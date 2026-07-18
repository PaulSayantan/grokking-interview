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

- **"Does GraphQL replace REST?"** No. It solves over/under-fetching and client-driven
  shapes, but gives up easy HTTP caching and adds query-cost/N+1 complexity. Many teams
  run both.
- **"Why can't the browser call gRPC directly?"** Browser HTTP APIs don't expose the
  HTTP/2 framing/trailers gRPC needs; you need gRPC-Web plus a proxy, and even then no
  client/bidi streaming.
- **"What HTTP status does a failing GraphQL query return?"** Usually 200, with errors in
  the `errors` array; transport 4xx/5xx is reserved for malformed/failed requests.
- **"How do you stop an expensive GraphQL query?"** Depth limiting, query cost/complexity
  analysis, persisted-query allowlists, timeouts, and cost-based rate limiting.
- **"How do you version each?"** REST: URL/media-type versions + additive change. GraphQL:
  don't version — add fields and `@deprecated`. gRPC: never reuse field numbers, add new
  tags, `reserve` removed ones.
- **"Which is fastest?"** For raw service-to-service latency/throughput, gRPC (binary +
  HTTP/2 multiplexing) usually wins; but "fastest" depends on caching — a CDN-cached REST
  `GET` beats everything by not hitting the origin at all.
- **"Why does gRPC use HTTP/2?"** Multiplexed streams over one connection, header
  compression, and binary framing enable low-latency calls and native streaming.

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
