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

## The CloudEvents standard

The ad-hoc `{ id, type, created, data }` envelope shown earlier is exactly the
shape **CloudEvents** standardizes. **CloudEvents 1.0** is a CNCF (Cloud Native
Computing Foundation) specification for describing event data in a common,
vendor-neutral way, so an event emitted by one system can be consumed by another
without bespoke parsing. Interviewers increasingly name-drop it as *the* answer
to "how would you standardize your event envelope?"

REQUIRED context attributes on every CloudEvent:

- **`id`** — unique per (source, id) pair; the consumer's de-dup key. Producers
  MUST ensure `source` + `id` is unique.
- **`source`** — a URI-reference identifying the context the event happened in
  (e.g. `/orders/service` or `https://github.com/cloudevents`).
- **`specversion`** — the CloudEvents spec version, `"1.0"`.
- **`type`** — the event kind, conventionally reverse-DNS
  (`com.github.pull_request.opened`), used for routing and versioning.

OPTIONAL attributes: **`subject`** (the specific subject within the source, e.g.
the object key), **`time`** (RFC 3339 timestamp), **`datacontenttype`** (media
type of `data`, defaults to `application/json` behavior when absent),
**`dataschema`** (URI of the schema for `data`), and the payload itself in
**`data`**.

```json
{
  "specversion": "1.0",
  "id": "A234-1234-1234",
  "source": "/orders/service",
  "type": "com.example.order.shipped",
  "subject": "orders/o_123",
  "time": "2026-07-19T12:00:00Z",
  "datacontenttype": "application/json",
  "data": { "orderId": "o_123", "carrier": "UPS" }
}
```

### HTTP protocol binding: content modes

CloudEvents defines three ways to map an event onto an HTTP message:

- **Binary mode** — the `data` is the raw HTTP body (with its own
  `Content-Type`), and every context attribute becomes a header prefixed `ce-`:
  `ce-id`, `ce-source`, `ce-specversion`, `ce-type`, `ce-subject`, `ce-time`.
  This keeps the payload untouched (efficient for large/binary data and lets
  infrastructure route on headers without parsing the body).
- **Structured mode** — the entire event (attributes *and* data) is a single
  JSON document in the body with `Content-Type: application/cloudevents+json`.
  Self-contained and easy to forward across transports without losing metadata.
- **Batch mode** — an array of structured events with
  `Content-Type: application/cloudevents-batch+json`.

> [!INTERVIEW]
> "Binary vs structured for a Kafka-backed webhook gateway?" Binary mode maps
> attributes to `ce-*` headers so the gateway can route/filter without
> deserializing the payload, and the raw `data` passes through untouched —
> efficient at high volume. Structured mode is better when an event must cross
> several hops/transports and must stay self-describing end to end. Many gateways
> ingest binary at the edge and re-emit structured downstream.

---

## The Standard Webhooks specification

The `Webhook-Id` / `Webhook-Timestamp` / `Webhook-Signature` headers used
earlier come from **Standard Webhooks**, an open, cross-vendor spec (adopted by
the likes of OpenAI, Twilio, and others) that pins down the signing conventions
different providers had reinvented. Knowing it by name turns "some HMAC header"
into a citable standard.

Core rules:

- **Signed content is `msg_id.timestamp.payload`** — the message id, the unix
  timestamp, and the raw body, joined by dots (`.`). This binds the id and
  timestamp into the signature, giving replay protection for free.
- **Symmetric signature format is `v1,<base64>`** — scheme version, comma, then
  the base64 HMAC-SHA256 digest. The signing secret is prefixed **`whsec_`** and
  should be **24–64 bytes** of entropy.
- **Multiple signatures are space-delimited** in one header
  (`v1,<sigA> v1,<sigB>`), which is what enables **zero-downtime secret
  rotation**: sign with both old and new secrets during the overlap window.
- **Asymmetric variant `v1a` = Ed25519.** The producer signs with an Ed25519
  private key (`whsk_` prefix) and consumers verify with the public key
  (`whpk_` prefix). The spec advises **preferring asymmetric** signing where
  practical.
- **Keys must be unique per endpoint.** Reusing one secret across multiple
  customers is called out as a vulnerability: a leak by one consumer would let
  them forge events destined for another.

> [!INTERVIEW]
> "HMAC vs Ed25519 — when force asymmetric?" When there are **many, mutually
> untrusted consumers**, or the consumer cannot be trusted with signing power. A
> shared HMAC secret lets *any* holder forge valid events (including forging
> events "from the producer" to a third party if secrets are shared). Ed25519
> (`v1a`) gives each consumer only a public key — they can verify but never
> forge — at the cost of slower verification and public-key distribution.

---

## Subscription verification handshakes

Registration alone does not prove the registrant controls the URL. Before
enabling an endpoint (or a subscription), producers run a **verification
handshake**. Two families dominate:

**1. Challenge–response echo.** The producer sends a token and requires the
endpoint to echo it back verbatim, proving the endpoint is live and controlled:

- *Meta / Facebook* — `GET` the callback with
  `?hub.mode=subscribe&hub.challenge=<token>&hub.verify_token=<shared>`; the
  endpoint must return the exact `hub.challenge` value as the body.
- *Slack Events API* — sends a JSON `{"type":"url_verification","challenge":"…"}`
  and expects the `challenge` string echoed back.
- *Twitch EventSub* — sends a `webhook_callback_verification` request whose
  `challenge` must be returned in the response body.

**2. WebSub (W3C Recommendation, formerly PubSubHubbub).** The standardized
pub/sub-over-webhooks protocol. A subscriber `POST`s to the hub with
`hub.mode=subscribe`, `hub.topic`, and `hub.callback`; the hub then verifies
intent by hitting the callback with `hub.mode`, `hub.topic`, a `hub.challenge`
to echo, and **`hub.lease_seconds`** (subscriptions are *leased* and must be
renewed before they expire).

```
GET /hooks/orders?hub.mode=subscribe&hub.challenge=Ab3Xy&hub.lease_seconds=864000 HTTP/1.1

HTTP/1.1 200 OK
Ab3Xy                     # echo the exact challenge to confirm the subscription
```

> [!KEY-TAKEAWAY]
> A verification handshake ties a subscription to *proven control of the
> callback URL*. Without it, anyone could register a victim's URL and weaponize
> your delivery fleet to flood them (a reflected-DoS / SSRF amplifier).

---

## Fan-out, ordering, and consumer scaling

**Thundering herd on fan-out.** One popular event (say a status-page incident,
or a price change) may have thousands or millions of subscribers. Naively
dispatching all deliveries at once creates a burst that overwhelms your own
egress fleet *and* stampedes any shared downstream. Mitigations:

- **Jittered dispatch scheduling** — spread the fan-out over a short window
  instead of firing simultaneously.
- **Per-endpoint rate limiting / token buckets** — never send a single consumer
  more than it can absorb; smooth bursts per destination.
- **Sharded / partitioned delivery queues** — partition work (e.g. by endpoint
  or tenant) so one slow consumer's backlog does not block others (head-of-line
  blocking) and you can scale workers horizontally.
- **Backpressure** — when queues grow, slow producers or shed/deprioritize
  rather than melting down.

**The reverse herd.** When a widely-used consumer recovers from an outage, every
producer's accumulated retries fire at once — a *retry storm* against the
just-recovered endpoint. Jitter, capped concurrency per endpoint, and staggered
redelivery from the DLQ tame it.

**Ordering guarantees.** The base contract is "no ordering." If a customer needs
order, mechanisms (in increasing strength) are:

- **Monotonic sequence numbers** in the envelope so the consumer can detect gaps
  and reorder, discarding anything older than what it has applied.
- **Per-aggregate / partition-key ordering** — guarantee order only *within* a
  key (Kafka-style keyed partitions: all events for `order o_123` go to one
  partition and are delivered in order), never globally.
- **Consumer-side reordering buffers** — briefly hold events to resequence.
- **Thin payload + fetch-current-state** — the robust escape hatch: the event is
  a hint, the consumer `GET`s authoritative current state, so out-of-order
  arrival cannot corrupt it.

> [!INTERVIEW]
> "Customer says events arrive out of order and it breaks their ledger — fix it
> at the contract level." Options, cheapest first: (1) document *no ordering* and
> have them fetch current state (thin payload); (2) add a monotonic `sequence`
> per resource so they can discard stale updates; (3) offer per-key ordered
> delivery via partitioning if they truly need it. Global total ordering across
> all events is almost never worth the throughput cost.

---

## Producer-side reliability: the transactional outbox

Consumer idempotency handles duplicates, but there is a symmetric *producer*
problem: **the dual-write problem.** The producer must commit a state change to
its database *and* emit the webhook/event. If these are two separate operations
and the process crashes between them, you either lose the event (committed the
order, never sent `order.created`) or emit a phantom event (sent it, then the
DB transaction rolled back).

The **transactional outbox** pattern solves this: within the *same database
transaction* that makes the state change, insert a row into an `outbox` table.
The commit is atomic — either both the business change and the outbox row
persist, or neither does. A separate **relay** process (or Change Data Capture /
CDC tailing the DB log) then reads the outbox and delivers the webhook,
marking rows sent. Because the relay is at-least-once, this pairs naturally with
consumer idempotency on the event id.

```
BEGIN;
  UPDATE orders SET status='shipped' WHERE id='o_123';
  INSERT INTO outbox(event_id, type, payload) VALUES ('evt_88ah2','order.shipped', …);
COMMIT;                       -- both or neither
-- relay: SELECT unsent FROM outbox → deliver webhook → mark sent (retry on failure)
```

> [!KEY-TAKEAWAY]
> The outbox turns "commit state" and "emit event" into one atomic write, then
> delivers asynchronously. It is the producer-side mirror of consumer
> idempotency: the outbox guarantees the event is *never lost*, and the event id
> lets the consumer guarantee it is *never double-applied*.

---

## Structured long-running operations

The ad-hoc status resource can be given a canonical shape. Two named industry
patterns show up in interviews:

**Google AIP-151 — Long-Running Operations (LRO).** A method that cannot finish
quickly (rule of thumb: **>10 seconds**) returns an **`Operation`** resource:

- **`name`** — the operation's resource id (pollable).
- **`done`** — boolean; false while running.
- **`metadata`** — progress/percent, ETA, and other type-specific info.
- a result **oneof**: **`response`** (the success payload) **or** **`error`** (a
  `google.rpc.Status` with `code`, `message`, `details`) — never both.

Standard verbs operate on it: `GetOperation`, `ListOperations`,
`CancelOperation`, `DeleteOperation`. Operations **expire** (commonly ~30 days),
after which they are garbage-collected.

**Azure-style async monitor.** The service returns **`202 Accepted`** with a
**`Location`** header pointing to a *status-monitor* URL. Polling that URL
returns **`200 OK`** while the operation is still running (with `Retry-After`),
then a **`302`/`303`** redirect to the final result resource once complete. This
is header-driven, versus Google's operation-resource-driven model.

**Cancellation of in-flight work.** Neither the base status pattern nor webhooks
covered aborting a running job. Real systems must let clients stop long
operations:

- A **`DELETE`** on the operation, or a dedicated `:cancel` verb
  (`CancelOperation` in AIP-151), requests best-effort abort; the operation then
  transitions to a terminal `cancelled` state.
- **`409 Conflict`** (with `ABORTED` semantics) is the right answer when a
  concurrent/parallel operation is rejected because it conflicts with one
  already in progress.

> [!INTERVIEW]
> "Consumer needs to cancel a 2-hour transcode — design it." Model the job as a
> resource with a state machine (`queued → running → succeeded | failed |
> cancelled`). Expose `DELETE /jobs/{id}` or `POST /jobs/{id}:cancel` that
> requests cancellation (best-effort, may race with completion). Return the
> current state; if the job already finished, say so rather than pretending it
> cancelled. Represent a failed job's error with RFC 9457 Problem Details (or
> `google.rpc.Status` in an LRO), not an opaque `"failed"`.

---

## Documenting async in the API contract: OpenAPI webhooks vs callbacks

How you *specify* asynchronous flows in the machine-readable contract is squarely
on-topic for API design. **OpenAPI 3.1** offers two distinct objects:

- **Root-level `webhooks`** (new in OpenAPI 3.1) — describes **provider-initiated,
  out-of-band** requests the API sends that are *not* tied to any specific
  operation the client called (e.g. "we will POST `newPet` events to your
  registered URL"). It is a map of named webhooks at the document root.
- **Operation-level `callbacks`** — describes requests the API will send **as a
  consequence of a specific operation**, keyed by a **runtime expression** that
  resolves against that request, e.g. `$request.body#/callbackUrl`. This ties the
  callback to the exact operation and the URL the client supplied in it.

```yaml
paths:
  /subscribe:
    post:
      requestBody:
        content: { application/json: { schema: { properties: { callbackUrl: { type: string, format: uri } } } } }
      callbacks:
        onEvent:
          '{$request.body#/callbackUrl}':          # runtime expression → the client's URL
            post:
              requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Event' } } } }
              responses: { '200': { description: consumer acknowledged } }
webhooks:                                            # provider-initiated, not tied to a call
  orderShipped:
    post:
      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Event' } } } }
```

> [!KEY-TAKEAWAY]
> `callbacks` = "in response to *this* operation, we will call the URL you passed
> in it" (keyed by a runtime expression). `webhooks` = "independently of any
> call, we may push these events to your subscribed endpoint." Use callbacks for
> per-request async replies, webhooks for standing subscriptions.

---

## Hardening: SSRF defense-in-depth

The SSRF warning earlier said *what* to block; senior interviews probe *how*.
Layer these defenses because any single one fails:

- **Validate at registration AND re-resolve at delivery time.** Checking the URL
  only when it is registered is defeated by **DNS rebinding**: the attacker's
  domain resolves to a public IP at registration and to `169.254.169.254` (or an
  internal IP) at delivery. Re-resolve DNS and validate the *actual connect-time
  IP*, and pin the connection to that validated IP.
- **Block internal/link-local ranges** — the cloud metadata endpoint
  `169.254.169.254`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `::1`, and `*.internal` names — after resolution, not just
  on the literal hostname.
- **Egress proxy / filter.** Route all outbound webhook traffic through a
  dedicated egress proxy that enforces the denylist. Stripe open-sourced
  **Smokescreen** for exactly this. The delivery fleet is not allowed to make
  arbitrary outbound connections directly.
- **Network isolation.** Run webhook-sender workers in a **private subnet with no
  route to internal services** (and no IMDS access), so even a bypassed filter
  cannot reach anything sensitive.

> [!INTERVIEW]
> "Walk the exact SSRF exploit and your layered defenses." Attacker registers a
> callback URL on a domain they control that, at *delivery* time, resolves to
> `169.254.169.254`; your sender fetches cloud instance credentials and reflects
> them into the response body or a follow-up. Defenses: re-resolve + validate the
> connect-time IP (kills DNS rebinding), run senders behind an egress filter
> (Smokescreen) in an isolated subnet with IMDS blocked, and require signed,
> verified callbacks so a reflected internal response is never trusted.

---

## Payload minimization and data-residency

Thin vs fat was framed earlier around staleness; there is also a
**security/compliance** driver. Fat payloads push full resource data — often
including PII — through many hands: the consumer's logs, any intermediary
proxies/CDNs, and error-tracking systems that capture request bodies. That
widens the **blast radius** of a leak and can violate **GDPR data-minimization**
or **data-residency** rules (data crossing regions in a webhook body).

A **thin payload plus an authenticated callback** to fetch details keeps
sensitive data on the authenticated API path, under access control and audit,
rather than sprayed across delivery infrastructure. For regulated data this is
frequently the deciding factor, independent of staleness.

> [!KEY-TAKEAWAY]
> Prefer thin payloads not only to avoid stale data but to minimize PII exposure:
> a signed notification with ids leaks far less than a fat body if it lands in a
> log, a proxy cache, or the wrong region.

---

## At-least-once corner cases: dedupe TTL vs replay window

A subtle but real inconsistency trips people up: the **replay-protection window**
and the **de-duplication retention window are different durations** and must not
be conflated.

- The **replay tolerance** (±5 min) and the **nonce store** that backs it exist
  to reject *maliciously replayed* old requests. Keeping seen ids for ~5–10
  minutes is enough there.
- **Retry-based duplicates**, however, can arrive **hours or days** later — a
  legitimate retry of a real event after a long backoff or a DLQ redelivery. To
  de-dup *those*, the idempotency store must retain event ids **at least as long
  as the maximum retry/redelivery window**, which is measured in days, not
  minutes.

If your dedupe store TTL is 5 minutes but a retry arrives 6 hours later, the
consumer no longer recognizes the id and **double-processes** the event. The fix
is to size the idempotency store to exceed the entire retry horizon (accepting
the storage cost), separate from the short replay-nonce window. This is also why
the crash-between-effect-and-record failure mode matters — use a transactional
outbox / dedupe write so the record and effect commit together.

> [!WARNING]
> Do not reuse the 5-minute replay window as your idempotency TTL. Replay defense
> guards against *malicious* re-sends within minutes; duplicate suppression must
> survive the *entire* retry/redelivery horizon (days). Two different clocks.

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
- [CloudEvents 1.0 specification](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)
  (CNCF) — vendor-neutral event envelope; REQUIRED `id`/`source`/`specversion`/`type`.
- [CloudEvents HTTP Protocol Binding](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/bindings/http-protocol-binding.md)
  — binary (`ce-*` headers), structured (`application/cloudevents+json`), and batch modes.
- [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
  — `msg_id.timestamp.payload` signing, `v1`/`v1a` (Ed25519), `whsec_`/`whsk_`/`whpk_` keys, rotation.
- [OpenAPI Specification 3.1.0](https://spec.openapis.org/oas/v3.1.0) — root-level
  `webhooks` object and Operation-level `callbacks` object with runtime expressions.
- [Google AIP-151 — Long-Running Operations](https://google.aip.dev/151) —
  `Operation` resource (`name`/`done`/`metadata`/`response`|`error`), cancel/list/delete.
- [Microsoft Azure — Asynchronous Request-Reply](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)
  — `202` + `Location` status-monitor → `302`/`303` to result.
- [W3C WebSub](https://www.w3.org/TR/websub/) — standardized subscribe/verify
  (`hub.mode`, `hub.challenge`, `hub.lease_seconds`).
- [Stripe Smokescreen](https://github.com/stripe/smokescreen) — open-source SSRF
  egress proxy for filtering outbound (webhook) traffic.
