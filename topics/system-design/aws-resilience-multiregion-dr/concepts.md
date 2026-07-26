# Resilience and Disaster Recovery: Multi-AZ, Multi-Region and DR Strategies

Resilience is the ability of a workload to recover from infrastructure or service
disruptions, dynamically acquire computing resources to meet demand, and mitigate
failures. On AWS this is a **layered** problem: you use Multi-AZ deployments for
*high availability* (surviving a single data-center/AZ failure with near-zero human
intervention), and Multi-Region deployments for *disaster recovery* (surviving a
Region-wide event, meeting compliance, or serving global users at low latency). The
interview skill is not naming services — it is reasoning about **RTO/RPO targets vs
cost vs operational complexity**, and knowing which AWS primitive gives you which
guarantee, where it breaks, and what you give up.

---

## Availability building blocks: Regions, AZs, and Multi-AZ HA

An AWS **Region** is a physical geography (e.g. us-east-1) containing multiple
**Availability Zones** (AZs). An AZ is one or more discrete data centers with
redundant power, networking, and cooling, physically separated (typically many km
apart) but connected by low-latency (single-digit ms, usually <1–2 ms), high-bandwidth,
redundant private fiber. Regions are isolated from each other by design — this is the
fault-isolation boundary. There is no shared blast radius across Regions for the data
plane.

**Multi-AZ is the default HA pattern *within* a Region.** Because inter-AZ latency is
low, you can run **synchronous** replication across AZs without meaningfully hurting
write latency:

- **RDS/Aurora Multi-AZ**: RDS Multi-AZ keeps a synchronous standby in another AZ;
  failover is automatic (typically 60–120 s for classic Multi-AZ; the newer *Multi-AZ
  DB cluster* with two readable standbys can fail over in ~35 s). Aurora stores 6 copies
  of data across 3 AZs and can lose an entire AZ (2 copies) with no write availability
  loss and read availability preserved.
- **ELB + Auto Scaling across AZs**: spread instances/tasks across ≥2 (ideally 3) AZs;
  the load balancer routes only to healthy targets, ASG replaces failed instances.
- **S3, DynamoDB, SQS, Lambda** are regional services that are already multi-AZ
  internally — you get AZ resilience for free.

**Why 6 copies / 3 AZs survives an AZ loss — the quorum arithmetic.** Aurora stores
`N = 6` copies (2 per AZ across 3 AZs) and uses a **write quorum of 4/6** and a **read
quorum of 3/6**. Two rules make this work:

- **Writes survive a full AZ loss.** Lose an AZ → lose 2 copies → 4 remain, which exactly
  meets the 4/6 write quorum, so writes keep flowing with zero availability loss.
- **Reads survive AZ + 1.** Lose an AZ (2 copies) *and* one more copy → 3 remain, exactly
  the 3/6 read quorum, so reads still succeed.
- **Why 4 and 3 (not 3 and 3)?** `W + R = 4 + 3 = 7 > 6 = N`, so any read set of 3 always
  overlaps a write set of 4 by at least one copy — a read is guaranteed to see the latest
  acknowledged write. Bumping the write quorum to 4 is what buys "survive an AZ with writes
  still up."

```
        Region (us-east-1)
  +-----------------------------------+
  |  AZ-a        AZ-b        AZ-c      |
  |  [app]       [app]       [app]     |  <- ASG spreads instances
  |    \           |          /        |
  |          [   ALB   ]               |  <- routes to healthy AZs only
  |  [RDS pri]<=sync=>[RDS standby]    |  <- synchronous, auto-failover
  +-----------------------------------+
   Survives: full AZ loss. Does NOT survive: Region-wide event.
```

**Trade-off:** Multi-AZ gives you strong-consistency HA cheaply and automatically, but
protects only against AZ-scoped failures. It does **not** protect against a Region
impairment, a bad global config push, data corruption/deletion, or a service control-plane
event that spans AZs. For those you need Multi-Region and/or backups.

---

## Measuring resilience: RPO, RTO, and availability math

Two targets drive every DR decision:

- **RTO (Recovery Time Objective)** — max acceptable *downtime*: how long until the
  workload is serving again.
- **RPO (Recovery Point Objective)** — max acceptable *data loss* measured in time: how
  far back the last usable recovery point can be.

Both are business requirements, not technical ones — you design *down* to them, spending
the least money/complexity that meets them. Over-engineering DR (active-active when RTO
is 4 hours) wastes money; under-engineering fails the audit or the outage.

**Availability math**: availability compounds. Serial dependencies multiply
(0.99 × 0.99 = 0.9801). Redundant/parallel components combine as
`1 − (1−a)^n`. "Nines":

| Nines | Availability | Downtime/year |
|-------|--------------|---------------|
| 3     | 99.9%        | ~8.77 h       |
| 4     | 99.99%       | ~52.6 min     |
| 5     | 99.999%      | ~5.26 min     |

Adding a hard dependency on a lower-availability component (e.g. a control-plane API in
your failover path) *caps* your achievable availability at that component's number. This
is the core argument for **static stability** (below).

**Worked example — walk the numbers.** Take a request path `ALB → app → RDS`, each
component 99.9% (three nines):

- **Serial chain (no redundancy).** They multiply: `0.999 × 0.999 × 0.999 = 0.999³ =
  0.99700`. That is **99.70%**, i.e. `(1 − 0.99700) × 8760 h = 0.00300 × 8760 ≈ 26.3
  h/year` of downtime — *worse* than any single component, because a failure of any one
  takes the path down.
- **Put the app tier in parallel across 2 AZs.** Two 99.9% instances behind the ALB fail
  the tier only if *both* are down: `1 − (1 − 0.999)² = 1 − (0.001)² = 1 − 0.000001 =
  0.999999` → **99.9999% (six nines)** for that tier alone. The path becomes `0.999
  (ALB) × 0.999999 (app) × 0.999 (RDS) = 0.99800` → **99.80%**, ≈ `0.00200 × 8760 ≈ 17.5
  h/year`. Redundancy on one tier bought back ~9 h/yr; the remaining loss is now dominated
  by the still-serial ALB and RDS.
- **Now add a hard dependency on a control-plane API in the failover path.** Suppose
  reaching "recovered" requires a control-plane call that is itself 99.9%. It multiplies in:
  even a beautifully redundant path is dragged back to *at most* `… × 0.999`, so the whole
  thing is **capped at 99.9%** (≈ 8.8 h/year) no matter how many nines you built elsewhere.
  That is the concrete case for **static stability**: don't put a lower-availability
  control-plane call on the critical recovery path — it becomes the ceiling.

**Trade-off:** each extra nine costs disproportionately more (redundancy, testing,
multi-Region). Know the target before choosing a strategy.

---

## The four DR strategies

AWS defines four strategies on a spectrum of decreasing RTO/RPO and increasing cost/complexity:

```
 RTO/RPO   HIGH (hours/hours)                     LOW (~zero/seconds)
 cost/ops  LOW ------------------------------------------> HIGH
           |            |             |                 |
        Backup &     Pilot         Warm            Multi-site
         Restore     Light        Standby        Active/Active
        (redeploy)  (core on,    (scaled-down    (all Regions
                     scale up)    running app)    serve traffic)
```

| Strategy | RTO | RPO | What's running in DR Region | Relative cost |
|---|---|---|---|---|
| Backup & restore | Hours | Hours | Nothing (data backups only) | Lowest |
| Pilot light | 10s of min | Minutes | Data replicating + core infra off/minimal | Low |
| Warm standby | Minutes | Seconds | Full stack running, scaled down | Medium |
| Multi-site active/active | Near-zero (real-time) | Near-zero | Full production capacity, serving traffic | Highest |

The two left strategies are **active/passive**; multi-site is **active/active**
(hot standby is active/passive but with full capacity provisioned). Note: even
active/active cannot give RPO=0 against *data corruption/deletion*, because you must
restore from a point-in-time backup taken before the bad event — replication faithfully
copies the corruption to every Region.

**Trade-off summary:** you are buying down RTO/RPO with money and operational complexity.
Move right only as far as the business requirement demands.

---

## Backup and restore

**Idea:** periodically (or continuously) back up data; on disaster, redeploy
infrastructure (via IaC — CloudFormation/CDK) and restore data in the recovery Region.

- Services: EBS snapshots, RDS/Aurora snapshots, DynamoDB backup/PITR, EFS/FSx backups,
  Redshift snapshots, **AWS Backup** (central policy, cross-Region + cross-account copy).
- S3: use versioning + optionally CRR for durability of objects.
- Infra as code + golden AMIs are mandatory; without them, RTO balloons.

**RTO** = time to provision infra + restore data (often hours). **RPO** = backup interval
(hours, unless continuous/PITR).

**Trade-off / when to pick:** cheapest option; ideal when RTO/RPO are measured in hours,
for dev/test, or as the *always-required baseline* even alongside other strategies
(because backups are the only defense against data corruption/ransomware that replication
can't provide). Weakness: slow recovery, and restore is a **control-plane** operation, so
test it and pre-stage restores. Pick a richer strategy when downtime of hours is
unacceptable.

---

## Pilot light

**Idea:** keep data continuously replicated and the *core* infrastructure (databases,
maybe a minimal always-on tier) provisioned in the DR Region, but application/compute
servers are "switched off" (not deployed, or deployed at zero desired capacity). On
failover you "turn on" and scale up compute, then shift traffic.

- Data replication: Aurora Global Database, RDS cross-Region read replicas, DynamoDB
  global tables, S3 Replication, ElastiCache Global Datastore.
- **AWS Elastic Disaster Recovery (DRS)** implements a pilot-light model via continuous
  block-level replication into a low-cost staging area, then launches full instances on
  failover — great for lift-and-shift / on-prem / EC2-based (not RDS) workloads.

**RTO** = minutes to tens of minutes (must provision/scale compute). **RPO** = seconds to
minutes (continuous async replication).

**Trade-off / when to pick:** much lower RTO than backup&restore for modest extra cost
(you pay for replication + minimal always-on data tier, not idle compute). Pick when RTO
of ~10s of minutes is acceptable and you want to avoid the cost of a full standby fleet.
Weakness: failover depends on **control-plane** scaling operations (launching/scaling
compute), which are less reliable during a Regional event — this is the key risk vs warm
standby's already-running fleet.

---

## Warm standby

**Idea:** a **fully functional but scaled-down** copy of production always runs in the DR
Region. It can serve traffic immediately (at reduced capacity), so failover is just
scale-up + traffic shift.

- All pilot-light services plus **EC2 Auto Scaling / ECS / DynamoDB / Aurora replica
  scaling** to grow to full capacity.
- Can (and should) take continuous live/synthetic traffic to build confidence.

**RTO** = minutes (scale up + shift). **RPO** = seconds.

**Trade-off / when to pick:** the distinction from pilot light is subtle but important —
**pilot light cannot serve requests without first turning servers on; warm standby is
already serving (small).** Warm standby costs more (you run a real, if small, fleet 24/7)
but recovers faster and is continuously validated. Pick when RTO must be minutes and you
want lower failover risk than pilot light. If you're going to run a full-capacity fleet
anyway (**hot standby**), most teams make it active/active to actually use it.

**Worked example — trace the same Region-loss failover, second by second.** Primary Region
goes dark at **T+0**. Watch where the minutes actually go:

| Step | Pilot light | Warm standby |
|---|---|---|
| Detect + decide (health checks flip, alarm) | +30 s → `0:30` | +30 s → `0:30` |
| **Launch compute** (control-plane `RunInstances`, boot AMIs, register targets) | +8 min → `8:30` | *skipped* — fleet already running |
| Scale up to full capacity | *(part of launch)* | +2 min → `2:30` |
| Promote DB / already writable | +1 min → `9:30` | +1 min → `3:30` |
| DNS/traffic shift (60 s TTL) | +1 min → `~10:30` | +1 min → `~4:30` |
| **Total RTO** | **≈ 10 min** | **≈ 4 min** |

The whole gap is that one row: pilot light pays a ~8-minute **control-plane launch** step
(cold compute has to be created and booted from zero) that warm standby skips because its
scaled-down fleet is *already running and already in the load balancer*. Warm standby only
has to grow an existing fleet, not create one — and that launch step is also the *riskiest*
one during a real Regional event, because control-plane APIs are the first thing to degrade.

---

## Multi-site active-active and hot standby

**Idea:** run the workload simultaneously in ≥2 Regions, **all serving traffic**
(active/active). There is no "failover" per se — you shift traffic *away* from an impaired
Region. **Hot standby** is the active/passive cousin: full capacity provisioned in the DR
Region but it takes no user traffic until promoted.

- Traffic: Route 53 (latency/geoproximity/weighted) or Global Accelerator (anycast,
  traffic dials) distribute users across Regions.
- Data write patterns:
  - **Write global** — all writes to one Region; promote another on failure. Aurora
    Global Database fits (single writer, <1 s replication, promote a secondary in <1 min).
  - **Write local** — writes to the nearest Region. DynamoDB global tables fit
    (multi-active, last-writer-wins conflict resolution).
  - **Write partitioned** — route writes by partition key (e.g. user ID) to avoid
    conflicts; e.g. bidirectional S3 replication between two Regions.

**RTO/RPO** = near-zero for infra/Region events (with correct design). Data-corruption
recovery is still non-zero (needs backups).

**Trade-off / when to pick:** lowest RTO/RPO and gives you global low-latency reads/writes
as a bonus — but **highest cost and by far the highest complexity**: cross-Region data
consistency, conflict resolution, idempotency, split-brain avoidance, and testing a
"loss of a Region" scenario without failover semantics. Pick only when near-zero RTO/RPO
is a hard requirement or you already need global multi-Region serving. Otherwise warm
standby is cheaper and simpler.

---

## Choosing a DR strategy from RTO and RPO targets

Decision heuristic:

1. **What is the disaster scope?** Single AZ → Multi-AZ HA may be enough (no cross-Region
   DR needed). Region loss / regulatory → pick from the four strategies.
2. **RPO drives the replication choice.** RPO of hours → periodic backups. RPO of
   seconds → continuous async replication (global DB/tables/CRR). RPO ~0 for *infra*
   events → active/active. RPO ~0 including corruption is impossible via replication —
   need synchronous + immutable backups, and even then corruption is a logical event.
3. **RTO drives the compute posture.** RTO hours → backup&restore. RTO 10s of min →
   pilot light. RTO minutes → warm standby. RTO seconds/real-time → active-active/hot.
4. **Then minimize cost/ops** to just meet both. Layer backups underneath *every*
   strategy for corruption/ransomware protection.

**Common gotcha:** teams pick active-active for prestige when RTO is 4 h — burning money
and adding consistency bugs. Conversely, teams pick backup&restore for a system with a
5-minute RTO and fail the drill. Match the strategy to the *number*.

---

## Data replication: Aurora Global Database

Aurora Global Database spans one **primary** Region (writes) and up to **10 secondary**
read-only Regions. Replication is done at the **storage layer** (not the SQL/binlog
engine), using dedicated infrastructure, so it has minimal impact on the primary's
compute and achieves **typical replication latency under 1 second** cross-Region (intra-
Region <100 ms). Each secondary can add readers (up to 16, vs 15 for a standalone cluster).

- **Switchover** (planned, "managed planned failover"): relocate the primary to a
  secondary with **no data loss** (RPO 0) — for Region rotation/maintenance.
- **Unplanned failover** (Region outage): promote a secondary to primary. Managed
  unplanned failover typically completes in **~1 minute** (RTO), with a small RPO
  (usually ~1 s of unreplicated writes; you can monitor the RPO lag and enforce a target).
- **Write forwarding**: secondary clusters can forward writes to the primary, enabling a
  "write global, read local" pattern without app-side routing.

**Trade-off vs alternatives:** Aurora Global DB gives relational/ACID semantics with a
single authoritative writer (no conflict resolution needed) and fast promote — ideal for
*write-global* systems. But it is **single-writer**: cross-Region writes always pay the
round-trip (write forwarding or app routing), so it is not true multi-master. Compare
DynamoDB global tables (multi-active, write-local, but eventual + LWW). Use Aurora Global
DB when you need SQL/ACID + strong single-writer consistency and can tolerate ~1 s RPO on
unplanned failover; use DynamoDB global tables when you need local writes in every Region
and can accept eventual consistency + LWW.

---

## Data replication: DynamoDB global tables

Global tables are **multi-active, multi-Region** replicas of a DynamoDB table: every
replica Region accepts **both reads and writes** ("write local"). Replication is
**asynchronous**, typically propagating within about **1 second** (often sub-second) under
normal conditions. Conflicts between concurrent writes to different Regions are resolved
by **last-writer-wins (LWW)** using a reconciliation timestamp.

- No promotion/failover needed — every Region is already a writer. On Region loss, route
  clients elsewhere; writes continue.
- Requires the streams/replication machinery; new-version global tables replicate item
  changes via internal streams.
- **Reads within a Region** can be eventually or strongly consistent, but there is **no
  strongly consistent cross-Region read** — you can read stale data that hasn't replicated
  yet.

**Worked example — how LWW silently loses an update.** Account balance starts at **100**,
replicated to Region A and Region B. Two concurrent `+10` / `+5` operations land before
replication catches up:

- `t1`: Region A reads 100, writes **balance = 110** (its `+10`), timestamp `t1`.
- `t2 > t1`: Region B (still seeing the un-replicated 100) reads 100, writes **balance =
  105** (its `+5`), timestamp `t2`.
- Replication reconciles: LWW keeps the write with the **larger timestamp** → `t2` wins →
  **balance = 105**. A's `+10` is **silently discarded**. The correct answer (115) is
  reachable by *neither* Region.

That is why **counters/increments are unsafe** under LWW: read-modify-write races don't
merge, they overwrite. The fixes: **conditional writes** (`ConditionExpression` so B's
write fails if the value changed), **write-partition by account** (all writes for one
account routed to one Region so there's no concurrency), or a **single-writer ledger**
(Aurora) that serializes the two increments to 115.

**Trade-off:** unmatched for low-latency global writes and Region-loss resilience with
near-zero RTO, but you **give up cross-Region consistency** and must design for LWW
semantics (concurrent updates to the same item in two Regions → one silently wins;
counters/increments are unsafe). Use for user profiles, sessions, carts, gaming state —
data where per-item last-write-wins is acceptable. Avoid raw global tables for
strict-ordering/monetary ledgers where a lost update is unacceptable; use write-partitioned
routing, conditional writes, or a single-writer store instead.

---

## Data replication: S3 Cross-Region Replication

**S3 Replication** asynchronously copies objects to a destination bucket. **Cross-Region
Replication (CRR)** targets a bucket in another Region (SRR = same Region). Requirements:
**versioning enabled** on source and destination; a replication configuration/role.

- Replication is **async** and best-effort by default (minutes, occasionally longer).
- **S3 Replication Time Control (S3 RTC)** provides an SLA to replicate **99.99% of
  objects within 15 minutes**, backed by replication metrics/events — use it when you
  need a predictable replication RPO.
- Delete markers: by default a delete in the source is **not** replicated as a delete
  (adds delete marker only in source), which protects the DR copy from malicious/accidental
  deletes; delete-marker replication is opt-in.
- Bidirectional replication (both directions) supports active/active *write-partitioned*
  patterns; enable replica modification sync for metadata/ACL/tag/lock changes.
- S3 itself provides **strong read-after-write consistency** for new PUTs and overwrite
  PUTs/DELETEs *within a Region* (since Dec 2020) — but CRR is still eventually consistent
  across Regions.

**Trade-off:** CRR is cheap, durable, and simple for object DR, but async → non-zero RPO
(bounded by RTC if enabled, at extra cost). It doesn't give you compute failover — it's a
data primitive you compose with Route 53/CloudFront origin failover. For same-Region
low-RTO copies use SRR; for cross-Region DR use CRR (+RTC if RPO matters).

---

## Replication consistency and conflict trade-offs

Cross-Region replication is fundamentally **asynchronous** (physics: speed of light ⇒ tens
of ms one-way between distant Regions; synchronous cross-Region writes would cripple write
latency). Consequences you must reason about:

- **Non-zero RPO on failover**: any writes not yet replicated when the primary dies are
  lost (Aurora ~1 s; DynamoDB ~1 s; S3 minutes/RTC 15 min).
- **Write conflicts** in multi-active designs: DynamoDB uses LWW (silent loss of the
  "losing" concurrent write). Aurora sidesteps this by having a single writer.
- **Split-brain**: if you allow writes in two Regions during a partition without a
  conflict strategy, you diverge. Mitigations: single-writer (Aurora), write-partitioning
  by key, or CRDT/LWW acceptance.
- **Read-your-writes** across Regions is not guaranteed — pin a user's session to one
  Region, or read from the writer Region for critical reads.

| Store | Write model | Cross-Region consistency | Conflict handling | Typical RPO |
|---|---|---|---|---|
| Aurora Global DB | Single writer (write global) | Async to secondaries | N/A (one writer) | ~1 s |
| DynamoDB global tables | Multi-active (write local) | Eventual | Last-writer-wins | ~1 s |
| S3 CRR | Per-bucket async | Eventual (RTC ≤15 min SLA) | Version/overwrite | minutes |
| ElastiCache Global Datastore | Single primary writer | Async | N/A | seconds |

**Interview line:** "Cross-Region is always eventually consistent; I choose single-writer
(Aurora) when I need correctness, and multi-active (DynamoDB global tables, LWW) when I
need local-write latency and can tolerate lost concurrent updates."

---

## Route 53 failover and health checks

Route 53 is a **global, highly available DNS** service used to steer traffic across
Regions/endpoints. Relevant routing policies:

- **Failover** (active/passive): a primary and secondary record; Route 53 serves the
  primary while healthy, else the secondary.
- **Latency-based / geoproximity / geolocation**: send users to the best/closest Region
  (active/active).
- **Weighted**: split traffic by percentage (canary, gradual failover) — but changing
  weights is a **control-plane** operation.
- **Multivalue answer**: return multiple healthy IPs.

**Health checks** monitor endpoint health (HTTP/HTTPS/TCP), can be tied to CloudWatch
alarms, and can be *calculated* (parent/child). DNS failover is a **data-plane** operation
and thus highly reliable. Caveat: **DNS TTL caching** and client/resolver non-compliance
mean DNS-based failover is not instantaneous — clients may keep hitting the old endpoint
until TTL expires (set low TTLs, e.g. 60 s, on failover records; accept some tail).

**Concrete tail.** With a 60 s TTL, a well-behaved resolver that cached the record 40 s ago
keeps sending clients to the *dead* endpoint for up to another ~20 s after the health check
flips. But the tail is worse than one TTL in practice: resolvers that ignore low TTLs (some
ISP/corporate caches pin to minutes), plus **long-lived TCP connections** that never re-
resolve until they drop, mean a residual fraction of traffic keeps hitting the failed Region
for **minutes**. **Global Accelerator** sidesteps this: clients connect to fixed **anycast
IPs**, and the flip happens *at the AWS edge* on the next packet — there is no client-side
DNS cache in the path to wait out, so failover is near-immediate.

**Trade-off vs Global Accelerator:** Route 53 is DNS (subject to TTL/caching) but supports
rich policies (latency/geo). **Global Accelerator** uses **anycast static IPs** on the AWS
edge/backbone, so client failover is near-immediate (no DNS cache issue) and latency is
lower, but it offers fewer routing policies and costs more. Use Route 53 for flexible geo/
latency routing; use Global Accelerator when you need fast IP-level failover and backbone
performance, or fixed IPs (e.g. for allowlisting). CloudFront origin failover fails over
per-request at the edge for cached content.

---

## Application Recovery Controller and routing controls

**Amazon Application Recovery Controller (ARC)** (formerly Route 53 ARC) addresses two
hard problems in multi-Region failover:

- **Readiness checks**: continuously audit that your recovery Region is actually *ready*
  (capacity, quotas, config parity, replication lag) so you don't fail over into a Region
  that can't take the load.
- **Routing controls**: highly available **on/off switches** for traffic, implemented as
  Route 53 health checks you fully control. Crucially, they are backed by a **cluster of
  five regional data-plane endpoints across five Regions** — you can flip a switch even if
  one (or more) Regions is impaired, because you don't depend on a single Region's control
  plane. **Safety rules** prevent dangerous states (e.g. turning both Regions off, or on
  simultaneously when that's invalid).

**Trade-off / why it matters:** naive failover often depends on control-plane APIs
(scaling, DNS record edits, config changes) that are exactly what's degraded during a big
event. ARC gives you a **data-plane, statically stable** failover switch. Cost/complexity:
ARC clusters carry a nontrivial hourly cost and setup effort — justified for
mission-critical workloads with tight RTO, overkill for low-tier services where a manual
Route 53 change is fine.

---

## Static stability and avoiding control-plane dependency

**Control plane** = APIs that *create/modify* resources (RunInstances, scaling, creating
records, provisioning). **Data plane** = the part that *serves* existing resources
(routing requests to running instances, reading an S3 object, DNS query resolution).
Data planes are engineered for much higher availability than control planes and degrade
independently.

**Static stability** = the system keeps working during a failure **without needing to make
any control-plane changes**. Examples:

- Pre-provision the failover fleet at full size (hot standby) rather than relying on Auto
  Scaling (control plane) to grow it during the event.
- Multi-AZ that keeps spare capacity in each AZ so losing one AZ needs no new launches
  (the classic "don't depend on `RunInstances` during an AZ event").
- Use **data-plane** failover switches (ARC routing controls, Route 53 health checks)
  rather than editing config/records at failover time.

**Trade-off:** static stability costs money — you pay for idle/spare capacity that only
earns its keep during a failure — but it removes the fragile dependency on control-plane
availability precisely when it's least reliable. This is the fundamental
**cost vs reliability** trade-off. For the most critical tiers, pay for static stability;
for others, accept a control-plane dependency and a higher RTO.

---

## Cell-based architecture and blast radius reduction

A **cell** is a complete, independent instance of the workload (its own compute + data +
dependencies) serving a *partition* of customers/traffic. Requests are mapped to cells by
a thin, highly-available **cell router** (partition by tenant/user/shard key). Cells share
nothing at the data plane.

```
            [ thin cell router ]        <- simple, highly available, few deps
           /        |         \
       [Cell A]  [Cell B]   [Cell C]    <- each a full stack, independent
        users     users      users
        0-33%     34-66%     67-100%
```

**Why:** it caps **blast radius** — a bad deploy, poison-pill request, hot key, or
overload damages only one cell (e.g. 1/N of customers), not everyone. It turns a global
outage into a partial one, and enables safe canary deploys (roll out cell-by-cell).

**Trade-offs:** more operational overhead (N stacks to deploy/monitor), harder cross-cell
queries, and the **cell router becomes a critical shared component** — keep it dumb and
ultra-reliable (ideally static, e.g. a mapping in DynamoDB/S3 with heavy caching), because
if it fails everything fails. Combine with **shuffle sharding** to further reduce the
probability that any two customers share the exact same set of cell resources, limiting
the impact of a single noisy/poison tenant. Pick cells for large multi-tenant/regional
services where a single-blast-radius outage is unacceptable; skip for small workloads
where the overhead isn't justified.

---

## Chaos engineering with AWS FIS

You cannot claim resilience you haven't tested. **Chaos engineering** = deliberately
injecting controlled failures in (ideally) production to validate that the system degrades
and recovers as designed, under a hypothesis ("if AZ-a fails, error rate stays <1% and RTO
<2 min").

**AWS Fault Injection Service (FIS)** is the managed tool: it runs **experiment templates**
that inject faults — stop/terminate EC2, throttle/kill EC2 API, inject latency/packet loss,
CPU/memory stress via SSM, **AZ availability-power interruption** (simulate an AZ outage),
spot interruptions, and (with cross-service actions) network disruptions. Key safety
feature: **stop conditions** tied to CloudWatch alarms automatically halt and roll back the
experiment if real customer impact exceeds a threshold.

**Trade-offs / best practices:** start in pre-prod, define a steady-state metric and stop
conditions, minimize blast radius, and run **game days** regularly. The risk of chaos
testing is real customer impact if guardrails are weak — that's why FIS enforces IAM
scoping and alarm-based stop conditions. Testing DR is non-negotiable: an untested failover
plan is a hypothesis, not a plan.

---

## Graceful degradation, throttling and load shedding

Resilience isn't only about full failover — it's about **staying partially up** under
stress:

- **Graceful degradation / fallbacks**: when a dependency fails, serve a reduced-but-useful
  response — cached/stale data, default recommendations, read-only mode, hide a
  non-essential widget. Better a degraded page than a 500.
- **Throttling / rate limiting**: cap request rates (API Gateway usage plans/throttles,
  token buckets, WAF rate rules) to protect downstream capacity and ensure fairness.
- **Load shedding**: when overloaded, *proactively reject* excess/low-priority work fast
  (return 429/503 quickly) so the system serves the accepted load well instead of collapsing
  for everyone. Prioritize critical traffic (e.g. health checks, paying customers).
- **Backpressure and queues**: SQS/buffering absorbs spikes and decouples producers from
  slower consumers, converting a throughput spike into latency rather than failure.

**Trade-off:** shedding/throttling sacrifices some requests to preserve overall
availability and latency for the rest — you must decide *what* to drop and *for whom*.
Combine with retries + exponential backoff **with jitter** and **circuit breakers** on the
client side to avoid retry storms (thundering herd) that amplify an outage. Idempotency is
required so retries are safe.

---

## Backups, immutability and WORM

Replication is not backup. Replication faithfully copies **corruption, ransomware
encryption, and accidental deletes** to every Region within seconds. The only defense is
**point-in-time backups** you can roll back to, protected from tampering:

- **S3 Object Lock** (WORM — Write Once Read Many): **Compliance mode** (no one, not even
  root, can delete/overwrite before retention expires) vs **Governance mode** (privileged
  users with a specific permission can override). Plus optional **legal holds**.
- **S3 Versioning + MFA Delete** to guard against accidental/malicious deletes.
- **AWS Backup** with **Vault Lock** (compliance mode) for immutable, cross-account,
  cross-Region backup copies; **logically air-gapped vaults** for isolation.
- **DynamoDB PITR** (restore to any second in the last 35 days) and on-demand backups.
- Keep backups in a **separate account/OU** so a compromised production account can't
  delete them (defense against insider threat / credential compromise).

**Trade-off:** immutability (compliance mode) protects against the worst insider/ransomware
scenarios but removes your ability to delete early — you pay storage for the full retention
even for mistakes, and must size retention carefully. Governance mode is more flexible but
weaker. Cross-account/air-gapped adds ops complexity but is the strongest ransomware
defense. Always pair replication with immutable backups; RPO for *corruption* is bounded by
backup granularity, not replication lag.

---

## Trade-offs and when to use what

- **Multi-AZ vs Multi-Region**: Multi-AZ = cheap, synchronous, automatic HA for AZ
  failures — always do it. Multi-Region = adds DR for Region events + global latency, but
  brings async replication (non-zero RPO), consistency complexity, and cost. Don't go
  multi-Region unless the requirement (RTO/RPO/compliance/geo) demands it.
- **Backup&restore vs pilot light vs warm standby vs active-active**: pick by RTO/RPO;
  each step right cuts recovery time and raises cost — stop at the requirement.
- **Aurora Global DB vs DynamoDB global tables**: single-writer ACID + fast promote
  (write-global) vs multi-active local writes + LWW eventual (write-local). Correctness →
  Aurora; local-write latency & Region-loss with no promote → DynamoDB.
- **S3 CRR vs RTC**: plain CRR is cheap, async, unbounded RPO; add RTC for a 15-min SLA at
  extra cost when RPO matters.
- **Route 53 vs Global Accelerator**: DNS (flexible geo/latency policies, but TTL-cache
  lag) vs anycast static IP (fast IP failover, backbone latency, fewer policies, higher
  cost).
- **Auto Scaling on failover vs static stability (hot/pre-provisioned)**: cheaper but
  control-plane-dependent (risky in a Region event) vs costlier but reliable. Critical tier
  → static; others → accept the dependency.
- **Automatic vs manual failover**: automatic = fastest RTO but risks false-positive
  failover (costly, lossy) and flapping; manual (one-button, pre-scripted, ARC) = avoids
  false alarms at the cost of human latency. Use automated *health-based data-plane* DNS
  failover for stateless tiers; manual/ARC for stateful Region promotion where a wrong
  failover is expensive.
- **Cell-based + shuffle sharding**: reduces blast radius for large multi-tenant systems at
  the cost of operational multiplicity and a critical router; skip for small systems.
- **Replication vs immutable backup**: replication = RTO/RPO for infra failure; immutable
  WORM backups = the ONLY defense for corruption/ransomware. You need both.

---

## Common interview follow-up questions

- "Your RTO is 5 minutes and RPO is 1 second for a relational workload — which strategy and
  which data service, and why not the others?"
- "Design a two-Region active-active system. How do you handle writes and conflicts? What
  breaks during a network partition?"
- "Why is depending on Auto Scaling during a Regional failover a risk, and what's the
  alternative?" (control-plane vs static stability)
- "Route 53 failover vs Global Accelerator vs CloudFront origin failover — when each?"
- "Replication gives you RPO of 1 second. Why do you still need backups?" (corruption/ransomware)
- "How do you test that your DR actually works?" (FIS, game days, ARC readiness, restore drills)
- "DynamoDB global tables resolve conflicts with last-writer-wins. When is that dangerous,
  and what do you do instead?"
- "What's the difference between pilot light and warm standby, concretely?"
- "How does cell-based architecture reduce blast radius, and what new single point of
  failure does it introduce?"
- "Your failover plan edits DNS records and scales an ASG. Why might that fail exactly when
  you need it, and how do you make it statically stable?"

## References

- AWS Well-Architected Framework — Reliability Pillar.
- AWS Whitepaper: *Disaster Recovery of Workloads on AWS: Recovery in the Cloud* (four DR
  strategies, RTO/RPO, active/active write patterns).
- AWS docs: *Using Amazon Aurora Global Database* (storage-level replication, <1 s latency,
  up to 10 secondary Regions, switchover vs failover, write forwarding).
- AWS docs: *Amazon DynamoDB Global Tables* (multi-active, last-writer-wins).
- AWS docs: *S3 Replication* and *S3 Replication Time Control (RTC)* (versioning, 15-min SLA).
- AWS docs: *Amazon Application Recovery Controller (ARC)* — readiness checks and routing
  controls (five-Region data-plane cluster).
- AWS docs: *Amazon Route 53* routing policies and health checks; *AWS Global Accelerator*.
- AWS docs: *AWS Fault Injection Service (FIS)* — experiment templates, stop conditions, AZ
  power interruption.
- Amazon Builders' Library: *Static stability using Availability Zones*; *Workload isolation
  using shuffle-sharding*; *Avoiding fallback in distributed systems*; *Timeouts, retries,
  and backoff with jitter*; *Using load shedding to avoid overload*.
- AWS docs: *S3 Object Lock*, *AWS Backup Vault Lock*, *DynamoDB point-in-time recovery*.
- re:Invent deep-dive talks on multi-Region architectures, cell-based architecture, and
  static stability (ARC 300/400-level sessions).
