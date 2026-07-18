# Request Validation & Data Integrity

Every byte a client sends is untrusted until proven otherwise. Request
validation is the discipline of deciding — at the API contract boundary —
which requests are well-formed and meaningful enough to act on, and rejecting
the rest with a clear, machine-readable answer. It is simultaneously a
**correctness** concern (garbage in → garbage stored → corrupt state forever),
a **security** concern (injection, mass-assignment, resource-exhaustion), and a
**developer-experience** concern (a good 400/422 tells the client exactly what
to fix).

This document stays at the **HTTP/wire contract** altitude. It is
framework-agnostic: examples are raw requests/responses, JSON payloads, JSON
Schema, and OpenAPI — not any one framework's validation annotations. The
mental model to carry throughout:

> [!KEY-TAKEAWAY]
> Validate at the edge, but never *only* at the edge. Treat the payload shape,
> the field-level constraints, and the business rules as three different layers
> of checking — and never let the client dictate which fields it is allowed to
> write. Reject early, reject specifically, and never trust that a prior layer
> already validated.

---

## Why validate requests

**What it is.** Request validation means checking that an incoming request is
structurally parseable, conforms to the declared schema, satisfies field
constraints, and is semantically acceptable *before* your service acts on it.

**Why it matters.**

- **Data integrity.** An API is often the only gatekeeper between the outside
  world and your database. Once bad data is persisted (a negative price, a
  malformed email, a `quantity` of `"NaN"`), it can corrupt reports, break
  downstream consumers, and be expensive to unwind. Rejecting at ingress is
  orders of magnitude cheaper than repairing later.
- **Security.** The OWASP API Security Top 10 (2023) is dominated by failures
  that validation directly addresses: **API3:2023 Broken Object Property Level
  Authorization** (which includes mass assignment / excessive data exposure),
  **API8:2023 Security Misconfiguration**, and injection-class problems.
  Unvalidated input is the raw material for injection and resource-exhaustion
  attacks.
- **Robustness / fail-fast.** Validating up front means the rest of your code
  can assume clean inputs, which simplifies business logic and avoids
  half-completed operations.
- **Developer experience.** A precise validation error ("`email` is not a valid
  address", "`quantity` must be ≥ 1") lets the caller self-correct without
  reading your source or filing a ticket.

**The contract view.** From the client's perspective, validation defines the
*preconditions* of every operation. A well-documented API publishes those
preconditions (via OpenAPI/JSON Schema) so clients can validate locally, and
enforces them consistently so clients can rely on the error shape.

> [!INTERVIEW]
> A strong answer frames validation as **defense in depth**, not a single
> gate. Interviewers want to hear that you validate *and* that you don't assume
> the caller (or an upstream gateway) already did.

---

## Syntactic vs semantic validation

These are two distinct layers, and conflating them is a common interview trip-up.

- **Syntactic validation** checks *form*: Is the JSON well-formed? Is `age` a
  number rather than a string? Does `email` match an email grammar? Is
  `startDate` an RFC 3339 timestamp? Is the string ≤ 100 characters? These
  checks are **stateless** — they need only the request itself and a schema.
- **Semantic validation** checks *meaning in context*: Does that `userId`
  actually exist? Is the `couponCode` still valid today? Is `endDate` after
  `startDate`? Is the requested `quantity` ≤ current inventory? These checks are
  **stateful** — they need database lookups, business rules, or cross-field
  logic.

| Aspect | Syntactic | Semantic |
|---|---|---|
| Question answered | "Is it shaped correctly?" | "Does it make sense here?" |
| Needs external state? | No | Usually yes (DB, other services) |
| Where it runs best | Edge / schema layer | Domain / service layer |
| Typical failure code | `400 Bad Request` | `422 Unprocessable Content` or `409 Conflict` |
| Expressible in JSON Schema? | Mostly yes | Mostly no |

**Why the split matters.** Syntactic checks are cheap, universal, and can be
pushed to the edge (or even the client) via a published schema. Semantic checks
often can't run until you have the request in the domain layer with access to
state. Trying to encode "the coupon must not be expired" in JSON Schema is a
category error.

**Advanced gotcha.** Cross-field constraints (e.g., "`shippingAddress` required
only when `deliveryMethod == "ship"`") sit on the boundary. JSON Schema *can*
express many of these with `if/then/else`, `dependentRequired`, or
`dependentSchemas`, so they're arguably syntactic. But "the address must be a
real, deliverable address" is firmly semantic. Know where the line is.

---

## Sanitization vs validation

**Validation rejects; sanitization transforms.** They are not
interchangeable, and choosing sanitization where you need validation is a
classic security mistake.

- **Validation**: accept the input as-is if it satisfies the rules, otherwise
  **reject** the whole request with an error. The input the client sent is the
  input you process.
- **Sanitization**: **modify** the input to make it "safe" or canonical —
  trimming whitespace, stripping HTML tags, lowercasing an email, removing
  control characters. The input you process differs from what the client sent.

**Guidance for APIs.**

- **Prefer validation over sanitization for correctness.** Silently mutating a
  client's data violates the principle of least surprise and can mask bugs — if
  a client sends `"  1000 "` for an amount and you "helpfully" parse it as
  `1000`, you've hidden a client bug and may disagree with the client about what
  was stored.
- **Do context-specific *output* encoding, not input sanitization, for
  injection defense.** The correct defense against SQL injection is
  parameterized queries; against XSS it's output encoding at the point of use
  (HTML, JS, URL contexts differ). "Sanitizing" input by stripping `<script>`
  is fragile and famously bypassable. Store data faithfully; encode on output.
- **Canonicalization** (a form of sanitization) is legitimate and sometimes
  necessary — e.g., Unicode NFC normalization before a uniqueness check, or
  trimming trailing whitespace on a username — but do it **deliberately and
  document it**, and validate *after* canonicalizing.

> [!WARNING]
> Never rely on input sanitization (blocklists of "bad characters") as your
> primary injection defense. It is bypass-prone. Use parameterized
> queries/prepared statements and context-aware output encoding. Validation and
> allow-lists are supporting controls, not substitutes.

**Order of operations** when you do both: canonicalize/normalize → validate →
process. Validating before normalizing can let `admin ` (trailing space) or a
Unicode look-alike slip past a check that the normalized value would fail.

---

## Schema and constraint validation (JSON Schema)

**What it is.** A schema is a declarative, machine-readable description of a
valid payload: which fields exist, their types, and their constraints.
**JSON Schema** is the de-facto standard for JSON bodies, and **OpenAPI 3.1**
adopts JSON Schema (Draft 2020-12) as its schema dialect, so the schema you
document *is* the schema you can validate against.

A minimal JSON Schema for a "create user" body:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["email", "age"],
  "properties": {
    "email":    { "type": "string", "format": "email", "maxLength": 254 },
    "age":      { "type": "integer", "minimum": 0, "maximum": 130 },
    "nickname": { "type": "string", "minLength": 1, "maxLength": 40 }
  }
}
```

**Common constraint keywords.**

| Concern | Keywords |
|---|---|
| Type | `type`, `enum`, `const` |
| Numbers | `minimum`, `maximum`, `exclusiveMinimum`, `multipleOf` |
| Strings | `minLength`, `maxLength`, `pattern`, `format` |
| Arrays | `minItems`, `maxItems`, `uniqueItems`, `items`, `prefixItems` |
| Objects | `required`, `properties`, `additionalProperties`, `dependentRequired` |
| Composition | `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else` |

**Why schema-based validation wins.**

- **Single source of truth.** Design-first: the OpenAPI/JSON Schema doc drives
  documentation, client SDK generation, server request validation, and
  contract tests. Hand-written `if` checks drift from the docs.
- **Consistency.** The same schema produces the same accept/reject decision
  everywhere.

**Gotchas the interviewer probes.**

- **`format` is annotation-only by default.** In JSON Schema, `format`
  (`email`, `uri`, `date-time`, `uuid`, …) is *advisory* unless you enable
  format assertion in your validator. Don't assume `"format": "email"` rejects
  bad emails out of the box — you must turn on assertion or add a `pattern`.
- **`additionalProperties: false` is your over-posting guard** (see mass
  assignment below). Without it, unknown fields are silently allowed.
- **OpenAPI 3.0 vs 3.1.** 3.0 used a *modified subset* of JSON Schema (e.g.,
  `nullable: true`, single-type only). 3.1 aligns fully with JSON Schema
  2020-12 (use `type: ["string", "null"]` for nullable). Mixing them up is a
  common mistake.
- **`type: number` accepts floats;** if you need integers use `type: integer`,
  and remember JSON has no separate integer type on the wire — validators infer
  it, and `1.0` may or may not be accepted as an integer depending on the
  validator.

---

## Required vs optional fields

**The rule.** A field is *required* if the request is meaningless without it;
it is *optional* if the operation has a sensible default or the field is
genuinely additive. In JSON Schema, presence is controlled by the `required`
array — **not** by `properties`. Listing a property does not make it required.

**Nuances that trip people up.**

- **Required ≠ non-null ≠ non-empty.** These are three separate checks:
  - `required` — the key must be *present* in the object.
  - non-null — the value must not be JSON `null`.
  - non-empty — a string must have length > 0, an array `minItems ≥ 1`.
  A field can be required but nullable, or optional but non-nullable when present.
- **Absent vs `null` vs empty string** carry different meanings, and your API
  should decide and document them. This matters enormously for **PATCH**: with
  JSON Merge Patch (RFC 7396), `null` means "delete this field" while *omitting*
  the field means "leave it unchanged". Conflating "field missing" with "field
  = null" corrupts partial updates.
- **Required-ness differs by method.** On `POST` (create), `email` may be
  required; on `PATCH` (partial update), nearly everything is optional because
  the client sends only what changes. Don't reuse one schema blindly across
  create and update.
- **Defaults.** If an optional field has a server default, document it. Prefer
  applying the default server-side rather than forcing every client to send it.

```json
// Create: strict — email & age required
{ "required": ["email", "age"], "properties": { "...": {} } }

// PATCH: same fields, none required, but constrained when present
{ "required": [], "properties": { "...": {} }, "minProperties": 1 }
```

`minProperties: 1` on a PATCH body is a nice touch — it rejects an empty
`{}` update that would otherwise be a no-op the client didn't intend.

---

## Mass assignment and over-posting control

**The vulnerability.** *Mass assignment* (a.k.a. *over-posting*, *autobinding*)
happens when a server blindly binds every field in the request body to an
internal object's properties. A client sends an extra field the developer
didn't intend to be client-writable, and it gets persisted.

Classic example — the endpoint is meant to let a user edit their profile:

```http
PATCH /users/me HTTP/1.1
Content-Type: application/json

{ "displayName": "Alice", "role": "admin", "accountBalance": 1000000 }
```

If the server does `user.update(requestBody)`, the attacker just made
themselves an admin with a million-dollar balance. This is **OWASP API3:2023 –
Broken Object Property Level Authorization** (which merges the old "Mass
Assignment" and "Excessive Data Exposure" categories from 2019).

**Defenses — allow-list, never denylist.**

1. **Allow-list the writable fields (best).** Explicitly enumerate the
   properties a client may set for this operation and ignore/reject everything
   else. In JSON Schema this is `additionalProperties: false` plus a `properties`
   set that contains *only* client-writable fields.
2. **Use dedicated input DTOs / write models.** The type you bind the request
   to should contain only client-settable fields — not the full domain/DB
   entity. Server-controlled fields (`id`, `role`, `createdAt`, `ownerId`,
   `balance`) simply don't exist on the input model, so they can't be set.
3. **Reject vs ignore unknown fields.** Two valid policies:
   - **Reject** (`additionalProperties: false` → `400`): strict, catches client
     bugs and typos early. Downside: brittle across versions if you add fields.
   - **Ignore** (drop unknown fields silently): forgiving/forward-compatible.
     Downside: hides client typos (`emial` silently dropped). Many APIs ignore
     for read-compatibility but *never* auto-bind unknowns to the entity.

> [!WARNING]
> A denylist ("strip out `role` and `isAdmin`") is a losing game — you will
> forget a sensitive field, or a future refactor will add one. Allow-list the
> fields a client may write, and keep server-owned fields off the input model
> entirely.

**Advanced.** Field-level *authorization* is distinct from field-level
*validation*: even among writable fields, *which* fields a caller may set can
depend on their role (an admin may set `role`, a normal user may not). That's
authorization, enforced per-property, and the reason OWASP renamed the category
to "object property level authorization."

---

## Where to validate: edge vs domain

**The layers.** In a typical deployment a request passes through: client →
API gateway/reverse proxy → application edge (controller/router) → domain/
service layer → persistence. Validation can happen at several of these.

- **Edge / gateway validation.** Cheap, universal, syntactic: request size
  limits, content-type checks, JSON well-formedness, schema conformance,
  authentication. Rejecting malformed or oversized requests here protects
  everything downstream and sheds load early. Many gateways can validate the
  body against the OpenAPI schema.
- **Application edge (controller).** Schema + field-constraint validation on
  the parsed body; produce the field-level error response.
- **Domain / service layer.** Semantic and business-rule validation that needs
  state, plus **invariant enforcement**. This is where "the coupon is expired"
  or "insufficient inventory" is decided.

**The key principle: validate at the edge, enforce invariants in the domain.**

> [!KEY-TAKEAWAY]
> Edge validation is an *optimization and a UX feature* (fast, clear
> rejection); domain validation is the *correctness guarantee*. Never make the
> edge the *only* line of defense — internal callers, retries, other entry
> points, and future refactors can bypass it. Defense in depth: the domain must
> protect its own invariants regardless of what the edge did.

**Trade-offs.**

- **Duplication vs safety.** Validating in two places feels redundant, but the
  checks serve different masters (contract shape vs domain invariant) and often
  differ in detail. Share a schema where you can; don't share it where the
  concerns genuinely diverge.
- **Microservices.** In a service mesh, a request validated by service A may
  arrive at service B via an internal call. B must still validate its own
  inputs — "trusted network" is not a validation strategy (zero-trust).
- **Gateway offloading.** Pushing schema validation to the gateway centralizes
  it and protects backends, but couples deploys (schema changes must sync) and
  the gateway rarely has the state for semantic checks.

---

## 400 vs 422 for validation errors

This is one of the most-asked (and most-argued) questions in API design.

**The status codes.**

- **`400 Bad Request`** (RFC 9110 §15.5.1): "the server cannot or will not
  process the request due to something perceived to be a **client error**
  (e.g., malformed request syntax, invalid request message framing, or
  deceptive request routing)." Canonically about **syntax/framing**.
- **`422 Unprocessable Content`** (RFC 9110 §15.5.21 — moved into core HTTP from
  RFC 4918/WebDAV, and renamed from "Unprocessable Entity"): "the server
  understands the content type of the request content, and the syntax of the
  request content is correct, but it was **unable to process the contained
  instructions**." I.e., the body parsed fine but is *semantically* invalid.

**The pragmatic mapping many APIs use:**

| Situation | Suggested status |
|---|---|
| Body isn't valid JSON / malformed syntax | `400` |
| Wrong/missing `Content-Type` for the body | `415 Unsupported Media Type` |
| Valid JSON, but violates the schema (wrong type, missing required field) | `400` *or* `422` — pick one and be consistent |
| Valid JSON & schema, but fails a business rule (expired coupon, dup email) | `422` (or `409` for conflicts) |
| Missing/invalid auth | `401` / `403` (not a validation code) |

**The two camps.**

- **"422 for all validation" camp:** if the JSON parsed, it's syntactically
  fine, so any *content* problem (schema or business) is `422`; reserve `400`
  strictly for unparseable/malformed requests. This is common in modern APIs
  (and what many frameworks default to).
- **"400 for validation" camp:** RFC 9110 explicitly names `400` as the general
  client-error status and points out clients may not understand `422`. Plenty
  of large public APIs (including much of Google, GitHub for some cases) return
  `400` with a detailed error body for validation failures.

**What to actually say in an interview.**

> [!INTERVIEW]
> There is no single "correct" code that a spec mandates for schema-level
> validation — both `400` and `422` are defensible. The strong answer is:
> *(1)* `400` for un-parseable/malformed requests (this is unambiguous),
> *(2)* pick `400` **or** `422` for "parsed but invalid content" and apply it
> **consistently across the whole API**, *(3)* the real value is in the
> **error body** (field-level details), not the exact code, and *(4)* never use
> `500` for a client input error — that misattributes fault and pollutes your
> error-rate SLOs/alerting.

**Gotchas.**

- `422` originated in WebDAV (RFC 4918) and is now folded into RFC 9110, so it's
  a fully legitimate general-purpose code — but some old clients/proxies may not
  recognize it. Weigh your audience.
- Don't return `200 OK` with an error object in the body for a failed request.
  That breaks HTTP semantics, caching, and every generic client/monitoring tool.
- `404` for "the referenced related resource doesn't exist" vs `422` for "your
  body references a non-existent id" is a judgment call; `422` (or `409`) is
  usually better because the *request* body is the problem, not the URL target.

---

## Returning field-level errors

**Why.** A single "Bad Request" with no detail forces the client to guess. A
good validation response tells the caller **which fields** failed and **why**,
so a form can highlight the exact inputs. This is a major DX differentiator.

**Use RFC 9457 Problem Details.** RFC 9457 *(Problem Details for HTTP APIs,
which **obsoletes RFC 7807**)* defines a standard JSON error format with media
type **`application/problem+json`**. Standard members: `type` (URI identifying
the problem type), `title`, `status`, `detail`, `instance`. It has **no
built-in field-error member**, but the spec's own example uses an **`errors`
extension array** for exactly this.

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Your request parameters didn't validate.",
  "status": 422,
  "detail": "The request body failed validation. See 'errors' for details.",
  "instance": "/orders/req-6f3a",
  "errors": [
    { "detail": "must be a valid email address", "pointer": "#/email" },
    { "detail": "must be greater than or equal to 1", "pointer": "#/items/0/quantity" },
    { "detail": "is required", "pointer": "#/shippingAddress" }
  ]
}
```

**Design guidance.**

- **Report all errors at once**, not just the first. Failing on the first field
  forces the client into a frustrating fix-resubmit loop. Collect the full set
  and return them together.
- **Locate each error with a JSON Pointer** (RFC 6901: `#/items/0/quantity`) or
  a dotted path, so the client can map it to a form field. Use `parameter` (or
  a `name`) for query/header params instead of `pointer`.
- **Include a stable, machine-readable code** per error (e.g. `"code":
  "too_short"`) in addition to the human `detail`. Clients should branch on
  codes, not on English text (which changes / is localized).
- **Set the `Content-Type` to `application/problem+json`** so generic clients
  recognize it as a problem document.
- **`status` in the body is advisory** and MUST match the real HTTP status code.

> [!WARNING]
> Don't leak internals in error detail — stack traces, SQL fragments, internal
> field names, or which of username/password was wrong on login. Error bodies
> are attacker-readable. Be specific about *client* mistakes, opaque about
> *server* internals (OWASP API8: Security Misconfiguration).

**Consistency > cleverness.** Whatever shape you choose (Problem Details is the
standards-based default), use it for *every* error across the API. Clients write
one error handler, not one per endpoint.

---

## Defensive parsing

**The idea.** Parse the request as if the sender is hostile or buggy — because
some are. Defensive parsing means making **no optimistic assumptions** about
structure, size, encoding, or types, and failing safely when they're violated.

**Concrete practices.**

- **Validate `Content-Type` before parsing.** If you expect
  `application/json`, reject other types with `415 Unsupported Media Type`
  rather than trying to parse arbitrary bytes as JSON.
- **Parse with limits (see next section).** Bound the body size, nesting depth,
  and array/string lengths *before or during* parsing so a malicious payload
  can't exhaust memory or CPU.
- **Reject duplicate keys / ambiguous JSON.** `{"a":1,"a":2}` is technically
  allowed by JSON grammar but ambiguous; strict parsers reject it. Duplicate
  keys are a known smuggling/confusion vector when two components disagree on
  which wins.
- **Don't trust declared vs actual length.** A lying `Content-Length` header, a
  truncated body, or a `Transfer-Encoding` mismatch can cause request smuggling;
  reject framing inconsistencies.
- **Be strict about types.** `"true"` (string) is not `true` (boolean);
  `"1"` is not `1`. Type coercion is a source of subtle bugs and security holes
  — prefer strict schema type checks over lenient coercion.
- **Guard numeric ranges and precision.** Reject `NaN`, `Infinity`, and numbers
  outside safe integer range; money should be an integer of minor units or a
  decimal string, never an IEEE-754 float you `parseFloat`.
- **Beware "billion laughs" / deeply nested structures.** Especially for XML
  (entity expansion) but also deeply nested JSON, which can blow the stack or
  amplify memory. Disable external entity resolution for XML (**XXE** defense).

> [!TIP]
> A useful heuristic: *the parser is part of your attack surface.* Configure it
> for strictness (size caps, depth caps, no external entities, reject
> duplicates) rather than accepting library defaults, which favor leniency.

---

## Content-Length and content-type limits

**Why.** Without limits, a single request can exhaust memory, CPU, or disk —
this is **API4:2023 Unrestricted Resource Consumption** in the OWASP API Top 10.
Limits are a validation concern because they gate whether you'll even *accept*
the request.

**The controls, at the wire level.**

- **Maximum body size.** Enforce a hard cap (e.g., 1 MB for JSON APIs; larger
  only where genuinely needed). Reject oversize bodies with **`413 Content Too
  Large`** (RFC 9110 §15.5.14, formerly "Payload Too Large"). Enforce it at the
  gateway *and* the app — don't rely on `Content-Length` alone (it can lie or be
  absent with chunked transfer), so also stop reading once the byte cap is hit.

```http
HTTP/1.1 413 Content Too Large
Content-Type: application/problem+json

{ "type": "about:blank", "title": "Payload too large",
  "status": 413, "detail": "Request body exceeds the 1 MB limit." }
```

- **`Content-Type` enforcement.** Require the expected media type; reject others
  with **`415 Unsupported Media Type`**. Combined with `Accept`-driven content
  negotiation, this keeps parsing predictable and blocks content-type confusion
  attacks.

```http
HTTP/1.1 415 Unsupported Media Type
Accept-Post: application/json

{ "type": "about:blank", "title": "Unsupported Media Type", "status": 415 }
```

- **`411 Length Required`.** A server *may* refuse a request that omits
  `Content-Length` when it needs to know the size in advance (RFC 9110
  §15.5.11), though most servers instead accept chunked encoding and enforce a
  streaming byte cap.
- **Per-element caps.** Beyond total body size, bound `maxItems` on arrays,
  `maxLength` on strings, and object nesting depth. A 1 MB body containing a
  10-million-element array is still an attack.
- **Field/parameter count and URL length.** Cap the number of query parameters
  and the total URI length (oversized URIs → **`414 URI Too Long`**, §15.5.15)
  to prevent parameter-pollution and header-based DoS.
- **Upload/streaming limits.** For file uploads, stream to bounded storage with
  a size cap and validate the *actual* content (magic bytes), not just the
  claimed `Content-Type` or extension.

> [!KEY-TAKEAWAY]
> Size and type limits are *validation you do before you even parse*. Set them
> explicitly at both the gateway and the application, return `413`/`415`/`414`
> as appropriate, and remember `Content-Length` is a claim, not a guarantee —
> always enforce a hard read cap.

---

## Common follow-up questions

**"400 or 422 for a failed schema validation — which is correct?"**
Neither is mandated by a spec for schema-level failures. Use `400` for
un-parseable/malformed requests (unambiguous). For "parsed but violates schema
or business rules," `400` and `422` are both defensible; pick one, apply it
API-wide, and put the real value in a field-level error body. `422` is popular
for "syntactically fine but semantically invalid."

**"How do you stop mass assignment?"** Allow-list writable fields (never
denylist), bind requests to dedicated input models that lack server-owned
fields, and set `additionalProperties: false` in the schema. It's OWASP
API3:2023.

**"Validation vs sanitization?"** Validation rejects bad input; sanitization
transforms it. For injection defense, prefer parameterized queries and
context-aware output encoding over input sanitization. Canonicalize *before*
validating if you canonicalize at all, and document it.

**"Where should validation live?"** Both edge and domain. Edge = cheap
syntactic checks + fast rejection (UX/optimization). Domain = semantic checks
and invariant enforcement (correctness). The domain must never trust that the
edge validated.

**"Is `format: email` in JSON Schema enough?"** Not by default — `format` is an
annotation unless you enable format assertion in the validator; otherwise pair
it with a `pattern` or explicit check.

**"How do you return multiple field errors?"** RFC 9457 Problem Details with an
`errors` extension array, each entry carrying a `detail` and a JSON Pointer
(`pointer`) or `parameter` name, plus a stable machine-readable code. Return all
errors at once.

**"What about request size attacks?"** Enforce a body-size cap (`413`), validate
`Content-Type` (`415`), bound array/string/nesting limits, and don't trust
`Content-Length`. This is OWASP API4:2023 Unrestricted Resource Consumption.

**"Can JSON Schema express all your validation?"** Syntactic and many
cross-field constraints yes (`if/then/else`, `dependentRequired`), but stateful
semantic rules (existence, business logic) no — those live in the domain.

---

## References

- **RFC 9110 — HTTP Semantics** (status codes: §15.5.1 `400`, §15.5.11 `411`,
  §15.5.14 `413`, §15.5.15 `414`, §15.5.16 `415`, §15.5.21 `422`).
  <https://www.rfc-editor.org/rfc/rfc9110.html>
- **RFC 9457 — Problem Details for HTTP APIs** (obsoletes RFC 7807;
  `application/problem+json`; `errors` extension example).
  <https://www.rfc-editor.org/rfc/rfc9457.html>
- **RFC 4918 — HTTP Extensions for WebDAV** (original definition of `422`).
  <https://www.rfc-editor.org/rfc/rfc4918.html>
- **RFC 7396 — JSON Merge Patch** (semantics of `null` vs absent in PATCH).
  <https://www.rfc-editor.org/rfc/rfc7396.html>
- **RFC 6901 — JavaScript Object Notation (JSON) Pointer** (locating a field).
  <https://www.rfc-editor.org/rfc/rfc6901.html>
- **JSON Schema — Draft 2020-12** (validation vocabulary).
  <https://json-schema.org/specification>
- **OpenAPI Specification 3.1** (adopts JSON Schema 2020-12).
  <https://spec.openapis.org/oas/v3.1.0>
- **OWASP API Security Top 10 (2023)** — esp. API3 (Broken Object Property Level
  Authorization / mass assignment), API4 (Unrestricted Resource Consumption),
  API8 (Security Misconfiguration).
  <https://owasp.org/API-Security/editions/2023/en/0x11-t10/>
- **OWASP Cheat Sheets** — Input Validation, Mass Assignment, REST Security.
  <https://cheatsheetseries.owasp.org/>
