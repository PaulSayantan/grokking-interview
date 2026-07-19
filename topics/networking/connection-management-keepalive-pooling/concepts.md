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

## References

- RFC 9293 — Transmission Control Protocol (TCP), incl. keepalive discussion
- RFC 9112 — HTTP/1.1 message syntax, persistent connections, `Connection` header
- RFC 9110 — HTTP Semantics (methods, status, `Connection` semantics)
- RFC 9113 — HTTP/2 (streams, multiplexing, forbidden `Connection` header)
- RFC 9114 — HTTP/3; RFC 9000 — QUIC transport
- RFC 896 — Congestion Control (Nagle's algorithm)
- RFC 1122 — Requirements for Internet Hosts (delayed ACK, TCP keepalive)
- RFC 5681 — TCP Congestion Control (slow start); RFC 6928 — Increasing the initial window (IW10)
- RFC 8446 — TLS 1.3 (1-RTT / 0-RTT resumption, PSK); RFC 5077 — TLS session tickets
- MDN Web Docs — "Connection management in HTTP/1.x", "Connection", "Keep-Alive" headers
