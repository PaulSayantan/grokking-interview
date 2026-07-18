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

## Common follow-up questions

- **"Why not just return 200 with an error flag?"** It breaks caches, proxies,
  monitoring, and generic HTTP clients that key off the status line; the status
  code is the machine-readable outcome and must be honest.
- **"What replaced RFC 7807?"** RFC 9457 (July 2023) obsoletes 7807. The object
  model (`type`/`title`/`status`/`detail`/`instance` + extensions) is unchanged;
  9457 clarifies guidance and registration. `application/problem+json` is the
  media type.
- **"400 or 422 for validation?"** `400` for unparseable requests, `422` for
  well-formed-but-semantically-invalid. Pick one convention and be consistent.
- **"401 or 403 when the token is missing?"** `401` (with `WWW-Authenticate`).
  `403` is for an authenticated caller who lacks permission.
- **"How do clients react differently to the same status?"** Via the stable
  machine `code`/`type`, not by parsing the human message.
- **"How do you make POST retries safe after a timeout?"** Idempotency keys the
  server deduplicates; advertise the mechanism and the retry semantics.
- **"How do you debug a production error without leaking internals?"** Return a
  generic body plus a correlation/trace ID; keep the full detail in server logs
  keyed by that ID.
- **"How do you localize errors?"** Localize only the human strings via
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
