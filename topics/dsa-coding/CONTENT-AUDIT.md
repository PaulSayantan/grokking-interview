# dsa-coding — Content Audit

**Executive summary.** The `dsa-coding` domain is in strong overall health: across 20 audited subtopics, clarity is excellent (avg **4.6/5**) and interview depth is uniformly solid (avg **4.0/5**, every subtopic scored 4). The domain reads like an expert's intuition-first reference — recognition-signal framing, reasoned trade-off tables, and dedicated "common follow-ups" layers are pervasive and genuinely senior-grade. The single systemic weakness is the repo owner's **#2 priority, worked examples** (avg **3.0/5**): nearly every file teaches its hardest algorithm in prose or a bare code template with **no numbers-in/numbers-out trace**, which is exactly where a student gets stuck. Priority breakdown: **1 high** (`hashmap-hashset-internals`), **19 medium**, **0 low**. Headline takeaways: (1) the example gap is domain-wide, not localized — a single "add one traced example to each file's hardest concept" pass would lift the whole domain; (2) the flagship Hard problems (Median of Two Sorted Arrays, LFU, streaming median, Max-XOR bit-trie, histogram, Minimum Window Substring, Gas Station/Task Scheduler/Candy) are the most consistently under-served; (3) there is **one real correctness bug** (`recursion-backtracking`'s permutation dedup rule) and **4 files flagged for web verification** of version-specific claims.

## Scorecard

Sorted: high priority first, then by lowest (clarity + example + depth) sum first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| hashmap-hashset-internals | 5 | 2 | 4 | **high** | Superb on internals but teaches almost entirely via prose/tables; no traced hash/index/resize computation, and thread-safety/ConcurrentHashMap is missing entirely. |
| advanced-structures-string-algorithms | 4 | 3 | 4 | medium | Strong senior toolbox, but KMP matching, Rabin-Karp, Z, Manacher and the flagship "worked example" are prose-only with no numeric traces. |
| bit-manipulation-math | 4 | 3 | 4 | medium | Accurate expert cheat-sheet, but two's complement, the full adder, Single Number III and fast-exp lack bit-level numeric traces. |
| coding-patterns-overview | 4 | 3 | 4 | medium | Excellent meta-map, but the hardest patterns (DP, prefix-sum counting, monotonic stack, cyclic sort) get zero worked trace. |
| greedy-intervals-divide-conquer | 4 | 3 | 4 | medium | Great greedy-vs-DP intuition, but Gas Station/Task Scheduler/Candy/Partition Labels are listed-not-taught and most algorithms lack traces. |
| recursion-backtracking | 4 | 3 | 4 | medium | Well-organized, but a genuinely wrong permutation dedup rule and the "worked example" is only a code template. |
| sorting-and-selection | 4 | 3 | 4 | medium | Strong reference, but counting/radix placement, build-heap O(n), the decision-tree bound and partition are asserted without traces. |
| two-pointers-sliding-window | 4 | 3 | 4 | medium | Clear and correct, but Minimum Window Substring and 2D prefix-sum are asserted-but-unworked; one decision-tree misroute. |
| union-find-dsu | 4 | 3 | 4 | medium | Tight DSU reference, but path compression and union-by-rank have no numeric trace and the inverse-Ackermann "proof intuition" is undelivered. |
| arrays-strings-hashing | 5 | 3 | 4 | medium | Exceptionally clear, but in-place idioms (cyclic sort, sign-encoding, Dutch flag) and prefix-sum-in-hashmap have no trace. |
| binary-search | 5 | 3 | 4 | medium | Excellent template discipline, but Median of Two Sorted Arrays and binary-search-on-answer lack any numeric walkthrough. |
| design-data-structures | 5 | 3 | 4 | medium | Great "list ops → pick structures" method, but LFU and streaming median are prose-only with no code or trace. |
| dynamic-programming | 5 | 3 | 4 | medium | Exceptionally method-first, but only edit distance gets a trace; knapsack, O(n log n) LIS, coin change, Kadane are abstract. |
| graphs-bfs-dfs-topological | 5 | 3 | 4 | medium | Superb intuition, but Kahn's, DFS post-order topo and gray/black cycle detection are code-only with no traces. |
| heaps-priority-queues-topk | 5 | 3 | 4 | medium | Excellent clarity, but two-heaps rebalance and quickselect are hand-waved and sift ops lack numeric traces. |
| linked-lists | 5 | 3 | 4 | medium | Excellent intuition, but Floyd's cycle-start congruence and even-length middle are asserted without a numeric trace. |
| stacks-queues-monotonic | 5 | 3 | 4 | medium | Excellent core teaching, but histogram and trapping rain water are prose-only and strict-vs-non-strict gotcha is missing. |
| trees-bst-traversals | 5 | 3 | 4 | medium | Excellent primer, but BST delete, Validate-BST counterexample, serialize string and general-tree LCA are never traced. |
| tries | 5 | 3 | 4 | medium | Excellent clarity and core code, but Max-XOR bit-trie and prefix-autocomplete enumeration are prose-only. |
| complexity-analysis-big-o | 5 | 4 | 4 | medium | Best-in-domain examples; main gap is Master Theorem taught as a lookup table without recursion-tree intuition. |

## Systemic issues

These themes recur across subtopics and should drive the refinement strategy. Fixing them once, as a pattern, is far higher-leverage than file-by-file cleanup.

### 1. The worked-example gap is domain-wide (≈20 / 20 subtopics) — the dominant theme
Every single file's lowest score is `example_score`, and 18 of 20 sit at exactly 3/5. The recurring failure mode is identical: the hardest concept in each file is delivered as prose or a bare code template with **no numbers-in/numbers-out trace**. Because it is uniform, it is fixable as one editorial pass with a fixed rubric ("for each file's hardest concept, add a small concrete input and trace the state at each step"). Representative example-gap issues flagged `high`: `binary-search` (Median of Two Sorted Arrays), `design-data-structures` (LFU + streaming median), `heaps-priority-queues-topk` (two-heaps rebalance), `dynamic-programming` (knapsack + O(n log n) LIS), `graphs-bfs-dfs-topological` (Kahn's + DFS post-order topo), `hashmap-hashset-internals` (hash/index/resize), `linked-lists` (Floyd's cycle start), `sorting-and-selection` (counting + radix), `tries` (bit-trie Max-XOR), `advanced-structures-string-algorithms` (KMP/Rabin-Karp), `trees-bst-traversals` (BST delete + Validate-BST), `two-pointers-sliding-window` (Minimum Window Substring), `union-find-dsu` (path compression), `arrays-strings-hashing` (in-place idioms).

### 2. Flagship "Hard" problems are named but not taught (≈9 subtopics)
A distinct sub-theme of #1: the single hardest, most-asked problem in a file is left as a one-line link or one prose sentence while easier problems get full code. Students can name it but not implement it. Instances: `binary-search` (Median of Two Sorted Arrays), `design-data-structures` (LFU cache), `heaps` (Find Median from Data Stream), `stacks-queues-monotonic` (Largest Rectangle in Histogram, Trapping Rain Water), `two-pointers` (Minimum Window Substring), `greedy` (Gas Station, Task Scheduler, Candy, Partition Labels — four at once), `bit-manipulation-math` (Maximum XOR), `tries` (Maximum XOR + Word Search II), `trees` (Serialize/Deserialize). Recommend a targeted "teach the flagship Hard problem in the body" checklist.

### 3. Master Theorem taught as a lookup table without recursion-tree intuition (3 subtopics)
`complexity-analysis-big-o`, `greedy-intervals-divide-conquer`, and `recursion-backtracking` all invoke the Master Theorem or `T(n)=2T(n/2)+O(n)→O(n log n)` without the recursion-tree "why." `complexity-analysis-big-o` additionally has a **correctness** issue: the "grows slower/faster" gloss omits the *polynomially* requirement and the gap cases (e.g. `T(n)=2T(n/2)+n log n = Θ(n log²n)`). Fix once (a shared recursion-tree intuition paragraph) and cross-reference.

### 4. Prefix-sum + hashmap counting pattern is under-taught (4 subtopics)
`arrays-strings-hashing`, `coding-patterns-overview`, `hashmap-hashset-internals`, and `two-pointers-sliding-window` all reference "count subarrays summing to k via a hashmap of prefix sums" as a one-line abstraction and none trace it. This is arguably the most-asked senior hashing pattern beyond Two Sum. A single canonical traced example (e.g. `nums=[1,2,3], k=3` with the `{0:1}` seed) should be authored once and reused/cross-linked.

### 5. Quickselect cited-not-taught (3 subtopics)
`heaps-priority-queues-topk`, `sorting-and-selection`, and `greedy-intervals-divide-conquer` (D&C) all cite quickselect as the key O(n)-average alternative but never explain the partition mechanism, the geometric-series intuition, the O(n²) worst case, or median-of-medians. Author one shared quickselect explainer.

### 6. Duplicate-handling / strictness gotchas (4 subtopics) — includes the one real bug
Recurring gap around ties/duplicates: `recursion-backtracking` states a **wrong** permutation dedup rule (`i > start` applied to a template that has no `start`; the correct guard is `i > 0 && nums[i]==nums[i-1] && !used[i-1]`) — this is the domain's most severe correctness issue. Related: `stacks-queues-monotonic` (strict vs non-strict pop / Sum of Subarray Minimums double-counting), `coding-patterns-overview` and `two-pointers-sliding-window` (3Sum duplicate-skipping).

### 7. Copy-paste traps: code that won't run as written (4 subtopics)
Small but real code defects a student would hit on paste: `heaps` (`pop()` references undefined `n`/`A[last]`), `union-find-dsu` (`count` used in `union()` but never declared), `sorting-and-selection` (quickselect calls deterministic Lomuto partition under a `# random pivot` comment → O(n²) on sorted input), `recursion-backtracking` (the dedup rule above). Recommend a "does each snippet run standalone?" pass.

### 8. Version-specific factual claims flagged for web verification (4 subtopics)
`needs_web_verification=true` for `arrays-strings-hashing` (Java ArrayList 1.5x grow, CPython over-allocation formula, HashMap treeify threshold), `hashmap-hashset-internals` (Java 19 `HashMap.newHashMap`, CPython 3.6+ compact dict, presize idiom rounding), `design-data-structures` (Caffeine vs ConcurrentLinkedHashMap, Design Twitter self-follow), and `recursion-backtracking` (HotSpot default main-thread stack size). Batch these into one verification pass.

### 9. Missing thread-safety / concurrency depth (2 subtopics, 1 severe)
`hashmap-hashset-internals` is missing an entire thread-safety section (HashMap not thread-safe, Java 7 resize infinite loop, fail-fast iterators, ConcurrentHashMap) — a top senior-backend follow-up and the main reason this file is the domain's only `high`. `design-data-structures` touches thread-safety only in a follow-up bullet.

## High-priority subtopics

### `hashmap-hashset-internals` (clarity 5 / examples 2 / depth 4)
The only high-priority file: clarity and depth are excellent, but it is the sole subtopic scoring **2** on examples, and it has a genuine depth hole.

1. **[high · example-gap]** `## The hash function and index reduction` / `## Load factor, resize and rehash`: the entire file is abstract prose/tables with **zero** numbers-in/numbers-out trace — the repo owner's #2 priority is essentially unmet here. *Fix:* trace a real key: `hashCode()` → `h ^ (h>>>16)` spread → `& (16-1)` = concrete bucket; add a colliding second key to show chaining; then trace a resize (cap 16, threshold 12, the 13th insert doubles to 32) showing one entry stay at index `i` vs move to `i+16`.
2. **[high · depth]** whole file — **missing thread-safety/concurrency section**. *Fix:* add `## Thread-safety and ConcurrentHashMap`: HashMap unsynchronized; Java 7 concurrent-resize infinite loop; fail-fast iterators via `modCount`; `Collections.synchronizedMap` (coarse lock) vs `ConcurrentHashMap` (per-bin CAS/synchronized, weakly-consistent iterators, no null keys/values) with a "when to use which" line.
3. **[medium · example-gap]** `## Interview Problems`: flagship problems (Two Sum, LRU, Subarray Sum Equals K) are one-line hints; the intro promises they "collapse to O(n)" but none is walked. *Fix:* add a compact traced Two Sum (`[2,7,11,15]`, target 9) and a sketch of the LRU hashmap+DLL structure with a 2-3 op eviction trace.
4. **[medium · gotchas-followups]** null handling only implied by the `key==null?0` snippet. *Fix:* state HashMap allows one null key (bucket 0, bypassing hashCode) and many null values, whereas Hashtable/ConcurrentHashMap throw NPE — and why (absent-vs-mapped-to-null ambiguity under concurrency).
5. **[low · verification]** the presize idiom `new HashMap<>(expectedSize/0.75 + 1)` and the CPython 3.6+ compact-dict claim need confirming (`needs_web_verification=true`); clarify HashMap rounds requested capacity up to the next power of two and mention Java 19+ `HashMap.newHashMap(int)`.

## Refinement plan

Recommended order of attack, sequenced to knock out the systemic themes with the least total effort:

1. **Fix the one correctness bug first** — `recursion-backtracking` permutation dedup rule (Systemic #6). It actively teaches wrong code; highest severity in the domain.
2. **Refine the sole high-priority file** — `hashmap-hashset-internals`: add the traced hash/index/resize walkthrough and the thread-safety section (Systemic #1, #9). This is the biggest single-file quality gap.
3. **Author 3 reusable explainers once, then cross-link** — (a) prefix-sum + hashmap counting trace (Systemic #4, touches 4 files), (b) quickselect mechanism (Systemic #5, 3 files), (c) Master Theorem recursion-tree intuition + the "polynomially / gap-cases" correctness fix (Systemic #3, 3 files, includes the `complexity-analysis-big-o` correctness issue).
4. **Domain-wide worked-example pass** (Systemic #1 + #2) — for each remaining file, add one concrete traced example for its hardest concept and teach its flagship Hard problem in the body. Suggested high-value order by student pain: `binary-search` (Median of Two Sorted Arrays), `design-data-structures` (LFU, streaming median), `heaps` (two-heaps), `dynamic-programming` (knapsack 1-D direction, LIS), `graphs` (Kahn's, DFS post-order), `stacks-queues-monotonic` (histogram), `two-pointers` (Minimum Window Substring), `trees` (BST delete, Validate-BST counterexample), `tries` (bit-trie Max-XOR), `sorting-and-selection` (counting/radix), `advanced-structures-string-algorithms` (KMP matching + Rabin-Karp roll), `linked-lists` (Floyd's derivation), `union-find` (path compression + rank), `bit-manipulation-math` (two's complement + full adder), `greedy` (Gas Station/Task Scheduler/Candy), `arrays-strings-hashing` (cyclic sort + sign-encoding), `coding-patterns-overview`.
5. **Code-snippet runnability sweep** (Systemic #7) — fix `heaps` (`n`/`A[last]`), `union-find` (`count`), `sorting` (quickselect random pivot), plus the strictness/duplicate gotchas in `stacks` and `two-pointers`.
6. **Batch web-verification pass** (Systemic #8) — the **4 files with `needs_web_verification=true`**: `arrays-strings-hashing`, `design-data-structures`, `hashmap-hashset-internals`, `recursion-backtracking`. Verify version-specific numbers (Java/CPython growth factors, treeify threshold, `HashMap.newHashMap`, compact dict, Caffeine, HotSpot stack default, Design Twitter self-follow) in one sitting.

**Missing files:** 0 of 20 (all audit files read successfully).
