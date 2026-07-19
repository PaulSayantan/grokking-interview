# HTTP/2, HTTP/3 & QUIC

HTTP/2 (RFC 9113), HTTP/3 (RFC 9114) and the QUIC transport (RFC 9000) are the modern
evolution of the HTTP application protocol. They keep HTTP *semantics* (methods, status
codes, headers, resources — see RFC 9110) identical but completely change how bytes are
framed and moved on the wire. This topic is about the **transport and framing mechanics**,
not API design.

> [!KEY-TAKEAWAY]
> HTTP/1.1, HTTP/2 and HTTP/3 all express the *same* HTTP semantics. What changes is the
> "wire format": HTTP/1.1 is text over TCP, HTTP/2 is binary frames multiplexed over one
> TCP connection, and HTTP/3 is binary frames over QUIC (which runs on UDP).

---

## Evolution from HTTP/1.1 to HTTP/2 to HTTP/3

**Why it matters.** HTTP/1.1 (RFC 9112) sends one request/response at a time per TCP
connection. Its two workarounds for concurrency are both flawed:

- **Multiple parallel connections** (browsers cap at ~6 per origin): wastes memory, defeats
  congestion control (each connection probes bandwidth independently), and multiplies TLS
  handshakes.
- **HTTP pipelining**: allows sending several requests without waiting, but responses must
  come back **in order**, so a slow first response blocks everything behind it
  (head-of-line blocking at the application layer). Pipelining was effectively never
  deployed and is deprecated.

**HTTP/2** (2015, RFC 7540, obsoleted by **RFC 9113** in 2022) fixes application-layer
concurrency: a single TCP connection carries many concurrent, interleaved **streams** using
a **binary framing** layer. But because it still rides on TCP, a single lost TCP segment
stalls *all* streams — **TCP-level head-of-line blocking**.

**HTTP/3** (2022, RFC 9114) moves HTTP onto **QUIC** (RFC 9000), a new transport built on
UDP that provides independent, reliable, ordered streams. A lost packet only stalls the
stream(s) whose data it carried, eliminating transport HOL blocking.

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| RFC | 9112 | 9113 (was 7540) | 9114 |
| Transport | TCP | TCP | QUIC over UDP |
| Wire format | Text | Binary frames | Binary frames |
| Concurrency | 1/conn (or N conns) | Many streams / 1 conn | Many streams / 1 conn |
| Header compression | none (plain text) | HPACK (RFC 7541) | QPACK (RFC 9204) |
| Encryption | optional (via TLS) | optional in spec, TLS in practice | **mandatory** (TLS 1.3 built in) |
| HOL blocking | app-layer (pipelining) | TCP-layer | none at transport |
| Handshake RTTs | TCP + TLS separate | TCP + TLS separate | combined; 1-RTT or 0-RTT |

> [!TIP]
> A common interview trap: "HTTP/2 uses UDP." It does not — HTTP/2 is TCP. Only HTTP/3
> (via QUIC) uses UDP.

---

## HTTP/2 binary framing layer

HTTP/2 replaces the human-readable text of HTTP/1.1 with a **binary framing** layer. All
communication is split into **frames**, each with a fixed 9-byte header:

```
+-----------------------------------------------+
| Length (24 bits)                              |
+---------------+---------------+---------------+
| Type (8)      | Flags (8)     |
+-+-------------+---------------+-------------------------------+
|R| Stream Identifier (31 bits)                                 |
+=+=============================================================+
| Frame Payload ...                                             |
+---------------------------------------------------------------+
```

Key frame types:

- `HEADERS` — carries an HPACK-compressed header block (request/response headers).
- `DATA` — carries the message body.
- `SETTINGS` — connection-level configuration exchanged at startup (e.g. max concurrent
  streams, initial window size, max frame size).
- `WINDOW_UPDATE` — flow-control credit.
- `RST_STREAM` — abruptly terminate one stream.
- `GOAWAY` — gracefully shut down the connection (stop opening new streams).
- `PING` — liveness / RTT measurement.
- `PRIORITY` — (original) prioritization hints.
- `PUSH_PROMISE` — announce a server-pushed resource (deprecated).

The connection opens with a fixed client **connection preface** (the magic octets
`PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n`) followed by a `SETTINGS` frame. Frames belong to a
**stream** identified by the 31-bit stream ID (0 = connection-level control).

> [!KEY-TAKEAWAY]
> Binary framing is what makes multiplexing possible: because everything is length-prefixed
> frames tagged with a stream ID, the endpoint can interleave frames from many streams on
> one connection and reassemble them correctly.

---

## HTTP/2 streams and multiplexing

A **stream** is an independent, bidirectional sequence of frames within one connection.
Many streams are **multiplexed** over a single TCP connection and their frames are
**interleaved** on the wire, giving true request/response concurrency without opening
multiple connections.

**Stream IDs:**
- Client-initiated streams use **odd** IDs (1, 3, 5, …).
- Server-initiated streams (push) use **even** IDs.
- IDs only increase; once used, a number is never reused on that connection.
- Stream 0 is reserved for connection-level control frames.

**Stream lifecycle** (simplified): idle → open → half-closed (one side sent `END_STREAM`)
→ closed. `RST_STREAM` cancels a stream without tearing down the connection — a big win
over HTTP/1.1 where cancelling meant closing the TCP connection.

**Concurrency limit:** `SETTINGS_MAX_CONCURRENT_STREAMS` bounds how many streams may be
open at once (commonly 100+). Exceeding it is a protocol error.

> [!WARNING]
> The **HTTP/2 Rapid Reset** attack (CVE-2023-44487) abused streams: a client opens a
> stream (HEADERS) and immediately sends `RST_STREAM`, over and over. Each pair is cheap
> for the client but forces the server to do request setup work, bypassing the concurrent-
> stream limit and enabling a large DoS. Mitigation: rate-limit resets / count them against
> the stream budget.

---

## HPACK header compression

HTTP headers are highly repetitive and verbose (cookies, user-agent, accept). HTTP/1.1
sends them as plain text on every request. **HPACK** (RFC 7541) compresses them.

HPACK has three mechanisms:

1. **Static table** — a fixed, predefined table of 61 common header entries (e.g. index 2
   = `:method: GET`, index 8 = `:status: 200`). Sending a single index byte replaces a
   whole header.
2. **Dynamic table** — a per-connection, per-direction table that both peers update in
   lockstep as headers are seen. Repeated custom headers (e.g. a long auth cookie) get
   inserted once, then referenced by index thereafter.
3. **Huffman coding** — a static Huffman table compresses literal string values.

> [!INTERVIEW]
> "Why was HPACK invented instead of just using gzip on headers?" Because HTTP/2 headers
> were vulnerable to **CRIME**-style attacks: gzip's back-references leak secret content
> (like a session cookie) when an attacker can inject known plaintext. HPACK is designed to
> be **compression that doesn't cross security boundaries** for sensitive values — it never
> uses generic stream compression over attacker-influenced + secret data together, and lets
> senders mark fields "never indexed."

HPACK's dynamic table requires **ordered, reliable delivery** of the header-block updates —
which TCP guarantees. This is exactly why HTTP/3 needed a redesign (QPACK) since QUIC
streams can arrive out of order relative to each other.

The pseudo-headers (`:method`, `:scheme`, `:authority`, `:path`, `:status`) replace the
HTTP/1.1 request line and status line and must appear before regular headers.

---

## HTTP/2 flow control

Because many streams share one connection, a fast sender could overwhelm a slow consumer
of one particular stream. HTTP/2 provides **credit-based flow control**, applied at two
levels: **per-stream** and **whole-connection**.

- Each side advertises a receive window (default 65,535 bytes). Only `DATA` frames count
  against the window (headers do not).
- The sender may transmit at most the window's worth of `DATA` before it must stop.
- The receiver sends `WINDOW_UPDATE` frames to grant more credit as it consumes data.
- A stream is limited by **both** its per-stream window and the connection window.

This lets a client, for example, pause a large download stream (stop granting window) while
still receiving other streams — something impossible in HTTP/1.1. Tuning the initial window
(`SETTINGS_INITIAL_WINDOW_SIZE`) matters for high-bandwidth-delay-product links; a small
window caps throughput at `window / RTT`.

> [!TIP]
> QUIC/HTTP-3 has its own flow control at the QUIC transport layer (per-stream and
> connection-wide `MAX_DATA`/`MAX_STREAM_DATA` frames), conceptually similar but living in
> the transport rather than in HTTP.

---

## HTTP/2 stream prioritization

HTTP/2 originally defined a **priority tree**: each stream could declare a dependency on a
parent stream plus a weight (1–256), forming a tree the server uses to decide how to
allocate bandwidth among concurrent streams (e.g. HTML and CSS before images).

In practice this dependency-tree model was **complex, inconsistently implemented, and often
buggy**; RFC 9113 **deprecated** it (kept for wire compatibility but recommends not relying
on it). The replacement is the **Extensible Prioritization Scheme** (RFC 9218), which uses
simple HTTP headers/frames: an **urgency** level (0–7) and an **incremental** flag. RFC 9218
works for both HTTP/2 and HTTP/3.

> [!WARNING]
> Don't claim "HTTP/2 has great prioritization." The accurate interview answer is: the
> original dependency-tree priorities were deprecated in RFC 9113 due to implementation
> problems, and RFC 9218 defines the modern, simpler scheme.

---

## HTTP/2 server push (deprecated)

**Server push** let a server proactively send resources the client hadn't requested yet
(e.g. push `style.css` when the client requests `index.html`), via a `PUSH_PROMISE` frame
reserving an even-numbered stream.

In practice push **hurt more than it helped**: servers pushed resources already in the
client cache (wasting bandwidth), it was hard to coordinate with caching, and the
performance wins were marginal versus `preload` resource hints (`<link rel=preload>` /
`103 Early Hints`). Chrome **removed** server push support in 2022, and RFC 9113 documents
it as effectively deprecated. **HTTP/3 keeps a push mechanism in the spec but it is largely
unused.**

> [!INTERVIEW]
> If asked "should I use HTTP/2 server push?" — the expected answer is no; use `preload`
> hints and `103 Early Hints` (RFC 8297) instead. Knowing push is dead is a signal you're
> current.

---

## TCP head-of-line blocking in HTTP/2

This is the central limitation that motivated HTTP/3.

HTTP/2 solves **application-layer** HOL blocking (independent streams, any can complete in
any order). But all those streams ride on **one TCP connection**, and TCP delivers a single
in-order byte stream. If one TCP segment is lost, TCP **holds back every later byte** —
including bytes belonging to *other, unaffected* streams — until the lost segment is
retransmitted and arrives. The kernel cannot hand out-of-order data to the application.

So on a lossy network, HTTP/2 can perform *worse* than HTTP/1.1 with 6 connections: with
6 connections, a loss on one connection only stalls that connection's ~1/6 of traffic; with
HTTP/2's single connection, one loss stalls *everything*.

```
HTTP/2 on TCP: streams A, B, C multiplexed
  segments: [A1][B1][A2][B2][C1][A3] ...
  If [B1] is lost -> TCP buffers A2,B2,C1,A3 and delivers NOTHING
  to the app until B1 is retransmitted. All three streams stall.
```

> [!KEY-TAKEAWAY]
> HTTP/2 removed HOL blocking at the HTTP layer but not at the TCP layer. TCP's guarantee of
> a single ordered byte stream means one lost packet blocks all multiplexed streams. Only a
> new transport (QUIC) can fix this, which is exactly what HTTP/3 does.

---

## QUIC transport fundamentals

**QUIC** (RFC 9000) is a general-purpose, connection-oriented, reliable, encrypted transport
that runs **on top of UDP** in user space (not the OS kernel). It is *not* HTTP-specific;
HTTP/3 is just its first major user. QUIC provides:

- **Multiplexed independent streams** with per-stream reliability and ordering.
- **Built-in TLS 1.3** encryption and authentication (not an add-on).
- **Connection IDs** decoupled from IP/port, enabling connection migration.
- **Modern loss recovery and congestion control** with unambiguous packet numbers.

**Why UDP and not a brand-new IP protocol?** Deploying a new transport directly on IP is
impossible in practice — middleboxes (NATs, firewalls) only pass TCP and UDP. Running in
user space on UDP means QUIC can evolve without kernel/OS upgrades and be shipped inside
applications (browsers, libraries).

**Packets vs frames:** A QUIC **packet** (carried in a UDP datagram) has its own packet
number and is almost entirely encrypted (even most of the header). Inside, QUIC carries
**frames** (`STREAM`, `ACK`, `CRYPTO`, `MAX_DATA`, `NEW_CONNECTION_ID`, etc.). Packet
numbers **never repeat and always increase**, so a retransmission uses a new packet number —
eliminating TCP's retransmission ambiguity problem.

> [!WARNING]
> QUIC's deep encryption (headers included) is deliberate **ossification resistance** — it
> stops middleboxes from inspecting/depending on internals and freezing the protocol the way
> they did to TCP. A downside: some networks throttle or block UDP/443, so clients must be
> able to **fall back to HTTP/2 over TCP**.

---

## HTTP/3 over QUIC and HOL-blocking elimination

**HTTP/3** (RFC 9114) is HTTP semantics mapped onto QUIC. Each HTTP request/response uses
one QUIC **bidirectional stream**. Because QUIC streams are **independently
flow-controlled, ordered, and reliable**, a lost packet only stalls the stream(s) whose
bytes it carried — **other streams keep flowing**. This removes the transport HOL blocking
that HTTP/2-over-TCP suffers.

```
HTTP/3 on QUIC: streams A, B, C, each independent
  If a packet carrying B's data is lost -> only stream B waits for
  retransmission. Streams A and C are delivered immediately.
```

Differences from HTTP/2 framing:
- No separate `SETTINGS`-preface dance over the same connection; control uses dedicated
  QUIC streams (a client and server **control stream** plus QPACK encoder/decoder streams).
- Frame types are similar in spirit (`HEADERS`, `DATA`) but QUIC provides the stream
  multiplexing, so HTTP/3 frames don't carry stream IDs — the QUIC layer does.

> [!KEY-TAKEAWAY]
> HTTP/3 eliminates *transport-level* HOL blocking. But note: HOL blocking can still occur
> *within a single stream* (bytes of one response must arrive in order) — HTTP/3 just stops
> one stream's loss from blocking the *others*.

---

## QUIC handshake and integrated TLS 1.3

QUIC does not layer TLS on top like HTTPS-over-TCP does; it **integrates TLS 1.3**
(RFC 8446) directly. The TLS handshake messages travel in QUIC `CRYPTO` frames, and the
negotiated keys protect QUIC packets. There is **no unencrypted QUIC** — encryption is
mandatory.

**RTT comparison:**

| Stack | RTTs before app data (fresh) |
|---|---|
| HTTP/1.1 or HTTP/2 over TCP+TLS 1.3 | 1 (TCP SYN/SYN-ACK) + 1 (TLS 1.3) = **2 RTT** |
| HTTP/1.1 or HTTP/2 over TCP+TLS 1.2 | 1 + 2 = **3 RTT** |
| HTTP/3 over QUIC (fresh) | **1 RTT** (transport + crypto combined) |
| HTTP/3 over QUIC (resumed, 0-RTT) | **0 RTT** (data with first packet) |

The saving comes from combining the transport handshake and the crypto handshake into one
round trip, instead of TCP's three-way handshake completing *before* TLS can even start.

> [!TIP]
> With TCP Fast Open + TLS 1.3 you can approach QUIC's RTT count, but TCP Fast Open is poorly
> supported by middleboxes; QUIC's 1-RTT/0-RTT is the reliable, widely-deployed version.

---

## 0-RTT connection establishment

When a client has connected to a server before, it can cache a **pre-shared key (PSK)** /
session ticket. On the next connection it sends application data (e.g. a GET request) in the
**very first flight**, encrypted with keys derived from the cached secret — **0-RTT**. TLS
1.3 over TCP also supports 0-RTT resumption; QUIC bakes it in.

**The replay risk.** 0-RTT (a.k.a. "early data") is **not forward-secret** for that first
flight and, crucially, an attacker can **capture and replay** the 0-RTT packet. So 0-RTT
must only carry **idempotent, safe** requests (e.g. `GET`). Servers must not execute
non-idempotent operations (a `POST` that charges a card) from 0-RTT data, or must have
anti-replay defenses. Anything after the handshake completes (1-RTT keys) is safe.

> [!WARNING]
> Interview gotcha: "0-RTT is free performance." No — it trades a round trip for a
> **replay-attack surface**. Restrict it to idempotent requests; the client/server may also
> refuse 0-RTT and fall back to 1-RTT.

---

## Connection migration and connection IDs

A TCP connection is identified by the 4-tuple (src IP, src port, dst IP, dst port). If any
element changes — e.g. your phone switches from Wi-Fi to cellular, or a NAT rebinding
changes your port — the TCP connection **breaks** and must be re-established (new handshake,
new TLS).

QUIC identifies a connection by an opaque **Connection ID (CID)** carried in packets, *not*
by the IP/port 4-tuple. So when the client's address changes, it keeps sending with the same
CID and the server recognizes the ongoing connection — **connection migration** — with no
new handshake. The endpoint validates the new path (anti-spoofing) via `PATH_CHALLENGE` /
`PATH_RESPONSE` frames before shifting large amounts of traffic to it.

Endpoints issue **multiple CIDs** (`NEW_CONNECTION_ID` frames) so peers can rotate them.
Rotating the CID as the path changes prevents on-path observers from **linking** your
activity across networks (a privacy property).

> [!KEY-TAKEAWAY]
> Connection migration is a headline QUIC feature: mobile clients keep a live connection
> (and its congestion state, open streams) across network changes because the connection is
> named by a Connection ID, not by the IP/port 4-tuple.

---

## QPACK header compression

HTTP/3 can't use HPACK. HPACK's dynamic table assumes header blocks are processed in the
**exact order they were sent** (each update mutates shared state), which TCP guarantees but
QUIC's independent, possibly-out-of-order streams do not. Blindly reusing HPACK would
reintroduce HOL blocking (a header block referencing a table entry from a not-yet-arrived
block would stall).

**QPACK** (RFC 9204) solves this:
- Same idea (static table — 99 entries, dynamic table, Huffman) but decouples table updates
  onto **dedicated unidirectional QUIC streams** (an encoder stream and a decoder stream).
- The encoder chooses whether a header block **references** dynamic-table entries. If it
  references entries that may not have arrived yet, the decoder must wait — so QPACK lets the
  encoder trade **compression ratio vs. HOL-blocking risk** via `SETTINGS_QPACK_BLOCKED_STREAMS`
  and by only referencing already-acknowledged entries when it wants zero blocking.

> [!INTERVIEW]
> "Why QPACK instead of HPACK for HTTP/3?" Because HPACK requires total ordering of header
> updates, which would recreate head-of-line blocking over QUIC's independent streams. QPACK
> moves table maintenance onto separate streams and lets the encoder bound how many streams
> may block, preserving QUIC's HOL-blocking-free property.

---

## ALPN negotiation and protocol discovery

Clients need to know which HTTP version a server supports.

**ALPN (Application-Layer Protocol Negotiation, RFC 7301)** is a TLS extension: in the TLS
`ClientHello` the client lists protocol IDs it supports (e.g. `h2`, `http/1.1`), and the
server picks one in its `ServerHello`. This negotiates the version **within the TLS
handshake** with no extra round trip. Identifiers: `http/1.1`, `h2` (HTTP/2 over TLS),
`h2c` (HTTP/2 cleartext — rarely used), `h3` (HTTP/3 over QUIC).

**How HTTP/2 starts:**
- Over TLS: ALPN offers `h2`. (Browsers require TLS for HTTP/2 — there is no cleartext HTTP/2
  in browsers.)
- Cleartext `h2c`: via an HTTP/1.1 `Upgrade: h2c` header (server-to-server; browsers don't do
  this).

**How HTTP/3 is discovered.** QUIC uses ALPN `h3` inside its handshake — but the client must
first *know* to try QUIC/UDP at all. Discovery mechanisms:
- **Alt-Svc header** (RFC 7838): a server responds over HTTP/1.1 or HTTP/2 with
  `Alt-Svc: h3=":443"; ma=86400`, telling the client "you can reach me via HTTP/3 on this
  port." The client caches it and uses HTTP/3 on subsequent connections.
- **HTTPS DNS resource record** (RFC 9460): advertises `h3` support (and other params) in DNS
  so the client can attempt HTTP/3 on the *first* connection, avoiding the initial TCP
  round trip.

> [!TIP]
> Because a client can't know in advance whether UDP/443 is open, HTTP/3 deployments race or
> fall back: try QUIC, and if it fails/blocked, use HTTP/2 over TCP. This is often called
> "happy eyeballs" style racing.

---

## Head-of-line blocking comparison across versions

Putting it together — three distinct places HOL blocking can occur:

| Version | App-layer HOL (pipelining) | Transport HOL (one loss blocks all streams) | Within-stream ordering |
|---|---|---|---|
| HTTP/1.1 | **Yes** (pipelined responses in order) | N/A (one req at a time) | Yes |
| HTTP/2 | **No** (independent streams) | **Yes** (TCP: one lost segment stalls all streams) | Yes |
| HTTP/3 | **No** | **No** (QUIC streams independent) | Yes (per stream only) |

Key nuances interviewers probe:

- HTTP/2's win is *application-layer* multiplexing; its remaining weakness is *TCP-layer*
  HOL blocking, which only bites under **packet loss**. On clean networks HTTP/2 and HTTP/3
  perform similarly.
- HTTP/3 removes cross-stream HOL blocking but **not within-stream** ordering: if you send a
  single big response and a packet is lost, that response still waits for retransmission.
- The benefit of HTTP/3 grows with **loss rate and RTT** (mobile, lossy, high-latency links);
  on a fast wired connection the difference is small.

---

## When each version helps: trade-offs and gotchas

**HTTP/2 helps when:** you have many small resources over one origin on a reasonably clean
network; you want to cut connection count and TLS handshakes vs HTTP/1.1; you control both
ends. It is universally supported.

**HTTP/3 helps when:** clients are on lossy/high-latency/mobile networks (loss recovery per
stream + connection migration shine); you want fastest connection setup (1-RTT / 0-RTT);
head-of-line blocking under loss is hurting you.

**Costs / gotchas of HTTP/3 / QUIC:**
- **Higher CPU cost:** QUIC runs in user space and does per-packet encryption; historically
  it burns more CPU than kernel TCP (though offload and optimization keep improving).
- **UDP throttling/blocking:** some networks rate-limit or block UDP; you must keep a TCP
  fallback.
- **Middlebox/observability changes:** load balancers, firewalls and monitoring built around
  TCP/2-tuple state need updating; the encrypted headers reduce passive visibility.
- **0-RTT replay risk:** restrict to idempotent requests.
- **Not always faster:** on clean, low-latency networks HTTP/2 and HTTP/3 are close; HTTP/3's
  advantage is under adverse conditions.

> [!INTERVIEW]
> Strong answer to "should we switch to HTTP/3?": "It depends on the client population. For a
> mobile-heavy, global, lossy-network audience, HTTP/3's per-stream loss recovery, faster
> handshake, and connection migration are real wins. For internal/datacenter traffic on clean
> links, HTTP/2 (or even HTTP/1.1 with keep-alive) is fine and cheaper on CPU. Always keep an
> HTTP/2-over-TCP fallback because UDP can be blocked."

---

## HTTP/2 header block framing and CONTINUATION

A single logical set of headers is a **header block**, and it does not have to fit in one
frame. A header block is:

- a `HEADERS` (or `PUSH_PROMISE`) frame, followed by
- zero or more `CONTINUATION` frames, terminated by the frame that carries the
  `END_HEADERS` flag.

Two flags govern this: **`END_HEADERS`** marks the last fragment of the header block, and
**`END_STREAM`** (on `HEADERS` or `DATA`) marks the end of the message body and half-closes
the stream. `CONTINUATION` is the frame type the original frame-types list often omits
(type `0x9`); it exists only to continue an oversized header block that exceeds
`SETTINGS_MAX_FRAME_SIZE`.

Critically, a header block **must be contiguous on the wire** — no frames for any other
stream may be interleaved between the opening `HEADERS` and the final `END_HEADERS`. This
contiguity requirement is itself a subtle, unavoidable HOL cost in HTTP/2: while a big
header block is being transmitted, no other stream's frames can go out, because HPACK's
shared dynamic table must be mutated in a single, uninterrupted sequence.

> [!KEY-TAKEAWAY]
> `HEADERS`/`PUSH_PROMISE` + `CONTINUATION*`, ended by `END_HEADERS`, form one header block
> that must be sent contiguously. `END_STREAM` separately half-closes the stream. Confusing
> `END_HEADERS` (end of a header block) with `END_STREAM` (end of the message) is a common
> error.

---

## HTTP/2 DoS attacks: Rapid Reset and CONTINUATION Flood

Two headline HTTP/2 denial-of-service classes exploit the framing layer differently.

**Rapid Reset (CVE-2023-44487, Aug–Oct 2023)** — deepened. Only streams in the **open** or
**half-closed** states count toward `SETTINGS_MAX_CONCURRENT_STREAMS`. When the client sends
`HEADERS` then immediately `RST_STREAM`, the stream transitions straight to closed, so the
slot is freed instantly and the client can churn *unbounded* new requests without ever
tripping the concurrency limit. Worse, many front proxies **buffer and dispatch the
`HEADERS`/`DATA` upstream to the backend before they observe the trailing `RST_STREAM`**, so
the canceled request still consumes real backend work. The record attack reached
~201 million requests/second from a ~20,000-node botnet. Naïvely *lowering*
`SETTINGS_MAX_CONCURRENT_STREAMS` backfires: clients that assume 100 concurrent streams will
overshoot and get a storm of `499`/`502` errors. Correct mitigations: **count and rate-limit
resets** (e.g. treat excess `RST_STREAM` as abuse), close abusive connections with `GOAWAY`
(HTTP/3 uses `H3_EXCESSIVE_LOAD`), and jail offending IPs.

**CONTINUATION Flood (2024, VU#421644, incl. CVE-2023-45288 and others)** — the opposite
signature. The attacker sends `HEADERS` followed by an endless stream of `CONTINUATION`
frames and **never sets `END_HEADERS`**. Because the header block never completes, the
server keeps **buffering** the growing block (memory exhaustion / OOM) or keeps
**Huffman-decoding** fragments it will ultimately discard (CPU burn). The lethal property:
the request never completes, so **it never produces a normal access-log line** — the attack
is nearly invisible to request logging. Affected implementations included nghttp2/Node.js,
Envoy, Apache httpd, Apache Traffic Server, and Go's net/http; some stacks (e.g.
lighttpd, Jetty, Tomcat) were not. Mitigation: cap the number/total size of `CONTINUATION`
frames per header block and enforce a header-block completion timeout.

> [!INTERVIEW]
> "You're getting hammered by an HTTP/2 DoS but request logs show almost nothing — what is
> it?" That's the CONTINUATION Flood signature (request never completes → no log line),
> distinct from Rapid Reset (visible churn of open+reset). Give the matching mitigation for
> each.

---

## Modern prioritization: the Priority header and PRIORITY_UPDATE

RFC 9218 (already introduced) is worth pinning down to exact wire syntax, since
interviewers probe the tokens.

- The **`Priority`** request/response header is an HTTP structured field with two members:
  **`u=`** urgency, an integer **0–7** (lower = more urgent; **default 3**; level **7** is
  "background"), and **`i`**, a Boolean **incremental** flag (default `false`) meaning the
  resource is useful as it arrives (e.g. progressive images, HTML) so the server may
  round-robin it with peers of equal urgency. This header is **end-to-end** (survives
  through intermediaries).
- The **`PRIORITY_UPDATE`** frame reprioritizes an in-flight request and is **hop-by-hop**
  (a client can change its mind after sending the request). Type codes: HTTP/2 `0x10`;
  HTTP/3 `0xF0700` (request) / `0xF0701` (push).
- **`SETTINGS_NO_RFC7540_PRIORITIES`** (`0x9`) lets an endpoint signal it does not use the
  deprecated RFC 7540 dependency tree, so peers should rely on RFC 9218 instead.

> [!TIP]
> "How do you prioritize critical CSS ahead of images in 2025?" Answer: send `Priority:
> u=0` (or a low urgency) on the CSS and higher `u` on images, optionally adjust with
> `PRIORITY_UPDATE` — **not** the deprecated RFC 7540 dependency tree.

---

## HPACK dynamic table internals

Beyond the three mechanisms, the exact accounting matters. Each dynamic-table entry's
"size" is defined (RFC 7541 §4.1) as **name length + value length + 32 bytes** of overhead
(the 32 bytes approximate per-entry bookkeeping). The table is a **FIFO**: inserting a new
entry can **evict** the oldest entries until the table fits within its maximum size. That
maximum is bounded by **`SETTINGS_HEADER_TABLE_SIZE`**, and the encoder can shrink its view
with a **dynamic-table-size-update** instruction.

Because both peers must apply inserts and evictions in the identical order to keep their
tables in sync, HPACK depends on **total ordering** of the header stream — exactly what TCP
provides and exactly why it cannot survive QUIC's independently ordered streams. This
lockstep requirement is the direct motivation for QPACK.

---

## QPACK internals: encoder/decoder streams and insert counts

QPACK (RFC 9204) splits the compression state across dedicated unidirectional QUIC streams
and adds two counters so out-of-order delivery is safe.

**Encoder-stream instructions** (encoder → decoder, mutating the dynamic table): **Insert
with Name Reference**, **Insert with Literal Name**, **Duplicate**, and **Set Dynamic Table
Capacity**.

**Decoder-stream instructions** (decoder → encoder, feedback): **Section Acknowledgment**
(a field section decoded), **Stream Cancellation**, and **Insert Count Increment**.

Two counters make it work:

- **Required Insert Count (RIC)** — encoded in each field section's prefix; the minimum
  number of dynamic-table insertions the decoder must have seen before it can decode this
  section.
- **Known Received Count** — how many insertions the decoder has acknowledged back to the
  encoder.

A stream is **blocked** when its RIC exceeds the decoder's current insert count (the
referenced entry hasn't arrived yet). **`SETTINGS_QPACK_BLOCKED_STREAMS`** (default **0**)
bounds how many streams may be in that state; an encoder that wants zero blocking references
only already-acknowledged entries. Violations raise **`QPACK_DECOMPRESSION_FAILED`** (or
`QPACK_ENCODER_STREAM_ERROR` / `QPACK_DECODER_STREAM_ERROR` for stream-level faults).

---

## QUIC packet headers and packet types

The file notes "most of the header is encrypted"; the structure is worth enumerating,
because "what's actually visible to a middlebox?" is a classic senior question.

- **Long-header packets** are used during setup and carry **both** a Source and Destination
  Connection ID plus a version field. The four long-header types: **Initial**, **0-RTT**,
  **Handshake**, and **Retry**.
- **Short-header (1-RTT) packets** are used after the handshake and carry only the
  **Destination Connection ID** — no source CID, no version — keeping steady-state overhead
  small.

**Header protection (RFC 9001 §5.4)** is a separate step layered on top of the AEAD payload
encryption: it masks the packet-number bytes and certain header bits using a cipher derived
from the sample of the (already AEAD-encrypted) payload. So the packet number is protected
independently of the payload. To an on-path observer, essentially only the Destination CID,
a few fixed bits, and UDP framing are visible.

---

## QUIC packet-number spaces

QUIC does not use one monotonic packet-number sequence. It maintains **three independent
packet-number spaces**: **Initial**, **Handshake**, and **Application (1-RTT)**. Each space
has its own numbering *and its own encryption keys*, and `CRYPTO` frame offsets restart at
0 in each space. This cleanly separates handshake data from application data: they are
acknowledged independently, and 0-RTT/1-RTT keys never collide with handshake keys. An `ACK`
frame always acknowledges packets **within its own space only**.

---

## QUIC address validation, Retry, and anti-amplification

QUIC must not become a DDoS reflection/amplification vector, since a spoofed-source client
could trick a server into blasting a large handshake at a victim.

- **Anti-amplification limit (RFC 9000 §8.1):** before it has validated the client's
  address, a server **MUST NOT send more than 3× the number of bytes it has received** from
  that address. This caps any reflected amplification at 3×.
- **Retry packet:** a server may respond to the client's Initial with a **Retry** packet
  carrying a token instead of proceeding. The client must **echo the token** in a new
  Initial, proving return-routability (it actually receives at that address) before the
  server commits handshake state. This is QUIC's analogue of TCP SYN cookies.

> [!INTERVIEW]
> "How does QUIC avoid being abused as a DDoS amplifier?" Two mechanisms: the 3×
> anti-amplification limit on unvalidated paths, and Retry-token address validation.

---

## QUIC ACK frames, loss detection, and congestion control

QUIC's recovery (RFC 9002) is more precise than TCP's.

- **`ACK` frames** carry **ACK Ranges** — selective, gap-based acknowledgment is the default
  (unlike TCP where SACK is an option) — plus an **ACK Delay** field so the sender can
  subtract receiver processing delay from RTT samples.
- Because packet numbers never repeat, there is **no retransmission ambiguity**, giving
  clean RTT samples.
- Loss is inferred by a **packet-number-gap threshold** (default 3) and a **time
  threshold**; the **PTO (Probe Timeout)** replaces TCP's RTO for tail-loss recovery.
- Congestion control is **pluggable in user space**; RFC 9002 specifies a NewReno-style
  default, and CUBIC/BBR are common. **ECN** is supported and validated via ECN counts
  echoed in `ACK` frames.

---

## QUIC connection close and stateless reset

- **`CONNECTION_CLOSE` frame** ends the whole QUIC connection (distinct from HTTP-level
  `GOAWAY`). There are two forms: transport error (**frame type `0x1c`**, an error in QUIC
  itself) and application error (**`0x1d`**, e.g. an HTTP/3 error). It is not itself
  reliably retransmitted; the sender enters a draining state.
- **Stateless Reset:** if an endpoint loses all connection state (crash/reboot) it can no
  longer decrypt incoming packets. Using a **stateless-reset token** previously delivered in
  a `NEW_CONNECTION_ID` frame, it emits a packet the peer recognizes as "this connection is
  dead," so the peer tears down instead of hanging. This is how QUIC recovers gracefully
  from a rebooted server without a live connection.

---

## QUIC and HTTP/3 stream types and IDs

**Stream IDs** in QUIC encode role in the **low two bits** (richer than HTTP/2's odd/even):
bit 0 = initiator (0 client, 1 server), bit 1 = directionality (0 bidirectional, 1
unidirectional):

- `0x00` — client-initiated **bidirectional**
- `0x01` — server-initiated **bidirectional**
- `0x02` — client-initiated **unidirectional**
- `0x03` — server-initiated **unidirectional**

HTTP/3 requests use client-initiated bidirectional streams. Control and QPACK machinery use
**unidirectional** streams, each prefixed with a **stream-type byte**: **control `0x00`**,
**push `0x01`**, **QPACK encoder `0x02`**, **QPACK decoder `0x03`**. Each peer must permit
**at least 3** unidirectional streams (its control stream + the two QPACK streams). Relevant
errors: **`H3_MISSING_SETTINGS`** (first control-stream frame wasn't `SETTINGS`) and
**`H3_CLOSED_CRITICAL_STREAM`** (closing a control or QPACK stream is fatal to the
connection).

---

## HTTP/3 frame types and error codes

HTTP/3 reuses HTTP/2's frame *concepts* but with its own numeric codes on QUIC streams:
**DATA `0x00`**, **HEADERS `0x01`**, **CANCEL_PUSH `0x03`**, **SETTINGS `0x04`**,
**PUSH_PROMISE `0x05`**, **GOAWAY `0x06`**, **MAX_PUSH_ID `0x07`**. Note the analogue of
`SETTINGS_MAX_FIELD_SECTION_SIZE` is `0x06`. There is **no per-stream flow-control frame** in
HTTP/3 (QUIC handles that) and **no `WINDOW_UPDATE`/`RST_STREAM`** at the HTTP layer — QUIC's
`RESET_STREAM`/`STOP_SENDING` do that job.

Key HTTP/3 error codes: **`H3_FRAME_UNEXPECTED`** (a frame on the wrong stream type),
**`H3_ID_ERROR`** (a stream/push ID out of range), **`H3_EXCESSIVE_LOAD`** (the code a
server uses to shed abusive load — the Rapid Reset analogue), and **`H3_MESSAGE_ERROR`**
(malformed request/response). **`GOAWAY`** carries a stream ID when sent by the server (last
request it will process) or a push ID when sent by the client, and the value **must be
non-increasing** across successive GOAWAYs.

---

## GREASE and ossification resistance

To keep parsers tolerant and prevent the protocol from freezing (ossifying), both HTTP/2
(RFC 8701, "GREASE") and HTTP/3 **reserve** ranges of type/setting/version values that peers
**MUST ignore** if unknown. HTTP/3 reserves values of the form **`0x1f * N + 0x21`** for
frame types, settings, and stream types. Implementations deliberately *send* these reserved
values so that any middlebox or peer that chokes on "unknown" values is caught early, before
a real future extension needs those code points. This is the active countermeasure behind
the file's "ossification resistance" theme.

---

## Connection coalescing and origin reuse

HTTP/2 and HTTP/3 may reuse a **single connection for multiple origins** ("connection
coalescing") when the TLS certificate covers all the hostnames (e.g. a wildcard or SAN) and
they resolve to the same server (RFC 9110 §9.1.1, RFC 9113 §9.1.1). If a coalesced request
lands on a server that can't actually serve that authority, the server returns **`421
Misdirected Request`**, telling the client to retry on a fresh connection.

Practical consequence: **domain sharding** (splitting assets across `img1/img2/img3.example.com`)
was an HTTP/1.1 optimization to get more parallel connections, but under HTTP/2 and HTTP/3 it
is an **anti-pattern** — it defeats multiplexing and coalescing, creating extra connections
and handshakes that hurt performance.

> [!WARNING]
> "We sharded assets across subdomains and HTTP/2 got slower." Expected: sharding fights H2/H3
> multiplexing and connection coalescing; consolidate onto one origin.

---

## h2c upgrade and prior knowledge

Cleartext HTTP/2 (`h2c`) can start two ways (browsers do neither; this is server-to-server):

1. **Upgrade dance:** the client sends an HTTP/1.1 request with `Connection: Upgrade`,
   `Upgrade: h2c`, and an `HTTP2-Settings` header (base64url-encoded SETTINGS payload). The
   server responds **`101 Switching Protocols`** and both switch to HTTP/2 framing.
2. **Prior knowledge:** the client just opens the HTTP/2 connection preface immediately,
   assuming the server speaks h2c.

Over TLS there is no Upgrade dance — the version is chosen by ALPN.

---

## Extended CONNECT and protocol tunneling (WebSocket, MASQUE)

Standard HTTP `CONNECT` establishes a TCP tunnel (used by forward proxies). **Extended
CONNECT** (RFC 8441) adds a **`:protocol`** pseudo-header so a single stream can be turned
into a tunnel for another protocol, gated by **`SETTINGS_ENABLE_CONNECT_PROTOCOL`**. This is
how **WebSocket runs over HTTP/2** (`:protocol = websocket`), and RFC 9220 extends the same
mechanism to **WebSocket over HTTP/3**. Related: **CONNECT-UDP** (RFC 9298) and the broader
**MASQUE** work tunnel UDP (and IP) over HTTP, enabling proxying of QUIC itself.

> [!TIP]
> "Can you run WebSocket over HTTP/2?" Yes — via Extended CONNECT (`:protocol`, RFC 8441)
> with `SETTINGS_ENABLE_CONNECT_PROTOCOL`; over HTTP/3 it's RFC 9220.

---

## HTTP/2 flow-control edge cases and QUIC flow control

Subtleties that bite in production:

- The **connection-level window is not auto-scaled**. Many servers leave it at the 65,535
  default while raising only per-stream windows, capping aggregate throughput on high-BDP
  links — a common latency bug. You must actively grow the connection window above 65,535.
- A **`WINDOW_UPDATE` with a 0 increment is a `PROTOCOL_ERROR`**.
- Changing **`SETTINGS_INITIAL_WINDOW_SIZE`** mid-connection **retroactively adjusts the
  flow-control window of all existing streams** by the delta (which can even make a window
  temporarily negative).
- A **flow-control deadlock** can occur if an intermediary won't grant window on stream data
  it hasn't been asked to forward while the peer waits for window — implementations must be
  careful to keep windows moving.

**QUIC's flow control** differs structurally: **`MAX_DATA`** (connection-wide) and
**`MAX_STREAM_DATA`** (per-stream) grant byte credit, and critically **`MAX_STREAMS`**
provides **stream-count** flow control — a first-class limit on how many streams the peer may
open. HTTP/2 has no such frame; it relies on the `SETTINGS_MAX_CONCURRENT_STREAMS` setting
instead, which is part of why Rapid Reset (freeing slots instantly) was so effective there.

---

## Connection migration deep dive

Beyond the basic "CID not 4-tuple" story:

- **NAT rebinding vs. deliberate migration:** a NAT silently changing the client's mapped
  port looks like a passive address change; a deliberate migration is the client actively
  moving networks. Both are handled via Connection IDs, but the endpoint still runs
  **path validation** (`PATH_CHALLENGE`/`PATH_RESPONSE`).
- **Congestion-controller reset:** on confirming a *new* path, the sender **resets its
  congestion controller and RTT estimate** to conservative starting values (the old path's
  capacity says nothing about the new one, and this limits abuse). This is why a Wi-Fi→cellular
  handoff shows a brief throughput dip even though the connection survives.
- **`disable_active_migration`** is a transport parameter a server can set to forbid
  client-initiated migration. **`preferred_address`** lets a server hand the client a
  different address to migrate to after the handshake (e.g. move off an anycast entry point).
- **CID linkability:** endpoints must **rotate the Connection ID** when migrating, or an
  on-path observer could correlate the pre- and post-migration flows and track the user.

---

## 0-RTT deep dive: replay defenses and keys

Deepening the replay discussion:

- **Anti-replay is a server responsibility.** TLS 1.3 (RFC 8446 §8) recommends
  **single-use session tickets** or a **strike register** (record of accepted 0-RTT
  identifiers) to reject duplicates; QUIC additionally bounds early data with
  **`max_early_data_size`** in the ticket.
- **`NEW_TOKEN` vs session ticket:** the `NEW_TOKEN` frame gives the client an
  **address-validation** token to skip Retry on the next connection — it is *not* the same as
  the TLS session ticket that enables 0-RTT *resumption keys*. Confusing the two is a common
  error.
- **Separate keys and packet space:** 0-RTT data uses its own keys and the 0-RTT
  packet-number space; it is **not forward-secret** and is **replayable**, which is different
  and independent properties.
- **Rejection path:** the server may **reject** 0-RTT (e.g. it lost the PSK, or anti-replay
  fires); the client then **retransmits that data in 1-RTT** after the handshake completes.

> [!INTERVIEW]
> "A POST occasionally executes twice under HTTP/3 — how?" A non-idempotent request was sent
> in 0-RTT early data and an attacker (or a retry) replayed it. Fix: restrict 0-RTT to safe
> methods and/or enforce server-side anti-replay.

---

## Common follow-up questions

- **Does HTTP/2 require TLS?** The spec allows cleartext (`h2c`), but every major **browser**
  requires TLS, so in practice HTTP/2 = TLS + ALPN `h2`. HTTP/3 mandates encryption.
- **What transport does HTTP/3 use?** QUIC, which runs over **UDP** — not TCP, not a raw new
  IP protocol (middleboxes wouldn't pass it).
- **Why not just fix TCP?** TCP is implemented in the OS kernel and ossified by middleboxes;
  changing it globally is infeasible. QUIC in user space over UDP can evolve freely.
- **Is server push used?** No — it's effectively deprecated; browsers removed it. Use
  `preload` and `103 Early Hints` instead.
- **HPACK vs QPACK?** Same goal; QPACK decouples dynamic-table updates onto separate streams
  so out-of-order QUIC delivery doesn't reintroduce HOL blocking.
- **What breaks a TCP connection that QUIC survives?** An IP/port change (Wi-Fi↔cellular, NAT
  rebind). QUIC's Connection ID lets it migrate without a new handshake.
- **Why can 0-RTT be dangerous?** Early data can be replayed by an attacker; only idempotent
  requests should use it.
- **Does HTTP/3 fully eliminate HOL blocking?** It eliminates *cross-stream* transport HOL
  blocking; ordering *within* a single stream still applies.
- **How does a browser learn a site speaks HTTP/3?** Via the `Alt-Svc` header (RFC 7838) or
  an HTTPS DNS record (RFC 9460); the actual protocol pick is via ALPN `h3` in the QUIC
  handshake.
- **CONTINUATION Flood vs Rapid Reset?** Both are HTTP/2 DoS: Rapid Reset churns
  open+`RST_STREAM` pairs (visible, bypasses concurrency limit); CONTINUATION Flood sends
  `HEADERS` + endless `CONTINUATION` with no `END_HEADERS` (invisible in logs, OOM/CPU burn).
- **How does QUIC avoid being a DDoS amplifier?** The 3× anti-amplification limit on
  unvalidated addresses plus Retry-token return-routability validation (RFC 9000 §8).
- **Why did HTTP/3 look like H2 on the first request?** `Alt-Svc` is learned only after a
  prior connection; only an HTTPS/SVCB DNS record (RFC 9460) enables first-flight HTTP/3.
- **Can WebSocket run over HTTP/2 or HTTP/3?** Yes — Extended CONNECT (`:protocol`, RFC 8441)
  with `SETTINGS_ENABLE_CONNECT_PROTOCOL`; over HTTP/3 it is RFC 9220.
- **Why did domain sharding make HTTP/2 slower?** Sharding across subdomains fights H2/H3
  multiplexing and connection coalescing; consolidate to one origin.
- **How does QUIC recover from a rebooted server?** A Stateless Reset using a token from a
  prior `NEW_CONNECTION_ID` frame tells the peer the connection is dead.

---

## References

- RFC 9110 — HTTP Semantics
- RFC 9112 — HTTP/1.1
- RFC 9113 — HTTP/2 (obsoletes RFC 7540)
- RFC 7541 — HPACK: Header Compression for HTTP/2
- RFC 9218 — Extensible Prioritization Scheme for HTTP (replaces HTTP/2 priority tree)
- RFC 9114 — HTTP/3
- RFC 9204 — QPACK: Field Compression for HTTP/3
- RFC 9000 — QUIC: A UDP-Based Multiplexed and Secure Transport
- RFC 9001 — Using TLS to Secure QUIC
- RFC 9002 — QUIC Loss Detection and Congestion Control
- RFC 8446 — TLS 1.3
- RFC 7301 — Application-Layer Protocol Negotiation (ALPN)
- RFC 7838 — HTTP Alternative Services (Alt-Svc)
- RFC 9460 — Service Binding and Parameter Specification via DNS (SVCB/HTTPS records)
- RFC 8297 — HTTP 103 Early Hints
- RFC 9001 §5.4 — QUIC header protection
- RFC 9002 — QUIC Loss Detection and Congestion Control
- RFC 8441 — Bootstrapping WebSockets with HTTP/2 (Extended CONNECT / `:protocol`)
- RFC 9220 — Bootstrapping WebSockets with HTTP/3
- RFC 9298 — Proxying UDP in HTTP (CONNECT-UDP / MASQUE)
- RFC 8701 — Applying GREASE to TLS Extensibility (ossification resistance)
- CVE-2023-44487 — HTTP/2 Rapid Reset
- VU#421644 / CVE-2023-45288 — HTTP/2 CONTINUATION Flood
- MDN Web Docs — Evolution of HTTP; Cloudflare Learning Center — HTTP/2, HTTP/3, QUIC
