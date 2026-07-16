# Failure Theory: Metastable Failures, Retry Storms and Load Shedding

This topic is about *why large systems collapse and stay collapsed* — and the
small set of mechanisms that prevent, contain, and reverse that collapse. The
central, non-obvious idea is that **the trigger that starts an outage is often
not what keeps it going.** A load spike, a deploy, a slow disk — these are
transient. Yet the system stays down for hours after the trigger is gone,
because a *feedback loop* now sustains the bad state. That is a **metastable
failure**, and it is the dominant failure mode of mature, well-provisioned
systems. Understanding it changes how you design retries, timeouts, queues, and
capacity headroom.

A mental model to carry throughout:

> **A healthy system dissipates load; a metastable system amplifies it.** Every
> mechanism below either (a) prevents work from being amplified (backoff, retry
> budgets, circuit breakers), (b) sheds work faster than it arrives so the queue
> drains (load shedding, bounded queues, LIFO), or (c) removes the dependency on
> a fragile control plane in the hot path (static stability). Naming *which of
> these three levers* a technique pulls is the senior signal in an interview.

Numbers to anchor intuition: at a p99 of 100 ms, 1 request in 100 is slow; a
page that fans out to 100 backends will, on average, have **~63% of requests hit
at least one slow backend** (1 − 0.99^100). Tail latency is not an edge case at
fan-out; it is the common case. This is the core lesson of *The Tail at Scale*.

---

## Failure taxonomy, crash, omission, timing, Byzantine, gray and partial

**Intuition.** Before you can tolerate a failure you must name it, because the
tolerance mechanism differs by class. The classic hierarchy (from the
distributed-systems literature, e.g. Cristian, Schneider) orders failure models
from easiest to hardest to mask:

| Model | What a process does | Detectable by | Example |
|---|---|---|---|
| **Crash (fail-stop)** | Halts, never sends wrong output; ideally others learn it stopped | Timeouts, heartbeats | Process killed, host powers off |
| **Omission** | Drops some messages (send/receive omission) but is otherwise correct | Sequence numbers, acks | Dropped packets, full queue silently discards |
| **Timing (performance)** | Correct value, but too late (or too early) | Deadlines, timeouts | GC pause, slow disk, a "gray" slow node |
| **Byzantine (arbitrary)** | Any behavior: wrong values, lies, different answers to different peers | Cryptographic signatures, 3f+1 voting (BFT) | Corrupted memory, malicious node, firmware bug |

The models are **nested**: crash ⊂ omission ⊂ timing ⊂ Byzantine. A protocol
that tolerates Byzantine faults tolerates all weaker ones, but at far higher
cost (BFT needs **3f+1** replicas to tolerate f faults and multiple message
rounds; crash-tolerant consensus like Raft/Paxos needs only **2f+1**). Most
production systems deliberately assume **crash + omission + timing** and use
checksums/TLS to *reduce* (not fully handle) Byzantine risk — full BFT is
reserved for blockchains and a few critical control planes because the cost is
rarely justified inside a trusted datacenter.

**The hardest class: gray failures and partial failures.** The taxonomy above is
clean; reality is not. The failures that cause the worst outages are the ones
that *aren't* fail-stop:

- **Gray failure** (Huang et al., "Gray Failure: The Achilles' Heel of
  Cloud-Scale Systems"): the system is *degraded but not down* — 5% packet loss,
  a disk doing 200 ms I/O instead of 2 ms, a node at 99% CPU. The dangerous part
  is **differential observability**: the failing component's own health check
  says "healthy" (it can still answer a ping), while its clients see high latency
  and errors. Fail-stop detection (heartbeats) completely misses this. This is
  why load balancers that only check "is the port open?" happily route traffic
  to a brownout node.
- **Partial failure** (Waldo et al., "A Note on Distributed Computing"): part of
  a distributed operation succeeds and part fails, and you often **cannot tell
  which** — a timeout is ambiguous: did the request not arrive, arrive-but-not-
  process, or process-but-the-response-was-lost? This ambiguity is *the* reason
  retries need idempotency and why exactly-once delivery is impossible (you get
  at-least-once + idempotency = effectively-once).

**Trade-offs / what breaks first.** The subtle failure is always the expensive
one. A crashed node is *easy* — it's removed from the pool and traffic reroutes.
A gray node is *lethal* because it stays in the pool, absorbs requests, times
them out, and triggers retries — turning one slow node into system-wide retry
amplification. Senior design lesson: **health checks must be from the client's
perspective (outlier detection, latency-based ejection), not the server's
self-report.** Envoy/Istio "outlier detection" and AWS "minimal healthy host"
patterns exist precisely because self-reported health misses gray failure.

---

## Metastable failures and feedback loops

**Intuition and definition.** A **metastable failure** (Bronson et al., HotOS
2021, "Metastable Failures in Distributed Systems"; and the follow-up OSDI/CACM
work) is a *sustained* bad state that persists **even after the triggering event
is removed**, because a feedback loop keeps the system in that state. Formally:
the system has two stable-ish regimes — a **stable** state (good) and a
**metastable** state (bad) — separated by a barrier. A trigger pushes it over
the barrier; a **sustaining effect** (positive feedback) then holds it there.
Removing the trigger does *not* recover it, because the sustaining effect is
self-reinforcing. You need an external intervention (drop load, drain, flush,
restart) to push it back over the barrier.

```
throughput ^
  goodput   |        stable state (work in ~= work out)
            |      /``````````````\
            |     /                \  <- capacity cliff
            |    /                  \______________  metastable:
            |   /                     high load, near-zero goodput
            +--/--------------------------------------> offered load
               trigger pushes past the cliff; feedback keeps it there
```

**Mechanism: the sustaining feedback loop.** The trigger and the sustaining
effect are usually *different* things:

- **Retry storm (the canonical example).** Trigger: brief latency spike →
  timeouts fire → clients retry → retries add load → more timeouts → more
  retries. The *work amplification* (retries) is the sustaining effect. Even
  after the original slowness ends, the retry-generated load alone keeps latency
  above the timeout threshold. **Goodput collapses to near zero while the system
  is 100% busy doing doomed work.**
- **Cache-empty thundering / thundering herd.** Trigger: cache flush or cold
  restart → all requests miss → they stampede the database → DB slows → cache
  fills slowly or not at all → misses continue. The empty cache is sustained
  because the DB is now too slow to serve the fills. Facebook/Meta documented
  exactly this class.
- **GC / memory death spiral.** Trigger: load bump → more allocation → more
  frequent GC → GC steals CPU → requests slow → queue grows → more live objects
  retained → more GC. The heap pressure sustains itself.
- **Look-aside cache + retries** compound: a miss storm plus a retry policy can
  multiply load 3–5× at exactly the moment the datastore is weakest.

**Why "well-provisioned" systems are the most vulnerable.** Counterintuitively,
adding capacity can *increase* metastability risk. More headroom means the
system runs happily closer to a cliff you can't see, and the amplification
factor (e.g., retries) is a *multiplier* — the more normal traffic there is, the
larger the absolute retry surge when the trigger hits. Bronson's key insight:
the **gap between the load that triggers the problem and the load required to
sustain it** is what makes it metastable. If sustaining load < trigger load, a
transient blip becomes a permanent outage.

**How to break a metastable failure (ranked by effectiveness):**

1. **Shed load hard** — drop enough requests that work-in < capacity so the
   queue drains. Half-measures don't work; you must get *below* the sustaining
   threshold, not just below the trigger threshold.
2. **Kill the amplification** — disable/curtail retries (retry budgets, circuit
   breakers open), clamp fan-out.
3. **Break the loop physically** — flush the retry queue, restart to clear
   backlog, serve stale/degraded responses to relieve the datastore.
4. **Add headroom preventively** — run at lower utilization so the barrier is
   farther away; but this is prevention, not recovery.

**Trade-offs.** Load shedding sacrifices some availability *now* to preserve
goodput for the rest; the alternative (do nothing) sacrifices *all* availability.
The hard part operationally: metastable states often *look* like a capacity
problem, so the instinct is to **add capacity or restart clients** — but adding
capacity mid-storm can just feed the amplifier, and telling clients to retry is
pouring fuel on the fire. The correct move is almost always *reduce* work.

---

## Retry amplification math and retry budgets

**The core math.** Retries are load multipliers applied at the worst possible
moment. If every layer retries up to `r` times (r attempts total, i.e. 1 try +
(r−1) retries), and there are `L` layers of services calling each other, the
worst-case load multiplication at the bottom layer is:

```
amplification = r ^ L
```

Example: an edge service, a middle service, and a data service each configured
with 3 attempts on failure → **3 × 3 × 3 = 27×** load on the datastore during a
partial failure. This is why the rule is **retry at ONE layer only** (usually the
one closest to the client that can still meet the deadline), and pass a
"do-not-retry" / deadline signal down so lower layers don't independently retry.

Even at a single layer, retries raise steady-state load. If a fraction `f` of
requests fail and each is retried once, offered load = `1 + f`. Under a partial
outage where `f → 0.5`, you've added **50% load precisely when the system is
already failing** — often enough to keep it failing.

**Retry budgets (the fix).** Instead of "retry N times per request," cap retries
as a **fraction of total requests** over a window — e.g., "retries may not exceed
10% of successful requests." Implemented as a **token bucket**: each attempt
tries to take a token; a successful request refills tokens. Under a broad outage
the bucket empties and retries stop automatically, capping amplification at
**1 + budget (e.g., 1.1×)** no matter how many requests fail. This is how gRPC
(retryThrottling), Finagle, Envoy, and Google's internal RPC stacks bound retry
load. Contrast:

| Policy | Amplification under total outage | Behavior |
|---|---|---|
| Fixed N attempts | up to N× (per layer; N^L across layers) | Worst — amplifies exactly when weakest |
| Per-request budget only | still N× if all requests fail | Insufficient alone |
| **Token-bucket retry budget** | **1 + budget (e.g., 1.1×)** | Self-disabling under broad failure |
| Circuit breaker (open) | → 0 (fails fast) | Stops all calls; blunter |

**When to retry at all.** Retries only help for **transient, independent,
uncorrelated** failures (a dropped packet, one bad host). They are *harmful* for
**correlated / overload** failures — if the dependency is down because it's
overloaded, retrying makes the overload worse. Also: **only retry idempotent
operations** (or requests carrying an idempotency key), because a timeout is
ambiguous (the first attempt may have succeeded). And **never retry a
non-retryable error** (400, 404, auth failure) — it will never succeed and just
burns budget. AWS Builders' Library: retries are "selfish" — good for the one
client, bad for the fleet — which is exactly why they need a fleet-wide budget.

---

## Exponential backoff and jitter

**Intuition.** If you must retry, *when* you retry matters as much as *whether*.
Constant-interval retries from many clients synchronize into periodic load
spikes (a **thundering herd**). Exponential backoff spreads them out in time;
**jitter** (randomization) de-correlates them so they don't re-cluster.

**Exponential backoff.** Wait `base × 2^attempt` (capped at a max). This
geometrically reduces retry pressure over time and gives the dependency room to
recover. But pure exponential backoff has a flaw: if 10,000 clients all fail at
t=0, they *all* wait exactly `base`, then all wait `2×base` — they retry in
**synchronized waves**. Backoff alone reduces average rate but preserves the
spike.

**Jitter — the variants** (from Marc Brooker's AWS post "Exponential Backoff and
Jitter"):

```
No jitter:     sleep = min(cap, base * 2^attempt)
Full jitter:   sleep = random(0, min(cap, base * 2^attempt))
Equal jitter:  temp = min(cap, base * 2^attempt);
               sleep = temp/2 + random(0, temp/2)
Decorrelated:  sleep = min(cap, random(base, sleep_prev * 3))
```

| Variant | Spread | Client-side "clumping" | Notes |
|---|---|---|---|
| No jitter | none | Severe synchronized waves | Never use at scale |
| **Full jitter** | 0..cap | Best de-synchronization | Fewest total calls in Brooker's sims; recommended default |
| Equal jitter | half fixed + half random | Guarantees a minimum wait | Slightly more predictable, slightly more calls |
| **Decorrelated jitter** | grows from last sleep | Good spread + climbs fast | Great when you want backoff to increase without a per-attempt counter |

**Key results from the simulations:** *full jitter* and *decorrelated jitter*
both dramatically cut the number of competing calls and total completion time vs
no jitter; full jitter minimized total work. The counterintuitive takeaway:
**adding randomness (which feels like giving up control) reduces total load and
finishes faster.** The reason is that de-synchronization prevents the spikes that
cause repeated collisions.

**Trade-offs and gotchas.** Backoff increases *tail latency* for the retried
request (you're deliberately waiting) — fine for background/async work, bad if a
user is blocked and a deadline is ticking. Backoff must be **bounded by the
deadline**: never back off past the point where success can still be delivered in
time. And backoff is orthogonal to a **retry budget** — you need both: jittered
backoff spreads retries in *time*, the budget caps them in *volume*. Backoff
alone does not prevent a retry storm if the failure is broad; only the budget /
circuit breaker does.

---

## Circuit breakers

**Intuition.** A circuit breaker (Nygard, *Release It!*) is a stateful proxy
around a remote call that **stops calling a dependency that is clearly failing**,
so you (a) fail fast instead of piling up threads on timeouts, and (b) give the
dependency room to recover instead of hammering it. It converts slow failures
into fast failures.

**State machine:**

```
        failures exceed threshold
 CLOSED ─────────────────────────▶ OPEN
   ▲                                 │
   │ trial succeeds                  │ after cool-down timer
   │                                 ▼
   └──────────  HALF-OPEN  ◀─────────┘
      trial fails (back to OPEN)
```

- **CLOSED** — normal; requests flow; failures are counted (often over a rolling
  window or as a failure *rate*, not a raw count, to be load-independent).
- **OPEN** — trip! Reject immediately (fail fast) for a cool-down period. No load
  reaches the dependency.
- **HALF-OPEN** — after cool-down, allow a *limited* number of trial requests. If
  they succeed, close; if any fail, re-open (and often extend the cool-down).

**Design details that matter (senior level):**

- **Per-endpoint / per-dependency / per-instance, not global.** One global
  breaker for a whole service will trip on one bad shard and cut off the healthy
  ones. Netflix Hystrix used per-dependency-command breakers; Envoy does
  per-upstream-cluster outlier ejection. Ideally per (instance) so one gray node
  is ejected while the pool keeps serving.
- **Trip on rate, plus a minimum request volume.** Tripping on "5 failures"
  behaves differently at 10 rps vs 10,000 rps. Use failure *percentage* over a
  window with a minimum-volume guard so low-traffic breakers don't flap on a
  single error.
- **Half-open must be single-flight / limited.** If half-open lets the full herd
  through to test, you recreate the storm. Let *one* (or a trickle) probe.

**Trade-offs and failure modes.** A breaker trades **availability for recovery**:
it *deliberately* fails requests it might have served, betting that shedding this
dependency's load helps overall. Risks: (1) **False trips** during a brief blip
cut off a recovering dependency and can themselves cause an outage; tune
thresholds against real p99/error data. (2) A breaker is a **coarse, binary**
tool — fully on or off; load shedding / concurrency limits are finer-grained and
often preferable for *overload* (you keep serving what you can). (3) Breakers can
**mask** the real problem and make behavior harder to reason about. Modern
practice (e.g., Netflix moving toward **adaptive concurrency limits**, Google's
gradient limiter) often *replaces* the crude breaker with an adaptive limiter
that continuously finds the safe concurrency rather than flipping open/closed.
Use a breaker when the dependency is *binary* (up/down); use a concurrency limiter
when it *degrades gracefully* under load.

---

## Timeouts and deadline propagation

**Why every remote call needs a timeout.** Without a timeout, a hung dependency
holds your thread/connection **forever**; enough hung calls exhaust your thread
pool or connection pool, and now *your* service is down because of *someone
else's* slowness. A timeout converts an **unbounded wait into a bounded,
handleable failure**. This is the single most common missing-safeguard in
real-world outages.

**How to set a timeout (not by gut feel).** Base it on the dependency's observed
latency distribution:

- A timeout at **p99** means ~1% of *healthy* requests time out unnecessarily
  (false positives) — too aggressive. A timeout at **p99.9 or p99.99 plus
  margin** is typical: high enough to not fail healthy slow requests, low enough
  to catch true hangs.
- Trade-off: **too short** → false timeouts, wasted retries, self-inflicted load
  (you time out requests that would have succeeded, then retry them → more load).
  **Too long** → threads pile up on a hung dependency, slow to detect failure,
  and you blow the caller's deadline anyway.
- Set it from *data* and revisit it: a timeout copied from a template ("30s") is
  almost always wrong.

**Deadline propagation (the senior concept).** A per-hop timeout is not enough.
If the edge gives the user 1 s, and it calls A (timeout 1 s) which calls B
(timeout 1 s) which calls C (timeout 1 s), then C might still be working after
the edge already gave up — **wasted work on a doomed request**, which under load
becomes amplification. The fix is a **deadline**: an *absolute* time
(`now + budget`) attached to the request and **propagated downstream**. Each hop
computes remaining time (`deadline − now`), uses it as its effective timeout, and
**abandons work immediately if the deadline has already passed** (fail fast
without even calling the next hop). gRPC deadlines and Google's RPC framework do
exactly this. Deadlines beat timeouts because:

- They account for time *already spent* upstream (a per-hop timeout resets the
  clock each hop).
- They let a hop *skip* work that can't possibly finish in time — cutting
  amplification during overload.
- They propagate cancellation: when the client goes away, downstream work is
  cancelled instead of continuing to burn resources.

**Trade-offs.** Deadlines require clock discipline (relative durations propagated,
not absolute wall-clocks, to avoid clock-skew bugs; gRPC sends a *remaining
duration*). And an overly tight end-to-end deadline can make a system *more*
fragile (everything times out under mild slowness) — so budget deadlines with
margin, and combine with backoff that's clamped to the deadline.

---

## Load shedding and brownout

**Intuition.** When demand exceeds capacity, you have two choices: **degrade for
everyone** (queues grow, latency explodes, eventually everything times out and
goodput → 0) or **serve some requests well and reject the rest fast**. Load
shedding is choosing the second: **admission control** that rejects (sheds) work
the system cannot complete, *cheaply and early*, to protect goodput for the work
it accepts.

**The goodput curve — why shedding is non-negotiable.** Without shedding, as
offered load passes capacity, *goodput* (successfully completed useful work)
doesn't plateau — it **collapses**, because the system spends resources on
requests that will time out anyway (work that produces no value). Shedding keeps
the system on the plateau instead of falling off the cliff. This is the
overload-control half of preventing metastable failure.

```
goodput ^        ____ with shedding (stays near capacity)
        |       /    ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
        |      /
        |     /  \
        |    /    \___ without shedding (collapses past capacity)
        +---/----------\----------------> offered load
                     capacity
```

**Mechanisms, from blunt to smart:**

1. **Random shedding** — drop X% when overloaded. Simple, fair-ish, ignores
   value.
2. **Priority-based shedding (brownout)** — classify requests by criticality
   (e.g., "critical" checkout vs "non-critical" recommendations) and shed
   low-priority first. **Brownout** = intentionally disabling optional features
   (personalization, recommendations, non-critical writes) to cut load while
   keeping core function alive. Netflix, Google, and Facebook all do this.
3. **Cost-aware / concurrency-limit shedding** — admit based on in-flight
   concurrency (Little's Law: `L = λ × W`; if a request takes `W` and you can
   safely have `L` in flight, admit at rate `λ = L/W`). Adaptive limiters
   (Netflix `concurrency-limits`, TCP-Vegas-style gradient) probe the safe limit
   continuously.
4. **Deadline-aware shedding** — if a queued request's deadline has already
   passed, drop it *without processing* (it's dead work). Cheap and highly
   effective.

**LIFO under overload (the counterintuitive one).** Under normal load, **FIFO**
is fair. Under *overload*, **FIFO is the worst policy**: the request at the front
of a deep queue has already waited so long it's likely past its deadline — you
do full work to produce a response nobody wants, then repeat for every stale
item. **LIFO** (serve newest first) means the requests you serve are the *freshest*
(most likely still within deadline), and the stale ones at the bottom get dropped
— maximizing goodput. Facebook's Thrift/queue and others switch to LIFO-ish
(adaptive) behavior under overload. Trade-off: LIFO is unfair (old requests
starve) and reorders — only acceptable *under overload*, which is why it's an
adaptive mode, not the default.

**Where to shed.** Shed **as early and cheaply as possible** — at the load
balancer or the front door, before you've spent CPU/DB on the request. Shedding
after the expensive work is pointless. And shedding must cost far less than
serving, or the shedder itself becomes the bottleneck.

**Trade-offs.** Shedding sacrifices some requests' availability to keep the
system on the goodput plateau — but the *shed* requests must be told fast (a
quick 503 with `Retry-After`), and the client must honor backoff or you just
shift the storm. The danger: if the rejected clients immediately retry (no
budget), shedding alone doesn't save you — **shedding + client retry budgets +
backoff are a package.**

---

## Backpressure and flow control

**Intuition.** Backpressure is **telling the producer to slow down when the
consumer can't keep up**, rather than silently buffering (which just moves the
overload into a queue that eventually explodes). It's flow control for
distributed systems. The alternative to backpressure is unbounded buffering,
which converts an overload into an out-of-memory crash or unbounded latency.

**The bounded-queue principle.** *Every* queue must be bounded. An unbounded
queue is a **latency and memory bomb**: under sustained overload it grows without
limit, so latency (by Little's Law, `W = L/λ`) grows without limit until OOM.
A bounded queue forces a decision at the boundary: when full, you must **block
(backpressure), drop (shed), or reject** — all better than pretending you have
infinite capacity. "Unbounded queue" is a synonym for "hidden metastable
failure."

**Mechanisms:**

- **Blocking / bounded buffers** — producer blocks when the queue is full; the
  block propagates upstream as backpressure. Simple, but blocking can deadlock or
  stall unrelated work if not isolated.
- **Credit-based flow control** — the consumer grants the producer a number of
  "credits" (permits) equal to its free buffer space; the producer may only send
  up to its credits. Used by HTTP/2 and gRPC flow control, RSocket, and
  Reactive Streams. Precise and non-blocking, but more complex.
- **Reactive Streams `request(n)`** — the subscriber pulls `n` items at a time;
  the publisher never pushes more than requested. This is *demand-driven*
  backpressure (Project Reactor, Akka Streams, RxJava). It moves the control
  decision to the consumer, which knows its own capacity.
- **TCP flow control** (receive window) is the OG credit-based backpressure and a
  useful mental model.

**Backpressure vs load shedding — the key distinction.** Backpressure
*propagates* the slowdown upstream (eventually to the ultimate source, ideally a
human who waits); load shedding *drops* work. Backpressure is right when the
producer *can* slow down (internal pipeline, a user typing). It's **wrong when
the producer can't be slowed** — e.g., the open internet, or a fan-in of millions
of clients: you can't backpressure the whole internet, so you *must* shed at the
edge. Also, backpressure that propagates all the way to a synchronous user just
converts "dropped" into "slow," which may be worse. Rule of thumb:
**backpressure internally, shed at the edge.**

**Trade-offs.** Backpressure preserves *all* work (nothing dropped) at the cost
of *latency and coupling* — a slow consumer can stall the whole pipeline (head-of-
line blocking), and backpressure can cascade into a distributed deadlock if
producers and consumers form a cycle. Shedding preserves *latency/goodput* at the
cost of *dropping work*. Choose by whether the dropped work is acceptable and
whether the producer is controllable.

---

## Cascading failures, bulkheads and isolation

**Cascading failure** is when the failure of one component *causes* the failure
of others, which cause more, in a chain — often via a shared resource. The
classic path: dependency B slows → all threads in service A block calling B → A's
thread pool exhausts → A can't serve *anything*, including requests that don't
even use B → A's callers now see A as down → the failure climbs the stack. The
shared resource (A's thread pool) coupled the healthy path to the unhealthy one.

**Bulkheads (isolation).** Named after ship compartments: partition resources so
a failure floods only one compartment, not the whole hull. Forms:

- **Thread-pool / connection-pool isolation** — give each dependency its *own*
  bounded pool. If B hangs, only B's pool exhausts; calls to C still have threads.
  This is the core of Hystrix's design (separate thread pools per dependency).
- **Semaphore isolation** — a cheaper cap on concurrent calls per dependency
  without the overhead of a separate thread pool (no extra context switches, but
  no ability to time out a truly stuck call by interrupting a separate thread).
- **Cell / shard isolation** — partition *customers* into independent cells
  (AWS "cell-based architecture", shuffle sharding). A bad tenant or poison
  request blasts only its cell.
- **Shuffle sharding** — assign each client a *random subset* of nodes so that
  any two clients rarely share their full set; a single bad client (or a poison
  pill) degrades only the few nodes in its shard, and the overlap math means the
  probability that two customers fully collide is tiny. AWS Route 53 and many
  services use this for blast-radius reduction.

**Trade-offs.** Isolation *always costs efficiency*: separate pools mean lower
utilization (idle threads reserved per dependency), cells mean you can't pool all
capacity, thread-pool isolation adds context-switch overhead. You trade
**utilization for blast-radius containment.** Too fine-grained isolation wastes
resources and can *reduce* resilience (each tiny pool is easier to exhaust);
too coarse and one failure takes everything. The senior judgment call is
choosing the *partition dimension* (per-dependency, per-tenant, per-region) that
matches how failures actually correlate.

---

## Static stability

**Intuition.** A system is **statically stable** if it keeps working *in its
current configuration* when its dependencies fail — it does **not** need the
control plane (the thing that makes changes) to keep the data plane (the thing
that serves traffic) running. From the AWS Builders' Library ("Static stability
using Availability Zones"): the data plane should be able to survive the control
plane being *completely down*, as long as no *changes* are needed.

**Mechanism: keep the control plane out of the hot path.** The control plane
(config distribution, scaling, health-based routing decisions, cert issuance,
service discovery writes) is complex and thus more failure-prone than the data
plane (serving cached config from local memory). Static stability means:

- **Pre-provision for failure** rather than reacting. Classic example: to survive
  an AZ failure across 3 AZs, run each AZ at ~66% so the surviving two absorb the
  load — instead of *relying on auto-scaling to add capacity during the failure*
  (auto-scaling is a control-plane action that may itself be impaired exactly
  when you need it, and the failure event is when everyone else is scaling too).
- **Cache dependency responses / config locally** so a config-service outage
  doesn't stop request serving — you keep using the last-known-good config.
- **Data plane uses pre-computed state.** Route 53 keeps answering DNS from
  distributed data-plane state even if the control plane (record updates) is
  down; you just can't *change* records.

**Trade-offs.** Static stability trades **cost/efficiency and freshness for
availability.** Pre-provisioning to 66% (or lower for more AZs) means you *pay
for idle capacity* that only earns its keep during a failure — the opposite of
"scale on demand." Serving last-known-good config means you may serve **stale**
config during a control-plane outage (a node that should be ejected stays in
rotation). The bet is that the *cost of over-provisioning* is far less than the
*cost of a correlated outage where the control plane fails right when you need
it most* — and empirically, control planes fail during the big events. This is
the deepest resilience principle in the topic: **don't put a fragile dependency
in the critical path of recovering from that dependency's failure.**

---

## Graceful degradation and the danger of fallbacks

**Graceful degradation** means reducing functionality instead of failing
entirely: serve stale cache, hide a non-critical widget, disable personalization,
return a simpler response. It's the *product-level* expression of load shedding
and brownout. Good degradation is **planned, prioritized, and tested**: you
decide in advance what to drop first (recommendations before checkout), and you
practice it (chaos/game days).

**Why fallbacks are dangerous (AWS Builders' Library, "Avoiding fallback in
distributed systems").** A **fallback** is code that runs *only* when the primary
path fails — a secondary datastore, a default value, an alternate service. AWS's
hard-won lesson: **fallbacks are among the most dangerous patterns** because:

1. **The fallback path is rarely exercised**, so it's under-tested and often
   *itself* broken — and it gets invoked for the first time at scale during your
   worst incident.
2. **Correlated demand.** When the primary fails, *all* traffic shifts to the
   fallback *simultaneously* — the fallback (e.g., a secondary DB) gets a sudden
   load spike it was never sized for, and it fails too. The fallback becomes a
   second, worse outage.
3. **Bimodal behavior.** The system behaves completely differently in fallback
   mode, so capacity planning and testing done for the normal mode don't apply —
   you have a hidden second system with its own untested failure modes.
4. **Fallbacks can mask errors** until they're catastrophic, and can create
   *retry+fallback* amplification.

**The AWS recommendation:** prefer designs that **don't need a fallback** — make
the primary path robust, and if the primary can't serve, **fail (shed) rather
than fall back** to an untested alternate. If you must have a fallback, **exercise
it continuously** (run some fraction of production traffic through it always, so
it's never cold) and **size it for 100% of load.** A fallback you only use in
emergencies is a landmine.

**Trade-offs / nuance.** Not all fallbacks are bad: serving a **stale local
cache** or a **static default** is a *safe* fallback because it has no new
dependency and roughly constant cost — it doesn't create correlated demand on a
fragile system. The dangerous ones are fallbacks to *another live remote
dependency*. The distinction: a safe fallback removes dependencies; a dangerous
fallback adds a new (untested, unsized) one at the worst moment.

---

## The fallacies of distributed computing

Catalogued at Sun (Peter Deutsch, James Gosling, and others, 1994–97). They are
false assumptions that, baked into code, cause outages — and each maps directly
to a mechanism in this topic:

| # | Fallacy | Reality | Mechanism it forces |
|---|---|---|---|
| 1 | The network is reliable | Packets drop, links flap | Retries (idempotent), timeouts |
| 2 | Latency is zero | RPCs are ~1000× a local call | Deadlines, batching, async |
| 3 | Bandwidth is infinite | Links saturate | Backpressure, flow control, payload limits |
| 4 | The network is secure | It isn't | TLS, authn/z, zero-trust |
| 5 | Topology doesn't change | It changes constantly | Service discovery, health-based routing |
| 6 | There is one administrator | Many, across orgs | Versioning, compatibility, graceful degradation |
| 7 | Transport cost is zero | Serialization/marshalling costs | Efficient protocols, caching |
| 8 | The network is homogeneous | Mixed hardware/protocols | Standard protocols, defensive parsing |

The senior framing: **every fallacy has a matching resilience mechanism.** When
you name why a design is fragile, name the fallacy it violates *and* the
mechanism that repairs it. "Latency is zero" is what makes a chatty N+1 fan-out
fragile; deadlines + batching repair it. "The network is reliable" is why a call
without a timeout is a bug, not a style choice.

---

## Common interview follow-up questions

- **"Your service is at 100% CPU and near-zero goodput; adding hosts didn't
  help. What's happening and what do you do?"** — Suspect a metastable failure
  (likely retry storm or GC spiral). Adding capacity feeds the amplifier. Shed
  load below the *sustaining* threshold, disable/curtail retries (open breakers,
  drain retry budget), flush backlog; then re-introduce traffic gradually.
- **"Three services each retry 3×. What's the load on the datastore during a
  partial failure?"** — Up to 3^3 = 27×. Fix: retry at one layer, use a
  token-bucket retry budget, propagate deadlines so lower layers fail fast.
- **"Why is a timeout at p99 usually wrong?"** — It fails ~1% of *healthy*
  requests (false positives) and triggers needless retries → self-inflicted load.
  Set from p99.9/p99.99 + margin, and use deadline propagation.
- **"When is a circuit breaker the wrong tool?"** — When the dependency degrades
  *gracefully* under load rather than being binary up/down; an adaptive
  concurrency limiter keeps serving what it can, whereas a breaker's binary trip
  either over- or under-shoots.
- **"FIFO vs LIFO for a request queue?"** — FIFO under normal load; LIFO (or
  adaptive) *under overload*, because the front of a deep FIFO queue is stale/past
  deadline — serving it is wasted work. Also drop past-deadline items unprocessed.
- **"Why can adding a fallback make things worse?"** — Untested path, correlated
  demand (all traffic shifts at once to an unsized alternate), bimodal behavior.
  Prefer fail-and-shed or safe fallbacks (stale cache) that add no dependency.
- **"Full vs decorrelated jitter — when each?"** — Full jitter minimizes total
  competing calls; decorrelated jitter climbs faster without tracking an attempt
  counter and gives a good spread — pick decorrelated when you want increasing
  backoff without per-attempt state.
- **"How do you detect a gray failure that health checks miss?"** — Client-side/
  outlier detection: eject on observed latency/error rate from the caller's
  perspective, not on the server's self-reported health.
- **"Why does over-provisioning increase metastability risk?"** — More headroom
  hides the cliff and, because amplification is multiplicative, a bigger normal
  load means a bigger absolute surge when the trigger hits.

## References

- **Bronson, Aghayev, Charapko, Zhu — "Metastable Failures in Distributed
  Systems"** (HotOS 2021) and the follow-up (CACM 2022 / OSDI-era work) — the
  definitive treatment of trigger vs sustaining effect.
- **Huang et al. — "Gray Failure: The Achilles' Heel of Cloud-Scale Systems"**
  (HotOS 2017) — differential observability.
- **Waldo, Wyant, Wollrath, Kendall — "A Note on Distributed Computing"** (1994)
  — partial failure, why local ≠ remote.
- **Dean & Barroso — "The Tail at Scale"** (CACM 2013) — fan-out tail latency,
  hedged/tied requests.
- **AWS Builders' Library** — "Timeouts, retries, and backoff with jitter"
  (Marc Brooker), "Avoiding fallback in distributed systems" (Jacob Gabrielson),
  "Static stability using Availability Zones", "Using load shedding to avoid
  overload", "Workload isolation using shuffle sharding", "Fairness in
  multi-tenant systems".
- **Marc Brooker's blog** — "Exponential Backoff and Jitter"; posts on retries,
  timeouts, and overload.
- **Michael Nygard — *Release It!* (2nd ed.)** — circuit breakers, bulkheads,
  steady state, fail fast, timeouts.
- **Google SRE Book** — "Addressing Cascading Failures", "Handling Overload",
  "Managing Critical State" — deadline propagation, load shedding, retry budgets.
- **Netflix Tech Blog / Hystrix wiki / `concurrency-limits`** — bulkheads,
  adaptive concurrency limiting, brownout.
- **Kleppmann — *Designing Data-Intensive Applications*** (ch. 8) — failure
  models, unreliable networks/clocks, partial failure.
- **Cristian / Schneider / Lamport** — classical failure models and the crash ⊂
  omission ⊂ Byzantine hierarchy; BFT needs 3f+1, crash-consensus 2f+1.
