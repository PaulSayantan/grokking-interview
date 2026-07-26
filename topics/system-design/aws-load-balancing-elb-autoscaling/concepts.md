# Load Balancing and Auto Scaling: ALB, NLB, GWLB and ASG

Elastic Load Balancing (ELB) and EC2 Auto Scaling are the two AWS primitives that
turn a fleet of servers into an elastic, self-healing tier. ELB spreads traffic
across healthy targets in multiple Availability Zones; Auto Scaling groups (ASGs)
add and remove capacity so the fleet matches demand. In interviews the value is
not "use an ALB" — it is knowing **which** load balancer for which layer/protocol,
**which** scaling policy for which traffic shape, and the concrete trade-offs
(latency, cost, source-IP preservation, ops burden, failure blast radius) that make
one choice defensible over another.

This note goes service-by-service and mode-by-mode, always ending on trade-offs.

---

## ELB family overview and choosing the right load balancer

Elastic Load Balancing is one product family with four load balancer types:

| Type | OSI layer | Protocols | Killer feature | Typical use |
|---|---|---|---|---|
| **Application (ALB)** | L7 | HTTP, HTTPS, gRPC, WebSocket | Content-based routing (host/path/header) | Web apps, microservices, containers |
| **Network (NLB)** | L4 | TCP, UDP, TLS, TCP_UDP | Ultra-low latency, static/Elastic IP, source-IP preservation, millions of conn/s | Extreme throughput, non-HTTP, static IP, gaming, IoT |
| **Gateway (GWLB)** | L3/L4 (gateway) | IP (GENEVE encapsulation) | Transparent insertion of virtual appliances | Firewalls, IDS/IPS, deep packet inspection |
| **Classic (CLB)** | L4 + L7 | HTTP, HTTPS, TCP, SSL | Legacy only | Pre-2016 apps not yet migrated |

**What "OSI layer" means here (ground the jargon once).** The **OSI model** is the
standard 7-layer networking stack; the only distinction you need is *how much of the
traffic the LB looks at*:
- **L7 (application layer)** — the LB parses the actual **HTTP request** (URL path,
  headers, method), so it can route and rewrite based on contents.
- **L4 (transport layer)** — the LB sees only **TCP/UDP connections** (IPs and ports),
  never their contents; it just picks a backend for each connection.
- **L3 (network layer)** — the LB operates on **raw IP packets** and forwards them
  transparently (a "bump-in-the-wire": inserted into the path without the endpoints
  noticing).

**How ELB actually works under the hood (one model that explains everything).** An
ELB is not a single box — it is a **DNS name** (e.g. `my-alb-123.elb.amazonaws.com`)
that resolves to a set of **load balancer nodes**, one (that scales horizontally) per
enabled AZ, each with its own IP. Clients resolve the name and connect to a node IP.
This single picture explains three things that otherwise look like unrelated rules:
(1) why an **ALB has no static IP** — the node IPs are AWS-managed and change as nodes
scale; (2) why **an AZ failure "just works"** — ELB pulls that AZ's node IPs out of
DNS and clients stop reaching it; and (3) what **cross-zone load balancing** actually
toggles — whether a node may forward to targets in *other* AZs or only its own. Keep
this "DNS name → per-AZ nodes → targets" model in your head for the rest of the note.

**Mental model:** the choice is driven first by *what you route on*.
- Route on URL path, host header, HTTP method, cookies, query string → **ALB** (L7).
- Route a raw TCP/UDP stream with lowest latency, or you need a fixed IP the
  client can allowlist → **NLB** (L4).
- Transparently steer *all* traffic through a third-party security appliance
  fleet without changing routes/IPs → **GWLB** (L3 bump-in-the-wire).
- Anything greenfield: never CLB.

**Trade-off framing.** L7 (ALB) understands HTTP, so it can do path routing,
authentication (OIDC/Cognito), header rewriting, WAF integration, and per-request
load balancing — but it terminates and re-originates the connection (does not
preserve client source IP by default; you get `X-Forwarded-For`), adds a small
amount of latency (~milliseconds of processing), and cannot handle non-HTTP.
L4 (NLB) is a near-passthrough: microsecond-class added latency, preserves source
IP, handles any TCP/UDP protocol and huge connection counts — but it is "dumb":
no path routing, no header inspection, no native WAF. You trade intelligence for
speed and transparency.

See the AWS product comparison table for the authoritative feature matrix; the
above is the interview-usable subset.

---

## Application Load Balancer (L7) deep dive

**Mental model first:** think of an ALB as a **smart HTTP reverse proxy**. It opens
the envelope — it reads the actual HTTP request (the URL path, the `Host` header, the
method, cookies) and *decides* where to send it based on the contents. Because it
opens and re-seals the envelope, it terminates the client's connection and starts a
fresh one to the backend (so the backend sees the ALB's IP, not the client's, unless
it reads `X-Forwarded-For`).

An ALB operates at the application layer. Its object model is:
**Listener** (protocol+port, e.g. HTTPS:443) → **Rules** (conditions + actions,
evaluated by priority) → **Target groups** (a set of targets + health check).

Key capabilities:
- **Content-based routing**: rules match on host header, path pattern, HTTP header,
  HTTP method, query string, or source IP, and forward/redirect/fixed-response/
  authenticate. This is what lets one ALB front many microservices
  (`/orders/*` → orders TG, `api.example.com` → api TG).
- **Protocols**: HTTP/1.1, HTTP/2, gRPC (HTTPS only), and **WebSocket** (upgrade
  is passed through). HTTP/2 to targets is supported; HTTP/3/QUIC is *not* on ALB.
- **TLS termination** with ACM certs, SNI for many certs on one listener, and
  configurable security policies.
- **Native integrations**: AWS WAF (L7 firewall), Cognito/OIDC user authentication,
  Lambda targets (invoke a function per request), sticky sessions via cookies.
- **Target types**: `instance`, `ip`, `lambda`.
- **Routing algorithms** (per target group): `round_robin` (default),
  `least_outstanding_requests` (good for uneven request cost / long-lived
  connections), and `weighted_random` with optional **anomaly mitigation** (shifts
  traffic away from targets returning anomalous errors/latency).

**Limits/defaults worth knowing:**
- **Idle timeout**: default 60 s (configurable 1–4000 s). Long-poll/streaming
  clients must send data within this window or the connection is closed.
- Cross-zone load balancing is **always on and free** for ALB.
- ALB scales itself; you don't provision capacity, but there is a warm-up period
  for sudden 10x+ spikes (pre-warm via traffic ramp or Support for flash events).
- Billed per hour + **LCU** (Load Balancer Capacity Units) measuring new
  connections, active connections, processed bytes, and rule evaluations.

**Trade-offs.** ALB is the default for HTTP microservices: one LB fans out to many
services, integrates WAF/auth, and supports containers with dynamic ports. What you
give up, and why:
- **No real client source IP** — it terminates the connection, so the backend sees
  the ALB and gets the client only via the `X-Forwarded-For` header. Non-HTTP or
  IP-allowlisting downstreams can't read that header, so they can't recover the client.
- **No static IP** — you get a DNS name only. If a fixed IP is mandatory (partner
  allowlist), front the ALB with an **NLB** or **Global Accelerator**.
- **Cost at high connection churn** — the per-request LCU model can be pricier than
  NLB when connections churn fast (see the LCU worked example below).
- **Added latency** — L7 parsing costs a few milliseconds vs NLB's near-passthrough.

Pick ALB when routing intelligence, HTTP features, and WAF matter more than raw
latency or a static IP; reach for NLB the moment one of those four costs is a dealbreaker.

**Worked example — reading an LCU bill.** An LCU is billed as the **max** of four
dimensions each hour — you pay for the single dimension you stress most, *not* their
sum. Published per-LCU allowances: **25 new connections/sec**, **3,000 active
connections/min**, **1 GB processed/hour**, and **1,000 rule-evaluations/sec** (only
rules past the first 10 count). Take one hour of a chatty, short-connection API:

- New connections: 2,000/sec → 2,000 / 25 = **80 LCUs**
- Active connections: ~10,000 concurrent → 10,000 / 3,000 = **3.3 LCUs**
- Processed bytes: 5 GB → 5 / 1 = **5 LCUs**
- Rule evals: default routing (≤10 rules) → **~0 LCUs**

Max = **80 LCUs**, driven entirely by connection churn. At ≈$0.008/LCU-hour that's
≈$0.64/hour plus the ≈$0.0225 ALB-hour. Run the *same* traffic through an NLB, whose
NLCU allowances for connections are far higher (**800 new flows/sec**, **100,000
active flows/min**, 1 GB/hour): new flows 2,000/800 = 2.5, bytes 5/1 = 5 → max = **5
NLCUs** ≈ $0.03/hour at ≈$0.006/NLCU-hour. That ~20x gap is *why* NLB is cheaper for
high connection churn: ALB meters new connections at 25/sec, NLB at 800/sec, so the
same connection storm that pins ALB to its new-connection dimension barely registers
on NLB (which ends up bytes-bound instead).

---

## Network Load Balancer (L4) deep dive

**Mental model first:** where an ALB opens the envelope, an NLB is a **wire-speed
packet router that never opens it**. It sees only the connection's addressing —
source/destination IP and port — picks a backend for that flow, and gets out of the
way. It doesn't know or care whether the bytes inside are HTTP, MySQL, a game
protocol, or noise. That "don't look inside, just forward" design is exactly why it
adds almost no latency, preserves the client's real source IP, and scales to millions
of connections.

An NLB operates at the transport layer (L4) and is effectively a highly available,
horizontally scaled flow router built on AWS Hyperplane.

How it routes:
- **TCP**: target chosen by a flow hash over {protocol, src IP, src port, dst IP,
  dst port, TCP sequence number}. A connection sticks to one target for its life.
- **UDP**: flow hash over the 5-tuple (no sequence number); a flow sticks to one
  target.
- Supports **TCP, UDP, TCP_UDP, TLS** listeners — those are the *only* NLB listener
  protocols. There is **no QUIC/HTTP3 listener** on ELB: native HTTP/3 termination is
  a **CloudFront** feature, not an NLB one. QUIC does ride on top of UDP, so if you
  simply need to *pass QUIC packets through* to your own servers, a plain **UDP
  listener** carries them transparently (the NLB never parses them) — but the NLB
  itself does not "speak" QUIC.

**Worked example — why one client hits two targets.** The hash is over the *tuple*,
not the client. Say client `203.0.113.7` opens two TCP connections to the NLB on
port 443. The OS picks a different **ephemeral source port** per connection — say
`51000` and `51001`. Two tuples with 4 fields identical and one field (src port)
different hash to two different buckets, so connection A lands on target-1 and
connection B on target-2. The flip side is the load-skew trap: a single client
holding **one** huge long-lived connection (e.g. a 1 Gbps video ingest) is *one*
tuple → *one* target for its entire life. NLB never rebalances a live flow, so a few
heavy long-lived clients can pin most of your load onto a couple of targets while the
connection *count* looks perfectly even. That is exactly when you reach for
`least_outstanding_requests` (ALB) or more granular fan-out — flow hashing balances
flows, not bytes.

Distinctive properties:
- **Static IP per AZ**: one private IP per enabled subnet, and you can attach one
  **Elastic IP per AZ** for internet-facing NLBs — clients/partners can allowlist
  fixed IPs. ALB cannot do this.
- **Source IP preservation**: with `instance` and `ip` target types the client's
  real source IP reaches the target (no `X-Forwarded-For` needed). Preserved by
  default for **instance** targets; for **ip** targets it is a target-group attribute
  (`preserve_client_ip`) whose default differs (off for ip targets registered by IP
  in most cases) — a classic gotcha when a container fleet suddenly sees the LB's IP
  instead of the client's. Great for firewalls, geo-IP, rate limiting at the app.
  Watch the **hairpin/loopback** limitation: when client-IP preservation is on, a
  target cannot reach *itself* through the NLB (a request that flow-hashes back to the
  originating instance breaks, because the packet's src and dst resolve to the same
  host). And when client-IP preservation is on, the target's inbound packets carry the
  **client's** IP, so target **security groups must allow the client CIDRs** for that
  traffic (not the NLB) — the classic "I allowed the LB but traffic is still blocked"
  gotcha. See the failure-modes section.
- **NLB security groups (modern capability)**: for a long time NLBs — unlike ALBs —
  **could not have a security group of their own** (a favorite old interview gotcha).
  Since Aug 2023 an NLB created with a security group attached *can* filter traffic at
  the LB itself. This also introduces a setting for whether the **target's** security
  group is evaluated against the **client IP** (the client-IP-preservation case above)
  or against the NLB — the `enforce-security-group-inbound-rules-on-private-link-traffic`
  option — so "which IP must the target SG allow?" now depends on both client-IP
  preservation and this flag. Note the SG attachment is fixed at creation time on
  existing NLBs, so this is something to plan up front.
- **Ultra-low latency** (single-digit added latency, often sub-millisecond vs
  ALB's higher processing) and **millions of connections/requests per second**.
- **TLS offload** on NLB (terminate TLS at L4 with ACM) if you want cert management
  without HTTP awareness.
- **Target types**: `instance`, `ip`, and **`alb`** (NLB → ALB chaining, e.g. to
  get a static IP in front of an ALB, or to combine PrivateLink + L7 routing).
- Works as the entry point for **AWS PrivateLink** (VPC endpoint services).

**Limits/defaults worth knowing:**
- **Idle timeout**: NLB TCP flows have long been **fixed at 350 s** and — unlike the
  ALB idle timeout — are generally **not tunable**; UDP has no connection concept. The
  standard fix for long-lived-but-idle flows is therefore **client-side TCP keep-alive**
  (keep packets flowing so the flow never goes idle for 350 s), *not* raising a timeout.
  (Verify against current NLB docs before quoting a hard number in an interview.)
- **Cross-zone load balancing is OFF by default** and, when enabled, incurs
  **inter-AZ data transfer charges** (this is the opposite of ALB, and a classic
  gotcha). See the cross-zone section.
- No native WAF (WAF is L7); no content routing; no HTTP header manipulation.
- When client-IP preservation is on, targets see the client's IP, so target security
  group rules must allow the **client CIDRs** for that traffic (not the LB). If
  preservation is off, or with the newer NLB-SG PrivateLink enforcement option, the
  target instead sees the NLB — so decide which one the target SG must trust based on
  those two settings.

> [!INTERVIEW]
> Three NLB "modernity" facts interviewers use to separate stale from current
> answers: (1) an NLB **can now have its own security group** (since Aug 2023) — the
> old "NLBs can't have security groups" line is no longer true; (2) there is **no QUIC
> or HTTP/3 listener** on any ELB — HTTP/3 termination lives at **CloudFront**, and an
> NLB only carries QUIC as opaque UDP; (3) the NLB TCP **idle timeout is 350 s and
> effectively fixed** — the fix for long idle flows is **client TCP keep-alive**, not
> a bigger timeout. Repeating "NLB has no SG / NLB supports QUIC / raise the NLB idle
> timeout" all read as out-of-date.

**Trade-offs.** Pick NLB for: non-HTTP protocols, latency-critical paths, static/
Elastic IP requirements, source-IP-dependent apps, extreme connection scale, and
PrivateLink. You give up: path/host routing, WAF/auth integration, per-request
load balancing (it's per-flow), and health checks are shallower (it can't inspect
HTTP bodies unless you use HTTP health checks on a TCP target group). If you need
both L7 routing and a static IP, chain **NLB → ALB** or put **Global Accelerator**
in front of an ALB instead.

---

## Gateway Load Balancer (L3) and appliance insertion

GWLB solves a narrow but important problem: **transparently inserting a fleet of
third-party virtual appliances** (next-gen firewalls, IDS/IPS, DPI, packet
capture) into the traffic path without re-architecting routing or exposing the
appliances directly.

How it works:
- GWLB operates as a **L3 gateway (bump-in-the-wire)**. It uses the **GENEVE
  protocol on UDP port 6081** to encapsulate original packets and send them,
  unmodified, to the appliance fleet, then receives them back and forwards to the
  destination. The appliances see the original packet, IP headers intact.
- Traffic is steered to GWLB via a **Gateway Load Balancer Endpoint (GWLBe)**, a
  type of VPC endpoint (PrivateLink), referenced in route tables. This decouples
  the appliance owner (security VPC) from the application VPC.
- It provides scaling, health checking, and flow stickiness (a flow pins to one
  appliance so stateful inspection works) for the appliance fleet.

**Trade-offs.** GWLB is the right tool when you must run *your own or a vendor's*
inline security appliances and want them highly available, auto-scaled, and
inserted transparently across many VPCs (centralized inspection VPC + Transit
Gateway pattern). Alternatives: AWS-managed **Network Firewall** (no appliance
fleet to run, less flexibility), or host-based agents (no network choke point).
GWLB adds latency (extra hop + encapsulation) and cost (endpoints + data
processing + the appliance fleet itself), and only makes sense when you genuinely
need transparent inline L3 inspection. It is *not* a general-purpose app LB.

---

## Classic Load Balancer (legacy) and migration

The Classic Load Balancer (CLB, "ELB v1") predates ALB/NLB. It can do basic L4 and
some L7, but lacks content-based routing, target groups, host/path rules,
Lambda/IP targets, WebSocket/HTTP2, and most modern integrations.

**Guidance:** never choose CLB for new work. AWS positions it as legacy.
Migration paths:
- L7/HTTP CLB → **ALB** (gain path/host routing, WAF, containers).
- TCP/SSL CLB → **NLB** (gain static IP, source-IP preservation, scale).
- AWS provides a migration wizard/copy utility to reproduce listeners on the new type.

**Trade-off / when it lingers:** the only reason to keep a CLB is an app that
depends on a CLB-specific behavior not yet re-tested on ALB/NLB, or organizational
inertia. There is essentially no capability CLB has that ALB+NLB don't cover better.

---

## Target groups, target types, and registration

A **target group** is the unit of routing + health checking. A listener/rule
forwards to a target group; the target group tracks its targets' health.

**Target types:**
- `instance` — register by EC2 instance ID; traffic goes to the instance's primary
  private IP. Simplest with ASG (ASG auto-registers on launch).
- `ip` — register by IP (VPC subnets, peered VPC, on-prem via DX/VPN, RFC1918/6598
  ranges). Enables cross-VPC, on-prem, and multiple apps per instance/port. Cannot
  be publicly routable IPs.
- `lambda` — ALB only; the LB invokes a Lambda per request (serverless targets).
- `alb` — NLB only; front an ALB with an NLB for static IP + L7 routing.

**Registration with ASG:** attach the target group to the ASG; Auto Scaling
registers new instances and deregisters terminated ones automatically, honoring
the deregistration delay. This is why you attach *target groups* (not the LB
directly) to an ASG in modern setups.

**Trade-offs.** `instance` targets are simplest but tie you to EC2 in the same VPC.
`ip` targets are more flexible (containers with awsvpc networking, on-prem, cross-
VPC databases) at the cost of managing IP registration and losing the automatic
"same instance" mapping. `lambda` targets give serverless HTTP with no servers,
but incur invoke latency/cost and the 1 MB request/response and Lambda timeout
constraints — good for lightweight or spiky endpoints, not high-QPS hot paths.

---

## Health checks, connection draining, and deregistration delay

**Health checks** run per target group. The LB routes only to targets that pass.
Tunables: protocol/port/path, `HealthCheckIntervalSeconds`, timeout,
`HealthyThresholdCount`, `UnhealthyThresholdCount`, and success matcher (HTTP codes).
- ALB uses HTTP/HTTPS health checks (can check a real endpoint like `/healthz`).
- NLB defaults to TCP health checks but can do HTTP/HTTPS checks against targets.
- A target must pass the first check before receiving traffic after registration.

**Connection draining = deregistration delay.** When a target is deregistered or
becomes unhealthy (or ASG terminates it), the LB stops sending *new* requests but
lets **in-flight requests finish** during the deregistration delay.
- ALB/NLB attribute `deregistration_delay.timeout_seconds`: **default 300 s**,
  range **0–3600 s**.
- Set it long enough to cover your longest normal request, short enough to not
  slow deploys/scale-in. Long-lived connections (WebSocket, streaming) may be cut
  at the end of the window regardless.

**Slow start** (ALB target group `slow_start.duration_seconds`, 30–900 s, default
0/off): ramps traffic to a *newly healthy* target linearly instead of hitting it
with full share immediately — protects cold caches/JIT-warming apps from a
thundering herd.

**Trade-offs.** Aggressive health checks (short interval, low unhealthy threshold)
detect failures fast but risk flapping and false negatives under transient GC
pauses; conservative checks are stable but slow to eject bad hosts. A deep health
check that pings downstream deps can flip *every* target to unhealthy at once when
that shared dependency blips. Critically, ELB does **not** then drop all traffic:
when *all* targets in a target group are unhealthy the LB **fails open** and routes
to every target anyway (regardless of health status). So the real danger of a deep
check isn't dropped traffic — it's that the LB sends requests to targets that will
all error on the dead dependency, and you've lost the health signal that could have
routed around a genuinely bad host. A shallow `/healthz` avoids the mass-unhealthy
flip but can keep routing to a target whose dependency is down. Balance depth vs
blast radius.

---

## Cross-zone load balancing and multi-AZ distribution

Each enabled AZ gets a **load balancer node**. Without cross-zone LB, a node only
sends to targets **in its own AZ**; with cross-zone on, every node sends to targets
**in all enabled AZs**.

**The key defaults (a favorite interview gotcha):**
- **ALB: cross-zone is always ON and free.** You cannot turn it off at the LB level
  (target-group override exists).
- **NLB (and CLB): cross-zone is OFF by default**, and turning it on incurs
  **inter-AZ data transfer charges**.

**Why it matters — even distribution.** DNS hands clients the per-AZ node IPs
roughly evenly. If AZ-A has 2 targets and AZ-B has 8, then *without* cross-zone,
each AZ receives ~50% of traffic, so the 2 targets in AZ-A get 25% each while the
8 in AZ-B get 6.25% each — a 4x imbalance. Cross-zone smooths this by letting every
node reach every target. Keeping AZs symmetric (equal target counts) mitigates the
imbalance without paying cross-zone data charges on NLB.

```
WITHOUT cross-zone (DNS = 50% per node)      WITH cross-zone (nodes fan to all)
  Node-A (50%)      Node-B (50%)               Node-A          Node-B
   /     \          / / / / \ \ \ \              \\  \\        //  //
  T1     T2        T3 T4 ... T10                every node -> all 10 targets
 25%    25%       6.25% each                    each target = 100%/10 = 10%
 (2 targets split 50%)  (8 split 50%)           (even, regardless of AZ counts)
```

The skew comes purely from splitting each node's 50% among *unequal* target counts:
50%/2 = 25% vs 50%/8 = 6.25% (25 / 6.25 = 4x). Cross-zone erases it (10% each) at the
cost of inter-AZ bytes on NLB.

**Multi-AZ = availability.** Enable ≥2 (ideally 3) AZs and keep healthy targets in
each. If an AZ's targets all go unhealthy, ELB removes that AZ's node IPs from DNS
(clients honoring TTL, 60 s, stop hitting it). This is your AZ-failure story.

**Trade-off.** On NLB, cross-zone ON = even load + resilience to skew, but you pay
cross-AZ data transfer for every rebalanced byte; cross-zone OFF = free + lowest
latency (stays in-AZ) but you must keep AZs balanced and over-provision so any AZ
can absorb a peer AZ's failover. High-throughput NLB workloads often deliberately
leave cross-zone off and balance capacity per AZ to save on data transfer.

---

## Sticky sessions and session affinity

Stickiness pins a client to the same target so server-side session state is found.

- **ALB duration-based (`lb_cookie`)**: ALB issues an `AWSALB`/`AWSALBCORS` cookie;
  duration 1 s–7 days, default 1 day.
- **ALB application-based (`app_cookie`)**: honors your app's cookie (`AWSALBAPP`
  wrapper); duration 1 s–7 days, default 1 day. Ties affinity to your session
  lifecycle.
- **NLB**: source-IP affinity via flow hash is inherent per flow; NLB also supports
  stickiness by source IP for TCP/UDP target groups.

**Trade-offs.** Stickiness is a crutch for stateful servers: it enables in-memory
sessions but **breaks even load distribution** (hot targets get "stuck" heavy
clients), **hurts scale-in/deploys** (draining a sticky target disrupts its pinned
users), and **reduces resilience** (losing a target loses those sessions). The
better pattern is **stateless app servers** with session state in a shared store
(ElastiCache/Redis, DynamoDB) or JWTs — then any target can serve any request and
the LB is free to balance perfectly. Use stickiness only for legacy stateful apps
or to keep a warm per-user cache, and keep durations short.

---

## Auto Scaling groups fundamentals

An **Auto Scaling group (ASG)** maintains a fleet between `min` and `max` size at a
`desired` capacity, across multiple subnets/AZs, launching from a **launch template**.

Core behaviors:
- **Maintain desired count**: if an instance fails its ASG or ELB health check, the
  ASG terminates and replaces it (self-healing).
- **Health check types**: EC2 status checks, ELB health checks, and EBS; use ELB
  health checks so app-level failures (not just instance failures) trigger replacement.
- **Health check grace period** (default 300 s): time after launch before health
  checks count, so slow-booting apps aren't killed prematurely.
- **AZ rebalancing**: ASG strives to keep instances evenly spread across AZs and
  will rebalance after an AZ recovers.
- **Termination policies** decide *which* instance to kill on scale-in (default:
  oldest launch template/config, then closest to next billing hour).
- **Instance refresh** rolls the fleet to a new launch template version (deploys/AMI
  updates) with configurable min-healthy-percentage.
- **Mixed instances / capacity-optimized allocation** and **Spot** for cost.

**Trade-offs.** ASG gives elasticity + self-healing for free, but scaling is only
as fast as instance boot + app warm-up (minutes) — bursty, sub-minute spikes need
**warm pools**, pre-provisioning, or a serverless/container tier that scales faster.
ELB health checks catch more failures than EC2 checks but a bad deploy that fails
health checks everywhere can send the ASG into a launch/terminate loop.

---

## Scaling policies target tracking, step, simple, scheduled, predictive

ASG supports several policy types; picking the right one is a common design question.

- **Target tracking** (recommended default): keep a metric at a target value (e.g.
  ASGAverageCPUUtilization = 50%, or `ALBRequestCountPerTarget` = 1000). AWS
  manages the CloudWatch alarms and computes how many instances to add/remove. Best
  for most workloads; behaves like a thermostat.

  **Worked example — how it picks the count.** Target = `ALBRequestCountPerTarget`
  = 1,000. You have **10** instances and traffic climbs to **18,000 req** over the
  period. Current metric = 18,000 / 10 = **1,800 per target** — 1.8x the target, too
  hot. Target tracking uses the ratio: desired ≈ current × (metric / target) =
  10 × (1,800 / 1,000) = 18 (equivalently ceil(18,000 / 1,000) = 18). So it scales
  **+8 → 18 instances**. Next period the same 18,000 spread over 18 targets = exactly
  1,000/target → at target, no action. If traffic then falls to 9,000: 9,000 / 18 =
  500/target (half), desired = 18 × (500 / 1,000) = 9 → scale **in to 9**. That
  settle-toward-target loop is the "thermostat." (Compare step scaling firing on the
  same 1,800 breach: you'd hand-author a table like `+3 if ≥150% of target, +6 if
  ≥180%` — more control, more to tune, whereas target tracking derived the +8 for you.)
- **Step scaling**: add/remove capacity in steps based on alarm breach magnitude
  (e.g. +1 at 60% CPU, +3 at 80%). More control than simple; good when you want
  bigger responses to bigger breaches.
- **Simple scaling**: single adjustment per alarm, then wait a cooldown before any
  further action. Oldest, least responsive; largely superseded by target/step.
- **Scheduled scaling**: change min/max/desired at set times (e.g. scale up before
  a 9 a.m. business spike, down at night). Deterministic, predictable loads.
- **Predictive scaling**: ML forecasts load from history — a **24 h minimum** to
  produce a first forecast, but AWS analyzes up to the past **14 days** and forecasts
  are more accurate with ~2 full weeks of data (hourly forecast for the next 48 h,
  refreshed every 6 h) — and **provisions capacity ahead of the predicted spike**,
  ideal for cyclical/daily patterns. Often combined with target tracking (predictive
  handles the known cycle, target tracking handles the unexpected).

**Choosing the metric matters more than the policy.** For request-driven web tiers,
`ALBRequestCountPerTarget` (or a queue depth / latency SLO) tracks load better than
CPU. For queue consumers, scale on **backlog per instance** (SQS
`ApproximateNumberOfMessages` / consumer count). CPU is a poor proxy for I/O-bound
or memory-bound apps.

**Trade-offs.** Target tracking is simplest and self-tuning but reactive (it scales
*after* the metric moves, so there's a boot-time lag). Step scaling reacts more
aggressively to severe breaches but you must design the steps. Scheduled is perfect
for known cycles but blind to surprises. Predictive removes the boot-lag for
*recurring* patterns but is useless for novel spikes and, while 24 h of history is
enough to start, needs about two weeks of history to be accurate. Real systems layer them: predictive/scheduled for the baseline curve +
target tracking as the safety net.

---

## Cooldowns, warm pools, and lifecycle hooks

**Cooldown** (simple scaling): a pause (**default 300 s**) after a scaling activity
before another simple-scaling action, preventing thrashing while new instances warm
up. Target tracking and step scaling use **instance warm-up** instead of cooldown
(they don't block scale-out on cooldown, avoiding under-provisioning).

**Warm pools**: a pre-initialized pool of **stopped** (or hibernated / kept-running)
instances that are already booted and app-warmed. On scale-out, the ASG pulls from
the warm pool instead of cold-launching, cutting time-to-serve from minutes to
seconds. States: `Stopped` (cheapest — only EBS), `Running` (fastest — full cost),
`Hibernated` (RAM preserved to disk). Ideal for slow-booting apps (large AMIs, JIT
warm-up, big caches) that also see fast spikes.

**Lifecycle hooks**: pause an instance in `Pending:Wait` (before entering service)
or `Terminating:Wait` (before termination) to run custom actions — install/config
on launch, drain connections / flush logs / deregister from external systems on
terminate. The instance waits until you `CompleteLifecycleAction` or the heartbeat
times out (**default 3600 s / 1 h**, extendable, max 48 h / 172800 s). Default
action on timeout is configurable (ABANDON or CONTINUE).

**Trade-offs.** Warm pools trade **standby cost** (you pay for stopped-instance EBS,
or full cost if kept running) for **fast scale-out** — worth it when boot time
threatens your SLO during spikes, wasteful for fast-booting stateless apps.
Lifecycle hooks add **operational complexity** and can *stall* scaling if a hook
hangs (instance sits in Wait until timeout), so keep hook actions fast and idempotent.

---

## Choosing scaling metrics and capacity planning

**Right metric per workload:**
- Stateless web/API tier: `ALBRequestCountPerTarget` or p99 latency SLO.
- CPU-bound compute: average CPU (target tracking at ~50–70%).
- Queue workers: **backlog per instance** = messages / running instances; target a
  value that meets your latency budget.

  **Worked example — turning a drain SLO into a target.** Backlog = **10,000
  messages**, each takes **200 ms** to process, and you want to drain within **60 s**.
  One instance does 1 / 0.2 = **5 msgs/sec**, so in 60 s it clears 5 × 60 = **300
  messages**. Instances needed = 10,000 / 300 ≈ 33.3 → **34 instances**. So set the
  target `backlog-per-instance` = throughput_per_instance × budget = 5 × 60 = **300
  messages/instance** (equivalently messages ÷ instances = 10,000 / 34 ≈ 294): whenever
  `ApproximateNumberOfMessages / running-instances` exceeds ~300, target tracking scales
  out to hold the 60 s drain SLO. Tighten the budget to 30 s and the target halves (5 ×
  30 = **150**), roughly doubling the fleet.
- Connection-heavy (NLB): active flow count / bandwidth per target.

**Back-of-envelope.** If each instance safely serves 1,000 RPS and peak is 250,000
RPS, you need ≥250 instances just for peak, plus headroom for a target CPU below
100% (at 50% target, double to ~500) and **N+1 (or N+ one AZ)** redundancy so a
full AZ failure still leaves enough. Work the AZ math explicitly: 500 instances / 3
AZs ≈ **167/AZ** at steady state. If one AZ dies, the surviving **two** must still
carry all 500 → 500 / 2 = **250/AZ**. So provision **250/AZ = 750 total** — i.e. each
AZ runs at 250 / 167 ≈ **1.5x** its normal share (the remaining two go from 33% each
to 50% each, and 50/33 = 1.5). That is where the "size each AZ to ~1.5x its share"
rule comes from. Include **scale-out lag**: if boot+warm
is 4 minutes and traffic can double in 2 minutes, you must pre-scale (predictive/
scheduled) or keep warm-pool/standby headroom.

**Cost reasoning.** ELB billing = hourly + usage (ALB LCUs / NLB NLCUs). ASG cost =
instance-hours; blend On-Demand (baseline) + **Spot** (burst, interruption-tolerant)
+ Savings Plans/RIs (steady baseline) via mixed-instances policy. Over-provisioning
for safety costs money every hour; under-provisioning costs availability. Predictive
scaling and warm pools are tools to shrink the safety margin you must pay for.

**Trade-offs.** Scaling on a lagging metric (CPU) under-serves latency-sensitive
apps; scaling on a leading metric (queue depth, request count) is more responsive
but needs a good target value. Tighter targets = better utilization = lower cost but
less burst headroom; looser targets = more headroom = higher cost.

---

## Integration with ECS and EKS

- **ECS**: an ECS **service** registers tasks into an ALB/NLB target group. With
  `awsvpc` networking each task gets an ENI/IP and registers as an **`ip` target**.
  Dynamic host port mapping (bridge mode) lets many tasks share a host on random
  ports, each registered individually — ALB/NLB handle this natively (a CLB cannot).
  Scale tasks with **ECS Service Auto Scaling** (target tracking on
  `ALBRequestCountPerTarget`, CPU, or memory); scale the EC2 capacity with **ECS
  Capacity Providers** (or use Fargate for serverless capacity).
- **EKS**: the **AWS Load Balancer Controller** provisions an ALB for Kubernetes
  **Ingress** and an NLB for **Service type=LoadBalancer**. `ip` target mode routes
  the LB straight to pod IPs (bypassing kube-proxy/node hops) for lower latency;
  `instance` mode targets NodePorts. Scale pods with HPA/KEDA, nodes with Cluster
  Autoscaler or **Karpenter**.

**Trade-offs.** `ip`-mode targeting pods gives lower latency and accurate per-pod
health but couples the LB to pod churn (more registration traffic) and needs enough
VPC IPs; `instance`/NodePort mode is simpler and IP-frugal but adds a hop and
coarser health. For containers you almost always want ALB (L7 ingress) unless you
need NLB's L4/static-IP/latency properties.

---

## CloudFront with ALB, and layering CDN plus load balancing

**CloudFront** is a global CDN + edge network; an **ALB** is a regional L7 LB.
They compose: `Client → CloudFront (edge) → ALB (region) → targets`.

Why put CloudFront in front of an ALB:
- **Cache static/cacheable content at the edge**, offloading the origin and cutting
  latency for global users (TLS terminates at the nearest edge; requests ride the
  AWS backbone to the origin).
- **DDoS/security at the edge**: AWS Shield + WAF on CloudFront absorb attacks
  before they reach the ALB; **origin cloaking** (security group referencing the
  CloudFront managed prefix list, or a shared secret header) forces all traffic
  through CloudFront.
- **TLS/HTTP3** at the edge, connection reuse to origin.
- **Lambda@Edge / CloudFront Functions** for edge logic (auth, redirects, header
  manipulation) close to the user.

When you *don't* need it: purely internal APIs, single-region low-latency users, or
non-cacheable dynamic traffic where the edge adds a hop with little cache benefit
(though edge TLS + backbone routing can still help global latency).

**Global Accelerator vs CloudFront.** For non-HTTP or when you need **static
anycast IPs** and TCP/UDP acceleration to an NLB/ALB (not caching), use **AWS
Global Accelerator**; for cacheable HTTP content use CloudFront. They solve
different problems (content caching vs network path/anycast IP).

**Trade-offs.** CloudFront adds cost (per-request + data out) and a caching layer to
reason about (TTLs, invalidations, cache keys) but massively reduces origin load,
improves global latency, and shifts security to the edge. Skipping it keeps the
architecture simpler and cheaper for regional/dynamic workloads but leaves the ALB
exposed to the full request volume and to L7 attacks at the region.

---

## Failure modes and how the design degrades

- **Single target fails**: health check ejects it after the unhealthy threshold;
  in-flight requests drain; ASG replaces it. Brief elevated latency on the survivors.
- **Entire AZ fails**: that AZ's LB node IPs are pulled from DNS; multi-AZ targets
  in other AZs serve. Requires ≥2 AZs and enough per-AZ capacity (N+1 across AZs).
  If cross-zone is OFF on NLB, surviving AZs must have capacity to absorb the dead
  AZ's share.
- **Region fails**: single-region ELB/ASG can't survive it. Need multi-region
  (Route 53 latency/failover routing, or Global Accelerator) with data replication —
  a much bigger design.
- **Thundering herd / cold scale-out**: a spike outpaces boot time; users see
  latency/errors until new instances warm. Mitigate with warm pools, predictive/
  scheduled scaling, and slow start.
- **Deploy fails health checks**: ASG/instance refresh loops launching and killing;
  min-healthy-percentage and rollback protect you.
- **Deep health check + dependency outage**: if `/healthz` pings a down dependency,
  *all* targets report unhealthy at once; ELB then **fails open** (routes to every
  target regardless of health) rather than dropping traffic — so requests still flow
  but hit targets that all error on the dead dependency. A shallow check avoids
  turning a dependency blip into a fleet-wide "all unhealthy" event.
- **Sticky sessions + scale-in**: draining a pinned target disrupts its users;
  stateless design avoids this.
- **NLB source-IP + security groups**: with client-IP preservation on, targets see
  the **client's** IP, so SG rules that only allow the LB block the traffic — allow the
  client CIDRs instead. (And remember the NLB itself can now carry its own SG.)

---

## Trade-offs and when to use what

**ALB vs NLB (the classic question).**
- ALB when: HTTP(S)/gRPC/WebSocket, path/host routing, WAF/auth, containers,
  Lambda targets, one LB fronting many services. Give up: static IP, source-IP
  preservation, lowest latency.
- NLB when: TCP/UDP/non-HTTP, ultra-low latency, static/Elastic IP for allowlisting,
  source-IP preservation, millions of connections, PrivateLink. Give up: L7 routing,
  WAF, per-request balancing.
- Need both: **NLB → ALB** chain, or **CloudFront/Global Accelerator → ALB**.

**GWLB**: only for transparent inline virtual security appliances; else use Network
Firewall (managed) or host agents.

**CLB**: legacy only — migrate.

**Cross-zone**: ALB (free, always on) — non-issue. NLB — off by default; leave off +
balance AZs to save data-transfer cost, turn on to tolerate skew/AZ imbalance at the
price of inter-AZ transfer.

**Stateless + shared session store** beats sticky sessions for balance, scaling, and
resilience — use stickiness only for legacy stateful apps.

**Scaling policy**: target tracking (default) → add step for aggressive breaches →
scheduled for known cycles → predictive for recurring patterns; warm pools when boot
time threatens SLO. Scale on the **load-leading** metric (request count/queue depth),
not just CPU.

**Compute tier interplay**: EC2+ASG for full control; ECS/EKS for containers (ALB
ingress + service autoscaling); Fargate/Lambda when you want scaling faster than EC2
boot and less ops. The LB choice and the scaling story must match the tier's warm-up
speed and the traffic shape.

---

## Common interview follow-up questions

1. ALB vs NLB — walk me through choosing for (a) a public REST API, (b) a MySQL
   proxy, (c) a UDP game server, (d) an mTLS gRPC service needing a static IP.
2. Why is cross-zone load balancing free on ALB but a paid, off-by-default option on
   NLB, and how does that change your AZ capacity planning?
3. Your fleet scales out but users still see 30 s of errors during spikes — diagnose
   and fix (boot lag, warm pools, predictive scaling, health-check grace).
4. What breaks if you set the deregistration delay to 0? To 3600? For a WebSocket app?
5. When would target tracking on CPU give you the *wrong* answer, and what metric
   would you use instead?
6. How do you give an ALB a static IP for a partner's IP allowlist?
7. A dependency (DB) goes down and suddenly *all* your targets are "unhealthy" and
   the site is fully down — what did the health check do wrong?
8. Design the LB + scaling tier for 250k RPS across 3 AZs with a 4-minute boot time
   and a p99 latency SLO — how much headroom and which policies?
9. When do you add CloudFront in front of an ALB, and when is Global Accelerator the
   right front door instead?
10. How do ECS `awsvpc` tasks and EKS pods register as targets, and why prefer
    `ip`-target mode?
11. Why are sticky sessions considered an anti-pattern, and what's the alternative?
12. How does GWLB insert a firewall fleet transparently, and what protocol/port does
    it use?

---

## References

- AWS docs — Elastic Load Balancing: User Guide, and the Application, Network,
  Gateway, and Classic Load Balancer developer guides (target groups, health checks,
  cross-zone load balancing, sticky sessions, target group attributes). The ALB
  target-group health-checks guide documents the **fail-open** rule: if a target
  group contains only unhealthy targets the LB routes to all of them regardless of
  status.
- AWS docs — Product comparison for Elastic Load Balancing (ALB vs NLB vs GWLB vs CLB
  feature matrix).
- AWS docs — Amazon EC2 Auto Scaling User Guide: scaling policies (target tracking,
  step, simple, scheduled, predictive), cooldowns and warm-up, warm pools, lifecycle
  hooks, health checks and grace period. "How predictive scaling works" states the
  **24 h minimum** history to start forecasting, analysis of up to the **past 14
  days**, and an hourly forecast for the next 48 h refreshed every 6 h.
- AWS docs — Gateway Load Balancer and GENEVE (UDP 6081), Gateway Load Balancer
  endpoints.
- AWS docs — AWS Global Accelerator, Amazon CloudFront developer guide (CloudFront +
  ALB origins, Shield/WAF at the edge).
- AWS docs — ECS Service Load Balancing and Service Auto Scaling; EKS AWS Load
  Balancer Controller (ALB Ingress / NLB Service, ip vs instance target modes).
- AWS Well-Architected Framework — Reliability and Performance Efficiency pillars
  (multi-AZ, elasticity, workload right-sizing).
- AWS Builders' Library — "Workload isolation using shuffle sharding" and load
  balancing / health-check articles (health check depth, fail-open behavior).
- re:Invent deep-dive sessions on Elastic Load Balancing and EC2 Auto Scaling
  (NET/CMP 300–400 level).
