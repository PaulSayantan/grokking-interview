# Rate Limiting and Consistent Hashing

These two topics show up together in system-design interviews because they are the
two canonical "distributed coordination under load" building blocks: **rate limiting**
protects a system from too much traffic, and **consistent hashing** decides *which node*
handles a given request/key so that traffic (and state) is spread evenly and survives
membership changes. Both are fundamentally about trade-offs between accuracy,
latency, cost, and operational complexity — which is exactly what interviewers probe.

This document is layered: for each concept you get intuition → mechanics → real-world
usage → **trade-offs and when to pick it**. The trade-off sections are the ones worth
memorizing for interviews.

---

## Why rate limiting exists

**Intuition.** A rate limiter caps how many requests a client (user, IP, API key,
tenant, service) may perform in a time window. It converts unbounded, bursty, or
abusive demand into a predictable, bounded load the system was capacity-planned for.

**What it buys you:**

- **Protection from overload / cascading failure.** Without a limiter, a traffic spike
  (organic or a retry storm) drives latency up, queues fill, threads block, and the
  service tips over. A limiter sheds excess load *cheaply and early*, before expensive
  downstream work happens.
- **Fairness / anti-noisy-neighbor.** In multi-tenant systems one tenant's runaway
  batch job should not starve everyone else. Per-tenant limits enforce isolation.
- **Abuse / DoS / brute-force mitigation.** Login endpoints, OTP sends, password reset,
  scraping — all are throttled per identity/IP.
- **Cost control.** Metered downstreams (LLM tokens, SMS, third-party APIs, DB IOPS)
  cost money; limits bound spend.
- **Monetization / quotas.** API tiers ("100 req/s on the free tier, 10k on
  enterprise") are literally sold as rate limits.

**Where it hurts (the cost of limiting):**

- **False rejections** of legitimate traffic if limits are too tight or bursty
  patterns are penalized.
- **Added latency** on every request (a limiter check is on the hot path).
- **Coordination cost** in distributed settings (see distributed rate limiting).

**Response semantics.** The standard is HTTP `429 Too Many Requests`, usually with a
`Retry-After` header and rate-limit hint headers (`RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset` — the IETF `draft-ietf-httpapi-ratelimit-headers`
standard, and the older de-facto `X-RateLimit-*`). Well-behaved clients back off
(ideally exponential backoff **with jitter**) instead of hammering.

**Back-of-envelope.** If you allow 10 req/s per user and have 1M active users, the
theoretical ceiling is 10M req/s — you never provision for that; limits are about the
*tail* of abusers, not the average. Sizing the limiter store: a token-bucket state is
~tens of bytes/key; 100M keys × ~100 B ≈ 10 GB → fits comfortably in a small Redis
cluster. That "it's cheap to store" fact drives most design choices below.

---

## Token bucket

**Intuition.** A bucket holds up to `B` tokens. Tokens refill at a steady rate `r`
tokens/sec. Each request removes one token (or `N` tokens for weighted requests). If
the bucket has a token, the request is allowed; if empty, it's rejected (or queued).

```
refill rate r tokens/sec
        |
        v
   +---------+
   | tokens  |  capacity B (max burst)
   +---------+
        |
   request takes 1 token --> allowed
   empty --> 429
```

**Mechanics.** You don't run a background thread adding tokens. You store
`(tokens, last_refill_ts)` and compute lazily on each request:

```
now      = now()
elapsed  = now - last_refill_ts
tokens   = min(B, tokens + elapsed * r)
last_refill_ts = now
if tokens >= 1: tokens -= 1; allow
else: reject
```

This is O(1) time and O(1) memory per key — two numbers. That efficiency is why it's
the most widely deployed algorithm.

**Key property: it allows bursts up to `B`.** A client that's been idle accumulates up
to `B` tokens and can fire `B` requests instantly, then is limited to the steady rate
`r`. This is usually *desirable*: real traffic is bursty and you want to absorb short
spikes without penalizing users.

**Real-world usage.** AWS API Gateway (burst + steady rate), Stripe's API, NGINX
`limit_req` with `burst=`, Amazon/Google client SDKs, the classic Guava `RateLimiter`,
and most cloud API quota systems use token bucket or a close variant.

**Trade-offs:**

- **Gain:** O(1) memory/CPU, controllable burst allowance, smooth steady-state rate,
  intuitive to tune (two knobs: `r` and `B`).
- **Give up:** allows short bursts up to `B`, so it does *not* strictly cap requests in
  every fixed instant; if your downstream truly cannot tolerate any burst, token
  bucket's burst is a liability.
- **When to pick:** default choice for API rate limiting where some burst is fine and
  you value simplicity/efficiency. Pick **leaky bucket** instead when you need a strictly
  smooth *output* rate (traffic shaping).

---

## Leaky bucket

**Intuition.** Think of a bucket (a FIFO queue) with a hole that leaks at a constant
rate. Requests pour in; they drain at a fixed rate `r`. If the bucket (queue) is full,
new requests overflow and are dropped.

```
requests in (bursty)
     | | |
     v v v
   +-------+
   | queue |  capacity = B
   +-------+
       |  leaks at fixed rate r  (smooth output)
       v
   processed
```

**Mechanics.** Two variants:

1. **Queue-based (meter/shaper):** an actual FIFO buffers requests and a scheduler
   dispenses them at rate `r`. Output is perfectly smooth. This adds queueing latency.
2. **"Leaky bucket as a meter"** (the GCRA — Generic Cell Rate Algorithm — used in
   telecom/ATM and by `redis-cell`): no real queue; it tracks a "theoretical arrival
   time" and rejects requests that arrive too early. Mathematically similar to token
   bucket but framed around inter-arrival spacing.

**Key property: smooth, constant output rate; no bursts pass through.** Downstream sees
a flat rate regardless of input shape.

**Real-world usage.** Network traffic shaping/policing (routers, ATM), Shopify's older
API limiter (leaky-bucket flavored), NGINX `limit_req` without `burst` behaves like a
leaky bucket (strict smoothing).

**Trade-offs:**

- **Gain:** perfectly smooth output — ideal when the downstream (e.g., a fragile
  legacy system, a payment processor, a metered API) needs constant pacing.
- **Give up:** the queue adds latency; a full queue drops requests silently; idle
  clients cannot "save up" burst capacity (unlike token bucket). Under bursty load it
  can feel unfair (old requests processed before fresh ones = high latency).
- **When to pick:** traffic shaping / smoothing where a constant downstream rate
  matters more than latency. For user-facing APIs where burst tolerance and low latency
  matter, token bucket usually wins.

> Token bucket vs leaky bucket in one line: **token bucket limits the average and
> allows bursts; leaky bucket enforces a smooth constant rate and removes bursts.**

---

## Fixed window counter

**Intuition.** Divide time into fixed windows (e.g., each calendar minute). Keep a
counter per key per window. Increment on each request; reject when the counter exceeds
the limit `L`. At the window boundary the counter resets to zero.

```
|---- 12:00:00–12:00:59 ----|---- 12:01:00–12:01:59 ----|
        count=L (full)              count resets to 0
```

**Mechanics.** One integer per key per window. In Redis: `INCR key:window` +
`EXPIRE`. Extremely cheap and simple.

**The fatal flaw: boundary bursts (2× spike).** Because the window resets abruptly, a
client can send `L` requests at 12:00:59 and another `L` at 12:01:00 — `2L` requests in
a ~1-second span, straddling the boundary, while never violating either window's count.
So the *effective* short-term rate can be double the intended limit.

**Real-world usage.** Simple internal quotas, GitHub's older hourly API limit was
effectively window-based, many "X requests per hour" billing counters. Good when the
window is long and occasional 2× boundary bursts are harmless.

**Trade-offs:**

- **Gain:** minimal memory (one counter), trivial to implement, easy to reason about
  ("1000/hour"), cheap reset (TTL expiry).
- **Give up:** up to **2× burst** at window edges; also "bursty fairness" — everyone's
  quota resets at the same instant causing a thundering-herd at each boundary.
- **When to pick:** coarse quotas where the window is long relative to acceptable burst
  (hourly/daily billing counters), or where absolute precision doesn't matter. For
  precise short-window enforcement, use sliding window.

---

## Sliding window log

**Intuition.** Store a timestamp for every request in a sorted structure. To check a
request, drop all timestamps older than `now - window`, then count what remains. Allow
if `count < L`. This is the *exact* rate over any rolling window — no boundary artifact.

```
window = 60s.  Keep timestamps in last 60s.
On request:  purge < now-60s;  if size < L: add now, allow; else reject.
```

**Mechanics.** In Redis: a sorted set (`ZSET`) per key. `ZREMRANGEBYSCORE` to purge old
entries, `ZCARD` to count, `ZADD` to record. Operations are done atomically (MULTI/EXEC
or Lua).

**Key property: perfectly accurate.** No 2× boundary problem; the limit is honored for
*every* rolling window.

**The cost: memory and CPU scale with request volume.** You store one entry *per
request* within the window. A key doing 10k req/min holds 10k timestamps. Across many
keys this is expensive, and purge/count operations get heavier under load — the exact
moment you least want extra work.

**Real-world usage.** Where correctness is paramount and volumes are modest: security-
sensitive endpoints (login attempts, OTP), precise billing enforcement, small-scale
precise limits. Often the reference implementation people simplify away from at scale.

**Trade-offs:**

- **Gain:** exact rolling-window accuracy, no boundary bursts, naturally supports
  per-request weights.
- **Give up:** O(requests-in-window) memory and CPU per key; costliest algorithm;
  scales poorly for high-QPS keys.
- **When to pick:** low-to-moderate volume where precision matters (auth, fraud,
  metered billing). At high scale, downgrade to **sliding window counter** for ~99%
  of the accuracy at a fraction of the cost.

---

## Sliding window counter

**Intuition.** A hybrid that gets most of the sliding-window accuracy with fixed-window
cheapness. Keep counters for the current and previous fixed windows, then estimate the
rolling count by **weighting the previous window by how much of it still overlaps** the
sliding window.

```
estimate = current_window_count
         + previous_window_count * (overlap fraction of previous window)

e.g. 30% into the current minute:
estimate = curr + prev * 0.70
```

**Mechanics.** Two integers per key (current, previous window counts) plus arithmetic —
O(1) memory and CPU, like fixed window, but it smooths the boundary. Cloudflare
published a well-known analysis showing this approximation is accurate to within ~0.003%
of exact for real traffic, while using vastly less memory than a log.

**Assumption / caveat.** It assumes requests are roughly uniformly distributed within
the previous window. If traffic was extremely spiky inside the previous window (all at
the very end), the linear-overlap estimate can be slightly off (it can under- or
over-count), but for real-world traffic the error is tiny.

**Real-world usage.** Cloudflare's rate limiter, Kong, and many API gateways use this
as the default because it's the sweet spot of accuracy vs cost. This is the answer to
"what would you actually use in production at scale?" most of the time.

**Trade-offs:**

- **Gain:** O(1) memory/CPU (two counters), smooths the fixed-window 2× boundary burst,
  extremely accurate for real traffic, cheap in Redis.
- **Give up:** it's an *approximation* (assumes uniform distribution in prior window);
  not exact like the log; slightly more logic than fixed window.
- **When to pick:** the pragmatic default for high-scale API rate limiting. Choose the
  **log** only when you need provable exactness; choose **fixed window** only for coarse
  long-window quotas.

---

## Comparing the algorithms

| Algorithm | Memory/key | Burst behavior | Accuracy | Smoothing | Typical use |
|---|---|---|---|---|---|
| Token bucket | O(1) (2 numbers) | Allows burst up to B | Good | No (bursty by design) | Default API limiting (AWS, Stripe, NGINX) |
| Leaky bucket | O(1) or O(queue) | No burst passes | Good | Yes (constant output) | Traffic shaping, fragile downstreams |
| Fixed window | O(1) (1 counter) | Up to 2× at boundary | Poor near edges | No | Coarse hourly/daily quotas |
| Sliding window log | O(requests in window) | None | Exact | No | Auth/security, precise billing (low volume) |
| Sliding window counter | O(1) (2 counters) | Minimal | ~99.9% | Partial | High-scale production default (Cloudflare, Kong) |

**Mental model for interviews:**
- Need burst tolerance + simplicity → **token bucket**.
- Need constant downstream pacing → **leaky bucket**.
- Need dead-simple coarse quota → **fixed window**.
- Need exactness, low volume → **sliding window log**.
- Need accuracy at scale, cheap → **sliding window counter**.

---

## Distributed rate limiting

**The problem.** A single limiter node with in-memory counters is trivial. But real
systems run N stateless app/gateway instances behind a load balancer. If each instance
keeps its *own* local counter, a global "1000 req/s" limit becomes "1000 × N req/s" —
badly over-permissive. You need the *fleet* to agree on the count. That's a distributed
state / coordination problem, and it trades accuracy against latency and availability.

### Option A: Centralized store (Redis / Memcached)

All instances read/increment a shared counter in a central store (usually Redis).
Atomicity via `INCR`, or a **Lua script** that reads-computes-writes the whole
token-bucket/sliding-window logic in one atomic server-side round trip (avoids race
conditions between GET and SET).

```
   inst1  inst2  inst3  ...  instN
      \      |     |        /
       \     |     |       /
        v    v     v      v
        +------------------+
        |   Redis (counter)|  <- atomic INCR / Lua
        +------------------+
```

- **Accuracy:** high/global — one source of truth.
- **Latency:** adds a network round trip (~0.2–1 ms same-AZ, more cross-AZ) to every
  request on the hot path.
- **Availability / failure mode:** Redis is now a dependency of *every* request. If it's
  slow or down you must decide **fail-open** (allow all — protects availability, drops
  protection) or **fail-closed** (reject all — protects downstream, causes an outage).
  Most user-facing systems **fail open** with local fallback.
- **Hot-key problem:** a single very hot limiter key (e.g., a giant tenant) funnels all
  its traffic to one Redis shard/key → that shard becomes a bottleneck.

### Option B: Local counters only (no coordination)

Each node limits independently to `L/N`. Zero coordination latency, perfectly available,
but inaccurate: uneven load-balancing means some nodes reject while others have spare
quota, and adding/removing nodes changes the effective per-node limit.

### Option C: Local + async sync (the common production pattern)

Each node maintains a local counter for speed and periodically (every few hundred ms)
syncs deltas to a central store or gossips to peers, then adjusts. This is what large
gateways do.

```
node local decision (fast, approximate)
        |
        |  async flush/gossip every ~200ms-1s
        v
   shared aggregate  -> corrects local budgets
```

- **Accuracy:** eventually consistent — can overshoot the global limit within a sync
  interval, but converges. Tunable via sync frequency.
- **Latency:** local decision is in-memory (microseconds); no per-request network hop.
- **Availability:** degrades gracefully — if sync fails, nodes fall back to local limits.

**Stripe** (their engineering blog on rate limiters) uses Redis + token buckets with
Lua. **Cloudflare** does edge-local counting with sliding-window-counter and
aggregation. **Envoy / Lyft's `ratelimit`** service uses a central Redis with a gRPC
rate-limit service called by the proxy. **Kong**, **Amazon API Gateway**, and
**Google's** systems offer both local and distributed (synchronized) modes explicitly.

### Comparison

| Approach | Accuracy | Added latency | Availability | Cost/complexity | When |
|---|---|---|---|---|---|
| Central store (Redis+Lua) | High (global) | +1 network RTT/req | Redis is critical dep | Medium | Need tight global limits, moderate QPS |
| Local only | Low (N× drift) | ~0 | Highest | Lowest | Rough limits, huge scale, per-node OK |
| Local + async sync | Medium-high (converges) | ~0 hot path | Graceful degradation | Higher | High scale + reasonably accurate global limit |

**The core trade-off:** *accuracy vs latency vs availability*. You cannot have a
perfectly accurate global limit, zero added latency, and full availability during a
store outage simultaneously — this is a CAP-flavored tension. Interview answer: pick
**local decision + async aggregation with fail-open** for high scale, or **central
Redis+Lua** when limits must be tight and QPS is moderate.

---

## Where to enforce rate limits

**Options along the request path:**

```
client -> CDN/edge -> API gateway / LB -> service mesh sidecar -> service -> datastore
   (1)       (2)            (3)                  (4)                 (5)
```

1. **Client-side (SDK):** best UX (avoids wasted round trips) but *untrusted* — never
   your only line of defense; attackers bypass it.
2. **Edge / CDN (Cloudflare, CloudFront + WAF):** cheapest place to drop abusive/DoS
   traffic — closest to the source, protects everything behind it. Coarse-grained
   (IP-based, path-based). Great first layer.
3. **API gateway / load balancer:** the most common enforcement point. Centralized
   policy, applied uniformly, keeps limiter logic out of every service, sheds load
   *before* it hits business logic. This is the default recommended answer.
4. **Service mesh sidecar (Envoy + a rate-limit service):** enforce per-service or
   per-route limits close to the service without embedding logic in app code; good for
   internal service-to-service limits.
5. **In-service (application code):** most precise (has full business context — user
   tier, per-endpoint cost, feature flags) but couples limiter logic to each service and
   spends resources before rejecting.

**Trade-offs:**

- **Earlier (edge/gateway):** cheaper (drops load before expensive work), centralized,
  but coarser (less business context — may not know user tier or the true cost of a
  request).
- **Later (in-service):** richer context and per-endpoint precision, but wastes
  resources handling requests that get rejected, and scatters/duplicates logic.

**Best practice: defense in depth / layered.** Coarse IP/DoS limits at the edge,
per-API-key/tenant limits at the gateway, and fine-grained business limits (e.g.,
"5 password resets/day", weighted cost limits) in the service. Don't rely on a single
layer.

---

## Consistent hashing

**Intuition.** You have K keys (cache entries, user sessions, shard rows) to distribute
across N nodes. The naive scheme is **`hash(key) mod N`**. It's perfectly balanced —
until N changes. Add or remove one node and `mod N` becomes `mod (N±1)`, remapping
*almost every key*. For a cache, that means a near-total cache miss storm (and possible
thundering herd on the origin); for a shard map, it means moving almost all data.

**Consistent hashing** fixes this: map both nodes and keys onto the same fixed circular
hash space (the "ring", e.g., 0 … 2³²−1). A key is owned by the first node encountered
going clockwise from the key's position. Adding/removing a node only remaps the keys in
*one arc* — on average **K/N keys move**, not K.

```
        0/2^32
          |
    nodeC * . . . . . . *  nodeA
        .                   .
      . k3                 k1 .
      .        (ring)         .
        .                   .
    nodeB * . . . . . . *  (key k2 -> next node clockwise)
```

**Why it beats mod-N on resize (the headline result):**

| Scheme | Keys remapped when N → N+1 |
|---|---|
| `hash(key) mod N` | ~all K keys (≈ (N−1)/N fraction move) |
| Consistent hashing | ~K/N keys (only one node's arc) |

**Mechanics.** Nodes are hashed onto the ring by ID. To find a key's owner, hash the key
and walk clockwise to the next node (implemented as a binary search over a sorted array
of ring positions → O(log N) lookup). On membership change, only neighbors are affected.

**The naive-ring problem: uneven load.** With only N points on the ring, arcs are
uneven → some nodes own much larger arcs (more keys) than others. Removing a node dumps
*all* its keys onto its single clockwise neighbor (not spread out). This is solved by
virtual nodes.

**Real-world usage.** Amazon **Dynamo** (and DynamoDB internals), **Cassandra**,
**Riak**, **ScyllaDB** for partitioning; **memcached** clients (ketama), **Redis
Cluster** (uses 16384 hash slots — a fixed-slot variant of the same idea);
**Discord** for routing; CDNs and consistent-hash load balancing in **Envoy/NGINX**
(`hash`/`ring_hash`), **HAProxy**. It's the backbone of horizontally-partitioned data
stores.

**Trade-offs:**

- **Gain:** minimal reshuffling on scale up/down (K/N vs K), enabling elastic clusters
  and cache warmth preservation; decentralized (each client can compute ownership).
- **Give up:** more complex than mod-N; naive ring has load-imbalance and hotspot-on-
  removal problems (needs virtual nodes); lookups are O(log N) not O(1); rebalancing
  still moves *some* data.
- **When to pick:** any time nodes join/leave dynamically and you want to minimize data
  movement / cache invalidation — caches, sharded stores, stateful routing. If N is
  truly fixed forever and load is uniform, plain mod-N is simpler.

---

## Virtual nodes

**Intuition.** Instead of placing each physical node once on the ring, place it at
`V` positions (e.g., 100–500 "vnodes" per physical node), each a differently-hashed
point. Now each physical node owns *many small arcs* scattered around the ring.

**Why:**

1. **Balance.** More points → arcs are statistically more uniform → keys spread evenly.
   Standard deviation of load falls roughly as 1/√V. With ~100–200 vnodes, imbalance
   drops to a few percent.
2. **Smooth failure/removal.** When a physical node dies, its many small arcs each hand
   off to *different* neighbors → its load is redistributed across the whole cluster,
   not dumped on one successor. Likewise, a new node steals small slices from many nodes.
3. **Heterogeneous capacity.** Give a beefier machine more vnodes → it gets
   proportionally more keys. Weighting by capacity is trivial.

```
Physical node A -> vnodes A#1, A#2, ... A#V scattered on ring
Node dies -> each A#i arc absorbed by a different neighbor -> even spread
```

**Trade-offs:**

- **Gain:** far better load balance, graceful redistribution on membership change,
  easy capacity weighting.
- **Give up:** more ring metadata (V×N points → more memory and slightly slower
  lookups / more to gossip), and more, smaller data ranges to track. Very high V has
  diminishing returns and management overhead.
- **When to pick:** essentially always with consistent hashing at scale — Cassandra,
  Dynamo, ketama all use vnodes. Tune V for the balance-vs-overhead sweet spot
  (commonly 128–256).

---

## Consistent hashing with bounded loads

**Intuition.** Even with vnodes, load is only *statistically* balanced, and *key
popularity* is not uniform — a viral key or a big tenant can overload whichever node
owns it (a hotspot). **Consistent Hashing with Bounded Loads (CHWBL)**, from a 2016
Google paper (used in Vimeo's HAProxy setup and Google's load balancing), adds a hard
cap: no node may exceed `(1 + ε) × average_load`.

**Mechanics.** Assign a key to its consistent-hash owner *unless* that node is already at
its capacity cap; if so, walk clockwise to the next node with spare capacity. This bounds
the max load any node sees while still keeping most keys on their natural owner
(preserving cache locality and minimizing movement).

**Trade-offs:**

- **Gain:** guarantees an upper bound on per-node load (no single node gets crushed by a
  hot arc), while retaining consistent hashing's low churn.
- **Give up:** overflow means some keys land on a non-owner node → slightly worse cache
  locality and the need to track live per-node load; the cap `ε` is a tuning knob
  (small ε = tighter balance but more overflow/movement).
- **When to pick:** load-balancing requests to stateful backends where a hot key/backend
  would otherwise overload one node (Google's Maglev-adjacent LB, Vimeo). For pure
  data-at-rest partitioning where you don't track live load, vnodes usually suffice.

---

## Rendezvous hashing

**Intuition.** Also called **Highest Random Weight (HRW)** hashing. Instead of a ring,
for a given key you compute `hash(key, node_i)` for *every* node and pick the node with
the highest score. That node owns the key. To find the top-2 (for replicas), take the
two highest scores, and so on.

```
owner(key) = argmax over nodes n of  hash(key, n)
```

**Why it's elegant.** When a node is removed, only the keys that had *that* node as their
max move — and they move to their *next-highest* node, which is stable for all other
keys. It gives minimal disruption like consistent hashing, but:

- **No ring, no vnodes needed** for good balance — the hashing itself is uniform.
- **Trivial to get an ordered preference list** (ranked replicas) — just sort scores.
- **Simpler to reason about** and no ring metadata to maintain.

**The cost:** lookup is **O(N)** per key (hash against every node) vs consistent
hashing's O(log N). For small/medium N (dozens to low hundreds of nodes) this is fine
and often faster in practice; for very large N it's expensive unless combined with
hierarchy/sharding of the node set.

**Real-world usage.** Used in **Ceph's CRUSH** (conceptually), some CDN cache selection,
Microsoft's caching, and client-side shard selection where N is modest and you want a
ranked replica list without ring bookkeeping.

**Trade-offs:**

- **Gain:** great uniform balance with no vnode tuning, minimal-disruption remapping,
  natural ordered replica lists, simple to implement.
- **Give up:** O(N) per-lookup cost (vs O(log N) ring); doesn't scale as gracefully to
  huge node counts without extra structure.
- **When to pick:** modest N, need ranked replicas / weighted selection, want to avoid
  ring/vnode complexity. Prefer the **ring + vnodes** when N is very large and lookup
  cost dominates.

---

## Consistent hashing in caches, sharding, and load balancing

**Distributed caches (memcached/Redis clients).** Consistent hashing lets clients pick
which cache node holds a key without a central coordinator, and preserves warmth when
nodes are added/removed (only K/N of the cache is invalidated instead of everything).
Ketama (libketama) is the classic memcached implementation. Redis Cluster uses 16384
fixed hash slots (`CRC16(key) mod 16384`) mapped to nodes — moving slots (not rehashing
keys) on resize, a pragmatic variant.

**Sharded databases / partitioning.** Dynamo/Cassandra/Riak place data on a
consistent-hash ring with vnodes; replication writes a key to the next R nodes clockwise
(the "preference list"). Adding capacity streams only the arcs the new node claims.

**Load balancing to stateful backends.** `ring_hash`/`maglev` (Envoy), NGINX `hash`,
HAProxy consistent hashing route a client/session consistently to the same backend
(session affinity, cache-friendly) while tolerating backend churn. Add CHWBL to avoid
hotspots.

**Trade-off summary for placement:** consistent hashing gives **stable, decentralized,
churn-tolerant** routing at the cost of **statistical (not perfect) balance** and the
**hotspot risk** from skewed key popularity — which vnodes (balance) and bounded loads
(hotspot cap) address.

---

## Hot-spot and hot-key handling

Even perfect hashing can't fix **skewed access** (one key or tenant is disproportionately
popular — a celebrity user, a viral video, a Black-Friday product). All that traffic
maps to one node. Techniques:

- **Key splitting / sharding a hot key.** Append a suffix bucket (`key#0..key#K`) so one
  logical key spreads across K physical keys/nodes; fan-out reads and merge. Common for
  hot counters and hot cache entries.
- **Replication of hot keys.** Store popular keys on multiple nodes and read from any
  (read fan-out). Trades storage/consistency for spread.
- **Local caching / request coalescing.** Cache hot keys in the app tier (near cache) and
  use **single-flight / request coalescing** so a cache miss triggers only one origin
  fetch (prevents the thundering-herd / cache stampede).
- **Consistent hashing with bounded loads (CHWBL).** Caps per-node load so overflow
  spills to neighbors.
- **Two-tier / power-of-two-choices.** For LB, hashing to *two* candidate nodes and
  picking the less loaded reduces max load dramatically.
- **Adaptive/dynamic vnode reassignment.** Detect hot ranges and split/move them.

**Trade-offs:** splitting/replication improve spread but add read fan-out cost and
consistency complexity (merging, staleness); coalescing adds a tiny latency for the
coalesced waiters but massively protects the origin. Pick based on read/write ratio and
consistency needs.

---

## Modern patterns and where the field is heading

- **Edge rate limiting (Cloudflare Workers, Lambda@Edge, Fastly Compute).** Enforce
  limits at hundreds of PoPs near users; each PoP counts locally and aggregates
  asynchronously — the local+sync pattern at global scale, trading exactness for latency.
- **Cell-based architecture.** Traffic is partitioned into isolated "cells" (each a full
  stack); consistent hashing (often on tenant/customer ID) routes a tenant to a cell,
  bounding blast radius. Rate limits are enforced per cell. AWS promotes this for
  fault isolation.
- **LLM / GenAI cost control.** Rate limiting by **tokens per minute (TPM)** and
  **requests per minute (RPM)**, weighted token buckets where a request "costs" its token
  count. OpenAI/Anthropic/Bedrock all expose TPM+RPM limits; internal gateways enforce
  per-team token budgets. Consistent hashing routes sessions/prompt-cache affinity to the
  same GPU node to reuse KV-cache.
- **Sidecar/mesh + external rate-limit service (Envoy global rate limiting).** Decouples
  policy from app; central gRPC RL service backed by Redis.
- **CDC / event-driven quota reconciliation.** Emit usage events to a stream (Kafka),
  aggregate for billing/quota truth asynchronously while the hot path uses fast local
  approximations.
- **Adaptive / concurrency limits.** Instead of a fixed rate, adaptive limiters (Netflix
  `concurrency-limits`, à la TCP Vegas/AIMD) infer the safe limit from observed latency —
  they lower the limit when latency rises. This targets *goodput* rather than a static
  number and self-tunes to real capacity.

---

## Trade-offs and when to use what

**Rate-limit algorithm selection:**

- Bursty API traffic, want simple + efficient + burst tolerance → **token bucket**.
- Must feed a fragile/metered downstream at constant pace → **leaky bucket**.
- Coarse hourly/daily quota, precision unimportant → **fixed window**.
- Security/auth/billing, exactness required, low volume → **sliding window log**.
- High scale, want accuracy without cost → **sliding window counter** (production
  default).

**Distribution strategy:**

- Tight global limit, moderate QPS, can tolerate a Redis dependency → **central Redis +
  Lua** (atomic).
- Massive scale, approximate global limit acceptable, latency-critical → **local counters
  + async sync**, fail-open.
- Rough per-node capping only → **local only**.

**Enforcement point:**

- DoS/abuse volume → **edge/CDN** (drop early, cheap).
- Uniform per-tenant/API-key policy → **API gateway** (default).
- Business-context-rich, per-endpoint cost → **in-service** (plus the above; defense in
  depth).

**Hashing scheme:**

- Dynamic membership, minimize data movement, large N → **consistent hashing + virtual
  nodes**.
- Need per-node load cap / avoid hotspots in LB → **consistent hashing with bounded
  loads**.
- Modest N, want ranked replicas / no ring bookkeeping → **rendezvous (HRW) hashing**.
- N fixed forever, uniform load → plain **mod-N** (simplest).

**The recurring tension:** accuracy/consistency ⇄ latency ⇄ availability ⇄ cost/
complexity. Every choice above trades along those axes. Interviewers reward candidates
who *name the axis being traded* and justify the pick against the stated constraints.

---

## Common interview follow-up questions

1. Why does `hash(key) mod N` behave badly when you add a node, and exactly how many keys
   move with consistent hashing? (≈K/N vs ≈K.)
2. What problem do virtual nodes solve, and what's the downside of using thousands of
   them?
3. Token bucket vs leaky bucket — when would you choose each? What does each do to bursts?
4. How does the fixed-window counter allow 2× the intended rate, and how does the sliding
   window counter fix it while staying O(1)?
5. In distributed rate limiting, how do you keep a global limit accurate across N
   gateways? Walk through central-Redis vs local+sync and the accuracy/latency/
   availability trade-offs.
6. Your Redis limiter store goes down — fail open or fail closed? How do you decide?
7. Where do you enforce limits: edge, gateway, or service? Why layer them?
8. How do you use a Redis Lua script to make a token-bucket check atomic, and why is
   plain GET-then-SET wrong?
9. A single tenant/key is a hotspot overloading one shard — what are your options
   (splitting, replication, bounded loads, coalescing)?
10. Rendezvous vs consistent hashing — when is O(N) lookup acceptable and what do you gain?
11. How would you rate-limit an LLM API by tokens (TPM) rather than requests, and route
    for KV-cache affinity?
12. Explain consistent hashing with bounded loads and the role of the ε parameter.
13. How does Redis Cluster's 16384-slot model relate to consistent hashing, and why slots
    instead of hashing keys directly to nodes?
14. Design a rate limiter for 1M req/s across 50 gateways with a global 429 accuracy
    target of ~99% and a p99 added latency budget of 1 ms. What do you build?
15. How does an adaptive concurrency limiter differ from a fixed-rate limiter, and when is
    it better?

---

## References

- Alex Xu, *System Design Interview, Vol. 1* — "Design a Rate Limiter" and "Design a
  Consistent Hashing" chapters (ByteByteGo).
- ByteByteGo blog & YouTube: "Rate Limiting Fundamentals", "Consistent Hashing"
  (bytebytego.com, YouTube channel ByteByteGo).
- Cloudflare Engineering blog: "How we built rate limiting capable of scaling to millions
  of domains" and the sliding-window-counter accuracy analysis.
- Stripe Engineering blog: "Scaling your API with rate limiters" (token bucket + Redis +
  Lua).
- Kleppmann, *Designing Data-Intensive Applications* (DDIA) — Ch. 6 Partitioning
  (consistent hashing, rebalancing) and replication.
- Amazon Dynamo paper (DeCandia et al., 2007) — consistent hashing, virtual nodes,
  preference lists.
- Google Research: "Consistent Hashing with Bounded Loads" (2016) and the Vimeo/HAProxy
  writeup on applying it.
- Thaler & Ravishankar, "Using Name-Based Mappings to Increase Hit Rates" — rendezvous
  (HRW) hashing.
- Lyft/Envoy `ratelimit` service docs; Envoy global rate limiting and `ring_hash`/
  `maglev` load balancer docs.
- Netflix `concurrency-limits` (adaptive limiting) GitHub and tech blog.
- IETF `draft-ietf-httpapi-ratelimit-headers` (RateLimit-* header standard).
- system-design-primer (GitHub, donnemartin).
- YouTube: Gaurav Sen "Consistent Hashing"; Hussein Nasser on rate limiting/Redis;
  "Jordan has no life" system-design series.
