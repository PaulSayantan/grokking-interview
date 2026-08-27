# API Gateways & Backend-for-Frontend

Most non-trivial APIs do not expose their services directly to the internet.
Between the client and the fleet of services sits an **edge tier** whose job is
to terminate TLS, authenticate the caller, enforce rate limits, route the
request to the right service, and normalize what comes back. Two patterns
dominate that tier: the **API gateway** (one shared front door for many
services) and the **Backend-for-Frontend / BFF** (a dedicated backend tailored
to a single kind of client — web, iOS, Android, partner).

This topic stays at the **API-contract altitude**: what the gateway does to the
*request and response on the wire*, and how those decisions shape the contract a
client actually consumes. It is deliberately distinct from the system-design
altitude (where you decide service boundaries and reason about a distributed
rate-limiter's math) and from any single framework's code — the concepts here
are the same whether the gateway is Kong, Envoy, NGINX, Amazon API Gateway,
Apigee, or a hand-rolled reverse proxy.

The strong interview signal is showing that you know **which cross-cutting
concern belongs at the edge and which does not** — and, critically, that you do
**not** put business logic in the gateway.

> [!KEY-TAKEAWAY]
> A gateway is infrastructure for *cross-cutting, request-shaped* concerns
> (TLS, authN, rate limiting, routing, observability). A BFF is a *product*
> backend owned by a frontend team that shapes payloads for one client. Keep
> domain/business logic out of both the shared gateway's config and — as much as
> possible — behind stable service contracts.

---

## What an API gateway is

**What it is.** An API gateway is a server that sits at the edge of a system and
acts as a **single entry point** for a defined set of APIs. Every external
request lands on the gateway first; the gateway applies a pipeline of
cross-cutting policies and then forwards (proxies) the request to one or more
backend services, returning their response to the client.

**Why it matters.** Without a gateway, every service must independently
implement TLS, authentication, rate limiting, CORS, logging, and so on — and
clients must know the network location of every service. The gateway
**centralizes** those concerns so services stay focused on business logic, and
gives clients **one stable hostname and contract** to code against while the
topology behind it changes freely.

**The request lifecycle at the gateway** (typical order):

1. **Terminate TLS** — decrypt the inbound HTTPS connection.
2. **Authenticate** — validate the API key / bearer token / mTLS cert.
3. **Authorize (coarse)** — check scopes/claims allow the route at all.
4. **Rate limit / throttle** — enforce quotas before doing real work.
5. **Route** — match method + path (+ host/headers) to a backend.
6. **Transform** — rewrite paths, headers, maybe the body.
7. **Forward** — proxy to the backend (often over the internal network).
8. **Transform response** — normalize errors, strip internal headers.
9. **Observe** — emit metrics, logs, and trace spans throughout.

**The Gateway pattern (Gang-of-Four analogy).** It is the network-level cousin
of the Facade pattern: one simple, stable interface in front of a complicated
subsystem. It is also called the "API front door."

> [!INTERVIEW]
> A crisp definition beats a feature list: "An API gateway is a reverse proxy
> specialized for API traffic — it adds authN/Z, rate limiting, routing,
> transformation, and observability as a shared policy layer, so services and
> clients don't each reinvent the edge."

---

## Gateway responsibilities

The gateway's job is the set of **cross-cutting concerns** that (a) apply to
many/most routes and (b) are best expressed as operations on the HTTP
request/response rather than as domain logic. The canonical list:

| Responsibility | What it does on the wire |
|---|---|
| **Routing / dispatch** | Match `METHOD + path (+ host/header)` → upstream service |
| **TLS termination** | Decrypt HTTPS at the edge; manage certificates centrally |
| **AuthN offload** | Validate API keys, JWTs (RFC 7519), OAuth tokens, mTLS |
| **AuthZ offload (coarse)** | Check scopes/claims gate access to a route |
| **Rate limiting / throttling** | Enforce per-key/plan quotas; return `429` |
| **Request/response transformation** | Rewrite paths, headers, body shape |
| **Aggregation / composition** | Fan out to several services, merge responses |
| **Observability** | Central metrics, access logs, distributed-trace headers |
| **Protocol translation** | e.g. REST/JSON at edge → gRPC/other internally |
| **Caching** | Cache cacheable GET responses at the edge |
| **CORS / security headers** | Centralize preflight and security-header policy |

**Why centralize these?** Two reasons. First, **consistency**: one place to
enforce that *every* API requires auth or that *every* error is
`application/problem+json` (RFC 9457). Second, **decoupling**: clients depend on
the gateway's stable contract, not on the shifting internal service map, so you
can split, merge, relocate, or re-language services without breaking clients.

**The boundary test.** Ask: "Does this concern depend on the *meaning* of the
resource, or only on the *shape* of the HTTP message and the *identity* of the
caller?" Shape/identity concerns (auth, rate limit, routing, header rewrite) fit
the gateway. Meaning concerns (is this order eligible for a refund?) do **not** —
they belong in a service. See the anti-patterns section.

> [!WARNING]
> A gateway is a **single point of failure and a shared blast radius**. A bad
> config push, a CPU-heavy transform, or a plugin bug affects *every* API behind
> it. Treat gateway config as production code: version it, review it, roll it
> out gradually, and keep the data plane simple.

---

## Routing and dispatch

**What it is.** Routing is the gateway's core job: deciding, for each inbound
request, which upstream service (and which instance) should handle it. Rules
match on **method, path, host, headers, or query** and map to an **upstream
target** (a service, a load-balancer VIP, or a set of instances).

**Path-based routing** (most common for APIs):

```
GET  /api/orders/*    → orders-service
GET  /api/catalog/*   → catalog-service
POST /api/payments/*  → payments-service
```

**Host-based routing** (multi-tenant / multi-API):

```
Host: orders.api.example.com   → orders-service
Host: catalog.api.example.com  → catalog-service
```

**Path rewriting.** The public path and the internal path usually differ; the
gateway strips or rewrites the prefix so the public contract is stable even if
internal routes change:

```
Client:   GET /api/v2/orders/42
Upstream: GET /orders/42            (prefix /api/v2 stripped, routed to orders-svc)
```

**Advanced routing.** Header/weight-based routing enables **canary** and
**blue-green** releases (route 5% of traffic to `orders-v2`), and **traffic
splitting** by claim (e.g. `X-Beta: true`). This is routing on message *shape*,
not business logic.

> [!TIP]
> Routing rules are ordered/specificity-matched. Put the most specific routes
> first; a greedy `/*` catch-all placed too early will shadow everything after
> it. This is a classic gateway-config bug.

---

## TLS termination

**What it is.** The gateway **terminates** the client's TLS connection —
decrypting HTTPS at the edge — so backends receive plaintext HTTP (or a fresh
internal TLS session). Certificate management, cipher policy, and TLS version
negotiation happen in one place.

**Why it matters.** Centralizing TLS means (a) one place to rotate certs and
retire weak ciphers, (b) backends are relieved of TLS CPU cost, and (c) the
gateway can *read* the request (headers, path, body) to route, authenticate, and
transform — impossible if traffic stayed encrypted end-to-end to the service.

**Termination vs passthrough vs re-encryption:**

| Mode | Edge behavior | Backend sees |
|---|---|---|
| **TLS termination** | Decrypt at gateway | Plaintext HTTP over trusted network |
| **TLS re-encryption (bridging)** | Decrypt, inspect, re-encrypt to backend | New TLS session (defense in depth) |
| **TLS passthrough** | Forward encrypted bytes (L4) | Client's original TLS (gateway can't inspect) |

**The forwarded-headers gotcha.** After termination the backend no longer sees
the original scheme/IP, so the gateway must inject them:

```
X-Forwarded-For: 203.0.113.7
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
Forwarded: for=203.0.113.7;proto=https;host=api.example.com   (RFC 7239)
```

> [!WARNING]
> Backends must trust `X-Forwarded-*` **only** from the gateway, never from
> arbitrary clients — otherwise a client can spoof its source IP or scheme to
> bypass IP allowlists or force-downgrade security checks. Terminate at a
> trusted edge and strip client-supplied forwarding headers.

---

## Authentication and authorization offload

**What it is.** The gateway validates the caller's credentials
(**authentication**) and can do coarse-grained **authorization** — then passes a
*verified* identity to backends so they don't each re-implement token handling.

**Common edge auth mechanisms:**

- **API keys** — `Authorization: Apikey ...` or `X-Api-Key:` header; identifies
  the *application/plan*, good for quotas, weak as a security control alone.
- **Bearer JWT (RFC 7519 / OAuth 2.0)** — `Authorization: Bearer <jwt>`; gateway
  verifies signature (JWKS), `exp`, `iss`, `aud`, and maps scopes → route access.
- **OAuth 2.0 / 2.1 introspection** — for opaque tokens, gateway calls the
  authorization server's introspection endpoint (or caches results).
- **mTLS** — client presents a certificate; used for partner/service-to-service.

**Offload, don't originate.** The gateway *verifies* tokens; it should not *mint*
business decisions. After verifying a JWT it forwards the identity to backends,
e.g.:

```
# inbound
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...

# gateway → upstream (token verified; identity forwarded)
X-User-Id: 8f3c...
X-Scopes: orders:read orders:write
X-Auth-Method: jwt
```

**Coarse vs fine-grained authorization.** The gateway can enforce *coarse* rules
cheaply: "this route needs scope `orders:write`." It generally should **not**
enforce *fine-grained* rules that depend on the resource ("user may edit
order 42 only if they own it") — that requires domain data the service holds.
This maps directly to OWASP API Security Top 10 (2023): **API1 Broken Object
Level Authorization (BOLA)** and **API5 Broken Function Level Authorization**
are usually *service-side* responsibilities the gateway cannot fully cover.

> [!WARNING]
> A gateway that verifies auth is necessary but **not sufficient**. If backends
> are reachable on the internal network *without* re-checking identity, an
> attacker who reaches a service directly (SSRF, misconfig, lateral movement)
> bypasses all edge auth. Defense in depth: services must not blindly trust that
> "traffic on the internal network is already authenticated."

---

## Rate limiting and throttling

**What it is.** The gateway limits how many requests a client (key, user, IP, or
plan) may make in a window, protecting backends from overload and abuse and
enforcing commercial quotas. When a caller exceeds the limit the gateway returns
**`429 Too Many Requests`** without touching the backend.

**Why the edge is the right place.** Rejecting excess load *before* it consumes
backend resources is the whole point — the cheapest request to serve is the one
you reject early. It's also where you can see all of a caller's traffic across
services (a per-service limit can't).

**The response contract.** A well-behaved gateway tells the client *when* to
retry:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 30
Content-Type: application/problem+json

{ "type": "https://example.com/probs/rate-limit",
  "title": "Too Many Requests", "status": 429,
  "detail": "Quota of 100 req/min exceeded" }
```

- `Retry-After` (RFC 9110 §10.2.3) — seconds (or an HTTP-date) to wait.
- `RateLimit-*` headers — a convention for exposing quota state.

> [!WARNING]
> **The `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` triplet
> shown above is the *legacy* form.** The current IETF draft
> (`draft-ietf-httpapi-ratelimit-headers`, at -11) **replaced** it with two
> **RFC 9651 Structured Fields** headers carrying named parameters:
>
> ```
> RateLimit-Policy: "burst";q=100;w=60          ; q=quota, w=window(s), qu=quota-unit, pk=partition-key
> RateLimit:        "burst";r=0;t=30            ; r=remaining, t=reset-window(s), pk=partition-key
> ```
>
> The single-header tripartite legacy form and the even-older, never-standardized
> `X-RateLimit-*` are widely deployed but not the current standard. Only
> `Retry-After` (RFC 9110) is a stable normative header here. Know all three
> generations and which is current — a common senior "gotcha."

**Algorithms (named at contract altitude; the math lives in system-design):**
fixed window, sliding window, **token bucket** (allows bursts up to bucket
size), and leaky bucket (smooths to a constant rate). Token bucket is the most
common gateway default because it permits short bursts while capping average
rate.

**Token bucket, traced.** Bucket **capacity 100**, refill **10 tokens/sec**.
Each request costs 1 token; a request is allowed only if a token is available.
- **t=0:** bucket starts full at **100**. A burst of **100** requests arrives at
  once → each takes a token → bucket drains **100 → 0**, all 100 **allowed**.
- **t=0 (101st request):** bucket is **0**, no refill has elapsed → **`429`**.
- **idle 3s:** refill adds `10 × 3 = 30` tokens (capped at capacity 100) →
  bucket holds **30**. A new burst → **30** requests pass, the **31st** gets `429`.

Steady-state throughput is pinned to the **refill rate (10/sec)** no matter how
big the bursts; the **capacity (100)** just sets how large a one-off burst may be.
This is exactly AWS API Gateway's naming: the **burst limit** *is* the bucket
size, the **rate limit** *is* the refill rate.

**429 vs 503.** Use **`429`** for *per-client* quota/throttle ("you specifically
sent too much"); use **`503 Service Unavailable`** (often with `Retry-After`)
for *server-side* overload/shedding affecting everyone. Don't return `503` for a
single noisy client.

> [!TIP]
> Distinguish **rate limiting** (protect against abuse / enforce fairness) from
> **quotas/plans** (commercial — 10k calls/day on the free tier) from **spike
> arrest / concurrency limits** (cap simultaneous in-flight). Interviewers like
> when you separate these; they have different windows and different `429` copy.

---

## Request and response transformation

**What it is.** The gateway can rewrite the request before forwarding and the
response before returning it: add/remove/rename headers, rewrite paths, map
query params, strip internal fields, and (sometimes) reshape the body.

**Common transformations:**

- **Header manipulation** — inject `X-Request-Id`/trace headers, add
  `X-Forwarded-*`, strip hop-by-hop and internal headers (`Server`, `X-Powered-By`,
  internal debug headers) from responses.
- **Path/prefix rewriting** — `/api/v2/orders` → `/orders` (see routing).
- **Protocol / format translation** — accept REST/JSON at the edge, speak gRPC
  or SOAP internally; or translate `application/xml` ↔ `application/json`.
- **Error normalization** — turn a backend's raw `500`/HTML into a consistent
  `application/problem+json` body (RFC 9457) so clients get one error shape.
- **Response filtering** — strip fields the client shouldn't see (a light touch;
  heavy per-client reshaping is a BFF job).

**Why it matters.** Transformation lets the *public contract* stay stable and
clean while internal services evolve, use different protocols, or expose
messier shapes. It also centralizes security hygiene (removing
version-disclosing headers) and observability plumbing (trace-id injection).

> [!WARNING]
> Transformation is where "just a little logic" sneaks into the gateway. Header
> rewriting and error normalization are fine. Parsing the body to compute a
> business field, or branching on domain state, is business logic in disguise —
> it couples the gateway to the domain and belongs in a service or BFF. Keep
> transforms **structural**, not **semantic**.

---

## API composition and aggregation

**What it is.** **Aggregation** (a.k.a. the API Composition / Gateway
Aggregation pattern) means the gateway (or a BFF) receives *one* client request,
**fans out** to *several* backend services in parallel, and **merges** their
responses into a single payload — so a client makes one round trip instead of
many.

**Why it matters.** On high-latency mobile networks, N sequential requests to
build one screen is painful. Aggregating server-side (where service-to-service
latency is tiny) collapses N round trips into one for the client and hides the
service decomposition.

**Example — a mobile "home screen" call:**

```
Client:  GET /home                 (one request)

Gateway/BFF fans out in parallel:
  GET user-service/users/42/profile
  GET orders-service/users/42/recent-orders?limit=3
  GET recommendations-service/users/42/recos

Merged response:
{
  "profile":  { ... },
  "recentOrders": [ ... ],
  "recommendations": [ ... ]
}
```

**Partial failure is the hard part.** If recommendations time out but profile
and orders succeed, what do you return? Options: return `200` with the
recommendations field null/omitted plus a partial-result marker; return a
degraded response; or fail the whole call. **Don't let one slow dependency block
the whole screen** — use per-call timeouts and graceful degradation. This
resilience logic is exactly why aggregation often lives in a **BFF** (owned by
the client team) rather than a shared gateway: it encodes product decisions
about what's "good enough."

The decision rule interviewers push on ("profile fails vs recos fails — same
response?"): classify each field as **critical** or **enrichment**. *Critical*
data (identity/profile — the screen is meaningless without it) → **fail the call**
(5xx) if it's missing. *Enrichment* data (recommendations, badges, "customers
also bought") → **omit it and still return `200`**. Either way the payload should
carry a machine-readable marker (e.g. a `partial: true` flag or an `errors[]`
array naming the dropped fields) so the client can tell "this field was dropped
due to a failure" apart from "this field is genuinely empty."

**GraphQL as an alternative.** A GraphQL layer is another aggregation approach:
the client specifies exactly which fields across which services it wants in one
query, shifting composition to a schema/resolver layer. Trade-off vs a hand-rolled
BFF/aggregator: more flexible for clients, but more caching/complexity/security
surface (query cost, depth limits).

> [!INTERVIEW]
> The subtle point interviewers probe: **aggregation ≠ orchestration.**
> Read-side fan-out/merge is a reasonable gateway/BFF job. Multi-step *write*
> orchestration with compensation (sagas) is business logic and belongs in a
> service, not the edge.

---

## The Backend-for-Frontend (BFF) pattern

**What it is.** BFF (coined at SoundCloud, popularized by Sam Newman) is the
pattern of building **one backend per client experience** instead of one
general-purpose API for all clients. The web app talks to a **web BFF**, iOS to
an **iOS BFF**, the public partner API to a **partner BFF** — each owned by (or
close to) the team that owns that frontend.

**Why it exists.** A single general-purpose backend is pulled in conflicting
directions: mobile wants small, few, aggregated payloads (battery, bandwidth,
small screen); web wants richer data; partners want a stable, conservative
contract. Serving all of them from one API leads to over-fetching, `?include=`
flag sprawl, and a backend team that becomes a bottleneck for every client
change. A BFF lets each client's needs evolve **independently**.

**What a BFF does (and a shared gateway usually doesn't):**

- Aggregates/composes calls tailored to *that client's* screens.
- Reshapes payloads to exactly what the client renders (field selection,
  renaming, unit/format conversion, trimming).
- Encodes client-specific concerns: mobile push tokens, web session cookies,
  device-specific logic.

**BFF vs gateway — they compose, they don't compete:**

| | API Gateway | BFF |
|---|---|---|
| Scope | One shared front door, many clients | One backend per client type |
| Owner | Platform/infra team | The frontend team |
| Concerns | Generic cross-cutting (authN, rate limit, routing) | Client-specific shaping/aggregation |
| Contains logic? | No business logic | *Presentation/aggregation* logic, minimal domain logic |
| Count | Usually one (or a few) | One per client experience |

A common topology: **gateway at the very edge** (TLS, authN, global rate limit)
→ **per-client BFFs** behind it → **domain services** behind those.

**Trade-offs / gotchas.**

- **Code duplication.** Similar aggregation appears in each BFF. Mitigate by
  extracting shared libraries — *not* by collapsing back into one BFF-for-all
  (which recreates the general-purpose-backend problem).
- **Proliferation.** One BFF per client can multiply. Group by client *class*
  (all mobile share one) rather than per app version.
- **Don't leak domain logic into the BFF.** A BFF should orchestrate and shape,
  not become the system of record. Business rules stay in services.

> [!KEY-TAKEAWAY]
> BFF answers "who is this backend *for*?" — a specific frontend. It optimizes
> the payload and round trips for that client and lets its team move
> independently. It is an application-tier pattern; the API gateway is an
> infrastructure-tier pattern. Real systems use both.

---

## Gateway vs load balancer vs reverse proxy vs service mesh

These four overlap (a gateway *is* a specialized reverse proxy) but sit at
different layers and solve different problems. Getting the boundaries right is a
frequent interview question.

| Component | OSI layer | Primary job | API/L7 awareness |
|---|---|---|---|
| **Load balancer** | L4 (or L7) | Distribute traffic across instances for scale/HA | L4: none; L7 LB: some |
| **Reverse proxy** | L7 | Front servers: forward, cache, terminate TLS, hide origin | Generic HTTP |
| **API gateway** | L7 | API-specific edge: authN/Z, rate limit, routing, transform, aggregation | Deep (API-aware) |
| **Service mesh** | L7 (sidecar) | *East-west* service-to-service: mTLS, retries, traffic policy | Deep, but internal |

**Load balancer.** Answers "which instance?" for scale and availability. An
**L4 LB** balances TCP/UDP without reading HTTP; an **L7 LB** can route on path/
host but stops short of auth, quotas, and transformation. A gateway usually sits
*behind* an LB (or has one built in).

**Reverse proxy.** The general category (NGINX, HAProxy): terminates TLS,
forwards to origins, caches, hides internal structure. A gateway is a reverse
proxy **plus** API-management features (keys, plans, developer portal, aggregation).

**API gateway vs service mesh — the key distinction is direction of traffic:**

- **Gateway = north-south** traffic: *external clients ↔ your system*, at the
  edge. One centralized entry point.
- **Service mesh = east-west** traffic: *service ↔ service inside* the system,
  via **sidecar proxies** (e.g. Envoy) next to each service. It handles mTLS
  between services, retries, circuit breaking, and fine-grained traffic policy —
  transparently, without app code.

They are complementary: a gateway governs who gets *in*; the mesh governs how
internal services talk to *each other*. Some products (e.g. Envoy-based) power
both roles.

> [!INTERVIEW]
> If asked "isn't a gateway just an L7 load balancer?" — no. An L7 LB routes and
> balances HTTP; a gateway adds the **API-management layer**: authentication,
> authorization, quotas/plans, request/response transformation, aggregation, and
> developer-facing concerns. Overlapping mechanics, different job.

---

## Gateway anti-patterns

**The cardinal sin: business logic in the gateway.** The most-tested
anti-pattern. Because gateways can transform requests and run plugins/scripts,
teams are tempted to encode domain rules there — "if the cart total > $500 apply
the discount," "validate the order's line items," "compute loyalty tier." This
is wrong because:

- **It couples the shared edge to one domain.** A change to order rules now
  requires a gateway deploy — and the gateway is shared by *every* API.
- **Blast radius.** A bug in that logic can take down all APIs, not one service.
- **Wrong ownership.** Domain logic belongs to the team that owns the domain,
  tested in that service's suite — not buried in gateway config a platform team
  maintains.
- **Testability & observability suffer.** Logic in proxy config/scripts is hard
  to unit-test, version, and debug compared to service code.

**The overambitious / "god" gateway (ESB creep).** Piling orchestration,
transformation-heavy mediation, and business rules into the gateway recreates
the old **Enterprise Service Bus** anti-pattern: a smart, central, fragile
bottleneck ("smart pipes, dumb endpoints"). Modern guidance is the opposite —
**smart endpoints, dumb pipes**: keep the gateway thin.

**Other anti-patterns:**

- **The chatty gateway / N+1 aggregation** — fanning out to dozens of services
  per request without parallelism, timeouts, or partial-failure handling.
- **Single point of failure without redundancy** — one gateway instance, no
  HA/failover; the edge must be at least as available as anything behind it.
- **Leaking internals** — passing backend stack traces, internal hostnames,
  `Server`/`X-Powered-By` headers, or raw upstream errors straight to clients.
- **Auth-only-at-the-edge** — trusting the internal network so services never
  re-verify identity (see the authZ section; defense in depth).
- **Distributed monolith via the gateway** — using gateway config to tightly
  sequence services so nothing can deploy independently.
- **Config drift / untested config** — treating gateway config as ad-hoc
  clicks in a console rather than reviewed, versioned, gradually-rolled-out code.

> [!WARNING]
> Litmus test for "does this belong in the gateway?": *If the rule changes when
> the business changes, it's business logic — put it in a service.* If it changes
> when the network/security/traffic policy changes, it's a gateway concern.

---

## Resilience patterns at the edge

Rejecting excess load (rate limiting) is only half the reliability story. The
other half is protecting the *system* from its own failing dependencies. A
gateway (and especially a BFF that fans out) needs the standard resilience
toolkit:

- **Per-upstream timeouts.** Every proxied call gets a bounded deadline. Without
  one, a hung backend exhausts the gateway's connection/thread pool and the
  failure spreads. Timeouts should sum to a **latency budget** for the whole
  request, not be set independently. **Traced:** client budget is **2s**. If each
  hop is given an independent **1s** timeout on a 3-hop chain (gateway→A 1s, then
  A→B 1s, then B→C 1s), the worst case is `1 + 1 + 1 = 3s` — the chain can spend
  **3s** on a request the client already abandoned at 2s. Inner deadlines must be
  *strictly smaller* than the outer budget and shrink as you go deeper: e.g.
  gateway 2s → A 1.5s → B 1s → C 0.5s, each hop passing its *remaining* budget
  down (a deadline, not a fresh timeout) so total work never exceeds 2s.
- **Retries — only on idempotent/safe methods.** Retrying a failed `GET`, `PUT`,
  or `DELETE` is safe (RFC 9110 idempotency). **Retrying a non-idempotent `POST`
  can duplicate a write** (double-charge, double-order). Retry only when the
  method is idempotent *or* an `Idempotency-Key` makes it safe (see below).
- **Retry budgets, not fixed counts.** Naïve "retry 3×" turns a partial outage
  into a **retry storm** that amplifies load 3–4× exactly when the backend is
  weakest. Cap retries as a *percentage of total traffic* (a budget) and add
  jittered exponential backoff.

  **Retry storm, traced.** Backend is failing **50%** of calls; policy retries up
  to 3× on failure. Start with **1000** client requests:
  - Attempt 1: 1000 calls → 500 fail.
  - Retry 1: 500 calls → 250 fail.
  - Retry 2: 250 calls → 125 fail.
  - Retry 3: 125 calls → (give up on the ~62 that still fail).

  Upstream calls = `1000 + 500 + 250 + 125 = 1875` — about **1.9×** the offered
  load, and that surge lands *precisely* when the backend is already half-down. A
  **10% retry budget** instead caps retries at `0.10 × 1000 = 100` extra calls
  (1100 total, 1.1×), so a struggling backend can recover instead of being buried.
- **Circuit breaker.** After a threshold of failures, "open" the breaker and
  fail fast (shed the dependency) instead of piling requests onto a sick
  backend; periodically "half-open" to probe recovery. This bounds blast radius.
- **Bulkhead isolation.** Give each upstream its own connection pool/concurrency
  limit so one slow dependency can't consume all the gateway's resources and
  starve unrelated routes (the ship-compartment metaphor).
- **Load shedding / backpressure.** Under global overload, proactively drop or
  reject the lowest-priority work with **`503 Service Unavailable` + `Retry-After`**
  to protect the core. This is the server-wide analogue of per-client `429`.

> [!INTERVIEW]
> "You add retries at the gateway — what can go wrong?" Strong answer names all
> three traps: (1) non-idempotent duplication, (2) retry storms amplifying an
> outage, (3) stacked timeouts blowing the latency budget. The fixes: idempotency
> keys, retry budgets with backoff+jitter, and a circuit breaker.

---

## Edge caching (RFC 9111)

A gateway/CDN can cache cacheable responses to cut latency and offload backends,
but HTTP caching (RFC 9111, plus RFC 5861 extensions) has sharp edges.

- **Shared vs private cache.** A gateway/CDN is a **shared cache** serving many
  users. `Cache-Control: private` forbids a shared cache from storing a response
  (only the end-user's browser may); `public` explicitly allows it.
- **`s-maxage`.** Overrides `max-age` **for shared caches only** — lets you cache
  longer at the edge than in browsers.
- **`stale-while-revalidate` / `stale-if-error` (RFC 5861).** Serve slightly
  stale content instantly while asynchronously revalidating, or serve stale on a
  backend error — both improve resilience and tail latency.
- **`Vary` and cache-key construction.** The cache key is method+URL **plus**
  whatever `Vary` lists (e.g. `Vary: Accept-Encoding, Accept-Language`). Getting
  `Vary` wrong either serves the wrong variant or destroys hit rate.
- **`ETag` + conditional revalidation.** `If-None-Match` lets the edge revalidate
  cheaply and return `304 Not Modified` without re-sending the body.
- **Invalidation / purge.** Time-based expiry is passive; explicit purge/ban APIs
  actively evict a key when data changes. Invalidation is the hard part of edge
  caching.

> [!WARNING]
> **Never let a shared edge cache store an authenticated/personalized response
> under a non-user-specific key** — user A's balance gets served to user B (a
> cross-tenant data leak). Personalized responses need `Cache-Control: private`
> (or `no-store`), or a cache key that includes the user identity, plus correct
> `Vary`. A cache that ignores `Authorization`/`Cookie` in its key is the classic
> failure mode.

### Request collapsing / coalescing

When many clients request the **same cacheable key** and it's a cache **miss**,
a naïve edge forwards *all* of them to the origin — a **cache stampede / thundering
herd** that can topple a cold backend. **Request collapsing** (a.k.a. coalescing
or request dedup) merges concurrent identical misses into **one** upstream fetch;
the single response fills the cache and fans back out to all waiters.

This is the mirror image of aggregation: aggregation **fans out** one request to
many services; collapsing **folds in** many requests to one upstream call.
Combined with `stale-while-revalidate`, it keeps a hot key from ever hammering
the origin.

---

## GraphQL federation as an aggregation/BFF alternative

Beyond a single GraphQL server, **federation** (e.g. Apollo Federation) is a way
to build one graph from many independently-owned services:

- **Subgraph** — a service that owns part of the schema (its types/fields).
- **Supergraph** — the composed schema stitched from all subgraphs.
- **Router (the gateway)** — receives one client query, plans it, and orchestrates
  calls across subgraphs, merging the result. Teams own their subgraph schemas
  independently.

**Trade-offs vs a REST BFF:**

- **Pro:** clients fetch exactly what they need in one query; you avoid
  hand-writing and maintaining N bespoke aggregators; teams evolve subgraphs
  independently.
- **Con:** an extra **router hop**; the classic **resolver N+1** problem (a field
  resolver firing one backend call per list item — mitigated with dataloader/
  batching); need for **query-cost / depth limiting** to stop abusive deep queries;
  **HTTP caching is harder** (queries are usually `POST`ed to one endpoint);
  **persisted queries** (client sends a hash of a pre-registered query) are used
  to restore GET-cacheability and block arbitrary queries.

The common 2025 design question — "**REST BFF vs GraphQL federation** for a
multi-client product" — turns on ownership model, caching strategy, N+1/query-cost
control, and whether the extra router operational hop is worth avoiding N
aggregators.

---

## WAF vs API gateway (security layering)

A **Web Application Firewall (WAF)** and an API gateway are different security
layers that **stack**, they are not substitutes:

- **WAF** inspects traffic for **attack payloads** — SQL injection, XSS, path
  traversal, OWASP-web signatures — plus bot/DDoS mitigation and IP reputation.
  It answers "is this request *malicious*?"
- **API gateway** does **API management** — authN/Z, quotas, routing, transform.
  It answers "is this caller *allowed* and *within limits*?"

Typical order in the path: **client → WAF → API gateway → (service mesh) →
service**. Conflating them maps to **OWASP API8 Security Misconfiguration**.
Managed stacks often integrate a WAF in front of the gateway (e.g. AWS WAF +
Amazon API Gateway).

---

## BFF as a security pattern (token-handling BFF for SPAs)

Modern guidance (IETF `oauth-browser-based-apps` draft, OWASP) reframes the BFF
as a **security** boundary, not just a payload-shaper, for browser apps (SPAs):

- The **BFF holds the OAuth tokens server-side** (access + refresh).
- The browser receives only an **`HttpOnly; Secure; SameSite`** session cookie —
  a reference to the server-side session. Access/refresh tokens **never touch
  JavaScript** or `localStorage`.
- The BFF attaches the real token when proxying to APIs.

**Why:** tokens in `localStorage`/JS are exfiltratable by any XSS. `HttpOnly`
cookies are unreadable by script, so a token-handling BFF removes the highest-value
XSS target. The trade-off is that cookie-based sessions must defend **CSRF**
(via `SameSite` and/or CSRF tokens). "Where do you store SPA OAuth tokens?" → a
token-handling BFF with `HttpOnly` cookies, **not** `localStorage`.

### Token exchange: phantom-token and split-token patterns

The gateway can decouple the token the **client** holds from the token the
**backend** receives:

- **Phantom token.** The client holds an **opaque reference token**; the gateway
  introspects it and swaps in a **JWT** forwarded to backends. JWT internals
  never appear on the public wire (no signature/claims to attack or leak), and
  revocation is easy (revoke the opaque reference).
- **Split token.** The signature and payload of a JWT are split; the client holds
  one part, the gateway reassembles — a variant optimizing introspection.
- **RFC 8693 OAuth Token Exchange.** A standard for the gateway to **downscope**
  or **delegate** — exchange the caller's token for a narrower one scoped to a
  specific downstream service (least privilege between hops).

---

## JWT validation edge cases and attacks

Verifying a JWT is more than "check the signature." Senior-level pitfalls (all
map to **OWASP API2 Broken Authentication**):

- **JWKS + `kid`.** The gateway fetches the issuer's **JWKS** (JSON Web Key Set)
  and selects the key by the token header's **`kid`**. It must **cache** JWKS
  (network fetch per request is a latency/availability risk) yet **refresh on
  key rotation** — a cache miss on `kid` should trigger a refetch, not a reject.
- **`alg=none` attack.** A forged token sets the header `alg` to `none` and
  drops the signature; a naïve verifier that honors the token's own `alg`
  accepts it. **Defense:** the verifier must pin the expected algorithm(s), never
  trust the token's `alg` for `none`.
- **Algorithm-confusion (RS256 → HS256).** An attacker changes `alg` from RS256
  (asymmetric) to HS256 (symmetric) and signs with the **public** key as the HMAC
  secret. If the verifier uses the same "key" for both, it validates. **Defense:**
  bind each key to one algorithm; don't let the token choose.
- **Always validate `exp`, `nbf`, `iss`, `aud`.** A structurally-valid signature
  on a token minted for a different audience/issuer must still be rejected.

---

## OWASP API Security Top 10 (2023) — gateway-relevant items

The content already cites **API1 (BOLA)** and **API5 (BFLA)** as mostly
service-side. The gateway is the enforcement point for several others:

| Item | What it is | Gateway's role |
|---|---|---|
| **API2 Broken Authentication** | Weak/foolable token validation | Robust JWT/JWKS validation; reject `alg=none`/confusion |
| **API4 Unrestricted Resource Consumption** | No rate/size/quota limits | The gateway's **core** mandate: rate limits, quotas, body-size caps, timeouts |
| **API7 SSRF** | Server fetches an attacker-supplied URL | Validate/allowlist any user-supplied URIs the gateway/backend fetches |
| **API8 Security Misconfiguration** | Missing hardening, verbose errors | Strip internal headers, normalize errors, correct CORS, WAF layering |
| **API9 Improper Inventory Management** | Shadow/zombie/deprecated APIs | Gateway is the **API inventory & deprecation** enforcement point |
| **API10 Unsafe Consumption of APIs** | Blindly trusting third-party APIs | Validate/transform responses from upstreams the gateway consumes |

---

## API lifecycle: versioning, deprecation, and Sunset

The gateway is where API **inventory and lifecycle** are enforced — directly
addressing **API9 (Improper Inventory Management)**: undocumented "shadow" APIs
and forgotten "zombie" old versions are a top breach vector.

- **Version routing.** The gateway routes `v1` vs `v2` (path, header, or media
  type) to the right backend, letting versions coexist during migration.
- **`Sunset` header (RFC 8594).** Advertises the date/time a resource will stop
  working: `Sunset: Sat, 31 Jan 2026 23:59:59 GMT`. Clients (and tooling) can
  detect the retirement window.
- **`Deprecation` header (RFC 9745).** Signals a resource is deprecated,
  typically paired with a `Link; rel="deprecation"` or `rel="sunset"` pointing to
  docs and `Sunset`. Standardized in 2025 as RFC 9745 (Proposed Standard), which
  supersedes the earlier `draft-ietf-httpapi-deprecation-header` and pins the
  value to a Structured-Fields Date (e.g. `Deprecation: @1735689600`).

Centralizing this at the gateway means a single, auditable place that knows every
live route and its lifecycle state — the antidote to zombie APIs.

---

## CORS handling at the edge

Cross-Origin Resource Sharing governs whether a browser lets page JS on origin A
call API origin B. Centralizing it at the gateway avoids per-service drift:

- **Preflight.** For non-simple requests the browser sends an `OPTIONS` preflight
  carrying `Access-Control-Request-Method`/`-Headers`; the gateway answers with
  `Access-Control-Allow-Origin/-Methods/-Headers` and caches the decision via
  **`Access-Control-Max-Age`**.
- **Credentials pitfall.** `Access-Control-Allow-Credentials: true` **cannot** be
  combined with `Access-Control-Allow-Origin: *` — the browser rejects it. With
  credentials you must echo a **specific** allowed origin (and `Vary: Origin`).
- **CORS is not authorization.** It only constrains *browsers*; it is not a
  server-side access control. Non-browser clients ignore it entirely.

---

## Control plane vs data plane

A gateway has two conceptually separate planes:

- **Data plane** — the request path that forwards/transforms live traffic. It
  must be **simple, fast, and (ideally) stateless** so it stays fast and its
  blast radius is contained.
- **Control plane** — config/management: defining routes, policies, keys, plans,
  publishing changes. Config changes should be versioned, reviewed, and rolled
  out gradually (the SPOF warning applies).

Deployment models: **managed** (Amazon API Gateway, Apigee) offload the ops;
**self-hosted** (Kong, Envoy, NGINX, Traefik) give control; **microgateway /
decentralized** deploys a small gateway per service or per team (closer to the
mesh model) to avoid one central choke point.

---

## Kubernetes: Ingress vs Gateway API vs API gateway

Three overlapping things, each stopping at a different point:

- **`Ingress`** — the original Kubernetes L7 resource: basic host/path HTTP
  routing to Services, TLS. Limited expressiveness; vendors bolted features on via
  annotations (non-portable).
- **Gateway API** — the **role-oriented successor** to Ingress:
  **`GatewayClass`** (infra provider), **`Gateway`** (a listener, owned by cluster
  ops), and **`HTTPRoute`** (routing rules, owned by app teams). Richer,
  portable, header/traffic-split aware — but still fundamentally *routing*.
- **Full API gateway** — adds the **API-management layer** on top: authN/Z,
  quotas/plans, transformation, aggregation, developer portal.

Rule of thumb: Ingress/Gateway API get traffic *to* the right service; a full API
gateway governs *how APIs are consumed*. Gateway API can be the data plane an API
gateway product builds on.

---

## Service discovery and health checking

The gateway must resolve an upstream **service name** to concrete healthy
instances:

- **Discovery mechanisms:** static config; **DNS**; a **service registry**
  (Consul, Eureka); or **EDS** (Envoy's Endpoint Discovery Service) for dynamic
  membership.
- **Active health checks** — the gateway probes an upstream `/health` endpoint on
  an interval and stops routing to failing instances.
- **Passive health checks / outlier ejection** — the gateway watches live traffic
  and **ejects** an instance that returns too many errors/timeouts, re-admitting
  it after a cooldown. Cheaper than active probes and reacts to real failures.

---

## Streaming and protocol support at the edge

Beyond request/response REST, a gateway increasingly must handle:

- **WebSocket** — upgrade `Connection: Upgrade`; long-lived bidirectional
  connections need connection limits and idle timeouts tuned very differently
  from short HTTP requests.
- **Server-Sent Events (SSE)** — one-way streaming over a long-lived HTTP
  response (`text/event-stream`); buffering/response-flush behavior at the gateway
  matters or events stall.
- **HTTP/2 and HTTP/3 (QUIC).** Multiplexing (H2) and UDP-based QUIC (H3) at the
  edge; the gateway often terminates a modern client protocol and speaks a simpler
  one to backends.
- **gRPC and gRPC-JSON transcoding.** The gateway can expose a REST/JSON facade
  and transcode to gRPC upstream (protocol translation, extended to streaming).

Long-lived connections change the resource model: connection count, not
requests/second, becomes the scaling constraint.

---

## Idempotency support at the edge

An **`Idempotency-Key`** request header lets a client safely retry an otherwise
non-idempotent request (e.g. `POST /payments`). The server (or gateway)
remembers the key and returns the **original result** for a duplicate instead of
performing the action twice.

This interacts with gateway retries: if the gateway retries a `POST` on the
client's behalf, an idempotency key is what makes that retry *safe*. Without it,
gateway-level retries of non-idempotent requests are dangerous (duplicate writes).

---

## Request and schema validation at the edge

The gateway can reject malformed requests **before** they reach a backend,
offloading validation and shrinking attack surface (defends **API4** and
**API8**):

- **Schema validation** — validate request bodies/params against an **OpenAPI
  3.1** schema at the edge; reject non-conforming requests with `400`.
- **Size limits** — cap body and header sizes to blunt resource-exhaustion
  attacks (an **API4** control).
- **Content-type / method allowlists** — reject unexpected verbs and media types
  early.

Keep this **structural** (does the message conform to the contract?), not
**semantic** (is this a valid business operation?) — the latter is service logic.

---

## Tail-latency amplification and composition consistency

Two subtle consequences of fan-out aggregation that senior interviews probe:

- **Tail-latency amplification.** When one request fans out to **N** services in
  parallel and waits for all, the client's latency is the **slowest of N**. Even
  if each service has a good p99, the probability that *at least one* of N is slow
  rises fast, so the aggregate p99 is much worse than any single backend's. "Every
  backend p99 is fine but client p99 is bad" is explained by this. Mitigations:
  **per-call timeouts within a latency budget**, **hedged requests** (fire a
  duplicate to a second replica after a delay, take the first to answer), and
  degrading non-critical fields.

  **Worked example.** Say each backend independently exceeds its p99 latency (is
  "slow") **1% of the time** (0.01), and each call is independent. The chance the
  *whole* fan-out is slow is `1 − (fraction that are all fast)`:
  - **N = 1:** `1 − 0.99¹ = 0.01` → **1%** slow (the client sees the backend's own p99).
  - **N = 10:** `1 − 0.99¹⁰ = 1 − 0.9044 = 0.0956` → **~9.6%** slow.
  - **N = 50:** `1 − 0.99⁵⁰ = 1 − 0.605 = 0.395` → **~39%** slow.

  So fanning out to 10 healthy backends turns a per-service **p99** event into
  roughly a client-side **p90** event (slow ~1-in-10 requests); at 50 backends
  nearly *2 in 5* requests hit a slow tail. The fleet is fine — the *composition*
  is what degrades, which is why you need timeouts + hedging, not just faster
  backends.
- **Composition consistency.** Aggregating across services merges data captured at
  **different points in time** — there is **no cross-service transaction**. A
  merged payload can show a total that doesn't match its line items, or a count
  that disagrees with the list, because each sub-response is an independent
  read-time snapshot. This is an **eventual-consistency / read skew** artifact, not
  a bug in one service; call it out and, if it matters, fetch the dependent values
  from a single consistent source.

---

## The three named gateway patterns

Microsoft/Azure formalize three distinct gateway patterns worth naming precisely:

- **Gateway Routing** — route requests to multiple services behind one endpoint
  (the routing/dispatch job).
- **Gateway Aggregation** — fan out one request to several services and merge
  (the composition job).
- **Gateway Offloading** — move **shared, cross-cutting** functionality (TLS,
  authN, rate limiting, logging) into the gateway. The rule: **only offload what
  the whole app uses**, and **never offload business logic**.

---

## mTLS and SNI detail

Extending the one-line mTLS mention:

- **Mutual TLS (mTLS)** — both sides present certificates. **Client-certificate
  validation becomes an authentication mechanism** (the cert identifies the
  caller) — common for partner and service-to-service traffic.
- **SNI (Server Name Indication)** — the client sends the target hostname in the
  TLS `ClientHello`, so the gateway can select the right cert **and even route**
  (SNI-based routing) before/without terminating, useful in passthrough mode.
- **Certificate rotation** — client and server certs expire; the edge must rotate
  without downtime (overlapping validity, automated issuance). Expired-cert
  outages are a classic edge incident.

---

## Managed vs self-hosted trade-offs (with AWS specifics)

Concrete grounding many interviewers use:

- **Managed (Amazon API Gateway, Apigee):** less ops, built-in integrations, but
  less control and provider-specific limits. AWS specifics worth naming: **usage
  plans + API keys** (quota + throttle per key), **burst vs steady-state throttle**
  implemented as a **token bucket** (steady rate = bucket refill, burst = bucket
  size), **stage-level caching**, **Lambda/custom authorizers** (offload auth to
  your own function returning an IAM/allow policy), and **WAF integration** in
  front.
- **Self-hosted (Kong, Envoy, NGINX, Traefik):** full control and portability, but
  you own scaling, HA, and upgrades.

---

## AI/LLM gateways (forward-looking)

An emerging category: a gateway specialized for LLM/model traffic. It differs
from a classic API gateway in what it meters and inspects:

- **Token/cost-based rate limiting** — limit by **tokens or dollar cost**, not
  request count, since one request's cost varies wildly.
- **Semantic caching** — cache by **embedding similarity** of prompts, not exact
  key match, to reuse answers to near-duplicate questions.
- **Prompt-injection guards and PII redaction** — inspect/scrub prompts and
  completions.
- **Model routing / fallback** and **MCP routing** — route to the cheapest/best
  model or tool, with failover.

Mention it as a trend; the underlying discipline (metering, caching, security at
the edge) is the same, just measured in tokens.

---

## Common follow-up questions

- "Where do you put authentication vs authorization?" AuthN and coarse authZ
  (scope/route gating) at the gateway; fine-grained, resource-level authZ (BOLA,
  ownership checks) in the service that owns the data.
- "Gateway or BFF for aggregating a mobile home screen?" Prefer a BFF owned
  by the mobile team — it encodes product decisions about partial failure and
  payload shape. A shared gateway shouldn't hold client-specific logic.
- "How do you avoid the gateway being a SPOF?" Run it redundantly behind an
  LB, keep the data plane simple/stateless, externalize state (rate-limit
  counters), and roll config out gradually with fast rollback.
- "Isn't a service mesh a replacement for a gateway?" No — mesh is east-west
  (internal service-to-service); gateway is north-south (external ingress). Many
  systems run both.
- "Why not just let clients call services directly?" Clients would couple to
  internal topology, and every service would re-implement TLS/authN/rate
  limiting/CORS. The gateway centralizes those and gives one stable contract.
- "What status code when a client exceeds its quota vs the server is
  overloaded?" `429 Too Many Requests` for the specific client; `503 Service
  Unavailable` for server-side overload — both with `Retry-After` when known.
- "How does a backend get the client's real IP after TLS termination?" Via
  `X-Forwarded-For` / `Forwarded` (RFC 7239) injected by the trusted gateway;
  the backend must only trust these from the gateway.

## References

- **RFC 9110 — HTTP Semantics** (status codes incl. 429/503, `Retry-After`):
  https://www.rfc-editor.org/rfc/rfc9110
- **RFC 9457 — Problem Details for HTTP APIs** (obsoletes 7807; edge error
  normalization): https://www.rfc-editor.org/rfc/rfc9457
- **RFC 7519 — JSON Web Token (JWT)**: https://www.rfc-editor.org/rfc/rfc7519
- **RFC 7239 — Forwarded HTTP Extension** (`Forwarded` header):
  https://www.rfc-editor.org/rfc/rfc7239
- **OAuth 2.0 (RFC 6749) / OAuth 2.1 draft / Token Introspection (RFC 7662)**:
  https://www.rfc-editor.org/rfc/rfc6749 , https://www.rfc-editor.org/rfc/rfc7662
- **IETF draft — RateLimit header fields for HTTP**:
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- **OWASP API Security Top 10 (2023)** (API1 BOLA, API5 BFLA):
  https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- **Sam Newman — Backends For Frontends**:
  https://samnewman.io/patterns/architecture/bff/
- **Microsoft Azure Architecture Center — Gateway Aggregation / Gateway Routing
  / Gateway Offloading / BFF patterns**:
  https://learn.microsoft.com/azure/architecture/patterns/
- **microservices.io — API Gateway / BFF pattern (Chris Richardson)**:
  https://microservices.io/patterns/apigateway.html
- **OpenAPI 3.1 specification**: https://spec.openapis.org/oas/v3.1.0
- **RFC 9111 — HTTP Caching** (shared/private, `s-maxage`, `Vary`, revalidation):
  https://www.rfc-editor.org/rfc/rfc9111
- **RFC 5861 — HTTP Cache-Control Extensions** (`stale-while-revalidate`,
  `stale-if-error`): https://www.rfc-editor.org/rfc/rfc5861
- **RFC 9651 — Structured Field Values for HTTP** (used by new RateLimit headers):
  https://www.rfc-editor.org/rfc/rfc9651
- **RFC 8594 — The Sunset HTTP Header Field**:
  https://www.rfc-editor.org/rfc/rfc8594
- **RFC 9745 — The Deprecation HTTP Response Header Field** (Proposed Standard,
  2025; supersedes the deprecation-header draft):
  https://www.rfc-editor.org/rfc/rfc9745
- **RFC 8693 — OAuth 2.0 Token Exchange**: https://www.rfc-editor.org/rfc/rfc8693
- **IETF draft — OAuth 2.0 for Browser-Based Applications** (token-handling BFF):
  https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/
- **OWASP API Security Top 10 (2023) — full list** (API2/4/7/8/9/10):
  https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- **Kubernetes Gateway API**: https://gateway-api.sigs.k8s.io/
- **Apollo GraphQL Federation**: https://www.apollographql.com/docs/federation/
- **Curity — Phantom Token / Split Token patterns**:
  https://curity.io/resources/learn/phantom-token-pattern/
