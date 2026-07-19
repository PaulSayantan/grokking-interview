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

## RFC 8085: UDP usage guidelines and mandatory congestion control

The informal rule "apps on UDP must add their own congestion control" is codified as a
**Best Current Practice: RFC 8085 (UDP Usage Guidelines)**. Senior candidates are expected
to cite it by number. Key normative requirements:

- **Congestion control is not optional (§3).** Any application that can send more than a
  few datagrams **MUST** implement congestion control. Bulk-transfer apps **SHOULD** use
  **TFRC (TCP-Friendly Rate Control)** or a **TCP-like windowing** scheme, aiming to
  "compete fairly within an order of magnitude of TCP" (§3.1.2).
- **Rate ceilings when you have no feedback (§3.1.3).** With **no RTT estimate and no
  return traffic**, an application **SHOULD NOT send more than one datagram every 3
  seconds**. A low data-volume app **SHOULD** send at most **one datagram per RTT**.
- **Retransmission timers (§3.1.1).** Initial **RTO SHOULD be 1 second**; maintain the
  estimate with an **EWMA** of RTT samples and apply **Karn's algorithm** — do not sample
  RTT from a retransmitted (ambiguous) exchange, and use exponential backoff on repeated
  loss.
- **Transport circuit breaker (§3.1.10).** As a last resort, non-congestion-controlled
  flows (e.g. media that can't reduce rate) **SHOULD** implement a circuit breaker that
  halts the flow if the path is persistently overloaded.
- **Keep-alives are discouraged (§3.5).** Keep-alives are **NOT RECOMMENDED**; if used,
  send them at most **once every 15 seconds** and add jitter. This interacts with the
  **RFC 4787** guidance that a NAT UDP mapping timeout floor is ~2 minutes.

> [!INTERVIEW]
> "Your team wants to push data over UDP at line rate for speed. What does the standards
> track require?" — RFC 8085 makes congestion control mandatory; a flow that ignores it is
> a congestion-collapse hazard and a bad internet citizen. You either implement TFRC /
> TCP-like windowing, or you use an existing transport (QUIC) that already does.

## Datagram sizing: path MTU, PLPMTUD, and safe payload floors

"Keep within the path MTU" has a precise mechanism and precise safe floors.

- **Classic Path MTU Discovery (RFC 1191 / RFC 8201 for IPv6)** sets the IPv4 **DF (Don't
  Fragment)** bit and relies on routers returning **ICMPv4 "Fragmentation Needed"** /
  **ICMPv6 "Packet Too Big"** when a packet is too large. Its fatal weakness is the **PMTU
  black hole**: many middleboxes filter that ICMP, so the sender never learns and packets
  vanish silently.
- **Packetization-Layer PMTUD (PLPMTUD, RFC 4821; datagram version RFC 8899)** does not
  depend on ICMP. It **probes upward** with progressively larger packets and uses the
  transport's own loss signal to confirm what got through, so it is robust to ICMP
  black-holing. This is the modern, correct answer to "how do you pick a datagram size?"
- **Safe fallback floors (EMTU_S).** When PMTU is unknown, use the effective-MTU-for-
  sending floor: **IPv4 = min(576, first-hop MTU); IPv6 = 1280 bytes**. Subtract the IP
  header + 8 (UDP) to get the safe payload. QUIC codifies this pragmatically by requiring
  an **initial max datagram of 1200 bytes** and keeping payloads there until a larger PMTU
  is validated.

> [!TIP]
> Debugging "works on LAN, drops ~5% of *large* datagrams over the internet" almost always
> points at a **PMTU black hole / fragment drop**. Fix by enabling PLPMTUD or capping the
> payload to ~1200 bytes (the QUIC floor), not by raising buffers.

## IP fragmentation of UDP datagrams

Fragmentation deserves more than "it's dangerous."

- **It happens at the IP layer, not in UDP.** IP splits an oversized packet into fragments
  keyed on the **IP Identification field, fragment offset, and the MF (More Fragments)
  flag**. UDP is unaware; only the first fragment carries the UDP header/ports.
- **All-or-nothing reassembly.** Losing **any single fragment** forces the receiver to
  discard the **entire** datagram after the reassembly timer expires — so a large UDP
  datagram has an effective loss rate that compounds per fragment.
- **Middlebox hazard.** Only the first fragment has L4 ports, so stateful firewalls/NATs
  and ECMP hashers struggle with later fragments; many simply **drop non-initial
  fragments**. Fragment **reassembly is also a DoS vector** (overlapping/incomplete
  fragments exhaust buffers).
- **IPv6 differs.** IPv6 routers **never fragment**; only the **source** may fragment (via
  a Fragment extension header), and if a packet is too big a router returns Packet Too Big.
- **RFC 8900 ("IP Fragmentation Considered Fragile")** formally advises upper layers to
  **avoid relying on IP fragmentation**. This is the concrete justification for the "apps
  cap datagram size" rule.

## Checksum internals: one's-complement and incremental update

Deeper mechanics behind the checksum field:

- **Algorithm.** The checksum is the **16-bit one's-complement of the one's-complement
  sum** of the pseudo-header + UDP header + payload (padded to 16 bits). One's-complement
  addition means carries out of the top bit are **added back into the low bit
  ("end-around carry")**. The receiver sums everything including the checksum and expects
  **all-ones (0xFFFF)**.
- **Incremental update (RFC 1624).** Because it's a sum, a device that changes a few bytes
  (a **NAT rewriting the port/IP**) can adjust the checksum with a small arithmetic delta
  instead of rescanning the whole packet — cheap for routers/NATs. RFC 1624 corrects an
  earlier RFC 1141 formula edge case around the ~0 representation.
- **IPv6 context.** IPv6 has **no IP header checksum**, so UDP's checksum is the only
  end-to-end integrity check and is therefore mandatory (RFC 8200). **RFC 6935/6936**
  permit a **zero UDP checksum only for specific tunnel/encapsulation** use in controlled
  environments, and it must be explicitly enabled per destination port.

## GSO, GRO, and batched syscalls

Scaling UDP throughput is a real staff-level topic.

- **UDP_SEGMENT (Generic Segmentation Offload).** The application hands the kernel one
  large "super-buffer" plus a segment size; the kernel/NIC slices it into up to **64**
  MTU-sized datagrams on the way out. This amortizes the per-datagram stack traversal.
  (Linux ≥ 4.18.)
- **GRO (Generic Receive Offload).** On RX, consecutive same-flow datagrams are coalesced
  into one larger buffer handed up the stack, cutting per-packet cost.
- **sendmmsg / recvmmsg.** Send or receive **many datagrams in one syscall**. Real-world
  impact: Cloudflare reported dropping from ~900k to ~15k syscalls/sec on a QUIC path.
- **The GSO-vs-pacing tension.** Batching hands many packets to the NIC at once, which
  **defeats per-packet pacing** that congestion control (e.g. BBR) relies on. The fix is
  hardware/kernel pacing: **SO_MAX_PACING_RATE** or per-packet transmit timestamps
  (**SO_TXTIME**, the Earliest Departure Time / EDT model) so batched packets still leave
  spaced out.

## Amplification and reflection attacks

Because UDP has **no handshake to verify the source address**, an attacker can **spoof the
victim's IP as the source** of a small request to a public server, and the server's
**larger reply is reflected at the victim**. Two properties combine: **reflection** (hide
the real attacker, aim traffic at the victim) + **amplification** (reply ≫ request).

- **Bandwidth Amplification Factor (BAF)** = response size ÷ request size. Named vectors:

| Service | Port (UDP) | Approx BAF | Trigger |
|---|---|---|---|
| memcached | 11211 | ~10,000–51,000× | `stats`/large stored value |
| NTP | 123 | ~556× | `monlist` |
| chargen | 19 | ~358× | any byte |
| DNS (ANY/EDNS) | 53 | ~28–179× | ANY query, large zone |
| CLDAP | 389 | ~56–70× | connectionless LDAP query |
| SSDP | 1900 | ~30× | M-SEARCH |
| SNMP | 161 | ~6× | GetBulk |

- The **2018 GitHub 1.35 Tbps** attack used **memcached reflection** — the record at the
  time.
- **Mitigations to name:**
  - **BCP 38 / RFC 2827** (ingress filtering / **Source Address Validation, SAV**) and
    **BCP 84 / RFC 3704** — networks drop packets whose source address couldn't legitimately
    originate from them, killing spoofing at the source. The definitive network-side fix.
  - **DNS Response Rate Limiting (RRL)** and returning **REFUSED**/small responses.
  - Disabling **NTP `monlist`**; memcached shipping with **UDP disabled by default (1.5.6)**.
  - Anycast + traffic scrubbing to absorb/scatter reflected floods.

> [!INTERVIEW]
> "You find an internal service answering on UDP/11211 or UDP/389 reachable from the
> internet — what's the risk?" — memcached or CLDAP reflection/amplification. Firewall it,
> bind to localhost/private only, and push **BCP 38** ingress filtering upstream.

## QUIC internals: anti-amplification, connection IDs, and header protection

QUIC is the canonical "reliable, secure transport on UDP," and it directly answers UDP's
security and ossification problems.

- **Anti-amplification limit (RFC 9000 §8.1).** Before it has **validated the client's
  address**, a QUIC server **MUST NOT send more than 3× the bytes it has received** from
  that client. This is precisely how QUIC avoids becoming a UDP reflector during its own
  handshake — contrast open DNS/NTP resolvers that will happily amplify. Address is
  validated either by completing the handshake or via a **Retry** token round-trip.
- **Connection IDs decouple identity from the 4-tuple (RFC 9000 §5).** A CID identifies the
  connection independently of source/dest IP+port, enabling **connection migration** (Wi-Fi
  ↔ LTE) **and** server-side routing: a **load balancer can encode routing info into the
  CID** and steer packets to the right backend even when the 5-tuple changes.
- **Header protection (RFC 9001).** QUIC encrypts not just payload but **most header
  fields** (packet numbers, parts of the CID), so middleboxes cannot inspect or ossify on
  them. **GREASE** (reserved values deliberately exercised) and **version negotiation**
  further prevent middleboxes from freezing the protocol.
- **Real-world counter-pressure.** Some networks **rate-limit or block UDP** (or QUIC
  specifically), so clients race QUIC against TCP+TLS and fall back — a "Happy Eyeballs"-
  style approach for HTTP/3.

> [!INTERVIEW]
> "A stateful L4 load balancer sends a client's QUIC packets to a different backend after a
> Wi-Fi→LTE switch — why, and how is it solved?" — The 5-tuple changed so 5-tuple hashing
> re-buckets the flow. Solution: route on the **Connection ID** (which the LB parses),
> since the CID is stable across migration.

## Source-port randomization and off-path spoofing

UDP's lack of a handshake makes it vulnerable to **off-path response forgery**: an attacker
who never sees the request can still inject a forged reply if they guess the tuple that
identifies the exchange. The classic case is **DNS cache poisoning (the Kaminsky attack)**.

- The reply is accepted if it matches the **4-tuple (src/dst IP + src/dst port)** plus the
  **16-bit DNS transaction ID** — only ~16 bits of entropy if the source port is fixed.
- **RFC 5452** hardens DNS by **adding entropy**: **source-port randomization** (formalized
  as **RFC 6056 / BCP 156**, why the OS picks a random high ephemeral port) and optional
  **0x20 case randomization** of the query name. This turns a ~16-bit guess into ~32 bits.
- The **cryptographic** fix is **DNSSEC** (origin authentication of records); port
  randomization only raises the bar.

## The source port as flow-hash entropy (ECMP and L4 load balancing)

RFC 8085 §5.1.1 notes that the **source port doubles as flow entropy**. Routers doing
**ECMP** and L4 load balancers hash the **5-tuple** (which includes the UDP source port) to
pick a path/backend.

- The source port **SHOULD be in the ephemeral range 49152–65535** and **SHOULD stay
  stable for the life of a flow**. Changing it mid-flow **re-hashes** the flow onto a
  different path — causing reordering — and **breaks stateful LB pinning**.
- This is the flip side of source-port randomization (entropy for security) and interacts
  with QUIC connection-migration edge cases, where the transport must be prepared for the
  path (and its ordering/PMTU) to change.

## NAT behavior, NAT types, and traversal (STUN/TURN/ICE)

Peer-to-peer UDP across NATs is a deep topic (RFC 4787 documents required NAT behavior).

- **NAT mapping types (classic taxonomy):**
  - **Full-cone** — one external mapping; any external host can send in once the mapping
    exists.
  - **(Address-)restricted-cone** — external host may send in only if the internal host
    first sent to that host's IP.
  - **Port-restricted-cone** — as above but must match IP **and** port.
  - **Symmetric** — a **new external port per destination**, so the mapping learned via one
    server is useless for a different peer.
- **Symmetric NAT breaks hole punching.** The external port a STUN server observes is not
  the port a different peer will see, so the mapping can't be reused → you must fall back to
  a **TURN relay**.
- **The tools (STUN/TURN/ICE):**
  - **STUN (RFC 8489)** — a host asks a public server "what source IP:port do you see?" to
    discover its external mapping.
  - **TURN (RFC 8656)** — a relay that forwards traffic when direct paths fail (the
    symmetric-NAT fallback); costs bandwidth/latency.
  - **ICE (RFC 8445)** — the framework that gathers candidate addresses (host, server-
    reflexive via STUN, relayed via TURN), then **hole-punches** by having both peers send
    to each other simultaneously to open matching mappings, and picks the best working pair.
- UDP mappings are **short-lived** (seconds to a couple of minutes) versus TCP's longer
  connection-tracked state, which is why UDP P2P needs periodic keepalives.

## DTLS: securing datagrams

TLS assumes a **reliable, ordered byte stream**, so it can't run directly over UDP — a lost
or reordered record would break the stream cipher state. **DTLS (Datagram TLS)** adapts TLS
to datagrams.

- **Versions: RFC 6347 = DTLS 1.2, RFC 9147 = DTLS 1.3.**
- DTLS adds an **explicit epoch + sequence number** per record and a **replay window**, so
  it tolerates reordering and loss. It runs **its own handshake retransmission** (with
  timers) since there's no TCP underneath, and includes **anti-amplification / cookie
  (HelloVerifyRequest)** protection against spoofed-source floods.
- Used by **WebRTC (DTLS-SRTP key exchange), SIP, and IoT/CoAP**. Contrast with **QUIC**,
  which does not use DTLS — it integrates **TLS 1.3** directly into its own transport.

## UDP-based protocols and encapsulation

Beyond DNS/DHCP/NTP, UDP is the substrate for a wide range of modern protocols — useful for
"name a protocol that does X on UDP" questions:

- **CoAP (RFC 7252)** — RESTful protocol for constrained IoT devices; UDP + optional DTLS,
  with its own lightweight confirmable/non-confirmable reliability.
- **RTP / RTCP (RFC 3550)** and **SRTP** — real-time media transport + control/statistics;
  the media plane for VoIP/WebRTC, secured by SRTP (keys from DTLS).
- **WireGuard** and **IPsec (NAT-T, UDP/4500)** — VPNs encapsulating encrypted traffic in
  UDP for NAT traversal and middlebox friendliness.
- **VXLAN (UDP/4789)** and **GTP-U (UDP/2152)** — L2-over-L3 overlay tunneling (data-center
  network virtualization) and mobile-core user-plane tunneling. These carry entire inner
  packets as UDP payload; the outer UDP source port is often a **hash of the inner flow** to
  spread load across ECMP paths.

## Multicast depth: IGMP/MLD versions, scoping, and SSM

Deepening one-to-many delivery:

- **IGMP versions (IPv4 group membership):** **IGMPv1** (join, timeout-based leave),
  **IGMPv2** (adds explicit Leave), **IGMPv3 (RFC 3376)** adds **source filtering** →
  enables **Source-Specific Multicast (SSM)** in **232.0.0.0/8** (RFC 4604/4607), where a
  receiver subscribes to (source, group) and avoids needing shared distribution trees.
- **MLD (IPv6):** **MLDv1/MLDv2** are the IPv6 equivalents (MLDv2 ↔ IGMPv3 for SSM).
- **Scoping:** **224.0.0.0/24 is link-local and never forwarded** (used by routing
  protocols, e.g. OSPF 224.0.0.5). Reach is bounded by the **TTL / hop-limit** on the
  packet and by administrative scope ranges. Routers apply **RPF (Reverse Path Forwarding)**
  checks to prevent loops when building trees (PIM).
- **Not internet-routable / unauthenticated.** Broadcast and multicast are **LAN or managed-
  overlay** mechanisms — they are not delivered across the public internet and carry no
  authentication, so treat them as trusted-segment-only.

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
- **What spec mandates congestion control for UDP apps?** RFC 8085 — congestion control is
  required; ≤1 datagram/3 s with no feedback; initial RTO 1 s with Karn's algorithm.
- **How do you pick a datagram size safely?** PLPMTUD (RFC 8899) probing, or fall back to
  the EMTU_S floor (IPv4 576, IPv6 1280) minus IP+8; QUIC uses a 1200-byte floor.
- **Why is UDP amplification possible and how is it stopped?** No handshake → spoofed source
  + reply ≫ request (memcached ~10,000×+, NTP monlist ~556×). Fix: BCP 38 ingress filtering.
- **How does QUIC avoid being a reflector?** RFC 9000 §8.1: server sends ≤3× received bytes
  before validating the client address (Retry token).
- **Why does the OS randomize the UDP source port?** RFC 6056/5452 — entropy against off-path
  DNS spoofing (Kaminsky); the port is also ECMP flow-hash entropy.
- **Why can't TLS run directly on UDP?** TLS needs a reliable ordered stream; DTLS (RFC 9147/
  6347) adds epoch/sequence + replay window + its own handshake retransmission.
- **What breaks UDP hole punching?** Symmetric NAT (new external port per destination) →
  fall back to a TURN relay.

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
- RFC 8085 — UDP Usage Guidelines (BCP 145): congestion control, RTO, keep-alives.
- RFC 8899 / RFC 4821 — Packetization Layer Path MTU Discovery (PLPMTUD).
- RFC 1191 / RFC 8201 — classic Path MTU Discovery (IPv4 / IPv6).
- RFC 8900 — IP Fragmentation Considered Fragile.
- RFC 1624 — Computation of the Internet Checksum via Incremental Update.
- RFC 5452 — Measures for Making DNS More Resilient against Forged Answers.
- RFC 6056 (BCP 156) — Recommendations for Transport-Protocol Port Randomization.
- RFC 2827 (BCP 38) / RFC 3704 (BCP 84) — ingress filtering / source-address validation.
- RFC 4787 — NAT Behavioral Requirements for Unicast UDP.
- RFC 8489 / RFC 8656 / RFC 8445 — STUN / TURN / ICE.
- RFC 6347 / RFC 9147 — DTLS 1.2 / DTLS 1.3.
- RFC 9001 / RFC 9002 — QUIC TLS (header protection) / QUIC loss detection & congestion.
- RFC 3376 / RFC 4604 / RFC 4607 — IGMPv3, MLDv2, and Source-Specific Multicast.
- RFC 7252 — Constrained Application Protocol (CoAP).
- RFC 3550 — RTP: A Transport Protocol for Real-Time Applications.
