# Capacity Planning & Load Management

**Capacity planning** is the discipline of ensuring a system has *enough resources to meet
demand at its target reliability* — no more (that wastes money), no less (that causes outages).
It answers three questions: *how much load is coming?* (forecasting), *how much can one unit
serve before it degrades?* (load testing / benchmarking), and *how much slack do we keep in
reserve?* (headroom). **Load management** is the runtime complement: when demand approaches or
exceeds provisioned capacity, how do you *shape* it (autoscale, queue, shed, rate-limit) so the
system degrades gracefully instead of collapsing.

The whole field rests on one counter-intuitive fact from queueing theory: **you cannot safely
run a system at 100% utilization**. As utilization approaches 1.0, latency does not rise
linearly — it goes *vertical* (the hockey-stick / "M/M/1 wall"). So capacity planning is really
about deciding *how far below the cliff* you want to operate, and buying/holding enough resource
to stay there through your worst realistic spike.

> [!KEY-TAKEAWAY]
> Capacity planning is a **risk/cost trade-off**, not a math problem with one right answer.
> More headroom = higher cost, lower risk of overload; less headroom = cheaper, but you're
> closer to the latency cliff and depend more on fast autoscaling and load shedding as
> backstops. Provision for your forecast **plus headroom**, then use load management to absorb
> the forecast error.

**Boundaries (cross-reference, don't duplicate):** for *how you measure* utilization/saturation
and alarm on it (the four golden signals, PromQL, dashboards) see `observability/*`; for the
*mechanics of shedding excess load* (goodput, admission control, backpressure) see
`reliability-ops/load-shedding-and-backpressure`; for *rate-limiter design/algorithms* see
`system-design/design-rate-limiter` and for *rate limiting as abuse prevention* see `security/*`;
for *deploy/autoscaling pipeline mechanics and IaC* see `devops-cicd/*`; for the *theoretical
scalability trade-offs* see `system-design/*`; for *load-test correctness details* see
`testing/*` (load testing).

---

## Provisioned vs Usable Capacity

A frequent planning error is treating the number on the invoice as the capacity you can serve
with. Distinguish three layers:

| Layer | Meaning |
|---|---|
| **Provisioned / raw capacity** | What you paid for / spun up — e.g. 20 instances × 8 vCPU. |
| **Usable capacity** | What you can actually drive *while staying within SLO* — always lower, because of the utilization wall, per-instance overhead (OS, sidecars, GC), and reserved headroom. |
| **Effective / redundant capacity** | Usable capacity *after* subtracting what must survive the loss of a failure domain (a node, an AZ). This is the number that matters for a redundancy target. |

**Rule of thumb:** if the latency SLO forces you to keep CPU below ~60–70%, then usable capacity
is only ~60–70% of raw *before* you even reserve headroom for failures and growth. Planning as if
100% of provisioned capacity is usable is how teams end up over the cliff during a normal spike.

> [!WARNING]
> "We have 20 servers and each does 1,000 rps in a benchmark, so we can serve 20,000 rps" is
> almost always wrong. The benchmark number is peak *throughput*, often measured at 100%
> utilization with unrealistic latency; usable rps at SLO is much lower, and you must still
> reserve capacity to lose a node/AZ.

---

## Forecasting Demand: Organic Growth, Events & Seasonality

You provision against *forecast peak*, not average. Good forecasts decompose demand into
components and add them:

- **Organic growth** — the baseline trend (user growth, adoption). Often modeled as a
  compound growth rate. A 5%/month growth compounds to **~1.8×** in a year (`1.05^12 ≈ 1.80`);
  10%/month is **~3.1×** (`1.10^12 ≈ 3.14`). Small monthly rates are large annual ones.
- **Seasonality** — recurring cycles: daily (diurnal peak), weekly (weekday vs weekend),
  yearly (retail: Black Friday/Cyber Monday, Prime Day; tax season; back-to-school).
- **Events / launches** — discrete, often *non-organic* spikes: a marketing push, a product
  launch, a viral moment, a Super Bowl ad. These are the ones that break systems because they
  are large, sudden, and poorly predicted by trend lines.

**Two forecasting styles (Google SRE):**

| Approach | Basis | Good for |
|---|---|---|
| **Organic / bottom-up** | Extrapolate historical usage trends + known seasonality. | Steady-state growth, recurring peaks. |
| **Inorganic / top-down** | Business-driven: "marketing expects 5M signups on launch day." | Launches, one-off events with no historical signal. |

Always combine: forecast peak = *organic-trend peak* × *seasonal multiplier* + *event uplift*,
then provision for that with headroom. Forecast against the **peak-of-peaks** (e.g. the busiest
minute of Black Friday), not the daily or monthly average — that's the moment you must survive.

> [!TIP]
> Track forecast **accuracy** as a metric. Systematically under-forecasting means you'll be
> caught short; chronic over-forecasting means you're burning money. Feed misses back into next
> cycle's model.

---

## Headroom: N+1 / N+2 and Why Not to Run at 100%

**Headroom** is deliberately unused capacity held in reserve. It exists to absorb three things
simultaneously: (1) **failures** — you must keep serving if a unit dies; (2) **spikes** — demand
above forecast; (3) **latency** — the utilization wall means you *want* to run below saturation
even with no failures.

**Redundancy notation (N is the capacity needed to serve peak demand at SLO):**

| Model | Meaning | Survives |
|---|---|---|
| **N** | Exactly enough to serve peak. No spare. | Nothing — one failure = overload. |
| **N+1** | One spare unit beyond peak need. | Loss of any *one* unit. |
| **N+2** | Two spares. | Two simultaneous failures (or one failure *during* maintenance). |
| **2N** | Full duplicate. | Loss of an entire set/site. |
| **2(N+1)** | Redundant, each side itself N+1. | Common in high-tier data-center/DR designs. |

For **multi-AZ** services the practical target is often "survive the loss of one AZ at peak."
If you run in 3 AZs, each must be able to absorb the traffic of a failed AZ, so each AZ runs at
**~2/3 utilization max** — losing one leaves two carrying the full load. In 2 AZs you'd need each
at ≤50%. This is why AZ redundancy is expensive: you pay for slack that is idle in the normal case.

**Why not 100%?** Beyond the latency-cliff reason (next section), running at 100% leaves *zero*
room to: deploy (rolling deploys temporarily remove capacity), absorb a bad GC pause or noisy
neighbor, or handle the retry surge when something briefly hiccups. Typical steady-state CPU
targets for latency-sensitive services sit around **50–70%**; batch/throughput systems can run
hotter (80–90%) because they tolerate queueing.

```mermaid
flowchart LR
    A["Raw / provisioned capacity"] --> B["- per-instance overhead\n- utilization ceiling for SLO"]
    B --> C["Usable capacity"]
    C --> D["- headroom for failures N+1/N+2\n- headroom for spikes\n- headroom for deploys"]
    D --> E["Committed to normal peak demand"]
```

---

## Little's Law and the Utilization Wall

**Little's Law** is the fundamental relation of queueing systems, and it holds for *any* stable
system regardless of arrival distribution:

```
L = λ × W
```

- **L** = average number of requests *in the system* (in service + waiting)
- **λ** (lambda) = average arrival rate (requests/sec)
- **W** = average time a request spends *in the system* (latency, including queue wait)

It's used constantly in capacity work. Examples:
- **Concurrency needed:** at λ = 2,000 rps with W = 50 ms, `L = 2000 × 0.05 = 100` requests in
  flight — so you need ~100 concurrent workers/threads (plus headroom) to keep up.
- **Thread-pool / connection-pool sizing:** pool size must be ≥ L or requests queue.
- **Max throughput of a fixed pool:** with 200 threads and W = 100 ms, `λ_max = L/W = 200/0.1 =
  2,000 rps`. Push past that and W (latency) rises to keep the equation balanced — the queue grows.

**The utilization wall (M/M/1 model):** for a single server with random arrivals and service
times, the average response time scales as:

```
W = S / (1 − ρ)          where S = service time, ρ = utilization (0..1)
```

The `1/(1−ρ)` term is the killer. As ρ climbs:

| Utilization ρ | Latency multiplier `1/(1−ρ)` |
|---|---|
| 50% | 2× service time |
| 70% | ~3.3× |
| 80% | 5× |
| 90% | 10× |
| 95% | 20× |
| 99% | 100× |

This is the **hockey stick**: latency is nearly flat until ~70–80%, then goes vertical. It's why
"we're only at 85% CPU, we're fine" is dangerous — you're already on the steep part of the curve,
and a small demand increase produces a huge latency jump. Parallelism (more servers, M/M/c)
softens the knee but does not remove it. This queueing reality is *the* mathematical justification
for holding headroom.

> [!INTERVIEW]
> If asked "why can't we just run servers at 100% to save money?" the crisp answer is Little's
> Law plus the `1/(1−ρ)` response-time curve: near full utilization, queue depth and latency
> diverge, so a system at 100% util has effectively *infinite* tail latency and no slack to
> absorb variance or failures. You trade a little idle cost for bounded latency.

---

## Load Testing: Load vs Stress vs Soak vs Spike

You cannot plan capacity from specs alone — you must *measure* how the real system behaves under
load. The four canonical test types answer different questions:

| Test type | What it does | Question it answers |
|---|---|---|
| **Load test** | Drive expected/target load (e.g. forecast peak) and hold. | "Do we meet SLO at our expected peak?" |
| **Stress test** | Push load *past* expected peak until the system breaks. | "Where is the breaking point, and *how* does it break?" |
| **Soak / endurance test** | Sustain moderate load for hours/days. | "Do we degrade over time — memory leaks, fd leaks, disk fill, cache bloat, log growth?" |
| **Spike test** | Apply a sudden, sharp jump in load, then drop. | "Can we survive a flash crowd / can autoscaling react in time?" |

Two more you'll hear:
- **Capacity / scalability test** — step load up in stages to map the throughput-vs-latency curve
  and find the knee (next section).
- **Volume test** — large *data* volumes rather than request rate (big tables, large payloads).

**Trade-offs / gotchas:**
- Load tests must use **realistic traffic mix and data** — cache hit rates, payload sizes, and
  key distributions dominate real behavior. Testing all-cache-hit traffic wildly overstates
  capacity.
- Test **against dependencies** (or realistic mocks). A service that looks fine in isolation can
  fall over because a downstream DB is the true bottleneck.
- **Soak tests catch what short tests can't:** a memory leak that OOMs after 6 hours is invisible
  in a 10-minute load test but will page you at 3 a.m. in production.
- Prefer testing in **prod or a prod-like environment** (Google's preference); a scaled-down
  staging env has different bottlenecks. See `testing/*` for methodology and `devops-cicd/*` for
  running these in a pipeline.

---

## Finding the Knee: Saturation Point & Capacity Limits

To size capacity you need the **knee** (a.k.a. saturation point or "point of maximum sustainable
throughput"): the load level beyond which latency degrades faster than throughput improves.

Run a **step / ramp test**: increase offered load in stages and plot two curves — *throughput
(completed rps)* and *latency (p50/p99)* against offered load.

- Below the knee: throughput rises ~linearly with offered load, latency stays roughly flat.
- **At the knee:** throughput flattens (you've hit a bottleneck — CPU, a lock, connection pool,
  DB); adding load no longer adds goodput.
- Past the knee: latency shoots up (utilization-wall region); eventually throughput can *fall*
  (thrashing, retries, congestive collapse) — this is the difference between the **saturation
  point** and the **collapse point**.

**Plan capacity at the knee, not the collapse point.** The maximum *usable* per-unit throughput
is the knee value, minus your headroom. Provisioning to the collapse point means production runs
in the unstable region where a tiny nudge triggers a cascading failure (see
`reliability-ops/cascading-failures-and-antipatterns`).

Identify the *binding constraint* at the knee (Amdahl-style bottleneck analysis): is it CPU, a
single-threaded lock, GC, connection-pool exhaustion, disk IOPS, or a downstream limit? The
bottleneck determines the right autoscaling metric — scaling on CPU is useless if the real limit
is a fixed DB connection pool.

```mermaid
flowchart LR
    subgraph curve["Offered load ->"]
      A["Linear region:\nthroughput up, latency flat"] --> B["Knee / saturation:\nthroughput plateaus"]
      B --> C["Overload:\nlatency vertical"]
      C --> D["Collapse:\ngoodput falls"]
    end
```

---

## Coordinated Omission: The Load-Test Measurement Trap

**Coordinated omission** (coined by Gil Tene) is a systematic *measurement error* that makes load
tests report latency far better than reality — often hiding the worst tail entirely.

**The mechanism:** most load generators work in lockstep — send a request, *wait for the response*,
then send the next. When the server stalls (a GC pause, a lock, a slow dependency), the load
generator **stops sending** during the stall. So the very requests that *would* have experienced
the long queue wait are never issued — the tool "coordinates" its omission of samples with exactly
the periods of bad latency. The result: a 100 ms stall that in production would have delayed
*thousands* of queued requests shows up as a *single* slow sample, and your p99 looks great.

**A concrete illustration:** a system is supposed to serve 10,000 rps but freezes for 1 second.
In production, ~10,000 requests arrive during that freeze and each waits up to 1 s — a huge tail.
A naive load generator sends *one* request, waits 1 s, and records one 1-second sample; every
other measurement is a fast, post-stall response. Reported p99 ≈ a few ms; true p99 ≈ ~1 s.

**How to avoid it:**
- Use load tools that model an **open workload** / constant arrival rate independent of responses
  (send on schedule regardless of whether prior requests returned), e.g. `wrk2`, and correction
  modes in `HdrHistogram` / Gatling / k6.
- **Back-correct**: for any response that took longer than the intended send interval, synthesize
  the samples that *should* have been sent during the stall.
- Measure against a **fixed schedule** (intended start time), not just service time — report
  latency as `now − intended_send_time`, capturing queue wait the tool would otherwise omit.

> [!WARNING]
> Coordinated omission is why teams are shocked when production tail latency is 10–100× worse than
> the load test predicted. If a benchmark's throughput and latency both look great and the numbers
> came from a closed-loop tool, distrust the tail. See `testing/*` for load-test methodology.

---

## Autoscaling: Reactive vs Predictive vs Scheduled

Autoscaling adjusts capacity to track demand so you don't pay for peak 24/7. Three strategies:

| Strategy | How it decides | Strength | Weakness |
|---|---|---|---|
| **Reactive / dynamic** | React to *current* metrics crossing a threshold (CPU > 60% → add instances). | Simple, needs no forecast, follows real demand. | Always **lagging** — scales *after* load arrives; blind to sudden spikes. |
| **Scheduled** | Scale on a *calendar* (add capacity at 08:00, before the daily peak or a known launch). | Great for predictable diurnal/event patterns; capacity is ready *before* demand. | Useless for unexpected spikes; wastes money if the event doesn't materialize. |
| **Predictive** | ML/forecast of near-future demand → pre-scale (e.g. AWS Predictive Scaling). | Anticipates recurring patterns, warms capacity ahead of the curve. | Only as good as the forecast; mispredicts novel events. |

**Best practice:** combine them. Use **scheduled/predictive** to have baseline capacity ready for
known peaks, and **reactive** as the safety net for the unforecastable. Also scale in two
dimensions: **horizontal** (add/remove instances — the usual autoscaling) and **vertical**
(bigger instances — limited, disruptive, has a ceiling).

Key config levers and their trade-offs:
- **Target utilization** — the metric setpoint (e.g. 50% CPU). Lower = more headroom, faster to
  absorb spikes, higher cost.
- **Cooldown / stabilization window** — prevents *flapping* (rapid scale in/out). Too short →
  thrash; too long → sluggish response.
- **Scale-in caution** — scale *out* fast, scale *in* slow. Removing capacity too aggressively
  right before the next spike causes an outage.

---

## Autoscaling Isn't Instant: Scale-Up Lag & the Right Metric

The most common autoscaling misconception is that it's instantaneous. It is not — there is a
**provisioning delay** between deciding to scale and having warm, serving capacity:

```
detect (metric scrape + eval + breach duration)
  → decide (cooldown/threshold)
  → launch instance (boot, ~1–several min)
  → bootstrap (pull image/deps, warm caches, JIT warmup)
  → register (health checks pass, LB adds to pool)
```

This end-to-end lag is commonly **minutes** (EC2 boot + app warmup; a large container image or
JVM warmup adds more). A **spike that arrives in seconds will overwhelm you before new capacity
is ready** — which is why autoscaling *alone* cannot handle flash crowds. You need:

- **Standing headroom** to absorb load during the scale-up window.
- **Warm pools / pre-provisioned instances** (kept booted, ready to serve) to shrink lag.
- **Load shedding** as the immediate backstop while capacity spins up (see
  `reliability-ops/load-shedding-and-backpressure`).

**Scale on the right metric.** The autoscaling signal must be the *actual bottleneck* and, ideally,
a **leading** indicator:
- CPU is the default but is wrong when the limit is I/O, memory, a connection pool, or a downstream.
- For request-serving systems, scale on a **per-instance load metric** like requests-in-flight,
  queue depth, or **RPS/target** — these lead CPU and map to Little's Law.
- **Never scale on a lagging/global average that the scaling action doesn't affect.** Classic
  anti-pattern: scaling a queue-consumer fleet on *consumer* CPU when the real signal is **queue
  backlog / age of oldest message** — scale on the backlog.

> [!WARNING]
> **Autoscaling can amplify a failure.** If instances are crashing (OOM, bad deploy) and the
> scaler interprets rising per-instance load as "need more capacity," it launches replacements
> that also crash — or, worse, scales *down* healthy capacity because a dependency outage made
> traffic drop. Guard with health checks, min/max bounds, and alarms on scaling activity itself.

---

## Overprovisioning: Cost vs Risk

Overprovisioning — running more capacity than the forecast requires — is *buying insurance
against overload*. The core trade-off:

- **More headroom / overprovision:** lower risk of SLO breach and outage; tolerates forecast
  error, spikes, and failures gracefully; but **higher cost** (idle resources) — and idle
  capacity is pure waste.
- **Lean / just-in-time:** cheaper; but you lean hard on **fast autoscaling + load shedding** as
  backstops, and you're one bad forecast away from an outage.

Frame it as expected cost: `E[cost] = cost_of_idle_capacity` vs `E[loss] = P(overload) ×
cost_of_an_outage`. If an outage is very expensive (revenue, trust, SLA penalties), a lot of
headroom is *rational*. For a low-stakes internal tool, running lean and eating the occasional
degradation is fine.

**Tactics that cut the cost of headroom without cutting the safety:**
- **Cheaper reserve capacity** — spot/preemptible instances or a warm pool for the buffer, on-demand
  for the baseline.
- **Load shedding + graceful degradation** — lets you provision closer to the forecast because
  the failure mode is "shed low-priority traffic" instead of "collapse."
- **Multi-tenancy / bin-packing** — smooth uncorrelated demand across services so aggregate peak <
  sum of individual peaks.
- **Autoscaling** — turns fixed overprovisioning into demand-following capacity (bounded by
  scale-up lag).

> [!INTERVIEW]
> There's no universally "right" utilization target. The answer an interviewer wants is the
> *reasoning*: "It depends on cost of an outage vs cost of idle capacity, how spiky demand is,
> how fast we can autoscale, and whether we can shed load. A latency-sensitive revenue service
> with slow autoscaling wants lots of headroom; a batch pipeline can run hot."

---

## Demand Shaping: Shed, Queue, Rate-Limit

When demand exceeds capacity *right now* — faster than you can add capacity — you manage the
*demand* side. This is **load management** proper. Three levers:

| Lever | What it does | Best for | Cost |
|---|---|---|---|
| **Shed** | Reject excess requests fast (`503`/`429`) so accepted work stays healthy. | Interactive traffic where a fast failure beats a slow one; protects goodput. | Some users get errors (ideally low-priority ones first). |
| **Queue / buffer** | Accept and defer work to smooth bursts. | Async / batch work that tolerates delay. | Adds latency; **bounded** queues only — an unbounded queue just delays collapse (see below). |
| **Rate-limit / throttle** | Cap per-client/per-tenant request rate. | Fairness, protecting shared capacity from one noisy tenant. | Clients must handle throttling / back off. |

**Queueing caveat (critical):** a queue converts overload into *latency and memory growth*, not
into free capacity. If arrival rate stays above service rate, a queue grows without bound → OOM /
timeouts (Little's Law: W → ∞). Queues only help absorb **bursts** that fit within the average
capacity. Under *sustained* overload you must shed or apply backpressure. Use **bounded** queues
and treat a full queue as a shed signal.

**Prioritization:** shed *the right* traffic first — drop low-priority/best-effort work (background
refreshes, prefetch, non-critical analytics) and protect high-value/critical requests (checkout,
auth). Criticality-aware shedding preserves the most business value per unit of capacity.

For the full treatment of the mechanics — admission control, backpressure, goodput, LIFO vs FIFO
queues, deadline propagation — see `reliability-ops/load-shedding-and-backpressure`. For limiter
algorithms (token bucket, leaky bucket, sliding window) see `system-design/design-rate-limiter`.
For *how you measure* saturation and queue depth to trigger these, see `observability/*`.

---

## Universal Scalability Law: Why Adding Nodes Can Backfire

Little's Law and the M/M/1 wall explain the *single-node* ceiling. The **Universal Scalability
Law (USL, Neil Gunther)** explains the *horizontal* ceiling — why adding nodes stops helping and
can even make throughput *fall*. Relative capacity as a function of node count `N`:

```
X(N) = γN / [ 1 + α(N − 1) + βN(N − 1) ]
```

- **γ** (gamma) — ideal per-node throughput (the linear-scaling slope).
- **α** (alpha) — **contention**: serialization / queueing for a shared resource (a lock, a
  single writer, a shared DB). This is the **Amdahl's Law** term — Amdahl is the special case
  `β = 0`. Contention makes throughput *plateau*.
- **β** (beta) — **coherency**: the crosstalk cost of keeping N nodes *consistent* with each
  other (cache-coherency traffic, gossip, cross-node coordination). It grows as **N(N−1)** —
  O(N²) — so beyond a point adding a node costs more in coordination than it adds in work, and
  throughput goes **retrograde** (actually declines).

The peak is at:

```
N_max = √( (1 − α) / β )
```

Past `N_max`, more nodes = *less* throughput. This is the crisp answer to **"we doubled the
fleet and throughput barely moved — or got *worse* — why?"**: a plateau is α/contention
(Amdahl); a *decline* is β/coherency. The fix for α is to remove the serialization point; the
fix for β is to **stop making every node talk to every other node** — partition the fleet so
coordination is bounded (see cell-based architecture below).

> [!KEY-TAKEAWAY]
> Horizontal scaling is not free and not unbounded. Contention (α) caps throughput; coherency
> (β) can *reverse* it. Capacity planning for a distributed fleet must ask "does per-node
> coordination cost grow with fleet size?" — if yes, there is an `N_max` you must not blow past.

---

## When Adding Capacity Reduces Capacity: The Kinesis Lesson

The **AWS Kinesis outage (us-east-1, 25 Nov 2020)** is the canonical real-world USL-β story and
the textbook case of a capacity limit that was **not** CPU or RAM. Operators added a modest
number of servers to the front-end fleet. Each front-end server creates **OS threads for every
*other* server in the fleet** to build its shard-map — so thread count per server scales with
**fleet size** (O(N) per node, O(N²) fleet-wide). The capacity *addition* pushed every server
past the **OS thread-count limit**; servers could no longer build a correct shard-map and
couldn't route requests. Recovery was slow and deliberate — capacity had to be added back at
"a few hundred servers per hour" to avoid re-tripping the limit.

Lessons that show up directly in interviews:

- **Adding capacity can *reduce* capacity** when per-node cost grows with fleet size (the β
  term made physical).
- **The binding constraint is often an invisible config ceiling** — a thread limit nobody was
  graphing — not the resource on your dashboard.
- The fix was **larger/fewer boxes** (fewer nodes → less coordination) plus **cellularization**.

> [!WARNING]
> The real capacity limit is frequently *not* CPU/RAM. Watch for **thread counts, file
> descriptors, ephemeral ports, connection-tracking (conntrack) table size, ARP tables, ENIs,
> connection-pool slots, a single global lock, and API/service quotas**. Use the USE method
> (below) to find *which* resource saturates first, and graph it.

---

## Cell-Based Architecture & Blast-Radius Isolation

Once fleet-wide coordination cost (USL β) or a shared poison-pill dominates, the modern answer
is **cell-based architecture**: partition the fleet into many independent **cells**, each a
complete, self-contained copy of the stack sized and *capped* so its capacity — and its failure
— is bounded. A request is routed to exactly one cell; a cell's overload, bad deploy, or
poison-pill request is contained to that cell instead of taking down the whole service.

- **Bounded coordination.** Nodes only coordinate *within* a cell, so N per cell is small and β
  never runs away — this is precisely the Kinesis fix.
- **Shuffle sharding** (AWS Builders' Library, "Workload isolation using shuffle-sharding")
  assigns each customer a *random combination* of cells, so two noisy tenants rarely share the
  same full set — dramatically shrinking the fraction of customers any single overloaded cell
  can affect.
- **Blast-radius math:** with C cells, a single-cell failure impacts ~`1/C` of traffic instead
  of 100%. This turns a total outage into a partial, survivable degradation.

> [!KEY-TAKEAWAY]
> Cells trade a little efficiency (each cell needs its own headroom, so you can't pool as
> tightly) for **bounded blast radius and bounded coordination cost** — the way to scale past
> the point where fleet-wide coordination or correlated failure dominates.

---

## Finding the Binding Constraint: USE Method & Golden Signals

To size capacity you must find the resource that saturates *first*. Two complementary
checklists (measurement mechanics live in `observability/*`; here they are *capacity* tools):

**USE method (Brendan Gregg)** — for **every resource** (CPU, memory, disk, network,
connection pools, threads), check:

| | Meaning | Why it's the capacity signal |
|---|---|---|
| **U — Utilization** | % of time the resource was busy. | Where you are on the hockey stick. |
| **S — Saturation** | Degree of *queued* work beyond what the resource can service (run-queue length, pool wait-queue, backlog). | **The leading capacity signal** — saturation climbs *before* utilization pins at 100%, and it's what actually breaks SLO. |
| **E — Errors** | Error events for the resource. | Often the first sign of a hit ceiling (pool timeouts, FD-exhaustion errors). |

Utilization alone lies: a resource can read "90% utilized" and be fine, or "70% utilized" with a
deep run-queue (already saturated for bursty work). **Saturation** — not %busy — is what you
provision against.

**Four Golden Signals (Google SRE):** latency, traffic, errors, **saturation**. The capacity
framing: *saturation is the fullness of your most-constrained resource — the thing you scale
on.* **RED** (Rate, Errors, Duration) is the request-driven complement. The vocabulary matters
in interviews: you scale on *saturation of the binding resource*, not on CPU by default.

---

## Open vs Closed Load Models

The coordinated-omission trap has precise vocabulary worth naming explicitly:

| Model | Arrival process | Behavior under stress | Real-world analogue |
|---|---|---|---|
| **Open workload** | Arrivals are **independent of responses** — new requests keep coming on a schedule (Poisson / constant rate) no matter how slow the system is. | A stall causes a **backlog** — queue and latency blow up, just like production. | Real internet traffic; users/other services don't wait for you. |
| **Closed workload** | A **fixed population of N virtual users**, each looping: send → wait for response → think-time → send again. Arrival rate is *throttled by the system's own latency*. | **Structurally cannot overload** past N in flight — when the system slows, the generator slows with it. Root cause of **coordinated omission**. | A fixed set of internal batch clients — rarely models a public endpoint. |

**Interview trap:** "your load test ran 500 VUs in a loop and reported great p99 — what's
wrong?" Answer: it's a *closed* model; it self-throttles and omits the queue that an open
arrival process would build, so it hides the tail and *cannot* find your true overload point.
Use **open-model / constant-arrival-rate** generators: `wrk2`, **k6** (constant-arrival-rate
executor), **Gatling** (open injection profile), **Vegeta**. JMeter's default thread-group is
*closed*. To reason about the true tail you must also separate **service time** (time actually
serving) from **response time** (service + queue wait) — coordinated omission hides the queue-wait
component.

---

## The Utilization, Throughput, and Latency Triangle

Three quantities are locked in a trade-off; you can favor **at most two**:

- **Throughput** (how much work per second),
- **Latency** (how fast each request completes, especially the tail),
- **Utilization** (how full the resource runs — i.e. cost efficiency).

You **cannot** simultaneously maximize throughput, minimize latency, *and* maximize utilization —
the `1/(1−ρ)` wall guarantees that pushing utilization toward 1.0 to maximize throughput destroys
latency. So capacity planning is choosing a corner: pick a **latency SLO** *or* a **throughput
target**, and **utilization is the dial that trades one for the other**. Latency-sensitive
services deliberately give up utilization (run cool, ~50–70%) to protect the tail; batch systems
give up latency to run hot (80–90%) and maximize throughput per dollar.

---

## Sizing to a Wait Target: Erlang C & Square-Root Staffing

Little's Law gives you the *mean* in-flight count; sometimes you must size to a **probability of
waiting** target (e.g. "≤1% of requests queue"). Queueing theory formalizes this.

- **Offered load** in **erlangs**: `E = λ · h` (arrival rate × mean holding/service time). This
  is exactly Little's Law's `L` — the average number of servers busy. 500 rps × 40 ms = 20
  erlangs = 20 servers just to keep up on average.
- **Erlang C** gives the probability an arrival must wait given `c` servers and offered load `E`.
- **Square-root staffing rule** (Halfin–Whitt regime): to hit a good service level,

```
servers ≈ E + c·√E          (c set by the target wait probability, typically ~1–2)
```

The key senior insight: the **safety term is √E, so required headroom grows only as the
*square root* of load** — meaning headroom *as a fraction* of load **shrinks as you get bigger**.
A 20-erlang service might need `20 + 2·√20 ≈ 29` servers (~45% headroom); a 2,000-erlang service
needs `2000 + 2·√2000 ≈ 2089` (~4.5% headroom). **Big fleets enjoy economies of scale in
reserve capacity; small services must run structurally cooler.** This is the quantitative answer
that beats hand-wavy "keep 30–50% headroom."

---

## Tail-Driven Capacity: Provision for the Tail, Not the Mean

Averages hide the requests that actually saturate you, so you size to **peak-of-peaks and to tail
latency**, not the mean. The sharpest case is **fan-out tail amplification** (Dean & Barroso,
*The Tail at Scale*): a request that fans out to many leaves and waits for the **slowest** one
sees the leaves' *tail*, not their median. If each of 100 leaves independently exceeds its p99
with probability 1%, the chance that *at least one* is slow is `1 − 0.99¹⁰⁰ ≈ 63%` — so a leaf's
p99 becomes roughly the **request-level median**. Consequences:

- A fan-out service must be provisioned against the **tail latency of its leaves**, not their
  mean — otherwise the aggregate request latency is dominated by stragglers.
- Mitigations (hedged/tied requests, more replicas so the tail shrinks) are *capacity* decisions:
  they cost extra headroom to buy tail predictability.

Provision so that even the **p99 of demand** stays left of the knee — sizing to the mean puts you
over the cliff during the bursts that averages smooth away.

---

## Analytical Capacity Models: Gray-Box & NALSD

Pure black-box load testing is slow and can't cover every future scenario. A **gray-box /
analytical model** builds capacity from a **per-request resource budget**:

```
required_capacity = forecast_request_rate × per-request cost of the BINDING resource
```

Measure the cost of one request in the currency of the bottleneck — **CPU-ms, disk IOPS, bytes
of network, DB rows read/written, lock-hold time** — then multiply by the forecast rate to size
the fleet, and **validate the model against a load test**. This is Google's **NALSD (Non-Abstract
Large System Design)**: back-of-the-envelope sizing ("this needs X CPU-seconds and Y GB/s, which
is Z machines") is the expected whiteboard technique in a design interview.

Crucially, model **per resource**: a launch might 2× requests but **5× DB writes** or 10× cache
memory. Sizing on "requests" alone misses the resource that actually binds. The loop is
**forecast → model/provision → load-test to validate → measure error → refine**, and you must
forecast **far enough ahead to cover the capacity lead time** (procurement, reserved-capacity
purchase, or scale-up latency).

---

## Retry Amplification, Thundering Herd & Correlated Demand

Two forces defeat the comfortable assumptions of headroom planning and statistical multiplexing.

**Retry amplification / retry storms.** When a service slows, clients retry — multiplying offered
load *exactly when you have the least capacity to serve it*, a self-inflicted spike. Naive retry
(1 retry) can **instantly ~2–3× load**; retries of retries compound. This is a *capacity
multiplier* you must either provision for or shed. Mitigations:

- **Exponential backoff with full jitter** — spread retries in time so they don't synchronize
  (AWS Builders' Library, "Timeouts, retries, and backoff with jitter"). Backoff *without* jitter
  just moves the herd to a later instant.
- **Retry budgets / token buckets** — cap retries to a small fraction (e.g. ≤10%) of requests;
  when the budget is exhausted, fail fast instead of retrying.
- **Circuit breakers** — stop hammering a failing dependency entirely (see
  `reliability-ops/circuit-breakers-and-bulkheads`).

**Thundering herd / correlated demand.** Statistical multiplexing ("aggregate peak < sum of
peaks") assumes demand is *uncorrelated*. It breaks when demand **synchronizes**: a cache entry
expires and every client stampedes the origin at once; all cron jobs fire at `:00`; every client
reconnects simultaneously after a network blip; a shared dependency or same-timezone diurnal peak
lines everyone up. When demand correlates, your bin-packing headroom **evaporates**. Mitigations:
**jittered TTLs, request coalescing / single-flight, jittered cron schedules**, and staggered
reconnect backoff.

> [!INTERVIEW]
> "Your bin-packing plan assumes uncorrelated demand — when does that break?" → thundering herd,
> synchronized retries, shared dependencies, same-timezone diurnal peaks. The mitigation theme is
> always the same: **add jitter and coalesce** to *de*-correlate.

---

## Provisioning Against Quotas and Limits

Real capacity ceilings are frequently **account/service quotas**, not hardware you can just add
(AWS Well-Architected Reliability, "Manage service quotas and constraints"). You can hit these
long before CPU: **API rate limits, Lambda concurrency limits, ENIs/EIPs per account,
connection limits, ephemeral-port and conntrack ceilings, per-partition throughput caps**. The
Kinesis OS-thread limit is the archetype.

Practices: **track quota headroom as a first-class metric**, and **request limit increases ahead
of the forecast** — many increases take days to approve and cannot be granted during an incident.
A launch plan that provisions compute but forgets to raise the downstream API quota or Lambda
concurrency will fail at the quota, not the CPU. Model *soft* and *hard* limits alongside
hardware in your capacity plan.

---

## Demand Shifting: Batch as a Shock Absorber

Beyond shed/queue/rate-limit on the *serving* path, deferrable work is a capacity lever: **shift
demand in time**. Interruptible/deferrable jobs — batch, ML training, backfills, report
generation — can be **scheduled into troughs** (overnight) or **preempted during peaks** to free
capacity for latency-sensitive traffic. Running them on **spot/preemptible instances** makes them
cheap *and* naturally interruptible. This complements the demand-shaping levers: instead of
shedding user traffic, you pause background work and hand its capacity to the serving path when
demand surges, then resume in the trough.

---

## Autoscaling Config in Practice: Numbers & Defaults

Concrete defaults interviewers expect you to reason about (verify current values against vendor
docs — they drift):

- **EC2 target-tracking** — you set a target (e.g. 50% CPU or a per-instance RPS target); default
  **scale-out is aggressive, scale-in has a longer cooldown** (classic-policy cooldown historically
  ~**300 s**). **Step scaling** adds capacity in tiers by breach magnitude; **target tracking** is
  simpler but can **oscillate** if the tracked metric is noisy or if the target interacts badly
  with provisioning lag (a control-theory instability — the loop over/under-shoots).
- **Predictive scaling** — needs history (roughly **24 h to 14 days**) and forecasts ~**48 h**
  ahead; pairs with dynamic scaling as the reactive backstop.
- **Warm pools** — keep instances pre-initialized (stopped/hibernated) to cut launch lag; trade
  standby cost for faster launch.
- **Kubernetes HPA** — default sync ~**15 s**, **tolerance ~10%** (won't act on small deltas),
  **scale-down stabilization window default 300 s**, scale-up more immediate; scales on
  CPU/memory or custom/external metrics.
- **Cluster Autoscaler / Karpenter** — add *node* provisioning lag on top of pod scheduling;
  HPA can want pods the cluster can't yet place.
- **KEDA** — event-driven scaling on queue depth / lag (e.g. SQS `ApproximateNumberOfMessages`
  or `ApproximateAgeOfOldestMessage`, Kafka consumer lag), including **scale-to-zero** — the right
  tool when the causal signal is backlog, not CPU.

**Load-balancer imbalance is a hidden capacity loss.** M/M/c math assumes *perfect* load
balancing. With hot shards, sticky sessions, or uneven hashing, **one instance hits its wall
while the fleet average looks fine at 60%** — and fleet p99 is driven by the hottest instance.
Always check per-instance saturation, not just the fleet average, or you'll "have headroom" on a
dashboard while a hot node is already over the cliff.

---

## Common Interview Follow-ups

- **"Why can't we run servers at 100% utilization?"** — Little's Law + `W = S/(1−ρ)`: near full
  utilization latency and queue depth diverge; no slack for variance, deploys, or failures.
- **"How much headroom should we keep?"** — Depends on cost of outage vs idle cost, spikiness,
  autoscaling speed, and shedding ability. For AZ redundancy, size so surviving AZs carry full
  peak (e.g. ≤2/3 util across 3 AZs).
- **"Traffic will 3× at a launch — how do you prepare?"** — Inorganic (top-down) forecast from the
  business, load/stress test to that level, pre-scale (scheduled) capacity + warm pools, verify
  downstream dependencies scale too, and have load shedding + a runbook ready as backstops.
- **"Our load test looks great but prod tail latency is terrible — why?"** — Suspect coordinated
  omission (closed-loop generator omitting samples during stalls); re-test with an open-workload
  tool (wrk2/k6) or HdrHistogram correction. Also check realistic traffic mix and dependency load.
- **"Autoscaling is on — why did we still have an outage during the spike?"** — Scale-up lag
  (minutes to boot/warm/register) can't keep up with a seconds-scale spike; need standing headroom,
  warm pools, and load shedding to bridge the gap. Or you scaled on the wrong metric.
- **"CPU-based autoscaling isn't working for our queue workers."** — Scale on **queue backlog / age
  of oldest message**, not consumer CPU; the backlog is the leading, causal signal.
- **"Is adding a queue enough to handle overload?"** — No. A queue smooths *bursts* but converts
  *sustained* overload into unbounded latency/memory. Use bounded queues + shedding/backpressure.
- **"Provisioned vs usable capacity?"** — Raw purchased capacity ≠ what you can serve at SLO;
  subtract utilization ceiling, overhead, and failure/spike headroom.
- **"We doubled the fleet and throughput went *down* — why?"** — USL β/coherency: per-node
  coordination cost grows O(N²), so past `N_max = √((1−α)/β)` more nodes subtract capacity. A
  mere *plateau* (not decline) is α/contention (Amdahl). Fix β by partitioning/cellularization;
  fix α by removing the serialization point. The Kinesis thread-limit outage is the archetype.
- **"The load test hit 50k rps at 20 ms p99, but prod fell over at 30k — reconcile."** —
  Closed-model generator (coordinated omission) + all-cache-hit synthetic data + no dependency
  load + LB imbalance hiding a hot node. Re-test open-model with realistic mix and per-instance
  saturation.
- **"How much headroom, quantitatively?"** — Square-root staffing: `servers ≈ E + c·√E`, so
  headroom grows as √load and *shrinks as a fraction* as you scale — big fleets run hotter, small
  services must run cooler.
- **"What's the real limit if it's not CPU?"** — Threads, FDs, ephemeral ports, conntrack, ENIs,
  connection-pool slots, a single lock, or an API/service quota. Use USE-method *saturation* per
  resource to find it, and track quota headroom ahead of the forecast.
- **"When does statistical multiplexing (aggregate peak < sum of peaks) break?"** — Correlated
  demand: thundering herd on cache expiry, synchronized retries, cron at `:00`, reconnect storms,
  same-timezone diurnal. De-correlate with jitter and request coalescing.
- **"Bigger queue, more retries, or shed under sustained overload?"** — Shed / backpressure.
  Unbounded queue = unbounded W (OOM); naive retries = amplification. Bounded queue + shed-on-full
  is correct.

## References

- Beyer, Jones, Petoff, Murphy (eds.), *Site Reliability Engineering* (Google), esp. ch. "Software
  Engineering in SRE / Handling Overload" and "Managing Load"; and *The Site Reliability Workbook*,
  "Managing Load."
- Michael T. Nygard, *Release It!* (2nd ed.) — stability patterns, capacity anti-patterns,
  Unbalanced Capacities, and load-management patterns.
- AWS Well-Architected Framework — **Reliability Pillar** ("Manage demand and supply resources",
  workload/service quotas) and **Cost Optimization Pillar** (right-sizing, demand-based supply).
- Gil Tene, "How NOT to Measure Latency" (talk) — the definitive treatment of **coordinated
  omission** and HdrHistogram.
- John D. C. Little, "A Proof for the Queuing Formula: L = λW" (1961); Kendall notation & M/M/1
  response-time results (standard queueing theory).
- AWS Auto Scaling docs — target tracking, scheduled scaling, and **predictive scaling**;
  warm pools.
- Brendan Gregg, *Systems Performance* — the USE method (Utilization/Saturation/Errors) and
  saturation/knee analysis.
- Neil J. Gunther, *Guerrilla Capacity Planning* — the **Universal Scalability Law**
  `X(N)=γN/[1+α(N−1)+βN(N−1)]`, contention (α) vs coherency (β), `N_max=√((1−α)/β)`, and
  retrograde scaling; Amdahl's Law as the `β=0` special case.
- AWS post-event summary, **Kinesis us-east-1 (25 Nov 2020)** — OS thread-count limit scaling
  with fleet size; adding capacity reducing capacity; cellularization fix.
- AWS Builders' Library — "**Workload isolation using shuffle-sharding**" (cell-based
  architecture, blast-radius reduction) and "**Timeouts, retries, and backoff with jitter**"
  (retry storms, full jitter, retry budgets/token buckets).
- Jeffrey Dean & Luiz André Barroso, "**The Tail at Scale**" (CACM 2013) — fan-out tail
  amplification and tail-tolerant techniques (hedged/tied requests).
- Erlang C / offered load (erlangs, `E = λh`) and the **square-root staffing rule**
  (`servers ≈ E + c√E`, Halfin–Whitt regime) — any standard queueing-theory text
  (e.g. Harchol-Balter, *Performance Modeling and Design of Computer Systems*).
- AWS Well-Architected **Reliability Pillar** — "Manage service quotas and constraints"; AWS
  Auto Scaling, EC2 target-tracking/step/predictive scaling and warm pools; Kubernetes HPA /
  Cluster Autoscaler / Karpenter / KEDA documentation.
- Google, "**Non-Abstract Large System Design**" (*The Site Reliability Workbook*, ch. 12) —
  back-of-envelope analytical capacity modeling.
