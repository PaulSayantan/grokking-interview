# IP Addressing & Subnetting

IP addressing is how the network layer names every interface on an internetwork, and
subnetting is how a single address block is carved into smaller routing/broadcast domains.
Interviewers use this topic to test whether you can do binary math under pressure, reason
about routing scale, and explain *why* the design choices (CIDR, VLSM, NAT) exist. This
page is protocol/mechanics-focused and vendor-neutral.

## IPv4 addressing: 32-bit structure and dotted-decimal

An IPv4 address is a **32-bit** unsigned number. Humans write it as **dotted-decimal**:
four 8-bit *octets* (0–255) separated by dots, e.g. `192.168.10.5`. That single value is
logically split into a **network portion** (the prefix, shared by all hosts on the same
link/subnet) and a **host portion** (unique per interface within the subnet). The split
point is defined by the mask/prefix, *not* by the address itself.

Binary is the ground truth — you must be fluent converting octets:

```
192      . 168      . 10       . 5
11000000   10101000   00001010   00000101
```

The place values within an octet are `128 64 32 16 8 4 2 1`. Handy anchors:
`/24` = `255.255.255.0`, each `.255` = 8 network bits, each `.0` = 8 host bits.

> [!KEY-TAKEAWAY]
> An IPv4 address is meaningless without its mask. `10.0.0.9` could be a host in a /8,
> a /24, or a /30 — the mask decides which bits are "network" and which are "host."

Total IPv4 space is 2^32 ≈ **4.29 billion** addresses — the number whose smallness drives
the whole NAT/IPv6 story later on this page.

## Subnet masks and CIDR prefix length

The **subnet mask** marks which bits are network (1s) and which are host (0s). It is always
a *contiguous* run of 1s followed by 0s — you cannot have `255.0.255.0`. **CIDR notation**
(Classless Inter-Domain Routing, RFC 4632) writes the mask compactly as `/n`, where *n* is
the count of leading 1-bits (the **prefix length**).

| CIDR | Dotted-decimal mask | Network bits | Host bits |
|------|---------------------|--------------|-----------|
| /8   | 255.0.0.0           | 8            | 24        |
| /16  | 255.255.0.0         | 16           | 16        |
| /24  | 255.255.255.0       | 24           | 8         |
| /25  | 255.255.255.128     | 25           | 7         |
| /26  | 255.255.255.192     | 26           | 6         |
| /27  | 255.255.255.224     | 27           | 5         |
| /28  | 255.255.255.240     | 28           | 4         |
| /30  | 255.255.255.252     | 30           | 2         |

To find the mask octet for a non-byte boundary: fill 1-bits from the left. `/26` = 26 bits
= two full octets (16) + 10 more = last octet `11000000` = `192`. So `/26` = `255.255.255.192`.

> [!TIP]
> The "magic" mask octet values are the place-value cumulative sums:
> `128, 192, 224, 240, 248, 252, 254, 255`. These correspond to 1..8 network bits in an octet.

## Network address, broadcast address, and usable-host math

Within any subnet, two host values are reserved and **cannot** be assigned to an interface:

- **Network address** — all host bits set to **0**. Identifies the subnet itself.
- **Broadcast address** — all host bits set to **1**. Reaches every host on the subnet.

Everything strictly between them is a **usable host** address. The default gateway is just
one of the usable addresses (by convention often the first or last usable one).

Example: `192.168.1.0/24`
- Network: `192.168.1.0`
- Broadcast: `192.168.1.255`
- Usable range: `192.168.1.1` – `192.168.1.254` (254 hosts)

Example: `172.16.5.66/26`. Block size in the last octet = 256 − 192 = **64**, so subnets
start at .0, .64, .128, .192. `.66` falls in the `.64` subnet:
- Network: `172.16.5.64`
- Broadcast: `172.16.5.127`
- Usable: `172.16.5.65` – `172.16.5.126`

> [!WARNING]
> The network and broadcast reservation is per-subnet. When you subdivide a block, *each*
> new subnet loses its own 2 addresses — subnetting always costs usable host addresses.

## How many hosts fit in a subnet

The formulas every interviewer wants instantly:

- **Total addresses in the block** = 2^(host bits)
- **Usable hosts (IPv4)** = 2^(host bits) − **2** (subtract network + broadcast)
- **Number of equal subnets** when borrowing *b* bits = 2^b

Host bits = 32 − prefix length. Common answers to memorize:

| Prefix | Host bits | Total | Usable hosts |
|--------|-----------|-------|--------------|
| /24    | 8         | 256   | 254          |
| /25    | 7         | 128   | 126          |
| /26    | 6         | 64    | 62           |
| /27    | 5         | 32    | 30           |
| /28    | 4         | 16    | 14           |
| /29    | 3         | 8     | 6            |
| /30    | 2         | 4     | 2            |
| /31    | 1         | 2     | (2, special) |
| /32    | 0         | 1     | 1 (host route)|

So **a /26 gives 62 usable hosts** (64 − 2). Two special cases:

- **/31** (RFC 3021): 2 addresses, both usable — designed for point-to-point links where a
  network/broadcast pair is wasteful. No broadcast is used on the link.
- **/32**: a single host route (loopbacks, iBGP peers, `/32` firewall rules).

## VLSM: variable length subnet masking

**VLSM** means using *different* prefix lengths for different subnets carved from the same
parent block, sizing each subnet to its actual host count instead of forcing one uniform
mask. It is the classless technique that stopped the massive address waste of fixed-length
subnetting. Requirement: the routing protocol must carry the mask/prefix per route
(classless protocols like OSPF, EIGRP, RIPv2, BGP — not classful RIPv1/IGRP).

Method: **allocate largest subnets first**, then subdivide remaining space for smaller ones.

Example — carve `192.168.1.0/24` for: LAN-A 100 hosts, LAN-B 50 hosts, LAN-C 25 hosts,
and two point-to-point WAN links (2 hosts each):

| Subnet | Need | Prefix | Block | Range |
|--------|------|--------|-------|-------|
| LAN-A  | 100  | /25 (126) | 128 | `.0`   – `.127` |
| LAN-B  | 50   | /26 (62)  | 64  | `.128` – `.191` |
| LAN-C  | 25   | /27 (30)  | 32  | `.192` – `.223` |
| WAN-1  | 2    | /30 (2)   | 4   | `.224` – `.227` |
| WAN-2  | 2    | /30 (2)   | 4   | `.228` – `.231` |

Everything fits inside the one /24 with room to spare. Doing this with a single fixed mask
would force /25 everywhere and fail after two subnets.

> [!INTERVIEW]
> A classic whiteboard task: "subnet this /24 for these host counts." Always sort
> descending, round each requirement up to the next power of two (host+2), and lay blocks
> end to end on their natural boundaries so nothing overlaps.

## Supernetting and route aggregation

**Supernetting** (aka route aggregation/summarization) is the inverse of subnetting: combine
several contiguous smaller prefixes into one shorter prefix to shrink routing tables. This
is the core reason CIDR was introduced (RFC 1519/4632) — it lets a provider advertise one
route instead of hundreds and slowed the growth of the global BGP table.

To aggregate, the blocks must be **contiguous** and align on a boundary that is a power of
two. Example: aggregate four /24s
`192.168.0.0/24, 192.168.1.0/24, 192.168.2.0/24, 192.168.3.0/24`.

```
192.168.00000000.0   /24
192.168.00000001.0   /24
192.168.00000010.0   /24
192.168.00000011.0   /24
              ^^ these last 2 bits vary; first 22 bits are common
```

The common prefix is **22 bits**, so the summary is `192.168.0.0/22` (covers .0–.3).
You cannot summarize `192.168.1.0/24 + 192.168.2.0/24` into a single /23 — they don't share
a /23 boundary (a /23 starts on an even third-octet value: .0, .2, .4 …).

> [!WARNING]
> Over-aggregation can advertise reachability for addresses you don't actually host
> (a "black hole"). Aggregate only truly contiguous, owned space.

## Classful legacy vs classless (CIDR)

Before 1993, IPv4 used **classful** addressing where the leading bits fixed the network size:

| Class | Leading bits | First octet | Default mask | Purpose |
|-------|--------------|-------------|--------------|---------|
| A     | `0`          | 0–127       | /8           | Very large networks |
| B     | `10`         | 128–191     | /16          | Medium networks |
| C     | `110`        | 192–223     | /24          | Small networks |
| D     | `1110`       | 224–239     | (n/a)        | Multicast |
| E     | `1111`       | 240–255     | (n/a)        | Reserved/experimental |

The problem: a site needing 300 hosts got a whole Class B (65k addresses) because a Class C
(254) was too small — enormous waste, and the routing table couldn't scale. **CIDR**
abolished classes: the prefix is arbitrary and carried explicitly, enabling VLSM and
aggregation. Modern networking is entirely classless; "class" survives only as legacy
vocabulary and as defaults in some tools.

> [!KEY-TAKEAWAY]
> "Class C" is not a mask. In a classless world `192.0.2.0` can be a /24, /26, or /30 —
> the address's first octet no longer implies its prefix length.

## Private address ranges (RFC 1918)

RFC 1918 reserves three IPv4 ranges for **private** internets — reusable inside any
organization, never routed on the public Internet, and typically NAT'd at the edge:

| Range | CIDR | Size | Classful shorthand |
|-------|------|------|--------------------|
| `10.0.0.0` – `10.255.255.255`     | `10.0.0.0/8`     | ~16.7M | one Class A |
| `172.16.0.0` – `172.31.255.255`   | `172.16.0.0/12`  | ~1M    | 16 Class B |
| `192.168.0.0` – `192.168.255.255` | `192.168.0.0/16` | 65,536 | 256 Class C |

The commonly-missed one is the `172.16.0.0/12` boundary: it covers `172.16` through
`172.31` only — `172.32.x.x` is **public**, and so is `172.15.x.x`. Related: **CGNAT**
(RFC 6598) reserves `100.64.0.0/10` for carrier-grade NAT between subscriber and ISP.

## Loopback, link-local, and APIPA

Several ranges have special local meaning and are never globally routed:

- **Loopback** — `127.0.0.0/8` (almost always `127.0.0.1`, "localhost"). Traffic never
  leaves the host. The whole /8 is reserved even though one address is normally used.
- **Link-local / APIPA** — `169.254.0.0/16` (RFC 3927). A host auto-assigns an address here
  when it wants IPv4 but **no DHCP server answered**. On Windows this is branded APIPA. It
  works only on the local link (not routed) — seeing a `169.254.x.x` address is a strong
  signal that **DHCP failed**.
- **"This host on this network"** — `0.0.0.0/8` (source-only) and `0.0.0.0` as a wildcard
  "any address" / default route.
- **Documentation / test ranges** (RFC 5737) — `192.0.2.0/24`, `198.51.100.0/24`,
  `203.0.113.0/24` exist so docs and examples don't collide with real allocations.

IPv6 equivalents: loopback `::1/128`, link-local `fe80::/10` (auto-configured on every
IPv6 interface and required for neighbor discovery).

## IPv6: 128-bit addressing and notation

IPv6 (RFC 4291) uses **128-bit** addresses — 2^128 ≈ 3.4×10^38, effectively inexhaustible.
Written as **eight groups of four hex digits** (16-bit "hextets") separated by colons:

```
2001:0db8:0000:0000:0000:ff00:0042:8329
```

Two compression rules make them readable:
1. **Drop leading zeros** in each group: `0db8` → `db8`, `0000` → `0`, `0042` → `42`.
2. **`::` collapses one run of consecutive all-zero groups** — usable **at most once** per
   address (otherwise the length would be ambiguous).

So the address above compresses to `2001:db8::ff00:42:8329`. Loopback `0:0:0:0:0:0:0:1`
becomes `::1`; the unspecified address `0:0:0:0:0:0:0:0` becomes `::`.

Prefix length works exactly like CIDR (`/n` = leading network bits). The standard split:
the first **/64** is the network prefix and the last **64 bits** are the interface
identifier — a **/64 is the normal subnet size** for a LAN. ISPs typically delegate a
**/48** or **/56** to a site, which subnets into many /64s. There is **no broadcast** and
no network/broadcast reservation in IPv6 (broadcast is replaced by multicast), so a /64
isn't reduced by 2 usable addresses the IPv4 way.

> [!TIP]
> `2001:db8::/32` is the reserved **documentation** prefix (RFC 3849) — the IPv6 analogue
> of `192.0.2.0/24`. Use it in examples, never real addresses.

## IPv6 address types and special prefixes

IPv6 replaces broadcast with three delivery models and assigns purpose by prefix:

| Type / prefix | Meaning |
|---------------|---------|
| `2000::/3` (global unicast) | Public, globally routable addresses |
| `fe80::/10` (link-local) | Auto-configured, on-link only; required per interface |
| `fc00::/7` → `fd00::/8` (ULA) | Unique Local Addresses — private, RFC 4193 (≈ RFC 1918) |
| `ff00::/8` (multicast) | One-to-many; no broadcast exists in IPv6 |
| `::1/128` (loopback) | localhost |
| `::/128` (unspecified) | "no address," source during autoconfig |
| `::ffff:0:0/96` | IPv4-mapped IPv6 (e.g. `::ffff:192.0.2.1`) |

Anycast (one address, many nodes, routed to the nearest) is not a distinct prefix — any
unicast address configured on multiple nodes acts as anycast. **SLAAC** (StateLess Address
AutoConfiguration, RFC 4862) lets a host build its own global address from the router-
advertised /64 prefix plus an interface ID, often without DHCP.

## IPv4 exhaustion and NAT context

With only ~4.29 billion IPv4 addresses, the free pool ran out: IANA allocated its last five
/8 blocks to the RIRs in **February 2011**, and the regional registries exhausted their
general free pools over the following years. The stopgaps that kept IPv4 alive:

- **NAT / PAT** (Network Address (and Port) Translation) — many private RFC 1918 hosts share
  one or a few public addresses. **PAT ("NAT overload")** multiplexes on the TCP/UDP port so
  thousands of internal flows use a single public IP. This is why most home/enterprise LANs
  use private space behind one public address.
- **CIDR + VLSM** — slowed exhaustion and route-table growth (covered above).
- **CGNAT** (`100.64.0.0/10`, RFC 6598) — ISP-level NAT adding a second translation tier.

Trade-offs of NAT: it breaks the end-to-end principle, complicates inbound connections and
peer-to-peer (needing port forwarding, STUN/TURN, hole punching), and is *not* a security
feature by itself (though it incidentally hides internal addressing). The real long-term fix
is **IPv6**, whose vast space removes the need for NAT — hosts can have globally unique
addresses again, restoring end-to-end reachability (subject to firewall policy).

## Fast subnet math under time pressure

Interviewers time this. The drilled algorithm beats binary conversion every time. For any
`IP/prefix`:

1. **Find the interesting octet** — the octet the prefix "ends in": `/8,/16,/24,/32` end on
   octet 1,2,3,4; anything else lands in the octet where the prefix crosses a byte boundary
   (`/25–/32` → octet 4, `/17–/24` → octet 3, etc.).
2. **Magic number = block size = 256 − mask value of the interesting octet.** Equivalently
   `2^(8 − bits-in-that-octet)`. For `/26`, mask octet = 192, block = `256 − 192 = 64`.
3. **Network address** = round the interesting octet *down* to the nearest multiple of the
   block size. **Next network** = network + block; **broadcast** = next network − 1.
4. **First usable** = network + 1; **last usable** = broadcast − 1 (IPv4, non-/31/32).

Worked at speed — `172.16.5.66/26`: block 64 → multiples 0,64,128,192 → `.66` rounds down to
`.64` → network `172.16.5.64`, broadcast `172.16.5.127`, usable `.65–.126`.

Two-way lookups to hold **by heart** (they eliminate arithmetic mid-interview):

| /nn | mask octet | block | hosts | | /nn | mask octet | block | hosts |
|-----|-----------|-------|-------|-|-----|-----------|-------|-------|
| /25 | 128 | 128 | 126 | | /29 | 248 | 8 | 6 |
| /26 | 192 | 64  | 62  | | /30 | 252 | 4 | 2 |
| /27 | 224 | 32  | 30  | | /31 | 254 | 2 | 2* |
| /28 | 240 | 16  | 14  | | /32 | 255 | 1 | 1  |

> [!TIP]
> The magic-number method works on *any* octet. `10.20.132.0/22` → /22 is in octet 3, mask
> octet = 252, block = 4 → third-octet networks step 0,4,8,…132,136 → `132` is a network
> boundary → `10.20.132.0/22` covers `10.20.132.0`–`10.20.135.255`.

## IPv6 interface identifiers and EUI-64

The lower 64 bits of a SLAAC address are the **interface identifier (IID)**. Historically it
was derived from the 48-bit MAC via **Modified EUI-64** (RFC 4291, Appendix A):

1. Split the MAC in half: `AABB CC | DD EEFF`.
2. Insert **`FFFE`** in the middle → `AABBCC FFFE DDEEFF`.
3. **Flip the 7th bit of the first octet** (the Universal/Local bit, second-least-significant
   bit of octet 1). Universal(0)→Local becomes 1 in the *sense that the bit is inverted*.

Worked example — MAC `00:1A:2B:3C:4D:5E`, prefix `2001:db8:1:1::/64`:
`00` = `0000 0000`; flip the U/L bit → `0000 0010` = `02`. Insert `FFFE` →
IID `021A:2BFF:FE3C:4D5E`, full address `2001:db8:1:1:021a:2bff:fe3c:4d5e`. The tell-tale
`FF:FE` in the middle of an IID is the fingerprint of an EUI-64 address.

> [!WARNING]
> **EUI-64 is largely deprecated on the host side.** Because it embeds the MAC, it enables
> cross-network device tracking. Modern OSes default to **RFC 8981 temporary/privacy
> addresses** (obsoletes RFC 4941) for outbound traffic and **RFC 7217 stable-privacy /
> opaque IIDs** (a per-prefix hash, stable within a network but not tied to the MAC) for the
> stable address. Knowing EUI-64 is still expected, but "modern hosts don't use it by
> default" is the senior-level point.

## SLAAC Router Advertisements and DHCPv6

Whether a host uses SLAAC, DHCPv6, or both is decided by flags in the **Router Advertisement
(RA)** (RFC 4861/4862), not by the host guessing:

- **A (Autonomous) flag** on a Prefix Information Option: if set, the host may build a SLAAC
  address from that /64 prefix + an IID. SLAAC needs a /64 (64 host bits) — this is *why* the
  /64 boundary is rigid, not merely conventional.
- **M (Managed) flag**: set → use **stateful DHCPv6** for addresses *and* other config.
- **O (Other) flag**: set (with M clear) → SLAAC for the address, **stateless DHCPv6** for
  *other* config only (e.g. DNS servers).

Key differences from DHCPv4:

- **DHCPv6 cannot hand out a default gateway.** The gateway *always* comes from the RA
  (router lifetime + link-local next-hop). A host with DHCPv6 but no RA has an address but no
  route off-link.
- **DHCPv6-PD (Prefix Delegation, RFC 8415)** is how an ISP delegates a whole `/48`–`/56` to
  a customer CPE, which then sub-delegates /64s to internal links. This is the dual-stack
  home/enterprise norm.

> [!INTERVIEW]
> "Every host must get a *specific* address AND a DNS server — which flags/mechanism?" →
> stateful DHCPv6 (**M** flag), because SLAAC can't assign a chosen address; the gateway
> still comes from the RA. "SLAAC hosts also need DNS" → set the **O** flag (stateless
> DHCPv6) or use the RDNSS RA option.

## Duplicate Address Detection and Neighbor Discovery

IPv6 has **no ARP and no broadcast**; the **Neighbor Discovery Protocol (NDP, RFC 4861)**
over ICMPv6 replaces both. Before a host uses any address it runs **Duplicate Address
Detection (DAD)**: the address is **tentative**, the host sends a **Neighbor Solicitation
(NS)** to the address's **solicited-node multicast** group (source `::`); if no Neighbor
Advertisement (NA) comes back, the address becomes **preferred**. This is why every IPv6
interface briefly holds a "tentative" address and why an interface stuck with only an
`fe80::` link-local (no global) points to *no RA received* / router down / DHCPv6 failure.

Address resolution (the ARP replacement): to find a neighbor's link-layer address, a host
sends an NS to that neighbor's **solicited-node multicast** address rather than a broadcast —
so only the target (and the few sharing its low-24-bit suffix) is interrupted, not the whole
segment.

## IPv6 multicast address structure

A multicast address is `ff` + **4-bit flags** + **4-bit scope** + 112-bit group ID:
`ff` `flgs` `scop` `::group`. Scope values that matter: `1` interface-local, `2` link-local,
`5` site-local, `e` global. Well-known groups:

| Group | Meaning |
|-------|---------|
| `ff02::1` | all-nodes (link-local) — the closest thing to "broadcast" |
| `ff02::2` | all-routers (link-local) |
| `ff02::1:2` | all DHCPv6 relay agents and servers |
| `ff02::1:ffXX:XXXX` | **solicited-node multicast** |

The **solicited-node** address is `ff02::1:ff00:0/104` with the **low 24 bits** of the target
unicast/anycast address appended. So `2001:db8::1a:2b3c` maps to `ff02::1:ff1a:2b3c`. Because
a host only joins the solicited-node groups for its own addresses, NDP resolution and DAD hit
almost no other hosts — the efficiency win that lets IPv6 drop broadcast entirely.

## IPv6 point-to-point links and the /127 convention

For inter-router point-to-point links, **RFC 6164** says routers **MUST support /127** and
**MUST disable Subnet-Router anycast** on that prefix. Using a full /64 on a P2P link invites
two documented problems:

- **Neighbor-cache-exhaustion DoS**: an attacker floods packets to unused addresses in the
  huge /64; the router creates NDP cache entries and fires fruitless NSes for each, which can
  exhaust the cache and even disrupt control-plane sessions like BGP.
- **Ping-pong loop**: on point-to-point / NBMA media, a packet to an unused address in the
  /64 can bounce between the two routers until its Hop Limit expires.

A /127 gives exactly two addresses, one per end, with no network/broadcast concept — the
direct IPv6 analogue of the IPv4 **/31** (RFC 3021) design pattern. (On a /31 there is *no*
network or broadcast address; both addresses host the two ends of the link. Some very old
IPv4 stacks mishandled /31, the historical objection to it.)

## Anycast unicast multicast and broadcast

Four delivery models, one comparison:

| Model | Targets | How the network chooses |
|-------|---------|-------------------------|
| **Unicast** | exactly one interface | normal longest-prefix routing |
| **Broadcast** | all hosts on a subnet (IPv4 only) | all-ones host bits; not in IPv6 |
| **Multicast** | a subscribed group | group membership (IGMP/MLD) |
| **Anycast** | *one of* many identical nodes | routes to the **topologically nearest** advertiser |

**Anycast** works by advertising the **same prefix from multiple locations via BGP**;
each client reaches whichever node is nearest in routing terms. It is **not IPv6-specific** —
IPv4 anycast is ubiquitous: DNS root servers (`k.root-servers.net`), public resolvers
(`8.8.8.8`, `1.1.1.1`), and CDN edge fronts all use it. In IPv6 anycast is not a distinct
prefix — any unicast address configured on multiple nodes acts as anycast (the all-zero IID
in a /64 is the reserved **Subnet-Router anycast** address).

## IPv6 subnetting a /48 and /56 into /64s

Because the LAN prefix is fixed at /64, IPv6 "subnetting" is just counting the **subnet bits**
between the delegated prefix and /64:

- **/48 → /64**: `64 − 48 = 16` subnet bits → **65,536** /64 LANs. The subnet ID occupies the
  **4th hextet**.
- **/56 → /64**: `64 − 56 = 8` subnet bits → **256** /64 LANs.
- **/60 → /64**: 4 subnet bits → 16 /64s.

Worked: ISP delegates `2001:db8:abcd::/48`. Subnet ID lives in the 4th hextet. Zero-indexed,
subnet 0 = `2001:db8:abcd:0::/64`, subnet 5 = `2001:db8:abcd:5::/64`, subnet `0xffff` =
`2001:db8:abcd:ffff::/64`.

> [!TIP]
> Allocate on **nibble boundaries** (/48→/52→/56→/60→/64) so each level aligns to a hex digit.
> Nibble alignment keeps `ip6.arpa` reverse-DNS delegation and route aggregation clean; an
> off-nibble prefix (e.g. /61) fragments the reverse zone into multiple delegations.

## IPv4 and IPv6 transition mechanisms

Dual-stack (run both protocols in parallel) is the primary model, but IPv6-only clients still
need to reach IPv4-only servers:

- **NAT64/DNS64** (RFC 6146/6147): DNS64 synthesizes an AAAA from an A record by prefixing the
  IPv4 address under the **well-known `64:ff9b::/96`** (RFC 6052); a NAT64 gateway translates
  the resulting IPv6 flow to IPv4. **464XLAT** adds a client-side CLAT so even IPv4-only apps
  work over an IPv6-only access network.
- **6to4 / Teredo**: legacy IPv6-over-IPv4 tunneling, **largely deprecated**.
- **Address forms to distinguish**: **IPv4-mapped `::ffff:0:0/96`** (used inside dual-stack
  sockets to present v4 peers as v6) vs the **deprecated IPv4-compatible `::/96`** (`::a.b.c.d`,
  no longer used).
- **Happy Eyeballs v2 (RFC 8305)**: a dual-stack client resolves A and AAAA, starts connecting
  over IPv6 but races IPv4 shortly after, and uses whichever completes first — hiding a broken
  or slow path from the user.

## Default address selection and address lifetimes

When a host has several source and destination addresses, **RFC 6724** governs the choice:
prefer same-scope pairs, prefer a source that shares the longest prefix with the destination,
prefer appropriate scope, avoid deprecated addresses, and (with adjustable policy) generally
prefer IPv6 over IPv4. This is *why* a multi-address host picks a particular source address.

SLAAC prefixes carry two timers in the RA Prefix Information Option: the **preferred lifetime**
(address is used for new connections) and the **valid lifetime** (address still works for
existing connections). When preferred expires the address becomes **deprecated** — usable but
not chosen for new flows — enabling graceful renumbering as an ISP rotates a delegated prefix.

## Reverse DNS and delegation boundaries

Reverse lookups (IP → name, PTR records) live in special zones:

- **IPv4**: `in-addr.arpa` with **octets reversed** — `203.0.113.5` → `5.113.0.203.in-addr.arpa`.
- **IPv6**: `ip6.arpa` with **nibbles reversed**, one label per hex digit — 32 nibbles deep.

Delegation is easy on octet/nibble boundaries. A `/24` maps cleanly to one `in-addr.arpa`
zone; a `/nn` finer than /24 (e.g. a `/26` from your ISP) needs **classless reverse delegation
(RFC 2317)** — the ISP CNAMEs each address into a sub-zone you control. Likewise IPv6 rDNS
delegates cleanly only on **nibble-aligned** prefixes (/48, /52, /56, /60, /64).

## NAT taxonomy and CGNAT internals

Beyond basic NAT/PAT, the **RFC 3489/4787** behavioral taxonomy predicts NAT-traversal success:

| NAT type | Mapping/filtering behavior | Hole-punching |
|----------|----------------------------|---------------|
| **Full-cone** | one external port per internal endpoint; any external host may use it | easiest |
| **Restricted-cone** | reply allowed only from IPs the host has sent to | works |
| **Port-restricted-cone** | reply allowed only from IP+port already contacted | works |
| **Symmetric** | a *new* external port per destination | often fails → needs TURN relay |

This drives **STUN/TURN/ICE** (RFC 5389 etc.) in WebRTC/VoIP: STUN discovers the external
mapping for cone NATs; symmetric NATs usually force a TURN relay.

**CGNAT (`100.64.0.0/10`, RFC 6598)** is a *separate* shared block precisely so it does not
collide with subscriber RFC 1918 space behind their own routers (double-NAT). Operational
realities: the ISP allocates **port blocks** per subscriber (limiting concurrent flows), must
keep **huge CGN translation logs** for attribution, and breaks things — geolocation (many
users behind one IP), reputation/denylist collateral damage, and inbound reachability
(port-forwarding is impossible), which is a common merger/e2e pain point.

## Route aggregation BGP and RPKI

Aggregation (supernetting) directly limits the size of the **global BGP RIB**: one covering
prefix instead of many more-specifics. But operationally:

- **More-specific leaks / de-aggregation** bloat the table and can hijack traffic (a longer
  prefix always wins longest-prefix match, so a leaked /24 beats an aggregate /16).
- **Discontiguous subnets** and over-aggregation can **black-hole** traffic for space you
  advertise but can't deliver.
- **RPKI ROAs** (Route Origin Authorizations) are the modern guardrail: a ROA binds a prefix
  to an origin ASN **with a `maxLength`**, so an over-long more-specific is **RPKI-invalid** —
  mitigating both accidental de-aggregation and prefix-hijack hijacks.

## Additional special-purpose address blocks

Senior "is this routable?" trivia from the IANA special-purpose registries:

| Block | Purpose | Routable on Internet? |
|-------|---------|-----------------------|
| `192.0.0.0/24` | IETF protocol assignments (RFC 6890) | No |
| `198.18.0.0/15` | benchmarking / performance testing (RFC 2544) | No |
| `240.0.0.0/4` | former **Class E**, reserved/experimental (reclaim debated) | No |
| `255.255.255.255/32` | limited broadcast | No (link-only) |
| `100.64.0.0/10` | CGNAT shared space (RFC 6598) | No |
| `0.0.0.0/8` | "this host on this network" (source-only) | No |

## Common follow-up questions

- **How many usable hosts in a /26? A /29? A /30?** 62, 6, and 2 (2^host_bits − 2).
- **What subnet does 172.16.5.66/26 belong to?** Block size 64 → network `172.16.5.64`,
  broadcast `172.16.5.127`.
- **Why does a /31 have 2 usable hosts?** RFC 3021 removes the network/broadcast reservation
  for point-to-point links; both addresses are assignable.
- **Can you summarize 192.168.1.0/24 and 192.168.2.0/24 into a /23?** No — they don't align
  on a /23 boundary; .0/23 covers .0–.1 and .2/23 covers .2–.3.
- **Is 172.20.0.0 public or private?** Private — inside `172.16.0.0/12` (172.16–172.31).
- **What does a 169.254.x.x address indicate?** APIPA/link-local: the host got no DHCP lease.
- **What's the normal IPv6 subnet size and why?** /64, because the lower 64 bits are the
  interface identifier used by SLAAC.
- **Why can `::` appear only once in an IPv6 address?** Two `::` would make the number of
  zero groups each represents ambiguous.
- **Is NAT a security control?** No — it's an address-conservation mechanism; obscurity is a
  side effect, not a policy.
- **Derive the SLAAC IID for MAC 00:1A:2B:3C:4D:5E.** Flip the U/L bit of `00`→`02`, insert
  `FFFE`: IID `021A:2BFF:FE3C:4D5E`. (But modern hosts default to RFC 7217/8981, not EUI-64.)
- **SLAAC vs DHCPv6 — where does that decision live?** In the RA flags: A enables SLAAC, M =
  stateful DHCPv6, O = stateless DHCPv6; the default gateway always comes from the RA.
- **Why /127 (not /64) on a router-to-router link?** RFC 6164 — avoids neighbor-cache
  exhaustion DoS and ping-pong loops; the IPv6 analogue of the IPv4 /31.
- **How many /64s in a delegated /48?** 65,536 (16 subnet bits); a /56 yields 256.
- **How does an IPv6-only client reach an IPv4-only server?** NAT64/DNS64 via `64:ff9b::/96`,
  or 464XLAT; dual-stack clients use Happy Eyeballs (RFC 8305).
- **Is 100.64.5.1 routable on the Internet?** No — CGNAT shared space (RFC 6598); not RFC 1918
  but not public either.
- **A host has only an fe80:: address, no global — what failed?** No RA received / router down
  / DHCPv6 not answering — SLAAC/DHCPv6 never provided a global prefix.
- **Two merged companies both use 10.0.0.0/8 — how do you interconnect?** Overlapping/twice-NAT,
  renumber one side, or migrate to non-overlapping IPv6/ULA space.

## References

- RFC 791 — Internet Protocol (IPv4)
- RFC 4632 — Classless Inter-Domain Routing (CIDR): Address Assignment and Aggregation
- RFC 1519 — original CIDR specification (obsoleted by 4632)
- RFC 1918 — Address Allocation for Private Internets
- RFC 6598 — IANA-Reserved IPv4 Prefix for Shared Address Space (CGNAT, 100.64.0.0/10)
- RFC 3927 — Dynamic Configuration of IPv4 Link-Local Addresses (169.254.0.0/16)
- RFC 3021 — Using 31-Bit Prefixes on IPv4 Point-to-Point Links
- RFC 5737 — IPv4 Address Blocks Reserved for Documentation
- RFC 4291 — IP Version 6 Addressing Architecture
- RFC 4193 — Unique Local IPv6 Unicast Addresses (fc00::/7)
- RFC 4862 — IPv6 Stateless Address Autoconfiguration (SLAAC)
- RFC 3849 — IPv6 Address Prefix Reserved for Documentation (2001:db8::/32)
- RFC 4861 — Neighbor Discovery for IPv6 (NDP, RA flags, DAD)
- RFC 6164 — Using 127-Bit IPv6 Prefixes on Inter-Router Links
- RFC 8415 — Dynamic Host Configuration Protocol for IPv6 (DHCPv6) and Prefix Delegation
- RFC 8981 — Temporary Address Extensions for SLAAC (obsoletes RFC 4941)
- RFC 7217 — A Method for Generating Stable, Semantically Opaque Interface Identifiers
- RFC 6724 — Default Address Selection for IPv6
- RFC 6052 / 6146 / 6147 — IPv6 Addressing of IPv4/IPv6 Translators, NAT64, DNS64 (64:ff9b::/96)
- RFC 8305 — Happy Eyeballs Version 2
- RFC 4787 / 3489 / 5389 — NAT behavioral requirements and STUN
- RFC 2317 — Classless IN-ADDR.ARPA delegation
- RFC 6890 — Special-Purpose IP Address Registries
- IANA IPv4/IPv6 Special-Purpose Address Registries
