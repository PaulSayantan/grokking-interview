# TCP Deep Dive: Handshake, Flow & Congestion Control

TCP (Transmission Control Protocol) is the connection-oriented, reliable, byte-stream
transport that carries most of the web (HTTP/1.1, HTTP/2, TLS). The current
authoritative specification is **RFC 9293** (August 2022), which obsoletes the classic
RFC 793 and folds in decades of errata and clarifications. This topic covers how a TCP
connection is set up, how it guarantees ordered/reliable delivery, how it protects a slow
receiver (flow control), and how it protects the network (congestion control).

> [!KEY-TAKEAWAY]
> TCP provides four core guarantees over the unreliable IP datagram service:
> **connection setup/teardown**, **reliable + ordered delivery** (sequence numbers,
> ACKs, retransmission), **flow control** (receiver window — protect the *receiver*),
> and **congestion control** (protect the *network*). Flow control and congestion
> control are different mechanisms solving different problems.

## The Three-Way Handshake and Sequence Numbers

TCP is connection-oriented: before any data flows, both endpoints agree on starting
sequence numbers and options. This is the **three-way handshake**:

```
Client                              Server
  |  SYN  seq=x                       |   (client: SYN_SENT)
  | --------------------------------> |   (server: SYN_RECEIVED)
  |  SYN-ACK  seq=y, ack=x+1          |
  | <-------------------------------- |
  |  ACK  seq=x+1, ack=y+1            |   (both: ESTABLISHED)
  | --------------------------------> |
```

1. **SYN**: client picks an **Initial Sequence Number (ISN)** `x` and sends a segment
   with the SYN flag set and `seq=x`.
2. **SYN-ACK**: server picks its own ISN `y`, acknowledges the client's SYN with
   `ack=x+1`, and sends its own SYN with `seq=y`.
3. **ACK**: client acknowledges the server's SYN with `ack=y+1`. The connection is now
   ESTABLISHED and either side may send data.

**Why three messages?** Each direction of the byte stream must be independently
synchronized (both SYNs acknowledged). The server's SYN and its ACK of the client's SYN
are piggy-backed into one segment, so the four logical steps collapse to three.

**The SYN consumes one sequence number.** That is why the ACK is `ISN+1` even though no
application data was sent. FIN also consumes one sequence number.

**Why is the ISN random?** RFC 9293 (following RFC 6528) mandates a randomized ISN to
prevent off-path attackers from guessing sequence numbers and injecting/spoofing
segments, and to avoid confusing delayed segments from a previous incarnation of the same
4-tuple with the new connection.

> [!TIP]
> A TCP connection is identified by the **4-tuple**: (source IP, source port,
> destination IP, destination port). Two connections that share three of the four fields
> are still distinct.

**SYN flood defense — SYN cookies.** A half-open connection (SYN received, ACK not yet
back) consumes a slot in the backlog queue. Attackers flood SYNs to exhaust it. **SYN
cookies** let the server encode the necessary state into the ISN it sends in the SYN-ACK,
so it need not allocate memory until the final ACK returns and validates the cookie.

**TCP Fast Open (TFO, RFC 7413)** allows data in the SYN on a repeat connection using a
server-issued cookie, saving one RTT — but it is not universally deployed and has replay
considerations.

## TCP Segment Header and Flags

The TCP header is 20 bytes minimum (up to 60 with options). Key fields:

| Field | Bits | Purpose |
|---|---|---|
| Source / Dest port | 16 each | Identify endpoints (with IPs form the 4-tuple) |
| Sequence number | 32 | Byte offset of first data byte in this segment |
| Acknowledgment number | 32 | Next byte the sender **expects** (cumulative) |
| Data offset | 4 | Header length in 32-bit words (min 5 = 20 bytes) |
| Flags | 8+ | CWR, ECE, URG, ACK, PSH, RST, SYN, FIN |
| Window | 16 | Receiver's advertised free buffer (flow control) |
| Checksum | 16 | Covers header + data + pseudo-header |
| Urgent pointer | 16 | Offset of urgent data (with URG; largely deprecated) |

**Control flags:**
- **SYN** — synchronize sequence numbers (connection setup).
- **ACK** — acknowledgment number field is valid (set on all segments after the first SYN).
- **FIN** — sender has finished sending data (graceful close).
- **RST** — abrupt reset; tear the connection down immediately, no graceful close.
- **PSH** — push buffered data to the receiving application promptly.
- **URG** + urgent pointer — mark urgent data (rarely used, discouraged).
- **ECE / CWR** — Explicit Congestion Notification signaling (RFC 3168).

**Sequence vs. acknowledgment numbers.** Sequence numbers count **bytes**, not segments.
The ACK number is the next expected byte — it is **cumulative**: an ACK of N means
"I have all bytes up to N-1." The window field is scaled by the **Window Scale option**
(RFC 7323) negotiated in the handshake, allowing windows far larger than 64 KiB.

**RST vs FIN.** A FIN is a polite "I'm done sending"; the connection can still receive.
An RST is a hard abort: it is sent when a segment arrives for a connection that does not
exist (e.g., connecting to a closed port), or when an application calls close with unread
data / uses SO_LINGER=0. RST does not wait for or generate a graceful teardown.

## TCP State Machine

Each endpoint runs a finite state machine (RFC 9293). Principal states:

| State | Meaning |
|---|---|
| CLOSED | No connection |
| LISTEN | Server waiting for incoming SYN |
| SYN_SENT | Client sent SYN, awaiting SYN-ACK |
| SYN_RECEIVED | Server got SYN, sent SYN-ACK, awaiting ACK |
| ESTABLISHED | Data transfer phase |
| FIN_WAIT_1 | Sent FIN, awaiting ACK of it |
| FIN_WAIT_2 | Our FIN acked; awaiting peer's FIN |
| CLOSE_WAIT | Received peer's FIN; app must still close |
| CLOSING | Both sent FIN simultaneously; awaiting ACK |
| LAST_ACK | Sent our FIN after CLOSE_WAIT; awaiting final ACK |
| TIME_WAIT | Waited after final ACK (2·MSL) before CLOSED |

- The **active opener** (client) transitions CLOSED → SYN_SENT → ESTABLISHED.
- The **passive opener** (server) transitions LISTEN → SYN_RECEIVED → ESTABLISHED.
- The side that sends the **first FIN** (active close) ends up in **TIME_WAIT**; the side
  that receives it first goes through **CLOSE_WAIT → LAST_ACK**.

> [!WARNING]
> A pile-up of sockets in **CLOSE_WAIT** almost always indicates an **application bug**:
> the peer closed, but your code never called `close()`/`shutdown()` on its socket. Many
> sockets in **TIME_WAIT**, by contrast, is normal on a busy client that opens many
> short-lived connections.

## Connection Teardown and TIME_WAIT

Graceful shutdown is a **four-way** exchange because each direction closes independently
(TCP is full-duplex):

```
Client (active close)               Server
  |  FIN  seq=u                       |   client: FIN_WAIT_1
  | --------------------------------> |   server: CLOSE_WAIT
  |  ACK  ack=u+1                     |
  | <-------------------------------- |   client: FIN_WAIT_2
  |            ... server finishes sending ...
  |  FIN  seq=v                       |   server: LAST_ACK
  | <-------------------------------- |
  |  ACK  ack=v+1                     |   client: TIME_WAIT -> (2 MSL) -> CLOSED
  | --------------------------------> |   server: CLOSED
```

The middle two steps (ACK of client FIN, and server's own FIN) can be combined if the
server has no more data — collapsing to three segments — but conceptually there are four.

**Why TIME_WAIT?** The active closer waits **2·MSL** (Maximum Segment Lifetime; MSL is
often taken as 30 s–2 min, so TIME_WAIT is commonly ~1–4 min) for two reasons:

1. **Reliable teardown.** If the final ACK is lost, the peer will retransmit its FIN. The
   closer must still be around to re-ACK it; otherwise the peer would get an RST and see
   an error on an otherwise clean close.
2. **Prevent old duplicates.** Waiting 2·MSL ensures all segments from this connection
   incarnation have drained from the network before the same 4-tuple can be reused,
   preventing a stray delayed segment from being accepted by a new connection.

> [!INTERVIEW]
> "Why does the server sometimes run out of ephemeral ports / sockets, not the client?"
> Whoever does the **active close** accumulates TIME_WAIT sockets. For a server behind a
> load balancer that closes connections, TIME_WAIT can exhaust local ports. Mitigations:
> connection reuse/keep-alive, `SO_REUSEADDR`, Linux `tcp_tw_reuse` (reuse TIME_WAIT for
> new *outbound* connections when safe). Note: `tcp_tw_recycle` was removed from Linux —
> it broke NAT and must not be recommended.

## Reliable Delivery and Cumulative ACK

TCP turns unreliable IP into a reliable, ordered byte stream:

- **Sequence numbers** let the receiver reorder segments and detect duplicates.
- **Acknowledgments are cumulative.** `ACK=N` means every byte below N has been received
  contiguously. It says nothing definitive about bytes above N (that is what SACK adds).
- **Data is buffered** at the sender until acknowledged so it can be retransmitted.

**Example.** Sender transmits four 1000-byte segments starting at seq 1:
seg1 [1–1000], seg2 [1001–2000], seg3 [2001–3000], seg4 [3001–4000]. If **seg2 is lost**
but 1, 3, 4 arrive, the receiver keeps ACKing `ack=1001` (it still needs byte 1001). It
cannot cumulatively ACK past the hole. These repeated ACKs are **duplicate ACKs** and are
the trigger for fast retransmit.

**PAWS and timestamps.** With the TCP Timestamps option (RFC 7323), each segment carries
a timestamp used both for accurate RTT measurement and for **PAWS** (Protection Against
Wrapped Sequence numbers) on high-bandwidth links where the 32-bit sequence space could
wrap within one MSL.

## Retransmission and RTO

If an ACK does not arrive, the sender retransmits after the **Retransmission Timeout
(RTO)** expires. Getting the RTO right is critical: too short causes needless
retransmissions; too long stalls throughput after a real loss.

**Estimating RTO (RFC 6298).** TCP measures round-trip time (RTT) samples and maintains:
- **SRTT** — smoothed RTT (exponentially weighted moving average).
- **RTTVAR** — RTT variance.
- **RTO = SRTT + 4·RTTVAR**, clamped to a minimum (commonly 200 ms–1 s) and a maximum
  (≥ 60 s).

**Karn's algorithm.** Do **not** take an RTT sample from a retransmitted segment — you
cannot tell whether the ACK is for the original or the retransmission. Also apply
**exponential backoff**: double the RTO on each successive timeout for the same segment.

**Timeout retransmit vs fast retransmit.** An RTO timeout is the *slow* path: it fires
only after a full timer expires and it collapses the congestion window to 1 MSS (see
slow start). Fast retransmit reacts much sooner using duplicate ACKs.

## Fast Retransmit and Fast Recovery

Waiting for an RTO wastes time when only a single segment is lost. **Fast retransmit**
(RFC 5681) uses duplicate ACKs as an early loss signal:

- Each out-of-order segment the receiver gets makes it re-send the same cumulative ACK
  (a **duplicate ACK**).
- On receiving **three duplicate ACKs** (i.e., the 3rd dup, 4 identical ACKs total), the
  sender retransmits the apparently-lost segment **immediately**, without waiting for the
  RTO.

**Fast recovery** then avoids dropping all the way back to slow start: because dup ACKs
prove segments are still flowing (the network is not fully congested), `cwnd` is halved
(to `ssthresh`) rather than reset to 1, and the connection continues in congestion
avoidance. This is the core of the **AIMD** behavior described below.

Three dup ACKs (not one or two) is a deliberate threshold: a small amount of reordering
in the network can produce one or two dup ACKs without any actual loss, so requiring
three reduces spurious retransmissions.

## Selective Acknowledgment SACK

Pure cumulative ACKs are inefficient when **multiple** segments are lost in one window:
the sender learns only about the first hole and may retransmit data that already arrived.
**SACK (RFC 2018)**, negotiated with the SACK-Permitted option in the handshake, lets the
receiver report **non-contiguous blocks** it has already buffered.

**Example.** Bytes 1–1000 and 2001–4000 received, 1001–2000 missing. The receiver sends
`ACK=1001` (cumulative) plus a SACK block `{2001–4000}`. The sender now retransmits only
1001–2000 and knows not to resend 2001–4000.

- **D-SACK** (Duplicate-SACK, RFC 2883) additionally reports segments received *twice*,
  helping the sender detect spurious retransmissions and unnecessary window reductions.
- SACK blocks live in TCP options; the 40-byte option space limits a segment to about
  **3–4 SACK blocks** (fewer if timestamps are also present).

## Sliding-Window Flow Control and Zero Window

**Flow control protects the receiver**, not the network. The receiver advertises a
**receive window (rwnd)** — how many more bytes it can buffer — in every segment's Window
field. The sender may have at most `min(cwnd, rwnd)` bytes **in flight** (sent but
unacknowledged).

As the application drains the receive buffer, the window opens; if the app is slow, the
window shrinks. When the buffer is full the receiver advertises **window = 0** (a
**zero window**), telling the sender to stop.

**Zero-window probes.** Since a later window-update segment could be lost (and a pure ACK
is not retransmitted), the sender periodically sends **zero-window probes** (1 byte) to
elicit a fresh window advertisement and avoid deadlock.

**Silly Window Syndrome (SWS).** If the receiver advertises tiny window openings (a few
bytes at a time) or the sender ships tiny segments, overhead dominates. Avoidance: the
**receiver** should not advertise a window increment smaller than one MSS (or half the
buffer); the **sender** side is handled by Nagle's algorithm.

**Bandwidth-delay product (BDP).** To keep a fast, long link full you need
`window ≥ bandwidth × RTT`. Because the base window field is 16 bits (max 64 KiB), the
**Window Scale option** (RFC 7323) is essential on high-BDP ("long fat") networks.

> [!TIP]
> Flow control vs congestion control in one line: **rwnd** is set by the *receiver*
> (don't overrun my buffer); **cwnd** is computed by the *sender* (don't overrun the
> network). The sender obeys the smaller of the two.

## Slow Start and Congestion Avoidance AIMD

**Congestion control protects the network.** The sender maintains a **congestion window
(cwnd)** and a threshold **ssthresh**, and probes for available bandwidth (RFC 5681):

**1. Slow start.** Start with a small **Initial Window** (RFC 6928 raised it to ~10 MSS).
For every ACK, increase `cwnd` by 1 MSS — this **doubles cwnd every RTT** (exponential
growth despite the name "slow"). Continue until `cwnd ≥ ssthresh` or loss occurs.

**2. Congestion avoidance.** Once `cwnd ≥ ssthresh`, grow **linearly**: roughly +1 MSS
per RTT (additive increase). This gently probes for more bandwidth.

**3. Reaction to loss = AIMD (Additive Increase / Multiplicative Decrease):**
- **RTO timeout** (severe): `ssthresh = cwnd/2`, then `cwnd = 1 MSS`, restart slow start.
- **Three dup ACKs** (mild, fast retransmit/recovery): `ssthresh = cwnd/2` and
  `cwnd = ssthresh` (multiplicative decrease by half), stay in congestion avoidance.

The characteristic classic **"sawtooth"** of cwnd over time comes from AIMD: slow linear
climb, sharp halving on loss. AIMD is what makes multiple TCP flows converge toward a
**fair** share of a bottleneck.

**Loss-based vs signal.** Classic (Reno/NewReno/CUBIC) congestion control treats **packet
loss** as the congestion signal. **ECN** (RFC 3168) lets routers mark packets instead of
dropping them, signaling congestion without loss.

## Modern Congestion Control CUBIC and BBR

**TCP Reno / NewReno** are the classic AIMD algorithms. NewReno improves recovery when
multiple segments are lost in one window without SACK.

**CUBIC (RFC 9438**, which in 2023 moved CUBIC to the Standards Track and obsoleted the
earlier RFC 8312**)** is the **default in Linux** (and widely used elsewhere). Instead of
linear growth it grows `cwnd` as a **cubic function of the time since the last congestion
event**. This makes it aggressive far from the last loss point, cautious near it, and —
crucially — **independent of RTT**, so it is fairer to high-latency flows and scales far
better than Reno on high-BDP links.

**BBR (Bottleneck Bandwidth and Round-trip propagation time)**, developed by Google, is a
**model-based, not loss-based** algorithm. It continuously estimates the bottleneck
bandwidth and the minimum RTT and paces sending to `bandwidth × min_RTT`, aiming to
operate at the optimal point (full pipe, minimal queue) rather than filling buffers until
they overflow.

- **Advantage:** avoids **bufferbloat** (large router buffers that inflate latency) and
  performs well on lossy links (e.g., wireless) where loss ≠ congestion. Reno/CUBIC
  overreact to random loss there.
- **Trade-off / criticism:** BBRv1 can be **unfair to CUBIC/Reno flows** sharing a
  bottleneck and can cause packet loss by not backing off on loss; BBRv2/BBRv3 address
  fairness and add ECN response.

| Algorithm | Signal | Notes |
|---|---|---|
| Reno / NewReno | Loss | Classic AIMD sawtooth |
| CUBIC | Loss | Linux default; RTT-independent cubic growth |
| BBR | Bandwidth + RTT model | Paces to BDP; fights bufferbloat; fairness caveats |

## Head-of-Line Blocking

**Head-of-line (HOL) blocking** is when one stalled item blocks everything queued behind
it, even if those later items are ready. TCP has HOL blocking **at the transport layer**:
because TCP delivers a single, strictly-ordered byte stream, a single lost segment forces
the receiver to **withhold all subsequent (already-arrived) bytes** from the application
until the gap is retransmitted and filled.

This matters most when a single TCP connection multiplexes many logical streams:

- **HTTP/1.1** has HOL blocking at the **request level**: responses on a persistent
  connection must return in order; a slow response blocks the ones behind it (mitigated
  crudely by opening multiple connections; pipelining was never widely usable).
- **HTTP/2** multiplexes many streams over **one** TCP connection, removing application-
  level HOL blocking — but a single lost TCP segment still stalls **all** HTTP/2 streams,
  because they share one ordered byte stream. This is **TCP-level HOL blocking**.
- **HTTP/3 over QUIC** solves this: QUIC runs on **UDP** and implements independent,
  per-stream ordering, so a loss on one stream does not block the others. (QUIC still has
  HOL blocking *within* a single stream — ordering is inherent per stream.)

> [!INTERVIEW]
> A favorite chain: "Why does HTTP/2 not fully fix head-of-line blocking?" → because
> multiplexing is above TCP, and TCP's single ordered stream reintroduces HOL blocking on
> loss. "How does HTTP/3 fix it?" → QUIC moves stream multiplexing/ordering into the
> transport over UDP, giving per-stream independent delivery.

## Nagle's Algorithm and Delayed ACK

Two optimizations that individually help but can interact badly:

**Nagle's algorithm (RFC 896)** reduces the number of tiny "tinygram" packets. Rule:
*if there is unacknowledged data outstanding, buffer small writes until either a full-MSS
segment can be sent or the outstanding data is ACKed.* This coalesces many small writes
(e.g., single keystrokes) into fewer, larger segments, saving header overhead.

**Delayed ACK (RFC 1122)** reduces pure-ACK traffic: the receiver waits up to ~200 ms
(or until it has data to piggy-back on, or a second full segment arrives) before sending
an ACK, hoping to combine it with a response or acknowledge two segments at once.

**The pathological interaction.** A sender using Nagle has a small segment it can't send
until the previous data is ACKed; the receiver, using delayed ACK, is sitting on that ACK
waiting for more data or its timer. The result is a stall of up to ~200 ms per exchange —
disastrous for small **request/response** workloads (RPC, interactive protocols).

**Fix:** applications that send small, latency-sensitive messages set **`TCP_NODELAY`**
to disable Nagle. This is standard for low-latency RPC, gaming, and interactive traffic.
Some stacks also offer `TCP_QUICKACK` to suppress delayed ACKs. The general guidance:
disable Nagle when you do your own buffering or need low latency; leave it on for bulk
byte-stream workloads that write in small chunks.

> [!WARNING]
> Do not reflexively disable Nagle everywhere. If your application already writes in
> large, well-buffered chunks, `TCP_NODELAY` gains nothing and can increase packet count.
> It matters specifically for chatty small-message traffic.

## Common follow-up questions

- **Why exactly three packets in the handshake, not two or four?** Each direction must
  synchronize its ISN and have it acknowledged; the server piggy-backs its SYN onto the
  ACK of the client's SYN, collapsing four logical steps to three.
- **Why does the SYN consume a sequence number if it carries no data?** So the SYN itself
  can be reliably acknowledged (`ack=ISN+1`); the same is true of FIN.
- **Who ends up in TIME_WAIT and why is it 2·MSL?** The side that sends the first FIN
  (active close); 2·MSL guarantees the final ACK can be retransmitted and that old
  duplicate segments drain before the 4-tuple is reused.
- **Difference between flow control and congestion control?** Flow control (rwnd)
  protects the receiver's buffer; congestion control (cwnd) protects the network. Sender
  is bounded by `min(rwnd, cwnd)`.
- **Why 3 duplicate ACKs for fast retransmit?** To tolerate mild packet reordering, which
  can produce 1–2 dup ACKs without real loss.
- **What does a cumulative ACK actually tell you, and what does SACK add?** Cumulative ACK
  = "I have everything below N." SACK adds reports of non-contiguous blocks above N so the
  sender retransmits only the true gaps.
- **Why can HTTP/2 still suffer head-of-line blocking?** Its streams share one ordered TCP
  byte stream; one lost segment stalls delivery of all streams until retransmitted.
- **When would you set TCP_NODELAY?** For small, latency-sensitive request/response
  traffic where Nagle + delayed ACK can add ~200 ms stalls.
- **How does CUBIC differ from Reno?** Cubic (RTT-independent) window growth instead of
  linear additive increase; scales much better on high-bandwidth, high-latency links.
- **Why is BBR different in kind from CUBIC?** BBR models bottleneck bandwidth and RTT and
  paces to the BDP rather than treating loss as the congestion signal.

## References

- [RFC 9293 — Transmission Control Protocol (TCP)](https://www.rfc-editor.org/rfc/rfc9293) (2022; obsoletes RFC 793)
- [RFC 5681 — TCP Congestion Control](https://www.rfc-editor.org/rfc/rfc5681) (slow start, congestion avoidance, fast retransmit/recovery)
- [RFC 6298 — Computing TCP's Retransmission Timer](https://www.rfc-editor.org/rfc/rfc6298)
- [RFC 2018 — TCP Selective Acknowledgment Options](https://www.rfc-editor.org/rfc/rfc2018)
- [RFC 2883 — An Extension to SACK (D-SACK)](https://www.rfc-editor.org/rfc/rfc2883)
- [RFC 7323 — TCP Extensions for High Performance (window scaling, timestamps, PAWS)](https://www.rfc-editor.org/rfc/rfc7323)
- [RFC 6928 — Increasing TCP's Initial Window](https://www.rfc-editor.org/rfc/rfc6928)
- [RFC 9438 — CUBIC for Fast and Long-Distance Networks](https://www.rfc-editor.org/rfc/rfc9438) (2023, Standards Track; obsoletes RFC 8312)
- [RFC 896 — Nagle's algorithm (congestion control in IP/TCP internetworks)](https://www.rfc-editor.org/rfc/rfc896)
- [RFC 1122 — Requirements for Internet Hosts (delayed ACK)](https://www.rfc-editor.org/rfc/rfc1122)
- [RFC 3168 — The Addition of Explicit Congestion Notification (ECN) to IP](https://www.rfc-editor.org/rfc/rfc3168)
- [RFC 6528 — Defending against Sequence Number Attacks (ISN randomization)](https://www.rfc-editor.org/rfc/rfc6528)
- [RFC 7413 — TCP Fast Open](https://www.rfc-editor.org/rfc/rfc7413)
- [BBR: Congestion-Based Congestion Control (Cardwell et al., ACM Queue 2016)](https://queue.acm.org/detail.cfm?id=3022184)
