# Redundancy, Failover & Health Checks

Redundancy, failover, and health checks are the three legs of **fault tolerance**: you
provision *more than one* of everything critical (redundancy), you *detect* when a component
is unhealthy and route around it (health checks + failure detection), and you *promote* a
survivor to take over the failed component's role (failover). Get the interplay right and a
single dead node is a non-event; get it wrong and the failover machinery itself becomes the
outage — a split-brain, a health-check death spiral, or a cascading failure triggered by a
"deep" health check.

This topic owns the **operational patterns**: eliminating single points of failure (SPOFs),
standby models and their cost/RTO trade-offs, safe failover (quorum/fencing to avoid
split-brain), and the correct design of liveness/readiness and shallow/deep health checks.
For **Kubernetes probe configuration** see `kubernetes` (probes); for the **theoretical
failure trade-offs, CAP, and multi-region DR architecture** see `system-design`; for
**RPO/RTO tiers and DR strategies** see `reliability-ops/disaster-recovery-rpo-rto-strategies`;
for **retries/timeouts** that ride on top of failover see
`reliability-ops/retries-timeouts-and-backoff`.

> [!KEY-TAKEAWAY]
> Redundancy only helps if failover is **automatic, fast, and safe**. The three failure
> modes that turn "highly available" designs into outages are: (1) **correlated failure** —
> your "redundant" replicas share a failure domain (same rack/AZ/power/dependency) and die
> together; (2) **split-brain** — automatic failover promotes a second primary while the
> first is still alive, corrupting data — prevented by **quorum** and **fencing/STONITH**;
> (3) **health-check death spiral** — an over-eager or *deep* health check marks healthy
> nodes as failed under load and removes capacity, accelerating the collapse.

---

## Single points of failure (SPOF)

A **single point of failure** is any component whose failure takes down the whole system
because there is no redundant path around it. Eliminating SPOFs is the first-principles goal
of high-availability design: for every critical component ask "what happens if exactly this
one thing dies?" and ensure the answer is "traffic continues on a redundant peer."

Classic hidden SPOFs interviewers probe for:

- **The load balancer itself** (redundant app servers behind one LB) — needs a redundant LB
  pair or anycast/DNS-level failover.
- **A single database primary** — needs replicas + failover, or the writer is a SPOF.
- **Shared state**: one Redis, one config server, one message broker, one NAT gateway.
- **The control/coordination plane**: DNS, service discovery, secrets manager, a single
  Kubernetes API server.
- **Correlated dependencies**: all replicas in one AZ, on one power feed, one network switch,
  or depending on one downstream service (a *dependency* SPOF).
- **People/process**: one engineer who knows how to fail over, one manual runbook step.

The **availability math** shows why redundancy helps. For components **in series** (all must
work), availabilities multiply:

```
A_series = A1 × A2 × ... × An
```

Two 99.9% components in series → 0.999 × 0.999 ≈ **99.8%** (worse than either alone). For
**redundant** (parallel) components where any one suffices, you multiply the *failure*
probabilities:

```
A_parallel = 1 − (1 − A1)(1 − A2) ... (1 − An)
```

Two 99% nodes in parallel → 1 − (0.01)(0.01) = **99.99%**. Redundancy converts a component's
unavailability *q* into *q²* (roughly) — the classic reason two cheap nodes beat one gold-plated
one. **Caveat:** this assumes *independent* failures. If both replicas share a failure domain,
the real correlated-failure probability dominates and the q² math is a lie.

> [!WARNING]
> "We have three replicas" means nothing if all three are in the same AZ, on the same rack,
> or all call the same downstream dependency. Redundancy is only as good as the
> **independence** of the failure domains. Always ask: *what is the shared fate?*

---

## Redundancy: N, N+1, N+2, 2N

Redundancy sizing describes how much spare capacity you provision beyond the minimum needed
to serve peak load. Let **N** = the number of units required to carry full load.

| Model | Meaning | Survives | Cost overhead | Typical use |
|---|---|---|---|---|
| **N** | Exactly enough, no spare | 0 failures | 0% | Non-critical / dev |
| **N+1** | One spare beyond need | 1 concurrent failure | ~1/N extra | Most production services |
| **N+2** | Two spares | 2 concurrent failures (or 1 failure *during* maintenance) | ~2/N extra | Critical infra, power/cooling |
| **2N** | Full duplicate set | Loss of an entire set | 100% | Data centers, active-active regions |
| **2N+1** | Duplicate set plus one | A set failure + one more | >100% | Highest-tier facilities |

**N+1** is the workhorse: it tolerates one unit failing *and* lets you take one unit down for
patching without dropping below N. A subtle interview point: with N+1 you must be able to
survive a failure **while** a unit is already out for maintenance — which is why highly
critical systems go **N+2** (so a failure during a maintenance window still leaves N running).

Redundancy must span **failure domains** at the right granularity, cheapest/tightest first:

- **Host / process** — multiple instances (restart on crash).
- **Rack** — spread across racks (a rack shares a switch + power strip).
- **Availability Zone (AZ)** — independent power, cooling, network within a region; the
  standard blast-radius boundary in cloud. Spread replicas across ≥2–3 AZs.
- **Region** — geographically distinct; survives a whole-region outage but adds latency and
  data-replication complexity (see `system-design` for multi-region and
  `reliability-ops/disaster-recovery-rpo-rto-strategies`).

The rule: **place redundant copies in different failure domains** so no single domain event
takes out a quorum.

---

## Active-active vs active-passive (standby models)

The two fundamental redundancy topologies:

- **Active-active**: all replicas serve traffic simultaneously; load is shared. A failure
  just removes one contributor and the survivors absorb its share. Failover is near-instant
  (it's just load rebalancing), but you must run with enough headroom that the survivors can
  take the extra load, and you need conflict handling for writes (multi-primary databases,
  CRDTs, or partitioned ownership).
- **Active-passive (standby)**: one active (primary) serves; one or more standbys wait and
  take over on failure. Simpler consistency (single writer) but wastes the idle capacity and
  failover takes time to detect + promote.

Standbys come in three "temperatures", trading **cost** against **failover time (RTO)**:

| Standby | State | Failover time | Cost | Notes |
|---|---|---|---|---|
| **Hot** | Running, data continuously replicated, ready to serve instantly | Seconds | High (near-2N) | Often synchronous replication; smallest data loss |
| **Warm** | Running but scaled-down / not serving; data replicated (may lag) | Seconds→minutes | Medium | Scale up on promotion |
| **Cold** | Not running; must be provisioned/restored from backup | Minutes→hours | Low | Cheapest; largest RPO/RTO |

This is the same spectrum as DR strategies (backup-restore ≈ cold, pilot-light ≈ warm-ish,
warm-standby ≈ warm, multi-site active-active ≈ hot) — see
`reliability-ops/disaster-recovery-rpo-rto-strategies` for the RPO/RTO numbers.

```mermaid
flowchart LR
    subgraph AA[Active-Active]
      C1[Client] --> LB1[LB]
      LB1 --> A1[Node A serving]
      LB1 --> A2[Node B serving]
    end
    subgraph AP[Active-Passive]
      C2[Client] --> LB2[LB]
      LB2 --> P[Primary serving]
      P -. replicate .-> S[Standby idle]
    end
```

> [!TIP]
> Active-active's hidden trap is **capacity**: if two nodes each run at 60% and one dies, the
> survivor needs 120% — it can't. For N-node active-active surviving one failure, the (N−1)
> survivors must absorb all the load, so keep each node under **`(N−1)/N`** utilization
> (2 nodes → 50%, 3 → 67%, 4 → 75%). To survive `k` simultaneous failures, keep each node
> under `(N−k)/N`.

---

## Failover: automatic vs manual, and failback

**Failover** is the act of promoting a standby (or shifting traffic to survivors) when the
active component fails. **Failback** is the (optional) return to the original once it recovers.

- **Automatic failover**: a detector (health check, heartbeat loss, quorum vote) triggers
  promotion with no human. Pros: fast RTO (seconds). Cons: risk of *false positives* (a
  transient network blip triggers an unnecessary, disruptive failover) and *split-brain* if
  the "failed" primary is actually alive. Requires fencing + quorum to be safe.
- **Manual failover**: a human confirms the failure and executes (or approves) the promotion.
  Pros: no false-positive flapping, human judgment. Cons: slow RTO (minutes, gated by paging
  + human response), and the runbook step itself can be a SPOF at 3 a.m.

The judgment call: **automate failover for well-understood, frequent, low-blast-radius
failures** (a stateless app instance); **keep a human in the loop for high-blast-radius,
data-bearing, or ambiguous failures** (promoting a database primary across regions) where a
wrong automatic decision can cause data loss. Many mature systems use *automatic detection +
one-click human confirmation*.

**Failback caution:** returning to the original primary is a *second* failover event with its
own risk. Don't fail back automatically the instant the old node reappears — it may still be
partially broken, its data may be stale, and an auto-failback can flap. Prefer manual,
verified failback after confirming the recovered node is fully caught up.

> [!WARNING]
> The most dangerous failovers are **flapping** ones. If detection is too twitchy, a brief
> latency spike triggers failover, the promotion causes a load spike, that trips the health
> check on the new primary, and it fails back — oscillating. Use hysteresis: require *N
> consecutive* failed checks to fail over, dampen with a cooldown, and never auto-failback.

---

## Split-brain, quorum, and fencing/STONITH

**Split-brain** is the catastrophic failure mode of automatic failover: a network partition
makes the standby *believe* the primary is dead, so it promotes itself — but the original
primary is still alive and accepting writes. Now **two primaries** accept conflicting writes
to the same data, causing divergence and corruption that is extremely hard to reconcile.

Root cause: you **cannot distinguish** "the primary is dead" from "I can't reach the primary"
(a partition) using timeouts alone. The two look identical to a detector.

Three mechanisms prevent split-brain, usually combined:

1. **Quorum (majority voting).** Only a partition holding a **strict majority** (`⌊n/2⌋ + 1`)
   of nodes may elect a leader / accept writes. The minority side refuses to act, so at most
   one side is ever active. This is why clusters use an **odd number** of nodes (3, 5, 7): an
   even count can split 2–2 with no majority. Quorum tolerates `⌊(n−1)/2⌋` failures — 3 nodes
   tolerate 1, 5 tolerate 2. (Consensus protocols Raft/Paxos are owned by `system-design`;
   here it's the anti-split-brain tool.)
2. **Fencing.** Before a standby takes over a resource, the old primary is *forcibly cut off*
   so it cannot keep writing — e.g. revoking its access to shared storage, blocking its
   network path, or **STONITH** ("Shoot The Other Node In The Head"): the takeover node
   power-cycles/kills the old node (via IPMI/power controller) *before* promoting itself.
   Fencing guarantees the old primary is truly gone, not just unreachable.
3. **A tie-breaker / witness.** In a 2-node setup add a lightweight third **witness** (or a
   shared "quorum disk") so a partition always has a majority side. Prevents the 1–1 split.

```mermaid
stateDiagram-v2
    [*] --> Primary
    Primary --> SuspectedDead: heartbeat lost
    SuspectedDead --> QuorumCheck: standby asks for votes
    QuorumCheck --> Fencing: has majority
    QuorumCheck --> StayStandby: no majority (minority side)
    Fencing --> NewPrimary: old node fenced/STONITH
    StayStandby --> Primary: heartbeat returns
    NewPrimary --> [*]
```

> [!INTERVIEW]
> "How do you prevent split-brain in automatic failover?" The staff-level answer names all
> three: **quorum** so only a majority partition can promote, **fencing/STONITH** so the old
> primary is physically prevented from writing before the new one starts, and an **odd node
> count / witness** so partitions always have a decisive majority. Timeouts alone can never
> distinguish "dead" from "unreachable."

---

## Liveness vs readiness health checks

Health checks answer two *different* questions, and conflating them is a common bug (see
`kubernetes` for probe syntax; this is the reliability semantics):

- **Liveness** = "Is this process broken beyond recovery? **Restart me if so.**" A failed
  liveness check triggers a **restart/replace** of the instance. Use it for deadlocks,
  unrecoverable state, wedged event loops. It must check *only* the process itself.
- **Readiness** = "Am I ready to serve traffic **right now**? If not, **stop sending me
  requests** (but don't kill me)." A failed readiness check **removes the instance from the
  load-balancer pool** without restarting it. Use it during startup (warming caches, JIT,
  loading models), during graceful shutdown, or when a *local* dependency is briefly
  unavailable and will recover.

| | Liveness | Readiness |
|---|---|---|
| Question | Is the process dead? | Can I serve traffic now? |
| Action on failure | **Restart** the instance | **Remove from LB pool** (keep running) |
| Failure during startup | ❌ crash-loop if too eager | ✅ correct — not ready yet |
| Should check dependencies? | **No** (restart won't fix a downstream) | Cautiously (see deep-check anti-pattern) |

The classic bug: making the **liveness** probe check a downstream dependency. When that
dependency has a blip, liveness fails, Kubernetes/orchestrator *restarts* the pod — but the
restart doesn't fix the downstream, so every pod crash-loops and you lose the whole service
to a problem that was only a minor dependency hiccup. **Liveness must never depend on
anything but the process itself.**

> [!TIP]
> Rule of thumb: **liveness = only local, cheap, "am I wedged" checks**; **readiness = "should
> I get traffic"** and may consider *local* resources. Startup latency belongs to a separate
> **startup probe** (Kubernetes) so a slow boot doesn't trip liveness. When in doubt, prefer
> readiness over liveness — pulling from the pool is reversible, restarting is not.

---

## Shallow vs deep health checks (the deep-check anti-pattern)

A **shallow** health check verifies only that the local process responds (e.g. `/healthz`
returns 200, the HTTP server accepts a connection, an in-process flag is green). A **deep**
health check additionally probes the instance's **dependencies** — database, cache,
downstream services — and reports unhealthy if any are unreachable.

Deep checks *sound* better ("report unhealthy if you can't actually do your job") but carry a
notorious **cascading-failure anti-pattern**:

> If every instance runs a **deep** health check against a **shared** dependency, then a brief
> blip in that shared dependency makes **every** instance report unhealthy **simultaneously**.
> The load balancer then removes **all** of them, and a minor dependency hiccup becomes a
> **total, correlated outage** — even though the instances themselves were fine and could have
> served cached/degraded responses.

This is worse than doing nothing: without the deep check, a transient DB blip would recover on
its own; *with* it, the LB tears down the entire fleet in seconds.

Guidance (from AWS/Google SRE practice):

- Keep the **load-balancer** health check **shallow** (liveness-style) so a shared-dependency
  blip can't empty the entire pool at once.
- If you use deep checks, do them **out of band** (a separate monitor/alarm that a human or a
  slow controller reacts to), **not** wired directly to the LB's remove-from-pool decision.
- Prefer **fail-open / degraded** behavior: if a dependency is down, keep serving what you can
  (see `reliability-ops/graceful-degradation-and-fallbacks`) rather than declaring yourself
  dead.
- Use **health-check dependency isolation**: don't let a *non-critical* dependency's health
  affect your served-traffic health at all.

---

## Health-check-driven LB removal and the death spiral

Load balancers continuously health-check their backends and **remove** any that fail,
routing only to healthy ones. This is the core mechanism that makes redundancy *automatic* —
but it has a dangerous positive-feedback loop under load: the **health-check death spiral**
(a.k.a. health-check-induced cascading failure).

The spiral:

```mermaid
flowchart TD
    A[Fleet near capacity, latency rising] --> B[Health checks time out on some nodes]
    B --> C[LB removes those nodes from pool]
    C --> D[Same total load, fewer nodes]
    D --> E[Surviving nodes even more overloaded]
    E --> F[Their health checks now time out too]
    F --> C
    F --> G[Cascade: entire fleet marked unhealthy, total outage]
```

Under high load, response times rise; the health check (which shares the same overloaded
threads/CPU) starts timing out; the LB removes those nodes; the *same* load now hits *fewer*
nodes, pushing them over the edge; their checks fail; and the fleet collapses to zero — even
though every node was actually still (barely) serving real traffic.

Mitigations:

- **Fail-open at the LB**: if *too many* backends (e.g. >X%) simultaneously report unhealthy,
  the LB should **stop removing them and route to all** — assume the health check, not the
  fleet, is wrong. (AWS ELB does this; it's a key defense.)
- Give health checks a **separate, reserved resource path** (dedicated thread/connection) and
  a **generous timeout** so a busy-but-healthy node isn't misjudged as dead.
- **Prioritize** health-check requests, or shed *real* load before health checks fail (see
  `reliability-ops/load-shedding-and-backpressure`).
- Require **multiple consecutive failures** before removal (hysteresis) and cap the removal
  rate so you can't drop the whole pool at once.

> [!WARNING]
> Aggressive health checking is a leading cause of **correlated, self-inflicted** outages. The
> counterintuitive lesson from large-scale operators: when nearly everything looks unhealthy
> at once, **trust the fleet over the health check** and fail open. See
> `reliability-ops/cascading-failures-and-antipatterns`.

---

## Heartbeats and failure detection

Failure detection is how one node concludes another has failed. The universal building block
is the **heartbeat**: a node periodically sends "I'm alive" pings; if none arrives within a
timeout, it's suspected dead. Two families:

- **Fixed-timeout detection**: declare a node dead after `T` ms of silence. Simple, but forces
  a hard **trade-off**: a *short* timeout gives fast detection but many **false positives**
  (a GC pause or brief network jitter looks like death, triggering needless failover); a
  *long* timeout is robust but **slow to detect** real failures (longer outage). You can't win
  both with a static threshold.
- **Phi-accrual (φ) failure detection** (Cassandra, Akka): instead of a boolean dead/alive,
  it outputs a **suspicion level φ** computed from the *statistical distribution* of recent
  heartbeat inter-arrival times. φ rises as silence exceeds the historically-normal gap. The
  app picks a threshold (e.g. φ=8) meaning "the probability I'm wrong about this being dead is
  ~10⁻⁸." Its value: it **adapts** to actual network conditions — a normally-jittery link
  gets more slack automatically, reducing false positives without hard-coding a timeout.

Key tunables: **heartbeat interval** (how often), **detection timeout / φ threshold** (how
patient), and whether detection is **direct** (each watches each) or via **gossip/SWIM** (nodes
share suspicion, scales to large clusters). Failure detection feeds the *inputs* to failover —
which is why a too-sensitive detector produces flapping (see the failover section).

> [!KEY-TAKEAWAY]
> Every failure detector trades **detection speed** against **false-positive rate** — you
> cannot maximize both. Fixed timeouts pick one point on that curve; **phi-accrual makes the
> point adaptive** to observed latency, which is why large distributed systems prefer it.

---

## Graceful shutdown and connection draining

When an instance is intentionally removed (deploy, scale-in, node drain), killing it abruptly
drops **in-flight requests** and can corrupt state. **Graceful shutdown** lets it finish work
and leave the pool cleanly. The canonical sequence on Linux/Kubernetes:

1. The orchestrator sends **`SIGTERM`** (a polite "please stop") — *not* `SIGKILL`.
2. The app's SIGTERM handler flips **readiness to failing** so the LB/service stops sending
   *new* requests (this is why readiness, not liveness, governs draining).
3. **Drain**: stop accepting new connections but **let in-flight requests complete** (bounded
   by a drain deadline). Finish or checkpoint background work, flush buffers, close DB
   connections, deregister from service discovery.
4. Exit cleanly. If the app hasn't exited by the **grace period** (Kubernetes default
   `terminationGracePeriodSeconds` = **30s**), the orchestrator sends **`SIGKILL`** and forces
   it down — losing whatever was still in flight.

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant A as App instance
    participant LB as Load balancer
    O->>A: SIGTERM
    A->>LB: readiness = NOT ready (stop new traffic)
    Note over A: finish in-flight requests, flush, close conns
    A->>O: process exits (within grace period)
    Note over O,A: if not exited by grace period -> SIGKILL
```

Pitfalls interviewers look for:

- **Race between SIGTERM and LB de-registration.** The LB may still route to the pod for a
  short window after SIGTERM (its health-check cache is stale). Best practice: on SIGTERM,
  fail readiness and **sleep briefly** (a `preStop` hook) *before* closing the listener, so
  the LB observes "unready" and drains you before you stop accepting connections. Otherwise
  clients get connection-refused errors during every deploy.
- **Ignoring SIGTERM entirely** (common in shell-wrapped or PID-1 apps that don't forward
  signals) — the app gets `SIGKILL`ed after the grace period every time, dropping requests on
  each deploy.
- **Grace period shorter than the longest request** — long requests get killed. Size the grace
  period to your p99 request duration (and drain deadline).

> [!TIP]
> The single highest-value graceful-shutdown practice: **on SIGTERM, fail readiness first and
> pause before closing the socket.** This closes the LB-drain race and turns rolling deploys
> from a source of 5xx spikes into a non-event.

---

## Common Interview Follow-ups

- **"You have three DB replicas across two AZs. Where's the risk?"** Two share an AZ — an AZ
  outage kills two of three, and if that's your quorum you lose write availability. Spread
  across three AZs, or the "redundancy" is partly illusory (correlated failure domain).
- **"Automatic or manual failover for the database primary?"** Automatic detection is fine, but
  gate promotion carefully: use quorum + fencing to avoid split-brain; consider human
  confirmation because a wrong auto-promotion across regions can lose committed writes. Never
  auto-failback.
- **"Why not just make the health check check the database?"** That's a deep check on a shared
  dependency — a DB blip marks the whole fleet unhealthy at once and the LB removes everyone,
  turning a minor blip into a total outage. Keep LB checks shallow; monitor the DB out of band.
- **"Your fleet went to zero healthy during a load spike but the boxes were fine — what
  happened?"** Health-check death spiral: overload made checks time out, LB removed nodes,
  concentrating load and collapsing the rest. Fix with fail-open, reserved health-check
  resources, hysteresis, and load shedding.
- **"Why an odd number of nodes in a cluster?"** So a network partition always has a strict
  majority (quorum) on one side; an even count can split evenly with no majority, and nobody
  can safely act. 3 nodes tolerate 1 failure, 5 tolerate 2.
- **"What's STONITH and when do you need it?"** "Shoot The Other Node In The Head" — forcibly
  power off/fence the old primary before promoting a new one, so a still-alive-but-unreachable
  primary can't keep writing (prevents split-brain). Needed whenever two nodes could both
  believe they own a shared resource.
- **"Liveness vs readiness in one sentence?"** Liveness failure ⇒ *restart me*; readiness
  failure ⇒ *stop sending me traffic but leave me running*. Never make liveness depend on a
  downstream.
- **"What does SIGTERM do and why sleep before closing?"** SIGTERM asks the app to shut down
  gracefully; you fail readiness and pause so the LB drains you before you stop accepting
  connections, avoiding connection-refused errors during deploys; SIGKILL follows if you don't
  exit by the grace period (K8s default 30s).

## References

- Beyer, Jones, Petoff, Murphy (eds.), *Site Reliability Engineering* (Google, O'Reilly,
  2016) — Ch. 21–22 (handling overload, cascading failures), health checking and load
  balancing.
- Beyer et al., *The Site Reliability Workbook* (Google, O'Reilly, 2018) — canarying,
  load balancing, and managing overload.
- Michael T. Nygard, *Release It!* (2nd ed., Pragmatic Bookshelf, 2018) — stability patterns,
  failing fast, and the dangers of health checks under load.
- AWS Well-Architected Framework — **Reliability Pillar** (fault isolation boundaries,
  redundancy, health checks, automatic vs manual failover).
- AWS Builders' Library — "Implementing health checks" (Colm MacCárthaigh) — shallow vs deep
  checks, fail-open, and health-check death spirals.
- Hayashibara et al., "The φ Accrual Failure Detector" (2004) — adaptive failure detection.
- Kubernetes documentation — liveness, readiness, and startup probes; `terminationGracePeriodSeconds`,
  `preStop` hooks (see `kubernetes` topic).
- Cross-references: `reliability-ops/disaster-recovery-rpo-rto-strategies` (RPO/RTO tiers),
  `reliability-ops/cascading-failures-and-antipatterns`,
  `reliability-ops/load-shedding-and-backpressure`, `system-design` (CAP, consensus,
  multi-region), `kubernetes` (probes).
