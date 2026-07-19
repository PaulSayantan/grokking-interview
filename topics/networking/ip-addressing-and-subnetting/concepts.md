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
- IANA IPv4/IPv6 Special-Purpose Address Registries
