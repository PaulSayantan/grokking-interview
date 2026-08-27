# Resource Modeling & URI Design

Resource modeling is the foundational discipline of REST API design: deciding **what things
your API exposes** and **how they are addressed**. In REST, the *resource* is the central
abstraction — any information that can be named (a document, a user, a collection of orders, a
computation result). A **URI** (Uniform Resource Identifier) is the stable name a client uses
to identify and locate that resource. Good resource modeling makes an API feel obvious; bad
modeling produces the RPC-over-HTTP mess (`/getUserData?action=delete`) that interviewers use
as a cautionary tale.

This guide is layered: each section opens with the beginner definition and why it matters,
moves through the intermediate trade-offs, and closes with the advanced gotchas an interviewer
probes. It stays at the **API-contract altitude** — the URIs and payloads a client actually
consumes — and is deliberately framework-agnostic (raw HTTP, JSON, OpenAPI), so nothing here
is tied to any particular server library.

**Anchor standards (memorize which RFC owns what):**

| Concern | Authority |
|---|---|
| Generic URI syntax (scheme, authority, path, query, fragment) | **RFC 3986** |
| URI Templates (e.g. `/users/{id}`) | **RFC 6570** |
| HTTP semantics — methods, status, target resource | **RFC 9110** (obsoletes 7230–7235) |
| Web Linking (`Link` header, relations) | **RFC 8288** |
| Problem Details for errors | **RFC 9457** (obsoletes 7807) |
| "Cool URIs don't change" | **W3C / Tim Berners-Lee** (1998) |

---

## Anatomy of a URI

**Beginner.** Before modeling resources you must know the parts of the address you are
designing. RFC 3986 defines the generic syntax:

```
     foo://user@example.com:8042/over/there?name=ferret#nose
     \_/   \______________/\_________/ \_________/ \__/
      |            |            |            |        |
    scheme     authority       path        query   fragment
```

- **scheme** (`https`) and **authority/host** (`api.example.com`) — *where* the API lives.
- **path** (`/v1/orders/42`) — the hierarchical identifier of the resource. This is what
  resource modeling primarily shapes.
- **query** (`?status=open&page=2`) — non-hierarchical parameters that refine or filter.
- **fragment** (`#section`) — client-side only; **never sent to the server**, so it cannot
  be used to select a resource server-side.

**Why it matters.** The path expresses *identity and hierarchy*; the query expresses
*parameters over an already-identified resource*. Confusing the two is the single most common
URI-design mistake.

> [!KEY-TAKEAWAY]
> The fragment (`#...`) is processed only by the client and is stripped before the request
> is sent. Anything the server must act on belongs in the path or query, never the fragment.

**Advanced.** Per RFC 3986 §6, the scheme and host are **case-insensitive** and should be
normalized to lowercase, but the **path is case-sensitive**. `%`-encoding lets you place
reserved characters in a segment (`/orders/a%2Fb` encodes a literal `/` inside one segment).
The `path` is a sequence of segments separated by `/`; empty segments and `.`/`..` have
special meaning during reference resolution.

---

## Resources as Nouns, Not Verbs

**Beginner.** A resource is a *thing*, so its URI should be a **noun**, and the *action* on
that thing is expressed by the **HTTP method** — not baked into the path. REST reuses HTTP's
uniform interface: `GET` reads, `POST` creates, `PUT`/`PATCH` update, `DELETE` removes.

```
# RPC-style (anti-pattern) — verbs in the URI, method carries no meaning
POST /createUser
POST /getUser?id=42
POST /deleteUser?id=42
POST /updateUserEmail

# Resource-oriented — one noun, method = verb
POST   /users            # create
GET    /users/42         # read
PATCH  /users/42         # partial update
DELETE /users/42         # delete
```

**Why it matters.** When the URI names a noun and the method names the action, the API becomes
predictable and leverages HTTP's built-in method *semantics*: `GET` is **safe** (no side
effects) and **cacheable**; `PUT`/`DELETE` are **idempotent**. Verb-in-URI designs throw all of
that away — a `POST /getUser` is neither safe nor cacheable, and intermediaries can't reason
about it.

**Intermediate.** The test: if you find yourself adding a verb to a path segment, ask "what
noun is this an action *on*?" `POST /activateUser/42` usually wants to be a state change on the
user resource — either `PATCH /users/42` with `{"status":"active"}`, or a sub-resource
`PUT /users/42/activation`.

> [!WARNING]
> Verbs in URIs (`/getX`, `/doY`) are the hallmark of RPC-over-HTTP, not REST. The method
> already says what to do; the path should only say *to what*.

**Advanced gotcha.** "Nouns only" is a strong default, **not an absolute law** — some
operations genuinely are not CRUD on a resource (`/search`, `/calculate-tax`). See
[Avoiding Verbs (and Pragmatic Action Exceptions)](#avoiding-verbs-and-pragmatic-action-exceptions).
The interviewer wants you to know the rule *and* when to break it deliberately.

---

## Collection vs Singleton Resources

**Beginner.** Two archetypes cover most URIs:

- **Collection resource** — a plural resource representing a set of items: `/orders`.
  `GET` lists, `POST` appends a new member.
- **Item (member) resource** — one element within a collection, addressed by id:
  `/orders/42`. `GET` reads it, `PUT`/`PATCH` update it, `DELETE` removes it.
- **Singleton resource** — a resource of which there is exactly **one** in its context, so it
  has **no id segment**: `/users/42/profile`, or a global `/config`. There is no collection to
  POST into; you `GET` and `PUT`/`PATCH` it directly.

```
GET    /orders            # list the collection
POST   /orders            # create a new order (server assigns id) -> 201 + Location
GET    /orders/42         # read one member
DELETE /orders/42         # delete one member

GET    /users/42/profile  # singleton sub-resource: no id, exactly one profile per user
PUT    /users/42/profile  # replace it
```

**Why it matters.** The collection/item split maps cleanly onto HTTP methods and status codes:
`POST /orders` returns **201 Created** with a `Location: /orders/42` header pointing at the new
member. That's the canonical create pattern.

**Intermediate — method semantics per type:**

| Request | Collection `/orders` | Item `/orders/42` | Singleton `/config` |
|---|---|---|---|
| `GET` | list members | read the member | read the singleton |
| `POST` | create member → 201 + `Location` | usually 405 | usually 405 |
| `PUT` | replace whole collection (rare) | replace the member | replace the singleton |
| `PATCH` | rare | partial update | partial update |
| `DELETE` | delete all (rare/dangerous) | delete member | delete singleton (if allowed) |

**Advanced gotchas.**
- `POST` to a **collection** creates a member; the *server* assigns the id. `PUT` to an
  **item** URI can create-or-replace *at a client-chosen id* (upsert), which is why `PUT` is
  idempotent and `POST` is not.
- Fetching a missing member is `404`; fetching an *empty collection* is `200` with an empty
  array `[]`, **not** `404` — the collection resource exists, it just has no members.
- Don't overload a singleton where a collection is meant: if a user can have multiple
  addresses, `/users/42/addresses` (collection) beats `/users/42/address` (singleton).

---

## Sub-resources and Relationships

**Beginner.** When one resource belongs to or is scoped by another, express that containment
with **nested path segments**:

```
GET  /users/42/orders          # orders belonging to user 42
GET  /users/42/orders/1001     # a specific order of that user
POST /users/42/orders          # create an order for user 42
```

The nesting communicates the relationship "this order belongs to this user" directly in the
address.

**Why it matters.** Nesting scopes a collection to a parent, which is both readable and often a
natural authorization boundary (user 42 can only see `/users/42/orders`).

**Intermediate — how deep to nest?** The widely-followed guideline is **at most one level of
nesting** — `/parents/{id}/children`. Beyond that, prefer a top-level resource with a filter:

```
# Awkward — deeply nested
GET /users/42/orders/1001/items/7/refunds

# Better — flatten once you can address the leaf directly
GET /order-items/7/refunds
GET /refunds?order-item=7
```

**Relationships that aren't containment.** For many-to-many links, model the *relationship*
itself as a resource when it carries data, or use a link sub-resource:

```
PUT    /users/42/roles/admin     # grant: idempotent association
DELETE /users/42/roles/admin     # revoke
GET    /users/42/roles           # list associations
```

**Advanced gotchas.**
- A resource that is only ever accessed through one parent (a *dependent*/composition) is a
  good nesting candidate. A resource with its own global identity that is merely *related*
  should usually be top-level and linked, not nested — otherwise the same order lives at two
  URIs (`/orders/1001` and `/users/42/orders/1001`), creating aliasing and cache-invalidation
  headaches.
- Deep nesting bakes the hierarchy into the URI; if the relationship changes, every client
  URI breaks. Flat + links is more evolvable.

> [!INTERVIEW]
> "How deep would you nest?" The strong answer: nest at most one level to show containment/
> scope, and once a child has a stable global id, expose it top-level and connect the two with
> links or a query filter rather than deep paths.

---

## Path vs Query Parameters

**Beginner.** A rule of thumb:

- **Path parameters** identify a *specific resource or hierarchy*: `/orders/42`,
  `/users/42/orders`. They are part of the resource's identity.
- **Query parameters** modify or refine a request against an *already-identified* resource —
  filtering, sorting, pagination, projection, search: `/orders?status=open&sort=-createdAt&page=2`.

```
GET /products/99                       # path: identifies the product
GET /products?category=books&page=2    # query: filters/pages the collection
```

**Why it matters.** Path segments express identity and hierarchy (and should be reasonably
stable and cacheable per-URI); query strings express *variations* of a query and naturally
represent optional, combinable parameters.

**Intermediate — decision heuristics:**

| Use a **path** parameter when… | Use a **query** parameter when… |
|---|---|
| It identifies a single resource (`/orders/42`) | It filters a collection (`?status=open`) |
| It is required to locate the thing | It is optional / has a default |
| It defines hierarchy (`/users/42/orders`) | It sorts / paginates (`?sort=name&page=3`) |
| Removing it changes *which* resource | It selects fields/format (`?fields=id,name`) |
| Values are enumerable identities | Values combine freely (`?a=1&b=2&c=3`) |

**Advanced gotchas.**
- **Caching:** the full URI including the query string is the cache key. `?sort=asc` and
  `?sort=desc` are distinct cache entries; a required identifier hidden in the query
  (`/order?id=42`) still works but obscures that it's a single-resource fetch and mixes
  identity with refinement.
- **Ordering & encoding:** query parameter order is not guaranteed significant, and repeated
  keys (`?tag=a&tag=b`) are a common way to pass lists — but the exact multi-value convention
  (repeat vs `tag=a,b`) is not standardized by RFC 3986, so **document it**.
- **Sensitive data:** query strings land in access logs, browser history, and `Referer`
  headers. Never put secrets or tokens in the query — use headers.
- A very long or complex filter that exceeds URL length limits (~2–8 KB in practice) is a
  reason some APIs offer a `POST /searches` "search resource" instead.

---

## Pluralization and Naming Conventions

**Beginner.** The dominant convention is **plural nouns for collections**, with the item
addressed by appending an id:

```
/orders        /orders/42
/users         /users/42
/products      /products/99
```

Consistency matters more than the specific choice, but plural-everywhere (`/orders`,
`/orders/42`) is the most common and reads naturally ("the order 42 within the orders
collection").

**Why it matters.** A predictable naming scheme means a client that has seen `/users/42` can
guess `/orders/1001` without reading docs. Mixing `/user/42` and `/orders` is jarring and
error-prone.

**Intermediate — the conventions checklist:**

- **Plural collections:** `/customers`, not `/customer`.
- **lowercase** path segments: `/user-profiles`, not `/UserProfiles`.
- **kebab-case** (hyphens) for multi-word segments — hyphens over underscores because
  underscores can be hidden by link underlines and are harder to read:
  `/purchase-orders`, not `/purchase_orders` or `/purchaseOrders`.
- **No file extensions** in the path for content type (`/orders/42`, not `/orders/42.json`);
  use the `Accept` header for content negotiation instead.
- **No trailing slash** on resource URIs (see the trailing-slash section).
- Verbs are for the few genuine action endpoints only.

> [!TIP]
> Use kebab-case for multi-word *path segments* but note that JSON *property* naming
> (`camelCase` vs `snake_case`) is a separate decision governed by your payload style guide,
> not URI conventions. Don't conflate the two.

**Advanced gotchas.**
- Singletons are singular by nature (`/users/42/profile`) — the plural rule is a *collection*
  rule, not a "make everything plural" rule.
- Uncountable/mass nouns (`/audio`, `/news`) don't pluralize; pick a sensible collection name
  and stay consistent.
- Once published, a collection name is part of your contract — renaming `/people` to `/users`
  breaks every client. Choose deliberately; slugs are stable identifiers.

---

## Hierarchy vs Flat Design

**Beginner.** You can model relationships two ways:

- **Hierarchical (nested):** `/users/42/orders/1001` — the path encodes the containment chain.
- **Flat:** `/orders/1001` (with the parent available as a field or link, and filtering via
  `/orders?user=42`).

**Why it matters.** Hierarchy is self-documenting and scopes/authorizes naturally, but it
couples the child's URI to its parent. Flat URIs are shorter, give each resource **one
canonical address**, and are more resilient to relationship changes.

**Intermediate — trade-offs:**

| | Hierarchical `/users/42/orders/1001` | Flat `/orders/1001` |
|---|---|---|
| Readability of relationship | High (explicit) | Needs a field/link |
| Canonical URI per resource | Risk of duplicates | One canonical URI |
| Scoped authorization | Natural | Enforce in handler |
| Resilience to model changes | Brittle (URI encodes hierarchy) | Robust |
| Deep-link ergonomics | Verbose | Concise |

**Common pattern — hybrid:** offer the nested collection for *listing/creating in context*
but keep a flat canonical URI for the *item*:

```
GET  /users/42/orders        # list within scope (nested)
POST /users/42/orders        # create within scope
GET  /orders/1001            # canonical item URI (flat)  <- the one you link to
```

**Advanced gotchas.**
- **Pick one canonical URI** per resource for cache keys, `Location` headers, `self` links,
  and ETags. If an order is reachable at two URIs, caches and clients can disagree about
  identity.
- Deeply hierarchical URIs (`/a/1/b/2/c/3/d/4`) are a smell: they bake many assumptions into
  the address and break when any level of the model changes. Flatten and link.

---

## Avoiding Verbs (and Pragmatic Action Exceptions)

**Beginner.** The default is nouns + HTTP methods (covered above). But some operations are
genuinely **not** CRUD on a resource — computations, searches, or complex state transitions
that don't map to a single method. For these, a **controller/action resource** (sometimes a
verb) is the pragmatic, widely-accepted exception.

```
POST /orders/42/cancel          # state transition that isn't a simple field update
POST /carts/7/checkout          # a process, not a CRUD op
POST /search                    # complex query with a body
POST /images/9/resize           # a computation producing a new representation
POST /users/42/password:reset   # action on a resource (colon style, per Google AIP)
```

**Why it matters.** Forcing every operation into pure CRUD can be more confusing than a clear
action. `POST /orders/42/cancel` communicates intent better than trying to model cancellation
as `PATCH /orders/42` with a magic status field that also triggers refunds, emails, etc.

**Intermediate — how to keep actions RESTful:**
- Use **`POST`** for actions (they're typically non-idempotent and have side effects).
- Scope the action under the resource it acts on: `/orders/42/cancel`, not `/cancelOrder`.
- Prefer modeling the *result* as a resource where natural: instead of `POST /orders/42/cancel`,
  some designs `POST /orders/42/cancellation` (create a cancellation sub-resource) so the
  action leaves an addressable record.
- Two well-known naming styles for actions: nested segment (`/resource/{id}/action`) and the
  Google AIP **custom-method colon** style (`/resource/{id}:action`).

**Advanced gotchas.**
- Actions break HTTP's uniform interface, so use them **sparingly and deliberately** — an API
  that is mostly actions has slid back into RPC.
- A "cancel" that is idempotent (cancelling an already-cancelled order is a no-op returning the
  same state) can be modeled as `PUT /orders/42/status` = `cancelled` to gain idempotency;
  choose based on whether repeat calls must be safe.

> [!INTERVIEW]
> Expect: "Isn't `POST /orders/42/cancel` un-RESTful?" Strong answer: pure REST prefers state
> transitions via representation updates, but pragmatic API design allows scoped action
> sub-resources for operations that aren't natural CRUD; the key is to keep them the exception,
> scope them under the owning resource, and use `POST`.

---

## Identifiers: Opaque IDs vs Slugs

**Beginner.** The id in `/orders/{id}` can be:

- **Opaque id** — a surrogate key the client treats as a meaningless token: an auto-increment
  integer (`/orders/42`), a UUID (`/orders/9f1c…`), or an encoded id.
- **Human-readable slug** — a readable string derived from the resource's name:
  `/articles/how-to-design-uris`.

**Why it matters.** IDs are part of the URI contract. Choosing well affects security,
enumerability, SEO, and how coupled clients become to your internals.

**Intermediate — trade-offs:**

| | Sequential integer | UUID / opaque | Slug |
|---|---|---|---|
| Guessable / enumerable | **Yes (risk)** | No | Partially |
| Leaks volume/business data | Yes (`/orders/1002`) | No | No |
| Human/SEO friendly | No | No | **Yes** |
| Stable if title changes | Yes | Yes | **No** (title edits break it) |
| Client-generatable | No | Yes | No |

**Advanced gotchas.**
- **Enumeration / BOLA:** sequential ids invite scraping and, combined with weak
  authorization, **Broken Object Level Authorization** — OWASP API Security **API1:2023**, the
  #1 API risk. Opaque/UUID ids reduce guessability, but they are **not an authorization
  control**: you must still check that the caller may access that object. Obscurity ≠ authz.
- **Slug mutability:** if a slug is derived from a mutable title, editing the title changes the
  URI and breaks links. Common fix: use an immutable id as the canonical key and treat the slug
  as decorative (`/articles/12345/how-to-design-uris`), redirecting or ignoring the slug part;
  or freeze the slug at creation and keep old slugs as redirects.
- **Opaqueness principle:** clients should treat ids as opaque and *not parse them*. If clients
  start depending on id structure (e.g. decoding a timestamp from it), you've created hidden
  coupling. Hypermedia (`self` links) reinforces opacity — the client follows the URI it was
  given rather than constructing it.

> [!WARNING]
> A UUID or random id is **obfuscation, not authorization**. OWASP API1:2023 (BOLA) requires an
> explicit per-object access check on every request regardless of how unguessable the id is.

---

## Trailing Slashes and Case Sensitivity

**Beginner.** Two subtle URI details that trip up real APIs:

- **Trailing slash:** `/orders` and `/orders/` are, per RFC 3986, **different URIs**. Most APIs
  standardize on **no trailing slash** for resources and either redirect or 404 the other form.
- **Case:** per RFC 3986, the **scheme and host are case-insensitive** (normalized to
  lowercase), but the **path is case-sensitive** — `/Orders/42` and `/orders/42` may be
  different resources. Convention is **all-lowercase paths** to avoid the ambiguity entirely.

**Why it matters.** Treating `/orders` and `/orders/` as the same when they are technically
different can cause duplicate cache entries, broken relative-link resolution, and inconsistent
routing.

**Intermediate — relative reference resolution (RFC 3986 §5).** The trailing slash changes how
relative links resolve, which matters for hypermedia:

```
Base: /orders/42       + relative "items"  ->  /orders/items     (42 is replaced!)
Base: /orders/42/      + relative "items"  ->  /orders/42/items  (appended)
```

That difference is exactly why trailing-slash discipline matters for HATEOAS clients resolving
relative URIs.

**Advanced gotchas / best practice.**
- **Choose one form and enforce it.** Common approaches: canonicalize by issuing a `301`
  redirect from the non-canonical form to the canonical one, or simply reject the other with
  `404`. Redirecting is friendlier to clients.
- **Lowercase everything in the path.** RFC 3986 §6.2.2.1 says only scheme/host may be
  case-normalized safely; a case-insensitive path requires *you* to normalize, and mixed case
  invites duplicate URIs. All-lowercase sidesteps it.
- Don't rely on clients preserving case or slashes — normalize server-side and be explicit in
  docs.

---

## URI Stability & Cool URIs

**Beginner.** URIs are a **long-lived contract**. Once a client, a bookmark, a search engine,
or another service references `/orders/42`, that URI should keep working. Tim Berners-Lee's 1998
W3C note **"Cool URIs don't change"** is the canonical statement: the only reason a URI should
change is that you decided to break it, and there's almost always a way to avoid that.

**Why it matters.** Breaking a URI breaks every client silently — no compiler catches it. URI
stability is a big part of why versioning, redirects, and careful naming exist.

**Intermediate — how to keep URIs stable:**
- **Don't encode volatile things in the path** — technology (`.php`), server names, org
  structure, or mutable titles. `/orders/42` outlives `/legacy-app/servlet/getOrder.do`.
- **Version deliberately** so evolution doesn't force churn: many teams put the version in the
  path (`/v1/orders`) or in a header/media type; either way the goal is that old URIs keep
  serving the old contract. (Full treatment lives in the *API Versioning & Evolution* topic.)
- **When you must move a resource, redirect.** `301 Moved Permanently` (or `308` to preserve
  the method/body) points old URIs at the new location so existing clients follow along.
- **Keep ids immutable and opaque** so the canonical URI never has to change when data changes.

**Advanced gotchas.**
- `301`/`302` change the method to `GET` on many legacy clients; use **`308 Permanent`** /
  **`307 Temporary`** when you must preserve the original method and body (e.g. redirecting a
  `POST`). This is codified in RFC 9110.
- A `Location` header on `201 Created` is itself a URI you're publishing — make it the
  canonical, stable one, not a nested/aliased form.
- Stability and evolution coexist via **additive change**: add new fields/resources without
  removing or repurposing old URIs, so clients that ignore what they don't understand keep
  working (the robustness/tolerant-reader principle).

> [!KEY-TAKEAWAY]
> Design URIs as if they'll be referenced for a decade. Keep them noun-based, lowercase,
> opaque-id-keyed, and free of volatile details — and when change is unavoidable, redirect
> rather than break.

---

## Percent-Encoding & Reserved Characters

**Beginner.** URIs are restricted to a small ASCII alphabet. To put any other byte in a URI
you **percent-encode** it: `%` followed by two hex digits of the UTF-8 byte(s). A space
becomes `%20`, `é` becomes `%C3%A9`.

**Intermediate — the RFC 3986 §2 character classes (memorize these):**

- **`unreserved`** — `A–Z a–z 0–9 - . _ ~`. Always safe literally; **never needs encoding**
  and should *not* be encoded gratuitously.
- **`gen-delims`** — `: / ? # [ ] @`. Separate the major URI components.
- **`sub-delims`** — `! $ & ' ( ) * + , ; =`. Reserved *within* a component for
  application-defined sub-syntax (e.g. query pairs, matrix params).
- **`pct-encoded`** — anything else must arrive as `%XX`.

"Reserved" means "has structural meaning where it appears." A reserved char that you want to
carry as *data* (not as a delimiter) must be percent-encoded so it isn't mistaken for the
delimiter.

**Advanced gotchas.**
- **A literal `/` inside one path segment must be `%2F`.** But per RFC 3986 §3.3, `%2F` is
  *not equivalent* to a real `/` — and many gateways/proxies either reject encoded slashes
  (Apache `AllowEncodedSlashes`, some CDNs return 404/400) or **decode them before routing**,
  which silently reintroduces a segment boundary. This is a real source of routing and
  security bugs (path traversal via double-decoding `%252F` → `%2F` → `/`). If an id legitimately
  contains `/` (a Git ref, a file path), the robust options are: encode and pray the gateway
  passes it through, encode the *whole* id as an opaque token (e.g. base64url), or restructure
  the id into sub-resource segments.
- **`+` means space only in `application/x-www-form-urlencoded`** (query strings and form
  bodies) — a form convention, *not* RFC 3986. In a **path** segment, `+` is a literal plus and
  a space must be `%20`. Candidates routinely assume `+`→space everywhere; decoding a path `+`
  as a space is a bug.
- Encode the *bytes*, not the characters: encode using UTF-8 (`ferret+café` → `caf%C3%A9`),
  and encode reserved chars that are data, but leave `unreserved` chars alone.

> [!WARNING]
> `%2F` ≠ `/` per RFC 3986, yet infrastructure frequently conflates them. Do not rely on an
> encoded slash surviving intact through gateways; design ids that don't need one.

---

## URI Normalization & Equivalence

**Beginner.** "Are these two URIs the same resource?" is answered by **normalization** — the
process (RFC 3986 §6) of reducing URIs to a canonical form so equivalent URIs compare equal.
It matters for cache keys, deduplication, `self`-link comparison, and deciding when to `301`.

**Intermediate — the equivalence ladder (cheapest → most assumptions):**

1. **Simple string comparison** — byte-for-byte; the safest, weakest test.
2. **Syntax-based normalization** (RFC 3986 §6.2.2), always safe:
   - **Case normalization** — scheme and host to lowercase; and in `pct-encoded` triplets the
     **hex digits are uppercased** (`%2f` → `%2F`). The percent sign stays, only `A–F` case is
     normalized.
   - **Percent-encoding normalization** — decode any `unreserved` char that was needlessly
     encoded (`%7E` → `~`).
   - **Path segment normalization** — run `remove_dot_segments`: resolve `.` and `..`
     (`/a/b/../c` → `/a/c`).
3. **Scheme-based normalization** (§6.2.3) — apply scheme defaults: drop the default port
   (`https://h:443/` → `https://h/`), an empty path becomes `/` for http(s).
4. **Protocol-based normalization** (§6.2.4) — requires knowing server behavior (e.g. a
   trailing slash redirecting); the most assumptions, least safe to apply blindly.

**Advanced gotchas.**
- The **path is still case-sensitive** — normalization does *not* lowercase it. `/Orders` and
  `/orders` are distinct even after full syntax normalization.
- Two URIs returning identical bytes are **not necessarily the same resource** — they may be
  independent representations that happen to match. Equivalence is about *identity*, not
  current content. If they *are* the same resource, advertise one canonical form (`301`,
  `Content-Location`, or `rel="canonical"`); if they're genuinely distinct, keep them separate.
- Caches key on the normalized request-target; inconsistent normalization between client and
  origin causes cache misses or, worse, cache poisoning.

---

## Internationalization: IRIs and Non-ASCII URIs

**Beginner.** RFC 3986 URIs are **ASCII only**. To support non-ASCII text you either
percent-encode the UTF-8 bytes, or you use an **IRI** (Internationalized Resource Identifier,
**RFC 3987**) which permits Unicode directly and defines a deterministic mapping back to a URI.

```
IRI:  https://api.example.com/cities/Cádiz
URI:  https://api.example.com/cities/C%C3%A1diz     # Cádiz → UTF-8 → percent-encoded
```

**Intermediate.**
- **Host names** can't be percent-encoded; internationalized domains use **IDNA/Punycode**
  (`münchen.example` → `xn--mnchen-3ya.example`).
- **Where does *locale* belong?** A localized *representation* (language of the response) is a
  **content-negotiation** concern, not resource identity. Prefer the **`Accept-Language`**
  request header and vary the cache with **`Vary: Accept-Language`**. Putting locale in the
  path (`/en-US/products`) or a query (`?lang=en`) makes the *same* product a *different*
  resource per language, multiplying URIs and fragmenting caches — acceptable for
  human-facing/SEO pages, questionable for a data API. A locale *subdomain* (`en.api.com`)
  similarly forks identity.

**Advanced gotchas.**
- If a non-ASCII identifier is unavoidable, normalize Unicode to **NFC** before encoding so two
  visually identical strings don't produce different byte sequences (and different URIs).
- Prevalent guidance (Google AIP-122, Azure) is to keep ids **DNS/ASCII-compatible and
  human-readable** — avoid gratuitous percent-encoding and UUIDs in user-facing URLs where a
  readable ASCII slug works.
- Locale-in-path breaks the "one canonical URI per resource" rule and complicates `self` links:
  which language's URI is canonical?

---

## URI Templates in Depth (RFC 6570)

**Beginner.** RFC 6570 defines **URI Templates** — strings with `{expressions}` that expand to
URIs given variable values. It's what OpenAPI path items, `Link` headers, and hypermedia
clients use to describe a *class* of URIs, not just the `{id}` shorthand.

**Intermediate — the operator levels.** The first character of an expression may be an
*operator* that controls how the value is joined:

| Op | Name | `{op var}` with `var=x, list=[a,b]` | Typical use |
|---|---|---|---|
| *(none)* | simple | `{var}` → `x` | plain substitution |
| `+` | reserved | `{+path}` → keeps `/`, `:` unencoded | inject a whole path |
| `#` | fragment | `{#var}` → `#x` | fragment |
| `.` | label | `{.var}` → `.x` | file extensions |
| `/` | path segment | `{/var}` → `/x` | append path segments |
| `;` | path-style / matrix | `{;var}` → `;var=x` | matrix params |
| `?` | form query | `{?var}` → `?var=x` | start a query string |
| `&` | query continuation | `{&var}` → `&var=x` | add to a query string |

**Modifiers:**
- **explode `*`** — expand a list/map into multiple pairs. `{?ids*}` with `ids=[1,2]`
  → `?ids=1&ids=2`; `{?filter*}` with a map → `?a=1&b=2`.
- **prefix `:n`** — take the first *n* characters. `{var:3}` with `var=value` → `val`.

```
Template:  /users/{id}/orders{?status,page}
Values:    id=42, status=open, page=2
Expands:   /users/42/orders?status=open&page=2
```

**Advanced.**
- A **templated** `Link` header (RFC 8288) sets `; templated` (via a link-template mechanism)
  so a hypermedia client knows to *fill* it rather than dereference it as-is. HAL and other
  hypermedia formats mark templated links explicitly.
- OpenAPI 3.1 `paths` keys are Level-1 templates (`/users/{id}`); query/matrix operators are
  *not* used there because query params are described separately under `parameters`.
- Templates are one-way for description; matching an incoming URI back to a template
  (reverse-templating) is a separate, harder problem your router solves.

---

## Matrix Parameters

**Beginner.** A **matrix parameter** attaches `;key=value` pairs to a *specific path segment*:
`/maps/color;lat=50;lng=20/tiles`. Tim Berners-Lee's original "matrix URIs" note introduced
them; RFC 3986 treats `;` and `=` as `sub-delims` inside a segment but assigns **no semantics**
— they are application-defined. RFC 6570's `{;var}` operator expands to this form.

**Intermediate — matrix vs query.** The key difference is **scope**: a query string applies to
the *whole* URI (one query per request), while a matrix param binds to *one segment*, so it
survives nesting and can differ per segment:

```
/books;lang=en/reviews;sort=recent     # each segment carries its own params
/books/reviews?lang=en&sort=recent      # ambiguous which segment lang applies to
```

**Advanced gotchas.**
- JAX-RS popularized `@MatrixParam`, but **most APIs avoid matrix params**: caching/proxy
  support is inconsistent, few clients build them, and the semantics aren't standardized. They
  shine only for genuinely *per-segment* parameters (map tiles, coordinate-scoped filters).
- They are not a substitute for the query string on collection filtering — use query for
  whole-request refinement.

---

## Composite and Compound Keys

**Beginner.** Some resources have a **multi-part natural key** — e.g. a shopping cart keyed by
`(country, sessionId)` or a book keyed by `(publisherId, bookId)`. You must decide how that
tuple appears in the URI.

**Intermediate — the options:**

```
# A) Hierarchical name (each component a segment) — Google AIP style
/publishers/{publisherId}/books/{bookId}
/shopping-carts/{country}/{sessionId}        # Zalando #241

# B) One opaque composite token (encode the tuple into a single id)
/books/{opaqueCompositeId}

# C) Independent components as query on search/create
/books?publisher=123&isbn=...
```

**Advanced gotchas.**
- **Multi-segment keys erode id opacity.** Once the "id" is spread across path segments, the
  id is no longer a single opaque token — clients start parsing and assembling it, and adding a
  *fourth* key component next year (a new segment) is a breaking URI change. That evolvability
  cost is the classic interview trap: "your PK is a 3-tuple; the team adds a 4th component —
  what did design A cost you?" Answer: every client that constructs the URI must change, and
  cached/bookmarked URIs break.
- **Encoding the tuple as one opaque token** (option B) preserves opacity and evolvability —
  you can change the key's internal structure without changing the URI *shape* — at the cost of
  human readability and the ability to browse the hierarchy.
- Google AIP hierarchical names (`publishers/123/books/456`) deliberately choose readability +
  hierarchy and accept that the name encodes structure; they mitigate churn by treating the
  full name as the contract and never reusing it.

---

## URL Length Limits, Search Resources, and the QUERY Method

**Beginner.** URIs aren't unbounded. Practical caps: legacy IE ~2 KB, Azure ~2083 chars, many
servers default to ~8 KB request-line/header limits; exceeding them yields **414 URI Too Long**
(RFC 9110). A big or sensitive filter can't always live in the query string.

**Intermediate — three ways to send a large/complex/sensitive query:**

| Approach | Safe? | Idempotent? | Cacheable? | Notes |
|---|---|---|---|---|
| `GET /orders?...` | yes | yes | **yes** | breaks at length limit; filter visible in logs |
| `POST /searches` (search resource) | no | no | not by default | body carries filter; may return a created search resource / results; loses GET caching |
| **`QUERY`** method (draft) | **yes** | **yes** | **yes** (keyed on method+URI+**body**) | GET-with-a-body done right |

**Advanced.**
- **`GET` with a body is a trap.** RFC 9110 doesn't forbid a GET body but says it has no defined
  semantics and many intermediaries drop or ignore it — do not rely on it.
- **`POST /searches`** is the long-standing pragmatic workaround: the criteria go in the body.
  Downside: `POST` is neither safe nor cacheable, so you forfeit HTTP caching and must document
  that this "creates" a search only nominally.
- The **HTTP `QUERY` method** (IETF httpbis `draft-ietf-httpbis-safe-method-w-body`, active
  through 2024–2025 — flag it as a *draft*, not yet an RFC) is designed to fix exactly this: a
  method that is **safe and idempotent** like GET but carries a request body, and whose response
  is **cacheable keyed on the request content** (method + URI + body). If asked "GET vs
  POST /search vs QUERY," the senior answer weighs caching and idempotency: GET when it fits,
  QUERY when standardized support arrives, POST /searches as today's fallback.

---

## Full vs Relative Resource Names

**Beginner.** When one service needs to reference another service's resource, a bare relative
path (`/books/456`) is ambiguous — relative to *which* API? Google AIP-122 distinguishes three
forms of a resource name.

**Intermediate.**

```
Relative name:  publishers/123/books/456
Full name:      //library.googleapis.com/publishers/123/books/456   # schemeless, adds authority
Resource URI:   https://library.googleapis.com/v1/publishers/123/books/456  # adds scheme + version
```

- **Relative name** — canonical *within* the service; used inside its own payloads.
- **Full resource name** — schemeless (`//host/...`); globally unambiguous across services.
- **Resource URI** — a full name plus scheme (and often API version) that you can dereference.

**Advanced gotchas.**
- **Version is excluded from resource *names*** because names must "persist version to version"
  — the identity of the book doesn't change when the API rolls from v1 to v2. Version is a
  transport/URI concern, not part of identity.
- Real-world analogue: **AWS ARNs** (`arn:aws:s3:::bucket/key`) are exactly this — a
  globally-unique, scheme-agnostic, cross-service resource name.
- Ties to hypermedia: a `self` link should carry the canonical dereferenceable form so a client
  never has to assemble it.

---

## Server-Assigned vs Client-Provided Identifiers

**Beginner.** Who picks the id — the server or the client? By default (AIP-133) the **server
assigns** ids on `POST` to a collection. But some designs let the **client provide** the id.

**Intermediate — the two models and their method mapping:**

```
# Server-assigned (default): POST, server returns the id
POST /books           -> 201 Created, Location: /books/AbC123

# Client-provided id via create-with-id (AIP-133) or PUT upsert (AIP-134)
PUT  /books/my-chosen-id   -> 201 (created) or 200 (replaced)  # idempotent upsert
POST /books  {"id":"my-chosen-id"}   # create-with-id semantics
```

**Advanced gotchas.**
- **Idempotency:** `PUT` to a client-chosen URI is idempotent — retrying a create-or-replace
  yields one resource. `POST` create is *not* idempotent (each call may create a duplicate),
  which is why the **`Idempotency-Key`** request header exists: the client sends a unique key,
  the server dedups retries. Client-chosen ids and `Idempotency-Key` are two answers to the
  same "safe retry of create" problem.
- **Collision handling:** with client-provided ids the server must define what happens on
  conflict — `PUT` replaces (upsert), while a strict `POST` create should return **409
  Conflict** if the id already exists.
- **Constraints:** user-provided ids must be documented and constrained — a common rule
  (AIP-122) is RFC-1034/1123 label syntax `^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`. Google **dropped
  its blanket anti-UUID stance in 2025**, so UUIDs are acceptable as ids again where readability
  isn't required.

---

## Aliases and self Pseudo-Identifiers

**Beginner.** An **alias** is a stable URI that resolves to a resource whose real id you don't
have to know: `/users/me`, `/orders/latest`, `/config/current`.

**Intermediate.**
- `users/me` (or a bare `/me`, `/self`) resolves to *the caller* — the server derives the
  identity from the **authentication token**, not from a path id.
- The rule: an alias *resolves*, but the response should carry the **canonical name** (its real
  `self` URI), so clients can cache and re-reference by identity.

**Advanced gotchas.**
- **Security angle (Zalando #228, BOLA):** using `me` instead of `/users/{myId}` means the
  caller's own id never appears in the URL, removing an IDOR surface — there's no id to tamper
  with, and the server can't be tricked into serving someone else's object by id-guessing.
- Don't let an alias *become* the canonical identity in stored links; persist the resolved
  canonical URI so a shared/bookmarked link doesn't silently point at "whoever is logged in."

---

## Nesting as an Authorization Boundary

**Beginner.** Nested URIs *look* scoped — `/users/42/orders/1001` reads like "order 1001 that
belongs to user 42." But the URI shape is only a hint; **the server must actually authorize the
whole chain.**

**Intermediate — the path-confusion IDOR.** Consider `GET /users/42/orders/1001` where order
1001 actually belongs to user 7. If the handler looks up order 1001 by id and ignores the `42`
in the path, it will happily return another user's order. Correct behavior: verify the
parent-child linkage *and* the caller's right to user 42, returning **404** (don't confirm
existence) or **403**.

**Advanced gotchas.**
- This maps to the top OWASP API risks: **API1:2023 Broken Object Level Authorization (BOLA)**
  (object access) and **API3:2023 Broken Object Property Level Authorization (BOPLA)** (over-
  exposing or accepting properties the caller shouldn't see/set). Nesting neither creates nor
  removes these — every segment that names an object needs an access check.
- Nesting *helps* the authorization story by making the scope explicit and enabling
  parent-scoped policies; it *hurts* if developers treat the path as trusted and skip the
  per-object check. Deep nests multiply the checks (each ancestor must be authorized), which is
  another reason to keep nesting shallow.

---

## Paginating Relationships

**Beginner.** A relationship endpoint (`/users/42/orders`) is a **collection** and must obey the
*same* pagination contract as a top-level collection. A sub-collection that returns an unbounded
array is a latency and memory time-bomb.

**Intermediate.**
- Apply cursor-based (opaque token) or offset/limit pagination, page metadata, and **`Link`
  header** relations `rel="next" | "prev" | "first" | "last"` (RFC 8288) — identically to
  top-level lists.
- Nested collections are often *more* prone to unboundedness (a user with 10 years of orders),
  so pagination and filtering are mandatory, not optional.

**Advanced.**
- The modeling rule: **relationship endpoints are collections**, so make them paginable,
  filterable, and sortable from day one — retrofitting pagination onto a shipped endpoint that
  returned a bare array is a breaking change (the response type changes from array to an
  envelope, or you must sneak in `Link` headers clients weren't reading).
- Cross-reference the *Pagination & Filtering* topic for the full cursor-vs-offset trade-off;
  the point here is that nesting doesn't exempt you from it.

---

## Custom Methods: Batch and Long-Running Operations

**Beginner.** Beyond the single-resource action (`POST /orders/42/cancel`), two more custom-
method shapes show up constantly and are worth modeling deliberately (Google AIP-136/231/233).

**Intermediate — the three action scopes + batch + async:**

```
# Resource-scoped custom method
POST /books/1:archive

# Collection-scoped custom method (operates on the collection)
POST /books:batchGet          # AIP-231: read many by id in one call
POST /books:batchCreate       # AIP-233: create many atomically

# Stateless / service-scoped method (no specific resource)
POST /v1:translateText
```

- **`GET` is allowed for a side-effect-free custom method** (a pure retrieval/computation);
  **`POST` for anything with side effects**. This mirrors safe-vs-unsafe method semantics.
- The colon `:` must be **disallowed inside resource ids** so `/books/1:archive` can't collide
  with a legitimately-colon-containing id. Naming is `verb` or `verbNoun`, no prepositions.

**Advanced — long-running operations (LRO).** When an action can't complete synchronously,
model the *operation itself* as a resource: return **`202 Accepted`** with a `Location`/body
pointing at an operation resource (`/operations/abc123`) the client polls (or subscribes to via
webhook). This turns "the work" into a first-class, addressable, cache-nothing resource with its
own status — far cleaner than holding a connection open or returning a fake `200`.

> [!INTERVIEW]
> "`POST /orders/42/cancel` vs `POST /orders/42:cancel` vs `PATCH` status?" Strong answer: all
> three are defensible; choose `PATCH {"status":"cancelled"}` if cancel is a pure idempotent
> state edit, a custom method (`:cancel` per AIP-136 or `/cancel` sub-segment) if it triggers
> side effects/workflow, and return `202` + an operation resource if it's long-running.

---

## Canonical URI Enforcement

**Beginner.** "Pick one canonical URI per resource" (from *Hierarchy vs Flat*) needs *mechanics*
to actually advertise which URI is canonical.

**Intermediate — the tools:**
- **`Content-Location` response header** — states the specific URI of the representation just
  returned. Useful after content negotiation (which variant you got) and when a `POST` returns
  the created/updated body.
- **`Link: <...>; rel="canonical"`** (RFC 6596) — declares the canonical URI for a resource
  reachable at several URIs (query-param variants, tracking params), so caches and crawlers
  coalesce them.
- **`self` link** in a hypermedia body — carries the canonical, dereferenceable form the client
  should store and reuse, reinforcing id opacity.

**Advanced.** These matter for **cache-key correctness**: if a resource is reachable at several
URIs but only one is canonical, advertising it lets shared caches and clients converge instead
of storing divergent entries. Contrast with a genuine *move* (use `301`/`308`), which is a
different action from *aliasing* (use `rel="canonical"`/`Content-Location`, keep both live).

---

## Location vs Content-Location

**Beginner.** Two similarly-named headers, different jobs (RFC 9110 §10.2.2, §8.7):

- **`Location`** — points at a *different* URI: where the newly created resource lives
  (`201 Created`) or where to go next (`3xx` redirect). It answers "where is the thing now?"
- **`Content-Location`** — the URI of the representation *in this very response body*. It
  answers "what is the canonical address of the bytes I just gave you?"

**Intermediate — the classic exchange:**

```
POST /orders                     -> 201 Created
                                    Location: /orders/42          # the new resource's URI

GET /orders?format=summary       -> 200 OK
                                    Content-Location: /orders/summary   # which representation this is
```

**Advanced gotchas.**
- When a `POST` action returns the *created/updated body*, set **both**: `Location` (where it
  lives) and optionally `Content-Location` (the URI of the enclosed representation) if they
  differ. Confusing the two — e.g. putting the new resource URI in `Content-Location` on a
  create — is a common interview trap.
- With content negotiation, `Content-Location` lets a client bookmark the *specific* negotiated
  variant (`/orders/42.en` vs `/orders/42`) even though it requested the generic URI.

---

## Well-Known URIs

**Beginner.** Some metadata isn't a normal resource in your model but must live at a *predictable*
address so clients can find it without being told. **RFC 8615** reserves the **`/.well-known/`**
path prefix for exactly this site-wide metadata.

**Intermediate — common well-known URIs:**

```
/.well-known/openid-configuration          # OpenID Connect discovery
/.well-known/oauth-authorization-server     # OAuth 2.0 AS metadata (RFC 8414)
/.well-known/security.txt                   # security contact (RFC 9116)
/.well-known/api-catalog                    # list of the org's APIs (RFC 9727)
```

**Advanced.** `/.well-known/api-catalog` (RFC 9727, 2025) is a modeling decision in its own
right: API *discovery* lives at a fixed, non-resource address rather than being shoehorned into
your resource hierarchy — the interview point is recognizing that discovery/metadata endpoints
are deliberately *outside* the normal noun space and standardized so clients don't guess.

---

## Common follow-up questions

- "Walk me through modeling an e-commerce API's URIs." Expect collections (`/orders`,
  `/products`), item URIs (`/orders/42`), one level of scoping (`/users/42/orders`), a flat
  canonical URI for each item, query params for filter/sort/paginate, and a couple of action
  endpoints (`/orders/42/cancel`) justified as non-CRUD exceptions.
- "Path or query for a required filter that's really an identity?" If it selects *the*
  resource, it's a path segment; if it refines a collection, it's a query param.
- "Integer, UUID, or slug ids?" Cover enumeration/BOLA risk of sequential ids, opacity of
  UUIDs (not an authz control), and slug mutability; typical answer = opaque immutable canonical
  id, optional decorative slug.
- "How do you avoid breaking clients when the model changes?" Flat canonical URIs + links,
  additive change, redirects (`301`/`308`), and deliberate versioning.
- "Is `POST /orders/42/cancel` RESTful?" It's a pragmatic action sub-resource; acceptable as
  a scoped exception, keep it rare and use `POST`.
- "Why not `/orders/42.json`?" Content type belongs in `Accept`/`Content-Type` negotiation,
  not the path; extensions couple the URI to a format.
- "Trailing slash — does it matter?" Yes; different URIs per RFC 3986. Canonicalize (usually
  no trailing slash) and redirect the other form.

## References

- **RFC 3986** — *Uniform Resource Identifier (URI): Generic Syntax* (Berners-Lee, Fielding,
  Masinter, 2005). Anatomy, reserved chars, normalization, case/slash rules, relative-reference
  resolution. <https://www.rfc-editor.org/rfc/rfc3986>
- **RFC 9110** — *HTTP Semantics* (2022; obsoletes 7230–7235). Method semantics (safe,
  idempotent, cacheable), status codes, target resource, `Location`, redirect codes 301/307/308.
  <https://www.rfc-editor.org/rfc/rfc9110>
- **RFC 6570** — *URI Template* (2012). The `{id}` templating notation. <https://www.rfc-editor.org/rfc/rfc6570>
- **RFC 8288** — *Web Linking* (2017). `Link` header and link relations for connecting resources.
  <https://www.rfc-editor.org/rfc/rfc8288>
- **RFC 9457** — *Problem Details for HTTP APIs* (2023; obsoletes 7807). Error representation.
  <https://www.rfc-editor.org/rfc/rfc9457>
- **RFC 3987** — *Internationalized Resource Identifiers (IRIs)* (2005). Unicode in
  identifiers; mapping IRI↔URI. <https://www.rfc-editor.org/rfc/rfc3987>
- **RFC 6596** — *The Canonical Link Relation* (`rel="canonical"`, 2012).
  <https://www.rfc-editor.org/rfc/rfc6596>
- **RFC 8615** — *Well-Known URIs* (`/.well-known/`, 2019). **RFC 9727** — *api-catalog*
  well-known URI (2025). <https://www.rfc-editor.org/rfc/rfc8615>
- **HTTP `QUERY` Method** — IETF httpbis `draft-ietf-httpbis-safe-method-w-body` (Internet-Draft,
  not yet an RFC): a safe, idempotent method carrying a request body, cacheable on content.
- **W3C / Tim Berners-Lee** — *Cool URIs don't change* (1998), and *Matrix URIs* note.
  <https://www.w3.org/Provider/Style/URI>
- **OWASP API Security Top 10 (2023)** — API3:2023 Broken Object Property Level Authorization
  (BOPLA). <https://owasp.org/API-Security/editions/2023/en/0x11-t10/>
- **Google AIP** — AIP-133/134 (create / create-with-id / upsert), AIP-231/233 (batch methods).
- **Zalando RESTful API Guidelines** — #129 kebab-case, #134 pluralize / singleton-as-collection,
  #143 identify via path, #145/147 nesting depth, #228 opaque ids & `self`, #241 compound keys.
  <https://opensource.zalando.com/restful-api-guidelines/>
- **OWASP API Security Top 10 (2023)** — API1:2023 Broken Object Level Authorization (BOLA).
  <https://owasp.org/API-Security/editions/2023/en/0x11-t10/>
- **Google API Improvement Proposals (AIP)** — AIP-122 (Resource names), AIP-136 (Custom
  methods / colon syntax). <https://google.aip.dev/>
- **Microsoft REST API Guidelines** — naming, collections, and URL conventions.
  <https://github.com/microsoft/api-guidelines>
