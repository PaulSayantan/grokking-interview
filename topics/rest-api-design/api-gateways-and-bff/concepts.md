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

- `Retry-After` (RFC 9110) — seconds (or an HTTP-date) to wait.
- `RateLimit-*` headers — the emerging IETF draft convention for exposing quota
  state; widely used even though still a draft.

**Algorithms (named at contract altitude; the math lives in system-design):**
fixed window, sliding window, **token bucket** (allows bursts up to bucket
size), and leaky bucket (smooths to a constant rate). Token bucket is the most
common gateway default because it permits short bursts while capping average
rate.

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

## Common follow-up questions

- **"Where do you put authentication vs authorization?"** AuthN and coarse authZ
  (scope/route gating) at the gateway; fine-grained, resource-level authZ (BOLA,
  ownership checks) in the service that owns the data.
- **"Gateway or BFF for aggregating a mobile home screen?"** Prefer a BFF owned
  by the mobile team — it encodes product decisions about partial failure and
  payload shape. A shared gateway shouldn't hold client-specific logic.
- **"How do you avoid the gateway being a SPOF?"** Run it redundantly behind an
  LB, keep the data plane simple/stateless, externalize state (rate-limit
  counters), and roll config out gradually with fast rollback.
- **"Isn't a service mesh a replacement for a gateway?"** No — mesh is east-west
  (internal service-to-service); gateway is north-south (external ingress). Many
  systems run both.
- **"Why not just let clients call services directly?"** Clients would couple to
  internal topology, and every service would re-implement TLS/authN/rate
  limiting/CORS. The gateway centralizes those and gives one stable contract.
- **"What status code when a client exceeds its quota vs the server is
  overloaded?"** `429 Too Many Requests` for the specific client; `503 Service
  Unavailable` for server-side overload — both with `Retry-After` when known.
- **"How does a backend get the client's real IP after TLS termination?"** Via
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
