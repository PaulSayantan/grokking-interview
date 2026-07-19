# WebSockets & Server-Sent Events (SSE)

HTTP's classic request/response model is fundamentally **client-driven**: the server can
only speak when spoken to. Real-time features — chat, live scores, collaborative editors,
trading tickers, notifications — need the *server* to push data to the client as events
happen. This topic covers the techniques that solve that problem at the protocol level:
short polling, long polling, **WebSocket** (RFC 6455, a distinct TCP-based protocol
bootstrapped from HTTP), and **Server-Sent Events / SSE** (a WHATWG standard that streams
events over a plain HTTP response). It stays at protocol/mechanics altitude — handshakes,
framing, headers, reconnect — not framework APIs.

> [!KEY-TAKEAWAY]
> WebSocket = **full-duplex**, bidirectional, binary-or-text, its own framed protocol over
> one TCP connection (upgraded from HTTP). SSE = **one-way** server→client, UTF-8 text
> only, plain `text/event-stream` HTTP response with built-in auto-reconnect. Polling =
> the client repeatedly asks over ordinary HTTP requests. Pick by direction, payload type,
> and infrastructure friendliness.

---

## The polling problem

**Why it matters.** Plain HTTP is half-duplex request/response and strictly
client-initiated. A server that learns something new (a new chat message, a price change)
has **no channel** to tell an already-loaded page. Historically the only workaround was to
have the client *ask again*. This is "polling," and it forces an awkward trade-off between
**latency** (how fresh the data is) and **overhead** (wasted requests/CPU/bandwidth).

The core tension:

- Poll **too often** → most responses are "nothing new," wasting a full HTTP round trip
  (TCP/TLS state, request/response headers, server work) each time.
- Poll **too rarely** → data is stale; the user sees an event seconds or minutes late.

Every HTTP request also carries **header overhead** (cookies, `User-Agent`, `Accept`,
etc.) that can dwarf a tiny "no updates" payload. At scale (say 100k clients polling every
2s), that is 50k requests/second of mostly-empty traffic. This overhead is what pushed the
industry toward long polling and then toward true push protocols (WebSocket, SSE).

> [!INTERVIEW]
> A classic opener: "The user needs live updates but HTTP is request/response — how?"
> Walk the ladder: short poll → long poll → SSE/WebSocket, naming the trade-off each rung
> removes (freshness vs. overhead vs. complexity vs. proxy-friendliness).

---

## Short polling vs long polling

Both use ordinary HTTP requests; they differ in **when the server responds**.

**Short polling.** The client sends a request on a fixed interval (e.g. every 3s). The
server answers **immediately** with either new data or an empty "nothing yet" response.
Simple and stateless, but wasteful and adds up to `interval` of latency.

**Long polling.** The client sends a request and the server **holds it open** (does not
respond) until it actually has data or a timeout fires. On response the client immediately
opens a new request. This gives near-real-time delivery over standard HTTP with no special
protocol — it works through virtually every proxy and firewall.

```
Short poll:                          Long poll:
C --GET /updates--> S  (empty)       C --GET /updates--> S     (server holds…)
   ...wait 3s...                          ...event occurs...
C --GET /updates--> S  (empty)       C <---- 200 {event} ---- S
   ...wait 3s...                      C --GET /updates--> S     (holds again)
C --GET /updates--> S  ({event})
```

Long-polling trade-offs / gotchas:

- **Latency**: near-instant on the *first* event, but there is a race window while the
  client is re-establishing the next request during which server events can be missed
  unless the server buffers by cursor/sequence id.
- **Server cost**: each waiting client ties up a connection (and, on thread-per-request
  servers, a thread) doing nothing — a scalability problem async servers mitigate.
- **Proxy timeouts**: intermediaries may kill idle connections, so servers cap the hold
  (e.g. 30–60s) and return empty, prompting a fresh poll.

> [!TIP]
> Long polling is still the standard **fallback** in libraries like Socket.IO when a
> WebSocket upgrade fails (blocked by a corporate proxy). It is not obsolete — it is the
> lowest-common-denominator that works nearly everywhere.

---

## WebSocket HTTP Upgrade handshake

**Why it matters.** WebSocket (RFC 6455) is a *separate* protocol (`ws://` / `wss://`),
but it deliberately **starts life as an HTTP/1.1 request** so it can share ports 80/443 and
traverse HTTP infrastructure. The opening handshake is an HTTP `GET` with an `Upgrade`
header; a successful server reply is **`101 Switching Protocols`**, after which the bytes on
that TCP connection are no longer HTTP — they are WebSocket frames.

Client request:

```
GET /chat HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Sec-WebSocket-Protocol: chat, superchat        (optional subprotocol negotiation)
Origin: https://example.com                    (browsers send this; server checks it)
```

Server response:

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
Sec-WebSocket-Protocol: chat
```

The **`Sec-WebSocket-Accept`** value is computed deterministically:

```
accept = base64( SHA1( Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" ) )
```

The magic GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` is a fixed constant from RFC 6455.
This is **not** security — the `Sec-WebSocket-Key` is a random base64 nonce, not a secret.
Its purpose is to prove the server actually understands WebSocket (and to defend against
caching proxies / cross-protocol attacks replaying a plain HTTP response). `Sec-WebSocket-
Version: 13` is the only version defined by RFC 6455.

Key facts interviewers probe:

- Status **101**, not 200. The `Connection: Upgrade` + `Upgrade: websocket` header pair is
  mandatory (these are hop-by-hop headers, which is why some proxies must be configured to
  forward them).
- After 101 the connection is a persistent, **full-duplex** TCP pipe; there is no more HTTP
  request/response structure.
- `Sec-WebSocket-Protocol` negotiates an application **subprotocol** (e.g. `wamp`, a chat
  format); the server echoes the one it picked. `Sec-WebSocket-Extensions` negotiates
  wire-level extensions like `permessage-deflate` compression.
- `wss://` runs the same handshake **inside TLS** on 443. Prefer it: `wss` handshakes
  survive intercepting proxies far better than plaintext `ws`.

> [!WARNING]
> The handshake is HTTP/1.1-shaped. Native WebSocket over HTTP/2 uses a different mechanism
> (extended CONNECT, RFC 8441) and over HTTP/3 (RFC 9220). The classic
> `Upgrade: websocket` header does **not** exist in HTTP/2 — HTTP/2 removed the `Upgrade`
> mechanism entirely.

---

## WebSocket framing and full-duplex data transfer

Once open, data moves as **frames**, not HTTP messages. Each frame has a compact binary
header (RFC 6455 §5.2):

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |                               |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
```

Fields:

- **FIN** (1 bit): last frame of a message. A message can be split across many frames
  (fragmentation) using FIN=0 continuation frames.
- **RSV1–3**: reserved, 0 unless an extension (e.g. `permessage-deflate` uses RSV1) is
  negotiated.
- **opcode** (4 bits): frame type —
  `0x0` continuation, `0x1` text (UTF-8), `0x2` binary,
  `0x8` close, `0x9` ping, `0xA` pong. `0x3–0x7` and `0xB–0xF` reserved.
- **MASK** (1 bit) + **Masking-key** (32 bits): see below.
- **Payload len**: 7 bits. If value is 0–125 that *is* the length; **126** means the real
  length is the next 16 bits; **127** means the next 64 bits. This variable-length scheme
  keeps small frames tiny.

**Masking.** Every frame sent **client→server MUST be masked**: the payload is XORed with a
random 32-bit key that changes per frame. Server→client frames MUST NOT be masked. Masking
exists to defend intermediaries (proxies/caches) against **cache-poisoning attacks** where
attacker-controlled bytes could otherwise look like a crafted HTTP request. It is not
confidentiality — use `wss://`/TLS for that.

Framing consequences:

- WebSocket is **message-oriented** on top of TCP's byte stream: the receiver reassembles
  frames into whole messages. This is a real difference from raw TCP where you must frame
  yourself.
- **Text vs binary** is explicit via opcode; text payloads must be valid UTF-8 or the
  connection is closed with 1007.
- Control frames (close/ping/pong) MUST be ≤125 bytes and MUST NOT be fragmented; they may
  be interleaved between fragments of a data message.

---

## Ping/pong keepalive and heartbeats

**Why it matters.** A WebSocket may sit idle for minutes. Idle TCP connections get silently
dropped by NATs, load balancers, and proxies (idle timeouts), and a peer can vanish (crash,
network partition) without a TCP FIN ever arriving. **Ping/pong** control frames are the
built-in liveness mechanism.

- Either endpoint may send a **Ping** (opcode `0x9`) with an optional ≤125-byte payload.
- The receiver **MUST** reply with a **Pong** (opcode `0xA`) echoing the same payload, as
  soon as practical.
- An **unsolicited Pong** is legal and serves as a one-way heartbeat ("I'm alive"), no ping
  required.

Practical use: send a ping every N seconds; if no pong returns within a timeout, treat the
connection as dead and close/reconnect. Pings also **reset idle timers** on intermediaries,
keeping the connection from being reaped. Note: browser JavaScript cannot send WebSocket
pings directly (the API auto-handles incoming pings), so app-level heartbeat messages are
common in browser clients.

> [!TIP]
> Ping/pong is at the **WebSocket protocol layer**, distinct from TCP keepalive (which is
> OS-level, off by default, and often on a 2-hour timer — too coarse for real-time apps).

---

## WebSocket close handshake and close codes

Closing cleanly is a **two-way** exchange, mirroring TCP's FIN/FIN. One side sends a
**Close frame** (opcode `0x8`); the peer replies with its own Close frame; then the
underlying TCP connection is torn down. The Close frame may carry a 2-byte **status code**
plus an optional UTF-8 reason.

Common close codes (RFC 6455 §7.4):

| Code | Meaning |
|---|---|
| 1000 | Normal closure |
| 1001 | Going away (server shutting down, browser navigating away) |
| 1002 | Protocol error |
| 1003 | Unacceptable data type (e.g. binary when only text expected) |
| 1005 | No status code present *(reserved — never sent on the wire)* |
| 1006 | Abnormal closure, no Close frame *(reserved — connection dropped)* |
| 1007 | Invalid payload data (e.g. non-UTF-8 in a text frame) |
| 1008 | Policy violation |
| 1009 | Message too big |
| 1010 | Client aborting: server didn't negotiate a required extension |
| 1011 | Server encountered an unexpected condition |
| 1015 | TLS handshake failure *(reserved — never sent on the wire)* |

The **reserved** codes (1005, 1006, 1015) are used by APIs to *report* a state locally but
must never be put in an actual Close frame. **1006** is the one you see most in the wild: it
means the TCP connection dropped without a proper close handshake (crash, network loss) —
that is your cue to reconnect.

---

## Server-Sent Events (SSE): text/event-stream

**Why it matters.** SSE (standardized by WHATWG in the HTML Living Standard, originally
described in the older W3C EventSource spec) is the *lightweight* answer for **one-way,
server→client** streaming. It is not a new protocol at all — it is a normal HTTP response
that never ends, with `Content-Type: text/event-stream`, over which the server writes a
simple UTF-8 text event format. Browsers consume it via the `EventSource` API.

The server responds:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

…then streams events in this text format:

```
: this is a comment (heartbeat)         ← lines starting with ':' are ignored

event: price                            ← optional event name (default is "message")
data: {"symbol":"ACME","px":42.10}      ← the payload
id: 1027                                 ← optional event id (see Last-Event-ID)

data: line one                          ← multiple data: lines are joined with '\n'
data: line two

retry: 5000                             ← optional: set client reconnect delay (ms)
```

Framing rules:

- Fields are `field: value` lines. Recognized fields: **`event`**, **`data`**, **`id`**,
  **`retry`**. Unknown fields are ignored.
- An event is dispatched on a **blank line** (a bare `\n`). Multiple `data:` lines in one
  event are concatenated with newlines.
- A line beginning with `:` is a **comment**, commonly used as a keep-alive/heartbeat to
  keep the connection and any proxies alive.
- The stream is **UTF-8 text only** — no binary. Binary must be base64-encoded (overhead)
  or SSE avoided.

SSE strengths: dead-simple, uses ordinary HTTP (works through most proxies/CDNs), automatic
reconnection and event-id resume are built into `EventSource`. Weaknesses: one-directional
(client→server still needs a separate normal HTTP request), text only, and — critically —
under **HTTP/1.1** browsers cap ~6 connections per origin, so many SSE streams to one origin
exhaust the pool. Over **HTTP/2+** multiplexing removes that limit.

---

## SSE auto-reconnect and Last-Event-ID

**Why it matters.** This is SSE's headline feature and a favorite interview contrast with
WebSocket (which has *no* built-in reconnection — you write it yourself).

- When the connection drops, `EventSource` **automatically reconnects** after a delay. The
  server can tune that delay by sending a **`retry: <milliseconds>`** field.
- If the server has been assigning event **`id:`** values, the browser remembers the last
  id it received and, on reconnect, sends it back in a request header:
  **`Last-Event-ID: <id>`**.
- The server reads `Last-Event-ID` and **replays events after that id**, so no events are
  lost across a reconnect — a resumable stream with almost no application code.

```
(initial)   GET /stream                → id: 1027 delivered, connection drops
(reconnect) GET /stream
            Last-Event-ID: 1027         → server resumes from 1028
```

Gotchas: the resume guarantee is only as good as the server's ability to buffer/replay by
id; if events aren't persisted, gaps still occur. Also `Last-Event-ID` is only sent on the
*automatic* reconnect, and a full page reload starts fresh (the id lives in the JS
`EventSource` object, not persistent storage).

---

## WebSocket vs SSE vs long polling: choosing

The decision hinges on **direction of data flow**, **payload type**, and **infrastructure
friendliness**. A compact comparison:

| Property | Short poll | Long poll | SSE | WebSocket |
|---|---|---|---|---|
| Direction | C→S req / S→C resp | C→S req / S→C resp | **S→C only** | **Full-duplex** |
| Underlying protocol | HTTP | HTTP | HTTP (`text/event-stream`) | Own protocol over TCP (via 101) |
| Payload | any | any | **UTF-8 text only** | text + **binary** |
| Server push latency | poll interval | ~instant (per event) | ~instant | ~instant |
| Auto-reconnect | n/a (client loops) | client re-requests | **built-in** (`retry`/`Last-Event-ID`) | **none** (DIY) |
| Header overhead per event | high (full req) | high (per event) | low (after 1 request) | **very low** (frame header) |
| Proxy / firewall friendliness | best | best | good (plain HTTP) | can be blocked (needs Upgrade; use `wss`) |
| HTTP/1.1 conn-per-origin cost | low (short-lived) | ties up a conn | ties up a conn (~6 cap) | 1 persistent conn (not counted in 6 cap) |
| Complexity | trivial | low | low | higher (framing/state/scale) |

Rules of thumb:

- **Server→client only** (news feed, notifications, live dashboard, log tail, LLM token
  stream): choose **SSE** — simpler, auto-reconnect, plain HTTP, HTTP/2-friendly.
- **Bidirectional / low-latency / binary** (chat, multiplayer game, collaborative editing,
  live trading with client actions): choose **WebSocket**.
- **Must work through hostile proxies, or updates are infrequent**: **long polling** as
  baseline or fallback.
- **Infrequent, non-urgent** state checks where simplicity wins: **short polling** is fine.

> [!INTERVIEW]
> "Why not just use WebSocket for everything?" Because SSE is simpler to operate (it *is*
> HTTP: works with standard auth, CORS, compression, HTTP/2 multiplexing, CDNs, and
> reconnects itself), and many use cases are one-directional. WebSocket adds framing,
> connection state, custom reconnect logic, and proxy friction you don't need for a
> read-only stream.

---

## Scaling stateful real-time connections

**Why it matters.** Polling is stateless and load-balances trivially. WebSocket and SSE hold
a **long-lived, stateful connection** pinned to one server process — this is the hard part
of real-time at scale, and interviewers love it.

Key challenges and standard techniques:

- **Connection limits, not request rate**, become the bottleneck. Each open connection
  consumes a file descriptor and some memory; a single server can hold hundreds of
  thousands of *idle* connections only with an event-driven / async I/O model
  (epoll/kqueue), not thread-per-connection. This ties back to socket I/O multiplexing.
- **Load balancing**: L4 (TCP) LBs pass WebSocket through transparently. L7 LBs must be
  configured to forward the `Upgrade`/`Connection` headers and to allow long-lived
  connections (raise idle timeouts). Sticky routing isn't strictly required per connection
  (the socket stays on one node), but **fan-out across nodes** is.
- **Fan-out / horizontal scale**: a message from user A on server 1 must reach user B whose
  socket lives on server 3. Servers therefore subscribe to a shared **pub/sub bus**
  (e.g. a Redis pub/sub, Kafka, or a message broker); each node delivers only to the
  connections it locally owns. This decouples "who is connected where" from "who needs the
  message."
- **Backpressure**: a slow client whose send buffer fills can bloat server memory. Servers
  must bound per-connection queues and drop/close slow consumers.
- **Reconnect storms & thundering herds**: a deploy or LB blip disconnects everyone at once;
  they all reconnect simultaneously. Mitigate with **jittered exponential backoff**, and
  for SSE tune `retry`. Graceful shutdown should send WebSocket 1001 (going away).
- **Deploys**: rolling a server drops its connections; clients must reconnect and resume
  (WebSocket: app-level replay; SSE: `Last-Event-ID`). Connection draining helps.

> [!WARNING]
> HTTP/1.1's ~6-connections-per-origin browser cap means many independent SSE streams to
> one origin will **starve** other requests. Multiplex over **HTTP/2** or consolidate into
> one stream. WebSocket connections do **not** count against that per-origin cap.

---

## Common follow-up questions

- **Why does the WebSocket handshake return 101 and not 200?** Because it is switching the
  connection off the HTTP protocol onto the WebSocket protocol; `101 Switching Protocols`
  is exactly the HTTP mechanism for that (`Upgrade`/`Connection` headers).
- **What is the magic GUID for?** `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` is concatenated to
  the client's `Sec-WebSocket-Key`, SHA-1'd and base64'd into `Sec-WebSocket-Accept` to
  prove the server understands WebSocket — a handshake integrity check, not security.
- **Why must client frames be masked?** To prevent cache-poisoning attacks on intermediaries
  that might misinterpret attacker-controlled payload bytes as an HTTP request. It provides
  no confidentiality; use TLS (`wss://`).
- **Does SSE support binary?** No — `text/event-stream` is UTF-8 text only; base64-encode
  binary (with size overhead) or use WebSocket.
- **How does SSE recover lost events?** Server assigns `id:` values; on reconnect the browser
  sends `Last-Event-ID`, and the server replays events after that id.
- **WebSocket has no reconnect — how do you handle drops?** Detect via ping/pong timeout or
  close code 1006, then reconnect with jittered exponential backoff and replay missed state.
- **WebSocket over HTTP/2?** Not the classic `Upgrade`; RFC 8441 defines an "extended
  CONNECT" bootstrap over HTTP/2 (and RFC 9220 for HTTP/3).
- **Long polling vs SSE — both hold a connection, why prefer SSE?** SSE keeps one connection
  open for *many* events with tiny framing and built-in reconnect/resume; long polling pays
  a full request/response cycle per event.

## References

- RFC 6455 — The WebSocket Protocol: https://www.rfc-editor.org/rfc/rfc6455
- RFC 8441 — Bootstrapping WebSockets with HTTP/2: https://www.rfc-editor.org/rfc/rfc8441
- RFC 9220 — Bootstrapping WebSockets with HTTP/3: https://www.rfc-editor.org/rfc/rfc9220
- WHATWG HTML Living Standard — Server-sent events (`EventSource`):
  https://html.spec.whatwg.org/multipage/server-sent-events.html
- RFC 9110 — HTTP Semantics (status codes incl. 101): https://www.rfc-editor.org/rfc/rfc9110
- RFC 9113 — HTTP/2 (removed the Upgrade mechanism): https://www.rfc-editor.org/rfc/rfc9113
- MDN — WebSockets API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- MDN — Server-sent events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
