# UDP & Datagram Transport

UDP (User Datagram Protocol, **RFC 768**, 1980) is the minimal transport-layer
protocol on top of IP. Where TCP gives you a reliable, ordered, congestion-controlled
byte stream, UDP gives you almost nothing: it takes your message, slaps on an 8-byte
header, and hands it to IP. No handshake, no connection, no retransmission, no ordering,
no flow control. What you gain for giving all that up is *low latency*, *low overhead*,
*message boundaries*, and *full application control*. Understanding UDP well means
understanding both what it deliberately omits and why an entire generation of modern
transports (QUIC, WebRTC, QUIC-based HTTP/3) chose to build **on top of UDP** rather
than TCP.

> [!KEY-TAKEAWAY]
> UDP is "IP plus ports plus an optional checksum." Everything else — reliability,
> ordering, congestion control, connection state — is either the application's job or
> deliberately absent. That minimalism is a feature, not a bug.

---

## The UDP datagram and its 8-byte header

A UDP datagram is a header plus a payload. The header is exactly **8 bytes** (64 bits),
made of four 16-bit fields:

```
 0      7 8     15 16    23 24    31
+--------+--------+--------+--------+
|     Source Port | Destination Port|
+--------+--------+--------+--------+
|      Length     |     Checksum    |
+--------+--------+--------+--------+
|              data ...             |
```

| Field | Size | Meaning |
|---|---|---|
| Source Port | 16 bits | Sender's port. **Optional** — may be 0 if no reply is expected. |
| Destination Port | 16 bits | Receiver's port; used to demultiplex to the right socket. |
| Length | 16 bits | Length in bytes of **header + data** (minimum 8, the header alone). |
| Checksum | 16 bits | Optional in IPv4, mandatory in IPv6. Covers header, data, and a pseudo-header. |

Key facts an interviewer probes:

- The header is a **fixed 8 bytes** with **no options** — contrast TCP's 20–60 byte
  variable header. This tiny, fixed size is why UDP overhead is so low.
- The **Length** field counts the UDP header *and* data, so its minimum legal value is
  8 (an empty datagram). Because it's 16 bits, the theoretical max datagram is 65,535
  bytes, but see the payload-size limits below.
- UDP is IP **protocol number 17** (TCP is 6). This is the number in the IP header's
  Protocol field, not a port.
- A UDP datagram maps to **exactly one IP packet's worth of application message**
  (before IP fragmentation). UDP itself never splits or reassembles your message — it
  preserves message boundaries.

> [!TIP]
> Max UDP payload over IPv4 = 65,535 − 8 (UDP header) − 20 (minimum IPv4 header) =
> **65,507 bytes**. Sending that much forces IP fragmentation; in practice you keep
> datagrams under the path MTU (commonly ~1,472 bytes payload on a 1,500-byte Ethernet
> MTU) to avoid fragmentation and its reliability penalty.

## Connectionless, best-effort delivery

UDP is **connectionless**: there is no handshake and no per-connection state in the
protocol. Each datagram is independent — the classic "fire and forget." UDP offers
**best-effort** delivery, which explicitly means the protocol makes *no guarantees*:

- **No delivery guarantee** — datagrams can be silently dropped (buffer overflow,
  congestion, checksum failure, MTU issues) with no notification to the sender.
- **No ordering guarantee** — datagrams can arrive in a different order than sent,
  because IP packets can take different paths.
- **No duplicate protection** — a datagram may be delivered more than once.
- **No retransmission** — a lost datagram stays lost unless the *application* resends.
- **No flow control / congestion control** — UDP will happily let you blast a receiver
  or a link faster than it can handle. Managing send rate is the application's problem.

What UDP *does* give you:

- **Multiplexing/demultiplexing** via 16-bit ports (the same as TCP).
- **Optional integrity check** via the checksum (detect, not correct, corruption).
- **Message framing** — each `recvfrom()` returns exactly one datagram; boundaries are
  preserved (a stream protocol like TCP does not preserve boundaries).

> [!WARNING]
> "Connectionless" doesn't mean you can't `connect()` a UDP socket. A "connected" UDP
> socket just fixes the default peer address (so you can `send()`/`recv()` and get
> asynchronous ICMP errors like port-unreachable back), but it creates **no connection
> on the wire** and gives **no reliability**. It's purely a local API convenience.

## Message boundaries vs. TCP's byte stream

This is a favorite interview distinction. TCP is a **byte stream**: it has no concept of
application messages, so one `send()` of 1,000 bytes may arrive as several `recv()`s, or
several sends may be coalesced into one read (Nagle, segmentation). Applications must
add their own framing (length prefixes, delimiters) on top of TCP.

UDP is **message-oriented (datagram)**: one send = one datagram = one receive. If you
send three datagrams of 100 bytes, the peer does three reads of 100 bytes each (assuming
none are lost). Boundaries are preserved for free. The trade-off: a datagram larger than
what the socket buffer can hold is **truncated** (not buffered for a later read) in the
BSD socket model, and a single datagram is all-or-nothing.

## The UDP checksum (and why it's optional)

The checksum is a 16-bit one's-complement sum computed over:

1. A **pseudo-header** — source IP, destination IP, the protocol number (17), and the
   UDP length. Including the IP addresses lets the receiver detect misdelivered
   datagrams (this is a layering violation UDP shares with TCP).
2. The **UDP header** (with the checksum field itself set to 0 during computation).
3. The **payload**, zero-padded to an even number of bytes if needed.

Rules and gotchas:

- In **IPv4**, the UDP checksum is **optional**. A transmitted value of **all-zeros (0)**
  means "checksum not computed." If a real computed checksum happens to be zero, it is
  sent as **all-ones (0xFFFF)** instead, since 0 is reserved to mean "disabled."
- In **IPv6**, the UDP checksum is **mandatory** (RFC 8200), because IPv6 has *no
  header checksum of its own* — the transport layer is the only integrity check left.
  (RFC 6935/6936 carve out a narrow exception for some tunneling/encapsulation cases.)
- The checksum only **detects** errors; UDP cannot correct them. A datagram that fails
  the checksum is silently discarded — it just looks like a loss to the application.
- UDP-Lite (**RFC 3828**) is a variant that lets an application checksum only a
  *prefix* of the datagram (the "coverage"), useful for codecs (audio/video) that would
  rather receive a slightly corrupt payload than have the whole datagram dropped.

## When UDP wins: DNS, VoIP, gaming, video, metrics

UDP is the right tool when **low latency or low overhead matters more than perfect
reliability**, or when the application can do reliability better than TCP would.

- **DNS** — a query and its response usually fit in one small datagram. UDP avoids a
  TCP handshake's round-trips for a request that's often answered in one packet. If the
  response is too large or truncated (TC bit set), the resolver retries over TCP. (DNS
  historically capped UDP replies at 512 bytes; EDNS0 negotiates larger UDP payloads.)
- **VoIP / real-time audio & video (RTP over UDP)** — a late packet is useless; there's
  no point retransmitting audio that was due 200 ms ago. Better to drop it and conceal
  the gap. TCP's in-order retransmission would cause audible stalls (head-of-line
  blocking). Codecs tolerate small loss gracefully.
- **Online gaming** — position/state updates are sent frequently; a lost update is
  superseded by the next one. Latency is king; retransmitting stale state hurts.
- **Live video streaming / multicast video** — one-to-many delivery and latency
  sensitivity favor UDP; loss is concealed or corrected at the app layer (FEC).
- **Real-time metrics / logging (e.g. StatsD)** — fire-and-forget counters where
  dropping the occasional sample is acceptable and you never want the telemetry path to
  block the application.
- **DHCP, TFTP, SNMP, NTP, syslog** — classic UDP protocols: small, transactional, or
  broadcast-based exchanges where TCP's overhead isn't justified.

> [!INTERVIEW]
> "Why does DNS use UDP but fall back to TCP?" — Because most lookups are a single small
> request/response where a TCP handshake would double or triple latency, but some
> responses (large records, zone transfers, DNSSEC) exceed the UDP payload the resolver
> will accept, so the server sets the truncated (TC) flag and the client retries over
> TCP, which has no such size ceiling.

## Building reliability on top of UDP

If UDP gives no reliability, why not always use TCP? Because building *just the pieces
you need* on UDP can beat TCP for a given workload. Applications layer on some or all of:

- **Sequence numbers** — to detect loss, reordering, and duplicates.
- **Acknowledgements** (cumulative or selective) and **retransmission** with timeouts
  (often with RTT estimation, like TCP's, or NAK-based schemes).
- **Congestion & flow control** — to be a good network citizen; ignoring this is how
  naive UDP apps cause congestion collapse. Modern transports use algorithms like BBR
  or NewReno-style control **in user space**.
- **Ordering / reassembly** — buffering to deliver in order when required.
- **Forward Error Correction (FEC)** — send redundant data so the receiver can
  reconstruct lost packets *without* a round-trip retransmission (great for real-time).

Real systems that do this: **QUIC** (full reliability + congestion control + streams),
**WebRTC data channels** (SCTP-over-DTLS-over-UDP, configurable reliability/ordering),
game netcode, and reliable-UDP libraries. The key idea: you pick your reliability
semantics (fully reliable, partially reliable, unreliable-but-ordered, etc.) rather than
being locked into TCP's one-size-fits-all model.

## UDP vs. TCP trade-off table

| Dimension | UDP | TCP |
|---|---|---|
| Connection | Connectionless (no handshake) | Connection-oriented (3-way handshake) |
| Header size | 8 bytes, fixed | 20–60 bytes, variable |
| IP protocol number | 17 | 6 |
| Reliability | None (best-effort) | Guaranteed delivery via ACK + retransmit |
| Ordering | None | In-order byte stream |
| Duplicate/loss handling | App's problem | Handled by TCP |
| Flow control | None | Sliding window |
| Congestion control | None (app must add) | Yes (slow start, AIMD, etc.) |
| Data model | Message/datagram (boundaries preserved) | Byte stream (no boundaries) |
| Head-of-line blocking | None (datagrams independent) | Yes (one lost segment stalls the stream) |
| Multicast/broadcast | Supported | Unicast only |
| Overhead / latency | Low | Higher (handshake, ACKs, state) |
| Typical uses | DNS, VoIP, gaming, video, metrics, QUIC | HTTP/1–2, email, file transfer, SSH |

> [!KEY-TAKEAWAY]
> Choose UDP when latency, message semantics, multicast, or custom reliability matter.
> Choose TCP when you want a reliable ordered stream and don't want to reimplement it.
> "Reliable UDP" (like QUIC) exists precisely because sometimes you want TCP-like
> guarantees *plus* control that kernel TCP can't give you.

## Broadcast and multicast

UDP is the only common transport that supports one-to-many delivery; TCP is strictly
unicast (point-to-point) because a connection has exactly two endpoints.

- **Broadcast (IPv4 only)** — send one datagram to *every* host on a subnet.
  `255.255.255.255` is the limited (local-link) broadcast; a subnet-directed broadcast
  uses the network's all-ones host part (e.g. `192.168.1.255` for `192.168.1.0/24`).
  Broadcast is confined to the local L2 segment (routers don't forward it by default).
  Used by DHCP discovery and ARP-like local announcements.
- **Multicast** — send to a *group* of interested hosts. IPv4 multicast uses the
  **224.0.0.0/4** (class D) range; IPv6 uses **ff00::/8**. Hosts join/leave groups via
  **IGMP** (IPv4) or **MLD** (IPv6); routers use protocols like PIM to build
  distribution trees. Efficient for IPTV, service discovery (mDNS uses `224.0.0.251`),
  and market-data feeds.
- **IPv6 has no broadcast at all** — it replaces broadcast entirely with multicast
  (e.g. the all-nodes multicast group `ff02::1`). This is a common gotcha.

## QUIC: reliable transport built on UDP

**QUIC (RFC 9000)** is a modern, reliable, secure, multiplexed transport that runs
**on top of UDP** — and understanding *why* it's built on UDP rather than as a new IP
protocol or on TCP is a high-signal interview topic.

What QUIC provides (things UDP itself lacks):

- Reliable, ordered delivery **per stream**, with retransmission and congestion control.
- **Stream multiplexing without head-of-line blocking** — independent streams over one
  connection; a loss on one stream doesn't stall the others (TCP's fatal flaw for HTTP/2
  multiplexing).
- **Integrated TLS 1.3** — encryption and the transport handshake are combined, giving
  **1-RTT** (and **0-RTT** for resumed) connection setup versus TCP+TLS's multiple RTTs.
- **Connection IDs** — a connection survives an IP/port change (e.g. Wi-Fi ↔ cellular)
  because it's identified by a connection ID, not the 4-tuple. This is **connection
  migration**.

Why build it on UDP instead of TCP or a brand-new protocol?

1. **Avoiding kernel TCP ossification.** TCP's behavior is baked into OS kernels and,
   worse, into **middleboxes** (NATs, firewalls, load balancers) that inspect and mangle
   TCP headers. Deploying a new TCP option or changing TCP semantics is nearly impossible
   at internet scale because middleboxes drop or "help-fix" anything unfamiliar. UDP is
   simple and widely passed through, so QUIC could evolve freely.
2. **User-space deployability.** Because QUIC lives above UDP, it can be implemented in
   application/library code and shipped/updated at browser or app cadence — no kernel
   upgrade, no waiting years for OS rollout. This is why QUIC could iterate rapidly.
3. **A new IP protocol number would be blocked.** Middleboxes and firewalls routinely
   drop anything that isn't TCP (6) or UDP (17), so a genuinely new L4 protocol would be
   undeployable on the real internet. UDP was the pragmatic vehicle.
4. **Encryption resists ossification.** QUIC encrypts almost all of its transport headers
   (not just the payload), so middleboxes can't inspect or depend on them — preserving
   the ability to change the protocol later.

QUIC is what carries **HTTP/3 (RFC 9114)**. So "HTTP/3 runs over QUIC, and QUIC runs
over UDP" — the loss recovery, ordering, and congestion control that TCP would have
provided are all reimplemented inside QUIC in user space.

> [!INTERVIEW]
> "If QUIC reimplements reliability, ordering, and congestion control, why not just use
> TCP?" — To escape ossification and get *per-stream* reliability, faster (0/1-RTT)
> secure setup, connection migration, and rapid user-space evolution — none of which
> kernel TCP + middleboxes allow.

## Sockets, buffers, and operational gotchas

- **No connection state, but there is buffer state.** Each UDP socket has a receive
  buffer; if the app doesn't read fast enough, incoming datagrams are **dropped** (you
  can see this as `RcvbufErrors`/drops in `netstat -su` or `/proc/net/udp`). There is no
  backpressure to slow the sender the way TCP's window does.
- **ICMP port unreachable.** Sending UDP to a closed port typically elicits an ICMP
  "port unreachable," but delivery of that ICMP isn't guaranteed and unconnected sockets
  usually don't surface it — another reason UDP feels "silent."
- **Fragmentation is dangerous.** A datagram larger than the path MTU gets IP-fragmented;
  losing *one* fragment loses the *whole* datagram, and many firewalls drop fragments.
  Well-behaved UDP apps keep datagrams within the path MTU (often via probing) or set
  DF and handle "packet too big."
- **Performance at scale.** High-throughput UDP (like QUIC servers) uses batching syscalls
  (`sendmmsg`/`recvmmsg`) and offloads (**UDP GSO/GRO**) to amortize per-packet CPU cost,
  since UDP lacks TCP's large-segment offload story by default.
- **NAT traversal.** UDP NAT mappings are shorter-lived and less predictable than TCP's;
  apps use keepalives and STUN/TURN/ICE (WebRTC) to punch and maintain holes.

## Common follow-up questions

- **How big is the UDP header and what are its fields?** 8 bytes: source port, dest port,
  length, checksum — all 16-bit.
- **What does the Length field count?** Header + data, minimum 8.
- **Is the UDP checksum mandatory?** Optional in IPv4 (0 = disabled), mandatory in IPv6.
  If the computed checksum is 0 it's transmitted as 0xFFFF.
- **What's the max UDP payload?** 65,507 bytes over IPv4 (65,535 − 8 − 20), but you
  should stay within the path MTU to avoid fragmentation.
- **Does UDP preserve message boundaries?** Yes — one send = one datagram = one receive.
  TCP does not (it's a byte stream).
- **Why does VoIP prefer UDP?** Latency; a retransmitted late audio packet is useless,
  and TCP's in-order retransmission causes stalls (head-of-line blocking).
- **How would you make UDP reliable?** Add sequence numbers, ACKs, retransmission with
  timeouts, congestion control, and optionally FEC — i.e. build what QUIC does.
- **Why was QUIC built on UDP?** To avoid TCP/kernel/middlebox ossification, deploy in
  user space, pass through firewalls, and get per-stream (no HoL) reliability with
  0/1-RTT encrypted setup and connection migration.
- **Can UDP do broadcast/multicast?** Yes (TCP can't). IPv4 broadcast `255.255.255.255`
  or subnet-directed; multicast `224.0.0.0/4` (IGMP). IPv6 has no broadcast — multicast
  `ff00::/8` only.
- **What's UDP's IP protocol number?** 17 (TCP is 6).
- **What happens if a UDP receive buffer overflows?** Datagrams are dropped silently;
  no backpressure to the sender.

## References

- RFC 768 — User Datagram Protocol (the original UDP spec).
- RFC 8200 — Internet Protocol, Version 6 (IPv6): mandatory UDP checksum.
- RFC 6935 / RFC 6936 — IPv6 UDP checksum exception for tunneling.
- RFC 3828 — The Lightweight User Datagram Protocol (UDP-Lite).
- RFC 1122 — Requirements for Internet Hosts (host behavior, checksum rules).
- RFC 1112 / RFC 3376 — IPv4 multicast and IGMPv3.
- RFC 9000 — QUIC: A UDP-Based Multiplexed and Secure Transport.
- RFC 9114 — HTTP/3.
- RFC 8446 — TLS 1.3 (integrated into QUIC).
- RFC 1034 / RFC 1035 — DNS (UDP transport, 512-byte limit, TCP fallback).
- RFC 6891 — Extension Mechanisms for DNS (EDNS0): larger UDP payloads.
- RFC 9293 — Transmission Control Protocol (for the TCP contrast).
