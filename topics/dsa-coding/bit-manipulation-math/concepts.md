# Bit Manipulation & Math

Bit tricks and number theory are the "low-level" corner of coding interviews. They rarely
require a fancy data structure — instead they test whether you understand how integers are
*actually represented* (two's complement), the algebraic **properties of the bitwise
operators** (especially XOR), and a handful of classic number-theory algorithms (GCD, prime
sieve, fast exponentiation, modular arithmetic). Problems here are usually short to state and
have an elegant O(1)- or O(log n)-space answer that looks like magic until you know the trick.
This topic teaches the operators, the canonical identities, the overflow gotchas, and the math
you are expected to reproduce from memory.

> [!KEY-TAKEAWAY]
> Two ideas unlock most bit problems: **XOR is addition without carry** (so `a^a=0`,
> `a^0=a`), and **`n & (n-1)` clears the lowest set bit**. Two ideas unlock most math
> problems: **do arithmetic in `long` and reduce mod 1e9+7 to avoid overflow**, and
> **anything of the form "combine by halving" is O(log n)** (binary exponentiation, GCD).

## Integer representation and two's complement

An interview integer is a fixed-width binary string (32-bit `int`, 64-bit `long` in Java;
Python ints are arbitrary precision, which changes some tricks — see gotchas). The bit at
position `i` has place value `2^i`.

**Two's complement** is how signed integers are stored: the most significant bit (MSB) is the
sign bit, and a negative number `-x` is represented as `~x + 1` (invert all bits, add one).
Equivalently, the MSB carries a *negative* weight `-2^(w-1)`.

Worked example — store `-5` in 8 bits, two ways, and confirm they agree:

```
+5           = 0000 0101
invert (~)   = 1111 1010
add 1        = 1111 1011   ← this is -5

Read it back by the negative-MSB-weight rule (bit 7 is worth -2^7 = -128):
1111 1011 = -128 + 64 + 32 + 16 + 8 + 0 + 2 + 1
          = -128 + 123 = -5   ✓
```

Both interpretations — "`~x + 1`" and "MSB carries weight `-2^(w-1)`" — land on the same
value. That is *why* the identities hold; they are not two rules but one.

- Range of a `w`-bit signed int: `[-2^(w-1), 2^(w-1) - 1]`. For 32 bits:
  `[-2147483648, 2147483647]`.
- There is exactly **one zero** (unlike sign-magnitude), and one "extra" negative value
  (`Integer.MIN_VALUE`) with no positive counterpart — so `-Integer.MIN_VALUE` overflows back
  to itself. `Math.abs(Integer.MIN_VALUE)` is negative. A classic trap.
- `-1` is all-ones (`0xFFFFFFFF`). `~0 == -1`. `~x == -x - 1`.

| Expression | Meaning |
|---|---|
| `~x` | bitwise NOT; equals `-x - 1` in two's complement |
| `-x` | `~x + 1` |
| `x >> 1` (arithmetic) | floor(x/2); sign bit is *replicated* (sign-extends) |
| `x >>> 1` (logical, Java) | shifts in 0 from the left; treats x as unsigned |

**Signed vs unsigned shift.** A right shift `>>` on a negative number keeps it negative
(fills with 1s): `-8 >> 1 == -4`. Java's `>>>` fills with 0s, so `-1 >>> 28 == 15`. C/C++
right shift of a negative signed value is implementation-defined — prefer unsigned types.
Left shift `<<` fills with 0s from the right; shifting into or past the sign bit is undefined
behavior in C and silently wraps in Java.

> [!WARNING]
> Shift counts are taken **mod the width** in Java/C for `int`: `1 << 32 == 1`, not `0`,
> because the count `32 & 31 == 0`. To build a full 64-bit mask use `1L << k` — `1 << k`
> is computed in 32-bit `int` first and overflows for `k >= 31`.

## The bitwise operators

Six operators, all O(1) on machine words:

| Op | Name | Rule (per bit) | Typical use |
|---|---|---|---|
| `&` | AND | 1 iff both 1 | masking (keep bits), test a bit |
| `\|` | OR | 1 iff either 1 | set bits, merge flags |
| `^` | XOR | 1 iff bits differ | toggle, "add without carry", pairing |
| `~` | NOT | flip every bit | build inverse masks |
| `<<` | left shift | multiply by 2^k | build masks `1<<i`, pack fields |
| `>>`/`>>>` | right shift | divide by 2^k | extract fields, iterate bits |

**AND (`&`)** is the "keep only where mask is 1" operator — a mask isolates a field.
**OR (`\|`)** unions bits. **XOR (`^`)** is the star of interviews (next section).

## XOR properties and their tricks

XOR (`^`) is addition in GF(2) — bitwise addition with no carry. Its algebraic properties:

- **Self-inverse / cancellation:** `a ^ a = 0`.
- **Identity:** `a ^ 0 = a`.
- **Commutative & associative:** order and grouping don't matter, so XOR of a list is
  well-defined regardless of arrangement.

These give a family of tricks:

**Single Number** — every element appears twice except one. XOR the whole array; pairs cancel
(`a^a=0`), leaving the unique element. O(n) time, **O(1) space** (beats a hash set).

```python
def single_number(nums):
    x = 0
    for n in nums: x ^= n
    return x
```

**Missing Number** — array of `0..n` with one missing. XOR all indices `0..n` with all values;
everything present cancels, leaving the missing one. (Alternative: Gauss sum `n(n+1)/2 - sum`,
but XOR avoids overflow.)

**Swap without a temp:** `a ^= b; b ^= a; a ^= b;`. Cute but *not* recommended in real code
(fails when `a` and `b` alias the same location, and is not faster than a temp).

**Single Number III** (two uniques `p, q`, rest paired): XOR everything to get `p^q`. Any set
bit of `p^q` is a position where `p` and `q` differ. Pick the lowest set bit `d = x & -x`,
partition the array by that bit, and XOR each group separately to recover `p` and `q`.

Worked trace — `nums = [1, 2, 1, 3, 2, 5]` (uniques are 3 and 5):

```
XOR all:  1^2^1^3^2^5 = (1^1)^(2^2)^(3^5) = 0^0^(3^5) = 3^5
          3 = 011, 5 = 101  →  3^5 = 110 = 6
lowest set bit d = 6 & -6 = 2   (binary 010)

partition on "n & 2":
  bit set   {2, 3, 2}  (2=010, 3=011)  → 2^3^2 = 3
  bit clear {1, 1, 5}  (1=001, 5=101)  → 1^1^5 = 5
answer = {3, 5}   ✓
```

The trick works because `d` is a bit where `p` and `q` disagree, so they land in *different*
groups — while every duplicate pair shares all its bits and so lands together, cancelling out.

**Single Number II** (every element thrice except one) is *not* solvable by plain XOR —
threes don't cancel under XOR. Use bit-by-bit counting mod 3, or the two-mask "ones/twos"
state machine.

## Single-bit operations: check, set, clear, toggle

Build a one-hot mask `1 << i` and combine it:

| Operation | Expression | Idea |
|---|---|---|
| **Get** bit i | `(x >> i) & 1` | shift bit i to position 0, mask it |
| **Set** bit i | `x \| (1 << i)` | OR in a 1 |
| **Clear** bit i | `x & ~(1 << i)` | AND with a 0 at i, 1s elsewhere |
| **Toggle** bit i | `x ^ (1 << i)` | XOR flips exactly that bit |
| **Test power-of-two** | `x > 0 && (x & (x-1)) == 0` | only one bit set |
| **Clear lowest set bit** | `x & (x - 1)` | see below |
| **Isolate lowest set bit** | `x & -x` | see below |

## The two workhorse identities: n&(n-1) and n&-n

**`n & (n - 1)` clears the lowest set bit.** Subtracting 1 flips the lowest set bit to 0 and
turns all the 0s below it into 1s; ANDing with the original wipes that whole low run, leaving
the bit cleared. Consequences:

- **Power-of-two check:** a positive power of two has exactly one set bit, so
  `n & (n-1) == 0`. (Guard `n > 0`.)
- **Brian Kernighan's popcount:** loop `n &= n-1` until zero; iterations = number of set
  bits. Runs in **O(popcount)** rather than O(width) — faster when bits are sparse.

```python
def count_bits(n):          # Kernighan
    c = 0
    while n:
        n &= n - 1          # drop lowest set bit
        c += 1
    return c
```

**`n & -n` isolates the lowest set bit** (returns its value, e.g. `12 & -12 == 4`). Because
`-n == ~n + 1`, the low run flips and the lowest set bit is the only position that agrees:

```
 12 = 0…0 0 1 1 0 0
-12 = ~12 + 1 = 0…0 1 0 1 0 0   (invert to …10011, add 1)
AND = 0…0 0 0 1 0 0 = 4
```

Bit 2 (value 4) is the only position that is 1 in both: below it the add-1 carry flipped every
bit, and above it the bits are exact complements, so they can never both be 1. This is the core
of **Fenwick / Binary Indexed Trees** and of Single Number III's partition.

## Counting bits and the DP recurrence

**Counting Bits** (popcount for every `i` in `0..n`) has a slick DP:
`bits[i] = bits[i >> 1] + (i & 1)` — `i` has the same set bits as `i/2` plus its own last bit.
Alternatively `bits[i] = bits[i & (i-1)] + 1`. O(n) total, beating O(n log n) naive.

## Iterating subsets with bitmasks

A set of `n` elements maps to an `n`-bit integer: bit `i` present ⟺ element `i` in the subset.

- **All subsets** of `{0..n-1}`: `for mask in range(1 << n)` — `2^n` masks. Element `i` is in
  `mask` iff `mask & (1 << i)`.
- **Enumerate submasks** of a fixed mask `m` (all subsets of `m`):
  `sub = m; while sub: ...; sub = (sub - 1) & m`. Total work over all masks is **O(3^n)**.
  *Why 3^n?* Across the whole (mask, submask) enumeration each of the `n` bits is
  independently in one of **three** states: set in `m` and in `sub`, set in `m` but not in
  `sub`, or not in `m` at all. So total work `= Σ_masks 2^popcount(mask) = Σ_k C(n,k)·2^k =
  (1+2)^n = 3^n` (binomial theorem). Sanity check `n=2`: masks 00,01,10,11 do 1+2+2+4 = 9 = 3².
- This underpins **bitmask DP** (e.g. Travelling Salesman `dp[mask][i]`), where `mask` is the
  visited set. Feasible only for small `n` (~20) because of the `2^n` state count.

## Sum of two integers without addition (full adder)

Add without `+`: the XOR is the sum-without-carry, and `(a & b) << 1` is the carry. Loop
until no carry remains.

```python
def get_sum(a, b):
    mask = 0xFFFFFFFF
    while b & mask:
        carry = (a & b) << 1
        a = a ^ b
        b = carry
    return a & mask if b > mask else a   # Python: emulate 32-bit wrap
```

In Java this is just `while (b != 0) { int c = a & b; a ^= b; b = c << 1; }` — 32-bit wrap is
automatic. Python needs explicit masking because its ints never overflow, so the two masked
lines are pure Python bookkeeping: `while b & mask` ignores any carry that has already marched
past bit 31, and `a & mask if b > mask else a` says "if the carry ran off the top of 32 bits,
the true answer is negative — return the low 32 bits reinterpreted."

Worked trace — `get_sum(-1, 1)` should give `0`. The carry propagates one bit higher each pass:

```
a=-1 (…1111), b=1     → a^b = -2,  carry = (a&b)<<1 = 2
a=-2,         b=2     → a^b = -4,  carry = 4
a=-4,         b=4     → a^b = -8,  carry = 8
… (bit climbs) …
a=-2^31,      b=2^31  → a^b = -2^32, carry = 2^32
now b = 2^32; b & mask = 2^32 & 0xFFFFFFFF = 0 → loop ends
b (=2^32) > mask → return a & mask = (-2^32) & 0xFFFFFFFF = 0   ✓
```

The `b > mask` test fires exactly because the final carry (`2^32`) overflowed 32 bits — the
signal that the result is a negative 32-bit value, so we mask `a` down to its 32-bit form.

## GCD (Euclid) and LCM

**Euclid's algorithm:** `gcd(a, b) = gcd(b, a mod b)`, terminating when `b == 0`. Each step at
least halves the larger argument every two iterations, giving **O(log(min(a,b)))** divisions.

```python
def gcd(a, b):
    while b: a, b = b, a % b
    return a
```

**LCM:** `lcm(a, b) = a / gcd(a, b) * b` — divide **before** multiplying to avoid overflow (and
so the division is exact). `lcm` of large numbers overflows fast; use `long` / mod as needed.

## Modular arithmetic and overflow

Interview arithmetic frequently asks for answers **mod 1e9+7** (a prime chosen so it fits in an
`int` and products of two mod-values fit in a 64-bit `long`). Rules:

- `(a + b) % m`, `(a - b + m) % m` (add `m` to keep non-negative), `(a * b) % m` are all safe
  **if you cast to `long` first**: `((long)a * b) % m`. `a * b` in 32-bit `int` overflows
  silently well before the mod.
- **Division under a mod** needs the **modular inverse** (Fermat: `a^(m-2) mod m` for prime
  `m`), not real division. Fermat requires `m` prime **and** `a` not a multiple of `m`
  (`a ≢ 0 mod m`, i.e. `gcd(a, m) = 1`) — otherwise no inverse exists. For composite moduli use
  the extended Euclidean algorithm instead.
- Distributivity: `(a*b*c) % m == ((a%m)*(b%m)%m * (c%m)) % m` — reduce at every step.

> [!WARNING]
> The single most common overflow bug: computing `a * b` (or `a + b`) in `int`, *then*
> assigning to a `long`. The overflow already happened. Cast **before** the operation:
> `long p = (long) a * b;`.

## Fast (binary) exponentiation

Compute `x^n` in **O(log n)** multiplications by squaring: `x^n = (x^(n/2))^2` (times `x` if
`n` is odd). Read `n`'s bits low to high; square the base each step and multiply into the
result when the current bit is 1.

```python
def power(x, n):            # n >= 0
    result = 1
    while n:
        if n & 1: result *= x
        x *= x
        n >>= 1
    return result
```

Worked trace — `power(3, 13)`, where `13 = 1101b` (bits 0, 2, 3 set). Watch `x` square each
step and `result` pick up a factor only when the current low bit is 1:

| n (binary) | n&1 | result before → after | x before → after |
|---|---|---|---|
| 13 (1101) | 1 | 1 → 3 | 3 → 9 |
| 6 (110)   | 0 | 3 → 3 | 9 → 81 |
| 3 (11)    | 1 | 3 → 243 | 81 → 6561 |
| 1 (1)     | 1 | 243 → 1594323 | 6561 → … |

`result = 3^1 · 3^4 · 3^8 = 3·81·6561 = 1594323 = 3^13` ✓ — the set bits (0, 2, 3) contribute
exactly the powers `3^1, 3^4, 3^8`, and `1 + 4 + 8 = 13`. ~7 multiplies (4 squarings + 3 on set
bits) instead of the 12 a naive loop needs — and only `O(log n)` as `n` grows.

For **Pow(x, n)** on LeetCode: handle `n < 0` by computing `1 / power(x, -n)`, and beware
`n == Integer.MIN_VALUE` — negating it overflows, so widen to `long` first. The same
"multiply into result on set bits, square each step" skeleton also does **modular** power
(reduce mod `m` after each multiply) — the backbone of Fermat inverses and hashing.

## Sieve of Eratosthenes

To list all primes up to `n`: mark multiples of each prime starting at `p*p` (smaller
multiples were already marked by smaller primes). Time **O(n log log n)**, space **O(n)**.

```python
def sieve(n):
    is_prime = [True] * (n + 1)
    is_prime[0] = is_prime[1] = False
    for p in range(2, int(n**0.5) + 1):
        if is_prime[p]:
            for m in range(p*p, n + 1, p):
                is_prime[m] = False
    return [i for i in range(2, n+1) if is_prime[i]]
```

Trial-division primality of a single number is **O(√n)** (test divisors up to `√n`).

## Newton's method for integer sqrt

To compute `floor(sqrt(n))` without the math library, iterate `x = (x + n/x) / 2` (Newton /
Babylonian). It converges quadratically. A robust integer version:

```python
def my_sqrt(n):
    if n < 2: return n
    x = n
    while x * x > n:
        x = (x + n // x) // 2
    return x
```

Alternatively **binary-search the answer** on `[0, n]` for the largest `x` with `x*x <= n` —
O(log n), no floating point, no overflow if you use `long`.

## When bit tricks actually matter

Recognition signals that a problem wants bit manipulation:

- **Constraints mention small sets** (`n <= 20`, "subsets", "which items chosen") → bitmask
  represents a set in one integer; bitmask DP.
- **"Do it in O(1) extra space"** with a paired/duplicate structure → XOR cancellation.
- **Flags / permissions / feature toggles** packed into one integer → set/clear/test bits.
- **"Without using operator X"** (no `+`, no `*`, no `/`) → simulate with shifts and XOR/carry.
- **Ranges of integers, "bitwise AND of all numbers in [L,R]"** → think about which high bits
  stay constant (common prefix) — the answer is the common binary prefix of L and R shifted
  back.
- **Hashing / dedup within a fixed small alphabet** (26 letters) → a 32-bit int as a boolean
  set (`seen |= 1 << (c-'a')`), O(1) membership, cache-friendly.

Bit ops don't lower asymptotic complexity by a factor of `log n` in general — they win by
constant factors, O(1) space, and by turning set operations into single machine instructions.

## Worked example: Bitwise AND of Numbers in a Range

`rangeAND(L, R)` = AND of every integer in `[L, R]`. Any bit that flips somewhere in the range
becomes 0 in the AND. Bits flip in the low positions as you count up, so the surviving bits are
exactly the **common binary prefix** of `L` and `R`. Right-shift both until they're equal
(counting shifts), then shift the common value back:

```python
def range_and(L, R):
    shift = 0
    while L < R:
        L >>= 1; R >>= 1; shift += 1
    return L << shift
```

O(log R) time, O(1) space. This "find the common high prefix" insight is the whole problem.

## Maximum XOR of two numbers (bit trie / greedy prefix)

Given an array, find the largest `a ^ b` over all pairs. Brute force is O(n²). The trick:
insert every number's fixed-width bits (say 32, MSB-first) into a **binary trie**. To maximize
XOR *for one number*, walk the trie from the top bit down and at each level **greedily take the
opposite bit** if a branch for it exists — a differing bit contributes `1` to that (higher-value)
position of the XOR. Do this for every number and keep the best. **O(n · W)** time (W = bit
width), which is O(n) for fixed 32-bit ints.

> [!TIP]
> Higher bits dominate: a single differing bit at position `k` is worth more (`2^k`) than every
> lower bit combined. That is why greedily grabbing the opposite bit top-down is optimal — never
> trade a high bit for lower ones.

Worked trace — `nums = [1, 2, 4]` in 3 bits: `001, 010, 100`. Query with `4 = 100`, walking the
trie built from all three:

```
bit2: 4 has 1 → want 0; branches {001,010} have 0 → take it. XOR bit2 = 1.  candidates {001,010}
bit1: 4 has 0 → want 1; 010 has 1       → take it. XOR bit1 = 1.  candidates {010}
bit0: 4 has 0 → want 1; 010 has 0 only  → forced 0. XOR bit0 = 0.
XOR = 110 = 6   (i.e. 4 ^ 2 = 6)
```

Repeating for 1 and 2 finds nothing larger, so the answer is **6**. (Brute-force check: 1^2=3,
1^4=5, 2^4=6 — matches.)

## Interview Problems

Grouped by sub-pattern; all are classic SDE-interview bit/math problems.

**XOR & counting bits**
- [Single Number](https://leetcode.com/problems/single-number/) — Easy — XOR cancellation, O(1) space
- [Single Number II](https://leetcode.com/problems/single-number-ii/) — Medium — bit-count mod 3 / ones-twos state machine
- [Single Number III](https://leetcode.com/problems/single-number-iii/) — Medium — XOR then partition by lowest set bit
- [Missing Number](https://leetcode.com/problems/missing-number/) — Easy — XOR indices with values (or Gauss sum)
- [Number of 1 Bits](https://leetcode.com/problems/number-of-1-bits/) — Easy — Brian Kernighan `n & (n-1)` popcount
- [Counting Bits](https://leetcode.com/problems/counting-bits/) — Easy — DP `bits[i] = bits[i>>1] + (i&1)`
- [Reverse Bits](https://leetcode.com/problems/reverse-bits/) — Easy — shift out low bit, shift into result

**Masks & arithmetic**
- [Power of Two](https://leetcode.com/problems/power-of-two/) — Easy — `n > 0 && (n & (n-1)) == 0`
- [Power of Four](https://leetcode.com/problems/power-of-four/) — Easy — single set bit in an even position mask
- [Sum of Two Integers](https://leetcode.com/problems/sum-of-two-integers/) — Medium — XOR sum + carry via `& << 1`
- [Bitwise AND of Numbers Range](https://leetcode.com/problems/bitwise-and-of-numbers-range/) — Medium — common binary prefix
- [Maximum XOR of Two Numbers in an Array](https://leetcode.com/problems/maximum-xor-of-two-numbers-in-an-array/) — Medium — bit trie / greedy prefix

**Math**
- [Pow(x, n)](https://leetcode.com/problems/powx-n/) — Medium — binary (fast) exponentiation
- [Sqrt(x)](https://leetcode.com/problems/sqrtx/) — Easy — Newton's method / binary search on answer
- [Count Primes](https://leetcode.com/problems/count-primes/) — Medium — Sieve of Eratosthenes
- [Excel Sheet Column Number](https://leetcode.com/problems/excel-sheet-column-number/) — Easy — base-26 positional math
- [Factorial Trailing Zeroes](https://leetcode.com/problems/factorial-trailing-zeroes/) — Medium — count factors of 5

## Common follow-up questions

- **Why does `n & (n-1)` clear the lowest set bit?** Subtracting 1 flips the lowest 1 to 0 and
  all trailing 0s to 1s; ANDing with `n` erases that entire low run.
- **How do you count set bits in O(popcount) instead of O(width)?** Brian Kernighan's loop:
  `n &= n-1` per iteration removes one set bit; count iterations. (Hardware `POPCNT` /
  `Integer.bitCount` is O(1).)
- **Why XOR for Single Number but not Single Number II?** XOR cancels pairs (`a^a=0`) but a
  triple `a^a^a = a` does not vanish; you need counting mod 3.
- **Why compute midpoints / products in `long`?** To avoid 32-bit overflow before the modulo
  or comparison; cast *before* the operation, not after.
- **What's the difference between `>>` and `>>>` in Java?** `>>` is arithmetic (sign-extends);
  `>>>` is logical (fills 0). Python has no `>>>` because ints are unbounded and non-two's-
  complement.
- **How do you divide under a modulus?** Multiply by the modular inverse — `a^(m-2) mod m` for
  prime `m` (Fermat's little theorem), computed with fast modular exponentiation.
- **Why start the sieve's inner loop at `p*p`?** All smaller multiples of `p` have a smaller
  prime factor and were already crossed off.

## References

- CLRS, *Introduction to Algorithms* — Chapter 31 (Number-Theoretic Algorithms: GCD, modular
  arithmetic, modular exponentiation), and bit-level RAM model discussion.
- *Hacker's Delight*, Henry S. Warren Jr. — the canonical reference for bit tricks
  (`n & (n-1)`, `n & -n`, popcount, two's complement identities).
- Java Language Specification §15.19 (shift operators) and `java.lang.Integer` /
  `Integer.bitCount`, `Integer.numberOfTrailingZeros` docs.
- Python data model — arbitrary-precision `int`, and why two's-complement bit tricks need
  explicit masking.
- Competitive Programming canon (CP-Algorithms: binary exponentiation, sieve of Eratosthenes,
  Euclidean algorithm, Fenwick tree's `i & -i`).
