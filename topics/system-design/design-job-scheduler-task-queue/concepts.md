# Design a Distributed Job Scheduler, Task Queue and Cron

A "job scheduler / task queue / cron" is really three overlapping systems that
interviewers blur together, and the first points you score come from *separating*
them:

- **Task queue** — "run this unit of work *soon*, somewhere, at least once."
  (Sidekiq, Celery, SQS + workers, Resque.) Latency budget: milliseconds to
  seconds. The hard problems are delivery semantics, retries, and back-pressure.
- **Delayed jobs** — "run this *at* time T" (a single future execution). Same
  machinery as a task queue plus a *timer* / time-indexed store.
- **Distributed cron / recurring schedules** — "run this *every* 5 minutes / at
  02:00 UTC daily, exactly once per tick, across a fleet." The hard problems are
  leader election, dedup (fire-once per tick), and missed-run handling.

The interview is won not by naming Kafka or Temporal, but by articulating, for
every choice, **what you gain, what you give up, and when you'd pick the
alternative.** Exactly-once is (almost) a lie; idempotency is the real answer.
That thesis runs through this whole document, and every section ends in
trade-offs.

---

## Requirements, API and problem framing

**Intuition.** Before drawing boxes, pin down which of the three systems you are
building and the numbers. A scheduler for 100 nightly ETL jobs is a laptop-sized
problem; a task queue for 1M tasks/sec of ad-click processing is a
partitioned-datastore problem. Interviewers deliberately leave this vague to see
if you ask.

**Functional requirements to nail down**
- Submit a job (immediate, delayed until T, or recurring cron expression).
- Cancel / update / pause a job.
- Execute the job body on a worker fleet.
- Track status (pending → running → succeeded / failed / dead).
- Retries with backoff; dead-letter for poison jobs.
- Query job history / observability.

**Non-functional questions that change the design**
- **Scale:** jobs/sec submitted, concurrent running jobs, fan-out per tick.
- **Latency budget:** must a job start within 10 ms of its scheduled time, or is
  ±1 minute fine? Tight budgets kill polling designs.
- **Delivery semantics:** at-least-once (default, dominant) vs at-most-once vs
  "effectively once."
- **Durability:** can we lose an enqueued job on a crash? Almost never for
  payments; often OK for cache-warm jobs.
- **Time granularity:** second-level cron vs sub-second scheduling.
- **Multi-tenancy:** noisy-neighbor isolation, per-tenant quotas.

**A minimal API**
```
POST /jobs            {type, payload, run_at | cron, priority, idempotency_key,
                       max_retries, timeout}
DELETE /jobs/{id}
GET  /jobs/{id}       -> status, attempts, last_error, next_run_at
```

**Trade-offs.** Exposing a rich cron+dependency+DAG API up front (Airflow-style)
buys expressiveness but forces you into a heavy stateful scheduler; a thin
"enqueue a task" API (SQS-style) is trivially scalable but pushes orchestration
onto the client. Decide based on whether callers need *orchestration* (multi-step
workflows) or just *dispatch* (independent tasks). When unsure, start with the
thin API and layer a workflow engine on top only if DAGs appear.

---

## Core architecture and components

**Intuition.** Almost every design decomposes into the same five roles. Name them
explicitly; it signals seniority.

```
                 +-------------+
   clients  ---> |  API / Ingest| --- validate, assign id, idempotency ---.
                 +-------------+                                          |
                        |                                                 v
                        v                                        +-----------------+
                +---------------+   scheduled?   time-indexed --> |  Job Store (DB) |
                | Scheduler /   |--------------------------------> | jobs, state,    |
                | Timer Wheel   |   due jobs -> enqueue            | schedules       |
                +---------------+                                 +-----------------+
                        |                                                 ^
                        v                                                 |
                +---------------+    pull/push        +----------------+   |
                |  Queue /      | <-----------------> |  Worker Fleet  |---'  status/ack
                |  Broker(s)    |   visibility lease  |  (executors)   |
                +---------------+                     +----------------+
                        |                                     |
                        v                                     v
                     +-----+                            +-----------+
                     | DLQ |                            | Downstream|
                     +-----+                            | side-effect|
                                                        +-----------+
```

- **Ingest / API layer** — stateless, validates, assigns job id, applies
  idempotency key, persists to job store. Front it with a load balancer.
- **Job / schedule store** — durable source of truth for job definitions,
  state machine, and *when to run*. Choice of store (below) dominates the design.
- **Scheduler / timer** — decides which jobs are *due now* and moves them into the
  execution path. For cron this is where dedup + leader election live.
- **Queue / broker** — buffers due tasks, hands out leases to workers, enforces
  visibility timeout, feeds the DLQ.
- **Worker fleet** — pulls tasks, executes the job body, acks/nacks, reports
  status. Auto-scaled on queue depth.

**Two dominant topologies**
1. **DB-as-queue (pull):** workers `SELECT ... FOR UPDATE SKIP LOCKED` rows that
   are due. Simple, transactional, strong dedup. Scales to ~low thousands/sec.
2. **Broker-based (push/pull):** a dedicated queue (SQS/Kafka/RabbitMQ/Redis)
   separate from the durable store. Scales far higher, but you now reconcile two
   systems.

**Trade-offs.** Collapsing scheduler + queue + store into one DB is the fastest
path to correctness and the easiest to reason about (one transaction) — pick it
under ~5–10k jobs/sec. Splitting them lets each scale independently and hit high
QPS, at the cost of distributed-state reconciliation (a job can be "done" in the
store but redelivered by the broker). The senior move is to start unified and
split only the component that actually becomes the bottleneck.

---

## Task queue design, visibility timeout and acknowledgements

**Intuition.** A task queue must guarantee that if a worker takes a task and then
dies, someone else eventually runs it — *without* two workers running it at once
under normal operation. The mechanism is a **lease with a visibility timeout**.

**How it works (the lease loop).**
1. Worker calls `receive()`. The broker hands out the message and makes it
   *invisible* to others for a **visibility timeout** (SQS default 30 s, max
   12 h).
2. Worker processes, then calls `delete()`/`ack()` to remove it permanently.
3. If the worker crashes or is slow past the timeout, the message becomes visible
   again and is redelivered to another worker.
4. For long tasks the worker *heartbeats* — periodically extending the lease
   (`ChangeMessageVisibility`) so a healthy-but-slow worker isn't preempted.

This is the core of **at-least-once** delivery: work is never lost, but it *can*
run more than once (crash after side effect, before ack).

**Choosing the visibility timeout — the central tuning trade-off**
- **Too short:** a still-running task's lease expires, a second worker starts it →
  duplicate execution, wasted compute, and possibly double side effects.
- **Too long:** a genuinely crashed task sits invisible for the whole timeout
  before retry → high tail latency for that job and slow failure recovery.
- **Rule of thumb:** set it a bit above p99 processing time, and use heartbeats
  for tasks with high variance. SQS caps in-flight (~120k standard) — too-long
  timeouts + slow consumers can exhaust that and stall receives.

**Pull vs push delivery**

| Dimension | Pull (workers poll) | Push (broker delivers) |
|---|---|---|
| Back-pressure | Natural — worker pulls only when free | Needs flow control / concurrency limits |
| Latency | Adds poll interval (mitigate w/ long-poll) | Lower, event-driven |
| Fan-out | Simple | Broker manages subscriptions |
| Examples | SQS, Sidekiq/Redis BRPOP, Kafka | RabbitMQ push, webhooks, SNS |

**Trade-offs.** At-least-once + visibility timeout is the industry default because
losing work is usually worse than doing it twice — but it *mandates idempotent
consumers*. If you cannot make consumers idempotent and duplicates are
catastrophic, you need either a transactional outbox or FIFO/dedup features, both
of which cost throughput. Pull gives you free back-pressure and is the safe
default; push gives lower latency but you must add concurrency caps or you'll
overwhelm slow consumers.

---

## Delivery semantics and exactly-once challenges

**Intuition.** There are three delivery models, and only two are physically
achievable end-to-end:

- **At-most-once:** ack/remove *before* processing. Fast, no duplicates, but a
  crash loses the job. Acceptable for metrics/telemetry sampling, never for money.
- **At-least-once:** process, then ack. The default. No loss, possible
  duplicates. Requires idempotency.
- **Exactly-once *delivery*:** impossible across a network in the presence of
  crashes (the two-generals / FLP intuition). What systems actually offer is
  **exactly-once *processing/effects*** — dedup + idempotent side effects that
  make duplicates observationally harmless.

**Why "exactly once" keeps failing.** The unavoidable gap: a worker performs the
side effect (charge card), then crashes *before* the ack reaches the broker. The
broker cannot tell "done but ack lost" from "never done," so it must redeliver.
Any layer that promises exactly-once is really doing dedup on an idempotency key,
often within a bounded window.

**What real systems do**
- **Kafka exactly-once semantics (EOS):** idempotent producer (per-partition
  sequence numbers dedup retries) + transactions (atomic write across partitions
  + consumer-offset commit). Real, but only *within Kafka* — the moment you touch
  an external DB or API, you're back to needing idempotency.
- **SQS FIFO:** 5-minute dedup window on `MessageDeduplicationId`; ordered per
  message-group. Lower throughput than standard queues.
- **Temporal:** replays a durable event history so completed steps aren't
  re-executed; activities must still be idempotent for the crash-before-record
  window.

**Trade-offs.** Chasing true exactly-once is the classic junior trap. The senior
framing: "I'll use at-least-once delivery and make the *effect* exactly-once via
idempotency keys / dedup, because end-to-end exactly-once delivery is
unachievable and its approximations (FIFO, Kafka EOS) cost throughput and don't
extend to external side effects." Reserve FIFO/EOS for when *ordering* is also
required, not just dedup.

---

## Idempotency and deduplication

**Intuition.** Idempotency = running an operation N times has the same observable
effect as running it once. It's the real substitute for exactly-once and the most
important reliability primitive in this whole domain.

**How to make jobs idempotent**
- **Idempotency key:** client (or ingest) assigns a stable key per logical job.
  Before performing the side effect, the worker atomically checks/records the key
  (e.g., `INSERT ... ON CONFLICT DO NOTHING`, or a dedup table keyed by
  `idempotency_key`). Second delivery sees the key and short-circuits.
- **Natural idempotency:** design the operation to be a no-op on repeat — `SET
  balance = 100` (idempotent) vs `balance = balance + 10` (not). Upserts, PUTs,
  and conditional writes are your friends.
- **Dedup store:** Redis SET with TTL, or a DB unique constraint. TTL bounds
  memory but reopens a duplicate window after expiry — size it beyond max retry
  horizon.
- **Fencing tokens:** monotonic tokens so a resurrected zombie worker's late write
  is rejected (guards against a lease that expired while the worker was paused).

**The atomicity gap.** "Do the side effect AND record the key" must be atomic, or
you've just moved the race. Options: put both in one DB transaction (if the side
effect is in the same DB), or use a **transactional outbox** (write the effect +
an outbox row in one txn; a relay publishes the message — exactly-once *to the
DB*, at-least-once *to the broker*).

**Trade-offs.** Idempotency keys add a storage read/write on the hot path (latency
+ cost) and require a dedup store with its own scaling story, but they are the
only robust defense against at-least-once duplicates. Natural idempotency is
cheapest when achievable but constrains your data model. TTL-bounded dedup trades
memory for a small risk of late-duplicate reprocessing — acceptable if retries are
bounded, dangerous for jobs that can be redelivered days later.

---

## Retries, backoff and dead-letter queues

**Intuition.** Transient failures (a flaky downstream, a timeout) should be
retried; permanent failures (malformed payload, a bug) should not be retried
forever or they become a **poison message** that wedges a queue.

**Retry strategy**
- **Exponential backoff with jitter:** delay = base · 2^attempt, capped, plus
  random jitter. Backoff avoids hammering a struggling downstream; **jitter**
  avoids the thundering-herd where thousands of failed jobs retry in lockstep and
  re-DDoS the dependency.
- **Bounded attempts:** after `max_retries`, route to a **dead-letter queue
  (DLQ)** for human/automated inspection instead of infinite looping.
- **Retry budget / circuit breaker:** cap the *fraction* of traffic that is
  retries so a broad outage doesn't amplify load (retries can 2–3x load exactly
  when the system is already failing).

**Dead-letter queue.** A separate queue that captures messages exceeding the
retry limit (SQS: `maxReceiveCount` on a redrive policy). Enables: alerting,
offline debugging, and **redrive** (replay after a fix). Without a DLQ, poison
messages either loop forever (burning money) or get silently dropped (data loss).

**Where retries live — a subtle trade-off**
- **Broker-driven redelivery** (let visibility timeout expire): simple, but the
  *only* control is the timeout; hard to do per-attempt backoff.
- **App-driven re-enqueue with delay:** worker catches the error and re-enqueues
  with a computed delay → precise backoff, but you must not double-count and must
  handle the crash-before-reenqueue case (falls back to broker redelivery).

**Trade-offs.** Aggressive retries improve success rates for transient blips but
amplify load during real outages and can duplicate side effects — always pair with
idempotency and a retry budget. A DLQ adds operational surface (someone must watch
and redrive it) but is non-negotiable at scale; the alternative is silent loss or
infinite loops. Jitter costs nothing and should always be on.

---

## Priority, fairness and multi-tenancy

**Intuition.** Not all jobs are equal (a password-reset email beats a nightly
report), and one tenant must not starve others.

**Priority approaches**

| Approach | How | Trade-off |
|---|---|---|
| Multiple queues per priority | High/med/low queues; workers drain high first | Simple; risk of **starving** low-priority if high never drains |
| Weighted fair queuing | Workers pull from queues in weighted rotation | Bounds starvation; more complex scheduling |
| Priority column + sorted fetch | `ORDER BY priority, run_at` in DB queue | Easy in DB-as-queue; expensive index scans at scale |
| Deadline / EDF scheduling | Order by "must finish by" | Good for SLAs; needs deadline metadata |

**Multi-tenant fairness**
- **Per-tenant queues or shards** so a burst from tenant A doesn't block tenant B.
- **Token-bucket rate limits / quotas** per tenant to cap noisy neighbors.
- **Weighted round-robin** across tenant queues for fair dispatch.
- Uber/large systems use *task-queue partitioning* per tenant to isolate load.

**Trade-offs.** Strict priority queues are simple but starve low-priority work —
add aging (promote jobs as they wait) or weighted fair queuing if low-priority
jobs have any SLA. Per-tenant queues give strong isolation but explode the number
of queues to manage and can waste workers idling on empty queues; a shared queue
with fair scheduling is more efficient but risks head-of-line blocking. Choose
isolation when tenants have wildly different load profiles or contractual SLAs;
otherwise share and rate-limit.

---

## Delayed jobs and timers

**Intuition.** "Run at time T" needs a time-indexed structure so you can
efficiently find "everything due now" without scanning all jobs.

**Implementations**
- **Sorted store keyed by run_at:** Redis **sorted set** (score = run_at epoch);
  poll `ZRANGEBYSCORE -inf now`. Simple, fast, the classic Sidekiq/Bull approach.
- **DB with an index on `next_run_at`:** `SELECT ... WHERE next_run_at <= now()
  FOR UPDATE SKIP LOCKED`. Transactional and durable.
- **Hierarchical timing wheel:** O(1) insert/expire buckets by time granularity;
  used by Kafka (purgatory) and high-throughput timer systems. Efficient for
  millions of timers but bounded horizon per wheel level.
- **Delayed-delivery broker features:** SQS delay queues (max 15 min),
  message timers; beyond that you need your own store.

**Polling cadence trade-off.** A scheduler polls "what's due?" every P seconds.
Small P → tighter scheduling accuracy but more DB/Redis load; large P → cheaper but
jobs fire late by up to P. For sub-second accuracy, a timing wheel or a
next-wakeup timer (sleep until the earliest run_at) beats fixed polling.

**Trade-offs.** A Redis sorted set is the cheapest, lowest-latency delayed-job
store but is memory-bound and needs persistence/replication or you lose timers on
crash. A DB index is durable and transactional but caps throughput and adds
polling load. Timing wheels scale to millions of timers with O(1) ops but are more
code and have a bounded time horizon per level. Pick Redis for millions of
short-horizon delays where a rare loss is tolerable; pick the DB when durability
and transactional dedup dominate.

---

## Distributed cron and leader election

**Intuition.** Naive cron on N boxes fires each job N times. Distributed cron must
ensure **each schedule fires once per tick** across the fleet, and keeps firing
even if the box that "owns" cron dies.

**Approaches to fire-once-per-tick**

1. **Single leader (leader election).** One node is elected leader (via ZooKeeper,
   etcd, Consul, or a Redis/DB lease/lock) and is the *only* one that evaluates
   schedules and enqueues due jobs. Followers stand by. If the leader dies, a new
   one is elected (bounded by lease TTL). Simple correctness; the leader is a
   scaling ceiling and a failover gap.
2. **Partitioned/sharded schedulers.** Partition schedule ownership (by hash of
   schedule id) across nodes; each node is leader *for its shard*. Scales
   horizontally; needs a membership/rebalancing protocol (consistent hashing +
   coordination) and careful handoff to avoid double-fire during rebalance.
3. **DB row lock per tick.** Every node tries to `INSERT` a row keyed by
   `(schedule_id, scheduled_time)` (unique constraint) or grab a `FOR UPDATE`
   lock; exactly one wins and enqueues. No dedicated leader; the DB is the
   coordinator. Simple, but the DB becomes the coordination bottleneck.

**Leader-election mechanics.** A lease is a key with a TTL that the leader
renews (heartbeats). If it fails to renew (crash, GC pause, network partition),
the lease expires and another node acquires it. **Fencing tokens** prevent a
paused-then-resumed old leader from acting after a new one took over.

**Trade-offs.** Single-leader is the simplest correct design and fine for
thousands of schedules, but caps throughput and has a failover blind spot (jobs
during the election gap need catch-up). Partitioned schedulers scale but add a
coordination service (ZK/etcd) and a rebalancing hazard where a schedule can
briefly be owned by two nodes → double-fire (mitigate with the tick-dedup row
below). DB-lock-per-tick avoids a separate coordinator and gives exactly-once
ticks trivially, but concentrates load on the DB. Use single-leader by default;
shard only when a single node can't evaluate all schedules in time.

---

## Deduplicating a job so it runs once across nodes

**Intuition.** Even with leader election, races (rebalance, clock skew, retries)
can enqueue a tick twice. The robust guarantee comes from an idempotent *tick
identity*, not just from "only the leader enqueues."

**The canonical pattern.** Give each firing a deterministic id:
`execution_id = hash(schedule_id, scheduled_time_bucket)`. Insert it under a
**unique constraint** before enqueuing (or use it as the message dedup id). The
first writer wins; concurrent duplicates hit the constraint and abort. This turns
"fire once per tick" into a database uniqueness guarantee that is immune to how
many nodes tried.

```
scheduled_time bucketed to the tick (e.g., floor to the minute)
execution_id = sha1("job42" + "2026-07-16T02:00")
INSERT INTO executions(execution_id, ...) ON CONFLICT DO NOTHING;
-- rows affected == 1  => you own this tick, enqueue it
-- rows affected == 0  => someone already did, skip
```

**Why bucket the time?** Clock skew across nodes means "now" differs slightly; if
you keyed on raw timestamp you'd get near-duplicate keys. Bucketing to the tick
granularity (minute/second) makes all nodes agree on the same execution id.

**Trade-offs.** Tick-dedup via unique constraint is cheap and bulletproof against
double-fire regardless of leader-election bugs — the cost is a write to a
coordination store on every tick and reliance on its availability. It guarantees
*at-most-once enqueue per tick*, but the downstream execution is still
at-least-once (the enqueued task can be redelivered) — so job bodies still need
idempotency. This is a defense-in-depth layering: dedup the *tick*, idempotent the
*effect*.

---

## Missed-run handling and catch-up semantics

**Intuition.** If the scheduler is down at 02:00, what happens to the 02:00 run?
Fire it late? Skip it? Fire all missed runs? This is a *policy* decision the
interviewer wants you to surface, not a bug.

**Policies (steal Quartz/Kubernetes terminology)**
- **Fire immediately / catch up once (misfire = "fire now"):** run the missed job
  as soon as the scheduler recovers. Good for "must run daily" reports.
- **Skip / do nothing:** ignore missed runs; wait for the next scheduled tick.
  Good for "refresh cache every 5 min" where a stale skip is harmless and running
  10 backed-up copies is wasteful.
- **Backfill all missed:** enqueue every missed tick (K8s CronJob
  `startingDeadlineSeconds` + concurrency policy control this). Dangerous — a
  long outage can enqueue thousands of runs (a "thundering backfill").
- **Concurrency policy:** `Allow` / `Forbid` / `Replace` — whether a new run may
  overlap a still-running previous run.

**How you detect misfires.** Persist `next_run_at` per schedule; on recovery,
compare to now. A durable schedule store (not in-memory cron state) is what makes
recovery possible at all.

**Trade-offs.** "Fire immediately" preserves the guarantee that the job runs but
can cause a stampede after a long outage — cap catch-up (only the most recent
missed run) and bound concurrency. "Skip" is safe and cheap but silently drops
work, unacceptable for billing/settlement. "Backfill all" is correct for jobs that
must process each interval's data but needs a deadline window and concurrency
limits to avoid overload. State the policy per job type; there is no universal
right answer, and saying so scores points.

---

## Storage and datastore choices

**Intuition.** The store holds job definitions, the state machine, and the time
index. Its consistency and throughput properties bound the whole system.

**State machine (persist it):**
`PENDING -> SCHEDULED -> RUNNING -> {SUCCEEDED | FAILED -> (retry) | DEAD}`
with attempt count, lease owner/expiry, last error, next_run_at.

**Options**

| Store | Strengths | Weaknesses | Use when |
|---|---|---|---|
| Relational (Postgres/MySQL) | Transactions, `SKIP LOCKED`, unique-constraint dedup, strong consistency | Vertical scaling ceiling; polling load | <~10k jobs/sec, correctness-critical, dedup via constraints |
| Redis (sorted sets/streams) | Sub-ms latency, native delayed (ZSET), Streams w/ consumer groups | Memory-bound, durability requires care (AOF/replica) | High-throughput, short-horizon delays, tolerant of rare loss |
| Wide-column (Cassandra/DynamoDB) | Massive write scale, horizontal | Weaker transactions; dedup harder; hot partitions | Millions of jobs, time-bucketed partitions |
| Kafka (log) | Huge throughput, replay, ordered per partition | Not a random-access store; deletes/cancels awkward | Firehose of tasks, stream processing |
| Purpose-built (Temporal, Quartz store) | Durable execution / orchestration | Operational weight | Long-running stateful workflows |

**DB-as-queue detail.** `SELECT ... FOR UPDATE SKIP LOCKED LIMIT n` lets many
workers pull disjoint batches without blocking each other — the modern, correct
way to use a relational DB as a queue (Postgres, MySQL 8+). Avoids the old
"everyone locks the same hot rows" problem.

**Partitioning for scale.** Time-bucket the schedule (partition by
`floor(run_at / window)`) and/or hash-shard by job id. Beware **hot partitions**:
if everyone schedules jobs at `00:00`, that bucket melts — add a hash suffix /
jitter the scheduled time to spread load.

**Trade-offs.** A relational DB gives you transactional dedup and the simplest
correct queue via `SKIP LOCKED`, but tops out in the thousands/sec and the polling
load is real. Redis is blazing fast and has native delayed-job structures but
trades durability for speed. Wide-column stores scale writes almost limitlessly
but make dedup and cancellation painful and expose you to hot partitions. Match
the store to your dominant axis: correctness → RDBMS; latency → Redis; write
volume → Cassandra/Dynamo; orchestration → Temporal.

---

## Back-pressure and flow control

**Intuition.** Producers can always out-run consumers. Without back-pressure the
queue grows unbounded → memory blows up, latency explodes, and eventually the
whole system topples. Back-pressure is the feedback that slows producers or sheds
load *before* collapse.

**Mechanisms**
- **Bounded queues:** cap depth; on full, block the producer, reject (429), or
  spill to disk. A bounded queue *is* back-pressure.
- **Pull-based consumption:** workers fetch only when they have capacity — the
  consumer's rate naturally throttles the pipeline (Kafka/SQS long-poll).
- **Concurrency limits / worker pools:** cap in-flight tasks per worker so a slow
  downstream doesn't cause unbounded parallelism.
- **Rate limiting / admission control at ingest:** token bucket at the API to cap
  submission rate.
- **Autoscaling on queue depth / age-of-oldest-message:** scale workers up when
  backlog grows; the honest signal is *oldest message age*, not just depth.
- **Load shedding:** drop or defer low-priority work when overloaded.

**Signals to watch.** Queue depth, oldest-message age (best SLA signal), consumer
lag (Kafka), in-flight count, and processing-time p99.

**Trade-offs.** Blocking producers preserves all work but propagates slowness
upstream (can stall user requests) — good for internal pipelines, bad on a
user-facing hot path where you'd rather reject fast (429) and let the client
retry. Unbounded queues *feel* resilient but merely defer collapse and destroy
latency; always bound. Autoscaling workers absorbs bursts but has a spin-up lag
and a cost ceiling, and can't fix a downstream bottleneck (you'll just pile up
against the DB). Choose reject-fast for interactive paths, buffer+autoscale for
batch/async.

---

## Scaling, partitioning and sharding

**Intuition.** Every component must scale independently. The usual bottlenecks, in
order: the coordination/leader node, the datastore, then the workers.

**Back-of-envelope (worked example).**
- Target: **1,000,000 jobs/day** enqueued, avg **500 ms** processing, peak = 5×
  average.
- Average rate = 1e6 / 86,400 ≈ **~12 jobs/sec**; peak ≈ **~60 jobs/sec**.
- Concurrency (Little's Law): L = λ · W = 60/s · 0.5 s = **30 concurrent jobs** at
  peak → ~30 worker slots + headroom.
- Storage: 1M jobs/day × ~1 KB/job × 30-day retention ≈ **~30 GB** (fits one DB;
  no sharding needed — proves you shouldn't over-engineer).
- Contrast: **1,000,000 jobs/sec** (ad-click firehose) → Little's Law gives
  500k concurrent → thousands of workers, partitioned Kafka/Cassandra, no single
  leader. The numbers *decide* the architecture.

**Scaling levers**
- **Stateless ingest & workers:** scale horizontally behind a LB / by queue depth.
- **Shard the store:** hash by job id or time-bucket; consistent hashing for
  worker→partition assignment.
- **Shard the scheduler:** partition schedule ownership; each shard has its own
  leader (see distributed cron).
- **Regional / cell-based:** isolate blast radius — independent cells (queue +
  scheduler + workers + store) per region/tenant-group so one cell's failure or
  poison-load can't take down others. Modern AWS/large-scale pattern.

**Trade-offs.** A single leader/coordinator is simplest and correct but is the
first thing to blow up past ~10k schedules — shard it, accepting rebalancing
complexity. Sharding the store multiplies capacity but complicates cross-shard
queries (global "list all failed jobs") and dedup. Cell-based architecture caps
blast radius and enables independent scaling/deploys but multiplies operational
overhead and cross-cell coordination. Add each layer of partitioning only when a
capacity number forces it — the estimation above is how you justify *not*
sharding.

---

## Failure modes and how the design degrades

**Intuition.** Interviewers probe "what breaks and how gracefully." Enumerate
failures and the design's response.

| Failure | Effect | Mitigation / degraded mode |
|---|---|---|
| Worker crashes mid-task | Lease expires | Visibility timeout redelivers → runs again (idempotency saves you) |
| Worker slow (GC pause, zombie) | Lease may expire while alive | Heartbeat to extend lease; fencing token rejects zombie writes |
| Scheduler/leader dies | No new jobs enqueued during gap | Fast re-election (lease TTL); missed-run catch-up on recovery |
| Datastore down | Can't enqueue/ack | Buffer at ingest / reject; degrade to read-only; replicas for HA |
| Broker partition (split-brain) | Duplicate or lost delivery | Idempotency + tick dedup; quorum broker config |
| Poison message | Repeated failures | Bounded retries → DLQ |
| Clock skew across nodes | Double-fire / wrong tick id | NTP; bucket time for execution id; leases not wall-clock ordering |
| Thundering herd on retry | Amplified load during outage | Backoff + jitter + retry budget |
| Backfill stampede after outage | Thousands of catch-up runs | Bounded catch-up, concurrency policy, deadline window |
| Hot partition (all jobs at 00:00) | One shard melts | Jitter scheduled times, hash-suffix keys |

**Graceful degradation ladder.** Under overload: (1) autoscale workers → (2)
shed/defer low-priority jobs → (3) rate-limit / 429 new submissions → (4) keep
durable store writes so nothing is lost even if execution lags.

**Trade-offs.** Every mitigation costs something: heartbeats add broker traffic;
fencing tokens add a monotonic counter dependency; fast re-election needs short
lease TTLs which increase false failovers under load. The art is matching
mitigation strength to how catastrophic each failure is for *your* jobs (double
charge vs double cache-warm).

---

## Comparisons of Celery, Sidekiq, Quartz, Temporal and cloud queues

**Intuition.** Naming the right tool *and its trade-off* is a fast credibility
signal. These fall into three families: **task queues**, **schedulers**, and
**workflow/durable-execution engines**.

| System | Family | Backing store | Semantics | Sweet spot | Main trade-off |
|---|---|---|---|---|---|
| **Celery** (Python) | Task queue | Redis/RabbitMQ broker | At-least-once, optional acks-late | Python async tasks, periodic (beat) | Beat scheduler is single-node (SPOF for cron); duplicate handling on you |
| **Sidekiq** (Ruby) | Task queue | Redis | At-least-once | Rails background jobs, high throughput | Redis-bound durability; needs idempotent jobs |
| **BullMQ / Resque** | Task queue | Redis | At-least-once | Node/Ruby jobs, delayed via ZSET | Same Redis durability caveats |
| **Quartz** (Java) | Scheduler | JDBC store (clustered) | Fire-once via DB row lock | JVM cron/scheduled jobs, misfire policies | DB-centric; scaling ceiling; heavier |
| **Kubernetes CronJob** | Scheduler | etcd | Concurrency + starting-deadline policies | Containerized periodic jobs | Coarse (minute) granularity; backfill hazards |
| **SQS + workers** | Managed queue | AWS-managed | At-least-once (FIFO: dedup+order) | Serverless task queues, huge scale | Delay max 15 min; visibility-timeout tuning; FIFO lower TPS |
| **Kafka** | Log | Distributed log | At-least-once, EOS within Kafka | Firehose, streaming, replay | Not random-access; cancel/priority awkward |
| **Temporal / Cadence** | Durable execution | Cassandra/SQL + history | Effectively-once via replay | Long-running, multi-step, stateful workflows | Determinism constraints; operational weight |
| **Airflow / Dagster** | Workflow scheduler | Metadata DB | DAG-oriented, at-least-once tasks | Data-pipeline DAGs, backfills | Not low-latency; scheduler-centric |

**When to reach for a workflow engine (Temporal).** When the job is really a
*multi-step, long-lived process* with retries, human approval waits, and
compensations (sagas) — the durable event history and built-in orchestration save
you from hand-rolling state machines. **Don't** use it for simple fire-and-forget
tasks — the operational weight and determinism rules aren't worth it; a task queue
is lighter.

**Trade-offs.** Task queues (Celery/Sidekiq/SQS) are lightweight and high-
throughput but leave orchestration, dedup, and cron reliability to you (Celery
beat is a notorious cron SPOF). Schedulers (Quartz/Quartz-cluster, K8s CronJob)
give you cron semantics and misfire policies but are DB/etcd-bound and coarser.
Workflow engines (Temporal) give durable, exactly-once-effect orchestration at the
cost of operational complexity and code constraints. The senior answer picks per
requirement: dispatch → queue; recurring → scheduler; stateful multi-step →
workflow engine — and often composes them.

---

## Trade-offs and when to use what

A consolidated cheat-sheet of the judgment calls interviewers hammer:

- **Delivery:** default **at-least-once + idempotent consumers**. Use at-most-once
  only for lossy telemetry; pursue "exactly-once" only as dedup-on-key, never as a
  delivery guarantee.
- **Exactly-once:** it's a lie at the delivery layer. Deliver at-least-once, dedup
  the effect. FIFO/Kafka-EOS only when you also need *ordering* and can pay the
  throughput cost.
- **Queue substrate:** **DB-as-queue (`SKIP LOCKED`)** under ~10k/sec for
  transactional dedup; **Redis** for low-latency/high-throughput with tolerable
  loss; **Kafka/Cassandra** for firehose scale; **managed SQS** to avoid ops.
- **Cron dedup:** **single leader** by default; **shard leaders** when one can't
  keep up; **always** back it with a **tick-dedup unique constraint** for
  defense-in-depth.
- **Visibility timeout:** ~p99 processing time; heartbeat for variable/long tasks.
- **Retries:** exponential backoff + jitter + bounded attempts + DLQ + retry
  budget. Never infinite, never lockstep.
- **Missed runs:** choose per job — fire-once-immediately (must-run), skip
  (idempotent refresh), or bounded backfill (per-interval data). Cap catch-up.
- **Priority/fairness:** priority queues + aging, or weighted fair queuing;
  per-tenant queues/quotas when load profiles diverge.
- **Back-pressure:** bounded queues + pull + autoscale on oldest-message-age;
  reject-fast on interactive paths, buffer on batch paths.
- **Scale:** do the Little's-Law math first; shard/cell only when a number forces
  it. Over-engineering an under-loaded scheduler is a common failure.
- **Tool:** queue (Celery/Sidekiq/SQS) for dispatch, scheduler (Quartz/K8s) for
  recurring, Temporal for stateful workflows.

---

## Common interview follow-up questions

- "You said at-least-once. A card gets charged twice on redelivery — walk me
  through preventing it." (idempotency key + atomic dedup + transactional outbox)
- "Your cron leader dies at 01:59:59 and the 02:00 daily job is critical. What
  happens?" (re-election gap + missed-run policy + tick dedup on recovery)
- "Two schedulers both think they're leader during a partition. Does the job fire
  twice?" (fencing tokens; tick-dedup unique constraint makes it at-most-once
  enqueue)
- "Every tenant schedules a job at midnight UTC. What breaks and how do you fix
  it?" (hot partition / thundering herd → jitter scheduled times, hash-suffix)
- "How do you set the visibility timeout for jobs whose runtime varies from 1 s to
  1 h?" (heartbeat/extend lease; don't set a blanket 1 h)
- "A downstream dependency is down for 2 hours. What does your retry system do to
  it and to your queue?" (backoff+jitter+retry budget; backlog grows; autoscale +
  DLQ; circuit breaker)
- "When would you reach for Temporal instead of SQS + a Lambda?" (multi-step,
  long-lived, stateful orchestration vs simple dispatch)
- "Estimate the workers and storage for 1M jobs/day at 500 ms each." (Little's
  Law → ~30 concurrent; ~30 GB/30 days)
- "How do you cancel a job that's already been picked up by a worker?"
  (cooperative cancellation flag + fencing; you can't preempt a running side
  effect safely)
- "Delayed job for 30 days out — where do you store it and why not Redis TTL?"
  (durable store; Redis memory + loss risk over long horizons)

---

## References

- Alex Xu, *System Design Interview Vol. 2* — "Distributed Message Queue" and
  ByteByteGo blog articles on job schedulers and delayed queues.
- Martin Kleppmann, *Designing Data-Intensive Applications* — Ch. 8/9 (delivery
  semantics, exactly-once, fencing tokens, leader election, consensus).
- AWS SQS Developer Guide — Visibility timeout, DLQ / redrive policy, FIFO
  dedup: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- Apache Kafka docs — Exactly-once semantics (idempotent producer + transactions),
  timing wheel / purgatory for delayed operations.
- Temporal documentation — Durable execution, workflows/activities, event-history
  replay: https://docs.temporal.io/temporal
- Quartz Scheduler docs — Clustering (JDBC job store), misfire instructions.
- Kubernetes docs — CronJob concurrencyPolicy, startingDeadlineSeconds.
- Uber Engineering — Cadence / task-queue and multi-tenant scheduling write-ups.
- LinkedIn Engineering — distributed scheduler design posts.
- GitHub: donnemartin/system-design-primer — task queue / async patterns.
- Postgres docs — `SELECT ... FOR UPDATE SKIP LOCKED` for DB-as-queue.
- YouTube: ByteByteGo "Design a distributed job scheduler"; Gaurav Sen and
  "Jordan has no life" system-design videos on task queues and cron; Hussein
  Nasser on queueing and back-pressure.
