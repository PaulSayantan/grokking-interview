# Error Handling & Problem Details

When an API works, clients barely notice the response shape. When it fails, the
error contract becomes the most important part of the API: it drives retries,
alerting, user-facing messages, and the debugging session at 3 a.m. This topic
is about the **wire contract** for errors — the status code, the response body,
and the headers a client actually consumes — independent of any framework.

The strong interview signal is showing that you treat errors as a *designed,
versioned, machine-readable contract*, not an afterthought. The anchor standard
is **RFC 9457 — Problem Details for HTTP APIs** (published July 2023, which
**obsoletes RFC 7807**), layered on top of **RFC 9110 — HTTP Semantics** for
status-code meaning.

A mental model to carry throughout: **the HTTP status code is for the machine
(especially generic middleware, caches, and proxies), a stable application error
code is for the client's code, and the human-readable message is for the
developer or end user. Keep all three, and never conflate them.**

---

## The consistent error contract

**What it is.** A single, documented response shape that *every* error in the
API uses — the same media type, the same top-level fields, the same semantics —
regardless of which endpoint failed or what layer produced the error
(validation, auth, business logic, an upstream timeout, an unhandled crash).

**Why it matters.** Clients write error-handling code *once*. If `POST /orders`
returns `{"error": "..."}`, `GET /users/{id}` returns `{"message": "..."}`, and
the gateway returns bare HTML on a 502, the client must special-case every
endpoint and every failure origin. Inconsistency is the single most common
real-world API-error complaint.

**The three-part model.** A good error carries:

1. **A status code** (RFC 9110) — coarse, standardized, understood by every HTTP
   intermediary.
2. **A stable, machine-readable error code** — fine-grained, owned by your API,
   safe for clients to branch on.
3. **A human-readable message** — for logs and developers; *not* to be parsed.

**Gotcha — the "200 OK with error in body" anti-pattern.** Returning HTTP 200
and burying `{"success": false}` in the body breaks every generic tool: caches
cache the failure, monitoring counts it as success, and `fetch`/`curl` treat it
as fine. The status line must reflect the outcome.

> [!KEY-TAKEAWAY]
> One error shape, everywhere. Status code for intermediaries, stable error
> code for client logic, human message for humans. Make it part of your public,
> versioned contract and document it in OpenAPI.

---

## RFC 9457 problem details

**What it is.** RFC 9457 defines a standard JSON (and XML) object for carrying
machine-readable error details in an HTTP response body, using the media type
**`application/problem+json`** (or `application/problem+xml`). It **obsoletes
RFC 7807**; the object model is unchanged, so "7807-compatible" bodies remain
valid — 9457 mainly clarifies wording, registration, and guidance.

**The standard members** (all optional; a bare `{}` is technically a valid
problem):

| Member | Type | Meaning |
|---|---|---|
| `type` | string (URI) | Identifies the *problem type*. Should be a stable, dereferenceable URI with human-readable docs. Default is `"about:blank"`. |
| `title` | string | Short, human-readable summary of the problem type. Should not change per-occurrence. |
| `status` | number | The HTTP status code, duplicated in the body (advisory; the real status is on the response line). |
| `detail` | string | Human-readable explanation *specific to this occurrence*. |
| `instance` | string (URI) | Identifies the specific occurrence (e.g., `/orders/123/errors/abc`). |

**Example.**

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/insufficient-funds",
  "title": "Insufficient funds",
  "status": 403,
  "detail": "Your account balance is 30 but the transfer requires 50.",
  "instance": "/accounts/12345/transfers/abc-987",
  "balance": 30,
  "required": 50
}
```

**Extension members.** Any member beyond the five above (`balance`, `required`
above) is an **extension**. Extensions are how you carry structured, actionable
data. Consumers **must ignore extensions they don't recognize**, and extensions
should be defined by the problem `type`.

**Key semantics interviewers probe:**

- `type` is the primary identifier. Two problems with the same `type` are the
  same *kind* of problem. `"about:blank"` means "no semantics beyond the status
  code" and, when used, `title` should be the status phrase (e.g., "Not Found").
- `type` need not be resolvable, but **should** point to human docs when it is a
  real URI. Clients must not assume dereferencing it does anything.
- The body `status` is advisory/for debugging; if it disagrees with the response
  line, the **response line wins**.
- The media type `application/problem+json` lets clients (and generic tooling)
  detect a problem document without guessing from the body shape.

> [!WARNING]
> Do not put secrets, PII, or stack traces in `detail`. `detail` is
> human-readable but still crosses the wire to the client. It is for explaining
> *this* occurrence, not for dumping server internals.

---

## Machine-readable error codes vs human messages

**The distinction.** The HTTP status code is intentionally coarse (there are
only a few dozen). "Card declined", "card expired", and "insufficient funds" can
all be `402`/`403`. Clients that need to react differently need a **finer,
stable application error code** — a short symbolic token like
`"insufficient_funds"` or `"card_expired"`.

**Where it lives.** Two common encodings, both valid:

- As the problem `type` URI: `"type": "https://api.example.com/problems/card-expired"`.
- As an extension member, e.g. `"code": "card_expired"` (Stripe-style: a short
  string clients switch on).

**The contract rule that matters most:** the **code is stable; the message is
not**. Clients branch on `code`; they *display or log* `title`/`detail`. You can
reword, translate, or A/B-test the human message freely, but changing a code is
a breaking change.

```json
{
  "type": "https://api.example.com/problems/card-declined",
  "title": "Card declined",
  "status": 402,
  "code": "card_declined",
  "detail": "The card was declined by the issuing bank.",
  "docUrl": "https://docs.example.com/errors/card-declined"
}
```

**Gotchas:**

- **Never make clients parse the human string.** If a client greps `detail` for
  the word "expired", your next copy edit breaks them.
- **Codes should be enumerable and documented.** Publish the list; treat it like
  an enum in your API's public contract.
- **Namespacing.** For large APIs, namespace codes (`billing.card_expired`) or
  use full `type` URIs to avoid collisions across teams.

---

## Field-level validation errors

**The problem.** A `400 Bad Request` on a form submission that says only
"validation failed" is useless. Clients need to know *which fields* failed and
*why*, so they can highlight inputs and show inline messages.

**The pattern.** Return a single top-level problem (status `400`, or `422
Unprocessable Content` when the syntax is valid but semantics fail) with an
**extension array of per-field errors**:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Your request parameters didn't validate.",
  "status": 422,
  "errors": [
    { "detail": "must be a valid email address", "pointer": "#/email" },
    { "detail": "must be at least 8 characters", "pointer": "#/password" },
    { "detail": "unknown currency 'XYZ'",        "pointer": "#/order/currency" }
  ]
}
```

**Pointing at the offending field.** RFC 9457's appendix explicitly suggests an
`errors` extension array whose entries use a **JSON Pointer (RFC 6901)** in a
`pointer` member (for body fields) or a `parameter` name (for query/header
params). This mirrors the JSON:API convention (`source.pointer`).

**Design decisions interviewers probe:**

- **Return all field errors at once, not one at a time.** Fail-fast validation
  forces the client through many round-trips fixing one field per submit.
- **`400` vs `422`.** `400` = malformed request the server can't parse (bad
  JSON, wrong content type). `422 Unprocessable Content` = syntactically valid
  but semantically invalid (well-formed JSON, but `age` is `-5`). Both are
  defensible for validation; be consistent. (`422` is defined in RFC 9110.)
- **Keep the top-level status meaningful.** The response is still one HTTP error;
  the per-field details live in the body, not in the status line.

---

## Do not leak internals

**The rule.** Error responses must never expose server internals: stack traces,
exception class names, SQL fragments, file paths, framework versions, internal
hostnames/IPs, or dependency error text verbatim. This is both a security
concern (**OWASP API Security Top 10 2023 — API8:2023 Security Misconfiguration**
calls out verbose errors) and a contract-stability concern (clients that key off
a leaked exception name break when you refactor).

**What leaks and why it's dangerous:**

| Leak | Risk |
|---|---|
| Stack trace / class names | Reveals framework, versions, internal structure → targeted attacks. |
| SQL error text | Confirms injection surface; leaks schema/table names. |
| Internal hostnames/IPs | Maps internal topology for lateral movement. |
| Upstream error verbatim | Leaks third-party keys, internal URLs, PII. |
| "User not found" vs "wrong password" | **User enumeration** — let attackers discover valid accounts. |

**The pattern.** Catch everything at the edge. Map unexpected errors to a
generic `500` problem with a **correlation ID** (see below), log the full detail
server-side keyed by that ID, and return only the safe, generic body:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json

{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred. Contact support with the trace id.",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```

**Gotchas:**

- **Environment coupling.** Verbose errors in dev, generic in prod is common —
  but ensure the *contract* (fields clients rely on) is identical, or clients
  behave differently across environments.
- **Auth errors should be deliberately vague.** Return `401`/`404` uniformly to
  avoid confirming which resources or accounts exist.
- **Don't leak via timing or via which fields you echo back**, either.

---

## Mapping domain errors to status codes

**The task.** Your domain has errors like "order already shipped", "coupon
expired", "email already taken". You must map each to an HTTP status that a
generic client/intermediary interprets correctly, then add a fine-grained `code`
for the specifics.

**The 4xx vs 5xx line — the most important distinction:**

- **4xx = the client did something wrong.** The request as sent will not succeed
  if retried unchanged. The fix is on the client side.
- **5xx = the server failed.** The request may be valid; retrying (with backoff)
  might succeed. The fix is on the server side.

Getting this wrong wrecks operations: a validation bug returned as `500` pages
your on-call; an upstream outage returned as `400` hides a real incident and
tells clients "don't retry" when they should.

**Common domain-to-status mappings:**

| Domain situation | Status | Notes |
|---|---|---|
| Missing/malformed input | `400 Bad Request` | Can't parse or required field absent. |
| Not authenticated | `401 Unauthorized` | Must include `WWW-Authenticate` header. |
| Authenticated but not allowed | `403 Forbidden` | Identity known, permission denied. |
| Resource doesn't exist (or hidden) | `404 Not Found` | Also used to avoid leaking existence. |
| Method not allowed on resource | `405 Method Not Allowed` | Must include `Allow` header. |
| Can't produce requested representation | `406 Not Acceptable` | Content negotiation failure. |
| State conflict (already shipped, dup) | `409 Conflict` | Edit conflicts, optimistic-lock failures. |
| Resource gone permanently | `410 Gone` | Stronger than 404. |
| Precondition (If-Match) failed | `412 Precondition Failed` | Conditional-request/optimistic concurrency. |
| Payload too large | `413 Content Too Large` | |
| Unsupported media type | `415 Unsupported Media Type` | Wrong `Content-Type`. |
| Semantically invalid, syntactically OK | `422 Unprocessable Content` | Business-rule validation. |
| Rate limit exceeded | `429 Too Many Requests` | Should include `Retry-After`. |
| Unhandled server bug | `500 Internal Server Error` | Generic; log with trace id. |
| Feature/endpoint not built | `501 Not Implemented` | |
| Upstream returned garbage | `502 Bad Gateway` | Gateway/proxy semantics. |
| Down for maintenance / overloaded | `503 Service Unavailable` | Include `Retry-After`. |
| Upstream timed out | `504 Gateway Timeout` | |

**Gotchas interviewers probe:**

- **`401` vs `403`.** `401` = "I don't know who you are / your credentials are
  missing or invalid" and **requires** a `WWW-Authenticate` header. `403` = "I
  know who you are, and you still can't." Sending `403` when the token is missing
  is a classic mistake.
- **`400` vs `422`.** `422` is for well-formed requests that fail business rules;
  `400` is for requests the server can't even parse. Both live in RFC 9110 now.
- **`409` vs `412`.** `409 Conflict` is a general state conflict; `412
  Precondition Failed` is specifically for a failed conditional header
  (`If-Match`/`If-Unmodified-Since`), the standard optimistic-concurrency signal.
- **Don't invent 4xx codes for server faults** to keep your error budget green —
  that's dishonest telemetry.

---

## Idempotent error semantics

**Why errors and idempotency interact.** Clients retry on failures — especially
on `5xx`, timeouts, and network drops. The error contract must tell the client
**whether a retry is safe** and, for idempotent replays, **behave consistently**.

**Retry-safety by status class:**

- **`5xx` / timeouts / connection resets:** the outcome is *unknown*. The
  request may or may not have been applied. A safe client retries — ideally with
  an **idempotency key** so a duplicated create doesn't create two resources.
- **`4xx` (except `429`, `408`):** the request is broken; retrying unchanged is
  pointless and wrong. Don't retry.
- **`429 Too Many Requests` / `503`:** retry, but **only after** the
  `Retry-After` delay (or exponential backoff with jitter).

**Idempotency keys and error replay.** With an `Idempotency-Key` header, the
server records the first response. On replay:

- If the original **succeeded**, return the same stored success (don't re-run
  the side effect).
- If the original **failed with a client error (4xx)**, returning the same
  stored error is typical.
- A conflict on the *same key with a different request body* should return `422`
  or `409` — the key was reused for a different operation.

```http
POST /payments HTTP/1.1
Idempotency-Key: 9f2a...c7
Content-Type: application/json
...

# First attempt times out client-side; client retries with SAME key.
# Server recognizes the key, returns the ORIGINAL result — no double charge.
```

**Gotchas:**

- **Idempotent method ≠ safe to blindly retry with a new attempt.** `PUT` and
  `DELETE` are idempotent in *semantics* (repeating yields the same state), but a
  retried `DELETE` may return `404`/`410` the second time — the client should
  treat "already gone" as success, not failure.
- **`POST` is not idempotent** by default; that's exactly why creation endpoints
  need idempotency keys to make retries safe.
- **`Retry-After`** accepts either delay-seconds (`Retry-After: 120`) or an
  HTTP-date. Honor it; don't hammer.

> [!INTERVIEW]
> A favorite question: "A client's `POST /orders` times out. What should it do?"
> Strong answer: the outcome is unknown, so it must retry — but only safely, via
> an idempotency key the server deduplicates, and the API should have advertised
> that key mechanism as part of its error/reliability contract.

---

## Localization of error messages

**The core rule.** **Localize the human message, never the machine code.**
Clients branch on the stable `code`/`type`; the `title`/`detail` strings are the
only thing that should ever change per-locale.

**How locale is negotiated.** The client sends `Accept-Language`; the server
returns the best-matching translation and echoes `Content-Language`:

```http
POST /orders HTTP/1.1
Accept-Language: fr-CA, fr;q=0.9, en;q=0.5

HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
Content-Language: fr-CA

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Vos paramètres de requête ne sont pas valides.",
  "status": 422,
  "code": "validation_error",
  "errors": [ { "detail": "doit être une adresse courriel valide", "pointer": "#/email" } ]
}
```

**Two philosophies interviewers compare:**

- **Server localizes:** the API translates `detail`/`title` using
  `Accept-Language`. Simpler for thin clients; the server owns translations.
- **Client localizes:** the API returns only a stable `code` plus structured
  **parameters** (e.g., `{"code": "min_length", "params": {"min": 8}}`), and the
  *client* renders the localized message from its own message catalog. Best for
  rich UIs, offline apps, and full control of wording — but requires the client
  to maintain a message table.

The robust design does **both**: always send the stable `code` + params (so
clients *can* localize), and optionally send a server-localized `detail` as a
sensible fallback.

**Gotchas:**

- **Interpolation belongs in structured params, not baked strings** — otherwise
  clients can't re-localize or reformat numbers/dates per locale.
- **Fall back gracefully** to a default locale when `Accept-Language` has no
  match; don't 406 on a missing translation.
- **`Content-Language`** should reflect the language you actually returned so
  caches (keyed by `Vary: Accept-Language`) behave.

---

## Correlation and trace ids in errors

**What they are.** A **correlation ID** (a.k.a. request ID) is a unique
identifier for a single request as it flows through your system; a **trace ID**
(from distributed tracing) identifies an end-to-end trace across many services.
Putting one in every error response is what turns "it's broken" into a
one-minute log lookup.

**The standard: W3C Trace Context.** The `traceparent` header carries the trace
in a standard format: `version-traceid-spanid-flags`, e.g.
`00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`. `tracestate` carries
vendor-specific data. Many APIs also accept/return an `X-Request-Id` (or
`X-Correlation-Id`) header as a simpler request identifier.

**The pattern.**

1. Generate (or accept from the client/gateway) a correlation/trace ID at the
   edge.
2. Propagate it to every downstream call and attach it to every log line.
3. **Echo it back** — in a response header (`X-Request-Id` / `traceparent`)
   *and* as an extension member in the problem body (`traceId`) so it survives
   copy-paste into a bug report.

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json
X-Request-Id: req_01HX9...
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "Unexpected error. Quote the trace id to support.",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

**Why it's the safe place to be verbose.** The correlation ID is an opaque
random token — it leaks nothing — yet it lets support/engineering pull the full,
un-redacted server-side log for that exact request. It's the bridge between the
"don't leak internals" rule and "I still need to debug this."

**Gotchas:**

- **Put it in the body, not just a header.** Users copy JSON into tickets;
  headers get lost.
- **Accept an inbound ID** (from a gateway or client) instead of always
  minting a new one, so the whole chain shares one ID.
- **Don't reuse a predictable/sequential ID** that leaks request volume or lets
  clients guess other requests.

---

## The IANA problem types registry

**What it is.** RFC 9457 §4.2 (with §6 defining the process) establishes an IANA
registry, **"HTTP Problem Types"**, for *widely reusable* problem `type` URIs.
Its registration policy is **"Specification Required"** (RFC 8126 §4.6): you need
a stable, published specification and a designated-expert review — you cannot just
mint a public entry ad hoc.

**What's actually registered.** As of RFC 9457, the registry effectively contains
**one entry: `about:blank`** (§4.2.1), whose semantics are "no problem-type
information beyond the HTTP status code," with `title` set to the status phrase.
That is the *only* URI you should assume is universally understood.

**The senior takeaways interviewers probe:**

- **You do not register vendor-specific types.** Your `https://api.acme.com/problems/insufficient-funds`
  is a perfectly valid `type` — RFC 9457 explicitly wants you to use your own
  namespaced HTTPS URIs — but it lives in *your* documentation, **not** the IANA
  registry. The registry is for cross-organization, reusable problem semantics.
- **`type` is not a URL you must host.** It's an identifier; two problems with the
  same `type` are the same kind. Hosting docs there is *encouraged*, not required.
- **Registration is a governance signal**, not a runtime requirement: nothing in
  the wire protocol changes whether or not a `type` is registered.

---

## The type and instance members in depth

The `type` and `instance` members are the most under-used parts of a problem
document, and RFC 9457 §3.1.1 gives precise mechanics.

**`type` URI mechanics (§3.1.1):**

- A relative `type` URI is **resolved against the document's base URI** (per RFC
  3986). RFC 9457 **recommends absolute URIs** to avoid ambiguity when the body is
  copied, logged, or served from a different base.
- `type` **need not be dereferenceable**, but making it resolve to human docs is
  encouraged for tooling and developer experience.
- Equality of `type` is what defines "same kind of problem" — clients key their
  logic off it (or off a `code` extension), never off `title`/`detail`.

**`instance` — the occurrence URI:** `instance` identifies the **specific
occurrence** of the problem, not the type. Deepened uses:

- Make it a **dereferenceable occurrence URI** that hosts the logged error or
  trace for that one request (e.g., `/errors/2026/req_01HX9...`), so support can
  click straight through. It complements — and can encode — the correlation-ID
  pattern.
- Like `type`, a relative `instance` resolves against the document base URI.
- Because it can point at server-side detail, treat what it exposes with the same
  "don't leak internals" discipline as `detail`.

**Extension member naming rules (§3.2).** Extensions are how you carry structured
data, and RFC 9457 gives *recommendations* (SHOULD, not MUST) for their names: an
extension member name **SHOULD start with a letter** (`ALPHA`), **SHOULD comprise
only** `ALPHA` / `DIGIT` / `_` (so it serializes in non-JSON formats), and
**SHOULD be three characters or longer**. What *is* mandatory: unrecognized
extensions **MUST be ignored** by consumers, and extensions are **scoped to /
defined by the problem `type`** — the same extension name can mean different
things under different types.

**"Most relevant problem" rule (§3).** When a single request hits multiple
problems, RFC 9457 guidance is to surface the **single most relevant/urgent
problem** rather than an artificial aggregate — reserve multi-error bodies for
genuine batch/bulk semantics (below), not for "I found three things wrong with
one resource."

---

## Status-code nuances for errors

**The `422` origin gotcha.** `422 Unprocessable Content` is a favorite
"gotcha-correction" for interviewers. It was **originally** defined in **WebDAV
(RFC 4918 §11.2)**, but **RFC 9110 §15.5.21 now defines it as part of core HTTP
semantics** — RFC 9110 Appendix B.3 notes that status code 422 "has been added
because of its general applicability." So the crisp, current answer is: "422
originated in WebDAV but is today a first-class member of the base HTTP semantics
document (RFC 9110), not merely a WebDAV-only extension." If you want a status you
are certain even an older or minimal HTTP intermediary understands, `400` is the
safer floor.

**A four-way discrimination interviewers love** — bad JSON vs negative age vs
duplicate email vs stale `If-Match`:

| Situation | Status | Why |
|---|---|---|
| Body isn't valid JSON / wrong `Content-Type` | `400 Bad Request` | Server can't even parse the request. |
| Valid JSON, `age: -5` breaks a business rule | `422 Unprocessable Content` | Syntactically fine, semantically invalid. |
| `email` already registered (unique constraint) | `409 Conflict` | Conflicts with current resource state. |
| `If-Match` ETag no longer matches | `412 Precondition Failed` | A conditional header precondition failed. |

**`409` vs `412` retry-ability.** A `409`/optimistic-concurrency `ABORTED`
conflict is **retryable after the client re-fetches** and rebuilds its update on
fresh state; a `412 Precondition Failed` is generally **not** retryable until the
underlying state changes and the client obtains a new validator (ETag). Both mean
"your view of the world is stale," but they differ in *how* the client recovers.

---

## Batch and bulk error semantics

Single-item error contracts don't answer the hardest design question in this
space: **what happens when one request operates on many items and some succeed
while others fail?** There is no single "right" answer — there is a trade-off you
must choose deliberately.

**Option A — all-or-nothing (transactional).** The whole batch commits or none of
it does. On any failure return a normal single error (e.g., `422`) identifying the
offending item(s); nothing was applied, so a corrected retry is clean. Simpler
mental model, but one bad row fails 999 good ones.

**Option B — best-effort (partial success).** Apply what you can and report
per-item outcomes. Two common wire shapes:

- **`207 Multi-Status` (RFC 4918 §11.1, §13).** A WebDAV status meaning "I
  processed the request; the *real* outcomes are inside." The **top-level `207`
  carries no aggregate success/failure signal** — a client must read each entry's
  own `status`. The classic footgun: treating `207` as "success" and ignoring the
  body.
- **A `200`/`207` body with a per-item results array**, each entry carrying its
  own status and (on failure) an embedded problem document:

  ```json
  {
    "results": [
      { "index": 0, "status": 201, "id": "ord_1" },
      { "index": 1, "status": 422,
        "problem": { "type": ".../validation-error", "title": "...",
                     "detail": "currency 'XYZ' unknown" } },
      { "index": 2, "status": 201, "id": "ord_3" }
    ]
  }
  ```

**The contrarian view (Google AIP-193).** Google's guidance is that APIs
**generally should NOT support partial errors** — partial success makes clients'
error handling ambiguous and hides failures. Prefer either transactional
semantics or a **long-running operation** whose metadata reports per-item failures
after the fact. Being able to argue *both* sides is the senior signal.

**Idempotency of the survivors.** If 997 of 1000 creates succeed and the client
retries the whole batch, the successful 997 must **not** be duplicated — this is
exactly where per-item idempotency keys (or a batch key) matter.

**Zalando Rule #152** codifies one common house style: **MUST use `207` for batch
or bulk requests** where individual parts can fail independently.

---

## gRPC canonical error model

Even a pure-REST engineer meets this model at gateways, gRPC-JSON transcoders, and
service meshes, so interviewers use it to test whether you understand error models
*beyond* HTTP.

**The shape: `google.rpc.Status`** — three fields: `code` (an integer from a fixed
enum of **16 canonical codes**), `message` (developer-facing, not for end users),
and `details[]` (a list of typed payloads such as `ErrorInfo`, `RetryInfo`,
`BadRequest`, `QuotaFailure`, `PreconditionFailure`, `Help`, `LocalizedMessage`).

**Canonical code → HTTP status mapping (the part people get quizzed on):**

| gRPC code | HTTP |
|---|---|
| `INVALID_ARGUMENT`, `FAILED_PRECONDITION`, `OUT_OF_RANGE` | 400 |
| `UNAUTHENTICATED` | 401 |
| `PERMISSION_DENIED` | 403 |
| `NOT_FOUND` | 404 |
| `ALREADY_EXISTS`, `ABORTED` | 409 |
| `RESOURCE_EXHAUSTED` | 429 |
| `CANCELLED` | 499 (client closed request) |
| `UNKNOWN`, `INTERNAL`, `DATA_LOSS` | 500 |
| `UNIMPLEMENTED` | 501 |
| `UNAVAILABLE` | 503 |
| `DEADLINE_EXCEEDED` | 504 |

**Subtle ones interviewers probe:** `INVALID_ARGUMENT` vs `FAILED_PRECONDITION` —
the former means the argument is wrong *regardless of system state*; the latter
means the argument is fine but the *system isn't in a state* to run it (retry
after fixing state). `499` ("client closed request") has **no RFC 9110 equivalent**
— it's an nginx/gRPC convention for "the caller went away before we answered,"
which is why it surfaces at gateways.

---

## GraphQL error model

GraphQL error handling is asked about constantly in 2025-era interviews precisely
because it **inverts** REST assumptions.

**The shape.** A top-level **`errors[]`** array (sibling to `data`), each entry
with `message`, `locations` (line/column in the query), `path` (which field
failed), and `extensions` — where a **`extensions.code`** string is the de facto
machine-readable code. Apollo's common catalog: `BAD_USER_INPUT`,
`GRAPHQL_VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`,
`INTERNAL_SERVER_ERROR`.

**The three inversions vs REST:**

1. **HTTP 200 even on errors.** Classic GraphQL-over-HTTP returns `200` and puts
   errors *in the body*, not the status line — the opposite of the REST rule that
   the status must reflect the outcome. Generic HTTP tooling (caches, dashboards)
   therefore can't see GraphQL failures.
2. **`data` and `errors` together = partial success.** A response can carry both:
   some fields resolved, others errored. There is no single "the request
   failed/succeeded" bit.
3. **Null propagation.** When a resolver throws, that field becomes `null` and the
   error is recorded; if the field is declared **non-null**, the error
   **propagates up to the nearest nullable parent**, potentially nulling a whole
   subtree. This is unique to GraphQL's type system and has no REST analog.

**The modern nuance.** The **GraphQL-over-HTTP spec** introduces the
`application/graphql-response+json` media type, under which a server **does**
return non-2xx status codes for *request-level* failures (malformed query, validation)
— narrowing the "always 200" gap. So the correct 2025 answer is "200 for
*field-level* execution errors under the legacy media type; non-200 is allowed for
*request-level* errors under `application/graphql-response+json`."

---

## Stable error codes at scale

Beyond a flat `code` string, two industrial patterns answer "how do 40+ teams
issue stable, non-colliding, machine-readable codes?"

**Google's `ErrorInfo` — the `(reason, domain, metadata)` triple.** A typed detail
carrying:

- **`reason`** — `UPPER_SNAKE_CASE`, ≤ 63 chars, unique **within a domain** (e.g.
  `STOCKOUT`, `API_KEY_INVALID`). This is the branch key.
- **`domain`** — the service identity that owns the reason (e.g.
  `pubsub.googleapis.com`). `(domain, reason)` together are globally unique, so
  teams never collide.
- **`metadata`** — dynamic key/value pairs (`{"service": "...", "sku": "123"}`).

The rule that mirrors this topic's whole thesis: **any request-specific value that
appears in the human `message` MUST also appear in `metadata`**, so clients extract
it structurally and **never parse the message string**.

**Error catalog / registry as a governance artifact.** Large orgs treat the set of
error codes as a **versioned enum in the public contract**: each code has an owner,
a documentation URL (often the `type` URI), and a **deprecation policy** — removing
or repurposing a code is a **breaking change**, exactly like removing a field.
Namespacing (`billing.card_expired`) or `(domain, reason)` prevents cross-team
collisions; a central registry prevents two teams from minting the same token with
different meanings. "How would you run error codes for 50 teams?" is a staff-level
probe whose answer is *governance*, not syntax.

---

## Custom error envelopes vs standard problem JSON

RFC 9457 is not the only game in town; several large APIs ship their own envelope.
Knowing *when each is right* is the design signal.

**The standard: `application/problem+json`.** Pros: a registered media type,
off-the-shelf tooling/interop, and it's what greenfield APIs and API guidelines
(e.g., Zalando Rule #176 "MUST support problem JSON") expect. Best default for new,
externally-consumed APIs.

**Custom envelopes** — worth recognizing by shape:

- **Microsoft / Azure:** `{ "error": { "code", "message", "target", "details": [],
  "innererror": { "code", "innererror": { ... } } } }`. Notable for **`target`**
  (which field/param) and a **recursively nested `innererror`** that gives
  progressively more specific, machine-readable codes as you drill down.
- **Stripe / Google / JSON:API** each have their own long-standing shapes that
  their SDKs and entire ecosystems already parse.

**When a custom envelope wins:** you have an established SDK/ecosystem where
consistency with existing responses beats standards-conformance, or you need
structure (like nested `innererror`) the problem model doesn't natively express.

**Coexistence / migration.** You can support both via **content negotiation** —
return `application/problem+json` when the client asks for it and your legacy
envelope otherwise — during a migration, but avoid shipping two live contracts
long-term.

---

## Modern rate-limit signalling

The doc's rate-limit coverage stops at `Retry-After`; senior candidates are
expected to know what's replacing the ad-hoc `X-RateLimit-*` triplet.

**The IETF `RateLimit` / `RateLimit-Policy` structured fields**
(`draft-ietf-httpapi-ratelimit-headers`, standards-track work as of 2026)
standardize quota signalling using **HTTP structured fields**:

- **`RateLimit-Policy`** advertises the policy: a window `w`, quota `q`, optional
  quota-unit `qu`, and partition key `pk`.
- **`RateLimit`** reports current state: remaining `r` and time-to-reset `t`.

This supersedes the non-standard `X-RateLimit-Limit` / `-Remaining` / `-Reset`
headers everyone reverse-engineered.

**The precedence rule interviewers probe:** on a `429`, if both `Retry-After` and a
`RateLimit` reset window are present, **`Retry-After` takes precedence** as the
authoritative "don't come back before this" instruction; the `RateLimit` fields are
informational about the window. Zalando Rule #153 similarly requires a `429` to
carry the headers a client needs to back off correctly.

---

## Retry semantics in depth

Extending the idempotency section with the precise, per-status retry contract:

- **`Retry-After` is not 429-only.** RFC 9110 allows `Retry-After` on **`503`**
  (server temporarily unavailable — *retry the whole request*), on **`429`** (*back
  off*), and even on **`3xx`** redirects to pace a client.
- **`503` vs `429` intent differs.** `503` = "the server as a whole is
  down/overloaded, retry the same request later." `429` = "*you specifically* are
  over quota, slow down." A client that treats them identically may hammer a
  recovering service or ignore a per-client limit.
- **`408 Request Timeout`** (the *server* gave up waiting for the request) is
  retryable — resend the request. Distinguish from `504 Gateway Timeout` (an
  *upstream* timed out), also retryable, and from a client-side socket timeout
  where the outcome is *unknown* (idempotency key territory).
- **Conflict retryability:** `409`/`ABORTED` optimistic-concurrency conflicts are
  retryable **after re-fetching** and rebasing the change; `412 Precondition
  Failed` is not retryable until the client holds a fresh validator.
- **The unknown-outcome case dominates:** any `5xx`, timeout, or connection reset
  leaves the result *indeterminate*, so a safe retry needs an idempotency key —
  the status code alone can't tell you whether the side effect happened.

---

## Security beyond leakage

The doc covers verbose-error leakage and user enumeration; senior interviews go
further into named attack classes.

**BOLA / BFLA (OWASP API1:2023 and API5:2023).** Error responses can leak
**authorization** facts. If `GET /accounts/{id}` returns `403 Forbidden` for an
object that exists but the caller can't see, and `404 Not Found` for one that
doesn't, an attacker can **probe object existence** by watching 403-vs-404 — a
**BOLA** enumeration channel. Mitigation mirrors Google's rule: **check permission
before existence** and return the **same response (typically `404`)** whether the
object is missing *or* forbidden, so the two are indistinguishable.

**When `404`-instead-of-`403` is correct — and when it's a bug.** Returning `404`
to hide existence from unauthorized callers is a legitimate security choice.
Returning `404` to a **legitimately authorized** user who hit a transient issue is
a bug that sends them chasing a nonexistent resource. The discriminator is *who is
asking*: hide existence from those with no right to know, be honest to those who do.

**Occurrence-link / `DebugInfo` leakage (RFC 9457 §5).** The spec warns that an
`instance`/occurrence link, or a gRPC `DebugInfo` detail, can inadvertently expose
stack traces and internal state — keep the same discipline there as in `detail`.

**Other channels:** **timing side-channels** (uniform-looking responses that differ
in latency still enumerate), and **error-message reflection / XSS** when `detail`
echoes unsanitized user input into an HTML-rendering client. Sanitize or avoid
echoing raw input into human strings.

---

## Content negotiation for error responses

Two negotiation nuances reinforce the media-type and i18n sections.

- **A server MAY return `application/problem+json` even if it's not in the client's
  `Accept`** (RFC 9457 §3 note). An error is an exceptional condition; forcing a
  `406` because the client only listed `Accept: application/json` would be
  unhelpful. Returning a problem document is generally the right thing.
- **Language negotiation still applies to errors** (§1): honor `Accept-Language`
  for the human `title`/`detail`, echo `Content-Language`, and set `Vary:
  Accept-Language` so caches don't cross-serve languages — but the machine `code`/
  `type` never varies by locale.

---

## Common follow-up questions

- "Why not just return 200 with an error flag?" It breaks caches, proxies,
  monitoring, and generic HTTP clients that key off the status line; the status
  code is the machine-readable outcome and must be honest.
- "What replaced RFC 7807?" RFC 9457 (July 2023) obsoletes 7807. The object
  model (`type`/`title`/`status`/`detail`/`instance` + extensions) is unchanged;
  9457 clarifies guidance and registration. `application/problem+json` is the
  media type.
- "400 or 422 for validation?" `400` for unparseable requests, `422` for
  well-formed-but-semantically-invalid. Pick one convention and be consistent.
- "401 or 403 when the token is missing?" `401` (with `WWW-Authenticate`).
  `403` is for an authenticated caller who lacks permission.
- "How do clients react differently to the same status?" Via the stable
  machine `code`/`type`, not by parsing the human message.
- "How do you make POST retries safe after a timeout?" Idempotency keys the
  server deduplicates; advertise the mechanism and the retry semantics.
- "How do you debug a production error without leaking internals?" Return a
  generic body plus a correlation/trace ID; keep the full detail in server logs
  keyed by that ID.
- "How do you localize errors?" Localize only the human strings via
  `Accept-Language`/`Content-Language`; keep stable codes + structured params so
  rich clients can localize themselves.

## References

- **RFC 9457 — Problem Details for HTTP APIs** (obsoletes RFC 7807), July 2023:
  https://www.rfc-editor.org/rfc/rfc9457
- **RFC 7807 — Problem Details for HTTP APIs** (obsoleted, historical):
  https://www.rfc-editor.org/rfc/rfc7807
- **RFC 9110 — HTTP Semantics** (status codes 4xx/5xx, `WWW-Authenticate`,
  `Allow`, `Retry-After`, 422): https://www.rfc-editor.org/rfc/rfc9110
- **RFC 6901 — JavaScript Object Notation (JSON) Pointer**:
  https://www.rfc-editor.org/rfc/rfc6901
- **RFC 4918 — HTTP Extensions for WebDAV** (207 Multi-Status §11.1/§13; origin of
  422 §11.2): https://www.rfc-editor.org/rfc/rfc4918
- **RFC 8126 — Guidelines for Writing an IANA Considerations Section** ("Specification
  Required" policy §4.6): https://www.rfc-editor.org/rfc/rfc8126
- **RFC 3986 — Uniform Resource Identifier (URI): Generic Syntax** (relative-URI
  resolution): https://www.rfc-editor.org/rfc/rfc3986
- **gRPC / google.rpc.Status & canonical codes**:
  https://grpc.github.io/grpc/core/md_doc_statuscodes.html and
  https://cloud.google.com/apis/design/errors (AIP-193 error model, ErrorInfo)
- **GraphQL spec — Errors** and **GraphQL-over-HTTP**
  (`application/graphql-response+json`): https://spec.graphql.org/ and
  https://graphql.github.io/graphql-over-http/draft/
- **IETF draft-ietf-httpapi-ratelimit-headers** (RateLimit / RateLimit-Policy
  structured fields): https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- **Zalando RESTful API Guidelines** (Rules #152 batch 207, #153 429 headers, #176
  problem JSON, #177 no stack traces): https://opensource.zalando.com/restful-api-guidelines/
- **OWASP API Security Top 10 (2023)** — API1:2023 BOLA, API5:2023 BFLA:
  https://owasp.org/API-Security/editions/2023/en/
- **RFC 8288 — Web Linking** (link relations in error/next-step guidance):
  https://www.rfc-editor.org/rfc/rfc8288
- **W3C Trace Context** (`traceparent`/`tracestate`):
  https://www.w3.org/TR/trace-context/
- **OWASP API Security Top 10 (2023)** — esp. API8:2023 Security
  Misconfiguration (verbose errors): https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/
- **JSON:API — Error Objects** (field-error conventions):
  https://jsonapi.org/format/#error-objects
- **MDN HTTP response status codes**:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
