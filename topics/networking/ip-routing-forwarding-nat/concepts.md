# IP Routing, Forwarding & NAT

How does an IP packet actually get from a host on one network to a host on another,
possibly across the entire internet? Two distinct jobs answer that question:
**routing** (building the map of where networks are) and **forwarding** (moving each
packet one hop closer using that map). On top of that sits **NAT**, the address-rewriting
hack that lets billions of private hosts share a handful of public IPv4 addresses — and
that quietly breaks the internet's original end-to-end model. This topic is language- and
vendor-agnostic: it is about what happens on the wire and in the IP header, not about any
one router OS.

> [!KEY-TAKEAWAY]
> Routing = decide the path (control plane, builds the table). Forwarding = execute the
> path per packet (data plane, longest-prefix lookup). NAT = rewrite addresses/ports so
> a packet can survive the trip across an address boundary.

## Routing table and longest-prefix match

Every IP-capable node — host or router — has a **routing table** (a.k.a. Forwarding
Information Base / FIB when it is the lookup-optimized copy). Each entry maps a
**destination prefix** (network + mask, in CIDR notation) to a **next hop** and an
**outgoing interface**. When a packet arrives, the node compares the destination IP
against every entry and picks the one whose prefix matches and is **most specific** —
this is **longest-prefix match (LPM)**.

Example table:

| Destination prefix | Next hop | Interface | Notes |
|---|---|---|---|
| `0.0.0.0/0` | `192.0.2.1` | eth0 | default route (least specific) |
| `10.0.0.0/8` | `10.1.1.1` | eth1 | |
| `10.1.0.0/16` | `10.1.1.9` | eth1 | more specific than /8 |
| `10.1.2.0/24` | `10.1.1.20` | eth2 | most specific |

A packet to `10.1.2.55` matches `/0`, `/8`, `/16`, **and** `/24`. LPM wins → it is sent
via `10.1.1.20` on eth2. The prefix length (the number after the slash) is literally the
"length" being maximized: `/24` beats `/16` beats `/8` beats `/0`.

Why LPM matters: it lets you write one broad route and then *override* narrower slices
without deleting anything. It is also why the **default route** (`0.0.0.0/0`, or `::/0`
in IPv6) works — it matches everything but is always the loser when anything more specific
exists, so it is the fallback of last resort.

> [!TIP]
> A `/0` mask matches 0 bits → matches every address. A `/32` (IPv4) or `/128` (IPv6)
> is a single host route — the most specific possible. Prefix length ranges 0–32 (IPv4)
> or 0–128 (IPv6).

Advanced points interviewers probe:

- **Tie-breaking within equal prefix length.** If two protocols offer the same prefix,
  routers use **administrative distance / route preference** (e.g. directly connected <
  static < OSPF < BGP in typical defaults) to choose. If the *same* protocol offers two
  equal-cost paths, that is **ECMP** (equal-cost multipath) and traffic is hashed across
  them per-flow.
- **RIB vs FIB.** The RIB (Routing Information Base) is the full control-plane database of
  everything learned; the FIB is the pruned, hardware-optimized table the data plane
  actually uses. LPM in hardware is often done with a **TRIE / radix tree** or TCAM.
- A **connected route** (the subnet on a directly attached interface) is installed
  automatically and is more trusted than any learned route to the same prefix.

## Forwarding vs routing

These two words are used loosely in conversation but name **different planes**:

- **Routing (control plane):** the process of *learning and choosing* paths — running
  routing protocols (OSPF, BGP), exchanging updates, running SPF/Bellman-Ford, and
  installing the best routes into the table. Relatively slow, runs on the CPU, happens
  continuously in the background.
- **Forwarding (data plane):** the per-packet act of *looking up* the destination in the
  (already-built) FIB and pushing the packet out the right interface, rewriting the L2
  header and decrementing TTL. This must happen at line rate — often in dedicated ASIC
  hardware, not the CPU.

The classic interview one-liner: **routing builds the map; forwarding drives the route.**
A router can forward millions of packets per second using a table that the routing
protocols updated seconds ago. If the control plane dies but the FIB is intact, forwarding
often keeps working (this is the idea behind "graceful restart / nonstop forwarding").

> [!INTERVIEW]
> If asked "what does a router do when a packet arrives?": (1) verify checksum / TTL,
> (2) longest-prefix-match the destination in the FIB, (3) decrement TTL (drop + ICMP if
> it hits 0), (4) rewrite the L2 (MAC) header for the next hop, (5) recompute the IPv4
> header checksum, (6) enqueue on the egress interface. The L3 destination IP does **not**
> change hop to hop (unless NAT); the L2 MAC addresses change every hop.

## Static vs dynamic routing

**Static routes** are manually configured entries. They are simple, predictable, add zero
protocol overhead, and reveal nothing to neighbors — great for small/stub networks, a
default route pointing at your ISP, or deliberately pinning a path. Their weakness is that
they do **not react to failures**: if the next hop dies, the static route stays in the
table (unless paired with a liveness check like BFD or a tracked object) and blackholes
traffic.

**Dynamic routing** uses a protocol (RIP, OSPF, BGP, IS-IS, EIGRP) so routers *discover*
topology and *reconverge* automatically when links change. This scales and self-heals but
costs CPU, memory, bandwidth for updates, and introduces convergence delay and complexity.

| | Static | Dynamic |
|---|---|---|
| Configuration | Manual, per route | Protocol learns automatically |
| Reacts to failure | No (by itself) | Yes — reconverges |
| Overhead | None | CPU/memory/bandwidth |
| Scales to large nets | Poorly | Well |
| Predictability | Total | Depends on topology |
| Typical use | Stub networks, default route | Backbones, multi-path networks |

Real networks mix both: e.g. a static default route to the ISP plus OSPF internally.

## Interior vs exterior gateway protocols

Routing protocols split by *where* they operate relative to an **Autonomous System (AS)** —
a network under a single administrative/routing policy, identified by an **ASN**.

- **IGP (Interior Gateway Protocol):** routes *within* one AS. Goal = find the
  technically best (shortest/fastest) path. Examples: **OSPF**, **IS-IS**, **RIP**,
  **EIGRP**. They converge fast and optimize metrics like cost/hop count.
- **EGP (Exterior Gateway Protocol):** routes *between* ASes. Today this means exactly
  one protocol: **BGP** (specifically eBGP). Goal = enforce *policy* (business
  relationships, cost, preference) — not necessarily the shortest path.

> [!TIP]
> Mnemonic: **I**GP = **I**nternal (inside your org, optimize distance). **E**GP/BGP =
> **E**xternal (between orgs, enforce policy). BGP is "the routing protocol of the
> internet."

Advanced nuance: BGP is used both between ASes (**eBGP**) and, confusingly, *inside* an AS
to carry external routes across it (**iBGP**). iBGP is still BGP, but its role is
transport of external prefixes, not internal path selection — that is the IGP's job.

## Distance-vector vs link-state (RIP, OSPF)

The two classic IGP families differ in *what each router knows*:

**Distance-vector (RIP, EIGRP):** each router knows only its neighbors' *distance
vectors* — "I can reach network X in N hops via me." It runs a Bellman-Ford-style
computation and trusts what neighbors tell it ("routing by rumor"). Simple and low-memory,
but slow to converge and prone to **routing loops** and the **count-to-infinity** problem,
mitigated by hacks like **split horizon**, **route poisoning**, and **hold-down timers**.
- **RIP** (RFC 2453, v2): metric = hop count, max **15** hops (16 = unreachable/infinity),
  updates broadcast every 30s. Obsolete for anything nontrivial due to that tiny diameter
  and slow convergence.

**Link-state (OSPF, IS-IS):** every router floods **Link-State Advertisements (LSAs)**
describing its own links, so *every* router builds an identical, complete **map** of the
topology (the link-state database). Each then independently runs **Dijkstra's SPF**
algorithm to compute shortest paths. Faster convergence, loop-free by construction,
scales via **areas**, but uses more CPU/memory and is more complex.
- **OSPF** (OSPFv2, RFC 2328; OSPFv3 for IPv6, RFC 5340): metric = **cost** (inversely
  related to bandwidth), hierarchical **areas** with a backbone **area 0**.

| | Distance-vector (RIP) | Link-state (OSPF) |
|---|---|---|
| What each router knows | Neighbor distances only | Full topology map |
| Algorithm | Bellman-Ford | Dijkstra (SPF) |
| Convergence | Slow | Fast |
| Loop risk | Higher (count-to-infinity) | Low (consistent map) |
| Resource use | Low | Higher CPU/memory |
| Scaling tool | — | Areas |

## BGP and the internet

**BGP-4** (RFC 4271) is the path-vector protocol that glues the ~100k+ autonomous systems
of the internet together. Key facts interviewers want:

- Runs over **TCP port 179** (reliable, ordered — BGP does not reinvent transport).
- It is a **path-vector** protocol: routes carry the full **AS_PATH** (the list of ASes to
  traverse). This makes loop detection trivial (an AS rejects any route already containing
  its own ASN) and encodes policy.
- It advertises **reachability of prefixes**, not link metrics. Best-path selection is a
  long ordered tie-break list, but the headline knobs are **LOCAL_PREF** (highest wins,
  chosen by *you* for outbound policy), then **shortest AS_PATH**, then MED, etc.
- BGP is **policy-driven, not shortest-path**. Whether traffic takes a path is governed by
  business relationships (customer/provider/peer), not raw hop count.

> [!WARNING]
> Because trust in BGP is largely implicit, a misconfigured or malicious AS announcing
> prefixes it does not own causes **BGP hijacking** / route leaks (e.g. traffic to a
> prefix gets pulled to the wrong AS). **RPKI** (Route Origin Validation) is the current
> mitigation, validating that an AS is authorized to originate a prefix. Bringing up RPKI
> in an interview signals modern awareness.

## Default gateway

A host's **default gateway** is the router it sends packets to when the destination is
**not on its own subnet**. Mechanically it is just the next hop for the `0.0.0.0/0`
default route in the host's routing table.

The host's decision, per outbound packet:

1. Compute whether the destination IP is **in my local subnet** (dest AND mask == my
   network). If yes → deliver directly on the LAN (ARP for the destination's own MAC,
   send).
2. If not local → send to the **default gateway**: ARP for the *gateway's* MAC, put that
   MAC as L2 destination but keep the *final* destination IP as L3 destination.

So even for a remote destination, the **L2 frame** is addressed to the gateway's MAC while
the **L3 packet** still carries the ultimate destination IP. The gateway then routes it
onward. Hosts typically learn the gateway via **DHCP** (option 3). A wrong/unreachable
default gateway is the classic "I can ping local machines but not the internet" symptom.

> [!TIP]
> "Local vs remote" is decided purely by the subnet mask, so a wrong mask can make a host
> think a remote host is local (never sends to gateway) or a local host is remote
> (uselessly sends to gateway). This is why mask mistakes cause weird one-way reachability.

## TTL and ICMP (echo, time-exceeded, unreachable)

**TTL (Time To Live)** is an 8-bit IPv4 header field (0–255), renamed **Hop Limit** in
IPv6. Despite the name it counts **hops, not time**: **every router decrements it by 1**.
When a router decrements TTL to **0**, it **discards** the packet and sends an **ICMP Time
Exceeded (Type 11)** message back to the source. This prevents packets from looping
forever in a routing loop.

**ICMP** (RFC 792 for IPv4; ICMPv6 in RFC 4443) is the control/error-signaling protocol
riding directly on IP (protocol number 1 for ICMP, 58 for ICMPv6). Key messages:

| ICMP message | Type (IPv4) | Meaning |
|---|---|---|
| Echo Request / Reply | 8 / 0 | the basis of **ping** — is the host alive & RTT |
| Time Exceeded | 11 | TTL hit 0 in transit (code 0), or fragment reassembly timeout (code 1) |
| Destination Unreachable | 3 | no route (code 0), host unreachable (1), port unreachable (3), frag needed/DF set (4) |

**How ping works:** sender emits ICMP Echo Request; target replies with Echo Reply;
round-trip time and loss are measured.

**How traceroute works (the classic trick):** send packets with **deliberately increasing
TTL** — TTL=1 first. The first router decrements it to 0 and returns an ICMP Time Exceeded,
revealing hop 1. TTL=2 reveals hop 2, and so on, until the destination is reached (which
replies with Echo Reply, or Port Unreachable for the UDP-probe variant). Each hop is thus
discovered by *forcing* it to expire the packet.

> [!WARNING]
> **Path MTU Discovery** relies on ICMP Type 3 Code 4 ("fragmentation needed but DF set").
> Overzealous firewalls that blanket-drop ICMP break PMTUD, causing large packets to
> silently vanish — the notorious "small pings work, big transfers hang" **PMTUD black
> hole.** Don't fully block ICMP.

## NAT and PAT: source translation and port mapping

**NAT (Network Address Translation)** rewrites IP addresses (and, for PAT, ports) in
packet headers as they cross a boundary — classically between a **private** network
(RFC 1918 space: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and the **public**
internet. It was standardized to combat IPv4 address exhaustion (RFC 1631, obsoleted by
RFC 3022; terminology in RFC 2663).

- **Basic NAT** maps one private IP ↔ one public IP (1:1). Rare today.
- **NAPT / PAT (Port Address Translation, a.k.a. "NAT overload"):** maps **many** private
  IPs to **one** public IP by also rewriting the **source port**. This is what home and
  most enterprise routers do. "PAT" is the common (Cisco-popularized) name; the RFCs call
  it NAPT.

**Source NAT walk-through (PAT):** host `192.168.1.10:51000` sends to `93.184.216.34:443`.
The NAT box rewrites the **source** to its public IP `203.0.113.5` and an allocated port,
say `:60000`, and records a translation entry:

```
inside 192.168.1.10:51000  <->  outside 203.0.113.5:60000   (dst 93.184.216.34:443, proto TCP)
```

The reply comes back to `203.0.113.5:60000`; NAT looks up the table and rewrites the
**destination** back to `192.168.1.10:51000`. The port is the demultiplexing key that lets
one public IP serve thousands of concurrent inside flows.

> [!TIP]
> ICMP has no ports. PAT therefore tracks the **ICMP Query Identifier** field (in Echo
> Request/Reply) as the demultiplexing key instead of a port — which is how multiple inside
> hosts can `ping` through one shared public IP.

Directionality:
- **SNAT (source NAT):** rewrites the source — the outbound-initiated case above; lets
  inside hosts reach out.
- **DNAT (destination NAT) / port forwarding:** rewrites the destination — lets outside
  clients reach a specific inside server by mapping a public IP:port to a private one.

## Why NAT breaks end-to-end connectivity

The internet's original **end-to-end principle** assumed every host has a unique, globally
routable address and any host can directly address any other. NAT violates this: inside
hosts have **no globally reachable address**, and the NAT only holds state for flows the
inside *initiated*. Consequences:

- **No unsolicited inbound.** An outside host cannot open a connection to an inside host
  unless an explicit **port-forward (DNAT)** or **UPnP/PCP** mapping exists — this is why
  peer-to-peer, VoIP, and gaming need help.
- **Embedded-address protocols break.** Protocols that put IP/port *inside the payload*
  (classic **FTP** PORT command, **SIP**, **H.323**, some RTP signaling) send the *private*
  address, which is meaningless outside. NAT must run an **ALG** (Application Layer
  Gateway) to deep-inspect and rewrite the payload — fragile and often buggy.
- **IPsec AH breaks; ESP needs NAT-T.** AH authenticates the IP header (which NAT mutates),
  so it fails; ESP needs **NAT-Traversal** (UDP 4500 encapsulation) to survive.
- **Identity/logging ambiguity.** Many users share one public IP (**CGNAT**, carrier-grade
  NAT), complicating abuse attribution, geolocation, and per-user rate limiting.

NAT traversal techniques answer these: **STUN** (discover your public mapping), **TURN**
(relay when direct fails), and **ICE** (try candidates in order) — the stack WebRTC uses.
**PCP/UPnP-IGD** let an inside host request a mapping. IPv6's huge address space is the
"real" fix — it removes the *need* for NAT, though firewalls still restrict inbound.

> [!INTERVIEW]
> A strong answer connects the dots: "NAT conserved IPv4 addresses but broke the
> end-to-end model — no inbound reachability, payload-embedded addresses need ALGs, and
> that whole mess (STUN/TURN/ICE, PCP) exists to punch back through it. IPv6 removes the
> address-scarcity reason for NAT entirely."

## NAT hairpinning (NAT loopback)

**Hairpinning** (a.k.a. **NAT loopback**) is when an inside host reaches *another inside
host* (or itself) using the **public** IP/port of the service, rather than its private
address. The packet goes to the NAT, gets "bent back" (like a hairpin) toward the inside,
and must have **both** its destination *and* its source translated.

Scenario: inside web server `192.168.1.20` is published on public `203.0.113.5:80`
(a DNAT/port-forward). Inside client `192.168.1.10` tries to reach `203.0.113.5:80`
(e.g. using the same public hostname external users use). For this to work the NAT must:

1. **DNAT** the destination `203.0.113.5:80` → `192.168.1.20:80`, and
2. also **SNAT** the source `192.168.1.10` → the NAT's inside address, so the server's
   reply goes *back through the NAT* rather than directly to the client.

Why step 2 matters: without source translation, the server would reply **directly** to
`192.168.1.10` (same subnet) with a source of `192.168.1.20`. But the client sent to
`203.0.113.5` and expects the reply *from* `203.0.113.5` — the mismatched source is
dropped. Translating the source forces the return path back through the hairpin so the
addresses line up.

> [!WARNING]
> Not all NAT devices support hairpinning (RFC 4787 requires it for good UDP behavior, but
> support varies). When it is missing, the classic symptom is "our site works from
> outside and from other LANs, but not from inside our own office using the public
> domain name" — often worked around with **split-horizon DNS** that hands inside clients
> the private IP directly.

## Common follow-up questions

- **What's the difference between the routing table and the forwarding table (RIB vs
  FIB)?** RIB = all routes learned by all protocols (control plane); FIB = the pruned,
  hardware-optimized best-path table used per packet (data plane).
- **Two routes match a destination — how is the winner chosen?** Longest prefix first;
  ties broken by administrative distance/preference between protocols, then by metric
  within a protocol, then ECMP if still equal.
- **Why can't RIP scale?** 15-hop diameter, slow (timer-based, count-to-infinity)
  convergence, and periodic full-table broadcasts.
- **Why does BGP run over TCP?** It needs reliable, ordered delivery of incremental
  updates without reimplementing transport; TCP 179.
- **Does the destination IP change hop by hop?** No — the L3 destination IP is constant
  end-to-end (unless NAT rewrites it); the L2 MAC addresses change every hop, and TTL
  decrements every hop.
- **How does traceroute use TTL?** It sends probes with TTL 1, 2, 3… so each successive
  router expires one and returns ICMP Time Exceeded, revealing the path.
- **Why do we still see NAT if IPv6 exists?** IPv4 exhaustion and slow IPv6 adoption; NAT
  also gives a crude "default deny inbound" that some operators like. IPv6 removes the
  address-scarcity reason but not firewalling.
- **What breaks behind NAT and how is it fixed?** Unsolicited inbound (port-forward/PCP),
  payload-embedded addresses (ALGs), IPsec (NAT-T), P2P (STUN/TURN/ICE).
- **What is CGNAT and why is it controversial?** Carrier-grade NAT shares one public IP
  across many subscribers; it worsens the end-to-end problems and complicates abuse
  attribution and per-user rate limiting.

## References

- RFC 9293 — *Transmission Control Protocol* (current TCP spec; BGP transport)
- RFC 791 / RFC 8200 — *Internet Protocol* v4 / IPv6 (TTL / Hop Limit, header fields)
- RFC 792 — *Internet Control Message Protocol* (ICMP: echo, time exceeded, unreachable)
- RFC 4443 — *ICMPv6*
- RFC 4632 — *CIDR: The Internet Address Assignment and Aggregation Plan* (LPM, prefixes)
- RFC 2328 — *OSPF Version 2*; RFC 5340 — *OSPFv3 for IPv6*
- RFC 2453 — *RIP Version 2*
- RFC 4271 — *A Border Gateway Protocol 4 (BGP-4)*
- RFC 4786 / RFC 6811 — BGP anycast / *BGP Prefix Origin Validation (RPKI ROV)*
- RFC 1918 — *Address Allocation for Private Internets*
- RFC 1631 (obsoleted by) RFC 3022 — *Traditional IP NAT (NAT/NAPT)*
- RFC 2663 — *IP NAT Terminology and Considerations*
- RFC 4787 — *NAT Behavioral Requirements for UDP* (mapping/filtering terms, hairpinning)
- RFC 5382 — *NAT Behavioral Requirements for TCP*
- RFC 5389 / RFC 8656 / RFC 8445 — *STUN* / *TURN* / *ICE* (NAT traversal)
- RFC 6887 — *Port Control Protocol (PCP)*
