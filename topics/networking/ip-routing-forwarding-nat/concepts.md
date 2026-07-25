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
  updates sent every 30s — **RIPv2 multicasts to `224.0.0.9`** (only legacy RIPv1 broadcasts).
  Obsolete for anything nontrivial due to that tiny diameter and slow convergence.

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

## NAT type taxonomy: cone vs symmetric (RFC 4787)

The classic "four NAT types" (from the old STUN spec RFC 3489) describe how a NAT treats
inbound packets relative to a mapping it created for an outbound flow:

- **Full-cone:** once inside `A:a` maps to public `X:x`, *any* external host can reach
  `A:a` by sending to `X:x`. Mapping is reusable; filtering is open.
- **(Address-)restricted-cone:** external host may reach `X:x` only if `A:a` first sent to
  *that host's IP* (any port).
- **Port-restricted-cone:** external host may reach `X:x` only if `A:a` first sent to that
  host's *IP **and** port*.
- **Symmetric:** the NAT allocates a **different public port per destination tuple**, so
  `A:a → dst1` and `A:a → dst2` get *different* external ports. Only the exact destination
  that saw the mapping can reply.

> [!WARNING]
> RFC 4787 **deliberately deprecated** the cone/symmetric vocabulary as "inadequate" and
> replaced it with two orthogonal axes. Strong candidates use the modern framing:
> - **Mapping behavior (§4.1):** Endpoint-Independent Mapping (EIM — same external port
>   regardless of destination), Address-Dependent Mapping, or Address-and-Port-Dependent
>   Mapping. "Symmetric" = address-and-port-dependent mapping.
> - **Filtering behavior (§5):** Endpoint-Independent, Address-Dependent, or
>   Address-and-Port-Dependent Filtering.
> **REQ-1** says a NAT MUST use Endpoint-Independent Mapping. **REQ-9/9a** says it MUST
> support hairpinning. A NAT can have EIM but strict (address-and-port-dependent) filtering
> — that still allows hole punching, whereas address-and-port-dependent *mapping*
> (symmetric) is the case that defeats it.

Why it matters: symmetric NAT breaks the assumption STUN relies on (that the port you
learned for one destination is the port a peer can use), forcing a TURN relay. This is the
single most-probed NAT distinction in P2P/WebRTC/VoIP interviews.

## NAT traversal: STUN, TURN, ICE, and UDP hole punching

The named tools in "why NAT breaks E2E" have precise mechanics:

- **STUN** (RFC 8489, obsoletes 5389): the client sends a **Binding Request** to a STUN
  server; the server copies the packet's observed source into a **XOR-MAPPED-ADDRESS**
  attribute and reflects it back. That is the client's **server-reflexive (srflx)**
  candidate — its public IP:port *as seen from outside*. STUN only *tells you* your mapping;
  it does not relay data.
- **UDP hole punching:** the actual traversal trick. Both peers learn each other's srflx
  candidates (via a signaling channel), then **send outbound packets to each other
  simultaneously**. The first outbound packet opens the local NAT's filter state so the
  peer's inbound packet is accepted. This works when both NATs use **endpoint-independent
  mapping**; it **fails if either side is symmetric**, because the port the peer was told
  is not the port the NAT will use toward that peer.
- **TURN** (RFC 8656): a **relay** of last resort. The client allocates an address on the
  TURN server and both peers send through it. Always works (it is just a client-initiated
  outbound flow to the relay) but adds latency, cost, and a bottleneck — hence "relay only
  when hole punching fails."
- **ICE** (RFC 8445): the orchestration. Each side **gathers candidates** (host,
  server-reflexive via STUN, relayed via TURN), exchanges them, forms **candidate pairs**,
  and runs **connectivity checks** (STUN Binding requests over each pair) to find the
  best working pair, preferring host > srflx > relay.

> [!INTERVIEW]
> "Which NAT combination makes direct hole punching impossible?" → **either peer behind a
> symmetric (address-and-port-dependent-mapping) NAT.** Answer with the RFC 4787 mapping
> axis, then say the fallback is a TURN relay.

## PAT port exhaustion and CGNAT

A single public IPv4 address has only **~64K TCP and ~64K UDP source ports** to hand out.
How far that stretches depends on the mapping model:

- With **endpoint-independent mapping** the NAT reuses one external port across many
  destinations, so the limit is roughly 64K *concurrent flows per public IP per protocol*.
- With **per-destination (symmetric) mapping** each new destination consumes a fresh port,
  exhausting far faster.

**CGNAT** (RFC 6888 requirements; **RFC 6598** defines the `100.64.0.0/10` shared address
space) stacks a carrier NAT on top of subscriber NATs, so thousands of subscribers share a
pool of public IPs — dramatically amplifying exhaustion pressure. Mitigations:

- **Port-block allocation (PBA, RFC 7422):** pre-assign each subscriber a contiguous block
  of ports so the carrier logs one line per *block*, not per flow — critical for logging
  scale and legal attribution.
- Tuning **NAT idle timeouts** (RFC 5382 recommends TCP idle ≥ 2 h 4 min for established,
  UDP ≥ 5 min) to reclaim stale mappings.

> [!WARNING]
> Symptom of exhaustion: **new connections fail even though bandwidth is fine and there is
> no packet loss** — the NAT can't allocate a port/mapping. The **NAT state table** is also
> a finite resource and a DoS target: a flood of tiny flows can fill it, denying service to
> legitimate users. This is distinct from link congestion and points at PAT/CGNAT limits.

## BGP best-path selection and attributes

The full ordered tie-break ladder (common vendor implementation of RFC 4271 decision
process) — memorize the order, not just LOCAL_PREF/AS_PATH/MED:

1. **Weight** (vendor-local, not advertised) — highest wins.
2. **LOCAL_PREF** — highest wins (your AS's *outbound* preference; iBGP-only).
3. **Locally originated** (network/redistribute/aggregate) preferred.
4. **Shortest AS_PATH.**
5. **Lowest ORIGIN** (IGP `i` < EGP `e` < Incomplete `?`).
6. **Lowest MED** (only compared among paths from the *same neighbor AS*).
7. **eBGP over iBGP.**
8. **Lowest IGP metric to the BGP NEXT_HOP.**
9. **Oldest eBGP route** (stability).
10. **Lowest Router-ID**, then lowest neighbor IP.

**Attribute categories:**

| Category | Attributes | Property |
|---|---|---|
| Well-known mandatory | ORIGIN, AS_PATH, NEXT_HOP | every BGP router must recognize; in every update |
| Well-known discretionary | LOCAL_PREF, ATOMIC_AGGREGATE | recognized by all; optional to send |
| Optional transitive | COMMUNITIES (RFC 1997), AGGREGATOR | pass through unknown routers with partial flag |
| Optional non-transitive | MED (RFC 4451) | dropped by routers that don't recognize it |

> [!INTERVIEW]
> Direction is the classic trap: **LOCAL_PREF steers *outbound* traffic** (you tell your own
> routers which exit to prefer; propagated only inside your AS via iBGP). **MED is a *hint*
> to a neighbor AS about which of your links it should use for *inbound*** traffic — but the
> neighbor may ignore it. Reliable *inbound* engineering usually needs **AS_PATH prepending**
> or advertising **more-specific prefixes** on the preferred link; you fundamentally cannot
> *force* how others route toward you.

## iBGP scaling: route reflectors and confederations

iBGP has a **loop-prevention rule**: a router must **not re-advertise an iBGP-learned route
to another iBGP peer** (AS_PATH doesn't grow inside the AS, so it can't catch loops). The
consequence is a required **full mesh** of iBGP sessions — `n(n-1)/2` sessions for `n`
routers, which explodes with size. Two fixes:

- **Route reflectors (RFC 4456):** a designated RR is allowed to reflect routes between
  iBGP peers. Its clients form sessions only with the RR, cutting the mesh. Loop prevention
  moves to two new attributes: **ORIGINATOR_ID** (the router that first injected the route —
  drop if it's you) and **CLUSTER_LIST** (list of RR clusters traversed — drop if your
  cluster appears). Reflection rules: a route from a client is reflected to all peers; from
  a non-client, only to clients.
- **Confederations (RFC 5065):** split the AS into **sub-ASes** that run eBGP-like sessions
  among themselves (using a confederation AS_PATH segment) while appearing as one AS
  externally.

Two more iBGP gotchas interviewers use:

- **NEXT_HOP handling:** eBGP-learned routes carry the *external* next hop unchanged into
  iBGP. If internal routers have no route to that external next hop the path is unusable —
  fixed with **next-hop-self** on the border router.
- **Synchronization** (legacy, now default-off): the old rule that iBGP wouldn't use a route
  until the IGP also knew it, to avoid blackholing across non-BGP routers.

## OSPF internals: LSA types, areas, DR/BDR, adjacency

OSPFv2 (RFC 2328; OSPFv3 RFC 5340) runs **directly on IP protocol 89** — not TCP/UDP —
using multicast `224.0.0.5` (AllSPFRouters) and `224.0.0.6` (AllDRouters).

**LSA types (the flooding vocabulary):**

| Type | Name | Scope/meaning |
|---|---|---|
| 1 | Router LSA | a router's own links, flooded within its area |
| 2 | Network LSA | generated by the DR for a multi-access segment |
| 3 | Summary LSA | inter-area prefixes, injected by an ABR |
| 4 | ASBR-Summary LSA | how to reach an ASBR, injected by an ABR |
| 5 | AS-External LSA | routes redistributed from outside OSPF (by ASBR) |
| 7 | NSSA-External LSA | external routes inside a Not-So-Stubby Area (translated to Type 5 at the ABR) |

**Area types:** backbone (**area 0**, all others must touch it), **stub** (blocks Type 5,
uses default), **totally stubby** (blocks Type 3 and 5), **NSSA** (allows local externals as
Type 7 while otherwise stub-like).

**DR/BDR election:** on a multi-access (broadcast) segment, forming a full mesh of
adjacencies would be `O(n²)`. OSPF elects a **Designated Router** (and Backup) that every
other router adjoins, so LSAs are exchanged through the DR. Election is by highest **OSPF
priority**, tie-broken by highest **Router-ID**; it is **non-preemptive** (a higher-priority
router joining later does not take over).

**Neighbor state machine:** Down → Init → **2-Way** (bidirectional Hello seen; DR/BDR
elected here) → ExStart → Exchange (DBD packets) → Loading (LSRs) → **Full** (databases
synced). Hello/Dead timers (default 10 s / 40 s on broadcast links) detect failure.
**Cost = reference-bandwidth ÷ interface-bandwidth** (default reference 100 Mbps, so it must
be raised on ≥ 1 Gbps links or fast links tie at cost 1).

## Convergence and fast reroute (BFD, LFA, BGP PIC)

"How fast does the network heal, and why?" is a staple senior question. Convergence has
distinct phases: **detect** the failure → **flood/propagate** → **recompute** (SPF or
best-path) → **install** into the FIB.

- **Detection** is usually the slow part. Protocol Hello/Dead timers are coarse (OSPF 40 s
  default). **BFD (RFC 5880)** is a lightweight hello protocol that both sides run to detect
  liveness in **milliseconds**, then signals the routing protocol — decoupling failure
  detection from protocol timers.
- **SPF/LSA throttling:** link-state protocols rate-limit LSA generation and SPF runs
  (exponential backoff) so a flapping link doesn't melt every CPU. This trades a little
  convergence latency for stability.
- **Precomputed backups** avoid recomputation entirely: **Loop-Free Alternates (LFA) /
  remote-LFA** install a backup next hop in advance; **BGP PIC (Prefix-Independent
  Convergence)** lets a single next-hop update reroute many prefixes at once instead of
  touching each prefix.
- **BGP** converges slowly by design: the **MRAI timer** (Minimum Route Advertisement
  Interval, ~30 s eBGP) rate-limits updates, and **route flap damping (RFC 2439)** suppresses
  repeatedly-flapping prefixes — now largely **deprecated/relaxed** (RIPE) because it
  over-penalized normal path exploration.

## ECMP, hashing, and polarization

**Equal-cost multipath** spreads traffic over several equal-cost next hops. The critical
design rule: hash a **per-flow key** (typically the 5-tuple: src/dst IP, src/dst port,
protocol) to pick the path, so **all packets of one TCP flow take the same path** and never
reorder (reordering is misread as loss and kills throughput).

Failure modes and fixes:

- **Hash polarization:** if every tier of a Clos/leaf-spine fabric uses the *same* hash
  function and inputs, downstream stages make correlated decisions and some links get no
  traffic. Fix: **per-device hash seed/salt** so each tier decorrelates.
- **Elephant flows / low entropy:** a few huge flows (or few distinct 5-tuples) hash
  unevenly, so one link can carry the majority of bytes even with 4 equal paths. Fixes:
  **flowlet switching** (rebalance at gaps in a flow), better entropy sources, or
  **consistent/resilient hashing** so adding/removing a member remaps *minimal* flows
  instead of reshuffling all of them.
- Relation to L2: **LAG/LACP** is the link-layer analogue (hash across bundle members).
  **Unequal-cost** load balancing exists too (EIGRP `variance`, BGP multipath with relaxed
  attributes).

## Reverse path forwarding (RPF and uRPF)

RPF means two different things — a common precision check:

1. **Multicast RPF check:** a router accepts a multicast packet **only if it arrived on the
   interface the unicast route back toward the source would use**. This builds loop-free
   distribution trees (PIM) and prevents multicast packets from looping or duplicating on a
   LAN.
2. **Unicast RPF (uRPF, RFC 3704 / BCP 84; ingress filtering is BCP 38):** an *anti-spoofing*
   control. Modes:
   - **Strict:** drop if the source's best return route doesn't point out the interface the
     packet arrived on. Strongest, but **breaks under asymmetric routing** (legitimate
     traffic arriving on a non-return path is dropped — a real false positive).
   - **Loose:** accept as long as the source exists *somewhere* in the FIB (not tied to
     ingress interface) — survives asymmetry but catches far less spoofing.
   - **Feasible-path:** like strict but considers *all* advertised paths (alternate routes),
     a middle ground for multihomed edges.

> [!INTERVIEW]
> "Design a stateless anti-spoofing filter and give a false positive." → uRPF strict per
> BCP 38; false positive = a multihomed customer with **asymmetric routing** whose return
> path differs from the ingress link, dropped by strict mode → relax to feasible-path or
> loose.

## IP fragmentation and header mechanics

IPv4 fragmentation uses three header fields: **Identification** (shared by all fragments of
one datagram), **Flags** (`DF` = Don't Fragment, `MF` = More Fragments), and **Fragment
Offset** (in 8-byte units). Key facts:

- **Reassembly happens only at the final destination**, never at intermediate routers —
  fragments can take different paths and arrive out of order.
- Fragmentation is harmful: **loss amplification** (losing one fragment discards the whole
  datagram), reassembly buffer pressure, and **firewall/IDS evasion** (overlapping
  fragments). PMTUD exists precisely to avoid it.
- **IPv6 forbids router fragmentation entirely.** A router that can't fit a packet drops it
  and returns **ICMPv6 Packet Too Big (Type 2)** with the MTU; only the *source* may
  fragment (via a Fragment extension header). PMTUD is therefore **mandatory** in IPv6
  (RFC 8201).
- **Minimum MTU:** **1280 bytes in IPv6** (links must support it), **68 bytes in IPv4**
  (minimum a host must be able to reassemble is 576).

## LPM data structures and FIB scale

Longest-prefix match must run at line rate for hundreds of thousands of prefixes. Common
implementations:

- **Binary/PATRICIA (radix) trie:** compressed prefix tree; simple but multiple memory
  accesses per lookup.
- **Multibit / LC-trie / DIR-24-8:** trade memory for speed by examining several bits per
  step; DIR-24-8 uses a 2^24 first-level table so most lookups are a single memory access.
- **TCAM (Ternary CAM):** hardware that matches all entries in parallel using mask ("don't
  care") bits; entries must be **ordered by prefix length** so the longest match is returned.
  TCAM is fast but power-hungry and **finite** — the constraint behind FIB-scale incidents.

> [!INTERVIEW]
> "Why did the internet break for many networks in **August 2014**?" → the global IPv4 BGP
> table crossed **512K routes**, overflowing the default TCAM FIB partition on widely
> deployed routers (e.g. older Catalyst 6500 / 7600 with a 512K IPv4 default). Routes spilled
> to software or were dropped, causing loss and instability until operators re-partitioned
> TCAM. Great signal of FIB-scale awareness. IPv6 at **/128** granularity makes efficient LPM
> even harder.

## Policy-based routing and VRF

Ordinary forwarding is **destination-only** LPM. Two mechanisms break or partition that:

- **Policy-based routing (PBR):** override the routing table using *other* packet fields —
  source IP, DSCP/ToS, protocol, or port — e.g. route guest-VLAN traffic out a cheap link
  and finance traffic out a premium link, or implement **source-based routing** for
  multi-WAN/multihoming. PBR is evaluated before the normal FIB lookup.
- **VRF (Virtual Routing and Forwarding):** multiple **independent routing tables** on one
  physical device, each with its own FIB. Interfaces are bound to a VRF, so overlapping
  address space (two tenants both using `10.0.0.0/8`) can't collide. VRFs underpin
  **multi-tenant** networks and **MPLS L3VPNs**; controlled sharing between them is
  **route leaking**.

## Anycast routing

**Anycast** advertises the **same prefix/address from many locations**; ordinary
BGP/IGP LPM then routes each client to the **topologically nearest** instance. No special
protocol is needed — it's a *deployment* of normal routing.

- Powers **DNS root servers**, public resolvers (**1.1.1.1**, **8.8.8.8**), and CDN edges.
- **Failover** is implicit: if an instance withdraws its route, traffic reconverges to the
  next-nearest — usually within routing convergence time.
- **TCP-anycast caveat:** because a routing change mid-connection can steer packets to a
  *different* instance that has no state for the flow, long-lived stateful sessions can
  break. In practice modern anycast TCP works because routes are stable and instances are
  well-provisioned, but it is why anycast historically favored short UDP transactions (DNS).

## ICMP types and codes in depth

Precise codes separate seniors from juniors:

- **Destination Unreachable (Type 3):** code **0** net, **1** host, **3** port, **4**
  fragmentation-needed-and-DF-set (the **PMTUD signal — carries the Next-Hop MTU** in the
  message), **9/10** admin-prohibited, **13** administratively filtered.
- **Time Exceeded (Type 11):** code **0** = TTL/hop-limit reached 0 in transit (traceroute);
  code **1** = fragment reassembly timeout.
- **Redirect (Type 5):** a router telling a host a better first hop — a **security risk**
  (can be abused to reroute traffic), so often disabled.
- **ICMPv6 (RFC 4443):** **Packet Too Big = Type 2** (the v6 PMTUD signal); **Neighbor
  Discovery** (RS/RA/NS/NA = Types 133–136) rides on ICMPv6, so blanket-blocking ICMPv6
  breaks address resolution and autoconfig, not just diagnostics.
- Every ICMP error carries the **IP header + first 8 bytes** of the offending packet — just
  enough for the source to see the protocol and port and match the error to the right socket.

## TTL fingerprinting and GTSM

- **Initial-TTL fingerprinting:** common defaults are **64** (Linux/macOS/most Unix), **128**
  (Windows), **255** (many network devices). Since routers only decrement, the *received*
  TTL reveals both a hop-count estimate and a hint at the sender's OS.
- **GTSM — Generalized TTL Security Mechanism (RFC 5082):** protect a directly-connected
  protocol session (eBGP, OSPF) by **sending with TTL 255 and accepting only packets with
  TTL ≥ 254**. Since a spoofed packet from more than one hop away arrives with a lower TTL,
  off-path attackers can't inject — a cheap anti-spoofing guard for control-plane peers.
- **Asymmetric paths and `* * *`:** traceroute shows different forward/return paths because
  routing is directional, and shows `* * *` when a hop **rate-limits or filters ICMP**
  (many routers deprioritize control-plane ICMP generation).

## Traceroute variants and pitfalls

- **UDP-probe (classic Unix):** sends UDP to high, unlikely destination ports; the final host
  returns **Destination Unreachable / Port Unreachable (Type 3 Code 3)** to end the trace.
- **ICMP-Echo (Windows `tracert`):** uses Echo Requests with increasing TTL; the target's
  Echo Reply ends it.
- **TCP-SYN traceroute:** probes to port **80/443** to slip through firewalls that drop
  UDP/ICMP; a SYN-ACK or RST ends it.
- **Distortions:** **ECMP** makes classic traceroute show phantom/alternating hops because
  each probe (different port → different hash) takes a different path — **Paris-traceroute**
  fixes this by holding the flow key constant. **MPLS** clouds may hide hops or expose them
  via **ICMP extensions (RFC 4950)**; **anycast** can make one "hop" resolve to different
  physical sites.

## Administrative distance and route preference

When two *different protocols* offer the same prefix, routers pick by **administrative
distance (AD)** — lowest wins. Typical (vendor) defaults:

| Source | AD |
|---|---|
| Connected | 0 |
| Static | 1 |
| eBGP | 20 |
| EIGRP (internal) | 90 |
| OSPF | 110 |
| IS-IS | 115 |
| RIP | 120 |
| iBGP | 200 |
| Unknown/unusable | 255 |

> [!WARNING]
> These numbers are **vendor conventions, not an internet standard** — quote them as "Cisco
> defaults" and speak vendor-neutrally about **route preference / origin preference**
> otherwise. The two-stage rule: **AD chooses *between* protocols; the metric chooses
> *within* a protocol.** Note eBGP (20) is trusted over OSPF, but iBGP (200) is trusted less
> than any IGP.

## BGP security: RPKI, BGPsec, and famous incidents

Beyond RPKI origin validation (already covered), seniors should know the layers:

- **Prefix filters / max-prefix limits / IRR:** the first line of defense — filter what a
  peer may announce, cap the count, and validate against Internet Routing Registry objects.
- **RPKI ROV (RFC 6480/6811):** validates only the **origin AS** of a prefix (via signed
  ROAs). It does **not** verify the rest of the AS_PATH.
- **BGPsec (RFC 8205):** cryptographically validates the **entire AS_PATH** (each AS signs).
  Far stronger but heavy and barely deployed.
- **RPKI-to-Router (RTR) protocol:** how routers fetch validated prefix-origin data from a
  local validator cache.
- **AS_PATH prepending:** a traffic-engineering trick — advertise your own ASN multiple times
  to make a path *look* longer and less preferred for inbound traffic.
- **Incidents as scenario fodder:** **Pakistan Telecom / YouTube (2008)** — a more-specific
  hijack blackholed YouTube globally; **Facebook (Oct 2021)** — a *self-inflicted* BGP
  withdrawal took its prefixes off the internet (also breaking its own DNS and remote
  access). Both illustrate LPM (more-specific wins) and the fragility of implicit trust.

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
- RFC 4787 — *NAT Behavioral Requirements for UDP* (mapping/filtering axes, REQ-1/REQ-9, hairpinning)
- RFC 5382 — *NAT Behavioral Requirements for TCP* (idle-timeout guidance)
- RFC 6888 — *Common Requirements for Carrier-Grade NATs (CGN)*
- RFC 6598 — *IANA-Reserved IPv4 Prefix for Shared Address Space* (`100.64.0.0/10`)
- RFC 7422 — *Deterministic Address Mapping to Reduce Logging in CGN* (port-block allocation)
- RFC 8489 (obsoletes RFC 5389) — *STUN*; RFC 8656 — *TURN*; RFC 8445 — *ICE*
- RFC 6887 — *Port Control Protocol (PCP)*
- RFC 4456 — *BGP Route Reflection*; RFC 5065 — *BGP Confederations*; RFC 4451 — *BGP MED*; RFC 1997 — *BGP Communities*
- RFC 6480 / RFC 6811 — *RPKI* / *BGP Prefix Origin Validation (ROV)*; RFC 8205 — *BGPsec*
- RFC 5880 — *Bidirectional Forwarding Detection (BFD)*; RFC 2439 — *BGP Route Flap Damping*
- RFC 3704 / BCP 84 — *Ingress Filtering for Multihomed Networks (uRPF)*; BCP 38 — *Network Ingress Filtering*
- RFC 5082 — *The Generalized TTL Security Mechanism (GTSM)*
- RFC 8201 — *Path MTU Discovery for IPv6*
- RFC 4950 — *ICMP Extensions for MPLS*
