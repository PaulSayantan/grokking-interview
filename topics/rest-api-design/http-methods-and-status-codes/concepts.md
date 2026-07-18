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

## Common follow-up questions

- **"Which HTTP methods are idempotent, and why does it matter for retries?"**
  GET, HEAD, OPTIONS, TRACE, PUT, DELETE. Idempotency lets clients/proxies
  safely auto-retry after a timeout; POST/PATCH aren't idempotent, so they need
  an `Idempotency-Key` to be retry-safe.
- **"Difference between PUT and PATCH?"** PUT replaces the whole resource
  (idempotent, omitted fields cleared); PATCH applies a partial change (not
  guaranteed idempotent).
- **"When 201 vs 202?"** 201 = created and done (has `Location`); 202 = accepted
  for async processing, may still fail.
- **"401 vs 403?"** 401 = not authenticated (send `WWW-Authenticate`, can retry
  after auth); 403 = authenticated but not permitted.
- **"400 vs 422?"** 400 = malformed/unparseable request; 422 = well-formed but
  fails semantic/business validation.
- **"404 vs 409?"** 404 = no such resource; 409 = conflicts with current state
  (duplicate, concurrent edit, illegal state transition).
- **"What must a 405 include?"** An `Allow` header listing supported methods.
- **"What must a 201 include?"** A `Location` header pointing at the new
  resource.
- **"500 vs 503?"** 500 = unexpected bug in this service; 503 = temporary
  unavailability, include `Retry-After`, retry-worthy.
- **"Is DELETE idempotent even though the second call returns 404?"** Yes —
  idempotency is about resulting server state, not the response code.
- **"Can GET have a body?"** No defined semantics; don't design APIs that
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
  — context for 401/403/404 disclosure trade-offs (BOLA/BFLA).
