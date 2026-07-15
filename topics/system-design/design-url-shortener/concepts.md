# Design a URL Shortener, Pastebin, and Key-Value Store

The URL shortener (TinyURL, Bit.ly), Pastebin, and a generic key-value store are the
same problem wearing three hats. All three are: **generate a short unique key → store a
mapping from key to a blob → serve that blob back on read, at massive read scale**. The
URL shortener stores a long URL as the value; Pastebin stores a text/document blob (often
in object storage) with metadata in a DB; the KV store stores arbitrary bytes. Because
the shape is identical, this is the canonical "warm-up" system-design interview — and the
interviewer uses it to probe whether you actually understand the trade-offs behind each
building block, not whether you can draw boxes.

This document is layered per concept: **intuition → how it works → real-world usage →
trade-offs and when to pick it.** The trade-off sections are what wins interviews — for
every choice, know what you gain, what you give up, and when the alternative is better.

The generalizable building blocks you will reuse everywhere: unique ID generation,
read-through caching, sharded storage, CDN/edge, and the CAP (consistency vs
availability) decision.

---

## Requirements and scale estimation

**Functional requirements (the core):**

- `POST /shorten {long_url}` → returns a short URL (e.g. `https://sho.rt/aXb3Kd`).
- `GET /{shortkey}` → HTTP redirect to the original long URL.
- Optional: custom alias (`sho.rt/my-brand`), expiration/TTL, click analytics,
  user accounts, link editing/deletion.

**Non-functional requirements (where the interview lives):**

- **Read-heavy**: reads (redirects) dominate writes (creates) by ~100:1 to ~1000:1.
  This single fact drives almost every design decision (cache aggressively, optimize
  the read path, tolerate slightly slower writes).
- **Low latency**: redirects should be <10–100 ms; users feel every millisecond.
- **High availability**: a dead shortener breaks every link ever created — availability
  usually beats strong consistency here (a redirect being stale for a second is fine).
- **Not easily guessable/enumerable** (optional security requirement).
- **Durable**: links are expected to live for years; losing the mapping is catastrophic.

**Back-of-envelope estimation (memorize this drill):**

Assume **100 M new URLs/day** (Bit.ly-scale is order-of-magnitude here).

- Write QPS = 100 M / 86,400 s ≈ **1,160 writes/s**; peak ~2× → ~2,300/s.
- Read QPS at 100:1 read:write → **116,000 reads/s**; peak ~230,000/s.
- Storage per record: short key (7 B) + long URL (~100 B avg, cap 2 KB) + metadata
  (userId, createdAt, expiry, clicks ~ 50 B) ≈ **~500 B/record** rounded up.
- Records over 5 years: 100 M/day × 365 × 5 ≈ **182 B records** → 182 B × 500 B ≈
  **~91 TB** (order ~100 TB). Definitely needs sharding; too big for one node's RAM,
  fits comfortably on disk across a modest cluster.
- Cache sizing (80/20 rule): 20% of daily reads are hot. Daily reads ≈ 116k × 86,400 ≈
  **10 B reads/day**; 20% hot × ~500 B ≈ ... practically, cache the hottest few % of
  *distinct* keys. Even caching 100 M hot mappings × ~500 B ≈ **~50 GB** → a few Redis
  nodes. The point: the working set of hot links is tiny relative to total storage.
- Key space: with Base62 and length 7 → 62^7 ≈ **3.5 trillion** combinations; length 6 →
  62^6 ≈ 56.8 B. At 182 B records over 5 years you need length **7** to have headroom.

**Trade-off framing:** the numbers tell you (a) you are read-dominated → cache + CDN,
(b) storage needs sharding but not exotic tech, (c) key length is a capacity decision
(shorter = prettier but smaller space + higher collision risk).

---

## High-level architecture

**Intuition.** A thin, stateless write API that mints keys, a fat read path that is
almost entirely cache/CDN, and a sharded durable store behind both.

```
                         (writes ~2k/s)                 (reads ~200k/s)
     Client ── POST /shorten ──► API/Write Service       Client ── GET /aXb3Kd ──►
                                     │                                │
                                     ▼                                ▼
                            Key Generation (KGS/                 CDN / Edge (301 cache)
                            Snowflake/counter)                        │ miss
                                     │                                ▼
                                     ▼                          Redis cache (key→URL)
                            ┌─────────────────┐                       │ miss
                            │  Metadata DB     │◄──────────────────────┘
                            │ (sharded KV/SQL) │  read-through populate cache
                            └─────────────────┘
                                     │ (async)
                                     ▼
                            Analytics pipeline (Kafka → OLAP)
```

- **Write path**: validate URL → obtain unique key → persist `{key, longURL, meta}` →
  (optionally warm cache) → return short URL. Writes are cheap and rare; correctness and
  uniqueness matter more than latency here.
- **Read path**: `GET /{key}` → check CDN/edge → Redis → DB → issue HTTP redirect. This
  path must be blisteringly fast and highly available; it is 99%+ of traffic.
- **Analytics**: click events are emitted asynchronously (fire-and-forget to a queue like
  Kafka) so they never slow down or fail the redirect.

**Trade-off:** separating read and write paths (a lightweight CQRS split) lets you scale
and tune them independently — you can throw huge cache/CDN at reads and keep the write
path simple. The cost is more moving parts and eventual consistency between the paths
(a just-created link may take milliseconds to appear at all edges).

---

## Key generation approaches

There are four families of approaches to minting the short key. This is the single most
discussed part of the interview. Overview first; each has its own section below.

| Approach | Uniqueness guarantee | Coordination | Guessable? | Length control | Best when |
|---|---|---|---|---|---|
| Hash of URL (MD5/SHA + truncate) | Needs collision check | Low (stateless) | No | Fixed | Dedup identical URLs; simple |
| Counter + Base62 | Perfect (monotonic) | Central counter | **Yes (sequential)** | Grows over time | Simplest correctness; internal tools |
| Distributed ID (Snowflake) | Perfect (per-node) | Minimal (node IDs) | Somewhat (time-ordered) | ~11 chars | High write throughput, no central bottleneck |
| Pre-generated keys (KGS) | Perfect (dedup at gen) | Batch/offline | No (random) | Fixed, short | Best read/write latency; prettiest keys |

**Key encoding note.** Base62 (`[0-9a-zA-Z]`) is the standard alphabet: URL-safe, dense,
readable. Base64 adds `+ / =` which are not URL-safe (need escaping) and is case-sensitive
in ways that hurt. Some systems drop ambiguous chars (`0/O`, `1/l/I`) for human-typed
codes → "Base58" (Bitcoin, Flickr). Base62 length 7 = 62^7 ≈ 3.5 T combinations.

---

## Hashing and collision handling

**Intuition.** Hash the long URL with MD5/SHA-256, take the first N bytes, Base62-encode,
truncate to 6–7 chars. Same URL → same key (free deduplication).

**How it works.** `key = base62(truncate(md5(longURL + optional_salt), 43 bits))[:7]`.
MD5 gives 128 bits; you only keep enough for 7 Base62 chars (~41.7 bits). Truncation
means many inputs map to the same short output → **collisions are guaranteed** by the
pigeonhole principle once you have enough URLs.

**Collision handling strategies:**

1. **Check-and-retry**: before inserting, look up the candidate key. If it exists and
   maps to a *different* URL, append a salt / re-hash / add random chars and retry. Costs
   an extra read per write, and read cost rises as the table fills (birthday paradox: at
   62^7 space, collision probability becomes non-trivial around tens of millions of keys).
2. **Insert with unique constraint**, catch the DB uniqueness violation, retry with a new
   candidate. Cleaner than read-before-write under concurrency (no race window).

**Deduplication trade-off.** Hashing gives you idempotency (same URL → same key) for
free, saving storage when the same URL is shortened many times. But: (a) two users may
*want* distinct keys/analytics for the same URL, (b) you leak that someone else already
shortened a URL, and (c) if you add per-user salt to separate them, you lose the dedup
benefit. Most production shorteners do **not** dedup (each shorten is a distinct link
with its own analytics).

**Trade-offs of hashing overall.**

- Gain: stateless (any node can generate without coordination), natural dedup, keys not
  sequential/guessable.
- Give up: collisions require a read-check (extra latency + load that grows with fill),
  no clean length guarantee, and collision retries add tail latency.
- Pick it when: you want simple, coordination-free generation and dedup, and write volume
  is modest. Avoid at very high write scale where the collision-check read becomes a
  bottleneck — prefer counter/Snowflake/KGS.

---

## Counter and Base62 encoding

**Intuition.** Maintain a single global monotonically increasing integer counter. Each
new URL gets the next integer; Base62-encode it to get the short key. No collisions ever,
because integers are unique by construction.

**How it works.** `id = counter++; key = base62(id)`. `base62(125) = "cb"`, etc. A single
counter is a bottleneck and SPOF, so you distribute it:

- **Ranged/segmented counters**: each app server requests a *block* of IDs (e.g. 1,000 at
  a time) from a central allocator (ZooKeeper, a DB sequence, or Redis `INCRBY`). It hands
  them out locally and only touches the allocator once per block → cuts coordination by
  1000×. Flickr's "ticket server" and Instagram-style schemes work this way.
- **Multiple counters with disjoint ranges**: server A owns even ranges, B owns odd, or
  ZooKeeper assigns each server a unique range.

**Trade-offs.**

- Gain: **zero collisions**, trivially correct, shortest possible keys for a given number
  of records (dense sequential packing), no collision-check read.
- Give up: **keys are sequential and enumerable** → competitors/attackers can scrape your
  entire link corpus by incrementing (`sho.rt/aaa`, `aab`, ...); a serious privacy/security
  problem. Central counter is a bottleneck/SPOF unless segmented. Segmenting causes **gaps**
  (a server holding a block that crashes loses its unallocated IDs — harmless but non-dense).
- Mitigations for enumeration: XOR/multiply the counter by a secret and permute bits
  (Feistel/`optimus`-style bijective obfuscation) before Base62 so output looks random but
  is still 1:1 and collision-free.
- Pick it when: you need guaranteed uniqueness and the shortest keys, and enumeration is
  either acceptable (internal tool) or you add the obfuscation layer. This is the most
  common "textbook correct" interview answer with the segmented-counter refinement.

---

## Distributed ID generation with Snowflake

**Intuition.** Generate globally unique IDs on each node *without any coordination per
ID* by composing the ID from `timestamp + machineID + sequence`. Twitter's Snowflake is
the canonical design; Instagram, Discord (snowflakes as message IDs), and Sony's Sonyflake
are variants.

**How it works (64-bit Snowflake layout):**

```
 0 | 41 bits: timestamp (ms since epoch) | 10 bits: machine id | 12 bits: sequence
 ^ sign bit (unused, keeps id positive)
```

- 41-bit ms timestamp → ~69 years of range from a custom epoch.
- 10-bit machine ID → 1,024 nodes (often split datacenter-id + worker-id, e.g. 5+5).
- 12-bit sequence → 4,096 IDs per node per millisecond → ~4 M IDs/s/node.

Each node stamps IDs locally; the only coordination is one-time machine-ID assignment
(via ZooKeeper/etcd/config). Base62-encoding a 64-bit Snowflake yields ~11 chars — longer
than a counter or KGS key.

**Trade-offs.**

- Gain: **no per-ID coordination** → scales horizontally to millions of IDs/s, no central
  SPOF, roughly time-sortable (great for DB locality and range queries).
- Give up: **clock dependence** — if a node's clock moves backward (NTP correction), it
  can mint duplicate IDs; mitigations are to refuse to generate until the clock catches
  up, or use monotonic clocks. IDs are **longer** (11 chars) and **leak creation time +
  approximate volume** (competitors can estimate your growth from ID timestamps). Machine
  IDs must be uniquely assigned or you get collisions.
- Pick it when: write throughput is high and you must avoid a central counter, and slightly
  longer, time-ordered keys are acceptable. Not ideal when you want the shortest, opaque
  keys — then use KGS.

---

## Key generation service and pre-generation

**Intuition.** Instead of computing a key at write time, a separate **Key Generation
Service (KGS)** pre-generates a huge pool of unique random 6–7-char Base62 keys *offline*
and stores them in a database of "available" keys. At write time you just pop one.

**How it works.**

- Offline, the KGS generates random keys, dedups them (unique index), and stores them in
  an `unused_keys` table/partition; used ones move to `used_keys` (or are flagged).
- App servers request keys in **batches** (e.g. 1,000 at a time) and cache them in memory,
  so the hot write path never hits the KGS synchronously.
- Concurrency: keys must be handed out exactly once. Mark-on-fetch with a transaction, or
  move keys between two tables atomically. The KGS itself is replicated for HA; the
  "which keys are handed out" state is the tricky part.

**Trade-offs.**

- Gain: **fastest write path** (no hashing, no collision check, no counter round-trip —
  just pop a cached key), **shortest and fully random** (non-enumerable, no info leak)
  keys, and uniqueness is guaranteed at generation time.
- Give up: **operational complexity** (a whole service + a large table of keys — 62^7 keys
  is ~3.5 T rows if you materialize the full space, so you generate lazily/incrementally),
  a KGS outage stalls new-link creation (mitigated by app-server key caches), and a server
  crash with a cached batch **wastes** those keys (acceptable — the space is huge).
- Pick it when: you want the best read/write latency and prettiest opaque keys at scale,
  and you can afford to run and operate the extra service. This is the answer that most
  impresses interviewers when paired with the batch-caching detail.

---

## Read-heavy caching

**Intuition.** Redirects vastly outnumber creates and the same popular links get hit over
and over (Zipfian/power-law distribution). Cache the `key → longURL` mapping in memory so
most reads never touch the DB.

**How it works.**

- **Cache-aside (look-aside) + read-through**: on `GET /{key}`, check Redis/Memcached
  first; on hit, redirect immediately; on miss, read DB, populate cache, redirect.
- **CDN / edge cache**: because the mapping is immutable (a key's target rarely changes),
  you can cache the *redirect response itself* at the CDN/edge (Cloudflare, CloudFront),
  serving redirects geographically close to users with zero origin hits. This is where 301
  vs 302 matters (see below).
- **Eviction**: LRU/LFU. The hot working set is small (see estimation), so hit rates of
  95–99% are realistic.
- **Cache warming**: optionally pre-load a new key into cache on creation so the first
  read is a hit.

**Trade-offs.**

- Gain: massive read-latency reduction (sub-ms cache vs ms+ DB), DB load shed by 20–50×,
  cheaper scaling.
- Give up: **staleness** — if a link is edited/deleted/expired, cached copies (and 301s
  cached in browsers/CDNs) may still serve the old target until TTL expires or you
  invalidate. Cache adds a consistency dimension and cost. **Cache stampede**: a hot key
  expiring can trigger a thundering herd to the DB (mitigate with request coalescing,
  probabilistic early expiry, or negative-result caching).
- **Negative caching**: cache "this key does not exist" (with short TTL) or use a **Bloom
  filter** in front of the DB so that lookups for random/garbage/enumeration keys don't
  hammer the DB. A Bloom filter with 1% FP rate for 1 B keys is ~1.2 GB.
- Pick aggressive caching + CDN always for this workload; the only question is invalidation
  strategy (TTL vs explicit invalidation vs versioned keys).

---

## Database choice and schema

**Intuition.** The access pattern is a pure primary-key lookup: given `key`, return
`longURL`. That is the ideal case for a key-value / wide-column store, though a sharded
relational DB works fine too.

**Schema (relational or KV):**

```
url_mappings
  short_key   VARCHAR(7)  PRIMARY KEY   -- lookup key, indexed
  long_url    TEXT / VARCHAR(2048)
  user_id     BIGINT (nullable)
  created_at  TIMESTAMP
  expires_at  TIMESTAMP (nullable)      -- for TTL
  click_count BIGINT (denormalized/async)
  is_custom   BOOLEAN
```

**Options compared:**

| Store | Consistency | Read latency | Write scale | Ops complexity | Notes |
|---|---|---|---|---|---|
| Single SQL (Postgres/MySQL) | Strong | Low (with cache) | Limited (vertical) | Low | Fine to start; primary-key lookup is cheap |
| Sharded SQL (Vitess/Citus) | Strong per-shard | Low | High | Medium/High | Shard by hash(key); loses cross-shard txns |
| Key-value (DynamoDB, Cassandra) | Tunable/eventual | Very low | Very high | Medium | Ideal for PK lookups; auto-partitioned; TTL built-in |
| Redis as primary | Weak (needs persistence) | Sub-ms | High | Medium | Great as cache; risky as sole store (durability) |

**Sharding.** Partition by `hash(short_key)` (range sharding by key causes hot spots since
sequential keys land together). DynamoDB/Cassandra do this transparently via consistent
hashing on the partition key. This is where the topic literally *becomes* a distributed
KV store — the short key is the partition key.

**Trade-offs.**

- SQL: strong consistency, easy secondary indexes (for "list my links"), transactions for
  custom-alias uniqueness — but harder to scale writes and storage; you must add sharding.
- NoSQL KV/wide-column: effortless horizontal scale and built-in TTL (DynamoDB TTL,
  Cassandra TTL auto-expire) that matches the expiry requirement perfectly, tunable
  consistency (favor availability) — but weaker cross-key transactions, and secondary
  access patterns (by user) need GSIs / a second table.
- Pick DynamoDB/Cassandra at large scale (matches PK-lookup + TTL + availability needs),
  pick Postgres/MySQL for smaller scale or when you want relational features and simplicity.
  Never use Redis alone as the durable store (it's a cache; back it with a durable DB).

---

## Custom aliases, expiry, and analytics

**Custom aliases.** Users pick `sho.rt/my-brand`. Requires an **atomic uniqueness check**
(insert with unique constraint or a conditional put) — this is the one place you truly need
strong consistency, because two users must not both claim `my-brand`. Custom aliases share
the same namespace as generated keys, so you either reserve a prefix, use longer generated
keys to avoid collisions, or check both spaces. Trade-off: custom aliases reintroduce a
coordination/consistency point into an otherwise availability-first system, and they are
enumerable/guessable by nature.

**Expiry / TTL.** Links can expire (after a date, or default e.g. 2 years).
Implementation options:

- **Lazy deletion**: check `expires_at` at read time; if expired, return 404/410 and
  optionally delete. Cheap, no background job, but expired rows linger and consume storage.
- **Active deletion**: a background sweeper / cron scans for expired rows and removes them;
  or use the DB's native TTL (DynamoDB/Cassandra auto-expire). Reclaims storage and frees
  keys for reuse, but adds a background process and delete load.
- Trade-off: lazy is simplest and read-path-correct; active reclaims space and enables key
  recycling. Most systems do lazy check + native TTL cleanup.

**Analytics.** Click counts, geo, referrer, device, timestamps. **Never** update analytics
synchronously on the redirect path (it would add latency and a failure dependency to every
read). Instead emit an event asynchronously:

```
GET /{key} → redirect (fast) ── fire-and-forget ──► Kafka/Kinesis ──► stream processor
                                                          └──► OLAP store (ClickHouse,
                                                               Druid, Redshift) for dashboards
```

Trade-off: async analytics keeps redirects fast and available but makes counts eventually
consistent and approximate (you may sample or use probabilistic counters like HyperLogLog
for unique-visitor counts). This is a deliberate accuracy-for-latency trade.

---

## Redirect 301 vs 302

**Intuition.** The redirect status code decides *who caches the mapping and for how long*,
which directly trades performance against control and analytics.

- **301 Moved Permanently**: browsers, proxies, and CDNs **cache the redirect aggressively**
  (often indefinitely). Subsequent clicks skip your server entirely and go straight to the
  long URL. Fast and cheap; **but you lose analytics** (repeat clicks never hit you) and you
  **cannot change or revoke** the target for clients that cached it — a stale/hijacked link
  problem.
- **302 Found (Moved Temporarily)** / **307**: browsers do **not** cache; every click comes
  back to your server. You keep full analytics, can update/expire/revoke targets, and can
  do A/B routing — **but** every click costs a round trip to your service (more load, more
  latency, higher cost).

| | 301 | 302 |
|---|---|---|
| Client/CDN caching | Aggressive (indefinite) | None (per-request) |
| Analytics on repeat clicks | Lost | Captured |
| Can change/revoke target | No (stale) | Yes |
| Server load | Very low | High (every click) |
| Best for | Static, permanent, high-traffic vanity links | Analytics, expiring, editable, monetized links |

**Trade-off / when to pick:** commercial shorteners (Bit.ly) use **302** because analytics
and the ability to change/kill a link are the product. Use **301** when you want maximum
performance and lowest cost and the mapping is truly permanent (and you don't need
per-click analytics). A hybrid: 302 with a short `Cache-Control: max-age` gives some edge
caching while retaining eventual control. Note SEO folklore ("301 passes link juice")
matters for site migrations, not usually for shorteners.

---

## Consistency versus availability choices

**Intuition.** By CAP/PACELC, when the network partitions you must choose consistency or
availability; even without partitions you trade latency vs consistency (the "ELC" half).
A URL shortener is a textbook **AP** (availability-first) system for the read path.

- **Read path → AP / eventual consistency.** Serving a slightly stale redirect (e.g. a
  just-edited target for a few ms, or reading a replica) is harmless. You want the redirect
  to *always* work, everywhere, even during partitions. So: replicate widely, read from
  the nearest replica, tolerate eventual consistency, cache aggressively.
- **Write path → mostly AP, with CP islands.** Minting a *generated* key can be eventually
  consistent (uniqueness is guaranteed by construction with counter/Snowflake/KGS). But
  **custom-alias claiming** needs a **strongly consistent / linearizable** uniqueness check
  (CP) so two users can't grab the same alias — a small CP island in an AP system.
- **Read-your-writes**: a user who just created a link expects it to work immediately. Since
  replication/cache propagation is eventual, route the creator's first read to the primary,
  or return the key only after it's durably written to a quorum, or pin their session to the
  region that wrote it.

**Trade-offs.**

- Favoring availability: links keep resolving during failures (the whole point of the
  product) at the cost of possibly-stale targets and approximate analytics.
- Favoring consistency (for custom aliases, dedup, quotas): correct uniqueness/no
  double-claims, at the cost of write latency and unavailability during partitions for
  those specific operations.
- The elegant answer: **AP everywhere except the narrow uniqueness-critical operations,
  which you make CP.** Match consistency to each operation rather than globally.

---

## Rate limiting and abuse prevention

**Intuition.** A shortener is a magnet for abuse: spammers and phishers mint millions of
links to disguise malicious destinations; scrapers enumerate keys. You must throttle and
screen.

- **Rate limit creates** per user/IP/API-key (token bucket) to stop bulk-spam minting and
  control cost.
- **Malware/phishing screening**: check destination URLs against Google Safe Browsing /
  threat feeds at creation and/or resolve time; show an interstitial warning page for
  flagged links.
- **Prevent enumeration**: random keys (KGS/hashing) or obfuscated counters so attackers
  can't walk the space; rate-limit 404-heavy scanners.
- **Open-redirect / SSRF hygiene**: validate/normalize submitted URLs; block internal
  addresses and non-http(s) schemes.

**Trade-off:** screening and rate limiting add latency and false positives (a legit link
flagged) and infrastructure, but the reputational and security cost of being a spam vector
is far higher. Do heavy screening async where possible; keep the redirect path light.

---

## Modern patterns and where the field is heading

Interviewers in 2024–2025 like to see awareness of current patterns even on this "classic"
problem:

- **Edge compute for redirects.** Run the lookup at the CDN edge (Cloudflare Workers,
  Lambda@Edge, Fastly Compute) backed by an edge KV (Cloudflare KV, Workers KV, DynamoDB
  Global Tables). Redirects resolve within a few ms of the user globally, origin barely
  touched. Trade-off: edge KV is eventually consistent and has write-propagation delay.
- **CQRS split.** Formalize the read/write separation: a write service that mints+persists,
  a read service (mostly cache/edge) optimized purely for redirects. Independent scaling.
- **CDC (Change Data Capture).** Stream inserts/updates from the primary DB (via Debezium /
  DynamoDB Streams / Kafka) to fan out to caches, edge KV replicas, search indexes, and the
  analytics pipeline — instead of dual-writes. Trade-off: eventual consistency + pipeline ops
  in exchange for decoupling and reliable propagation.
- **Cell-based architecture.** Partition the whole stack into independent "cells" (each a
  full slice of API+cache+DB serving a subset of keys/tenants) to bound blast radius: one
  cell failing takes down only its slice. Used by AWS, Slack, DoorDash. Trade-off: routing
  complexity and per-cell overhead for dramatically better fault isolation.
- **Global tables / multi-region active-active.** DynamoDB Global Tables or Cassandra
  multi-DC for low-latency global reads and regional failover; last-writer-wins conflict
  resolution (fine, since mappings are immutable). Trade-off: eventual cross-region
  consistency, cost.
- **Object storage for Pastebin.** For Pastebin/large blobs, store the blob in S3/object
  storage and keep only metadata + the S3 pointer in the DB; serve big content via CDN.
  Keeps the DB small and cheap. This is the KV-store generalization at large value sizes.

---

## Pastebin and generic key-value store generalization

The three problems map onto one another; knowing the mapping shows depth:

| | URL shortener | Pastebin | Generic KV store |
|---|---|---|---|
| Key | short code | paste id | user/system key |
| Value | long URL (~100 B) | text/doc blob (KB–MB) | arbitrary bytes |
| Value location | in DB row | **object storage (S3)** + metadata in DB | in KV store |
| Read pattern | redirect | fetch + render (CDN) | get |
| Dominant concern | redirect latency | large-blob delivery, expiry | throughput, consistency knobs |

**Key insight for interviews:** the *only* real difference is **value size and where the
value lives**. Small values (URLs) live inline in the DB/KV row. Large values (pastes,
files) live in object storage with a pointer in the metadata DB, and are delivered via CDN.
The key-generation, caching, sharding, expiry, and CAP reasoning are **identical** across
all three — which is exactly why this is the archetypal "building blocks" interview.

---

## Failure modes and how the design degrades

- **Cache down (Redis outage):** reads fall through to the DB → latency spikes and DB load
  jumps ~20–50×. Mitigate: DB read replicas, request coalescing, in-process L1 cache, and
  serving still-fresh CDN 301/302s. Design so a cache miss is *slow*, not *failed*.
- **DB shard down:** keys on that shard become unresolvable (partial outage). Mitigate:
  replication with automatic failover, and cell-based isolation so only a slice is affected.
- **KGS / counter allocator down:** *new-link creation* stalls, but existing redirects
  (the 99% traffic) are unaffected because app servers cache pre-fetched key batches.
  Graceful partial degradation — the product's core (redirects) stays up.
- **Clock skew (Snowflake):** backward clock jump risks duplicate IDs → refuse to mint
  until the clock advances past the last-seen timestamp.
- **Hot key / celebrity link:** one viral link overwhelms a shard/cache node. Mitigate:
  the item is cacheable (so CDN/edge absorbs it), plus key-level replication and
  request coalescing.
- **Cache stampede on expiry:** many concurrent misses for a hot key hit the DB at once.
  Mitigate: single-flight/coalescing, probabilistic early recompute, staggered TTLs.
- **Analytics pipeline down:** redirects continue (async, fire-and-forget); you lose or
  buffer click events. Deliberately decoupled so analytics failure never breaks redirects.

**Design principle throughout:** the redirect path must degrade *gracefully* (slower, or
serving slightly stale data) and essentially never go fully down; everything else
(creation, analytics, custom aliases) is allowed to degrade or pause.

---

## Trade-offs and when to use what

A consolidated cheat sheet — the heart of the interview:

- **Key generation:** *Hashing* for simple, coordination-free + dedup at low write volume;
  *segmented counter* for shortest keys + guaranteed uniqueness when enumeration is OK (or
  add bijective obfuscation); *Snowflake* for very high write throughput with no central
  bottleneck, accepting longer/time-leaking keys; *KGS pre-generation* for the best latency
  and prettiest opaque keys at scale, accepting extra operational complexity. Default
  "impressive" answer at scale: **KGS with app-server batch caching**, or **segmented
  counter + obfuscation** for shortest keys.
- **Redirect code:** *301* for max performance/lowest cost on permanent links (lose
  analytics + revocation); *302* when analytics, editability, expiry, or monetization
  matter (higher load). Commercial shorteners → 302.
- **Database:** *Postgres/MySQL* for small-to-mid scale + relational features; *sharded SQL*
  when you outgrow one node but want SQL; *DynamoDB/Cassandra* for large scale, PK lookups,
  built-in TTL, and availability-first. Redis only as cache, never sole store.
- **Consistency:** *AP/eventual* for the read path and generated-key writes; *CP/linearizable*
  only for custom-alias uniqueness (and quota/dedup if used). Provide read-your-writes for
  the creator via primary reads or quorum.
- **Caching:** always cache-aside + CDN; use *301* or 302-with-max-age to leverage edge;
  add *Bloom filter / negative caching* to protect the DB from garbage/enumeration lookups.
- **Analytics:** always async (queue → OLAP); accept eventual/approximate counts to keep the
  redirect path fast and independent.
- **Expiry:** lazy check on read (simplest) + native DB TTL for cleanup; active sweep only if
  you must reclaim storage or recycle keys quickly.
- **Scale-out modern:** edge KV + CQRS + CDC for propagation, cell-based for blast-radius,
  global tables for multi-region — reach for these at global scale, not for the MVP.

---

## Common interview follow-up questions

1. How long should the short key be, and how did you compute it? (Base62, 62^7 ≈ 3.5 T;
   justify from projected record count over N years.)
2. How do you guarantee uniqueness without a single global counter bottleneck? (Segmented
   counters, Snowflake, or KGS — discuss coordination cost of each.)
3. How do you prevent users from enumerating all links by incrementing keys? (Random/KGS
   keys, or obfuscate a counter with a bijective/Feistel permutation.)
4. 301 or 302 — and how does that decision affect analytics and the ability to revoke a
   link? (Caching vs analytics/control trade-off.)
5. How do you handle a link that goes viral (hot key)? (CDN/edge absorbs it, key
   replication, request coalescing.)
6. How do you implement custom aliases without race conditions? (Atomic conditional
   insert / unique constraint — a CP island.)
7. How do you implement expiry at 100 TB scale without a giant delete job? (Native DB TTL +
   lazy read-time check.)
8. What breaks first at 10× traffic, and how does the system degrade? (Cache/DB read path;
   graceful degradation reasoning.)
9. How do you collect analytics without slowing redirects? (Async event to Kafka → OLAP;
   HyperLogLog for uniques.)
10. How would you make this globally low-latency? (Edge compute + edge KV / global tables;
    eventual consistency trade-off.)
11. How is this the same as designing Pastebin or a generic KV store? (Value size + where
    the value lives; everything else is identical.)
12. How do you prevent the shortener from becoming a spam/phishing vector? (Rate-limit
    creates, Safe Browsing screening, interstitials.)
13. What consistency model do you choose and why? (AP read path + CP custom-alias island;
    read-your-writes for creators.)

---

## References

- Alex Xu, *System Design Interview – An Insider's Guide, Vol. 1* — Ch. "Design a URL
  Shortener" and "Design a Unique ID Generator in Distributed Systems" (Snowflake).
- ByteByteGo blog & YouTube — "Design a URL Shortener", "How to Design a Unique ID
  Generator" (Snowflake breakdown), "Cache strategies" videos.
- Martin Kleppmann, *Designing Data-Intensive Applications* (DDIA) — replication,
  partitioning/sharding, consistency & CAP/linearizability, and derived-data/CDC chapters.
- The System Design Primer (GitHub, donnemartin) — "Design a system that scales to millions
  of users" and the URL-shortener exercise.
- Twitter Engineering — "Announcing Snowflake" (distributed 64-bit ID generation).
- Instagram Engineering — "Sharding & IDs at Instagram" (timestamp+shard+sequence IDs).
- Flickr Engineering — "Ticket Servers: Distributed Unique Primary Keys on the Cheap"
  (segmented counter / GET_LAST_INSERT_ID).
- AWS Architecture Blog & docs — DynamoDB partitioning, TTL, and Global Tables; Lambda@Edge.
- Cloudflare docs — Workers KV and edge redirect patterns.
- Gaurav Sen & "Jordan has no life" (YouTube) — URL shortener and unique ID generation
  system-design walkthroughs.
- Discord Engineering — "How Discord Stores Billions of Messages" (snowflake IDs,
  Cassandra) for KV-at-scale patterns.
