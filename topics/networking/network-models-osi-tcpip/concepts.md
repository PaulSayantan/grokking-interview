# Network Models: OSI & TCP/IP

Network models are the mental scaffolding every networking interview is built on.
They break the enormous problem of "get bytes from an application on one machine to an
application on another, anywhere in the world" into a stack of **layers**, each with a
single well-defined job and a clean interface to the layers above and below. Two models
dominate: the **OSI reference model** (7 layers, a teaching/standards framework) and the
**TCP/IP model** (4 or 5 layers, the model the real Internet is actually built on). This
topic covers both, how they map onto each other, how data is wrapped and unwrapped as it
moves through the stack (encapsulation), the name of the data unit at each layer (the
PDU), which protocols and which physical devices live where, and the classic "which
layer is X?" questions interviewers love.

> [!KEY-TAKEAWAY]
> OSI is the *vocabulary* (7 layers, used to describe and compare); TCP/IP is the
> *implementation* (the protocol suite the Internet runs on). When someone says "that's
> a Layer 7 load balancer" or "an ARP problem is Layer 2," they are speaking OSI even
> though the packets on the wire are TCP/IP.

## Why layering matters

Layering exists to tame complexity. Each layer solves one problem and exposes a simple
service to the layer above, hiding its own internals. The payoff:

- **Abstraction / separation of concerns.** HTTP does not care whether the bytes travel
  over Wi-Fi, fiber, or a cellular link; TCP does not care whether the underlying network
  is Ethernet or something else. Each layer only talks to its immediate neighbors.
- **Interoperability.** Because layers have standardized interfaces, a Cisco router and a
  Juniper router interoperate, and a browser on Linux talks to a server on Windows. Any
  implementation that honors the layer's contract can be swapped in.
- **Independent evolution.** IPv4 → IPv6 changes Layer 3 without rewriting TCP or HTTP.
  Wi-Fi 6 replaces the physical/link layers without touching the application. This is the
  **hourglass model** of the Internet: many protocols above, many below, but everyone
  agrees on **IP in the narrow waist**.
- **Easier reasoning and troubleshooting.** "Ping works but the web page won't load"
  instantly localizes a fault: L3 connectivity is fine, so look higher (DNS, TCP, TLS,
  HTTP). Engineers debug *by layer*.

> [!TIP]
> The trade-off of layering is overhead and some duplicated work (each layer adds a
> header; error-checking may happen at L2 *and* L4). In practice the interoperability and
> maintainability win overwhelmingly, which is why every real network is layered.

## The OSI seven-layer model

The **Open Systems Interconnection (OSI)** model was standardized by ISO (ISO/IEC 7498-1).
It defines **7 layers**, numbered from the physical medium (1) up to the application (7):

| # | Layer | Core job | Typical PDU | Examples |
|---|---|---|---|---|
| 7 | **Application** | Interface to the end-user application; app-level semantics | Data | HTTP, DNS, SMTP, FTP, DHCP |
| 6 | **Presentation** | Translation, encoding, encryption, compression | Data | TLS/SSL, ASCII/Unicode, JPEG, MIME |
| 5 | **Session** | Establish, manage, and tear down sessions/dialogs | Data | RPC, NetBIOS, session tokens, TLS session resumption |
| 4 | **Transport** | End-to-end delivery between processes; ports, reliability, flow/congestion control | Segment (TCP) / Datagram (UDP) | TCP, UDP, QUIC (debated), SCTP |
| 3 | **Network** | Logical addressing and routing *across* networks (end-to-end host-to-host) | Packet | IP, ICMP, IGMP, routing protocols (OSPF, BGP) |
| 2 | **Data Link** | Node-to-node delivery on a single link; framing, MAC addressing, local error detection | Frame | Ethernet, Wi-Fi (802.11), ARP, PPP, VLAN (802.1Q) |
| 1 | **Physical** | Transmit raw bits over a medium; voltages, light pulses, radio, connectors | Bit | Cables, fiber, hubs, repeaters, RJ45, 10BASE-T |

Reading the roles more carefully:

- **L1 Physical** — signaling and media. Bit rate, encoding, connectors, pinouts. No
  addressing at all; it just pushes 1s and 0s.
- **L2 Data Link** — organizes bits into **frames**, adds **MAC (hardware) addresses**,
  and delivers a frame across **one hop** (one link/segment). Detects (not always
  corrects) bit errors via a checksum (Ethernet FCS/CRC). ARP (mapping IP→MAC) sits here.
- **L3 Network** — **logical addressing (IP)** and **routing/forwarding** between
  different networks. This is the first layer that can reach a host that is not on the
  local link. ICMP (ping, traceroute, "destination unreachable") lives here.
- **L4 Transport** — end-to-end communication between **processes**, identified by
  **port numbers**. TCP adds reliability, ordering, flow control, and congestion control;
  UDP adds almost nothing (just ports + a checksum) for speed.
- **L5 Session** — opens, maintains, synchronizes, and closes conversations between
  applications (dialog control, checkpointing).
- **L6 Presentation** — makes sure data is in a form the application understands:
  character-set translation, serialization, compression, and **encryption** (this is the
  layer OSI purists assign TLS to).
- **L7 Application** — the protocols applications speak directly (HTTP, DNS, SMTP). Note:
  this is *not* your browser or email client — it is the protocol the app uses.

> [!WARNING]
> In the real world, layers 5, 6, and 7 are rarely distinguished — TCP/IP folds them all
> into a single "application" layer. The clean L5/L6/L7 split is mostly an OSI teaching
> construct; almost no widely deployed protocol maps cleanly to *just* the session or
> presentation layer.

## The TCP/IP model

The **TCP/IP model** (a.k.a. the Internet model, described in **RFC 1122** "Requirements
for Internet Hosts") is what the Internet is actually built on. It is more pragmatic and
collapses OSI's top three layers into one. It comes in two common presentations:

**4-layer view (RFC 1122's own layering):**

| TCP/IP layer | Job | Maps to OSI |
|---|---|---|
| **Application** | Everything apps speak: HTTP, DNS, SMTP, TLS | OSI 5–7 |
| **Transport** | Process-to-process delivery: TCP, UDP | OSI 4 |
| **Internet** | Host-to-host routing/addressing: IP, ICMP | OSI 3 |
| **Link** (a.k.a. Network Access / Network Interface) | Move frames on the local link: Ethernet, ARP, Wi-Fi, plus the physical medium | OSI 1–2 |

**5-layer view (common in textbooks, e.g. Kurose & Ross / Tanenbaum):** identical, but
the bottom "Link" layer is split back into **Data Link** and **Physical** to match OSI 1
and 2 separately. So the 5 layers are Application, Transport, Network, Data Link, Physical.

Both are the same model — the only disagreement is whether the bottom is one layer (RFC
1122's "link" bundles physical + data link) or two. Interviewers accept either; just be
consistent and say which you are using.

> [!INTERVIEW]
> "How many layers does the TCP/IP model have?" is a trick with two right answers.
> Say: "**Four** as defined in RFC 1122 (Application, Transport, Internet, Link), though
> many textbooks show **five** by splitting the link layer into Data Link and Physical."
> That answer signals you know both the standard and the teaching convention.

## OSI vs TCP/IP mapping

Side-by-side, the mapping is:

```
   OSI (7 layers)            TCP/IP 4-layer      TCP/IP 5-layer
 7 Application   ┐
 6 Presentation  ├────────►  Application         Application
 5 Session       ┘
 4 Transport     ─────────►  Transport           Transport
 3 Network       ─────────►  Internet            Network
 2 Data Link     ┐
                 ├────────►  Link                Data Link
 1 Physical      ┘                               Physical
```

Key differences to state in an interview:

| Aspect | OSI | TCP/IP |
|---|---|---|
| Layers | 7 | 4 (RFC 1122) or 5 (textbook) |
| Origin | ISO reference model, designed top-down before protocols | Built from working protocols (TCP, IP) that already existed |
| Purpose | Conceptual/teaching & standards reference | Practical implementation of the actual Internet |
| Upper layers | Distinct Session / Presentation / Application | Collapsed into one Application layer |
| Lower layers | Distinct Physical and Data Link | Bundled as "Link" (RFC 1122) |
| Protocol coupling | Protocol-independent (a framework) | Tied to the TCP/IP protocol suite |
| Adoption | Model is universal; few pure-OSI protocols deployed | The model everything runs on |

The **mental shortcut**: OSI is the ruler people measure things with ("Layer 4 load
balancer," "Layer 2 switch"); TCP/IP is the thing being measured.

## Encapsulation and de-encapsulation

As data moves **down** the sending stack, each layer wraps the unit from the layer above
with its own **header** (and, at L2, a trailer). This is **encapsulation**. On the
receiving side each layer strips its own header/trailer and hands the payload up — this
is **de-encapsulation** (decapsulation). The payload of one layer is the entire PDU of the
layer above; layers do not inspect each other's headers (that is the abstraction).

Sending host (top → bottom), for an HTTP request over TCP/IP/Ethernet:

```
 L7 Application :  [ HTTP data ]                                             → "Data"
 L4 Transport   :  [ TCP hdr | HTTP data ]                                   → "Segment"
 L3 Network     :  [ IP hdr | TCP hdr | HTTP data ]                          → "Packet"
 L2 Data Link   :  [ Eth hdr | IP hdr | TCP hdr | HTTP data | Eth FCS ]      → "Frame"
 L1 Physical    :  101000110101110010101...  (the frame as raw bits)        → "Bits"
                                    │
                                    ▼  transmitted over the wire
```

Receiving host reverses it (bottom → top): the NIC reassembles bits into a frame, the
link layer checks the FCS and strips the Ethernet header, IP strips the IP header and
checks the destination address, TCP strips the TCP header and reorders/acks the segment,
and the application finally gets the raw HTTP data.

> [!TIP]
> Each header answers "who does this go to at *my* layer?": the Ethernet header holds MAC
> addresses (this hop), the IP header holds IP addresses (end-to-end), the TCP header
> holds port numbers (which process). At every router hop the **L2 frame header is
> rewritten** (new source/dest MAC) while the **L3 IP addresses stay the same**
> end-to-end. This is the single most-tested encapsulation detail.

## Protocol data units at each layer

The generic name for "the unit of data at a given layer" is the **PDU** (Protocol Data
Unit). Knowing the PDU names cold is a guaranteed interview point:

| Layer | PDU name |
|---|---|
| Application / Presentation / Session (OSI 5–7) | **Data** (or "message") |
| Transport (L4) | **Segment** (TCP) / **Datagram** (UDP) |
| Network (L3) | **Packet** (sometimes "datagram" for IP) |
| Data Link (L2) | **Frame** |
| Physical (L1) | **Bit** (symbol/signal) |

Memory hook: from top to bottom, **D**ata, **S**egment, **P**acket, **F**rame,
**B**its — "**D**o **S**ergeants **P**ay **F**or **B**eer?" Watch the terminology
overloads: TCP's PDU is a **segment**, UDP's is a **datagram**, and IP's PDU is also
often called a **datagram** — context tells you whether "datagram" means the UDP unit
(L4) or the IP unit (L3).

## Protocols at each layer

A quick reference of where the protocols interviewers ask about live:

| Layer | Protocols |
|---|---|
| L7 Application | HTTP(S), DNS, SMTP/IMAP/POP3, FTP, SSH, DHCP, SNMP, WebSocket |
| L6 Presentation | TLS/SSL (OSI-purist placement), MIME, JPEG/PNG, ASCII/Unicode, compression |
| L5 Session | RPC, NetBIOS, SMB session setup, TLS session resumption, SIP (partly) |
| L4 Transport | **TCP**, **UDP**, SCTP, QUIC (see debate below), DCCP |
| L3 Network | **IP** (IPv4/IPv6), **ICMP**, IGMP, IPsec (AH/ESP), routing protocols (OSPF, BGP, RIP) |
| L2 Data Link | **Ethernet (802.3)**, **Wi-Fi (802.11)**, **ARP**, PPP, VLAN/802.1Q, STP, HDLC, Frame Relay |
| L1 Physical | Bit encoding on copper/fiber/radio, USB physical, DSL, Bluetooth radio, 10BASE-T/100BASE-TX |

Points that trip people up:

- **ARP** maps an IP address to a MAC address. Because it works with MACs on the local
  link and is carried directly in an Ethernet frame (not inside IP), it is treated as
  **Layer 2** (some call it "Layer 2.5" since it bridges L2 and L3). It is *not* an
  application protocol.
- **ICMP** (ping, traceroute) rides *inside* IP packets but is a **Layer 3** protocol —
  it is a control/error-reporting companion to IP, not a transport protocol, and has no
  port numbers.
- **DNS** and **DHCP** are **application-layer** protocols even though they are
  infrastructure — DNS typically runs over UDP/TCP port 53, DHCP over UDP 67/68.
- **Routing protocols** are confusing: OSPF runs directly over IP (protocol 89), RIP over
  UDP, and BGP over TCP — but conceptually they all manage **Layer 3** routing tables.

## Where does TLS sit

This is a favorite "there is no single clean answer, show me you understand why" question.

- **OSI-purist answer:** TLS/SSL provides encryption and, arguably, session management, so
  it maps to the **Presentation layer (L6)**, with its handshake/session parts touching
  the **Session layer (L5)**. This is the textbook answer.
- **TCP/IP / practitioner answer:** TCP/IP has no presentation or session layer, so TLS is
  simply part of the **Application layer**. Operationally it sits **between the
  application and TCP** — it takes a reliable TCP byte stream and hands the application an
  encrypted one. Many engineers therefore call it "**Layer 5–6**," "between L4 and L7," or
  informally "**Layer 4.5**."

The reason it resists a clean label is precisely that the OSI upper layers do not exist as
separate implementations in real stacks. The strong interview answer: *"TLS runs on top of
TCP (Layer 4) and beneath the application protocol (Layer 7). In OSI terms it corresponds
to the presentation layer, sometimes the session layer; in TCP/IP it is just part of the
application layer."* Contrast with **QUIC**, which builds reliability, encryption (TLS
1.3), and streams **on top of UDP** — blurring transport and above even further, which is
why QUIC's exact layer is itself debated.

## Devices at each layer

Interviewers routinely ask "what layer does a *switch* / *router* / *load balancer*
operate at?" Match the device to the deepest header it inspects:

| Device | Layer | What it inspects / does |
|---|---|---|
| **Repeater / Hub** | **L1 Physical** | Regenerates/repeats the electrical signal; a hub floods bits to all ports. No addressing; one collision domain. |
| **Bridge / Switch** | **L2 Data Link** | Reads **MAC addresses**, learns a MAC-address table, forwards frames only to the correct port. Each port is its own collision domain. |
| **Router** | **L3 Network** | Reads **IP addresses**, consults a routing table, forwards packets between networks, and **rewrites the L2 frame** at each hop. Separates broadcast domains. |
| **L3 switch** | **L2 + L3** | A switch with routing built in (routes between VLANs at wire speed). |
| **L4 load balancer** | **L4 Transport** | Balances by **IP + port** (TCP/UDP), no visibility into HTTP. Fast, protocol-agnostic. |
| **L7 load balancer / reverse proxy / API gateway** | **L7 Application** | Reads **HTTP** (URL path, headers, cookies) to route, terminate TLS, and do content-based routing. |
| **Firewall** | **L3–L7** | A packet-filter firewall works at L3/L4 (IP/port); a next-gen/application firewall inspects up to L7. |
| **NIC** | **L1–L2** | Puts bits on the wire and builds/parses frames (owns a MAC address). |

> [!TIP]
> The pattern: a device operates "at layer N" if N is the **highest header it reads to
> make a forwarding decision**. A switch *could* carry an IP packet, but it decides using
> the MAC header → Layer 2. An L7 load balancer decides using the HTTP request → Layer 7.

## Common interview mapping questions

Rapid-fire drills that show up constantly — practice answering these instantly:

- **"Which layer does routing happen at?"** → Network, **L3** (routers, IP addresses).
- **"Which layer are MAC addresses / ARP / a switch at?"** → Data Link, **L2**.
- **"Which layer adds port numbers?"** → Transport, **L4** (TCP/UDP).
- **"What's the PDU at the transport layer?"** → **Segment** (TCP) / **Datagram** (UDP).
- **"What's the PDU at Layer 3? Layer 2?"** → **Packet**; **Frame**.
- **"ICMP is what layer?"** → **L3** (rides in IP, no ports).
- **"HTTP / DNS / DHCP?"** → **L7 Application**.
- **"TLS?"** → OSI L6 (presentation), TCP/IP application layer; sits above TCP, below HTTP.
- **"L4 vs L7 load balancer?"** → L4 balances by IP+port (fast, opaque); L7 reads HTTP
  (content-based routing, TLS termination).
- **"A hub vs a switch?"** → Hub = L1 (floods bits, one collision domain); switch = L2
  (MAC-aware, per-port collision domain).
- **"Ping works but the site won't load — where's the problem?"** → L3 is fine; look
  higher: DNS, TCP handshake, TLS, or the L7 application.

## Mnemonics

- **Top-down (L7 → L1):** "**A**ll **P**eople **S**eem **T**o **N**eed **D**ata
  **P**rocessing" — Application, Presentation, Session, Transport, Network, Data Link,
  Physical.
- **Bottom-up (L1 → L7):** "**P**lease **D**o **N**ot **T**hrow **S**ausage **P**izza
  **A**way" — Physical, Data Link, Network, Transport, Session, Presentation, Application.
- **PDUs top-down:** "**D**o **S**ergeants **P**ay **F**or **B**eer?" — Data, Segment,
  Packet, Frame, Bits.

## SDU, PDU, and SAP: the formal vocabulary

The picture-level "each layer adds a header" story has precise ISO 7498 vocabulary behind
it, and senior interviewers like to check you know it:

- **PDU (Protocol Data Unit)** — the complete unit a layer sends to its **peer** on the
  other host: its own **header** (protocol control information, PCI) plus its payload.
  "Segment," "packet," "frame" are layer-N PDUs.
- **SDU (Service Data Unit)** — the payload a layer receives *from the layer above* through
  the service interface, i.e. the data it is asked to deliver unchanged. A layer's PDU =
  its header + the SDU it was handed. Formally: **the SDU at layer N is the PDU of layer
  N+1**. When you say "TCP encapsulates the HTTP data," the HTTP message is TCP's SDU and
  the TCP segment is TCP's PDU.
- **SAP (Service Access Point)** — the addressable point at which a layer offers its
  service to the layer above, and the demultiplexing key that says "which upper-layer
  entity does this belong to." Concrete SAPs: a **TCP/UDP port** is a transport SAP; the
  **EtherType** (or 802.2 LLC DSAP/SSAP) is a data-link SAP; the **IP Protocol number** is
  the network-layer SAP that selects TCP vs UDP vs ICMP.

So encapsulation, stated formally: layer N receives an SDU via its SAP, prepends PCI to
form a PDU, and passes that PDU down as the SDU of layer N-1. Fragmentation/segmentation is
just one SDU being split across several PDUs.

## Horizontal vs vertical communication

Two orthogonal kinds of communication exist in a layered stack, and conflating them is a
classic mistake:

- **Vertical (interfaces / services)** — communication between **adjacent layers on the
  same host**, across the service interface (via SAPs). This is where SDUs are handed down
  and PDUs handed up. It is real, local function calls.
- **Horizontal (protocols / peer-to-peer)** — the **logical** conversation between a layer
  and its **peer layer on the remote host** (TCP-to-TCP, IP-to-IP). Each layer is *designed
  as if* it talks directly to its peer, exchanging that layer's PDUs, following a
  **peer-to-peer protocol**. Physically no such direct link exists — only Layer 1 actually
  moves bits; every "peer" message really travels all the way down one stack, across the
  wire, and up the other. This is the **"virtual communication"** at each layer.

The clean way to say it in an interview: *a **protocol** is horizontal (rules between
peers); a **service/interface** is vertical (between adjacent layers on one host).* OSI is
explicit about this separation; TCP/IP muddles it.

## Data Link sublayers: LLC and MAC

The Data Link layer (L2) is itself split into two IEEE 802 sublayers, which explains a lot
of "is L2 really one layer?" follow-ups:

- **MAC (Media Access Control)** — the lower sublayer: physical (MAC) addressing, framing,
  and **medium access** (who may transmit — CSMA/CD on legacy Ethernet, CSMA/CA on
  802.11). This is where 802.3 (Ethernet) and 802.11 (Wi-Fi) genuinely differ.
- **LLC (Logical Link Control, IEEE 802.2)** — the upper sublayer: a **protocol
  multiplexing** shim (DSAP/SSAP identify the upper-layer protocol) and optional
  flow/error control. On Wi-Fi and other 802 links, the upper-layer protocol is identified
  via an **802.2 LLC + SNAP** header carrying an EtherType.

Ethernet II (the DIX frame the Internet actually uses) skips LLC and puts the **EtherType**
directly in the frame; the value distinguishes an 802.3-length field (≤1500) from an
Ethernet II type (≥1536). So on Ethernet II the "LLC" multiplexing job is done by the
EtherType field itself.

## Byte-level encapsulation and the demux chain

The conceptual diagram earlier becomes much stronger when you can name field sizes and the
**demultiplexing chain** the receiver walks. For an IPv4/TCP/Ethernet-II frame:

| Piece | Size | Key fields |
|---|---|---|
| Preamble + SFD | 7 + 1 B | L1 sync; **not** counted in the frame or MTU |
| Ethernet header | 14 B | 6 B dst MAC, 6 B src MAC, 2 B **EtherType** |
| (802.1Q VLAN tag) | +4 B | present only if tagged (EtherType 0x8100) |
| IPv4 header | 20 B min | Protocol field, TTL, header checksum, src/dst IP |
| TCP header | 20 B min | src/dst **port**, seq/ack, flags, window |
| Payload | up to MSS | application bytes |
| Ethernet FCS (trailer) | 4 B | CRC-32 over the frame |
| Interframe gap | 12 B time | L1 idle; not part of the frame |

So a minimum full Ethernet frame carrying IPv4+TCP is 14 + 20 + 20 + payload + 4. The
**demux chain** on receive is a cascade of SAP lookups:

```
EtherType 0x0800 → IPv4   (0x86DD → IPv6, 0x0806 → ARP, 0x8100 → VLAN tag)
IP Protocol 6    → TCP    (17 → UDP, 1 → ICMP, 58 → ICMPv6, 89 → OSPF, 47 → GRE)
TCP dst port 443 → the listening process/socket
```

Each layer reads exactly one field to decide who to hand the SDU to next — that field *is*
the SAP demux key. Being able to recite `EtherType → Protocol → port` is a strong signal.

## MTU, MSS, and Path MTU Discovery

This cross-layer relationship is one of the richest senior debugging topics.

- **MTU (Maximum Transmission Unit)** is an **L2/L3** limit: the largest **IP payload** a
  link will carry in one unfragmented frame. Standard Ethernet MTU = **1500 B**. The
  Ethernet **frame** is then 1518 B (14 B header + 1500 payload + 4 B FCS), or **1522 B**
  with an 802.1Q VLAN tag. **Jumbo frames** raise the MTU to ~**9000 B** (data-center /
  storage networks).
- **MSS (Maximum Segment Size)** is an **L4/TCP** value = MTU − IP header − TCP header. For
  IPv4: 1500 − 20 − 20 = **1460 B**. For IPv6 (40 B base header): 1500 − 40 − 20 =
  **1440 B**. MSS is the max *TCP payload* per segment and is announced as a **TCP option
  in the SYN only** (each side advertises what it can *receive*); it is not renegotiated
  later. UDP has no MSS.
- **MSS clamping** — a router/firewall/tunnel endpoint rewrites the MSS value in transiting
  SYN packets downward so both hosts size segments for the smallest link on the path. A
  deliberate **cross-layer hack** (an L3 box editing an L4 option) widely used on PPPoE and
  VPN/tunnel gateways.
- **Path MTU Discovery (PMTUD, RFC 1191; RFC 8201 for IPv6)** — the host sets the IPv4
  **DF (Don't Fragment)** bit; if a downstream link's MTU is too small, the router drops
  the packet and returns **ICMP Type 3 Code 4 "Fragmentation Needed and DF set"** (IPv4) or
  **ICMPv6 Type 2 "Packet Too Big"** (IPv6), carrying the next-hop MTU. The source shrinks
  its packet size accordingly.
- **PMTUD blackhole** — the classic failure: a firewall silently drops the ICMP "too big"
  messages, so the sender never learns to shrink. Small packets (handshake, `ping`, `ssh`
  keystrokes) pass, but the first full-size data segment is dropped forever → **large
  transfers hang** while the connection looks "up." Fixes: unblock the ICMP, apply **MSS
  clamping**, or use **PLPMTUD (RFC 4821 / RFC 8899 for datagrams)**, which probes MTU
  without relying on ICMP at all.
- **Encapsulation shrinks the effective MTU.** Every tunnel adds overhead to the 1500 B
  budget: **PPPoE → 1492**, **GRE → ~1476**, **IPsec → ~1400 or less**, **VXLAN → 1450**
  (50 B outer overhead), WireGuard ~1420. If the inner host still assumes 1500, you get the
  blackhole above — hence tunnels almost always clamp MSS.

## IPv4 vs IPv6 fragmentation

Where fragmentation happens differs sharply between the two IP versions — a great IPv6
fluency check:

- **IPv4** — a router **may fragment** an oversized packet in flight (unless DF is set),
  splitting it into fragments reassembled only at the destination. This is cheap for the
  sender but costly for routers and fragile (lost fragment = whole packet lost).
- **IPv6** — **routers never fragment.** Only the **source host** may fragment, using a
  **Fragment extension header**, and it is expected to run PMTUD instead. The IPv6
  **minimum link MTU is 1280 B** (every IPv6 link must carry at least that without
  fragmentation), versus IPv4's 68 B minimum. IPv6 also **dropped the header checksum**
  entirely (relying on L2 CRC and L4 checksums), so routers do less per-packet work.

## MPLS and "Layer 2.5"

OSI's network layer is itself formally divided into three sublayers (SNAcP / SNDCP /
SNICP), but the interview-famous example of "a protocol that defies clean layering" is
**MPLS (Multiprotocol Label Switching)**. MPLS pushes a **label** (a 4-byte shim) *between*
the L2 frame header and the L3 packet header, and routers ("label switch routers") forward
on the label alone without inspecting the IP header — so it behaves like L2 switching but
operates on L3 traffic. It genuinely sits between the two layers, which is why it is
nicknamed **"Layer 2.5"** (the same nickname ARP gets, for a different reason).

## Control plane, data plane, and management plane

Staff-level framing that reframes "what layer is a switch?" more precisely — every network
device is really three planes:

- **Data plane (forwarding plane)** — moves packets **per-packet at line rate**, usually in
  hardware/ASIC. It consults pre-built tables (MAC table, FIB/forwarding table). When you
  say "a switch is L2," you mean **its data plane forwards using the L2 header**.
- **Control plane** — **builds the state** the data plane uses: routing protocols (OSPF,
  BGP), ARP/NDP, STP, ICMP generation, DHCP relay. It runs in software, off the fast path,
  and is comparatively slow. A "routing protocol" is control-plane; the resulting FIB is
  what the data plane uses.
- **Management plane** — **configuration and telemetry**: SSH/CLI, SNMP, NETCONF/RESTCONF,
  streaming telemetry. It touches neither forwarding nor route computation directly.

This separation is exactly what **SDN** formalizes (a centralized controller owns the
control plane; switches keep only the data plane, programmed via e.g. OpenFlow). It also
explains why "ping/OSPF/ARP live at the control plane" is *not* the same as "the forwarding
layer."

## Cross-layer violations in practice

"Give me real examples where the strict layered model breaks" is a standard senior
question. A consolidated catalog:

| Mechanism | Layers touched | Why it violates layering |
|---|---|---|
| **NAT / NAPT (PAT)** | L3 + L4 | Rewrites IP addresses *and* TCP/UDP ports (and fixes L4 checksums) in transit. |
| **L7 load balancer / TLS-terminating reverse proxy** | L4 ↔ L7 | Reads L7 (URL, headers, SNI) to make what is nominally an L4 forwarding choice; terminates the client's L4 connection. |
| **Stateful firewall / DPI / NGFW** | L3–L7 | Tracks L4 connection state and inspects L7 payloads to permit/deny L3 packets. |
| **QoS / DSCP marking** | L3 field set from L7 intent | An application's importance (L7) is encoded into the IP header's DSCP bits (L3). |
| **TCP MSS clamping** | L3/L2 box edits L4 | A router/tunnel rewrites a TCP option in the SYN. |
| **Transparent proxy** | intercepts L4/L7 | Terminates connections the client thinks are end-to-end. |

The unifying theme: **middleboxes** read or write headers of layers they are not supposed
to touch, trading the purity of the model for real-world function (security, scaling,
address conservation).

## Encapsulation vs tunneling vs multiplexing

Three related but distinct ideas that interviewers probe:

- **Encapsulation** — the normal downward wrapping: layer N's PDU becomes layer N-1's
  payload. Each wrap is *one* layer deeper.
- **Tunneling** — encapsulating a **whole packet inside a packet of the same or lower
  layer**, so the payload is itself a full protocol stack. Examples: **GRE** (IP protocol
  47), **IP-in-IP**, **IPsec ESP**, **VXLAN** (L2 Ethernet frames inside UDP), **GTP**
  (mobile), **WireGuard**. A tunnel makes a multi-hop path look like a single logical link
  and is *why* effective MTU shrinks.
- **Multiplexing / demultiplexing** — using a **SAP key** to interleave many upper-layer
  flows over one lower-layer channel and separate them on receive: **EtherType**
  (0x0800/0x86DD/0x0806) selects the L3 protocol, the **IP Protocol number** (6/17/1)
  selects the L4 protocol, and **port numbers** select the process.

Encapsulation is vertical wrapping; tunneling is encapsulation used to carry a foreign
stack; multiplexing is the demux key that reverses it.

## QUIC and HTTP/3: collapsing the layers

QUIC is the flagship "layering is breaking down" example, so be able to place it precisely:

- **QUIC (RFC 9000)** is a **user-space transport running over UDP**. It deliberately folds
  together functions the classic model splits: L4 reliability/ordering/congestion control,
  **per-stream** multiplexing (no head-of-line blocking across streams), connection
  migration, and **TLS 1.3 (RFC 9001)** as a mandatory, integrated handshake — encryption
  is not a separate layer bolted on top but part of the transport, and even most of the
  transport header is encrypted.
- Because it lives in user space over UDP, it evolves without OS-kernel or middlebox
  changes — sidestepping the ossification that made deploying new L4 protocols (like SCTP)
  impractical on the public Internet.
- **HTTP/3 (RFC 9114)** is the application protocol that runs over QUIC, mapping each HTTP
  request/response to a QUIC stream. Loss recovery is RFC 9002.

Placement answer: QUIC spans L4 through the session/presentation functions of L5/L6, and
HTTP/3 sits at L7 — QUIC intentionally erases the L4/L5/L6 boundaries that TCP+TLS keep
separate.

## ARP, RARP, DHCP, and NDP (the IPv6 twist)

The address-resolution family is a favorite because IPv6 *moved* it to a different layer:

- **ARP (RFC 826)** resolves an IPv4 address → MAC on the local link. It has its own
  **EtherType 0x0806** (it rides directly in an Ethernet frame, *not* inside IP), which is
  the strongest argument for calling it **L2**; but it resolves an **L3** address, hence
  the "**Layer 2.5**" hedge.
- **RARP → BOOTP → DHCP** — the historical lineage for a host learning *its own* address.
  RARP (reverse ARP) was replaced by BOOTP and then **DHCP** (application-layer, UDP
  67/68).
- **NDP (Neighbor Discovery, RFC 4861)** — the IPv6 replacement for ARP. Crucially, NDP is
  built on **ICMPv6 (IP Protocol 58)**, so it runs **inside IP at Layer 3** — IPv6 pulled
  neighbor resolution *up* from L2 (ARP) to L3. That single fact ("ARP is L2, its IPv6
  successor NDP is L3") is a great senior differentiator.

## ICMP nuance

Beyond "L3, no ports," the details that separate seniors:

- ICMP is carried **inside IP** (IPv4 Protocol 1; **ICMPv6** is Protocol 58) but is a
  **peer of the transport protocols in the demux chain** — the IP Protocol field selects
  it just as it selects TCP or UDP.
- It uses **type/code**, not ports. **Type 8/0** = echo request/reply (ping). **Type 11**
  = TTL/Hop-Limit exceeded — the mechanism **traceroute** exploits by sending packets with
  increasing TTL and reading the ICMP from each hop. **Type 3 Code 4** = fragmentation
  needed (PMTUD); ICMPv6 **Type 2** = Packet Too Big.
- ICMP has **no reliability and no flow control**, and routers commonly **rate-limit** ICMP
  generation — which is why traceroute hops can appear as `*` and why blocking ICMP breaks
  PMTUD silently.

## Connection-oriented vs connectionless services

"Reliability" is a **service property of a layer, not a layer itself** — worth stating
crisply:

- **Connection-oriented** — a setup handshake establishes state before data (OSI service
  primitives: CONNECT / DATA / DISCONNECT). **TCP** is connection-oriented at L4:
  ordered, reliable, flow/congestion-controlled.
- **Connectionless** — each PDU is independent, no prior setup. **UDP** is connectionless
  at L4; **IP itself is connectionless** at L3 — which is precisely why an IP unit is
  called a **datagram**.
- The key subtlety: **IP (connectionless) happily carries TCP (connection-oriented).** The
  service model of a layer does not have to match the layer above or below it — reliability
  is layered *on top of* a best-effort network, which is the whole point of the end-to-end
  argument. (That argument, Saltzer/Reed/Clark, is also why **UDP still carries its own
  checksum even though Ethernet has a CRC**: the L2 CRC only protects one hop and cannot
  catch corruption inside a router's memory, so end-to-end integrity must be checked
  end-to-end.)

## Why the OSI model persists (and its critics)

TCP/IP won the protocol war, yet the *seven-layer OSI model* remains the universal
language. Why it survives, more precisely than "it's the vocabulary":

1. It is the **shared troubleshooting and design lingua franca** — "that's an L3 problem,"
   "put an L7 LB in front," "it's a Layer 1 issue" communicate instantly across vendors and
   teams.
2. **Vendor product categories are sold by layer** (L2 switch, L3 switch, L4/L7 LB), so the
   taxonomy is commercially entrenched.
3. It **predates and outlived its own failed protocol suite** — the model was useful enough
   to survive even as OSI's protocols died.
4. It **cleanly separates concepts TCP/IP muddles** (session vs presentation vs application;
   service vs protocol; horizontal vs vertical).

The balanced senior counterpoint is **RFC 3439 §3, "Layering Considered Harmful"**: strict
layering has real costs — **redundant work** (checksums at L2 *and* L4), **hidden
cross-layer interactions** (TCP throughput collapsing over lossy wireless because it
misreads loss as congestion), and **per-layer header overhead**. Real high-performance
systems routinely violate layering (offloads, cross-layer optimization) precisely because
the abstraction is not free. Citing both sides shows judgment.

## What changes at each router hop

A precise, field-level answer to "what changes hop-to-hop" separates seniors from
memorizers:

- **Rewritten every hop (L2):** destination MAC (to the next hop's interface) and source
  MAC (to the outgoing interface). The whole L2 frame is rebuilt; the old FCS is discarded
  and a **new FCS** computed.
- **Modified in place (L3):** **TTL** (IPv4) / **Hop Limit** (IPv6) is decremented by 1; in
  IPv4 the **header checksum is recomputed** because the TTL changed. **IPv6 has no header
  checksum**, so nothing is recomputed there — a favorite gotcha.
- **Unchanged end-to-end (barring NAT):** source/destination **IP addresses**, the **L4
  ports**, and the payload. A NAT box is exactly the exception that rewrites the IPs and
  ports (and repairs the L4 checksum).

## Common follow-up questions

- **Why does the Internet use TCP/IP instead of the "official" OSI protocols?** TCP/IP was
  simpler, already working, and freely implementable when the OSI protocol suite was still
  being standardized; the market chose the running code. OSI survives as the *model*.
- **Is OSI obsolete?** The OSI *protocols* largely are, but the OSI *reference model* is
  alive and universal — it is how engineers name and reason about layers.
- **Why 4 vs 5 layers for TCP/IP?** RFC 1122 defines 4 (bundling physical + data link into
  "link"); textbooks split those two apart to make 5. Same model.
- **Does encapsulation add much overhead?** Headers cost bytes (e.g. 20 bytes IPv4 + 20
  bytes TCP = 40 bytes before payload), which matters for small packets and is why header
  compression and larger MTUs/jumbo frames exist.
- **At a router hop, what changes and what stays the same?** The L2 frame header (source/
  dest MAC) is rewritten every hop; the L3 IP source/destination stay constant end-to-end
  (barring NAT); the TTL decrements.
- **Where does NAT operate?** Layer 3 (rewrites IP addresses), and NAPT/PAT also touches
  Layer 4 (rewrites ports) — so it deliberately breaks strict layering.
- **Why can't a Layer 2 switch route between subnets?** It only reads MAC addresses and
  has no concept of IP networks; crossing subnets requires an L3 device (router / L3
  switch).

## References

- ISO/IEC 7498-1:1994 — *Information technology — Open Systems Interconnection — Basic
  Reference Model: The Basic Model* (the OSI model).
- RFC 1122 — *Requirements for Internet Hosts — Communication Layers* (defines the TCP/IP
  layering: Application, Transport, Internet, Link).
- RFC 1123 — *Requirements for Internet Hosts — Application and Support* (companion to 1122).
- RFC 791 — *Internet Protocol* (IPv4, Layer 3); RFC 792 — *ICMP*.
- RFC 793 / RFC 9293 — *Transmission Control Protocol* (TCP, Layer 4); RFC 768 — *UDP*.
- RFC 826 — *Address Resolution Protocol* (ARP, Layer 2).
- RFC 8446 — *The Transport Layer Security (TLS) Protocol Version 1.3*.
- IEEE 802.3 (Ethernet) and IEEE 802.11 (Wi-Fi) — Layer 1/2 standards.
- Kurose & Ross, *Computer Networking: A Top-Down Approach* (5-layer model);
  Tanenbaum & Wetherall, *Computer Networks*.
