# HTTP for APIs: Methods & Status Codes

HTTP is the wire contract of a REST API. The *method* tells the server what
kind of operation the client intends, and the *status code* tells the client
what happened in a way that generic HTTP infrastructure (browsers, caches,
proxies, gateways, retry libraries) understands **without reading your JSON**.
Getting these right is what makes an API predictable, cacheable, and safe to
retry. This document is grounded in **RFC 9110 (HTTP Semantics, June 2022)**,
which is the current, consolidated specification that obsoletes the old
RFC 7231 / 7230 series.

A mental model to carry throughout: **the method + status code are a promise
to intermediaries and clients.** When you label something `GET`, you promise it
has no side effects. When you return `201`, you promise a resource was created.
Breaking those promises breaks caching, retries, and every tool that trusts the
contract.

---

## HTTP method semantics per RFC 9110

RFC 9110 §9 defines a set of **request methods**, each with a defined meaning.
The method is the primary source of an operation's semantics — the URI names
the resource, the method says what to do to it.

| Method | Meaning | Request body? | Response body? |
|---|---|---|---|
| `GET` | Retrieve a representation of the target resource | No (no defined semantics) | Yes |
| `HEAD` | Same as GET but return headers only, no body | No | No (headers only) |
| `POST` | Process the enclosed data per the resource's own semantics | Yes | Usually |
| `PUT` | Replace the target resource with the enclosed representation | Yes | Optional |
| `PATCH` | Apply a partial modification (RFC 5789) | Yes | Optional |
| `DELETE` | Remove the target resource | Optional | Optional |
| `OPTIONS` | Describe the communication options for the target | No | Yes |
| `TRACE` | Loop-back test of the request path | No | Yes |
| `CONNECT` | Establish a tunnel (used by proxies) | — | — |

Key points interviewers probe:

- **Method names are case-sensitive and uppercase** (`GET`, not `get`).
- **`GET` bodies have no defined semantics.** RFC 9110 says a client SHOULD NOT
  generate content in a GET request; servers may reject it. Do not design an
  API that requires a request body on GET — use query parameters or a POST
  "search" endpoint instead.
- **`POST` is the catch-all.** Its semantics are "process this per the target
  resource's rules," which is why it is used for creation, complex actions,
  RPC-style operations, and anything that doesn't fit the other methods.
- The **method registry** is maintained by IANA; you can define custom methods,
  but in practice interviewers expect the standard set.

```http
GET /v1/orders/123 HTTP/1.1
Host: api.example.com
Accept: application/json
```

> [!KEY-TAKEAWAY]
> The URI identifies *what* resource; the method identifies *what to do* to it.
> Never encode the verb in the URI (`POST /orders/123/delete` is an
> anti-pattern — use `DELETE /orders/123`).

---

## Safe, idempotent, and cacheable methods

These three properties are the single most-tested concept in this topic, and
they are **independent**. RFC 9110 §9.2 defines them.

- **Safe (§9.2.1):** the method is essentially *read-only* — it does not request
  any state change on the server. Safe methods: `GET`, `HEAD`, `OPTIONS`,
  `TRACE`. Safe methods can be prefetched, followed by crawlers, and retried
  freely.
- **Idempotent (§9.2.2):** making the request **N times has the same effect on
  server state as making it once**. Idempotent methods: `GET`, `HEAD`,
  `OPTIONS`, `TRACE`, **`PUT`, `DELETE`**. This is about *server state*, not the
  *response* — `DELETE` twice may return `204` then `404`, but the resource is
  gone either way, so it is idempotent.
- **Cacheable (§9.2.3):** a response to the method may be stored and reused.
  Responses to `GET` and `HEAD` are cacheable by default; `POST` responses are
  cacheable **only** if explicitly marked with freshness info (e.g.
  `Cache-Control`, `Expires`) — rare in practice; `PUT`, `DELETE`, `PATCH` are
  not cacheable.

| Method | Safe | Idempotent | Cacheable |
|---|---|---|---|
| `GET` | ✅ | ✅ | ✅ |
| `HEAD` | ✅ | ✅ | ✅ |
| `OPTIONS` | ✅ | ✅ | ❌ |
| `TRACE` | ✅ | ✅ | ❌ |
| `PUT` | ❌ | ✅ | ❌ |
| `DELETE` | ❌ | ✅ | ❌ |
| `POST` | ❌ | ❌ | ⚠️ only if explicitly marked |
| `PATCH` | ❌ | ❌ | ❌ |

Why it matters:

- **All safe methods are idempotent, but not all idempotent methods are safe.**
  `PUT` and `DELETE` change state (not safe) yet are idempotent.
- **Idempotency drives retry logic.** A client, proxy, or load balancer may
  automatically retry an idempotent request after a timeout because a duplicate
  is harmless. `POST` is *not* idempotent, so a naive retry can create two
  orders — this is why real-world payment/order APIs add an
  `Idempotency-Key` header to make POST safe to retry (covered in the
  idempotency topic).
- **`PATCH` is not idempotent in general.** A JSON Patch with an `add` to an
  array, or an `increment` operation, changes state each time. A *full-document*
  PUT-like PATCH can be idempotent, but the method itself carries no such
  guarantee, so infrastructure treats it as non-idempotent.

> [!WARNING]
> "Idempotent" is about the **effect on server state**, not about getting an
> identical response. `DELETE /x` returning `204` the first time and `404` the
> second is still idempotent — the end state (x is gone) is the same.

---

## GET and HEAD

**`GET`** retrieves a representation of a resource. It is safe, idempotent, and
cacheable — the backbone of a read API.

- Use query parameters for filtering/sorting/pagination
  (`GET /v1/orders?status=open&limit=20`), never a request body.
- A successful `GET` returns `200 OK` with the representation, or `404` if the
  resource doesn't exist.
- Support conditional GET with `If-None-Match` / `ETag` and
  `If-Modified-Since` to enable `304 Not Modified` responses (covered in the
  caching topic).

**`HEAD`** is identical to `GET` but the server **must not** return a message
body — only the headers it *would* have sent for a GET. Uses:

- Check existence / freshness cheaply (get `ETag`, `Last-Modified`,
  `Content-Length` without downloading the payload).
- Validate a cached copy or a large-file link before fetching.

```http
HEAD /v1/reports/2026-q2.pdf HTTP/1.1
Host: api.example.com

HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 5242880
ETag: "a1b2c3"
```

Interviewers like to note: a server that supports `GET` on a resource should
generally support `HEAD` on it too, and the headers returned by both must be
consistent.

---

## POST for creation and non-CRUD actions

`POST` means "process the enclosed representation according to the target
resource's semantics." It is the most flexible method and the correct choice
when nothing else fits.

Common uses:

- **Create a subordinate resource** by POSTing to a collection:
  `POST /v1/orders` creates a new order under the collection. The server
  assigns the identifier, so the client cannot use `PUT` (it doesn't know the
  URI yet).
- **Actions / RPC-ish operations** that aren't a clean resource mutation:
  `POST /v1/orders/123/refund`, `POST /v1/emails/send`. The action is modeled
  as a resource (a "controller" resource) that you POST to.
- **Complex or large queries** where filters won't fit in a URL or are
  sensitive: `POST /v1/search` with a JSON body (a pragmatic exception to
  "reads use GET").

```http
POST /v1/orders HTTP/1.1
Host: api.example.com
Content-Type: application/json

{ "sku": "ABC-1", "qty": 2 }

HTTP/1.1 201 Created
Location: /v1/orders/123
Content-Type: application/json

{ "id": 123, "sku": "ABC-1", "qty": 2, "status": "pending" }
```

`POST` is **neither safe nor idempotent**. Two identical POSTs to a collection
normally create two resources — which is why creation endpoints that must
tolerate client retries adopt an `Idempotency-Key`.

---

## PUT vs PATCH vs POST for updates and creates

This comparison is a guaranteed interview question. The distinction is about
*semantics*, not just "create vs update."

- **`PUT` = full replacement at a known URI.** The client sends the *complete*
  target representation; the server replaces the resource with it. If a field
  is omitted, PUT semantics say it should be removed/reset, not left untouched.
  `PUT` is **idempotent**: sending the same body twice leaves the same state.
- **`PATCH` = partial modification.** The body is a *set of changes* to apply,
  not a full resource. `PATCH` is **not guaranteed idempotent** and is **not
  safe**.
- **`POST` = server decides.** Used to create when the server assigns the URI,
  or for operations that don't map to replace/modify.

**PUT for creation ("upsert"):** `PUT /v1/users/alice` is valid when the client
controls the identifier (`alice`). If the resource doesn't exist, the server
MAY create it and return `201 Created`; if it existed and was replaced, return
`200`/`204`. This is why PUT is idempotent-create-friendly while POST-create is
not.

**PATCH payload formats** matter — `PATCH` bodies are not "just the changed
fields" by default; the format is negotiated:

| Format | Media type | Idea |
|---|---|---|
| JSON Merge Patch (RFC 7386) | `application/merge-patch+json` | Send changed fields; `null` deletes a member |
| JSON Patch (RFC 6902) | `application/json-patch+json` | Ordered array of ops: `add`/`remove`/`replace`/`move`/`test` |

```http
PATCH /v1/orders/123 HTTP/1.1
Content-Type: application/merge-patch+json

{ "status": "shipped", "coupon": null }   // sets status, deletes coupon
```

Decision guide:

| Situation | Method |
|---|---|
| Client sends the whole resource, knows the URI | `PUT` |
| Client sends only a few fields to change | `PATCH` |
| Server assigns the ID on create | `POST` to the collection |
| Idempotent retryable update needed | `PUT` (full) |
| Action that isn't a resource mutation | `POST` to an action resource |

> [!INTERVIEW]
> Classic trap: "Use PUT to update one field." A strict `PUT` replaces the
> *entire* resource, so omitting fields should clear them. If you only want to
> change one field, `PATCH` is the semantically correct method.

---

## DELETE semantics

`DELETE` removes the target resource. It is **not safe** but **is idempotent**.

- First `DELETE /v1/orders/123` → `200`/`204` (deleted).
- Second `DELETE /v1/orders/123` → often `404` (already gone). This is still
  idempotent: the end state is the same either way.
- Response codes: `204 No Content` when nothing to return, `200 OK` with a body
  describing the outcome, or `202 Accepted` if deletion is asynchronous
  (e.g. a background purge job).

Design notes:

- **Soft delete** (mark as deleted, keep the row) is an implementation choice;
  the HTTP contract can still return `204`. A subsequent `GET` typically returns
  `404` or `410 Gone`.
- Deleting a collection (`DELETE /v1/orders`) is usually disallowed — return
  `405 Method Not Allowed`.
- Do **not** use `GET` to trigger deletion (`GET /orders/123/delete`) — it
  violates the safe-method contract and can be triggered by crawlers/prefetch.

---

## OPTIONS, 405 Method Not Allowed, and the Allow header

**`OPTIONS`** asks the server what it can do with a resource. It is safe and
idempotent. The server responds with an `Allow` header listing the supported
methods. `OPTIONS *` (with `*` as the target) queries server-wide capabilities.

```http
OPTIONS /v1/orders/123 HTTP/1.1

HTTP/1.1 204 No Content
Allow: GET, HEAD, PUT, PATCH, DELETE, OPTIONS
```

`OPTIONS` is also the **CORS preflight** mechanism: browsers send an
`OPTIONS` request with `Access-Control-Request-Method` before certain
cross-origin calls, and the server answers with `Access-Control-Allow-*`
headers.

**`405 Method Not Allowed`** means the resource *exists* but the method is not
supported on it (e.g. `DELETE /v1/orders` when the collection is read-only).
RFC 9110 §15.5.6 **requires** a `405` response to include an `Allow` header
enumerating the methods that *are* allowed:

```http
POST /v1/reports/2026-q2 HTTP/1.1

HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD, OPTIONS
```

> [!WARNING]
> Omitting the `Allow` header on a `405` is a spec violation and a common review
> finding. Contrast `405` (resource exists, wrong method) with `404` (resource
> doesn't exist) and `501 Not Implemented` (the server doesn't support the
> method *at all*, for any resource).

---

## Status code families 2xx to 5xx

RFC 9110 §15 groups status codes into five classes. The **first digit** carries
the primary meaning, and clients should be able to act on the class even if they
don't recognize the specific code.

| Class | Meaning | Client action |
|---|---|---|
| `1xx` Informational | Interim response, request received, continuing | Wait |
| `2xx` Success | Request understood and accepted | Proceed |
| `3xx` Redirection | Further action needed to complete | Follow / re-request |
| `4xx` Client error | The request is wrong; **don't blindly retry unchanged** | Fix the request |
| `5xx` Server error | The server failed on a valid request | Retry may help (esp. 503) |

The critical distinction is **4xx vs 5xx = whose fault is it.** A `4xx` says
"you, the client, sent something wrong — retrying the identical request won't
help." A `5xx` says "the server broke — the same request might succeed later."
This split drives retry policies, alerting (5xx spikes page the on-call; 4xx
spikes usually don't), and SLO error budgets.

> [!KEY-TAKEAWAY]
> Return the **most specific** status code that is accurate, but never a code
> whose *class* is wrong. Returning `200` with an `{"error": ...}` body (so
> called "200-always" APIs) is an anti-pattern: it breaks caches, monitoring,
> and every generic client that trusts the status line.

---

## Choosing 2xx: 200, 201, 202, 204 (and Location)

Picking the right success code communicates *what happened* precisely.

- **`200 OK`** — generic success with a representation in the body. Use for
  successful `GET`, and for `PUT`/`PATCH`/`POST` that return the updated/created
  entity in the body.
- **`201 Created`** — a new resource was created. **Return a `Location` header
  with the URI of the new resource** (RFC 9110 §15.3.2), and typically the
  representation in the body. Used mainly for `POST` to a collection, and for
  `PUT` that creates.
- **`202 Accepted`** — the request was accepted for **asynchronous** processing
  but is **not done yet**. The work may still fail. Commonly returns a link to a
  status/"operation" resource the client can poll. Use for long-running jobs,
  queued work, batch operations.
- **`204 No Content`** — success with **no response body**. Ideal for `DELETE`,
  and for `PUT`/`PATCH` when the client doesn't need the entity echoed back. A
  `204` must not include a body.

```http
POST /v1/orders HTTP/1.1

HTTP/1.1 201 Created
Location: https://api.example.com/v1/orders/123
```

```http
POST /v1/video-transcode HTTP/1.1

HTTP/1.1 202 Accepted
Location: /v1/operations/9f3   // poll this for progress
Content-Type: application/json

{ "status": "queued", "operationId": "9f3" }
```

Comparison of the two most-confused pairs:

- **201 vs 202:** `201` = created *and done now* (resource exists at
  `Location`). `202` = accepted, *maybe done later* (may still fail; nothing may
  exist yet).
- **200 vs 204:** both are success; `204` explicitly signals *there is no body
  to read*, so a client shouldn't try to parse one.

> [!INTERVIEW]
> "You POST to create an order and processing is synchronous and instant —
> which code?" → `201 Created` + `Location`. "Same but it kicks off a background
> workflow that can still fail?" → `202 Accepted` + a status resource.

---

## 3xx redirection

`3xx` codes tell the client the resource lives elsewhere or hasn't changed. For
APIs the relevant ones are:

- **`301 Moved Permanently`** — resource permanently relocated; update
  bookmarks/links. Clients/proxies may cache it.
- **`302 Found`** / **`307 Temporary Redirect`** — temporary relocation.
- **`308 Permanent Redirect`** — like 301 but **guarantees the method and body
  are preserved** on the redirect. `301`/`302` historically let clients change a
  `POST` into a `GET` on redirect, which is why `307`/`308` were introduced to
  preserve the original method.
- **`303 See Other`** — "go GET this other URI"; used after a POST to point the
  client at a result resource via GET.
- **`304 Not Modified`** — conditional-request response: the client's cached
  copy is still fresh (used with `ETag`/`If-None-Match`). No body is returned;
  the client reuses its cache. (Detailed in the caching topic.)

> [!TIP]
> For programmatic APIs, prefer `307`/`308` over `302`/`301` when the method
> must be preserved (e.g. redirecting a `POST`). `304` is not really
> "redirection" in spirit — it's the cache-validation success code.

---

## Client errors part 1: 400 vs 422

Both indicate the client sent something wrong, but at different layers.

- **`400 Bad Request`** — the server **cannot or will not process** the request
  due to a client error: malformed syntax, invalid JSON, a missing required
  parameter, a bad query string, a request too large, etc. It is the generic
  catch-all for "your request is broken."
- **`422 Unprocessable Content`** — the request was **syntactically valid**
  (well-formed JSON, correct content type) but **semantically wrong**:
  validation failed on the *meaning* (e.g. `age: -5`, `endDate` before
  `startDate`, a referenced ID that violates a business rule). Originally from
  WebDAV (RFC 4918) and now widely used by JSON APIs; renamed
  "Unprocessable Content" in RFC 9110.

```http
POST /v1/users HTTP/1.1
Content-Type: application/json

{ "email": "not-an-email", "age": -3 }

HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://example.com/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "errors": [
    { "field": "email", "detail": "must be a valid email" },
    { "field": "age", "detail": "must be >= 0" }
  ]
}
```

The pragmatic rule most teams use: **`400` for "I can't even parse/route this";
`422` for "I parsed it fine but the values are invalid."** Some APIs (and some
frameworks) use `400` for everything — that's acceptable and RFC-compliant, but
`422` gives clients a cleaner signal that syntax was fine and only validation
failed. Pick one convention and document it.

> [!WARNING]
> Don't return `422` for malformed JSON — if the body can't be parsed, it's a
> `400`. `422` presumes the server successfully understood the structure.

---

## Client errors part 2: 401 vs 403

The most-confused pair in API security. Both are `4xx`, both mean "you don't get
this," but for different reasons.

- **`401 Unauthorized`** — actually means **unauthenticated**. The request
  lacks valid credentials, or they expired/are invalid. RFC 9110 §15.5.2
  **requires** a `WWW-Authenticate` header telling the client how to
  authenticate. The client can retry *after* authenticating.
- **`403 Forbidden`** — the server **understood who you are** (or doesn't care
  about identity) and **refuses** to authorize the action. Re-authenticating
  won't help; the identity simply lacks permission. No `WWW-Authenticate`
  required.

```http
GET /v1/admin/users HTTP/1.1
Authorization: Bearer <expired-token>

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api", error="invalid_token"
```

```http
GET /v1/admin/users HTTP/1.1
Authorization: Bearer <valid-token-for-non-admin>

HTTP/1.1 403 Forbidden
```

Mnemonic: **401 = "who are you?" (authentication); 403 = "I know who you are,
and no" (authorization).**

> [!WARNING]
> Security nuance (OWASP): to avoid leaking *which* resources exist to
> unauthorized users (a form of enumeration / BOLA), some APIs deliberately
> return `404` instead of `403` for objects the caller isn't allowed to see, so
> attackers can't distinguish "exists but forbidden" from "doesn't exist." This
> is an intentional trade-off between correctness and information disclosure.

---

## Client errors part 3: 404 vs 409, and 429

- **`404 Not Found`** — the server has no resource at that URI (or hides its
  existence). Not necessarily permanent. Use `410 Gone` when you want to signal
  a resource *used to* exist and was intentionally removed.
- **`409 Conflict`** — the request conflicts with the **current state** of the
  resource. Classic uses: an optimistic-concurrency clash (the resource changed
  since the client's `ETag`; also expressible as `412 Precondition Failed`),
  trying to create a resource that already exists (duplicate unique key), or a
  state-machine violation (e.g. cancelling an already-shipped order). The
  response should explain how to resolve it.

```http
PUT /v1/orders/123 HTTP/1.1
If-Match: "old-etag"

HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{ "title": "Order was modified by another request; refetch and retry." }
```

- **`429 Too Many Requests`** — the client has sent too many requests in a
  window (rate limiting / throttling, RFC 6585). The response **should include a
  `Retry-After` header** (seconds, or an HTTP date) telling the client when to
  try again. Well-behaved clients back off and retry after that delay. Contrast
  with `503` (server overloaded/down) which also uses `Retry-After` but is a
  server-side condition, not a per-client quota.

```http
GET /v1/search?q=x HTTP/1.1

HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Remaining: 0
```

> [!INTERVIEW]
> "Two clients edit the same record concurrently — what status?" → `409
> Conflict` (or `412 Precondition Failed` if you used `If-Match`/`ETag`
> optimistic concurrency). "Client exceeded its quota?" → `429` + `Retry-After`.

---

## Server errors: 500 vs 502, 503, 504

`5xx` means the server failed to fulfill an apparently valid request. The
specific code tells operators and clients *where* it broke — critical when your
API sits behind a gateway/load balancer/proxy.

- **`500 Internal Server Error`** — generic, unexpected failure in the
  application (an unhandled exception, a bug). The catch-all when no more
  specific `5xx` applies. Never leak stack traces in the body.
- **`502 Bad Gateway`** — the server was acting as a **gateway/proxy** and got
  an **invalid response** from an upstream server. Typically your gateway
  reached your service but the service returned garbage or crashed the
  connection.
- **`503 Service Unavailable`** — the server is **temporarily unable** to handle
  the request: overloaded, down for maintenance, or shedding load. It is
  transient — include `Retry-After`. This is the "come back later" code.
- **`504 Gateway Timeout`** — the server, acting as a gateway/proxy, **did not
  get a timely response** from the upstream server. The upstream was too slow /
  unreachable.

| Code | Who failed | Typical cause |
|---|---|---|
| `500` | This service | Unhandled exception / bug |
| `502` | Upstream (bad response) | Backend crashed, returned malformed data |
| `503` | This service (temporarily) | Overload, maintenance, load shedding |
| `504` | Upstream (too slow) | Backend timeout, unreachable dependency |

Retry guidance: `503` and `504` are the most retry-worthy (transient); a naive
retry of `500` often just re-hits the same bug. `502`/`503`/`504` are the codes
you'll see emitted by load balancers (ALB, NGINX, API gateways) rather than your
app code.

> [!WARNING]
> Don't return `500` for a client's bad input — that's a `4xx`. A `500` spike
> should mean *your* code/infra broke, which is what pages the on-call.
> Misclassifying client errors as `5xx` poisons your error-rate SLOs and alerts.

---

## Conditional requests and optimistic concurrency: 304, 412, 428

Three status codes form the **conditional-request family**, and together they are
the mechanism behind optimistic concurrency ("preventing lost updates" / the
"mid-air collision" problem). RFC 9110 §13 defines conditional headers
(`If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since`).

- **`304 Not Modified`** — a *read* validation succeeded. Sent for a conditional
  `GET`/`HEAD` with `If-None-Match`/`If-Modified-Since` when the cached copy is
  still fresh. No body; the client reuses its cache. (Caching topic covers this.)
- **`412 Precondition Failed` (§15.5.13)** — a *write* precondition failed. The
  client sent `If-Match: "etag"` (or `If-Unmodified-Since`) and the current state
  no longer matches, so the server refuses the write to avoid clobbering someone
  else's change. This is the canonical optimistic-concurrency rejection.
- **`428 Precondition Required` (RFC 6585 §3)** — the server *forces* the client
  to make its request conditional. It rejects an unconditional `PUT`/`PATCH`/
  `DELETE` that has **no `If-Match`**, telling the client to GET the current
  representation (and its `ETag`), then retry with `If-Match`. This closes the
  "lost update" hole where a client that never sent a precondition overwrites
  blindly.

End-to-end lost-update prevention:

1. Client `GET`s the resource → receives `ETag: "v7"`.
2. Client `PUT`/`PATCH`es with `If-Match: "v7"`.
3. If the resource is still at `"v7"` → the write applies, new `ETag: "v8"`.
4. If another writer already moved it to `"v8"` → **`412 Precondition Failed`**;
   the client must refetch, reconcile, and retry.
5. To *require* step 2, an unconditional write returns **`428`**.

```http
PUT /v1/orders/123 HTTP/1.1
If-Match: "v7"

HTTP/1.1 412 Precondition Failed
```

> [!INTERVIEW]
> **409 vs 412 is a favorite trap.** `412` = a *precondition header* you sent
> (`If-Match`) evaluated false against current state. `409` = a state conflict
> when **no precondition was used** (duplicate key, illegal state transition).
> If your concurrency control is ETag-based, the mismatch is `412`; if it's a
> business-rule clash detected server-side, it's `409`. `428` is how the server
> mandates that clients use `If-Match` at all.

---

## 404 vs 410 Gone

Both say "there's nothing here," but they carry different **permanence and
lifecycle** semantics (RFC 9110 §15.5.5 and §15.5.11).

- **`404 Not Found`** — the server has no current representation and says
  **nothing about permanence or the past**. The resource may never have existed,
  may exist but be hidden (see the BOLA note under 401/403), or may return later.
  Not cacheable as "gone forever."
- **`410 Gone`** — the resource **existed and was intentionally, permanently
  removed**, and the server has no forwarding address. It is a stronger,
  deliberate signal: clients, search-engine crawlers, and integrators should
  **stop requesting it**. `410` is cacheable and is the correct code for
  sunsetting/deprecating an endpoint or a hard-deleted resource whose ID you want
  to actively discourage retrying.

Use `410` when you *know* the thing is gone for good and want to tell the
ecosystem to give up; use `404` when you either don't know or don't want to
disclose the history. On a **repeat `DELETE`**, either `404` (default) or `410`
(if you track tombstones) is defensible — both preserve idempotency because the
end state is "gone."

---

## TRACE, CONNECT, and HTTP method override

**`TRACE`** performs a loop-back diagnostic: the server echoes the received
request back to the client. It is safe and idempotent, but it is **disabled in
production almost everywhere** because it enables the **Cross-Site Tracing (XST)**
attack — an attacker can use `TRACE` to read otherwise-protected headers (cookies,
`Authorization`) reflected back, bypassing `HttpOnly`. OWASP guidance is to
disable it; servers typically return `405 Method Not Allowed` or `501 Not
Implemented`. Do not expose `TRACE` on an API.

**`CONNECT`** establishes a **TCP tunnel** through a forward proxy, used to carry
HTTPS (TLS) through the proxy. It is a proxy/transport primitive, **not an
application API method** — you never design a resource around `CONNECT`.

**HTTP method override** is an interop hack for clients, proxies, or firewalls
that only permit `GET`/`POST`: the real method is tunneled in a header
(`X-HTTP-Method-Override: DELETE`, `X-HTTP-Method`) or a form field (`_method`),
and the server rewrites the `POST` into the intended verb.

```http
POST /v1/orders/123 HTTP/1.1
X-HTTP-Method-Override: DELETE
```

> [!WARNING]
> Method override is a real **security risk** (OWASP **API8:2023 Security
> Misconfiguration**). WAF rules, gateway routing, and authorization checks that
> key off the *outer* HTTP method see a `POST` and may let a `DELETE`/`PUT` slip
> past controls that would have blocked it. If you must support override, apply
> authorization to the *effective* method and constrain which overrides are
> honored.

---

## Content negotiation errors: 406 and 415

Two distinct codes cover the two directions of content negotiation, and both are
frequently confused with `400` and `422`.

- **`415 Unsupported Media Type` (§15.5.16)** — the server refuses the request
  because the **request body's `Content-Type`** is one it can't process (e.g. the
  client sent `text/xml` but the endpoint only accepts `application/json`, or an
  unsupported `Content-Encoding`). It's about **what the client is sending**.
- **`406 Not Acceptable` (§15.5.7)** — the server **cannot produce a response**
  matching the client's `Accept`/`Accept-Language`/`Accept-Encoding` constraints
  (e.g. client demands `Accept: application/xml` but the API only emits JSON).
  It's about **what the client is willing to receive**. (Servers may instead just
  return their default representation; `406` is the strict-negotiation choice.)

Advertisement headers tell clients what a resource accepts:

- **`Accept-Patch` (RFC 5789 §3.1)** — lists the PATCH document formats a
  resource supports (e.g. `application/merge-patch+json, application/json-patch+json`).
- **`Accept-Post` (W3C LDP)** — lists the media types a resource accepts for
  `POST`.

> [!INTERVIEW]
> The **400 vs 415 vs 422 three-way split**: body **unparseable/syntactically
> broken** → `400`; body in a **media type the server doesn't handle** → `415`;
> body **parsed fine but the values fail validation** → `422`. And the negotiation
> mirror: server **can't emit what you asked for** → `406`.

---

## RFC 9457 Problem Details error bodies

**RFC 9457 (Problem Details for HTTP APIs, 2023; obsoletes RFC 7807)** defines the
standard, machine-readable error body so every API doesn't invent its own error
shape. Media type: **`application/problem+json`** (or `application/problem+xml`).

Standard members (all optional, but conventionally present):

- **`type`** — a URI identifying the problem *kind* (dereferenceable docs, ideally).
  Defaults to `"about:blank"` when absent, which means "use the status code."
- **`title`** — a short, human-readable, **type-stable** summary (should not vary
  per occurrence).
- **`status`** — the HTTP status code, duplicated in the body for convenience.
- **`detail`** — human-readable explanation **specific to this occurrence**.
- **`instance`** — a URI identifying this specific occurrence (e.g. the request/
  error id).
- **Extension members** — any additional fields (e.g. `errors: [...]` for
  per-field validation failures, `balance`, `retryAfter`). Consumers must ignore
  unknown members.

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "https://example.com/probs/out-of-credit",
  "title": "You do not have enough credit.",
  "status": 403,
  "detail": "Your balance is 30 but the cost is 50.",
  "instance": "/account/12345/msgs/abc",
  "balance": 30
}
```

The `status` in the body must match the real HTTP status line; the body is a
supplement to the status code, never a replacement for it.

---

## WWW-Authenticate challenges and Bearer token errors

A `401` must carry a **`WWW-Authenticate`** challenge (§15.5.2) — omitting it is a
spec violation. For OAuth 2.0 Bearer tokens, **RFC 6750 §3** defines standardized
`error` codes in the challenge that let a client tell *why* auth failed:

- **`invalid_request`** — the request is malformed (missing/duplicated
  parameters). Usually `400`, or `401` with the challenge.
- **`invalid_token`** — the token is expired, revoked, malformed, or otherwise
  invalid → **`401`** + `WWW-Authenticate: Bearer error="invalid_token"`. The
  client should refresh/re-authenticate and retry.
- **`insufficient_scope`** — the token is *valid* but lacks the scope/permission
  for this operation → **`403`** + `WWW-Authenticate: Bearer error="insufficient_scope", scope="..."`.
  Re-authenticating with the same grant won't help; the client needs a token with
  broader scope.

```http
GET /v1/admin/users HTTP/1.1
Authorization: Bearer <expired>

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api", error="invalid_token",
  error_description="The access token expired"
```

> [!INTERVIEW]
> "Expired token vs valid-but-no-scope vs no token?" → expired: `401` +
> `error="invalid_token"`; valid but missing scope: `403` +
> `error="insufficient_scope"`; no token at all: `401` + a bare
> `WWW-Authenticate: Bearer` challenge. The `insufficient_scope`/`403` pairing is
> the tell that separates authn from authz at the token layer.

---

## Expect: 100-continue and 417 Expectation Failed

The **`Expect: 100-continue`** handshake (§15.2.1) lets a client ask permission
before streaming a large body. The client sends the request **headers only** with
`Expect: 100-continue` and waits:

- Server willing → **`100 Continue`** (interim `1xx`); client then sends the body.
- Server can reject **early**, *before* the body is uploaded — e.g. `401`/`403`
  (unauthorized), `413 Content Too Large` (body would exceed limits), `405`, etc.
  This saves the client from uploading megabytes only to be rejected.
- **`417 Expectation Failed` (§15.5.18)** — the server (or an intermediary) cannot
  meet the `Expect` requirement. A client that gets `417` should retry without the
  `Expect` header.

This is a request-lifecycle optimization for big uploads; recognizing it signals
understanding beyond the happy path.

---

## Rate-limit signaling: RateLimit headers and 429 vs 403

`429` alone tells a client it's throttled *after the fact*; good APIs also expose
the **budget before it's exhausted**. Header conventions:

- **Legacy `X-RateLimit-*`** — the widespread de-facto convention:
  `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Non-standard,
  and reset is expressed inconsistently (epoch seconds vs delta).
- **IETF standard `RateLimit` / `RateLimit-Policy`** (draft-ietf-httpapi-ratelimit-
  headers, Standards Track) — structured fields: `RateLimit-Policy` advertises the
  quota policy (`q`=quota, `w`=window seconds, `pk`=partition key), and `RateLimit`
  reports current state (`r`=remaining, `t`=time-to-reset seconds). These are the
  forward-looking standard.
- **`Retry-After`** — on a `429` (or `503`), tells the client when to retry;
  accepts **either delta-seconds or an HTTP-date** (§10.2.3).

Status-code disambiguation:

- **`429`** = **per-client quota** exceeded (a `4xx` client concern).
- **`503`** = **server-wide** overload/maintenance (a `5xx` server condition).
- Some APIs (e.g. GitHub **secondary** rate limits, and various WAFs) return
  **`403`** for over-quota/abuse — non-ideal but seen in the wild.

Correct **consumer** behavior on `429`/`503`: honor `Retry-After` if present,
otherwise **exponential backoff with jitter** to avoid synchronized retry storms
(thundering herd).

---

## The QUERY method: a safe method with a body

The tension the doc raises — "`GET` bodies are undefined, but I need a large or
sensitive search payload" — has three answers, each with trade-offs:

1. **`POST /search` with a JSON body** — pragmatic and universal, but sacrifices
   **safety, idempotency, and cacheability**; intermediaries treat it as a
   mutation, so it can't be cached or auto-retried, and `POST` semantics don't
   advertise "this is a read."
2. **Body on `GET`** — RFC 9110 leaves it undefined; many servers/proxies drop or
   reject the body. **Don't.**
3. **The `QUERY` method** (draft-ietf-httpbis-safe-method-w-body) — a proposed
   Standards-Track method that is **safe and idempotent *and* carries a request
   body**. It's the standards answer: a read that can send a complex/large/
   sensitive filter, whose responses can be cached (keyed on method + URI + body).

`QUERY` is the "correct future" answer to complex search; mentioning it signals
you're current (2024/2025). Until it ships broadly, `POST /search` remains the
practical default, and you should know exactly what properties you're giving up by
choosing it.

---

## Long-running operations: 202, operation resources, and polling

For work that takes seconds-to-minutes, the mature pattern goes beyond "202 +
Location":

- **`202 Accepted`** — the request is queued; return a link to an **operation
  resource** (a first-class resource representing the async job) that the client
  can `GET` to poll.
- Polling the operation returns its state (`pending`/`running`/`succeeded`/
  `failed`), and can include **`Retry-After`** to pace the client's polling.
- On completion, the operation resource can **`303 See Other`** (or embed a link)
  to the finished result resource, which the client fetches with `GET`.

Cloud conventions:

- **Google AIP-151** — the LRO (Long-Running Operation) pattern: a standard
  `Operation` resource with `done`, `metadata`, `response`/`error`.
- **Microsoft REST Guidelines / Azure** — `202` + an **`Operation-Location`**
  header pointing at the status endpoint.

> [!INTERVIEW]
> "Design the response contract for a 5-minute job." → `202 Accepted` with a
> `Location`/`Operation-Location` to an operation resource → client polls it,
> honoring `Retry-After` → on success the operation points (e.g. `303`) at the
> result resource. Never block the connection for 5 minutes.

---

## The long tail of 4xx: 411, 413, 414, 421, 426, 431, 451

Knowing the catalog separates rote memorizers from people who reach for the exact
code:

- **`411 Length Required` (§15.5.12)** — the request needs a `Content-Length` and
  didn't send one (server won't accept chunked here).
- **`413 Content Too Large` (§15.5.14)** — the request body exceeds what the
  server will process (the answer to "a 20 MB payload"). Formerly "Payload Too
  Large." Maps to OWASP **API4:2023 Unrestricted Resource Consumption**.
- **`414 URI Too Long` (§15.5.15)** — the request-target/URI is longer than the
  server will interpret (the answer to "a 10 KB URL" — often the symptom of
  cramming a huge filter into a query string, i.e. use `POST`/`QUERY` instead).
- **`421 Misdirected Request` (§15.5.20)** — the request reached a server that
  can't produce a response for the target authority; arises with **HTTP/2
  connection coalescing** (a reused connection sent to the wrong virtual host).
- **`426 Upgrade Required` (§15.5.22)** — the server refuses over the current
  protocol and names a required upgrade in the `Upgrade` header (e.g. force TLS).
- **`431 Request Header Fields Too Large` (RFC 6585)** — headers (individually or
  in total) are too big (the answer to "a header bomb"; e.g. an oversized cookie).
- **`451 Unavailable For Legal Reasons` (RFC 7725)** — access denied for legal
  reasons (court order, censorship, GDPR/geo-blocking). The number nods to
  *Fahrenheit 451*.

> [!INTERVIEW]
> Rapid-fire: 20 MB body → **413**; 10 KB URL → **414**; header bomb → **431**;
> unsupported request `Content-Type` → **415**; can't produce the requested
> `Accept` → **406**; missing `Content-Length` → **411**.

---

## Range requests: 206 Partial Content and 416

For large files / media APIs, **range requests** (§14) let a client fetch a byte
range instead of the whole thing — the basis of resumable downloads and video
seeking.

- Server advertises support with **`Accept-Ranges: bytes`**.
- Client requests a range: `Range: bytes=0-1023`.
- **`206 Partial Content` (§15.3.7)** — success returning just that range, with a
  `Content-Range: bytes 0-1023/5242880` header.
- **`416 Range Not Satisfiable` (§15.5.17)** — the requested range is invalid
  (e.g. start beyond the resource size); the response may include
  `Content-Range: bytes */5242880` to state the actual length.

Ranges combine with conditional headers (`If-Range` with an `ETag`) so a resumed
download aborts cleanly if the resource changed mid-transfer.

---

## Batch operations and partial success: 207 Multi-Status

When a **bulk/batch** request half-succeeds (3 of 10 items fail), a single overall
status can't tell the truth. Two accepted approaches:

- **`207 Multi-Status` (WebDAV, RFC 4918)** — the response body carries a
  **per-item status** for each sub-operation, so the client sees exactly which
  succeeded and which failed. Zalando's guidelines, for instance, mandate
  `207` + `problem+json` semantics for batch endpoints.
- A **`200`/`202` envelope** with an application-defined array of per-item
  outcomes (each with its own status and error) — common when you don't want to
  adopt the WebDAV media semantics.

The key principle: **don't collapse mixed outcomes into a single misleading
2xx/4xx.** A `200` implies everything worked; a `400` implies nothing did. Partial
success needs a per-item report. (Whether the batch is atomic — all-or-nothing —
or best-effort is a separate design decision you must document.)

---

## PATCH atomicity and format advertisement

`PATCH` (RFC 5789) has operational rules that go beyond "send the changed fields":

- **Atomic / all-or-nothing (§2).** A server MUST apply the *entire* patch
  document or **none of it** — partial application is forbidden. If op 3 of 5
  fails, the server rolls back and the resource is unchanged.
- **Advertise supported formats** with **`Accept-Patch`** (RFC 5789 §3.1), so
  clients know whether to send `application/merge-patch+json`,
  `application/json-patch+json`, etc. A PATCH in an unsupported format → `415`.
- **JSON Patch `test` op → `409` on mismatch.** RFC 6902's `test` operation is a
  built-in precondition/concurrency guard: `{ "op": "test", "path": "/version",
  "value": 7 }`; if it fails, the whole patch fails (atomicity) and the server
  returns `409 Conflict` (or `412` if you framed it via `If-Match`).
- **JSON Merge Patch limitations (RFC 7386).** It can't set a member to a literal
  `null` (because `null` *means delete*), and it can't target individual array
  elements (arrays are replaced wholesale). For those, use JSON Patch.

> [!WARNING]
> A failed PATCH must leave the resource **exactly as it was**. "Applied 3 of 5
> ops then errored" is a bug — that's what atomicity forbids. Contrast this with a
> deliberately partial-success **batch** endpoint, which reports per-item outcomes
> via `207`.

---

## Non-idempotent retries and the Idempotency-Key header

The deep problem with retrying `POST`: a **network timeout is ambiguous** — the
client can't tell whether the server committed the operation and the *response*
was lost, or the request never landed. Blind at-least-once retries then risk
**duplicate side effects** (two charges, two orders).

The standardizing fix is an **`Idempotency-Key`** header
(draft-ietf-httpapi-idempotency-key-header): the client generates a unique key
(e.g. a UUID) per logical operation and sends it on the `POST`. The server:

1. First time it sees the key → process, and **store the response keyed by the
   Idempotency-Key**.
2. A **retry with the same key** → **replay the stored response** instead of
   re-executing (so the client gets the original `201` and no second order is
   created).
3. A **concurrent in-flight** request with the same key → typically **`409
   Conflict`** (the original is still processing).

This makes an inherently non-idempotent `POST` **retry-safe** without changing its
HTTP semantics. It's the concrete answer to "how do you safely retry a payment?"

---

## Custom methods and the colon-verb convention

Some operations aren't a clean CRUD verb (cancel, publish, archive, batchGet).
Rather than invent a new HTTP method or bury a verb in a path segment, **Google
AIP-136** sanctions **custom methods via colon syntax** on a `POST`:

```http
POST /v1/orders/123:cancel HTTP/1.1
POST /v1/documents/9:publish HTTP/1.1
```

The `:verb` is appended to the resource name, keeping the resource-oriented URL
while expressing an action that doesn't fit standard methods. This is the
sanctioned alternative to RPC-style `/orders/123/cancel` sub-resources or
`?action=cancel` query flags. Standard methods (List/Get/Create/Update/Delete →
`GET`/`GET`/`POST`/`PATCH`/`DELETE`) should always be preferred where they fit;
custom methods are the escape hatch, still tunneled over `POST` (occasionally
`GET` for safe custom methods).

---

## Common follow-up questions

- "Which HTTP methods are idempotent, and why does it matter for retries?"
  GET, HEAD, OPTIONS, TRACE, PUT, DELETE. Idempotency lets clients/proxies
  safely auto-retry after a timeout; POST/PATCH aren't idempotent, so they need
  an `Idempotency-Key` to be retry-safe.
- "Difference between PUT and PATCH?" PUT replaces the whole resource
  (idempotent, omitted fields cleared); PATCH applies a partial change (not
  guaranteed idempotent).
- "When 201 vs 202?" 201 = created and done (has `Location`); 202 = accepted
  for async processing, may still fail.
- "401 vs 403?" 401 = not authenticated (send `WWW-Authenticate`, can retry
  after auth); 403 = authenticated but not permitted.
- "400 vs 422?" 400 = malformed/unparseable request; 422 = well-formed but
  fails semantic/business validation.
- "404 vs 409?" 404 = no such resource; 409 = conflicts with current state
  (duplicate, concurrent edit, illegal state transition).
- "What must a 405 include?" An `Allow` header listing supported methods.
- "What must a 201 include?" A `Location` header pointing at the new
  resource.
- "500 vs 503?" 500 = unexpected bug in this service; 503 = temporary
  unavailability, include `Retry-After`, retry-worthy.
- "Is DELETE idempotent even though the second call returns 404?" Yes —
  idempotency is about resulting server state, not the response code.
- "Can GET have a body?" No defined semantics; don't design APIs that
  require it — use query params or a POST search endpoint.

## References

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
  (June 2022; obsoletes RFC 7230/7231) — methods (§9), safe/idempotent (§9.2),
  status codes (§15), `Allow`, `Location`, `WWW-Authenticate`, `Retry-After`.
- [RFC 5789 — PATCH Method for HTTP](https://www.rfc-editor.org/rfc/rfc5789.html)
- [RFC 6902 — JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html)
- [RFC 7386 — JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7386.html)
- [RFC 6585 — Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585.html)
  (429 Too Many Requests, 428, 431, 511)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
  (obsoletes 7807) — `application/problem+json` error bodies.
- [RFC 4918 — HTTP Extensions for WebDAV](https://www.rfc-editor.org/rfc/rfc4918.html)
  (origin of 422 Unprocessable Content).
- [MDN — HTTP request methods](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods)
  and [HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status).
- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x00-header/)
  — context for 401/403/404 disclosure trade-offs (BOLA/BFLA), method-override
  (API8), and resource-consumption limits (API4 → 413/429).
- [RFC 6750 — OAuth 2.0 Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750.html)
  §3 — `WWW-Authenticate: Bearer` error codes (`invalid_token`,
  `insufficient_scope`).
- [RFC 7725 — 451 Unavailable For Legal Reasons](https://www.rfc-editor.org/rfc/rfc7725.html).
- [QUERY method](https://datatracker.ietf.org/doc/draft-ietf-httpbis-safe-method-w-body/)
  (draft-ietf-httpbis-safe-method-w-body) — a safe, idempotent method with a body.
- [IETF RateLimit header fields](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
  and [Idempotency-Key header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/).
- [Google AIP](https://google.aip.dev/) — AIP-136 (custom methods / colon verbs),
  AIP-151 (long-running operations).
