# Microservices, Monolith and API Design

This topic is about **how you slice a system into deployable units and how those
units talk to each other and to clients**. In interviews it shows up two ways:
(1) an explicit "monolith vs microservices, how would you decompose this?"
question, and (2) implicitly inside every product design ("how do the order
service and the payment service communicate?"). The single most valuable skill
here is **articulating trade-offs**: microservices are not "better" than a
monolith — they move complexity from one place (a large codebase) to another
(the network and operations). A senior answer names what you *gain*, what you
*give up*, and *when* the swap is worth it.

> Conway's Law is the backbone of this whole topic: *"organizations design
> systems that mirror their own communication structure."* Architecture is a
> people problem as much as a technical one. Service boundaries that fight your
> org chart create constant cross-team coordination; boundaries that match it
> let teams ship independently. Many microservice migrations are really
> **org-scaling** moves disguised as technical ones.

---

## Monolith vs microservices vs modular monolith

**Intuition.** A **monolith** is one deployable unit: one codebase, one build,
one process (possibly many replicas behind a load balancer), usually one
database. **Microservices** split the system into many small, independently
deployable services, each owning its own data. A **modular monolith** is the
underrated middle ground: one deployable unit, but with strictly enforced
internal module boundaries (clear interfaces, no reaching into another module's
tables) so it *could* be split later.

```
MONOLITH                    MODULAR MONOLITH            MICROSERVICES
+-----------------+         +-----------------+         +------+ +------+ +------+
| orders  users   |         | [orders]|[users]|         |orders| |users | |pay   |
| payments  ship  |         | [pay]   |[ship] |         +--+---+ +--+---+ +--+---+
|                 |         |  (1 deploy,     |            |        |        |
|  one process    |         |   enforced      |          +-v--+  +--v-+  +--v-+
|  one DB         |         |   module APIs)  |          |DB  |  |DB  |  |DB  |
+-------+---------+         +--------+--------+          +----+  +----+  +----+
        |                            |                  independent deploy + data
     one DB                       one DB
```

**How it works / what changes.** The defining property of microservices is
**independent deployability**, and the enabler of that is **database-per-service**
(private data — no other service reads your tables directly). If services share
a database, you have a *distributed monolith*: the operational cost of
microservices with none of the benefits. In a monolith, module A calls module B
with an in-process function call (nanoseconds, reliable, transactional). In
microservices, that same call becomes a network hop (milliseconds, can fail,
no shared transaction) — this is the **distributed-systems tax**.

**Real-world usage.** Amazon, Netflix, and Uber famously run thousands of
services — but all three *started* as monoliths and split under scaling
pressure. Shopify, GitHub, and Stack Overflow run enormous, successful
**(modular) monoliths** to this day. Shopify explicitly moved to a *modular
monolith* ("Componentization") rather than microservices. Segment famously
**went back** from microservices to a monolith (2018/2020) because the
operational overhead of ~140 services for a small team was crushing.

**Capacity / cost intuition.** Microservices multiply your operational surface:
N services means N pipelines, N dashboards, N on-call runbooks, N sets of
dependencies to patch. A 3-service system is manageable; a 300-service system
needs a platform team, service mesh, centralized tracing, and a service
catalog. Rule of thumb: the operational overhead of microservices only pays off
when you have **enough teams that coordinating deploys in a monolith has become
the bottleneck** (often cited around Amazon's "two-pizza team" per service).

**TRADE-OFFS (the heart of the topic).**

| Dimension | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| Deploy independence | None (all-or-nothing) | None (still 1 deploy) | High (per service) |
| Team scale | Poor past ~1-2 teams | Good to several teams | Best for many teams |
| Runtime latency | Best (in-process) | Best (in-process) | Worse (network hops) |
| Consistency | Easy (ACID txns) | Easy (ACID txns) | Hard (eventual, sagas) |
| Fault isolation | Poor (one bug -> whole app) | Poor (same process) | Good (blast radius per svc) |
| Operational complexity | Low | Low | High (mesh, tracing, CI/CD) |
| Tech heterogeneity | One stack | One stack | Per-service stack |
| Refactoring boundaries | Easy (compiler helps) | Easy | Hard (network contract) |
| Onboarding / debugging | Easy (one repo, one trace) | Moderate | Hard (distributed traces) |

**When to pick what.**
- **Start with a (modular) monolith** for a new product/startup: you don't yet
  know the right boundaries, and refactoring a module boundary is a compiler
  refactor, not a cross-service migration. "You must be this tall to ride
  microservices" (Martin Fowler's *Monolith First*).
- **Move to microservices** when: many teams block on each other's deploys,
  different components have wildly different scaling profiles (e.g. a
  CPU-heavy transcoder vs a light metadata API), or you need independent
  fault isolation / independent tech stacks.
- **Modular monolith** is the best default in 2024-2025 thinking: you get most
  of the boundary discipline of microservices with none of the network tax, and
  a clean seam to extract a service later (strangler fig).

---

## Service boundaries and Domain-Driven Design

**Intuition.** The hardest part of microservices is *where to cut*. Cut wrong
and you get chatty, tightly-coupled services that must deploy together — a
distributed monolith. The guiding principle: services should be
**loosely coupled and highly cohesive**, aligned to **business capabilities**,
not technical layers.

**How it works.** Domain-Driven Design (DDD) gives the vocabulary:
- **Bounded context** — an explicit boundary within which a domain model and its
  terms have one consistent meaning. "Customer" in Sales vs "Customer" in
  Support may be different models. A bounded context is the natural candidate
  for a microservice (or a module in a modular monolith).
- **Ubiquitous language** — shared terms between engineers and domain experts
  inside a context.
- **Aggregate** — a cluster of objects treated as one unit for data changes,
  with one root; a good unit of transactional consistency (and often the unit
  that maps to one service's data ownership).
- **Context map** — how bounded contexts relate (upstream/downstream,
  anti-corruption layer, shared kernel).

**Anti-patterns to name in interviews:**
- **Decompose by technical layer** (a "UI service", a "business-logic service",
  a "database service") — every feature touches all three -> lockstep deploys.
- **Entity/CRUD services** ("one service per database table") — hyper-chatty,
  no cohesion. A `Customer` service and `Address` service that always call each
  other should be one service.
- **Nanoservices** — so small the coordination cost dwarfs the code.
- **God service** — one service everyone depends on becomes a deploy bottleneck.

**Real-world usage.** Amazon organizes services around business capabilities
owned by two-pizza teams. Uber reorganized from many tiny services toward
**Domain-Oriented Microservice Architecture (DOMA)** — grouping services into
coarser *domains* with clear layered gateways, precisely because
over-decomposition had gotten out of hand.

**TRADE-OFFS.**
- **Fine-grained boundaries**: better independent scaling and clearer ownership,
  but more network chatter, more distributed transactions, higher cognitive
  load. **Coarse-grained**: fewer hops and simpler consistency, but larger blast
  radius and more teams sharing a service.
- **Getting the boundary wrong is expensive**: moving a method between modules
  in a monolith is a refactor; moving a responsibility between services is a
  data migration + API contract change + dual-write period. This is *the* reason
  to defer decomposition until the domain is well understood.
- **Test for a good boundary:** can this service be deployed without coordinating
  with others? Does it own its data? Are cross-service calls rare relative to
  in-service work? If "no," reconsider the cut.

---

## API styles REST, GraphQL and gRPC

**Intuition.** Once you have services (or a public API), you choose how callers
talk to them. The three dominant styles trade off differently on flexibility,
performance, and coupling.

**REST (Representational State Transfer).** Resource-oriented over HTTP/JSON.
Uses HTTP verbs (GET/POST/PUT/PATCH/DELETE), status codes, and caching. Ubiquitous,
human-readable, cache-friendly (GET is cacheable at CDN/proxy), great for public
APIs. Weaknesses: **over-fetching** (you get the whole resource) and
**under-fetching** (N+1 round trips to assemble a screen), and no strict schema
by default (OpenAPI helps).

**GraphQL.** A query language + single endpoint (usually `POST /graphql`). The
client specifies exactly the fields it wants across multiple resources in one
request — solving over/under-fetching and reducing round trips for rich UIs.
Strongly typed schema. Weaknesses: **HTTP caching is hard** (one endpoint, POST
bodies), **complex/malicious queries** can hammer the backend (need query depth
limits, cost analysis, persisted queries), the **N+1 problem** moves server-side
(need DataLoader batching), and server complexity is higher. Invented at
Facebook for mobile feeds; used by GitHub, Shopify, Netflix (internal).

**gRPC.** Contract-first RPC using **Protocol Buffers** (binary) over **HTTP/2**.
Very fast and compact, supports **bidirectional streaming**, strong typed
contracts, code-gen in many languages. Ideal for **internal service-to-service**
comms and low-latency/high-throughput paths. Weaknesses: not natively callable
from browsers (needs gRPC-Web + proxy), binary payloads are not human-readable,
less mature edge/CDN caching, steeper tooling. Used pervasively at Google, and
internally at many companies for east-west traffic.

```
Public / browser edge  ->  REST or GraphQL (JSON, cache-friendly / flexible)
Internal east-west     ->  gRPC (protobuf, HTTP/2, fast, streaming)
Rich aggregated UI     ->  GraphQL (or BFF) to avoid N+1 round trips
```

**Comparison.**

| Dimension | REST | GraphQL | gRPC |
|---|---|---|---|
| Payload | JSON (text) | JSON (text) | Protobuf (binary) |
| Transport | HTTP/1.1 or 2 | HTTP (usually POST) | HTTP/2 |
| Schema/contract | Optional (OpenAPI) | Required (SDL) | Required (.proto) |
| Over/under-fetch | Yes (fixed shapes) | No (client picks) | Fixed (RPC methods) |
| Caching | Excellent (HTTP GET) | Hard | Hard |
| Streaming | Limited (SSE/WS) | Subscriptions | First-class bidi |
| Browser support | Native | Native | Needs gRPC-Web |
| Best for | Public APIs, CRUD | Aggregating rich UIs | Internal microservices |
| Latency/throughput | Good | Good | Best |

**TRADE-OFFS / when to pick.**
- **REST** when you want simplicity, broad compatibility, HTTP caching, and a
  public API. Default choice unless you have a specific reason not to.
- **GraphQL** when many diverse clients (web/iOS/Android) need different slices
  of data and round trips hurt (mobile). You pay with caching difficulty and
  server-side query-cost governance.
- **gRPC** for internal, high-volume, low-latency service-to-service calls,
  especially polyglot backends and streaming. You give up human-readability and
  easy browser/CDN access.
- Common real-world combo: **gRPC internally, REST/GraphQL at the edge**, with a
  gateway translating.

---

## API gateway and Backend for Frontend

**Intuition.** You don't want clients calling 30 services directly (chatty,
leaks internal topology, duplicated auth). An **API gateway** is a single entry
point that routes requests to backend services and centralizes cross-cutting
concerns.

**API gateway responsibilities:** routing, **authentication/authorization**,
**rate limiting/throttling**, TLS termination, request/response transformation,
**aggregation** (fan-out to several services and combine — the *gateway
aggregation* pattern), caching, observability (correlation IDs, metrics),
and protocol translation (e.g. REST-in, gRPC-out). Examples: Kong, AWS API
Gateway, Apigee, NGINX, Envoy, Zuul/Spring Cloud Gateway.

**Backend for Frontend (BFF).** One gateway/backend **per client type** (web
BFF, iOS BFF, Android BFF, partner BFF). Each BFF tailors payloads and
aggregation to *that* client's needs so a single generic API doesn't have to
serve everyone. Popularized by SoundCloud and Netflix. It solves the problem
where a shared "one size fits all" API becomes a coordination bottleneck between
frontend and backend teams and forces the mobile client to over-fetch.

```
         +----------- Web BFF -----------+
Web  --->|  tailors payloads for web     |---+
         +-------------------------------+   |
         +----------- iOS BFF -----------+   +--> [order] [user] [catalog] ...
iOS  --->|  tailors payloads for mobile  |---+        (internal services)
         +-------------------------------+   |
Android->|  Android BFF                  |---+
         +-------------------------------+
```

**TRADE-OFFS.**
- **API gateway** centralizes cross-cutting concerns (huge win) but is a
  **single point of failure** and a potential **bottleneck** — must be HA and
  horizontally scaled; keep it thin (don't put business logic in it, or it
  becomes an ESB / new monolith).
- **BFF** decouples client teams and optimizes payloads per device, but you now
  maintain **N gateways** with duplicated logic (auth, common aggregation). Pick
  BFF when client needs genuinely diverge (mobile vs web vs partner); avoid it
  when clients are similar (the duplication isn't worth it).
- **Gateway aggregation** reduces client round trips over high-latency networks
  (mobile) but couples the gateway to backend response shapes and can turn one
  slow backend into a slow aggregated response — use per-call timeouts, partial
  responses, and circuit breakers. If aggregation needs real domain logic, put
  it in a **dedicated aggregation service behind** the gateway, not in the
  gateway itself.

---

## API versioning and evolution

**Intuition.** APIs are contracts with clients you don't control. You must
evolve without breaking them. The golden rule: **prefer backward-compatible,
additive changes; version only when you must break.**

**Approaches.**
- **URI versioning** — `/v1/orders`, `/v2/orders`. Most visible, easiest to
  route/cache, but "wrong" per REST purists (the resource didn't change). Most
  common in practice (Stripe-style major versions, Twitter, GitHub used it).
- **Header/media-type versioning** — `Accept: application/vnd.myapi.v2+json`.
  Cleaner URIs, harder to test in a browser, less visible.
- **Query-param versioning** — `?version=2`. Simple but pollutes caching.
- **Date-based versioning** — Stripe pins each account to the API version *as of
  the date they started*, and transforms newer internal responses back to older
  shapes. Lets Stripe evolve continuously while never breaking existing
  integrations. A gold-standard pattern for public APIs.

**Compatibility rules.** *Backward compatible* changes (safe, no version bump):
add optional fields, add new endpoints, add new enum values *only if clients
tolerate unknowns*, relax validation. *Breaking* changes (need a version):
remove/rename fields, change types, make optional required, change semantics,
tighten validation, remove enum values. In protobuf/gRPC, never reuse or change
field numbers; add new fields with new numbers.

**TRADE-OFFS.**
- **Versioning in the URL** is operationally simplest (route, log, cache, and
  deprecate whole versions) but you accumulate parallel implementations
  (v1..vN) — maintenance and test cost grows.
- **No versioning + strict backward compat** (add-only) keeps you on one code
  path but constrains what you can change and can leave dead fields forever.
- **Consumer-driven contracts** (Pact) let providers verify they haven't broken
  known consumers — critical in microservices where you *do* control both sides.
- Always ship a **deprecation policy**: sunset headers, timelines, metrics on who
  still uses old versions. Breaking a public API silently is a cardinal sin.

---

## Pagination, filtering and idempotency keys

**Intuition.** Real APIs return lots of data and get retried. Two design
concerns interviewers probe: how you page/filter large collections, and how you
make writes safe to retry.

**Pagination.**
- **Offset/limit** (`?offset=100&limit=20` or page numbers): simple, allows
  jumping to page N, but **slow at deep offsets** (DB must scan+skip) and
  **inconsistent under inserts/deletes** (items shift; you see duplicates or
  skips). Fine for small/stable datasets and admin UIs.
- **Cursor / keyset pagination** (`?after=<opaque_cursor>&limit=20`): the cursor
  encodes the last seen sorted key (e.g. `(created_at, id)`); the query is
  `WHERE (created_at, id) > (...) ORDER BY ... LIMIT n`. **O(1)-ish regardless of
  depth** and **stable under concurrent writes**. The standard for infinite
  scroll and large datasets (Slack, Stripe, Twitter/X, GraphQL Relay
  connections). Cost: can't jump to an arbitrary page; needs a stable sort key.

| | Offset/limit | Cursor/keyset |
|---|---|---|
| Deep-page performance | Degrades (skip N rows) | Constant |
| Jump to page N | Yes | No |
| Stable under writes | No (drift) | Yes |
| Implementation | Trivial | Needs sortable unique key |

**Filtering/sorting.** Expose explicit, whitelisted filter fields (avoid
arbitrary query -> DB injection / unindexed scans). Ensure filter+sort combos are
backed by indexes; otherwise you invite full-table scans at scale.

**Idempotency keys.** A write is **idempotent** if performing it multiple times
has the same effect as once. Networks retry (timeouts, at-least-once delivery),
so `POST /charge` could execute twice -> double charge. The fix: client sends an
`Idempotency-Key: <uuid>` header; the server stores the key + result; on a
repeat it returns the *stored* result instead of re-executing. Stripe pioneered
this for payments. Key design points: keys are scoped per endpoint/account,
stored with the response and a TTL, and the first request should be committed
**atomically with the key** (same transaction) so a crash mid-write doesn't
leave the key recorded without the effect (or vice-versa).

**TRADE-OFFS.**
- GET/PUT/DELETE are naturally idempotent; **POST is not** — that's where
  idempotency keys matter most.
- Idempotency adds a storage + lookup cost on every write and a subtle
  concurrency problem (two concurrent requests with the same key -> use a unique
  constraint / lock so only one wins). Worth it for money movement, order
  creation, and any at-least-once messaging consumer.
- Related but different: **exactly-once delivery is a myth over a network**; you
  get *at-least-once delivery + idempotent processing* = *effectively once*.

---

## Service mesh and the sidecar pattern

**Intuition.** In microservices, every service needs the same networking
concerns: retries, timeouts, mTLS, load balancing, circuit breaking, and
telemetry. Rather than a library baked into each service (and re-implemented per
language), a **service mesh** moves that logic into a **sidecar proxy** deployed
next to each service instance. Application traffic flows through the sidecar
(e.g. Envoy); a **control plane** (e.g. Istio, Linkerd) configures all the
sidecars.

```
   +------------------- Pod -------------------+
   |  App container  <-->  Sidecar proxy(Envoy)|---mTLS--> other sidecars
   +-------------------------------------------+
              ^ config/policy/telemetry
        +-----+------ Control plane (Istio) -----+
```

**What it gives you:** mTLS everywhere (zero-trust), consistent retries/timeouts/
circuit breaking, traffic shifting (canary, blue-green), **observability** (the
mesh emits uniform metrics/traces for all traffic) — all *without changing
application code* and *language-agnostically*.

**TRADE-OFFS.**
- **Pros:** offloads cross-cutting networking from every service and every
  language; uniform security and telemetry; powerful traffic management.
- **Cons:** **latency overhead** (each hop now traverses two extra proxies —
  typically single-digit-ms, but real), **resource overhead** (a sidecar per
  pod = more CPU/memory), and **significant operational complexity** — Istio in
  particular is notoriously complex to run. It's another distributed system to
  operate.
- **When to use:** you have *many* services, polyglot stacks, and strong
  security/observability requirements. **When not to:** a handful of services or
  a single language where a shared library (e.g. gRPC's built-in retries, or a
  resilience lib) is far cheaper. Newer **sidecar-less / eBPF meshes** (Cilium,
  Istio Ambient mode) aim to cut the sidecar tax — a good "modern trend" to
  mention.

---

## Synchronous vs asynchronous inter-service communication

**Intuition.** Two services can talk **synchronously** (request/response —
caller waits, e.g. REST/gRPC) or **asynchronously** (fire an event/message to a
broker and move on, e.g. Kafka/SQS/RabbitMQ). This choice drives coupling,
latency, and resilience more than almost anything else.

**Synchronous (request/response).**
- *Pros:* simple mental model, immediate result, easy to reason about,
  straightforward error handling.
- *Cons:* **temporal coupling** — caller and callee must both be up *right now*.
  Chained sync calls **multiply latency** (A->B->C->D) and **compound failure**:
  if B is down, A fails. This is how one slow dependency causes
  **cascading failures**; mitigate with **timeouts, retries with backoff +
  jitter, circuit breakers, and bulkheads**.

**Asynchronous (event/message driven).**
- *Pros:* **temporal decoupling** (producer doesn't care if consumer is up now —
  the broker buffers), natural **load leveling** (smooths spikes), better
  fault isolation, easy fan-out to many consumers, enables event-driven / CQRS.
- *Cons:* **eventual consistency** (the result isn't ready when you return),
  harder debugging (no linear stack trace — need distributed tracing), ordering
  and duplicate-delivery concerns (need idempotent consumers), and you must
  handle poison messages / dead-letter queues.

```
SYNC:   Order --HTTP--> Payment --HTTP--> Inventory   (all must be up; latency adds up)
ASYNC:  Order --event--> [ broker ] --> Payment
                                   \--> Inventory     (decoupled, eventual)
```

**Real-world.** Uber/DoorDash place an order synchronously (need an immediate
"accepted"), then fan out asynchronously for notifications, receipts, analytics,
and fulfillment. The rule of thumb: **use sync when the caller genuinely needs
the answer to proceed; use async for everything that can happen "eventually"
or fan out to many consumers.**

**TRADE-OFFS / when to use what.**
- **Sync** for read paths and commands where the user is blocked on the result
  (checkout returning success). Keep call chains shallow.
- **Async** for workflows spanning services, notifications, and anything where
  temporal decoupling and resilience beat immediacy. Cross-service transactions
  become **sagas** (a sequence of local txns with compensating actions) instead
  of 2PC.
- **The key insight for interviews:** sync = strong consistency + tight coupling
  + cascading-failure risk; async = availability + decoupling + eventual
  consistency + operational complexity of a broker. State which one your design
  needs and *why*.

---

## The fallacies of distributed computing

**Intuition.** L. Peter Deutsch and colleagues (Sun, 1990s) listed eight false
assumptions engineers make when moving from in-process to distributed systems.
Microservices force you to confront every one. Interviewers love these because
naming them signals you understand the *distributed-systems tax*.

1. **The network is reliable** — it isn't; packets drop, connections reset.
   Design for retries, timeouts, idempotency.
2. **Latency is zero** — a remote call is ~10^6x slower than a local call.
   Chatty designs (N+1 cross-service calls) kill performance.
3. **Bandwidth is infinite** — large payloads and fan-out saturate links; page
   and compress.
4. **The network is secure** — assume hostile; use mTLS, authn/authz (zero
   trust).
5. **Topology doesn't change** — instances come and go (autoscaling, failures);
   use service discovery, don't hardcode hosts.
6. **There is one administrator** — many teams/clouds; no single point of
   control; expect version skew.
7. **Transport cost is zero** — serialization, network hardware, and bandwidth
   all cost money and CPU.
8. **The network is homogeneous** — mixed hardware, protocols, versions;
   interoperate defensively.

**Why it matters (the trade-off framing).** Every fallacy is a *cost* the
monolith didn't have. Moving a call across the network buys you independent
deployability but *bills* you reliability engineering (retries, circuit
breakers), latency budget, security work, and observability. When you propose
splitting a service, you're implicitly signing up to pay all eight. That's the
"distributed-systems tax," and it's the reason "monolith first" is sound advice.

---

## When NOT to use microservices

**Intuition.** The most senior thing you can say in this topic is *"here I would
not use microservices."* Microservices are an answer to **organizational and
scaling** problems, not a default.

**Don't use microservices when:**
- **Small team / early-stage product.** You don't yet know the right boundaries;
  the coordination and ops overhead will crush a small team. Segment's return to
  a monolith is the canonical cautionary tale. Start with a **modular monolith**.
- **The domain isn't well understood.** Getting boundaries wrong is far more
  expensive to fix across services than within a codebase.
- **You lack the operational maturity.** Microservices *require* CI/CD,
  containerization/orchestration, centralized logging, distributed tracing,
  monitoring, and on-call discipline. Without that platform, you get outages you
  can't debug.
- **Strong cross-entity transactional consistency is core** (e.g. tight
  financial ledgers) and sagas/eventual consistency add unacceptable complexity
  — a monolith's ACID transactions are a feature.
- **Latency-critical tight loops** where in-process calls matter — splitting adds
  network hops you can't afford.

**Symptoms you split too early / wrong (the distributed monolith):** services
that must be deployed together, shared database, synchronous call chains many
levels deep, a change to one service constantly requiring changes to others.
You've paid the microservices tax and kept the monolith's coupling.

**The mature path:** monolith (or modular monolith) -> identify the module that
*actually* needs independent scaling/deploy -> extract it via **strangler fig**
(route new traffic to the new service, migrate incrementally) -> repeat only as
the org grows. Decompose *because a specific pain demands it*, not on principle.

---

## Trade-offs and when to use what

A consolidated decision guide — the kind of reasoning to say out loud.

**Architecture:**
- 1-2 teams, unknown domain, want speed -> **modular monolith**.
- Many teams blocking on shared deploys, divergent scaling, need fault isolation
  -> **microservices**, extracted incrementally.
- Don't split for resume-driven reasons; splitting bills you all 8 fallacies.

**API style:**
- Public / cacheable / simple -> **REST**.
- Diverse clients needing tailored data, round trips hurt -> **GraphQL** (govern
  query cost) **or BFF**.
- Internal, high-throughput, low-latency, streaming, polyglot -> **gRPC**.

**Edge:**
- Centralize auth/rate-limit/routing -> **API gateway** (keep it thin, make it
  HA).
- Clients genuinely diverge (mobile vs web vs partner) -> **BFF per client**.

**Communication:**
- Caller needs the answer now -> **sync** (with timeouts/retries/circuit
  breakers, shallow chains).
- Fan-out, decoupling, spiky load, cross-service workflow -> **async** + broker,
  sagas, idempotent consumers, DLQs.

**Consistency:**
- Need ACID across entities -> keep them in one service/DB (or one aggregate).
- Can tolerate eventual -> split, and reconcile with events/sagas/CDC.

**Networking layer:**
- Many polyglot services, strong security/observability -> **service mesh**
  (accept latency/ops cost; consider ambient/eBPF meshes).
- Few services / one language -> a **shared library** beats a mesh.

**The meta-principle:** every choice trades **consistency/simplicity** against
**scalability/independence/availability**. There is no free lunch — name the
axis you're optimizing and the price you're paying.

---

## Common interview follow-up questions

- "Would you build this as a monolith or microservices, and why?" (Almost always
  start with: what's the team size and is the domain understood?)
- "How would you decide service boundaries here?" (Bounded contexts / business
  capabilities; own your data; minimize cross-service calls.)
- "These two services need to share data — how?" (API call vs event/CDC vs
  shared DB — and why *not* shared DB.)
- "How do you handle a cross-service transaction?" (Saga + compensations;
  why not 2PC.)
- "REST, GraphQL, or gRPC for this, and why?"
- "How do you version this public API without breaking clients?"
- "How do you make this `POST` safe to retry?" (Idempotency keys.)
- "How do you paginate a billion-row feed?" (Cursor/keyset, not offset.)
- "One downstream service is slow — how do you stop it taking everything down?"
  (Timeouts, circuit breakers, bulkheads, fallbacks, async.)
- "When would you *not* use microservices?" (The maturity/team/consistency
  answer above.)
- "What's a distributed monolith and how do you avoid it?"
- "Do you need a service mesh here? What does it cost you?"
- "Recite the fallacies of distributed computing and tie each to a design
  decision."

---

## References

- Sam Newman, *Building Microservices* (2nd ed., O'Reilly) — decomposition,
  boundaries, communication styles, "monolith first."
- Martin Fowler & James Lewis, "Microservices" and "MonolithFirst",
  martinfowler.com — the canonical definitions and the monolith-first argument.
- Chris Richardson, *Microservices Patterns* and **microservices.io** — pattern
  catalog (database-per-service, saga, API composition, CQRS, API gateway, BFF,
  idempotent consumer, strangler fig).
- Eric Evans, *Domain-Driven Design*; Vaughn Vernon, *Implementing DDD* —
  bounded contexts, aggregates, context maps.
- Martin Kleppmann, *Designing Data-Intensive Applications* (DDIA) — consistency,
  replication, and the realities behind distributed communication.
- Alex Xu, *System Design Interview* Vol. 1 & 2 and the ByteByteGo blog —
  API gateway, communication styles, real-world case studies.
- L. Peter Deutsch et al., "The Fallacies of Distributed Computing" (Sun
  Microsystems).
- Stripe API docs & engineering blog — idempotency keys and date-based API
  versioning.
- Uber Engineering, "Domain-Oriented Microservice Architecture (DOMA)."
- Segment blog, "Goodbye Microservices: From 100s of problem children to 1
  superstar" — when to consolidate back to a monolith.
- Shopify Engineering, "Deconstructing the Monolith" / modular monolith
  (Componentization) posts.
- Microsoft Azure Architecture Center — Gateway Aggregation, Gateway Offloading,
  BFF, Circuit Breaker, Bulkhead patterns.
- Istio / Linkerd / Envoy docs; Cilium & Istio Ambient (sidecar-less mesh).
- system-design-primer (GitHub, donnemartin).
- ByteByteGo YouTube (REST vs GraphQL vs gRPC; API gateway); Hussein Nasser
  (backend engineering / protocols); Gaurav Sen (microservices).
</content>
</invoke>
