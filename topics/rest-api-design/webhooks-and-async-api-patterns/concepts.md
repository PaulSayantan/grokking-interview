# Webhooks & Async API Patterns

Not every interaction fits the synchronous request/response mould. Sometimes
the *server* needs to tell the *client* that something happened ("a payment
settled," "a video finished transcoding"), and sometimes an operation takes too
long to answer inline. **Webhooks** and **asynchronous API patterns** are how
HTTP-based systems handle both cases without holding a connection open for
minutes or forcing clients to poll a busy loop.

This document is framework-agnostic: it teaches the *wire contract* — the HTTP
requests, headers, signatures, and status codes a producer and consumer
actually exchange — not any single library's helpers. It is grounded in
**RFC 9110 (HTTP Semantics, June 2022)** for status-code and method semantics,
**RFC 9457 (Problem Details for HTTP APIs, 2023, obsoletes RFC 7807)** for error
bodies, **RFC 8288 (Web Linking)** for `Link` relations, and the widely
deployed **HMAC-SHA256 signature** convention popularized by Stripe, GitHub,
Slack, and others. HMAC itself is defined by **RFC 2104**; SHA-256 by
**RFC 6234 / FIPS 180-4**.

A mental model to carry throughout: a webhook is just **an HTTP request the
producer makes to a URL the consumer registered**. The consumer becomes a
tiny server; the producer becomes a client. Everything hard about webhooks —
retries, signing, idempotency, replay protection — falls out of that role
reversal plus the reality that *networks fail in the middle*.

---

## Webhooks versus polling

**Polling** is pull: the client repeatedly asks "anything new yet?" via `GET`.
**Webhooks** are push: the server sends an HTTP `POST` to the client's URL the
moment an event occurs. Both solve the same problem — "how does a client learn
about state changes it did not itself initiate?" — with opposite mechanics.

Polling example — the client hammers an endpoint on a timer:

```
GET /v1/orders/o_123/status HTTP/1.1
Host: api.example.com

HTTP/1.1 200 OK
{ "status": "pending" }        # ... same answer, over and over
```

Webhook example — the producer calls the consumer *once*, when it matters:

```
POST /hooks/example HTTP/1.1        # <- consumer's registered URL
Host: buyer-app.com
Content-Type: application/json

{ "type": "order.shipped", "data": { "orderId": "o_123" } }
```

Trade-offs:

| Dimension | Polling | Webhooks |
|---|---|---|
| Latency | Bounded by poll interval | Near real-time |
| Wasted requests | High (mostly "nothing new") | Near zero |
| Who runs a server | Only the producer | Consumer must expose a public URL |
| Failure handling | Client just polls again | Producer must retry; needs DLQ |
| Firewall/NAT | Works from behind NAT | Consumer must be reachable |
| Security surface | Client authenticates to server | Producer→consumer requires signing |

> [!KEY-TAKEAWAY]
> Polling wastes requests but is simple and works behind a firewall. Webhooks
> are efficient and low-latency but push operational burden onto both sides:
> the consumer must run a reachable, secured endpoint, and the producer must
> implement retries, signing, and dead-lettering.

Interviewers like the nuance: webhooks are not strictly "better." A consumer
behind a corporate firewall, or one that cannot expose a public HTTPS endpoint,
may be forced to poll. Many mature APIs offer *both* and let integrators choose.

---

## Anatomy of an outbound webhook delivery

An outbound webhook is a single HTTP request the producer sends per event.
A well-designed delivery has a predictable shape:

```
POST /hooks/orders HTTP/1.1
Host: consumer.example.com
Content-Type: application/json
User-Agent: ExampleHooks/1.0
Webhook-Id: msg_2b9f1c...              # unique delivery/event id
Webhook-Timestamp: 1710000000          # unix seconds, for replay protection
Webhook-Signature: v1,k8f3...=         # HMAC over timestamp + body
Idempotency-Key: evt_88ah2            # often == event id

{
  "id": "evt_88ah2",
  "type": "order.shipped",
  "created": "2026-07-19T12:00:00Z",
  "data": { "orderId": "o_123", "carrier": "UPS" }
}
```

Key design choices an interviewer expects you to justify:

- **Event envelope vs. bare payload.** Wrap the domain data in an envelope with
  a stable `id`, `type`, and `created` timestamp. The `id` drives consumer
  idempotency; the `type` lets one endpoint route many event kinds; `created`
  supports ordering and staleness checks.
- **Thin vs. fat payloads.** A *thin* (or "notification") webhook sends only
  identifiers (`{"type":"order.shipped","orderId":"o_123"}`) and expects the
  consumer to call back the API for details. A *fat* payload embeds the full
  resource. Thin payloads avoid stale/oversized bodies and leak less data if a
  signature is ever bypassed, but cost the consumer an extra round trip. Fat
  payloads are self-contained but can arrive out of order and go stale.
- **Small, bounded bodies.** Never stream a 50 MB export through a webhook; send
  a reference/URL. Consumers time out and disconnect on large bodies.

> [!TIP]
> Include the event `type` and a schema `version` in the envelope. It lets you
> evolve the payload (add fields, ship `v2` events) without breaking existing
> subscribers, and lets a consumer's single endpoint fan out by type.

---

## Subscriptions and callback URL registration

Before any event flows, the consumer tells the producer *where* to send it.
This is usually a management endpoint:

```
POST /v1/webhook-endpoints HTTP/1.1
Content-Type: application/json

{
  "url": "https://consumer.example.com/hooks/orders",
  "events": ["order.shipped", "order.cancelled"],
  "description": "prod order sync"
}

HTTP/1.1 201 Created
{
  "id": "we_1a2b",
  "url": "https://consumer.example.com/hooks/orders",
  "events": ["order.shipped", "order.cancelled"],
  "secret": "whsec_9c...    ",          # shown ONCE — used to verify signatures
  "status": "enabled"
}
```

Design points interviewers probe:

- **HTTPS only.** Reject `http://` callback URLs; unencrypted webhooks leak
  payloads and are trivially spoofable.
- **The signing secret is returned once.** It is per-endpoint, high-entropy, and
  the consumer stores it to verify every future delivery. Support **secret
  rotation** (allow two active secrets during a rollover window).
- **Event filtering.** Let subscribers select event types so you do not send
  (and they do not have to reject) traffic they do not care about.
- **A confirmation / verification handshake.** Before enabling an endpoint, many
  producers send a `ping`/challenge event, or require the consumer to echo back
  a token, to prove the URL is controlled by whoever registered it (prevents
  using your infrastructure to flood a victim URL).

> [!WARNING]
> Accepting an arbitrary callback URL is an **SSRF** vector (OWASP API7:2023 —
> Server Side Request Forgery). Validate that the URL is public HTTPS and block
> internal ranges (`169.254.169.254`, `10.0.0.0/8`, `127.0.0.1`, `localhost`,
> `*.internal`) *at delivery time*, re-resolving DNS, to stop attackers from
> pointing your webhook sender at cloud metadata or internal services.

---

## Delivery guarantees and at-least-once semantics

The internet does not offer exactly-once delivery over HTTP. In practice
webhook systems provide **at-least-once** delivery: the producer keeps retrying
until it sees a success response, which means a consumer *will* occasionally
receive the same event more than once (a retry after a lost `200`, a network
partition, a producer restart mid-send).

What counts as "delivered"? By near-universal convention:

- **2xx (usually 200/201/204)** = accepted; stop retrying.
- **4xx** = client error. Most systems treat these as *permanent* failures and
  do **not** retry (e.g. `400`, `401`, `403`, `404`, `410 Gone`) — retrying a
  malformed or unauthorized request will never succeed. **`429 Too Many
  Requests`** is the exception: it means "slow down," so respect `Retry-After`
  and retry later.
- **5xx / timeouts / connection errors** = transient; retry with backoff.

> [!KEY-TAKEAWAY]
> Webhook delivery is **at-least-once, not exactly-once**. The consumer, not the
> producer, is responsible for de-duplicating. Design every consumer to be
> idempotent and never assume an event arrives exactly once or in order.

Two consequences interviewers love:

- **Ordering is not guaranteed.** Retries and parallel delivery mean
  `order.shipped` can arrive before `order.created`. If order matters, include a
  sequence number or timestamp and have the consumer reconcile, or fetch current
  state from the API rather than trusting event order.
- **Respond fast, process later.** The consumer should acknowledge with `2xx`
  *immediately* after durably enqueuing the event, then do heavy work
  asynchronously. Doing slow work before responding causes producer timeouts →
  spurious retries → duplicate processing.

---

## Retries and exponential backoff

When a delivery fails transiently, the producer retries. Retrying naively (a
tight loop, or every 1 s) hammers a struggling consumer and can synchronize a
"thundering herd." The standard is **exponential backoff with jitter**.

- **Exponential backoff:** wait `base * 2^attempt`, capped at a max — e.g. 10 s,
  30 s, 1 min, 5 min, 30 min, 2 h, up to N attempts over hours or days.
- **Jitter:** add randomness to the delay so many failed deliveries do not all
  retry at the same instant. *Full jitter* (`sleep = random(0, backoff)`) is the
  common recommendation to spread load.
- **A retry budget / max attempts:** give up after a bounded number of tries or
  a time window, then dead-letter (below).

If the consumer returns **`429`** or **`503`** with a **`Retry-After`** header,
the producer should honor it instead of its own schedule:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 120        # seconds (RFC 9110 §10.2.3); also accepts an HTTP-date
```

> [!WARNING]
> Retries are the mechanism that turns at-least-once into *duplicate*
> deliveries. You cannot have automatic retries AND guarantee single delivery —
> so retries and consumer idempotency are two halves of one design. If you add
> retries, you must add de-duplication downstream.

Idempotency-key semantics also apply here: many producers send the same
`Idempotency-Key`/`Webhook-Id` on every retry of the *same* event, so the
consumer can recognize "this is a retry, not a new event."

---

## Signing and verifying payloads (HMAC)

A webhook arrives at a public URL; anyone who learns that URL can `POST` forged
events. Signing proves the request genuinely came from the producer and was not
tampered with. The dominant scheme is a **keyed HMAC (RFC 2104), typically
HMAC-SHA256**, over the raw request body (and usually a timestamp), sent in a
header.

Producer side:

```
signature = HMAC_SHA256(secret, timestamp + "." + raw_body)
```

```
Webhook-Timestamp: 1710000000
Webhook-Signature: v1,5f8d...base64...   # scheme version + digest
```

Consumer verification steps:

1. Read the **raw** body bytes (not re-serialized JSON — re-encoding changes
   whitespace/key order and breaks the signature).
2. Recompute `HMAC_SHA256(secret, timestamp + "." + raw_body)`.
3. Compare using a **constant-time** comparison to avoid timing attacks.
4. Reject if it does not match (`400`/`401`).

Why HMAC and not something else:

- **HMAC (symmetric)** is fast and simple; both sides share the secret. The
  downside: the consumer *could* forge events to itself, and every consumer with
  the secret can create valid signatures. Fine for producer→consumer trust.
- **Asymmetric signatures (e.g. Ed25519/RSA, or a JWT/JWS payload)** let the
  producer sign with a private key and consumers verify with a public key —
  no shared secret to leak. Slack and Zoom moved toward this model; it is
  heavier but avoids distributing a symmetric secret to many parties.

> [!WARNING]
> Sign over the **raw bytes** and compare in **constant time**. Two classic
> bugs: (1) verifying against a re-serialized body (fails intermittently), and
> (2) using `==` on strings, which can leak the signature via timing.
> HTTPS (TLS) protects the transport but does **not** authenticate the sender —
> you still need signing, because anyone can open a TLS connection to your URL.

Support **multiple signatures per header** during secret rotation, e.g.
`v1,<sig-with-secretA> v1,<sig-with-secretB>`, so a consumer accepts either
during the overlap window.

---

## Replay protection: timestamps and nonces

Signing alone stops forgery but not **replay**: an attacker who captures one
valid signed request (or a well-meaning proxy that re-sends it) can `POST` the
exact bytes again — the signature still verifies. Two defenses, usually combined:

- **Signed timestamp + tolerance window.** Include the send time in the signed
  material (`Webhook-Timestamp`) and have the consumer **reject** deliveries
  whose timestamp is outside a tolerance (commonly ±5 minutes). Because the
  timestamp is inside the HMAC, an attacker cannot rewrite it without the
  secret. This bounds the replay window and also protects against clock-skew
  abuse.

  ```
  if abs(now - webhook_timestamp) > 300:   # 5 minutes
      reject(400)  # possible replay / stale delivery
  ```

- **Nonce / event-id de-duplication.** Record each delivery's unique id
  (`Webhook-Id`/event id) and reject or ignore ids already seen. This closes the
  gap *within* the tolerance window and doubles as consumer idempotency.

> [!KEY-TAKEAWAY]
> Signature = "this came from the producer and was not modified." Timestamp +
> nonce = "and it is not a stale copy being replayed." You need both: a valid
> signature does not tell you *when* the request was captured.

Advanced gotcha: the tolerance must be wide enough for legitimate retries and
clock skew but narrow enough to limit replay exposure. Store nonces at least as
long as the tolerance window (e.g. keep seen ids for 5–10 minutes) or you leave
a replay hole.

---

## Idempotent webhook consumers

Because delivery is at-least-once, **the consumer must be idempotent**:
processing the same event twice must have the same effect as processing it once.
This is the single most important consumer-side discipline.

The standard implementation:

1. Extract the stable event id (`evt_88ah2`) from the envelope.
2. Attempt to record it in a de-duplication store with a **uniqueness
   constraint** (unique key on `event_id`). This should be atomic with — or
   guard — the side effect.
3. If the id is new, process and commit. If it already exists, **acknowledge with
   `2xx` and do nothing** (do not re-run the side effect; do not error).

```
POST /hooks/orders
{ "id": "evt_88ah2", "type": "order.shipped", ... }

-- consumer:
INSERT INTO processed_events(event_id) VALUES ('evt_88ah2');
   ok        -> process, then 200
   conflict  -> already handled, return 200 (idempotent no-op)
```

Nuances interviewers probe:

- **Return `2xx` for duplicates**, not an error. A `409`/`500` on a duplicate
  makes the producer retry *forever*, amplifying the problem.
- **De-dup must cover the side effect, not just the HTTP layer.** If you record
  the id but crash before the DB write, you have "processed" nothing. Wrap the
  effect and the id-insert in one transaction, or use the effect's own natural
  idempotency (e.g. upsert by resource id).
- **Handle out-of-order + duplicate together.** Prefer operations that are
  order-independent (set state to a value carried in the event, keyed by
  resource id and a version/timestamp) over deltas (increment by 1), which
  break under duplicates.

---

## 202 Accepted and the polling / status-resource pattern

When an operation is too slow to finish within a request (video transcode,
bulk import, report generation), do not hold the connection open. Return
**`202 Accepted`** (RFC 9110 §15.3.3) — "I have accepted the request for
processing, but processing is not complete" — and hand back a **status
resource** the client can poll.

```
POST /v1/reports HTTP/1.1
Content-Type: application/json
{ "type": "annual", "year": 2025 }

HTTP/1.1 202 Accepted
Location: /v1/reports/rep_9f2/status      # where to check progress
Content-Type: application/json
{ "id": "rep_9f2", "status": "pending" }
```

The client then polls the status resource:

```
GET /v1/reports/rep_9f2/status HTTP/1.1

HTTP/1.1 200 OK
Retry-After: 5                            # hint: poll again in ~5s
{ "id": "rep_9f2", "status": "running", "progress": 0.4 }
```

When finished, the status resource points to the result — often via `303 See
Other` or a `Link` header (RFC 8288):

```
HTTP/1.1 200 OK
{
  "id": "rep_9f2",
  "status": "succeeded",
  "result": { "href": "/v1/reports/rep_9f2/download" }
}
```

Design points:

- **`202` means "accepted," not "done" and not "created."** Use `201 Created`
  only when the resource exists synchronously; use `200` for a completed
  synchronous op. `202` explicitly disclaims completion.
- **The status resource is a first-class GET-able URL** with its own lifecycle
  (`pending → running → succeeded | failed`). Include `Retry-After` to guide
  poll frequency and avoid stampedes.
- **On failure, describe it with RFC 9457 Problem Details** in the status body
  (`type`, `title`, `status`, `detail`) rather than an opaque `"failed"`.

> [!TIP]
> This is the async-request-reply pattern *without* requiring the client to run
> a server. It works behind firewalls, degrades gracefully, and is the safe
> default when you cannot assume the client can receive a callback.

---

## Async request-reply and callback URLs

Two families solve "the answer isn't ready yet":

1. **Poll a status resource** (above) — the client pulls. Simple, firewall-
   friendly, no client server needed.
2. **Callback URL** — the client includes a URL in the *request*, and the server
   `POST`s the result there when done (a one-shot, per-request webhook).

```
POST /v1/transcode HTTP/1.1
{ "source": "s3://in/clip.mov", "callbackUrl": "https://me.app/cb/xyz" }

HTTP/1.1 202 Accepted
{ "id": "job_7", "status": "queued" }

... later, server -> client's callback:
POST /cb/xyz HTTP/1.1
{ "id": "job_7", "status": "succeeded", "output": "s3://out/clip.mp4" }
```

Choosing between them:

| | Status polling | Callback URL |
|---|---|---|
| Client runs a server | No | Yes (must be reachable) |
| Latency to result | Poll interval | Immediate on completion |
| Firewall/NAT friendly | Yes | No |
| Security | Client auth as usual | Callback must be signed/verified (SSRF risk) |
| Best for | Client apps, browsers, CLIs | Server-to-server integrations |

A robust API often supports **both**: return `202` + a status URL *and* accept
an optional `callbackUrl`, so simple clients poll and advanced clients get
pushed. Callback URLs carry the same security burden as any webhook — validate
the URL (SSRF), sign the callback, and treat delivery as at-least-once.

> [!INTERVIEW]
> A frequent question: "Long-running upload — how do you design the API?" Strong
> answer: `202 Accepted` with a `Location` pointing to a status resource that
> reports `pending/running/succeeded/failed`, `Retry-After` to pace polling,
> Problem Details on failure, and *optionally* a callback/webhook for clients
> that can receive push. Mention that `202` disclaims completion and that the
> operation should be idempotent (safe to resubmit) or protected by an
> idempotency key.

---

## Webhooks vs polling vs SSE vs WebSockets

"How should the client learn about server-side events?" has four common answers.
Interviewers want you to pick by *constraints*, not fashion.

| | Polling | Webhooks | SSE | WebSockets |
|---|---|---|---|---|
| Direction | Client pull | Server→consumer push | Server→client push | Full duplex |
| Transport | Repeated HTTP `GET` | HTTP `POST` to a URL | One long-lived HTTP response (`text/event-stream`) | TCP upgrade (`ws://`/`wss://`) |
| Who runs a server | Producer only | Consumer needs public URL | Producer only | Both endpoints, persistent conn |
| Latency | Poll interval | Near real-time | Real-time | Real-time |
| Client type | Anything | Server-to-server | Browsers/clients (auto-reconnect) | Browsers/apps needing 2-way |
| Firewall friendly | Best | Consumer must be reachable | Good (plain HTTP) | Usually, over 443 |
| Complexity/cost | Low | Medium (retries, signing, DLQ) | Low–medium (open connections) | High (stateful connections) |
| Reconnect/replay | N/A | Producer retries | Built-in (`Last-Event-ID`) | App-defined |

Rules of thumb:

- **Server-to-server, event-driven, integrator receives events:** webhooks.
- **Client can't run a server / behind firewall / occasional check:** polling.
- **Server→browser stream, one direction (live feed, progress, notifications):**
  SSE — it is just HTTP, auto-reconnects, and carries `Last-Event-ID` for resume.
- **Low-latency bidirectional (chat, collaborative editing, games):**
  WebSockets — but you pay for stateful, long-lived connections.

> [!KEY-TAKEAWAY]
> Webhooks push server→*consumer-server*; SSE and WebSockets push over a
> *persistent connection the client opened*. If the recipient cannot expose a
> public URL, webhooks are off the table — SSE/WebSockets/polling remain because
> the client initiates the connection.

---

## Dead-letter handling and delivery observability

Retries eventually run out. A delivery that fails past its max attempts must not
vanish silently — it goes to a **dead-letter queue (DLQ)**: durable storage of
undeliverable events for inspection, alerting, and manual/automated replay.

What a mature webhook system exposes:

- **A dead-letter store** of exhausted deliveries, with the original payload,
  headers, and the failure reason/response, so events are never lost.
- **Manual + bulk redelivery.** Let integrators re-send a specific event or
  replay a time range after they fix their endpoint. Redelivery reuses the
  original event id so idempotent consumers de-dup correctly.
- **A delivery log / dashboard.** Per-delivery records: timestamp, response
  status, latency, attempt number, next retry time. Essential for debugging
  "we never got the event" support tickets.
- **Endpoint auto-disabling.** If an endpoint fails continuously for a long
  window (e.g. days), disable it and notify the owner rather than retrying a dead
  URL forever.
- **Metrics + alerts.** Delivery success rate, retry rate, DLQ depth, p99
  delivery latency. A rising DLQ depth or falling success rate is the signal
  something is broken.

> [!WARNING]
> Without a DLQ, an outage on the consumer side means **silent, permanent event
> loss** once retries are exhausted. The DLQ + redelivery is what makes "at least
> once" actually mean "eventually delivered." Always pair retries with a dead-
> letter path and observability.

From the *consumer's* side, observability matters too: log every received event
id, alert on signature-verification failures (possible attack or secret
mismatch), and monitor how long processing lags behind delivery.

---

## Common follow-up questions

- **"Webhooks are at-least-once — how do you prevent double-processing?"**
  Idempotent consumer: de-dup on the stable event id with a uniqueness
  constraint, return `2xx` for duplicates, and keep the side effect
  order-independent.
- **"How do you verify a webhook really came from us?"** Shared-secret
  HMAC-SHA256 over the raw body + timestamp, sent in a signature header; verify
  with a constant-time comparison. TLS alone is not enough — it protects
  transport, not sender identity.
- **"Someone captured a valid signed request and re-sends it — what stops
  them?"** Replay protection: a signed timestamp with a tolerance window (±5 min)
  plus nonce/event-id de-duplication.
- **"Which HTTP status should a long-running POST return?"** `202 Accepted` with
  a `Location`/status resource to poll; not `200` (implies done) or `201`
  (implies created synchronously).
- **"When would you choose polling over webhooks?"** Consumer can't expose a
  public URL, is behind a firewall/NAT, low event volume, or you want the
  simplest possible integration.
- **"Webhook vs SSE vs WebSocket?"** Webhook = server→consumer-server push
  (integrations); SSE = one-way server→client stream over HTTP with reconnect;
  WebSocket = bidirectional persistent connection (chat/collab).
- **"What happens after retries are exhausted?"** Dead-letter the event, alert,
  optionally auto-disable the endpoint, and offer redelivery once it is fixed.
- **"Consumer takes 30 s to process — what's the anti-pattern?"** Doing the work
  before responding; the producer times out and retries. Ack fast (enqueue +
  `2xx`), process async.
- **"How do you roll a webhook signing secret without downtime?"** Dual secrets:
  emit two signatures (or accept two) during an overlap window, then retire the
  old one.

## References

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) —
  §9.2 safe/idempotent methods, §15.3.3 `202 Accepted`, §15.3.4 `203`/status
  codes, §10.2.3 `Retry-After`, `429`/`503` semantics.
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
  (2023, obsoletes RFC 7807) — structured error bodies for failed async jobs.
- [RFC 8288 — Web Linking](https://www.rfc-editor.org/rfc/rfc8288.html) — the
  `Link` header for pointing a status resource at its result.
- [RFC 2104 — HMAC: Keyed-Hashing for Message Authentication](https://www.rfc-editor.org/rfc/rfc2104).
- [RFC 6234 — US Secure Hash Algorithms (SHA)](https://www.rfc-editor.org/rfc/rfc6234)
  / FIPS 180-4.
- [RFC 7519 — JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519.html)
  — when signing webhook payloads as JWS instead of a raw HMAC header.
- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  — API7:2023 Server Side Request Forgery (callback-URL/SSRF risk).
- [Stripe — Webhook signatures](https://docs.stripe.com/webhooks/signatures) —
  reference implementation of timestamped HMAC signing + tolerance.
- [GitHub — Securing webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
  — HMAC-SHA256 delivery signatures.
- [Standard Webhooks specification](https://www.standardwebhooks.com/) — an
  emerging cross-vendor convention for signing, ids, and timestamps.
- [MDN — Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
  and [WebSockets API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
  — comparison baselines.
