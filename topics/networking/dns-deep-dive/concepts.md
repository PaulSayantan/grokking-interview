# DNS Deep Dive

The Domain Name System (DNS) is the Internet's distributed, hierarchical naming
database. Its most visible job is turning human-friendly names like
`www.example.com` into the addresses machines route on (`93.184.216.34` for IPv4,
`2606:2800:220:1:248:1893:25c8:1946` for IPv6), but it also carries mail routing,
service discovery, policy, and text metadata. DNS is a *protocol* (message format on
the wire, UDP/TCP transport, resource-record encoding) layered on top of a *delegated
administrative hierarchy* (root → TLD → zone). Interviewers probe both: "what packets
flow when you type a URL," and "who is authoritative for what, and how does caching
make this scale."

The foundational specs are **RFC 1034** (concepts and facilities) and **RFC 1035**
(implementation and message format), both from 1987 and still normative. Later RFCs
layer on: **RFC 2782** (SRV), **RFC 6844/8659** (CAA), **RFC 6891** (EDNS(0)),
**RFC 4033–4035** (DNSSEC), **RFC 7766** (DNS over TCP requirements), **RFC 7858**
(DNS over TLS), and **RFC 8484** (DNS over HTTPS).

> [!KEY-TAKEAWAY]
> DNS scales because it is **delegated** (no single server knows everything — each
> zone points down to child zones) and **cached** (answers are reused for their TTL at
> every layer). Almost every DNS interview question is really testing whether you
> understand delegation, caching, or the difference between recursive and iterative
> resolution.

## The resolution path: stub, recursive resolver, root, TLD, authoritative

A full lookup involves four distinct actors:

1. **Stub resolver** — the tiny client library in your OS/app (`getaddrinfo`, the
   browser's resolver). It knows almost nothing; it just forwards the whole question
   to a configured recursive resolver and waits for the final answer. It sets the
   **RD (Recursion Desired)** bit.
2. **Recursive resolver** (a.k.a. recursor / caching resolver) — e.g. your ISP's
   resolver, `8.8.8.8`, `1.1.1.1`. It does the legwork, walking the hierarchy on the
   stub's behalf, and caches everything it learns.
3. **Root servers** — the 13 root server *identities* (`a.root-servers.net` …
   `m.root-servers.net`, each actually a huge anycast fleet). They don't know
   `example.com`; they know who runs `.com`, `.org`, etc., and return NS referrals.
4. **TLD servers** — authoritative for a top-level domain (`.com`, `.co.uk`). They
   don't know the `www` record; they return a referral to the zone's authoritative
   nameservers.
5. **Authoritative servers** — hold the actual zone data for `example.com` and return
   the real answer with the **AA (Authoritative Answer)** bit set.

Cold-cache walk for `www.example.com` (recursor's view):

```
stub ──(RD=1)──► recursor:  "A www.example.com?"
recursor ──► root:          "A www.example.com?"   → referral: ".com NS a.gtld-servers.net ..."
recursor ──► .com TLD:      "A www.example.com?"   → referral: "example.com NS ns1.example.com ..."
recursor ──► example.com auth: "A www.example.com?" → answer: "A 93.184.216.34" (AA=1)
recursor ──► stub:          "A 93.184.216.34"  (cached at each level for its TTL)
```

The recursor typically starts from a **root hints** file (the well-known root IPs) or
a **priming query** for `NS .`. Once it has cached the `.com` NS set and the
`example.com` NS set, subsequent lookups skip the top of the tree entirely.

> [!INTERVIEW]
> "What happens when you type a URL and hit enter?" On the DNS side: browser cache →
> OS stub cache → recursive resolver (which may answer from cache or walk root → TLD →
> authoritative). Say "the resolver does the recursion; the stub just asks once" and
> you've shown you understand the split.

## Recursive vs iterative queries

These describe *who chases referrals*, and they are frequently confused.

- **Recursive query**: "Give me the final answer; you do the work." The stub sends a
  recursive query (RD=1) to its recursor. If the server offers recursion (RA =
  Recursion Available bit set), it must return either the answer or an error — never a
  referral.
- **Iterative query**: "Give me the best you have; a referral is fine." The recursor
  sends *iterative* queries (RD=0 effectively, or ignored) to root/TLD/authoritative
  servers. Each responds with either the answer or a referral to servers closer to it.

So a single user lookup is **one recursive query** (stub→recursor) that internally
drives **many iterative queries** (recursor→root→TLD→auth).

| | Recursive | Iterative |
|---|---|---|
| Who chases referrals | The queried server | The querying client |
| Typical sender | Stub → recursor | Recursor → root/TLD/auth |
| Response can be a referral? | No (answer or error) | Yes |
| State held | Server tracks the whole walk | Client tracks the walk |

> [!WARNING]
> Root and TLD servers do **not** perform recursion — they only answer iteratively
> with referrals. If they recursed for everyone, they'd collapse. Authoritative
> servers likewise generally refuse recursion. Only recursive resolvers recurse.

## DNS record types: A, AAAA, CNAME, MX, TXT, NS, SOA, SRV, PTR, CAA

A **resource record (RR)** has: owner name, type, class (almost always `IN`), TTL, and
type-specific RDATA. Key types:

| Type | Purpose | Example RDATA |
|---|---|---|
| **A** | Name → IPv4 address | `93.184.216.34` |
| **AAAA** | Name → IPv6 address | `2606:2800:220:1::/…` |
| **CNAME** | Alias → canonical name | `www → example.com.` |
| **MX** | Mail exchanger + preference | `10 mail.example.com.` |
| **TXT** | Arbitrary text (SPF, DKIM, verification) | `"v=spf1 include:_spf.google.com ~all"` |
| **NS** | Delegates a zone to a nameserver | `ns1.example.com.` |
| **SOA** | Start Of Authority: zone metadata | `ns1 hostmaster serial refresh retry expire minimum` |
| **SRV** | Service location: host + port + priority/weight | `_sip._tcp → 10 60 5060 sipserver` |
| **PTR** | Reverse: IP → name (in `in-addr.arpa`/`ip6.arpa`) | `34.216.184.93.in-addr.arpa → example.com.` |
| **CAA** | Which CAs may issue certs for the domain | `0 issue "letsencrypt.org"` |

Details worth knowing:

- **CNAME rules**: a CNAME's owner name can have *no other records* of a different
  type at the same name (RFC 1034). That's why you can't put a CNAME at a zone apex
  (see the apex problem below). Resolvers follow the CNAME chain to reach the terminal
  A/AAAA. MX/NS/CNAME targets must point to names, not CNAMEs, per best practice
  (RFC 2181 discourages CNAME targets for MX/NS).
- **MX preference**: *lower* number = higher priority. `10` is tried before `20`.
- **SOA fields**: `serial` (bumped on every change; secondaries compare it),
  `refresh`/`retry`/`expire` (secondary zone-transfer timing), and **`minimum`** —
  which today defines the **negative-caching TTL** (RFC 2308), not a default record
  TTL.
- **SRV** format is `_service._proto.name TTL IN SRV priority weight port target`.
  Used by SIP, XMPP, LDAP, Kerberos, Minecraft, etc. HTTP historically ignored SRV;
  **SVCB/HTTPS** records (RFC 9460) are the modern equivalent for web.
- **PTR** lives under the reversed-IP `.in-addr.arpa` (IPv4) or `.ip6.arpa` (IPv6)
  tree. Forward and reverse are independent zones; an A record does *not* create a PTR.
- **CAA** is checked by Certificate Authorities at issuance time, not by browsers.

Example `dig` output:

```
$ dig +noall +answer www.example.com A
www.example.com.  3600  IN  A  93.184.216.34

$ dig +noall +answer example.com MX
example.com.  3600  IN  MX  10 mail.example.com.
```

## TTL and caching layers

Every RR carries a **TTL** (time-to-live, in seconds) that tells caches how long they
may reuse the answer. Caching happens at many layers, and the *effective* freshness is
governed by the smallest remaining TTL along the path:

```
browser cache  →  OS stub cache  →  recursive resolver cache  →  authoritative (source of truth)
```

- The **authoritative** server sets the TTL. Everyone downstream counts it down; a
  recursor that cached a 3600s record and serves it 1000s later hands the client a
  record with TTL ~2600 (it decrements).
- **Low TTL** (30–300s) = fast propagation of changes, more query load, more resolver
  round-trips. **High TTL** (hours/days) = fewer queries, more resilience if
  authoritative servers are unreachable, but slow to change.
- Common pattern before a planned migration: lower the TTL to 60s *well in advance*
  (at least one old-TTL window before), cut over, then raise it again.

> [!TIP]
> The classic operational trap: you drop the TTL to 60s an hour before a migration,
> but the old record had TTL 86400 and was cached 30 minutes ago — that stale copy
> lives up to 24h regardless of your new low TTL. Lower TTLs must be published at least
> one *old*-TTL period ahead to take effect.

Resolvers may also **cap** TTLs (e.g. ignore multi-week TTLs) and some clamp very low
TTLs upward to protect themselves. Browsers keep their own short in-process cache
(often ~60s) independent of the OS.

## Negative caching

Caching "this name/type does not exist" is as important as caching positive answers —
otherwise every typo or missing record hammers the authoritative servers.

- **NXDOMAIN**: the name does not exist at all (rcode 3).
- **NODATA**: the name exists but has no record of the requested type (e.g. an AAAA
  query for an IPv4-only host) — signalled by rcode 0 (NOERROR) with an empty answer
  section plus an SOA in the authority section.

Per **RFC 2308**, the **negative-caching TTL** is the *minimum* of the SOA's `MINIMUM`
field and the SOA record's own TTL. So the SOA `minimum` field, which in the 1980s meant
a default record TTL, now defines how long negative answers are cached. Set it too high
and a newly created record stays "invisible" (still cached as NXDOMAIN) for that long.

> [!WARNING]
> A common bug: you add a new `AAAA` record but clients still fail to resolve it for
> minutes. Cause: a prior NODATA/NXDOMAIN answer got negatively cached for the SOA
> minimum. The fix is a low SOA minimum, and patience — you can't reach into resolver
> caches.

## DNS over UDP:53, TCP fallback, and message size

Classic DNS uses **UDP port 53** for its speed (one datagram out, one back, no
handshake). But UDP has limits:

- Original DNS capped UDP payloads at **512 bytes** (RFC 1035). Responses that don't
  fit set the **TC (Truncated)** bit, telling the client to **retry over TCP:53**.
- **EDNS(0)** (RFC 6891) added an OPT pseudo-record letting the client advertise a
  larger UDP buffer (commonly 1232 or 4096 bytes), reducing TCP fallback. 1232 is the
  modern recommended default to avoid IP fragmentation.
- **TCP:53** is *mandatory* to support (RFC 7766), not optional. It's used for
  truncated responses, **zone transfers (AXFR/IXFR)**, and by DoT/large DNSSEC answers.

Flow:

```
client ──UDP──► resolver:  "ANY example.com?" (EDNS buf 1232)
resolver ──UDP──► client:  response too big → TC=1 set, minimal/empty answer
client ──TCP──► resolver:  same query over TCP
resolver ──TCP──► client:  full response
```

> [!INTERVIEW]
> "Is DNS UDP or TCP?" Best answer: "Both. UDP:53 by default for speed; TCP:53 as a
> mandatory fallback when responses are truncated (TC bit) and for zone transfers.
> EDNS(0) raises the UDP size limit to cut down on TCP fallback." Saying "UDP only" is
> a red flag.

## DNS-based load balancing, failover, and GeoDNS

DNS is a cheap, ubiquitous traffic-steering layer because every client already queries
it:

- **Round-robin DNS**: return multiple A/AAAA records; clients/resolvers rotate through
  them. Crude load spreading — no health awareness, and client caching/ordering skews
  the distribution.
- **Weighted / latency / geo (GeoDNS)**: the authoritative server returns *different*
  answers based on the resolver's source IP or EDNS Client Subnet (ECS, RFC 7871),
  steering users to the nearest or least-loaded region.
- **Failover**: the provider health-checks endpoints and stops returning dead ones —
  but only as fast as the **TTL** allows, so DNS failover is inherently slower than
  in-band load-balancer failover. TTLs of 30–60s are typical for failover records.

Limitations to name in an interview:

1. **Resolver caching** means clients don't re-query until TTL expiry — you can't
   instantly drain a node.
2. **GeoDNS sees the resolver's IP, not the user's** — a user on `8.8.8.8` may be
   mapped to Google's resolver location, not their own. **EDNS Client Subnet** (RFC
   7871) mitigates this by forwarding a truncated client subnet, at a privacy cost.
3. **No load feedback** — DNS doesn't know server load in real time; it's coarse
   compared to an L4/L7 load balancer. DNS is best for *coarse regional* steering, with
   a real load balancer doing fine-grained distribution inside each region.

## The CNAME-at-apex problem

You often want the apex (a.k.a. root, `example.com` with no host label) to point at a
CDN or load balancer hostname like `d123.cloudfront.net`. The obvious tool is a CNAME —
but **you cannot put a CNAME at a zone apex**.

Why: RFC 1034 forbids a CNAME coexisting with any other record at the same name. The
apex *must* carry `SOA` and `NS` records (they define the zone). A CNAME there would
collide with them, so it's illegal. Symptoms if you try: broken mail (MX at apex gone),
NS resolution issues, or the provider simply rejecting the record.

Workarounds:

- **ALIAS / ANAME / "CNAME flattening"** — provider-specific pseudo-records (Route 53
  ALIAS, Cloudflare CNAME flattening, DNSimple/NS1 ALIAS). The authoritative server
  resolves the target's A/AAAA *at query time* and returns them as if they were real
  A/AAAA records at the apex. Not a standard record type — it's synthesized server-side.
- **Redirect** `example.com` → `www.example.com` (which *can* be a CNAME) via an HTTP
  redirect.
- **Static A records** to the target's IPs — brittle if the target's IPs change.
- **SVCB/HTTPS records** (RFC 9460) — the emerging standard-track answer; `HTTPS`
  records can live at the apex and carry an `AliasMode` target, plus ALPN/port hints.

> [!INTERVIEW]
> "Why can't you CNAME your root domain to a CDN?" → "A zone apex must hold SOA and NS
> records, and a CNAME can't coexist with other records at the same name (RFC 1034).
> Providers work around it with ALIAS/ANAME flattening that synthesizes A/AAAA at query
> time, and the standards-track fix is the HTTPS/SVCB record (RFC 9460)."

## DNSSEC (brief)

Plain DNS has no authentication — a resolver can't tell a forged answer from a real one
(enabling **cache poisoning**, e.g. the Kaminsky attack). **DNSSEC** (RFC 4033–4035)
adds *origin authentication and integrity* — **not confidentiality** — via a chain of
cryptographic signatures.

- Zone data is signed; each RRset gets an **RRSIG**. Public keys are published as
  **DNSKEY**. A **DS** (Delegation Signer) record in the *parent* zone hashes the
  child's key, building a chain of trust from the root down (the root's key is the
  **trust anchor**, distributed out-of-band).
- Proof of *non-existence* uses **NSEC**/**NSEC3** records (NSEC3 hashes names to
  resist zone enumeration).
- Validation is done by the **resolver**, which sets the **AD (Authenticated Data)**
  bit when the chain verifies; bad signatures yield **SERVFAIL**.

Trade-offs: larger responses (more TCP fallback / fragmentation), operational
complexity (key rollovers, DS updates at the registrar), and it protects the
*resolver→authoritative* path but classically **not** the last hop stub→resolver — that
gap is what DoH/DoT address. DNSSEC ≠ encryption.

## DNS privacy: DoH and DoT

Classic DNS is plaintext on port 53 — any on-path observer (ISP, coffee-shop Wi-Fi) can
see and even tamper with your queries. Two protocols encrypt the **stub→resolver** hop:

| | DoT (DNS over TLS) | DoH (DNS over HTTPS) |
|---|---|---|
| RFC | 7858 | 8484 |
| Transport | TLS over dedicated **port 853** | HTTPS (HTTP/2 or /3) over **port 443** |
| Distinguishable from other traffic | Yes (own port) | No — blends with web traffic |
| Typical deployment | OS/network-level resolver | Browser or app-level resolver |
| Network admin control | Easy to block/allow (port 853) | Hard to block (looks like HTTPS) |

Key points:

- Both encrypt the query *between the stub and the recursive resolver*; they do **not**
  encrypt the recursor→authoritative queries (that's the emerging **Authoritative DoT**
  / DELEG work) and are orthogonal to DNSSEC (integrity vs. confidentiality — you can,
  and ideally do, run both).
- **DoH is controversial** operationally: because it rides port 443 and can be enabled
  *inside the browser*, it can bypass enterprise/parental DNS filtering and split-horizon
  DNS. That's a feature for privacy and a headache for network operators.
- Neither hides *which sites you visit* from the resolver operator — you're trusting
  whoever runs the resolver. **Oblivious DoH (ODoH)** adds a relay so the resolver
  doesn't see client IPs. TLS **SNI** and IP still leak the destination to on-path
  observers unless Encrypted Client Hello (ECH) is used.

## The "DNS propagation" misconception

Engineers say "my DNS change hasn't propagated yet," implying updates flood outward to
all servers. **That's not how it works.**

- Authoritative changes are effectively **instant** — the moment you update the master
  zone (and secondaries pull it via IXFR/NOTIFY, seconds later), the *authoritative*
  answer is the new one.
- What you're actually waiting for is **cached copies of the OLD record expiring** in
  recursive resolvers around the world. A resolver that cached the old answer will keep
  serving it until its **TTL** counts down to zero — there is no push/invalidation
  mechanism in DNS.
- Therefore "propagation time" ≈ the record's **TTL** (plus straggler resolvers that
  cap or clamp TTLs, and negative-cache windows for newly-created names).

> [!KEY-TAKEAWAY]
> There is no global DNS "propagation." Authoritative updates are immediate; the delay
> is stale answers **expiring** from caches. To make changes take effect fast, lower the
> TTL *before* the change (a full old-TTL window ahead). You cannot force-flush the
> world's resolver caches.

## Common follow-up questions

- **"Walk me through resolving `mail.example.co.uk` from a cold cache."** Root → `.uk`
  TLD → `.co.uk` → `example.co.uk` authoritative; note that `.co.uk` is a delegation
  point, not just a label — the public suffix matters.
- **"Why is the answer sometimes returned over TCP?"** Truncation (TC bit) due to a
  response exceeding the (EDNS-negotiated) UDP size, DNSSEC-inflated answers, or zone
  transfers.
- **"How would you implement blue/green with DNS, and what's the catch?"** Weighted
  records + low TTL; catch is resolver caching means you can't instantly shift 100% and
  some clients ignore/clamp TTLs.
- **"Difference between a CNAME and an ALIAS?"** CNAME is a standard record that can't
  sit at the apex and can't coexist with other types; ALIAS/ANAME is a provider
  synthesis that returns A/AAAA at query time and *can* live at the apex.
- **"Does DNSSEC encrypt my queries?"** No — it authenticates/integrity-protects
  answers. DoT/DoH provide confidentiality.
- **"Why did my new subdomain 404/NXDOMAIN for a while even though I added the
  record?"** Negative caching (RFC 2308) of the earlier non-existent answer for the SOA
  minimum window.
- **"What is EDNS Client Subnet and its trade-off?"** Forwards a truncated client subnet
  to authoritative servers for better GeoDNS accuracy, at a privacy cost; RFC 7871.

## References

- RFC 1034 — Domain Names: Concepts and Facilities
- RFC 1035 — Domain Names: Implementation and Specification (message format, UDP 512B)
- RFC 2181 — Clarifications to the DNS Specification (TTLs, CNAME/MX/NS rules)
- RFC 2308 — Negative Caching of DNS Queries (NXDOMAIN/NODATA, SOA minimum)
- RFC 2782 — A DNS RR for specifying the location of services (SRV)
- RFC 6891 — Extension Mechanisms for DNS (EDNS(0))
- RFC 8659 — DNS Certification Authority Authorization (CAA) Resource Record
- RFC 7766 — DNS Transport over TCP — Implementation Requirements
- RFC 7858 — Specification for DNS over Transport Layer Security (DoT)
- RFC 8484 — DNS Queries over HTTPS (DoH)
- RFC 7871 — Client Subnet in DNS Queries (EDNS Client Subnet)
- RFC 4033 / 4034 / 4035 — DNS Security Introduction and Requirements (DNSSEC)
- RFC 9460 — Service Binding and Parameter Specification via the DNS (SVCB/HTTPS RRs)
- IANA Root Servers — https://www.iana.org/domains/root/servers
