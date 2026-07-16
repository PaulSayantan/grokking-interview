# Cost Optimization and Scaling Trade-offs on AWS

Cost is a first-class design axis on AWS, not an afterthought you hand to finance. Every
architecture decision — which service, which mode (serverless vs provisioned), which
purchasing model, which storage class, which Region and AZ layout — moves you along a
four-way trade-off surface: **cost vs performance vs availability/durability vs
operational effort**. A senior interview answer never says "use X because it's cheaper";
it says "use X because at *this* scale and *this* access pattern the crossover math favors
it, and here is what I give up." This topic is about reasoning quantitatively about that
surface and naming the AWS-specific traps (egress, NAT, idle provisioned capacity, hot
partitions) that wreck bills.

The mental model: **you pay AWS along a small set of pricing dimensions** — compute-time,
requests/invocations, GB stored, GB scanned/processed, and data transfer. Optimize by
(1) picking the service whose *dominant* pricing dimension matches your *cheapest* usage
axis, (2) matching provisioned capacity to real demand (right-sizing + autoscaling +
scale-to-zero), (3) committing to steady-state usage for a discount (Savings Plans,
Reserved, Spot), and (4) killing the silent line items (egress, NAT, idle, over-retained
logs). FinOps is the org practice that makes this continuous rather than a one-time audit.

---

## The cost, performance, availability, and operational-effort trade-off framework

**Intuition.** There is no globally "best" architecture — only the best one for a stated
set of constraints. Interviewers give you constraints (scale, latency budget, consistency
need, durability target, budget ceiling, team maturity) precisely so you pick a point on
the trade-off surface and defend it. The four axes usually pull against each other:

- **Cost** — total spend across all pricing dimensions, including hidden ones.
- **Performance** — latency (p50/p99), throughput, cold-start behavior.
- **Availability and durability** — AZ/Region redundancy, RPO/RTO, data loss tolerance.
- **Operational effort** — how much undifferentiated heavy lifting (patching, scaling,
  capacity planning, on-call) the team carries.

**The core tensions interviewers probe.**

- **Cost vs availability**: Multi-AZ roughly doubles the compute/DB footprint and adds
  inter-AZ transfer; multi-Region can 2–3× total cost. You buy resilience with money and
  complexity. Single-AZ is cheapest but a facility failure is an outage.
- **Cost vs performance**: Caches (ElastiCache/DAX/CloudFront), provisioned concurrency,
  higher-memory Lambdas, and Provisioned IOPS all cost more to cut latency. Right-sizing
  down saves money but risks throttling under burst.
- **Cost vs operational effort**: Serverless/managed (Lambda, Fargate, Aurora Serverless,
  DynamoDB on-demand) costs more per unit of work at steady high load but removes ops
  toil. Self-managed EC2 is cheapest per unit but you pay in engineering time and risk.
- **Performance vs durability**: One Zone-IA / single-AZ RDS trade a durability/availability
  margin for lower cost; async replication trades RPO for lower write latency and cost.

**How to answer.** State the binding constraint first ("the p99 must stay < 100 ms and we
can lose at most 5 min of data"), then pick the cheapest design that still satisfies it,
then name what you sacrificed. "Cheapest design that meets the SLO," not "cheapest design."

**The Well-Architected Cost Optimization pillar** codifies five practices: (1) practice
Cloud Financial Management (FinOps), (2) adopt a consumption model (pay only for what you
use), (3) measure overall efficiency (business output per dollar), (4) stop spending on
undifferentiated heavy lifting (use managed services), and (5) analyze and attribute
expenditure (tagging + Cost Explorer + CUR). Interviewers love when you frame answers
against these.

```
                 more $$        HIGH COST
                    ^
   Multi-Region  •  |  • Provisioned-concurrency + PIOPS + big cache
                    |
   AZ-redundant  •  |  • Right-sized autoscaling (the usual sweet spot)
                    |
   Single-AZ,    •  |  • Spot + scale-to-zero + aggressive lifecycle
   loss-tolerant    |
                    +-------------------------------------> more resilience / perf
                 LOW COST
```

---

## Pricing dimensions per service and the hidden cost of data transfer

**Intuition.** Almost every AWS bill decomposes into five dimensions. Know which one
*dominates* for each service and you can predict where money leaks.

| Dimension | Billed as | Services where it dominates |
|---|---|---|
| **Compute-time** | vCPU/GB-seconds, instance-hours | EC2, Fargate, Lambda (GB-s), RDS/Aurora instance-hours |
| **Requests/invocations** | per million requests | Lambda invokes, API Gateway, S3 GET/PUT, SQS/SNS messages, DynamoDB RCU/WCU |
| **GB stored** | GB-month | S3, EBS, EFS, DynamoDB storage, RDS storage, CloudWatch Logs retention |
| **GB scanned/processed** | per TB scanned | Athena ($5/TB scanned), Redshift Spectrum, S3 Select, DynamoDB (RCUs read) |
| **Data transfer** | GB egress | The silent killer — see below |

**Data transfer — the hidden cost that surprises everyone.** Rough hierarchy (varies by
Region; illustrative, not exact):

- **Inbound (ingress) to AWS: free.** Getting data *in* costs nothing.
- **Internet egress (out): ~$0.09/GB** for the first tier, dropping with volume; **this is
  the big one**. CloudFront egress is cheaper per GB and can be committed down further.
- **Cross-Region transfer: ~$0.02/GB** (Region-pair dependent).
- **Cross-AZ transfer within a Region: ~$0.01/GB each direction** (so ~$0.02/GB round
  trip). Chatty microservices spread across AZs pay this constantly.
- **Same-AZ, private IP: free.** Traffic to/from S3 and DynamoDB in-Region via a **Gateway
  VPC endpoint: free** (and avoids NAT charges).

**Design implications.**
- Keep chatty traffic **in-AZ** where the SLO allows (topology-aware routing), but never at
  the expense of AZ resilience for stateful/critical tiers.
- **Serve reads through CloudFront** — offloads origin egress to cheaper edge egress *and*
  cuts origin compute. A cache hit costs you almost nothing on the origin side.
- **Never route S3/DynamoDB traffic through a NAT gateway** — use Gateway endpoints (free).
- Watch **inter-service** and **inter-AZ** transfer in data pipelines; a poorly-placed
  Kafka/MSK or replication topology can generate huge cross-AZ bills.

**Back-of-envelope example.** A service egressing 100 TB/month to the internet directly:
~100,000 GB × $0.09 ≈ **$9,000/month** just in transfer. Front it with CloudFront at a
~85% hit ratio and lower per-GB edge rates and you can cut that by more than half while
also shedding origin compute. Transfer is often *the* line item that decides an
architecture.

---

## Purchasing models On-Demand, Reserved, Savings Plans, and Spot

**Intuition.** For steady, predictable usage you should *commit* and get a discount. AWS
offers a spectrum from zero-commitment/highest-price (On-Demand) to deep-discount/
interruptible (Spot), plus commitment-for-discount instruments (Reserved Instances,
Savings Plans).

| Model | Discount vs On-Demand | Commitment | Flexibility | Interruptible? | Best for |
|---|---|---|---|---|---|
| **On-Demand** | 0% (baseline) | none | full | no | Spiky/unpredictable, dev/test, new workloads |
| **Spot** | up to ~90% | none (bid on spare capacity) | full | **yes, 2-min notice** | Fault-tolerant, stateless, batch, CI, big-data |
| **Compute Savings Plans** | up to ~66% | $/hr for 1 or 3 yr | **highest** — any EC2 family/size/Region/OS + **Fargate + Lambda** | no | Steady baseline across mixed compute |
| **EC2 Instance Savings Plans** | up to ~72% | $/hr for 1 or 3 yr | medium — within one instance family + Region | no | Steady, known family/Region |
| **Standard Reserved Instances** | up to ~72% | 1 or 3 yr, specific type | low (can't change family); sellable in RI marketplace | no | Legacy commitment model |
| **Convertible RIs** | up to ~54% | 1 or 3 yr | can exchange for different attributes | no | When you need RI + flexibility |

**Payment options** (RIs and Savings Plans): **All Upfront** (deepest discount) >
**Partial Upfront** > **No Upfront** (smallest discount, no capital outlay).

**Savings Plans vs Reserved Instances (the modern default).** Savings Plans are AWS's
current recommendation over RIs because they commit to a **dollar-per-hour spend**, not to
specific instances, so the discount *floats* automatically to whatever you run. **Compute
Savings Plans** are the most flexible — they cover EC2 regardless of family/size/Region/OS/
tenancy **and** Fargate **and** Lambda, so you can refactor from EC2 to Fargate to Lambda
without losing your discount. **EC2 Instance Savings Plans** give a slightly deeper discount
(up to ~72%) in exchange for locking to one instance family in one Region.

**Spot — the deepest discount, with a catch.** Spot uses spare EC2 capacity at up to ~90%
off. AWS can **reclaim it with a 2-minute interruption notice** (delivered via instance
metadata / EventBridge) when it needs the capacity back. Design for interruption:
checkpoint work, use **capacity-optimized** allocation strategies, diversify across many
instance types/AZs, and combine Spot + On-Demand in an EC2 Auto Scaling group or via
**Spot Fleet / EC2 Fleet**. **Fargate Spot** and **Karpenter/EKS with Spot** apply the same
idea to containers. **Never** run a stateful primary DB, a stateful leader, or a workload
that can't tolerate node loss purely on Spot.

**The portfolio strategy (what a senior answer says).** Cover the **stable baseline** with
Savings Plans or RIs (commit to what you know you'll always run), serve **variable/spiky
demand** with On-Demand, and offload **fault-tolerant, time-flexible** work to Spot. Don't
over-commit: if you buy Savings Plans for 100% of a fluctuating load, you pay for unused
commitment during troughs. A common target is committing to ~70–80% of steady-state.

**Trade-offs.** Commitment trades flexibility and forecast-risk for a discount. If your
workload shrinks or you migrate off a family, an over-large RI/Savings Plan becomes
stranded cost. Spot trades reliability for price. On-Demand trades price for zero
commitment — correct for genuinely unpredictable or short-lived workloads.

---

## Serverless pay-per-use versus provisioned economics and the crossover point

**Intuition.** Serverless (Lambda, Fargate, DynamoDB on-demand, Aurora Serverless v2, S3)
bills you for *actual work*: invocations, GB-seconds, requests, per-GB. It **scales to
zero** — idle costs nothing. Provisioned (EC2, ECS/EKS on EC2, RDS/Aurora provisioned,
DynamoDB provisioned) bills for *reserved capacity whether or not you use it*. The economics
cross over at some utilization level: **below the crossover, pay-per-use wins; above it,
always-on provisioned (especially with Savings Plans) wins.**

**Lambda pricing dimensions.** You pay per **request** (~$0.20 per 1M) **and** per
**GB-second** of compute (memory × duration). Memory 128 MB–**10 GB**; vCPU scales with
memory. Max timeout **15 minutes**; ephemeral `/tmp` up to **10 GB**. There is **no charge
when idle**. Provisioned Concurrency (to kill cold starts) *does* charge for idle warm
capacity — that pushes Lambda toward the provisioned side of the trade-off.

**Where the crossover sits.** Reason about **duty cycle** (fraction of time actually doing
work):

- **Very spiky / low average utilization (< ~10–15% duty cycle), unpredictable, or
  scale-to-zero desirable** → **serverless wins.** You'd be paying for mostly-idle EC2/
  containers otherwise. Classic: internal tools, event-driven glue, cron, APIs with bursty
  or diurnal traffic, new products with unknown load.
- **Sustained high utilization (steady, predictable, ~24/7 near capacity)** → **provisioned
  wins**, especially EC2/Fargate + a Savings Plan or Graviton. At constant high RPS, Lambda's
  per-invocation + GB-second cost exceeds an always-on right-sized instance's amortized cost.
- **In between** → depends on request cost, average duration, memory, and how good your
  autoscaling is. Model it.

**Worked crossover intuition.** A Lambda at 512 MB running 200 ms per request costs on the
order of a few dollars per million requests (GB-s + request charge). At tens of millions of
requests per day sustained around the clock, a right-sized Graviton container fleet under a
Savings Plan is typically cheaper *per request* — but only if utilization stays high. If
that same volume arrives in a 3-hour daily spike, Lambda (or Fargate scaling in/out) likely
wins because the fleet would sit idle 21 hours a day.

**The real trade-off is not just dollars.** Serverless also buys: no capacity planning, no
patching, automatic scaling, built-in AZ redundancy. So even past the pure-cost crossover,
teams stay serverless to save **operational effort** — you pay a compute premium to delete
an ops burden. Conversely, serverless has ceilings: 15-min Lambda cap, cold starts, VPC/
connection-pooling friction (mitigated by RDS Proxy), and per-invocation overhead that hurts
at massive steady scale. Know both sides.

**Aurora Serverless v2** scales capacity in fine-grained ACU increments and can now (since
late 2024) **scale down to 0 ACUs** (auto-pause after a configurable idle period, with a
brief resume latency on the next connection) — good for variable or intermittent DB load,
but a steadily busy DB is cheaper on provisioned Aurora.

---

## Right-sizing and auto scaling to match demand

**Intuition.** The single biggest source of waste is **over-provisioned, under-utilized**
resources: an m5.2xlarge sitting at 8% CPU, an EBS gp2 volume 4× larger than needed, a
DynamoDB table provisioned for peak that runs at 5% most of the day. Right-sizing means
matching resource size to actual demand; autoscaling means letting that match change over
time.

**Right-sizing tools and levers.**
- **AWS Compute Optimizer** — ML-driven recommendations for EC2, EBS, Lambda memory, ECS/
  Fargate, RDS: "downsize this m5.4xlarge to m6g.2xlarge." **Cost Explorer Rightsizing
  Recommendations** and **Trusted Advisor** also flag idle/underused resources.
- **Lambda**: tune **memory** — more memory = more vCPU, so a higher-memory function can
  finish faster and sometimes cost *less* (fewer GB-seconds). Use **Lambda Power Tuning**.
- **EBS**: move gp2 → **gp3** (baseline 3,000 IOPS / 125 MB/s decoupled from size, ~20%
  cheaper); delete unattached volumes and old snapshots.

**Auto scaling flavors (match the right one to the resource).**
- **EC2 Auto Scaling Groups (ASG)**: target-tracking (keep CPU at 50%), step, scheduled,
  and **predictive scaling** (ML forecasts diurnal patterns and pre-warms capacity so you
  don't lag the ramp). Combine with mixed instances + Spot.
- **Application Auto Scaling**: scales ECS services, DynamoDB tables, Aurora replicas,
  Spot Fleet, etc., on CloudWatch metrics.
- **Kubernetes**: HPA (pods), Cluster Autoscaler / **Karpenter** (nodes — Karpenter picks
  cheapest right-sized instance types, consolidates, and uses Spot well).

**Trade-offs.** Aggressive scale-in saves money but risks being caught flat-footed by a
burst (scaling has lag — instance boot, container pull, warm-up). **Predictive + scheduled
scaling** hedges known patterns; **over-provisioned headroom** hedges unknown spikes at a
cost. Set scale-in cool-downs to avoid thrashing. The classic failure: scaling on a lagging
metric (CPU) for a latency-driven workload, so you scale *after* the SLO is already blown —
scale on the metric that actually predicts saturation (queue depth, RPS, concurrency).

---

## NAT gateway and data-transfer cost traps

**Intuition.** Two of the most common "why is my bill so high?" culprits are **NAT Gateway**
charges and **cross-AZ / egress** transfer. They're insidious because they're per-GB and
grow silently with traffic.

**NAT Gateway costs.** A NAT Gateway charges **both** an **hourly rate** (~$0.045/hr, ~$32/
month each) **and a per-GB data-processing charge** (~$0.045/GB) for everything flowing
through it — *on top of* any egress transfer cost. Traps:

- **Sending S3/DynamoDB traffic through NAT.** Private-subnet instances reaching S3 or
  DynamoDB over the internet path pay NAT data-processing per GB. Fix: **Gateway VPC
  endpoints** for S3 and DynamoDB are **free** and bypass NAT entirely. This is the #1 easy
  win.
- **One NAT Gateway per AZ vs one shared.** For HA you want a NAT GW per AZ (survives AZ
  loss), but cross-AZ traffic to a single shared NAT adds cross-AZ transfer charges. Trade
  resilience (NAT per AZ) vs cost (one NAT) — for prod, per-AZ; for dev, one is fine.
- **Chatty egress to third-party APIs / package repos** through NAT racks up data-processing
  charges. **Interface (PrivateLink) endpoints** for supported AWS services avoid NAT for
  that traffic (but interface endpoints have their own hourly + per-GB cost — cheaper than
  NAT for AWS-service traffic, do the math).

**Cross-AZ transfer trap.** Microservices, databases, and streaming systems spread across
AZs pay ~$0.01/GB each way. A high-throughput internal mesh can generate surprising bills.
Mitigations: topology-aware / same-AZ routing where the SLO permits, but **do not sacrifice
AZ redundancy for stateful tiers** to save transfer — that trades a real availability risk
for a modest cost saving.

**Egress trap.** Internet egress at ~$0.09/GB dwarfs storage cost for high-download
workloads. Front with **CloudFront** (cheaper edge egress + origin offload). For cross-cloud
or partner data feeds, consider whether the data even needs to leave AWS.

---

## S3 storage classes and lifecycle policies for cost

**Intuition.** S3 charges per GB-month, and the price per GB drops dramatically as you move
to colder classes — but colder classes add **retrieval latency, retrieval fees, minimum
storage durations, and minimum billable object sizes**. Match the class to the *access
pattern*, and automate transitions with **lifecycle policies**.

| Class | AZs | Min duration | Min billable size | Retrieval fee | First-byte latency | Use case |
|---|---|---|---|---|---|---|
| **S3 Standard** | ≥3 | none | none | none | ms | Hot, frequently accessed |
| **Intelligent-Tiering** | ≥3 | none | 128 KB* | none | ms | Unknown/changing access; auto-tiers |
| **Express One Zone** | 1 | 1 hr | none | per GB | single-digit ms | Ultra-low-latency hot data (no lifecycle) |
| **Standard-IA** | ≥3 | 30 days | 128 KB† | per GB | ms | Infrequent but needs instant access |
| **One Zone-IA** | 1 | 30 days | 128 KB† | per GB | ms | Re-creatable infrequent data |
| **Glacier Instant Retrieval** | ≥3 | 90 days | 128 KB | per GB | ms | Archive needing instant access |
| **Glacier Flexible Retrieval** | ≥3 | 90 days | none | per GB | minutes–hours | Backups accessed 1–2×/yr |
| **Glacier Deep Archive** | ≥3 | 180 days | none | per GB | up to ~12 hr | Compliance/long-term (7–10+ yr) |

\*Intelligent-Tiering objects < 128 KB are always billed at frequent-access rates and aren't
monitored. †IA classes bill a per-object minimum of 128 KB regardless of actual size.

**Key cost traps.**
- **Small objects in IA/Glacier.** The 128 KB minimum billable size and per-object overhead
  (Glacier adds ~40 KB metadata/object) mean **millions of tiny objects in IA/Glacier can
  cost *more* than Standard**. Cold classes are for *large* or *aggregated* objects.
- **Early deletion.** Deleting from Standard-IA before 30 days, Glacier before 90/180 days,
  still bills the minimum duration. Don't transition churny data.
- **Intelligent-Tiering** removes the guesswork (auto-moves objects between tiers based on
  access) for a small per-object monitoring fee — ideal when access patterns are unknown or
  changing, and there are **no retrieval fees**. It's the safe default for unpredictable
  data lakes. But for *known-hot* or *known-cold* data, a fixed class is cheaper (no
  monitoring fee).
- **One Zone-IA** is ~20% cheaper than Standard-IA but lives in a **single AZ** — data is
  lost if that AZ is destroyed. Only for **re-creatable** data (thumbnails, derived data,
  secondary copies).

**Lifecycle policies** automate transitions (Standard → Standard-IA at 30d → Glacier at 90d
→ Deep Archive at 180d) and **expiration** (delete after N days). Also enable
**expiration of incomplete multipart uploads** and **noncurrent version expiration** — orphaned
multipart parts and old versions silently accumulate cost. **S3 Storage Lens** gives
org-wide visibility into what's costing you.

**Trade-off.** Colder = cheaper storage but slower + retrieval fees. If you'll read it soon
or often, retrieval fees + latency can erase the storage savings. Model expected read
frequency before archiving.

---

## Caching to reduce cost and load

**Intuition.** A cache hit is compute and I/O you **don't** pay for downstream. Caching cuts
cost on *three* axes at once: fewer DB reads (fewer RCUs/instance load), fewer origin
compute cycles, and (via CloudFront) cheaper egress. It's one of the highest-ROI cost levers
because it simultaneously improves latency.

**AWS caching layers (edge → app → data).**
- **CloudFront (edge cache)** — caches static + cacheable dynamic responses at 600+ PoPs.
  Cuts origin egress (edge egress is cheaper), origin requests, and origin compute. High hit
  ratio = dramatically lower origin cost.
- **API Gateway caching** — caches responses per stage; reduces backend invocations.
- **ElastiCache (Redis / Memcached / Valkey)** — in-memory cache in front of RDS/Aurora/
  DynamoDB. Absorbs read-heavy traffic; a cache hit avoids a DB read and lets you run a
  smaller/cheaper DB. Redis adds persistence, replication, pub/sub; Memcached is simplest;
  Valkey is the newer open-source Redis-compatible option.
- **DAX (DynamoDB Accelerator)** — write-through cache specifically for DynamoDB, microsecond
  reads, cuts consumed RCUs (and thus cost) for read-heavy tables.

**Cost math.** If a DynamoDB table serves 10,000 read RPS and a cache absorbs 90%, you
provision for ~1,000 DB reads instead of 10,000 — a ~10× reduction in RCUs *and* better p99.
The cache node fleet costs money, so the win is real only when hit ratio is high and the
downstream you're offloading is expensive (large DB, high egress).

**Trade-offs.** Caching trades **consistency/freshness** for cost and latency — you serve
possibly-stale data. Choose TTLs and invalidation strategy per data's tolerance for
staleness. It adds a component to operate and a failure mode (cache stampede / thundering
herd on cold cache or mass expiry — mitigate with request coalescing, jittered TTLs,
soft-TTL refresh). Don't cache data that must be strongly consistent or is rarely re-read
(no hit ratio = pure overhead).

---

## DynamoDB on-demand versus provisioned capacity cost

**Intuition.** DynamoDB has two capacity modes with opposite cost profiles. **On-demand**
pays **per request** (per million reads/writes) and scales instantly to zero — no capacity
planning. **Provisioned** pays for **reserved RCUs/WCUs per hour** whether used or not, is
much cheaper *per request* at steady load, and supports **auto scaling** and **reserved
capacity** discounts.

**Facts that constrain the design.**
- **Item size limit: 400 KB.** 1 **RCU** = one strongly-consistent read of up to 4 KB/s (or
  two eventually-consistent reads); 1 **WCU** = one write up to 1 KB/s.
- **Per-partition limits: ~3,000 RCU and ~1,000 WCU.** Exceed these on one partition key and
  you get a **hot partition** and throttling regardless of table-level capacity. Adaptive
  capacity helps but you must design a **high-cardinality partition key** (or write-shard).
- On-demand also has ramp limits (it can double previous peak quickly but a cold table can
  throttle a huge instantaneous spike — pre-warm for known launches).

**When to pick which.**
- **On-demand**: unpredictable/spiky traffic, new tables with unknown load, dev/test, or
  spiky serverless workloads where scale-to-zero matters. Costs more per request (~6–7× the
  provisioned per-request rate) but you never pay for idle and never throttle from
  under-provisioning.
- **Provisioned (+ auto scaling + reserved capacity)**: steady, predictable, high-volume
  traffic. Far cheaper per request at high sustained utilization; reserved capacity adds a
  further discount for committed baseline. Risk: under-provision → throttling; over-provision
  → waste.

**Rule of thumb / crossover.** If sustained utilization would keep provisioned capacity
comfortably above ~50–60% most of the time, provisioned + auto scaling is cheaper. For
bursty or low-average traffic, on-demand wins on both cost *and* operational simplicity. You
can switch modes (limited frequency), so start on-demand to learn the pattern, then move to
provisioned once it's predictable.

---

## Graviton and ARM for price-performance

**Intuition.** AWS **Graviton** (ARM-based, custom silicon — Graviton2/3/4) instances deliver
better **price-performance** than comparable x86 (Intel/AMD) instances — commonly cited as
up to ~40% better price-performance and lower energy — for a very wide range of workloads.
It's one of the lowest-effort cost wins available: often just change the instance family and
recompile/redeploy.

**Where it applies.** EC2 (`*g` families: m6g, c7g, r8g...), **Fargate (Graviton)**, **Lambda
(arm64)**, and managed services running on Graviton under the hood — **RDS/Aurora**,
**ElastiCache**, **OpenSearch**, **EMR**, **MSK** — where you just select a Graviton instance
class and get the price cut with zero code change.

**Trade-offs / caveats.** It's an **ARM64** architecture, so:
- Native/compiled code (C/C++/Rust/Go, JNI libs, some Python/Node native modules) must be
  **built for arm64**; multi-arch container images (buildx) make this easy but you must do it.
- Rare third-party agents or proprietary binaries may lack arm64 builds — check dependencies.
- Interpreted/JIT runtimes (Java, .NET, Node, Python, Go) generally run great on Graviton.

For most modern workloads the migration is trivial and the savings are real and immediate,
which is why "have you considered Graviton?" is a stock interview follow-up. Stack it *with*
Savings Plans (Compute Savings Plans cover Graviton instances too) for compounding savings.

---

## Tagging, cost allocation, and FinOps

**Intuition.** You can't optimize what you can't attribute. **Cost allocation tags** map
spend to teams, products, environments, and features so you know *where* the money goes and
*who owns it*. FinOps is the cultural + operational practice of making cost a shared,
continuous engineering responsibility rather than a monthly finance surprise.

**The AWS cost-management toolchain.**
- **Cost allocation tags** — user-defined (e.g., `team`, `env`, `product`, `cost-center`) and
  AWS-generated. Must be **activated** in Billing to appear in reports. Enforce with **Tag
  Policies** (AWS Organizations) and **SCPs**; find gaps with the **Tag Editor** / config
  rules. Untagged resources = unattributable spend = the thing FinOps fights.
- **AWS Cost Explorer** — visualize and filter spend by tag/service/account; rightsizing and
  Savings Plans recommendations; forecasting.
- **Cost and Usage Report (CUR)** — the most granular billing data (hourly, per-resource),
  landed in S3 and queryable via Athena/QuickSight for custom FinOps dashboards.
- **AWS Budgets** — set spend/usage thresholds with alerts and **budget actions** (e.g.,
  auto-apply a restrictive policy when a budget is exceeded).
- **Cost Anomaly Detection** — ML-based alerts on unusual spend spikes (catches the runaway
  script / misconfigured job before month-end).
- **AWS Organizations + consolidated billing** — aggregate accounts; volume tiering and
  Savings Plans/RIs are **shared across the org**, so commitment purchased in one account
  benefits others.

**Multi-account strategy.** Separate accounts per team/environment (via Control Tower /
Organizations) give a hard cost + blast-radius boundary; consolidated billing still pools
discounts. This is cleaner than tag-only attribution for large orgs.

**FinOps operating model (Inform → Optimize → Operate).** Inform: give teams visibility into
their own spend (showback/chargeback). Optimize: right-size, buy commitments, adopt Graviton/
serverless, clean up waste. Operate: bake cost into CI/CD, alerting, and architecture reviews;
make it continuous. Interviewers want to hear that cost is a design input and an owned,
measured KPI — not a cleanup project.

**Trade-off.** Tagging discipline and multi-account governance cost engineering effort and
add process friction; the payoff is attributable, controllable spend and the ability to make
teams accountable. At small scale, a few tags + Budgets + Cost Explorer suffice; at large
scale you need Organizations, Tag Policies, CUR-based dashboards, and a FinOps function.

---

## Trade-offs and when to use what

A compressed decision guide interviewers reward:

- **Compute purchasing**: steady baseline → **Compute Savings Plans** (flexible) or EC2
  Instance Savings Plans (deeper, less flexible); fault-tolerant batch/stateless → **Spot**;
  spiky/unknown → **On-Demand** or serverless. Layer Graviton under all of it.
- **Serverless vs provisioned**: low duty-cycle / spiky / ops-lean team → **serverless**
  (Lambda, Fargate, DynamoDB on-demand); sustained high utilization → **provisioned +
  Savings Plan + Graviton**. Cross over on utilization, not vibes.
- **DynamoDB mode**: spiky/unknown → **on-demand**; steady high volume → **provisioned +
  auto scaling + reserved capacity**.
- **S3 class**: hot → Standard; unknown/changing → **Intelligent-Tiering**; known-cold with
  instant access → Glacier Instant Retrieval; archival → Glacier Flexible / Deep Archive.
  Automate with lifecycle. Beware small-object minimums.
- **Cut transfer cost**: Gateway endpoints for S3/DynamoDB (free, avoids NAT); CloudFront for
  egress + origin offload; same-AZ routing where SLO allows; PrivateLink for AWS-service
  traffic vs NAT.
- **Cut DB/compute cost**: cache aggressively (CloudFront/ElastiCache/DAX) when hit ratio is
  high; right-size + autoscale; delete idle resources; gp2→gp3, x86→Graviton.
- **When cost is NOT the priority**: hard latency SLOs (buy PIOPS, provisioned concurrency,
  bigger caches), strict durability/availability (multi-AZ/Region, no One Zone-IA), or
  regulatory needs — say explicitly that you're trading cost for the binding requirement.

**The meta-point.** Every cost optimization is a trade. Name what you give up (freshness,
flexibility, resilience, latency, ops simplicity) and confirm the binding constraint still
holds. "Cheapest that meets the SLO" — never just "cheapest."

---

## Common interview follow-up questions

- "This service egresses 500 TB/month to end users — how do you cut the bill without hurting
  latency?" (CloudFront + high hit ratio; measure origin offload; consider egress commitments.)
- "You have steady 24/7 EC2 baseline plus a nightly batch job — design the purchasing mix."
  (Savings Plans for baseline, Spot for batch, On-Demand for spillover.)
- "At what point does moving from Lambda to Fargate/EC2 save money?" (Duty cycle / sustained
  utilization crossover; model GB-seconds + requests vs amortized instance cost.)
- "Your DynamoDB bill spiked — walk me through diagnosing and fixing it." (On-demand vs
  provisioned, hot partition / low-cardinality key, missing cache, unbounded scans.)
- "Why is my NAT Gateway bill huge?" (S3/DynamoDB traffic through NAT → Gateway endpoints;
  chatty egress; per-GB processing charge.)
- "How would you decide S3 storage classes for a data lake with mixed access?"
  (Intelligent-Tiering default; lifecycle to Glacier for cold; watch small-object minimums.)
- "How do you keep cost visible and owned across 40 teams?" (Tags + Tag Policies, multi-account
  + consolidated billing, CUR dashboards, Budgets, anomaly detection, FinOps model.)
- "When would you deliberately NOT optimize for cost?" (Binding latency/availability/compliance
  constraint — state the trade explicitly.)
- "Graviton — when wouldn't you use it?" (arm64 build/dependency gaps; otherwise default to it.)

## References

- AWS Well-Architected Framework — Cost Optimization Pillar (whitepaper and docs).
- AWS Savings Plans overview and Compute vs EC2 Instance Savings Plans pricing docs.
- Amazon EC2 Spot Instances docs; Spot best practices and interruption handling.
- Amazon S3 Storage Classes comparison and S3 Lifecycle / Storage Lens docs.
- Amazon DynamoDB Developer Guide — read/write capacity modes, on-demand vs provisioned,
  partition behavior and adaptive capacity.
- AWS Lambda pricing and Lambda Power Tuning; AWS Compute Optimizer docs.
- AWS Graviton / Arm-based instances product pages and price-performance guidance.
- VPC pricing (NAT Gateway) and Data Transfer pricing pages; Gateway vs Interface endpoints.
- AWS Cost Management: Cost Explorer, Cost and Usage Report, AWS Budgets, Cost Anomaly
  Detection, cost allocation tags; AWS Organizations consolidated billing.
- AWS FinOps guidance / Cloud Financial Management; re:Invent cost optimization deep-dive talks.
- CloudFront pricing and caching; ElastiCache and DynamoDB DAX developer guides.
