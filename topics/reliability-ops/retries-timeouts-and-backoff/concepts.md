# Retries, Timeouts & Backoff

This page covers the **most-asked resilience mechanism in backend/SRE interviews**: how a client
survives a slow or failing dependency without either hanging forever or making the failure worse.
The order matters. **Timeouts** come first — you cannot retry a call that never returns, so bounding
every wait is the foundation. **Retries** come second — but only for the right failures, or you
double-charge customers and amplify load. **Backoff and jitter** come third — they decide *when* the
retry fires so a fleet of clients does not synchronize into a self-inflicted DDoS. **Retry budgets**
cap the total, so retries can never become more than a small fraction of traffic.

Get this wrong and you build a **metastable failure**: a system that, once tipped over by a small
trigger, stays down under its own retry load even after the original trigger is gone.

This topic owns the **reliability mechanics** of these three controls. Neighbours: stopping retries
against a dead dependency is `circuit-breakers-and-bulkheads`; shedding load to protect yourself
(the server-side dual of client-side backoff) is `load-shedding-and-backpressure`; the theory of why
retries cause cascades lives partly in `cascading-failures-and-antipatterns`; dead-letter handling of
exhausted retries in async systems is a messaging concern (see `system-design`); and rate-limiting as
abuse-prevention is `security`, while rate-limiting *as a reliability mechanism* is here and in
`design-rate-limiter`. How you *measure/alert* on retry rates and timeout budgets is `observability`.

> [!KEY-TAKEAWAY]
> Four rules carry this whole topic. **(1) Never wait forever** — every network call needs a
> timeout, set from the dependency's measured p99 plus headroom, not a guess. **(2) Only retry
> idempotent + transient failures** — retrying a non-idempotent write can double-charge; retrying a
> 400 or a business error just wastes work. **(3) Never retry without backoff *and* jitter** —
> naked retries synchronize clients into a thundering herd. **(4) Cap retries with a budget** (e.g.
> ≤10% of requests) so a bad dependency can't multiply your outbound traffic.

---

## Timeouts: never wait forever

A **timeout** is the maximum time a caller will wait before abandoning an operation and treating it
as failed. The default behaviour of most network libraries is to wait **effectively forever** (or
until an OS-level TCP timeout minutes later), and that is the single most common reliability bug in
production: a slow dependency doesn't return errors, it **holds your threads/connections hostage**
until your own thread pool is exhausted and *you* fall over. A timeout converts an unbounded hang
into a fast, bounded failure you can then handle (retry, fall back, or shed).

> [!WARNING]
> The absence of a timeout is worse than a short one. Nygard's *Release It!* calls the unbounded
> wait the root of most cascading failures: the failure of a downstream service propagates upstream
> as **resource (thread/connection) exhaustion**, not as an error. Slow is the new down.

There are **distinct timeouts** at different layers, and interviewers expect you to name them:

| Timeout | What it bounds | Typical value |
|---|---|---|
| **Connect timeout** | Establishing the TCP/TLS connection (handshake). Failing here usually means the host is down/unreachable. | Short — 100 ms–1 s (LAN is fast; a slow connect = dead host) |
| **Read / socket / response timeout** | Waiting for bytes *after* the request is sent — the server's processing time. | Set from server p99 + headroom |
| **Request / call timeout (overall)** | End-to-end deadline for the whole call including retries. The one that matters to the user. | Derived from the caller's own SLA |
| **Idle / keep-alive timeout** | How long an unused pooled connection stays open. | Seconds to minutes |

A connect timeout and a read timeout are **not** the same thing, and a common bug is setting only
one. A short connect timeout catches dead hosts fast; the read timeout catches slow processing.

> [!TIP]
> Prefer **deadlines** (an absolute "finish by 12:00:00.500") over **relative timeouts** ("wait
> 500 ms") for anything that crosses service boundaries. A deadline can be propagated down the call
> chain (gRPC does this natively) so every hop knows how much time is truly left, and no hop wastes
> effort on a request the caller has already given up on. Relative timeouts reset at each hop and
> silently blow the end-to-end budget.

---

## How to pick a timeout value

The naive approach — "round number that feels safe," e.g. 30 s — is an anti-pattern: it's far too
long to protect you (30 s of held threads is an eternity) and provides no real bound. The
data-driven approach:

1. **Measure the dependency's latency distribution** — specifically **p99 (or p99.9)**, not the
   mean. The mean hides the tail, and it is the tail that causes timeouts.
2. **Set the read timeout to p99 + headroom** — a common heuristic is the p99.9 latency, or p99 ×
   a small multiplier. You want to time out the genuinely-stuck calls while letting the normal
   slow-tail succeed.
3. **Account for retries in the *overall* budget.** If one attempt is bounded at 300 ms and you
   allow 2 retries, the worst-case wall-clock is ~900 ms plus backoff — which must still fit inside
   what *your* caller will tolerate.

The core tension:

- **Too short** → you abandon requests that would have succeeded, turning tail-latency into
  errors, and (if you then retry) you add load to an already-slow dependency. You can convert a
  latency blip into an availability outage.
- **Too long** → threads/connections pile up during a slowdown, your pool exhausts, and the
  dependency's slowness becomes *your* outage. You lose the fast-failure benefit entirely.

> [!INTERVIEW]
> "How do you choose a timeout?" A strong answer never says a number first. It says: *measure the
> downstream p99/p99.9 under load, set the per-attempt read timeout just above that with headroom,
> then work out the overall deadline from my own SLA and back-solve how many retries fit inside it.
> I revisit it as the dependency's latency profile changes.* Then, and only then, offer a ballpark.

---

## Timeout budgets across a call chain

In a layered system A → B → C → D, timeouts must **shrink as you go down** the chain. This is the
**timeout budget** (or deadline propagation): each caller's timeout must be *shorter* than its
own caller's remaining budget, minus the time already spent and a margin for the caller's own work.

The failure mode when you ignore this: **A** times out at 1 s, but **B** calls **C** with a 3 s
timeout. When C is slow, B keeps waiting for 3 s — but A already gave up at 1 s and (worse) may have
retried, so B is now doing work for a request nobody is waiting for. This wastes capacity exactly
when the system is under stress. The rule: **inner timeouts < outer timeouts.**

```mermaid
flowchart LR
    A["Client<br/>deadline 1000 ms"] --> B["Service B<br/>budget 900 ms"]
    B --> C["Service C<br/>budget 600 ms"]
    C --> D["Service D<br/>budget 300 ms"]
```

Each hop subtracts the time it needs for its own processing plus a safety margin, and passes the
**remaining** deadline down. gRPC and many RPC frameworks propagate the deadline automatically; with
plain HTTP you pass a header (e.g. an `X-Request-Deadline`) or compute it explicitly. If a hop
receives a request whose deadline has *already* passed, it should **fail fast without doing the
work** — this is "deadline-aware" behaviour and it reclaims capacity during overload.

> [!WARNING]
> A subtle amplification: if the total end-to-end budget is 1 s and you let each of 3 layers retry
> twice, the *inner* layers can burn the whole budget on retries and leave nothing for the outer
> ones — or blow past 1 s entirely. Timeout budgets and retry budgets must be designed **together**.

---

## Retries: when they help and when they hurt

A **retry** re-issues a failed request in the hope that the failure was **transient** — a brief
network blip, a momentary connection reset, a leader election, a request that hit a node mid-restart.
Retries are cheap insurance against the vast class of failures that resolve themselves in
milliseconds. But a retry is only safe under **two simultaneous conditions**:

1. **The failure is transient / retryable**, not permanent. Retrying a permanent failure just
   wastes work and adds load.
2. **The operation is idempotent** (or made idempotent), so re-executing it can't cause harm.

**What to retry vs. what never to retry:**

| Failure | Retry? | Why |
|---|---|---|
| Connection timeout / reset, `ECONNREFUSED` | Yes | Transient network / host restart |
| HTTP 503 Service Unavailable, 502, 504 | Yes (with backoff) | Server overloaded or restarting — but back off |
| HTTP 429 Too Many Requests | Yes — **honour `Retry-After`** | You're being throttled; retrying immediately makes it worse |
| Read timeout on an idempotent GET | Yes | Safe to repeat |
| HTTP 400 Bad Request / 422 | **No** | Malformed request; retrying sends the same bad request forever |
| HTTP 401 / 403 | **No** | Auth won't fix itself by retrying |
| HTTP 404 | **No** | Resource genuinely absent |
| Business-logic rejection (e.g. "insufficient funds") | **No** | Not a fault; the answer won't change |
| Read timeout on a **non-idempotent** POST/charge | **Only if idempotent-keyed** | You don't know if it committed — see below |

> [!WARNING]
> **Retrying a non-idempotent write is how you double-charge a customer.** If a `POST /charge`
> times out, the request may have *succeeded* on the server and only the response was lost. Blindly
> retrying charges twice. The fix is an **idempotency key**: the client sends a unique key with the
> request, the server records it, and a retry with the same key returns the original result instead
> of re-executing. This makes the write idempotent and safe to retry. (Payment APIs like Stripe
> require exactly this.)

Additional retry discipline:
- **Cap the attempts** (e.g. 2–3 total). Unbounded retries turn one failure into an infinite loop.
- **Retry idempotent operations only**, or use idempotency keys / conditional writes for the rest.
- **Don't retry client errors (4xx)** — they're deterministic; the same request fails the same way.
- **Respect `Retry-After`** on 429/503 — the server is telling you when it's safe.

---

## Retry storms & the thundering herd

A **retry storm** (a form of **thundering herd**) is the pathology at the heart of this topic. When
a dependency slows or briefly fails, *every* client times out at *roughly the same time* and *all
retry at once*. That synchronized burst of retries **adds load precisely when the dependency is
least able to handle it**, keeping it down. Worse, if each client retries N times, a dependency
struggling with X requests now sees up to **X × (1 + N)** requests — the retries can exceed the
original traffic. This is **load amplification**.

This is the classic **metastable failure**: a small trigger (a brief latency spike, a deploy, a
cache flush) tips the system into a state where the *retry load it generates* is enough to keep it
down **even after the original trigger is gone**. The system has two stable states — healthy and
collapsed — and retries provide the positive feedback loop that holds it in the collapsed one.
Recovery often requires *reducing* load below normal (shedding traffic, "draining the storm") before
the system can climb back out.

```mermaid
flowchart TD
    T["Trigger: brief latency spike / deploy"] --> TO["Many clients hit timeout simultaneously"]
    TO --> R["All clients retry at the same instant"]
    R --> AMP["Load amplified N-fold on a weakened dependency"]
    AMP --> SLOW["Dependency stays overloaded"]
    SLOW --> TO
    SLOW -.->|feedback loop keeps it down| AMP
```

The three defences, in combination, break this loop:
1. **Backoff** — spread retries out over time so they don't all land at once.
2. **Jitter** — randomize the timing so clients *de-synchronize* from each other.
3. **Retry budgets / circuit breakers** — cap total retries and stop retrying a dependency that's
   clearly dead (see `circuit-breakers-and-bulkheads`).

> [!KEY-TAKEAWAY]
> Retries are the most common *cause* of cascading failure, not just a cure for transient errors.
> The instinct "add retries for reliability" is dangerous without backoff, jitter, and a budget.

---

## Backoff: fixed vs exponential

**Backoff** is the delay a client waits before retrying. It converts an instant re-hammer into a
paced sequence, giving the dependency room to recover.

- **No backoff (immediate retry):** worst option under load — it's the thundering herd on fast-
  forward. Only defensible for a single immediate retry of a genuinely instantaneous blip.
- **Fixed / constant backoff:** wait the same delay each time (e.g. 200 ms). Simple, but clients
  that failed together stay synchronized — they just re-collide every 200 ms.
- **Exponential backoff:** the delay grows multiplicatively with each attempt. The standard formula:

  ```
  delay = min(cap, base * 2^attempt)
  ```

  where `base` is the initial delay (e.g. 100 ms), `attempt` is the 0-based retry number, and `cap`
  is a ceiling (e.g. 20 s) so the delay doesn't grow without bound. With base = 100 ms:
  attempt 0 → 100 ms, 1 → 200 ms, 2 → 400 ms, 3 → 800 ms, … capped at `cap`. This rapidly backs off
  a persistently failing dependency while still retrying transient blips quickly.

The **cap** matters: without it, `2^attempt` explodes into minutes and hours. Capped exponential
backoff is the industry default.

| Strategy | Timing | Synchronization risk | Use when |
|---|---|---|---|
| Immediate (no backoff) | 0 | **Very high** | Almost never; at most one quick retry |
| Fixed | constant | High (clients stay in lockstep) | Simple internal calls, low fan-out |
| Exponential (capped) | `min(cap, base·2ⁿ)` | Reduced, but still clustered without jitter | The default for most retries |
| Exponential + jitter | randomized around the curve | **Low** | The recommended production default |

> [!WARNING]
> Exponential backoff **alone** does not solve the herd. If 10 000 clients all failed at t=0, they
> all wait 100 ms, then all wait 200 ms — they retry in synchronized waves. Backoff spreads a single
> client's retries over time; it does **not** de-correlate *different* clients. That's what jitter is
> for.

---

## Jitter: full, equal & decorrelated

**Jitter** adds controlled randomness to the backoff delay so that clients which failed together
retry at *different* times, smoothing the retry load from spiky waves into a flat trickle. AWS's
canonical article *"Exponential Backoff and Jitter"* (Marc Brooker) showed via simulation that
adding jitter dramatically reduces contention and total work compared to backoff alone — it is not
optional polish, it is the point.

Given `base` and a capped exponential ceiling, the three named variants:

| Variant | Formula | Behaviour |
|---|---|---|
| **No jitter** | `delay = min(cap, base·2^n)` | Deterministic; clients stay synchronized |
| **Full jitter** | `delay = random(0, min(cap, base·2^n))` | Pick uniformly between 0 and the exponential ceiling. **Maximum spread**; AWS's recommended default. |
| **Equal jitter** | `temp = min(cap, base·2^n); delay = temp/2 + random(0, temp/2)` | Half fixed, half random. Guarantees a minimum wait while still spreading. |
| **Decorrelated jitter** | `delay = min(cap, random(base, prev_delay·3))` | Uses the *previous* delay to seed the next; grows well and spreads widely without unbounded growth. |

In AWS's simulations, **full jitter** and **decorrelated jitter** both performed best — full jitter
minimized the total number of calls and completed work fastest under contention. Equal jitter is a
reasonable choice when you want to guarantee some minimum delay (e.g. to avoid a near-instant retry).

> [!TIP]
> The single most impactful, cheapest change you can make to a retrying client is: **add full jitter
> to your exponential backoff.** It costs one `random()` call and prevents the synchronized-wave
> failure mode. If you remember one formula from this topic, remember
> `sleep = random(0, min(cap, base * 2^attempt))`.

```mermaid
flowchart LR
    F["Failure at t=0"] --> NB["No jitter:<br/>all retry at 100ms, 200ms, 400ms<br/>(spiky waves)"]
    F --> FJ["Full jitter:<br/>retries spread uniformly<br/>(flat, smooth load)"]
```

---

## Retry budgets & token buckets

A **retry budget** caps the *total* amount of retrying a client (or client fleet) may do, expressed
as a fraction of the underlying request rate — e.g. **retries may add at most 10% on top of the
primary request traffic.** This is the safety net that guarantees retries can *never* amplify load
into a storm, no matter how many individual requests are failing. It's implemented with a **token
bucket**:

- Every successful/primary request adds a token (or the bucket refills at a rate proportional to
  request throughput).
- Every retry **spends** a token.
- The bucket's size / refill rate is set so retries are capped at, say, 10–20% of requests.
- **When the bucket is empty, retries are suppressed** — the client returns the error immediately
  rather than retrying.

The elegance: when a dependency is healthy, failures are rare, the bucket stays full, and retries
are always available for the occasional transient blip. When the dependency is **broadly failing**,
the failure rate spikes, the bucket drains fast, and retries are automatically throttled off — you
stop hammering a dead dependency. This is the fleet-wide analogue of a circuit breaker and is how
gRPC's built-in retry policy and Google's client libraries bound retry amplification.

| Mechanism | Scope | What it limits |
|---|---|---|
| Max attempts (e.g. 3) | Single request | How many times *one* request retries |
| Retry budget / token bucket | Whole client or fleet | What *fraction* of all traffic can be retries |
| Circuit breaker | Per dependency | Whether to attempt the dependency *at all* right now |

> [!INTERVIEW]
> "You already have exponential backoff and jitter — why also need a retry budget?" Because backoff
> and jitter fix the *timing* (when retries land) but not the *volume*. If 100% of requests are
> failing, backoff+jitter still lets every request retry — just spread out — which is still up to
> N× the traffic on a struggling dependency. The budget caps the *total*, so a wholesale outage
> can't be amplified regardless of timing. Timing and volume are orthogonal problems.

---

## Retry amplification in layered systems

The most dangerous retry mistake in a microservice architecture is **retrying at every layer**. If
each layer in a chain independently retries R times, the load multiplies **exponentially with
depth**. For a chain of depth D where each layer retries so it makes R attempts:

```
total requests at the bottom = R^D
```

With 3 retries (R=3) and 4 layers deep (D=4), a single top-level request can become **3⁴ = 81**
requests hitting the bottom service. A modest failure at the leaf turns into a crushing, self-
amplifying flood by the time every layer above it has multiplied its retries.

```mermaid
flowchart TD
    U["1 user request"] --> A["Layer A: 3 attempts"]
    A --> B["Layer B: 3× = 9"]
    B --> C["Layer C: 3× = 27"]
    C --> D["Layer D: 3× = 81 hits on the failing leaf"]
```

The rule of thumb from Google's SRE book: **retry at a single level of the stack** — usually the
level closest to the failure that has enough context to know the failure is transient, or the level
closest to the user. Layers in between should **fail fast and propagate the error up**, not add their
own retries. If you must retry at multiple levels, use **retry budgets at each level** and make lower
levels report "I already retried; don't retry me" (e.g. a response header) so the caller doesn't
re-multiply.

> [!WARNING]
> This is why "just add a retry, it improves reliability" is a trap in a large system. Every team
> adding a local retry seems locally reasonable; the *composition* is a load bomb. Retry policy is a
> system-level concern, not a per-call one.

---

## Putting it together & interaction with circuit breakers

A robust client-side resilience policy layers these controls, and they must be **tuned together**:

1. **Timeout** every call (connect + read), value from the p99 + headroom.
2. **Retry** only idempotent + transient failures, capped at 2–3 attempts.
3. **Backoff exponentially** with a cap.
4. **Add full jitter** to de-synchronize clients.
5. **Bound the total** with a retry budget (token bucket).
6. **Wrap it in a circuit breaker** so a *sustained* failure stops retries entirely and fails fast.

Backoff/retry and circuit breakers are complementary, not redundant: **backoff+jitter handles
transient, per-request failures; the circuit breaker handles sustained, dependency-wide failures.**
When a dependency is truly down, retrying (even with perfect backoff) still wastes latency budget on
every request — the breaker trips open and skips the attempt entirely, giving the dependency room to
recover and giving your callers instant failures/fallbacks. See `circuit-breakers-and-bulkheads` for
the state machine (closed → open → half-open) and `graceful-degradation-and-fallbacks` for what to
serve when the breaker is open.

A concrete Resilience4j-style composition (order matters — retry wraps circuit breaker wraps the
call, so the breaker sees each attempt):

```java
// Resilience4j: timeout + retry (exp backoff + jitter) + circuit breaker
var timeLimiter = TimeLimiter.of(Duration.ofMillis(300));           // per-attempt read timeout
var retry = Retry.of("charge", RetryConfig.custom()
    .maxAttempts(3)
    .intervalFunction(IntervalFunction.ofExponentialRandomBackoff(  // 100ms base, x2, full-ish jitter
        Duration.ofMillis(100), 2.0, 0.5))
    .retryOnResult(r -> r.status() == 503 || r.status() == 429)     // transient only
    .build());
var breaker = CircuitBreaker.of("charge", CircuitBreakerConfig.custom()
    .failureRateThreshold(50)            // open if >50% of calls fail
    .waitDurationInOpenState(Duration.ofSeconds(10))
    .build());
// decorate: retry(circuitBreaker(timeLimiter(call)))
```

For **async / messaging** systems the shape differs: instead of in-line retries you use a **retry
queue with a delay** and, after N attempts, route to a **dead-letter queue (DLQ)** for manual/offline
handling — this keeps the failing message from blocking the pipeline. That's a messaging-design
concern; see `system-design` for DLQ patterns.

---

## Hedged & tied requests: attacking the tail

Retries fire on a **failure**. Hedged requests fire on **slowness** — and slowness (tail latency) is
a separate problem retries do not touch. This is the single most important senior-level concept
missing from a "retries + backoff" story, and it comes from Dean & Barroso's **"The Tail at Scale"**
(CACM, Feb 2013).

- **Hedged request:** send the request to one replica, then if it hasn't returned by a high
  percentile of the expected latency (the paper uses the **95th percentile**), send a *second*
  copy to another replica and take **whichever returns first**, cancelling the loser. Because you
  only hedge the slow ~5% of requests, the extra load is tiny. The paper's real number: in Google
  **BigTable**, hedging reads after the 95th percentile cut **99.9th-percentile latency from
  1800 ms to 74 ms while adding only ~2% more requests**. (Re-verify the exact figures against the
  paper if quoting precisely.)
- **Tied request:** enqueue the request at **two servers at once**, each tagged with the identity of
  its "tie." When one server *dequeues and starts executing*, it sends a cancellation to the other.
  This nearly eliminates the duplicate *work* (only the small queue-crossing window is redundant).
  In BigTable, tied requests cut **median latency ~16%** and **99.9th ~40%** while adding **<1%**
  extra disk reads.

**Hedge vs retry — say this crisply in an interview:**

| | Retry | Hedge |
|---|---|---|
| Trigger | A **failure** (error/timeout) | **Slowness** (crossed a latency percentile) |
| Timing | **Sequential / reactive** — wait for attempt 1 to fail, then try | **Parallel / speculative** — attempt 2 launched *while* 1 is still running |
| Attacks | **Availability** (transient errors) | **Tail latency** (p99.9) |
| Cost | ~0 when healthy | A few % extra load (only the slow tail is duplicated) |
| Safety | Needs idempotency for writes | **Same** — hedging a non-idempotent write double-executes unless idempotency-keyed / tied+cancelable |

**gRPC exposes hedging as first-class config**: a `hedgingPolicy{ maxAttempts, hedgingDelay,
nonFatalStatusCodes }`. Setting `hedgingDelay: "0s"` fires all copies at once (pure speculation); a
positive delay is the classic "fire the hedge after X." A successful response cancels the outstanding
hedges. Crucially, **`retryPolicy` and `hedgingPolicy` are mutually exclusive on one method** — a call
is either retried or hedged, not both.

> [!INTERVIEW]
> "p99 is fine but p99.9 is terrible and you can't touch the server — what client-side technique
> helps and what does it cost?" The answer is **hedged requests fired past ~p95**, costing a few
> percent extra load, and requiring the operation be idempotent (or cancelable/tied) so the loser
> can't cause a duplicate side effect. Candidates who reach for "add retries" here have conflated
> slowness with failure.

---

## Cancellation propagation

Deadline propagation tells every hop *how much time is left*; **cancellation** actively tells a hop
to **stop now**. They're a pair. When the caller hits its deadline, gives up, or a **hedge winner**
returns, the in-flight losing/abandoned work should be **actively cancelled** — otherwise it keeps
burning CPU, threads, connections, and downstream capacity for a result nobody will read. This is the
same wasted-capacity problem the timeout-budget section warns about; cancellation is the *fix*.

- **gRPC**: cancelling the client `Context` propagates a cancellation down the call tree; well-behaved
  servers observe `ctx.Done()` / `context.Canceled` and abandon the work (and their own downstream
  calls) immediately.
- **HTTP**: aborting the request (e.g. `AbortController`, closing the connection) signals the server;
  servers should check for client-gone and stop.
- **Hedging without cancellation is a load multiplier** — every hedge that isn't cancelled on a
  winner doubles the work for the slow tail permanently. The cancel is what keeps the cost at "~2%."

> [!WARNING]
> Deadline propagation alone still leaves **orphaned work**: hop D happily computes for 3 s for a
> request A abandoned at 1 s unless A's cancellation reaches D. Under overload, orphaned work is
> exactly the capacity you can't spare.

---

## Little's Law: why a timeout protects your pool

The quantitative backing for "slow is the new down." **Little's Law**: for a stable system,

```
L = λ × W
```

where **L** = average number of in-flight requests (concurrency), **λ** = arrival rate, and
**W** = average time each request spends in the system (latency). A **timeout caps W**. Capping W
caps **L** — the concurrency, i.e. the number of threads/connections simultaneously occupied.

Worked example: a dependency normally answers in 20 ms, and you receive **λ = 500 req/s**. Then
`L = 500 × 0.02 = 10` concurrent calls — a 20-thread pool is comfortable. Now the dependency stalls
to **2 s** with *no timeout*: `L = 500 × 2 = 1000` concurrent calls demanded against a 20-thread pool
→ the pool is exhausted in ~40 ms and every subsequent caller blocks. Set a **250 ms timeout** and
the worst case is `L = 500 × 0.25 = 125` — still over 20, so you *also* need load-shedding or a
bulkhead, but the timeout has bounded the blast radius from "unbounded" to a number you can reason
about. **A timeout is the term that makes L finite.**

> [!INTERVIEW]
> "Prove numerically that a timeout protects your thread pool." Little's Law: L = λ·W. Without a
> timeout W is unbounded, so L grows until the pool is exhausted. Bounding W with a timeout bounds L;
> pick the timeout (with shedding) so L stays below pool size at your peak λ.

---

## Production retry-config defaults (real numbers)

Formulas are necessary but interviewers also probe whether you've *operated* these systems. The
canonical concrete defaults:

**AWS SDK retry modes** (botocore / AWS SDK for Java v2):
- **legacy** — up to **5 total attempts**.
- **standard** — **3 total attempts**, exponential backoff with **base 2** and **max backoff 20 s**;
  retries 500/502/503/504 plus an expanded set of throttling errors.
- **adaptive** — standard **plus client-side rate limiting** (a token bucket that slows the send rate
  when throttled). Documented as experimental/aggressive; use with care.
- **Retry-quota token bucket** (a *client-side circuit breaker on retries*, separate from max-attempts):
  the bucket starts at **500 tokens**; a **retry costs 5**, a **transient/timeout error costs 10**, a
  **successful retry refills 5**, a **successful first-try refills 1**. When the bucket is empty,
  **retries are suppressed** even though `max_attempts` wasn't reached. This is the real reason an SDK
  "stops retrying mid-outage" — by design, so a fleet stops hammering a down service.

**gRPC retry policy** (gRFC A6):
- `maxAttempts` is **capped at 5** by the server-side limit.
- Backoff uses jitter of **±0.2** (each delay multiplied by `random(0.8, 1.2)`).
- `retryThrottling { maxTokens (≤ 1000), tokenRatio }`: **every failed RPC subtracts 1 token, every
  success adds `tokenRatio`, and retries stop once `token_count ≤ maxTokens/2`** (the *half* threshold,
  not empty). Example `maxTokens: 10, tokenRatio: 0.1` throttles at roughly a 10% failure rate.
- Server can return **`grpc-retry-pushback-ms`** metadata (gRPC's Retry-After analogue); a
  **negative** value means "do not retry at all."

**Envoy** (a good name-drop for service-mesh contexts):
- `x-envoy-max-retries` and `retry_on` conditions (`5xx`, `reset`, `retriable-status-codes`, …).
- **Per-try timeout** distinct from the overall route timeout — each attempt is bounded separately.
- **Retry budgets**: `retry_budget.budget_percent` (default **20%** of a cluster's active requests)
  plus `min_retry_concurrency` (default **3**) — a cluster-level token analogue to the SRE budget.

---

## Cooperative retry limiting & the "don't retry" signal

Client-side budgets bound *your* fleet, but a deep call graph needs the layers to cooperate so retries
don't re-multiply. Google's SRE **"Handling Overload"** chapter gives the definitive mechanism and the
exact numbers interviewers quote:

- **Per-request retry budget:** at most **3 attempts** per logical request.
- **Per-client retry budget:** a client stops retrying once **retries / requests ≥ 10%**.
- **Why both:** with *only* the per-request budget, a broad failure can inflate load to just under
  **3×**. Adding the **10% per-client** budget reduces that growth to about **1.1×**. (This is the
  concrete version of the loose "≈10%" figure.)
- **Retry-attempt counter in metadata:** each request carries a counter (0, incremented on each retry,
  **capped at 2**). Backends keep **histograms of that counter**; when they see widespread retrying,
  they can react.
- **"Overloaded; reject" vs normal retryable error:** when only *one task* is overloaded, it returns a
  normal retryable error and the client tries another task. When the **whole datacenter/backend pool**
  is overloaded, backends return a distinct **non-retryable "overloaded; don't retry"** status so
  clients stop escalating load. This is the cooperative answer to "how do you stop layered retry
  amplification" — better than each layer guessing in isolation.

> [!INTERVIEW]
> "A 5-layer chain each retries 3×; give the amplification and the correct fix." Up to **3⁵** at the
> leaf. Fix: retry at only the layer immediately above the rejecter, propagate the **"overloaded;
> don't retry"** signal, embed the **retry-count-in-metadata (cap 2)**, and cap each client at the
> **10% per-client budget** (3× → ~1.1×).

---

## Idempotency keys: server-side design

The client side ("send a unique key") is easy; interviewers push on the **server-side lifecycle**,
where the correctness lives.

1. **Record the key on first receipt**, in a store keyed by the idempotency key, with a state:
   **`in-progress`** vs **`completed`**. Persist the *response* alongside `completed`.
2. **On replay:** if the key is `completed`, **return the stored response verbatim** without
   re-executing the side effect. If `in-progress`, the original is still running — the retry should
   **wait or return "in progress"** (e.g. 409/425), never execute in parallel.
3. **Concurrent-retry race:** two retries can arrive at nearly the same instant. You need a
   **unique constraint / atomic insert / lock** on the key so exactly one wins the "first" slot and
   the other sees `in-progress`. Without this, both execute and you double-charge — the very bug the
   key was meant to prevent.
4. **TTL / expiry:** keys are retained for a window (Stripe uses **~24 h**), then garbage-collected.
   A replay after expiry is treated as new — acceptable because legitimate retries happen within
   seconds/minutes, not days.
5. **Scope the key** to the operation (and often the account) so a key can't accidentally short-circuit
   a *different* request.

**Natural idempotency:** `PUT` and `DELETE` are idempotent by HTTP semantics (setting/removing the same
resource repeatedly lands in the same state); **`POST` is not** (each creates a new resource) and is
exactly what needs an idempotency key. `GET`/`HEAD` are safe.

> [!KEY-TAKEAWAY]
> **"Exactly-once" delivery is an illusion.** The network can always lose the ack, forcing a resend.
> What you actually build is **at-least-once delivery + idempotent processing = *effectively-once***.
> An idempotency key is how you make the processing idempotent.

---

## Which errors are retryable: the subtle cases

The main table covers the obvious codes; seniors get asked the edges.

- **408 Request Timeout** — **retryable** (server didn't get a complete request in time).
- **409 Conflict** — usually **not** retryable without changing the request (a concurrent-modification
  conflict won't resolve by resending the same thing); revalidate/re-read first.
- **425 Too Early** — the server declined a replayed early-data request; **retry without early data**.
- **429 / 503** — retryable **and** both may carry **`Retry-After`**.
- **gRPC codes:** `UNAVAILABLE`, `RESOURCE_EXHAUSTED`, `DEADLINE_EXCEEDED` are generally retryable
  (transient); `INVALID_ARGUMENT`, `FAILED_PRECONDITION`, `NOT_FOUND`, `PERMISSION_DENIED` are not.
  `ABORTED` signals a concurrency conflict — retryable, but often at a higher level after re-reading
  state, not a blind resend.
- **The rule that overrides the table:** a **read timeout on a non-idempotent write is *ambiguous*** —
  the write may already have committed server-side. It *looks* like a transient error, but retrying it
  is **not safe without an idempotency key**. Never let "the error looks transient" outweigh "the
  operation isn't safe to repeat."

**`Retry-After` specifics:** two formats — a **delay-seconds integer** (`Retry-After: 120`) or an
**HTTP-date** (`Retry-After: Wed, 21 Oct 2025 07:28:00 GMT`). Honor it — but **still add jitter on top**.
If every throttled client obeys the exact same server-suggested instant, they **re-synchronize into a
fresh herd** at that instant. The server hint sets the floor; jitter spreads the landing.

> [!WARNING]
> "Client honors Retry-After from a 503 — what's the hidden failure mode?" Every client wakes at the
> *same* server-specified time → a re-synchronized thundering herd. Honor the hint, then jitter around it.

---

## What backoff is actually for (and its limits)

A subtle senior point from Marc Brooker's **"What is Backoff For?"**: with **many competing clients**,
**backoff alone barely helps** — it's **jitter** that does the real work of de-synchronizing them.
Backoff's main job is to limit a **single** client's *self-inflicted* load (stop one client hammering).
Don't oversell backoff as a fleet-wide fix; pair it with jitter and a budget.

Two failure modes of the "circuit breaker on retries" idea worth naming:
- **Client-side retry breakers can trip too early.** Each client trips **independently** on its own
  observed failures, so during a *partial* outage a fleet of breakers collectively over-reacts — they
  can start shedding at roughly **half** the true failure rate, turning a partial problem into a
  bigger self-inflicted one.
- **Token-bucket budgets fail the opposite way with many short-lived clients** (serverless / lambda):
  a fresh client's bucket starts full and the process dies before the bucket drains, so the budget
  **never engages** — it can't throttle traffic it never accumulates state for.

The practical read: prefer a **retry-only budget/breaker that still allows first-try traffic** over a
breaker that blocks the primary request, and size buckets for your client lifetime. There is no single
knob; it's a genuine trade-off between over-reacting (independent breakers) and under-reacting
(ephemeral buckets).

---

## Canonical retry-storm incidents

Naming a real incident signals operational experience.

- **AWS DynamoDB, 20 Sep 2015 (us-east-1).** A brief spike in metadata-service latency caused storage
  servers to fail their internal **membership/partition-metadata lookups**, and they **retried**. The
  retry load held the metadata service in a **metastable** collapse: the trigger was gone but the
  sustaining retry feedback kept it down. Recovery required **reducing load / pausing the retries**,
  not just fixing the original latency. The textbook production example of everything in this topic.
- **AWS Kinesis, 25 Nov 2020 (us-east-1).** Adding front-end capacity pushed the fleet past an **OS
  thread limit**; threads/connections exhausted and the fleet cascaded — a "**slow/exhausted is the new
  down**" resource-exhaustion cascade rather than a clean error.
- **Ur-sources for the theory:** Google SRE **ch. 22 "Addressing Cascading Failures"** (the positive
  feedback loop) and **Bronson et al., "Metastable Failures in Distributed Systems," HotOS 2021**,
  which gives the vocabulary interviewers now use: a **trigger** vs a **sustaining effect**, **work
  amplification**, and the key insight that **recovery needs the sustaining effect (usually retries)
  removed, not just the trigger**.

---

## Common Interview Follow-ups

- **"Walk me through choosing a timeout for a downstream call."** Measure its p99/p99.9 under load,
  set the per-attempt read timeout just above that with headroom, distinguish connect vs read
  timeouts, derive the overall deadline from your own SLA, and back-solve how many retries fit.
- **"Your service double-charged a customer during a network blip. What happened and how do you fix
  it?"** A non-idempotent POST timed out after committing; the retry re-executed it. Fix with an
  idempotency key the server dedupes on.
- **"Adding retries made an outage worse. Explain."** Retry storm / metastable failure: synchronized
  retries amplified load N× on a weakened dependency and held it down. Fix: backoff + jitter + retry
  budget + circuit breaker, and retry at only one layer.
- **"Why isn't exponential backoff enough — why add jitter?"** Backoff spreads one client's retries
  over time but leaves *different* clients synchronized; jitter de-correlates them so retry load is
  smooth, not spiky. Full jitter minimizes total work (AWS).
- **"You have backoff and jitter already. Why also a retry budget?"** Jitter fixes *when* retries
  land; the budget fixes *how many*. At 100% failure, timing spreading still permits N× volume; the
  budget caps the fraction of traffic that can be retries.
- **"A dependency is slow (not erroring). Do you retry?"** Usually no — retrying a slow dependency
  adds load and makes it slower. Time out fast, consider shedding load or a fallback, and let a
  circuit breaker trip. Retrying is for *failures*, not *slowness*.
- **"How many retries at each layer of a 4-deep call chain?"** Ideally retry at exactly one layer;
  multiple-layer retries multiply as Rᐟᴰ (e.g. 3⁴ = 81). Middle layers fail fast and propagate.
- **"Client got a 429. What do you do?"** Honour `Retry-After`; back off at least that long. Retrying
  immediately is exactly what the throttle is telling you not to do.
- **"Deadlines vs timeouts across services?"** Propagate an absolute deadline down the chain so each
  hop knows the true remaining time and can fail fast on already-expired requests; relative timeouts
  reset per hop and blow the end-to-end budget.
- **"p99 is fine but p99.9 is terrible and you can't fix the server — client-side fix?"** Hedged
  requests fired past ~p95: send a second copy to another replica, take the first to return, cancel
  the loser. Costs a few % extra load; needs idempotency. Retries don't help — they wait for failure.
- **"Hedging vs retry — and can you hedge a payment?"** Hedge for tail latency on idempotent reads;
  retry for failures. Hedging a non-idempotent write double-executes unless it's idempotency-keyed or
  tied+cancelable.
- **"Your AWS SDK client stopped retrying mid-outage though max_attempts wasn't hit — why?"** The
  retry-quota token bucket emptied (500 tokens; retry −5, timeout −10, successful retry +5). By design,
  to stop hammering a down service — a client-side circuit breaker on retries.
- **"Client honors Retry-After from a 503 — hidden failure mode?"** Everyone wakes at the same
  server-suggested instant → a re-synchronized herd. Honor the hint, then jitter on top of it.
- **"Prove a timeout protects your pool."** Little's Law L = λ·W: a timeout bounds W, which bounds
  concurrency L below the pool size; without it W (and thus L) is unbounded.
- **"Slow dependency vs failing dependency — same retry policy?"** No. Retrying *slow* adds load and
  worsens it (time out fast, shed, fall back, trip a breaker); retry only genuine *failures*.
- **"Design the server side of an idempotency key."** Key store with in-progress vs completed states,
  atomic insert / unique constraint to win the concurrent-retry race, store and replay the response,
  TTL (~24 h).

---

## References

- Google, *Site Reliability Engineering*, ch. 22 "Addressing Cascading Failures" (retry
  amplification, retry budgets, load-induced metastable failure) — sre.google/books.
- Google, *The Site Reliability Workbook*, ch. on handling overload and cascading failures.
- Marc Brooker / AWS Architecture Blog, **"Exponential Backoff and Jitter"** (full / equal /
  decorrelated jitter, simulations) — aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/.
- AWS Builders' Library, **"Timeouts, retries, and backoff with jitter"** (Marc Brooker).
- Michael T. Nygard, *Release It!* (2nd ed.) — Timeouts, Circuit Breaker, Bulkhead, and the
  "slow is the new down" cascading-failure analysis.
- gRPC documentation — client retry policy, retry throttling (token-bucket budget), and deadline
  propagation.
- gRFC A6, "gRPC Retry Design" — retry & hedging policies, `maxAttempts` cap 5, ±0.2 jitter,
  `retryThrottling` (maxTokens/tokenRatio/half threshold), `grpc-retry-pushback-ms`.
- Jeffrey Dean & Luiz André Barroso, **"The Tail at Scale"**, CACM 56(2), Feb 2013 — hedged &
  tied requests; the BigTable 1800 ms→74 ms hedging and median-16%/p99.9-40% tied-request results.
- Google, *The Site Reliability Workbook* / SRE book, **"Handling Overload"** — per-request (3) and
  per-client (10%) retry budgets, 3×→1.1×, retry-count-in-metadata (cap 2), "overloaded; don't retry".
- Marc Brooker / AWS, **"What is Backoff For?"** — jitter (not backoff) does the fleet-wide work;
  independent client breakers over-react on partial outages; token buckets under-react for ephemeral
  clients.
- Bronson, Aghayev, Charapko, Zhu, **"Metastable Failures in Distributed Systems,"** HotOS 2021 —
  trigger vs sustaining effect, work amplification.
- AWS post-event summaries — DynamoDB (20 Sep 2015, us-east-1 metadata retry storm) and Kinesis
  (25 Nov 2020, thread-limit exhaustion cascade).
- AWS SDK / botocore retry modes (legacy/standard/adaptive; 20 s max backoff; retry-quota bucket
  500/5/10). Envoy retry semantics (`retry_on`, per-try timeout, retry budgets: 20% / min 3).
- Stripe API docs — idempotency keys for safely retrying non-idempotent writes.
- Neighbouring topics in this library: `circuit-breakers-and-bulkheads`,
  `load-shedding-and-backpressure`, `cascading-failures-and-antipatterns`,
  `graceful-degradation-and-fallbacks`; `observability` for measuring/alerting on retry rates;
  `security` and `design-rate-limiter` for rate-limiting.
