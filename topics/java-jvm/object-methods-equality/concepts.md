# Object Class Contract: equals, hashCode, toString and clone

Every class in Java implicitly extends `java.lang.Object`, which provides a small set of
non-final methods intended to be overridden: `equals(Object)`, `hashCode()`, `toString()`,
and `clone()`. These methods are governed by *contracts* documented in the JDK Javadoc.
Violating them does not produce a compile error — instead you get silent, hard-to-debug
misbehavior in hash-based collections, in `List.contains`, in logging, and in defensive copying.
This topic is a perennial interview favorite because it tests whether you understand *why*
the rules exist, not just that they exist.

---

## Reference identity versus logical equality

The most fundamental distinction is between **reference identity** (are these two references
pointing at the exact same object on the heap?) and **logical equality** (do these two objects
represent the same conceptual value?).

- `==` on reference types compares **references** (identity). It answers "same object?".
- `.equals(Object)` is a **method** whose default implementation in `Object` is `this == that`,
  i.e. identity — but it is *meant* to be overridden to express logical equality.

```java
String a = new String("hi");
String b = new String("hi");
System.out.println(a == b);        // false  -> different objects
System.out.println(a.equals(b));   // true   -> String overrides equals for value equality
```

For **primitives**, `==` compares values directly; there is no `equals` on a primitive
(`int`, `double`, etc.). Autoboxing complicates this:

```java
Integer x = 127, y = 127;
Integer p = 128, q = 128;
System.out.println(x == y);   // true  -> Integer cache (-128..127) returns same object
System.out.println(p == q);   // false -> outside cache, distinct objects
System.out.println(p.equals(q)); // true
```

The `Integer` cache (JLS also mandates caches for `Boolean`, `Byte` (all values),
`Short`/`Integer`/`Long` in -128..127, and `Character` in 0..127) is a classic trap: `==`
"works" for small values and breaks for large ones. **Always
use `.equals` (or `.compareTo`, or unbox with `.intValue()`) to compare boxed values.**

A subtle floating-point note: `Double.equals` and `==` disagree on `NaN` and signed zero.
`0.0 == -0.0` is `true` but `Double.valueOf(0.0).equals(-0.0)` is `false`; `NaN == NaN` is
`false` but `Double.valueOf(NaN).equals(NaN)` is `true`. This is because `equals` compares the
raw bit patterns (via `doubleToLongBits`) so that hash collections behave consistently.

---

## The equals contract

`Object.equals` must satisfy five properties for **non-null** references. From the Javadoc:

| Property | Meaning |
|---|---|
| **Reflexive** | `x.equals(x)` is `true`. |
| **Symmetric** | `x.equals(y)` is `true` **iff** `y.equals(x)` is `true`. |
| **Transitive** | if `x.equals(y)` and `y.equals(z)`, then `x.equals(z)`. |
| **Consistent** | repeated calls return the same result, provided no state used in comparisons changes. |
| **Non-nullity** | `x.equals(null)` must return `false` (never throw). |

A canonical correct implementation:

```java
public final class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override public boolean equals(Object o) {
        if (this == o) return true;             // 1. identity fast-path (perf + reflexive)
        if (!(o instanceof Point)) return false; // 2. type check also handles null
        Point p = (Point) o;
        return x == p.x && y == p.y;            // 3. compare significant fields
    }

    @Override public int hashCode() { return Objects.hash(x, y); }
}
```

Since Java 16 you can fold the cast into the type check with **pattern matching for
`instanceof`** (finalized in JDK 16, JEP 394):

```java
@Override public boolean equals(Object o) {
    return o instanceof Point p && x == p.x && y == p.y;
}
```

Key rules of thumb:
- Compare against `Object`, not your own type — otherwise you **overload** rather than
  **override** `equals`, and collections will call the inherited identity version.
- Use `instanceof` (returns `false` for `null`, giving non-nullity for free) rather than a
  `null` check plus `getClass()` — unless you deliberately want the `getClass()` strategy.
- Compare all *significant* (value-defining) fields; skip derived/cached fields.
- For `float`/`double` use `Float.compare`/`Double.compare` (or `Objects.equals` semantics),
  for arrays use `Arrays.equals`, for object fields use `Objects.equals(a, b)` (null-safe).

---

## Symmetry, transitivity and the inheritance trap

The hardest part of the equals contract to satisfy is **symmetry and transitivity across an
inheritance boundary**. If a subclass adds a value-significant field, there is *no* way to both
extend an instantiable class *and* preserve the contract (Effective Java, Item 10).

Classic broken symmetry — a case-insensitive string that tries to equal plain `String`:

```java
final class CIString {
    private final String s;
    CIString(String s) { this.s = s; }
    @Override public boolean equals(Object o) {
        if (o instanceof CIString c) return s.equalsIgnoreCase(c.s);
        if (o instanceof String str) return s.equalsIgnoreCase(str); // BUG
        return false;
    }
}
// cis.equals("abc") -> true, but "abc".equals(cis) -> false  => NOT symmetric
```

The two dominant strategies for the type check:

| Strategy | Behavior | Trade-off |
|---|---|---|
| `instanceof` | subclass instances *can* equal superclass instances | risks breaking symmetry/transitivity when subclasses add state |
| `getClass()` | only exact-same-class instances are equal | violates the **Liskov substitution principle**; a subclass that adds no state cannot equal its parent, breaks `HashSet` behavior with proxies/hibernate |

Recommended resolution: **favor composition over inheritance** — instead of subclassing
`Point` to make `ColorPoint`, give `ColorPoint` a `Point` field and a view method. This
sidesteps the contract problem entirely. An abstract superclass (not instantiable) also avoids
the issue because you can never create a bare-parent instance to compare against.

---

## The hashCode contract and the equals-hashCode link

`hashCode()` returns an `int` used to bucket objects in hash-based collections. Its contract:

1. **Consistent**: repeated calls return the same int during one execution, absent state change.
2. **equals implies equal hash**: if `a.equals(b)`, then `a.hashCode() == b.hashCode()`.
3. **Unequal objects need NOT have distinct hashes**, but distinct hashes improve performance.

The single rule that catches everyone: **whenever you override `equals`, you MUST override
`hashCode`.** If you override `equals` but inherit `Object.hashCode` (identity-based), two
"equal" objects will almost certainly land in different buckets, and `HashMap`/`HashSet` will
fail to find them.

```java
Map<Point, String> m = new HashMap<>();
m.put(new Point(1, 2), "a");
m.get(new Point(1, 2));  // null if hashCode not overridden, even though equals says they match
```

The reverse — equal hashCodes for unequal objects — is legal (a *collision*) and merely
degrades performance. Returning a constant like `return 42;` is *contract-valid* but disastrous:
every element collides into one bucket, turning O(1) lookups into O(n) (or O(log n) for
treeified bins; see below).

Idiomatic implementations:

```java
// Java 7+ : java.util.Objects
@Override public int hashCode() { return Objects.hash(x, y); }   // varargs, boxes -> allocates
// hot-path alternative (no boxing / no array):
@Override public int hashCode() {
    int result = Integer.hashCode(x);
    result = 31 * result + Integer.hashCode(y);
    return result;
}
```

The multiplier **31** is conventional (odd prime; `31 * i == (i << 5) - i`, so the JIT can turn
it into a shift and subtract). `Objects.hash(...)` is convenient but allocates a varargs array
and boxes primitives, so avoid it in performance-critical hashing.

---

## Consequences of breaking the contract in hash collections

Understanding *how* `HashMap` uses these methods explains the failure modes:

1. Compute `hashCode()`, then spread/perturb the bits (`h ^ (h >>> 16)`) and mask to the bucket
   index (`(n - 1) & hash`, where `n` is the power-of-two table size).
2. Within a bucket, walk the chain; for each candidate first compare hash, then use `equals`.

Failure modes:

- **Mutating a key after insertion** so its `hashCode`/`equals` change: the entry is now in the
  "wrong" bucket. `contains`/`get` compute the *new* hash, look in a different bucket, and miss
  it — the entry becomes a memory leak you cannot retrieve or remove. **Use immutable keys.**
- **Overriding `equals` without `hashCode`**: equal objects scatter across buckets; lookups miss.
- **Constant `hashCode`**: correctness is fine but everything collides into one bucket.
- **`equals` inconsistent with `compareTo`**: `TreeMap`/`TreeSet` use `compareTo`
  (or a `Comparator`), *not* `equals`, to determine membership. If `compareTo` says "equal"
  (returns 0) but `equals` says "not equal", a `TreeSet` will violate the `Set` contract. The
  Javadoc *strongly recommends* `(x.compareTo(y) == 0) == x.equals(y)` — `BigDecimal` famously
  breaks this (`new BigDecimal("1.0")` vs `"1.00"` are `compareTo`-equal but not `equals`-equal),
  so a `HashSet<BigDecimal>` and `TreeSet<BigDecimal>` behave differently.

**Treeification (Java 8+):** when a single bucket accumulates ≥ `TREEIFY_THRESHOLD` (8) entries
*and* the table capacity is ≥ `MIN_TREEIFY_CAPACITY` (64), `HashMap` converts that bucket's
linked list into a red-black tree, so worst-case lookup within a pathological bucket is O(log n)
instead of O(n). This mitigates hash-collision DoS but does **not** excuse a bad `hashCode`.
For treeification, keys are ordered by hash and, if they implement `Comparable`, by `compareTo`.

---

## toString

`Object.toString` returns `getClass().getName() + "@" + Integer.toHexString(hashCode())`,
e.g. `com.example.Point@1b6d3586`. That hex suffix is the *identity* hash in hex, **not** a
memory address, and not your overridden `hashCode` unless you overrode it.

Overriding `toString` is strongly recommended (Effective Java Item 12): it makes logs,
assertion failures, and debugger output readable. Guidance:

- Include all interesting fields; make the format clear and, ideally, documented.
- Do **not** rely on `toString` output as a machine-parseable format unless you commit to it in
  the Javadoc (that becomes an API contract).
- Provide programmatic accessors for anything in `toString`, so callers don't parse the string.

```java
@Override public String toString() { return "Point[x=" + x + ", y=" + y + "]"; }
```

`toString` has no formal *contract* the way `equals`/`hashCode` do, but it is invoked implicitly
by string concatenation (`"" + obj`), `String.valueOf(obj)` (which is null-safe and returns
`"null"`), `System.out.println(obj)`, and most logging frameworks.

---

## clone and Cloneable pitfalls

`clone()` is the most criticized method in `Object`. `Cloneable` is a **marker interface** with
no methods — it does not declare `clone()`. Instead it changes the behavior of the *protected*
`Object.clone()`: if the object's class implements `Cloneable`, `Object.clone()` performs a
field-by-field **shallow copy**; otherwise it throws `CloneNotSupportedException`. This is a
bizarre design where implementing an interface alters a superclass method's behavior.

Problems (Effective Java Item 13 — "avoid `clone`"):

- **Shallow by default**: `Object.clone` copies field *values*. Reference fields are shared
  between original and clone, so mutating a nested object leaks across both. You must manually
  deep-copy mutable reference fields.

```java
class Stack implements Cloneable {
    private Object[] elements; private int size;
    @Override public Stack clone() {
        try {
            Stack r = (Stack) super.clone();
            r.elements = elements.clone(); // MUST deep-copy the array, else shared backing store
            return r;
        } catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
```

- **`final` fields fight `clone`**: a mutable field you need to reassign in `clone` cannot be
  `final`, undermining immutability.
- **No constructor is invoked**: `clone` produces an object without running any constructor,
  so invariants normally enforced in constructors can be bypassed.
- **Checked `CloneNotSupportedException`** clutters call sites even when you implement `Cloneable`.
- **Covariant return types (Java 5+)** let you override `clone()` to return your own type instead
  of `Object`, which helps callers but doesn't fix the deeper issues.

**Preferred alternatives:** a **copy constructor** (`new ArrayList<>(other)`) or a **static copy
factory** (`Point.copyOf(p)`). These invoke constructors, work with `final` fields, can take
interface types, don't require `Cloneable`, and let you convert types during copy. Most modern
JDK collections offer copy constructors; new code should almost never implement `Cloneable`.

Note that arrays *do* support `clone()` cleanly (it is the recommended way to copy an array),
returning a shallow copy of the array — but the *elements* are still shared references.

---

## Records auto-generate equals, hashCode and toString

**Records** (preview in JDK 14 and 15 via JEP 359/384; **finalized in JDK 16**, JEP 395) are
the modern answer to the "value class" boilerplate that `equals`/`hashCode`/`toString` require.

```java
public record Point(int x, int y) {}
```

The compiler generates, from the record *components*:

- a canonical constructor,
- an accessor per component (`x()`, `y()` — note: no `get` prefix),
- `equals` that is `true` iff the other object is the same record type and **all components are
  equal** (using `Objects.equals`, with proper `Double.compare`-style handling for floats),
- `hashCode` derived from all components,
- `toString` like `Point[x=1, y=2]`.

This makes records **immutable, transparent carriers of data** whose `equals`/`hashCode` are
guaranteed contract-correct by the language — eliminating a whole class of hand-written bugs.

**Old way vs new way:**

| Concern | Manual POJO / Lombok | Record (JDK 16+) |
|---|---|---|
| `equals`/`hashCode`/`toString` | hand-written or `@Data`/IDE-generated; can drift from fields | generated by the *compiler*, always in sync with components |
| Immutability | must add `final` fields + no setters by hand | components are `final` by construction |
| Boilerplate | large | one line |
| Extensibility | open to subclassing bugs | records are implicitly `final`, cannot extend a class |

You may still **override** the generated methods (e.g. a normalizing `equals`, or a defensive
`toString` that hides a secret), and you can validate/normalize in a **compact constructor**.
But if you override `equals` you should override `hashCode` too, exactly as with any class —
the record only *generates* them for you; it does not enforce the link once you take over.

Records pair naturally with **sealed classes** (finalized JDK 17, JEP 409) and **record patterns**
(finalized JDK 21, JEP 440) for exhaustive, deconstructing pattern matching in `switch`.

---

## Common interview follow-up questions

- Why must you override `hashCode` whenever you override `equals`? What breaks if you don't?
- Walk through what `HashMap.get` does with `hashCode` and `equals` step by step.
- Is returning a constant from `hashCode` a contract violation? What is the consequence?
- Explain the Integer cache and why `==` on boxed `Integer` is dangerous.
- `instanceof` vs `getClass()` in `equals` — trade-offs? Which breaks Liskov substitution?
- Show a broken-symmetry `equals` and explain how a `HashSet` misbehaves as a result.
- Why is `clone()` discouraged? What do you use instead, and why is `Cloneable` weird?
- Shallow vs deep copy — where does `Object.clone` land, and how do you deep-copy?
- What happens if you mutate an object after using it as a `HashMap` key?
- How do records generate `equals`/`hashCode`/`toString`, and can you override them?
- Why do `BigDecimal` `equals` and `compareTo` disagree, and why does it matter for `TreeSet`?
- What does `Object.toString`'s default output actually contain? Is the hex part an address?
- Explain treeification in `HashMap` (Java 8) and how it relates to bad `hashCode`s.
- Why is `Objects.hash(...)` discouraged on a hot path?

## References

- Javadoc: `java.lang.Object` — `equals`, `hashCode`, `toString`, `clone` contracts.
- Javadoc: `java.util.Objects` (`equals`, `hash`, `requireNonNull`) — since Java 7.
- Javadoc: `java.util.HashMap` (treeification, `TREEIFY_THRESHOLD`, `MIN_TREEIFY_CAPACITY`).
- Joshua Bloch, *Effective Java, 3rd ed.* — Items 10 (equals), 11 (hashCode), 12 (toString),
  13 (clone), 14 (Comparable).
- JEP 395: Records (finalized in JDK 16). JEP 359/384: Records (preview, JDK 14/15).
- JEP 394: Pattern Matching for `instanceof` (finalized in JDK 16).
- JEP 409: Sealed Classes (finalized in JDK 17). JEP 440: Record Patterns (finalized in JDK 21).
- JLS: boxing conversion and the required caches for small integral values.
