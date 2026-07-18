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

## Architectural properties REST optimizes (and sacrifices)

The constraints exist to induce **properties**. Fielding's dissertation §2.3 enumerates
the properties of architectural styles; naming them closes the "constraint → property"
loop that senior interviewers probe ("what does REST optimize, and which constraint
delivers it?").

| Property | What it means | Constraint(s) that deliver it |
|---|---|---|
| **Performance** | Network performance, user-perceived performance, and network efficiency | Cacheable, code-on-demand, layered (via shared caches) |
| **Scalability** | Ability to support large numbers of components/interactions | Stateless, cacheable, layered, client-server |
| **Simplicity** | Understandability of the overall architecture | Uniform interface, separation of concerns (client-server) |
| **Modifiability** | Ease of change — split into **evolvability, extensibility, customizability, configurability, reusability** | Uniform interface (esp. HATEOAS + self-descriptive), client-server, code-on-demand |
| **Visibility** | Ability of a component (e.g. a monitor/cache) to understand an interaction in isolation | Stateless, uniform interface (self-descriptive messages) |
| **Portability** | Ability to move code/data across environments | Client-server, code-on-demand |
| **Reliability** | Resistance to failure at the system level | Stateless, cacheable, layered (redundancy/failover) |

**What REST *sacrifices*** — a favourite senior question:

- **Per-interaction efficiency.** The uniform interface transfers standardized rather
  than application-optimized representations. REST trades this efficiency for
  **generality and evolvability**. (This is why gRPC/GraphQL can beat REST on raw
  payload/round-trip efficiency for specific workloads.)
- **Visibility** is what **code-on-demand** trades away: an intermediary can no longer
  fully understand behaviour from the message alone once executable code drives the
  client. That is precisely why code-on-demand is the one *optional* constraint.

> [!INTERVIEW]
> "Name a property REST sacrifices and for what." → Per-interaction efficiency, traded
> for generality/evolvability via the uniform interface; and visibility, traded away by
> code-on-demand.

---

## Data, connector, and component elements

Fielding's dissertation §5.2 gives REST a precise vocabulary beyond "resource" and
"representation." Depth probes like "what is a *connector*?" or "what is *control
data*?" come straight from here.

**Data elements** — what flows through the system:

| Element | Meaning | Example |
|---|---|---|
| **Resource** | Any concept worth naming | a user, a collection, "today's weather" |
| **Resource identifier** | The URI naming a resource | `/users/42` |
| **Representation** | A serialized snapshot of resource state | a JSON document, a PNG |
| **Representation metadata** | Describes the representation | `Content-Type`, `Content-Length`, `ETag` |
| **Resource metadata** | Describes the resource, not a specific representation | source link, alternates, `vary` info |
| **Control data** | Defines the *purpose* of a message and how to process it | method semantics, `Cache-Control`, `If-None-Match`, status code |

**Connectors** — abstract interfaces for component communication (this is the answer to
"what's a connector?"):

- **client** — initiates requests (e.g. `libwww`, a browser's HTTP stack).
- **server** — listens for and answers requests.
- **cache** — stores responses for reuse; can sit on the client or server side or in the
  network (shared).
- **resolver** — translates identifiers into network addresses (e.g. DNS).
- **tunnel** — relays communication opaquely across a boundary (e.g. an SSL/`CONNECT`
  proxy, a firewall) without understanding the payload.

**Components** — the actors:

- **origin server** — the authoritative source for a resource's representations.
- **gateway** (reverse proxy) — imposed by the origin/network (API gateway, load
  balancer, mesh sidecar).
- **proxy** (forward proxy) — chosen by the client (corporate egress proxy).
- **user agent** — initiates requests on a user's behalf (browser, mobile app, CLI).

> [!TIP]
> "Control data" is the sleeper term: it's the request method, status code, and the
> caching/conditional headers — the bits that tell an intermediary *what to do* with a
> message. It's what makes messages self-descriptive.

---

## HATEOAS in depth: what compliance actually requires

REST's headline constraint is that the API must be **hypertext-driven**. In his 2008
post "REST APIs must be hypertext-driven," Fielding gave concrete rules that most "REST"
APIs violate. What compliance actually requires:

1. **No dependence on a single communication protocol.** The API is not hardwired to one
   protocol; it works over anything that can carry the media types and relations.
2. **Don't change protocol semantics beyond filling standard gaps.** You may use standard
   extensions (e.g. `PATCH`), but you must not repurpose methods/status codes.
3. **The design effort goes into media types and link relations** — *not* into
   documenting "which method hits which URI." The spec you publish should be a media-type
   spec plus a set of relation names, not a URI catalogue.
4. **The server owns its URI namespace.** Clients must **not** bake in URI structure or
   hierarchy. URIs are discovered from server-provided links, forms, and URI templates
   (RFC 6570). A client that constructs `/users/{id}/orders` from string concatenation is
   already non-conformant.
5. **Resource types are invisible to the client.** The client keys off **media type +
   standardized relation names**, never off a server-side "type." (`rel="payment"` tells
   the client what a link *means*, regardless of the resource's internal class.)
6. **The API is entered with no prior knowledge beyond the initial URI (a bookmark) and a
   set of standardized media types.** From there, all state transitions are selected by
   the client from the choices the server presents in its representations.

Fielding's killer line: relying on **out-of-band knowledge** to drive interaction (a
hardcoded URI template, an "API contract" the client compiles against) is *"the
data-oriented equivalent of RPC's functional coupling."* A hypermedia API is
**evolvable** because the server can change URIs, add transitions, and reshape flows
without breaking clients that follow links.

**Why adoption is low (a genuine industry debate).** Tooling and codegen assume static
URI contracts; machine clients hardcode URIs anyway; there is no single dominant
hypermedia format; and the discoverability/evolvability payoff often doesn't justify the
added client complexity for a small number of well-known consumers. So most teams ship
level-2 APIs and accept that they are *not* REST by Fielding's bar — a defensible
engineering trade-off, not a misunderstanding.

**The versioning corollary.** If you version your URIs (`/v2/users/42`), Fielding would
say you've already gotten something wrong: a hypertext-driven client shouldn't need URI
versioning because it doesn't construct or depend on URI structure. URL versioning is in
tension with both HATEOAS and self-descriptive evolvability (content negotiation on media
type is the more REST-aligned evolution path).

---

## Hypermedia formats and link standards

"How would you actually implement HATEOAS on the wire?" You pick a **hypermedia media
type** and standard **link machinery** instead of inventing a bespoke `_links` blob.

**Hypermedia document formats:**

| Format | Media type | Shape |
|---|---|---|
| **HAL** | `application/hal+json` | `_links` (and `_embedded`); the simplest, widely used. The example earlier in this file is HAL-shaped. |
| **HAL-FORMS** | `application/prs.hal-forms+json` | HAL plus templated **write** actions (method, fields) — fixes HAL's read-only link limitation |
| **JSON:API** | `application/vnd.api+json` | Opinionated: `data`, `links`, `relationships`, `included`; built-in pagination/sparse-fieldsets |
| **Siren** | `application/vnd.siren+json` | Entities with `links` **and** `actions` (name, method, fields, type) |
| **Collection+JSON** | `application/vnd.collection+json` | Collection-oriented with `queries` and `template` for writes |

**Link and identifier standards (framework-agnostic wire machinery):**

- **RFC 8288 (Web Linking)** — the `Link` response header plus the **IANA link-relation
  registry** (`self`, `next`, `prev`, `first`, `last`, `describedby`, ...). Lets you carry
  hypermedia even for non-hypermedia bodies (e.g. pagination `Link: <...>; rel="next"`).
- **RFC 6570 (URI Templates)** — server-provided *templated* links like
  `/users/{id}{?fields}` that the client expands. This is the mechanism behind Fielding's
  rule 4 (server owns the namespace; client fills in variables, doesn't construct
  structure).
- **RFC 6906 (`profile` link relation)** — points to a description of the *semantics/
  constraints* of a representation, letting clients negotiate application-level profiles
  without inventing new media types.
- **RFC 3986** — the URI generic syntax. Note "URL vs URI vs URN": a URL is a URI that
  also locates; a URN names without locating. REST identifies resources with URIs; it
  does not require them to be dereferenceable URLs (though on the web they usually are).

> [!INTERVIEW]
> If you claim "we do HATEOAS," expect: "which media type, and how do you express a
> *write* action?" HAL alone only models links (reads); HAL-FORMS, Siren, or
> Collection+JSON add templated actions with method + fields.

---

## Safety, idempotency, and cacheability as method properties

These are **architectural** properties of methods (RFC 9110 §9.2), not mere mechanics —
they are what let intermediaries and clients **retry and prefetch safely** under
statelessness and unreliable networks.

- **Safe (RFC 9110 §9.2.1):** the method is essentially read-only — it requests no
  *client-visible* state change. Safe ⇒ an intermediary or prefetcher may issue it
  speculatively. (Server-side logging/metrics don't count as client-visible effects.)
- **Idempotent (RFC 9110 §9.2.2):** the *intended effect on server state* of N ≥ 1
  identical requests is the same as for a single request. Idempotent ⇒ a client/proxy may
  **safely retry** after a timeout without fear of duplicate side effects.
- **Cacheable:** the response may be stored and reused (default for `GET`/`HEAD`;
  `POST`/`PATCH` only under explicit conditions).

| Method | Safe | Idempotent | Cacheable |
|---|---|---|---|
| `GET`, `HEAD` | yes | yes | yes |
| `OPTIONS`, `TRACE` | yes | yes | no |
| `PUT` | no | **yes** | no |
| `DELETE` | no | **yes** | no |
| `POST` | no | **no** | only if explicitly marked |
| `PATCH` | no | **no** (not by default) | no |

**The two classic traps:**

- *"Is a PUT that sets `updatedAt = now()` still idempotent?"* — **Yes.** Idempotency is
  about the *server-state effect*, not byte-identical responses. Repeating the PUT leaves
  the resource in the same logical state; a differing `updatedAt` timestamp does not break
  idempotency. (Contrast: a PUT that *appends* to a list on each call would not be
  idempotent.)
- *"Is a DELETE that returns 404 on the second call still idempotent?"* — **Yes.**
  Idempotency constrains the *effect on state* (resource is gone and stays gone), not the
  *response code*. Returning `204` then `404` is fine; the state effect is identical.

**Making POST safely retryable — idempotency keys.** `POST` is neither safe nor
idempotent, so a network timeout leaves the client unable to retry without risking a
duplicate (double charge). The standard fix is an **idempotency key**: the client sends a
unique key (e.g. `Idempotency-Key: <uuid>`); the server records the key + result and
returns the *same* result on replay instead of re-executing. This restores safe retry —
the enabler for reliability under statelessness — without changing POST's semantics.

---

## HTTP as application protocol vs transport

The single sharpest lens for "is this actually REST or *REST-ish*?"

- **HTTP as an application protocol (RESTful):** methods, status codes, and headers
  *carry application semantics*. `DELETE /orders/42` → `204`; a conflict → `409`; the
  response is cacheable per its `Cache-Control`. Intermediaries understand the exchange
  because the protocol elements mean what they say.
- **HTTP as a dumb transport (not RESTful):** the payload carries all semantics and HTTP
  is just an envelope. `POST /api` with `{ "action": "deleteOrder", "id": 42 }` always
  returning `200 { "error": ... }`. SOAP, JSON-RPC, and GraphQL-over-HTTP largely use HTTP
  this way — everything is a `POST`, everything is `200`, method/status/cache semantics are
  discarded.

**"REST-ish"** is the honest industry label for level-2 JSON APIs: they use HTTP *as an
application protocol* (real verbs, real status codes, cacheable GETs) but omit hypermedia,
so they are pragmatically RESTful without being REST by Fielding's bar. The gotcha
question "is your API actually REST or REST-ish?" is really asking whether you (a) use
HTTP semantically and (b) are hypertext-driven.

---

## Content negotiation in depth

Content negotiation is the mechanism behind "one resource, many representations" and a
pillar of self-descriptiveness (RFC 9110 §12).

- **Proactive (server-driven) negotiation:** the client expresses preferences via request
  headers and the server picks — `Accept` (media type), `Accept-Language`,
  `Accept-Encoding` (compression), `Accept-Charset`. Preferences carry **quality values**:
  `Accept: application/json;q=0.9, application/xml;q=0.5` means "prefer JSON, XML
  acceptable." This is by far the common case.
- **Reactive (agent-driven) negotiation:** the server returns a list of available
  representations (e.g. with `300 Multiple Choices`) and the client chooses. Rare in
  practice.

**The `Vary` header is the cache-correctness link.** When a response varies by a request
header, the origin **must** send `Vary: <header>` so a shared cache keys its stored copies
on that header. `Vary: Accept-Encoding` prevents serving a gzip body to a client that
can't decode it; `Vary: Accept` prevents serving JSON to an XML client. Omitting `Vary`
while doing negotiation is a classic cache-poisoning bug — it ties **cacheability** and
**content negotiation** together.

- `406 Not Acceptable` — the server cannot produce any representation matching the
  `Accept*` constraints (often better to serve a sensible default than to 406).
- `415 Unsupported Media Type` — the server refuses the *request body's* `Content-Type`
  (the request-side counterpart to `Accept`).

---

## Resource modeling: nouns, custom methods, and anti-patterns

Distilled from Google AIP-121/122/136, the Microsoft REST API Guidelines, and the
Zalando RESTful API Guidelines — the framework-agnostic discipline for turning a domain
into resources.

**Core rules:**

- **Don't mirror your database schema (AIP-121 anti-pattern).** Exposing tables/rows 1:1
  tightly couples the API to storage and leaks internal structure; model resources around
  the *domain concepts clients need*, not your ORM entities.
- **The resource hierarchy must be a DAG (acyclic).** Nesting expresses containment
  (`/projects/p1/datasets/d1`); cycles make identity ambiguous.
- **Prefer standard methods** (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) mapped to collections
  and items. Reserve **custom methods** for actions that genuinely don't fit CRUD.
- **Singleton resources** exist (e.g. `/users/42/settings`) — a sub-resource with exactly
  one instance, no collection.

**Modeling actions/processes as resources (the frequent probe):**

- *"Design 'search' RESTfully — noun or verb?"* Model the search as a resource:
  `GET /users?q=...` (query on a collection) or, for complex/large queries, create a
  **search resource**: `POST /searches` → `201` with a result URI you then `GET`.
- *"Design 'transfer money' RESTfully."* Reify the *process/event* as a noun:
  `POST /transfers` creates a **transfer resource** (`/transfers/9f3`) whose state you can
  later `GET`, retry idempotently (with an idempotency key), or audit. This beats a
  verb-endpoint `POST /transferMoney` because the transfer becomes a first-class,
  addressable, cacheable, auditable entity.
- **Custom methods** (AIP-136) are the escape hatch when reification is awkward — e.g.
  `POST /orders/1001:cancel` (Google's colon convention) or `POST /orders/1001/cancel`.
  Use them sparingly for state transitions that aren't naturally their own resource.

> [!INTERVIEW]
> The senior answer to "how do you model a non-CRUD action?" is: first try to **turn the
> action into a noun** (a transfer, a search, a shipment, a cancellation record); fall
> back to a **custom method** only when reification adds no value.

---

## REST vs GraphQL vs gRPC

The three-way comparison is one of the most common 2025 design-round openers. REST is one
point in a design space; know the trade-offs.

| Dimension | REST | GraphQL | gRPC |
|---|---|---|---|
| Endpoint model | Many resource URIs | **One** endpoint, client-specified query | Service methods (RPC), HTTP/2 |
| Wire format | Any (usually JSON) | JSON | **Protobuf** (binary) |
| Fetching | Fixed per endpoint (over/under-fetch risk) | **Client picks exact fields** (solves over/under-fetch) | Fixed by method contract |
| HTTP caching | **First-class** (GET + validators + CDNs) | Weak (everything is a POST to `/graphql`) | N/A (not HTTP semantics) |
| Status/error semantics | HTTP status codes | Usually `200` + `errors` array | gRPC status codes |
| Streaming | SSE/long-poll (bolted on) | Subscriptions | **Native bidirectional streaming** (HTTP/2) |
| Contract/codegen | OpenAPI (optional) | Schema (SDL), strongly typed | `.proto` IDL, strong codegen |
| Browser/human debuggability | **Excellent** (curl, cacheable) | Good (introspection) | Poor (binary, needs tooling) |
| Typical sweet spot | Broad public APIs, cacheable, evolvable | Aggregation for varied clients (mobile/BFF) | Internal service-to-service, low-latency |

**Trade-offs to speak to:**

- **GraphQL** eliminates over-/under-fetching and is great when many client shapes hit the
  same graph — but you **lose HTTP caching and status-code semantics**, rate-limiting is
  harder (query cost varies wildly), and you must defend against **N+1 resolver** blowups
  and expensive/deeply-nested queries.
- **gRPC** wins on throughput (binary protobuf, HTTP/2 multiplexing) and streaming for
  **internal** microservices with generated clients — but it's poor for browsers and human
  debugging, and it uses HTTP as transport, not application protocol.
- **REST** wins on cacheability, ubiquity, evolvability, and human-debuggability for broad
  public/long-lived APIs; it pays with over/under-fetching and chatty multi-round-trip
  workflows.

*"REST vs GraphQL for a mobile app on slow networks with many screen shapes?"* → GraphQL's
precise field selection cuts payload and round-trips (a real win on mobile), but weigh the
loss of HTTP/CDN caching and the operational cost of query-cost control; a REST + BFF that
returns screen-tailored aggregates is a valid middle ground.

---

## When NOT to use REST

REST's uniform interface and request/response model are a poor fit for several workloads.
Naming the alternative separates senior from junior answers.

| Scenario | Why REST fits poorly | Better fit |
|---|---|---|
| **Real-time bidirectional** (chat, collaborative editing, multiplayer) | Request/response can't push; polling is wasteful | **WebSockets** |
| **Server → client push / live feeds** (notifications, dashboards) | No native server push | **SSE** (Server-Sent Events) — one-way, over plain HTTP |
| **High-throughput internal RPC** | Uniform-interface + text overhead hurts; want streaming | **gRPC** (protobuf, HTTP/2) |
| **Deeply-nested / aggregation graph queries across many entities** | Over/under-fetch, N round trips | **GraphQL** or a **BFF** |
| **Long-running / async operations** | Synchronous request/response blocks | `202 Accepted` + a **status resource to poll**, or **webhooks/events** |
| **Action-heavy / transactional domains that don't map to nouns** | Forcing verbs into resources is awkward | RPC-style, or reify carefully with custom methods |
| **Ultra-low-latency paths** | Uniform-interface generality adds overhead | Binary RPC / specialized protocols |

**The long-running-operation pattern (worth knowing precisely):** for an operation that
can't complete within one request, return `202 Accepted` with a `Location` (or body) that
names an **operation/status resource**; the client polls `GET /operations/{id}` until it
reports completion (and a link to the result), or registers a **webhook** to be notified.
This keeps the API stateless and RESTful while handling async work.

---

## Statelessness in production: sticky sessions and idempotency keys

Deepening the statelessness constraint for the operational questions interviewers love.

- **Sticky sessions (session affinity) are the anti-pattern statelessness removes.**
  Pinning a client to one instance (so its in-memory session is found) breaks **elastic
  autoscaling** (new instances get no traffic pinned to them; scale-in drops sessions),
  **rolling deploys** (recycling a node logs users out / drops carts), and **failover**
  (a dead node's sessions are lost). A stateless design lets any instance serve any
  request, which is what makes those operations painless.
- **TCP/TLS connection state ≠ application state.** Being stateless at the *application*
  layer is fully compatible with a *stateful transport* (a kept-alive TCP/TLS connection,
  HTTP/2 streams). Statelessness is about not retaining per-client *conversational* state
  between requests, not about connectionless transport.
- **Cost of statelessness: re-sending context.** Auth tokens and context ride on *every*
  request, inflating request size. **HTTP/2 HPACK** (and HTTP/3 QPACK) header compression
  mitigates the repeated-header cost on a connection, which is part of why the tax is
  tolerable at scale.
- **Idempotency keys are the stateless-retry enabler.** Because the server keeps no
  per-client memory, a client that times out must be able to retry safely; an idempotency
  key lets it retry a `POST` without duplicating effects (see the method-properties
  section). This is how you get reliability *without* server-side session state.

> [!INTERVIEW]
> "Your cart uses sticky sessions — RESTful?" → No (server-side conversational state), and
> it breaks autoscaling, rolling deploys, and failover. Fix: carry cart identity in the
> request (token/cart-id) and store the cart as *resource state* in a shared datastore.

---

## Layered system: intermediary types in practice

Beyond "CDN → gateway → service," name the intermediary *types* and their roles — the
modern service-mesh reality.

- **Reverse proxy / TLS terminator** — an origin-side intermediary (e.g. nginx, Envoy)
  that terminates TLS and forwards plaintext internally; a **gateway** component in
  Fielding's vocabulary.
- **Forward proxy** — client-chosen (corporate egress proxy); a **proxy** component.
- **API gateway** — enforces authn/z, rate limiting, routing, and request shaping at the
  **security boundary** (the edge), so downstream services don't each re-implement it.
- **WAF (web application firewall)** — inspects/filters traffic for attacks at the edge.
- **Service-mesh sidecar (Envoy)** — a proxy co-deployed with each service that handles
  mTLS, retries, timeouts, and observability transparently — layered-system done at
  microservice granularity.
- **Shared vs private caches** — a *shared* (proxy/CDN) cache serves many users and must
  respect `Cache-Control: public` + `Vary`; a *private* (browser) cache is per-user and
  may store `private` responses.

The **security-boundary** angle is the senior point: layering lets you concentrate
cross-cutting policy (auth, rate limiting, WAF) at the edge, and statelessness is what
keeps every hop transparent to the client.

*"Client → CDN → gateway → service: which constraint permits this, and which makes it
transparent?"* → **Layered system** permits the intermediaries; **statelessness** (self-
contained requests) is what lets them route/cache without conversational context, keeping
them invisible to the client.

---

## Code-on-demand: modern examples

Beyond browser `<script>` (the dated example), name current uses so you don't sound
stuck in 2005:

- **WebAssembly (WASM)** modules the server ships for the client to execute.
- **Downloadable client-side validation rules** (a server-supplied ruleset the client runs
  before submitting).
- **Feature-flag / remote-config-driven behaviour** where the server ships logic/config
  that alters client behaviour at runtime.
- Historical: Java applets, Flash — the original code-on-demand, now obsolete.

The trade-off is unchanged: shipping executable code **reduces visibility** and expands
the client's security surface, which is why the constraint stays optional.

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
- RFC 6570 — *URI Template*. https://www.rfc-editor.org/rfc/rfc6570
- RFC 6906 — *The 'profile' Link Relation Type*. https://www.rfc-editor.org/rfc/rfc6906
- RFC 3986 — *Uniform Resource Identifier (URI): Generic Syntax*. https://www.rfc-editor.org/rfc/rfc3986
- Google API Improvement Proposals — AIP-121 (resource-oriented design), AIP-122
  (resource names), AIP-136 (custom methods). https://google.aip.dev/
- Zalando RESTful API Guidelines. https://opensource.zalando.com/restful-api-guidelines/
- Microsoft REST API Guidelines. https://github.com/microsoft/api-guidelines
- RFC 9457 — *Problem Details for HTTP APIs* (2023; obsoletes RFC 7807).
  https://www.rfc-editor.org/rfc/rfc9457
- Martin Fowler, "Richardson Maturity Model." https://martinfowler.com/articles/richardsonMaturityModel.html
- Leonard Richardson, "Justice Will Take Us Millions Of Intricate Moves" (QCon 2008 talk).
