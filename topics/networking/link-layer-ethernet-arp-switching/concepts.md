# Link Layer: Ethernet, MAC, ARP & Switching

The link layer (OSI Layer 2, the TCP/IP "link" layer) moves frames between
directly-connected nodes on the *same* physical or logical network segment. It sits
below IP: IP worries about end-to-end delivery across many networks; the link layer
worries about delivery across one hop. This topic covers how Ethernet frames are built,
how hardware (MAC) addresses work, how ARP maps IP addresses to MAC addresses, and how
switches forward frames — plus VLANs, collision/broadcast domains, MTU, and the common
attack (ARP spoofing) interviewers like to probe.

> [!KEY-TAKEAWAY]
> IP addresses get a packet to the right *network*; MAC addresses get a frame to the
> right *interface on the local link*. Every IP hop re-writes the L2 header (new source
> and destination MAC) while the IP source/destination stay the same end-to-end.

## Ethernet frame structure

An Ethernet II (DIX) frame is the workhorse of modern LANs. On the wire the sequence is:

| Field | Size | Purpose |
|---|---|---|
| Preamble | 7 bytes | `10101010` × 7 — clock synchronization |
| Start Frame Delimiter (SFD) | 1 byte | `10101011` — marks start of frame |
| Destination MAC | 6 bytes | Who the frame is for |
| Source MAC | 6 bytes | Who sent it |
| EtherType / Length | 2 bytes | ≥ 0x0600 = EtherType (protocol); ≤ 0x05DC = length (802.3) |
| Payload | 46–1500 bytes | The encapsulated packet (e.g. an IP datagram) |
| Frame Check Sequence (FCS) | 4 bytes | CRC-32 over dest…payload |

Key numbers to remember:

- **Preamble + SFD (8 bytes) are not counted** in the frame size and are stripped by the
  NIC; they exist only for physical-layer synchronization.
- **Minimum payload is 46 bytes** → minimum frame (dest through FCS) is **64 bytes**.
  Short payloads are **padded** to reach it. The 64-byte minimum exists so collisions can
  be detected within the round-trip time on classic half-duplex CSMA/CD Ethernet.
- **Maximum standard payload is 1500 bytes** → the classic Ethernet **MTU is 1500**.
  Maximum standard frame (excluding preamble/SFD) is **1518 bytes** (or **1522** with a
  802.1Q VLAN tag).
- **EtherType** identifies the payload protocol: `0x0800` = IPv4, `0x86DD` = IPv6,
  `0x0806` = ARP, `0x8100` = 802.1Q VLAN-tagged frame.

Common EtherTypes (worth memorizing):

| EtherType | Protocol |
|---|---|
| `0x0800` | IPv4 |
| `0x0806` | ARP |
| `0x86DD` | IPv6 |
| `0x8100` | 802.1Q VLAN tag |
| `0x8847` | MPLS unicast |

> [!TIP]
> The 2-byte field is *EtherType* when its value is ≥ 0x0600 (1536) and a *length* when
> ≤ 0x05DC (1500). This overload is how Ethernet II and the older IEEE 802.3 framing
> coexist on the same wire.

## MAC addressing

A MAC (Media Access Control) address is a 48-bit (6-byte) hardware address, usually
written as six hex octets, e.g. `00:1A:2B:3C:4D:5E`. It identifies a network interface
on the local link.

Structure of a universally-administered address:

- **First 3 bytes = OUI (Organizationally Unique Identifier)** assigned by the IEEE to
  the NIC vendor (e.g. `00:1A:2B`).
- **Last 3 bytes** are assigned by the vendor to make the whole address globally unique.

Two important bits live in the **first octet** (least-significant bits of that byte):

- **I/G bit (bit 0, least-significant):** `0` = unicast (one interface), `1` =
  multicast/group. The Ethernet **broadcast address is `FF:FF:FF:FF:FF:FF`** — all ones,
  a special case where every bit is set.
- **U/L bit (bit 1):** `0` = universally administered (burned-in, OUI-based), `1` =
  locally administered (software-assigned, e.g. randomized MACs for privacy or
  virtualization).

Because the I/G bit is in the *first transmitted octet*, a MAC whose first byte is odd
(e.g. `01:...`, `33:...`) is a multicast address. IPv4 multicast maps to MACs starting
`01:00:5E`; IPv6 multicast maps to `33:33:...`.

> [!WARNING]
> MAC addresses are *not* globally routable and are not guaranteed unique in practice —
> virtualization and locally-administered addresses mean you should never treat a MAC as
> a trustworthy identity. They also only have meaning within a single broadcast domain.

## ARP request and reply

ARP (Address Resolution Protocol, RFC 826) maps a known **IPv4 address** to an unknown
**MAC address** on the same link. Before a host can send an IP packet to a neighbor, it
needs the neighbor's MAC to build the Ethernet header.

The exchange (two frames):

1. **ARP request** — broadcast. Host A wants B's MAC: "Who has `10.0.0.5`? Tell
   `10.0.0.2`." Destination MAC = `FF:FF:FF:FF:FF:FF`, so every host on the segment
   receives it. EtherType `0x0806`.
2. **ARP reply** — unicast. B answers directly to A: "`10.0.0.5` is at
   `00:1A:2B:3C:4D:5E`." Sent unicast back to A's MAC.

ARP packet fields include hardware type (1 = Ethernet), protocol type (`0x0800` = IPv4),
operation (1 = request, 2 = reply), and the sender/target hardware and protocol
addresses.

> [!KEY-TAKEAWAY]
> ARP resolves addresses only for destinations on the **same subnet**. To reach a host on
> a different subnet, the sender ARPs for the **default gateway's** MAC, not the remote
> host's — the remote IP stays in the packet, but the frame is addressed to the router.

IPv6 does not use ARP; it uses **Neighbor Discovery Protocol (NDP, RFC 4861)** over ICMPv6
with Neighbor Solicitation / Neighbor Advertisement messages, riding on multicast rather
than L2 broadcast.

## ARP cache

To avoid ARPing before every packet, each host keeps an **ARP cache** (ARP table): a
map of IP → MAC with expiry timers. You can inspect it with `arp -a` or `ip neigh`.

- **Dynamic entries** are learned from ARP replies and time out (commonly tens of seconds
  to a few minutes; OS-dependent). Timeout balances staleness against broadcast traffic.
- **Static entries** are configured manually and don't expire — sometimes used to harden
  against spoofing for critical hosts (e.g. the gateway).
- **Gratuitous ARP** is an unsolicited ARP announcement (a host broadcasts its own
  IP→MAC mapping). Uses: detect duplicate IPs, update neighbors' caches after a failover
  (e.g. VRRP/keepalived moving a virtual IP to a new MAC), and pre-populate switch tables.

Example `ip neigh` output:

```
10.0.0.1 dev eth0 lladdr 00:1a:2b:3c:4d:5e REACHABLE
10.0.0.5 dev eth0 lladdr 00:aa:bb:cc:dd:ee STALE
```

States like `REACHABLE`, `STALE`, `DELAY`, and `INCOMPLETE` come from the Linux neighbor
state machine (shared conceptually with IPv6 NDP).

## Hubs vs switches

Both connect multiple devices, but operate very differently:

| | Hub (L1) | Switch (L2) |
|---|---|---|
| OSI layer | Physical | Data link |
| Forwarding | Repeats every bit to **all** ports | Forwards frames to the **specific** port for the destination MAC |
| Collision domain | **One** shared domain (all ports) | **One per port** |
| Duplex | Half-duplex (shared medium, CSMA/CD) | Full-duplex per port |
| Bandwidth | Shared among all ports | Dedicated per port |
| Intelligence | None (dumb repeater) | Learns MAC addresses, maintains a table |

A hub is essentially a multi-port repeater: it has no knowledge of addresses and creates a
single shared collision domain, so only one device can transmit at a time. A switch reads
the destination MAC of each frame and forwards it only out the port where that MAC lives,
giving each port its own collision domain and full-duplex operation. Hubs are effectively
obsolete; switches dominate modern LANs.

## MAC learning and the CAM table

A switch builds its forwarding table (the **MAC address table**, often stored in **CAM —
Content-Addressable Memory**) by *learning*:

1. **Learn:** when a frame arrives, the switch records `source MAC → ingress port` in its
   table (with a timer, typically ~300 s / 5 min default aging).
2. **Forward / filter:** it looks up the **destination MAC**:
   - **Known unicast** → forward out only the mapped port (unicast forwarding).
   - **Unknown unicast** (not yet in table) → **flood** out all ports except the one it
     arrived on. When the destination replies, the switch learns its port too.
   - **Broadcast** (`FF:FF:FF:FF:FF:FF`) and typically **multicast** → flood to all ports
     in the VLAN.

> [!INTERVIEW]
> "How does a switch handle the very first frame to a host it hasn't seen?" — Answer:
> unknown-unicast **flooding**. The switch has no table entry, so it floods; the reply
> teaches it the port, and subsequent frames are forwarded directly. This is *learning*,
> not routing.

CAM (Content-Addressable Memory) lets the switch look up a destination MAC in a single
hardware operation — you supply the value (MAC) and it returns the location (port),
enabling wire-speed forwarding. This is distinct from TCAM (Ternary CAM), which supports
"don't-care" bits and is used for longest-prefix IP routing and ACLs in L3 switches.

## Broadcast vs collision domains

Two "domain" concepts that interviewers frequently conflate:

- **Collision domain:** the set of interfaces that could collide if they transmitted at
  once (relevant to half-duplex CSMA/CD). A **hub** is one big collision domain; a
  **switch** puts **each port in its own** collision domain. Full-duplex switched links
  essentially eliminate collisions.
- **Broadcast domain:** the set of devices that receive one another's broadcast frames. A
  **switch (and hub) forward broadcasts to the whole segment**, so all their ports are in
  **one broadcast domain**. A **router (or a VLAN boundary)** stops broadcasts — it is
  where broadcast domains are separated.

Rules of thumb:

- Switch ports = many collision domains, one broadcast domain.
- Each VLAN = a separate broadcast domain (and typically a separate IP subnet).
- Routers do **not** forward broadcasts, so each router interface bounds a broadcast
  domain.

## VLANs and 802.1Q trunking

A **VLAN (Virtual LAN)** logically partitions one physical switch (or set of switches)
into multiple isolated broadcast domains. Two hosts on the same switch but different VLANs
cannot reach each other at L2 — traffic between VLANs must be **routed** (an L3 device or
"router-on-a-stick"/SVI).

- Why: segmentation for security, smaller broadcast domains, grouping by function rather
  than physical location.
- **802.1Q** is the IEEE standard for VLAN tagging. It inserts a **4-byte tag** into the
  Ethernet header between the source MAC and the EtherType. The tag contains:
  - **TPID** = `0x8100` (marks the frame as 802.1Q tagged).
  - **PCP** (3 bits) — priority (802.1p class of service).
  - **DEI** (1 bit) — drop-eligible indicator.
  - **VID** (12 bits) — the VLAN ID (0–4095; **0 and 4095 reserved**, so **4094 usable**).

Because the tag adds 4 bytes, a tagged frame can be up to **1522 bytes** (vs 1518).

Port modes:

- **Access port:** carries a single VLAN; frames are **untagged** toward the end host. The
  switch assigns the port's VLAN.
- **Trunk port:** carries **multiple VLANs** between switches (or to a router/hypervisor),
  **tagging** frames with their VID so the far end can demultiplex them.
- **Native VLAN:** on a trunk, the one VLAN whose frames are sent **untagged** (default 1).
  A native-VLAN mismatch is a classic misconfiguration and a security concern (VLAN
  hopping via double-tagging).

## L2 vs L3 forwarding

The core distinction interviewers test — what changes hop-to-hop:

- **L2 (switching):** forwards based on **destination MAC** within a single broadcast
  domain/subnet. Does **not** modify the IP header or decrement TTL. The frame's L2
  addresses are only locally significant.
- **L3 (routing):** forwards based on **destination IP** across subnets. The router
  **rewrites the L2 header** (new source MAC = router's egress interface, new destination
  MAC = next hop, resolved via ARP), **decrements the IPv4 TTL** (and recomputes the
  header checksum), and may fragment.

Walkthrough — host `10.0.0.2` sending to `192.168.5.9` (different subnet):

1. Source sees the destination is off-subnet → sends the frame to the **default
   gateway's MAC** (ARP for the gateway), but the **IP destination stays `192.168.5.9`**.
2. Router receives it, looks up `192.168.5.9` in its routing table, decrements TTL,
   rewrites the Ethernet header with its own egress MAC as source and the next hop's MAC
   as destination.
3. This repeats hop by hop. **The IP src/dst never change** (barring NAT); **the MAC
   src/dst change on every hop.**

An **L3 switch** is a switch with routing hardware (TCAM) that can do inter-VLAN routing at
near-wire speed — blurring the line, but the two *functions* remain distinct.

> [!KEY-TAKEAWAY]
> Same subnet → switched (dest MAC = the host). Different subnet → routed (dest MAC = the
> gateway, dest IP = the final host). TTL decrement is the fingerprint of an L3 hop.

## ARP spoofing

Because ARP has **no authentication**, any host can send a forged ARP reply claiming to
own an IP. In **ARP spoofing / ARP poisoning**, an attacker sends gratuitous or crafted
ARP replies mapping the **victim's or gateway's IP to the attacker's MAC**. Victims update
their caches and start sending that traffic to the attacker.

Consequences:

- **Man-in-the-middle (MITM):** attacker poisons both victim and gateway, relaying (and
  reading/modifying) traffic in both directions.
- **Denial of service:** map the gateway IP to a nonexistent MAC → traffic black-holes.

Mitigations:

- **Dynamic ARP Inspection (DAI):** switch feature that validates ARP packets against a
  trusted DHCP-snooping binding table and drops forgeries.
- **DHCP snooping** — builds the IP/MAC/port binding table DAI relies on.
- **Static ARP entries** for critical hosts (e.g. the gateway).
- **Port security** (limit MACs per port), **802.1X** (port authentication), and
  encryption (TLS/IPsec) so a MITM sees only ciphertext.

> [!WARNING]
> ARP spoofing works only within a broadcast domain — it's a **local-segment** attack. It
> does not cross a router. Encryption doesn't prevent the poisoning, but it prevents the
> attacker from reading or tampering with the intercepted traffic.

## MTU and framing

**MTU (Maximum Transmission Unit)** is the largest payload a link can carry in one frame.
The classic Ethernet MTU is **1500 bytes** (the max standard Ethernet payload). Framing =
how bytes are delimited into discrete frames (preamble/SFD, addressing, FCS).

- If an IP packet exceeds the path MTU, it must be **fragmented** (IPv4 routers or the
  source can fragment) or dropped. **IPv6 routers never fragment** — only the source may,
  guided by **Path MTU Discovery (PMTUD, RFC 8201)**.
- **PMTUD** discovers the smallest MTU along a path. IPv4 sets the **DF (Don't Fragment)**
  bit; a router needing to fragment instead drops the packet and returns **ICMP "Frag
  needed"** (Type 3, Code 4) with the next-hop MTU. IPv6 uses ICMPv6 **Packet Too Big**.
  If firewalls block these ICMP messages, PMTUD silently fails → the connection hangs
  ("PMTUD black hole").
- **Jumbo frames:** payloads up to ~9000 bytes, common in data-center / storage networks
  to reduce per-packet overhead and CPU. Not part of the IEEE standard; requires
  end-to-end support and consistent configuration.
- **TCP MSS** is derived from MTU: `MSS = MTU − IP header − TCP header` = `1500 − 20 − 20
  = 1460` bytes for standard IPv4/Ethernet with no options. **MSS clamping** on routers
  (e.g. over PPPoE/tunnels with 1492 or smaller MTU) forces a smaller MSS to avoid
  fragmentation and PMTUD black holes.

> [!TIP]
> Overhead reduces effective MTU: an **802.1Q tag** costs 4 bytes; **PPPoE** costs 8
> (→1492); **VXLAN** adds ~50 bytes; **IPsec/GRE** tunnels add their own headers. When you
> tunnel, either raise the underlying MTU or clamp MSS.

## Common follow-up questions

- **Why is the minimum Ethernet frame 64 bytes?** So a station on classic half-duplex
  CSMA/CD Ethernet is still transmitting when the earliest possible collision signal
  returns, guaranteeing collision detection within the slot time. Short frames are padded.
- **What's the difference between the EtherType and the 802.3 length field?** They share
  the same 2 bytes. Values ≥ 1536 (0x0600) are an EtherType (protocol); ≤ 1500 are a
  length (802.3, usually with an LLC/SNAP header inside).
- **How does a host decide whether to ARP for the destination or the gateway?** It applies
  its subnet mask: if the destination is in the same subnet, it ARPs for the host;
  otherwise it ARPs for the default gateway.
- **What happens to the MAC and IP addresses across multiple router hops?** IP src/dst stay
  constant end-to-end (barring NAT); the L2 src/dst are rewritten at every hop, and the
  IPv4 TTL decrements by one per hop.
- **Does IPv6 use ARP?** No — it uses NDP (Neighbor Discovery, ICMPv6) with Neighbor
  Solicitation/Advertisement over multicast.
- **What is unknown-unicast flooding and why does it happen?** When a switch has no table
  entry for a destination MAC, it floods the frame to all ports in the VLAN; the reply
  teaches it the correct port. A MAC-flooding attack overflows the CAM table to force
  constant flooding (turning the switch into a hub for sniffing).
- **How do VLANs and subnets relate?** Typically 1:1 — each VLAN is one broadcast domain
  and maps to one IP subnet; moving between them requires L3 routing.
- **Why does a VPN or tunnel sometimes break large transfers but not pings?** The tunnel
  lowers the path MTU; if PMTUD ICMP is filtered, full-size TCP segments are dropped
  silently — small packets (ping, TLS handshake) succeed, bulk transfer stalls. Fix with
  MSS clamping or proper ICMP.

## References

- RFC 826 — An Ethernet Address Resolution Protocol (ARP)
- RFC 5227 — IPv4 Address Conflict Detection (gratuitous ARP / ACD)
- RFC 4861 — Neighbor Discovery for IP version 6 (NDP)
- RFC 9293 — Transmission Control Protocol (MSS context)
- RFC 8201 — Path MTU Discovery for IPv6
- RFC 1191 — Path MTU Discovery (IPv4)
- IEEE 802.3 — Ethernet (frame format, CSMA/CD)
- IEEE 802.1Q — Virtual LANs and frame tagging (VLAN tag, trunking)
- IEEE 802.1p — Priority (PCP field)
- IEEE Registration Authority — OUI / MAC address assignment
