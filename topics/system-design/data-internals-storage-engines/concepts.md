# Data Store Internals: Storage Engines, MVCC and Schema Evolution

> The storage engine is where abstract data-model promises meet physics: disks,
> pages, cache lines, and the write/read/space amplification triangle. Senior
> interviews probe whether you can reason from an **access pattern** (write-heavy
> ingest vs point-read vs range scan vs analytical aggregation) down to the right
> on-disk structure, isolation mechanism, and encoding — and defend it against the
> alternative with concrete trade-offs, failure modes, and math. This topic is
> almost entirely about **what you give up to get what you want**. There is no
> "best" engine — only the right one for a set of constraints.

---

## LSM-tree internals

**Intuition.** A Log-Structured Merge-tree turns random writes into sequential
writes. Instead of updating data in place, every write is appended to an in-memory
sorted structure and periodically flushed to disk as an immutable sorted file. The
disk therefore only ever sees large sequential writes — which is why LSM engines
crush B-trees on write throughput, especially on spinning disks and flash where
random-write endurance matters.

**Mechanism.**
- **WAL (write-ahead log):** every write is first appended to an on-disk commit
  log for durability. If the process crashes before the memtable is flushed, the
  WAL is replayed on restart.
- **Memtable:** an in-memory sorted map (usually a skip list or balanced tree)
  that absorbs writes. Reads check it first.
- **Flush:** when the memtable hits a size threshold (e.g. 64 MB), it is frozen
  and written out sequentially as an **SSTable** (Sorted String Table) — an
  immutable file of key-sorted entries plus a sparse index and a bloom filter. A
  new empty memtable takes over.
- **Compaction:** background threads merge SSTables, discarding overwritten/deleted
  keys, keeping the tree from growing unbounded and bounding read fan-out.
- **Deletes** are logical: a **tombstone** marker is written. The key is only
  physically removed when compaction has merged past every older copy. Tombstones
  that are dropped too early resurrect deleted data (the "zombie" bug); RocksDB/
  Cassandra keep them for `gc_grace_seconds` to let all replicas converge.

```
write ──► WAL (fsync) ──► memtable (RAM, sorted)
                              │ flush at threshold
                              ▼
        SSTable_0  SSTable_1  SSTable_2 ...   (immutable, on disk)
                              │ background compaction
                              ▼  merged, dedup'd, tombstones dropped
                    fewer / larger SSTables
```

**Read path.** A point read checks the memtable, then SSTables newest→oldest. Each
SSTable is gated by a **bloom filter** (skip if key definitely absent) and a sparse
index (binary-search to the right block). Worst case a read touches every level, so
read cost grows with the number of sorted runs — this is **read amplification**.

**Systems.** RocksDB/LevelDB, Cassandra, ScyllaDB, HBase, BigTable, InfluxDB,
CockroachDB & TiKV (RocksDB under the hood), and the write path of many others.

**Trade-offs.** You gain sequential write throughput and good compression (sorted,
immutable data packs well). You pay **read amplification** (multiple runs to check),
**space amplification** (obsolete versions linger until compaction), and
**compaction is a background tax**: it competes for disk I/O and CPU, and if write
rate outruns compaction throughput the LSM enters *write stall / backpressure*
(RocksDB literally throttles or stops writes). Compaction also causes p99/p999
latency spikes when a large merge saturates I/O. When to prefer: write-heavy,
ingest-heavy, TTL/time-series workloads. When to avoid: read-latency-critical
point lookups on data that fits in a B-tree cache, or workloads that can't tolerate
compaction jitter.

---

## Compaction strategies and amplification trade-offs

Three amplifications define the cost of any LSM tuning (measured as ratios):
- **Write amplification (WA):** bytes actually written to disk ÷ bytes of user
  data. Every compaction rewrites data, so a byte can be rewritten many times.
- **Read amplification (RA):** disk reads per logical read (how many runs/levels a
  lookup may touch).
- **Space amplification (SA):** bytes on disk ÷ bytes of live data (obsolete
  versions + tombstones not yet reclaimed).

You cannot minimize all three — tuning compaction picks a point on the surface.

| Strategy | Write amp | Read amp | Space amp | Best for |
|---|---|---|---|---|
| **Size-tiered (STCS)** | **Low** | High | **High** (up to ~2×+; needs headroom for a big merge) | write-heavy, ingest |
| **Leveled (LCS)** | **High** (~10–30×) | **Low** (~1 run/level, ≤ ~10 SSTables) | **Low** (~1.1×) | read-heavy, space-constrained |
| **Tiered+Leveled / hybrid (universal)** | medium | medium | medium | mixed |
| **FIFO / TTL** | ~1× | high | low | pure time-series, drop old |

- **Size-tiered:** merge SSTables of similar size into a bigger one. Few merges →
  low WA, but many similarly-sized runs coexist → high RA, and during a merge you
  transiently need ~2× the space of the run being merged → high SA.
- **Leveled:** L0 flushed from memtable; each level Lᵢ is ~10× Lᵢ₊₁ and holds
  **non-overlapping** key ranges, so a read touches ≤1 SSTable per level. Great RA
  and SA, but promoting a key up levels rewrites it repeatedly → high WA (a classic
  figure is ~10–30× on Leveled vs a few× on size-tiered).

**Interview line:** "Leveled trades write amplification for read and space
amplification; size-tiered does the opposite. Pick leveled when reads and disk cost
dominate; size-tiered when ingest throughput dominates and you have disk headroom."

---

## B-tree and B+tree internals

**Intuition.** The B+tree is the read-optimized in-place structure that has
dominated relational OLTP for 40 years. Data is kept sorted in fixed-size **pages**
(4–16 KB) forming a balanced tree; a lookup is `O(log_b N)` page reads and, because
the tree is shallow (fanout of hundreds), typically 3–4 page accesses reach any row
even in a billion-row table.

**Mechanism.**
- **In-place update:** to change a key, you find its page and overwrite it. This is
  a **random write**, unlike an LSM append.
- **B+tree specifics:** all values live in leaf pages; internal pages hold only
  keys + child pointers (higher fanout → shallower tree). Leaves are linked in a
  list for efficient range scans.
- **WAL / redo log:** because an in-place page update that crashes mid-write can
  corrupt a page, B-trees write a WAL first. Postgres additionally does
  **full-page writes** (writes the whole page to WAL the first time it's touched
  after a checkpoint) to survive **torn pages** — partial 8 KB writes across a
  power failure, since the OS/disk atomic unit may be 512 B or 4 KB.
- **Page splits / merges:** an insert into a full page splits it into two; deletes
  can trigger merges. Splits cause **fragmentation** and are the source of B-tree
  write amplification.

**Trade-offs.** You gain excellent read latency (predictable, cache-friendly, one
copy of each key so no run-merging), strong locality for range scans, and mature
locking/MVCC integration. You pay with **random writes**, **in-place update
hazards** (WAL + full-page writes add write amplification of their own), and worse
raw write throughput than LSM. B-trees also fragment over time and each key exists
in exactly one place (good for reads, means writes seek). When to prefer: read-heavy
or balanced OLTP, point + range queries, strong transactional needs. When LSM wins:
sustained high write/ingest rates, compressible data, SSD-endurance-sensitive
workloads.

---

## The RUM conjecture

**Statement.** For any data structure/access method, of the three overheads —
**R**ead, **U**pdate, and **M**emory (space) — you can optimize two only at the
expense of the third (Athanassoulis et al., 2016). It is the storage-engine analog
of "pick two."

- **B+tree:** optimizes **Read** (and reasonable memory) → pays **Update** cost.
- **LSM (leveled):** optimizes **Update** and **Memory** → pays **Read** cost.
- **LSM (size-tiered):** optimizes **Update** → pays **Read** and **Memory**.
- **Hash index / in-memory:** optimizes **Read** and **Update** → pays **Memory**.
- **Bloom filters, zone maps, learned indexes** are all *auxiliary* structures that
  buy read overhead reduction by spending memory.

**Why it matters in interviews:** it reframes "LSM vs B-tree" as choosing which
overhead your workload can afford. Bloom filters, caching, and adaptive indexing
don't repeal RUM — they trade memory to soften a read penalty. Any pitch that
claims to be best at all three should trigger skepticism.

---

## Bloom filters in LSM engines

**Purpose.** A bloom filter is a probabilistic set membership structure that answers
"is key K possibly in this SSTable?" with **no false negatives** and a tunable
**false-positive rate**. LSM engines attach one per SSTable so a point read can skip
files that definitely don't contain the key — turning read amplification from
`O(#SSTables)` toward `O(1)` for the common miss case.

**Math.** For `n` keys, `m` bits, `k` hash functions, false-positive probability
`p ≈ (1 - e^(-kn/m))^k`. Optimal `k = (m/n) ln 2`. The classic result: about
**~10 bits per key gives ~1% FPR**; ~14–15 bits ≈ 0.1%. Bits-per-key is the memory
knob you spend to reduce read amplification (a direct RUM trade-off).

**Critical limitation:** bloom filters help **point lookups only**. A **range
scan** (`WHERE k BETWEEN a AND b`) cannot use a standard bloom filter and must open
every candidate SSTable — which is why range-heavy LSM workloads still suffer read
amplification and lean on leveled compaction, prefix bloom filters, or SSTable-level
min/max key metadata (zone maps) instead. Tombstones also defeat bloom filters for
"does this deleted key exist" checks. When you delete a huge range, accumulated
tombstones can make scans pathologically slow until compaction clears them.

---

## Write-ahead logging and group commit

**Why WAL.** Durability (the D in ACID) requires that a committed change survive a
crash. Flushing the actual data pages on every commit would be random-I/O-bound and
slow. Instead the engine appends the change to a sequential log and `fsync`s *that*;
data pages are flushed lazily later (at a **checkpoint**). WAL = write-ahead logging;
the invariant is **log record hits durable storage before the corresponding data
page** (that's the "ahead").

**The fsync bottleneck.** A single `fsync` costs ~0.1–10 ms depending on device
(NVMe vs spinning vs network EBS). If every transaction fsyncs independently, commit
throughput is capped at `1 / fsync_latency` per log stream — maybe a few hundred to a
few thousand commits/s.

**Group commit.** Batch many transactions' log records and fsync them together in one
syscall. If 100 transactions arrive within one 5 ms fsync window, one fsync durably
commits all 100 → ~100× throughput at the cost of a few ms of added latency per
commit. This is the classic **throughput-vs-latency** trade — group commit *raises*
individual commit latency slightly to *raise* aggregate throughput dramatically.
Postgres (`commit_delay`, `commit_siblings`), MySQL/InnoDB (binlog + redo group
commit), and essentially every serious engine do this.

**Durability knobs (the danger zone).** `innodb_flush_log_at_trx_commit=1` /
`synchronous_commit=on` = fsync each commit (safe). Setting them to relaxed modes
(`=2`, `synchronous_commit=off`) means commits ack before the log is durable — you
gain throughput but a crash loses the last few hundred ms of "committed" data. This
is a legitimate choice for some workloads (e.g. analytics ingest) and a data-loss
landmine for ledgers.

---

## MVCC and snapshot isolation

**Intuition.** Multi-Version Concurrency Control lets readers and writers not block
each other by keeping **multiple versions** of each row. A reader sees a consistent
**snapshot** as of its start; a concurrent writer creates a *new* version rather
than overwriting, so the reader's snapshot is undisturbed. "Readers don't block
writers, writers don't block readers."

**Mechanism (Postgres-style).** Each row version carries `xmin` (creating txn id)
and `xmax` (deleting/superseding txn id). A transaction gets a snapshot = the set of
txn ids committed at its start. A version is **visible** iff its `xmin` is committed
and ≤ snapshot and its `xmax` is not visible (not yet committed or after snapshot).
An UPDATE writes a new tuple and sets `xmax` on the old one. Old versions accumulate
and must be reclaimed (see vacuum/GC).

Other implementations differ:
- **MySQL/InnoDB:** keeps the current row in place and older versions in the
  **undo log**; reads reconstruct the snapshot version by walking undo.
- **Oracle:** rollback/undo segments; "ORA-01555 snapshot too old" is the classic
  failure when undo is recycled before a long reader finishes.

**Snapshot Isolation (SI):** the isolation level MVCC naturally provides. Reads come
from a single consistent snapshot; writes use **first-committer-wins** (or
first-updater-wins with row locks) to prevent **lost updates** on the same row. SI
eliminates dirty reads, non-repeatable reads, and phantoms *for the reader's view* —
but is **NOT serializable**: it permits **write skew** and read-only anomalies.

**Trade-offs.** You gain non-blocking reads and stable snapshots (great for
long-running reports amid OLTP writes). You pay with **version bloat / GC pressure**,
**snapshot-too-old** risks for long transactions, and the subtle correctness gap
(write skew) that many engineers wrongly assume "snapshot isolation = safe."

---

## Vacuum and garbage collection of old versions

**The problem.** MVCC never overwrites; it *accumulates* dead versions. Without
reclamation, disk grows unbounded and reads slow down scanning dead tuples. Every
MVCC engine needs a GC mechanism.

- **Postgres `VACUUM`:** marks dead tuples' space reusable; `autovacuum` runs it in
  the background. It also updates the **visibility map** (enabling index-only scans)
  and prevents **transaction-id wraparound** (the 32-bit `xid` space is finite; if
  the oldest unfrozen xid approaches 2³¹, Postgres will force an anti-wraparound
  vacuum and, at the limit, refuse writes to protect data). `VACUUM FULL` rewrites
  the table to actually shrink files but takes an exclusive lock.
- **InnoDB purge threads** reclaim undo-log versions once no snapshot needs them.

**Failure modes.**
- **Long-running / idle-in-transaction transactions** hold back the "oldest snapshot
  still needed" horizon → vacuum cannot remove versions newer than that → **bloat**.
  One forgotten `BEGIN;` can bloat a busy table for hours. This is one of the most
  common real production incidents in Postgres shops.
- **Write-heavy hot rows** produce long version chains; reads walking them slow down.
- Vacuum itself consumes I/O; aggressive autovacuum on a hot table competes with
  foreground traffic (tune cost limits).

**Interview gotcha:** "Why did our Postgres table balloon to 5× its data size?" →
a long-lived transaction (or replication slot / prepared txn) pinned the xmin
horizon and blocked vacuum. The fix is bounding transaction lifetime, not more disk.

---

## Isolation levels precisely

The SQL standard defines levels by which **anomalies** they forbid. Know the exact
mapping — this is a favorite trap.

| Anomaly | Read Uncommitted | Read Committed | Repeatable Read | Snapshot Isolation | Serializable |
|---|---|---|---|---|---|
| **Dirty read** (see uncommitted data) | possible | prevented | prevented | prevented | prevented |
| **Non-repeatable read** (row changes between reads) | possible | possible | prevented | prevented | prevented |
| **Phantom** (new rows match a predicate on re-query) | possible | possible | possible* | prevented (for reads) | prevented |
| **Lost update** (two RMW clobber) | possible | possible | prevented† | prevented (first-committer-wins) | prevented |
| **Write skew** (disjoint writes break a cross-row invariant) | possible | possible | possible | **possible** | prevented |

\* ANSI RR doesn't forbid phantoms; some engines' "RR" (e.g. InnoDB via next-key
locks, Postgres RR = SI) go further. †Lost-update prevention at RR is
implementation-dependent.

**The naming minefield:**
- **Postgres `REPEATABLE READ` == Snapshot Isolation** (not ANSI RR). Its
  `SERIALIZABLE` is true SSI.
- **Oracle `SERIALIZABLE` is actually Snapshot Isolation** — it allows write skew,
  so it is *not* truly serializable. This is the canonical "the label lies" example.
- **InnoDB `REPEATABLE READ`** uses consistent snapshots + next-key (gap) locks that
  prevent many phantoms; its default is RR, unusual among engines.
- Default is usually **Read Committed** (Postgres, Oracle, SQL Server default), which
  means each *statement* sees a fresh snapshot — non-repeatable reads are allowed.

**Serializable** is the only level guaranteeing that concurrent execution ≡ *some*
serial order. Everything below it admits at least one anomaly; the engineering job
is knowing which anomalies your invariants can tolerate.

---

## Write skew and serializable snapshot isolation

**Write skew** is the anomaly that snapshot isolation *cannot* stop and that catches
senior engineers. Two transactions each read an overlapping set, each check an
invariant that currently holds, then each write to **different** rows — individually
fine, jointly violating the invariant.

**Canonical example — on-call doctors.** Invariant: "≥1 doctor on call." Two doctors
are on call. Both run: `SELECT count(*) WHERE on_call=true` → 2, "ok, I can leave",
then each sets their own row `on_call=false`. Under SI both read the same snapshot
(count=2), both commit (they write different rows → no write-write conflict), and now
**zero** doctors are on call. Serializable would have forced one to fail. Other
examples: double-booking a meeting room, allowing two overlapping reservations,
overdrawing across two accounts with a combined-balance rule.

**Why SI misses it:** SI's first-committer-wins only detects **write-write**
conflicts on the *same* item. Write skew has *no* write-write conflict — the conflict
is a **read-write** dependency (each read data the other wrote/would write).

**Serializable Snapshot Isolation (SSI)** (Cahill/Fekete/Röhm; Postgres
`SERIALIZABLE`): run optimistically like SI but **track read-write dependencies** at
runtime. A serialization anomaly requires a specific structure — two consecutive
**rw-antidependency** edges forming a "dangerous structure" in the dependency graph.
When SSI detects one it **aborts** one transaction (`could not serialize access`,
SQLSTATE 40001). Trade-off: SSI has low overhead when contention is low, but under
high contention it produces **false-positive aborts** (it's conservative — it may
abort transactions that would actually have been fine), so the app must retry. It
also tracks predicate/read locks (via SIREAD locks), adding memory overhead.

**Alternatives to defeat write skew without full serializable:** materialize the
conflict — `SELECT ... FOR UPDATE` the rows you read (take explicit locks so a
write-write conflict is created), or lock a summary/parent row, or use a serializable
level. In an interview: "SI doesn't prevent write skew; either use SSI/serializable,
or take explicit read locks (`SELECT FOR UPDATE`) to materialize the conflict."

---

## Schema evolution, backward and forward compatibility

**The problem.** In a live system, code and data change at different rates, and
during a **rolling upgrade** old and new code run simultaneously against data written
by both. Compatibility must flow **both directions**:
- **Backward compatibility:** *new* code can read data written by *old* code.
- **Forward compatibility:** *old* code can read data written by *new* code
  (it must ignore fields it doesn't understand).

Forward compatibility is the trickier one and the reason tag-based binary encodings
exist: old readers skip unknown field tags.

**Safe vs unsafe changes:**
- **Adding an optional field with a default** → safe both ways. Old readers ignore
  it; new readers fill the default when reading old data.
- **Adding a required field** → breaks backward compat (old data has no value).
- **Removing a field** → only safe if it was optional; you must never reuse its
  tag/id.
- **Renaming a field** → safe in tag-based formats (name is cosmetic, tag is the
  identity) but breaks name-based formats like JSON.
- **Changing a field's type** → generally unsafe; may truncate or misparse.

**Rolling-upgrade rule:** deploy readers that tolerate the new field *before* writers
that produce it ("expand/contract" or **parallel change**): (1) add field as optional,
deploy everywhere; (2) start writing it; (3) start reading it; (4) later, remove old
field. Skipping step 1 breaks forward compatibility during the rollout window.

**Data-at-rest longevity:** encodings must let you read data written *years* ago by
long-gone code versions. This is why analytics/event stores care so much about
schema evolution — the data outlives every service that wrote it.

---

## Data encoding formats: Avro, Protobuf, Thrift and JSON

| Format | Schema | Field identity | Forward/backward compat | Size | Notes |
|---|---|---|---|---|---|
| **JSON / XML** | none (self-describing) | field **name** (as text) | tolerant but ambiguous types (numbers, no int/float distinction, no bytes) | large (names repeated every record) | ubiquitous, human-readable, no schema enforcement |
| **Protobuf** | `.proto`, tag numbers | **field tag number** | strong: unknown tags skipped (fwd), optional+default (bwd) | compact (varints) | required→optional removed in proto3 for this reason; repeated fields |
| **Thrift** | IDL, field ids | **field id** | similar to Protobuf | compact (BinaryProtocol/CompactProtocol) | Facebook origin; multiple protocols |
| **Avro** | writer + reader schema, **no tags** | field **name**, matched writer→reader | strong via schema resolution; add/remove needs defaults | most compact (no field ids/names in payload) | schema must travel with data (or via registry); great for big files/streams |

**Key mechanistic distinctions:**
- **Protobuf/Thrift** embed a **tag/id** per field in the bytes; the schema maps
  tag→name/type. Compatibility works because readers skip unknown tags and use
  declared defaults. You must **never reuse a tag number** (proto reserves removed
  tags for this reason).
- **Avro** puts **nothing** identifying fields in the payload — the bytes are a bare
  concatenation decoded strictly by position/order. It requires the exact **writer's
  schema** to decode, then resolves it against the **reader's schema** (matching by
  name, applying defaults for fields the reader has but the writer didn't, ignoring
  fields the writer had but the reader dropped). This makes Avro the most compact but
  means "schema must be available at read time" — which motivates the schema
  registry. Avro's schemaless payload is ideal for **dynamically generated schemas**
  (e.g. one Avro schema per DB table generated from the DB schema — no manual tag
  assignment).

**Interview line:** "JSON for external/debuggable APIs; Protobuf/Thrift for RPC and
where per-field evolution via tags is convenient; Avro for large-volume event/data
streams and files where payload size and dynamic schemas matter and a registry
distributes schemas."

---

## Schema registry and rolling upgrades

**Why.** With Avro (and increasingly Protobuf) over a stream like Kafka, embedding
the full schema in every message would bloat payloads. A **schema registry**
(Confluent Schema Registry, AWS Glue Schema Registry, Apicurio) stores schemas
centrally; each message carries a small **schema id**, and consumers fetch/cache the
schema by id.

**Compatibility enforcement.** The registry can *reject* an incompatible schema
registration at CI/publish time, enforcing a policy:
- **BACKWARD** (default): new schema can read data written with the previous schema →
  upgrade **consumers first**. Allows deleting fields and adding optional fields.
- **FORWARD:** previous schema can read data written with new schema → upgrade
  **producers first**. Allows adding fields and deleting optional fields.
- **FULL:** both directions (transitive variants check against *all* prior versions).
- **NONE:** no checks (dangerous).

**Trade-off:** the registry becomes a piece of critical infrastructure on the
data path. Mitigate with client-side caching (schema id → schema, immutable once
registered), high availability, and treating schema evolution as a reviewed,
CI-gated change — not an ad-hoc producer edit.

---

## Secondary indexes: local versus global

A secondary index maps a non-primary attribute to rows. In a partitioned/sharded
store the central question is *how the index is partitioned relative to the data*.

**Local (document-partitioned) index.** Each partition indexes only its own rows.
- **Write:** cheap — a write updates only the local index on the same partition
  (one node, often same transaction).
- **Read (by secondary key):** must **scatter-gather** across *all* partitions
  because matching rows can live anywhere — this is a **fan-out read**; latency is
  bounded by the slowest partition (tail-latency amplification).
- Used by: DynamoDB **LSI**, Elasticsearch shards, MongoDB, Cassandra secondary
  indexes, Riak.

**Global (term-partitioned) index.** The index itself is partitioned by the indexed
term, independent of data partitioning.
- **Read:** efficient — the term lives on one (or few) partition(s); no scatter.
- **Write:** expensive and **cross-partition** — one row update may touch a
  different partition than the data, so keeping it consistent needs a distributed
  transaction (rare) or async update → the index is often **eventually consistent**.
- Used by: DynamoDB **GSI** (async-updated, eventually consistent, own capacity).

| Dimension | Local (doc-partitioned) | Global (term-partitioned) |
|---|---|---|
| Write cost | low (local) | high (cross-partition) |
| Read cost | high (scatter-gather all partitions) | low (targeted) |
| Consistency | can be same-txn consistent | usually async / eventually consistent |
| Tail latency on read | bounded by slowest shard | one shard |

**Interview line:** "Local index = cheap writes, scatter-gather reads; global index =
cheap targeted reads, expensive cross-partition writes and usually eventual
consistency. Choose by whether your query pattern or your write pattern dominates."

---

## Change data capture and the outbox pattern

**CDC.** Change Data Capture streams a database's row-level changes to downstream
consumers (search index, cache, data warehouse, other services). The robust way is
to **tail the WAL / replication log** (Postgres logical decoding, MySQL binlog,
Mongo oplog) rather than polling — the log is the authoritative, ordered,
already-durable record of every committed change. Debezium is the canonical
implementation. CDC gives you an ordered stream with the DB as the single source of
truth; downstream systems are derived views that can be rebuilt by replaying the log
(**log compaction** keeps the latest value per key so a new consumer can bootstrap).

**The dual-write problem.** A service that must (a) commit to its DB **and** (b)
publish an event to Kafka has no atomicity across the two systems. If it writes the
DB then crashes before publishing (or vice versa), the two diverge — you get a lost
or phantom event. Distributed 2PC across DB+broker is fragile and often unsupported.

**Transactional outbox pattern.** Write the event into an `outbox` **table in the
same local transaction** as the business change. The DB commit makes both atomic (one
ACID transaction). A separate relay — ideally **CDC tailing the outbox table's WAL**,
or a polling publisher — reads the outbox and publishes to the broker, marking rows
sent. This guarantees **at-least-once** delivery of an event for every committed
state change (and never an event for an aborted one). Consumers must be
**idempotent** (dedupe by event id) because the relay can publish a row twice if it
crashes between publish and mark-sent.

**Trade-offs / failure modes.** CDC couples consumers to the source schema (schema
evolution discipline matters — see registry). Log-based CDC needs the DB to retain
logs (Postgres replication slots that fall behind can **pin WAL and fill the disk** —
a real outage mode, and they also hold back vacuum). The outbox adds write
amplification and a relay component, and delivers *at-least-once*, not exactly-once —
idempotency is mandatory downstream.

---

## Columnar versus row storage

**Row storage (row-major).** A row's columns are stored contiguously. Reading or
writing a whole record touches one place — ideal for **OLTP**: point reads/writes,
"fetch this order and all its fields," high-selectivity single-row operations.

**Columnar storage (column-major).** Each column's values are stored contiguously
across all rows. Ideal for **OLAP**: scan two columns out of two hundred and
aggregate over billions of rows.

**Why columnar wins for analytics:**
- **I/O reduction:** an aggregation reads only the columns it needs, not whole rows.
  A query touching 3 of 100 columns reads ~3% of the data.
- **Compression:** a column holds values of one type with low cardinality/high
  locality → run-length encoding, dictionary encoding, bit-packing, delta encoding
  compress far better than mixed-type rows (often 10× better). Better compression =
  less I/O = faster scans.
- **Vectorized / SIMD execution:** process a column in tight batches (e.g. 1024
  values) through CPU vector instructions, minimizing per-row interpreter overhead
  and cache misses. Combined with late materialization, this is why column stores are
  orders of magnitude faster on scans.

**Trade-offs.** Columnar is **poor for OLTP writes**: inserting one row means writing
to many separate column files, and single-row point lookups reassemble a row from
scattered columns. So column stores favor **bulk/append loads** and are frequently
**append-mostly** with background merges (Vertica's WOS/ROS, sorted projections).
Updates are expensive; many column stores don't do in-place updates at all.

**Systems / formats.** Row: Postgres/MySQL/InnoDB (OLTP). Columnar: Redshift, Vertica,
ClickHouse, BigQuery, Snowflake; file formats **Parquet** and **ORC**; Apache Arrow
(in-memory columnar). Hybrid **HTAP** engines (SingleStore, TiDB with TiFlash) keep
both a row store and a column-store replica. **Interview line:** "Row for OLTP
(whole-record, point ops), columnar for OLAP (few-column scans over many rows);
don't run analytics on your OLTP row store — replicate to a column store."

---

## Time-series and append-only stores

**Workload shape.** Time-series data is **append-heavy, immutable-once-written,
time-ordered, and queried by time range** (plus tags/dimensions), with data losing
value as it ages (recent = hot, old = cold/aggregated). This shape maps almost
perfectly onto LSM / append-only designs.

**Why LSM fits.** Writes are appends (sequential) → LSM's strength. TTL/retention is
natural: **FIFO/TTL compaction** or time-partitioned segments can drop whole old
files cheaply instead of deleting rows. Data compresses extremely well: timestamps
via **delta-of-delta** encoding, values via **XOR/Gorilla** compression (Facebook's
Gorilla paper: ~1.37 bytes/point average, ~12× reduction) — because consecutive
samples are similar. Recent data stays in memtable/hot SSTables; queries are
range scans over time.

**Design techniques.**
- **Time-partitioning / chunking:** partition by time window (TimescaleDB "hypertable"
  chunks, InfluxDB shards). Old chunks are read-only → cheap to compress, downsample,
  or drop. Retention = drop a partition (a metadata op), not a delete storm.
- **Downsampling / rollups / continuous aggregates:** pre-aggregate old data to
  coarser resolution (1s → 1m → 1h) to bound storage and speed historical queries.
- **Append-only / immutability** simplifies concurrency (no in-place updates → little
  locking, MVCC trivial) and enables the columnar+compression tricks above.

**Systems.** InfluxDB, TimescaleDB (Postgres extension, hybrid row+columnar chunks),
Prometheus (local TSDB with WAL + head block + compacted blocks), Cassandra/Scylla for
wide time-series, Gorilla/Beringei, VictoriaMetrics, Amazon Timestream.

**Trade-offs / failure modes.** These stores are **poor for random updates and
point-in-time mutation** (that's not the workload). High-cardinality tag sets (the
"cardinality explosion" — e.g. putting a unique request id in a label) blow up index
memory and are the #1 operational failure in Prometheus/InfluxDB. Late-arriving data
that lands in an already-compacted/dropped partition is awkward. And a flood of
**tombstones** or out-of-order writes fights the append-only assumptions.

---

## Common interview follow-up questions

- "You have a write-heavy metrics ingest at 1M points/s with 30-day retention and
  range-scan reads. LSM or B-tree? Which compaction?" (LSM, time-partitioned +
  FIFO/TTL, size-tiered-ish for ingest; columnar+delta/XOR compression.)
- "Explain why Oracle/Postgres call a level SERIALIZABLE that isn't." (Oracle's is
  SI → allows write skew; Postgres RR = SI, Postgres SERIALIZABLE = true SSI.)
- "Give a concrete write-skew scenario and three ways to fix it under Postgres."
  (Doctors-on-call; SERIALIZABLE/SSI, `SELECT FOR UPDATE`, lock a summary row.)
- "Our Postgres table is 5× its data size and vacuum won't shrink it — why?"
  (Long-running/idle-in-transaction txn or stale replication slot pins the xmin
  horizon.)
- "During a rolling upgrade, which do you deploy first — producers or consumers?"
  (Depends on registry compat mode: BACKWARD → consumers first; FORWARD → producers
  first.)
- "Why does Avro have no field tags, and what does that force on your architecture?"
  (Bytes decoded by writer schema; schema must travel with data → schema registry.)
- "Explain read/write/space amplification and where leveled vs size-tiered land."
- "How does the outbox pattern give exactly-once? (It doesn't — at-least-once +
  idempotent consumers.)"
- "Why do B-trees do full-page writes, and what failure do they defend against?"
  (Torn pages on crash across the OS/disk atomic boundary.)
- "Local vs global secondary index — which for a high-write-rate table queried by a
  low-cardinality attribute?"
- "Derive the bits-per-key for a 1% bloom-filter FPR." (~9.6, i.e. ~10 bits/key.)
- "Why can't a bloom filter accelerate a range scan?"

## References

- Martin Kleppmann, *Designing Data-Intensive Applications* (2017) — Ch. 3 (storage
  engines, LSM vs B-tree, columnar), Ch. 4 (encoding & schema evolution: Avro,
  Protobuf, Thrift), Ch. 7 (transactions, isolation levels, SI, write skew, SSI),
  Ch. 11–12 (CDC, streams, derived data, outbox).
- Athanassoulis, Kester, Maas, et al., "Designing Access Methods: The RUM Conjecture"
  (EDBT 2016).
- O'Neil, Cheng, Gawlick, O'Neil, "The Log-Structured Merge-Tree (LSM-Tree)" (1996).
- Cahill, Röhm, Fekete, "Serializable Isolation for Snapshot Databases" (SIGMOD
  2008) — the SSI algorithm behind Postgres SERIALIZABLE.
- Berenson, Bernstein, Gray, Melton, O'Neil, O'Neil, "A Critique of ANSI SQL
  Isolation Levels" (SIGMOD 1995) — snapshot isolation and anomaly definitions.
- Facebook, "Gorilla: A Fast, Scalable, In-Memory Time Series Database" (VLDB 2015).
- Bloom, "Space/Time Trade-offs in Hash Coding with Allowable Errors" (CACM 1970).
- RocksDB wiki — compaction (leveled, universal, FIFO), WAL, bloom filters, write
  stalls; PostgreSQL docs — MVCC, VACUUM, WAL, isolation, xid wraparound.
- Debezium documentation and Confluent Schema Registry docs (compatibility modes).
- Chris Richardson, microservices.io — Transactional Outbox and CDC patterns.
- Dean & Barroso, "The Tail at Scale" (CACM 2013) — scatter-gather tail-latency
  amplification (relevant to local secondary-index fan-out reads).
