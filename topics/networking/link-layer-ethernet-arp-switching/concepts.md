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

## Spanning tree loop prevention (STP, RSTP, MSTP)

Ethernet has **no TTL / hop-count field** (unlike IP). A broadcast, unknown-unicast, or
multicast frame ("**BUM traffic**") that enters a topology with a bridging loop is
forwarded, flooded, and re-flooded **forever**. Two catastrophes follow within
milliseconds:

- **Broadcast storm:** copies multiply exponentially around the loop until links and
  switch CPUs saturate and the whole segment melts down.
- **MAC table instability (flapping):** the same source MAC arrives on two ports in quick
  succession, so the CAM entry ping-pongs between ports, corrupting forwarding.

**Spanning Tree Protocol (STP, IEEE 802.1D)** solves this by computing a loop-free
logical tree over a physically redundant topology and putting the redundant links into a
**blocking** state (they carry no data, only BPDUs) until they are needed.

**STP 802.1D mechanics:**

- **Root bridge election:** every bridge starts claiming to be root; the bridge with the
  numerically **lowest Bridge ID** wins. Bridge ID = **2-byte priority** (default
  **32768**, configurable in steps of **4096** because the lower 12 bits are now an
  *extended system ID* carrying the VLAN, per 802.1t) **+ 6-byte MAC**. Ties break on the
  lowest MAC.
- **Port roles/selection:** each non-root bridge picks one **root port** (lowest cumulative
  **path cost** to the root); each segment picks one **designated port**; remaining ports
  are **blocking**.
- **Port states:** `blocking → listening → learning → forwarding` (plus `disabled`). A port
  spends one **forward-delay** interval in listening and another in learning.
- **Timers:** hello = **2 s**, forward delay = **15 s**, max age = **20 s**. A newly
  connected port therefore takes **~30–50 s** to reach forwarding — the reason a host can
  fail PXE/DHCP on boot until the port converges.
- **BPDUs:** Bridge Protocol Data Units — Configuration BPDUs (root/cost info) and
  **Topology Change Notification (TCN)** BPDUs. Sent to the reserved multicast MAC
  **`01:80:C2:00:00:00`**.

**RSTP (802.1w)** — the modern default, folded into 802.1Q-2018:

- **Port roles:** root, designated, **alternate** (backup path to root), **backup** (backup
  designated on a shared segment).
- **Three port states:** `discarding / learning / forwarding` (collapses 802.1D's
  disabled/blocking/listening into discarding).
- **Proposal/agreement handshake** on point-to-point (full-duplex) links converges in
  **sub-second** time instead of 30–50 s.
- **Edge ports (PortFast):** ports facing end hosts skip straight to forwarding.

**MSTP (802.1s):** maps groups of VLANs to a small number of **MST instances** so you do
not run one spanning-tree instance per VLAN. Switches join the same **MST region** only if
their **region name, revision number, and VLAN-to-instance mapping (an MD5 digest)** match.

**Protection features (real-world hardening):**

- **PortFast / edge port:** immediate forwarding on host-facing ports.
- **BPDU Guard:** if a PortFast/edge port ever *receives* a BPDU (someone plugged a switch
  into an access port), the port is **err-disabled** — because edge ports should never see
  another bridge.
- **Root Guard:** prevents a downstream switch from becoming root (ignores superior BPDUs
  on that port).
- **Loop Guard:** protects against a blocking port erroneously transitioning to forwarding
  when BPDUs stop arriving (e.g. unidirectional link).

## VLAN hopping attacks

Two named attacks let a host on one VLAN reach another, and both are "why native VLAN and
DTP hygiene matter" payoffs:

- **Switch spoofing (DTP abuse):** Cisco's **Dynamic Trunking Protocol (DTP)** auto-negotiates
  whether a link becomes a trunk. If an access port is left at the default `dynamic auto`/
  `dynamic desirable`, an attacker sends DTP frames to negotiate a **trunk**, then sees
  **all** VLANs. Defense: hard-set `switchport mode access` and `switchport nonegotiate`
  (disable DTP).
- **Double-tagging (802.1Q double-encapsulation):** attacker sends a frame with **two**
  802.1Q tags — outer = the trunk's **native VLAN**, inner = the target VLAN. The first
  switch strips the outer tag (native VLAN is carried untagged) and forwards the frame out
  the trunk; the **second** switch reads the remaining inner tag and delivers it to the
  target VLAN. The attack is **unidirectional** (no return path) and works only because the
  native VLAN is untagged. Defenses: set the native VLAN to an **unused** ID, never use
  VLAN 1, and/or force the native VLAN to be tagged (`vlan dot1q tag native`).

## MAC flooding and port security

The CAM table is finite. In a **MAC-flooding / CAM-overflow** attack, tools like
**`macof`** (part of dsniff) inject a torrent of frames with **random bogus source MACs**.
Once the table fills, the switch can no longer learn legitimate mappings and **fails open**:
every unknown-unicast frame is **flooded out all ports in the VLAN**, effectively turning
the switch into a hub so the attacker can sniff other hosts' traffic.

**Port Security** is the standard mitigation: limit the number of MACs learned per port,
optionally pin them with **sticky MAC** learning, and pick a **violation mode**:

- **shutdown** — err-disable the port (default, safest).
- **restrict** — drop offending frames and increment a counter/alert.
- **protect** — silently drop offending frames.

This pairs with ARP spoofing as one of the top L2 attacks interviewers probe together.

## 802.1Q vs ISL

Two ways to carry VLAN membership between switches:

| | IEEE 802.1Q | Cisco ISL (legacy) |
|---|---|---|
| Approach | **Inserts** a 4-byte tag inline (between src MAC and EtherType) | **External encapsulation** — wraps the entire original frame |
| Overhead | 4 bytes (frame up to 1522) | **26-byte header + 4-byte CRC** trailer (30 bytes) |
| Native/untagged VLAN | Yes — native VLAN carried untagged | **No** concept of an untagged native VLAN |
| Standard | IEEE, multi-vendor | Cisco-proprietary, **deprecated/obsolete** |

802.1Q won universally; ISL is gone from modern hardware. Know it existed and *why* the
standard, lower-overhead, native-VLAN-capable 802.1Q replaced it.

## Link aggregation and LACP

**Link aggregation** (EtherChannel / port-channel / "bond") bundles N physical links into
one logical link for higher aggregate bandwidth and link redundancy. **LACP (IEEE 802.3ad,
renamed 802.1AX)** negotiates the bundle with **LACPDUs** in **active** (initiates) or
**passive** (only responds) mode; alternatives are static ("on") or Cisco's legacy PAgP.

The senior nuance: frames are distributed across members by a **per-flow hash** (of some
combination of src/dst MAC, IP, and L4 ports) — **not** round-robin — to preserve per-flow
ordering. Consequences:

- A **single flow is pinned to one member link** and **cannot exceed that link's speed**.
  Bonding two 10G links does **not** give one TCP connection 20G — a single backup/`scp`
  job still tops out near 10G.
- Aggregate benefit appears only with **many** flows whose hashes spread across members.
- Bundles form only between the two endpoints of the aggregation; they do not "add up"
  across the whole network.

## Gratuitous ARP and Proxy ARP

**Gratuitous ARP (GARP):** an ARP request or reply where **sender IP = target IP** (a host
announces its own mapping, unsolicited). Legitimate uses:

- **Duplicate-address detection (ACD, RFC 5227)** — probe before claiming an IP.
- **Cache/CAM update after failover** — VRRP/keepalived VIP move, VM live migration — so
  neighbors and switches redirect traffic to the new MAC/port quickly. (A missing or
  DAI-dropped GARP is why a VIP can be unreachable for ~30 s after failover.)
- Priming switch forwarding tables.

It is also an **attack vector** (the mechanism behind ARP-cache poisoning).

**Proxy ARP (RFC 1027):** a router answers ARP requests on behalf of IPs it can reach,
letting a host that thinks *everything* is on-link resolve off-subnet destinations to the
router's MAC. Largely **legacy/discouraged**: it bloats ARP tables, hides
misconfiguration, and behaves badly with overlapping subnets. Modern relatives appear in
**DHCP relay** and **EVPN/overlay** designs.

## FCS, error handling, and switching modes

The 4-byte **FCS carries a CRC-32** over destination MAC through payload. L2 is
**error-detection, not correction**: a switch or NIC that computes a mismatching CRC
**silently drops** the frame — it never repairs it, and it is up to higher layers (TCP) to
retransmit. Counters you read when chasing a bad cable or duplex mismatch:

- **CRC / FCS errors** — corrupted frame (bad cable, EMI, duplex mismatch).
- **Runts** — frames **< 64 bytes** (often from collisions or truncation).
- **Giants** — frames larger than the allowed maximum (e.g. oversized due to MTU/tagging
  mismatch); **jumbo** frames appear as giants on a switch not configured for them.
- **Alignment errors** — frame length not a whole number of octets.

**Switching mode** determines *when* forwarding starts:

- **Store-and-forward:** buffer the whole frame, **verify the FCS**, then forward. Drops
  corrupt/runt/giant frames — never propagates errors — at the cost of latency
  proportional to frame size. Required when in/out link speeds differ.
- **Cut-through:** start forwarding as soon as the destination MAC is read (first ~6–14
  bytes), before the FCS arrives. Lowest latency, but it can **forward corrupt frames**
  because it hasn't seen the CRC yet. Some switches use **fragment-free** (wait for the
  first 64 bytes to filter collision runts) as a middle ground, or fall back to
  store-and-forward under high error rates.

## CSMA/CD, slot time, and duplex mismatch

Classic **half-duplex** Ethernet used **CSMA/CD** (Carrier Sense Multiple Access with
Collision Detection): listen before sending, and if two stations transmit at once, detect
the collision, send a jam signal, and back off (binary exponential backoff). The
**64-byte minimum frame = 512-bit slot time**: a station must still be transmitting when
the farthest possible collision returns, which is what bounds maximum cable length.

Even though full-duplex switched links **do not collide** (CSMA/CD is effectively legacy),
the constants and their diagnostics persist:

- **Duplex mismatch:** one side full-duplex, the other half-duplex (usually from
  autonegotiation failure). Symptom: the link "works" but throughput is terrible, with
  **CRC/FCS errors** and **late collisions** climbing on the half-duplex side.
- **Late collision:** a collision detected **after** the slot time (after the first 64
  bytes). It is never normal on a correct network — it signals a **duplex mismatch** or a
  cable longer than spec. A key debugging signature.

## Neighbor Discovery Protocol (NDP) internals

IPv6 replaces ARP with **NDP (RFC 4861)** over **ICMPv6**, and it is more capable:

- **Neighbor Solicitation (NS, ICMPv6 type 135) / Neighbor Advertisement (NA, type 136)**
  do address resolution. NS is sent to the **solicited-node multicast address**
  **`FF02::1:FFxx:xxxx`** (built from the low 24 bits of the target IPv6 address), not to a
  broadcast — so uninvolved hosts are not interrupted.
- **Router Solicitation / Router Advertisement (RS/RA, types 133/134)** handle gateway and
  prefix discovery (SLAAC).
- **Duplicate Address Detection (DAD):** before using a tentative address, a host sends an
  NS for it; any NA response means the address is already taken.
- **Neighbor Unreachability Detection (NUD):** the state machine
  `INCOMPLETE → REACHABLE → STALE → DELAY → PROBE` tracks liveness of a neighbor.
- **Threats and defenses:** NDP is unauthenticated like ARP, so **NDP spoofing** and
  **rogue Router Advertisements** are the IPv6 analog of ARP poisoning. Defenses: **RA
  Guard**, **ND inspection / IPv6 snooping**, and **SEND (SEcure Neighbor Discovery, RFC
  3971)**.

## MAC address randomization and special ranges

- **Randomized / private MACs:** modern phones and laptops present a **per-SSID randomized,
  locally-administered MAC** (the U/L bit set to 1) for privacy. This **breaks MAC-based
  NAC, ACLs, DHCP reservations, and device tracking** — a real 2025 operations headache.
- **Locally-administered bit tie-in:** any software-assigned MAC (VM/container NICs,
  randomized privacy MACs, VRRP virtual MACs) sets the **U/L bit**, so it does **not**
  derive from an IEEE OUI.
- **Multicast ranges:** IPv4 multicast → `01:00:5E:xx:xx:xx`; IPv6 multicast →
  `33:33:xx:xx:xx:xx`. STP/bridge control → `01:80:C2:00:00:00`.
- **EUI-64:** SLAAC can derive an IPv6 interface identifier from a 48-bit MAC by inserting
  `FF:FE` in the middle and flipping the U/L bit — though privacy addresses (RFC 8981) are
  now preferred over EUI-64 for the same tracking reasons.

## Power over Ethernet (PoE)

PoE delivers electrical power over the same twisted-pair Ethernet cabling that carries
data, so APs, IP phones, and cameras need only one cable. Power is negotiated at
L1/data-link (classification/LLDP), and standards step up over time:

- **802.3af (Type 1, "PoE"):** ~15.4 W at the source, ~12.95 W at the powered device (PD).
- **802.3at (Type 2, "PoE+"):** ~30 W at the source, ~25.5 W at the PD.
- **802.3bt (Type 3/4, "PoE++"/"4PPoE"):** uses **all four pairs**; Type 4 sources up to
  ~**90 W**, delivering ~**71.3 W** at the PD (the difference is cable loss).

## Jumbo frames and MTU mismatch

Jumbo frames (payload ~9000 bytes) cut per-packet overhead and CPU in data-center, storage
(iSCSI/NFS), and backup networks, but they are **not** an IEEE standard and demand
**consistent MTU on every host, switch, and router in the path**. "**Baby giants**"
(~1522–1600 bytes) accommodate tag/tunnel overhead (Q-in-Q, MPLS, VXLAN) without full
jumbo.

**MTU-mismatch failure mode (an L2 black hole):** if one device in the path has a smaller
MTU, oversized frames are **silently dropped as giants**. The symptom mirrors a PMTUD
black hole but at L2: **small packets and ping succeed, while bulk transfers, iSCSI, NFS,
or TLS-with-large-certificates hang**. Isolate it by probing with a DF-bit ping that
forbids fragmentation, e.g. `ping -M do -s 8972 <host>` (8972 + 8 ICMP + 20 IP = 9000):
the largest size that still gets a reply reveals the true path MTU.

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
- **Why is a bridging loop so much worse at L2 than a routing loop at L3?** Ethernet has no
  TTL, so looped BUM traffic never dies — a broadcast storm plus MAC flapping melts the
  segment in milliseconds. IP's TTL kills looped packets in ≤255 hops. STP/RSTP exist
  precisely because L2 has no such backstop.
- **A port takes ~30 s to pass traffic after a device boots (PXE/DHCP fails) — why?** The
  switch port is running STP listening→learning (15 s each). Fix by enabling PortFast/edge
  on host-facing ports (and pair with BPDU Guard).
- **You bonded two 10G links but one backup job still hits only ~10G — why?** LACP hashes
  each flow onto a single member link to preserve ordering, so a single TCP flow is pinned
  to one 10G member. Aggregation helps only across many flows.
- **A MAC is flapping between two ports in the logs — what does it mean?** Either a physical
  L2 loop (STP failed/disabled), a duplicate MAC, or a misconfigured NIC team — the same
  source MAC is arriving on two ports, destabilizing the CAM table.
- **How does an attacker on an access port reach another VLAN?** DTP switch-spoofing (negotiate
  a trunk) or 802.1Q double-tagging (outer = native VLAN stripped by switch 1, inner delivered
  by switch 2). Harden the native VLAN and disable DTP.
- **Cut-through vs store-and-forward — which validates the FCS?** Store-and-forward buffers the
  whole frame and checks the CRC before forwarding (drops corrupt frames); cut-through starts
  forwarding after the destination MAC, so it can propagate corrupt frames.

## References

- RFC 826 — An Ethernet Address Resolution Protocol (ARP)
- RFC 5227 — IPv4 Address Conflict Detection (gratuitous ARP / ACD)
- RFC 4861 — Neighbor Discovery for IP version 6 (NDP)
- RFC 9293 — Transmission Control Protocol (MSS context)
- RFC 8201 — Path MTU Discovery for IPv6
- RFC 1191 — Path MTU Discovery (IPv4)
- RFC 1027 — Using ARP to Implement Transparent Subnet Gateways (Proxy ARP)
- RFC 3971 — SEcure Neighbor Discovery (SEND)
- RFC 8981 — Temporary Address Extensions for SLAAC (privacy addresses)
- IEEE 802.3 — Ethernet (frame format, CSMA/CD)
- IEEE 802.1D — Spanning Tree Protocol (STP)
- IEEE 802.1w — Rapid Spanning Tree Protocol (RSTP; folded into 802.1Q-2018)
- IEEE 802.1s — Multiple Spanning Tree Protocol (MSTP)
- IEEE 802.1t — Bridge ID extended system ID
- IEEE 802.1Q — Virtual LANs and frame tagging (VLAN tag, trunking)
- IEEE 802.1p — Priority (PCP field)
- IEEE 802.1X — Port-based network access control (NAC)
- IEEE 802.3ad / 802.1AX — Link Aggregation (LACP)
- IEEE 802.3af/at/bt — Power over Ethernet (PoE / PoE+ / PoE++)
- IEEE Registration Authority — OUI / MAC address assignment
- Note: STP BPDUs use reserved multicast MAC 01:80:C2:00:00:00; DAI, DHCP snooping, DTP,
  PortFast, and BPDU Guard are vendor features, not RFC/IEEE standards.
