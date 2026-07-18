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
  (exponential backoff + jitter rationale).
  <https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/>
