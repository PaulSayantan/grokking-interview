# Arrays, Strings & Hashing

Arrays and strings are the substrate of almost every coding interview, and **hashing**
is the single most reused technique for turning an `O(n^2)` brute force into `O(n)`.
This topic covers how arrays actually live in memory, why dynamic arrays are "amortized
O(1)", why strings are immutable in Java/Python (and the concat trap that follows), and
the recognition signals for reaching for a hash map or hash set.

> [!KEY-TAKEAWAY]
> If a brute force scans pairs or repeatedly asks "have I seen X?" / "does the
> complement exist?" / "how many of each?", a **hash map or set almost always
> collapses it to a single linear pass**, trading `O(n)` space for `O(n)` time.

## Arrays and contiguous memory

An array is a **fixed-size block of contiguous memory** holding elements of the same
type (or same-width references). Because element `i` lives at a computable address, any
index is reachable in constant time:

```
address(a[i]) = base_address + i * element_size
```

This one formula explains every array property:

| Operation | Time | Why |
|---|---|---|
| Access / update by index `a[i]` | `O(1)` | Direct address arithmetic |
| Search by value (unsorted) | `O(n)` | Must scan |
| Search by value (sorted) | `O(log n)` | Binary search |
| Insert / delete at **end** (fixed capacity left) | `O(1)` | No shifting |
| Insert / delete at **middle/front** | `O(n)` | Must shift the tail |
| Space | `O(n)` | Contiguous block |

Contiguity also gives arrays excellent **cache locality**: neighboring elements sit on
the same cache line, so linear scans are far faster in practice than the same scan over
a pointer-chasing linked list, even though both are `O(n)` asymptotically.

> [!TIP]
> "Contiguous + fixed element size" is the whole story. When an interviewer asks why
> array access is `O(1)` but linked-list access is `O(n)`, the answer is address
> arithmetic vs. pointer traversal.

## Dynamic arrays and amortized resizing

A raw array has a fixed capacity. A **dynamic array** (Java `ArrayList`, Python `list`,
C++ `std::vector`, Go slice) wraps a backing array plus a `size` counter and grows
automatically. The mechanics:

- Keep a backing array of some `capacity >= size`.
- `append` writes to `a[size]` and increments `size` — `O(1)` while there is room.
- When `size == capacity`, allocate a **larger** array (typically `1.5x` or `2x`),
  copy all existing elements over (`O(n)`), then append.

Occasional copies are `O(n)`, so how is append "O(1)"? **Amortized analysis.** With
geometric growth (say doubling), `n` appends trigger copies of sizes
`1, 2, 4, ..., n`, and that geometric series sums to `< 2n`. Spreading `~2n` total work
across `n` appends gives **`O(1) amortized`** per append.

**Worked trace — 8 appends with doubling** (start capacity 1):

| Append # | size before | capacity | Resize? | Elements copied |
|---|---|---|---|---|
| 1 | 0 | 1 | first alloc | 0 |
| 2 | 1 | 1 → 2 | yes | 1 |
| 3 | 2 | 2 → 4 | yes | 2 |
| 4 | 3 | 4 | no | 0 |
| 5 | 4 | 4 → 8 | yes | 4 |
| 6–8 | 5,6,7 | 8 | no | 0 |

Total copy work to reach 8 elements = `1 + 2 + 4 = 7` (which is `< 2n = 16`). Add the 8
plain writes and you get `~15` units of work for 8 appends — **`~1.9` per append**, a
constant. Contrast additive growth by `+2`: resizes at sizes 2,4,6,… copying
`2+4+6+…+n = O(n²)` total → the cost per append grows *linearly*, which is why doubling
(or `1.5×`) is mandatory.

> [!WARNING]
> Growth must be **geometric (multiplicative)**, not additive. If you grew by a fixed
> `+k` each time, the copies would sum to `O(n^2)` total — amortized `O(n)` per append.
> This is exactly why doubling matters.

Language notes:
- **Java** `ArrayList` grows by `~1.5x` (`oldCapacity + (oldCapacity >> 1)`).
- **Python** `list` over-allocates by a mild growth pattern (roughly `1.125x` plus a
  constant); `CPython` also shrinks in some paths.
- **`ArrayList.remove(i)`** and inserting mid-array are `O(n)` because of the shift, even
  though the structure is dynamic. Dynamic only helps the *end*.

```java
ArrayList<Integer> a = new ArrayList<>();
a.add(7);        // amortized O(1)
a.add(1, 9);     // O(n): shifts everything from index 1 rightward
a.remove(0);     // O(n): shifts everything left
```

## Insertion and deletion complexity

The cost of changing an array is dominated by **how many elements must shift**:

```mermaid
flowchart LR
  A["Insert/delete at END"] --> A1["O(1) amortized — no shift"]
  B["Insert/delete at FRONT"] --> B1["O(n) — shift all n elements"]
  C["Insert/delete at MIDDLE i"] --> C1["O(n - i) — shift the tail"]
```

Common interview consequence: building a result by repeatedly **inserting at the front**
of an array/list is `O(n^2)`. Instead, append to the end and **reverse once** at the end
(`O(n)`), or write into a preallocated array from the back. This is a frequent hidden
quadratic in "build the answer in order" problems.

## Strings and immutability

In both **Java** and **Python**, `String`/`str` objects are **immutable** — the character
data cannot be changed after construction. Any "modification" allocates a **new** string.

Why immutability exists: safe sharing across threads without locks, safe use as hash-map
keys (the hash can be cached and never goes stale), and string interning/deduplication.

The classic trap — **concatenation in a loop**:

```java
// O(n^2): each += builds a whole new String, copying all prior chars
String s = "";
for (String w : words) s += w;

// O(n): StringBuilder mutates a resizable char[] buffer, amortized O(1) per append
StringBuilder sb = new StringBuilder();
for (String w : words) sb.append(w);
String s = sb.toString();
```

```python
# O(n^2) if done naively in a loop with +=
# Prefer join, which computes total length once and copies each char once -> O(n)
s = "".join(words)
```

| Task | Wrong (quadratic) | Right (linear) |
|---|---|---|
| Build a string in a loop | `s += piece` repeatedly | Java `StringBuilder`, Python `"".join(...)` |
| Random-access char edits | new string per edit | convert to `char[]` / `list`, mutate, join |
| Compare/hash keys | recompute repeatedly | immutable strings cache their hashCode |

> [!WARNING]
> "String vs char" bugs: Java `char` is a 16-bit primitive; `'a' + 'b'` is **int
> arithmetic** (195), not `"ab"`. Indexing a Java String gives a `char`; indexing a
> Python `str` gives a length-1 `str`. Know which your language returns before comparing.

## The hashing technique for O(1) lookups

A **hash map** (dictionary) stores key→value with **average `O(1)`** insert/lookup/delete
by hashing the key to a bucket index. A **hash set** is the same structure storing keys
only (in Java, `HashSet` is literally a `HashMap` with a dummy shared value). The deep
internals — buckets, collisions, load factor, resize/rehash, treeification, and the
`O(n)` worst case — live in the dedicated **Hash Tables** topic; here we focus on hashing
as a **problem-solving technique**.

The four hashing patterns that solve the majority of array/string problems:

| Pattern | You keep in the map | Recognition signal | Example |
|---|---|---|---|
| **Frequency map** | value → count | "count / most frequent / anagram / dedupe by count" | Valid Anagram, Top K Frequent |
| **Seen-set** | values already visited | "any duplicate? / has it appeared?" | Contains Duplicate |
| **Complement lookup** | value → index | "find a **pair** summing/matching to a target" | Two Sum |
| **Group-by-key** | canonical key → list | "group items that share a property" | Group Anagrams |

**Complement lookup — Two Sum in one pass** (the canonical example):

```python
def two_sum(nums, target):
    seen = {}                     # value -> index
    for i, x in enumerate(nums):
        need = target - x
        if need in seen:          # O(1) average
            return [seen[need], i]
        seen[x] = i
    return []
```

Brute force checks every pair (`O(n^2)`). By storing each number's index and asking "have
I already seen the complement `target - x`?", we answer in `O(1)` per element → **`O(n)`
time, `O(n)` space**. That space-for-time trade is the essence of hashing.

Trace on `nums=[2,7,11,15], target=9`:

| i | x | need = 9−x | need in seen? | action | seen after |
|---|---|---|---|---|---|
| 0 | 2 | 7 | no (`{}`) | store 2 | `{2:0}` |
| 1 | 7 | 2 | **yes** → `seen[2]=0` | return `[0,1]` | — |

We never touch 11 or 15 — the answer is found on the second element in one pass.

**Group Anagrams — group-by-canonical-key:**

```python
def group_anagrams(strs):
    groups = {}
    for s in strs:
        key = "".join(sorted(s))   # or a 26-count tuple; anagrams share this key
        groups.setdefault(key, []).append(s)
    return list(groups.values())
```

Trace on `["eat","tea","tan","ate"]`: each string's sorted key is `eat→"aet"`,
`tea→"aet"`, `tan→"ant"`, `ate→"aet"`, so the map ends as
`{"aet": ["eat","tea","ate"], "ant": ["tan"]}` → two groups. The canonical key is the
whole trick: strings that are anagrams collapse to an identical key regardless of order.

> [!INTERVIEW]
> When you catch yourself writing a nested loop to compare each element against the
> others, pause and ask: "What could I store in a hash map on the first pass so the
> second lookup is O(1)?" That reframing is what interviewers are testing.

Two subtleties worth stating out loud in an interview:
- Hash-map operations are `O(1)` **average / amortized**, not worst case. Adversarial or
  pathological keys can degrade to `O(n)` per op (mitigated by randomized hashing and, in
  Java 8+, by treeifying long buckets to `O(log n)`).
- A hash map/set is **unordered**. If you need sorted order or range queries, you want a
  tree-based map (`TreeMap` / balanced BST) at `O(log n)`, not a hash map.

### Fifth pattern — prefix-sum counts (the senior favorite)

Beyond the four table patterns, the most-asked "senior" hashing trick is **prefix sums in
a count map** (Subarray Sum Equals K). Intuition: the sum of the subarray `(i, j]` equals
`prefix[j] - prefix[i]`. A subarray ending at `j` sums to `k` exactly when there is an
earlier prefix equal to `prefix[j] - k`. So instead of re-summing every subarray
(`O(n²)`), carry a running prefix sum and keep a **count of every prefix seen so far**;
at each step look up `running - k`.

```python
def subarray_sum(nums, k):
    count = {0: 1}          # empty prefix; enables subarrays starting at index 0
    running = ans = 0
    for x in nums:
        running += x
        ans += count.get(running - k, 0)   # how many earlier prefixes = running-k
        count[running] = count.get(running, 0) + 1
    return ans
```

Trace on `nums=[1,2,3], k=3`:

| x | running | look up `running−k` | found count | ans | count after |
|---|---|---|---|---|---|
| 1 | 1 | −2 | 0 | 0 | `{0:1, 1:1}` |
| 2 | 3 | 0 | 1 | 1 | `{0:1, 1:1, 3:1}` |
| 3 | 6 | 3 | 1 | 2 | `{0:1, 1:1, 3:1, 6:1}` |

Answer `2` — the subarrays `[1,2]` and `[3]`. Note the seed `{0:1}`: it's what lets a
subarray that starts at index 0 (like `[1,2]` when `k=3`) be counted.

### Sliding window — variable-size with a last-seen map

When a problem asks for the **longest/shortest contiguous window** satisfying a
constraint, grow a `right` pointer, and whenever the constraint breaks, shrink `left`
until it holds again; track the best window. For "no repeating characters," a map of each
char's last-seen index lets `left` jump directly past the duplicate instead of crawling.

Trace on `"abcabcbb"` (window `[left, right]`, len = `right−left+1`):

| right | char | last-seen ≥ left? | left | window | best |
|---|---|---|---|---|---|
| 0 | a | — | 0 | `a` (1) | 1 |
| 1 | b | — | 0 | `ab` (2) | 2 |
| 2 | c | — | 0 | `abc` (3) | 3 |
| 3 | a | yes (0) | 1 | `bca` (3) | 3 |
| 4 | b | yes (1) | 2 | `cab` (3) | 3 |
| 5 | c | yes (2) | 3 | `abc` (3) | 3 |
| 6 | b | yes (4) | 5 | `cb` (2) | 3 |
| 7 | b | yes (6) | 7 | `b` (1) | 3 |

Answer `3` (any of the length-3 windows). Each of `right` and `left` moves at most `n`
times total → **`O(n)`**, versus `O(n²)` for re-checking every substring.

## In-place array techniques

Many problems demand `O(1)` extra space, which means mutating the input array itself.
Core in-place idioms:

- **Two pointers / read-write index** — a `write` pointer trails a `read` pointer to
  compact/filter in place (remove duplicates from a sorted array, move zeros to the end).
- **Swap to sort/partition** — Dutch-national-flag partitioning, cyclic sort (place value
  `v` at index `v`) to find missing/duplicate numbers in `O(1)` space.
- **Reverse tricks** — rotate an array by `k` via three reversals; reverse words in place.
- **Sign / index-as-hashset encoding** — mark "value `i` seen" by negating `a[abs(v)]`,
  using the array's own sign bits as a set without extra space.

These three are the least reconstructible from prose, so trace each one.

**Cyclic sort — First Missing Positive on `[3,4,-1,1]`.** The idea: value `v` (in range
`1..n`) belongs at index `v-1`. Repeatedly swap `nums[i]` to its home until the slot at
`i` is either out of range or already correct, then scan for the first index whose value
isn't `i+1`.

```
[3,4,-1,1]  i=0: nums[0]=3 → home index 2. swap(0,2) → [-1,4,3,1]
[-1,4,3,1]  i=0: nums[0]=-1 out of range 1..4 → leave it, i=1
[-1,4,3,1]  i=1: nums[1]=4 → home index 3. swap(1,3) → [-1,1,3,4]
[-1,1,3,4]  i=1: nums[1]=1 → home index 0. swap(1,0) → [1,-1,3,4]
[1,-1,3,4]  i=1: nums[1]=-1 out of range → leave it, i=2
[1,-1,3,4]  i=2: nums[2]=3 already at home (index 2) → i=3
[1,-1,3,4]  i=3: nums[3]=4 already at home (index 3) → done
```

Now scan: index 0 holds 1 ✓, index 1 holds −1 (expected 2) ✗ → answer **2**. Every swap
puts one value in its final home, so total swaps ≤ n → **`O(n)` time, `O(1)` space**.

**Sign-bit encoding — Find All Numbers Disappeared on `[4,3,2,7,8,2,3,1]`** (n=8, values
in `1..n`). Pass 1: for each value `v`, negate the slot at index `abs(v)-1` to mark "`v`
is present." Pass 2: any index still holding a positive number was never marked → its
`index+1` is missing.

```
see 4 → negate idx 3: [4,3,2,-7,8,2,3,1]
see 3 → negate idx 2: [4,3,-2,-7,8,2,3,1]
see 2 → negate idx 1: [4,-3,-2,-7,8,2,3,1]
see 7 → negate idx 6: [4,-3,-2,-7,8,2,-3,1]
see 8 → negate idx 7: [4,-3,-2,-7,8,2,-3,-1]
see |−2|=2 → idx 1 already negative, leave it
see |−3|=3 → idx 2 already negative, leave it
see 1 → negate idx 0: [-4,-3,-2,-7,8,2,-3,-1]
```

Positives remain at index 4 (value 8) and index 5 (value 2) → missing numbers are
**5 and 6**. Reading `abs(v)` before indexing is essential, since earlier marks may have
already flipped the sign of a slot you now need to read as an index.

**Dutch national flag — sort `[2,0,2,1,1,0]` of {0,1,2} in one pass.** Three pointers:
`low` (next slot for 0), `mid` (cursor), `high` (next slot for 2). If `nums[mid]==0` swap
with `low`, advance both; if `==1` just advance `mid`; if `==2` swap with `high` and
shrink `high` (do **not** advance `mid` — the swapped-in value is unexamined).

```
start                low=0 mid=0 high=5  [2,0,2,1,1,0]
nums[mid]=2 → swap(mid,high), high=4     [0,0,2,1,1,2]  (mid stays 0)
nums[mid]=0 → swap(mid,low), low=1 mid=1 [0,0,2,1,1,2]
nums[mid]=0 → swap(mid,low), low=2 mid=2 [0,0,2,1,1,2]
nums[mid]=2 → swap(mid,high), high=3     [0,0,1,1,2,2]  (mid stays 2)
nums[mid]=1 → mid=3
nums[mid]=1 → mid=4  (mid>high, stop)
```

Result `[0,0,1,1,2,2]`, sorted in a single pass, `O(n)` / `O(1)`.

**Product of Array Except Self** (no division, `O(1)` extra output-only space) uses
prefix/suffix passes writing into the result array:

```python
def product_except_self(nums):
    n = len(nums)
    res = [1] * n
    prefix = 1
    for i in range(n):            # res[i] = product of everything to the LEFT
        res[i] = prefix
        prefix *= nums[i]
    suffix = 1
    for i in range(n - 1, -1, -1): # multiply in product of everything to the RIGHT
        res[i] *= suffix
        suffix *= nums[i]
    return res
```

## 2D arrays and matrices

A 2D array is usually stored as a single contiguous block in **row-major order** (C,
Java's conceptual model, NumPy default): `address(a[r][c]) = base + (r * numCols + c) *
element_size`. This is why iterating **row by row** is cache-friendly and column-by-column
is not.

- Java's `int[][]` is actually an **array of row arrays** (jagged) — rows can differ in
  length and are separately allocated, so it is not strictly one contiguous block.
- Common index math: flatten `(r, c) -> r * cols + c`; unflatten `idx -> (idx / cols,
  idx % cols)`.
- Traversal patterns: 4-directional neighbors `[(1,0),(-1,0),(0,1),(0,-1)]`, spiral order,
  diagonal traversal, and in-place rotation (transpose then reverse each row for 90°).

> [!TIP]
> Always guard matrix traversals with bounds checks `0 <= r < rows && 0 <= c < cols`
> **before** dereferencing — out-of-bounds on grids is the #1 source of runtime errors.

## Common gotchas

- **Off-by-one.** Prefer half-open ranges `[lo, hi)`; `hi - lo` is the length. Be explicit
  about whether loop bounds are inclusive.
- **Integer overflow.** `mid = (lo + hi) / 2` can overflow in fixed-width languages; use
  `lo + (hi - lo) / 2`. Sums of large arrays may exceed 32-bit `int` — use `long`.
  (Python ints are arbitrary precision, so overflow is a *Java/C++* concern, not Python.)
- **Aliasing.** In Python, `[[0]*n]*m` creates `m` references to the **same** inner list;
  mutating one row mutates all. Use `[[0]*n for _ in range(m)]`.
- **String vs char.** See the immutability section — know what indexing returns and that
  `char` math is integer math in Java.
- **Empty / single-element inputs.** Confirm behavior for `[]`, `[x]`, and all-equal
  arrays before coding the general case.
- **Mutating while iterating.** Removing from a list inside a `for` over that same list
  skips elements or throws `ConcurrentModificationException` (Java).

## Interview Problems

Canonical LeetCode problems this topic drills (array manipulation, string handling, and
the hashing technique). Grouped by difficulty.

**Easy**
- [Two Sum](https://leetcode.com/problems/two-sum/) — Easy — hash map for `O(n)` complement lookup
- [Valid Anagram](https://leetcode.com/problems/valid-anagram/) — Easy — frequency map / char-count comparison
- [Contains Duplicate](https://leetcode.com/problems/contains-duplicate/) — Easy — seen-set membership
- [Two Sum II - Input Array Is Sorted](https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/) — Easy — two pointers on a sorted array (no hashing needed)
- [Best Time to Buy and Sell Stock](https://leetcode.com/problems/best-time-to-buy-and-sell-stock/) — Easy — single-pass running minimum
- [Move Zeroes](https://leetcode.com/problems/move-zeroes/) — Easy — in-place read/write two-pointer compaction
- [Remove Duplicates from Sorted Array](https://leetcode.com/problems/remove-duplicates-from-sorted-array/) — Easy — in-place write index

**Medium**
- [Group Anagrams](https://leetcode.com/problems/group-anagrams/) — Medium — group-by-canonical-key hash map
- [Top K Frequent Elements](https://leetcode.com/problems/top-k-frequent-elements/) — Medium — frequency map + bucket sort / heap
- [Product of Array Except Self](https://leetcode.com/problems/product-of-array-except-self/) — Medium — prefix/suffix passes, no division
- [Longest Consecutive Sequence](https://leetcode.com/problems/longest-consecutive-sequence/) — Medium — hash set for `O(n)` sequence walking
- [Subarray Sum Equals K](https://leetcode.com/problems/subarray-sum-equals-k/) — Medium — prefix-sum counts in a hash map
- [Longest Substring Without Repeating Characters](https://leetcode.com/problems/longest-substring-without-repeating-characters/) — Medium — sliding window + last-seen map
- [Set Matrix Zeroes](https://leetcode.com/problems/set-matrix-zeroes/) — Medium — in-place `O(1)`-space marking on a matrix
- [Rotate Image](https://leetcode.com/problems/rotate-image/) — Medium — in-place matrix transpose + reverse

**Hard**
- [First Missing Positive](https://leetcode.com/problems/first-missing-positive/) — Hard — index-as-hashset / cyclic placement in `O(1)` space

## Common follow-up questions

- **Why is dynamic-array append amortized `O(1)`, and why must growth be geometric?**
  Geometric growth makes total copy work a convergent geometric series (`< 2n`); additive
  growth makes it `O(n^2)`.
- **Why are hash-map operations `O(1)` average but `O(n)` worst case?** Average assumes a
  good hash spreading keys evenly; collisions/adversarial keys pile into one bucket. (Deep
  dive in the Hash Tables topic.)
- **When would you NOT use a hash map even though lookups are `O(1)`?** When you need
  ordering, range queries, or worst-case guarantees — use a balanced BST/`TreeMap`
  (`O(log n)`); or when `n` is tiny and constant factors/memory dominate.
- **How do you solve Two Sum if the array is sorted?** Two pointers from both ends —
  `O(n)` time, `O(1)` space, no hashing.
- **Why is `s += x` in a loop `O(n^2)` and how do you fix it?** Immutable strings copy on
  every concat; use `StringBuilder` / `"".join`.
- **How do you achieve `O(1)` extra space?** In-place two pointers, swapping, reversal
  tricks, or sign-bit / cyclic-sort encoding using the input array itself.

## References

- Cormen, Leiserson, Rivest, Stein — *Introduction to Algorithms* (CLRS), 3rd/4th ed.:
  dynamic tables & amortized analysis (Ch. 17), hash tables (Ch. 11).
- Sedgewick & Wayne — *Algorithms*, 4th ed.: resizing arrays, hashing.
- Oracle Java docs — `ArrayList`, `String`, `StringBuilder`, `HashMap`, `HashSet` API.
- CPython docs & source — `listobject.c` over-allocation, `str` immutability (Python data model).
- LeetCode — the problems linked above (canonical array/string/hashing set).
