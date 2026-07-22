# Graceful Degradation & Fallbacks

Graceful degradation is the discipline of keeping the **core function of a system
working when parts of it fail**, by intentionally shedding or substituting the pieces
that are broken instead of returning a full outage. Where a circuit breaker decides
*whether* to call a failing dependency (see `reliability-ops/circuit-breakers-and-bulkheads`),
degradation and fallbacks decide *what the user gets* when that dependency is
unavailable. The goal is to convert a hard, binary failure ("the page is down") into a
soft, partial one ("the page loads but recommendations are hidden").

This is a judgment-heavy topic. The reliability engineer's job is to know **which
features are core and which are optional**, wire each optional feature to a fallback,
and — critically — **measure how often the fallbacks fire** so that a silent quality
degradation never masks an ongoing incident.

> [!KEY-TAKEAWAY]
> The three ideas that carry this topic: (1) **degrade features, don't drop the
> request** — rank features by criticality and disable the non-critical ones under
> failure; (2) **a fallback is a designed alternative, not an accident** — and every
> fallback must be monitored, because a fallback that fires silently is an incident you
> can't see; (3) **static stability** — the reliable posture is to keep serving on
> last-known-good state without the failed dependency, rather than depend on the
> failed thing to recover.

---

## Graceful Degradation

**Definition.** Graceful degradation is a design property where a system continues to
provide reduced-but-useful functionality when one or more components fail or are
overloaded, rather than failing completely. The classic framing (Nygard, *Release It!*)
is that a **failure in a non-critical dependency must not take down a critical feature.**

**Mechanism.** You decompose a request or a page into independent features, each backed
by a dependency, and you attach a **degradation behavior** to each one that is keyed to
that dependency's health:

- **Hide the feature** — remove a recommendations widget, a "customers also bought"
  strip, or a live-inventory badge if its backing service is down.
- **Serve stale / cached data** — show the last-known price or catalog even if the
  pricing service is unavailable (this is *static stability*, below).
- **Substitute a cheaper computation** — return a generic, non-personalized homepage
  instead of a personalized one; return popularity-ranked search results instead of
  ML-ranked ones.
- **Reduce fidelity** — lower image resolution, drop optional response fields, disable
  autocomplete.

The essential architectural requirement is **failure isolation**: a call to the
optional dependency must be wrapped (timeout + circuit breaker + fallback) so its
failure or latency cannot block or crash the parent request. Without isolation you don't
get graceful degradation — you get a cascading failure
(see `reliability-ops/cascading-failures-and-antipatterns`).

```mermaid
flowchart TD
    R[Product page request] --> C[Core: product name, price, buy button]
    R --> O1[Optional: recommendations]
    R --> O2[Optional: reviews summary]
    R --> O3[Optional: live inventory badge]
    C --> OK[Always rendered]
    O1 -->|reco service down| H1[Hide widget]
    O2 -->|reviews slow: timeout| H2[Show cached count]
    O3 -->|inventory down| H3[Show 'usually in stock']
    OK --> P[Page renders, purchase still works]
    H1 --> P
    H2 --> P
    H3 --> P
```

**Degradation vs. failover.** Failover *replaces* a failed component with an equivalent
healthy one (a replica, another AZ) so the user sees no change
(see `reliability-ops/redundancy-failover-and-health-checks`). Degradation *accepts a
reduced experience*. Prefer failover when redundancy exists; degrade when it doesn't or
when the failed thing is genuinely optional.

**Trade-offs.**
- *Complexity.* Every degradation path is a code path that must be built, tested, and
  exercised — untested fallbacks are a leading cause of "the fallback also failed."
  Chaos/fault-injection testing exists partly to exercise these paths
  (see `reliability-ops/chaos-engineering-and-fault-injection`).
- *Silent quality loss.* A degraded experience can look "fine" to monitoring while
  quietly hurting conversion, relevance, or correctness — hence you must measure
  degradation rate as an explicit signal.
- *Correctness risk.* Degrading is safe for *presentation* (hide a widget) but dangerous
  for *state-changing / correctness-critical* paths (never "degrade" a payment by
  skipping the fraud check). Match the degradation to the criticality tier.

> [!INTERVIEW]
> A strong answer names the *unit* of degradation: you degrade **per feature**, keyed to
> **that feature's dependency health**, not the whole system at once. "The reco service
> is down so we hide the reco widget, but checkout keeps working" scores far better than
> "we show an error page."

---

## Fallbacks and Fallback Chains

**Definition.** A **fallback** is a predetermined alternative result returned when the
primary path fails (throws, times out, or a circuit breaker is open). It answers the
question "what do we return *instead*?" A **fallback chain** tries a sequence of
alternatives in decreasing order of quality until one succeeds.

**Common fallback sources (roughly best → worst quality):**

| Fallback type | Example | Freshness / quality | Notes |
|---|---|---|---|
| Secondary provider | switch payment gateway A→B; secondary geocoding API | Full | Needs an independent dependency; watch correlated failure |
| Local / near cache | serve last cached price or catalog | Stale (seconds–hours) | The workhorse; enables static stability |
| Recomputed / cheaper path | popularity ranking instead of ML ranking | Lower relevance | Degraded but personalized-free |
| Static default | "usually ships in 2 days", empty list, default config | Generic | Always available, lowest quality |
| Fail (controlled error) | return a typed error the caller can handle | None | Correct when a *wrong* answer is worse than none |

**Mechanism — fallback chain.** The pattern is: attempt primary → on failure attempt the
next source → … → terminal fallback that is *guaranteed to succeed* (usually a static
default that requires no I/O). Each hop should have its own timeout, and the total time
budget must be bounded so the chain doesn't blow the parent request's deadline.

```mermaid
flowchart LR
    A[Call pricing service] -->|ok| Z[Return live price]
    A -->|timeout / error| B[Read from cache]
    B -->|hit| Z2[Return cached price + stale flag]
    B -->|miss| C[Static default: 'see cart for price']
    C --> Z3[Return default]
```

**Resilience4j example (fallback on circuit-open):**

```java
Supplier<Price> decorated = CircuitBreaker
    .decorateSupplier(breaker, () -> pricingClient.getPrice(sku));

Price price = Try.ofSupplier(decorated)
    .recover(CallNotPermittedException.class, e -> cache.getPrice(sku))  // breaker open
    .recover(Exception.class, e -> Price.staticDefault(sku))             // terminal fallback
    .get();
```

**Design rules that separate senior answers from junior ones:**
- The **terminal fallback must not perform network I/O** — if your last resort can
  itself hang or fail, you have no floor. A static in-memory default or a value baked
  into the deployment artifact is the safe floor.
- **Fallbacks belong on reads, not blindly on writes.** Silently substituting a value on
  a write can corrupt state. For writes, prefer *queue-and-retry* (accept, persist to a
  durable buffer, apply later) over a fabricated success.
- **Bound the total latency of the chain** — a chain of three 2-second timeouts is a
  6-second request. Fallbacks should be *fast*; a slow fallback still ties up the thread.
- **Fallbacks must be independent of the primary.** A "secondary provider" that shares
  the same database, network path, or auth service will fail at the same time
  (correlated failure) and provide no real protection.

---

## The Risks of Fallbacks

Fallbacks are not free reliability — they trade *availability* for *correctness and
observability*, and each of the three big risks below has ended real incidents.

**1. Silent quality loss (the biggest one).** A fallback that returns stale or generic
data keeps the success rate at 100% while the *answer quality* silently collapses. Search
that has silently fallen back to popularity ranking looks healthy on an error-rate
dashboard but is quietly wrong. The mitigation is to **treat fallback activation as a
first-class metric**: emit a counter every time a fallback fires and alert on the
**fallback rate**. A fallback rate that jumps from 0.1% to 40% is an incident even if the
error rate is still zero.

> [!WARNING]
> The classic anti-pattern is a fallback that **masks an outage**. Because the fallback
> makes user-facing metrics look normal, the underlying dependency can be down for hours
> before anyone notices — and the fallback data goes progressively staler the whole time.
> Always alert on the fallback/degradation rate itself, not just on end-user errors.
> How you emit and alert on that metric is `observability`'s job — the *decision to
> measure it* is a reliability requirement.

**2. The fallback also fails.** If the fallback shares infrastructure with the primary
(same DB, same cache cluster, same auth service, same AZ), a correlated failure takes out
both. Worse, fallbacks are cold code paths that are rarely exercised, so they often have
latent bugs, stale credentials, or unmaintained data. **Untested fallbacks are effectively
broken fallbacks** — this is a core motivation for chaos engineering.

**3. Fallbacks amplify load.** A fallback that itself makes a call (e.g. "on cache miss,
hammer the origin") can *increase* load on an already-struggling system, turning a partial
failure into a full one — a variant of a retry storm. And when a whole fleet falls back to
a shared secondary at once, that secondary gets a thundering herd it was never sized for.

**4. Correctness / security fallbacks.** "Degrading" an authorization or fraud check by
allowing the request through (fail-open) trades a reliability win for a security hole —
see the next section.

| Risk | How it bites | Mitigation |
|---|---|---|
| Silent quality loss | 100% success, wrong answers | Emit + alert on **fallback rate** |
| Masks incident | Dependency down for hours unnoticed | Fallback-rate SLO/alert; staleness age metric |
| Fallback also fails | Shared infra, correlated failure | Independent fallback; test it (chaos) |
| Load amplification | Fallback calls origin → herd | Cache-only fallback; jittered refresh; request coalescing |
| Wrong fail direction | Fail-open on authz = security hole | Choose fail-closed for security (next section) |

---

## Static Stability (AWS)

**Definition.** **Static stability** is the AWS Well-Architected principle that a system
should **keep operating on its last-known-good state without needing the failed
dependency to be available** — including without needing the *control plane* that would
normally change that state. A statically stable system's steady-state behavior does not
depend on making new calls to the thing that just failed.

**Canonical examples.**
- **Serve reads from cache even if the database is down.** The cache holds last-known-good
  data; the system keeps answering read traffic through the outage instead of erroring.
- **EC2 instances keep running during an EC2 control-plane impairment.** You may be unable
  to *launch new* instances (control-plane action), but existing instances (data plane)
  keep serving. AWS designs data planes to be statically stable against control-plane
  failures.
- **Pre-provisioned capacity for failover.** A statically stable multi-AZ system
  **pre-provisions enough capacity** in the surviving AZs so that when one AZ fails it
  does *not* need to call the (possibly-impaired) control plane to scale up. This is why
  AWS recommends **not** relying on auto-scaling *during* an AZ failure — scaling is a
  control-plane action that may be exactly what's degraded.

**Mechanism / the core insight: data plane vs control plane.** Control planes (which
*change* configuration — launch instances, update DNS, change routing) are complex and
statistically more failure-prone; data planes (which *use* existing config to serve
traffic) are simpler and more available. Static stability means the **data plane keeps
working using existing state even when the control plane is unavailable.** You accept
being unable to *change* things during a failure in exchange for continuing to *serve*.

> [!TIP]
> The trade-off of static stability is **cost vs. dependency on recovery actions**. A
> statically stable failover keeps ~2x (or N+1) capacity warm so it never has to scale up
> mid-incident — more expensive, but it removes the control plane from the critical
> recovery path. A "dynamically stable" design scales on demand, which is cheaper but bets
> that the control plane and capacity are available exactly when the system is already
> unhealthy — often a bad bet.

Static stability is the *why* behind serving stale cache during a DB outage: it's not
just a fallback, it's a deliberate posture where steady-state serving does not depend on
the failed component. Cross-ref `system-design` for multi-region architecture and
`reliability-ops/caching` patterns for the caching mechanics.

---

## Fail-Open vs Fail-Closed

When a dependency fails and you must decide the default behavior, you pick a **fail
direction**:

- **Fail-open** (a.k.a. *fail-safe* in some domains, *fail-permissive*): on failure,
  **allow** the operation / continue as if the check passed. Maximizes availability.
- **Fail-closed** (a.k.a. *fail-secure* / *fail-safe* in security contexts): on failure,
  **deny / block** the operation. Maximizes safety and correctness.

> [!WARNING]
> The terms *fail-safe* and *fail-secure* are overloaded and mean opposite things in
> different fields (physical door locks vs. software auth). In an interview, describe the
> **behavior** — "allow on failure" vs "deny on failure" — not just the label.

**The decision rule: what is the cost of each wrong default?**

| Scenario | Right direction | Why |
|---|---|---|
| AuthN / AuthZ service unreachable | **Fail-closed** | Allowing access on failure = security breach; a blocked user is recoverable, a breach is not |
| Fraud / risk scoring down | Fail-closed (or step-up) | Approving fraud on failure has unbounded cost |
| Rate limiter store down | Usually fail-open* | Blocking all traffic because the *limiter* is down is worse than briefly unlimited (see `security`, `system-design/design-rate-limiter`) |
| Feature-flag service down | Fail to last-known / safe default | Serve cached flags; default new/risky features off |
| Optional enrichment (geo-IP, reco) | **Fail-open** | Non-critical; degrade gracefully rather than error the request |
| Firewall / network policy | **Fail-closed** | A firewall that fails open exposes everything |
| Physical egress / life-safety door | Fail-open (unlock) | People must be able to exit in a power failure — *safety* wins over *security* |

\* The rate-limiter case is genuinely contested. Fail-open risks a flood hitting an
already-fragile backend; fail-closed risks a total outage from a limiter dependency being
down. A common middle ground is a **local fail-open with a conservative static local
limit** so you neither block everyone nor go fully unlimited.

**Mechanism / principle.** The choice is a risk trade-off between the **cost of a false
allow** and the **cost of a false deny**. Security, money, and safety-of-state generally
fail closed (a wrong "yes" is catastrophic and irreversible). Non-critical,
presentation, and enrichment paths fail open (a wrong "block" needlessly hurts
availability). The judgment: *degrade functionality freely, but never degrade a security
or correctness guarantee.*

---

## Load-Based Degradation and Brownout

**Definition.** A **brownout** (borrowed from the electrical-grid term for a partial
voltage drop) is *intentional, graduated degradation triggered by load* rather than by a
dependency being down. As demand or latency rises, the system progressively sheds
optional work to protect the core — a dimmer switch, not an on/off switch.

**Mechanism.** The system watches a load/health signal — CPU, queue depth, p99 latency,
concurrency, or error-budget burn — and disables features in **criticality order** as the
signal crosses thresholds:

```mermaid
stateDiagram-v2
    [*] --> Full
    Full --> Degraded: load / latency rising
    Degraded --> Minimal: load still climbing
    Minimal --> Degraded: load easing
    Degraded --> Full: recovered
    note right of Full
      All features on:
      personalization, reco, rich media
    end note
    note right of Degraded
      Drop reco + personalization,
      serve cached, lower image quality
    end note
    note right of Minimal
      Core only: serve/checkout,
      static content, read-only mode
    end note
```

**Brownout vs. load shedding.** They are complementary (see
`reliability-ops/load-shedding-and-backpressure`). Load shedding **rejects whole
requests** (returns 429/503) to cap total work; brownout **makes each accepted request
cheaper** by dropping optional parts of it. A good design does both: shed the lowest-value
requests *and* serve the accepted ones in a reduced mode. Both aim to keep the system
inside its capacity envelope so it doesn't collapse into a cascading failure.

**Concrete brownout levers:**
- Disable personalization / ML ranking → cheaper generic responses.
- Serve from cache with longer TTLs (accept more staleness for less origin load).
- Turn on **read-only mode** (reject writes, keep reads) to protect a strained primary DB.
- Reduce page richness: fewer results per page, no thumbnails, no autocomplete.
- Drop sampling/telemetry fidelity for non-critical events.

**Trade-offs.**
- *Hysteresis matters.* Use separate enter/exit thresholds (or a cooldown) so the system
  doesn't oscillate between full and degraded modes ("flapping") as load hovers at the
  boundary.
- *Prioritize by criticality, not arbitrarily.* Shed the least valuable work first;
  protect revenue/safety-critical paths last.
- *Make it observable and reversible.* Operators need to see which brownout level is
  active and be able to force or clear it. Feature flags are the usual control surface
  (cross-ref `devops-cicd` for flag/deploy tooling).

> [!INTERVIEW]
> If asked "your service is overloaded and latency is spiking — what do you do?", a
> senior answer combines both mechanisms: **shed** the lowest-priority incoming requests
> (protect the queue) *and* **brownout** the survivors (drop optional features, go
> read-only), rather than a single blunt "add more servers" (which may be a control-plane
> action that's slow or unavailable exactly when you need it).

---

## Designing for Degradation: Criticality Tiers

Graceful degradation only works if you've **decided in advance what is core and what is
optional.** The senior practice is to classify each feature/dependency into criticality
tiers and attach a policy to each:

| Tier | Meaning | On dependency failure | Example |
|---|---|---|---|
| **Critical (T1)** | Request is meaningless without it | Fail the request (typed error), page on-call | Auth, checkout, the primary read path |
| **Important (T2)** | Degrades experience but request is still useful | Fallback to cache/default, alert | Pricing (use cached), search ranking |
| **Optional (T3)** | Nice-to-have | Hide silently, log + count | Recommendations, reviews, "recently viewed" |

Design implications:
- **Isolate optional dependencies** behind their own timeouts, circuit breakers, and
  ideally their own thread pool / bulkhead so a slow T3 call can never exhaust the
  resources needed for T1 work (see `reliability-ops/circuit-breakers-and-bulkheads`).
- **Set tighter timeouts on less-critical calls** — an optional widget should give up
  fast (e.g. 100–200 ms) rather than dragging the whole page's latency.
- **Make degradation testable and drillable** — feature flags to force each degraded
  mode, plus chaos experiments that kill T2/T3 dependencies in production to prove the
  core survives.
- **Tie it back to SLOs** — define SLOs on the *core* experience; optional features can
  have looser or no SLOs. This keeps the error budget focused on what matters (see
  `reliability-ops/slos-error-budgets-and-velocity-tradeoff`).

---

## Common Interview Follow-ups

- **"Difference between graceful degradation and a fallback?"** Degradation is the
  system-level *strategy* (reduced functionality instead of outage); a fallback is the
  *mechanism* (a specific alternative value returned when a call fails). You implement
  degradation *using* fallbacks + feature hiding + brownout.
- **"Your search relevance quietly got worse but errors are 0%. What happened and how do
  you catch it?"** A silent fallback (e.g. to popularity ranking) is masking a dependency
  outage. Catch it by emitting and alerting on the **fallback/degradation rate** and a
  **cache-staleness age** metric — not just error rate.
- **"Auth service is down — fail open or closed?"** Fail-closed. A blocked legitimate
  user is recoverable; an unauthorized access on fail-open is a breach. Contrast with an
  optional enrichment call, which fails open.
- **"Rate-limiter backing store is down — fail open or closed?"** Contested; explain the
  trade-off. Common answer: local fail-open with a conservative static limit so you
  neither block everyone nor go fully unlimited.
- **"What is static stability and why not just auto-scale during an AZ failure?"** Static
  stability = keep serving on last-known-good state without the failed dependency;
  pre-provision failover capacity so recovery doesn't depend on the control plane (which
  may be exactly what's impaired). Auto-scaling mid-failure bets on a control-plane action
  being available during an event.
- **"Give a fallback that made an incident worse."** A fallback that calls the origin on
  cache miss (load amplification / thundering herd), a fallback sharing the primary's DB
  (correlated failure), or a fallback that masked an hours-long outage while serving
  ever-staler data.
- **"How do you make sure fallbacks actually work?"** They're cold code paths — exercise
  them with chaos/fault injection in production, keep the terminal fallback I/O-free, and
  bound total chain latency.
- **"Brownout vs load shedding?"** Shedding rejects whole requests to cap total work;
  brownout makes each accepted request cheaper by dropping optional parts. Use both.

## References

- Google, *Site Reliability Engineering* — "Handling Overload" (graceful degradation,
  criticality, load shedding) and "Addressing Cascading Failures."
- Google, *The Site Reliability Workbook* — "Managing Load," canarying and degraded modes.
- Michael T. Nygard, *Release It!* (2nd ed.) — stability patterns: Circuit Breaker,
  Fail Fast, Fallback, Handshaking, Steady State; anti-patterns (Cascading Failures,
  Slow Responses).
- AWS Well-Architected Framework, **Reliability Pillar** — static stability, data plane
  vs control plane, using availability zones.
- Amazon Builders' Library — "Static stability using Availability Zones" (Becky Weiss)
  and "Avoiding fallback in distributed systems" (Jacob Gabrielson).
- Resilience4j documentation — `CircuitBreaker`, `TimeLimiter`, and fallback via
  `Try.recover` / `@CircuitBreaker(fallbackMethod=...)`.
- Cross-references in this library: `reliability-ops/circuit-breakers-and-bulkheads`,
  `reliability-ops/retries-timeouts-and-backoff`,
  `reliability-ops/load-shedding-and-backpressure`,
  `reliability-ops/cascading-failures-and-antipatterns`,
  `reliability-ops/disaster-recovery-rpo-rto-strategies`,
  `observability` (metrics/alerting on fallback rate), `security` and
  `system-design/design-rate-limiter` (fail-open vs fail-closed for limiting).
