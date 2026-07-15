# Caching and CDN

Caching is the single highest-leverage lever in system design: it turns a
p99 of 200 ms into 2 ms, cuts database load by 90%+, and lets a handful of
boxes serve millions of QPS. But every cache is a **denormalized copy of the
truth**, and the moment you keep a second copy of data you have signed up for
a consistency problem, an invalidation problem, and a set of new failure modes
(stampede, hot keys, split brain, poisoning). This document goes layer by
layer and pattern by pattern, and for every choice states **what you gain,
what you give up, and when to pick it over the alternative** — because that
trade-off reasoning is what an interviewer is actually grading.

Two quotations frame the whole topic:

> "There are only two hard things in Computer Science: cache invalidation and
> naming things." — Phil Karlton

> "Caching is a bet that the cost of a stale read is lower than the cost of a
> slow read." — the mental model to carry into every decision below.

---

## Latency numbers and why we cache

Intuition: memory is ~100,000x faster than disk-backed remote storage, and a
same-datacenter round trip is ~100x faster than a cross-continent one. Caching
exploits the fact that most workloads are **skewed** — a small fraction of
items get most of the traffic (Zipfian / 80-20 / power-law distributions), so
a small, fast store in front of a big, slow one captures most requests.

Ballpark latency ladder (order-of-magnitude "Jeff Dean numbers", 2020s
hardware):

| Operation                              | Latency        | Notes                          |
|----------------------------------------|----------------|--------------------------------|
| L1/L2 CPU cache reference              | ~1 ns          | on-core                        |
| Main memory (RAM) reference            | ~100 ns        | local process cache            |
| Read 1 MB sequentially from RAM        | ~3-10 µs       |                                |
| SSD random read                        | ~16-100 µs     | NVMe faster                    |
| Redis/Memcached GET, same DC           | ~0.2-1 ms      | dominated by network + syscall |
| Round trip within same datacenter      | ~0.5 ms        |                                |
| Disk (spinning) seek                   | ~5-10 ms       |                                |
| RDBMS indexed query (cache miss to DB) | ~1-10 ms       | more under load                |
| Round trip US East to Europe           | ~80-100 ms     | speed of light bound           |
| Round trip US to India/Australia       | ~150-250 ms    | why CDNs/edge exist            |

Key takeaway for interviews: the CDN exists to defeat the **speed of light**
(put bytes physically near the user); the in-memory cache exists to defeat
**disk and computation cost** (avoid the expensive query/render). They solve
different problems and stack together.

Back-of-envelope: a cache hit ratio `h` and backend latency `L_miss` vs cache
latency `L_hit` gives effective latency `L = h·L_hit + (1-h)·L_miss`. At
`h=0.95`, `L_hit=1ms`, `L_miss=50ms`: `L ≈ 0.95·1 + 0.05·50 = 3.45 ms`. Note
how the **misses dominate** — going from 95% to 99% hit ratio drops effective
latency from 3.45 ms to 1.49 ms, more than halving it. Chasing the last few
points of hit ratio has outsized payoff.

---

## Cache layers from client to database

Caching is not one thing; it is a **stack of caches**, each with different
scope, TTL, and consistency properties. A request may be served from any tier;
the closer to the user, the faster and cheaper, but the harder to invalidate.

```
 [ Browser ]      HTTP cache, memory/disk, Service Worker, localStorage
     |            (private, per-user; TTL via Cache-Control)
     v
 [ CDN / Edge ]   PoPs worldwide; static assets + cacheable API responses
     |            (shared, geo-distributed; purge is eventually consistent)
     v
 [ Load Balancer / Reverse Proxy ]  Nginx/Varnish/ATS microcache
     |            (shared, single DC; sub-second TTL "microcaching")
     v
 [ Application ]  in-process (local heap: Caffeine/Guava) + distributed
     |            (Redis/Memcached cluster; shared across app fleet)
     v
 [ Database ]     buffer pool / page cache, query cache, materialized views,
     |            replica read caches
     v
 [ OS page cache / storage ]  files served from RAM by the kernel
```

- **Client (browser/mobile) cache**: fastest possible (zero network). Governed
  by HTTP headers (`Cache-Control`, `ETag`, `Expires`). Private per user, so
  great for user-specific and static assets, useless for shared server-side
  compute. You cannot force-invalidate a client cache already handed out —
  only cache-bust future fetches.
- **CDN / edge cache**: geo-distributed shared cache for static and
  cacheable dynamic content. Defeats latency (light-speed) and offloads origin
  bandwidth.
- **Reverse-proxy / gateway cache**: Nginx, Varnish, Apache Traffic Server. Can
  do "microcaching" — cache even personalized-ish responses for 1 s to absorb
  bursts.
- **Application cache**: two sub-layers — (1) **in-process/local** (on the app
  heap, nanosecond access, but per-instance and hard to keep coherent across
  the fleet); (2) **distributed** (Redis/Memcached — shared, survives deploys,
  but adds a network hop).
- **Database cache**: buffer pool / page cache (Postgres shared_buffers, InnoDB
  buffer pool), materialized views, and read replicas. Often overlooked, but
  the DB is already caching hot pages in RAM.

**Trade-off across layers:** the higher you cache (closer to the client), the
bigger the latency and cost win, but the **weaker your control over
invalidation** and the more duplication of stale copies. The lower you cache,
the more control and consistency, but the smaller the win. Real systems layer
all of them and accept different staleness bounds per layer. A classic
interview mistake is treating "add a cache" as a single decision instead of a
per-layer decision with per-layer TTLs.

---

## Cache-aside (lazy loading)

**How it works:** the application code owns the cache. On read: check cache; on
hit, return it; on miss, read the DB, populate the cache, return. On write:
write the DB, then **invalidate (delete)** the cache entry (do not update it).

```
read(k):                         write(k, v):
  v = cache.get(k)                 db.put(k, v)
  if v == null:                    cache.delete(k)   # invalidate, don't set
    v = db.get(k)
    cache.set(k, v, ttl)
  return v
```

**Real-world usage:** the default pattern for the vast majority of systems
(Facebook's memcache tier, most web apps). The cache is a **look-aside** buffer
the DB doesn't know about.

**Why delete-not-update on write?** Writing the fresh value into the cache
looks tempting but creates a race: two concurrent writers can interleave
db-write and cache-set such that the cache ends up with the older value
permanently. Deleting is idempotent and self-healing — the next read repopulates
from the source of truth. (Facebook's "Scaling Memcache" paper details exactly
this; they use `delete` plus leases.)

**Trade-offs:**
- Gain: only requested data is cached (memory-efficient); cache and DB are
  decoupled so a cache outage degrades to slower reads, not errors; resilient
  and simple; works with any datastore.
- Give up: every cache miss pays **three trips** (miss + DB + set) — first
  read after eviction/deploy is slow; the code (not infra) must remember to
  invalidate on every write path, which is error-prone; there is a **race
  window** between DB write and cache delete where a concurrent read can
  repopulate stale data (mitigated by delete-after-write ordering + short TTL,
  or CAS/lease).
- When to pick: read-heavy workloads that tolerate slight staleness; when you
  want the cache to be optional/best-effort; the safe default.

---

## Read-through and write-through

**Read-through:** the application talks only to the cache; the **cache
library/service** handles misses by loading from the DB itself (via a loader
function), then caches and returns. The app never sees the DB on reads.

**Write-through:** writes go to the cache, and the cache **synchronously**
writes to the DB before acknowledging. Cache and DB are updated together.

```
Read-through:  app -> cache.get(k) --miss--> [cache loads from db] -> app
Write-through: app -> cache.put(k,v) -> cache writes db (sync) -> ack
```

**Real-world usage:** NCache, Ehcache, AWS DAX (DynamoDB Accelerator, both
read- and write-through), Netflix EVCache loaders. The loader logic is
centralized in the cache layer instead of scattered through app code.

**Trade-offs:**
- Read-through gain: cleaner app code (cache is the single read interface); the
  loader is one place to get right. Give up: same cold-miss penalty as
  cache-aside; couples you to a cache that supports loaders; first read is slow.
- Write-through gain: cache is (almost) never stale relative to DB — reads
  right after a write see fresh data with high consistency; no invalidation
  race. Give up: every write pays cache + DB latency (higher write latency);
  you cache data that may never be read again (write amplification / memory
  waste unless combined with write-around); if the DB write fails you must roll
  back the cache write (atomicity concerns).
- When to pick write-through: read-heavy data that is re-read soon after write
  and where read-after-write consistency matters (e.g. user profile, session).
  Combine with a TTL so a bug can't pin permanently-wrong data.

---

## Write-back (write-behind)

**How it works:** writes go to the cache and are acknowledged **immediately**;
the cache asynchronously flushes to the DB later (batched, coalesced, after a
delay). The cache becomes the temporary system of record.

```
write(k,v): cache.set(k,v); enqueue_async_flush(k)   # ack now
            ... later: batch-write dirty keys -> db
```

**Real-world usage:** high-write-throughput systems — metrics/counters
(view counts, likes), write-heavy buffers, some database internals (the OS
page cache and RDBMS dirty-page flushing are write-back). Often paired with a
durable log (Kafka) so the async flush isn't the only durability guarantee.

**Trade-offs:**
- Gain: lowest write latency (write hits RAM only); absorbs write spikes;
  **coalesces** many writes to the same key into one DB write (huge for hot
  counters — 10,000 increments become one UPDATE); reduces DB write load
  dramatically.
- Give up: **durability** — if the cache node dies before flush, acked writes
  are lost (unless the cache is persisted/replicated or backed by a log); the
  DB is temporarily stale/behind; complexity of managing dirty sets, retry, and
  ordering; reads from the DB (e.g. analytics) see lagging data.
- When to pick: write-heavy, loss-tolerant or log-backed workloads (counters,
  telemetry, leaderboards); NOT for financial ledgers or anything where a lost
  write is unacceptable unless the cache is durably replicated.

---

## Write-around

**How it works:** writes go **directly to the DB, bypassing the cache**; the
cache is populated only on read (miss). Usually combined with cache-aside or
read-through for the read path.

**Real-world usage:** write-once/read-rarely or bulk-import data, logging,
time-series ingestion — data that is written far more often than it is read, or
where you don't want a write to evict hotter items.

**Trade-offs:**
- Gain: avoids flooding the cache with write-only data that would never be read
  (no cache pollution / no evicting hot keys with cold ones); DB stays the
  source of truth.
- Give up: a read immediately after a write is a **guaranteed miss** (higher
  read latency for recently written data — bad read-after-write experience).
- When to pick: write-heavy data with low re-read probability; pair with
  write-through only for the subset that IS re-read.

### Pattern comparison

| Pattern        | Write latency | Read-after-write | Staleness risk        | Memory use        | Durability of cache write | Typical use                     |
|----------------|---------------|------------------|-----------------------|-------------------|---------------------------|---------------------------------|
| Cache-aside    | Low (DB only) | Miss (repopulate)| Race window (short)   | Only read data    | N/A (DB is truth)         | Default read-heavy web          |
| Read-through   | N/A (read)    | Miss             | Same as aside         | Only read data    | N/A                       | Clean read API, DAX             |
| Write-through  | High (C+DB)   | Fresh (hit)      | Very low              | Caches all writes | Safe (DB written sync)    | Profile/session, read-your-write|
| Write-back     | Lowest (cache)| Fresh (hit)      | DB lags               | Caches all writes | Risky (async, can lose)   | Counters, high write throughput |
| Write-around   | Low (DB only) | Miss             | Low                   | Only read data    | Safe                      | Write-once/read-rarely, imports |

**Interview framing:** these are not mutually exclusive. A mature system uses
**cache-aside for reads + write-around for the read path + write-through for a
hot subset**. The "correct" answer is almost always "it depends on read/write
ratio, re-read probability, staleness tolerance, and durability need."

---

## Eviction policies (LRU, LFU, FIFO, TTL, and variants)

A cache is bounded; when full, it must evict. The policy is a bet about what
future accesses will look like.

- **LRU (Least Recently Used):** evict the item unused for the longest time.
  Great for temporal locality (recently used → likely reused). Cheap
  (doubly-linked list + hash map, O(1)). Weakness: a **scan** (one-time bulk
  read, e.g. a batch job or crawler) evicts your whole hot set ("cache
  pollution" / scan resistance problem).
- **LFU (Least Frequently Used):** evict the least-frequently-accessed item.
  Better for skewed popularity that is stable over time; resists scans. Weakness:
  **cache staleness of counts** — an item popular yesterday keeps a high count
  and won't leave even after it goes cold (needs aging/decay, e.g. Redis
  `LFU` uses a probabilistic counter with a decay time). More bookkeeping.
- **FIFO (First In First Out):** evict the oldest-inserted regardless of use.
  Simplest, but ignores access patterns — evicts hot items just because they're
  old. Rarely optimal; used where simplicity dominates.
- **TTL (Time To Live):** every entry expires after a fixed/absolute time.
  Not an eviction-under-pressure policy per se but an **age bound** — the
  primary tool for **bounding staleness**. Almost always combined with LRU/LFU.
- **Random / Allkeys-random:** evict a random key. Surprisingly decent and
  cheap; Redis offers it. Good when access is uniform.
- **Advanced/modern:** **W-TinyLFU** (used by Caffeine, the modern Java cache)
  combines a frequency sketch (Count-Min) with a small LRU admission window —
  near-optimal hit ratios with scan resistance and low memory. **ARC** (Adaptive
  Replacement Cache) balances recency and frequency dynamically (used in ZFS).
  **2Q**, **CLOCK/CLOCK-Pro** (approximated LRU used in OS page caches and DBs).
  **S3-FIFO** (2023, three FIFO queues) shows FIFO-based designs can beat LRU on
  modern skewed workloads with better scalability (no per-hit list surgery).

Redis eviction policies (via `maxmemory-policy`): `noeviction` (reject writes),
`allkeys-lru`, `allkeys-lfu`, `allkeys-random`, `volatile-lru`, `volatile-lfu`,
`volatile-random`, `volatile-ttl` (evict soonest-to-expire among keys with a
TTL). Redis LRU/LFU are **approximate** (sampled, default 5 keys) to save the
memory/CPU of exact tracking.

**Trade-offs:**
- LRU vs LFU: LRU adapts fast to changing hot sets and is simple, but is
  scan-vulnerable; LFU has better steady-state hit ratio on stable skewed
  traffic but adapts slowly and needs decay. Pick LRU when popularity shifts
  quickly (news, trends); LFU when the popular set is stable (reference data).
  Modern default: W-TinyLFU/Caffeine gets most of both.
- TTL is orthogonal — you almost always want a TTL as a **safety net** even with
  LRU/LFU, so a missed invalidation self-corrects instead of serving stale
  forever. The trade-off is short TTL = fresher but lower hit ratio + more
  origin load; long TTL = higher hit ratio but staler. Tune per data volatility.

---

## Invalidation strategies

The hard problem. Options, roughly in increasing consistency and complexity:

1. **TTL / passive expiry:** let entries expire. Simplest, no coordination,
   eventually consistent. You accept staleness up to the TTL. Great default.
   Trade-off: choosing TTL trades freshness vs hit ratio/load. Can't react to a
   write faster than the TTL.
2. **Write-time invalidation (explicit purge/delete):** on every write, delete
   (or update) the affected cache keys. Fresh quickly, but requires the write
   path to **know every key** derived from the data (hard for aggregates,
   query results, fan-out). Misses cause silent staleness. This is cache-aside's
   Achilles' heel at scale.
3. **Write-through / read-through:** consistency by construction on the cached
   path (see above).
4. **Versioned keys / cache-busting:** embed a version or content hash in the
   key/URL (`user:42:v7`, `app.a1b2c3.js`). A write bumps the version so old
   entries are simply never read again (and age out). No coordinated purge
   needed — very CDN-friendly. Trade-off: need to track/propagate the version;
   old entries linger until evicted (memory).
5. **Change Data Capture (CDC) driven invalidation (MODERN):** tail the DB
   write-ahead log / binlog (Debezium, DynamoDB Streams, Postgres logical
   replication) and emit invalidation/refresh events to the cache. Decouples the
   write path from cache knowledge — **any** writer (including out-of-band
   scripts) triggers invalidation. Used widely now for cache coherence across
   services. Trade-off: added infra (Kafka + connector), replication lag (tens
   of ms to seconds) so still eventually consistent, and you must map row
   changes to cache keys.
6. **Pub/sub fan-out invalidation:** on write, publish an invalidation message
   (Redis pub/sub, Kafka topic) that all app instances consume to purge their
   **local** in-process caches. Essential when you have per-instance L1 caches.
   Trade-off: at-least-once/at-most-once delivery matters; a dropped message
   leaves a node stale (bound it with a short local TTL).
7. **Lease / holdoff tokens (Facebook):** on a miss, the cache hands one client
   a lease token to recompute; concurrent readers wait or get slightly stale
   data. On write, invalidate leases. Solves stampede + thundering-herd + some
   consistency races together.

**A durable truth:** you generally cannot have "always fresh, zero coordination,
cheap" — pick two. TTL is cheap + zero-coordination but stale; write-time purge
is fresh but needs coordination and is fragile; CDC is robust + decoupled but
adds infra and lag. Interview-ready line: **"I default to short TTL + explicit
delete-on-write, and add CDC-based invalidation when multiple services/writers
share the data and staleness bounds tighten."**

---

## Cache stampede, thundering herd, and mitigations

**The failure:** a popular key expires (or the cache node restarts). Suddenly
thousands of concurrent requests all miss, all hit the DB for the same key at
once, and the DB (or an expensive computation) melts. Also called the
**thundering herd** or **dogpile** effect. A stampede can cascade: DB slows →
more timeouts → retries → more load → full outage. This is one of the most
common "your cache made things worse" interview scenarios.

Mitigations (usually combined):

- **Request coalescing / single-flight:** only the **first** requester for a
  missing key recomputes; concurrent requesters for the same key **wait** and
  share the one result. Go's `singleflight`, Netflix EVCache, and most modern
  cache libs do this per-process; a distributed lock extends it fleet-wide.
- **Locking / mutex (per key):** the first miss acquires a (short-lived,
  distributed) lock (`SET key val NX PX ttl` in Redis) and recomputes; others
  either wait-and-retry or serve stale. Trade-off: lock contention and the risk
  of a stuck lock (always set a lock TTL); adds a round trip.
- **TTL jitter / randomization:** never expire many keys at the same instant.
  Add randomness to TTLs (`ttl = base ± rand`) so expirations spread out. Cheap
  and essential — prevents synchronized mass expiry (e.g. after a bulk warm-up
  or a daily job). Same idea as jittered retry backoff.
- **Early / probabilistic recomputation (XFetch):** refresh a key **before** it
  expires, probabilistically, with probability rising as expiry approaches
  (`now - delta·beta·ln(rand) >= expiry`). One lucky request refreshes early
  while others keep serving the still-valid cached value — no synchronized
  cliff, no lock. Elegant and popular in modern systems.
- **Stale-while-revalidate (SWR):** serve the stale value immediately while a
  background task refreshes it. The user never waits on a miss. HTTP
  `Cache-Control: stale-while-revalidate` and CDNs implement this; app caches
  do too. Trade-off: you serve slightly stale data during refresh (usually
  fine).
- **Background refresh / cache warming:** proactively refresh hot keys on a
  schedule so they never expire under load; pre-warm after deploys/restarts.
- **Negative caching:** cache "not found"/errors briefly so a missing key or a
  failing backend doesn't get hammered (also mitigates cache **penetration** —
  requests for keys that don't exist; a Bloom filter can reject known-absent
  keys before hitting the DB).

**Trade-offs summary:** jitter is free and always worth it; single-flight/locking
adds a little latency and complexity but bounds DB load to ~1 recompute per key;
early recompute avoids both the miss latency and the lock but needs tuning;
SWR gives the best latency at the cost of bounded staleness. A robust design
stacks jitter + single-flight + SWR.

---

## Hot keys and sharding

**The problem:** even with sharding, a single **hot key** (a celebrity's
profile, a viral tweet, a flash-sale product, a global config value) can send
all its traffic to one shard/node — a **hot shard** — while others idle. This
breaks horizontal scaling: adding nodes doesn't help because one key can't be
split by key-hashing. Redis Cluster hashes keys into **16,384 hash slots**
(`CRC16(key) mod 16384`) distributed across nodes; a single key always lands on
one slot/node, so one key = one node's capacity ceiling.

Detection: track per-key request rates (Redis `--hotkeys` / `OBJECT FREQ`,
proxy metrics, Count-Min sketch of key frequencies).

Mitigations:

- **Key splitting / replication of the hot key:** store N copies under
  `hotkey:0..N-1` and have clients read a random replica — spreads read load
  across shards. Trade-off: writes must fan out to all N copies (write
  amplification + consistency window across copies). Great for read-hot,
  write-rare keys.
- **Local (L1) caching of hot keys:** cache the hot key **in the app process**
  so most hits never reach the shared cache at all. This is the most effective
  hot-key fix (each app box absorbs its share). Trade-off: per-instance
  staleness (bound with a very short TTL + pub/sub invalidation).
- **Consistent hashing** for the cache ring: distribute keys so adding/removing
  a node moves only `K/N` keys (not a full rehash). **Virtual nodes** even out
  the ring so no single physical node owns a huge arc. Solves rebalancing but
  NOT a single-hot-key (that's still one node) — hence combine with splitting/L1.
- **Client-side sharding vs proxy (twemproxy/mcrouter) vs cluster-aware
  clients:** where the routing lives. Facebook's mcrouter and Twitter's twemproxy
  proxy and pool memcached; Redis Cluster clients route by slot.
- **Dedicated tier for hot items:** isolate known-hot data (e.g. homepage,
  trending) onto its own replicated cache pool so it can't starve everything else
  (bulkhead / cell isolation).

**Sharding trade-offs:**
- Consistent hashing gains minimal reshuffle on membership change and no central
  coordinator, but suffers uneven load without virtual nodes and can't fix a
  single hot key. Modulo hashing (`hash % N`) is simplest but **rehashes almost
  everything** when N changes (mass miss storm) — avoid for elastic fleets.
- Replicating hot keys gains read scale but costs write fan-out and consistency;
  L1 caching gains the most read offload but costs coherence. Pick based on the
  read/write ratio of the hot key.

---

## Redis versus Memcached

Both are in-memory key-value stores with sub-millisecond latency. The choice is
a classic interview question; the honest answer is nuanced.

| Dimension              | Redis                                              | Memcached                                       |
|------------------------|----------------------------------------------------|-------------------------------------------------|
| Data model             | Rich: strings, hashes, lists, sets, sorted sets, streams, bitmaps, HLL, geo, pub/sub | Strings/blobs only (opaque values)       |
| Threading              | Historically single-threaded core (6.x+ has I/O threads; 7.x more) | Multi-threaded — scales up on many cores natively |
| Persistence            | RDB snapshots + AOF log (optional durability)      | None (pure cache; data lost on restart)         |
| Replication / HA       | Replicas + Sentinel + Redis Cluster (sharding+failover) | None built-in (client-side sharding only)  |
| Eviction               | Many policies (LRU/LFU/random/volatile/ttl)        | LRU (slab-based)                                |
| Memory efficiency      | More overhead per key; but compact for small structs | Slab allocator, very efficient for uniform small objects; less fragmentation for pure KV |
| Scaling model          | Scale out (Cluster) or up                          | Scale out via more nodes; scale up via threads  |
| Extra features         | Transactions, Lua, pub/sub, streams, TTL per key, atomic ops, modules (search, JSON, bloom) | Simple, minimal, predictable        |
| Multithreaded throughput on huge values | Can bottleneck on single thread          | Higher raw throughput for large multi-core boxes |

**Trade-offs / when to pick:**
- **Pick Redis** when you need data structures (leaderboards via sorted sets,
  rate limiters, queues, pub/sub, geo), persistence/durability, replication and
  automatic failover, or atomic server-side operations. It's the default modern
  choice and far more versatile.
- **Pick Memcached** when you want a **simple, multithreaded, pure LRU cache**
  for large, uniform objects, want to maximize raw throughput/RAM efficiency on
  big multi-core nodes, and don't need persistence or data structures (classic
  large-scale HTML-fragment / object cache — this is what Facebook famously
  scaled). Its simplicity is a feature: fewer knobs, predictable behavior.
- Reality: most greenfield systems reach for Redis because the extra features
  and HA are usually worth it; Memcached wins in narrow, high-scale,
  pure-cache-of-blobs scenarios. Note Netflix built **EVCache on top of
  Memcached** (multi-AZ replication, zone-aware) precisely because Memcached's
  simplicity + their own replication layer suited a huge, mostly-read workload.

---

## CDN edge and origin, push versus pull, cache-busting

A **Content Delivery Network** is a globally distributed set of **Points of
Presence (PoPs)** / edge servers that cache content close to users. The
**origin** is your authoritative server/storage (e.g. S3, your app). Goals:
reduce latency (serve from a nearby PoP), offload origin bandwidth/compute, and
absorb traffic spikes and DDoS.

```
User (Tokyo) --> nearest PoP (Tokyo edge) --hit--> served locally (~5-20 ms)
                                          --miss--> regional/parent cache
                                                   --miss--> Origin (us-east)
```

Many CDNs use a **tiered / hierarchical cache** (edge PoP → regional "parent"
/ shield → origin) so an edge miss hits a nearby parent, and only parent misses
reach origin — this dramatically raises **origin offload** and protects origin.

**Pull CDN (origin-pull):** content is cached lazily on first request (like
cache-aside for the web). You configure the origin; the CDN fetches and caches
on demand, governed by `Cache-Control`/`Expires`/`ETag`.
- Gain: no upfront upload; only requested content is stored; simplest to
  operate; self-managing. Give up: first request per PoP per object is a slow
  miss (cold edge); a viral object causes many PoPs to pull from origin (mitigate
  with tiered cache/shield); less control over exactly what's where.
- When: the default — most websites, APIs, and large/long-tail catalogs (you
  can't pre-push millions of images to every PoP).

**Push CDN (origin-push):** you proactively upload/publish content to the CDN
ahead of demand.
- Gain: no cold-miss latency (content is pre-positioned); predictable origin
  load; good for large files and planned launches (game/OS updates, VOD
  releases, big software downloads). Give up: you manage what's pushed and
  when, storage cost for content that may not be requested, and staleness if you
  forget to re-push.
- When: a smaller set of large, high-value, known-in-advance assets with
  predictable demand (video releases, software distribution). Live video/large
  files often use push.

**HTTP caching controls (the vocabulary interviewers expect):**
- `Cache-Control: max-age=N` (fresh N seconds), `s-maxage` (shared/CDN
  override), `public`/`private` (CDN may cache vs browser-only), `no-cache`
  (must revalidate before use), `no-store` (never cache), `immutable`
  (never revalidate — for fingerprinted assets), `stale-while-revalidate`,
  `stale-if-error`.
- **Validators / conditional requests:** `ETag` + `If-None-Match`, or
  `Last-Modified` + `If-Modified-Since` → origin returns `304 Not Modified`
  (revalidate cheaply without resending the body).
- **Vary** header: cache separate variants per header (e.g. `Vary:
  Accept-Encoding`, `Vary: Accept-Language`) — over-varying (e.g. on `Cookie` or
  `User-Agent`) shreds hit ratio into per-user fragments.

**Invalidation on a CDN:**
- **Purge/invalidation API:** explicitly evict an object/path/tag. Effective but
  **eventually consistent** (propagates to all PoPs over seconds) and can be
  rate-limited/costly at scale; tag/surrogate-key purge (Fastly) lets you purge
  many related objects at once.
- **Cache-busting via versioned URLs (preferred for static assets):** include a
  content hash or version in the filename/query
  (`/static/app.9f3a1c.js`, `?v=42`). A new deploy references new URLs, so
  clients/PoPs fetch fresh content and you **never purge** — old URLs simply age
  out. Combine with `Cache-Control: immutable, max-age=31536000` (one year) for
  fingerprinted assets: maximum hit ratio AND instant "invalidation" on deploy.
  This is the modern best practice for JS/CSS/images.

**Modern edge patterns:** edge caching now extends to **edge compute**
(Cloudflare Workers, Lambda@Edge, Fastly Compute) — run logic and even cache
personalized/composed responses at the PoP; **ESI** (Edge Side Includes) to
compose pages from cacheable + dynamic fragments; **edge KV / durable objects**
for stateful edge data; and caching of **API/GraphQL** responses and even AI
inference/RAG results near users.

**CDN trade-offs:** huge latency + offload win and DDoS absorption, at the cost
of another layer to invalidate (eventual consistency), potential cost (egress,
requests, purge limits), and the risk of caching something you shouldn't
(see below). Static/immutable content is a slam dunk; dynamic/personalized
content needs care (short TTL, `private`, edge compute, or don't cache).

---

## Distributed cache consistency

When a cache is shared across a fleet (and replicated across zones/regions),
you inherit distributed-systems problems: the cache and DB can disagree; cache
replicas can disagree; concurrent writers can race.

Core issues and tools:

- **Cache/DB coherence race:** the classic bug — reader loads old value from DB
  during a miss and writes it to cache *after* a concurrent writer deleted the
  cache, pinning stale data. Fixes: delete-after-DB-write ordering, short TTL as
  a backstop, **CAS** (compare-and-set, e.g. memcached `gets/cas`), or Facebook
  **leases** (a token that lets only the miss-filler set the value and gets
  invalidated by writes).
- **Replica staleness:** replicated caches (EVCache multi-AZ, Redis replicas)
  are asynchronously replicated → reads from a lagging replica can be stale
  (read-your-writes violations). Bound by monitoring replication lag, routing
  read-your-writes to primary, or session stickiness.
- **Consistency levels:** most caches give **eventual consistency** by design;
  strong consistency is expensive and defeats the point. Choose the weakest
  consistency your product tolerates and make staleness bounds explicit (TTL).
- **Dual-write hazard:** writing to DB and cache as two independent operations
  is not atomic — a crash between them leaves them inconsistent. Prefer
  single-source-of-truth patterns: write DB then invalidate (cache-aside), or
  drive cache updates off the DB log (**CDC**) so there's one ordered source of
  changes.
- **Thundering-herd + consistency interplay:** leases and single-flight also
  reduce inconsistent concurrent repopulation.
- **Multi-region:** either cache-per-region filled locally (accepts cross-region
  divergence, lowest latency) or a global invalidation bus (CDC/Kafka fan-out)
  to purge all regions on write (more consistent, more infra). Cell-based /
  regional isolation limits blast radius.

**Trade-offs:** stronger consistency (leases, CAS, sync replication, read from
primary) costs latency, throughput, and complexity; weaker consistency (async
replicas, TTL-only) is fast and simple but serves stale data. The design lever
is the **acceptable staleness window** — pin it to a product requirement (e.g.
"prices may be up to 60 s stale" ) and engineer to it, rather than chasing
strong consistency you don't need.

---

## What not to cache

Caching is not free and not always safe. Do **not** cache (or cache only with
great care):

- **Highly volatile data with strict freshness needs:** e.g. account balances,
  inventory at zero, real-time stock/trading prices, auth/permission decisions
  right after a revocation — a stale hit here causes wrong business outcomes.
- **Sensitive / personalized data at shared layers:** never cache
  authenticated, per-user, or secret responses in a **shared** cache (CDN/proxy)
  without `private`/`no-store` — the canonical bug is one user seeing another
  user's data (cache poisoning of shared PII). Use `private` for browser-only,
  or don't cache.
- **Data with very low reuse / near-unique per request:** search results with
  huge cardinality, one-off reports, per-request-unique payloads — the hit ratio
  is ~0, so you pay memory and complexity for no benefit.
- **Data whose correctness depends on being transactional/atomic** with other
  state (e.g. within-transaction reads, distributed locks' truth) — the cache
  can't participate in the transaction.
- **Rapidly changing data where TTL would have to be so short the hit ratio is
  negligible** — if you'd set TTL to 1 s and it changes every 2 s, the cache
  mostly serves misses; skip it or use write-through with tight bounds.
- **Legally/compliance-restricted data** where a stale or misplaced copy is a
  violation (some PII/residency rules).
- **Error responses (long-term):** caching 5xx for a long time turns a blip into
  an outage; if you negative-cache, use a very short TTL.

**The meta-trade-off:** every cache adds a consistency risk, an invalidation
burden, a failure mode (what happens on cache down? stampede? poisoning?), and
memory/operational cost. Cache when reuse is high, staleness is tolerable, and
the source is expensive. Don't cache when reuse is low, freshness is critical,
or the data is sensitive at that layer. "Should we NOT cache this?" is a
senior-signal question interviewers love.

---

## Trade-offs and when to use what

A consolidated decision guide (the heart of the interview).

**Choosing a write pattern by read/write profile:**

| Situation                                            | Recommended pattern                         | Why                                            |
|------------------------------------------------------|---------------------------------------------|------------------------------------------------|
| Read-heavy, some staleness OK, generic KV            | Cache-aside + short TTL                     | Simple, resilient, memory-efficient default    |
| Must read your own writes immediately                | Write-through (or write DB then set on same path) | Cache stays fresh with the write         |
| Extremely write-heavy, loss-tolerant (counters)      | Write-back (behind a durable log)           | Coalesces writes, lowest write latency         |
| Written often, read rarely                           | Write-around + cache-aside reads            | Avoids polluting cache with cold write data    |
| Clean read interface, centralized loader             | Read-through                                | App code simplicity                            |

**Choosing where to cache:**
- Static assets, global content, latency-sensitive users worldwide → **CDN** with
  versioned URLs + long immutable TTL.
- Expensive computed/DB results shared across the fleet → **distributed cache**
  (Redis/Memcached) with cache-aside.
- Ultra-hot keys / per-instance speed → add **local L1** cache (Caffeine) with
  short TTL + pub/sub invalidation.
- Per-user data safe only on the client → **browser** cache with `private`.

**The universal levers and their tension:**
- **Consistency ↔ Latency/Cost:** fresher means more coordination and lower hit
  ratio.
- **Hit ratio ↔ Freshness:** longer TTL raises hit ratio, lowers freshness.
- **Memory ↔ Hit ratio:** more RAM/more nodes = higher hit ratio (diminishing).
- **Complexity ↔ Robustness:** stampede protection, CDC, leases add robustness
  at the cost of moving parts.

**Failure-mode checklist to raise unprompted in an interview:**
- Cache down → does the system degrade (slower) or fall over (DB overload)?
  (Add stampede protection, load shedding, circuit breakers, request coalescing.)
- Mass expiry / cold start → jitter TTLs, warm the cache, SWR.
- Hot key → L1 + key splitting + isolation.
- Poisoning / wrong `Vary`/`private` → correctness/security bug at shared layers.
- Invalidation miss → short TTL backstop + CDC.
- Replica lag → read-your-writes routing.

---

## Common interview follow-up questions

1. "You added a Redis cache and the DB still fell over during a spike — why?"
   (Stampede on a hot key expiring; fix with single-flight/lock + jitter + SWR.)
2. "How do you keep the cache consistent with the DB on writes?" (Cache-aside
   delete-after-write + short TTL; escalate to CDC/leases when needed; discuss
   the race window.)
3. "A celebrity posts and one node is at 100% CPU while others idle — what's
   happening and how do you fix it?" (Hot key/hot shard; L1 cache, key splitting,
   isolation.)
4. "When would you choose Memcached over Redis?" (Pure multithreaded blob cache
   at huge scale, no persistence/structures needed.)
5. "How do you invalidate a CDN when you deploy new JS?" (Versioned/fingerprinted
   URLs + immutable long TTL — no purge needed; contrast with purge API's
   eventual consistency.)
6. "Push vs pull CDN for a video launch vs a long-tail image catalog?"
   (Push for known large launch assets; pull for the long tail.)
7. "What should you NOT cache, and why?" (Sensitive per-user data at shared
   layers, strict-freshness financial data, low-reuse payloads.)
8. "LRU vs LFU for a system with periodic batch scans?" (LFU or W-TinyLFU for
   scan resistance; plain LRU gets polluted.)
9. "Estimate the cache memory and node count for 100M items × 2 KB with a target
   hit ratio." (Back-of-envelope: working set size, per-node RAM, replication
   factor, headroom.)
10. "Your invalidation events are dropped occasionally — how do you stay
    correct?" (Short TTL backstop, idempotent/versioned keys, reconcile via CDC.)
11. "How does consistent hashing help, and what does it NOT solve?" (Minimal
    reshuffle on membership change; does not fix a single hot key.)
12. "Write-through vs write-back for a like/view counter?" (Write-back to
    coalesce, backed by a log for durability; write-through would hammer the DB.)

---

## References

- Alex Xu, *System Design Interview* Vol. 1 & 2, and ByteByteGo blog/newsletter
  (caching, CDN, consistent hashing chapters). https://bytebytego.com
- Martin Kleppmann, *Designing Data-Intensive Applications* (DDIA) — replication,
  consistency, and derived-data/CDC concepts.
- Nishtala et al., "Scaling Memcache at Facebook", NSDI 2013 (leases, delete
  semantics, thundering herd). https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf
- Netflix Tech Blog — EVCache (Memcached-based, multi-AZ). https://netflixtechblog.com/announcing-evcache-distributed-in-memory-datastore-for-cloud-c26f4e11f745
- Redis docs — eviction (`maxmemory-policy`), Redis Cluster hash slots (16384),
  clustering & hash tags. https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/
  and https://redis.io/docs/latest/develop/reference/eviction/
- Redis vs Memcached comparison. https://redis.io/docs/latest/develop/get-started/faq/
- Vattani, Chierichetti, Lowenstein, "Optimal Probabilistic Cache Stampede
  Prevention" (XFetch / early recomputation), VLDB 2015.
- Ben Manes, Caffeine cache & W-TinyLFU. https://github.com/ben-manes/caffeine
- Yang et al., "FIFO queues are all you need for cache eviction" (S3-FIFO),
  SOSP 2023.
- Cloudflare Learning Center — CDN, caching, cache-control, purge, tiered cache.
  https://www.cloudflare.com/learning/cdn/
- Fastly docs — surrogate keys / tag-based purge, instant purge.
- AWS docs — CloudFront (origin shield, cache behaviors), ElastiCache
  (Redis/Memcached), DAX (DynamoDB Accelerator, read/write-through).
- MDN Web Docs — HTTP caching (`Cache-Control`, `ETag`, `Vary`,
  `stale-while-revalidate`). https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching
- The system-design-primer (GitHub) — caching patterns section.
  https://github.com/donnemartin/system-design-primer
- YouTube: ByteByteGo "Top caching strategies"; Gaurav Sen "Caching / Consistent
  Hashing"; Hussein Nasser "Caching pitfalls / CDN"; Jordan has no life (system
  design consistency & caching series).
