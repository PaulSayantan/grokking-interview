# Rate Limiting, DoS/DDoS Defense & Abuse Prevention

**Denial of Service (DoS)** attacks target the **availability** leg of the CIA triad: instead
of stealing or corrupting data, the adversary makes a system **unavailable** to legitimate
users by exhausting a finite resource — bandwidth, CPU, memory, socket/connection tables,
worker threads, database connections, disk, or a *budget*. **Rate limiting** and **abuse
prevention** are the defensive disciplines that keep any single client (or coordinated set
of clients) from consuming a disproportionate share of those resources.

This topic is deliberately **language- and framework-agnostic**. We reason at the
**threat/mechanism altitude**: what resource is being exhausted, at which network layer, and
which control (a rate-limiting algorithm, a protocol fix, an upstream scrubber, a CAPTCHA)
neutralizes it. The client-facing *contract* view of rate limits (how an API documents its
quotas, headers, and back-off guidance to consumers) belongs to **rest-api-design**; here we
take the **abuse-defense operator's** view.

> [!KEY-TAKEAWAY]
> Every DoS is **resource exhaustion**. To defend, first name the *finite resource* being
> consumed and the *layer* it lives at (L3/4 bandwidth & packets vs L7 CPU/queries), then pick
> a control that bounds consumption at that layer. Rate limiting bounds **request rate per
> key**; it does *not* stop a volumetric flood that saturates your uplink before packets ever
> reach your app — that requires **upstream** capacity (CDN/scrubbing).

> [!INTERVIEW]
> Classic probes: *"token bucket vs leaky bucket — which allows bursts?"* (token bucket),
> *"fixed-window vs sliding-window and the boundary-burst problem"*, *"what status code and
> header tell a client to slow down?"* (`429` + `Retry-After`), *"how do you rate-limit across
> many app servers?"* (shared atomic counter store), and *"what's an amplification attack and
> why does it use UDP + spoofed source IP?"* Being able to also explain **SYN cookies**,
> **slowloris**, **ReDoS**, and **economic/bill-shock DoS** covers most of the surface.

Authoritative anchors used throughout: **OWASP** (Denial of Service Cheat Sheet, WSTG DoS
tests, ASVS V11 "Business Logic" & rate-limiting requirements), **NIST SP 800-61** (Incident
Handling) and **SP 800-53** (SC-5 Denial-of-Service Protection), **RFC 6585 §4** (HTTP 429),
**RFC 7231 §7.1.3** (`Retry-After`), **RFC 4987** (TCP SYN Flooding & SYN cookies),
**RFC 9110** (HTTP semantics), **CWE-400** (Uncontrolled Resource Consumption), **CWE-770**
(Allocation Without Limits), **CWE-1333** (Inefficient Regular Expression Complexity / ReDoS),
**CWE-776** (XML Entity Expansion / "billion laughs").

---

## DoS vs DDoS

A **Denial-of-Service (DoS)** attack comes from a **single source** — one host, one IP,
one script — trying to overwhelm a target. Because it has a single origin, it is comparatively
easy to mitigate: block or throttle the offending IP/ASN and the attack stops.

A **Distributed Denial-of-Service (DDoS)** attack drives the same resource exhaustion from
**many coordinated sources** simultaneously — typically a **botnet** of compromised devices
(IoT cameras, routers, servers), or many reflectors (see amplification). Distribution is what
makes DDoS hard:

- **No single IP to block.** Traffic arrives from thousands/millions of distinct addresses, so
  simple per-IP blocklisting fails; you'd block real users behind shared NATs/CGNAT too.
- **Aggregate volume** can dwarf any single link, so the fix is often *upstream* of you.
- **Source IPs are frequently spoofed** (for UDP-based floods), so you cannot trust the source
  address at all.

> [!TIP]
> Rough industry heuristic: an attack from a handful of coordinated nodes on different networks
> is what distinguishes a *distributed* DoS from a plain DoS. The defensive implication matters
> more than the exact count: **single-source → block at the edge; distributed → absorb/scrub
> upstream and rely on statistical/behavioral controls, not per-IP blocks.**

**Threat-model framing.** DoS is an availability attack, distinct from confidentiality
(data theft) and integrity (tampering) attacks. It can be a goal in itself (extortion —
"ransom DDoS," hacktivism, competitive sabotage) or a **smokescreen**: flooding the SOC with
alerts while a quieter intrusion proceeds.

## Attack layers: volumetric, protocol, application

DoS attacks are usually classified by the OSI/TCP-IP layer whose resource they exhaust. Naming
the layer immediately narrows which defense applies.

| Class | Layer | Resource exhausted | Examples | Primary defense |
|---|---|---|---|---|
| **Volumetric** | L3/L4 | Bandwidth (bits/sec) | UDP/DNS/NTP/memcached amplification, ICMP flood | Upstream capacity: CDN/anycast, scrubbing centers, BGP diversion |
| **Protocol / state-exhaustion** | L3/L4 | Connection tables, firewall/LB state (packets/sec) | SYN flood, ACK flood, fragmented-packet attacks | SYN cookies, stateless filtering, connection-rate limits |
| **Application (L7)** | L7 | CPU, threads, DB conns, memory | Slowloris, HTTP flood, expensive-query abuse, ReDoS, zip/XML bombs | Rate limiting per key, WAF, timeouts, query cost caps, CAPTCHA |

Key intuition on **units**: volumetric attacks are measured in **Gbps/Tbps** (bandwidth);
protocol attacks in **packets/sec (pps)** or **half-open connections**; L7 attacks in
**requests/sec** — and a *tiny* request rate can still be devastating if each request is
expensive (a single unbounded search query, a report export, a crypto operation).

> [!WARNING]
> An application-layer rate limiter (requests/sec per key) is **useless against a volumetric
> flood** that saturates your ingress pipe: the packets never reach your application to be
> counted. Volumetric defense must happen *upstream*, where there is more capacity than the
> attack. Match the control to the layer.

## Volumetric and amplification attacks

**Volumetric** attacks aim to fill the victim's network pipe with sheer bit volume. The most
efficient way to generate huge volume from limited attacker bandwidth is **reflection with
amplification**, which exploits **connectionless UDP protocols**:

1. The attacker sends a *small* request to a public server (the **reflector**) but **spoofs
   the source IP** to be the *victim's* address (UDP has no handshake, so the source is never
   verified).
2. The reflector sends a *much larger* response — to the victim.
3. Repeat across thousands of reflectors. The victim is buried under responses it never asked
   for, and the traffic appears to come from legitimate services.

The **amplification factor** = response size ÷ request size. Well-documented factors
(US-CERT / real incidents):

| Protocol | Amplification factor | Abused feature |
|---|---|---|
| **DNS** | up to ~**28–54×** (ANY queries; ~179× cited in some tables) | large `ANY`/DNSSEC responses |
| **NTP** | up to ~**556×** | the `monlist` command (returns last 600 clients) |
| **memcached** | up to ~**10,000–51,000×** | UDP-exposed memcached (port 11211), huge stored values |

The 2018 **1.35 Tbps GitHub** and **1.7 Tbps** attacks used exposed **memcached** servers —
the highest amplification factor known. NTP `monlist` was fixed in `ntpd` 4.2.7; memcached UDP
was disabled by default in 1.5.6.

**Defenses (mostly upstream / ecosystem-level):**
- **Anycast + massive edge capacity / CDN**: spread and absorb the flood across many PoPs.
- **Traffic scrubbing centers**: divert traffic (via BGP announcement) through a filter that
  drops attack packets and forwards clean traffic.
- **BCP 38 / RFC 2827 source-address validation (ingress filtering)**: network operators drop
  spoofed-source packets at the edge, choking reflection at its root. (Requires broad ISP
  adoption — the reason these attacks persist.)
- **Don't run open reflectors**: firewall UDP services (memcached, DNS resolvers, NTP) so they
  aren't reachable from the internet; disable `monlist`.

## Protocol attacks: SYN flood and SYN cookies

The canonical **state-exhaustion** attack is the **TCP SYN flood**. TCP opens with a
three-way handshake: client `SYN` → server `SYN-ACK` → client `ACK`. When the server receives
a `SYN` it allocates a **half-open connection** in a bounded **SYN backlog** queue and waits
for the final `ACK`.

**The attack:** send a torrent of `SYN` packets with **spoofed source IPs** and never send the
final `ACK`. Each fills a slot in the backlog; the server holds the slot (and retransmits
`SYN-ACK` with timeouts) until it expires. Once the backlog is full, **legitimate** `SYN`
packets are dropped — the server can no longer accept connections, without any bandwidth being
saturated. It's a *per-connection-state* attack, not a bandwidth attack.

**Defense — SYN cookies (RFC 4987):** instead of allocating state on the first `SYN`, the
server encodes the connection state into the **initial sequence number** of its `SYN-ACK`
(a cryptographic hash of the connection tuple + a slowly changing secret + a coarse timestamp),
then **discards the half-open entry**. When a legitimate client returns the final `ACK`, its
acknowledgment number = server ISN + 1, so the server can **reconstruct and validate** the
connection statelessly. No backlog slot is consumed until the handshake completes, so a flood
of bare `SYN`s costs the server almost nothing.

> [!TIP]
> SYN cookies trade a little functionality for statelessness: because state isn't stored, some
> TCP options (like large windows/SACK negotiated in the original SYN) can be lost. Modern
> stacks therefore enable SYN cookies **only when the backlog is under pressure**, not always.

Other protocol attacks: **ACK floods**, **RST/FIN floods**, **fragmentation attacks**
(reassembly buffer exhaustion), and **TCP connection floods** (open real connections and idle
them). Defenses include connection-rate limiting, aggressive timeouts, and stateless packet
filtering at the edge.

## Application-layer (L7) attacks: slowloris and expensive endpoints

**L7 attacks** exhaust *application* resources (worker threads, connections, CPU, DB pool)
with far less traffic than volumetric attacks — often looking like "valid" HTTP. They're
harder to distinguish from real traffic, which is what makes them dangerous.

**Slowloris (slow-and-low / low-bandwidth DoS).** Rather than sending many requests fast, the
attacker opens **many connections** and sends each HTTP request **excruciatingly slowly** — a
partial header line every few seconds, never completing the request. A thread-per-connection
or connection-limited server keeps each connection *open and occupied* waiting for the rest.
With a few hundred trickling connections, all worker slots are tied up and legitimate users get
no connection — using **kilobits per second** of bandwidth.

Variants: **Slow POST (R-U-Dead-Yet)** dribbles a huge `Content-Length` body slowly; **Slow
Read** advertises a tiny TCP receive window so the server can't flush its response.

**Defenses:**
- **Aggressive request/header/body read timeouts** — if a client hasn't sent a complete request
  within N seconds, drop it. This is the primary fix.
- **Minimum data-rate enforcement** (drop connections below X bytes/sec).
- **Cap connections per source IP**; use an **event-driven / async** front proxy (nginx,
  reverse proxies) that doesn't dedicate a thread per connection.
- Put a buffering **reverse proxy / CDN** in front that only forwards *complete* requests to
  the origin.

**Expensive-endpoint / query abuse.** Some endpoints cost far more than others: full-text
search with wildcards, unbounded pagination or `limit`, report/PDF exports, image resizing,
regex-heavy validation, password hashing (deliberately slow!), GraphQL deeply nested queries,
or "download all my data." A modest request rate against these can exhaust CPU/DB. Defenses:
**per-endpoint (weighted) rate limits**, **query cost analysis / depth limits** (GraphQL),
**pagination caps**, **timeouts + circuit breakers**, and offloading heavy work to async queues.

## Algorithmic-complexity DoS: ReDoS, zip and XML bombs

A subclass of L7 DoS exploits **algorithmic complexity**: a *small* input triggers
*super-linear* (often exponential) work or memory. The input is tiny, so no rate limiter based
on request *count* or *size* catches it.

**ReDoS (Regular-expression DoS — CWE-1333).** A poorly written regex with **nested/overlapping
quantifiers** (e.g. `(a+)+$`, `(a|a)*$`, `(.*a){20}`) causes **catastrophic backtracking** on a
crafted non-matching input, driving matching time to **exponential** in input length. A ~30-char
string can hang a CPU for seconds to minutes.

```
Vulnerable regex:   ^(a+)+$
Malicious input:    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaX"   (30 a's + non-matching char)
Effect:             backtracking explores 2^n paths → CPU pinned, thread stuck
```

Defenses: use a **linear-time engine** (RE2 / Rust `regex`, which forbid backtracking), avoid
nested quantifiers, **bound input length** before matching, set **match timeouts**, and treat
untrusted regexes as untrusted code (never let users supply patterns).

**Zip bomb (decompression bomb).** A tiny compressed file expands to gigabytes/petabytes on
decompression (`42.zip` → ~4.5 PB via nested archives). Defenses: **cap decompressed size**
and reject when a running total exceeds a limit; limit nesting depth; enforce a max
**compression-ratio**.

**XML "billion laughs" / entity expansion (CWE-776).** Nested XML entity definitions expand
exponentially:

```xml
<!ENTITY lol "lol">
<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
<!ENTITY lol3 "&lol2;&lol2;...">   <!-- and so on to lol9 -->
```

A ~1 KB document expands to gigabytes in memory. Defenses: **disable DTD / external entity
processing** in the XML parser (this also kills XXE), or cap entity-expansion limits. Same idea
applies to JSON/YAML: cap document size, nesting depth, and key count.

> [!WARNING]
> These attacks defeat naive rate limiting because the *cost is in the payload, not the count*.
> You must bound the **work** (regex timeout, decompressed size, parse depth), not just the
> request rate.

## Rate-limiting algorithm: token bucket

The **token bucket** is the most common rate-limiting algorithm because it enforces an
**average rate while permitting controlled bursts** — matching real traffic, which is bursty.

**Mechanism:** a bucket holds up to **B** tokens (the *burst capacity*). Tokens are **refilled
at rate R** tokens/sec up to the cap B. Each request must **remove one token** (or *cost*
tokens for weighted endpoints); if the bucket is empty, the request is rejected (or queued).

```
capacity B = 10 tokens, refill R = 5 tokens/sec
- Idle a while → bucket fills to 10.
- A burst of 10 requests arrives at once → all 10 pass (drains bucket).
- Sustained load → limited to 5 req/sec (the refill rate).
```

Properties:
- **Allows bursts up to B**, then throttles to the steady rate R. This is the defining feature.
- Requires storing only `{tokens, last_refill_timestamp}` per key — cheap and O(1); tokens are
  computed lazily on access (`tokens = min(B, tokens + (now - last)·R)`).
- Two independent knobs: **B** (how bursty) and **R** (sustained rate).

Token bucket is used by AWS API Gateway, many CDNs, and network shapers. It is the standard
answer to *"which algorithm allows bursts?"*

## Rate-limiting algorithm: leaky bucket

The **leaky bucket** enforces a **smooth, constant output rate** regardless of how bursty the
input is — think of a bucket with a hole that leaks at a fixed rate.

**Mechanism (as a queue):** incoming requests are added to a FIFO queue of bounded size; the
processor **drains** (services) them at a **constant rate**. If the queue is full, new requests
are **dropped**. Output is perfectly smooth.

**Token bucket vs leaky bucket** — the interview contrast:

| | Token bucket | Leaky bucket (queue) |
|---|---|---|
| Bursts | **Allowed** up to bucket size, then throttled | **Smoothed out** — output is always constant |
| Output shape | Bursty then steady | Constant/flat |
| Data structure | Counter + timestamp | FIFO queue |
| Good for | APIs where short bursts are fine | Protecting a downstream that needs steady, predictable load |
| Latency | Low (immediate pass if tokens) | Can add queuing delay |

> [!TIP]
> A "leaky bucket as a meter" variant (GCRA — Generic Cell Rate Algorithm) is mathematically
> close to token bucket and used by some limiters (e.g. Redis-cell). The distinction that
> matters for interviews: **token bucket permits bursts; a leaky-bucket queue enforces a flat
> output rate and adds queuing delay**.

## Fixed vs sliding window and the boundary-burst problem

**Fixed window counter.** Divide time into fixed windows (e.g. per calendar minute). Keep one
counter per key per window; increment on each request; reject when it exceeds the limit; reset
at the window boundary.

- **Pro:** trivially cheap — one integer per key, `INCR` with a TTL.
- **Con — the boundary/edge burst:** a client can send the full limit at the *end* of window 1
  and the full limit at the *start* of window 2, delivering **2× the limit** in a short span
  straddling the boundary.

```
Limit = 100/min.
23:59:30 → 100 requests (window "23:59" filled)
00:00:10 → 100 requests (window "00:00" fresh)
Result: 200 requests in ~40 seconds — double the intended rate.
```

**Sliding window log.** Store a **timestamp for every request** in a sorted set; to decide, count
timestamps within `[now - window, now]`, evicting older ones. **Exact** and burst-proof, but
**memory grows with request volume** (one entry per request) — expensive at scale.

**Sliding window counter (approximation).** The common production compromise: keep the current
and previous fixed-window counts and **weight the previous window** by how much of it still
overlaps the sliding window:

```
estimate = current_count + previous_count · (overlap_fraction_of_previous_window)
e.g. 25% into the current minute →
estimate = current + previous · 0.75
```

Bounds the boundary burst with only two counters per key (O(1) memory). It's an approximation
(assumes uniform distribution within a window) but good enough for almost all APIs — this is
what CloudFlare and many gateways use.

| Algorithm | Memory | Burst-accurate? | Notes |
|---|---|---|---|
| Fixed window | O(1) | No (2× boundary burst) | Cheapest, coarse |
| Sliding window **log** | O(requests) | **Exact** | Precise but memory-heavy |
| Sliding window **counter** | O(1) | Approximate | Best practical balance |
| Token bucket | O(1) | Allows defined burst | Two knobs (rate + burst) |

## Per-key dimensioning: IP, user, API key, tenant

A rate limit is meaningless without deciding **what to count by** — the **key/dimension**.
Choosing wrongly either lets attackers evade the limit or punishes innocent users.

| Key | Pros | Pitfalls |
|---|---|---|
| **Source IP** | Works for anonymous/pre-auth traffic (login, signup) | **CGNAT / shared NAT / corporate proxies** put many real users behind one IP → collateral throttling; IPv6 attackers rotate through huge address space; proxy/`X-Forwarded-For` can be spoofed if you trust it blindly |
| **User account / session** | Fair per human; survives IP changes (mobile) | Requires authentication — useless for pre-auth abuse; attacker can create many accounts |
| **API key / client ID** | Aligns with billing/quota; stable identity | Leaked keys; one key shared across many callers |
| **Tenant / org** | Prevents one customer starving others (noisy-neighbor / multi-tenant fairness) | Needs tenant context resolved early in the pipeline |

**Best practice — layered limits.** Apply *several* limits simultaneously at different
granularities: a strict **per-IP** limit on **unauthenticated** endpoints (login, password
reset, signup) to blunt credential stuffing, plus **per-user/per-API-key** limits once
identity is known, plus a **global** ceiling to protect the whole service.

> [!WARNING]
> If you rate-limit by client IP taken from `X-Forwarded-For`, you must trust that header
> **only from your own proxy** and take the correct hop. A naive `X-Forwarded-For: 1.2.3.4`
> supplied by the attacker lets them forge a fresh "IP" per request and bypass the limit
> entirely. Strip/normalize the header at the edge and use the leftmost *trusted* value.

**Login endpoints deserve special mention:** rate-limit **per account** *and* **per IP**, add
**progressive delays** and **account lockout with care** (lockout by username lets an attacker
DoS a victim's account — prefer per-IP throttling + CAPTCHA + risk-based step-up).

## Distributed rate limiting and counter consistency

On a single server, a rate limiter is just an in-memory counter. Across a **fleet of N app
servers behind a load balancer**, per-instance counters mean the *effective* limit becomes
~N× the intended limit (each server counts only the requests it happens to receive). The
counter state must be **shared**.

**Approaches, with trade-offs:**

1. **Centralized store (Redis/Memcached) with atomic ops.** All instances `INCR` a shared key
   (with TTL) or run an atomic **Lua script** (read-modify-write must be atomic to avoid races).
   - **Pro:** accurate, simple mental model. Most common.
   - **Con:** every request needs a network round-trip; the store is a **throughput bottleneck
     and single point of failure**. Mitigate with pipelining, sharding by key, and a
     **fail-open vs fail-closed** decision.
2. **Local counters + async sync / gossip.** Each node counts locally and periodically
   reconciles. Lower latency, but **eventually consistent** → transient overshoot.
3. **Approximate / probabilistic** (e.g. divide the global budget across nodes, or sticky
   routing by key so the same key always hits the same node/shard).

> [!WARNING]
> A read-then-write counter (`GET`, compare, `SET`) is a **race condition** under concurrency:
> two instances read "99", both allow, both write "100" — the 101st, 102nd… slip through. Use
> an **atomic** primitive (`INCR`, `INCRBY`, or a Lua script executed server-side) so the
> check-and-increment is indivisible.

**Fail-open vs fail-closed.** If the rate-limit store is unreachable, do you allow all traffic
(**fail-open** — preserves availability but removes protection) or reject it (**fail-closed** —
preserves protection but *becomes* a self-inflicted DoS)? The right choice is contextual:
fail-open for general public traffic (availability first), fail-closed for a control that
guards something dangerous (e.g. an OTP send endpoint that costs money per call).

## 429 Too Many Requests and Retry-After

When a client exceeds a limit, the correct HTTP response is **`429 Too Many Requests`**
(defined in **RFC 6585 §4**). It signals a *client* error (the 4xx class): the request was
well-formed but the client is being rate-limited.

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 30
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 30

{"error":"rate_limited","message":"Too many requests. Retry after 30 seconds."}
```

- **`Retry-After`** (RFC 7231 §7.1.3 / RFC 9110): tells the client **how long to wait** — either
  a delay in **seconds** (`Retry-After: 30`) or an **HTTP-date** (`Retry-After: Wed, 21 Oct 2026
  07:28:00 GMT`). Well-behaved clients honor it; it prevents them from hammering harder.
- **`RateLimit-*` headers** (the IETF `draft-ietf-httpapi-ratelimit-headers`) advertise the
  limit, remaining budget, and reset — the *client-contract* side (owned by rest-api-design).

**Related codes and the distinctions interviewers probe:**
- **`429`** — the client hit *its* rate limit. Include `Retry-After`.
- **`503 Service Unavailable`** — the *server* is overloaded/down; also may carry `Retry-After`.
  Use 503 when *you're* shedding load globally, 429 when a *specific client* exceeded a quota.
- **`403`** is wrong for rate limiting (that's authorization). Returning `200` and silently
  dropping is also wrong — clients can't back off correctly.

> [!TIP]
> Pair `429`/`503` with **exponential backoff + jitter** guidance for clients. Without jitter,
> all throttled clients retry at the same instant → a **thundering-herd / retry-storm** that
> re-DoSes you the moment the window resets. Server-side, prefer **load shedding** (reject
> cheaply and early) over letting requests queue until they time out.

## Abuse prevention: CAPTCHA, proof-of-work, progressive backoff

Rate limiting bounds *volume*; **abuse prevention** raises the *cost* of each malicious action
so automated abuse (credential stuffing, scraping, spam signups, inventory scalping, fake
account creation) becomes uneconomical. These are complementary layers.

- **CAPTCHA / challenge** ("Completely Automated Public Turing test"): forces a human-solvable
  challenge that bots find costly. Modern variants (reCAPTCHA v3, hCaptcha, Turnstile) are
  **risk-scored and mostly invisible**, only challenging suspicious sessions. Trade-offs:
  accessibility burden, solvable by human CAPTCHA-farms, and UX friction — so trigger it
  **adaptively** (on risk signals), not on every request.
- **Proof-of-Work (PoW)**: require the client to solve a small computational puzzle (find a
  nonce whose hash has N leading zeros) before the request is served. Cheap for one legitimate
  request, **expensive at scale** — it makes floods cost the attacker CPU. Used by anti-spam
  (Hashcash) and some anti-DDoS challenge pages. Weakness: attackers with GPUs/botnets have
  cheap compute; asymmetric (attacker-cheap) if not tuned.
- **Progressive backoff / tarpitting**: increase the delay or difficulty with each successive
  failure from the same key — e.g. after 3 failed logins add a 1s delay, then 2s, 4s, 8s…
  Slows brute-force to a crawl while barely affecting a legitimate user who mistypes once.
- **Device fingerprinting, behavioral biometrics, and risk scoring**: distinguish humans from
  bots by signals (mouse movement, TLS/JA3 fingerprint, header order, timing) and reserve hard
  challenges for high-risk sessions.

> [!INTERVIEW]
> *"How do you stop credential stuffing?"* Layered: per-IP **and** per-account rate limits,
> **CAPTCHA on risk**, **breached-password checks** (NIST SP 800-63B), **MFA**, device/risk
> scoring, and monitoring for distributed low-and-slow attempts (many IPs, one password
> sprayed across many accounts — *password spraying* — which per-account limits alone miss).

## WAF, CDN and upstream scrubbing defense

Because volumetric and many L7 attacks are best handled **before** traffic reaches your origin,
much DoS defense lives **upstream**.

- **CDN / reverse proxy at the edge**: terminates connections, **absorbs volume across a global
  anycast network**, serves cached responses without touching origin, buffers slow requests
  (killing slowloris), and hides the origin IP. Massive aggregate capacity is the practical
  answer to volumetric floods — you rent capacity larger than the attack.
- **Web Application Firewall (WAF)**: inspects L7 traffic and blocks by rules/signatures
  (known bad patterns, bad bots, geo/ASN, and **rate-based rules** that block IPs exceeding a
  threshold). Good for L7 floods and known exploits; like all signature systems it is
  **bypassable** and best used as **defense in depth**, not the sole control.
- **DDoS scrubbing / mitigation services**: when under attack, **BGP-divert** traffic through a
  scrubbing center that filters attack packets and forwards clean traffic (or "always-on"
  inline). This is how multi-hundred-Gbps/Tbps floods are absorbed.
- **Anycast + generous over-provisioning**: spread load across many PoPs so no single site is
  the choke point.
- **Origin protection**: lock the origin to accept traffic **only from the CDN/WAF** (IP
  allowlist / mTLS / shared secret header) so attackers can't bypass the edge by hitting the
  origin directly.

> [!WARNING]
> A common real-world bypass: the attacker finds the **origin IP** (via DNS history, TLS certs,
> or a leaky subdomain) and attacks it **directly, skipping the CDN/WAF entirely**. If your
> origin firewall still accepts public traffic, all your edge protection is moot. Always
> restrict the origin to your edge provider's IP ranges.

## Autoscaling vs bill-shock (economic denial of service)

**Autoscaling** — adding capacity automatically under load — is often pitched as DoS defense:
"just scale out." But scaling to meet an *attack's* demand converts an **availability** problem
into a **financial** one. This is **Economic Denial of Sustainability (EDoS)** / **bill-shock
DoS**: the attacker can't take you down, but they run up a ruinous cloud bill (compute, egress
bandwidth, per-request serverless invocations, downstream API/database costs) until you either
go bankrupt or throttle yourself.

- **Serverless / pay-per-request** (Lambda, API Gateway, DynamoDB on-demand) is especially
  exposed: there's no capacity ceiling to hit, so cost scales linearly with the flood.
- **Egress bandwidth** is often the priciest line item — a flood that triggers large responses
  (or an amplified download) can dominate the bill.

**Defenses:**
- **Hard budgets & concurrency ceilings**, not just autoscale — set a **maximum** scale/
  concurrency cap so the system sheds load (429/503) instead of scaling infinitely.
- **Billing alarms and anomaly detection** to catch runaway cost early.
- **Rate limiting + CDN caching + WAF** so the flood is filtered *before* it triggers billable
  work.
- **Cost-aware architecture**: cache aggressively, cap response sizes, and put expensive
  downstreams behind their own quotas.

> [!KEY-TAKEAWAY]
> Autoscaling protects *availability* but can amplify *cost* under attack. Pair it with **hard
> ceilings, load shedding, and billing alarms** so an attacker can't turn "stay up" into "go
> broke." The choice between *degrade/shed* and *scale (and pay)* is a business decision that
> should be made deliberately, not defaulted.

## Common follow-up questions

- **"Token bucket vs leaky bucket — which allows bursts?"** Token bucket: it accumulates up to
  B tokens during idle periods, so a burst up to B passes, then the sustained rate is the refill
  rate R. A leaky-bucket queue smooths output to a constant rate and adds queuing delay.
- **"What's the boundary-burst problem with fixed windows and how do you fix it?"** A client can
  send a full limit at the end of one window and another full limit at the start of the next,
  yielding ~2× the limit around the boundary. Fix with a **sliding-window counter** (weight the
  previous window) or a **sliding-window log** (exact but memory-heavy).
- **"How do you rate-limit across many servers?"** Shared atomic counter (Redis `INCR`/Lua) so
  the check-and-increment is atomic; decide fail-open vs fail-closed if the store is down.
- **"Why do amplification attacks use UDP with a spoofed source IP?"** UDP is connectionless
  (no handshake to verify the source), so the reflector believes the spoofed victim asked, and
  sends a much larger response to the victim. TCP's handshake makes this impractical.
- **"How do SYN cookies work?"** The server encodes connection state into the SYN-ACK sequence
  number and stores no half-open entry, reconstructing state from the client's final ACK — so a
  SYN flood consumes no backlog.
- **"What status code and header signal a client to slow down?"** `429 Too Many Requests`
  (RFC 6585) with `Retry-After`; use `503` for whole-service overload.
- **"Why add jitter to client retries?"** Without jitter, all throttled clients retry
  simultaneously → thundering-herd/retry-storm re-DoSing the service. Jitter spreads retries.
- **"How is slowloris different from an HTTP flood?"** Slowloris uses *few, slow, incomplete*
  connections to tie up worker slots (low bandwidth); an HTTP flood sends *many fast* complete
  requests (high rate). Slowloris is fixed with read timeouts; floods with rate limiting/WAF.
- **"What is ReDoS and how do you prevent it?"** Catastrophic backtracking from nested
  quantifiers turns regex matching exponential; fix with linear-time engines (RE2), input-length
  caps, match timeouts, and never accepting user-supplied patterns.
- **"How do you defend a login endpoint from brute force without enabling account-lockout DoS?"**
  Per-IP + per-account throttling, progressive delays, CAPTCHA on risk, MFA, and breached-password
  checks — avoid hard lockout keyed only on username (an attacker could lock out victims).
- **"Rate limiting didn't stop the attack — why?"** It was volumetric (packets saturated the
  uplink before reaching the app) or algorithmic (tiny payload, huge work) — wrong layer/control.

## References

- OWASP Cheat Sheet — **Denial of Service**:
  https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
- OWASP — **Application Denial of Service** / DoS attacks:
  https://owasp.org/www-community/attacks/Denial_of_Service
- OWASP WSTG — **Testing for Denial of Service** (incl. slow HTTP, ReDoS):
  https://owasp.org/www-project-web-security-testing-guide/
- OWASP ASVS v4 — rate limiting & anti-automation (V11 Business Logic):
  https://owasp.org/www-project-application-security-verification-standard/
- NIST **SP 800-61r2** — Computer Security Incident Handling Guide:
  https://csrc.nist.gov/pubs/sp/800/61/r2/final
- NIST **SP 800-53** — control **SC-5 Denial-of-Service Protection**:
  https://csrc.nist.gov/projects/risk-management/sp800-53-controls
- **RFC 6585 §4** — HTTP 429 Too Many Requests: https://www.rfc-editor.org/rfc/rfc6585
- **RFC 9110 §10.2.3 / RFC 7231 §7.1.3** — `Retry-After`: https://www.rfc-editor.org/rfc/rfc9110
- IETF **RateLimit header fields** draft: https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- **RFC 4987** — TCP SYN Flooding Attacks and Common Mitigations (SYN cookies):
  https://www.rfc-editor.org/rfc/rfc4987
- **RFC 2827 / BCP 38** — Network Ingress Filtering (anti-spoofing):
  https://www.rfc-editor.org/rfc/rfc2827
- CWE-400 (Uncontrolled Resource Consumption): https://cwe.mitre.org/data/definitions/400.html
- CWE-770 (Allocation of Resources Without Limits): https://cwe.mitre.org/data/definitions/770.html
- CWE-1333 (Inefficient Regular Expression Complexity — ReDoS): https://cwe.mitre.org/data/definitions/1333.html
- CWE-776 (XML Entity Expansion — "billion laughs"): https://cwe.mitre.org/data/definitions/776.html
- US-CERT **TA14-017A** — UDP-based amplification attacks (amplification factors):
  https://www.cisa.gov/news-events/alerts/2014/01/17/udp-based-amplification-attacks
- Cloudflare Learning Center — DDoS attack types (memcached, NTP, DNS amplification, slowloris):
  https://www.cloudflare.com/learning/ddos/what-is-a-ddos-attack/
