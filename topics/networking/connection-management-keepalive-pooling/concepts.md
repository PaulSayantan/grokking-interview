# Connection Management: Keep-Alive, Pooling & Multiplexing

Opening a connection is expensive. Before a single byte of useful data moves, TCP must
complete a 3-way handshake, TLS must negotiate keys, and TCP's congestion control starts
cautiously in **slow start**. Connection *management* is the set of techniques — persistent
connections (keep-alive), client-side pooling, pipelining, multiplexing, session resumption
— that amortize this setup cost across many requests. This topic is about the **transport
and protocol mechanics** of reusing connections, not API design or capacity planning.

> [!KEY-TAKEAWAY]
> The cheapest request is one that reuses an already-warm connection. A warm connection has
> already paid for the TCP handshake, the TLS handshake, and has grown its congestion window
> past slow start. Reuse turns a multi-RTT setup into a zero-setup send.

---

## TCP connection setup cost: handshake and slow start

Every new TCP connection pays a fixed latency tax before it can carry a full-speed request.

**The 3-way handshake (RFC 9293).** Establishing a TCP connection costs one full round trip
before the client can send data:

```
Client                         Server
  | ---- SYN (seq=x) ----------> |
  | <--- SYN-ACK (seq=y,ack=x+1) |
  | ---- ACK (ack=y+1) --------> |   <- client can piggyback data on/after this ACK
```

The client can begin sending the request with (or right after) the third packet, so the
handshake adds **~1 RTT** of latency before the request even leaves. On a 100 ms RTT path
that is 100 ms of pure waiting.

**TLS handshake on top.** For HTTPS you then negotiate TLS. TLS 1.2 adds **2 RTTs**; TLS 1.3
(RFC 8446) cuts this to **1 RTT** (or **0-RTT** for resumed sessions). So a fresh HTTPS
connection over TLS 1.3 costs roughly 2 RTTs (1 for TCP + 1 for TLS) before the first
request byte is acknowledged.

**Slow start (RFC 5681).** Even after the connection is up, TCP does not immediately send at
full speed. It begins with a small **congestion window (cwnd)** — modern stacks use an
initial window of **10 MSS** (~14 KB, per RFC 6928) — and roughly doubles it each RTT until
it hits the receiver's window, a loss, or the slow-start threshold. A large response therefore
takes several RTTs to reach full throughput on a brand-new connection.

> [!TIP]
> This is *the* reason to reuse connections. A reused connection has already grown its cwnd,
> so it delivers large responses faster than a cold one, on top of skipping both handshakes.
> "Warm" connections are faster even after setup is done.

**Total cost of a cold HTTPS request** (TLS 1.3): ~1 RTT (TCP) + ~1 RTT (TLS) + slow-start
ramp. On a 100 ms path that is ~200 ms before data flows well — which is why opening a new
connection per request is a classic performance mistake.

---

## HTTP persistent connections and the Connection header

**Beginner definition.** *HTTP keep-alive* (a.k.a. **persistent connections**) means the
TCP connection stays open after a response so the next request on the same connection can
skip the TCP/TLS setup entirely.

**HTTP/1.0** closed the connection after each response by default. Reuse required the
explicit, non-standard header `Connection: keep-alive`. **HTTP/1.1 (RFC 9112) reversed the
default: connections are persistent unless a party sends `Connection: close`.** So in
HTTP/1.1 you get keep-alive for free.

```
GET /a HTTP/1.1
Host: example.com
            <- connection kept open; server responds and waits for the next request

GET /b HTTP/1.1
Host: example.com
Connection: close      <- tells the peer this is the last request; close after responding
```

**The `Connection` header is hop-by-hop.** It applies only to the single TCP hop between two
adjacent parties (e.g., client↔proxy), not end-to-end. A proxy must **not** forward the
`Connection` header, and it must also strip any header *named* in `Connection` (those are
also hop-by-hop). Headers like `Keep-Alive`, `Transfer-Encoding`, `Upgrade`, and `TE` are
hop-by-hop and must not be blindly forwarded.

**Message framing is a prerequisite for reuse.** To reuse a connection the receiver must know
exactly where one response ends and the next begins. HTTP/1.1 delimits bodies with either
`Content-Length` or `Transfer-Encoding: chunked`. Without a proper length/terminator the only
way to signal "end of body" is to close the connection — which defeats keep-alive.

> [!WARNING]
> "Connection: keep-alive" is essentially a **no-op in HTTP/1.1** — persistence is already
> the default. It only mattered in HTTP/1.0. In HTTP/2 and HTTP/3 the `Connection` header is
> forbidden entirely; connection management is handled by the protocol itself.

---

## Client-side connection pooling: why, sizing, and per-host limits

**What it is.** A connection pool is a client-side cache of open, reusable connections keyed
by destination (typically **scheme + host + port**, and for HTTPS effectively per TLS
config). Instead of opening a socket per request, the client borrows an idle connection from
the pool, uses it, and returns it for the next request.

**Why it matters.** Pooling amortizes handshake + slow-start cost across many requests, caps
resource usage (sockets, file descriptors, memory, server-side connection slots), and keeps
connections warm. Under load, a pool is the difference between reusing ~N warm connections and
opening thousands of cold ones.

**Per-host connection limits.** Browsers historically cap **~6 concurrent HTTP/1.1
connections per origin** (a limit that dates from RFC 2616's old "SHOULD be limited to 2"
guidance, since relaxed). This bounds server load but also bounds parallelism: with 6
connections and one in-flight request each, only 6 requests run at once — the rest queue.
This limit was a major driver for HTTP/2 multiplexing.

**Sizing a pool (server-to-server clients).** Use **Little's Law**: the number of connections
you need in flight is `L = λ × W`, where `λ` is request arrival rate (req/s) and `W` is mean
service time (seconds). Example: 500 req/s × 20 ms = 10 concurrent connections needed. Size
the pool near that with headroom; too small a pool causes requests to **queue for a
connection** (latency spikes), while too large a pool wastes memory and can overwhelm the
server's own connection limits.

| Pool too small | Pool too large |
|---|---|
| Requests block waiting to borrow a connection | Idle sockets consume memory / FDs |
| Latency spikes under bursts | Server-side connection exhaustion |
| Underutilizes network | More idle-timeout churn |

> [!INTERVIEW]
> A frequent question: "Your service calls a downstream at 1000 rps, p50 latency 50 ms. How
> big is the pool?" Answer with Little's Law: 1000 × 0.05 = **50 concurrent** as the floor,
> then add headroom for tail latency and bursts. Also mention: with HTTP/2 you may need far
> fewer connections because each is multiplexed.

**Gotchas.** Pools must **validate** connections before reuse — a server or middlebox may
have silently closed an idle connection (see idle timeouts). Borrowing a dead connection
yields errors that clients must retry. Pools also need eviction of connections idle longer
than the server's keep-alive timeout to avoid racing the server's close.

---

## HTTP/1.1 pipelining vs HTTP/2 multiplexing

**HTTP/1.1 pipelining.** Pipelining lets a client send multiple requests back-to-back on one
connection **without waiting** for each response. It sounds like concurrency, but responses
**must return in the same order the requests were sent** (FIFO). If the first response is
slow, every response behind it is stuck — **head-of-line (HOL) blocking at the application
layer**.

```
Pipelining (HTTP/1.1):
  -> GET /slow      -> GET /fast1   -> GET /fast2     (all sent immediately)
  <- (must answer /slow first) ... /fast1 ... /fast2  (strict FIFO — /fast* wait)
```

**Why pipelining failed in practice.**
- **HOL blocking**: one slow response stalls the whole pipe.
- **Buggy intermediaries**: many proxies/servers mis-handled pipelined requests, corrupting
  or reordering responses.
- **Non-idempotent risk**: on connection failure a client can't safely retry a pipelined
  POST because it can't tell which requests were processed.

As a result, **browsers ship with pipelining disabled by default** and it is effectively
dead.

**HTTP/2 multiplexing.** HTTP/2 (RFC 9113) solves this properly: a single TCP connection
carries many concurrent **streams**, each an independent request/response, split into
interleaved **binary frames**. Responses can return **in any order** and be interleaved, so a
slow response does not block others. This eliminates *application-layer* HOL blocking and
removes the need for 6 parallel connections.

| | Pipelining (HTTP/1.1) | Multiplexing (HTTP/2) |
|---|---|---|
| Concurrent requests | Yes (sent ahead) | Yes (true streams) |
| Response ordering | Strict FIFO | Any order, interleaved |
| App-layer HOL blocking | Yes | No |
| Deployment | Failed / disabled | Widely deployed |

> [!WARNING]
> HTTP/2 still runs on one **TCP** connection, so a lost TCP segment stalls *all* streams —
> **TCP-layer HOL blocking**. HTTP/2 removes application-layer HOL blocking but not
> transport-layer HOL blocking. HTTP/3 (over QUIC) fixes that by giving each stream
> independent loss recovery.

---

## Nagle's algorithm and TCP_NODELAY

**Nagle's algorithm (RFC 896).** Nagle reduces the number of tiny packets on the wire. Rule:
**if there is already unacknowledged data outstanding, buffer small writes until either a
full-MSS segment can be sent or the outstanding data is ACKed.** It exists to prevent
"tinygram" congestion from apps that write one byte at a time (classic Telnet).

**The pathological interaction: Nagle + delayed ACK.** TCP **delayed ACK** (RFC 1122) holds
back an ACK for up to ~200 ms hoping to piggyback it on a reply. Combine the two and you get
a deadlock-like stall: the sender withholds a small final segment (Nagle) waiting for an ACK,
while the receiver withholds the ACK (delayed ACK) waiting for more data. The result is a
**~200 ms latency spike** on small request/response exchanges — a notorious bug in
latency-sensitive protocols.

**TCP_NODELAY.** Setting the `TCP_NODELAY` socket option **disables Nagle's algorithm**, so
small segments are sent immediately. Latency-sensitive systems (RPC frameworks, databases,
games, HTTP/2 implementations) almost universally set `TCP_NODELAY`.

> [!TIP]
> Rule of thumb: if your app already batches writes into full messages (write the whole
> request at once), Nagle only hurts you — disable it with `TCP_NODELAY`. Nagle only helps
> chatty apps that emit many tiny writes and don't otherwise buffer.

- `TCP_NODELAY` = disable Nagle (send small segments now).
- `TCP_CORK`/`TCP_NOPUSH` = the *opposite*: aggressively coalesce until a full segment or the
  cork is released (useful for sending a header + file body as few packets).

---

## TCP keepalive vs HTTP keep-alive: two different things

These share the word "keepalive" but are unrelated mechanisms at different layers.

**HTTP keep-alive** = *application-layer* persistent connections: keep the connection open to
**reuse** it for more HTTP requests (see the persistent-connections section). It is about
*efficiency*.

**TCP keepalive (RFC 9293/1122)** = a *transport-layer* probe mechanism. When enabled via the
`SO_KEEPALIVE` socket option, TCP sends periodic empty probe segments on an **idle**
connection to detect whether the peer is still reachable (crashed host, cut cable, NAT that
dropped state). It is about *liveness detection and dead-connection cleanup*, not reuse.

| | HTTP keep-alive | TCP keepalive |
|---|---|---|
| Layer | Application (HTTP) | Transport (TCP) |
| Enabled by | Persistent connections / `Connection` header | `SO_KEEPALIVE` socket option |
| Purpose | Reuse connection for more requests | Detect a dead peer / clean up |
| Default timing | Server idle timeout (seconds) | Often **2 hours** idle before first probe |
| Direction | Efficiency | Reliability / resource cleanup |

**TCP keepalive default timing** is very slow: the classic default waits **~2 hours**
(`tcp_keepalive_time`) of idle before the first probe, then a few probes at intervals. That
is far too long for detecting dead peers in an app, which is why application-level heartbeats
or shorter tuned keepalive values are used in practice.

> [!WARNING]
> Interviewers love this trap: "Does HTTP keep-alive send TCP keepalive probes?" **No.** They
> are independent. HTTP keep-alive just leaves the socket open for reuse; it sends no probes.
> TCP keepalive is a separate socket option you must explicitly enable.

---

## Idle timeouts

An idle (keep-alive) connection cannot live forever — every party on the path may close it to
reclaim resources.

**Server idle timeout.** After serving a response the server waits a bounded time for the next
request (e.g., a web server's keep-alive timeout of a few seconds to ~60s). If nothing arrives
it closes the connection. This is a defense against holding thousands of idle sockets. The
`Keep-Alive: timeout=5, max=100` header can advertise the timeout and max requests per
connection.

**Client / pool idle timeout.** Clients evict connections idle beyond a threshold so they
don't hand out a connection the server is about to close.

**Middlebox / load-balancer idle timeout.** Load balancers, NATs, and firewalls drop idle
flow state after their own timeout (e.g., an AWS ALB defaults to ~60s idle). NAT gateways may
silently forget a mapping, so the connection is dead but neither endpoint knows.

**The race condition.** The classic keep-alive failure: the server (or LB) decides to close an
idle connection at the *same moment* the client sends a request on it. The client's request
hits a `FIN`/`RST` and fails. Mitigations:
- Set the **client's idle timeout lower** than the server's/LB's so the client retires the
  connection first.
- Retry idempotent requests on a fresh connection.
- Validate/probe connections before reuse.

> [!TIP]
> A robust rule: `client_idle_timeout < server_keepalive_timeout < LB_idle_timeout`. Keeping
> timeouts strictly increasing along the path avoids both ends trying to reuse a connection
> the other has just closed.

---

## Connection reuse and TLS session resumption

The biggest win from connection management is skipping repeated cryptographic setup.

**Full reuse (same connection).** If the same TCP+TLS connection is reused, subsequent
requests pay **zero** setup — no handshake, no key exchange — and ride an already-grown
congestion window.

**TLS session resumption (new connection, cached crypto state).** Sometimes you must open a
*new* connection (pool grew, old one closed) but can still avoid a *full* TLS handshake by
resuming prior TLS state:

- **TLS 1.2** offered **session IDs** (server caches state) and **session tickets** (RFC 5077;
  server encrypts state into a ticket the client stores). Resumption cuts the TLS handshake
  from 2 RTTs to **1 RTT**.
- **TLS 1.3 (RFC 8446)** uses a **PSK (pre-shared key)** mechanism established via a
  `NewSessionTicket` after the first handshake. A full TLS 1.3 handshake is 1-RTT; a resumed
  one can be **0-RTT** — the client sends application data ("early data") in its very first
  flight, alongside the ClientHello.

```
Fresh TLS 1.3:    ClientHello -> ... <- ServerHello ...   (1 RTT before data)
Resumed 0-RTT:    ClientHello + early data ->             (0 RTT — data in first packet)
```

> [!WARNING]
> **0-RTT early data is replayable.** An attacker can capture and resend the first flight, so
> 0-RTT data must be restricted to **idempotent, replay-safe** requests (e.g., GET). Never put
> a non-idempotent operation (a payment, a POST that mutates state) in 0-RTT early data.

**QUIC / HTTP/3.** QUIC (RFC 9000) folds the transport and TLS 1.3 handshakes together, so a
fresh connection is 1-RTT and a resumed one is 0-RTT — combining connection setup and crypto
setup into one exchange.

**Summary of savings.**

| Scenario | Setup cost (TLS 1.3) |
|---|---|
| Reuse existing warm connection | 0 RTT, no crypto, warm cwnd |
| New connection, resumed session (0-RTT) | 1 RTT TCP; TLS 0-RTT (data in first flight) |
| New connection, resumed session (1-RTT) | 1 RTT TCP + 1 RTT TLS |
| New connection, full handshake | 1 RTT TCP + 1 RTT TLS + slow start |

---

## Ephemeral ports, the 4-tuple, and TIME_WAIT

Pooling is not just a latency optimization — at scale it is what keeps you from running out
of *sockets*.

**A connection is a unique 4-tuple.** TCP (and UDP) identifies a connection by
`(source IP, source port, destination IP, destination port)`. Two connections may share three
of the four fields but must differ in at least one. For a single client talking to a single
`(dst IP, dst port)`, the only field that can vary is the **source (ephemeral) port**.

**Ephemeral-port exhaustion.** The OS allocates a source port from the *ephemeral range*. On
Linux `net.ipv4.ip_local_port_range` defaults to **32768–60999** — roughly **28,000 ports**.
So a single client can hold at most ~28k *simultaneous* connections to one destination
`IP:port`. Blow past that and `connect()` fails with `EADDRNOTAVAIL`/`EADDRINUSE`. Mitigations:
- **Pool / keep-alive** so you reuse a handful of sockets instead of opening thousands.
- Spread load across **multiple destination IPs or ports** (each new dst widens the 4-tuple space).
- Add **more source IPs** on the client.
- `IP_BIND_ADDRESS_NO_PORT` lets the kernel defer source-port selection until `connect()`, so it
  can pick a port that is unique *for that specific destination* — dramatically increasing the
  usable port count when connecting to many destinations.

**TIME_WAIT — the active closer pays.** Whichever side sends the first `FIN` and completes the
close (the **active closer**) parks the socket in **`TIME_WAIT` for 2×MSL** (Maximum Segment
Lifetime) — commonly **~60 s** on Linux (30–120 s on other stacks). This exists to (a) absorb
delayed/duplicate segments from the old connection so they aren't mis-delivered to a new
connection reusing the same 4-tuple, and (b) ensure the final ACK can be retransmitted if lost.
High connection churn (open→close→open→close) piles up thousands of `TIME_WAIT` sockets,
consuming ports and memory → `EADDRINUSE`. **The clean fix is to stop closing connections at
all — reuse them via keep-alive/pooling.**

- `SO_REUSEADDR` lets a listener rebind while old sockets sit in `TIME_WAIT`; `SO_REUSEPORT`
  lets multiple sockets bind the same port for load distribution — neither "removes" TIME_WAIT.
- `net.ipv4.tcp_tw_reuse` lets the *client* reuse a `TIME_WAIT` socket for a new outbound
  connection when it's provably safe (timestamps). The old `tcp_tw_recycle` was **removed** from
  Linux because it broke clients behind NAT (it keyed on per-source timestamps).

**CLOSE_WAIT is a different animal — and usually a bug.** When the peer closes and you receive
its `FIN`, your socket enters `CLOSE_WAIT` and stays there **until your application calls
`close()`**. It is *not* governed by a timer. A growing pile of `CLOSE_WAIT` sockets means the
application is leaking connections (not closing them after the peer hung up) — a code defect,
in contrast to `TIME_WAIT`, which is normal protocol behavior on the active closer.

> [!INTERVIEW]
> "Under load you get `EADDRINUSE` connecting to one downstream." → ephemeral-port/`TIME_WAIT`
> exhaustion from per-request connections. "`CLOSE_WAIT` sockets are piling up on my server." →
> the app isn't calling `close()` after the peer's `FIN`; distinct from `TIME_WAIT`.

---

## Happy Eyeballs: dual-stack connection racing

On a dual-stack (IPv6 + IPv4) host, a broken or slow IPv6 path used to cause multi-second
connect stalls because clients tried IPv6 first and only fell back to IPv4 after a long
timeout. **Happy Eyeballs v2 (RFC 8305)** minimizes cold-connection setup latency by *racing*
address families instead of serially timing out.

- **Resolution:** issue the **AAAA (IPv6)** and **A (IPv4)** DNS queries roughly together. If
  the A answer arrives first, wait a short **Resolution Delay (default 50 ms)** for the AAAA
  answer so IPv6 gets a fair chance (the algorithm *prefers* IPv6 when both work).
- **Connection racing:** start a TCP (or QUIC) handshake to the first address, then stagger
  attempts to further addresses by the **Connection Attempt Delay** — default **250 ms**
  (bounded to a minimum of 100 ms and a maximum of 2 s; a hard floor of 10 ms). The **first
  handshake to complete wins**; all other in-flight attempts are cancelled.
- **Caching:** remember the winning address family for subsequent connections to avoid
  re-racing.

The effect: on a healthy IPv6 path you use IPv6; on a broken one you fail over in ~250 ms
instead of stalling on a 20+ s TCP timeout. This is a *connection-setup* optimization — it
affects only how fast a **cold** connection is established, not reuse.

> [!INTERVIEW]
> "IPv6 users see multi-second connect stalls, IPv4 users don't." → a broken IPv6 path with no
> Happy Eyeballs racing; implement RFC 8305 (50 ms resolution delay, 250 ms attempt staggering).

---

## HTTP/2 flow control and concurrent-stream limits

Multiplexing many streams over one connection needs its own throttles, or one greedy stream
would starve the rest or overrun a slow receiver.

**Credit-based flow control (RFC 9113 §5.2, §6.9).** Only **DATA frames** are flow-controlled
(headers, SETTINGS, etc. are not). Flow control operates at **two levels simultaneously**: per
**stream** and for the **whole connection**. The initial per-stream window is
**65,535 octets** (`SETTINGS_INITIAL_WINDOW_SIZE` default). A sender may transmit DATA only up
to the smaller of the two available windows; the receiver replenishes credit with
**`WINDOW_UPDATE`** frames as it consumes data. Flow control is **hop-by-hop** (each endpoint
manages its own windows) and cannot be disabled, though you can effectively neutralize it by
advertising a very large window.

**Why "HTTP/2 is slow under load" is often a flow-control bug.** If windows stay small (default
64 KB per stream), a high-bandwidth-delay-product path can't keep enough data in flight — each
stream stalls waiting for `WINDOW_UPDATE`, re-introducing *per-stream* stalls that look like
HOL blocking but are actually self-inflicted throttling. Tuning `SETTINGS_INITIAL_WINDOW_SIZE`
and the connection window upward is the fix.

**`SETTINGS_MAX_CONCURRENT_STREAMS` (§6.5.2).** HTTP/2 removes the browser 6-connection limit
but replaces it with a *per-peer* cap on how many streams may be open at once. The spec
**recommends ≥ 100** and says it SHOULD NOT be 0. This is the real answer to "how many
concurrent requests can one HTTP/2 connection run?" — it is bounded by the peer's advertised
setting, not unlimited. Exceeding it doesn't error the connection: the server returns
**`REFUSED_STREAM`** (see below), telling the client to open the stream later or on another
connection.

---

## SETTINGS_MAX_CONCURRENT_STREAMS, REFUSED_STREAM, and safe retries

HTTP/1.1 has no safe way to auto-retry a non-idempotent request after a mid-flight failure —
you can't tell whether the server processed it. **HTTP/2 gives you an explicit wire signal.**

**`REFUSED_STREAM` (RFC 9113 §8.1.1, error code 0x7).** A server sends `RST_STREAM` with error
`REFUSED_STREAM` to say "I have **not** started processing this stream" — e.g., it hit
`SETTINGS_MAX_CONCURRENT_STREAMS`, or is shutting down and the stream is above a `GOAWAY`
Last-Stream-ID. Because the guarantee is *definitely not processed*, the client **may safely
retry the request on a new connection — even a non-idempotent POST.** Contrast
`PROTOCOL_ERROR`/`INTERNAL_ERROR`, which give no such "not processed" guarantee, so retrying a
non-idempotent request is unsafe. `REFUSED_STREAM` is the H2 answer to the idle-timeout/half-open
retry problem the HTTP/1.1 sections raise.

> [!INTERVIEW]
> "Is it ever safe to auto-retry a POST?" Normally no — but **yes** if the server signalled the
> request was not processed: `REFUSED_STREAM`, or a stream above a `GOAWAY` Last-Stream-ID.
> Those are the precise wire signals that make an otherwise-unsafe retry safe.

---

## GOAWAY and graceful connection draining

Long-lived multiplexed connections must be *cycled* — for deploys, autoscaling, and LB
rebalancing — without dropping in-flight requests. **`GOAWAY` (RFC 9113 §6.8)** is how HTTP/2
does it (HTTP/3 mirrors this in RFC 9114 §5.2).

A `GOAWAY` frame carries three things:
- **Last-Stream-ID** — the highest stream the sender "processed or might have processed."
  Streams with a **higher** ID were definitively **not** processed and are safe to retry on a
  new connection (they'll get `REFUSED_STREAM` semantics).
- **Error Code** — `NO_ERROR (0x0)` for a graceful shutdown, or a real error.
- **Optional debug data** — free-form diagnostic bytes.

**The double-GOAWAY graceful-shutdown pattern.** The canonical "deploy without dropping
requests" recipe:
1. Send a **first `GOAWAY` with `NO_ERROR` and Last-Stream-ID = 2³¹−1 (the maximum)**. This
   tells the peer "stop opening *new* streams" while explicitly promising that everything
   currently in flight will still be processed. (In HTTP/3 the "max" sentinel is a large
   VarInt.)
2. Let in-flight streams **drain** (optionally after one RTT so the peer has seen the first
   GOAWAY).
3. Send a **second `GOAWAY` with the real Last-Stream-ID** once you're done, then close.

This lets a client cleanly migrate remaining/new requests to a fresh connection while finishing
the ones already accepted — no lost RPCs during a rolling restart.

> [!INTERVIEW]
> "How do you restart an HTTP/2 / gRPC server behind an LB without dropping in-flight RPCs?" →
> double-`GOAWAY` graceful drain (first with max Last-Stream-ID to stop new streams, second with
> the real one after draining), often paired with gRPC `MAX_CONNECTION_AGE` + `_GRACE`.

---

## HTTP/2 connection coalescing and 421 Misdirected Request

"One HTTP/2 connection per origin" understates reality: a client MAY **coalesce** requests for
*multiple* authorities onto a single connection (RFC 9113 §9.1.1).

**When coalescing is allowed.** A client may reuse an existing connection for a different host
if **(1)** the connection's TLS certificate is valid for that host (e.g., a wildcard or SAN
covering both), **and (2)** the host resolves to the **same IP address** the connection already
goes to. This saves handshakes across sibling domains served by the same fleet/CDN.

**When it goes wrong — 421.** If a request is coalesced onto a connection whose server can't (or
won't) serve that authority, the server responds **`421 Misdirected Request`**. The client must
then **retry that request on a fresh connection** to the correct origin (and stop coalescing it).
This is common behind sharded backends where the cert covers many hosts but each backend serves
only some.

**HTTP/3 tightens this.** Over QUIC (RFC 9114 §3.3) a client must **re-validate the certificate
for each origin** before reusing a connection and SHOULD NOT open more than one connection to a
given `IP:UDP-port`. The coalescing concept interacts directly with domain sharding and pool
design: aggressive coalescing reduces connections but can concentrate load and trigger 421s.

---

## HTTP/2 PING and gRPC keepalive

The "three keepalives" section covers HTTP keep-alive and TCP keepalive; **HTTP/2 (and HTTP/3)
PING is a genuine fourth liveness tool**, living at the protocol/framing layer.

**H2 PING (RFC 9113 §6.7).** A `PING` frame carries **8 opaque octets** of payload. The receiver
**MUST** send back a `PING` with the **ACK flag (0x1)** set and the *identical* payload. PING is
a connection-level frame (stream 0) used for two things: **liveness** (is the peer still
responsive?) and **RTT measurement** (time from PING to its ACK). It is distinct from TCP
keepalive (transport probe on an idle socket) and HTTP keep-alive (leaving the socket open for
reuse).

**gRPC keepalive is H2 PING in practice.** gRPC exposes concrete knobs:
- Client `KEEPALIVE_TIME` (how often to PING; **default disabled**), `KEEPALIVE_TIMEOUT`
  (**20 s** to wait for the ACK before declaring the connection dead), and
  `KEEPALIVE_WITHOUT_CALLS` (whether to PING even with no active RPCs).
- Server enforcement: `PERMIT_KEEPALIVE_TIME` (minimum interval it will tolerate, **default
  5 min**) and `PERMIT_KEEPALIVE_WITHOUT_CALLS`. A client that PINGs **too aggressively** gets a
  **`GOAWAY` with error `ENHANCE_YOUR_CALM (0xb)`** and debug data **`"too_many_pings"`**, and is
  disconnected.
- `MAX_CONNECTION_AGE` + `MAX_CONNECTION_AGE_GRACE` force the server to cycle connections after a
  bounded lifetime (via graceful `GOAWAY`), which is how gRPC deployments **rebalance long-lived
  multiplexed connections across backends**.

> [!INTERVIEW]
> "gRPC clients get `ENHANCE_YOUR_CALM` / `too_many_pings` and disconnect." → the client's
> keepalive interval is below the server's `PERMIT_KEEPALIVE_TIME`; raise the client interval or
> lower the server's minimum (and set `KEEPALIVE_WITHOUT_CALLS` deliberately).

---

## Connection affinity vs stateless pooling

Long-lived, multiplexed connections change how load balancing behaves.

**Stateless pooling** routes each request to *any* backend; a pool of short-or-long connections
can fan out across the fleet. **Sticky / affinity** routing pins a client (or connection) to a
*specific* backend — required for stateful sessions.

**The multiplexing/LB tension.** An **L4 (transport) load balancer** balances *connections*, not
requests. It pins an entire HTTP/2 connection to one backend, so **all multiplexed streams on
that connection land on the same server** — a single long-lived connection can hotspot one pod
while others sit idle. An **L7 / gRPC-aware load balancer** balances per-request/per-stream, so
multiplexed streams spread across backends.

**Fixes for H2/gRPC imbalance:** use an L7 (request-level) balancer or client-side per-call load
balancing; and/or force periodic reconnection with gRPC `MAX_CONNECTION_AGE` so the pinned
connection is torn down (via graceful `GOAWAY`) and re-established, letting the balancer re-spread
it.

> [!INTERVIEW]
> "My gRPC/H2 traffic piles onto one backend pod despite 20 replicas." → an L4 LB pinned the
> long-lived multiplexed connection to one backend; switch to L7/per-request balancing or churn
> connections with `MAX_CONNECTION_AGE`.

---

## QUIC connection migration and Connection IDs

TCP identifies a connection by its **4-tuple**, so any change to the tuple — a NAT rebinding, a
device roaming from Wi-Fi to cellular — **kills** the TCP connection and forces a full
re-handshake. QUIC (RFC 9000) fixes this at the design level.

**Connection ID, not the 4-tuple.** A QUIC connection is keyed by a **Connection ID** carried in
the packet header, negotiated during the handshake (each side can supply several). Because
identity is decoupled from the IP/port tuple, packets arriving from a **new source address/port**
can still be matched to the existing connection.

**Connection migration.** When the client's address changes (NAT timeout re-mapping, Wi-Fi →
cellular handoff), it continues on the **same** QUIC connection — no new handshake, no lost TLS
state, in-flight streams survive. The endpoint validates the new path (a **path challenge /
response** to prevent address-spoofing amplification) and carries on. This also gives natural
resilience to NAT idle timeouts.

**Why H2 can't do this.** HTTP/2 rides TCP; TCP's connection *is* the 4-tuple, so there is no
protocol mechanism to move a live connection to a new address. Connection migration is a concrete
"what can HTTP/3 do that HTTP/2 fundamentally cannot?" answer.

---

## Congestion window state: slow start after idle

Slow start isn't only a cold-start cost — it can bite a **warm but idle** pooled connection too.

**Congestion window is per-connection state, and it decays when idle.** The `cwnd` a connection
grew during a burst is not kept forever. Under RFC 5681 guidance (and the Linux
`net.ipv4.tcp_slow_start_after_idle` default of **1/on**), a connection that has been **idle
longer than one RTO** resets its congestion window back to the initial window and must
**slow-start again** on the next send. So a pooled connection that sat quiet between bursts can
deliver its first post-idle response *slower* than you'd expect from a "warm" connection — a
subtle reason pooling alone doesn't guarantee full throughput. Disabling
`tcp_slow_start_after_idle` (or sending periodic traffic) keeps the window warm.

**BBR vs CUBIC.** The ramp behavior also depends on the congestion-control algorithm. **CUBIC**
(long the Linux default) is loss-based: it grows `cwnd` until loss, then backs off — it can
under-fill high-bandwidth-delay paths and is sensitive to random loss. **BBR** (Bottleneck
Bandwidth and RTT, from Google) models the path's bandwidth and RTT directly instead of treating
loss as the only congestion signal, often ramping faster and sustaining higher throughput on
lossy long-fat networks. The modern shift toward BBR (widely deployed for QUIC/HTTP/3) changes how
quickly a fresh or post-idle connection reaches full speed.

---

## Retry safety: idempotency and method semantics

Several connection-management failure modes (idle-timeout race, half-open pooled connection,
`GOAWAY`, 0-RTT) all reduce to one question: **is this request safe to send again?** RFC 9110
§9.2 defines the vocabulary:

- **Safe** methods — `GET`, `HEAD`, `OPTIONS`, `TRACE` — are read-only; sending them has no
  side effects.
- **Idempotent** methods — safe methods **plus** `PUT` and `DELETE` — can be sent N times with
  the same effect as once.
- **Neither** — `POST` (and `PATCH`) are not idempotent by default; a duplicate may create two
  resources or double-charge.

**The rule.** Only **safe/idempotent** requests may be *automatically* retried on a broken or
half-open pooled connection, or placed in TLS 1.3 **0-RTT early data** (which is replayable). A
`POST` may be auto-retried **only** when the server guarantees it was **not processed** —
`REFUSED_STREAM`, or a stream above a `GOAWAY` Last-Stream-ID. Application-level **idempotency
keys** let you make a POST safely retryable regardless of transport signals. This ties together
the idle-timeout race, `REFUSED_STREAM`, and 0-RTT sections.

---

## 0-RTT anti-replay defenses

The resumption section flags that TLS 1.3 **0-RTT early data is replayable**; here is what
actually defends against it (RFC 8446 §8, and RFC 9001 for QUIC).

- **Single-use session tickets** — the server issues a ticket the client may use only once; a
  replayed early-data flight presents an already-consumed ticket and is rejected.
- **Freshness / strike registers** — the server records recently-seen ClientHello identifiers
  (within a bounded time window) and rejects duplicates.
- **Bounded early-data window** — `max_early_data_size` caps how much 0-RTT data is accepted, and
  time-windows the risk.
- **Server MAY reject early data entirely** — it can respond as if the data weren't sent; the
  client **must be prepared to re-send the request at 1-RTT** once the handshake completes. So
  0-RTT is best-effort: never rely on it succeeding.
- Even with these, application semantics still matter — keep non-idempotent operations out of
  0-RTT regardless.

**QUIC adds address validation.** Before doing expensive work for a new client, a QUIC server MAY
send a **`Retry` packet** carrying a token the client must echo, proving it owns its source
address (anti-spoofing). QUIC also enforces an **anti-amplification limit** (a server may send at
most ~3× the bytes it has received from an unvalidated address), which bounds how much a spoofed
0-RTT/Initial flight can be abused as a reflection amplifier.

---

## Common follow-up questions

- **"Why is opening a new connection per request slow?"** TCP handshake (~1 RTT) + TLS
  handshake (1–2 RTTs) + slow-start ramp before full throughput. Reuse skips all of it.
- **"What does `Connection: keep-alive` do in HTTP/1.1?"** Essentially nothing —
  persistence is already the default. It mattered only in HTTP/1.0. `Connection: close`
  is the meaningful one in HTTP/1.1.
- **"Why did HTTP/1.1 pipelining fail?"** Response FIFO ordering causes head-of-line
  blocking, buggy intermediaries broke it, and retrying non-idempotent pipelined requests is
  unsafe. Browsers disable it.
- **"How does HTTP/2 multiplexing differ from pipelining?"** True independent streams with
  interleaved binary frames and any-order responses — no application-layer HOL blocking.
- **"Does HTTP/2 fully eliminate head-of-line blocking?"** No — it removes app-layer HOL but
  a lost TCP segment still stalls all streams (TCP-layer HOL). HTTP/3/QUIC fixes that.
- **"Nagle vs delayed ACK — what's the classic bug?"** They interact to add ~200 ms latency
  on small write/reply patterns; disable Nagle with `TCP_NODELAY`.
- **"Is TCP keepalive the same as HTTP keep-alive?"** No. TCP keepalive (`SO_KEEPALIVE`) is a
  transport liveness probe (default ~2h idle); HTTP keep-alive is app-layer connection reuse.
- **"How do you size a connection pool?"** Little's Law: `connections ≈ arrival_rate ×
  service_time`, plus headroom for tail latency/bursts.
- **"Why do keep-alive connections sometimes fail on reuse?"** A server/LB/NAT idle timeout
  closed the connection out from under the client. Keep client timeout < server timeout and
  retry idempotent requests.
- **"What's the benefit of TLS session resumption?"** Skip the full handshake on new
  connections: TLS 1.2 → 1 RTT; TLS 1.3 → 0-RTT (with replay-safety caveats).
- **"Why does high connection churn cause `EADDRINUSE`?"** The active closer holds each socket
  in `TIME_WAIT` for ~2×MSL (~60 s), exhausting the ~28k ephemeral ports to one destination.
  Pool/keep-alive to stop closing; or widen the 4-tuple with more dst IPs/ports.
- **"`TIME_WAIT` vs `CLOSE_WAIT`?"** `TIME_WAIT` is normal, on the active closer, timer-based
  (~2×MSL). `CLOSE_WAIT` sits until the app calls `close()` — a pile-up is a connection leak bug.
- **"How many concurrent requests on one HTTP/2 connection?"** Bounded by the peer's
  `SETTINGS_MAX_CONCURRENT_STREAMS` (recommended ≥100); exceeding it yields `REFUSED_STREAM`.
- **"When is it safe to auto-retry a POST?"** Only when the server guarantees non-processing:
  `REFUSED_STREAM`, or a stream above a `GOAWAY` Last-Stream-ID — or with an idempotency key.
- **"How do you deploy an H2/gRPC server without dropping in-flight RPCs?"** Double-`GOAWAY`
  drain (first with max Last-Stream-ID to stop new streams, second after draining), plus
  gRPC `MAX_CONNECTION_AGE`/`_GRACE`.
- **"Why does gRPC traffic pile onto one pod?"** An L4 LB pins the long-lived multiplexed
  connection to one backend; use L7/per-request balancing or churn with `MAX_CONNECTION_AGE`.
- **"What can HTTP/3 do that HTTP/2 fundamentally can't?"** Survive a 4-tuple change (NAT
  rebind, Wi-Fi→cellular) via QUIC connection migration keyed on Connection ID — TCP dies.
- **"Why do IPv6 users see connect stalls but IPv4 users don't?"** Broken IPv6 path with no
  Happy Eyeballs (RFC 8305) racing; add the 50 ms resolution delay + 250 ms attempt staggering.

## References

- RFC 9293 — Transmission Control Protocol (TCP), incl. keepalive discussion
- RFC 9112 — HTTP/1.1 message syntax, persistent connections, `Connection` header
- RFC 9110 — HTTP Semantics (methods, status, `Connection` semantics)
- RFC 9113 — HTTP/2 (streams, multiplexing, forbidden `Connection` header)
- RFC 9114 — HTTP/3; RFC 9000 — QUIC transport
- RFC 896 — Congestion Control (Nagle's algorithm)
- RFC 1122 — Requirements for Internet Hosts (delayed ACK, TCP keepalive)
- RFC 5681 — TCP Congestion Control (slow start); RFC 6928 — Increasing the initial window (IW10)
- RFC 8446 — TLS 1.3 (1-RTT / 0-RTT resumption, PSK, §8 anti-replay); RFC 5077 — TLS session tickets
- RFC 9001 — Using TLS to secure QUIC (0-RTT, `Retry`/address validation, amplification limit)
- RFC 8305 — Happy Eyeballs v2 (dual-stack connection racing)
- RFC 9000 — QUIC transport (Connection IDs, connection migration, path validation)
- RFC 9113 — HTTP/2 (§5.2/§6.9 flow control, §6.5.2 SETTINGS_MAX_CONCURRENT_STREAMS, §6.7 PING, §6.8 GOAWAY, §8.1.1 REFUSED_STREAM, §9.1.1 coalescing)
- RFC 9114 — HTTP/3 (§5.2 GOAWAY, §3.3 connection reuse/coalescing)
- gRPC docs — keepalive (`KEEPALIVE_TIME`/`_TIMEOUT`, `PERMIT_KEEPALIVE_TIME`, `MAX_CONNECTION_AGE`), ENHANCE_YOUR_CALM/too_many_pings
- Linux tunables — `ip_local_port_range`, `tcp_tw_reuse`, `tcp_slow_start_after_idle`; `IP_BIND_ADDRESS_NO_PORT`
- MDN Web Docs — "Connection management in HTTP/1.x", "Connection", "Keep-Alive" headers; MDN "421 Misdirected Request"
