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

## DNS message format on the wire

Every DNS message — query or response, over UDP, TCP, DoT, DoH, or DoQ — has the same
structure: a **12-byte fixed header** followed by four variable sections.

```
+---------------------+
|       Header        |  12 bytes
+---------------------+
|      Question       |  QDCOUNT entries (usually 1)
+---------------------+
|       Answer        |  ANCOUNT RRs
+---------------------+
|      Authority      |  NSCOUNT RRs (NS referrals, or SOA on negative answers)
+---------------------+
|     Additional      |  ARCOUNT RRs (glue A/AAAA, the EDNS OPT record, ...)
+---------------------+
```

The 12-byte header (RFC 1035 §4.1.1) packs:

- **ID** (16-bit) — transaction identifier; the resolver matches a response to its
  outstanding query by ID (plus the question). Critical to anti-spoofing (see below).
- **QR** (1 bit) — 0 = query, 1 = response.
- **Opcode** (4 bits) — QUERY (0), IQUERY (1, obsolete), STATUS (2), NOTIFY (4), UPDATE
  (5, dynamic update RFC 2136).
- **AA** — Authoritative Answer. **TC** — Truncated. **RD** — Recursion Desired (copied
  from query into response). **RA** — Recursion Available.
- **Z** — reserved, must be 0. **AD** — Authenticated Data (DNSSEC). **CD** — Checking
  Disabled (DNSSEC).
- **RCODE** (4 bits) — result code (see below).
- **QDCOUNT / ANCOUNT / NSCOUNT / ARCOUNT** — the number of entries in each section.

A **question** entry is just QNAME + QTYPE + QCLASS (no TTL/RDATA). A **resource record**
adds NAME, TYPE, CLASS, TTL, RDLENGTH, and RDATA. Names are encoded as a sequence of
**length-prefixed labels** terminated by a **zero-length octet** (the root). So
`www.example.com` is `3www7example3com0` — and a bare `.` (root) is a single `0x00`.

Over TCP/DoT/DoQ, each message is prefixed with a **2-octet length** field because a
stream has no datagram boundaries; over UDP the datagram itself delimits the message.

## Name compression

To keep messages compact when the same domain suffix repeats (e.g. many RRs under
`example.com`), RFC 1035 §4.1.4 defines **name compression**: instead of re-encoding a
suffix, a name can end with a **pointer** to an earlier occurrence.

- A pointer is 2 octets with the **two high bits set** (`0xC0` mask); the remaining 14
  bits are the **offset from the start of the message** to the earlier name.
- A name is thus a sequence of labels optionally terminated by a pointer (which itself
  ends the name — you follow it and stop).
- Compression may only point **backwards** to a prior name, and only within the same
  message.

Caveat: names inside some RDATA must **not** be compressed to remain unambiguous to
parsers that don't know a given RR type, and the **OPT (EDNS) pseudo-record's** owner
name is always root (`0x00`), never compressed. Buggy compression pointer handling
(pointer loops) has historically been a parser DoS vector.

## Response codes (RCODEs) and Extended DNS Errors

The 4-bit header RCODE is small, so EDNS extends it. Common values:

| RCODE | Name | Meaning |
|---|---|---|
| 0 | **NOERROR** | Success (may still be NODATA if answer section empty) |
| 1 | **FORMERR** | Server couldn't parse the query (format error) |
| 2 | **SERVFAIL** | Server failed — upstream timeout, DNSSEC bogus, internal error |
| 3 | **NXDOMAIN** | The queried name does not exist |
| 4 | **NOTIMP** | Opcode/feature not implemented |
| 5 | **REFUSED** | Policy refusal (e.g. recursion not offered, ACL, zone not served) |

EDNS carries an **extended 8-bit RCODE** in the OPT TTL field, enabling values ≥16:
**BADVERS (16)** = unsupported EDNS version, **BADCOOKIE (23)** = DNS Cookie mismatch.

Because SERVFAIL and REFUSED are vague, **Extended DNS Errors (EDE, RFC 8914)** add a
machine-readable *why* as an EDNS option: e.g. "DNSSEC Bogus", "Signature Expired", "DNSKEY
Missing", "Blocked", "Censored", "Stale Answer", "Prohibited". EDE is informational only —
it does not change the RCODE — but it turns "SERVFAIL, good luck" into an actionable reason.

> [!INTERVIEW]
> "Your resolver returns SERVFAIL intermittently — differential?" DNSSEC validation
> failure (expired RRSIG, broken chain, missing/incorrect DS at the registrar), an
> authoritative-server timeout, an EDNS/fragmentation blackhole (large answer dropped, no
> TCP fallback), or rate-limiting. Check the **EDE code** for the real reason before
> guessing.

## QNAME minimization

Classically a resolver sent the **full** QNAME to every server it queried — so the root
and TLD servers learned the entire name you were looking up, even though they only need
one label to give a referral. **QNAME minimization (RFC 9156**, obsoleting the
experimental RFC 7816) fixes this privacy leak:

- The resolver sends each server only **one label more than it already knows**. Asking
  the root, it queries just `com`; asking `.com`, it queries just `example.com`; and so
  on down.
- It uses an **A (or AAAA) QTYPE** for the intermediate probes rather than NS, because
  some servers behave badly for NS queries at non-apex names.
- A **relaxed mode** falls back to sending more of the name when a server responds
  oddly, and a cap (`MAX_MINIMISE_COUNT`, ~10) bounds the extra queries for very deep or
  wildcard-heavy names to avoid amplification.

This is the dominant *recursive-side* privacy improvement of the last decade and
complements DoH/DoT: those encrypt stub→resolver, while QNAME minimization limits what
each authoritative server learns.

## DNS Cookies

**DNS Cookies (RFC 7873**, updated by **RFC 9018)** are a lightweight, off-path
anti-spoofing and anti-amplification mechanism carried in an **EDNS OPT option (code
10)**:

- The client sends a 64-bit **Client Cookie**; the server returns that plus an 8–32 byte
  **Server Cookie** derived from the client IP and a server secret.
- On later queries the client echoes the Server Cookie, proving it can receive replies at
  its claimed source address — defeating **off-path** spoofing (an attacker who can't see
  the traffic can't guess the cookie) and blunting **amplification/reflection** (a forged
  request without a valid cookie gets only a small `BADCOOKIE` (RCODE 23) or is
  rate-limited, not a big answer).
- Cookies are cheap (no crypto handshake, no per-connection state) but only stop
  *off-path* attackers — an on-path attacker who sees the cookie is unaffected (that needs
  DoT/DoQ or DNSSEC).

## DNS over QUIC (DoQ)

**DNS over QUIC (RFC 9250**, 2022) completes the encrypted-DNS trio with DoT and DoH:

- Runs over **QUIC on UDP port 853** (same port number as DoT but QUIC/UDP, not TLS/TCP),
  ALPN token **`doq`**.
- Each query/response uses its own bidirectional **QUIC stream**, with **2-octet length
  framing** like TCP; because streams are independent, DoQ **eliminates the TCP
  head-of-line blocking** that DoT and DoH-over-HTTP/2 suffer when one lost packet stalls
  all multiplexed queries.
- The DNS Message **ID MUST be 0** on DoQ (the QUIC stream, not the ID, correlates
  request and response).
- **0-RTT** is allowed but restricted to replay-safe opcodes (**QUERY and NOTIFY**) to
  avoid an attacker replaying a state-changing message.
- DoQ is defined for stub→recursive, recursive→authoritative, **and** zone transfers
  (XFR-over-QUIC), making it the most general encrypted transport.

## DNS amplification and reflection attacks

DNS is a favourite DDoS amplifier because a small UDP query yields a large response and
the source IP can be spoofed:

- The attacker sends queries with the **victim's spoofed source IP** to open resolvers or
  authoritative servers, choosing query types that return large answers (historically
  `ANY`, or `DNSKEY`/large TXT). The victim is flooded with responses it never asked for;
  the **amplification factor** (response size ÷ query size) can be tens of times.
- **Open resolvers** (recursors that answer anyone) are the classic reflectors and should
  be closed or restricted to their own users.
- Defenses at protocol/operational altitude: **Response Rate Limiting (RRL)** on
  authoritative servers (limit identical responses per source/prefix), **DNS Cookies**
  (unspoofable client proof), refusing/`minimal-any` for `ANY` queries, and network-level
  **BCP 38 / ingress filtering** so spoofed source IPs can't leave a network in the first
  place.

## Registration, delegation, and glue records

A domain flows through three roles: the **registrant** (you) registers via a
**registrar** (e.g. a reseller), which records the delegation in the **registry** that
operates the TLD (e.g. Verisign for `.com`). The registry publishes your **NS records**
in the TLD zone — that's the delegation.

- **Glue records** solve a chicken-and-egg problem: if `example.com`'s nameservers are
  *inside* the zone (`ns1.example.com`), a resolver asking `.com` "where is example.com?"
  gets `NS ns1.example.com` — but to query `ns1.example.com` it must resolve *that* name,
  which lives in `example.com`, which it can't reach yet. So the parent (`.com`) also
  publishes **A/AAAA glue** for the in-bailiwick nameserver names in the **Additional**
  section of the referral, breaking the loop. Out-of-bailiwick nameservers
  (`ns1.someoneelse.net`) need no glue.
- **Parent vs child NS authority** (RFC 2181): the delegating parent's NS set and the
  child's own apex NS set can differ; the **child's** apex NS set is authoritative, but
  resolvers follow the parent's delegation to get there. Keeping them consistent avoids
  "lame delegation".

## Zone transfers: AXFR, IXFR, NOTIFY, and TSIG

Authoritative high availability uses a **primary** (holds the editable master zone) and
one or more **secondaries** that replicate it:

- **AXFR** (RFC 1035) transfers the **entire** zone over TCP. **IXFR** (RFC 1995)
  transfers only the **incremental delta** since the secondary's serial — far cheaper for
  large zones with small changes, with automatic fallback to AXFR if the delta isn't
  available.
- **NOTIFY** (RFC 1996) is a push *trigger*: when the primary's zone changes it sends a
  small NOTIFY to secondaries so they refresh immediately instead of waiting for the SOA
  REFRESH timer. Secondaries then pull via IXFR/AXFR.
- **TSIG** (RFC 8945) authenticates transfers and dynamic updates with a shared-secret
  HMAC and a timestamp (anti-replay). It protects who may pull/push a zone — distinct from
  DNSSEC, which signs the *data* for end resolvers. Zone transfers should be restricted by
  ACL and/or TSIG so attackers can't dump your whole zone via AXFR.

## Serve-stale and prefetching

Two resolver behaviors improve resilience and latency beyond strict TTL expiry:

- **Serve-stale (RFC 8767)**: if the authoritative servers are unreachable when a cached
  record's TTL has expired, the resolver may keep serving the **stale** answer (within a
  bounded "stale TTL", often up to ~1 day) rather than fail. This trades strict freshness
  for availability during authoritative outages — and is another reason a change may
  linger past its nominal TTL.
- **Prefetch**: popular records are re-queried **before** they expire (e.g. when TTL drops
  below a threshold and the name is being actively requested), so clients rarely wait on a
  cache miss.

## Happy Eyeballs and dual-stack lookups

On a dual-stack host, a client resolving a hostname issues **both an A and an AAAA
query** (often in parallel) and races connections to reduce user-visible latency —
**Happy Eyeballs v2 (RFC 8305)**:

- The client typically prefers IPv6 but starts a TCP/QUIC connection to whichever family
  answers/connects first, with a short head-start timer, falling back seamlessly if one
  family is broken.
- On an IPv4-only host, the AAAA query returns **NODATA** (NOERROR, empty) — normal, not
  an error. This is why packet captures of a single `getaddrinfo` show *two* DNS
  questions, and why a slow/blackholed AAAA path can add latency even when IPv4 works.

## SOA timers in depth

The SOA record's numeric fields have precise, easily-confused semantics:

- **SERIAL** (32-bit unsigned) — the zone version. Secondaries compare it (with
  wraparound arithmetic per RFC 1982) to decide whether to transfer; a common convention
  is `YYYYMMDDnn`. If you forget to bump the serial, secondaries won't pick up changes.
- **REFRESH** — how often a secondary checks the primary's serial (in the absence of
  NOTIFY).
- **RETRY** — how soon to retry after a *failed* refresh attempt (shorter than REFRESH).
- **EXPIRE** — how long a secondary keeps serving the zone if it **cannot** reach the
  primary at all; once EXPIRE elapses the secondary stops answering for the zone
  (SERVFAIL/refused) rather than serve very stale data. This is **zone-level** and
  entirely distinct from per-record TTL.
- **MINIMUM** — today the **negative-caching TTL** cap (RFC 2308), *not* a default record
  TTL.

> [!WARNING]
> Don't confuse **EXPIRE** (secondary stops serving the whole zone after prolonged loss
> of the primary) with **MINIMUM** (how long *resolvers* cache negative answers). They
> operate on different actors and different data.

## SVCB and HTTPS records in depth

**SVCB (type 64)** and its web-specific alias **HTTPS (type 65)** (RFC 9460) let a domain
publish connection parameters and endpoint aliasing in one record, cutting extra
round-trips:

- **SvcPriority = 0 → AliasMode**: the record aliases the owner name to a **TargetName**
  (the standards-track "CNAME at the apex" solution). Non-zero priority → **ServiceMode**:
  the record describes an endpoint with parameters, and multiple records give
  priority/fallback ordering.
- **TargetName** of `.` means "the owner name itself".
- **SvcParams** carry hints: **`alpn`/`no-default-alpn`** (advertise `h2`, `h3` so a
  client can go straight to HTTP/3 without an Alt-Svc round-trip), **`port`**,
  **`ipv4hint`/`ipv6hint`**, **`ech`** (key 5, carries the **Encrypted Client Hello**
  config so the client can hide the SNI), and **`mandatory`** (key 0, params the client
  must understand or ignore the record).
- Resolvers can bundle the SVCB/HTTPS answer with the target's A/AAAA in the **Additional**
  section, so a browser learns address, ALPN, and ECH config in one query — Alt-Svc-like
  discovery without an HTTP RTT. This makes HTTPS records the modern vehicle for apex
  aliasing, HTTP/3 discovery, and ECH bootstrapping.

## DNSSEC internals: KSK, ZSK, RRSIG, and denial of existence

Going beyond the brief overview:

- **Two-key split**: a **KSK (Key Signing Key)** signs only the **DNSKEY RRset**, and its
  hash is what the parent publishes as the **DS**. A **ZSK (Zone Signing Key)** signs the
  actual zone RRsets. This lets you roll the ZSK frequently **without** touching the
  registrar's DS record; you only involve the parent when rolling the KSK.
- **RRSIG** fields include the **type covered**, the signing **algorithm**, **labels**,
  original TTL, **signature inception and expiration** timestamps (so validators reject
  expired signatures — a common outage cause), the **key tag**, the **signer's name**, and
  the signature. Every signed RRset has its own RRSIG.
- **DS** at the parent is a **digest** (SHA-256, etc.) of the child KSK plus the algorithm
  and digest-type numbers. Algorithm numbers to recognise: **8 = RSASHA256**, **13 =
  ECDSAP256SHA256** (now preferred — small signatures), **15 = Ed25519**.
- **Denial of existence**: **NSEC** records chain the sorted names in a zone to prove a
  gap — but that lets an attacker **walk (enumerate) the entire zone** offline. **NSEC3**
  publishes *hashed* names instead, and **NSEC3 opt-out** skips unsigned delegations. Even
  NSEC3 is crackable offline, so **RFC 9276** recommends **iterations = 0** and an empty
  salt, and providers increasingly use **compact denial / "black lies"** (RFC 4470-style
  minimally-covering NSEC synthesised on the fly, as Cloudflare does) to avoid enumeration
  entirely.
- Header/EDNS bits: **DO (DNSSEC OK)** in the EDNS OPT record requests signatures; **AD**
  in the response says the resolver validated; **CD (Checking Disabled)** tells the
  resolver to skip validation and return data even if bogus (used for debugging or when the
  *client* validates).

## Cache poisoning and SAD DNS

Off-path cache poisoning is a moving target; the defenses have layered up over time:

- **Original weakness**: a UDP answer is accepted if it matches the outstanding query —
  and originally the only unpredictable field was the **16-bit transaction ID**. An
  off-path attacker races the real authoritative reply, forging answers (often stuffing a
  malicious record into the **Additional** section). The first defense is **bailiwick
  checking**: reject records outside the zone the server is authoritative for.
- **Kaminsky (2008)**: by querying random non-existent subnames and racing referrals, an
  attacker gets many fresh chances to guess the TXID, making poisoning practical.
- **Entropy defenses**: **source-port randomization** adds ~16 bits (attacker must now
  guess port *and* TXID ≈ 2^32), and **DNS 0x20** (mixed-case QNAME encoding, echoed
  verbatim) adds bits from the query name.
- **SAD DNS (2020, CVE-2020-25705)**: a side channel that defeats source-port
  randomization. The attacker abuses the **shared global ICMP rate limit** (RFC 1812
  §4.3.2.8) — by probing many ports and observing which produce ICMP "port unreachable"
  responses via a global counter, they infer the open source port, collapsing the problem
  back to a 16-bit TXID brute force. Mitigations: **randomized ICMP rate limits** (Linux
  5.10+), disabling outbound ICMP responses, **DNS Cookies**, and ultimately **DNSSEC** (an
  attacker can't forge valid signatures).

> [!INTERVIEW]
> "Off-path attacker wants to poison your resolver in 2025 — what stops them, what's
> left?" Source-port + TXID + 0x20 + DNS Cookies raise the bar enormously; residual risk
> is SAD-DNS-class side channels, **on-path** attackers (need DoT/DoQ), and any zone that
> isn't DNSSEC-signed.

## EDNS(0) OPT pseudo-record in depth

EDNS(0) (RFC 6891) is not a header extension but a pseudo-**RR of type OPT** placed in the
**Additional** section, cleverly repurposing RR fields:

- Owner **NAME** = root (`0x00`); **TYPE** = 41 (OPT).
- The **CLASS** field is repurposed as the **requestor's UDP payload size** (e.g. 1232).
- The **TTL** field is repurposed as: **extended RCODE** (high 8 bits of the 12-bit
  code), **EDNS version** (0), the **DO (DNSSEC OK)** bit, and reserved Z bits.
- **RDATA** carries a list of options by code: **ECS = 8** (Client Subnet), **COOKIE =
  10**, **EDE = 15** (Extended DNS Errors), among others.
- The **1232-byte** buffer recommendation comes from **DNS Flag Day 2020**: it fits within
  the IPv6 minimum MTU (1280) minus IPv6+UDP headers, avoiding fragmentation while still
  larger than the legacy 512.

## The response acceptance tuple

A subtle staff-level point: for a resolver to accept a **UDP** response as the answer to
its outstanding query, *every* element of an implicit tuple must match — this is exactly
what all off-path poisoning attacks must forge simultaneously:

1. **Source IP** = the address the query was sent to,
2. **Source port** = 53 (the server's port),
3. **Destination port** = the resolver's (randomized) query source port,
4. **DNS transaction ID** = the 16-bit ID it chose,
5. **Question section** matches (name/type/class, subject to **0x20** case), and
6. **Bailiwick**: the answering server is in-zone for the records it returns.

Encrypted transports change this entirely: with **DoT/DoQ** the response rides an
authenticated TLS/QUIC channel, so a blind off-path attacker can't inject at all — the
tuple race disappears.

## Reverse DNS and PTR in depth

Reverse lookups (IP → name) live in dedicated trees:

- **IPv4** uses **`in-addr.arpa`** with the octets **reversed**: `93.184.216.34` →
  `34.216.184.93.in-addr.arpa`. **IPv6** uses **`ip6.arpa`** with the 32 hex **nibbles
  reversed**, one per label.
- **Classless delegation (RFC 2317)**: reverse zones delegate naturally on octet (`/8`,
  `/16`, `/24`) boundaries. To delegate a **sub-/24** block (e.g. a `/26` a provider hands
  a customer), RFC 2317 uses a **CNAME trick**: the provider CNAMEs each address's PTR name
  to a specially-named child zone the customer controls.
- **FCrDNS (forward-confirmed reverse DNS)**: mail servers check that the connecting IP's
  **PTR** resolves to a name whose **forward A/AAAA** points back to that same IP.
  Mismatches are a strong spam signal — which is why running your own mail server requires
  a matching PTR, and PTR is controlled by whoever owns the IP block, not by your forward
  zone.

## Common follow-up questions

- "Walk me through resolving `mail.example.co.uk` from a cold cache." Root → `.uk`
  TLD → `.co.uk` → `example.co.uk` authoritative; note that `.co.uk` is a delegation
  point, not just a label — the public suffix matters.
- "Why is the answer sometimes returned over TCP?" Truncation (TC bit) due to a
  response exceeding the (EDNS-negotiated) UDP size, DNSSEC-inflated answers, or zone
  transfers.
- "How would you implement blue/green with DNS, and what's the catch?" Weighted
  records + low TTL; catch is resolver caching means you can't instantly shift 100% and
  some clients ignore/clamp TTLs.
- "Difference between a CNAME and an ALIAS?" CNAME is a standard record that can't
  sit at the apex and can't coexist with other types; ALIAS/ANAME is a provider
  synthesis that returns A/AAAA at query time and *can* live at the apex.
- "Does DNSSEC encrypt my queries?" No — it authenticates/integrity-protects
  answers. DoT/DoH provide confidentiality.
- "Why did my new subdomain 404/NXDOMAIN for a while even though I added the
  record?" Negative caching (RFC 2308) of the earlier non-existent answer for the SOA
  minimum window.
- "What is EDNS Client Subnet and its trade-off?" Forwards a truncated client subnet
  to authoritative servers for better GeoDNS accuracy, at a privacy cost; RFC 7871.
- "`dig` shows the answer but the app can't resolve it — why?" `dig` talks straight to
  a resolver; the app goes through `getaddrinfo`/nsswitch (hosts file, OS negative cache,
  Happy Eyeballs), and `resolv.conf` `search`/`ndots` can rewrite the name. The classic
  case is Kubernetes' default `ndots:5`, which appends search domains and fires several
  NXDOMAIN lookups before the absolute name — latency and NXDOMAIN storms.
- "Why do you need glue records?" When a zone's nameservers live inside the zone
  itself, the parent must publish their A/AAAA as glue in the referral, or resolution
  deadlocks trying to resolve the nameserver name.
- "Draw a DNS packet / how does a resolver match a response to its query?" 12-byte
  header (ID, flags, four counts) + Question/Answer/Authority/Additional; the response is
  matched by transaction ID plus the question (and, on UDP, the src IP/port tuple).

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
- RFC 1982 — Serial Number Arithmetic (SOA serial wraparound)
- RFC 1995 — Incremental Zone Transfer in DNS (IXFR)
- RFC 1996 — A Mechanism for Prompt Notification of Zone Changes (NOTIFY)
- RFC 2136 — Dynamic Updates in the DNS (UPDATE opcode)
- RFC 2317 — Classless IN-ADDR.ARPA delegation
- RFC 6555 / 8305 — Happy Eyeballs (v1 / v2)
- RFC 7873 / 9018 — DNS Cookies
- RFC 8914 — Extended DNS Errors (EDE)
- RFC 8945 — Secret Key Transaction Authentication for DNS (TSIG)
- RFC 8767 — Serving Stale Data to Improve DNS Resiliency (serve-stale)
- RFC 9156 — DNS Query Name Minimisation to Improve Privacy
- RFC 9250 — DNS over Dedicated QUIC Connections (DoQ)
- RFC 9276 — Guidance for NSEC3 Parameter Settings
- CVE-2020-25705 — SAD DNS (side-channel port inference via ICMP rate limit)
- IANA Root Servers — https://www.iana.org/domains/root/servers
