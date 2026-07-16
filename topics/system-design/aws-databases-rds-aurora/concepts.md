# Relational Databases on AWS: RDS and Aurora

> In a system-design interview, "which database?" is rarely the hard part — the hard
> part is defending *which flavor and which mode*, and naming the exact trade-off you
> accept. On AWS the relational choice ladder is: **self-managed on EC2 → Amazon RDS
> (managed engine) → Amazon Aurora (AWS-reengineered storage) → Aurora Serverless v2 /
> Global Database** for elasticity and multi-Region. Each step up trades control and
> raw cost knobs for less operational burden and better availability/scale — but every
> step has a limit it hits first (single-writer write ceiling, connection limits,
> replica lag, storage cap, failover RTO). This file is organized so that every design
> choice states **what you gain, what you give up, and when to pick it vs the
> alternative.** Interviewers probe Multi-AZ-vs-read-replica confusion, the Aurora
> quorum story, RPO/RTO numbers, and connection exhaustion with Lambda — get those
> right.

---

## Managed relational databases and the RDS value proposition

**Intuition.** Amazon RDS runs the *same* open-source or commercial engines you already
know — PostgreSQL, MySQL, MariaDB, Oracle, SQL Server — but AWS operates the undifferentiated
heavy lifting: provisioning, OS and engine patching, backups, monitoring, failover
orchestration, and replica setup. You still get a normal SQL endpoint; you give up shell
access to the host and some superuser privileges.

**How it works.** You choose a DB *instance class* (compute + RAM, e.g. `db.r6g.2xlarge`),
a storage type (gp3 general-purpose SSD, io1/io2 provisioned IOPS, or magnetic), and an
engine. RDS attaches EBS volumes, installs the engine, and exposes a DNS endpoint. Config
is controlled through **parameter groups** (engine settings like `max_connections`,
`work_mem`) and **option groups** (engine add-on features like Oracle TDE, SQL Server
Audit). Storage can auto-scale up (never down) when it nears capacity.

**Real-world usage.** RDS is the default OLTP store for the vast majority of workloads:
orders, users, inventory, ledgers — anything needing joins, transactions, and referential
integrity where a single well-sized writer is enough. RDS for PostgreSQL/MySQL commonly
handles thousands to tens of thousands of TPS on a large instance.

**Trade-offs.**
- **RDS vs self-managed on EC2:** RDS removes ops toil (patching, backups, Multi-AZ
  failover, replica provisioning) but *takes away* OS/root access, blocks some extensions
  and engine versions, and adds a managed-service premium. Pick self-managed on EC2 only
  when you need a superuser-only extension, an unsupported engine/version, a specific
  filesystem tweak, or an OS-level agent RDS won't allow — and accept that you now own
  patching, HA, and backups.
- **RDS vs Aurora:** covered below; RDS gives you the literal community engine with
  broadest version/extension parity; Aurora gives you AWS's distributed storage with
  better availability and read scaling but is a *reimplementation* with some parity lag.
- **RDS vs DynamoDB:** relational (joins, ad-hoc queries, transactions across rows) vs a
  managed key-value/document store with predictable single-digit-ms latency at any scale.
  Choose RDS when access patterns are rich/unknown and data is relational; choose DynamoDB
  when access patterns are known, you need seamless horizontal scale, and you can model
  around partition keys.

---

## RDS instance classes, storage, and vertical scaling limits

**Intuition.** An RDS instance is a single machine: its write throughput is bounded by one
node's CPU, RAM, and EBS bandwidth. You scale it **vertically** (bigger class) until you
run out of instance sizes or budget — this is the fundamental ceiling of a single-writer
relational database.

**How it works.** Instance families: `t` (burstable, dev/test), `m` (general), `r`
(memory-optimized, the OLTP default), `x`/`z` (extra memory). Storage: **gp3** lets you
provision IOPS and throughput independently of size (baseline 3,000 IOPS / 125 MB/s);
**io2 Block Express** for the highest, most consistent IOPS. Changing instance class or
storage-type causes a brief failover (Multi-AZ) or downtime (Single-AZ).

**Back-of-envelope.** A `db.r6g.4xlarge` (16 vCPU, 128 GB) can serve on the order of tens
of thousands of simple point queries/sec if the working set fits in RAM; complex joins and
write-heavy workloads are far lower. Once you saturate the largest instance, your only
relational options are **read replicas** (offload reads), **caching** (ElastiCache),
**sharding at the app layer**, or moving to a horizontally-scalable store.

**Trade-offs.**
- **Vertical scaling** is simplest (no app changes) but has a hard ceiling and gets
  super-linearly expensive at the top; a failover/resize causes a short blip.
- **gp3 vs io2:** gp3 is cheaper and decouples IOPS from size — good default; io2 Block
  Express when you need >64k IOPS with tight latency SLOs and are willing to pay.
- **Provisioning for peak** wastes money on spiky workloads — that's the pitch for Aurora
  Serverless v2 (below).

---

## Multi-AZ deployments: synchronous standby for high availability

**Intuition.** Multi-AZ is about **availability and durability, not read scaling.** RDS
keeps a *hot standby* in a second Availability Zone that you cannot read from; on failure,
RDS flips the DNS endpoint to the standby automatically.

**How it works (Multi-AZ instance deployment).** The primary synchronously replicates every
write to a standby in another AZ (physical, block-level replication). Because it's
**synchronous**, a committed write is durable in two AZs before the client sees success —
**RPO is effectively zero** for AZ failure. On primary failure, health checks trigger an
automatic failover by updating the endpoint CNAME to point at the promoted standby;
**RTO is typically 60–120 seconds.** The standby is passive — it serves no reads and no
writes until promoted.

**Multi-AZ *cluster* deployment (newer).** A different topology: one writer + **two
readable standbys** across three AZs using semi-synchronous replication (commit
acknowledged when at least one standby has it). This gives faster failover (often under
35 seconds) *and* lets you read from the two standbys — but with the caveat that reads
there can be slightly stale.

**Trade-offs.**
- **Synchronous replication** buys near-zero RPO but adds cross-AZ write latency
  (typically 1–2 ms extra) and roughly doubles instance cost (you pay for the idle
  standby). Accept this for any production system where an AZ outage must not lose data.
- **Multi-AZ instance vs Multi-AZ cluster:** instance = simplest, standby not readable;
  cluster = readable standbys + faster failover but only some engines/versions and a
  different cost/consistency profile. If you need read scaling too, cluster mode or read
  replicas.
- **The classic interview trap:** Multi-AZ ≠ read scaling. A single Multi-AZ standby
  (instance mode) does **not** offload reads. If you need more read throughput, add read
  replicas.

---

## Read replicas: asynchronous replication for read scaling

**Intuition.** Read replicas exist to **scale reads** and (secondarily) to provide
lower-cost regional read locality — a different job from Multi-AZ. They are updated
**asynchronously**, so they can lag.

**How it works.** RDS creates a replica from a snapshot then streams changes via the
engine's native async replication (MySQL binlog / PostgreSQL streaming replication). Each
replica has its **own endpoint** — the application must be routed to read from replicas
explicitly. RDS for MySQL/PostgreSQL supports up to **15 read replicas** per source
(historically 5; raised). Replicas can be in the same AZ, another AZ, or **another Region**
(cross-Region read replicas for geo-local reads or DR seed). A read replica can be manually
promoted to a standalone writer (breaks replication).

**Trade-offs.**
- **Async replication** means **replica lag** — reads can be stale by milliseconds to
  seconds (or more under write bursts). This breaks **read-your-writes** consistency:
  never read a just-written row from a replica unless the app tolerates staleness. Route
  read-after-write to the primary, or use monotonic/session pinning.
- **Read replica vs Multi-AZ standby:** replica = readable, async, no automatic failover of
  the *primary's* role (except Aurora, which unifies these). Standby = not readable, sync,
  automatic failover. Many production designs use **both**: Multi-AZ for HA + read replicas
  for scale.
- **Cross-Region read replica vs Aurora Global Database:** RDS cross-Region replica uses
  engine-level async replication with higher, more variable lag and more replication load
  on the primary; Aurora Global Database replicates at the *storage* layer with typically
  sub-second lag and negligible primary overhead. Prefer Global Database for serious
  multi-Region on Aurora.
- **Failover promotion** of a replica is a manual DR lever with data-loss risk equal to the
  replication lag at the moment of failure (nonzero RPO).

---

## Aurora architecture: shared distributed storage and the log-is-the-database model

**Intuition.** Aurora keeps the MySQL/PostgreSQL query/compute layer but **replaces the
storage engine** with a purpose-built, distributed, multi-tenant, log-structured storage
service. The database instance no longer writes data pages to a local disk; it ships only
**redo log records** to a fleet of storage nodes that materialize pages. This is the origin
of the famous line: *"the log is the database."*

**How it works.**
- The **cluster volume** is spread across **6 copies of the data over 3 Availability Zones
  (2 copies per AZ).** Storage is sliced into **10 GB "protection groups"/segments**.
- Writes use a **quorum**: a write is durable when **4 of 6** copies acknowledge (write
  quorum), and reads require **3 of 6** (read quorum). 4/6 + 3/6 overlap guarantees
  consistency while tolerating failures. This lets Aurora survive **losing an entire AZ
  plus one additional copy (AZ+1) with no write loss**, and losing a whole AZ with no
  impact on read availability.
- The writer sends **only redo log records** over the network (not full 8/16 KB pages),
  dramatically cutting write amplification and network I/O vs traditional replication.
  Storage nodes apply the log to produce pages on demand and self-heal via peer gossip.
- Up to **15 Aurora Replicas** share the *same* storage volume as the writer — so replicas
  don't re-do writes; they just read from shared storage, keeping replica lag typically in
  the **~10–20 ms** range (single-digit to low tens of ms).
- **Endpoints:** the **cluster (writer) endpoint** always points at the current primary; the
  **reader endpoint** load-balances across available Aurora Replicas; you can also make
  **custom endpoints** for subsets of instances.

**Failover.** Because replicas already share storage, promoting one to writer is fast —
Aurora failover is typically **under 30 seconds** (often ~10–15 s), versus RDS Multi-AZ's
60–120 s, because there's no volume to reattach or crash-recover from scratch.

**Trade-offs.**
- **Aurora vs RDS (same engine):** Aurora gives 6-way/3-AZ durability, faster failover,
  faster replicas with lower lag, up to 15 readers on one volume, and storage that
  auto-grows to **128 TiB** — but it is an AWS reimplementation, so cutting-edge community
  versions/extensions may lag, and it costs more at low utilization. Pick RDS when you need
  exact community-engine parity or a specific extension Aurora lacks; pick Aurora when you
  want the availability/scale story and are on a supported version.
- **Quorum writes** add a little tail latency vs a single local disk write but buy AZ+1
  fault tolerance — a very good trade for production.
- **Shared storage** means adding a read replica is cheap and fast (no data copy) — a big
  operational win over RDS replicas that must be built from a snapshot.

---

## Aurora endpoints, replicas, and read scaling

**Intuition.** Aurora unifies HA and read scaling: the same set of Aurora Replicas that
scale reads *are* the failover targets. There is no separate passive standby to pay for.

**How it works.** Applications write to the **writer endpoint** and spread reads across the
**reader endpoint**. Aurora Replicas (up to 15) can live in different AZs; you assign
**failover priority tiers (tier 0–15)** to control which replica gets promoted first
(Aurora prefers the highest-priority = lowest-numbered tier, then the largest instance).
**Aurora Auto Scaling** can add/remove replicas based on CPU or connections.

**Trade-offs.**
- **Reader endpoint load balancing** is per-connection, not per-query — long-lived
  connection pools can end up unbalanced across replicas.
- **Reads from replicas** are eventually consistent (small lag). For strict read-your-writes,
  read from the writer or use the same instance for the write+read.
- **Replica as failover target** eliminates the "pay for an idle standby" waste of RDS
  Multi-AZ instance mode: every replica does useful read work *and* is a failover target.
  The trade: a failover briefly reduces your read fleet by one while it's promoted.

---

## Aurora Serverless v2: on-demand ACU autoscaling

**Intuition.** Instead of picking an instance class, you set a **capacity range in Aurora
Capacity Units (ACUs)** and Aurora scales compute/memory up and down in fine increments,
in-place, without dropping connections — matching spend to load.

**How it works.** **1 ACU ≈ 2 GiB of RAM** plus associated CPU and networking. You configure
a **min and max ACU**; v2 scales in steps as small as **0.5 ACU**, seamlessly, while queries
and transactions are running (no connection drops, unlike v1's abrupt pauses). Max is
**256 ACUs** (≈512 GiB). With **scale-to-zero** (automatic pause/resume), the min can go to
**0 ACU** so an idle cluster costs (near) nothing for compute; the first connection after
a pause incurs a resume latency (seconds). Billing is **per-second on ACU consumed.**

**Real-world usage.** Spiky/unpredictable workloads, dev/test, multi-tenant SaaS (one
cluster per tenant with a wide range), and secondary/read-scaling instances. You can mix
Serverless v2 and provisioned instances in the same cluster.

**Trade-offs.**
- **Serverless v2 vs provisioned:** serverless removes capacity planning and wins big on
  spiky/idle workloads, but at *steady high* utilization a provisioned reserved instance is
  cheaper per ACU-equivalent. Pick provisioned + Reserved Instances for predictable 24/7
  load; pick serverless for variable/bursty/dev workloads.
- **Scale-to-zero** saves money but adds cold-start (resume) latency — unacceptable for
  latency-critical always-on paths; fine for dev/test and intermittent apps.
- **v2 vs v1:** v2 scales in-place and granularly (no disruptive pause at the connection
  layer, no doubling); v1 is legacy. Always v2 for new designs.
- **Max 256 ACU** is the ceiling — very large steady workloads may still prefer the largest
  provisioned instance classes or Aurora + sharding.

---

## Aurora Global Database: cross-Region replication and disaster recovery

**Intuition.** For low-latency global reads and Region-failure survival, Aurora Global
Database replicates a cluster to other Regions at the **storage layer** with **typically
sub-second lag**, using dedicated replication infrastructure that barely touches the
primary's compute.

**How it works.** One **primary Region** (read/write) plus up to **5 secondary Regions**
(read-only) — the docs now cite **up to 10 secondaries** on current engine versions. A
secondary cluster can have **up to 16 read replicas** (vs 15 normally) and can use
Serverless v2 readers. Replication uses dedicated infra, so it adds little load on the
primary and achieves latency **typically under 1 second**.
- **RPO:** for a *managed planned* **switchover**, zero data loss. For an *unplanned*
  cross-Region **failover** after a Region outage, RPO is typically **≤ 1 second** (the
  replication lag). Aurora PostgreSQL offers a configurable RPO knob.
- **RTO:** promoting a secondary to primary during a Region outage is typically **~1 minute**
  to a few minutes — dramatically better than restoring from backup cross-Region.
- **Write forwarding:** secondary-Region app servers can issue writes that Aurora forwards
  to the primary (with configurable read consistency), simplifying global write topologies
  at the cost of cross-Region write latency.
- The **Global writer endpoint** always points to the current primary, even after
  switchover/failover.

**Trade-offs.**
- **Global Database vs RDS cross-Region read replica:** storage-level replication → far
  lower lag, near-zero primary overhead, and fast managed failover. Prefer it for serious
  multi-Region Aurora DR/read-locality. The cost: only Aurora, and you pay for cross-Region
  data transfer + secondary clusters.
- **Global Database vs active-active multi-region:** Global DB is **single-writer** (one
  primary Region). If you need multi-Region *writes*, you need write forwarding (still one
  writer) or a genuinely multi-master store (DynamoDB Global Tables) — trading relational
  semantics/consistency for multi-Region write availability.
- **RPO ≤ 1s is not zero** for unplanned failover — if you truly need zero cross-Region RPO,
  use planned switchover only, or accept the async reality.

---

## RDS Proxy: connection pooling and failover for serverless and spiky clients

**Intuition.** Relational engines cap concurrent connections (each connection costs memory);
Lambda and large fleets can open thousands of short-lived connections and **exhaust
`max_connections`**. RDS Proxy sits between clients and the DB as a **managed connection
pool and multiplexer.**

**How it works.** The proxy maintains a warm pool of DB connections and **multiplexes** many
client connections onto fewer backend connections (connection reuse / "pinning" avoided when
possible). It also **shortens failover** by holding client connections while it re-points to
the new writer, and integrates with Secrets Manager + IAM auth. Fully managed, scales
automatically, deployed in your VPC.

**Real-world usage.** The canonical fix for **Lambda + RDS/Aurora**: without a proxy, bursty
Lambda concurrency opens a connection per container and blows through connection limits;
with the proxy, thousands of Lambdas share a small backend pool. Also helps any spiky/
high-concurrency app and smooths failovers.

**Trade-offs.**
- **RDS Proxy vs direct connection:** the proxy adds a small latency hop (~single-digit ms)
  and hourly cost per vCPU of the DB, but prevents connection exhaustion and reduces
  failover-induced errors. Skip it for a small fixed fleet with a healthy connection pool;
  add it for Lambda or highly variable concurrency.
- **Pinning:** session-level state (temp tables, session variables, some prepared
  statements) forces the proxy to **pin** a client to a backend connection, reducing
  multiplexing benefit — design stateless SQL to maximize sharing.
- **Alternative:** a client-side pooler (PgBouncer/HikariCP) is cheaper and works for
  long-lived servers, but you operate it and it doesn't help ephemeral Lambda the same way.

---

## Parameter groups, option groups, and engine configuration

**Intuition.** You can't SSH into an RDS host, so all engine tuning happens through
**parameter groups** (engine config values) and **option groups** (optional engine
features). Aurora uses **DB cluster** parameter groups (cluster-wide) plus DB instance
parameter groups.

**How it works.** Parameters are **static** (require a reboot, e.g. `shared_buffers`-style)
or **dynamic** (apply live, e.g. `work_mem`). Option groups enable add-ons like Oracle TDE,
SQL Server Audit, or MySQL `MEMCACHED`. You attach groups to instances/clusters; a custom
group lets you deviate from AWS defaults.

**Trade-offs.**
- **Default vs custom parameter group:** defaults are safe but conservative; custom groups
  let you tune `max_connections`, memory, timeouts — at the risk of misconfiguration and a
  required reboot for static params.
- **Aurora cluster vs instance parameter groups:** cluster-level settings (e.g. binlog)
  apply to all instances; instance-level lets a replica differ — know which layer a
  parameter lives at.

---

## Backups, point-in-time recovery, and snapshots

**Intuition.** Two backup mechanisms: **automated backups** (continuous, enabling
point-in-time recovery) and **manual snapshots** (user-triggered, retained until deleted).

**How it works.**
- **Automated backups** capture a daily full plus continuous transaction logs, enabling
  **point-in-time recovery (PITR)** to any second within the retention window (**1–35 days**,
  default typically 7; 0 disables). Restoring **creates a new instance/cluster** — you can't
  restore in place.
- **Manual snapshots** are user-initiated, retained indefinitely, and can be **copied
  cross-Region** and **shared across accounts** — the basis for cross-Region DR and cloning.
- **Aurora** additionally offers **backtrack** (Aurora MySQL only) — rewind the cluster
  in-place to a prior second **without a restore**, useful for undoing a bad deploy; and
  storage-level continuous backup to S3 with no performance hit.
- Aurora backups are continuous/incremental to S3 and don't impact performance; RDS backups
  can cause a brief I/O pause on Single-AZ.

**Trade-offs.**
- **PITR vs snapshot:** PITR = fine-grained recovery within the retention window but bounded
  by it; snapshots = coarse points retained forever and portable across Regions/accounts.
  Use both: automated for operational recovery, periodic manual snapshots for long-term/DR.
- **Backtrack vs PITR restore (Aurora MySQL):** backtrack is faster (in-place, seconds/
  minutes, no new cluster) but only rewinds a limited window and only on Aurora MySQL; PITR
  restore is always available but spins up a new cluster (slower, endpoint change).
- **Longer retention** = more storage cost and safety; balance against RPO needs.

---

## Choosing the engine and data store: RDS vs Aurora vs DynamoDB vs self-managed

**Intuition.** The decision flows from **access patterns, scale, consistency, ops maturity,
and budget** — not from familiarity.

**Comparison.**

| Dimension | RDS (Postgres/MySQL) | Aurora | DynamoDB | Self-managed on EC2 |
|---|---|---|---|---|
| Data model | Relational, joins, tx | Relational, joins, tx | Key-value/document | Anything |
| Write scaling | Single writer, vertical | Single writer, vertical | Horizontal, automatic | Whatever you build |
| Read scaling | Up to 15 async replicas | Up to 15 low-lag replicas | Horizontal + DAX cache | DIY |
| Durability | Multi-AZ sync standby | 6 copies / 3 AZs quorum | 3-AZ replicated | DIY |
| Failover RTO | 60–120 s | <30 s (often ~15 s) | Transparent (no failover) | DIY |
| Multi-Region | Cross-Region async replica | Global DB, <1s lag | Global Tables (multi-master) | DIY |
| Latency | ms | ms | single-digit ms at any scale | depends |
| Ops burden | Low | Low | Lowest | Highest |
| Cost shape | Instance-hours | Higher, but scales; serverless option | Pay per RCU/WCU or on-demand | EC2 + your time |
| Version/ext parity | Full community engine | Slight lag / reimplementation | N/A | Full control |

**Decision heuristics.**
- **Rich/unknown query patterns, joins, transactions, moderate scale →** RDS or Aurora.
- **Need best HA, fast failover, low-lag reads, 128 TiB growth, multi-Region →** Aurora.
- **Need exact community engine, a specific extension, or an unsupported version →** RDS
  (or self-managed on EC2 if RDS still can't).
- **Known access patterns, unbounded horizontal scale, predictable single-digit-ms,
  multi-Region writes →** DynamoDB.
- **Spiky/idle or dev/test relational →** Aurora Serverless v2.
- **Superuser/OS control or exotic engine →** self-managed on EC2 (own the ops).

---

## Trade-offs and when to use what: failure modes, RPO, RTO

**Failure modes and how the design degrades.**
- **Single-AZ instance failure:** with **Multi-AZ**, automatic failover in 60–120 s (RDS)
  or <30 s (Aurora), RPO ≈ 0 (sync/quorum). Without Multi-AZ, you restore from backup (RTO
  minutes-to-hours, RPO = last backup + lag).
- **Full AZ outage:** Multi-AZ (both instance and cluster) and Aurora (6/3-AZ quorum)
  survive; Single-AZ does not. Aurora tolerates **AZ+1** copy loss with no write loss.
- **Region outage:** only **Aurora Global Database** (or cross-Region replica/snapshot copy)
  survives; promote a secondary Region — RTO ~1 min, RPO ≤ 1 s (unplanned) or 0 (planned
  switchover). A single-Region deployment is fully down.
- **Connection storm (Lambda burst):** without RDS Proxy you hit `max_connections` and new
  connections error out; the proxy multiplexes to prevent this.
- **Replica lag under write burst:** stale reads on replicas — route read-your-writes to
  the writer.
- **Hot single writer:** you saturate the largest instance/256 ACUs — mitigate with caching,
  read replicas (reads only), CQRS, or app-level sharding; writes fundamentally don't scale
  horizontally on a single relational writer.
- **Storage cap:** Aurora auto-grows to **128 TiB**; RDS gp3/io2 have their own max volume
  sizes — very large datasets may need partitioning/archival or a different store.

**RPO/RTO cheat sheet.**

| Configuration | RPO (data loss) | RTO (downtime) | Scope survived |
|---|---|---|---|
| Single-AZ RDS | last backup + lag | minutes–hours (restore) | instance crash only |
| Multi-AZ RDS (instance) | ~0 (sync) | 60–120 s | AZ failure |
| Multi-AZ cluster / Aurora | ~0 (quorum) | <35 s / <30 s | AZ failure (+1 copy for Aurora) |
| Aurora Global DB (planned switchover) | 0 | ~1 min | Region failure (planned) |
| Aurora Global DB (unplanned failover) | ≤ 1 s | ~1 min–few min | Region failure |

**Cost reasoning.** Multi-AZ roughly doubles compute cost (idle standby in instance mode);
each read replica adds a full instance's cost; Aurora bills compute (instance-hours or ACU-
seconds), storage per GB-month, and I/O (or a fixed I/O-Optimized rate for I/O-heavy
workloads); Global Database adds secondary clusters + cross-Region transfer. Reserved
Instances / Savings Plans cut steady-state compute cost; Serverless v2 wins on spiky/idle.

---

## Common interview follow-up questions

- "Multi-AZ vs read replica — which scales reads, which gives HA, and can one do both?"
  (Aurora unifies them; RDS Multi-AZ instance standby is *not* readable.)
- "Walk me through what happens on an Aurora failover and why it's faster than RDS."
  (Shared storage, no volume reattach/crash recovery, promote a replica in seconds.)
- "Explain Aurora's 6-copies/3-AZ quorum. What failures does it tolerate? Why 4/6 and 3/6?"
- "Your Lambda functions are throwing 'too many connections' — fix it." (RDS Proxy; explain
  multiplexing and pinning.)
- "You need <1s multi-Region DR for a relational workload. Design it and state RPO/RTO."
  (Aurora Global Database; ≤1s RPO unplanned, 0 planned, ~1 min RTO.)
- "When would you pick DynamoDB over Aurora, and what do you give up?" (Horizontal write
  scale + multi-master vs joins/ad-hoc queries/transactions.)
- "Steady 24/7 load vs spiky — Serverless v2 or provisioned + RI? Why?"
- "How do you get read-your-writes consistency when reading from replicas?"
- "PITR vs snapshot vs backtrack — when each?"
- "Your write throughput exceeds the largest instance. Now what?" (No horizontal write
  scaling on a single relational writer; cache, CQRS, shard, or re-platform.)

## References

- AWS Aurora User Guide — "Amazon Aurora DB clusters" (writer/reader, up to 15 replicas):
  https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.html
- AWS Aurora User Guide — "Overview of Amazon Aurora storage" (6 copies / 3 AZs, 10 GB
  segments, quorum, 128 TiB): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.StorageReliability.html
- AWS Aurora User Guide — "Using Aurora Serverless v2" (ACU = 2 GiB, 0.5-ACU steps, min 0 /
  max 256, scale-to-zero): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html
- AWS Aurora User Guide — "Using Amazon Aurora Global Database" (up to 10 secondary Regions,
  <1s lag, write forwarding, switchover vs failover): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html
- AWS RDS User Guide — "Multi-AZ deployments" (instance vs cluster, sync standby, failover):
  https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html
- AWS RDS User Guide — "Working with read replicas" (async, up to 15, cross-Region):
  https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html
- AWS RDS User Guide — "Using Amazon RDS Proxy" (connection pooling, pinning, failover):
  https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html
- AWS RDS User Guide — backups, PITR, snapshots, Aurora backtrack.
- Amazon Aurora SIGMOD 2017 paper — "Amazon Aurora: Design Considerations for High
  Throughput Cloud-Native Relational Databases" (the log-is-the-database quorum design).
- AWS Well-Architected Framework — Reliability & Performance Efficiency pillars.
- AWS re:Invent Aurora deep-dive sessions (300/400-level storage & Global Database talks).
