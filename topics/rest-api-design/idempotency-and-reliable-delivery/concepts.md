# Idempotency & Reliable Request Delivery

Networks fail *in the middle*. A client sends `POST /payments`, the server
charges the card, and then the response is lost to a dropped connection or a
gateway timeout. The client has no idea whether the charge happened. If it
retries blindly, it might charge twice; if it gives up, it might drop a
legitimate payment. **Idempotency** is the discipline that lets a client retry
safely without causing duplicate side effects, and it is the single most
common reliability question in API-design interviews.

This document is grounded in **RFC 9110 (HTTP Semantics, June 2022)** — the
consolidated spec that obsoletes RFC 7231 — plus the widely deployed
**`Idempotency-Key`** pattern (popularized by Stripe and specified in the IETF
`draft-ietf-httpapi-idempotency-key-header`, still a draft, **not yet an RFC**).

A mental model to carry throughout: **idempotency is about the *effect* of
processing a request one time versus many times, not about the response bytes
being identical.** Two identical requests may return different status codes
(`201` then `200`, or `200` then `404`) yet still be idempotent, because the
*state of the server* ends up the same as if the request were made once.

---

## What idempotency means

An operation is **idempotent** if making it *N ≥ 1* times has the same effect
on server state as making it exactly once. RFC 9110 §9.2.2 defines it for HTTP:
a method is idempotent if "the intended effect on the server of multiple
identical requests with that method is the same as the effect for a single such
request."

Two clarifications that interviewers probe immediately:

- **Idempotency is about the effect, not the response.** `DELETE /orders/42`
  is idempotent: the first call removes the order and returns `204`; the second
  returns `404` (already gone). Different responses, same end state (order 42
  does not exist). Idempotency does **not** promise the same status code.
- **Idempotency is a property the client relies on to retry.** The whole reason
  the concept matters is fault tolerance: if a response is lost, an idempotent
  request can be re-sent without fear of a second side effect.

> [!KEY-TAKEAWAY]
> Idempotent means "safe to repeat." After one or one-hundred identical
> requests, the server's observable state is the same. This is what makes
> automatic retries safe.

Contrast with a **non-idempotent** operation: `POST /accounts/1/deposits` that
adds $100 each time it is processed. Two deliveries deposit $200 — the effect
scales with the number of requests, so it is not idempotent and cannot be
retried blindly.

---

## Safe methods versus idempotent methods

These are two *different* properties and mixing them up is a classic
interview trap.

- A method is **safe** (RFC 9110 §9.2.1) if it is essentially read-only — the
  client does not request, and should not cause, any state change. `GET`,
  `HEAD`, `OPTIONS`, and `TRACE` are safe.
- A method is **idempotent** (§9.2.2) if repeating it has the same effect as
  doing it once.

Every safe method is idempotent (reading twice changes nothing), but **not
every idempotent method is safe**. `DELETE` and `PUT` change state, so they are
*not* safe, yet they *are* idempotent.

| Method | Safe? | Idempotent? |
|---|---|---|
| `GET` | Yes | Yes |
| `HEAD` | Yes | Yes |
| `OPTIONS` | Yes | Yes |
| `TRACE` | Yes | Yes |
| `PUT` | No | Yes |
| `DELETE` | No | Yes |
| `POST` | No | **No** |
| `PATCH` | No | **No** (not guaranteed) |

> [!WARNING]
> "Safe" implies "idempotent," but the reverse is false. A `DELETE` is
> idempotent but definitely not safe — it destroys data.

Safe methods carry an extra promise: because they have no side effects, they
are eligible for caching and prefetching by intermediaries. That is why you
must never hide a state change behind a `GET` (e.g. `GET /users/5/delete`) — a
crawler or link-prefetcher will "click" it for you.

---

## Which HTTP methods are idempotent and why

RFC 9110 §9.2.2 designates **`GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, and
`DELETE`** as idempotent. `POST` and `PATCH` are **not** guaranteed idempotent.

The reasoning is about the *semantics* of each method:

- **`PUT` is idempotent** because it means "make the target resource equal to
  this representation." `PUT /users/5 {"name":"Ada"}` sets the resource to that
  exact value; sending it again sets it to the same value — no cumulative
  effect. That is why `PUT` is used for full replacement, not for "append."
- **`DELETE` is idempotent** because "ensure this resource is gone" has the same
  end state no matter how many times you ask.
- **`GET`/`HEAD`/`OPTIONS`/`TRACE`** are read-only, so trivially idempotent.
- **`POST` is not idempotent** because it means "process this data according to
  the resource's own semantics" — typically *create a new subordinate resource*
  or *append*. Each `POST /orders` may mint a new order, so two deliveries make
  two orders.
- **`PATCH` is not guaranteed idempotent** because a patch can be relative. A
  JSON Patch of `{"op":"add","path":"/tags/-","value":"x"}` appends on every
  application. A patch *can* be written idempotently (e.g. absolute
  `"op":"replace"`), but the method carries no guarantee, so treat it as
  non-idempotent unless you designed it otherwise.

> [!INTERVIEW]
> "Is `PATCH` idempotent?" The correct answer is **not necessarily** — it
> depends on the patch document. Absolute/`replace` patches are idempotent;
> relative operations like array-append or numeric increment are not. RFC 9110
> deliberately does not list `PATCH` (RFC 5789) as idempotent.

A subtle but important point: **idempotency is a promise about the method's
*defined semantics*, not a guarantee the server enforces.** A poorly written
handler can make `PUT` non-idempotent (e.g. by appending to a log each call).
The spec says a compliant server *should* preserve the property; violating it
breaks every client and proxy that trusts the method.

---

## Making POST idempotent with an Idempotency-Key header

`POST` is not idempotent by nature, but you can make a specific `POST`
operation *effectively* idempotent by giving each logical operation a unique
**idempotency key** that the client generates and sends in a request header.
The server remembers keys it has already processed and returns the stored
result instead of re-executing.

The de-facto standard header is **`Idempotency-Key`** (Stripe-style; the IETF
draft `draft-ietf-httpapi-idempotency-key-header` specifies the same name).

```http
POST /v1/payments HTTP/1.1
Host: api.example.com
Idempotency-Key: 5f8d0e3a-2b1c-4a6e-9f7d-1c2b3a4d5e6f
Content-Type: application/json

{ "amount": 4200, "currency": "usd", "source": "card_abc" }
```

First delivery — the server executes and stores the outcome:

```http
HTTP/1.1 201 Created
Location: /v1/payments/pay_123
Content-Type: application/json

{ "id": "pay_123", "amount": 4200, "status": "succeeded" }
```

Retry with the **same key** (because the client never saw the first response):

```http
HTTP/1.1 201 Created
Idempotent-Replayed: true
Content-Type: application/json

{ "id": "pay_123", "amount": 4200, "status": "succeeded" }
```

Design rules that interviewers look for:

- **The client generates the key**, not the server — it must be stable across
  retries of the *same* logical request. A **UUIDv4** or other high-entropy
  random string is standard; Stripe allows up to 255 characters. Generate it
  *before* the first attempt and reuse it for every retry.
- **The key scopes one logical operation.** A new checkout gets a new key; a
  retry of that checkout reuses it. Do not reuse a key for a different
  operation.
- **Only apply it to unsafe, non-idempotent methods** (`POST`, sometimes
  `PATCH`). `GET`/`PUT`/`DELETE` are already idempotent, so a key is redundant
  there — Stripe explicitly says `GET` and `DELETE` ignore it.
- **Scope keys correctly on the server**, typically per (endpoint + account /
  API-key) so two different tenants using the same random string never collide.

> [!TIP]
> The idempotency key belongs in a **header**, not the request body or URL. It
> is metadata about *delivery*, orthogonal to the resource representation, and
> keeping it in a header lets middleware handle dedup without parsing the body.

---

## Server-side deduplication and stored responses

The server side of the pattern is a **dedup store** keyed by the idempotency
key. The canonical algorithm:

1. On arrival, look up the key.
2. **If unseen:** atomically insert a record in state `in-progress` (see the
   race-condition section), execute the operation, then persist the **status
   code + response headers + response body** against the key and mark it
   `completed`.
3. **If seen and completed:** skip execution and **replay the stored response**
   verbatim (often tagged with a header like `Idempotent-Replayed: true`).
4. **If seen and still in-progress:** a concurrent duplicate is running — return
   `409 Conflict` (or `425 Too Early`) so the client backs off and retries.

```
key seen? ──no──► lock+insert(in-progress) ─► execute ─► store(response) ─► return fresh
   │
   yes
   ├─ completed  ─► return stored response  (replay)
   └─ in-progress ─► 409 Conflict / retry-after
```

Advanced details interviewers probe:

- **Store failures too, not just successes.** Stripe caches the outcome
  *whether it succeeded or failed*, so a retry of a request that legitimately
  produced a `500` (or a `402 card_declined`) replays that same result rather
  than re-charging. The exception: results that never began endpoint execution
  (validation errors, concurrency conflicts) are **not** stored and remain
  retryable.
- **Fingerprint the request to detect misuse.** A robust implementation stores
  a hash of the request (method + path + body) alongside the key. If the same
  key arrives with *different* parameters, that is a client bug — reject it with
  a 4xx client error (Stripe returns `400` with an `idempotency_error`;
  `422 Unprocessable Content` is another reasonable choice) instead of silently
  replaying the wrong result.
- **Persistence must be durable and shared.** An in-memory map on one node fails
  the moment a retry hits a different instance behind the load balancer; use a
  shared store (Redis/Postgres/DynamoDB) so all nodes see the same keys.

> [!WARNING]
> If you replay a stored `2xx` for a key whose *body differs* from the original,
> you silently drop the second request's data. Always compare a request
> fingerprint and reject mismatches (`422`) rather than blindly replay.

---

## Idempotency window and TTL

Stored keys cannot live forever — the dedup table would grow without bound. So
every implementation defines an **idempotency window** (a TTL) after which keys
are purged.

- **Stripe** retains keys for at least **24 hours**, then may prune them. If a
  key is reused *after* it was pruned, Stripe treats it as a brand-new request
  and executes it again (no replay).
- The **TTL should comfortably exceed** your maximum realistic client retry
  window (retry budget + backoff + client/queue outages). A 24-hour window is a
  common default; high-value financial flows may keep keys longer.

Interview gotchas:

- **After the window expires, idempotency is gone.** A very late retry
  (delayed by a queue outage, say) can double-execute if it arrives after the
  key was purged. The window is a bounded guarantee, not an eternal one.
- **TTL is a storage-cost vs. safety trade-off.** Longer windows use more
  storage but tolerate longer client outages; shorter windows are cheaper but
  narrow the protection.
- **Document the window** so clients know how long a key is honored and don't
  retry outside it expecting dedup.

---

## Race conditions on concurrent same-key requests

The nastiest real-world case: **two requests with the same idempotency key
arrive at the same time** (a client fired a retry before the first response
came back, or two workers picked up the same message). A naive
"check-then-insert" has a window where *both* see the key as unseen and *both*
execute — exactly the double side effect you were trying to prevent.

The fix is an **atomic reservation** of the key before doing any work:

- Use an atomic **insert-if-absent** primitive: `INSERT ... ON CONFLICT DO
  NOTHING`, a unique constraint on the key column, Redis `SET key val NX`, or a
  conditional put. The **database's uniqueness guarantee**, not application
  code, is what serializes the two racers.
- The **winner** proceeds to execute; the **loser's** insert fails, telling it a
  duplicate is already in flight.
- The loser should return **`409 Conflict`** (Stripe's behavior for concurrent
  same-key requests) so the client backs off and retries — by which time the
  winner has stored a result to replay. Such concurrency conflicts are **not**
  stored and are safely retryable.

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
Retry-After: 1

{ "type": "https://api.example.com/probs/in-progress",
  "title": "A request with this Idempotency-Key is already being processed" }
```

> [!INTERVIEW]
> "How do you prevent two concurrent requests with the same key from both
> executing?" The expected answer is a **unique constraint / atomic
> insert-if-absent** as a lock, *not* a read-then-write in application code
> (which has a TOCTOU race). Mention returning `409` to the loser.

Deeper points:

- **The atomic reservation must happen before the side effect**, and the side
  effect + result-storage should be committed together (or made recoverable),
  so a crash mid-flight doesn't leave a key marked in-progress forever. Give
  in-progress records their own short TTL so a crashed request can be retried.
- **This is a distributed-locking problem in miniature.** Prefer letting the
  datastore enforce uniqueness over a separate lock service — fewer moving
  parts and no lock-expiry correctness holes.

---

## Safe client retries with backoff

Idempotency on the server only pays off if the client retries *intelligently*.
Blindly hammering a failing server causes retry storms and cascading overload.

Best practices for retry logic:

- **Retry only what is safe.** Idempotent methods (`GET`, `PUT`, `DELETE`) can
  be retried freely. `POST`/`PATCH` should be retried **only with an
  idempotency key**, otherwise you risk duplicate side effects.
- **Retry on the right signals:** network/connection errors, timeouts,
  `429 Too Many Requests`, and `503 Service Unavailable`. Do **not** retry
  `4xx` client errors like `400`/`422` — the request is malformed and will fail
  identically.
- **Use exponential backoff with jitter.** Delay grows geometrically
  (`base·2^n`), and **random jitter** spreads retries out so many clients don't
  synchronize into a "thundering herd" that all retry at the same instant.
- **Honor the `Retry-After` header** when the server sends one (common with
  `429`/`503`) — it tells you exactly how long to wait.
- **Cap retries and total time** with a retry budget; after that, surface a
  failure rather than retrying forever.

```
attempt 1 → fail → wait (1s  ± jitter)
attempt 2 → fail → wait (2s  ± jitter)
attempt 3 → fail → wait (4s  ± jitter)   ← same Idempotency-Key on every attempt
attempt 4 → give up, report error
```

> [!KEY-TAKEAWAY]
> Reuse **the same idempotency key across all retries of one logical
> operation**. Generating a fresh key per attempt defeats the entire mechanism
> — the server sees each attempt as new and executes them all.

---

## At-least-once delivery and duplicate handling

Reliable messaging systems (and HTTP-over-unreliable-networks) almost always
give you **at-least-once** delivery: a message/request is guaranteed to arrive,
but possibly more than once. Duplicates happen because the *acknowledgement* can
be lost even when the work succeeded, forcing a re-send.

The three delivery semantics:

| Semantics | Guarantee | Duplicates? | Lost messages? |
|---|---|---|---|
| At-most-once | Fire and forget | No | Possible |
| At-least-once | Retries until acked | **Yes** | No |
| Exactly-once | One logical effect | No | No |

The pragmatic industry stance: **build for at-least-once delivery, and make the
consumer idempotent.** Since duplicates are unavoidable in any system that
retries, the receiver must be able to detect and discard them. Idempotency keys,
dedup tables, and natural business keys (e.g. a unique order number) are the
tools that turn at-least-once transport into an at-most-once *effect*.

> [!KEY-TAKEAWAY]
> "At-least-once delivery + idempotent processing" is the standard recipe for
> reliability. You don't stop duplicates from *arriving*; you stop them from
> having an *effect*.

---

## Exactly-once as an illusion

Interviewers love to ask: "Can you guarantee exactly-once delivery?" The
sophisticated answer is **no — exactly-once *delivery* over an unreliable
network is impossible**, and claiming otherwise is a red flag.

The reasoning (a variant of the Two Generals problem): the sender can never be
certain a message was received, because the acknowledgement itself can be lost.
So it must choose between never re-sending (risking loss = at-most-once) or
re-sending (risking duplicates = at-least-once). There is no third option at the
transport layer.

What systems that advertise "exactly-once" actually provide is **exactly-once
*processing* (effectively-once)**: the transport is at-least-once, and duplicate
*effects* are eliminated at the edges by:

- **Idempotent operations / idempotency keys** — reprocessing a duplicate is a
  no-op.
- **Deduplication** on a unique message ID within a window.
- **Transactional / atomic commit** of the side effect together with the
  consumer's offset/ack, so a message can't be marked done without its effect
  being durable (and vice versa).

> [!INTERVIEW]
> If asked "how do you get exactly-once?", say: *exactly-once **delivery** is a
> myth; you achieve exactly-once **effect** by combining at-least-once delivery
> with idempotent consumers and deduplication.* Naming the Two Generals problem
> earns credit.

---

## Idempotency-Key wire syntax and Structured Fields

The early Stripe convention treats the key as an opaque token. The IETF draft
(now `draft-ietf-httpapi-idempotency-key-header-07`, revised 2025-10-15) is more
precise: it defines `Idempotency-Key` as an **RFC 8941 Structured Field Value**,
specifically an **Item of type String**. That has a concrete wire consequence —
a String Item is **double-quoted**:

```http
Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"
```

The quotes are part of the syntax, not decoration. A bare unquoted token (what
most Stripe examples show, and what appears earlier in this document) is *not* a
valid Structured Fields String; a spec-strict parser rejects it. Practically,
many production servers still accept the unquoted form for backward
compatibility, but a candidate should know the draft mandates the quoted String
Item and that RFC 8941 also caps the printable-ASCII character set (no raw
control characters, no non-ASCII).

> [!INTERVIEW]
> "What is the exact type of the `Idempotency-Key` field per the draft?" — an
> **RFC 8941 Structured Fields Item, String type** (double-quoted). Naming
> RFC 8941 and the quoting rule is the precise-recall signal interviewers want.

---

## Error taxonomy in the IETF draft

Earlier this document hedged on status codes ("400 or 422 are both reasonable").
The `-07` draft is now explicit, and a senior candidate is expected to reproduce
the map — including the human-readable **title** strings the draft suggests:

| Condition | Status | Suggested title |
|---|---|---|
| Key required but **missing** | **400 Bad Request** | "Idempotency-Key is missing" |
| Key seen and request **still in flight** | **409 Conflict** | "A request is outstanding for this Idempotency-Key" |
| Same key, **different payload/fingerprint** | **422 Unprocessable Content** | "Idempotency-Key is already used" |
| Key **reused after expiry/purge** | *(no code defined)* | treated as a brand-new request |

Notes that separate a strong answer:

- **422 (RFC 9110 §15.5.21) Unprocessable Content** is the draft's choice for
  the same-key-different-body case — the syntax is fine but the request is
  semantically inconsistent with the recorded one. Stripe historically returns
  `400` here; both are defensible, but the draft standardizes on `422`.
- **409 Conflict** is the draft's code for a concurrent in-flight duplicate —
  *not* `425 Too Early` (see the 425 trap section).
- **Reuse after expiry has no defined error on purpose.** A purged key is
  indistinguishable from a never-seen key, so the safe behavior is to treat it
  as new and re-execute. That is exactly the "double-execute after TTL" danger
  window discussed under the idempotency window.

Error bodies should use **`application/problem+json` (RFC 9457)** so the
`type`/`title`/`detail` are machine-readable.

---

## Request fingerprint strategies

The dedup store should bind a key to a **fingerprint** of the request so that a
key replayed with a *different* body is caught (returned `422`) rather than
silently mis-replayed. The draft calls this an *idempotency fingerprint*
(a concept the resource derives from the request, **not** a wire header) and
enumerates several sanctioned generation strategies, each with a trade-off:

1. **Checksum of the entire payload** (e.g. SHA-256 of the raw body). Strictest,
   but brittle: a cosmetic re-serialization (key reordering, whitespace,
   different float formatting) changes the hash and triggers a false `422` even
   though the *intent* is identical.
2. **Checksum of selected elements** — hash only the semantically meaningful
   fields. Tolerates reserialization but requires the server to know which
   fields matter.
3. **Field-value matching** (full or selected) — compare parsed field values
   rather than a raw byte hash, so `{"a":1,"b":2}` and `{"b":2,"a":1}` match.
4. **Request digest / signature** — a signed digest that also authenticates the
   request.

> [!WARNING]
> A whole-body checksum is the safest *correctness* choice but the most
> **operationally fragile**: any client library that re-serializes JSON (very
> common) will flip the hash and start returning `422` on legitimate retries.
> Fingerprinting canonical/selected fields is the usual production compromise.

---

## Security considerations for idempotency keys

The draft's Security Considerations section (and OWASP API Security Top 10 2023)
turn key handling into an **authorization** problem, not just a collision one.
Two named attack classes:

- **Injection / cache-poisoning.** An unvalidated key used *directly* as a
  cache/store lookup key can be crafted to collide with or overwrite another
  entry (store injection). Mitigation: **fix and publish a key format** (e.g.
  "must be a UUID / a quoted String ≤ N chars") and **always validate the key
  before using it as a lookup key**.
- **Key-guessing / data leak (BOLA/IDOR).** If keys are low-entropy or
  guessable, an attacker can submit someone else's key and receive their stored
  response — a broken-object-level-authorization leak (**OWASP API1:2023
  BOLA**, related to API3:2023 broken object property authorization). The stored
  response can contain another tenant's PII.

The unifying fix is a **composite lookup key**: never key the store on the
client-supplied string alone. Combine it with **server-known, authenticated
client attributes** — the auth principal (account/API-key/tenant id) plus the
endpoint. This both prevents cross-tenant collisions *and* scopes replay to the
authenticated caller, so guessing another tenant's key cannot fetch their data.

> [!INTERVIEW]
> "Should the idempotency-key namespace be global or per-principal?" —
> **per-authenticated-principal (+ endpoint)**. A global namespace lets one
> tenant's key hit another tenant's stored response — a BOLA leak. Scoping to
> the auth principal makes the key a *within-tenant* dedup token, which is the
> correct authorization boundary.

---

## Competing and adjacent idempotency standards

`Idempotency-Key` is the most common pattern but far from the only one; breadth
here signals seniority:

- **OASIS Repeatable Requests v1.0 / Microsoft Azure.** Uses a *different*
  header pair: `Repeatability-Request-ID` (a unique id) plus
  `Repeatability-First-Sent` (an HTTP-date timestamp of the first attempt) on
  the request, and `Repeatability-Result: accepted | rejected` on the response.
  The repeatability window **MUST be at least 5 minutes**, and an endpoint that
  receives a repeatability header it does not support returns
  **501 Not Implemented**.
- **Google AIP-155 `request_id`.** A `request_id` field on the *request message*
  (not a header, not the resource), a UUID4, that **MUST** guarantee
  idempotency and replay a prior success. Notably, AIP-155 permits returning the
  **current resource state** if the original response can no longer be
  reproduced — a "stale replay" nuance: a replay may reflect newer state, not a
  byte-frozen snapshot.
- **Zalando REST guidelines (#229/#230/#231).** An endpoint MAY support the
  `Idempotency-Key` header, but Zalando SHOULD prefer a **secondary / natural
  business key** for idempotent creation (dedup on a domain-unique value like an
  order number) rather than a generic key.
- **Vendor header zoo.** `PayPal-Request-Id`, Square's `idempotency_key` (sent
  in the request *body*), Google's `requestId`, plus Twilio, Adyen, and Dwolla
  variants. The naming is not standardized because the header field itself is
  still an Internet-Draft.

> [!KEY-TAKEAWAY]
> There is no single ratified standard yet. Know the three families —
> **Stripe/IETF `Idempotency-Key`**, **OASIS/Azure `Repeatability-*` (+timestamp,
> ≥5 min, 501)**, and **Google AIP-155 `request_id` (stale-replay allowed)** —
> plus the natural-business-key approach.

---

## Idempotent creation without a dedup store

An idempotency key is not the only way to make creation retry-safe. Two
alternatives require **no dedup store at all**:

- **Client-chosen id + `PUT`.** Instead of `POST /resources` (server mints the
  id), use `PUT /resources/{client-generated-id}` where the client supplies a
  UUID. `PUT` is idempotent by definition, so a retry to the same URL is a no-op
  create-or-replace. Trade-off: the **client owns id generation** and the server
  loses control of its id space (and must guard against id collisions / squatting
  across tenants).
- **Natural / business key + unique constraint.** Dedup on a domain-unique value
  (order number, transfer reference). A duplicate insert violates the unique
  constraint and is rejected, giving an at-most-once effect without any header.
  This doubles as **defense-in-depth** behind an idempotency key whose TTL may
  expire.

A related *reconciliation* pattern: after a timeout on a keyless `POST`, the
client can **`GET` the resource** (by natural key, or via a `Location`/status
endpoint) to *discover* whether the first attempt actually succeeded, instead of
blindly retrying. This distinguishes a genuinely ambiguous outcome (the request
may have been processed — the exact case an idempotency key exists for) from a
known-nothing-happened outcome (connection refused / DNS failure), where a
retry is safe even without a key.

---

## Idempotency for async and long-running operations

Real payment/order APIs are frequently **asynchronous**: the write is queued and
processed later. The reliability contract then splits into two layers:

- **Submission** returns **`202 Accepted`** with an `Operation-Location` (or
  `Location`) header pointing at a **status-monitor resource**. The client polls
  it, honoring `Retry-After`, until the operation resource reports
  `succeeded`/`failed`.
- **The idempotency key protects the *submission*** — a retried submission with
  the same key returns the same operation handle rather than enqueuing the work
  twice. **The operation resource protects the *execution*** — the worker keys
  its side effect on the operation id so re-processing the queued message is a
  no-op.

So "how does idempotency work when the work is queued?" has a two-part answer:
key-dedup at the API edge to avoid duplicate *submissions*, plus idempotent
*consumers* (natural key / operation-id dedup) to survive at-least-once queue
redelivery. The `202`+polling shape also means a replay may legitimately return
the operation *in a newer state* (pending → succeeded), echoing the AIP-155
stale-replay point.

---

## Where to put deduplication (gateway versus service)

"Where does the dedup layer live?" is a design-altitude question.

- **Gateway / edge / CDN dedup** (e.g. AWS API Gateway has native idempotency
  support; some proxies and service meshes do too). Centralized,
  language-agnostic, keeps duplicate load off the service. **But** it cannot see
  business-transaction boundaries and **cannot join the service's database
  transaction** — it can only dedup at the HTTP layer, so a crash between "edge
  recorded the key" and "service committed the effect" can still lose or
  duplicate work.
- **In-service dedup.** More code in every service, but it is the **only place
  that can bind the key record into the same DB transaction as the side
  effect** — which is the only truly correct location for money-movement.

The usual senior answer for a payment that writes to a database: **do the
authoritative dedup in the service, inside the transaction**; a gateway layer is
at best an optimization to shed obvious duplicate load, never the correctness
boundary.

---

## Binding dedup to the business transaction

The subtle correctness requirement: the **key record and the side effect must
commit atomically**. If they don't, two failure modes appear:

1. **Effect happened, key not stored** (side effect committed, key write failed
   or crashed before it) → a retry sees no key and **double-executes**.
2. **Key stored, effect rolled back** (key committed, side-effect transaction
   later failed) → a retry replays a "success" for work that **never durably
   happened** (lost work).

Two correct patterns:

- **Single-database transaction.** Put the `INSERT idempotency_key` and the
  `INSERT order` (the side effect) in **one transaction**, so they commit or
  roll back together. This is why co-locating the dedup store with the
  side-effect datastore (relational unique constraint) is the strongest design.
- **Transactional outbox.** When the side effect is a *message* to another
  system, write the key/state change **and** an outbox row in one local
  transaction, then a relay publishes the message at-least-once. The consumer is
  idempotent, so the end-to-end effect is exactly-once.

> [!WARNING]
> "Store the key in Redis, charge in Postgres" is the classic broken design:
> the two stores cannot commit atomically, so *some* interleaving always yields
> either a double-charge or a lost charge. Either co-locate them in one
> transactional store or use an outbox.

---

## Distributed dedup store trade-offs

The store must provide an **atomic reserve primitive**, **durability**, and
ideally **co-location with the side-effect transaction**:

- **Redis** — fast; `SET key val NX [PX ttl]` is an atomic reserve, and native
  TTL handles expiry. **Caveats:** default persistence can lose recent writes on
  failover, and eviction under memory pressure can drop keys early. For money,
  it needs durable persistence and cannot be in the same transaction as a
  relational side effect (the cross-store atomicity trap above).
- **DynamoDB** — conditional writes (`attribute_not_exists(pk)`) give an atomic
  reserve, a TTL attribute auto-expires keys, and strongly-consistent reads are
  available. Good serverless fit; still separate from a non-Dynamo side effect.
- **Relational (Postgres/MySQL)** — a **unique constraint + `INSERT ... ON
  CONFLICT` / row lock** is the atomic reserve, and crucially the key row and the
  side-effect row can commit in **one transaction**. Strongest correctness,
  which is why financial systems favor it.

The decision axis: raw speed (Redis) vs. transactional co-location with the side
effect (relational) vs. managed serverless scale (DynamoDB).

---

## Retry amplification, budgets, and jitter algorithms

The client-retry section covers backoff + jitter; senior depth adds three
points from the AWS Builders' Library:

- **Retry amplification.** If every layer in a call chain retries, load
  multiplies geometrically: N nested layers each retrying 3× impose up to **3^N**
  requests on the deepest tier. The mitigation is to **retry at only one layer**
  (usually the edge/client) and let inner layers fail fast, or to propagate a
  "do not retry" signal.
- **Retry budgets / token buckets.** Cap retries as a *fraction* of live traffic
  (a token bucket) rather than a fixed per-request count, so a broad outage
  cannot let retries dominate load. Pair with **client-side circuit breakers**
  that stop sending once failure rates spike — retries can otherwise turn a
  brownout into a full outage.
- **Named jitter algorithms** (not just "add some randomness"):
  - **Full jitter:** `sleep = random(0, base·2^n)` — best spread, recommended
    default.
  - **Equal jitter:** `sleep = base·2^n/2 + random(0, base·2^n/2)` — keeps a
    floor while still de-synchronizing.
  - **Decorrelated jitter:** `sleep = min(cap, random(base, prev·3))` — grows
    from the previous delay, good for long-tail backoff.

> [!KEY-TAKEAWAY]
> "Add jitter" is table stakes; naming **full / equal / decorrelated** jitter
> and explaining **retry budgets + circuit breakers + avoiding retry
> amplification** is what distinguishes a senior answer. Retries can make an
> outage *worse*, not better.

---

## The 425 Too Early trap

Earlier this document offered `425 Too Early` as an alternative to `409` for a
concurrent in-flight duplicate. **That is spec-incorrect and a known interview
trap.** `425 Too Early` is defined by **RFC 8470 (Using Early Data in HTTP)** for
exactly one purpose: a server refusing to process a request that arrived in
**TLS 1.3 early data (0-RTT)**, because 0-RTT data is replayable and must not
trigger non-idempotent processing. It has nothing to do with "still processing"
or "duplicate in flight."

The correct codes:

- **409 Conflict** — a concurrent request with the same key is still in flight
  (the draft's choice).
- **429 Too Many Requests** or **503 Service Unavailable**, both with
  **`Retry-After`** — if you want to explicitly tell the client to back off.

Reserve **425** for its real meaning (0-RTT early-data replay protection), which
is itself an *idempotency-adjacent* concept: 0-RTT is unsafe precisely because
early data can be replayed, so servers restrict it to safe/idempotent handling.

---

## Common follow-up questions

- **Is `PUT` idempotent but `POST` not — why?** `PUT` replaces the resource with
  the exact representation sent, so repeating sets the same state; `POST`
  processes/creates, so repeating creates again.
- **Is `PATCH` idempotent?** Not guaranteed — depends on the patch. Absolute
  `replace` is idempotent; relative append/increment is not.
- **Where does the idempotency key go, and who generates it?** In the
  `Idempotency-Key` request header, generated by the *client* (a UUIDv4), reused
  across all retries of the same operation.
- **What status code for a replayed successful create?** Typically the original
  (`201` or `200`) with the stored body, often flagged `Idempotent-Replayed:
  true`. Idempotency doesn't require the *status code* to match, only the
  effect.
- **What do you return if the same key arrives with a different body?**
  A 4xx client error — do not replay the old result; the mismatch signals a
  client bug. (Stripe returns `400` with an `idempotency_error`;
  `422 Unprocessable Content` is another common choice.)
- **How do you handle two concurrent requests with the same key?** Atomically
  reserve the key (unique constraint / `INSERT ... ON CONFLICT` / `SET NX`); the
  loser gets `409 Conflict` and retries.
- **How long do you keep idempotency keys?** For a bounded TTL/window (Stripe:
  ~24h) that exceeds your client retry budget; after expiry a reused key
  executes fresh.
- **Which errors should a client retry?** Timeouts, connection errors, `429`,
  `503` — with exponential backoff + jitter and honoring `Retry-After`. Never
  retry `4xx` validation errors.
- **Can you guarantee exactly-once delivery?** No — exactly-once delivery is
  impossible over an unreliable network; you get exactly-once *effect* via
  at-least-once delivery + idempotent processing + dedup.
- **Should you cache a `500` under an idempotency key?** Stripe does store the
  failed outcome so a retry replays it; but concurrency conflicts and
  validation failures that never began execution are not stored and stay
  retryable.

## References

- **RFC 9110 — HTTP Semantics** (June 2022), §9.2.1 Safe Methods, §9.2.2
  Idempotent Methods. <https://www.rfc-editor.org/rfc/rfc9110>
- **RFC 5789 — PATCH Method for HTTP** (not listed as idempotent).
  <https://www.rfc-editor.org/rfc/rfc5789>
- **RFC 9457 — Problem Details for HTTP APIs** (July 2023; obsoletes RFC 7807) —
  error bodies for `409`/`422` responses.
  <https://www.rfc-editor.org/rfc/rfc9457>
- **`draft-ietf-httpapi-idempotency-key-header`** — The Idempotency-Key HTTP
  Header Field (IETF Internet-Draft, **not yet an RFC**).
  <https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/>
- **Stripe API — Idempotent Requests.**
  <https://docs.stripe.com/api/idempotent_requests>
- **AWS Builders' Library — Timeouts, retries, and backoff with jitter**
  (exponential backoff + jitter rationale; full/equal/decorrelated jitter,
  retry budgets, retry amplification).
  <https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/>
- **RFC 8941 — Structured Field Values for HTTP** (the Item/String type that
  `Idempotency-Key` uses per the draft). <https://www.rfc-editor.org/rfc/rfc8941>
- **RFC 8470 — Using Early Data in HTTP** (the real meaning of `425 Too Early` —
  TLS 1.3 0-RTT replay protection, *not* "still processing").
  <https://www.rfc-editor.org/rfc/rfc8470>
- **OASIS Repeatable Requests Version 1.0** + Microsoft Azure REST API
  Guidelines — `Repeatability-Request-ID`, `Repeatability-First-Sent`,
  `Repeatability-Result`, ≥5-minute window, `501` if unsupported.
- **Google AIP-155 — Request Identification** (`request_id` on the request
  message; replay may return current resource state). <https://google.aip.dev/155>
- **Zalando RESTful API Guidelines** — rules #229/#230/#231 on idempotency and
  the secondary/business-key approach.
- **OWASP API Security Top 10 2023** — API1:2023 BOLA and API3:2023 broken
  object property authorization (idempotency-key scoping / leak).
  <https://owasp.org/API-Security/editions/2023/en/0x11-t10/>
