# Immutability and String Handling

Immutability is one of the most important design principles in Java, and `String` is
the canonical immutable class in the language. This topic covers *why* immutability
matters, *how* to build immutable classes correctly, the internals of `String`
(the string pool, `intern()`, compact strings), the `String` vs `StringBuilder` vs
`StringBuffer` trade-offs, defensive copying, and how modern **records** (final in
JDK 16) act as concise immutable data carriers.

---

## Why immutability

**Beginner definition.** An object is *immutable* if its observable state cannot
change after construction. Every "mutation" produces a new object instead of altering
the existing one. `String`, the boxed primitives (`Integer`, `Long`, `Double`, …),
`BigInteger`, `BigDecimal`, `java.time` types (`LocalDate`, `Instant`, …), and
records with immutable components are all immutable.

**Why it matters — the four big wins:**

1. **Thread-safety for free.** An immutable object has no writable state, so it can be
   shared across threads with no synchronization, no locks, and no visibility problems.
   There are no data races because there is nothing to race on. Provided the object is
   *safely published* (see below), all threads see a fully-constructed, consistent value.
2. **Safe sharing and aliasing.** You can hand the same instance to many callers without
   defensive copies. Two references to the same immutable object can never surprise each
   other with a mutation.
3. **Caching and reuse.** Because the value never changes, you can cache it, memoize it,
   and reuse it freely (the string pool and the `Integer` cache exploit exactly this).
4. **Valid hash keys.** An immutable object's `hashCode()` never changes, so it is a safe
   key in a `HashMap`/`HashSet`. A mutable key that changes after insertion becomes
   unreachable ("lost" in the wrong bucket).

**Safe publication caveat.** Immutability guarantees thread-safety *only if the object
is safely published*. The Java Memory Model gives a special guarantee: if all fields
are `final`, other threads are guaranteed to see the correctly-initialized final field
values without extra synchronization (JLS §17.5, "final field semantics"), even if the
object reference is published via a data race. Non-final fields do **not** get this
guarantee — publishing such an object through a race can expose default/partial values.

**Cost.** Immutability trades allocation for safety: every change allocates a new object,
creating garbage. For hot paths that build strings in a loop, this is exactly why
`StringBuilder` exists.

---

## Building immutable classes

**The recipe (pre-records, still the definition of correctness):**

1. Make the class `final` (or use a private constructor + factory) so it cannot be
   subclassed with mutable behavior.
2. Make all fields `private final`.
3. Do **not** expose setters or any method that changes state.
4. Initialize all fields in the constructor.
5. **Defensively copy** mutable inputs on the way *in* (constructor) and mutable
   internal state on the way *out* (getters). Never leak a reference to internal mutable
   state.

```java
public final class Period {
    private final Date start;   // Date is mutable — danger!
    private final List<String> tags;

    public Period(Date start, List<String> tags) {
        // copy IN so the caller can't mutate our state afterwards
        this.start = new Date(start.getTime());
        this.tags  = List.copyOf(tags);            // unmodifiable snapshot (Java 10+)
    }

    public Date getStart() {
        return new Date(start.getTime());          // copy OUT
    }
    public List<String> getTags() {
        return tags;                               // already unmodifiable
    }
}
```

**Advanced gotchas:**

- Marking a field `final` only makes the *reference* unchangeable, not the *object* it
  points to. `private final Date d` still lets callers mutate the `Date` if you leak it.
- `final` on the class blocks subclass attacks; alternatively make the constructor
  private and validate invariants in a static factory.
- Beware the constructor leaking `this` (e.g., registering a listener) before all final
  fields are assigned — this breaks the safe-publication guarantee.
- Deep vs shallow immutability: `List.of(...)` / `List.copyOf(...)` give an unmodifiable
  list, but if the elements themselves are mutable, the aggregate is only *shallowly*
  immutable.

---

## String immutability and the string pool

**Beginner.** `String` objects are immutable — once created, the sequence of characters
never changes. Methods like `substring`, `toUpperCase`, `replace`, and `concat` all
return **new** strings and leave the original untouched.

**The string pool (string constant pool / intern table).** The JVM maintains a pool of
unique string instances. All **compile-time string literals** are automatically interned
and point at the same pooled instance:

```java
String a = "hello";
String b = "hello";
System.out.println(a == b);        // true  — same pooled object
String c = new String("hello");
System.out.println(a == c);        // false — new heap object, not pooled
System.out.println(a == c.intern());// true  — intern() returns the pooled reference
System.out.println(a.equals(c));   // true  — equals compares contents
```

Key rules:

- **Literals** and **compile-time constant expressions** (`"he" + "llo"`, both operands
  constant `final`) are interned by the compiler.
- **`new String("x")`** always creates a distinct object on the heap, *plus* the literal
  `"x"` still lives in the pool.
- **Runtime concatenation** (`a + someVariable`) produces a new, *non-pooled* string.

**Pool location (version note).** Before **Java 7** the string pool lived in PermGen.
Since **Java 7** the pool was moved to the main heap, so interned strings can be garbage
collected and the pool can grow large. PermGen itself was removed entirely in **Java 8**
(replaced by Metaspace).

---

## The intern method

`String.intern()` returns a canonical representation: if an equal string is already in
the pool it returns that pooled reference; otherwise it adds this string to the pool and
returns it. This lets you deduplicate strings so that `==` becomes a valid equality test
and memory is saved for many-duplicate datasets.

```java
String s1 = new String("data").intern();
String s2 = "data";
System.out.println(s1 == s2);   // true
```

**Advanced / gotchas:**

- The pool is backed by a fixed-size native hash table. Its capacity is tunable via
  `-XX:StringTableSize=N`. Interning huge numbers of unique strings can cause long hash
  chains and performance degradation, and (pre-Java-7) `OutOfMemoryError: PermGen`.
- Manual `intern()` is rarely worth it; prefer **G1 String Deduplication**
  (`-XX:+UseStringDeduplication`, available with G1 since JDK 8u20) which dedups the
  backing `char[]`/`byte[]` arrays automatically without changing `==` semantics.
- Interned strings are only collected once no other references (and the pool entry) keep
  them alive.

---

## Why String is immutable

Design rationale — this is a classic interview question. String immutability enables:

1. **The string pool / caching.** Sharing one instance across many references is only
   safe if nobody can mutate it. Mutability would corrupt every alias.
2. **Security.** Strings are used everywhere for sensitive parameters: file paths, URLs,
   hostnames, DB connection strings, class names passed to class loaders. If a string
   could change after a security check (time-of-check to time-of-use), an attacker could
   pass validation then mutate the value. Immutability closes that window.
3. **Hashcode caching.** `String` caches its hash code in a field (computed lazily on
   first call). This is only correct because the contents never change — making strings
   ideal `HashMap` keys with a cheap, cached hash.
4. **Thread-safety.** Strings can be shared across threads with zero synchronization.
5. **Class loading integrity.** Class names are strings; immutability prevents them from
   being altered between resolution and loading.

**Sensitive-data caveat.** Because strings are immutable *and* pooled, you cannot
reliably wipe a password `String` from memory. For secrets, use `char[]` (which you can
zero out with `Arrays.fill`) so the plaintext does not linger in the heap / pool.

---

## String vs StringBuilder vs StringBuffer

| Aspect            | `String`                       | `StringBuilder`            | `StringBuffer`             |
|-------------------|--------------------------------|----------------------------|----------------------------|
| Mutability        | Immutable                      | Mutable                    | Mutable                    |
| Thread-safe       | Yes (inherently)               | **No**                     | Yes (synchronized methods) |
| Performance       | New object per change          | Fastest for building       | Slower (lock overhead)     |
| Since             | JDK 1.0                        | **JDK 5**                  | JDK 1.0                    |
| Use when          | Fixed / shared text            | Single-threaded building   | Rare; shared mutable buffer|

- **`StringBuilder`** (Java 5) is the default choice for building strings, especially in
  loops. It is *not* synchronized, so it is faster but must not be shared across threads
  without external synchronization.
- **`StringBuffer`** predates `StringBuilder` and has synchronized methods. In practice
  it is rarely the right tool: sharing a single buffer across threads is unusual, and
  even then per-method locking rarely gives correct compound behavior. Prefer
  `StringBuilder` plus proper concurrency design.
- Both share a growable backing array; pre-sizing via `new StringBuilder(capacity)`
  avoids repeated array resizing/copying.

```java
// O(n^2) — each += builds a brand new String (allocates + copies everything)
String s = "";
for (int i = 0; i < n; i++) s += i;

// O(n) — one growable buffer
StringBuilder sb = new StringBuilder();
for (int i = 0; i < n; i++) sb.append(i);
String result = sb.toString();
```

---

## Concatenation and compact strings

**Compile-time constants.** `"a" + "b" + "c"` is folded into the single literal `"abc"`
by the compiler and interned.

**Runtime concatenation — how the `+` operator is implemented:**

- **Java 8 and earlier:** `javac` desugared `a + b` into explicit `new StringBuilder()`
  `.append(a).append(b).toString()` calls. A `+=` inside a loop therefore creates a new
  `StringBuilder` *per iteration* — hence the O(n²) trap; hoist an explicit
  `StringBuilder` out of the loop.
- **Since Java 9 (JEP 280, "Indify String Concatenation"):** `javac` emits an
  `invokedynamic` bytecode bound to `java.lang.invoke.StringConcatFactory`. The concrete
  strategy is chosen at runtime by the JDK, letting the JVM optimize concatenation without
  recompiling old code. It does **not** turn a loop of `+=` into O(n); a loop still
  produces many intermediate strings, so `StringBuilder` is still required for loops.

**Compact Strings (JEP 254, Java 9).** Before Java 9 `String` stored a `char[]`
(2 bytes/char, UTF-16) regardless of content. Since **Java 9**, `String` is backed by a
`byte[]` plus a `coder` flag:

- If every character fits in Latin-1 (ISO-8859-1, one byte), the string is stored as
  `byte[]` with `LATIN1` encoding — **half the memory** of the old representation.
- Otherwise it falls back to `UTF16` (2 bytes/char).

This is transparent to your code (the public API is unchanged) and typically cuts heap
usage and improves cache behavior for the common ASCII/Latin-1 case. It can be disabled
with `-XX:-CompactStrings`. Note this replaced the earlier, coarser "Compressed Strings"
experiment from Java 6 update releases.

**Text blocks (final in JDK 15, JEP 378).** Multi-line string literals with `"""`
delimiters. They are still ordinary immutable `String`s — purely a source-level
convenience for readability; no runtime type change.

---

## Defensive copies

A **defensive copy** protects an object's invariants when it accepts or returns
references to mutable objects. Without it, callers can reach in and mutate your internal
state, breaking encapsulation and (for "immutable" classes) immutability itself.

```java
public final class Schedule {
    private final Date start;
    public Schedule(Date start) {
        this.start = new Date(start.getTime());   // copy IN
    }
    public Date getStart() {
        return new Date(start.getTime());          // copy OUT
    }
}
```

Rules of thumb:

- Copy **in** in the constructor *before* validating (avoid a TOCTOU window where another
  thread mutates the argument between the check and the copy).
- Copy **out** of getters for mutable fields, or return unmodifiable views.
- Prefer immutable member types (`java.time` instead of `Date`, `List.copyOf` instead of
  a raw `ArrayList`) so copying becomes unnecessary.
- Unmodifiable collections: `Collections.unmodifiableList` wraps a *live* backing list
  (changes to the backing list show through); `List.of` / `List.copyOf` (Java 9/10)
  create a true independent snapshot.

---

## Records as immutable carriers

**The problem records solve.** Before records, a simple immutable data holder required
dozens of lines of boilerplate: private final fields, an all-args constructor, getters,
`equals`, `hashCode`, and `toString`. Teams reached for Lombok (`@Value`) or IDE code
generation, both of which add tooling dependencies or hand-maintained, error-prone code.

**Records (final in JDK 16, JEP 395; previewed in JDK 14 and JDK 15).** A `record`
declares a transparent, shallowly-immutable carrier for a fixed set of values. The
compiler generates: a private final field per component, a canonical constructor,
accessor methods (named like the component, e.g. `name()` — *not* `getName()`),
`equals`, `hashCode`, and `toString`.

```java
public record Point(int x, int y) { }

// Old way: ~40 lines of POJO boilerplate. New way: one line.
Point p = new Point(1, 2);
p.x();                    // accessor (no "get" prefix)
p.equals(new Point(1,2)); // true — value-based equality generated for you
```

Key facts and gotchas:

- Records are **implicitly `final`** and cannot extend another class (they extend
  `java.lang.Record`); they *can* implement interfaces.
- Components are `final`; records are **shallowly** immutable — a `record Holder(List<T> xs)`
  can still have its list mutated unless you defensively copy in a *compact constructor*:

  ```java
  public record Holder(List<Integer> xs) {
      public Holder {                       // compact canonical constructor
          xs = List.copyOf(xs);             // normalize + defend against mutation
      }
  }
  ```

- You may add static fields/methods and instance methods, but **not** additional instance
  fields beyond the components.
- **Record patterns** (final in **JDK 21**, JEP 440) allow destructuring in pattern
  matching: `if (obj instanceof Point(int x, int y))`.
- Records pair naturally with **sealed classes** (final in **JDK 17**, JEP 409) to model
  closed algebraic data types.

Records are not a replacement for all classes — use them for immutable value aggregates,
not for entities with identity or mutable lifecycle.

---

## Common interview follow-up questions

1. Why is `String` immutable in Java? Give at least three distinct reasons.
2. What is the difference between `new String("x")` and the literal `"x"`? How many
   objects can `new String("x")` create?
3. What does `intern()` do, and when would you use it versus G1 String Deduplication?
4. Where does the string pool live, and how did that change across Java 6, 7, and 8?
5. Explain the O(n²) trap of `+=` in a loop. How did JEP 280 (Java 9) change `+` compilation?
6. What are compact strings (JEP 254)? What problem do they solve and when do they *not* help?
7. Walk through building a truly immutable class that holds a `Date` and a `List`.
   Where exactly do the defensive copies go and why?
8. How does `final` on a field relate to the Java Memory Model's safe-publication guarantee?
9. `StringBuilder` vs `StringBuffer` — when, if ever, would you actually pick `StringBuffer`?
10. Why should passwords be `char[]` rather than `String`?
11. Are records deeply immutable? How do you defend a record component that is a collection?
12. Which Java version made records final? Sealed classes? Record patterns? Text blocks?

---

## References

- JLS §17.5 — *final Field Semantics* (safe publication guarantee).
- JEP 254: *Compact Strings* (Java 9).
- JEP 280: *Indify String Concatenation* (Java 9).
- JEP 378: *Text Blocks* (final in JDK 15).
- JEP 395: *Records* (final in JDK 16; previewed by JEP 359 in JDK 14 and JEP 384 in JDK 15).
- JEP 409: *Sealed Classes* (final in JDK 17).
- JEP 440: *Record Patterns* (final in JDK 21).
- *Effective Java*, 3rd ed. — Item 17 (Minimize mutability) and Item 50 (Make defensive copies).
- Oracle Java SE API docs: `java.lang.String`, `StringBuilder`, `StringBuffer`,
  `java.lang.invoke.StringConcatFactory`.
