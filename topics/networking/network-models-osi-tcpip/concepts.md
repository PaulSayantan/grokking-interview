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
