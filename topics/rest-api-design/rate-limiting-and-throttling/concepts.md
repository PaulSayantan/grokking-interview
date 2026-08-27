# Rate Limiting & Throttling (Client Contract)

Every public or shared API eventually has to say "no, not that fast." Rate
limiting is how a server protects its capacity and enforces fairness; **the
client contract** is how it communicates those limits so that a well-behaved
client can stay inside them and recover gracefully when it doesn't. This topic
is about that *wire contract* — the status code, the headers, and the response
body a client actually consumes — not about the token-bucket / leaky-bucket
math that runs inside the limiter (that internal algorithm lives in the
system-design domain).

The interview signal here is that you treat limits as a **documented, machine-
readable, versioned part of the API surface**: a client should be able to read
your headers and docs and write correct backoff logic without reverse-
engineering your behavior from 429s.

The anchor standards are **RFC 9110 (HTTP Semantics)** for the status codes and
the `Retry-After` header, **RFC 6585** which originally defined **429 Too Many
Requests**, and the IETF `httpapi` working group's Standards-Track Internet-
Draft **"RateLimit header fields for HTTP"** (`draft-ietf-httpapi-ratelimit-
headers`) for the standardized `RateLimit` / `RateLimit-Policy` fields.

A mental model to carry throughout: **the status code tells the client it was
throttled, `Retry-After` tells it *when* it may try again, and the RateLimit
headers tell it its *current standing* (budget remaining and reset window) so it
can avoid being throttled at all.**

---

## Rate limits vs quotas vs throttling vs spike arrest

These four terms are used loosely in conversation but mean different things, and
mixing them up is a common interview stumble.

| Term | Enforces | Typical window | Client-facing effect |
|---|---|---|---|
| **Rate limit** | Request *rate* (velocity) | Short (per second / minute) | Rejected/delayed when too fast |
| **Quota** | Total *volume* | Long (per day / month, often billing-aligned) | Cut off when budget exhausted |
| **Throttling** | The *act* of slowing/rejecting | — | The mechanism, not the policy |
| **Spike arrest** | Smoothness of arrival | Instantaneous | Evens out bursts; no bucket to "save up" |

- **Rate limit**: "at most 100 requests per minute." Concerns *how fast*.
- **Quota**: "at most 1,000,000 requests per month on the Pro plan." Concerns
  *how much in total*, and is usually tied to pricing/plans and billing cycles.
- **Throttling**: the umbrella term for the *server's response* to exceeding a
  limit — rejecting (hard) or delaying/queuing (soft) requests. A rate limit is
  a *policy*; throttling is the *enforcement action*.
- **Spike arrest**: smooths traffic to a maximum *instantaneous* rate (e.g.
  "no more than 1 request every 600 ms"). Unlike a token-bucket rate limit, it
  does **not** let a client accumulate unused allowance and then burst — it
  paces requests evenly. Apigee popularized the term.

**Gotcha the interviewer probes.** A "100/minute" *rate limit* implemented as a
fixed window is not the same guarantee as a spike arrest: with a fixed window a
client can legally send 100 requests in the last second of one window and 100 in
the first second of the next — 200 in ~2 seconds. Spike arrest prevents exactly
that. This is why the client contract should document *which* it is.

> [!KEY-TAKEAWAY]
> Rate limit = velocity (per second/minute). Quota = volume over a long,
> billing-aligned window. Throttling = the enforcement action. Spike arrest =
> smoothing bursts to an even pace. Say which one your headers describe.

---

## 429 Too Many Requests

**What it is.** `429 Too Many Requests` is the canonical status code for "you
have sent too many requests in a given amount of time." It was defined by **RFC
6585** (2012, which also added 428, 431, and 511) and is referenced by RFC 9110.

**Why it matters.** 429 is a *client* error (4xx) that is nonetheless
**retryable** — unlike most 4xx codes, the request wasn't malformed, the client
just needs to slow down. A correct client distinguishes 429 (back off and retry
the *same* request) from, say, 400 (fix the request; retrying unchanged is
pointless).

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 30
RateLimit: "default";r=0;t=30

{
  "type": "https://example.com/probs/rate-limit",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit of 100 requests per minute exceeded for API key."
}
```

**Caching.** RFC 6585 states that **429 responses MUST NOT be stored by a
cache** by default (a shared cache must not serve the throttle to other clients).

**429 vs 503.** Both can carry `Retry-After`. Use **429** for *per-client* rate
limiting ("*you* are too fast"). Use **503 Service Unavailable** for *server-
side* overload or maintenance ("the *service* can't handle this right now,
regardless of who you are"). Some gateways return 503 for global overload and
429 for per-key limits; blurring them makes client logic and dashboards wrong.

**Gotcha.** Returning `200 OK` with an error in the body, or a generic `400`,
for a throttle is an anti-pattern: generic HTTP tooling, retry libraries, and
your own monitoring all key off the status code. The status line must say 429.

> [!WARNING]
> 429 is retryable, but only *after* waiting. A client that immediately retries
> a 429 in a tight loop makes the overload worse — this is the "retry storm" the
> `Retry-After` header and backoff exist to prevent.

---

## Retry-After header

**What it is.** `Retry-After` (defined in **RFC 9110 §10.2.3**) tells the client
how long to wait before making a follow-up request. It is valid on **429**,
**503**, and **3xx** redirect responses. It takes one of two forms:

1. **delay-seconds** — a non-negative integer number of seconds:
   `Retry-After: 120`
2. **HTTP-date** — an absolute time (IMF-fixdate):
   `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 120
```

**Why it matters.** It converts a guessing game into an instruction. Without it,
clients invent their own (often too-aggressive) retry timing.

**Trade-offs — seconds vs date.**
- **delay-seconds** needs no clock synchronization between client and server and
  is unambiguous; it's the common choice for rate limiting.
- **HTTP-date** is useful for a known fixed window end (e.g. a daily quota that
  resets at midnight UTC), but relies on the client's clock being reasonably
  correct and requires date parsing.

**Gotchas the interviewer probes.**
- `Retry-After` is a **lower bound**, not an exact ETA. A conforming client
  should treat it as "wait *at least* this long," and layer jitter on top.
- The delay value is usually a small integer; some servers return a *fixed*
  value for every 429, which can synchronize thousands of clients to retry at
  the same instant (thundering herd). Jitter on the client side mitigates this.
- If both `Retry-After` and RateLimit headers are present, `Retry-After` governs
  the *rejected* request's retry timing; the RateLimit headers describe ongoing
  standing. They should be consistent (a `Retry-After: 30` alongside a RateLimit
  reset window of 30 s).

---

## RateLimit and RateLimit-Policy headers

**What it is.** The IETF `httpapi` working group is standardizing rate-limit
headers in the Standards-Track Internet-Draft **"RateLimit header fields for
HTTP"** (`draft-ietf-httpapi-ratelimit-headers`). It is a *draft*, not yet an
RFC — an important accuracy point. Crucially, the **modern draft defines two
Structured Fields** (RFC 8941/9651 syntax), *not* the older three separate
headers:

- **`RateLimit`** — the client's *current standing* against the applicable
  policy. Key parameter: **`r`** (remaining/available quota, required),
  optionally **`t`** (the time window, in **seconds**, within which that
  remaining quota applies) and **`pk`** (partition key).
- **`RateLimit-Policy`** — the *quota policy itself* (advertised limits). Key
  parameters: **`q`** (quota allocated), **`w`** (window in seconds), **`qu`**
  (quota units, default `requests`), **`pk`** (partition key).

```http
HTTP/1.1 200 OK
RateLimit-Policy: "burst";q=100;w=60, "daily";q=1000;w=86400
RateLimit: "burst";r=42;t=27
```

This says: two policies apply — 100/60 s and 1000/day — and against the burst
policy the client has 42 requests left, with the window resetting in 27 s.

**Reset is a delta, not a timestamp.** The `t` (and the old `Reset`) value is
"the number of seconds until the window resets" — a **delta-seconds**, aligned
with `Retry-After`. The draft deliberately avoids Unix timestamps because they
require clock synchronization.

**The older informal convention.** Before this draft converged, most APIs
(GitHub, Twitter/X, etc.) shipped **three separate headers**, usually
`X-RateLimit-*`:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Ceiling for the window (e.g. 100) |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | When the window resets (often a **Unix epoch** timestamp) |

Earlier versions of the draft used un-prefixed `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset`. You will see all three conventions in
the wild; the draft's appendix documents them as existing practice.

**Gotchas.**
- The `X-` prefix is **not standardized** and its semantics vary per API
  (`X-RateLimit-Reset` is a Unix timestamp on some APIs, seconds-remaining on
  others). Never assume; read the docs.
- These headers are **informational hints**, not a contract that the number
  won't change (bursts from other keys sharing a limit, policy changes, or
  eventual-consistency in a distributed limiter can make `remaining` jump).
- Sending RateLimit headers on **every** response (2xx included), not just on
  429, lets a good client *pace itself* and never hit the wall. That's the whole
  point of advertising remaining budget proactively.

> [!KEY-TAKEAWAY]
> The modern IETF draft uses two Structured Fields — `RateLimit` (current
> standing: `r`, `t`) and `RateLimit-Policy` (the advertised quota: `q`, `w`).
> The reset value is seconds-remaining, not a timestamp. It's still a draft, and
> lots of real APIs use the older `X-RateLimit-*` triplet.

---

## Per-key, per-user, and per-plan limiting

**What it is.** The dimension along which requests are counted and limited — the
"who" a limit applies to. Common keys:

- **Per API key / client ID** — the default for machine-to-machine APIs; the key
  identifies the calling application.
- **Per user / per account** — limits a human or tenant regardless of how many
  keys or devices they use.
- **Per IP address** — cheap, no auth needed; used for unauthenticated endpoints
  and abuse/DDoS mitigation. Weak: NAT/proxies share IPs; attackers rotate them.
- **Per plan / tier** — the *limit value* varies by the customer's subscription
  (Free = 60/min, Pro = 1000/min). Often layered on top of per-key counting.
- **Per endpoint / operation** — expensive operations (search, exports) get
  tighter limits than cheap reads.

**Why it matters.** Choosing the wrong key breaks fairness. Limiting purely by
IP punishes everyone behind a corporate NAT; limiting purely by API key lets one
customer spin up many keys to bypass an account-level cap.

**Layered limits.** Mature APIs apply several *simultaneously* — e.g. a per-IP
limit for basic abuse protection, a per-key burst limit, and a per-account
monthly quota. A request must satisfy *all* applicable limits; the one it
violates first is the one that 429s. The `RateLimit-Policy` field can advertise
multiple policies for exactly this reason.

**Gotchas.**
- **What identifies "the user" is unspecified by RFC 6585** — the server
  decides (credentials, API key, cookie, IP). Document it clearly so clients
  know how to distribute load (and whether adding keys helps or is abuse).
- **Anonymous vs authenticated** endpoints usually need *different* keys: you
  can't key on an API key you don't have, so login/signup endpoints fall back to
  IP + other signals.
- Sharing one limit across an entire org means a noisy internal service can
  starve others (the "noisy neighbor" problem) — a case for per-key isolation.

---

## Soft vs hard limits

**What it is.** A **hard limit** rejects any request over the threshold (429). A
**soft limit** allows temporary overage — the request still succeeds, but the
client is warned, throttled (slowed), billed for overage, or flagged for later
enforcement.

| | Hard limit | Soft limit |
|---|---|---|
| Over threshold | Request **rejected** (429) | Request **allowed** (with consequence) |
| Client impact | Immediate failure | Degraded / warned / charged |
| Use case | Protect capacity, hard SLAs | Grace during spikes, upsell, billing |
| Signal | 429 + Retry-After | Warning header, `RateLimit` r=0 but 200 |

**Why it matters.** A pure hard limit is safe for the server but brutal for a
client that momentarily overshoots. A soft limit (a small burst allowance, or a
grace period before enforcement) improves developer experience without
abandoning protection. Many token-bucket configs express this as *burst
capacity* above the sustained rate.

**Gotchas.**
- Soft limits need a **clear client signal** even when the response is 200 — e.g.
  a `RateLimit` header showing `r=0`, or a documented `Warning`/custom header —
  otherwise the client never learns it's in overage until it's suddenly cut off.
- Overage billing must be disclosed up front; silently charging for soft-limit
  overage is a support and trust disaster.
- "Soft" is not "unlimited": there's still an absolute ceiling where even soft
  limits become hard, to protect the server.

---

## Client backoff and jitter expectations

**What it is.** How a *well-behaved client* should react to a 429/503: wait, then
retry — but not immediately, and not all clients at the same instant.

**The contract, in order of preference:**
1. If `Retry-After` is present, **honor it** (wait at least that long).
2. Otherwise, use **exponential backoff**: wait `base * 2^attempt`, capped at a
   maximum, for a bounded number of attempts.
3. **Add jitter** — randomize the delay — so that many clients that were
   throttled together don't retry in lockstep (the "thundering herd").

**Why jitter matters (the classic result).** With no jitter, N clients that hit
a limit at the same moment retry at the same computed times, re-colliding
forever. AWS's well-known analysis showed that **"full jitter"** — picking a
random wait uniformly in `[0, base * 2^attempt]` — dramatically reduces
contention and completes work faster than plain exponential backoff.

```text
# Full jitter
sleep = random_between(0, min(cap, base * 2 ** attempt))

# Decorrelated jitter (another AWS-recommended variant)
sleep = min(cap, random_between(base, prev_sleep * 3))
```

**Gotchas the interviewer probes.**
- **Only retry idempotent/safe requests automatically**, or use an idempotency
  key, so a retried non-idempotent POST doesn't double-charge. (Ties into the
  idempotency topic.)
- **Cap total attempts and total elapsed time** — infinite retries turn a blip
  into an outage and can get the client banned.
- **Respect `Retry-After` over your own backoff** when both exist; the server
  knows better than the client's guess.
- A **`Retry-After` with a fixed value + no jitter** on the client is the worst
  combination — every client wakes at the same second. Jitter is a *client*
  responsibility even when the server dictates the base delay.

---

## Documenting limits and graceful degradation

**What it is.** Making the limits discoverable *before* a client hits them — in
docs, OpenAPI, and headers — and designing what happens *at* the limit so the
overall experience degrades gracefully rather than failing hard.

**Documenting.**
- State the numbers, the **window**, and the **key** ("100 requests per minute
  per API key; 1M per month per account").
- Document the **429 body shape** (ideally RFC 9457 `application/problem+json`),
  the headers you send, and whether `X-RateLimit-Reset` is a timestamp or
  seconds.
- Describe the headers in **OpenAPI 3.1** so they show up in generated docs and
  SDKs:

```yaml
responses:
  "429":
    description: Rate limit exceeded
    headers:
      Retry-After:
        schema: { type: integer }
        description: Seconds to wait before retrying.
      RateLimit:
        schema: { type: string }
        description: Current standing, e.g. "default";r=0;t=30
    content:
      application/problem+json:
        schema: { $ref: "#/components/schemas/Problem" }
```

**Graceful degradation** — designing the *system's* behavior at the edge:
- **Prefer shedding low-priority traffic first** (batch/analytics before
  interactive user requests) — *priority-based* throttling.
- **Degrade features, not the whole app**: serve cached/stale data, disable
  expensive personalization, or return partial results rather than a blanket
  429.
- **Advertise budget proactively** (RateLimit headers on 2xx) so good clients
  self-throttle and never reach the wall.
- **Fail informatively**: a 429 with a clear problem body and `Retry-After`
  degrades far more gracefully than a bare connection reset.

**Gotcha.** Graceful degradation is a *design* choice you make ahead of time; if
your only behavior at the limit is "hard 429 everything," you have rate limiting
but not graceful degradation. Interviewers like to see you separate the two.

> [!INTERVIEW]
> If asked to "design rate limiting for our public API," split your answer into
> the **algorithm** (token bucket etc. — system-design altitude) and the
> **client contract** (429 + Retry-After + RateLimit headers + documented
> per-key/plan limits + expected client backoff). This topic is the second half,
> and demonstrating that you know the difference is itself a strong signal.

---

## Distinction from the rate-limiter algorithm

**What it is.** The line between *this* topic (the client-facing HTTP contract)
and the system-design topic on **token bucket / leaky bucket / sliding window**
algorithms.

- **Algorithm (system-design):** *how the server decides* to allow or reject a
  request — token bucket, leaky bucket, fixed window, sliding-window log/counter
  — and how that state is stored and synchronized across a fleet (Redis,
  distributed counters, consistency trade-offs).
- **Contract (this topic):** *what the client observes and must do* — the status
  code, `Retry-After`, RateLimit headers, documented limits, and backoff
  expectations — regardless of which algorithm produced the decision.

**Why the distinction matters.** A client should be able to write correct code
against the *contract* without knowing the *algorithm*. Conversely, the server
can switch from fixed-window to sliding-window internally without breaking any
client, *as long as the contract (headers, codes, semantics) stays stable.*

**Gotcha.** The algorithm does leak into the contract in one place: **burst
behavior**. A token bucket allows saved-up bursts; a leaky bucket / spike arrest
does not. If your docs promise "100/minute" but the bucket allows a 100-request
burst in one second, clients will observe behavior your docs didn't describe.
The contract should describe *observable* behavior (burst allowance, window
type) even though it hides the implementation.

> [!KEY-TAKEAWAY]
> Algorithm = the server's internal allow/deny decision (system-design).
> Contract = the codes, headers, and semantics the client consumes (here). Keep
> the contract stable even when you change the algorithm — but do document any
> *observable* burst behavior the algorithm produces.

---

## Concurrency limiting as a fourth dimension

**What it is.** Beyond rate (requests per unit *time*), quota (total *volume*),
and spike arrest (arrival *smoothness*), there is a fourth, orthogonal limiter:
**concurrency** — the number of requests a caller may have *in flight at any
single instant*, regardless of how fast it started them. "At most 100 concurrent
requests" says nothing about requests/second; a client could open 100 long-lived
streaming or long-poll connections and hit the concurrency wall while its request
*rate* is near zero.

**Why it matters.** Rate limits protect against *arrival velocity*; concurrency
limits protect against *resource occupancy* — connections, worker threads, memory,
DB pool slots held for the duration of slow requests. A single expensive report
that takes 30 s ties up a slot the whole time; ten of them can exhaust a pool even
at a trivial request rate. This is why real APIs run both: **Stripe** exposes
`global-concurrency` and `endpoint-concurrency` limits; **GitHub** caps concurrent
requests (100, shared with GraphQL) independently of its points-per-minute rate.

**Contract expression.** The IETF draft's quota-unit registry standardizes
`qu=concurrent-requests`, so a `RateLimit-Policy` can advertise a concurrency
budget the same way it advertises a request-rate budget — e.g.
`RateLimit-Policy: "conc";q=100;qu=concurrent-requests`. The `RateLimit` `r` then
means "concurrent slots still available," and a concurrency 429 clears the instant
an in-flight request completes, not when a time window elapses — so a fixed
`Retry-After` seconds value is a poor fit (retry when a slot frees, not at a wall
clock).

> [!KEY-TAKEAWAY]
> Rate ≠ concurrency. Rate caps requests per unit time; concurrency caps
> simultaneously in-flight requests. Long/slow requests can exhaust a concurrency
> budget at near-zero request rate. Standardize it with `qu=concurrent-requests`.

---

## Machine-readable throttle bodies and problem types

**What it is.** Headers tell a client *when* and *how much*; the **response body**
can tell it *why*, *which policy*, and *whether it is safe to auto-retry* — the
machine-readable half of the contract. Two ecosystems formalize this.

**The IETF draft's problem types (§5).** Building on RFC 9457
(`application/problem+json`), the draft registers throttle-specific `type` URIs,
each carrying a **`violated-policies`** member (an array of the policy names that
were breached):

| Problem type | Status | Meaning |
|---|---|---|
| `quota-exceeded` | **429** | The caller's own quota/rate was exceeded |
| `abnormal-usage-detected` | **429** | Usage flagged as abusive/anomalous |
| `temporary-reduced-capacity` | **503** | Server-side capacity is temporarily reduced |

An SDK can branch on the `type`: `quota-exceeded` → honor `Retry-After` and back
off; `temporary-reduced-capacity` → treat as server-side (503) overload;
`abnormal-usage-detected` → surface to a human rather than blindly retrying.

**Google's cross-ecosystem model.** Google's API design guide maps the gRPC
`RESOURCE_EXHAUSTED` code to **HTTP 429** and puts structured detail in the body:
a required **`ErrorInfo`** (`reason`, `domain`, `metadata`), a **`QuotaFailure`**
describing which quota was hit, and **`RetryInfo{retry_delay}`** carrying the retry
timing *in the body* — a complement or alternative to the `Retry-After` header.

**Why it matters.** A well-designed 429 body lets a generic SDK do the right thing
without bespoke per-endpoint code: read the retry hint, identify the violated
policy for logging/metrics, and decide retry-vs-surface. Header + typed body
together are the full contract.

---

## Cost-based and weighted limiting

**What it is.** Counting *requests* assumes every request costs roughly the same.
It doesn't. One `GET /users/{id}` is cheap; one deep GraphQL query or a bulk export
can be thousands of times more expensive. **Cost/weight/points-based limiting**
assigns each request a cost and debits a *budget of points* rather than a count of
calls.

- **GitHub REST** enforces a **900-points-per-minute** *secondary* rate limit
  across REST endpoints (layered on top of the primary requests/hour limit) so
  expensive calls debit more of the budget than cheap ones.
- **GitHub GraphQL** rate-limits by **query complexity/cost** computed from the
  requested fields — essential because a single GraphQL endpoint hides queries of
  wildly varying cost, making a flat "N requests/min" meaningless.

**Contract expression.** The draft's `qu` quota-unit can be `content-bytes`
(bandwidth-based) as well as `requests`, and a policy's `q` is a *quota* in those
units — so a `RateLimit-Policy` can advertise a byte or points budget, and the
`RateLimit` `r` reports remaining points/bytes, not remaining calls. Document how
each operation maps to cost so clients can predict debits.

**The senior angle.** "How do you rate-limit one GraphQL endpoint or one
expensive bulk endpoint?" The answer is *not* a per-endpoint request count — it is
a cost model (query complexity / points / bytes) surfaced through the same
RateLimit contract, so the client sees remaining *budget* and can pace by cost.

> [!KEY-TAKEAWAY]
> Request-count limits are naive when calls differ in cost. Weighted/points/
> bytes-based limiting debits a budget by cost; the RateLimit contract carries it
> via `qu` (`requests` | `content-bytes` | `concurrent-requests`) and a `q` quota
> in those units.

---

## 403 vs 429 and reason disambiguation

**What it is.** In the wild, rate limits are not always signalled with 429.
**GitHub historically returned 403 Forbidden** for rate-limit rejection and still
returns **either 403 or 429** depending on the limit type. A 403 is *semantically
wrong* for throttling (403 means "authenticated but not allowed," implying
retrying won't help), but it is common enough that a robust client must handle it.

**How a client disambiguates.** A bare 403 is *not* retryable; a 403 that is
*actually* a rate limit is. The client distinguishes them by inspecting signals
the body/headers carry: a rate-limit 403 will include `Retry-After` and/or
`x-ratelimit-*` headers (GitHub sends `x-ratelimit-remaining: 0`), or a
rate-limit-flavored problem `type`/message. Absent those, treat 403 as a hard
authorization failure and do **not** retry.

**Different 429s are not interchangeable either.** A rate-limit 429, a concurrency
429, and a lock-timeout 429 share a status code but demand different client
behavior. Stripe disambiguates via **`Stripe-Rate-Limited-Reason`** (values like
`global-rate`, `endpoint-rate`, `global-concurrency`, `endpoint-concurrency`,
`resource-specific`) and a distinct `lock_timeout` error (a 429 that carries *no*
rate-limit header). Notably, Stripe's SDKs **auto-retry `lock_timeout` 429s but do
NOT auto-retry rate-limit 429s** — because a lock timeout is a transient
contention blip, whereas hammering a rate-limit 429 just deepens the throttle.

> [!WARNING]
> Do not treat every 403 as fatal or every 429 as auto-retryable. Branch on the
> body/headers: 403-that-is-a-rate-limit (has `Retry-After`/rate headers) is
> retryable; a plain 403 is not. A lock-timeout 429 is safely retryable; a
> rate-limit 429 must be backed off, not hammered.

---

## Retry amplification and retry budgets

**What it is.** In a multi-tier system (SDK → API gateway → service mesh sidecar →
service), if *every* layer retries independently, the retry counts **multiply**.
Three retries at each of three layers is up to **3 × 3 × 3 = 27×** the original
load hitting the innermost service. A downstream 429 or timeout thus triggers a
**retry storm** that can push an already-struggling system into a **metastable
failure** — a state that persists (retries keep the load high) even after the
original trigger is gone.

**Mitigations (the senior framing).**
- **Retry at exactly one layer.** Typically the outermost client/SDK owns retries;
  intermediate hops fail fast and propagate the error (and `Retry-After`) rather
  than retrying themselves.
- **Retry budgets (Google SRE).** Cap retries to a small fraction of request
  volume — e.g. **retries ≤ 10% of requests** — enforced with a token bucket per
  client. When the budget is exhausted, requests fail immediately instead of
  retrying, breaking the amplification loop.
- **Propagate `Retry-After`** end-to-end so upper layers wait rather than
  re-issuing, and use **circuit breakers** to stop calling a failing dependency
  entirely for a cool-down period.

**Why it matters.** The existing backoff/jitter guidance is about a *single*
client; retry amplification is the *systemic* failure that emerges when many
retrying layers compose. "Walk me through a downstream 429 that triggers retries
at the gateway, mesh, and SDK" is a classic staff-level probe — the answer is
single-layer retry + retry budgets + Retry-After propagation.

---

## Fail-open vs fail-closed limiters

**What it is.** A distributed limiter keeps its counters in a shared datastore
(commonly Redis). When that store is slow or **unavailable**, the limiter must
decide, per request, what to do without an authoritative count:

- **Fail-closed** — reject (429/503) when the counter can't be read. *Safe for the
  backend* (never over-admits) but the limiter becomes a **single point of
  failure**: a Redis outage turns into a full API outage — effectively self-DoS.
- **Fail-open** — allow the request when the counter can't be read. *Preserves
  availability* but removes protection exactly when the system may be stressed,
  risking overload.

**The trade-off.** Neither is universally right. Many designs fail-open for
best-effort rate limits (availability first) but fail-closed for hard
security/billing quotas (correctness first), and add a **local in-process
fallback** (approximate per-node counting) so a datastore blip degrades gracefully
instead of flipping fully open or fully closed.

**Client-visible consequence.** During a limiter datastore incident, a client may
observe `RateLimit: remaining` values that are stale, missing, or wildly
inconsistent, and either unexpected 503s (fail-closed) or a temporary absence of
throttling (fail-open). This is why the contract calls these headers *best-effort*.

---

## Client-side rate limiting and adaptive throttling

**What it is.** The contract is **bilateral**: a good client doesn't just react to
429s, it *proactively* limits itself so it rarely triggers one.

- **Client-side token bucket.** The client runs its own limiter sized to the
  advertised policy, smoothing its own outbound rate. **Stripe explicitly
  recommends** clients implement a token bucket rather than firing bursts and
  absorbing 429s.
- **Adaptive concurrency / adaptive throttling.** The client dynamically adjusts
  its in-flight concurrency based on observed latency and rejection rate (AIMD-style
  — additive increase, multiplicative decrease), backing off as it sees pressure.
- **Client-side "accept probability" throttling** (Google SRE): the client
  computes a local reject probability from its recent accept/reject ratio and
  drops requests *before* sending them once the server is clearly rejecting — this
  sheds load at the source and is distinct from a **server-side circuit breaker**
  (which trips a client's *calls to a dependency* off entirely).

**Why it matters.** A server can only defend itself; a well-behaved ecosystem
needs clients that pace, self-throttle, and shed proactively. "The client's
obligations extend beyond honoring `Retry-After`" is the point — RateLimit headers
exist precisely so clients can self-govern.

---

## Distributed limits and best-effort semantics

**What it is.** A limiter running on many nodes behind a shared (but lagging)
counter cannot give an *exact* real-time remaining count. This deepens the earlier
"informational hint" caveat with the precise reasons and the spec's explicit
disclaimers.

**Why `remaining` is approximate.**
- **Per-node local buckets** that only periodically reconcile can *sum above* the
  global limit (each node thinks it has budget), so a client may briefly succeed
  beyond the advertised ceiling — or, after reconciliation, see `remaining` **jump
  down or briefly go negative**.
- **Sticky vs non-sticky routing.** With sticky routing a client always hits the
  same node's counter (more consistent); with non-sticky routing consecutive
  requests hit different nodes with different local views, so `remaining` can
  appear to move non-monotonically.
- **Replication/sync lag** between nodes and the central store makes any single
  response's `remaining` a *snapshot that may already be stale*.

**What the draft actually says (advisory, not a guarantee).**
- Clients **MUST NOT assume** the full service limit will be restored after `t`.
- Clients **MUST NOT assume** future responses contain the same RateLimit fields
  (a server may change or drop them at any time).
- `t` **"does not necessarily end at a fixed point in time"** — with a sliding
  window the reset is continuous, not a hard wall.

The correct mental model: **RateLimit is advisory telemetry for pacing, not a
reservation or a promise.** Treat `remaining` as "roughly this much, right now,
best-effort."

---

## Retry-After and RateLimit precedence and edge cases

**What it is.** The exact precedence and parsing rules when the throttle signals
interact or are malformed — details the earlier "should be consistent" note leaves
implicit.

**Precedence (draft §6/§7).**
- If **both `Retry-After` and `RateLimit` are present, `Retry-After` MUST take
  precedence** for the rejected request's retry timing; the effective RateLimit
  window **MAY be ignored** for that decision.
- A server **SHOULD NOT** set `Retry-After` to a point *earlier* than the end of
  the effective RateLimit window (don't invite a retry that will just be rejected
  again).
- Clients **MUST ignore malformed fields** rather than guessing, and a **cached
  response with a positive `current_age` SHOULD be ignored** for rate-limit
  purposes (a stale RateLimit snapshot is worse than none).

**`Retry-After` edge cases.**
- `Retry-After: 0` means *retry immediately* (valid; a non-negative integer).
- An **HTTP-date in the past** implies no wait; treat as "retry now."
- **Non-integer / garbage** delay values (`Retry-After: soon`, `12.5`) are
  malformed → treat as **absent** and fall back to backoff.
- Clients should **clamp absurd values** — a `Retry-After: 999999999` shouldn't
  hang a request for years; cap it to a sane maximum and/or surface an error.

---

## Info-leak and abuse hardening

**What it is.** Advertising precise limit state is a usability win but also an
**information disclosure** vector, and the draft (§6) addresses it directly.

- Servers **"MUST NOT convey values exposing an unwanted volume of requests"** and
  **SHOULD cap the ratio** of quota to window, especially for large windows —
  otherwise `RateLimit: r=…` on every response tells a scraper *exactly* how much
  headroom it has to enumerate/scrape without tripping the limit.
- The partition key `pk` **SHOULD be documented** but **SHOULD avoid sensitive
  information** (it is a Byte Sequence, base64-encoded, not a place to leak user
  identifiers or internal keys).
- Precise `X-RateLimit-Remaining` on every 200 can *aid* an attacker pacing an
  enumeration attack right up to the limit — a real trade-off between
  developer-friendliness and abuse resistance. Coarsening or omitting the exact
  remaining count on sensitive/unauthenticated endpoints is a legitimate hardening
  choice.

**Resource-consumption defense is broader than request count (OWASP API4:2023).**
Rate limiting is one control; **Unrestricted Resource Consumption** covers many
other dimensions an attacker can abuse even within the request-count limit:
- max **response items / page size** (an unbounded `?limit=` is a DoS lever),
- request **body / payload size** and **file-upload size**,
- execution **timeouts** and **memory/CPU** caps per request,
- **third-party operational cost** — per-request spend on SMS, email, or cloud
  APIs, where a "cheap" request count masks real money burned.

A complete answer pairs rate/quota limits with these per-request resource caps.

---

## Structured Fields wire mechanics and quota units

**What it is.** The RateLimit fields are **Structured Fields** (RFC 8941, updated
by RFC 9651), and parsing them correctly means following that syntax — a common
implementer trip-up.

- **Names are sf-strings** (double-quoted): `"burst"`, `"daily"`. The parameters
  (`r`, `t`, `q`, `w`, `qu`, `pk`) are sf key/value pairs.
- **`pk` (partition key) is a Byte Sequence** — base64 wrapped in colons, e.g.
  `pk=:aGVsbG8=:` — not a bare string.
- **`w` (window) is a non-zero integer number of seconds**; `q` is a
  request/quota count in the policy's `qu` units.
- **`qu` (quota units)** comes from the registry (§10.3): **`requests`** (default),
  **`content-bytes`**, **`concurrent-requests`**.
- **Lists may be split across multiple header instances** with the same field name
  and must be **recombined** in order before parsing (a single logical List can
  arrive as several header lines).
- These fields **MUST NOT appear in trailers** — only in the header section.
- **Vendor-specific parameters SHOULD be prefixed** to avoid collisions with future
  registered params (e.g. `acme-policy`, not a bare `policy`).

**The draft's own identity.** The current revision is
**`draft-ietf-httpapi-ratelimit-headers-11`** (updated 2026-05-23). It is
**deliberately not tied to RFC 6585 or any specific status code** — the spec says
**"429 is only an example"**; RateLimit fields MAY accompany *any* status,
including 2xx and (with caution) 3xx. So the coupling "RateLimit ⇒ 429" is an
implementation convention, not a spec requirement.

---

## Conserving quota with conditional requests

**What it is.** Conditional requests (the caching topic's `ETag`/`If-None-Match`
and `Last-Modified`/`If-Modified-Since`) intersect with rate limiting: a `304 Not
Modified` returns no body and costs the server far less, so **some APIs charge
`304`/cached responses lightly or not at all** against the rate limit.

**Why it matters for the contract.**
- A client that sends `If-None-Match` and gets `304` conserves both bandwidth and
  (on APIs that discount them) its rate/points budget — a concrete pacing
  technique beyond "just slow down."
- Whether `304`s count against the limit is **API-specific and must be
  documented**; a client can't assume it. (GitHub, for instance, historically did
  not count some conditional `304`s against the limit.)
- This ties rate limiting to caching (RFC 9110 conditional requests, RFC 9111
  caching): the cheapest request is the one you don't fully make, and a
  well-designed contract rewards conditional-request discipline.

---

## Common follow-up questions

- "Why is 429 a 4xx if it's retryable?" Because the fault is on the client
  side (it sent too many requests); it's a client error, but unlike most 4xx it
  becomes valid again after waiting, which is why `Retry-After` accompanies it.
- "429 or 503 for a throttle?" 429 for *per-client* limiting, 503 for
  *server-wide* overload/maintenance. Both may carry `Retry-After`.
- "Timestamp or seconds for reset/Retry-After?" Prefer seconds
  (delta-seconds) — no clock sync needed and it's what the modern RateLimit
  draft uses. HTTP-date is fine for fixed calendar resets (daily quota).
- "Are the RateLimit headers a standard?" They're a Standards-Track IETF
  *draft* (`draft-ietf-httpapi-ratelimit-headers`), not yet an RFC; the modern
  version uses two Structured Fields (`RateLimit`, `RateLimit-Policy`). Many APIs
  still use the informal `X-RateLimit-*` triplet.
- "How should a client handle a 429 with no Retry-After?" Exponential
  backoff with jitter, capped attempts, only auto-retrying idempotent requests.
- "How do you stop a retry storm?" Server: send `Retry-After` and RateLimit
  headers. Client: honor them, add jitter, cap retries.
- "Should a cache store a 429?" No — RFC 6585 says 429 responses must not be
  stored by a cache by default.
- "How do you keep one customer from bypassing an account limit with many
  keys?" Layer a per-account limit above the per-key limit.

## References

- **RFC 9110 — HTTP Semantics** (June 2022): status-code semantics; `Retry-After`
  in §10.2.3 (delay-seconds or HTTP-date). https://www.rfc-editor.org/rfc/rfc9110
- **RFC 6585 — Additional HTTP Status Codes** (April 2012): defines **429 Too
  Many Requests** (§4), plus 428/431/511; notes 429 must not be cached and may
  carry `Retry-After`. https://www.rfc-editor.org/rfc/rfc6585
- **draft-ietf-httpapi-ratelimit-headers — "RateLimit header fields for HTTP"**:
  Standards-Track IETF Internet-Draft defining the `RateLimit` and
  `RateLimit-Policy` structured fields.
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- **RFC 8941 / RFC 9651 — Structured Field Values for HTTP**: the syntax the
  RateLimit fields use. https://www.rfc-editor.org/rfc/rfc9651
- **RFC 9457 — Problem Details for HTTP APIs** (July 2023, obsoletes 7807): the
  recommended body shape for a 429. https://www.rfc-editor.org/rfc/rfc9457
- **RFC 7231 §6.6.4 / RFC 9110 — 503 Service Unavailable**: server-overload
  status distinct from 429.
- **AWS Architecture Blog — "Exponential Backoff and Jitter"**: full jitter and
  decorrelated jitter. https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- **OWASP API Security Top 10 (2023) — API4:2023 Unrestricted Resource
  Consumption**: why rate limiting is a security control.
  https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/
- **OpenAPI 3.1 Specification**: documenting response headers.
  https://spec.openapis.org/oas/v3.1.0
- **draft-ietf-httpapi-ratelimit-headers-11** (updated 2026-05-23): current
  revision defining `RateLimit`/`RateLimit-Policy` params (`r`,`t`,`pk` /
  `q`,`w`,`qu`,`pk`), the quota-unit registry (`requests`, `content-bytes`,
  `concurrent-requests`), problem types (`quota-exceeded`,
  `temporary-reduced-capacity`, `abnormal-usage-detected` with `violated-policies`),
  precedence rules, and info-leak guidance. "429 is only an example" — the fields
  are not tied to any status code.
- **Google API Improvement Proposals / API Design Guide — errors**:
  `RESOURCE_EXHAUSTED`→429, `ErrorInfo`, `QuotaFailure`, `RetryInfo{retry_delay}`.
  https://cloud.google.com/apis/design/errors
- **Google SRE — Handling Overload / Addressing Cascading Failures**: client-side
  adaptive throttling ("accept probability"), retry budgets, metastable failure.
  https://sre.google/sre-book/handling-overload/
- **Stripe API rate limits**: `Stripe-Rate-Limited-Reason`, `lock_timeout`,
  global/endpoint concurrency limits, client-side token-bucket recommendation.
  https://stripe.com/docs/rate-limits
- **GitHub REST API — rate limits**: points/minute, primary vs secondary limits,
  100 concurrent (shared with GraphQL), 403-or-429 behavior.
  https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- **Zalando RESTful API Guidelines — Rule #153**: MUST use 429 with rate-limit
  headers. https://opensource.zalando.com/restful-api-guidelines/
