# Streaming and Real-Time Data: Kinesis and MSK

Streaming is the discipline of moving *unbounded, ordered sequences of records* from
many producers to many consumers with low latency, durable buffering, and the ability
for each consumer to read at its own pace. On AWS this space is dominated by three
families: **Amazon Kinesis** (Data Streams, Data Firehose, and Managed Service for
Apache Flink), **Amazon MSK** (managed Apache Kafka), and the messaging services
**SQS/SNS/EventBridge** that solve an adjacent-but-different problem.

The single most important mental model for an interview: **a log is not a queue.**
A queue (SQS) is a work-distribution buffer — a message is delivered, processed, and
*deleted*; different consumers compete for messages; there is no replay. A log
(Kinesis/Kafka) is an append-only, ordered, *retained* sequence that many independent
consumer groups read from by *offset/sequence number*; nothing is deleted on read, so
you get replay, fan-out, and ordered reprocessing. Almost every "Kinesis vs SQS" or
"stream vs queue" question reduces to: *do you need replay, ordering, and multiple
independent readers of the same data, or do you need to hand each unit of work to
exactly one worker and forget it?*

The interview bar here is not "can you create a stream" — it is "can you pick the
right service and the right mode for a stated set of constraints (throughput, latency,
ordering, retention, ops maturity, cost, ecosystem) and defend the trade-off out
loud." This document is organized around exactly those decisions.

---

## Streaming versus queueing: the core mental model

Before picking a service, decide the *shape* of the problem.

- **Work queue (SQS):** producers enqueue units of work; a pool of workers each pull a
  message, process it, and delete it. The message is consumed *once* by *one* worker.
  Scaling = add workers; there is no notion of "replay from yesterday." Ordering is not
  guaranteed in Standard queues; FIFO queues give ordering per message-group.
- **Pub/sub fan-out (SNS/EventBridge):** one event, many independent subscribers, push
  delivery, no retained log to replay from (EventBridge can archive+replay, but it is
  event routing, not a high-throughput ordered log).
- **Streaming log (Kinesis Data Streams / Kafka on MSK):** an ordered, partitioned,
  *retained* log. Many consumer applications independently read the *same* records, each
  tracking its own position. Records persist for the retention window regardless of who
  read them, enabling replay, reprocessing with new code, and multiple downstream
  materializations (analytics, search index, cache warmer) from one source of truth.

```
QUEUE (SQS)                         LOG (Kinesis / Kafka)
producer -> [ m m m ] -> worker     producer -> [ r r r r r r r ] (retained)
                 |                                   ^      ^      ^
             delete on ack                       appA    appB    appC
 one consumer wins each msg          each app reads all records at own offset
 no replay, competing consumers      replay + independent fan-out + ordering/partition
```

**When to choose which (the reflex):**
- Need each task done once by one of N workers, elastic worker pool, no replay → **SQS**.
- Need to broadcast an event to several decoupled services → **SNS / EventBridge**.
- Need ordered, retained, replayable records consumed independently by multiple apps,
  or need real-time analytics over a firehose of events → **Kinesis Data Streams / MSK**.
- Need to *just land* streaming data in S3/Redshift/OpenSearch with no custom consumer
  code → **Data Firehose**.

The trap answer in interviews is reaching for a stream when a queue is simpler, or a
queue when you actually need replay/fan-out. State the discriminator explicitly.

---

## Kinesis Data Streams architecture and shards

**Kinesis Data Streams (KDS)** is a managed streaming log. A stream is a named,
ordered collection of **shards**. A shard is the unit of both capacity and ordering:

- **Ingest per shard:** up to **1 MB/s or 1,000 records/s**, whichever comes first.
- **Egress (read) per shard (shared/classic):** up to **2 MB/s**, shared across all
  standard consumers of that shard, with **GetRecords capped at 5 transactions/s** per
  shard (so ~200 ms polling interval; 10,000 records or 10 MB max per GetRecords call).
- **Record payload:** classically 1 MB max; the service now accepts records up to
  **10 MiB** (before base64) using burst capacity, but a single record still counts
  against the 1 MB/s shard budget, so oversized records throttle you.
- **Durability:** each record is synchronously replicated across **3 Availability
  Zones** in the Region before the write is acknowledged. KDS is a regional service;
  there is no automatic cross-Region replication.
- **Retention:** default **24 hours**, configurable **up to 365 days** (8,760 hours).
  Longer retention costs more but is what enables replay/reprocessing.

Each record carries a **partition key** (chosen by the producer), a **sequence number**
(assigned by KDS, monotonically increasing *within a shard*), and the data blob. KDS
hashes the partition key (MD5) to a 128-bit space and routes the record to the shard
whose hash-key range contains it. **Ordering is guaranteed only within a shard.**

```
producers --putRecord(partitionKey, data)-->  KDS stream
   MD5(partitionKey) -> hash range -> Shard-2
   Shard-0: [seq..][seq..]     (ordered within shard)
   Shard-1: [seq..][seq..]
   Shard-2: [seq..][seq..] --> consumers read by sequence number
   each shard replicated across 3 AZs
```

**Aggregate throughput = shards × per-shard limits.** A 10-shard stream ingests up to
10 MB/s or 10,000 rec/s and emits 20 MB/s to shared consumers. You scale by changing
the shard count (provisioned) or letting AWS do it (on-demand). Producers commonly use
the **Kinesis Producer Library (KPL)**, which *aggregates* many small user records into
one KDS record (up to the 1 MB limit) to beat the 1,000 rec/s-per-shard record ceiling
— crucial when you have millions of tiny events; the **KCL** de-aggregates on the read
side.

**Trade-off vs Kafka:** KDS's shard is coarser and more opinionated than a Kafka
partition — fixed per-shard limits, MD5 hashing you don't control, resharding is a
heavier operation. You gain a fully managed, no-broker service; you give up Kafka's
fine-grained tuning, compaction, and ecosystem.

---

## Partition keys, hot shards, and resharding

The partition key determines *which shard* a record lands on and therefore both **load
distribution** and **ordering granularity**. This is the KDS analog of DynamoDB's hot
partition problem.

- **Hot shard:** if many high-volume records share a partition key (e.g. partition key
  = `country` and 60% of traffic is one country, or a single `deviceId` emits a flood),
  they all hash to one shard, which then throttles at 1 MB/s or 1,000 rec/s while other
  shards sit idle. `ProvisionedThroughputExceededException` on writes is the symptom.
- **Fix:** choose a **high-cardinality, uniformly-distributed** partition key. If you
  need per-entity ordering but one entity is hot, use a composite key
  (`entityId#bucket`) to spread load — at the cost of losing strict global ordering for
  that entity (ordering is preserved only per shard, i.e. per key bucket).
- **Explicit hash key:** producers can override routing with an `ExplicitHashKey` to
  pin records to a specific shard when they need deterministic placement.

**Resharding (provisioned mode only):**
- **Split** a shard → two child shards (increase capacity for a hot range).
- **Merge** two adjacent shards → one (reduce cost when traffic drops).
- `UpdateShardCount` does a bulk uniform split/merge but is limited (roughly doubling or
  halving in one call; there are per-24h and scaling-factor constraints).
- Resharding creates **parent/child shard lineage**. Consumers (via KCL) must drain a
  parent shard fully — read all its records **in order up to the shard end** — before
  reading children, to preserve ordering across the split. During resharding you
  temporarily pay for both parent and child shards.

**Trade-off:** provisioned mode gives you control and lower cost at steady, known load,
but resharding is manual, operationally noisy, and must be planned ahead of traffic
spikes. If your traffic is spiky or unpredictable, the operational cost of getting
resharding right often outweighs the per-GB savings — which is exactly the case
**on-demand** mode was built for.

---

## On-demand versus provisioned capacity mode

KDS offers two capacity modes:

| Aspect | Provisioned | On-demand |
|---|---|---|
| You manage shards | Yes — set + reshard manually | No — AWS auto-scales shards |
| Default limits | shards × 1 MB/s in, 2 MB/s out | 4 MB/s write, 8 MB/s read (new stream) |
| Max throughput | unbounded (add shards, 20k/region default) | scales to 200 MB/s write/400 MB/s read (most Regions); up to **10 GB/s write, 20 GB/s read** in us-east-1/us-west-2/eu-west-1 |
| Scaling behavior | manual / your own autoscaler | doubles based on observed peak of prior 30 days; can't jump >2× peak instantly |
| Pricing | per shard-hour + PUT payload units | per GB ingested/retrieved (higher $/GB) |
| Best for | steady, predictable, high-volume | spiky/unknown traffic, new apps, low ops |

**On-demand** removes shard management entirely and auto-scales, but it scales relative
to the **peak throughput of the trailing 30 days** and won't instantly absorb more than
**2× the previous peak** — a sudden 10× spike from a cold baseline can still throttle.
It costs meaningfully more per GB, so at large sustained volume, provisioned is cheaper.

**Rule of thumb:** start new/unpredictable workloads on **on-demand** (pay for
simplicity), and switch to **provisioned** once traffic is well understood and large
enough that the per-GB premium exceeds the ops cost of managing shards. You can switch
modes but only **twice per 24 hours** per stream.

**Trade-off summary:** provisioned = lowest cost + full control + manual toil + spike
risk if under-provisioned; on-demand = highest simplicity + spike-friendly + higher
$/GB + a cold-start scaling ceiling.

---

## Consumers, KCL, Lambda, and enhanced fan-out

Consumers read from shards. There are two throughput models:

**1. Shared-throughput (classic) consumers** — poll via `GetRecords`. All classic
consumers of a shard **share** its 2 MB/s egress and the 5 GetRecords/s limit. Add a
second consumer app and each now effectively contends for that 2 MB/s; polling also
adds latency (~200 ms+ per poll). Fine for 1–2 consumers.

**2. Enhanced Fan-Out (EFO) consumers** — each registered consumer gets its **own
dedicated 2 MB/s per shard** (not shared) via **`SubscribeToShard`**, an HTTP/2 push
stream. Latency drops to **~70 ms** (vs ~200 ms+ polling). You can register up to
**20 EFO consumers** per stream (up to **50** with On-demand Advantage mode). EFO costs
extra (per-consumer-shard-hour + per-GB retrieved) but is the answer when you have many
independent consumers or need low latency without them starving each other.

**Consumption options:**
- **KCL (Kinesis Client Library):** handles shard discovery, lease coordination
  (checkpoints stored in a **DynamoDB lease table**), load-balancing shards across
  worker instances, and resharding lineage. One worker owns a shard's lease at a time,
  guaranteeing single-consumer ordering per shard within a consumer group.
- **Lambda event source mapping:** the simplest consumer. Lambda polls shards (or uses
  EFO) and invokes your function with batches. Concurrency is naturally bounded by
  shard count — **one concurrent invocation per shard** by default; **`ParallelizationFactor`**
  (up to 10) lets multiple concurrent invocations process the *same* shard while still
  preserving order **per partition key**. Supports batching window, bisect-on-error, and
  an on-failure destination (SQS/SNS) for poison records.
- **Managed Service for Apache Flink / Firehose / custom KCL apps** for analytics/ETL.

**Trade-off:** Lambda is the lowest-ops consumer but caps out on complex stateful
processing; KCL gives full control but you run and scale the fleet; EFO buys isolation
and latency for a per-consumer cost. A common failure mode: attaching 5 classic
consumers to one stream and wondering why each is slow — the shared 2 MB/s is the
culprit; the fix is EFO.

---

## Ordering, retention, and replay

**Ordering.** KDS and Kafka both guarantee ordering only **within a shard/partition**,
by sequence number/offset. There is **no total order across shards.** To get per-entity
ordering, route all of an entity's records to the same shard via its partition key —
which reintroduces hot-shard risk for high-volume entities. SQS Standard gives no
ordering; SQS FIFO gives ordering per **message group id** but at much lower throughput.

**Retention and replay.** Records persist for the retention window (KDS: 24h default →
365d max; Kafka: configured by time or size, effectively unbounded with tiered
storage). Consumers track their own position, so you can:
- **Replay:** reset a consumer to an older sequence number/offset to reprocess (e.g.
  after a bug fix, rebuild a downstream store from scratch).
- **Fan-out over time:** add a brand-new consumer that reads history from the start
  (`TRIM_HORIZON` in KDS, earliest offset in Kafka).

This replayability is *the* feature that queues lack and is the backbone of
event-sourcing, CQRS read-model rebuilds, and Kappa architecture. **Trade-off:** longer
retention = more storage cost and a bigger blast radius for replaying bad data; you
trade money and operational care for the safety net of reprocessing.

**Iterator types (KDS):** `TRIM_HORIZON` (oldest retained), `LATEST` (only new),
`AT_SEQUENCE_NUMBER` / `AFTER_SEQUENCE_NUMBER`, `AT_TIMESTAMP`. Choosing `LATEST` on a
new consumer skips history; `TRIM_HORIZON` reprocesses everything retained — a common
"why is my new consumer flooded / why did it skip data" gotcha.

---

## Kinesis Data Firehose versus Data Streams

**Amazon Data Firehose** (formerly Kinesis Data Firehose) is a fully managed
**delivery** service: it buffers incoming records and reliably loads them to a
destination — **S3, Redshift, OpenSearch, Splunk, and generic HTTP/partner endpoints**
— with **no consumer code, no shards to manage, and near-zero ops**. It can transform
records inline with a Lambda, convert JSON to Parquet/ORC, and dynamically partition
into S3 prefixes.

Key mechanics and limits:
- **Buffering:** delivers when either **buffer size** (S3: 1 MB–128 MB) **or buffer
  interval** (**0–900 s**) is reached, whichever first. The default interval range is
  60–900 s, but Firehose now supports a **zero-buffering** option (interval as low as
  0 s) for lower latency. This buffering is why Firehose is **near-real-time (seconds to
  minutes), not truly sub-second real-time** — with default buffering, latency to S3 is
  ~60 s+. Smaller buffers = fresher data but more, smaller objects (costlier downstream).
- **Sources:** Direct PUT, a Kinesis Data Stream, or MSK.
- **Scaling:** with a KDS/MSK source, Firehose scales with no user limit; Direct PUT has
  default per-Region throughput quotas that auto-raise on throttling.
- **Record size:** up to **1,000 KiB** (Direct PUT). Pricing rounds each record up to
  the nearest **5 KB**, so many tiny records cost more — batch them.
- **No replay, no random access:** Firehose is fire-and-deliver. Once delivered, it
  keeps no readable log (buffers up to 24h only if the destination is down for
  Direct PUT). You cannot attach multiple independent consumers or reprocess from it.

| | Data Streams (KDS) | Data Firehose |
|---|---|---|
| Purpose | durable, replayable log for real-time consumers | buffered delivery to stores |
| Consumers | many independent apps, custom code, replay | fixed managed destinations only |
| Latency | ~70 ms (EFO) to ~200 ms | 60 s–15 min (buffered) |
| Ordering / replay | yes / yes | no / no |
| Ops burden | shards or on-demand + consumer code | fully managed, no code |
| Scaling | shards / on-demand | automatic |
| Pricing | shard-hour or per-GB + PUT units | per-GB ingested (+ conversions) |

**Common pattern:** producers → **KDS** (source of truth, real-time consumers +
replay) → **Firehose** subscribed to the stream → S3 data lake in Parquet. You get
real-time processing *and* cheap durable archival from one pipeline.

**Trade-off:** choose Firehose when the only requirement is "get this data into
S3/Redshift/OpenSearch reliably with minimal ops," and you can tolerate seconds-to-
minutes latency and have no need for replay or multiple consumers. Choose KDS (or MSK)
the moment you need sub-second latency, replay, ordering, or several independent
consumer applications.

---

## Amazon MSK, Kafka managed versus self-managed

**Amazon MSK (Managed Streaming for Apache Kafka)** runs open-source Apache Kafka with
AWS managing broker provisioning, patching, AZ-spread, and health. You still get *real
Kafka*: topics, partitions, consumer groups, the full client/connector/Streams
ecosystem, log compaction, and fine-grained configs.

Why MSK/Kafka over Kinesis:
- **Throughput ceiling & tuning:** partitions scale far higher and are individually
  tunable; no hard 1 MB/s-per-unit ceiling like a shard. Better for very high sustained
  throughput and large records.
- **Ecosystem:** Kafka Connect (hundreds of connectors), Kafka Streams, ksqlDB,
  Schema Registry (AWS Glue Schema Registry or Confluent), MirrorMaker2 for
  replication, exactly-once semantics (idempotent producer + transactions).
- **Portability:** standard Kafka API — no vendor lock-in; lift-and-shift existing
  Kafka apps.
- **Log compaction:** retain the latest value per key (Kinesis has no equivalent).

Cost/ops of MSK vs Kinesis:
- MSK provisioned bills **per broker-hour + storage + data transfer** and you must size
  brokers, partitions, replication factor, and retention. You own capacity planning,
  partition-count decisions, rebalancing, and (until removed) ZooKeeper/KRaft concerns.
- Kinesis is *more* managed (no brokers at all) but less flexible and can be pricier at
  very high sustained throughput.

**Self-managed Kafka on EC2** gives maximum control (any Kafka version, custom plugins)
but you own everything: broker failures, patching, scaling, disk, ZooKeeper/KRaft — a
large operational tax. MSK exists to remove ~80% of that toil while keeping the API.

**Trade-off:** pick **Kinesis** when you want the least ops and your throughput/feature
needs fit shards; pick **MSK** when you need Kafka's ecosystem/throughput/portability
and have (or want) the team maturity to reason about partitions and consumer groups;
pick **self-managed Kafka** only when you need something MSK doesn't support (rare) and
accept the ops burden.

---

## MSK provisioned versus MSK Serverless

MSK has two flavors:

**MSK Provisioned:** you choose broker instance types (e.g. `kafka.m5.large` up to
large `m7g`/`m5` sizes), number of brokers, storage (with provisioned throughput and
**tiered storage** to offload old segments to cheaper storage), and all Kafka configs.
You control partition counts and replication factor (typically 3 across 3 AZs). Best for
large, steady, high-throughput workloads where per-unit cost matters and you want full
tuning.

**MSK Serverless:** no brokers, no capacity planning — you create a cluster, create
topics, and produce/consume; AWS auto-scales throughput and storage and bills on
**throughput (data in/out) + storage + partition-hours**. It uses **IAM
authentication** only. Great for spiky/unknown workloads and teams that want Kafka's API
without capacity management — the "on-demand of Kafka."

MSK Serverless has quotas that matter for design: default limits like max ingress/egress
per cluster and a cap on partitions per cluster (e.g. hundreds of partitions), and no
support for some provisioned features (custom broker configs, certain auth modes, tiered
storage tuning). If you need very high partition counts, log compaction tuning, or
non-IAM auth, use provisioned.

**Trade-off (mirrors KDS on-demand vs provisioned):** Serverless = zero capacity
planning, spike-friendly, higher $/throughput, feature/quota limits; Provisioned =
lowest cost at scale, full control and features, but you own broker/partition sizing and
scaling. Start unknown workloads Serverless; graduate heavy steady ones to provisioned.

---

## Kinesis versus MSK versus SQS versus SNS: choosing

The most-probed decision. Match the requirement to the primitive:

| Need | Best fit | Why |
|---|---|---|
| One task → exactly one worker, elastic pool, no replay | **SQS Standard** | competing consumers, at-least-once, huge scale, cheap |
| Ordered per-group task processing, dedup | **SQS FIFO** | ordering per group + exactly-once *processing* dedup, but ~300 TPS (3,000 with batching) per group cap |
| Broadcast one event to many services (push) | **SNS / EventBridge** | pub/sub fan-out, filtering, routing |
| Ordered, replayable log; multiple independent readers; real-time analytics; least ops | **Kinesis Data Streams** | shards, retention, EFO, KCL/Lambda |
| Just land streaming data in S3/Redshift/OpenSearch | **Data Firehose** | buffered managed delivery, no code |
| Very high throughput, Kafka ecosystem/connectors, portability, compaction | **Amazon MSK** | real Kafka, tunable partitions |

Discriminators to say out loud:
- **Replay & multiple independent consumers?** → log (KDS/MSK), not SQS.
- **Delete-on-consume, competing workers, backlog-as-buffer?** → SQS.
- **Ecosystem/connectors/compaction/portability, extreme throughput?** → MSK over KDS.
- **Minimize ops above all, throughput fits shards?** → KDS over MSK.
- **No consumer code, destination is S3/warehouse?** → Firehose.
- **FIFO throughput ceiling (300/3,000 TPS per group) too low?** → KDS partition
  ordering scales far higher; use it instead of SQS FIFO for high-volume ordered streams.

**SQS + SNS "fanout" vs a stream:** SNS→SQS fanout gives push pub/sub with per-consumer
queues and DLQs, but no ordered replayable history. If a new consumer needs *past*
events, only a log delivers that.

---

## Exactly-once, idempotency, and delivery semantics

Delivery semantics are a favorite senior-level probe. Defaults:

- **Kinesis Data Streams:** producers can accidentally write **duplicates** (a retry
  after a timed-out but actually-successful `PutRecord` writes the record twice). On the
  consumer side, KCL/Lambda deliver **at-least-once** — a record can be reprocessed
  after a worker crash before checkpoint, or during resharding. There is **no built-in
  exactly-once**; you achieve *effectively-once* by making consumers **idempotent**
  (dedupe on a business key or the KDS sequence number, or use conditional writes).
- **SQS Standard:** at-least-once + possible out-of-order. **SQS FIFO:** exactly-once
  *delivery* within the dedup window (5 min) + ordering per group, at lower throughput.
- **Kafka/MSK:** supports **idempotent producers** (`enable.idempotence=true`, dedup by
  producer id + sequence) and **transactions** for exactly-once *within Kafka*
  (read-process-write across topics). End-to-end exactly-once to an *external* sink
  still requires an idempotent/transactional sink; the classic advice remains "design
  idempotent consumers."
- **Firehose:** at-least-once delivery to the destination — duplicates possible; dedupe
  downstream (e.g. in the warehouse) if needed.

**Trade-off:** true exactly-once is expensive (transactions, coordination, throughput
cost). The pragmatic, interview-correct answer is almost always **"at-least-once
delivery + idempotent consumers/dedup keys"** rather than paying for strict
exactly-once, unless the domain (payments, ledgers) truly demands it.

---

## Real-time analytics with Managed Service for Apache Flink

**Amazon Managed Service for Apache Flink** (formerly Kinesis Data Analytics) runs
Apache Flink for **stateful stream processing** — windowed aggregations, joins,
enrichment, anomaly detection, and complex event processing over KDS/MSK sources, with
sinks to KDS, Firehose, S3, OpenSearch, etc. It manages the Flink cluster and offers
**durable, incremental checkpointing/snapshots** to S3 so stateful jobs recover exactly
where they left off, with autoscaling based on load.

Why Flink over a plain Lambda consumer:
- **Stateful windows & event-time processing** with watermarks (handle out-of-order and
  late events) — Lambda is stateless per invocation.
- **Exactly-once state** via checkpoints; large keyed state (RocksDB backend).
- **Rich SQL and DataStream APIs**, joins across streams, sub-second latency.

**Trade-offs:** Flink is more powerful but more complex and costly than Lambda/KCL;
you reason about parallelism, checkpoint intervals, and state size. For simple
stateless transforms or fan-in to a store, Lambda or Firehose is cheaper and simpler.
Choose Flink when you need windowed/stateful analytics or complex event processing in
real time. (For SQL-over-a-window with even less ops, some teams use OpenSearch or
Redshift streaming ingestion instead — trading Flink's flexibility for simplicity.)

---

## Lambda and Kappa architectures on AWS

Two canonical big-data architectures show up in design rounds:

- **Lambda architecture** (unrelated to AWS Lambda the service): a **batch layer**
  (accurate, high-latency — e.g. S3 + EMR/Glue/Redshift recomputing full views) plus a
  **speed layer** (low-latency approximate — e.g. KDS + Flink) whose outputs are merged
  at query time. Pro: correctness + low latency. Con: **two codebases** doing the same
  logic (batch and streaming), doubling maintenance and reconciliation cost.
- **Kappa architecture:** *everything* is a stream. One streaming pipeline (KDS/MSK +
  Flink) serves both real-time and historical needs; to "recompute," you **replay** the
  retained log through the same code. Pro: **one codebase**, one source of truth,
  simpler. Con: requires long retention (or tiered storage) and a stream engine that can
  reprocess history fast enough; large historical replays can be slow/expensive.

**AWS mapping:**
```
Producers -> Kinesis/MSK (retained log = source of truth)
   |-> Flink (Managed Service for Apache Flink)  -> real-time views (OpenSearch/DynamoDB)
   |-> Firehose -> S3 data lake (Parquet) -> Athena/Redshift/EMR (batch/replay)
```

**Trade-off / when:** Kappa is the modern, serverless-first default — pick it when the
log can retain enough history and one engine can serve both paths (simpler ops, no
dual-code reconciliation). Keep a Lambda-architecture batch layer when historical
recompute over petabytes is far cheaper/faster in batch (EMR/Redshift) than replaying
the whole stream, or when regulatory recomputation demands a separate authoritative
batch view.

---

## Backpressure, throttling, and failure modes

How these systems degrade — interviewers love "what breaks first."

**Throttling / hot partitions:**
- KDS write over 1 MB/s or 1,000 rec/s on a shard →
  `ProvisionedThroughputExceededException`; fix with better partition key, more shards,
  KPL aggregation, or on-demand. Reads over 2 MB/s or >5 GetRecords/s per shard throttle
  shared consumers → use EFO.
- Firehose Direct PUT over the Region quota throttles until it auto-raises; retry.

**Backpressure & consumer lag:** if consumers fall behind, the *log buffers* the
backlog (this is a feature — the stream absorbs spikes so downstream isn't overwhelmed).
Watch **`IteratorAgeMilliseconds`** (KDS) / consumer lag (Kafka): rising age means
consumers can't keep up and records may **age out of retention before being read**
(silent data loss). Mitigate with more consumer parallelism (shards ×
ParallelizationFactor, more KCL workers/EFO), longer retention as a safety buffer, or
Flink autoscaling. This buffering-as-backpressure is a key advantage of streams/queues
over synchronous calls.

**Poison records:** a bad record can block a shard (Lambda retries the batch forever,
stalling that partition). Use **bisect-on-error**, max retry/record age, and an
**on-failure destination** (SQS/SNS DLQ) so one bad record doesn't halt the shard.

**AZ / Region failure:** KDS and MSK replicate across **3 AZs** in a Region, so a
single-AZ outage is transparent. **Neither is multi-Region by default** — a Region
failure takes the stream down. For DR you need cross-Region replication: MirrorMaker2 /
MSK Replicator for Kafka, or a consumer that re-publishes to a stream in another Region
for KDS. State the RPO/RTO cost of this explicitly.

**Ordering hazards:** resharding, ParallelizationFactor >1 across keys, and multiple
producers to the same key from different threads can reorder if not handled; KCL and
per-partition-key semantics preserve order only when respected.

---

## Cost reasoning and capacity estimation

Back-of-envelope skills interviewers probe.

**Sizing shards (provisioned KDS).** Need = max( ingest_MBps / 1, ingest_records_per_s /
1000 ). Example: 5,000 small events/s at 500 bytes each = 2.5 MB/s **and** 5,000 rec/s.
By bytes you'd need 3 shards; by records you need **5 shards** (5,000/1,000) — the
**record-count limit binds first** for many tiny records. KPL aggregation packs small
records into 1 MB records, relieving the record-count ceiling so bytes bind instead
(3 shards). Always check *both* limits and take the max.

**KDS pricing dimensions (provisioned):** per **shard-hour** + per **million PUT payload
units** (each unit = 25 KB; a 60 KB record = 3 units). Extras: **EFO** (per
consumer-shard-hour + per-GB retrieved), **extended retention** (per shard-hour beyond
24h), **long-term retention** (per GB-month beyond 7 days). On-demand bills per-GB
in/out (higher) with no shard-hours.

**MSK pricing:** per **broker-hour** (by instance size) + **storage-GB-month** (+
provisioned-throughput and tiered-storage options) + **data transfer**. Sizing =
partitions × per-partition throughput target, brokers to hold replicas across 3 AZs.

**Firehose pricing:** per **GB ingested** (record rounded up to nearest 5 KB) + optional
format-conversion and dynamic-partitioning charges. Many tiny records inflate cost →
batch before sending.

**Cost trade-off heuristics:**
- At **steady high volume**, provisioned KDS or MSK beats on-demand/serverless per GB.
- **Many tiny records** hurt everywhere (record-count shard limits, 25 KB PUT unit
  rounding, 5 KB Firehose rounding) → **aggregate/batch**.
- **EFO** adds cost per consumer — only pay for it when you have many consumers or need
  low latency; two consumers on shared throughput may be fine and free of EFO charges.
- **Long retention** is cheap insurance for replay but not free — set it to your real
  reprocessing window, not "max just in case."

---

## Trade-offs and when to use what

A consolidated decision cheat-sheet.

- **Stream (KDS/MSK) vs Queue (SQS):** need replay, ordering, and multiple independent
  consumers of the same records → stream. Need one-worker-per-task, elastic workers,
  delete-on-ack, backlog buffer → SQS. Don't use a stream just to distribute work.
- **KDS vs MSK:** minimal ops and shard-fit throughput → **KDS**. Kafka ecosystem
  (Connect/Streams/compaction), portability/no lock-in, very high sustained throughput,
  fine tuning → **MSK**. Willing to run everything for a niche need → self-managed Kafka.
- **KDS on-demand vs provisioned:** spiky/unknown/new → **on-demand** (mind the 2×-of-
  prior-peak cold ceiling). Steady/large/cost-sensitive → **provisioned** (own the
  resharding toil).
- **MSK Serverless vs Provisioned:** spiky/unknown + IAM auth OK → **Serverless**.
  Large steady + full Kafka features/tuning + lowest $/throughput → **Provisioned**.
- **KDS vs Firehose:** need real-time consumers/replay/ordering → **KDS**. Just deliver
  to S3/Redshift/OpenSearch with no code, seconds-to-minutes latency OK → **Firehose**
  (often *both*: KDS as source, Firehose subscribed for the S3 archive).
- **Shared vs Enhanced Fan-Out consumers:** 1–2 consumers, cost-sensitive → shared.
  Many consumers or low-latency isolation needed → **EFO** (pay per consumer-shard).
- **Lambda vs KCL vs Flink consumer:** simple stateless transforms/fan-in → **Lambda**.
  Full control over a fleet, custom coordination → **KCL**. Stateful windows/joins/CEP,
  exactly-once state → **Managed Service for Apache Flink**.
- **SQS FIFO vs KDS for ordered high-volume:** FIFO caps ~300 TPS/group (3,000 with
  batching); above that with many entities, **KDS partition ordering** scales far higher.
- **Exactly-once:** default to **at-least-once + idempotent consumers**; pay for
  transactions/FIFO dedup only when the domain truly requires it.
- **Kappa vs Lambda architecture:** modern default **Kappa** (one stream, one codebase,
  replay for recompute) when the log can retain enough and one engine serves both paths;
  keep a **batch layer** when petabyte historical recompute is far cheaper in batch.
- **DR:** both KDS/MSK are 3-AZ but single-Region; add MSK Replicator/MirrorMaker2 or
  cross-Region re-publish for multi-Region, accepting added cost and RPO/RTO.

---

## Common interview follow-up questions

- "Why not just use SQS here?" → Because you need replay / multiple independent
  consumers / ordered reprocessing — the log properties SQS lacks.
- "Your partition key is `customerId` and one customer is 50% of traffic — what
  happens and how do you fix it?" → Hot shard throttling; composite key to spread,
  accepting weaker per-customer ordering, or on-demand.
- "How do you get exactly-once?" → You usually don't; at-least-once + idempotent
  consumers keyed on business id or sequence number; transactions/FIFO only if required.
- "You added a 4th consumer and everything slowed down — why?" → Shared 2 MB/s per
  shard split across classic consumers; move to EFO.
- "IteratorAgeMilliseconds is climbing — what's wrong and what breaks?" → Consumers
  lagging; risk of records aging out of retention (data loss). Add parallelism / EFO /
  retention.
- "KDS vs MSK for a new team with no Kafka experience?" → KDS (least ops) unless a
  specific Kafka feature (connectors, compaction, portability) is required.
- "How would you land this in a data lake and also do real-time alerting?" → KDS as
  source → Flink for alerts + Firehose to S3 Parquet (Kappa-style).
- "Region goes down — what's your RPO/RTO?" → Single-Region by default; describe
  cross-Region replication cost and the resulting RPO.
- "1,000-record/s limit vs 1 MB/s limit — which binds first for tiny events?" → Record
  count; use KPL aggregation.
- "On-demand still throttled during a launch spike — why?" → It scales to ~2× trailing
  30-day peak; a cold 10× spike exceeds that; pre-warm or use provisioned with headroom.

## References

- Amazon Kinesis Data Streams Developer Guide — *Quotas and limits*, *Resharding*,
  *Enhanced fan-out*, *Reading data* (docs.aws.amazon.com/streams).
- Amazon Data Firehose Developer Guide — *Quotas*, *Buffering hints*, *Data delivery*
  (docs.aws.amazon.com/firehose).
- Amazon MSK Developer Guide — *MSK provisioned*, *MSK Serverless*, *Tiered storage*,
  *MSK Replicator* (docs.aws.amazon.com/msk).
- Amazon Managed Service for Apache Flink Developer Guide — checkpointing, autoscaling.
- AWS Lambda Developer Guide — *Using Lambda with Kinesis* (event source mapping,
  ParallelizationFactor, batching, on-failure destinations).
- AWS Well-Architected Framework — Reliability & Performance Efficiency pillars.
- AWS Architecture Center — streaming data / real-time analytics reference architectures.
- re:Invent deep-dive sessions on Kinesis Data Streams, Amazon MSK, and streaming
  analytics with Apache Flink (300/400-level).
- Amazon SQS Developer Guide — Standard vs FIFO throughput and semantics (for contrast).
