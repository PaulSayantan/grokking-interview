# AWS Fundamentals and the Well-Architected Framework

This topic is the mental map for AWS system-design interviews. You are not expected to
memorize every service; you are expected to reason about **where compute/storage/state
lives, how it fails, and what trade-off you are making** every time you pick a service or
a mode. AWS is just a large, opinionated toolbox of the generic system-design primitives
(load balancers, queues, KV stores, object stores, caches, pub/sub, coordination). The
Well-Architected Framework (WAF) is AWS's checklist for reasoning about those choices
across six pillars. Interviewers probe two things: (1) do you know the real limits and
failure modes, and (2) can you justify a choice against a named alternative.

---

## Global infrastructure Regions, Availability Zones, and edge

**Intuition.** AWS is a hierarchy of physical isolation boundaries. From coarse to fine:
**Partition** (e.g., `aws` commercial, `aws-us-gov`, `aws-cn`) > **Region** > **Availability
Zone (AZ)** > data center. Plus a separate **edge** network (CloudFront PoPs, Local Zones,
Wavelength, Outposts) that pushes compute/content closer to users.

- **Region** = a geographic area (e.g., `us-east-1` N. Virginia, `eu-west-1` Ireland) with
  **3+ AZs** (most have 3; some have 4–6). Regions are the blast-radius boundary for most
  AWS services and the isolation boundary for data residency/sovereignty. **Nothing crosses
  Region boundaries automatically** — you replicate explicitly (S3 CRR, DynamoDB global
  tables, Aurora Global Database). Region-scoped means an outage in one Region should not
  take out another (AWS designs services to be Regionally independent; `us-east-1` is a
  notable exception because some global control planes — IAM, Route 53, CloudFront,
  STS global endpoint, some S3 control operations — historically anchor there).
- **Availability Zone** = one or more discrete data centers with independent power, cooling,
  and networking, **physically separated (typically meaningful km apart) but close enough
  for low-latency synchronous replication** (single-digit ms, usually **< 1–2 ms** inter-AZ
  RTT). An AZ id like `us-east-1a` is **account-specific** (my `1a` may be your `1b`); the
  stable identifier is the **AZ ID** (e.g., `use1-az4`). AZs are the fundamental unit of HA:
  spreading across AZs survives a single-facility failure (power, flood, fire) while keeping
  synchronous replication cheap.
- **Edge / PoP** = 600+ CloudFront Points of Presence + regional edge caches for content
  delivery, TLS termination, Lambda@Edge / CloudFront Functions, and Route 53 / AWS Shield /
  WAF entry points. Edge defeats speed-of-light latency for reads and absorbs DDoS near the
  source.
- **Local Zones** = an extension of a Region placed in a metro (e.g., LA) for **single-digit
  ms latency** to that metro for latency-sensitive workloads (gaming, media, real-time). You
  get a subset of services. **Wavelength** embeds compute inside telco 5G networks for ultra-
  low-latency mobile/edge. **Outposts** = AWS-managed racks in **your own data center** for
  low-latency-to-on-prem or data-residency needs (hybrid).

**Trade-offs.**
- AZ spread buys HA nearly for free (managed services do it for you), at the cost of
  inter-AZ data-transfer charges and slightly higher write latency for synchronous
  cross-AZ replication. Almost always worth it — single-AZ is only for dev/test or
  latency-critical, loss-tolerant workloads.
- Multi-Region buys DR and global low-latency but is **expensive and hard**: you inherit
  replication lag, split-brain risk, doubled cost, and complex failover. Do not reach for it
  until an AZ-resilient design is genuinely insufficient (see *Resilience building blocks*).
- Edge/Local Zones/Wavelength trade a smaller service catalog and higher per-unit cost for
  latency you cannot otherwise get. Use only when a real latency SLO demands it.

---

## The shared responsibility model

**Security "of" the cloud vs "in" the cloud.** AWS is responsible for the security **OF the
cloud** — the hardware, the global infrastructure, the hypervisor, the managed-service
software. **You** are responsible for security **IN the cloud** — your data, IAM config,
OS/patching (where applicable), network config, and encryption choices.

The line **moves with the service model**, which is the crux interviewers test:

| Model | Example | AWS handles | You handle |
|---|---|---|---|
| IaaS | EC2 | Hypervisor, physical, network fabric | Guest OS + patching, app, firewall (SG), IAM, data, encryption |
| Container (managed) | ECS/EKS on Fargate | Host OS, runtime infra | Container image, app, IAM, data |
| PaaS/DB | RDS, ElastiCache | OS, DB engine patching, backups infra | Schema, queries, credentials, encryption choice, data |
| Serverless | Lambda, S3, DynamoDB | Everything up to the runtime/service | Code/config, IAM policies, data, encryption keys choice |

**Key facts.** For EC2, **OS patching is YOUR job** (or via Systems Manager Patch Manager).
For RDS/Lambda, AWS patches the OS/engine. **In every model, IAM, data classification, and
"who can access what" is always yours.** Encryption is a shared control: AWS provides KMS and
service integrations; you decide what to encrypt and which key (AWS-managed vs customer-managed
CMK). Most real breaches are customer-side misconfigurations (public S3 buckets, over-broad
IAM, leaked keys), not AWS infrastructure failures.

**Trade-off:** moving up the stack (IaaS → serverless) shrinks your security surface and
ops burden but reduces control and can increase per-unit cost and lock-in.

---

## Operational excellence pillar

**Definition.** The ability to run and monitor systems to deliver business value and
continually improve supporting processes and procedures. Design principles: **perform
operations as code** (IaC via CloudFormation/CDK/Terraform), **make frequent small reversible
changes**, **refine operations procedures frequently** (game days), **anticipate failure**
(pre-mortems, failure injection with FIS), and **learn from all operational events**
(blameless post-mortems).

**How it shows up in AWS:** CloudFormation/CDK for reproducible infra; CodePipeline/CodeDeploy
for automated, canary/blue-green deploys; CloudWatch dashboards/alarms; X-Ray tracing; AWS
Systems Manager runbooks (Automation documents); Config for drift detection.

**Trade-offs.** IaC costs upfront authoring time and a learning curve but pays back in
repeatability, review, and disaster recovery. Blue/green deploys cut deploy risk but
temporarily double infrastructure cost; canary/rolling deploys are cheaper but expose a
fraction of users to bad changes. Heavy observability improves MTTR but adds cost (CloudWatch
custom metrics/logs ingestion is a real bill line).

---

## Security pillar

**Definition & principles.** Protect data, systems, and assets. Principles: **implement a
strong identity foundation** (least privilege, centralized identity, avoid long-lived creds),
**enable traceability** (CloudTrail, Config, GuardDuty), **apply security at all layers**
(defense in depth), **automate security best practices**, **protect data in transit and at
rest**, **keep people away from data**, and **prepare for security events** (IR runbooks).

**Building blocks:** IAM + IAM Identity Center (SSO), Organizations SCPs, KMS/CloudHSM for
keys, Secrets Manager (rotation) vs SSM Parameter Store (cheaper, no rotation), VPC + security
groups (stateful) + NACLs (stateless), WAF/Shield for edge, GuardDuty (threat detection),
Macie (PII discovery in S3), Security Hub (aggregation), CloudTrail (API audit log).

**Trade-offs.** Least privilege vs velocity: tight IAM slows teams; use permission boundaries
and IAM Access Analyzer to right-size. Secrets Manager gives automatic rotation and cross-
account sharing but costs per secret per month + per API call; Parameter Store SecureString
is effectively free but no built-in rotation — pick Secrets Manager when rotation/compliance
matters. Customer-managed KMS keys give you control, key policies, and rotation you own but
add per-key monthly cost and per-request charges; AWS-managed keys are free-ish but you cannot
control their policy or disable them. Envelope encryption (KMS wraps data keys) is the pattern
that makes KMS scale — you never bulk-encrypt through KMS directly.

---

## Reliability pillar

**Definition & principles.** The ability of a workload to perform its intended function
correctly and consistently, and to recover from failures. Principles: **automatically recover
from failure** (health checks + self-healing ASG/ECS), **test recovery procedures**, **scale
horizontally to reduce blast radius**, **stop guessing capacity** (auto scaling), and **manage
change through automation**.

**Concepts you must name:** availability targets and the "nines" (99.9% = ~8.77 h/yr
downtime; 99.99% = ~52.6 min/yr; 99.999% = ~5.26 min/yr); **RTO** (recovery time objective —
how long to recover) vs **RPO** (recovery point objective — how much data loss is tolerable);
fault isolation boundaries (AZ, Region, **cell-based architecture** and shuffle sharding to
limit blast radius); redundancy; graceful degradation; retries with **exponential backoff +
jitter**; idempotency; circuit breakers; bulkheads; the **static stability** principle (a
system should keep working using resources already provisioned, without needing the control
plane during a failure).

**Data-plane vs control-plane:** the **data plane** (serving requests) is more reliable than
the **control plane** (provisioning/changing resources). Depend on the data plane during
failover — e.g., pre-provision capacity and use Route 53 health checks rather than calling
APIs to launch new resources mid-incident.

**Trade-offs.** More nines cost exponentially more (each nine roughly 10x the effort/cost).
Multi-AZ is the standard reliability floor; multi-Region is for the top nines and DR. Retries
improve success but can cause retry storms/metastable failures — always add backoff, jitter,
and circuit breakers.

---

## Performance efficiency pillar

**Definition & principles.** Use computing resources efficiently to meet requirements and
maintain that efficiency as demand changes. Principles: **democratize advanced tech** (use
managed services instead of building), **go global in minutes** (multi-Region/edge),
**use serverless architectures**, **experiment more often** (cheap to A/B infra), and
**consider mechanical sympathy** (match the tech to the access pattern).

**Levers:** right-size compute (Graviton/ARM for price-performance, Compute Optimizer
recommendations); pick the right storage class/DB for the access pattern; caching
(CloudFront, ElastiCache, DAX); read replicas; async/event-driven decoupling; provisioned
vs on-demand concurrency (Lambda), provisioned throughput vs on-demand (DynamoDB).

**Trade-offs.** Serverless gives instant scale and zero idle cost but adds cold starts and
per-request pricing that can exceed always-on compute at high steady load. Caching improves
latency and offloads the origin but introduces staleness/invalidation complexity. Graviton is
~20–40% better price-performance but requires ARM-compatible builds.

---

## Cost optimization pillar

**Definition & principles.** Avoid unnecessary cost. Principles: **implement cloud financial
management (FinOps)**, **adopt a consumption model** (pay for what you use), **measure overall
efficiency**, **stop spending on undifferentiated heavy lifting** (use managed services), and
**analyze and attribute expenditure** (tagging, Cost Explorer, cost allocation tags, Budgets).

**Purchasing models:** **On-Demand** (max flexibility, highest unit price), **Savings Plans /
Reserved Instances** (1- or 3-year commit for up to ~72% off — Compute Savings Plans are the
flexible option across instance family/Region/OS and Fargate/Lambda), **Spot** (up to ~90%
off but interruptible with a 2-minute warning — great for fault-tolerant batch/stateless).
Storage tiering (S3 Intelligent-Tiering auto-moves objects; Glacier for archive). Watch
**data transfer**: cross-AZ, cross-Region, and egress to internet all cost money; ingress is
usually free.

**Trade-offs.** Commitments (SP/RI) trade flexibility for discount — over-commit and you pay
for unused capacity; under-commit and you leave savings on the table. Spot trades
availability for price. Serverless trades higher per-unit price for zero idle cost — cheapest
for spiky/low-utilization, expensive for sustained high load. The classic anti-pattern is
optimizing unit cost while ignoring the biggest lever: turning off / right-sizing what you
don't need.

---

## Sustainability pillar

**Definition & principles.** Minimize the environmental impact of running cloud workloads
(added as the 6th pillar in 2021). Principles: **understand your impact**, **establish
sustainability goals**, **maximize utilization** (right-size, consolidate — a well-utilized
instance is greener per unit of work), **anticipate and adopt more efficient hardware/software
offerings** (Graviton, managed services with high multi-tenant utilization), **use managed
services** (shared, high-utilization), and **reduce the downstream impact** of your workloads
(smaller payloads, fewer device requirements).

**Trade-offs.** Sustainability and cost optimization usually align (both reward high
utilization and right-sizing), but not always: maximum performance/redundancy (idle standby
capacity, multi-Region active-active) increases carbon. Choosing Regions with lower carbon
intensity or scheduling batch work for off-peak/greener windows can conflict with latency or
data-residency requirements.

---

## Choosing a service managed versus self-managed and serverless-first

**The decision framework interviewers want:**

1. **Access pattern first.** Relational + transactions → RDS/Aurora. KV/high-scale + known
   access patterns → DynamoDB. Blobs/large objects → S3. Full-text search → OpenSearch.
   Cache → ElastiCache. Analytics/columnar → Redshift/Athena. Stream → Kinesis/MSK.
   Pub/sub fan-out → SNS/EventBridge. Decouple/buffer → SQS.
2. **Serverless-first.** Default to Lambda + API Gateway + DynamoDB + S3 + EventBridge unless
   you have a reason not to (sustained high load, long-running/stateful, special runtime,
   ultra-low-latency, heavy compute). Serverless minimizes ops and idle cost.
3. **Managed vs self-managed.** Prefer managed unless you need control the managed service
   won't give (custom kernel, exotic config, cost at extreme scale, portability).

**The ladder of "how much do you manage":**
`EC2 (you manage OS) → ECS/EKS on EC2 → Fargate (no servers) → Lambda (no infra at all)`
`Self-hosted DB on EC2 → RDS (managed engine) → Aurora (cloud-native, storage auto-scales) → DynamoDB (fully serverless NoSQL)`

**Trade-offs (the core interview point):** managed/serverless buys **development velocity,
reduced ops, built-in HA/backup/patching** at the cost of **less control, potential
higher unit cost at scale, and lock-in** (data-model, proprietary APIs, hard to migrate off
DynamoDB/Aurora). Self-managed buys **control and portability** at the cost of **operational
burden** (patching, scaling, HA, on-call) that is undifferentiated heavy lifting for most
teams. Rule of thumb: start managed for velocity; consider self-managed only when a concrete
constraint (cost at scale, control, multi-cloud requirement) justifies the ops cost.

---

## IAM and account structure

**IAM building blocks.** **Principals** (users, roles, federated identities) get access via
**policies** (JSON documents) evaluated against **actions** on **resources** with optional
**conditions**. Types: identity-based policies (attached to user/role/group), resource-based
policies (attached to S3 bucket, SQS queue, KMS key, Lambda — these allow **cross-account**
access without assuming a role), permission boundaries (a ceiling on what an identity can do),
Organizations **SCPs** (a ceiling across whole accounts — they never *grant*, only *limit*),
and session policies.

**Evaluation logic:** **explicit deny > allow > implicit deny (default)**. Access is granted
only if some policy allows it AND no policy (including SCP/boundary) denies it. This is the
#1 IAM interview fact.

**Best practices:** prefer **IAM roles over long-lived access keys** (roles vend temporary
STS credentials); don't use the **root** account (enable MFA, lock it away); use **IAM
Identity Center** for human SSO; use **instance profiles / IRSA / Lambda execution roles** so
workloads assume roles instead of embedding keys; least privilege via Access Analyzer.

**Trade-offs.** Assuming roles / temporary credentials is more secure (auto-expiring, no
secrets to leak) but adds indirection. Resource-based policies enable cross-account access
without a role hop but are harder to audit centrally. SCPs enforce guardrails org-wide but can
cause confusing "access denied" that identity-based policies can't fix — you must debug the
whole chain.

---

## Multi-account strategy with Organizations, Control Tower, and landing zones

**Why multiple accounts (not one big account):** the AWS account is the **strongest natural
blast-radius, security, and billing boundary**. Separate accounts isolate prod from dev, limit
credential/breach blast radius, give clean cost attribution, and avoid per-account service
quotas becoming a shared bottleneck.

- **AWS Organizations**: hierarchy of accounts grouped into **Organizational Units (OUs)**,
  consolidated billing (volume discounts, shared RIs/SPs), and **Service Control Policies
  (SCPs)** applied at OU/account level as guardrails.
- **Control Tower**: an opinionated, automated way to set up and govern a **multi-account
  landing zone** — sets up a management account, log-archive and audit accounts, guardrails
  (preventive via SCPs, detective via Config), and Account Factory for vending new accounts.
- **Landing zone**: the well-architected multi-account baseline (networking, identity,
  logging, security) you deploy before workloads.

**Typical structure:**
```
Management account (billing, Organizations root) -- keep it empty of workloads
 ├── Security OU: Log Archive acct (central CloudTrail/Config logs), Audit acct (GuardDuty/SecHub)
 ├── Infrastructure OU: shared networking (Transit Gateway), shared services
 ├── Workloads OU
 │     ├── Prod OU  -> prod accounts (per app/team)
 │     └── Non-prod OU -> dev/test/staging accounts
 └── Sandbox OU: experimentation, tight SCP budget guardrails
```

**Trade-offs.** More accounts = better isolation and cleaner blast radius/cost, but more
operational overhead (networking must be stitched with Transit Gateway/VPC peering/RAM,
identity via Identity Center, cross-account access via roles). Control Tower accelerates
governance but is opinionated and can be rigid for teams with existing custom setups. Never
run workloads in the management account (it has org-wide power → huge blast radius).

---

## Resilience building blocks Multi-AZ and multi-Region

**The resilience ladder (increasing cost/complexity, increasing coverage):**

1. **Single-AZ** — cheapest, no HA. Dev/test only.
2. **Multi-AZ** — deploy across 3 AZs behind an ELB / ASG; RDS Multi-AZ synchronous standby
   (auto-failover in ~60–120s, or seconds with Multi-AZ cluster / Aurora); DynamoDB and S3
   are multi-AZ by default. **This is the default production floor.** Survives one AZ loss
   with ~zero data loss (synchronous). Same-Region so low latency and modest cost.
3. **Multi-Region DR** — replicate data to a second Region for disaster recovery. Four
   patterns by RTO/RPO/cost:
   - **Backup & Restore** (cheapest; RTO hours, RPO hours) — restore from backups/S3 in DR
     Region on demand.
   - **Pilot Light** (RTO ~10s of min, RPO minutes) — core data replicated + minimal always-on
     (DB replica); scale up compute on failover.
   - **Warm Standby** (RTO minutes, RPO seconds) — a scaled-down but fully functional copy
     always running; scale up on failover.
   - **Multi-Region Active-Active** (RTO near-zero, RPO near-zero; most expensive/complex) —
     serve from multiple Regions simultaneously (Route 53 latency/geo routing, DynamoDB global
     tables, Aurora Global Database). Must handle multi-master conflict / eventual consistency.

**Failover mechanics:** Route 53 health checks + failover/latency records; Global Accelerator
for anycast IP + fast failover; DynamoDB global tables (multi-active, last-writer-wins);
Aurora Global Database (< 1s typical replication lag, ~1 min RPO, RTO usually < 1 min with
managed planned/unplanned failover).

**Trade-offs.** Each rung up multiplies cost and complexity. **Active-active** eliminates
failover time but forces you to solve **cross-Region data consistency** (conflict resolution,
eventual consistency, idempotency) and doubles the running cost. **Warm standby** is the usual
sweet spot for serious workloads that can't tolerate hours of downtime but don't need
active-active. **Cell-based architecture** (partition users into independent cells, each a
full stack) limits blast radius so one bad deploy/poison-pill affects only one cell — a
modern reliability pattern AWS itself uses. Don't jump to multi-Region until you've confirmed
multi-AZ can't meet the SLO; multi-Region introduces more failure modes than it removes if
done carelessly.

---

## Mapping AWS to generic system-design primitives

The interview trick: translate a generic design into AWS and back. Know the mapping cold.

| Generic primitive | AWS service(s) | Notes / limits |
|---|---|---|
| L7 load balancer | ALB | HTTP/HTTPS, path/host routing, WebSockets, gRPC |
| L4 load balancer | NLB | TCP/UDP, ultra-low latency, static IP, millions of RPS |
| DNS + global routing | Route 53 | health checks, latency/geo/weighted routing |
| Anycast / fast failover | Global Accelerator | static anycast IPs, edge entry |
| CDN | CloudFront | 600+ PoPs, edge compute (CF Functions, Lambda@Edge) |
| Object store | S3 | 11 nines durability, strong read-after-write since Dec 2020, 5 TB max object |
| Block store | EBS | attached to EC2, single-AZ (snapshots to S3) |
| Shared file system | EFS (NFS, multi-AZ), FSx | |
| Relational DB | RDS / Aurora | Aurora: storage auto-grows to 128 TB, 15 read replicas |
| Serverless NoSQL KV | DynamoDB | 400 KB item, single-digit ms, partition 3000 RCU/1000 WCU |
| In-memory cache | ElastiCache (Redis/Memcached), DAX | |
| Message queue (buffer) | SQS | standard (near-unlimited TPS, at-least-once, best-effort order) vs FIFO (exactly-once processing, ordered, 300 msg/s or 3000 with batching per API action) |
| Pub/sub fan-out | SNS, EventBridge | EventBridge = event bus + routing + schema registry |
| Streaming log | Kinesis Data Streams, MSK | shard: 1 MB/s or 1000 rec/s in, 2 MB/s out |
| Serverless compute | Lambda | 15 min max, 10 GB memory, 10 GB ephemeral /tmp, 6 MB sync payload |
| Containers | ECS/EKS (+ Fargate) | |
| Workflow / orchestration | Step Functions | saga, state machine, retries |
| Data warehouse | Redshift | columnar OLAP |
| Query-on-S3 | Athena (Presto) | serverless SQL over S3 |
| Secrets | Secrets Manager / SSM Param Store | |
| API front door | API Gateway | 29 s integration timeout (default), throttling, auth |

**Numbers worth memorizing (interviewers love these):**
- S3: **11 nines (99.999999999%) durability**, 4 nines availability (Standard); **strong
  read-after-write consistency for all operations since Dec 2020**; max object 5 TB; multipart
  for > 100 MB; 3,500 PUT/COPY/POST/DELETE and 5,500 GET/HEAD **requests/s per prefix**.
- DynamoDB: item max **400 KB**; per-partition throughput cap **3,000 RCU / 1,000 WCU**
  (hot-partition ceiling); single-digit ms (DAX → microseconds); global tables for multi-Region.
- Lambda: **15 min** max timeout, up to **10 GB** memory (CPU scales with memory), **10 GB**
  ephemeral `/tmp`, **6 MB** synchronous / 256 KB async payload; default 1,000 concurrent
  executions per Region (soft).
- SQS FIFO: **300 API calls/s per action** (send/receive/delete), **3,000 msg/s with batching
  (10 per batch)**; standard SQS is effectively unlimited throughput; message max 256 KB (up
  to 2 GB via extended client with S3). Visibility timeout, DLQs for poison messages.
- Kinesis: **1 MB/s or 1,000 records/s ingest per shard, 2 MB/s egress**; on-demand mode
  auto-scales.
- API Gateway: **29-second** integration timeout (recently configurable higher on REST APIs
  but 29 s is the default and the number to quote), default 10,000 RPS account throttle.
- ALB vs NLB: **ALB = L7** (content-based routing, TLS, WebSocket) higher latency; **NLB = L4**
  (TCP/UDP, static IP, lowest latency, extreme scale, preserves source IP).

---

## Trade-offs and when to use what

**Compute:**
- **Lambda** when: event-driven, spiky/unpredictable traffic, short (< 15 min) tasks, want
  zero ops and pay-per-use. Avoid when: sustained high throughput (per-request cost dominates),
  long-running/stateful, ultra-low-latency (cold starts), or special runtime needs.
- **Fargate** when: containers without managing servers, variable load, want isolation. Avoid
  when: you need GPU/special hardware cheaply, or extreme steady scale where EC2 (with SPs) is
  cheaper.
- **EC2 (ASG)** when: full control, sustained load with Savings Plans/Spot, special
  hardware/kernel, licensing tied to cores.

**Messaging / decoupling:**
- **SQS** (queue, point-to-point, buffering, one consumer group) vs **SNS** (pub/sub fan-out,
  push) vs **EventBridge** (event bus, content-based routing, 3rd-party/SaaS integration,
  schema registry) vs **Kinesis** (ordered replayable stream, multiple independent consumers,
  ordered per-shard, replay window). SQS FIFO for strict ordering + exactly-once processing
  but capped at 3,000 msg/s; use standard SQS + idempotent consumers for higher scale.
- Common pattern: **SNS → multiple SQS** (fan-out with durable per-consumer buffering).

**Data stores:**

| Need | Pick | Why / trade-off |
|---|---|---|
| ACID transactions, joins, complex queries | Aurora/RDS | Rich queries; vertical scaling ceiling, replica lag on reads |
| Massive scale, known access patterns, single-digit ms | DynamoDB | Serverless, auto-scale; must design keys, no ad-hoc joins, hot-partition limit |
| Large objects, static assets, data lake | S3 | 11 nines, cheap; not a DB (no queries — use Athena) |
| Sub-ms reads, cache | ElastiCache/DAX | Volatile; cache invalidation problem |
| Full-text / log search | OpenSearch | Powerful; you manage cluster sizing/cost |
| OLAP / BI | Redshift / Athena | Columnar; not for OLTP |

**Consistency:** S3 = strong read-after-write (since 2020). DynamoDB = **eventually consistent
reads by default** (cheaper, 0.5 RCU) or **strongly consistent** on request (1 RCU, same-Region
only, not on GSIs). DynamoDB global tables = **eventually consistent, multi-active,
last-writer-wins**. Aurora read replicas = eventually consistent (replica lag).

**Cost mental model:** compute (right-size + SP/Spot) + storage (tier) + **data transfer**
(the sneaky one: cross-AZ, cross-Region, egress). Serverless = zero idle but higher unit;
provisioned = cheaper at steady high utilization. Always ask "what's the dominant cost driver
and the biggest lever" before micro-optimizing.

**Failure-mode checklist for any AWS design:** What happens on **AZ loss**? **Region loss**?
**Throttling / hot partition**? **Downstream dependency down** (retry storm? circuit breaker?
graceful degradation?)? **Control-plane unavailable** (is your failover statically stable?)?
**Poison message** (DLQ?)? A strong answer names the degradation mode for each.

---

## Common interview follow-up questions

- "You said multi-AZ — walk me through exactly what fails and how the system recovers if
  `us-east-1a` goes dark. What's the data loss (RPO) and recovery time (RTO)?"
- "This is single-Region. When would you go multi-Region, and which of the four DR patterns
  would you pick given a 5-minute RTO and 1-second RPO budget?"
- "Why DynamoDB over Aurora here? What breaks first as you scale — and what's the hot-partition
  story?"
- "SQS or Kinesis for this? What if you need to replay events, or need multiple independent
  consumers?"
- "Lambda everywhere — at what traffic level does always-on Fargate/EC2 become cheaper, and why?"
- "Walk me through IAM policy evaluation. An SCP denies `s3:*` but the role policy allows it —
  can the role access S3?"
- "Why separate AWS accounts instead of one? What's the blast-radius argument, and how do you
  connect them?"
- "Your design calls CreateXxx APIs during failover. Why is that a static-stability
  anti-pattern?"
- "Where does the shared-responsibility line sit for RDS vs EC2 vs Lambda? Who patches the OS?"
- "How would cell-based architecture and shuffle sharding reduce blast radius here?"

## References

- AWS Well-Architected Framework (whitepaper) and the six pillar whitepapers (Operational
  Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, Sustainability).
- AWS Global Infrastructure documentation (Regions, AZs, Local Zones, Wavelength, Outposts).
- Amazon Builders' Library: "Static stability using Availability Zones", "Timeouts, retries,
  and backoff with jitter", "Avoiding fallback in distributed systems", "Workload isolation
  using shuffle-sharding", "Avoiding insurmountable queue backlogs".
- AWS Shared Responsibility Model page.
- IAM User Guide (policy evaluation logic); AWS Organizations & Control Tower documentation;
  AWS multi-account strategy / landing zone guidance (AWS Prescriptive Guidance).
- AWS Disaster Recovery whitepaper (Backup & Restore / Pilot Light / Warm Standby /
  Multi-site active-active).
- Service docs & quotas: S3, DynamoDB, Lambda, SQS, Kinesis, API Gateway, ALB/NLB, Route 53,
  Aurora Global Database (Service Quotas console / per-service limits pages).
- re:Invent deep-dive sessions on DynamoDB internals, S3 consistency, and resilient
  architecture patterns (cell-based architecture).
