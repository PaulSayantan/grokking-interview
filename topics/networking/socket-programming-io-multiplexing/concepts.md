# Socket Programming & I/O Multiplexing

Sockets are the operating system's abstraction for network communication: an endpoint
identified by an IP address + port, exposed to programs as a file-like descriptor. The
**BSD (Berkeley) socket API** — `socket/bind/listen/accept/connect/send/recv/close` — is
the lingua franca that virtually every OS and language runtime copies (Winsock, Java NIO,
Python `socket`, Go's `net` package all wrap it). This topic is about the *mechanics*: how
you set up a connection, how blocking vs non-blocking I/O behaves, which knobs (socket
options) matter, and how servers scale to tens of thousands of connections using **I/O
multiplexing** (`select`/`poll`/`epoll`/`kqueue`) instead of a thread per connection.

> [!KEY-TAKEAWAY]
> A socket is just a file descriptor with network semantics. Everything hard about
> high-performance servers reduces to one question: *how does my process learn that a
> descriptor is ready to read or write without wasting a thread blocked on it?*

## The BSD Socket API model

The BSD socket API defines a small set of system calls, and their ordering encodes the
connection lifecycle. A socket is created with `socket(domain, type, protocol)`:

- `domain` — address family: `AF_INET` (IPv4), `AF_INET6` (IPv6), `AF_UNIX` (local).
- `type` — `SOCK_STREAM` (reliable, ordered byte stream → TCP) or `SOCK_DGRAM`
  (unreliable, message-oriented datagrams → UDP).
- `protocol` — usually `0`, letting the kernel pick the default for the type.

The call returns an integer **file descriptor** (fd). Because it is an fd, the same
`read`/`write`/`close` and `select`/`poll` machinery that works on files and pipes also
works on sockets — this uniformity is the whole point of the abstraction.

Data is moved with `send`/`recv` (socket-specific, take a `flags` argument like
`MSG_PEEK`, `MSG_DONTWAIT`, `MSG_OOB`) or the generic `write`/`read` (equivalent to
`send`/`recv` with `flags == 0`). `close()` releases the fd and, for TCP, initiates the
connection teardown (FIN). An address is packed into a `sockaddr` structure (`sockaddr_in`
for IPv4, `sockaddr_in6` for IPv6) carrying the family, port (network byte order), and
address.

> [!TIP]
> Ports and addresses in `sockaddr` are stored in **network byte order** (big-endian).
> Use `htons()`/`htonl()` when filling them in — forgetting this is a classic bug where a
> server "binds to the wrong port" (e.g. 36895 instead of 8080: 8080 = 0x1F90, whose
> bytes swapped give 0x901F = 36895).

## TCP sockets: the connection lifecycle

TCP is connection-oriented, so client and server follow different call sequences.

**Server side:**
1. `socket()` → get a listening fd.
2. `bind(fd, addr)` → attach it to a local IP + port.
3. `listen(fd, backlog)` → mark it passive; the kernel now completes handshakes and
   queues established connections.
4. `accept(fd)` → **dequeue** the next completed connection and return a *new* fd for that
   one client. The original listening fd stays open to accept more. Blocks if the queue is
   empty (unless non-blocking).
5. `recv`/`send` on the connected fd, then `close()`.

**Client side:**
1. `socket()`.
2. optionally `bind()` (usually skipped — the kernel auto-assigns an ephemeral source
   port, typically from range 49152–65535).
3. `connect(fd, server_addr)` → triggers the TCP 3-way handshake (SYN, SYN-ACK, ACK).
   Returns when the handshake completes (or `EINPROGRESS` on a non-blocking socket).
4. `send`/`recv`, then `close()`.

A TCP connection is uniquely identified by the **4-tuple** `(src IP, src port, dst IP, dst
port)`. This is why one server port can hold thousands of simultaneous connections: each
peer differs in its (IP, port) pair, so the tuples are distinct.

> [!WARNING]
> `accept()` returning a *new* fd is the most-tested subtlety. Reading/writing the
> listening fd is wrong; you communicate over the fd `accept()` hands back. The listening
> socket only ever produces connections, never carries data.

## UDP sockets: connectionless datagrams

UDP has no handshake and no connection state. You create a `SOCK_DGRAM` socket and:

- **Server:** `socket()` → `bind()` → `recvfrom()` / `sendto()`. No `listen()` or
  `accept()` — there is no connection to accept.
- **Client:** `socket()` → `sendto(dst_addr, ...)`. `bind()`/`connect()` are optional.

Each `sendto()` produces exactly one datagram and each `recvfrom()` reads exactly one
datagram (message boundaries are preserved, unlike TCP's byte stream). If your buffer is
smaller than the datagram, the excess is **discarded** (with `MSG_TRUNC` you can detect
it). A `recvfrom()` also yields the sender's address so you know who to reply to.

You *can* call `connect()` on a UDP socket: it doesn't send packets, it just stores a
default peer so you can use `send`/`recv` and receive asynchronous ICMP errors (e.g. "port
unreachable") as `ECONNREFUSED` on the next call — impossible on an unconnected UDP
socket.

| | TCP (`SOCK_STREAM`) | UDP (`SOCK_DGRAM`) |
|---|---|---|
| Setup | `listen`/`accept`/`connect` | none (optional `connect`) |
| Semantics | byte stream, no boundaries | preserved message boundaries |
| Per-client fd | yes (from `accept`) | no — one fd serves all peers |
| Read call | `recv`/`read` | `recvfrom` (gives sender addr) |

## Blocking vs non-blocking sockets

By default a socket is **blocking**: `recv` sleeps the calling thread until data arrives,
`accept` sleeps until a connection is queued, `connect` sleeps until the handshake
finishes, and `send` sleeps if the socket send buffer is full. Simple to reason about, but
one thread can only wait on one thing at a time.

Setting `O_NONBLOCK` (via `fcntl(fd, F_SETFL, ...)` or the `SOCK_NONBLOCK` flag) makes
calls return immediately:
- If the operation can't proceed, it returns `-1` with `errno == EWOULDBLOCK` (a.k.a.
  `EAGAIN` — they are the same value on Linux).
- `connect()` on a non-blocking socket returns `-1`/`EINPROGRESS`; you then wait for the
  socket to become **writable** to learn the handshake finished (checking `SO_ERROR` to
  distinguish success from failure).

Non-blocking sockets are the foundation of event loops: you never let a single fd stall
the thread. But polling a non-blocking socket in a busy loop ("spin") burns CPU — the
correct pattern is *non-blocking sockets + a readiness API* (`epoll`/`kqueue`) that sleeps
until at least one fd is ready.

> [!INTERVIEW]
> "What does `recv` return on a non-blocking socket with no data?" → `-1` and `errno` set
> to `EAGAIN`/`EWOULDBLOCK`. Contrast with `recv` returning **`0`**, which means the peer
> performed an orderly shutdown (received a FIN) — end of stream, not an error.

## Partial reads and writes

TCP is a **byte stream with no message boundaries**, so the count you ask for is not the
count you get. `recv(fd, buf, 4096, 0)` may return `1400` bytes even though 4096 are
"coming" — you must loop and re-read until you have a complete application message. Framing
(length prefix, delimiter, or fixed size) is the application's job, not TCP's. This is why
"I sent one 8 KB message but the server got two chunks" is expected behavior, not a bug.

Similarly `send(fd, buf, n, 0)` may accept fewer than `n` bytes (a **short write**) when
the kernel send buffer is nearly full, especially on non-blocking sockets. Correct code
loops on the returned count until all bytes are handed off:

```
sent = 0
while sent < n:
    r = send(fd, buf[sent:], n - sent, 0)
    if r < 0 and errno in (EAGAIN, EWOULDBLOCK):
        wait_for_writable(fd)   # via epoll/kqueue, then retry
        continue
    sent += r
```

> [!WARNING]
> A `send()` that succeeds means the bytes were copied into the **kernel socket buffer**,
> NOT that the peer received or read them. Delivery confirmation only comes from TCP ACKs
> and, ultimately, an application-level reply. Never treat a successful `send` as
> end-to-end delivery.

## Key socket options

Set with `setsockopt(fd, level, optname, ...)`. The ones interviewers ask about:

- **`SO_REUSEADDR`** — allows `bind()` to a port still in the `TIME_WAIT` state from a
  previous connection. Without it, restarting a server often fails with "Address already
  in use" because the old connection's 4-tuple lingers ~2×MSL. Nearly every server sets
  this.
- **`SO_REUSEPORT`** — lets *multiple* sockets (typically one per worker process/thread)
  bind the **same** IP:port; the kernel load-balances incoming connections across them.
  Key technique for scaling accept across cores and avoiding the "thundering herd" on a
  single listener. (Different from `SO_REUSEADDR`.)
- **`TCP_NODELAY`** — disables **Nagle's algorithm**. Nagle coalesces small writes to
  reduce tiny-packet overhead by holding data until the previous unacknowledged small
  segment is ACKed. Great for bulk transfer, terrible for latency-sensitive
  request/response (chat, RPC, games), where it adds up to a round-trip of delay —
  especially when it interacts badly with **delayed ACK**. Set `TCP_NODELAY` for
  interactive protocols.
- **`SO_KEEPALIVE`** — enables periodic keepalive probes on idle TCP connections to detect
  dead peers. Defaults are coarse (Linux: first probe after 2 hours idle), so tune
  `TCP_KEEPIDLE`/`TCP_KEEPINTVL`/`TCP_KEEPCNT`. Detects half-open connections where the
  peer vanished without sending a FIN.
- **`SO_RCVBUF` / `SO_SNDBUF`** — kernel receive/send buffer sizes; the receive buffer caps
  the TCP receive window and thus throughput on high-latency links (bandwidth-delay
  product).
- **`SO_LINGER`** — controls whether `close()` blocks to flush unsent data, and can force a
  hard **RST** reset instead of a graceful FIN when set with a zero timeout.

> [!TIP]
> `SO_REUSEADDR` vs `SO_REUSEPORT`: `REUSEADDR` mainly lets you rebind a port stuck in
> `TIME_WAIT` (one listener). `REUSEPORT` lets N distinct sockets share the port for
> in-kernel load balancing (N listeners). Interviewers love conflating them.

## The listen backlog and accept queue

`listen(fd, backlog)` sizes the queue of connections waiting to be `accept()`ed. Modern
Linux maintains **two** queues:

- **SYN queue (incomplete)** — connections mid-handshake (SYN received, SYN-ACK sent,
  awaiting the final ACK). Sized by `net.ipv4.tcp_max_syn_backlog`.
- **Accept queue (completed)** — fully established connections awaiting `accept()`. Sized
  by `min(backlog, net.core.somaxconn)`.

When the accept queue is full, new completed connections may be dropped or the final ACK
ignored, forcing the client to retransmit — appearing as connection latency or refusals
under load. A too-small `backlog` (or a slow accept loop) is a classic cause of tail
latency spikes during traffic bursts.

The **SYN flood** attack exploits the SYN queue: an attacker sends many SYNs but never the
final ACK, exhausting the incomplete queue. **SYN cookies** defend against this by encoding
connection state into the SYN-ACK sequence number so the server holds no per-connection
state until the handshake completes.

> [!WARNING]
> Passing `backlog = 1000` does not guarantee 1000 — the effective cap is
> `min(backlog, somaxconn)`, and on older kernels `somaxconn` defaulted to 128. Tune the
> sysctl if you need a deeper queue.

## The C10K problem

The **C10K problem** (coined by Dan Kegel, ~1999) asks: how does a single server handle
**10,000 concurrent connections**? The naive **thread-per-connection** (or
process-per-connection) model breaks down:

- Each thread needs a stack (often ~1 MB default) → 10K threads ≈ 10 GB of address space
  just for stacks.
- The OS scheduler and context-switch overhead grow with thread count.
- Old readiness APIs like `select`/`poll` are **O(n)** per call — cost scales with the
  number of connections you monitor, so a 10K-fd server re-scans 10K fds on every wakeup.

The solution combines **non-blocking sockets** with an **event-driven** architecture and
an **O(1) readiness API** (`epoll` on Linux, `kqueue` on BSD/macOS, IOCP on Windows) so a
handful of threads multiplex thousands of connections. The modern sequel, **C10M** (10
million), pushes further into kernel-bypass (DPDK), `SO_REUSEPORT` sharding across cores,
and user-space networking.

> [!KEY-TAKEAWAY]
> C10K is not "one connection is expensive" — TCP connections are cheap. It's that the
> *coordination* model (one thread each, O(n) scanning) doesn't scale. Fix the model:
> non-blocking I/O + scalable readiness notification + few threads.

## Readiness I/O models: select, poll, epoll, kqueue

These are **readiness notification** (a.k.a. synchronous I/O multiplexing) APIs: they let
one thread wait on many fds and report which are ready to read/write, so you then do
non-blocking I/O only on the ready ones.

- **`select()`** — POSIX, ubiquitous. You pass three `fd_set` bitmaps (read/write/except).
  Limitations: fd values capped by `FD_SETSIZE` (commonly **1024**); the kernel **rescans
  all fds** each call → O(n); the fd_sets are **modified in place** so you must rebuild
  them every iteration. Fine for small fd counts and maximum portability.
- **`poll()`** — POSIX. Takes an array of `pollfd` structs, so **no FD_SETSIZE limit** and
  a cleaner in/out separation (`events` vs `revents`). Still **O(n)**: the kernel and your
  code both walk the whole array each call.
- **`epoll`** (Linux) — a persistent kernel-side interest set. `epoll_create` makes an
  epoll fd; `epoll_ctl` registers/updates/removes fds *once*; `epoll_wait` returns only the
  **ready** fds → effectively **O(number of ready fds)**, not total fds. Scales to hundreds
  of thousands of connections. Supports level- and edge-triggered modes.
- **`kqueue`** (BSD, macOS) — the equivalent scalable API. More general than epoll: a
  single interface (`kevent`) reports not just socket readiness but timers, signals, file
  and process events. Also O(ready).

| API | Portability | Cost per wait | fd limit | Stateful registration |
|---|---|---|---|---|
| `select` | POSIX (all) | O(n) rescan | `FD_SETSIZE` (~1024) | no (rebuild each call) |
| `poll` | POSIX | O(n) rescan | none | no |
| `epoll` | Linux only | O(ready) | none | yes (`epoll_ctl`) |
| `kqueue` | BSD/macOS | O(ready) | none | yes (`kevent`) |

> [!TIP]
> "Why is `epoll` faster than `poll` at 10K fds?" → `poll` copies and re-scans all 10K fds
> on every call even if only 5 are ready. `epoll` keeps the interest set in the kernel and
> returns just the ~5 ready ones, so cost tracks *activity*, not *connection count*.

## Level-triggered vs edge-triggered

`epoll` and `kqueue` support two notification semantics:

- **Level-triggered (LT)** — the default (matches `select`/`poll`). Reports a fd as ready
  **as long as** the condition holds. If data is readable and you read only part of it,
  the next `epoll_wait` still reports it ready. Forgiving; you may drain in convenient
  chunks.
- **Edge-triggered (ET)** — notifies only on a **transition** (e.g. empty → data
  available). You get one wakeup per new edge, so you **must drain the fd completely** —
  keep calling `recv` until it returns `EAGAIN`/`EWOULDBLOCK` — or you'll miss data and
  stall the connection until the *next* edge. Fewer wakeups and syscalls; the standard
  choice for maximum-performance servers (e.g. nginx uses ET).

> [!WARNING]
> The #1 edge-triggered bug: reading once per notification. With ET you *must* loop reads
> (and writes) until `EAGAIN`. A partial read leaves data buffered with no further
> notification, so the connection appears to hang. ET therefore requires non-blocking
> sockets — a blocking `recv` in the drain loop would block on the final iteration.

## Thread-per-connection vs event loop

Two dominant server concurrency architectures:

**Thread-per-connection (blocking):** each accepted connection gets its own thread (or
process) doing simple blocking `recv`/`send`. Easy to write and debug; each request handler
is straight-line code. Costs: memory per thread stack, context-switch overhead, and a hard
ceiling around thousands of connections. Great when connection counts are modest or work is
CPU-bound anyway (a thread pool bounds concurrency).

**Event loop (reactor / non-blocking):** a few threads (often one per core) run a loop
around `epoll_wait`/`kqueue`, dispatching ready fds to handlers that never block. One
thread multiplexes thousands of connections. Excellent for **I/O-bound, high-connection,
mostly-idle** workloads (chat, proxies, push). Costs: inverted control flow (callbacks /
state machines / async-await), and a single **blocking call or CPU-heavy handler stalls
every connection** on that loop.

Hybrids are common: an event loop per CPU core (nginx, Netty, Node.js cluster,
`SO_REUSEPORT` sharding), plus offloading blocking/CPU work to a thread pool. Green threads
/ goroutines / virtual threads offer a third path: you *write* blocking-style code but the
runtime multiplexes it onto an epoll-backed event loop underneath, getting event-loop
scalability with thread-per-connection ergonomics.

| | Thread-per-connection | Event loop |
|---|---|---|
| Programming model | blocking, linear | callbacks / async / state machines |
| Scaling ceiling | ~thousands (stack + switch cost) | 100K+ connections |
| A slow handler | blocks one connection | blocks the whole loop |
| Best for | modest/CPU-bound | high-concurrency, I/O-bound |

## Reactor, Proactor, and true async I/O

The **Reactor** pattern is readiness-based: wait for "fd is *ready*," then *you* perform
the (non-blocking) read/write. `epoll`/`kqueue`-based servers are reactors.

The **Proactor** pattern is completion-based: you *submit* an operation and the OS performs
the I/O into your buffer, notifying you when it's **done**. Windows **IOCP** (I/O
Completion Ports) and Linux **`io_uring`** are completion-based. `io_uring` uses shared
submission/completion ring buffers between user space and kernel, cutting syscall overhead
and enabling batched, truly asynchronous I/O (including disk, where `epoll` never worked
well because regular files are "always ready").

> [!INTERVIEW]
> Readiness (`epoll`) vs completion (`io_uring`/IOCP): with readiness the kernel says "go
> ahead, it won't block" and you do the syscall; with completion you hand the kernel the
> buffer and it does the transfer, telling you when finished. Completion models avoid the
> "ready then syscall" round-trip and work for files, not just sockets.

## Common follow-up questions

- **What's the difference between `send` returning 0 bytes and `recv` returning 0?**
  `recv` returning `0` = orderly peer shutdown (FIN), end of stream. `send`/`recv`
  returning `-1` with `EAGAIN` = would block on a non-blocking socket. `send` returning a
  short count = kernel buffer nearly full; loop to send the rest.
- **Why does my server get "Address already in use" on restart?** The previous connection
  is in `TIME_WAIT` (~2×MSL) holding the 4-tuple. Set `SO_REUSEADDR` before `bind()`.
- **When should I disable Nagle (`TCP_NODELAY`)?** For latency-sensitive
  request/response/interactive traffic where small writes must go out immediately;
  Nagle + delayed ACK can add ~40 ms stalls. Keep Nagle for bulk throughput.
- **Why prefer edge-triggered epoll?** Fewer wakeups/syscalls under load; but you must
  fully drain each fd to `EAGAIN` and use non-blocking sockets.
- **Is one socket per port a limit on concurrent connections?** No — connections are keyed
  by the full 4-tuple, so a single listening port serves many clients. The practical
  limits are file-descriptor limits (`ulimit -n`), memory, and — for a *client* connecting
  to one server — the ~28K ephemeral source ports per (src IP, dst IP:port).
- **How do goroutines/virtual threads handle 100K connections without 100K OS threads?**
  The runtime parks a blocked "thread" and uses an epoll/kqueue-backed netpoller to resume
  it when the fd is ready, multiplexing many logical threads onto few OS threads.
- **Why can't `epoll` efficiently watch regular files?** Regular files are always reported
  ready (they never "block" in the readiness sense), so `epoll` is useless for disk I/O;
  that's a motivation for `io_uring`.

## References

- RFC 9293 — Transmission Control Protocol (TCP), 2022 (obsoletes RFC 793).
- RFC 768 — User Datagram Protocol (UDP).
- RFC 6335 — Port number ranges (system/user/dynamic-ephemeral 49152–65535).
- RFC 896 / RFC 1122 — Nagle's algorithm and TCP host requirements (delayed ACK).
- RFC 4987 — TCP SYN Flooding Attacks and Common Mitigations (SYN cookies).
- POSIX.1-2017 (IEEE Std 1003.1) — `socket`, `bind`, `listen`, `accept`, `connect`,
  `send`, `recv`, `select`, `poll` specifications (The Open Group Base Specifications).
- Linux man-pages: `socket(2)`, `accept(2)`, `listen(2)`, `epoll(7)`, `select(2)`,
  `poll(2)`, `tcp(7)`, `socket(7)`, `io_uring(7)`.
- FreeBSD/macOS: `kqueue(2)` manual page.
- Dan Kegel, "The C10K problem" (kegel.com/c10k.html).
- W. Richard Stevens, *UNIX Network Programming, Vol. 1* (socket API reference).
