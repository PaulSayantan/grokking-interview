# Collections Framework and HashMap Internals

The Java Collections Framework (JCF), introduced in Java 1.2 and living in `java.util`, is a
unified architecture of interfaces, implementations, and algorithms for storing and manipulating
groups of objects. Interview questions cluster around two poles: (1) knowing the *hierarchy* and
the trade-offs between concrete implementations, and (2) understanding the *internals* of
`HashMap` — hashing, buckets, resizing, and treeification. This document layers from definitions
to JVM-level internals and edge cases.

---

## Collection Hierarchy

**Beginner.** The framework is rooted at two *unrelated* top interfaces:

- `java.lang.Iterable` → `java.util.Collection` → `List`, `Set`, `Queue` (and `Deque`).
- `java.util.Map` — **not** a `Collection`. A `Map` is a set of key→value associations, so it
  does not extend `Collection`, though `map.keySet()`, `map.values()`, and `map.entrySet()` return
  collection views.

```
Iterable
  └── Collection
        ├── List      (ordered, indexed, allows duplicates)   → ArrayList, LinkedList, Vector, CopyOnWriteArrayList
        ├── Set       (no duplicates)                         → HashSet, LinkedHashSet, TreeSet, EnumSet
        └── Queue     (FIFO / priority ordering)              → LinkedList, ArrayDeque, PriorityQueue
              └── Deque (double-ended)                        → ArrayDeque, LinkedList

Map (separate root, NOT a Collection)                         → HashMap, LinkedHashMap, TreeMap, Hashtable, ConcurrentHashMap, EnumMap
      └── SortedMap → NavigableMap                            → TreeMap, ConcurrentSkipListMap
```

**Intermediate — semantics per interface:**

| Interface | Duplicates | Ordering | Null elements | Key method |
|-----------|-----------|----------|---------------|------------|
| `List` | yes | insertion / positional index | yes (multiple) | `get(int)`, `add(int, e)` |
| `Set` | no | none (`HashSet`) / insertion (`LinkedHashSet`) / sorted (`TreeSet`) | one null (`HashSet`); none in `TreeSet` with natural order | `contains` |
| `Queue` | yes | FIFO or priority | usually no (`ArrayDeque`/`PriorityQueue` reject null) | `offer`/`poll`/`peek` |
| `Deque` | yes | both ends | `ArrayDeque` rejects null | `addFirst`/`addLast`/`pollFirst`/`pollLast` |
| `Map` | keys unique | impl-dependent | `HashMap` allows one null key + null values | `put`/`get` |

**Advanced — Sequenced Collections (JDK 21, JEP 431).** Java 21 finalized a new set of interfaces
`SequencedCollection`, `SequencedSet`, and `SequencedMap` that unify collections with a
well-defined encounter order. They add `addFirst`/`addLast`/`getFirst`/`getLast`/`reversed()`
(and `putFirst`/`putLast`/`firstEntry`/`lastEntry`/`reversed()` for `SequencedMap`). `List`,
`Deque`, `LinkedHashSet`, and `LinkedHashMap` were retrofitted to implement them. This finally
gives a uniform way to ask a `LinkedHashSet` for its last element without iterating. Note: calling
`reversed()` returns a *view*, not a copy.

**Gotcha.** `Arrays.asList(...)` returns a fixed-size list backed by the array — `add`/`remove`
throw `UnsupportedOperationException`, and `List.of(...)` / `Set.of(...)` / `Map.of(...)`
(immutable factories, **since Java 9**, JEP 269) are fully immutable and reject nulls with
`NullPointerException`.

---

## ArrayList vs LinkedList

**Beginner.** Both implement `List`. `ArrayList` is backed by a resizable array; `LinkedList` is a
doubly-linked list of nodes. `ArrayList` is the default choice ~95% of the time.

**Intermediate — complexity table:**

| Operation | `ArrayList` | `LinkedList` |
|-----------|-------------|--------------|
| `get(int)` random access | O(1) | O(n) (walks from nearest end) |
| `add(E)` at end (amortized) | O(1) amortized | O(1) |
| `add(int, E)` / `remove(int)` in middle | O(n) (array shift) | O(n) to *find*, O(1) to unlink |
| Iterator `remove()` | O(n) (shift) | O(1) |
| Memory per element | compact (Object ref) | high (node = prev + next + item, ~24 bytes overhead) |
| Cache locality | excellent (contiguous) | poor (pointer chasing) |

**Advanced / gotchas.**

- `ArrayList` growth: when capacity is exceeded it grows by ~1.5× (`oldCapacity + (oldCapacity >> 1)`),
  copying via `Arrays.copyOf`. Pre-sizing with `new ArrayList<>(expectedSize)` avoids repeated copies.
- Despite O(1) theoretical middle insertion, `LinkedList` is almost always *slower in practice* than
  `ArrayList` because finding the position is O(n) with cache-hostile pointer chasing. Modern advice:
  prefer `ArrayDeque` over `LinkedList` even for queue/stack use cases.
- `LinkedList` implements `Deque`, so it can act as a queue/stack — but `ArrayDeque` is faster and
  has less memory overhead for that role.
- `ArrayList.remove(Object)` vs `remove(int)`: `list.remove(2)` calls `remove(int index)`;
  `list.remove(Integer.valueOf(2))` calls `remove(Object)`. A classic autoboxing trap.

---

## HashMap Internals

**Beginner.** `HashMap<K,V>` stores key→value pairs and gives *average* O(1) `get`/`put` by hashing
the key to an array index (a "bucket"). It permits one null key and multiple null values, and gives
no ordering guarantee.

**Intermediate — the data structure.** Internally there is a `Node<K,V>[] table` (called `table`;
each slot is a "bucket"). Key constants (Java 8+):

| Constant | Value | Meaning |
|----------|-------|---------|
| `DEFAULT_INITIAL_CAPACITY` | 16 | initial bucket count (must be power of two) |
| `DEFAULT_LOAD_FACTOR` | 0.75 | resize when `size > capacity * loadFactor` |
| `TREEIFY_THRESHOLD` | 8 | a bucket's list converts to a red-black tree at 8 nodes... |
| `UNTREEIFY_THRESHOLD` | 6 | ...and reverts to a list when it shrinks to 6 |
| `MIN_TREEIFY_CAPACITY` | 64 | but treeify only if table capacity ≥ 64, else it resizes instead |

**How a bucket index is computed.** `HashMap` does **not** use `key.hashCode()` directly. It
"perturbs" the hash to mix high bits into low bits (because the index is `hash & (n-1)` and `n` is a
power of two, so only low bits would otherwise matter):

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
// bucket index = hash(key) & (table.length - 1)
```

Because capacity `n` is always a power of two, `hash & (n-1)` is a fast bitmask equivalent to
`hash % n`. A null key hashes to 0 and always lands in bucket 0.

**Collision handling.** Multiple keys in the same bucket form a singly linked list of `Node`s
(chaining). `get` walks the chain comparing `hash` first (cheap int compare) then
`(k == key || key.equals(k))`.

**Advanced — treeification (Since Java 8).** Before Java 8 a bad `hashCode` (all keys colliding)
degraded `get` to O(n). Java 8 (JEP 180) converts a bucket to a **red-black tree** once its chain
length reaches `TREEIFY_THRESHOLD` (8) *and* the table capacity is at least `MIN_TREEIFY_CAPACITY`
(64). If capacity is under 64, the map *resizes* instead of treeifying (resizing usually disperses
the collisions). A treeified bucket gives O(log n) worst case instead of O(n). Keys are compared by
hash, then by `Comparable` if they implement it, else by a tie-break using
`System.identityHashCode` and class name. When a tree shrinks to `UNTREEIFY_THRESHOLD` (6) during
removal/resize, it reverts to a plain list.

**Resize and rehash.** When `size` exceeds `threshold` (`capacity * loadFactor`), the table doubles.
Java 8 avoids recomputing hashes: because capacity doubles, each node either stays at index `i` or
moves to `i + oldCapacity`, decided by a single bit test (`(hash & oldCap) == 0`). This "lo/hi split"
also **preserves relative order** within a bucket, unlike Java 7 which reversed the list during
transfer (the Java 7 reversal is the root cause of the infamous concurrent-resize infinite-loop /
CPU spin bug when `HashMap` was misused across threads).

**Gotchas.**

- Resizing is O(n) and happens mid-`put`; a map that will hold N entries should be created with
  `new HashMap<>((int)(N / 0.75) + 1)` to avoid repeated resizes.
- Mutating a key's fields *after* insertion so that its `hashCode`/`equals` changes makes the entry
  effectively unreachable (it hashes to the wrong bucket). Use immutable keys.
- `HashMap` is **not** thread-safe. Concurrent structural modification can corrupt the table, spin
  the CPU (Java 7), or lose updates. Use `ConcurrentHashMap`.

---

## HashMap vs Hashtable vs ConcurrentHashMap vs LinkedHashMap vs TreeMap

**Beginner.** All are `Map` implementations; they differ in ordering, null handling, thread-safety,
and performance.

| Feature | `HashMap` | `Hashtable` | `ConcurrentHashMap` | `LinkedHashMap` | `TreeMap` |
|---------|-----------|-------------|---------------------|-----------------|-----------|
| Ordering | none | none | none | insertion or access order | sorted (natural / `Comparator`) |
| Null key | 1 allowed | **no** (NPE) | **no** (NPE) | 1 allowed | no (NPE with natural ordering) |
| Null values | yes | **no** | **no** | yes | yes |
| Thread-safe | no | yes (fully synchronized) | yes (fine-grained) | no | no |
| Locking | — | one lock, whole map | CAS + per-bin synchronized (Java 8) | — | — |
| get/put avg | O(1) | O(1) | O(1) | O(1) | O(log n) |
| Since | 1.2 | 1.0 (legacy) | 1.5 | 1.4 | 1.2 |

**Intermediate.**

- **`Hashtable`** is a legacy class (predates the framework, retrofitted). Every method is
  `synchronized` on the whole object, so throughput is poor under contention. Considered obsolete —
  use `ConcurrentHashMap` or `Collections.synchronizedMap`.
- **`ConcurrentHashMap`** (Java 5) originally used lock striping (16 segments). **Rewritten in Java 8**
  to drop segments: it uses CAS for the first insert into an empty bin and `synchronized` on the bin
  head node for updates, giving much higher concurrency. Reads are lock-free. Iterators are
  *weakly consistent* (fail-safe), never throw `ConcurrentModificationException`. `size()` is an
  estimate; use `mappingCount()` for a long. It rejects null keys and null values by design (so that
  `get`==null unambiguously means "absent" in a concurrent context).
- **`LinkedHashMap`** extends `HashMap`, adding a doubly-linked list across entries to preserve
  **insertion order** (or **access order** if constructed with `accessOrder=true`). Overriding
  `removeEldestEntry` turns it into a simple LRU cache. Since JDK 21 it implements `SequencedMap`.
- **`TreeMap`** is a red-black tree implementing `NavigableMap`; keys must be mutually `Comparable`
  or a `Comparator` supplied. Gives sorted iteration and range queries (`floorKey`, `ceilingKey`,
  `headMap`, `tailMap`, `subMap`). O(log n) operations.

**Advanced / gotchas.**

- `Collections.synchronizedMap(new HashMap<>())` wraps every method in a single lock (like
  `Hashtable`) — you must still manually synchronize during iteration. `ConcurrentHashMap` scales far
  better and needs no external locking for iteration.
- `TreeMap` uses **`compareTo`/`compare`, not `equals`**, to decide key equality. Two keys that are
  `!a.equals(b)` but `a.compareTo(b)==0` are treated as the *same* key — a subtle contract mismatch.
- `ConcurrentHashMap` compound operations aren't atomic unless you use the atomic methods
  (`putIfAbsent`, `compute`, `computeIfAbsent`, `merge`). A `computeIfAbsent` lambda must not modify
  the same map (can deadlock / throw in Java 9+).

---

## Fail-Fast vs Fail-Safe Iterators

**Beginner.** A **fail-fast** iterator throws `ConcurrentModificationException` (CME) if the
collection is structurally modified during iteration by anything other than the iterator's own
`remove`. A **fail-safe** (weakly consistent) iterator does not throw; it iterates over a snapshot
or tolerates concurrent changes.

**Intermediate — how fail-fast works.** Collections like `ArrayList`, `HashMap`, `HashSet` keep an
`int modCount` incremented on every structural modification. The iterator snapshots
`expectedModCount` at creation and checks `modCount == expectedModCount` on each `next()`; a mismatch
throws CME. It is **best-effort**, not guaranteed — you must not rely on it for correctness, only
for bug detection.

```java
List<Integer> list = new ArrayList<>(List.of(1, 2, 3));
for (Integer x : list) {          // uses the fail-fast iterator
    if (x == 2) list.remove(x);   // structural modification -> ConcurrentModificationException
}
```

**Fail-safe examples:** `CopyOnWriteArrayList`/`CopyOnWriteArraySet` (iterate over an immutable
snapshot of the backing array taken at iterator creation), and `ConcurrentHashMap`/
`ConcurrentSkipListMap` (weakly consistent — reflect some but not necessarily all updates made
after the iterator was created).

**Advanced / gotchas.**

- The safe way to remove during iteration is `Iterator.remove()`, which updates `expectedModCount`.
  In Java 8+, `Collection.removeIf(predicate)` is cleaner and avoids the trap entirely.
- The "remove the second-to-last element" special case: with `ArrayList`, removing the element right
  before the last one via the enhanced for-loop can *silently succeed without CME* because
  `hasNext()` returns false (cursor == size) before the modCount check runs. Do not depend on CME
  firing.
- `CopyOnWriteArrayList` iterators do not support `remove()` (throws `UnsupportedOperationException`)
  and never see later modifications — great for read-heavy, write-rare listener lists.

---

## equals and hashCode Contract in Maps

**Beginner.** For hash-based collections to work, keys must obey the `Object` contract:

1. If `a.equals(b)` is true, then `a.hashCode() == b.hashCode()` (**equal objects must have equal
   hash codes**).
2. Consistent: repeated calls return the same result if the object is unchanged.
3. Unequal objects *may* share a hash code (collisions are legal) but ideally shouldn't.
4. `equals` must be reflexive, symmetric, transitive, and consistent.

**Intermediate — why it matters for `HashMap`.** `get(key)` computes the bucket from
`hashCode`, then scans the chain using `equals`. If you override `equals` but **not** `hashCode`,
two "equal" keys can land in different buckets, so `get` returns null even though you "put" the
entry — the classic bug:

```java
class Point {
    final int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
    @Override public boolean equals(Object o) {
        return o instanceof Point p && p.x == x && p.y == y;
    }
    // BUG: no hashCode() override -> uses Object identity hash
}
Map<Point, String> m = new HashMap<>();
m.put(new Point(1, 2), "a");
m.get(new Point(1, 2)); // -> null! different identity hashCodes, wrong bucket
```

**Advanced / gotchas.**

- Overriding `hashCode` but not `equals` is also broken: distinct-but-"logically equal" objects
  never compare equal, so you get duplicate keys.
- Mutable keys: if a key's `hashCode` changes after insertion, the entry is stranded in the old
  bucket and becomes unreachable by lookup. Prefer immutable keys.
- **Records (Final in JDK 16, JEP 395)** auto-generate `equals`, `hashCode`, and `toString` from
  their components — ideal for map keys and a big improvement over hand-written or Lombok POJOs.
  The old way was error-prone boilerplate (or `@EqualsAndHashCode`); the new way is
  `record Point(int x, int y) {}` and you get a correct value-based `equals`/`hashCode` for free.
- Use `Objects.equals(a, b)` (null-safe) and `Objects.hash(f1, f2, ...)` (since Java 7) to implement
  the contract without NPEs. Note `Objects.hash` boxes into a varargs array — for hot paths compute
  by hand.
- `TreeMap` ignores `equals`/`hashCode` entirely — it uses `compareTo`/`compare`. So a type can be a
  valid `HashMap` key but behave differently in a `TreeMap`.

---

## Comparable vs Comparator

**Beginner.** Both define ordering. `Comparable<T>` is implemented by the class itself to define its
*natural ordering* via `int compareTo(T o)`. `Comparator<T>` is a separate object defining an
*external / alternative* ordering via `int compare(T a, T b)`.

| | `Comparable` | `Comparator` |
|--|--------------|--------------|
| Package | `java.lang` | `java.util` |
| Method | `compareTo(T)` | `compare(T, T)` |
| Where | inside the class | separate class / lambda |
| Count | one natural order | many orders |
| Used by | `Collections.sort(list)`, `TreeMap`/`TreeSet` default | `sort(list, cmp)`, `TreeMap(cmp)` |

Contract: returns negative / zero / positive if the first arg is less / equal / greater. It should be
consistent with `equals` for `TreeMap`/`TreeSet` to behave intuitively.

**Intermediate — modern Comparator (Since Java 8).** Functional-style factory and chaining methods
eliminate boilerplate:

```java
Comparator<Person> byName =
    Comparator.comparing(Person::getLastName)
              .thenComparing(Person::getFirstName)
              .thenComparingInt(Person::getAge)   // avoids autoboxing
              .reversed();

Comparator<Person> nullsSafe =
    Comparator.comparing(Person::getName, Comparator.nullsLast(Comparator.naturalOrder()));
```

**Advanced / gotchas.**

- Never implement `compare` as `a.value - b.value` on ints that can be large/negative — integer
  overflow flips the sign and breaks ordering. Use `Integer.compare(a, b)` (or `comparingInt`).
- A `Comparator`/`Comparable` that is not a *total order* (violates transitivity/consistency) causes
  `Arrays.sort`/`Collections.sort` (TimSort) to throw
  `IllegalArgumentException: Comparison method violates its general contract!`.
- For `TreeMap`/`TreeSet`, if the comparator says two elements are equal (`compare==0`) they are
  treated as the same key/element even if `equals` disagrees — deduplication follows the comparator.
- `Comparator.reversed()` on a multi-key chain reverses the *entire* composed order, not just the
  last key — order the `reversed()`/`thenComparing` calls carefully.

---

## Common interview follow-up questions

1. Why is `HashMap`'s capacity always a power of two, and how does that make `hash & (n-1)` work?
2. Walk through what happens on `put` when a bucket already has 7 entries and then an 8th arrives —
   does it always treeify? (No — only if capacity ≥ 64, else it resizes.)
3. Why did Java 8 change the resize transfer to avoid the linked-list reversal? What real-world bug
   did that fix?
4. Why does `ConcurrentHashMap` forbid null keys and values while `HashMap` allows them?
5. Show the bug when you override `equals` without `hashCode`. How do records fix this?
6. When would you actually pick `LinkedList` over `ArrayList` (or `ArrayDeque`)?
7. How is `LinkedHashMap` turned into an LRU cache? Which constructor flag and which method?
8. Difference between fail-fast and weakly-consistent iterators; is CME guaranteed?
9. `TreeMap` uses `compareTo`, not `equals` — what surprising behavior can that cause?
10. How does `ConcurrentHashMap` locking in Java 8 differ from the Java 5 segment design?
11. Why is `a.value - b.value` a dangerous `compare` implementation?
12. What does `Collections.synchronizedMap` give you that `ConcurrentHashMap` does not, and vice versa?

---

## References

- JEP 180: Handle frequent HashMap collisions with balanced trees (treeification, Java 8).
- JEP 269: Convenience Factory Methods for Collections (`List.of`/`Set.of`/`Map.of`, Java 9).
- JEP 431: Sequenced Collections (Final in JDK 21).
- Oracle Java SE API docs: `java.util.HashMap`, `LinkedHashMap`, `TreeMap`, `Hashtable`,
  `java.util.concurrent.ConcurrentHashMap`, `Comparable`, `Comparator`, `Object.hashCode`/`equals`.
- OpenJDK source: `java.util.HashMap` (fields `TREEIFY_THRESHOLD`, `UNTREEIFY_THRESHOLD`,
  `MIN_TREEIFY_CAPACITY`, `hash(Object)`, `resize()`).
- Oracle Collections Framework Overview / "The Collections Framework" trail.
- Josh Bloch, *Effective Java*, 3rd ed. — Items 10, 11, 14 (equals/hashCode/Comparable).
