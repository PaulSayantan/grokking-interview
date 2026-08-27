# REST vs GraphQL vs gRPC

Three dominant styles for building networked APIs. They are **not tiers of quality** —
each optimizes for different constraints, and mature systems often use more than one at
once (e.g. REST at the public edge, gRPC between internal services, GraphQL for a
mobile/BFF aggregation layer). An interviewer wants to see that you can reason about the
*trade-offs* — payload shape, caching, contracts, streaming, tooling, and who the client
is — rather than recite that "GraphQL is newer" or "gRPC is faster."

This topic is framework-agnostic. It is about the **wire contract** a client actually
consumes — the transport, the payload format, the schema, and the request/response
patterns — not about any single framework's server APIs.

> [!KEY-TAKEAWAY]
> REST is resource-oriented over plain HTTP/JSON: ubiquitous, cacheable, simple. GraphQL
> is a single-endpoint query language that lets the *client* choose exactly the fields it
> needs, killing over/under-fetching at the cost of caching and query-cost complexity.
> gRPC is a contract-first, binary (Protobuf-over-HTTP/2) RPC framework built for
> low-latency, high-throughput service-to-service calls and streaming. Choose by client,
> traffic shape, and contract needs — not by fashion.

## The three paradigms at a glance

- **REST (Representational State Transfer):** an architectural style. Model the domain as
  **resources** addressed by URLs; act on them with HTTP methods (`GET`, `POST`, `PUT`,
  `PATCH`, `DELETE`); rely on HTTP semantics (status codes, caching headers, content
  negotiation). Usually JSON over HTTP/1.1 or HTTP/2. Many endpoints, one per resource.
- **GraphQL:** a **query language and runtime** for APIs (spec at graphql.org). One
  endpoint (typically `POST /graphql`). The client sends a query describing the exact
  tree of fields it wants; the server returns exactly that shape. Strongly typed via a
  schema (SDL). Transport-agnostic but almost always HTTP/JSON.
- **gRPC:** a **contract-first RPC framework** (from Google, now CNCF). You define
  services and messages in Protocol Buffers (`.proto`); codegen produces typed client and
  server stubs. Uses **HTTP/2** as transport and **Protobuf** binary framing by default.
  Optimized for internal service-to-service traffic and streaming.

| Dimension | REST | GraphQL | gRPC |
|---|---|---|---|
| Style | Resource-oriented | Query language | RPC (call methods) |
| Transport | HTTP/1.1 or HTTP/2 | HTTP (usually) | HTTP/2 (required) |
| Payload | Usually JSON (text) | JSON | Protobuf (binary) |
| Endpoints | Many (per resource) | One | One method per RPC |
| Contract | Optional (OpenAPI) | Mandatory schema (SDL) | Mandatory `.proto` |
| Who shapes response | Server | Client (query) | Server (message) |
| Browser-native | Yes | Yes | No (needs gRPC-Web/proxy) |
| Streaming | Limited (SSE/chunked) | Subscriptions | First-class (4 modes) |
| HTTP caching | Excellent | Poor (POST) | N/A (binary/HTTP2) |

> [!INTERVIEW]
> A strong answer frames these as complementary. "REST for the public API because
> partners and browsers already speak it and it caches at the CDN; gRPC between our
> services because we control both ends and want typed contracts plus streaming; GraphQL
> as a BFF for the mobile app so it fetches one round trip instead of six." That shows
> judgment, not memorization.

## REST strengths and constraints

REST's superpower is that it **rides on HTTP** and inherits the entire web
infrastructure. RFC 9110 (HTTP Semantics) defines the method/status/caching semantics
REST leans on.

**Strengths:**
- **Ubiquity & simplicity:** every language, browser, proxy, and CLI (`curl`) speaks it.
  No codegen or special client required. Lowest barrier to entry.
- **Caching:** `GET` is safe and cacheable, so responses cache at the browser, CDN, and
  reverse proxy using `Cache-Control`, `ETag`, and conditional requests (RFC 9110 §13).
  This is REST's biggest structural advantage over GraphQL and gRPC.
- **Uniform interface & tooling:** standard verbs and status codes; huge ecosystem of
  proxies, gateways, log tooling, and API management that understand HTTP out of the box.
- **Statelessness & visibility:** each request is self-contained, so intermediaries can
  route, cache, and observe without app-specific knowledge.

**Constraints / weaknesses:**
- **Over- and under-fetching** (see next section): endpoints return server-defined
  shapes, so a client often gets too much or must make several calls.
- **No mandatory contract:** JSON is untyped on the wire; you bolt on OpenAPI/JSON Schema
  for a contract, but it is not enforced by the protocol.
- **Multiple round trips** for related resources (`/users/1`, then `/users/1/orders`).
- **Weak native streaming:** you reach for SSE, long-polling, chunked transfer, or
  WebSockets — none are as first-class as gRPC streaming.

> [!TIP]
> REST's caching is not a minor perk. A `GET` that a CDN can serve from edge offloads your
> origin entirely. GraphQL's `POST /graphql` and gRPC's binary HTTP/2 frames cannot use
> that shared HTTP cache without extra machinery — remember this when a question pits
> "read-heavy public content" against the three styles.

## Over-fetching and under-fetching

This is **GraphQL's core pitch** and a favorite interview framing.

- **Over-fetching:** the endpoint returns more data than the client needs. `GET /users/42`
  returns 30 fields; a list screen only needs `name` and `avatarUrl`. Wasted bandwidth
  and serialization, painful on mobile.
- **Under-fetching:** a single endpoint does not return enough, so the client makes
  additional calls. To render a profile you call `/users/42`, then `/users/42/orders`,
  then `/orders/{id}/items` — the **N+1 request** / waterfall problem on the client side.

REST mitigations (partial, ad hoc): sparse fieldsets (`GET /users/42?fields=name,avatar`),
`?expand=orders` / `?include=`, and compound documents (as in JSON:API). These work but
are bespoke per API and add server complexity.

**GraphQL's answer:** the client sends a query for exactly the fields it wants, across
related types, in one request:

```graphql
query {
  user(id: "42") {
    name
    avatarUrl
    orders(last: 3) {
      id
      total
      items { sku qty }
    }
  }
}
```

Response mirrors the query exactly — no more, no less:

```json
{ "data": { "user": { "name": "Ada", "avatarUrl": "...",
  "orders": [ { "id": "o1", "total": 42.0, "items": [ { "sku": "X", "qty": 2 } ] } ] } } }
```

> [!WARNING]
> Solving over-fetching does not make GraphQL universally better. It moves cost around:
> flexible client queries make **caching harder**, **query cost unpredictable**, and open
> the **N+1 problem on the server** (see below). "GraphQL fixes over-fetching" is true;
> "therefore use GraphQL everywhere" does not follow.

## GraphQL single endpoint and schema typing

GraphQL exposes **one endpoint** (conventionally `POST /graphql`; simple queries may use
`GET` with the query in the query string, which helps caching). There is no URL per
resource — the *query body* selects data.

The server publishes a **strongly typed schema** in Schema Definition Language (SDL):

```graphql
type User {
  id: ID!
  name: String!
  avatarUrl: String
  orders(last: Int): [Order!]!
}
type Order { id: ID!  total: Float!  items: [Item!]! }
type Query { user(id: ID!): User }
type Mutation { placeOrder(input: OrderInput!): Order }
```

- The schema is **mandatory and introspectable**: clients can query the schema itself
  (introspection), which powers tooling like GraphiQL and auto-generated typed clients.
- Operations come in three root types: **Query** (reads), **Mutation** (writes, run
  serially), and **Subscription** (streams over a persistent transport, usually
  WebSocket/SSE).
- **Errors:** GraphQL typically returns HTTP `200 OK` even for field-level errors, placing
  problems in a top-level `errors` array alongside partial `data`. This surprises people
  expecting REST-style 4xx/5xx status codes and complicates monitoring built on status.

```json
{ "data": { "user": null },
  "errors": [ { "message": "User not found", "path": ["user"],
               "extensions": { "code": "NOT_FOUND" } } ] }
```

> [!INTERVIEW]
> Common gotcha: "What status code does a failed GraphQL query return?" Usually **200**,
> with the failure inside the `errors` array (a transport-level 400/500 is reserved for
> malformed requests or server crashes). This is a deliberate design of the spec, not a
> bug — but it breaks naive HTTP-status-based alerting.

## GraphQL N+1 problem and query cost

Flexibility on the client creates two server-side problems interviewers love.

**N+1 (server side):** a query for a list where each item resolves a related field can
fire one database query per item. `orders { items }` over 100 orders can trigger 1 query
for orders + 100 for items = 101 queries. The standard fix is **batching + caching with a
DataLoader**-style pattern: collect all keys requested in a tick, issue one batched query
(`WHERE order_id IN (...)`), and cache per-request. This is *not automatic* — the resolver
author must wire it up.

**Unbounded query cost / abuse:** because clients compose arbitrary queries, a malicious
or careless client can request deeply nested or hugely wide data (`friends { friends {
friends { ... } } }`), a denial-of-service vector. Mitigations, which a REST endpoint gets
"for free" by having a fixed shape:
- **Depth limiting** — reject queries nested beyond N levels.
- **Query complexity / cost analysis** — assign each field a cost, sum it, reject over a
  budget.
- **Persisted queries / allowlists** — only accept pre-registered query hashes in prod, so
  clients cannot send arbitrary shapes.
- **Pagination limits, timeouts, and rate limits** keyed on cost, not request count.

> [!WARNING]
> "GraphQL has no N+1 problem" is wrong. GraphQL *shifts* the N+1 from the client
> (multiple HTTP round trips in REST) to the *server's* data layer, and you must
> deliberately solve it with batching/DataLoader. It also introduces query-cost as a new
> attack surface REST rarely faces.

## GraphQL caching challenges

Caching is where GraphQL pays for its flexibility.

- **HTTP caching mostly does not apply.** Requests are `POST /graphql` with the query in
  the body. Shared HTTP caches (browser, CDN, reverse proxy) key on URL + method and will
  not cache POST bodies. So the CDN-level caching REST enjoys is largely unavailable.
- **One endpoint, one URL** means proxies cannot distinguish a cheap query from an
  expensive one by URL.
- **Workarounds:**
  - **`GET` + persisted queries (APQ):** send a query hash as a URL param so the request
    is a cacheable `GET`. Enables CDN caching at the cost of a registration step.
  - **Client-side normalized caches** (Apollo Client, Relay, urql): cache *objects* by
    global ID in a normalized store, not whole responses. This is the primary GraphQL
    caching model and works well — but it is per-client, not shared/edge.
  - **Server-side / resolver caching** and `@cacheControl` hints per field.

By contrast, **REST caches at every layer with standard headers** (`Cache-Control`,
`ETag`, `Last-Modified`, conditional `If-None-Match` → `304`). This is one of the
strongest, most exam-worthy arguments *against* GraphQL for read-heavy, cacheable public
content.

> [!TIP]
> If an interviewer asks "why is caching harder in GraphQL," the crisp answer is: reads go
> over `POST` to a single URL, so URL-keyed HTTP/CDN caches can't help; GraphQL instead
> relies on *client-side normalized caches* keyed by object ID, which are not shared
> across clients or cacheable at the edge without persisted `GET` queries.

## gRPC HTTP2 protobuf and strong contracts

gRPC is a **contract-first, binary RPC** framework. You *call methods* on a remote service
as if local; the framework handles serialization and transport.

- **Contract in Protobuf:** you define services and messages in a `.proto` file.
  Field **numbers** (tags), not names, identify fields on the wire, which is what makes
  Protobuf compact and evolvable.

  ```protobuf
  syntax = "proto3";
  service UserService {
    rpc GetUser(GetUserRequest) returns (User);
  }
  message GetUserRequest { string id = 1; }
  message User { string id = 1; string name = 2; string avatar_url = 3; }
  ```

- **Codegen → strong contracts:** `protoc` generates typed client and server stubs in many
  languages. Both ends share the same contract; a mismatch is a compile-time or codegen
  error, not a runtime JSON surprise. This is gRPC's biggest advantage for internal
  systems.
- **HTTP/2 transport (required):** multiplexed streams over one connection, header
  compression (HPACK), and binary framing → low latency, high throughput, and native
  bidirectional streaming.
- **Protobuf binary payloads:** far smaller and faster to (de)serialize than JSON; not
  human-readable (you need `grpcurl` or reflection to inspect), which is a debuggability
  cost.
- **Status model:** gRPC has its own **status codes** (`OK`, `NOT_FOUND`,
  `INVALID_ARGUMENT`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, ...) carried in trailers, not
  HTTP status codes. **Deadlines/timeouts** are first-class and propagate across calls.

**Where it shines:** internal **service-to-service** calls in a microservice mesh, and
**polyglot** backends that want one enforced contract. **Where it hurts:** browsers and
public APIs (see next), and human debuggability.

## gRPC streaming modes

Streaming is first-class in gRPC (built on HTTP/2 streams). Four call types:

| Mode | Client sends | Server sends | Example |
|---|---|---|---|
| **Unary** | one message | one message | normal request/response |
| **Server streaming** | one | a stream | subscribe to a feed of updates |
| **Client streaming** | a stream | one | upload chunks, get one summary |
| **Bidirectional streaming** | a stream | a stream (interleaved) | chat, live telemetry |

Because it is native HTTP/2, streams multiplex over a single connection with flow control.
This is a genuine differentiator: REST needs SSE/WebSockets/chunked responses to
approximate streaming, and GraphQL uses Subscriptions (usually over WebSocket) for
server-push only.

## gRPC browser limits and gRPC-Web

**Browsers cannot speak native gRPC.** The fetch/XHR APIs do not expose the low-level
HTTP/2 framing (trailers, full control of the request stream) that gRPC needs. So you
cannot call a gRPC service directly from browser JavaScript.

The workaround is **gRPC-Web**: a variant protocol plus a **proxy** (Envoy, or an in-
process filter) that translates between browser-friendly HTTP/1.1-or-HTTP/2 requests and
backend gRPC. Limitations:
- gRPC-Web supports **unary and server-streaming**, but **not client-streaming or
  bidirectional streaming** in general (browser transport constraints).
- It requires an extra proxy hop and generated JS clients.

This is precisely why gRPC is usually reserved for **service-to-service** traffic (where
you control both ends) rather than public, browser-facing APIs. For public/browser APIs,
REST or GraphQL is the pragmatic choice.

> [!INTERVIEW]
> "Why not use gRPC for your public web API?" — Browsers can't speak it natively (need
> gRPC-Web + a proxy, with no client/bidi streaming), payloads are binary and hard to
> debug, and you lose HTTP caching and the huge REST tooling ecosystem. gRPC's value is
> internal, typed, low-latency service-to-service calls.

## Schema typing and tooling compared

| Aspect | REST | GraphQL | gRPC |
|---|---|---|---|
| Contract | Optional; OpenAPI 3.1 / JSON Schema layered on | **Mandatory** SDL schema | **Mandatory** `.proto` |
| Type enforcement | Not on the wire (JSON is untyped) | Strong at query validation time | Strong, compile-time via codegen |
| Discoverability | OpenAPI docs / Swagger UI | Introspection (self-describing) | Reflection + `.proto` |
| Codegen | Optional (OpenAPI generators) | Typed clients from schema | Core to the model (`protoc`) |
| Human-readable payloads | Yes (JSON) | Yes (JSON) | No (binary) |

- **REST:** contract is optional and additive. OpenAPI 3.1 (aligned with JSON Schema
  2020-12) is the de facto description format, powering docs, mocks, and client codegen —
  but nothing forces the server to obey it.
- **GraphQL:** the schema *is* the API; queries are validated against it before execution,
  and introspection makes the API self-documenting.
- **gRPC:** the `.proto` is the single source of truth and generation happens for every
  language, giving the strongest end-to-end type safety of the three.

## Streaming support compared

- **REST:** no native streaming. Approximations: **Server-Sent Events (SSE)** for
  server→client text streams, **chunked transfer encoding**, long-polling, or upgrade to
  **WebSockets** (a separate protocol) for bidirectional. Works, but bolted on.
- **GraphQL:** **Subscriptions** provide server→client push, typically over WebSocket (or
  SSE via `graphql-sse`). One-directional push for live updates. Newer `@defer`/`@stream`
  directives allow incremental delivery of parts of a single response.
- **gRPC:** first-class **server, client, and bidirectional** streaming over HTTP/2 (the
  richest streaming of the three), though bidi/client streaming is unavailable to browsers
  via gRPC-Web.

If the requirement is high-throughput bidirectional streaming between services, gRPC is
the natural fit; for browser server-push, SSE (REST) or GraphQL subscriptions are more
practical.

## Versioning approaches per paradigm

Each style has a distinct versioning philosophy:

- **REST:** explicit versioning is common — URL path (`/v1/...`, `/v2/...`), a custom or
  `Accept` media-type version (`Accept: application/vnd.example.v2+json`), or a header.
  Evolve additively (add optional fields) and reserve version bumps for breaking changes.
- **GraphQL:** the spec's guidance is to **avoid versioning**. Instead, evolve the schema
  continuously: add new fields/types freely, and **`@deprecated`** old fields (with a
  reason) rather than removing them. Because clients request specific fields, adding fields
  never breaks anyone, and you can measure a deprecated field's usage before removing it.
- **gRPC / Protobuf:** designed for **backward/forward-compatible evolution via field
  numbers**. Rules: never reuse or change an existing field's tag number; add new fields
  with new numbers (old clients ignore unknown fields); `reserve` removed field numbers/
  names to prevent accidental reuse. Optional fields and defaults keep old and new
  messages interoperable without a "v2 service."

> [!WARNING]
> The classic Protobuf mistake: renumbering or reusing a field tag. Field **numbers** are
> the wire identity; changing them silently corrupts data for peers using the old schema.
> Field *names* can change (they aren't on the wire in binary encoding); *numbers* must not.

## Choosing between REST GraphQL and gRPC

A decision guide you can defend in an interview:

**Choose REST when:**
- The API is **public / partner-facing** or **browser/mobile** and needs the widest reach.
- Responses are **read-heavy and cacheable** — you want CDN/HTTP caching for free.
- The domain maps cleanly to resources and simple CRUD; simplicity and ubiquity win.

**Choose GraphQL when:**
- Clients need **flexible, client-defined data shapes** and you want to eliminate over/
  under-fetching (classic **mobile app / BFF aggregation** over many backends).
- The frontend evolves fast and you want one endpoint that composes many sources.
- You accept the costs: harder caching, query-cost governance, N+1 discipline.

**Choose gRPC when:**
- **Internal service-to-service** communication where you control both ends.
- You want **strong, enforced contracts** across polyglot services and **low latency /
  high throughput** with binary payloads.
- You need **bidirectional or high-volume streaming**.

**They coexist:** REST or GraphQL at the public edge; gRPC internally; GraphQL/BFF for
mobile. There is no single "best" — the right answer names the client, the traffic shape,
and the contract needs, then maps them.

> [!INTERVIEW]
> When asked "which would you pick," never answer with one word. Ask: Who is the client
> (browser, mobile, another service)? Read-heavy and cacheable, or write/stream-heavy? Do
> we control both ends? How important is a strict contract? Then justify. The reasoning is
> the answer.

## Common follow-up questions

- "Does GraphQL replace REST?" No. It solves over/under-fetching and client-driven
  shapes, but gives up easy HTTP caching and adds query-cost/N+1 complexity. Many teams
  run both.
- "Why can't the browser call gRPC directly?" Browser HTTP APIs don't expose the
  HTTP/2 framing/trailers gRPC needs; you need gRPC-Web plus a proxy, and even then no
  client/bidi streaming.
- "What HTTP status does a failing GraphQL query return?" Usually 200, with errors in
  the `errors` array; transport 4xx/5xx is reserved for malformed/failed requests.
- "How do you stop an expensive GraphQL query?" Depth limiting, query cost/complexity
  analysis, persisted-query allowlists, timeouts, and cost-based rate limiting.
- "How do you version each?" REST: URL/media-type versions + additive change. GraphQL:
  don't version — add fields and `@deprecated`. gRPC: never reuse field numbers, add new
  tags, `reserve` removed ones.
- "Which is fastest?" For raw service-to-service latency/throughput, gRPC (binary +
  HTTP/2 multiplexing) usually wins; but "fastest" depends on caching — a CDN-cached REST
  `GET` beats everything by not hitting the origin at all.
- "Why does gRPC use HTTP/2?" Multiplexed streams over one connection, header
  compression, and binary framing enable low-latency calls and native streaming.

## GraphQL-over-HTTP status codes

The blanket claim "GraphQL always returns 200" is now the **legacy** path. The
**GraphQL-over-HTTP** specification (a GraphQL Foundation working draft) makes the
status-code story depend on the **response media type** the client negotiates:

- **`application/json` (legacy):** keep the old behavior — well-formed requests return
  **`200 OK`** even when execution failed, with problems in the `errors` array. Clients
  must inspect the body to know if anything worked.
- **`application/graphql-response+json` (new):** the transport speaks HTTP status
  properly:
  - **`400 Bad Request`** — a *syntax* problem: the request body is not valid JSON, or the
    GraphQL document itself **cannot be parsed**.
  - **`422 Unprocessable Content`** — the request is syntactically fine but *semantically*
    rejected before execution: it is not a well-formed GraphQL-over-HTTP request (e.g. a
    required parameter like `query` is missing), it **fails validation** against the schema
    (unknown field, wrong type), or **variable coercion** fails. Nothing executed. (Some
    servers use `400` for these too; the spec `RECOMMENDS` `422`.)
  - **`405 Method Not Allowed`** — attempting a **mutation over `GET`** (GET is reserved
    for safe, side-effect-free operations, so only queries may use it).
  - **`200 OK`** — the document validated and *execution began*; **field-level errors**
    (a resolver threw, a non-null field went null) still return `200` with `errors` +
    partial `data`. Partial success is a `200`, not a `4xx`.

> [!INTERVIEW]
> The sharp version of "what status does GraphQL return?": *"It depends on the response
> media type. Under `application/graphql-response+json`, a malformed body is `400`, a
> query that fails **validation** (bad field, wrong variable type) is `422` because it
> never executed, a mutation attempted over `GET` is `405`, but a query that validated
> and then hit a **resolver error** is still `200` with partial data — execution errors
> are not transport errors."* Naming the `422`-vs-`200` split (validation vs execution)
> is what separates a senior answer.

## GraphQL federation and supergraphs

"How do you scale one GraphQL API across many teams and services?" The modern answer is
**federation**, not one monolithic schema:

- Each team owns a **subgraph** (its own schema + service). A **composition** step merges
  the subgraphs into one **supergraph** schema that a **gateway/router** serves to
  clients. Clients still see a single unified graph.
- A type owned by several teams is stitched via **entities**: one subgraph declares the
  type with a `@key` (its identifying fields); other subgraphs *extend* that entity by
  contributing fields. The router builds a **query plan**, calls each subgraph for the
  fields it owns, and resolves cross-service references through the special
  **`_entities`** root field (a **reference resolver** takes the `@key` and returns the
  object).
- Flavors: **Apollo Federation v2** (widely deployed, vendor-driven) vs the
  vendor-neutral **GraphQL Composite Schemas** spec from the GraphQL Foundation
  (successor to Apollo's Fusion effort, aiming to standardize federation directives).
  The older technique is **schema stitching** — the gateway holds the merge logic instead
  of the subgraphs declaring their own boundaries; federation supersedes it for large
  orgs because ownership lives with each team.

> [!TIP]
> Watch for the anti-pattern: putting a GraphQL gateway *in front of* REST/gRPC
> downstreams just to "have GraphQL" adds a network hop and a second schema to maintain.
> Federation earns its keep when many teams genuinely co-own one graph, not as a thin
> proxy over one backend.

## Persisted queries versus trusted documents

A classic trap: **"Automatic Persisted Queries (APQ) secure GraphQL."** They do not.

- **APQ is a *performance* optimization.** The client sends a **hash** of its query; on a
  cache miss the server replies "unknown," the client re-sends the full query text *plus*
  the hash, and the server **registers it**. This shrinks request size and enables `GET`
  caching. But because the server registers *whatever* the client sends, an attacker can
  still register and run arbitrary queries — APQ is **not** an allowlist.
- **Trusted documents / safelisting is a *security* control.** At **build time** you emit
  a **manifest** of the exact operations the client ships, publish it to the server, and
  the server **rejects any operation not on the manifest** (often keyed by hash). Now the
  set of executable queries is fixed and known, which neutralizes arbitrary-query DoS and
  injection of expensive shapes.

The distinction: APQ decides *how* a known query is transmitted; trusted documents decide
*which* queries are even allowed to run. Conflating them ("we use persisted queries, so
we're safe") is a common miss.

## GraphQL security beyond query cost

Depth limiting and cost analysis (covered earlier) address resource-consumption DoS, but
GraphQL's single typed endpoint creates security surface REST's fixed shapes avoid. Map
these to the **OWASP API Security Top 10 (2023)**:

- **Field-level authorization (API1: BOLA / API5: BFLA).** Because one endpoint serves
  every field, you **cannot** put authorization at the route — a single query can traverse
  from an object the caller may read into a related object they may not. Authz must be
  enforced **per field/resolver**, checking the viewer against the specific object
  (object-level, not just "is logged in"). BOLA (broken object-level authorization) is
  #1 on the list and GraphQL makes it easy to get wrong.
- **Unrestricted resource consumption (API4).** This *is* the query-cost problem: nesting,
  wide lists, and expensive resolvers. It maps almost one-to-one to depth/complexity
  limits, pagination caps, and timeouts.
- **Batching attacks.** Query **aliases** (`a: user(id:1) b: user(id:2) ...`) and
  array-batched operations let one HTTP request perform many logical operations — bypassing
  naive per-request rate limits and enabling credential-stuffing or enumeration. Rate-limit
  on **cost/operation count**, not HTTP requests.
- **Introspection in production (API8: Security Misconfiguration).** Leaving introspection
  on hands attackers your full schema (types, fields, deprecations) as a map. Common
  hardening is to disable introspection (and field suggestions) in prod, or restrict it to
  authenticated internal use.

## gRPC status codes and retry semantics

gRPC defines a fixed set of **status codes 0–16** (in trailers as `grpc-status`), not HTTP
statuses. A key nuance: some are only ever produced by **application code**, never by the
library itself — e.g. `INVALID_ARGUMENT (3)`, `NOT_FOUND (5)`, `ALREADY_EXISTS (6)`,
`FAILED_PRECONDITION (9)`, `ABORTED (10)`, `OUT_OF_RANGE (11)`, `DATA_LOSS (15)`. Others
(`CANCELLED (1)`, `DEADLINE_EXCEEDED (4)`, `UNAVAILABLE (14)`, `UNIMPLEMENTED (12)`,
`UNAUTHENTICATED (16)`) are typically generated by the framework/transport.

The subtle, interview-favorite trio is **when is it safe to retry**:

- **`UNAVAILABLE (14)`** — transient (server down, connection dropped). The operation
  likely never ran; **retry the same call**, ideally with backoff. This is the canonical
  retryable code.
- **`ABORTED (10)`** — a concurrency conflict (e.g. failed transaction / optimistic-lock
  clash). Don't blindly retry the RPC; **retry at a higher level** after re-reading state,
  because the conflict will just recur.
- **`FAILED_PRECONDITION (9)`** — the system is in a state where the call cannot succeed
  *until something changes* (e.g. deleting a non-empty directory). **Do not retry** until
  the precondition is fixed; a retry is pointless.

> [!WARNING]
> `INVALID_ARGUMENT` vs `FAILED_PRECONDITION` vs `OUT_OF_RANGE` is a graded distinction:
> `INVALID_ARGUMENT` = the argument is bad *regardless of system state* (retry never
> helps); `FAILED_PRECONDITION` = the argument is fine but the *system state* forbids it
> now; `OUT_OF_RANGE` = a specific "past the valid range" case (e.g. seeking beyond EOF)
> that, unlike `INVALID_ARGUMENT`, a client can detect will become valid as state grows.

## gRPC deadlines, cancellation, and metadata

- **Deadlines are absolute and propagate.** A client sets a **deadline** (a point in
  time), not just a per-hop timeout. As the call fans out, each downstream inherits the
  **remaining budget** — if 800ms is left when service B calls service C, C gets ~800ms,
  not a fresh timeout. Exceeding it yields `DEADLINE_EXCEEDED (4)` and lets the whole tree
  stop wasting work. This is far stronger than REST's ad-hoc, non-propagating client
  timeouts.
- **Cancellation is immediate — and does not roll back.** When a client cancels (or the
  deadline fires), the server is notified and *should* stop, but any **side effects
  already committed are not undone**. gRPC gives you no transactional rollback; if you
  need exactly-once/rollback semantics you must design idempotency and compensation
  yourself.
- **Independent success determination.** Client and server each decide success **locally
  and independently**, and they can **disagree**. The server may commit a write and
  consider the RPC `OK` while the client, having hit its deadline or lost the connection,
  sees `DEADLINE_EXCEEDED`/`UNAVAILABLE`. This is exactly why retries need idempotency (see
  below): "the call failed" from the client's view does **not** mean "nothing happened."
- **Metadata** = key/value pairs sent in headers (and trailers), the gRPC analog of HTTP
  headers. Keys ending in **`-bin`** carry binary (base64 on the wire); the **`grpc-`**
  prefix is **reserved** for the library. Auth tokens (e.g. bearer JWTs) ride in metadata.

> [!INTERVIEW]
> Scenario: *"A client gets `DEADLINE_EXCEEDED` but the server actually completed the
> write."* Correct read: client and server make independent success determinations, so a
> client-side timeout says nothing about server-side commit. Make it safe by designing the
> RPC to be **idempotent** (idempotency key / dedupe) so a retry doesn't double-apply, and
> use deadline propagation so downstream work stops.

## Protobuf wire format and field presence

Why Protobuf is compact *and* forward-compatible comes down to its encoding:

- **Tag-length-value (TLV) with a packed tag.** Each field is prefixed by a key computed
  as **`(field_number << 3) | wire_type`** — the field number and a 3-bit wire type in one
  varint. That's why **field numbers**, not names, are the wire identity, and why small
  field numbers (1–15, one-byte tags) should go to the hottest fields.
- **Varints** encode integers in as few bytes as possible (7 bits/byte). Signed values use
  **ZigZag** (`sint32`/`sint64`) so small-magnitude negatives don't cost 10 bytes. Wire
  types include varint, 64-bit fixed, length-delimited (strings/bytes/embedded messages),
  and 32-bit fixed.
- **Unknown fields are skipped, not rejected** — the reader uses the wire type to know how
  many bytes to skip. That single rule is the mechanical basis of forward compatibility:
  an old reader silently ignores fields added by a newer writer (and may preserve them on
  re-serialization).
- **proto3 field presence.** proto3 originally **dropped explicit presence for scalars**:
  a field set to its default (`0`, `""`, `false`) was indistinguishable from *unset*, and
  defaults were **not** serialized on the wire. That breaks "was this field provided?"
  (e.g. patch semantics, `0` vs absent). The fix: the **`optional`** keyword (re-added to
  proto3) restores per-field presence tracking via a synthetic `oneof`, so you can tell
  "explicitly set to 0" from "not set."
- **Compatible vs incompatible type changes.** Wire-compatible swaps (same wire type):
  `int32`⇄`int64`⇄`uint32`⇄`bool`, and `sint32`⇄`sint64`. **Not** compatible:
  `int32`⇄`sint32` (different signed encoding) or `int32`⇄`string` (different wire type) —
  those silently corrupt readers. Use **`reserved`** for removed numbers *and* names, and
  `oneof`/`map` for their respective shapes.

## gRPC over HTTP/2 framing

Concretely, a unary gRPC call maps onto HTTP/2 frames like this:

- **Request = a HEADERS frame** carrying pseudo-headers `:method POST`,
  `:path /package.Service/Method` (the RPC's fully-qualified name is the path), and
  `content-type: application/grpc` (or `application/grpc+proto`), plus metadata.
- **DATA frames** carry **length-prefixed messages**: each message is a **1-byte
  compressed flag + 4-byte big-endian length + payload**. One or many messages flow per
  stream (streaming just sends more DATA frames).
- **Response status lives in the *trailing* HEADERS frame** — `grpc-status` and
  `grpc-message` arrive **after** the response body, as HTTP/2 **trailers**. A successful
  response therefore ends with `grpc-status: 0` in trailers, not in the initial response
  headers.

This framing is exactly why **browsers can't do native gRPC**: `fetch`/XHR give you no
access to HTTP/2 trailers or fine-grained frame control, so the client can't read
`grpc-status` or drive a request stream. It's also why a **CDN/HTTP cache can't help
gRPC**: every call is an opaque binary `POST`-like exchange with trailers — nothing to key
a cache on and no safe/cacheable `GET`.

## Exposing gRPC to browsers beyond gRPC-Web

gRPC-Web + Envoy is one bridge, but the 2025 landscape is broader:

- **Connect (from Buf).** A gRPC-compatible protocol that runs over **HTTP/1.1 and
  HTTP/2** and is **callable directly from browsers with no proxy** (unary and
  server-streaming), while the same server also speaks gRPC and gRPC-Web. It sidesteps the
  trailers problem by not requiring them for unary calls.
- **gRPC transcoding.** Annotate `.proto` methods with **`google.api.http`** options
  mapping RPCs to REST verbs/paths; a proxy (Envoy's gRPC-JSON transcoder, Google's ESP)
  then exposes a **REST + JSON facade** over the gRPC service — public REST outside, gRPC
  inside, one contract.
- **The read-heavy escape hatch.** "Why can't I put gRPC behind a CDN, and what do I do for
  cacheable reads?" — transcode/expose those reads as **REST `GET`** (or GraphQL persisted
  `GET`) at the edge so the CDN can cache them, keeping gRPC for internal writes/streams.

## gRPC operational surface

Operational maturity questions distinguish "used gRPC in prod" from "read a blog":

- **Health checking** — the standard **gRPC Health Checking Protocol** (`grpc.health.v1`)
  gives a `Check`/`Watch` RPC that load balancers and orchestrators probe.
- **Server reflection** — lets tools like **`grpcurl`** discover services/messages at
  runtime without the `.proto` on hand (the analog of GraphQL introspection / OpenAPI).
- **Channelz** — a debugging service exposing per-channel/subchannel/socket stats.
- **Client-side load balancing + name resolution.** gRPC clients can resolve a name to
  many backends and **balance across them in-process** (pick-first, round-robin, or via a
  lookaside/xDS control plane), rather than relying on a single L7 proxy the way REST
  typically does. This suits long-lived HTTP/2 connections, which a naive L4 LB would pin
  to one backend.

## Comparing the three error models

A clean comparative question: *"contrast how each style reports errors."*

| | REST | GraphQL | gRPC |
|---|---|---|---|
| Channel | **HTTP status code** (`4xx`/`5xx`) | Top-level **`errors[]`** in the body | **`grpc-status`** code (0–16) in trailers |
| Structured detail | **RFC 9457 Problem Details** (`application/problem+json`: `type`, `title`, `status`, `detail`, `instance`) | `errors[].extensions.code` + `path`, `locations` | `google.rpc.Status` with typed `details` (e.g. `ErrorInfo`, `RetryInfo`) |
| Partial success | Rare (whole response succeeds or fails) | **First-class** — `data` + `errors` together | Not for unary; per-message on streams |
| Machine-readable category | The status code itself | `extensions.code` (app-defined) | The numeric status (well-defined semantics) |

- **REST**: the **status code** is the primary signal; **RFC 9457** (which *obsoletes RFC
  7807*) standardizes a JSON problem body so clients get machine-readable detail beyond the
  bare code.
- **GraphQL**: transport is usually `200`; the **`errors` array** carries what failed, and
  partial `data` can accompany it. Categorization lives in `extensions.code` by convention.
- **gRPC**: a compact **numeric status** with rich, typed `details` — the most structured
  and the only one with standardized retry-signaling codes.

## HTTP versions and the round-trip story

A common oversimplification is "REST is HTTP/1.1 and gRPC owns HTTP/2." In fact:

- **REST runs fine over HTTP/2 and HTTP/3.** HTTP/2 **multiplexing** lets many REST
  requests share one connection concurrently, largely erasing HTTP/1.1 head-of-line
  blocking and the "REST needs many slow round trips" penalty. So under-fetching's *round
  trips* still cost server calls, but the *connection overhead* is much smaller than the
  old mental model.
- **HTTP/3 / QUIC (RFC 9114)** runs over UDP, removing **TCP** head-of-line blocking
  (a lost packet no longer stalls unrelated streams) and enabling 0-RTT connection resume —
  improving tail latency for REST and (where supported) gRPC alike.
- **gRPC still *requires* HTTP/2** for its framing/trailers; the difference is that REST is
  *version-agnostic* and benefits from newer HTTP transports transparently, while gRPC is
  pinned to HTTP/2 semantics.

## Idempotency and retry safety compared

Retry-safety is a cross-cutting senior concern, and the three styles differ:

- **REST bakes it into the verbs (RFC 9110).** `GET`, `HEAD`, `PUT`, `DELETE` are
  **idempotent** (repeating them has the same effect as once); `GET`/`HEAD` are also
  **safe** (no side effects). `POST` is **neither**, so retrying a `POST` risks duplicates —
  the common fix is an **`Idempotency-Key`** header the server dedupes on. The semantics are
  standardized and self-describing.
- **gRPC has no built-in idempotency.** A method's verb doesn't tell you whether a retry is
  safe; combined with **independent success determination** (a client-side
  `UNAVAILABLE`/`DEADLINE_EXCEEDED` may hide a committed server write), **automatic retries
  are dangerous unless you design idempotency in** (dedupe keys, `ALREADY_EXISTS`
  handling). gRPC's retry policy config assumes you've made the method idempotent.
- **GraphQL** runs top-level **mutations serially** (queries may resolve in parallel), but
  serial execution is *ordering*, not idempotency — a mutation is as unsafe to blindly
  retry as a `POST`, and it rides `POST` anyway.

## Use-case to paradigm decision matrix

| Use case | Best fit | Deciding factor |
|---|---|---|
| Public / partner API for the open web | **REST** | Ubiquity, HTTP caching, lowest client friction |
| Read-heavy cacheable content (catalog, docs) | **REST** | CDN caches `GET` at the edge; origin offload |
| Internal microservice-to-microservice | **gRPC** | Typed contract, low latency, you own both ends |
| Mobile BFF composing many backends | **GraphQL** | Client-defined shapes, one round trip, fast frontend iteration |
| Real-time chat / bidirectional telemetry | **gRPC** | First-class bidi streaming over HTTP/2 |
| Live "watch this data" push to browsers | **GraphQL subscriptions** or **SSE (REST)** | Browser reach; server→client push only |
| IoT / low-bandwidth / constrained devices | **gRPC** | Compact Protobuf, small frames |
| Third-party webhooks / callbacks | **REST** | Everyone can receive a plain HTTP `POST` |
| High-volume stream ingest between services | **gRPC** | Client/bidi streaming + backpressure/flow control |
| Polyglot backend needing one enforced schema | **gRPC** | `.proto` codegen across languages |

The exam habit: don't answer with a paradigm, answer with the **deciding factor** — who
the client is, whether reads are cacheable, whether you control both ends, and how strict
the contract must be.

## Performance nuance beyond raw speed

"gRPC is fastest" needs a caveat matrix, not a blanket claim:

- **Service-to-service, uncached:** gRPC usually wins — Protobuf (de)serialization is
  cheaper than JSON parsing and HTTP/2 multiplexing amortizes connection cost.
- **Read-heavy public content:** a **CDN-cached REST `GET` beats everything** by not
  touching the origin at all — no serialization, no round trip to your servers. Caching
  outranks wire efficiency.
- **Payload size:** Protobuf is roughly **30–50% smaller** than equivalent JSON, but
  **gzip/br-compressed JSON narrows the gap** substantially; on already-compressed links
  the serialization CPU cost often matters more than raw bytes.
- **Operational value of JSON:** human-readable payloads mean easier debugging, logging,
  and manual `curl` reproduction — a real (if unglamorous) cost of going binary that shows
  up in incident response, not benchmarks.

## Contract governance and breaking-change checks

Saying a contract is "mandatory" is hollow without enforcement. How it's actually policed:

- **Schema registries.** GraphQL: **Apollo GraphOS / schema registry** stores the
  published schema and (in federation) composes subgraphs and rejects invalid composition.
  gRPC: the **Buf Schema Registry (BSR)** hosts `.proto` modules with versioning and
  dependency management.
- **Breaking-change CI.** Automated **schema diffing** fails the build on incompatible
  changes: **`buf breaking`** for Protobuf (catches renumbered/removed fields, type
  changes), GraphQL schema-diff tools (catch removed/renamed fields or narrowed types) run
  against the registry's last published schema. REST's analog is OpenAPI diff/linters
  (e.g. spectral, oasdiff) — weaker because the spec isn't protocol-enforced.
- **Consumer-driven contracts.** Instead of trusting the producer's schema, **consumers**
  publish the interactions they depend on (e.g. Pact); the producer's CI verifies it hasn't
  broken any real consumer. This ties "the contract" to *actual* usage, complementing
  static schema diffs — especially valuable for REST, where the wire has no enforced type
  system.

## References

- RFC 9110 — HTTP Semantics (methods, status codes, caching): https://www.rfc-editor.org/rfc/rfc9110
- RFC 9457 — Problem Details for HTTP APIs (obsoletes RFC 7807): https://www.rfc-editor.org/rfc/rfc9457
- GraphQL Specification: https://spec.graphql.org/
- GraphQL — Best Practices (caching, pagination, versioning): https://graphql.org/learn/
- Apollo — Caching / persisted queries / query cost: https://www.apollographql.com/docs/
- gRPC — Official docs (concepts, core, HTTP/2 mapping): https://grpc.io/docs/
- gRPC-Web — https://github.com/grpc/grpc-web
- Protocol Buffers — Language guide (proto3) & message evolution: https://protobuf.dev/programming-guides/proto3/
- OpenAPI Specification 3.1: https://spec.openapis.org/oas/v3.1.0
- OWASP API Security Top 10 (2023): https://owasp.org/API-Security/editions/2023/en/0x00-header/
- GraphQL-over-HTTP spec (status codes, media types): https://graphql.github.io/graphql-over-http/draft/
- gRPC status codes (0–16) & core concepts (deadlines, cancellation, metadata): https://grpc.io/docs/guides/status-codes/ and https://grpc.io/docs/what-is-grpc/core-concepts/
- Protobuf encoding (wire types, varint/ZigZag) & proto3 presence: https://protobuf.dev/programming-guides/encoding/ and https://protobuf.dev/programming-guides/field-presence/
- Apollo Federation & GraphQL Composite Schemas spec: https://www.apollographql.com/docs/federation/ and https://github.com/graphql/composite-schemas-spec
- Connect protocol (Buf) & Buf Schema Registry / buf breaking: https://connectrpc.com/ and https://buf.build/docs/
- RFC 9114 — HTTP/3: https://www.rfc-editor.org/rfc/rfc9114
