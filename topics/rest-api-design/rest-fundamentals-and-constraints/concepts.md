# REST Fundamentals & Architectural Constraints

REST (**RE**presentational **S**tate **T**ransfer) is an **architectural style** for
distributed hypermedia systems, defined by Roy Fielding in his 2000 doctoral
dissertation. It is not a protocol, a standard, or a file format — it is a *named set
of constraints* that, when applied to a system, induce desirable properties like
scalability, evolvability, and visibility.

The most important reframe for interviews: REST describes **the contract a client
consumes over the wire**, not the code you write on the server. Two servers written in
completely different frameworks can expose the *same* RESTful contract. This topic is
about that contract and the reasoning behind it — the "what and why" — grounded in the
actual HTTP semantics defined by **RFC 9110**.

> [!KEY-TAKEAWAY]
> REST = **constraints, not code**. Each constraint trades away some freedom to *buy*
> a system property (scale, cache, evolvability). If you can name the constraint *and*
> the property it buys, you can answer almost any REST-fundamentals question.

---

## What REST is (and what it is not)

**Definition.** REST is an architectural style: a coordinated set of *constraints*
applied to the components, connectors, and data of a distributed system. Fielding
derived it by starting from the "null style" (no constraints) and adding constraints
one at a time, each justified by the property it produces. The style is deliberately
protocol-independent, though it was co-designed with HTTP/1.1 and URIs, so HTTP is its
canonical instantiation.

**Why it matters.** The web itself is the proof: REST's constraints are *why* the web
scales to billions of clients, caches aggressively, tolerates partial failure, and
lets servers and browsers evolve independently for decades. When you design an API to
"be RESTful," you are trying to inherit those same properties.

**What REST is NOT** (classic myth-busting — see also the myths section):

| Misconception | Reality |
|---|---|
| "REST = JSON over HTTP" | REST is media-type-agnostic. JSON is a common *representation format*, not part of REST. XML, CBOR, HTML, protobuf can all be RESTful representations. |
| "REST = CRUD mapped to HTTP verbs" | CRUD-over-HTTP is a *common pattern*, but REST is about resources, representations, and hypermedia — not database operations. |
| "REST is a protocol/standard" | It is an architectural style. HTTP is the protocol; there is no "REST spec" to conform to (RMM and guidelines exist, but no normative REST standard). |
| "Any HTTP JSON API is RESTful" | Most so-called REST APIs sit at Richardson level 2 and skip hypermedia; Fielding called APIs without hypermedia "not RESTful." |

> [!INTERVIEW]
> A strong opening answer: "REST is an architectural style defined by six constraints;
> the goal is to inherit the web's scalability and evolvability. It's not a protocol,
> and it's broader than JSON-over-HTTP or CRUD." Then let them probe a specific
> constraint.

---

## Fielding's six architectural constraints

Fielding's style is defined by **six constraints**. Five are required; one
(code-on-demand) is **optional**. If a system violates any of the five required
constraints, it is — strictly — not RESTful.

| # | Constraint | Property it buys |
|---|---|---|
| 1 | Client–server | Separation of concerns; independent evolution |
| 2 | Stateless | Scalability, visibility, reliability |
| 3 | Cacheable | Efficiency, reduced latency/load |
| 4 | Uniform interface | Simplicity, decoupling, evolvability |
| 5 | Layered system | Scalability, security boundaries, encapsulation |
| 6 | Code-on-demand *(optional)* | Client extensibility (at the cost of visibility) |

**Why "constraints"?** Each constraint *removes* a degree of freedom. Statelessness
forbids server-side session memory; that restriction is precisely what lets any server
handle any request, which is what enables horizontal scaling. The discipline of the
constraint *is* the benefit. This "trade a freedom to buy a property" framing is the
heart of the topic.

> [!TIP]
> Memory hook: **"CS Cake CoD"** — Client-server, Stateless, Cacheable, Uniform
> interface, Layered, Code-on-demand. Only the last is optional.

---

## Client-server separation

**Definition.** Separate the **user-interface / consumer** concerns (client) from the
**data storage and business logic** concerns (server) via a uniform interface. Neither
side needs to know the other's internals — only the contract between them.

**Why it matters.** Independent evolution. A mobile app, a web SPA, and a partner's
batch job can all consume the same server; the server can re-platform its database
without clients caring, as long as the wire contract holds. It also improves
portability of the UI across platforms and simplifies server components.

**Trade-offs / gotchas.**
- The boundary is the contract; changing it (breaking the representation or URI
  conventions) breaks clients — which is why versioning and evolution matter.
- "Client-server" is a *communication* separation, not a physical one. A BFF
  (backend-for-frontend) is still a client of downstream services even though it runs
  server-side.

---

## Statelessness: what it really means

**Definition.** Each request from client to server **must contain all information
needed to understand and process it**; the server keeps **no client session state**
between requests. State that persists (a user's data, an order) is *resource state*
that lives in the server's datastore; state about *the conversation* (who you are on
this request, what page you're on) must be carried by the client on every request.

**Crucial distinction (the #1 thing interviewers probe):**

| State type | Where it lives | RESTful? |
|---|---|---|
| **Application/session state** (conversation context: "logged in as X", "on step 3 of wizard") | Client — sent on each request (token, cursor, etc.) | Statelessness forbids storing this on the server between requests |
| **Resource state** (the user record, the cart's items, the order) | Server datastore | Perfectly fine — this is *the data*, not session memory |

So "stateless" does **not** mean "the server stores nothing." It means the server
stores no *per-client conversational* state tied to a connection/session.

**Example — stateful vs stateless auth:**

```http
# Stateful (NOT RESTful): server keeps a session in memory keyed by a cookie
GET /cart HTTP/1.1
Cookie: JSESSIONID=abc123        # server must look up in-memory session

# Stateless (RESTful): every request self-describes via a bearer token
GET /cart HTTP/1.1
Authorization: Bearer eyJhbGciOi...   # server validates token, no session lookup
```

**Why it matters — the properties it buys:**
- **Scalability / load balancing:** any server instance can handle any request; no
  sticky sessions, trivial horizontal scaling and failover.
- **Visibility:** a monitoring/caching intermediary can understand a request in
  isolation, without replaying prior requests.
- **Reliability:** recovering from partial failure is easier — no fragile server-side
  session to reconstruct.

**Trade-offs / gotchas.**
- **Cost:** repeated per-request data (auth token, full context) increases request
  size and can reduce the server's ability to optimize across requests. Statelessness
  trades server memory/efficiency for scalability and reliability.
- A **JWT** is a common way to make auth stateless (self-contained claims), but that
  reintroduces revocation problems (you can't easily invalidate a valid-until-expiry
  token). Opaque tokens with a lookup are less "stateless" at the token layer.
- Storing state in a *shared external store* (Redis session store) is a pragmatic
  middle ground, but strictly it means the request is no longer self-contained — the
  server still needs external context. Interviewers may push on this nuance.

> [!WARNING]
> "Stateless" is not "the server has no database." Confusing *resource state* with
> *session state* is the most common statelessness mistake in interviews.

---

## Cacheability

**Definition.** Responses must, implicitly or explicitly, label themselves as
**cacheable or non-cacheable**. If cacheable, a client or intermediary may reuse the
response for equivalent later requests. In HTTP this is done with cache-control
metadata.

**Why it matters.** Caching eliminates some client–server interactions entirely,
improving efficiency, scalability, and user-perceived latency — one of the biggest
reasons the web scales. It is a *first-class REST constraint*, not an afterthought.

**How it shows up on the wire (RFC 9110 / RFC 9111 semantics):**

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600     # cacheable by anyone for 1 hour
ETag: "v3-8a1f"                          # validator for conditional requests
```

```http
# Non-cacheable
Cache-Control: no-store
```

**Trade-offs / gotchas.**
- Caching trades **freshness/consistency** for efficiency — you may serve stale data.
- Only **safe** methods (typically `GET`, `HEAD`) yield responses that are meaningfully
  cacheable by default; responses to `POST` are cacheable only under specific
  conditions and rarely in practice.
- Bad cache labeling causes correctness bugs (serving one user's data to another). This
  intersects with security: never mark user-specific responses `public`.
- Conditional requests (`ETag`/`If-None-Match`, `Last-Modified`/`If-Modified-Since`)
  let a cache *revalidate* cheaply with `304 Not Modified` — the efficiency payoff.

---

## Uniform interface and its sub-constraints

**Definition.** The **uniform interface** is the central, defining feature of REST — it
is what distinguishes REST from other network styles. Components interact through a
**standardized, generic interface** rather than application-specific APIs. Fielding
breaks it into **four sub-constraints:**

1. **Identification of resources** — resources are identified by URIs. The URI names
   the *concept* (e.g. `/users/42`), independent of any particular representation.
2. **Manipulation of resources through representations** — clients act on resources by
   exchanging *representations* (a JSON document, an image), not by touching the
   server's internal storage. A representation + metadata is enough to create, modify,
   or delete the resource.
3. **Self-descriptive messages** — each message carries enough metadata to describe how
   to process it: the method's semantics, `Content-Type` media type, cache directives,
   status codes. An intermediary can understand a message without out-of-band
   knowledge.
4. **Hypermedia as the engine of application state (HATEOAS)** — the server drives the
   client through the application by embedding *links and controls* in responses; the
   client discovers available next actions from the representation rather than
   hardcoding URIs.

**Why it matters.** The uniform interface *decouples* clients from servers and lets
each evolve independently. Generic connectors (browsers, caches, proxies) work across
all resources because the interface is the same everywhere. The cost: a uniform
interface is less efficient than an interface tailored to one application's needs (you
transfer standardized representations, not bespoke payloads) — REST accepts that
inefficiency to buy generality and evolvability.

**Example — self-descriptive + hypermedia in one response:**

```http
GET /orders/1001 HTTP/1.1
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: private, max-age=0
ETag: "order-1001-v7"

{
  "id": 1001,
  "status": "pending",
  "total": 42.50,
  "_links": {
    "self":   { "href": "/orders/1001" },
    "cancel": { "href": "/orders/1001/cancel", "method": "POST" },
    "pay":    { "href": "/orders/1001/payment", "method": "POST" }
  }
}
```

**Gotchas.**
- Most "REST" APIs implement sub-constraints 1–3 but skip HATEOAS (sub-constraint 4).
  Fielding explicitly argued that an API without hypermedia is not RESTful.
- The uniform interface is *why* HTTP verbs and status codes matter: they are the
  standardized, self-descriptive vocabulary. Using `GET /getUser?id=42` (an RPC-style
  verb in the path) breaks self-descriptiveness and the uniform interface.

---

## Layered system

**Definition.** The architecture is composed of **hierarchical layers**; each component
can only "see" the immediate layer it interacts with — it cannot see beyond. A client
cannot tell whether it is connected directly to the origin server or to an intermediary
(load balancer, cache, gateway, proxy).

**Why it matters.**
- **Scalability:** intermediaries can load-balance and share caches.
- **Security:** you can enforce policy at boundaries (a gateway does auth/rate limiting;
  legacy services sit behind a facade).
- **Encapsulation:** legacy systems can be wrapped and shielded from clients.

**Example.** `Client → CDN → API Gateway → Load Balancer → Service → Database`. The
client only knows it talks HTTP to one endpoint; every hop is invisible to it, and each
layer can be changed independently.

**Trade-offs / gotchas.**
- Each layer adds **latency/overhead**; caching at intermediaries offsets this.
- Layered system is *why* REST plays well with gateways, BFFs, and CDNs — they are all
  transparent intermediaries permitted by this constraint.
- Statelessness is what *enables* layering to be transparent: because requests are
  self-contained, an intermediary can route/cache without conversational context.

---

## Code-on-demand (optional)

**Definition.** Servers can **extend client functionality** by transferring executable
code (scripts) that the client runs — e.g. JavaScript sent to a browser, or an applet.
This is the **only optional** constraint.

**Why it's optional.** It *reduces visibility* (an intermediary can no longer fully
understand behavior from the message alone) and adds client complexity/security
surface. Fielding made it optional so that architects can choose it where client
extensibility outweighs the visibility cost. A system can be fully RESTful without it.

**Example.** A browser fetching an HTML page that includes `<script>` executing on the
client is code-on-demand in action. A pure JSON data API typically does *not* use it.

> [!TIP]
> If asked "which constraint is optional and why," the answer is **code-on-demand**,
> because sending executable code trades away *visibility* — so it's left to the
> architect's discretion.

---

## Resource vs representation

**Definition.** A **resource** is any concept worth naming — a user, an order, a
collection, today's weather, even a transient process. It is identified by a **URI**. A
**representation** is a *concrete serialized snapshot* of a resource's state at a moment
in time, in some media type (JSON, XML, HTML, PNG). The client and server exchange
**representations**; they never move the resource itself.

**Key mental model.** The resource is the abstract *thing*; the representation is *a
view of it right now, in a chosen format*. One resource can have many representations.

**Example — one resource, many representations via content negotiation:**

```http
GET /users/42 HTTP/1.1
Accept: application/json
# → JSON representation

GET /users/42 HTTP/1.1
Accept: application/xml
# → XML representation of the SAME resource /users/42
```

Both requests target the same resource (`/users/42`); the `Accept` header selects the
representation. The resource identity (URI) is stable; representations vary.

**Why it matters / gotchas.**
- This distinction underpins **content negotiation** and the uniform-interface
  sub-constraint "manipulation through representations."
- A `PUT` sends a *representation* the server uses to set the resource's state; the
  bytes you send are not "the resource," they're a proposed representation of it.
- The URI identifies the resource, **not** a representation or a file. `/reports/2024`
  can be rendered as PDF or CSV without changing what the URI *identifies*.

---

## REST vs RPC

**Definition.** **RPC (Remote Procedure Call)** exposes *operations/verbs* ("do this
action") — you call a named procedure with arguments. **REST** exposes *resources/nouns*
and manipulates them with a *uniform* set of methods. RPC's interface is
application-specific; REST's is uniform.

| Aspect | RPC style | REST style |
|---|---|---|
| Endpoint model | Verbs/actions (`/createUser`, `/getUserById`) | Resources/nouns (`/users`, `/users/42`) |
| Interface | Custom per operation | Uniform (standard HTTP methods) |
| HTTP verb | Often just `POST` for everything | Method encodes intent (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) |
| Coupling | Client knows procedure names/signatures | Client knows media types + follows links |
| Examples | gRPC, JSON-RPC, XML-RPC, SOAP | HTTP APIs designed around resources |

**Example — same intent, two styles:**

```http
# RPC style — verb in the path, POST for everything
POST /getUserOrders HTTP/1.1
{ "userId": 42 }

# REST style — resource + uniform method
GET /users/42/orders HTTP/1.1
```

**Why it matters / trade-offs.**
- REST's uniform interface gives you caching, intermediary support, and evolvability
  for free (via standard HTTP semantics). RPC gives you a *tighter, often more
  efficient, action-oriented* contract — great for internal service-to-service calls
  (gRPC), less ideal for broad, cacheable, long-lived public APIs.
- RPC-over-HTTP that tunnels everything through `POST /doThing` throws away HTTP method
  semantics, cacheability, and self-descriptiveness — it is HTTP as *transport*, not
  as *application protocol*.
- Neither is universally "better." REST optimizes for evolvability/scale over a uniform
  interface; RPC optimizes for tailored, efficient operations at the cost of coupling.

---

## The Richardson Maturity Model

**Definition.** The **Richardson Maturity Model (RMM)**, articulated by Leonard
Richardson and popularized by Martin Fowler, is a **design lens** that grades an HTTP
API by how thoroughly it adopts REST's building blocks — across **four levels (0–3)**.
It is *descriptive*, not a compliance checklist, but it's a great vocabulary for
interviews.

| Level | Name | What it uses | Typical smell |
|---|---|---|---|
| **0** | The Swamp of POX | Single URI, single method (usually `POST`); HTTP as a tunnel | SOAP, XML-RPC, one endpoint like `/api` |
| **1** | Resources | Many URIs (one per resource), still typically one method | `/users/42`, but everything is `POST` |
| **2** | HTTP Verbs | Resources **+** proper HTTP methods **+** status codes | Most "REST" APIs live here |
| **3** | Hypermedia Controls (HATEOAS) | Level 2 **+** hypermedia links driving state transitions | The "glory of REST"; rare in practice |

**Why it matters.**
- Gives you a shared ladder to describe *how* RESTful an API is. Level 2 is the
  pragmatic industry norm; level 3 is what Fielding considers *actually* RESTful.
- The jump **1→2** (using verbs + status codes) delivers most practical value: caching,
  idempotency, and clear semantics. The jump **2→3** (hypermedia) buys evolvability and
  discoverability but adds client/server complexity, which is why adoption is low.

**Gotchas.**
- RMM is **Richardson's/Fowler's teaching aid, not Fielding's**. Fielding never
  endorsed levels as a REST definition; he only insists hypermedia (level 3's
  ingredient) is *required* for an API to be REST.
- "We're RESTful" usually means "level 2." If an interviewer asks whether that's *truly*
  REST, the honest answer is "it's level 2 — pragmatically RESTful, but missing the
  hypermedia constraint Fielding requires."

---

## Common REST myths, busted

- **Myth: "REST means JSON."** REST is representation-format agnostic. JSON is a popular
  representation; XML, HTML, CBOR, protobuf, even plain text can be RESTful
  representations. Content negotiation exists precisely because a resource can have
  many representations.
- **Myth: "REST is CRUD over HTTP."** CRUD-to-verb mapping is a *common convenience*, but
  resources need not map to database rows, and not every operation is CRUD (consider a
  `POST /orders/1001/cancel` state transition, or a search resource).
- **Myth: "REST is a standard/protocol."** It's an architectural style. HTTP is the
  protocol; there is no normative "REST specification" you conform to.
- **Myth: "Any HTTP+JSON API is RESTful."** Most are level 2 and omit hypermedia;
  strictly, Fielding calls hypermedia-less APIs "not RESTful."
- **Myth: "Statelessness means the server stores nothing."** It means no *per-client
  session/conversation* state between requests; resource state in a datastore is fine.
- **Myth: "REST requires HATEOAS to be useful."** Useful ≠ maximally RESTful. Level-2
  APIs are enormously useful; HATEOAS is what makes an API *fully* REST per Fielding,
  which is a different bar than "useful."
- **Myth: "Pretty URLs make it REST."** URI aesthetics are cosmetic. RESTfulness is
  about the constraints (uniform interface, statelessness, cacheability…), not
  whether the path looks clean.

---

## Common follow-up questions

- **"Name Fielding's six constraints and which is optional."** Client-server, stateless,
  cacheable, uniform interface, layered system, code-on-demand — the last is optional.
- **"What does statelessness actually forbid?"** Server-side *session/conversation*
  state between requests; each request must be self-contained. Resource state in a DB
  is fine.
- **"Why is statelessness good for scaling?"** Any server can serve any request → no
  sticky sessions → trivial horizontal scaling, load balancing, and failover.
- **"What are the four sub-constraints of the uniform interface?"** Resource
  identification via URIs; manipulation through representations; self-descriptive
  messages; HATEOAS.
- **"Is a JSON-over-HTTP API automatically RESTful?"** No — it's usually RMM level 2 and
  typically lacks hypermedia; and RESTfulness is about constraints, not the format.
- **"REST vs RPC — when would you pick RPC?"** For tightly-coupled, high-throughput
  internal service calls where a tailored, efficient action-oriented contract (e.g.
  gRPC) beats a uniform interface; REST for broad, cacheable, evolvable, public APIs.
- **"What does the Richardson Maturity Model add?"** A shared vocabulary (levels 0–3)
  for how thoroughly an API adopts resources, verbs, and hypermedia.
- **"Resource vs representation?"** The resource is the named abstract thing (URI); the
  representation is a concrete serialized snapshot in some media type. Clients exchange
  representations.
- **"Which constraint enables API gateways and CDNs?"** Layered system (with
  statelessness making the layering transparent).
- **"Why is the uniform interface a trade-off?"** It sacrifices per-application
  efficiency (standardized rather than tailored payloads) to buy generality,
  decoupling, and evolvability.

## References

- Roy T. Fielding, *Architectural Styles and the Design of Network-based Software
  Architectures* (2000), Ch. 5 "Representational State Transfer (REST)."
  https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm
- Roy T. Fielding, "REST APIs must be hypertext-driven" (2008).
  https://roy.gbiv.com/untangled/2008/rest-apis-must-be-hypertext-driven
- RFC 9110 — *HTTP Semantics* (2022; obsoletes the semantics RFCs 7231, 7232, 7233,
  7235 — HTTP/1.1 message syntax moved to RFC 9112, caching to RFC 9111).
  https://www.rfc-editor.org/rfc/rfc9110
- RFC 9111 — *HTTP Caching* (2022; obsoletes RFC 7234).
  https://www.rfc-editor.org/rfc/rfc9111
- RFC 8288 — *Web Linking* (link relations / `Link` header). https://www.rfc-editor.org/rfc/rfc8288
- RFC 9457 — *Problem Details for HTTP APIs* (2023; obsoletes RFC 7807).
  https://www.rfc-editor.org/rfc/rfc9457
- Martin Fowler, "Richardson Maturity Model." https://martinfowler.com/articles/richardsonMaturityModel.html
- Leonard Richardson, "Justice Will Take Us Millions Of Intricate Moves" (QCon 2008 talk).
