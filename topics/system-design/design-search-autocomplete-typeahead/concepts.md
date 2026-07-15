# Design Search, Autocomplete and Typeahead Systems

Search is one of the most-loved interview prompts because it forces you to
reason across the entire stack: an **ingestion/indexing pipeline** (write path),
a **query/serving path** (read path), a **ranking layer**, and a **caching and
sharding topology** — each with sharply different consistency and latency
budgets. Autocomplete (a.k.a. typeahead) is deceptively simple to state ("show
suggestions as the user types") but is a genuinely hard low-latency,
high-fan-out problem: every keystroke is a query, so a search box that gets
10M searches/day may serve 200M+ autocomplete requests/day, each needing a
sub-100 ms round trip *including network*.

The unifying mental model for the whole topic:

> Search is a **read-optimized denormalization** of your source-of-truth data.
> You pay write-time cost (build an inverted index / trie / vector index) so
> that read time is cheap. Every design choice below is a bet about where to
> spend: **precompute at write time** (fast reads, stale data, expensive
> rebuilds) vs **compute at read time** (fresh data, slow/expensive reads).

For every technique this doc states **what you gain, what you give up, and when
to pick it over the alternative** — that trade-off reasoning is what an
interviewer actually grades.

---

## Problem framing and requirements

Intuition: "search" is an umbrella. Nail down which product you're building,
because the architecture forks hard on the answer.

Three distinct products commonly conflated in interviews:

1. **Autocomplete / typeahead** — as the user types a *prefix*, return the
   top-k *completions* (queries, product names, usernames). Latency-critical
   (per keystroke), tolerant of slight staleness, ranked mostly by popularity.
2. **Full-text search** — user submits a full *query*, return ranked *documents*
   from a corpus. Relevance-critical (BM25 / learning-to-rank), tolerant of
   ~100-500 ms latency.
3. **Semantic / vector search** — retrieve by *meaning* not keywords
   (embeddings + ANN), used for RAG, recommendations, "find similar."

Functional questions to pin down: What is being searched (queries vs documents
vs entities)? Personalized or global? How fresh must results be (Google Trends:
minutes; product catalog: seconds; archival docs: hours)? Multi-language / Unicode?
Prefix-only or middle-of-string matching ("search-as-you-type")?

Non-functional targets that drive the design:

| Dimension          | Autocomplete            | Full-text search        |
|--------------------|-------------------------|-------------------------|
| Latency (p99)      | < 100 ms end-to-end     | < 500 ms                |
| Availability       | 99.9%+ (degrade gracefully) | 99.9%+              |
| Freshness          | seconds-minutes OK      | seconds for hot content |
| Read:write ratio   | ~1000:1 (read-heavy)    | ~100:1                  |
| Consistency        | eventual is fine        | eventual is fine        |

**Trade-off framing to state up front:** search is almost always **AP over CP**
(CAP) — you would rather return slightly stale or slightly incomplete results
fast and available than block or error to guarantee the freshest, most complete
answer. Interviewers love when you declare this explicitly and justify it.

---

## Back-of-envelope capacity estimation

Intuition: autocomplete volume is dominated by keystrokes, and index size is
dominated by the number of distinct queries times average length.

Worked example — a Google-scale search box:

- **Daily searches:** 5B searches/day.
- **Autocomplete multiplier:** each search ≈ 4 keystrokes before selection that
  we serve (we debounce, see below). So ≈ 20B autocomplete requests/day.
- **QPS:** 20B / 86,400 s ≈ **230K QPS average**, peak ≈ 2x = **~500K QPS**.
- **Latency budget:** 100 ms end-to-end minus ~40 ms network leaves ~60 ms
  server-side; this basically *forces* an in-memory data structure and heavy
  caching — you cannot hit disk per keystroke at 500K QPS.

Index sizing for the trie / suggestion store:

- Distinct historical queries: ~10B, but we only keep frequent ones. Say we keep
  the top **100M** distinct prefixes/queries.
- Avg query length ~20 bytes + top-k (say 5) suggestions × ~20 bytes + weights ≈
  ~150 bytes/entry ⇒ 100M × 150 B = **~15 GB**. Fits in RAM on a modest fleet;
  shard for headroom and replication.

Full-text index sizing (inverted index):

- 1B documents × ~1 KB text ⇒ 1 TB raw. Inverted index is typically **20-50%**
  of raw text after compression ⇒ ~200-500 GB. With replication factor 2 and
  overhead, plan ~1-2 TB across the cluster.

**Takeaway numbers to quote:** autocomplete = "hundreds of thousands of QPS,
tens of GB in RAM, sub-100 ms"; full-text = "hundreds of GB to TB index,
sub-500 ms, sharded across many nodes."

---

## Inverted index fundamentals

Intuition: to find documents containing a word without scanning every document,
pre-build a map from **term to the list of documents that contain it** (a
"postings list"). This is the beating heart of every keyword search engine
(Lucene, Elasticsearch, OpenSearch, Solr).

How it works — the pipeline from document to queryable index:

```
Document ──> Analyzer ──> [tokenize] ──> [lowercase] ──> [stopwords] ──>
             [stemming] ──> terms ──> Inverted Index

Term        Postings (docID : term-freq : positions)
--------    -----------------------------------------
"search"    -> [ (d1:2:[0,7]), (d5:1:[3]), (d9:4:[...]) ]
"engine"    -> [ (d1:1:[1]), (d3:1:[9]) ]
```

Key components:
- **Analyzer / tokenizer:** splits text into terms; applies lowercasing,
  stop-word removal, **stemming** (running→run) or **lemmatization**, synonym
  expansion. The *same* analyzer must run at index time and query time or matches
  silently fail.
- **Postings list:** for each term, a sorted list of doc IDs plus term frequency
  and optionally positions (for phrase queries) and offsets (for highlighting).
- **Term dictionary:** the sorted set of all terms, often stored as an **FST**
  (finite state transducer) in Lucene for compact prefix lookups.
- **Segments:** Lucene writes immutable **segments**; new docs create new
  segments, which are periodically **merged**. Immutability is what makes
  lock-free concurrent reads and crash recovery cheap.

Compression matters: postings are delta-encoded (store gaps between doc IDs) and
packed (e.g. Frame-of-Reference, PForDelta) so a postings list of billions of
IDs stays small and cache-friendly.

**Trade-offs:**
- *Inverted index vs scanning / B-tree:* the index gives O(1)-ish term lookup +
  fast intersection of postings, at the cost of write amplification and index
  storage (~20-50% of corpus). A B-tree on a single column can't do full-text
  ranked multi-term queries efficiently.
- *Immutable segments:* gain lock-free reads, cache-friendliness, simple
  recovery; give up in-place updates — a "delete" is a tombstone and space is
  only reclaimed on **merge**, so heavy update workloads cause segment churn and
  merge I/O storms. Pick Lucene-style engines for read-heavy, append-mostly
  corpora; avoid for high-mutation OLTP-style data.
- *Positions/offsets:* enable phrase and proximity search + highlighting but
  inflate index size 2-4x. Store them only if you need phrase queries.

---

## Ranking and relevance

Intuition: retrieval finds *candidate* matches; ranking decides their *order*.
Users only look at the top few results, so ranking quality dominates perceived
search quality far more than recall.

The modern search stack is a **funnel** (multi-stage retrieval + ranking):

```
Query
  │  (1) Retrieval / candidate generation  — cheap, high recall, ~millions→~1000s
  │       BM25 postings intersection, ANN vector recall, filters
  ▼
  │  (2) First-pass ranking (L1)           — cheap features, ~1000s→~100s
  ▼
  │  (3) Re-ranking (L2, learning-to-rank) — expensive features/model, ~100s→~10s
  ▼
Top-k results
```

**BM25** is the workhorse lexical scorer (Lucene default). It improves on TF-IDF
with two ideas: **term-frequency saturation** (the k1 parameter — the 10th
occurrence of a word adds little over the 3rd) and **document-length
normalization** (the b parameter, default 0.75 — a term in a short doc counts
more than in a long one). IDF down-weights common words and boosts rare ones.
Typical defaults: k1 ∈ [1.2, 2.0], b = 0.75.

**Learning to Rank (LTR):** a model (GBDT like LambdaMART, or a neural ranker)
combines many features — BM25 score, freshness, click-through rate,
personalization signals, semantic similarity — trained on labeled/click data to
directly optimize ranking metrics (NDCG, MRR). Applied only in the L2 re-rank
stage on the top candidates because it is expensive per document.

Relevance signals commonly combined: textual match (BM25), popularity/CTR,
recency, geo/personalization, business rules (boosts, pins), quality/spam
signals.

**Trade-offs:**
- *BM25 vs semantic vectors:* BM25 is exact-keyword, interpretable, cheap, no
  training, but blind to synonyms/meaning ("laptop" ≠ "notebook"). Vectors catch
  meaning but miss exact IDs/SKUs and can hallucinate similarity. Best practice
  in 2024-2025: **hybrid** (see hybrid section).
- *More ranking stages = better relevance but more latency and complexity.* Add
  an L2 re-ranker only when top-line relevance metrics justify the added p99 and
  serving cost. A single BM25 pass is often "good enough" for small corpora.
- *Personalized ranking* boosts engagement but breaks cacheability (every user
  sees different results) and complicates debugging/reproducibility. Trade the
  cache hit ratio for relevance only where it moves the needle.

---

## Autocomplete with tries and prefix structures

Intuition: to return completions for a prefix, store all candidate strings in a
**trie** (prefix tree) so that walking down the prefix path lands you at the
subtree of all strings sharing that prefix.

```
        (root)
       /   |   \
      c    t    ...
      |    |
      a    e
     /|    |
    r t    a
    | |    |
   [car][cat][tea]      each terminal node stores frequency/weight
```

Naive trie query = walk to prefix node (O(len(prefix))), then **DFS the subtree**
to collect all completions and sort by weight — but that subtree can be huge, so
the DFS is the bottleneck at scale.

The key optimization: **precompute and cache top-k at each node**. Store, at
every trie node, the top-k (e.g. top 5) completions of that prefix, sorted by
weight. Now a query is: walk to the prefix node (O(len)) and return its cached
list — O(1) after the walk, no subtree scan.

```
node "ca" ─> topk: ["cat"(9000), "car"(6000), "cake"(4000), ...]
node "to" ─> topk: ["today"(...), "tomorrow"(...), ...]
```

Alternative / complementary data structures:
- **Ternary Search Tree (TST):** more memory-efficient than a fat trie (each node
  has left/mid/right instead of an array of 26+ children), slightly slower.
- **Radix tree / Patricia trie:** compresses single-child chains into one edge —
  big memory win for sparse tries with long shared prefixes.
- **FST (finite state transducer):** what Lucene's completion suggester uses —
  a minimized DAG that shares suffixes too, extremely compact, immutable. Great
  for read-only prefix maps, costly to rebuild.
- **Sorted list + binary search / prefix-hashing:** simple, cache-friendly for
  smaller datasets; a prefix is a contiguous range in a sorted array.

**Trade-offs:**
- *Precomputed top-k at nodes vs on-the-fly DFS:* top-k caching turns queries
  O(len) and hits the latency budget, but **inflates memory** (top-k stored at
  every node) and makes **updates expensive** — a single frequency change can
  require updating top-k lists all the way up the prefix path. Pick precompute
  for read-heavy autocomplete (the default); pick on-the-fly only for tiny/rarely
  queried tries.
- *Trie (array children) vs TST vs radix vs FST:* trades memory vs build cost vs
  update flexibility. FST is smallest and fastest to read but effectively
  immutable (rebuild to change); plain trie is easiest to mutate incrementally
  but memory-hungry. Choose FST for static/periodically-rebuilt suggestion sets,
  mutable tries for streaming updates.
- *Prefix-only vs infix ("search-as-you-type"):* a plain trie only matches from
  the start. To match "york" inside "new york" you need **edge n-grams** or
  indexing every suffix, which multiplies index size. Add infix only if the
  product needs it.

---

## Top-k selection and weighting

Intuition: "top-k" is the recurring sub-problem of autocomplete and search —
given many weighted candidates, return the k highest efficiently.

Techniques:
- **Precomputed top-k lists** (as above) — O(1) read, O(rebuild) write.
- **Min-heap of size k** for streaming/on-the-fly selection: O(n log k) to pick
  top-k from n candidates without full sort.
- **Threshold / early-termination algorithms** (e.g. WAND, Block-Max WAND in
  Lucene) skip postings that cannot possibly enter the top-k, dramatically
  cutting the postings scanned for ranked full-text queries.

Weighting the suggestions — what "top" means:
- **Global popularity:** query frequency over some window (all-time vs trailing
  7/30 days). All-time is stable but stale to trends; trailing window captures
  spikes but is noisier.
- **Time-decayed popularity:** weight = Σ e^(−λ·age) so fresh signal dominates —
  captures trending terms ("oscars 2026" spikes then fades) without a hard cutoff.
- **Personalized / contextual weight:** blend global weight with user history,
  location, language. Breaks global cacheability.

**Trade-offs:**
- *All-time count vs sliding window vs time-decay:* stability vs trend
  responsiveness. Time-decay is the modern default (captures trends, self-cleans)
  but needs periodic recomputation and a tuned λ.
- *Exact top-k vs approximate:* approximate top-k (sampling, sketches like
  Count-Min for frequency estimation) saves memory/CPU at massive scale but can
  occasionally misorder near-ties. For autocomplete, near-ties rarely matter, so
  approximate counting (Count-Min Sketch) is a common, defensible choice.
- *Fixed k at build time:* precomputing top-5 is cheap but if the UI later wants
  top-10 you must rebuild. Store a slightly larger k than the UI needs for
  headroom.

---

## Typeahead serving at scale, caching and sharding

Intuition: at hundreds of thousands of QPS with a sub-100 ms budget, the serving
tier is a **fan-out + caching** problem. You cannot recompute per keystroke;
you serve from RAM and cache aggressively.

Reference serving architecture:

```
          ┌───────── CDN / edge (cache popular prefixes) ─────────┐
Client ──> │  debounce + client cache                            │
           ▼
        API Gateway / LB
           ▼
     Suggestion Service (stateless)
        │        │
   L1 cache   L2 distributed cache (Redis: prefix -> topk JSON)
        │        │  (miss)
        ▼        ▼
     Trie shards (in-memory, sharded by prefix)  <── periodic rebuild
                                                     from Data Aggregation
```

Client-side techniques (huge leverage, cost nothing server-side):
- **Debounce/throttle:** wait ~50-100 ms of typing pause before firing a request
  — cuts request volume dramatically and avoids racing responses.
- **Client-side caching + prefetch:** cache responses; once you have suggestions
  for "ca" you can often filter locally for "car" without a round trip.
- **Request cancellation / out-of-order handling:** cancel stale in-flight
  requests so a slow "ca" response doesn't overwrite the fresh "car" one.

Server-side caching:
- **Prefix→top-k cache** in Redis/Memcached is extremely effective because prefix
  popularity is Zipfian — a tiny set of prefixes ("a", "am", "ama"...) covers a
  huge share of traffic. Hit ratios of 90-99% are realistic.
- **Edge/CDN caching** for the most popular, non-personalized prefixes puts
  suggestions physically near users (defeats speed-of-light) and offloads origin.

Sharding strategy — **shard by prefix**:
- Route all prefixes starting with a range (e.g. "a"–"f") to shard 1, etc., or
  hash the *first N characters*. Every keystroke for a given prefix hits one
  shard → good locality and cache affinity.
- **Hazard:** naive first-letter sharding creates **hot shards** ("s", "a", "t"
  are far more common than "z", "q") and **hot keys** during viral events. Fix
  with consistent hashing on a longer prefix, splitting hot ranges, and
  replicating hot shards.

Personalization at scale:
- Serve a **global** cached list, then **re-rank client-side or in a thin layer**
  with the user's personal signals — keeps the expensive global computation
  cacheable while still personalizing. Fully per-user precomputed lists don't
  scale (N_users × N_prefixes).

**Trade-offs:**
- *Shard by prefix vs by hash of full query:* prefix sharding gives cache/locality
  wins but risks hot shards; full-query hashing spreads load evenly but a single
  prefix's completions may span many shards (scatter-gather) — worse latency.
  Prefix sharding + hot-shard replication is the usual winner.
- *Cache everything vs personalize:* caching maximizes hit ratio and minimizes
  cost; personalization improves relevance but is a cache-buster. Hybrid
  (global cache + light personal re-rank) is the standard compromise.
- *Bigger client debounce:* fewer requests and lower cost, but suggestions feel
  laggy. Tune to ~50-150 ms — a UX/cost trade-off.

---

## Indexing pipeline and near-real-time updates

Intuition: the write path is a separate system from the read path. It aggregates
raw signal (query logs, document changes), builds the index/trie, and publishes
it to the serving tier. How fast this loop runs determines **freshness**.

Autocomplete data-aggregation pipeline:

```
Query logs / clickstream
     ▼  (stream: Kafka/Kinesis)
Aggregator (count, time-decay, filter spam/PII)
     ▼
Weighted query set  ──batch──>  Trie/FST builder  ──publish──> Serving shards
                     ──stream──> incremental top-k updates
```

Two update paradigms:
- **Batch rebuild (offline):** periodically (hourly/daily) recompute weights and
  rebuild the whole trie/FST, then atomically swap it into the serving tier
  (blue-green). Simple, consistent, but stale between rebuilds and rebuilds are
  heavy.
- **Near-real-time (NRT) incremental:** stream events and update counts/top-k
  live. Fresh (seconds) but complex — concurrent updates to shared top-k lists,
  ordering, and correctness are hard.

Full-text NRT in Lucene/Elasticsearch:
- New docs go to an in-memory buffer + **translog** (write-ahead log for
  durability). A **refresh** (default every 1 s) makes them a searchable in-memory
  segment → this is the "near-real-time" 1-second visibility. A **flush** fsyncs
  segments to disk and truncates the translog. Background **merges** combine small
  segments into big ones.
- Refresh interval is the key freshness↔throughput knob: shorter = fresher but
  more tiny segments and merge pressure; longer = higher indexing throughput and
  fewer segments.

Change Data Capture (CDC) — the modern ingestion pattern:
- Instead of dual-writing to your DB and your search index (which can drift on
  partial failure), stream the DB's change log (e.g. via Debezium reading MySQL
  binlog / Postgres WAL) into Kafka, and have an indexer consume it into
  Elasticsearch. This makes the search index an **eventually-consistent
  materialized view** of the source of truth, decoupled and replayable.

**Trade-offs:**
- *Batch vs NRT:* batch is simple/consistent/cheap-to-reason-about but stale; NRT
  is fresh but complex and can serve partially-updated state. Pick batch for
  slowly-changing corpora (product catalog nightly), NRT for fast-moving content
  (news, social, trends). Many systems do **both**: batch baseline + NRT overlay.
- *Dual-write vs CDC:* dual-write is simpler to build but risks index/DB
  divergence on crashes and couples the two systems; CDC is more moving parts
  (Kafka, connector) but gives durability, replay, and decoupling. Prefer CDC at
  scale / when correctness matters.
- *Refresh interval / rebuild cadence:* freshness vs indexing cost and merge I/O.
  A classic answer: relax refresh (e.g. 30 s) during bulk backfills, tighten for
  live traffic.
- *Atomic swap (blue-green) vs in-place update:* swap gives a consistent snapshot
  and easy rollback but doubles memory during the swap; in-place is memory-lean
  but can serve inconsistent intermediate state.

---

## Spell correction and fuzzy matching

Intuition: users typo ("teh", "recieve") and expect the system to recover
("did you mean...") or just work. Correction happens by finding dictionary terms
within a small **edit distance** (Levenshtein: insert/delete/substitute; the
**Damerau-Levenshtein** variant adds transposition of adjacent characters).

Techniques, cheapest to richest:
- **Edit-distance / Levenshtein automaton:** Lucene builds a DFA that accepts all
  terms within edit distance 1 or 2 of the query term, then intersects it with
  the term dictionary FST — fast fuzzy term lookup without scanning all terms.
- **BK-tree:** a metric tree indexing the dictionary by edit distance, enabling
  "all words within distance d" queries in sublinear time.
- **n-gram similarity:** index character n-grams (trigrams) of each term; typos
  share most trigrams, so overlap ⇒ candidate. Robust and language-agnostic.
- **SymSpell:** precompute deletes of dictionary terms into a hash map — extremely
  fast (orders of magnitude faster than BK-tree) at the cost of large precomputed
  storage. Modern default for high-throughput spell correction.
- **Context / phrase correction:** Elasticsearch's **phrase suggester** uses an
  n-gram language model to pick corrections that fit the whole phrase (co-occurrence
  and frequency), not just per-token nearest words — "did you mean" quality.
- **Noisy channel model / ML:** P(correction | typed) ∝ P(typed | correction) ·
  P(correction); modern systems use seq2seq/transformer spell correctors trained
  on query logs (the correction the user actually clicked next).

**Trade-offs:**
- *Edit distance 1 vs 2:* distance 2 catches more typos but the candidate set and
  false-positive rate explode; distance 1 (with transpositions) covers most real
  typos cheaply. Standard choice: allow distance 2 only for longer terms.
- *SymSpell vs BK-tree vs Levenshtein automaton:* SymSpell = fastest lookup, huge
  precompute/memory; BK-tree = balanced, moderate memory; automaton = integrates
  natively with Lucene FST. Pick SymSpell for latency-critical at scale, automaton
  when you're already on Lucene.
- *Auto-correct vs suggest ("did you mean"):* silently auto-correcting is smooth
  but wrong for names/codes/rare-but-intended terms (user typed a real SKU);
  suggesting is safe but adds a click. Blend: auto-correct on high confidence +
  "showing results for X, search instead for Y."
- *Term vs phrase suggester:* per-token is cheap but context-blind; phrase adds a
  language model for far better suggestions at higher index/compute cost.

---

## Vector and semantic search as a modern alternative

Intuition: keyword search matches *strings*; semantic search matches *meaning*.
Encode text into a dense **embedding** vector so that semantically similar items
are near each other in vector space, then retrieve by **nearest-neighbor** search.
This is the backbone of modern RAG, recommendations, and "search that understands
intent."

How it works:
```
Query text ──> embedding model ──> query vector q (e.g. 768-dim)
Corpus docs ──> embedding model ──> doc vectors (indexed in ANN structure)
Retrieval: find vectors nearest to q by cosine/dot product (top-k)
```

**Approximate Nearest Neighbor (ANN)** — exact NN over billions of vectors is too
slow, so we approximate:
- **HNSW** (Hierarchical Navigable Small World): a layered proximity graph; greedy
  navigation from top layer down. Excellent recall/latency, high memory, the
  de-facto default (used by pgvector, Weaviate, Qdrant, Elasticsearch, Lucene).
- **IVF** (inverted file): cluster vectors, search only the nearest clusters —
  lower memory, tune nprobe for recall vs speed.
- **PQ** (product quantization): compress vectors to save memory at some recall
  cost; often combined (IVF-PQ) for billion-scale on a budget.

**Hybrid search** (the 2024-2025 best practice): run **BM25 (sparse/lexical)** and
**vector (dense/semantic)** retrieval in parallel and fuse the results, commonly
with **Reciprocal Rank Fusion (RRF)** or a learned weighting. This captures both
exact matches (IDs, rare tokens, names) and semantic matches (synonyms, intent),
covering each other's blind spots.

Semantic autocomplete: beyond prefix trie, embeddings enable "suggest by intent"
(typing "cheap flights to warm places" suggests destinations), and LLMs power
query rewriting/expansion. But for literal prefix completion, tries/FSTs are still
faster and cheaper.

**Trade-offs:**
- *Vector vs inverted-index (BM25):* vectors capture meaning/synonyms and cross
  modality but cost embedding compute, large RAM for the ANN index, are hard to
  debug ("why did this match?"), and miss exact keyword/ID matches. BM25 is cheap,
  interpretable, exact, but literal. **Hybrid beats either alone** in most
  benchmarks — pay the extra complexity only if semantic recall matters.
- *Exact NN vs ANN:* ANN trades a few points of recall for orders-of-magnitude
  speedup; at scale you always use ANN. Tune (efSearch/nprobe) for the
  recall↔latency point you need.
- *HNSW vs IVF-PQ:* HNSW = best recall/latency, highest memory, expensive
  incremental build; IVF-PQ = far less memory, some recall loss, better for
  billion-scale/budget. Pick HNSW for < ~100M vectors and latency-critical;
  IVF-PQ when memory/cost dominates.
- *Embedding freshness / re-embedding cost:* changing the embedding model means
  re-embedding the whole corpus (expensive, a migration). Version your embeddings.
- *Dimensionality:* higher dims = more expressive but more memory and slower
  distance; quantization/dimensionality reduction trades recall for cost.

---

## Elasticsearch and OpenSearch in practice

Intuition: most real interview answers land on "use Elasticsearch/OpenSearch"
(managed Lucene) rather than building from scratch — so know its model and knobs.

Core model:
- An **index** is split into **shards** (each an independent Lucene index);
  shards have **replicas** for HA and read scaling. Shard count is fixed at
  creation (reshard = reindex), so sizing shards is a real design decision.
- Documents are JSON; **mappings** define analyzers and field types. Field types
  for our topic: `completion` (FST-based suggester, heap-resident), `search_as_you_type`
  (auto-builds edge n-gram subfields for infix typeahead), plus `text`/`keyword`.
- **Suggesters:** `completion` (fast prefix autocomplete via FST, prefers a single
  shard), `term`/`phrase` (spell correction), `context` (filter/boost by category
  or geo).

Scaling and reliability:
- **Coordinating node** fan-out: a search scatters to all relevant shards
  (query phase) then gathers/merges top-k (fetch phase) — scatter-gather. Deep
  pagination (`from`+`size`) is expensive because every shard must return
  `from+size`; use `search_after` instead.
- Replicas increase read throughput and survive node loss; more shards parallelize
  but add coordination overhead and per-shard fixed cost. **Over-sharding** is a
  classic mistake.

**Trade-offs:**
- *Managed ES/OpenSearch vs build-your-own:* managed gets you battle-tested
  retrieval, ranking, suggesters, HA out of the box (ship fast); building your own
  trie service gives lower latency and cost at extreme autocomplete scale and full
  control. Most teams should use ES; hyperscale typeahead (Google, LinkedIn) build
  custom in-memory tries.
- *`completion` suggester vs `search_as_you_type` vs custom trie:* completion =
  fastest prefix, heap-resident, single-shard bias; search_as_you_type = supports
  infix/multi-term but larger index; custom trie = ultimate control/latency but
  you own it. Match to product needs and scale.
- *Few large shards vs many small shards:* fewer large shards = less overhead,
  slower recovery/rebalance and coarser parallelism; many small = more parallelism
  and faster recovery but more coordination and memory overhead. Aim ~10-50 GB/shard.

---

## Failure modes and graceful degradation

Intuition: at 500K QPS something is always broken. Design so that failures
**degrade** (worse suggestions) rather than **fall over** (errors/timeouts). For
autocomplete specifically, *no suggestions is an acceptable degraded state* —
the user can still type and press enter.

Common failure modes and mitigations:
- **Hot shard / hot key** (viral prefix, celebrity name): replicate hot shards,
  add per-key caching at edge, split hot key ranges. Consistent hashing avoids
  full reshard.
- **Cache stampede** on a popular prefix expiring: use request coalescing
  (single-flight), stale-while-revalidate, and jittered TTLs.
- **Index rebuild/publish failure:** keep serving the previous good snapshot
  (atomic blue-green swap with rollback); never swap in a partially built index.
- **Slow re-ranker / downstream:** enforce per-stage timeouts and **return
  candidates without L2 re-rank** rather than blocking (graceful relevance
  degradation).
- **Ingestion lag / backpressure:** if Kafka lags, freshness drops but serving is
  unaffected — decoupling the write path protects reads. Monitor consumer lag.
- **Node loss:** replicas serve reads; the coordinator retries on surviving shard
  copies.
- **Query-of-death** (pathological query): circuit-break, cap query complexity
  (max clauses, fuzzy distance), and shed load.

**Trade-offs:** every degradation is a deliberate choice to trade **quality for
availability**. State explicitly: "under overload I return cached/stale/global
(non-personalized) results and drop L2 re-ranking, because a fast decent answer
beats a slow perfect one for search."

---

## Trade-offs and when to use what

The master summary — the table interviewers want to see:

| Decision                     | Option A                | Option B                  | Pick A when… / Pick B when…                                  |
|------------------------------|-------------------------|---------------------------|--------------------------------------------------------------|
| Autocomplete backing store   | In-memory trie/FST      | Elasticsearch completion  | A: hyperscale QPS, own latency/cost. B: pragmatic, ship fast.|
| Suggestion freshness         | Batch rebuild           | NRT/streaming incremental | A: slow-changing corpus. B: trends/news, freshness critical. |
| Top-k                        | Precompute at nodes     | On-the-fly DFS + heap     | A: read-heavy (default). B: tiny/rare tries, freshness.      |
| Suggestion weight            | All-time popularity     | Time-decayed / windowed   | A: stable head. B: capture trends (modern default).          |
| Sharding                     | By prefix               | By hash of full query     | A: locality/cache (usual). B: even load, no hot ranges.      |
| Ingestion                    | Dual-write              | CDC (log → Kafka → index) | A: simple/small. B: correctness, replay, decoupling.         |
| Retrieval                    | BM25 (lexical)          | Vector/semantic           | A: exact/IDs, cheap. B: meaning/synonyms. Hybrid: usually.   |
| ANN index                    | HNSW                    | IVF-PQ                    | A: <100M vec, latency. B: billions, memory/cost.             |
| Spell correction             | SymSpell                | Levenshtein automaton     | A: latency-critical, RAM ok. B: already on Lucene.           |
| Personalization              | Global cached           | Per-user re-rank          | A: max cache hit. B: relevance. Hybrid: global + light rerank.|
| Consistency posture          | —                       | —                         | Almost always AP: fast/available > freshest/complete.        |

Meta-principles to voice in an interview:
1. **Separate read and write paths** — they have opposite optimization goals.
2. **Precompute for reads, tolerate write cost and staleness** — search is AP.
3. **Cache and shard along the access pattern** (prefix), then fix the hot spots.
4. **Degrade gracefully** — trade quality for availability under load.
5. **Hybrid over purity** — batch+NRT, BM25+vector, global+personalized.

---

## Common interview follow-up questions

- How would you support **multi-word / infix** typeahead ("new y" → "new york"),
  not just left-anchored prefixes? (edge n-grams, suffix indexing, cost trade-offs)
- How do you handle **trending queries** that spike suddenly (e.g. breaking news)?
  (time-decay weighting, NRT overlay on batch baseline, hot-key handling)
- How do you keep the suggestion index **fresh within seconds** without expensive
  full rebuilds? (streaming incremental updates vs atomic batch swap)
- How do you **shard** the trie and avoid hot shards? (prefix vs hash, replicate
  hot ranges, consistent hashing)
- How would you add **personalization** without destroying your cache hit ratio?
  (global cache + thin per-user re-rank)
- How do you **spell-correct** at 500K QPS? (SymSpell/automaton, distance limits,
  auto-correct vs "did you mean")
- Walk me through what happens on a single **keystroke** end to end (debounce →
  edge cache → service → cache → shard → response).
- When would you reach for **vector/semantic search**, and how do you combine it
  with BM25? (hybrid, RRF, blind spots of each)
- How do you keep your search index **consistent with the source-of-truth DB**?
  (CDC vs dual-write, materialized-view mental model)
- How do you **rank** results, and where do you insert a learning-to-rank model?
  (retrieval → L1 → L2 funnel, cost per stage)
- How does the system **degrade** when a shard, the re-ranker, or ingestion fails?
- Estimate the **QPS, storage, and memory** for autocomplete at N searches/day.
- Why is search typically **AP not CP**, and when might you actually need CP-ish
  behavior in search? (e.g. compliance/legal takedowns must not appear)

---

## References

- Alex Xu, *System Design Interview* (Vol. 1), Ch. "Design a Search Autocomplete
  System" — trie, top-k precomputation, data-gathering vs query service, sharding.
- ByteByteGo blog & YouTube — "Design a Search Autocomplete System", "How Search
  Engines Work", inverted index and typeahead videos.
- Elastic docs — Search suggesters (completion / term / phrase / context),
  `search_as_you_type` field, near-real-time search (refresh/flush/translog),
  shards and replicas. https://www.elastic.co/guide/
- Apache Lucene documentation — segments, FST term dictionary, BM25 default
  similarity, Block-Max WAND, Levenshtein automaton for fuzzy queries.
- *Okapi BM25* — Wikipedia (formula, k1 term-frequency saturation, b length
  normalization, comparison to TF-IDF). https://en.wikipedia.org/wiki/Okapi_BM25
- Martin Kleppmann, *Designing Data-Intensive Applications* — indexes,
  materialized views, CDC / log-based derived data, stream processing.
- Debezium documentation — CDC from MySQL binlog / Postgres WAL into Kafka for
  keeping search indexes in sync.
- Pinecone / Weaviate / Qdrant learning centers — vector embeddings, HNSW, IVF,
  product quantization, hybrid search and Reciprocal Rank Fusion.
- HNSW paper — Malkov & Yashunin, "Efficient and robust approximate nearest
  neighbor search using Hierarchical Navigable Small World graphs."
- SymSpell (Wolf Garbe) — symmetric-delete spelling correction algorithm.
- The System Design Primer (GitHub, donnemartin) — search, indexing, caching.
- Engineering blogs: LinkedIn (typeahead / Cleo), Meta (Unicorn social search),
  DoorDash / Uber (search platform), Elastic (relevance & vector search).
- YouTube: Gaurav Sen "Design Search Autocomplete", Hussein Nasser (inverted
  index / Elasticsearch internals), "Jordan has no life" system-design series.
