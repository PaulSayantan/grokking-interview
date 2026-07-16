# Probabilistic Data Structures for Scale

Probabilistic (a.k.a. *approximate* or *sketch*) data structures trade a bounded,
tunable amount of accuracy for order-of-magnitude reductions in memory and/or latency.
They answer questions like "is this element present?", "how many distinct things have I
seen?", "how often did this key appear?", and "what is my p99?" using **sublinear** space
— often kilobytes where an exact structure would need gigabytes. The core insight: at
scale, *exactness is frequently not worth its price*, and a 0.5–2% error is invisible to
the product but saves 100–1000x the RAM. This file covers the major families, the math
that governs their error, the real systems that ship them, and — most importantly — the
trade-offs and failure modes that a senior engineer must reason about before choosing one.

## Why Approximate, and the Space-Time-Accuracy Trade-off

The fundamental theorem of this whole area is that **exact answers to certain queries
provably require linear space**, while approximate answers require only sublinear (often
logarithmic or constant-relative) space. Counting distinct elements exactly needs Θ(n)
space (you must remember every distinct item, or a perfect hash of it); HyperLogLog
answers it to ~2% in a fixed ~1.5 KB regardless of n. That is not an engineering
convenience — it is a lower bound you cannot beat with a clever exact algorithm.

The three axes you are trading among:

| Axis | What you spend | What you get by relaxing it |
|------|----------------|------------------------------|
| **Space** | RAM / cache footprint | Fit the whole structure in L2/L3 or DRAM instead of spilling to disk |
| **Time** | CPU per op, cache misses | O(1) or O(log n) instead of O(n); stay in cache |
| **Accuracy** | false-positive rate, relative error | This is the knob you *give up* to buy the other two |

Why this matters operationally:

- **Memory is the scarce resource at scale.** A membership set of 1B 64-bit keys is ~8 GB
  exact (plus hash-table overhead, realistically 20–40 GB). A Bloom filter at 1% FP is
  ~1.2 GB — it fits in RAM on one box; the exact set forces sharding or disk.
- **Cache locality dominates latency.** A structure that fits in L3 (tens of MB) serves
  reads in ~10–40 ns; one that spills to DRAM costs ~100 ns; to SSD ~100 µs; to a network
  hop ~500 µs–ms. Shrinking the structure by 100x can move it up a tier of the memory
  hierarchy and cut tail latency by orders of magnitude.
- **Mergeability enables horizontal scale.** The best sketches (HLL, Count-Min, t-digest,
  MinHash) are *linear/mergeable*: shard-local sketches combine into a global answer
  without re-scanning raw data. This is what lets you compute "distinct users across 1000
  shards" cheaply. Exact distinct-count is **not** mergeable without shipping the raw sets.

**One-sided vs two-sided error** is the guarantee that decides safety. Bloom/Cuckoo/CMS
have *one-sided* error (Bloom: false positives but never false negatives; CMS: over-counts
but never under-counts). One-sided error is far easier to build safe systems on because you
know the *direction* of the mistake and can design a correctness backstop (e.g. Bloom says
"maybe present" → do the exact lookup; Bloom says "not present" → skip with certainty).

**When NOT to approximate** (covered in depth in the last section): anything where the
answer is the product of record — billing, ledger balances, inventory decrements,
regulatory counts, uniqueness constraints that must be enforced. There an approximate "yes"
that is wrong 1% of the time is a bug, not a feature.

## Bloom Filters, Mechanism and Math

A Bloom filter is a bit array of `m` bits and `k` independent hash functions. **Insert(x)**:
set the `k` bits at positions `h_1(x)..h_k(x) mod m`. **Query(x)**: if *all* `k` bits are
set → "possibly present"; if *any* is 0 → "**definitely** not present". This asymmetry is
the whole point: **no false negatives, tunable false positives**, and you never store the
elements themselves.

The math (assume good, independent hashes):

- After inserting `n` items into `m` bits with `k` hashes, the probability a specific bit is
  still 0 is `(1 - 1/m)^(kn) ≈ e^(-kn/m)`.
- False-positive probability: `p ≈ (1 - e^(-kn/m))^k`.
- **Optimal number of hashes:** `k* = (m/n) · ln 2 ≈ 0.693 · (m/n)`.
- **Bits per element for target `p`:** `m/n = -ln p / (ln 2)^2 ≈ -1.44 · log2(p)`.
  - p = 1% → ~9.6 bits/elem, k = 7. p = 0.1% → ~14.4 bits/elem, k = 10.
  - Rule of thumb: **~10 bits/element per ~1% FP**, and each additional order-of-magnitude
    reduction in `p` costs a *fixed additive* ~4.8 bits/element. This log-linear cost is why
    you can't drive `p` to zero cheaply.

Key properties and constraints:

- **You must know `n` (or an upper bound) up front** to size `m`. If you overfill (actual n
  >> planned), the bit array saturates, the FP rate blows past target, and eventually
  approaches 1 (useless). Bloom filters do **not** degrade gracefully into "just a bit
  slower" — they degrade into "always says maybe".
- **Cannot delete.** Clearing bits for one element would clear bits shared by others,
  introducing false negatives — which breaks the core guarantee. Deletion needs a counting
  Bloom or a cuckoo/quotient filter (next section).
- **`k` cache misses per query** in the naive layout. *Blocked Bloom filters* confine all
  `k` bits of an element to a single cache-line-sized block, trading a slightly worse FP
  rate for ~1 cache miss/query — a big real-world speedup (used in RocksDB, Impala).

```
m = 16 bits, k = 3
insert "cat": set bits {2, 7, 11}
insert "dog": set bits {2, 9, 14}
index: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
bit:   0 0 1 0 0 0 0 1 0 1 0  1  0  0  1  0
query "cow" -> hashes to {2, 9, 5}; bit 5 == 0 -> DEFINITELY NOT PRESENT
query "fox" -> hashes to {2, 7, 14}; all set -> "MAYBE" (false positive: fox never inserted)
```

## Bloom Filter Uses and Failure Modes

Canonical production uses (all exploit the "definitely-not-present → skip expensive work"
direction):

- **LSM-tree SSTable skipping (RocksDB, Cassandra, HBase, LevelDB, ScyllaDB).** Each SSTable
  carries a Bloom filter over its keys. A point lookup checks the filter before doing a disk
  read/seek; "not present" avoids the I/O entirely. This is the single most important use of
  Bloom filters in databases: it turns a read that would touch every level into one that
  usually touches only the level that has the key. A poorly tuned Bloom filter (too small,
  too high FP) directly inflates read amplification.
- **Cache / DB negative-lookup guard ("cache penetration" defense).** Before hitting the
  origin DB for a key, ask a Bloom filter of *existing* keys; "definitely not present" → skip
  the DB and return miss. Protects against floods of lookups for non-existent keys.
- **Crawler / dedup URL seen-set.** Google's original crawler, Bitcoin SPV clients, and web
  crawlers use Bloom filters to answer "have I already fetched this URL?" cheaply. A false
  positive here means occasionally *skipping* a URL you hadn't actually seen — an acceptable
  loss for a crawler.
- **CDN / cache admission (one-hit-wonder filter).** Only admit an object to cache on its
  *second* request; a Bloom filter tracks "seen once." Filters out one-hit-wonders that would
  pollute the cache. Akamai and others use this pattern.
- **Chrome Safe Browsing** historically used a Bloom-filter-like local set of malicious URLs;
  "maybe malicious" triggers a server round-trip for the exact check.

Failure modes / what breaks first:

- **FP-rate drift from underestimating n.** The #1 failure. Your 1% filter silently becomes a
  10% filter, and downstream "maybe present" work (DB reads, network calls) balloons. Monitor
  observed fill ratio, not just planned n.
- **Correlated / weak hashes** collapse the independence assumption; real systems use
  double-hashing (`g_i(x) = h1(x) + i·h2(x)`) which is provably fine, or one strong 128-bit
  hash split into two 64-bit halves.
- **A false positive is only safe if there is an exact backstop.** In LSM lookups the backstop
  is the actual SSTable read (a FP costs a wasted read, not a wrong answer). If you use a Bloom
  filter's "maybe" as a *final* answer with no backstop, false positives become correctness bugs.
- **Scaling: you can't shrink or resize** a saturated filter without rebuilding from source.
  *Scalable Bloom filters* chain progressively larger filters with geometrically tightening FP
  rates to bound the aggregate error when n is unknown.

## Counting Bloom, Cuckoo, and Quotient Filters

Standard Bloom filters can't delete. Three families fix this, each with a different trade-off.

**Counting Bloom filter (CBF):** replace each bit with a small counter (typically 4 bits).
Insert increments the `k` counters; delete decrements them; query = "all counters > 0". Now
deletion is safe (as long as you only delete elements actually inserted — deleting a
never-inserted element can corrupt counters and *introduce false negatives*). Cost: ~3–4x the
space of a plain Bloom filter for the same FP rate, and counter **overflow** (a 4-bit counter
saturates at 15) can cause under-counting on delete. CBFs were the classic answer but are
largely superseded by cuckoo filters.

**Cuckoo filter:** stores a short *fingerprint* (e.g. 8–16 bits) of each element in a cuckoo
hash table with two candidate buckets per item (`i1 = hash(x)`, `i2 = i1 XOR hash(fingerprint)`
— the "partial-key cuckoo" trick lets you relocate items knowing only the fingerprint). Query
checks both buckets for the fingerprint. Deletion = remove the matching fingerprint from a
bucket. Advantages: **supports deletion, better space efficiency than CBF, and better cache
locality** (2 bucket probes vs k scattered bits). For FP rates below ~3% cuckoo filters use
*less* space than Bloom filters. Trade-offs: insertion can **fail** when the table is too full
(cuckoo eviction cascades hit a max-kick limit → you must resize/rebuild), practical load
factor ~95%, and — subtly — inserting the *same* element more than a bucket-capacity number of
times will fail (duplicates consume slots). Used where deletion + high load matter.

**Quotient filter:** stores fingerprints in a compact open-addressed hash table using
*quotienting* — split the fingerprint into a quotient (the bucket index) and a remainder
(stored), with 3 metadata bits per slot to resolve which remainders belong to which quotient.
Advantages: **cache-friendly (sequential probes), mergeable, resizable, and can be written to
SSD efficiently** (the RSQF/CQF variants). Counting Quotient Filters (CQF) also count
multiplicities. Trade-off: more complex, and performance degrades as load factor approaches
full (long "runs" of shifted slots). Used in storage/genomics (e.g. Squeakr, k-mer counting).

| Filter | Delete? | Space vs Bloom | Cache behavior | Failure mode |
|--------|---------|----------------|----------------|--------------|
| **Bloom** | No | baseline | k random probes | saturates, FP→1 if overfilled |
| **Blocked Bloom** | No | slightly worse FP | 1 cache line | same, +intra-block skew |
| **Counting Bloom** | Yes | ~3–4x larger | k random probes | counter overflow; false negatives on bad delete |
| **Cuckoo** | Yes | smaller for p<3% | 2 buckets | insert fails near full; dup limit |
| **Quotient** | Yes | comparable/better | sequential | degrades near full load |

## HyperLogLog for Cardinality Estimation

**Problem:** count distinct elements (unique visitors, distinct search terms, distinct source
IPs) over a massive stream. Exact requires storing every distinct value (Θ(n) space).
HyperLogLog (HLL) estimates cardinality up to billions in a **fixed ~1.5 KB** with ~2% error.

**Mechanism (intuition first):** hash each element to a uniform bit string. In a random stream
of hashes, seeing a hash with `ρ` leading zeros suggests you've seen ~`2^ρ` distinct items
(long runs of zeros are rare). Tracking just the maximum `ρ` (that's the *Flajolet–Martin*
idea) is high-variance. HLL reduces variance by **stochastic averaging**: use the first `p`
bits of the hash to pick one of `m = 2^p` registers, and store in each register the max `ρ`
seen for that bucket. The estimate is the *harmonic mean* of `2^register` across buckets,
scaled by a bias-correction constant `α_m`:

```
E = α_m · m^2 / Σ_j 2^(-M[j])         (harmonic mean damps large-register outliers)
```

- **Standard error ≈ 1.04 / √m.** With `m = 2^14 = 16384` registers of ~6 bits each →
  ~12 KB raw, ~1.5 KB compressed → **error ≈ 1.04/128 ≈ 0.81%** (Redis uses p=14, quotes ~0.81%).
  Halving the error costs 4x the registers (√m in the denominator).
- **HLL++ (Google)** adds 64-bit hashing (removes the 2^32 ceiling), bias correction for small
  cardinalities, and a **sparse representation** that is exact-ish and tiny for low n, switching
  to dense at scale.

**Killer property — mergeability.** The union of two HLLs is the register-wise `max`; this is
exact and lossless (the merged HLL equals the HLL you'd get from the combined stream). So you
compute per-shard HLLs and merge for a global distinct count with no re-scan. **Intersections
are NOT directly supported** — you estimate them via inclusion–exclusion
(`|A∩B| = |A| + |B| − |A∪B|`), which compounds the relative errors and is unreliable when the
sets are very different in size or the intersection is small.

**Real systems:** Redis `PFADD`/`PFCOUNT`/`PFMERGE`; Google BigQuery `APPROX_COUNT_DISTINCT`
(HLL++); Redshift, Presto/Trino, Druid, Snowflake; Spark `approx_count_distinct`. Used for
unique-visitor dashboards, distinct-query counting, distinct-IP DDoS signals.

**Trade-offs / when it fails:** error is *relative*, not absolute — fine for "12.4M ± 100K
uniques," useless when you need to know if a count is exactly 0 vs 1 (e.g. "did this specific
user visit?"). No per-element membership (you can't ask "is X in the set"). Small-range bias
without HLL++ corrections. If you need both membership *and* count, HLL is the wrong tool.

## Count-Min Sketch for Frequency and Heavy Hitters

**Problem:** estimate the frequency `f(x)` of each key in a stream (and find heavy hitters /
top-k / trending) without a per-key exact counter (which is Θ(distinct keys) space). Count-Min
Sketch (CMS) does it in a fixed 2-D array.

**Mechanism:** a `d × w` matrix of counters and `d` independent hash functions (one per row).
**Update(x, c):** for each row `i`, `count[i][h_i(x)] += c`. **Estimate(x):** return the
**minimum** over rows: `f̂(x) = min_i count[i][h_i(x)]`. Taking the min discards rows where
`x` collided with a heavy key. CMS **only over-estimates** (collisions add counts; nothing
subtracts) — one-sided error, like Bloom.

Error guarantee (for point queries on non-negative streams):

- Set `w = ⌈e/ε⌉` and `d = ⌈ln(1/δ)⌉`. Then with probability ≥ `1 − δ`:
  `f̂(x) ≤ f(x) + ε·N`, where `N` = total count (L1 norm of the stream).
- The overestimate is bounded by `ε·N` — i.e. error is relative to the **total stream mass**,
  which is why CMS is accurate for heavy hitters (whose true count >> ε·N) and *unreliable for
  rare keys* (whose true count may be dwarfed by ε·N of noise). Example: ε=0.001, δ=0.001 →
  w≈2718, d≈7 → ~19K counters (~76 KB at 4 bytes) covers a stream of any key-cardinality.

**Heavy hitters / top-k:** CMS + a min-heap of the top-k candidates; on each update, estimate
and conditionally update the heap. Because CMS over-counts, you may admit a few false heavy
hitters but never *miss* a true one whose count exceeds threshold (relative to the error bound).

**Real systems / uses:** trending topics, "top talkers" in network telemetry, per-key **rate
limiting / abuse detection** at the edge (approximate counters per IP/API key are fine — you
tolerate slight over-counting, which fails *safe* toward throttling), advertising frequency
capping, and stream analytics (Spark, Flink, Redis-Bloom `CMS.*` commands).

**Trade-offs / variants:** plain CMS assumes **non-negative** counts; with deletions/negatives
(a "turnstile" stream) the min bound breaks — use **Count-Sketch** (uses ±1 hashes and takes
the *median*, giving unbiased two-sided estimates) instead. CMS gives no membership and no
distinct-count. Conservative-update (only increment the minimum cells) reduces over-count
empirically. **Failure mode:** under-provisioned `w` on a heavy-tailed stream makes light keys
report large phantom counts — a rate limiter built on it would throttle innocent low-volume
users. Distinguishing CMS (freq), Bloom (membership), and HLL (cardinality) is a classic
interview trap: they answer *different* questions and are not interchangeable.

## Skip Lists as Probabilistic Balanced Structures

A skip list is a probabilistically balanced ordered structure: a base sorted linked list with
additional "express-lane" linked lists stacked above it. An element appears in level `L` with
probability `p^L` (typically `p = 1/2` or `1/4`) — decided by coin flips at insert time. Search
starts at the top lane, moves right until it would overshoot, then drops down a level; this
gives **expected O(log n)** search, insert, and delete with **high-probability** bounds.

Why it matters vs balanced BSTs (red-black, AVL, B-trees):

- **Simplicity and concurrency.** No rotations; inserts/deletes are local pointer splices. This
  makes **lock-free / fine-grained-locking** concurrent implementations far easier than
  concurrent balanced trees. Java's `ConcurrentSkipListMap`/`Set` are the standard lock-free
  ordered map.
- **No global rebalancing** → predictable, low tail latency for writes (no cascading rotations
  or node splits). B-trees can have occasional expensive splits; skip lists amortize smoothly.
- **Range scans** are trivial (walk the bottom list) — same as B-trees, unlike hash structures.

**Real systems:** **Redis sorted sets (ZSET)** use a skip list (plus a hash map for O(1)
score lookup) to support ranked ranges and O(log n) rank queries. **LevelDB / RocksDB memtable**
is a skip list — chosen because concurrent inserts and ordered iteration are both needed while
the memtable is mutable, before it's flushed to an immutable SSTable. Apache HBase and Lucene
use them in places too.

**Trade-offs / failure modes:** it's *probabilistic* — worst case is O(n) (all coins land the
same way), astronomically unlikely but real; adversarial inputs can't force it (levels come from
a PRNG, not key values), which is a security edge over some deterministic structures. **Memory
overhead**: extra forward pointers (~2 pointers/node on average at p=1/2 → ~1.33 with p=1/4);
B-trees pack keys densely per cache-line/page and thus win on **cache/disk locality and memory
density** — which is exactly why on-disk databases use B-trees and in-memory/LSM-memtable use
skip lists. Pointer chasing is cache-unfriendly relative to a B-tree's contiguous nodes.

## MinHash, SimHash, and LSH for Near-Duplicate Detection

**Problem:** find near-duplicate documents / similar items among billions of pairs. Exact
pairwise comparison is O(n²) — infeasible. These techniques reduce similarity search to hashing
so similar items land in the same bucket.

**MinHash (Jaccard similarity).** Represent each document as a set of shingles (k-grams). The
Jaccard similarity `J(A,B) = |A∩B| / |A∪B|`. Key fact: for a random permutation (hash) `h`,
`P[min(h(A)) = min(h(B))] = J(A,B)`. So take `k` independent hashes, keep each set's minimum
under each → a **MinHash signature** of length `k`. The fraction of matching signature positions
is an unbiased estimate of Jaccard, with standard error ≈ `1/√k` (k=200 → ~7% error). Signatures
are tiny and comparable across the corpus. Used by AltaVista (its origin, Broder), search-engine
dedup, and recommendation/similarity systems.

**SimHash (cosine / Hamming).** Charikar's SimHash maps a high-dimensional weighted feature
vector to a single `b`-bit fingerprint such that the **Hamming distance** between fingerprints
tracks the cosine angle between vectors. Near-duplicates differ in only a few bits. **Google
uses 64-bit SimHash for web-page dedup** (Manku et al.) — near-dupes typically differ in ≤3 bits;
you then solve the "find all fingerprints within Hamming distance 3" problem with permuted tables.
SimHash is more compact than MinHash (one word vs a k-length signature) and better for cosine/TF-
IDF-weighted text; MinHash is the natural fit for set/Jaccard similarity.

**Locality-Sensitive Hashing (LSH)** is the umbrella framework: a hash family is
`(r, cr, p1, p2)`-sensitive if near points collide with prob ≥ p1 and far points with prob ≤ p2.
The **banding technique** for MinHash: split the length-k signature into `b` bands of `r` rows
(k = b·r); two items are candidate pairs if they match on *all* r rows of *any* band. The
probability two items with Jaccard `s` become candidates is `1 − (1 − s^r)^b` — an **S-curve**
whose threshold ≈ `(1/b)^(1/r)`. Tuning `b` and `r` trades **false positives (wasted candidate
comparisons) vs false negatives (missed true dupes)** and sets where the S-curve's steep part
sits. This is the master trade-off in near-dup systems.

**Trade-offs / failure modes:** LSH gives *approximate* nearest neighbors — it can miss true
near-dupes (false negatives), which for a legal/compliance dedup may be unacceptable but for web
crawl dedup is fine. Choosing `k`, `b`, `r` wrong either floods you with candidate pairs (compute
blowup) or misses matches. For modern semantic similarity, learned embeddings + ANN indexes
(HNSW, IVF-PQ, ScaNN) have largely displaced classical LSH for *vector* search, but MinHash/
SimHash remain the workhorses for *exact-shingle* and *text* near-dup at web scale because they
need no training and are cheap to compute and store.

## Streaming Quantiles with t-digest and DDSketch

**Problem:** compute p50/p99/p999 latency over a high-volume stream without storing all samples
(exact quantiles need the full sorted dataset, O(n) space) and be **mergeable** across hosts.
Naive approaches fail: per-bucket histograms with fixed bucket boundaries mis-estimate tails and
can't be re-bucketed; averaging percentiles across hosts is **mathematically invalid** (you
cannot average p99s — a notorious monitoring bug).

**t-digest (Ted Dunning).** Adaptively clusters samples into *centroids* whose allowed size
scales with a "scale function" `k(q)` so that clusters near the tails (q→0 or q→1) are kept
*small* (fine resolution) and clusters near the median are allowed to be large (coarse). Result:
**high relative accuracy at the extreme quantiles** (p999, p9999) where you care most, in a few
KB, and it's **mergeable** (concatenate centroid lists and re-cluster). Error is *relative to q*
— excellent at the tails, looser in the middle. No pre-specified value range needed. Widely used
(Elasticsearch percentiles, many metrics pipelines).

**DDSketch (Datadog).** Uses **exponentially-spaced buckets**: bucket index `i = ⌈log_γ(v)⌉`
with `γ = (1+α)/(1−α)`. This gives a hard **relative-error guarantee**: the reported quantile is
within a *fixed* `α` relative error of the true value for *every* quantile (`|v̂ − v| ≤ α·v`).
Strengths: provable relative-error bound (t-digest has only empirical accuracy), fully mergeable
(bucket-wise add), and fast. Trade-offs: needs a value range assumption to bound bucket count
(handled by collapsing lowest buckets / a max-bucket cap), and it assumes positive values
(latency is fine). DDSketch is often preferred when you need a *guaranteed* error bound on p99
SLOs; t-digest when you want great tail resolution with minimal fuss.

| Method | Error type | Mergeable | Tail accuracy | Guarantee |
|--------|-----------|-----------|---------------|-----------|
| Fixed-bucket histogram | absolute, bucket-width | yes (same buckets) | poor unless bucketed for tails | none |
| Naive avg-of-percentiles | — | **invalid** | — | **wrong** |
| **t-digest** | relative to q | yes | excellent at extremes | empirical |
| **DDSketch** | relative (fixed α) | yes | uniform relative | **provable α bound** |

**Why it matters:** "The Tail at Scale" (Dean & Barroso) shows that in a service fanning out to
N leaves, the *slowest* leaf dominates user-perceived latency, so p99/p999 are the numbers that
matter — and you must measure them correctly *and mergeably* across a fleet. Storing raw latencies
per host and centralizing is infeasible at millions of req/s; mergeable sketches are the standard
answer. **Failure mode:** teams that store histograms with buckets tuned for the median silently
report garbage p999; teams that average percentiles across hosts report numbers that are simply
false. Use a mergeable quantile sketch, and merge the *sketches*, never the *percentiles*.

## Reservoir Sampling over Streams

**Problem:** keep a *uniform* random sample of `s` items from a stream of unknown, unbounded
length `n`, in O(s) space and one pass, without knowing `n` in advance (you can't do "pick s of
n" because you never learn n and can't hold the stream).

**Algorithm R (Vitter):** fill the reservoir with the first `s` items. For the `i`-th item
(i > s), pick a random integer `j ∈ [1, i]`; if `j ≤ s`, replace reservoir slot `j` with the new
item. **Invariant:** after processing `i` items, every item seen so far is in the reservoir with
probability exactly `s/i` — proved by induction, giving a uniform sample at every prefix.

```
reservoir size s=3
items 1,2,3      -> reservoir = [1,2,3]
item 4 (i=4): j=rand(1..4); if j<=3 replace slot j  (P(keep 4)=3/4)
item 5 (i=5): j=rand(1..5); if j<=3 replace slot j  (P(keep 5)=3/5)
... each seen item retained w.p. s/i
```

**Variants:** *Algorithm L* skips ahead by drawing how many items to ignore before the next
replacement — O(s·(1 + log(n/s))) work instead of O(n) RNG calls, a big win for huge streams.
*Weighted reservoir sampling* (A-Res, Efraimidis–Spirakis) assigns each item a key `u^(1/w)` and
keeps the top-s by key, for sampling proportional to weight. *Distributed/mergeable* reservoirs
combine per-shard samples (weight by shard item counts) to get a uniform global sample.

**Real uses:** sampling log lines / traces for **observability at fixed cost** (keep 1000 sample
requests/min regardless of traffic), A/B experiment exposure sampling, ML training-set subsampling
from a firehose, and Dapper-style **distributed tracing** sampling. Reservoir sampling gives an
*unbiased* sample you can compute statistics on — unlike "keep the first N" (biased to early
traffic) or "keep every k-th" (aliases with periodic patterns).

**Trade-offs:** gives you a *sample*, not aggregate answers — you then estimate metrics from the
sample with sampling error ~`1/√s`. It's the right tool when you need to *retain raw exemplars*
(debugging, arbitrary later queries) rather than a single pre-decided aggregate (for which HLL/CMS/
t-digest are more space-efficient). Tail events are, by construction, likely to be *missed* by a
uniform sample — for rare-but-important events (errors), bias the sampling (e.g. tail-based
trace sampling) rather than sampling uniformly.

## Choosing the Error Budget and When Not to Approximate

**Framework for choosing a structure** (map the question to the tool — the #1 interview skill):

| Question you're answering | Structure | Error direction |
|---------------------------|-----------|-----------------|
| Is X present? (membership) | Bloom / Cuckoo / Quotient | FP only (Bloom), or w/ delete |
| How many *distinct* Xs? (cardinality) | HyperLogLog | ±relative |
| How often did X occur? / top-k | Count-Min Sketch | over-count only |
| Ordered map, ranges, concurrent | Skip list | exact (probabilistic balance) |
| Are A and B near-duplicates? | MinHash / SimHash + LSH | two-sided (tunable) |
| What's my p99/p999? | t-digest / DDSketch | relative |
| Keep a uniform raw sample | Reservoir sampling | sampling error |

**Setting the error budget:** work backward from the *product* tolerance and the *cost of a
mistake in each direction*. A unique-visitor dashboard tolerates ±2% (HLL p=14, 1.5 KB); an edge
rate limiter tolerates over-counting (fails safe → throttle) but not under-counting (lets abuse
through) — so CMS's over-count bias is a *feature*. An LSM Bloom filter's FP costs one wasted
disk read, so 1% is fine; a *final-answer* membership check with no backstop needs ~0. Remember
the cost curves: Bloom bits/elem is *log-linear* in 1/p (~+4.8 bits per 10x), HLL error is `1/√m`
(4x space to halve error), MinHash/quantile errors are `1/√k` — so pushing accuracy an order of
magnitude is expensive, and you should stop at the product's real tolerance.

**When NOT to approximate — the safety line:**

- **Money and ledgers.** Billing quantities, account balances, invoice line counts, payment
  idempotency keys. An approximate "already charged?" that is wrong 1% of the time double-charges
  or drops charges. Use exact stores with strong consistency.
- **Uniqueness / correctness constraints.** Enforcing "this username/email/order-id is unique"
  needs an exact index — a Bloom filter's false positive would wrongly reject a valid new value,
  and you cannot enumerate what it rejected. (Bloom is fine as a *fast negative pre-check* in
  front of an exact index, never as the enforcer.)
- **Legal / regulatory counts.** Distinct-user reports for compliance, vote tallies, ad-billing
  impression counts that advertisers are charged for — these are the record; approximation is a
  liability. (Ad *frequency capping* can be approximate; ad *billing* cannot.)
- **Security decisions with no backstop.** "Is this token revoked?" answered by a Bloom filter's
  "maybe" without an exact check can *fail open*. One-sided error direction must fail *closed*.
- **Small n.** If n is small enough that the exact structure fits in cache anyway (thousands of
  items), a sketch adds error for no space win — just use a hash set. Sketches pay off at scale.

**The senior mental model:** approximation is safe precisely when (a) the error is *bounded and
tunable*, (b) the error *direction* is known and the system is designed to fail in the safe
direction, and (c) there is either a correctness backstop or the product genuinely tolerates the
error. Violate any of those three and the "clever" sketch becomes a correctness bug that is hard
to detect because it's wrong only occasionally.

## Common interview follow-up questions

- A Bloom filter is showing a 12% false-positive rate but you sized it for 1%. What happened and
  how do you diagnose and fix it in production? (Underestimated n / saturation; check fill ratio;
  rebuild larger or switch to a scalable Bloom filter.)
- Why can't you delete from a standard Bloom filter, and what are the exact trade-offs of the
  three structures that *can* delete?
- You need distinct-user counts per region *and* a global total across 200 shards, updated hourly.
  Design it. Why is HLL's mergeability essential and why is exact distinct-count a poor fit?
- Your dashboard averages the p99 latency reported by 500 hosts. Why is the number wrong, and what
  do you do instead?
- Design an edge rate limiter for 10M API keys with a 50 MB memory budget. Which structure, which
  error direction do you want, and why does over-counting fail *safe* here?
- When would you choose a cuckoo filter over a counting Bloom filter, and when would neither work?
- Explain why you cannot use a Bloom filter to enforce a uniqueness constraint but *can* use it to
  speed one up.
- HLL says 1.02M uniques; the exact answer matters for ad billing. What do you tell the PM?
- Tune an LSH banding scheme: you're getting too many candidate pairs to compare. Which knob, which
  way, and what do you risk?
- Compare skip lists vs B-trees for an in-memory memtable vs an on-disk index — why does each system
  pick what it picks?

## References

- Bloom, "Space/Time Trade-offs in Hash Coding with Allowable Errors" (1970) — original Bloom filter.
- Fan, Andersen, Kaminsky, Mitzenmacher, "Cuckoo Filter: Practically Better Than Bloom" (2014).
- Bender et al., "Don't Thrash: How to Cache Your Hash on Flash" — quotient filters / RSQF; Pandey
  et al., "A General-Purpose Counting Filter" (CQF, 2017).
- Flajolet, Fusy, Gandouet, Meunier, "HyperLogLog: the analysis of a near-optimal cardinality
  estimation algorithm" (2007); Heule, Nunkesser, Hall, "HyperLogLog in Practice" (HLL++, Google, 2013).
- Cormode & Muthukrishnan, "An Improved Data Stream Summary: the Count-Min Sketch and its
  Applications" (2005); Charikar, Chen, Farach-Colton, "Finding Frequent Items in Data Streams"
  (Count-Sketch).
- Pugh, "Skip Lists: A Probabilistic Alternative to Balanced Trees" (1990); Java
  `ConcurrentSkipListMap` docs; Redis ZSET and RocksDB/LevelDB memtable design docs.
- Broder, "On the Resemblance and Containment of Documents" (MinHash); Charikar, "Similarity
  Estimation Techniques from Rounding Algorithms" (SimHash); Manku, Jain, Das Sarma, "Detecting
  Near-Duplicates for Web Crawling" (Google 64-bit SimHash, 2007); Indyk & Motwani (LSH); Leskovec,
  Rajaraman, Ullman, "Mining of Massive Datasets" ch. 3 (LSH banding).
- Dunning & Ertl, "Computing Extremely Accurate Quantiles Using t-Digests"; Masson, Rim, Lee,
  "DDSketch: A Fast and Fully-Mergeable Quantile Sketch with Relative-Error Guarantees" (Datadog, 2019).
- Vitter, "Random Sampling with a Reservoir" (1985, Algorithms R and L); Efraimidis & Spirakis,
  "Weighted Random Sampling with a Reservoir".
- Dean & Barroso, "The Tail at Scale" (CACM 2013); Kleppmann, "Designing Data-Intensive
  Applications" (LSM-trees / SSTables / Bloom filters, ch. 3).
- Redis documentation (PFADD/PFCOUNT/PFMERGE, sorted sets, RedisBloom CMS/Cuckoo); Google BigQuery
  APPROX_COUNT_DISTINCT / APPROX_QUANTILES docs.
