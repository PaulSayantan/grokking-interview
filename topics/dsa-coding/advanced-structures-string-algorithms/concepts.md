# Advanced Structures & String Algorithms

This note collects the "senior/hard" toolbox that shows up in the deeper coding rounds:
**range-query structures** (Fenwick / Binary Indexed Tree and Segment Tree, plus lazy
propagation), **balanced BSTs** at a conceptual level (AVL / red-black rotations and the
`O(log n)` guarantee they buy), and the **string-matching canon** (KMP, Rabin-Karp,
Z-algorithm, Manacher, with a nod to suffix arrays/automata).

The unifying theme is *when a plain hash map or a sort is not enough*. If you only need
membership or grouping, a `HashMap` wins. The structures here earn their complexity when
you have **many interleaved queries and updates over ranges/orderings** (Fenwick/segment
tree) or **linear-time pattern structure over strings** (KMP/Z/Manacher) where the naive
`O(n·m)` or `O(n²)` approach is too slow.

Each section leads with the internals — memory layout and per-operation complexity — then
the recognition signal and template, then gotchas.

## Fenwick tree (Binary Indexed Tree) internals

A **Fenwick tree** (Binary Indexed Tree, BIT) is a flat array `tree[1..n]` that answers
**prefix-sum queries** and **point updates** in `O(log n)`, using only `O(n)` space and a
few lines of code. It is the go-to when you need a mutable prefix-sum / cumulative-
frequency structure and nothing fancier.

The trick is that index `i` (1-based) is made **responsible for a range of values ending
at `i`**, and the *length* of that range equals the value of the **lowest set bit** of
`i`, written `i & (-i)`. So `tree[i]` stores the sum of the `lowbit(i)` elements
`a[i - lowbit(i) + 1 .. i]`.

- `lowbit(6) = lowbit(0b110) = 0b010 = 2`, so `tree[6]` covers `a[5..6]`.
- `lowbit(8) = 0b1000 = 8`, so `tree[8]` covers `a[1..8]`.
- `lowbit(7) = 1`, so `tree[7]` covers just `a[7]`.

```mermaid
flowchart TD
  t8["tree[8] covers 1..8"]
  t4["tree[4] covers 1..4"]
  t6["tree[6] covers 5..6"]
  t2["tree[2] covers 1..2"]
  t8 --> t4 --> t2
  t8 --> t6
  t6 --> t5["tree[5] covers 5..5"]
  t4 --> t3["tree[3] covers 3..3"]
  t2 --> t1["tree[1] covers 1..1"]
  t6b["(odd indices cover 1 element)"]
```

**Prefix sum `sum(i)`** walks *down* by stripping the lowest set bit: add `tree[i]`, then
`i -= lowbit(i)`, repeat until `i == 0`. Each step removes one bit, so at most `log n`
steps. **Point update `add(i, delta)`** walks *up*: add `delta` to `tree[i]`, then
`i += lowbit(i)`, repeat until `i > n`. A **range sum** `[l, r]` is `sum(r) - sum(l-1)`.

```java
int[] tree; int n;
void add(int i, long delta) {          // point update, 1-based
    for (; i <= n; i += i & (-i)) tree[i] += delta;
}
long sum(int i) {                       // prefix sum a[1..i]
    long s = 0;
    for (; i > 0; i -= i & (-i)) s += tree[i];
    return s;
}
long rangeSum(int l, int r) { return sum(r) - sum(l - 1); }
```

| Operation | Time | Space |
|---|---|---|
| Build (naive: n updates) | O(n log n) | O(n) |
| Build (in-place linear trick) | O(n) | O(n) |
| Point update | O(log n) | — |
| Prefix / range sum | O(log n) | — |

> [!KEY-TAKEAWAY]
> Fenwick tree = flat array where `tree[i]` owns a block of size `i & (-i)`. Query walks
> down by `i -= i&(-i)`, update walks up by `i += i&(-i)` — both `O(log n)`. It is the
> smallest-code structure for **mutable prefix sums**.

**Variations.** A BIT natively does *point-update + range-query*. With a difference-array
trick (two BITs) you can flip it to *range-update + point-query* or even *range-update +
range-query*. For 2-D prefix sums, nest a BIT inside a BIT for `O(log²n)` per op. Fenwick
trees generalize to any invertible group operation (sum, XOR) but **not** to min/max,
because you cannot "subtract" a min — for range-min with updates you need a segment tree.

## Segment tree internals and lazy propagation

A **segment tree** stores an associative function (sum, min, max, gcd, …) over array
ranges in a binary tree where each node covers a contiguous segment; leaves are single
elements and each internal node covers the union of its two children. It gives
`O(log n)` **range query** and `O(log n)` **point or range update**, at `O(n)` space
(commonly a `4n` array). Unlike a Fenwick tree it handles **non-invertible** operations
like min/max and supports **range updates** via lazy propagation.

```mermaid
flowchart TD
  A["[0..7] sum=36"] --> B["[0..3] sum=10"]
  A --> C["[4..7] sum=26"]
  B --> D["[0..1] sum=3"]
  B --> E["[2..3] sum=7"]
  C --> F["[4..5] sum=11"]
  C --> G["[6..7] sum=15"]
```

**Layout.** The classic array-based tree puts the root at index 1; node `x` has children
`2x` and `2x+1`. A size-`4n` array safely holds every node for any `n` (the tree can be
one level deeper than a perfect tree). A **range query** recurses from the root: if a
node's segment is fully inside the query it returns its stored value; if fully outside it
returns the identity; otherwise it recurses into both children and combines. At most two
nodes are "partially covered" per level, giving `O(log n)`.

**Lazy propagation** makes *range* updates `O(log n)` instead of `O(n)`. When an update
covers a whole node's segment, you apply it to the node's aggregate and store a **pending
("lazy") marker** instead of descending to every leaf. The marker is *pushed down* to
children only when a later query/update actually needs to enter that subtree. This is
essential for "add `v` to all of `[l, r]`" or "assign `v` to all of `[l, r]`" workloads.

```
update(node, [l,r] += v):
  if node fully inside [l,r]:
    apply v to node.aggregate; node.lazy += v; return
  push_down(node)                 # flush pending lazy to both children
  recurse into overlapping children
  node.aggregate = combine(left, right)
```

| Operation | Segment tree | Fenwick tree |
|---|---|---|
| Range sum query | O(log n) | O(log n) |
| Range min/max query | O(log n) | not supported |
| Point update | O(log n) | O(log n) |
| Range update | O(log n) (lazy) | O(log n) (diff trick, sum only) |
| Space | O(n) (~4n) | O(n) |
| Code size / constant | larger | tiny, fast |

> [!TIP]
> Choose the **cheapest tool that fits**. Only prefix sums with point updates → Fenwick
> (less code, smaller constant). Range min/max, or range *assign/add* updates, or custom
> merges → segment tree, adding lazy propagation only when updates span ranges.

**Gotchas.** Off-by-one in `4n` sizing (use `4*n`, not `2*n`); forgetting to `push_down`
before recursing on a lazy tree (stale children); using a Fenwick tree for min/max
(wrong — not invertible); and building naively with `n` updates (`O(n log n)`) when the
bottom-up `O(n)` build exists.

## Balanced BSTs and rotations

A **binary search tree** keeps the invariant *left subtree < node < right subtree*, which
makes search/insert/delete `O(h)` where `h` is the height. The catch: a plain BST built
from sorted input degenerates into a linked list, `h = n`, so operations become `O(n)`.
**Self-balancing BSTs** bound `h = O(log n)` by *rotating* after mutations.

A **rotation** is a local, `O(1)` pointer rewiring that changes height while preserving
the in-order (sorted) sequence. A right rotation at `y` promotes its left child `x`:

```mermaid
flowchart LR
  subgraph before
    y1["y"] --> x1["x"]
    y1 --> C1["C"]
    x1 --> A1["A"]
    x1 --> B1["B"]
  end
  subgraph after
    x2["x"] --> A2["A"]
    x2 --> y2["y"]
    y2 --> B2["B"]
    y2 --> C2["C"]
  end
```

- **AVL trees** track a per-node **balance factor** (height difference of subtrees) and
  keep it in `{-1, 0, +1}`, rebalancing with 1–2 rotations after each insert/delete. They
  are *strictly* balanced → height ≤ ~1.44 log n, so **lookups are faster**, but they may
  do more rotations on writes.
- **Red-black trees** color nodes red/black and enforce that no root-to-leaf path is more
  than twice as long as another (height ≤ 2 log(n+1)). They are *looser*, so they do
  **fewer rotations on writes** — which is why Java's `TreeMap`/`TreeSet` and C++'s
  `std::map` use them.

| Structure | Balance rule | Height bound | Best for |
|---|---|---|---|
| Plain BST | none | O(n) worst | teaching only |
| AVL | \|bf\| ≤ 1 | ~1.44 log n | read-heavy |
| Red-black | color/path rules | ≤ 2 log(n+1) | write-heavy, std libs |

| Operation | Balanced BST | Hash map |
|---|---|---|
| search / insert / delete | O(log n) | O(1) avg |
| ordered iteration | O(n) in sorted order | not ordered |
| floor / ceiling / range | O(log n) | not supported |

> [!INTERVIEW]
> You rarely *implement* a red-black tree in an interview. You must be able to say **why**
> balancing matters (avoids the `O(n)` degenerate BST), that a rotation is an `O(1)`
> pointer fix preserving in-order, and **when to reach for a tree map over a hash map**:
> when you need *ordered* operations — floor/ceiling, range scans, sorted iteration.

## KMP and the failure function

Naive substring search compares the pattern at every text position: `O(n·m)` worst case
(text length `n`, pattern length `m`), pathological on inputs like `aaa...aab`.
**Knuth–Morris–Pratt (KMP)** achieves `O(n + m)` by never re-examining a text character.
It precomputes a **failure function** (a.k.a. **LPS array** — longest proper prefix that
is also a suffix) for the pattern: `lps[i]` = length of the longest proper prefix of
`pattern[0..i]` that is also a suffix of it.

On a mismatch after matching `k` characters, instead of shifting the pattern by 1 and
restarting, KMP jumps the pattern pointer back to `lps[k-1]` — reusing the fact that the
matched prefix already overlaps itself. The text pointer never moves backward.

```java
int[] buildLps(String p) {
    int[] lps = new int[p.length()];
    int len = 0;                       // length of previous longest prefix-suffix
    for (int i = 1; i < p.length(); ) {
        if (p.charAt(i) == p.charAt(len)) lps[i++] = ++len;
        else if (len > 0) len = lps[len - 1];   // fall back, don't advance i
        else lps[i++] = 0;
    }
    return lps;
}
```

For `p = "ababaca"`, `lps = [0,0,1,2,3,0,1]`. Building `lps` is `O(m)`; the scan is
`O(n)`; total `O(n + m)` time, `O(m)` space. The same LPS idea powers **Shortest
Palindrome** (build `lps` of `s + '#' + reverse(s)` to find the longest palindromic
prefix) and repeated-substring-pattern detection.

> [!KEY-TAKEAWAY]
> KMP's failure/LPS array lets the pattern **slide by more than one** on a mismatch
> without ever backing up the text pointer. Recognition signal: exact substring/pattern
> matching where naive `O(n·m)` is too slow, or any question about self-overlap of a
> string (borders, periods, palindromic prefixes).

## Rabin-Karp and rolling hash

**Rabin-Karp** turns pattern matching into hashing: compute a hash of the pattern and of
each length-`m` window of the text; where hashes match, verify with a direct comparison.
The key is a **rolling hash** — a **polynomial hash** treating the window as a base-`b`
number mod a large prime — that updates in `O(1)` when the window slides: subtract the
outgoing character's contribution, multiply by the base, add the incoming character.

Average/expected time is `O(n + m)`; **worst case is `O(n·m)`** when hash collisions force
a full comparison at every position (or with an adversarial modulus). Its real strengths
are **multiple-pattern search** (hash a set of patterns) and **2-D / substring-fingerprint
problems** (e.g. "longest duplicate substring" via binary search on length + hashing).
Use a big prime modulus (or double hashing) to make collisions negligible.

| Algorithm | Preprocess | Search (avg) | Search (worst) | Note |
|---|---|---|---|---|
| Naive | — | — | O(n·m) | fine for tiny inputs |
| KMP | O(m) | O(n) | O(n) | deterministic linear |
| Rabin-Karp | O(m) | O(n+m) | O(n·m) | great for multi-pattern / fingerprints |
| Z-algorithm | — | O(n+m) | O(n+m) | prefix-match lengths |

## Z-algorithm

The **Z-array** of a string `s` gives, for each position `i`, `z[i]` = the length of the
longest substring starting at `i` that **matches a prefix** of `s`. It is computed in a
single `O(n)` left-to-right pass by maintaining a "Z-box" `[l, r]` — the rightmost
prefix-match window seen so far — and reusing previously computed values inside it instead
of recomparing.

For pattern matching, run the Z-algorithm on `pattern + '#' + text`: any position where
`z[i] == m` (the pattern length) marks an occurrence of the pattern in the text. It is an
often-simpler alternative to KMP and directly answers "how long is the prefix that
repeats/matches here," useful for string-period and border problems.

## Manacher longest palindromic substring in O(n)

The naive "expand around center" approach to longest palindromic substring is `O(n²)`
(each of `2n-1` centers expands up to `O(n)`). **Manacher's algorithm** does it in `O(n)`
by transforming the string (insert separators like `#` between every character so odd and
even palindromes are handled uniformly) and reusing symmetry: it keeps the **rightmost
palindrome** `[center, right]` found so far and initializes each new position's radius
from its **mirror** across `center`, only expanding beyond what symmetry already
guarantees.

| Approach | Time | Space | Note |
|---|---|---|---|
| Brute force (all substrings) | O(n³) | O(1) | check each substring |
| Expand around center | O(n²) | O(1) | interview-default, simple |
| DP table | O(n²) | O(n²) | also yields count of palindromes |
| Manacher | O(n) | O(n) | optimal; harder to code |

> [!WARNING]
> In an interview, reach for **expand-around-center** (`O(n²)`) first for "longest
> palindromic substring" — it is easy to get right. Mention Manacher as the `O(n)`
> optimum; only code it if explicitly pushed for linear time.

## Suffix arrays and suffix automata

For heavy multi-query substring work over a *fixed* text, **suffix structures** pay off:

- A **suffix array** is the sorted array of all suffix start-indices. Built in
  `O(n log n)` (or `O(n)` with DC3/SA-IS), it supports substring search in
  `O(m log n)` via binary search, and with an **LCP array** answers longest-common-prefix
  and distinct-substring queries. It is the space-efficient, cache-friendly successor to
  the older **suffix tree** (`O(n)` build, `O(n)` space, larger constant).
- A **suffix automaton** is the minimal DFA recognizing all substrings of `s`, built
  online in `O(n)` (for constant alphabet), and is the tool of choice for "number of
  distinct substrings," "longest common substring of two strings," and substring-count
  queries.

These are rare in standard SDE loops (more common in competitive programming); knowing
*when* they apply — many substring queries against one big text — is usually enough.

## When these beat a hash map or a sort

| You need… | Reach for | Not |
|---|---|---|
| Membership / grouping / dedup | HashMap / HashSet | fancy trees |
| One-shot "is X present" | sort + binary search, or set | segment tree |
| Many range-sum queries **with updates** | Fenwick / segment tree | recompute prefix sums (`O(n)` each) |
| Range **min/max** with updates | segment tree | Fenwick (not invertible) |
| Range **assign/add** over intervals | segment tree + lazy | per-element loop (`O(n)`) |
| Ordered ops: floor/ceiling/range/sorted iter | balanced BST / TreeMap | hash map (unordered) |
| Exact substring match, big inputs | KMP / Z / Rabin-Karp | naive `O(n·m)` |
| Longest palindrome, linear time | Manacher | brute force |
| Count-of-smaller / inversions with a scan | Fenwick over ranks | nested loops (`O(n²)`) |

## Worked example count of smaller numbers after self with a BIT

Given `nums`, for each element count how many elements to its **right** are smaller. A
Fenwick tree over *value ranks* solves it in `O(n log n)`:

1. **Coordinate-compress** the values to ranks `1..k` (sort unique, map value → rank).
2. Iterate `i` from **right to left**. For each `nums[i]`, its answer is
   `sum(rank(nums[i]) - 1)` — the count of already-seen values strictly smaller.
3. Then `add(rank(nums[i]), 1)` to record this value as "seen to the right."

The BIT here is a **cumulative frequency table**: `add` marks a value present, `sum`
counts how many present values fall in a prefix of the rank space. This same
frequency-BIT template solves inversion counting and many "count smaller/greater in a
window" problems.

## Interview Problems

Grouped by the structure/technique they drill.

**Fenwick / Segment tree (range query + update)**
- [Range Sum Query - Mutable](https://leetcode.com/problems/range-sum-query-mutable/) — Medium — canonical Fenwick/segment tree: point update + range sum
- [Range Sum Query 2D - Mutable](https://leetcode.com/problems/range-sum-query-2d-mutable/) — Hard — 2-D BIT, `O(log²n)` per op
- [Count of Smaller Numbers After Self](https://leetcode.com/problems/count-of-smaller-numbers-after-self/) — Hard — Fenwick over value ranks (frequency BIT)
- [Reverse Pairs](https://leetcode.com/problems/reverse-pairs/) — Hard — BIT / merge-sort inversion counting
- [The Skyline Problem](https://leetcode.com/problems/the-skyline-problem/) — Hard — segment tree / sweep with heap
- [Falling Squares](https://leetcode.com/problems/falling-squares/) — Hard — segment tree with range-assign lazy propagation

**Binary search / immutable range queries (contrast with the above)**
- [Range Sum Query - Immutable](https://leetcode.com/problems/range-sum-query-immutable/) — Easy — plain prefix-sum array, no structure needed

**KMP / string matching**
- [Implement strStr()](https://leetcode.com/problems/implement-strstr/) — Easy — KMP failure function for `O(n+m)` match
- [Shortest Palindrome](https://leetcode.com/problems/shortest-palindrome/) — Hard — KMP LPS on `s + '#' + reverse(s)`
- [Repeated Substring Pattern](https://leetcode.com/problems/repeated-substring-pattern/) — Easy — KMP LPS reveals the period
- [Find the Index of the First Occurrence in a String](https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/) — Easy — substring search (KMP/Z/Rabin-Karp)

**Rolling hash / Rabin-Karp**
- [Longest Duplicate Substring](https://leetcode.com/problems/longest-duplicate-substring/) — Hard — binary search on length + rolling hash
- [Repeated DNA Sequences](https://leetcode.com/problems/repeated-dna-sequences/) — Medium — fixed-window rolling hash / bitmask

**Palindromes (Manacher / expand-around-center)**
- [Longest Palindromic Substring](https://leetcode.com/problems/longest-palindromic-substring/) — Medium — expand-around-center `O(n²)`, Manacher `O(n)`
- [Palindromic Substrings](https://leetcode.com/problems/palindromic-substrings/) — Medium — count via expand-around-center / Manacher

**Monotonic-structure sliding window (a common alternative to segment trees)**
- [Sliding Window Maximum](https://leetcode.com/problems/sliding-window-maximum/) — Hard — monotonic deque `O(n)` (beats a heap/segment tree here)

## Common follow-up questions

- **"Fenwick or segment tree here?"** If the query is a prefix/range **sum** with point
  updates, Fenwick (smaller code, better constant). If you need range min/max, custom
  merges, or range *assign/add* updates → segment tree (add lazy propagation for range
  updates).
- **"Why can't a Fenwick tree do range minimum?"** Prefix decomposition relies on
  *subtracting* one prefix from another; min has no inverse, so `sum(r) - sum(l-1)` has no
  min analogue. Segment trees combine children directly and need no inverse.
- **"What does the LPS/failure array actually store?"** For each prefix, the length of the
  longest proper prefix that is also a suffix (the longest *border*). It encodes how far
  the pattern can safely slide on a mismatch.
- **"Rabin-Karp is O(n+m) average but what's the worst case, and why?"** `O(n·m)`, when
  hash collisions (or an adversarial modulus) force a full character comparison at every
  window; mitigate with a large prime modulus or double hashing.
- **"Why is a balanced BST worse than a hash map for lookup but sometimes preferred?"**
  Hash map is `O(1)` average but unordered; a balanced BST is `O(log n)` but supports
  floor/ceiling, range queries, and in-order (sorted) traversal.
- **"AVL vs red-black — when does each win?"** AVL is more strictly balanced → faster
  lookups (read-heavy); red-black does fewer rotations per write (write-heavy), which is
  why standard libraries use it.
- **"Longest palindromic substring in linear time?"** Manacher's algorithm — `O(n)` via
  the transformed string and mirror-symmetry radius reuse; expand-around-center is the
  `O(n²)` interview default.

## References

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms* (CLRS), 3rd/4th ed. —
  red-black trees & rotations (Ch. 13), string matching / KMP (Ch. 32), augmenting data
  structures.
- Fenwick, P., "A New Data Structure for Cumulative Frequency Tables," *Software: Practice
  and Experience*, 1994 — the original Binary Indexed Tree.
- Knuth, Morris, Pratt, "Fast Pattern Matching in Strings," *SIAM J. Computing*, 1977.
- Karp, R. & Rabin, M., "Efficient randomized pattern-matching algorithms," 1987.
- Manacher, G., "A new linear-time on-line algorithm for finding the smallest initial
  palindrome of a string," *JACM*, 1975.
- CP-Algorithms (cp-algorithms.com) — Fenwick tree, segment tree with lazy propagation,
  Z-function, prefix function/KMP, Manacher, suffix array/automaton (implementations &
  proofs).
- Sedgewick & Wayne, *Algorithms*, 4th ed. — balanced BSTs, string algorithms.
