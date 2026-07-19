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
- CVE-2023-44487 — HTTP/2 Rapid Reset
- MDN Web Docs — Evolution of HTTP; Cloudflare Learning Center — HTTP/2, HTTP/3, QUIC
