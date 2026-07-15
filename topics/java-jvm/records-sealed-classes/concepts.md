# Records, Sealed Classes and Modern Data Modeling

Java historically forced you to write a lot of ceremony to model plain data: a class with private
final fields, a constructor, getters, `equals`, `hashCode`, and `toString`. Two features — **records**
(finalized in **JDK 16**, JEP 395) and **sealed classes** (finalized in **JDK 17**, JEP 409) — attack
this from complementary directions. Records remove the boilerplate of a *single* immutable data
carrier; sealed classes let you constrain a *hierarchy* so the compiler knows the complete set of
subtypes. Combined, they give Java **algebraic data types** (ADTs) that pair beautifully with pattern
matching.

This guide is layered: each section opens with the beginner definition and motivation, moves through
intermediate usage and comparisons, and closes with advanced internals, edge cases, and gotchas. Java
version tags are called out explicitly because interviewers love version-accuracy questions.

**Version timeline (memorize this):**

| Feature | First preview | Finalized (standard) |
|---|---|---|
| Records | JDK 14 (JEP 359), 2nd preview JDK 15 (JEP 384) | **JDK 16 (JEP 395)** |
| Sealed classes | JDK 15 (JEP 360), 2nd preview JDK 16 (JEP 397) | **JDK 17 (JEP 409)** |
| Pattern matching for `instanceof` | JDK 14/15 preview | **JDK 16 (JEP 394)** |
| Pattern matching for `switch` | JDK 17 preview (JEP 406) through JDK 20 | **JDK 21 (JEP 441)** |
| Record patterns (deconstruction) | JDK 19/20 preview | **JDK 21 (JEP 440)** |
| Text blocks | JDK 13/14 preview | JDK 15 (JEP 378) |

---

## Records Basics

**Beginner.** A *record* is a special kind of class, declared with the `record` keyword, that acts as a
transparent, immutable carrier for a fixed set of values called its **components**. Records are a
standard feature **since JDK 16** (they were preview in 14 and 15).

```java
public record Point(int x, int y) { }
```

That one line generates all of the following automatically:

- A `private final` field for each component (`x`, `y`).
- A **canonical constructor** taking all components in declaration order.
- A public **accessor** for each component, named after the component — `x()` and `y()`, **not**
  `getX()`/`getY()` (records do not follow the JavaBeans get/set convention).
- `equals(Object)` and `hashCode()` derived from *all* components (value semantics).
- A `toString()` of the form `Point[x=1, y=2]`.

**The problem it solves.** The equivalent hand-written class is ~40 lines of error-prone boilerplate.
The classic risk is that someone adds a field but forgets to update `equals`/`hashCode`, silently
breaking hash-based collections. A record makes the compiler own that contract, so it can never drift.

```java
// OLD way — the "immutable POJO" ceremony
public final class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    public int getX() { return x; }
    public int getY() { return y; }
    @Override public boolean equals(Object o) { /* 8 lines */ }
    @Override public int hashCode() { return Objects.hash(x, y); }
    @Override public String toString() { return "Point[x=" + x + ", y=" + y + "]"; }
}
```

**Intermediate.** A record is *nominally* a data carrier but is still a real class. It can implement
interfaces, declare static fields/methods, declare instance methods, and be generic
(`record Pair<A, B>(A first, B second) {}`). What you get is a strong semantic promise: the state
described by the component list *is* the state of the object.

**Advanced / semantics.** Records give you **shallow** immutability. The component *references* are
final, but if a component is itself mutable (e.g. an `int[]` or a `List`), callers can still mutate the
referenced object. Defensive copying in the compact constructor is the fix (see below). Also note the
accessor returns the field directly, so `record R(int[] data)` leaks the array.

---

## Record Auto Generated Members

**Beginner.** The compiler synthesizes `equals`, `hashCode`, `toString`, and one accessor per
component. Two records of the same type are equal iff every corresponding component is equal
(using `Objects.equals` semantics, and `==` bit-for-bit rules for primitives).

**Intermediate — floating point subtlety.** Record `equals`/`hashCode` for `double`/`float`
components use `Double.compare`/`Float.compare`-style semantics (as `Double.valueOf(x).equals(...)`
would), **not** raw `==`. Concretely: `Double.NaN` **equals** `Double.NaN` inside a record, and
`+0.0` does **not** equal `-0.0`. This is the opposite of the `==` operator and is a favorite trick
question.

```java
record D(double v) {}
new D(Double.NaN).equals(new D(Double.NaN)); // true  (== would be false)
new D(0.0).equals(new D(-0.0));              // false (== would be true)
```

**Advanced — overriding the generated members.** You may override any of them, but you must preserve
the contract. If you override `equals` you should override `hashCode` consistently, exactly as with
normal classes. You can also add extra accessors or methods. What you *cannot* do is add instance
fields beyond the components — see "Records Restrictions."

**Reflection.** `Class::isRecord` (since JDK 16) returns true for records, and
`Class::getRecordComponents()` returns a `RecordComponent[]` describing the components in declaration
order. Frameworks (Jackson, Hibernate, etc.) use this to bind data without get/set conventions.

---

## Canonical Compact and Custom Constructors

This is one of the highest-yield record topics. There are three constructor shapes.

**1. Canonical constructor (implicit or explicit).** Every record has a canonical constructor whose
signature matches the component list. If you write nothing, it is generated and simply assigns each
field. You may write it explicitly with the full parameter list:

```java
public record Range(int lo, int hi) {
    public Range(int lo, int hi) {         // explicit canonical
        if (lo > hi) throw new IllegalArgumentException("lo > hi");
        this.lo = lo;
        this.hi = hi;                       // MUST assign every field
    }
}
```

**2. Compact constructor (record-only, since JDK 16).** A concise form that has **no parameter list**
and **no explicit field assignments**. You validate/normalize the parameters, and the compiler
appends `this.lo = lo; this.hi = hi;` automatically at the end.

```java
public record Range(int lo, int hi) {
    public Range {                          // note: no parentheses/params
        if (lo > hi) throw new IllegalArgumentException("lo > hi");
        hi = Math.min(hi, 100);             // normalize the PARAMETER, not this.hi
    }
}
```

Key rule: inside a compact constructor you assign to the **parameter names** (`hi = ...`) to influence
what gets stored; you must **not** assign to `this.hi` yourself (the implicit assignment does it).
Reading `this.hi` inside the compact body sees the default (0), not the incoming value.

**3. Custom (non-canonical) constructors.** Additional overloads are allowed, but every non-canonical
constructor **must delegate to another constructor via `this(...)`** on its first line, ultimately
reaching the canonical one. This guarantees the canonical constructor's validation always runs.

```java
public record Range(int lo, int hi) {
    public Range(int hi) { this(0, hi); }   // must call this(...)
}
```

**Gotcha:** You cannot have *both* a compact canonical constructor and an explicit canonical
constructor — pick one. And a compact constructor cannot assign `this.field` explicitly (compile
error).

**Defensive copying** belongs in the (compact) canonical constructor, and the matching accessor
should copy on the way out too:

```java
public record Tags(List<String> values) {
    public Tags {
        values = List.copyOf(values);       // immutable snapshot on the way in
    }
}
```

---

## Records Restrictions and Constraints

Records trade flexibility for guarantees. **Since JDK 16**, a record:

- Is **implicitly `final`** — it cannot be subclassed and you cannot mark it `abstract`.
- **Cannot `extend` any class** (it already extends `java.lang.Record` implicitly, and Java has no
  multiple inheritance). It **can** `implement` any number of interfaces.
- **Cannot declare additional instance (non-static) fields.** All instance state must come from the
  header/component list. It *can* declare `static` fields and `static`/instance methods and nested
  types.
- Cannot declare instance initializer blocks (`{ ... }`). Static initializers are allowed.
- Its component fields are `private final`; you cannot make them non-final or add setters.
- Cannot be `native` methods; record cannot declare `native` instance methods.

```java
record Bad(int x) {
    int y;                      // COMPILE ERROR: instance field not allowed
    static int count;           // OK: static field allowed
    { y = 1; }                  // COMPILE ERROR: instance initializer not allowed
}
```

**Local records (since JDK 16).** You can declare a record inside a method body — handy for modeling
an intermediate tuple inside a stream pipeline. Local records (like local classes) are implicitly
static and cannot capture enclosing instance state the way inner classes do; they are `static`
nested-like in behavior.

**Nested records** declared inside another class are implicitly `static`.

---

## Sealed Classes and Interfaces

**Beginner.** A *sealed* class or interface (declared with the `sealed` modifier) explicitly lists,
via a `permits` clause, exactly which classes or interfaces are allowed to extend/implement it. This
is a standard feature **since JDK 17** (preview in 15 and 16, JEPs 360/397, finalized by JEP 409).

```java
public sealed interface Shape permits Circle, Rectangle, Triangle { }
```

**The problem it solves.** Before sealing, any hierarchy meant to be closed (e.g. a fixed set of
message types) was either truly open — anyone could add a subtype and break your exhaustive `switch`
— or locked down with awkward tricks (package-private constructors, non-public classes). Sealing lets
you say "these three and *only* these three," and the compiler enforces it.

**The three permitted-subtype modifiers.** Every direct subtype named in `permits` **must** itself
choose one of:

- `final` — no further subclasses (typical for leaf records/classes).
- `sealed` — continues the closed hierarchy with its own `permits` list.
- `non-sealed` — deliberately re-opens that branch so arbitrary subclasses are allowed again.

```java
public sealed interface Shape permits Circle, Rectangle, Base {}
public record Circle(double r) implements Shape {}          // records are implicitly final
public final class Rectangle implements Shape { /*...*/ }
public non-sealed class Base implements Shape { }           // re-opened: anyone may extend Base
```

**Intermediate rules:**

- Every class listed in `permits` must be a **direct** subtype and must actually `extends`/`implements`
  the sealed type — the relationship is declared on both sides.
- Permitted subtypes must be **accessible** to the sealed type and (since JDK 17) must live in the
  **same module**; if in the unnamed module, they must be in the **same package**.
- The `permits` clause may be **omitted** if all permitted subtypes are declared in the **same source
  file** (same compilation unit) as the sealed type — the compiler infers them.

**Advanced.** Sealing is enforced by both the compiler *and* the JVM: the class file carries a
`PermittedSubclasses` attribute, so reflection (`Class::isSealed`, `Class::getPermittedSubclasses`,
since JDK 17) and the runtime reject unlisted subtypes even via bytecode manipulation. An `abstract`
class can be `sealed`; an `enum` or `record` cannot be `sealed` (they are implicitly final already),
but they *can* appear in a `permits` list as leaves.

---

## Sealed Types and Exhaustiveness

**Beginner.** Because a sealed type has a compiler-known, complete set of subtypes, a `switch` over it
can be checked for **exhaustiveness**: if you cover every permitted subtype, no `default` branch is
required, and if you miss one, it is a **compile error** (not a silent runtime fall-through).

**Version accuracy is essential here.** Exhaustive **pattern-matching `switch`** over sealed types was
a **preview** feature from JDK 17 through JDK 20 and was **finalized in JDK 21 (JEP 441)**. So on a
strict JDK 17 build you get sealed classes as a final feature, but the *type-pattern switch* that
exploits them is still preview. Interviewers test this distinction.

```java
// Final in JDK 21 (JEP 441): pattern switch, exhaustive over a sealed type
static double area(Shape s) {
    return switch (s) {                       // no default needed
        case Circle c    -> Math.PI * c.r() * c.r();
        case Rectangle r -> r.w() * r.h();
        case Triangle t  -> 0.5 * t.base() * t.height();
    };
}
```

**Intermediate — the exhaustiveness "remainder."** Even an exhaustive switch may need to handle the
possibility of `null` or of a subtype that becomes available at run time but was not at compile time
(separate compilation). The compiler inserts an implicit `default` that throws
`MatchException` (**since JDK 21**) if none of the labels match, so the switch is total without you
writing `default`.

**Advanced — record patterns (JDK 21, JEP 440).** Sealed hierarchies of records let you *deconstruct*
in the same switch, producing exhaustive ADT-style code:

```java
sealed interface Expr permits Num, Add {}
record Num(double val) implements Expr {}
record Add(Expr left, Expr right) implements Expr {}

static double eval(Expr e) {
    return switch (e) {
        case Num(double v)            -> v;
        case Add(Expr l, Expr r)      -> eval(l) + eval(r);   // nested deconstruction
    };
}
```

`null` handling: a plain `switch` still throws `NullPointerException` on a `null` selector unless you
add a `case null` label (allowed in pattern switches since JDK 21).

---

## Records and Sealed as Algebraic Data Types

**Beginner.** Combining a **sealed interface** (the "sum" — one of a fixed set of alternatives) with
**records** (each a "product" — a bundle of fields) reproduces what functional languages call
*algebraic data types*. `Shape = Circle | Rectangle | Triangle` is a sum of products.

**Why it matters.** ADTs plus exhaustive pattern matching give you the *make illegal states
unrepresentable* discipline: the type system enumerates every case, and the compiler forces you to
handle each one. Adding a new variant to the sealed interface immediately produces compile errors at
every non-exhaustive switch — a guided refactor instead of a runtime surprise.

**Old way vs new way.** The classic OO alternative is the **Visitor pattern**: an abstract `accept`
method and a visitor interface with one `visitX` per subtype. Visitor achieves exhaustiveness but is
verbose, spreads logic across classes, and is awkward to extend. Sealed + records + pattern switch is
the modern, concise replacement and keeps related logic co-located.

```java
// NEW (JDK 21): concise, exhaustive, logic co-located
sealed interface Json permits JNull, JBool, JNum, JStr, JArr, JObj {}
record JNull() implements Json {}
record JBool(boolean b) implements Json {}
record JNum(double n) implements Json {}
// ... exhaustive switch renders any Json without a visitor
```

**Advanced trade-off.** ADTs favor adding *operations* over a fixed set of types (add a new function
= one new switch). Classic polymorphism/Visitor favors adding *types* over a fixed set of operations.
This is the "expression problem." Choose sealed+records when the set of variants is stable and you add
new behaviors often.

---

## Records vs Lombok vs Classic POJO

**Beginner.** All three model data-holding classes, but with different mechanisms and guarantees.

| Aspect | Record (JDK 16+) | Lombok `@Data`/`@Value` | Hand-written POJO |
|---|---|---|---|
| Boilerplate | Zero (language) | Zero (annotation processor) | Manual, verbose |
| Mutability | Immutable (final fields) | `@Value` immutable; `@Data` mutable | Your choice |
| Accessor naming | `x()` (no `get`) | `getX()` (bean style) | Your choice |
| Inheritance | Cannot extend a class | Can extend classes | Full freedom |
| Extra instance fields | Not allowed | Allowed | Allowed |
| Tooling / build | Pure `javac`, no deps | Requires Lombok + IDE plugin, edits AST | None |
| `equals`/`hashCode` | Guaranteed by compiler over all components | Generated per annotation config | Manual (drift risk) |

**Intermediate.** Lombok is a compile-time annotation processor that *rewrites the AST* to inject
methods; it is not part of the JDK and needs an IDE plugin to avoid red squiggles. Records are a
first-class language feature — no dependency, no plugin, understood by every tool that understands the
JDK. Records also carry semantic intent ("this is a transparent data carrier") that Lombok annotations
only approximate.

**When a record is NOT the right tool:**

- You need mutability (JPA `@Entity` typically needs a no-arg constructor and setters — records fit
  poorly; use a class or Lombok `@Data`).
- You must extend a base class.
- You need lazy-initialized or derived fields stored as extra instance state.
- You need bean-style `getX()` accessors for a framework that hard-requires them (many now support
  records, but not all).

**Advanced.** Records give *shallow* immutability only; Lombok `@Value` is similar. Neither deep-freezes
nested mutable objects. For true value semantics with mutable members, defensive copying is still your
responsibility in both.

---

## Serialization of Records

**Beginner.** Records can implement `java.io.Serializable` and be serialized/deserialized like other
objects, **since JDK 16**.

**Intermediate — why record serialization is safer.** Records are serialized and deserialized based
**solely on their component state**, and deserialization goes **through the canonical constructor**.
This is the crucial difference from ordinary serialization: normal Serializable classes are rebuilt by
allocating the object and setting fields *without invoking any constructor*, which lets attackers
craft malicious byte streams that bypass invariants. Because record deserialization runs the canonical
constructor, **your validation in the compact constructor executes on the way in**, restoring
invariants automatically.

**Advanced consequences:**

- For records, the `serialVersionUID` defaults to `0L` unless you declare one, and the stream form is
  derived from the component list.
- Customization hooks like `writeObject`, `readObject`, `readObjectNoData`, and `readResolve`/
  `writeReplace`-via-`serialPersistentFields` are **ignored** for the *field* substitution semantics —
  record deserialization cannot be diverted to skip the canonical constructor. (`writeReplace`/
  `readResolve` for whole-object substitution still work.)
- This makes records a strong tool for the *serialization proxy pattern* and generally hardens
  deserialization against the classic "invariant bypass" attacks.

```java
public record Money(long cents, String currency) implements Serializable {
    public Money {
        if (cents < 0) throw new IllegalArgumentException("negative");
        Objects.requireNonNull(currency);
    }   // this validation RE-RUNS on deserialize — invariants preserved
}
```

---

## Common interview follow-up questions

- Which Java version *finalized* records? Sealed classes? (16 and 17 respectively.) Which finalized
  pattern-matching `switch` and record patterns? (Both JDK 21.)
- What is the difference between a compact constructor and an explicit canonical constructor? Can you
  have both?
- Why can't a record declare extra instance fields, and where must instance state come from?
- How does record `equals` treat `Double.NaN` and `-0.0` versus the `==` operator?
- What are the three modifiers a permitted subtype of a sealed type must choose, and what does each
  mean?
- When can you omit the `permits` clause?
- How does sealing enable exhaustive `switch` without a `default`, and what exception backs the
  implicit default at run time (`MatchException`, JDK 21)?
- Why is deserializing a record safer than deserializing an ordinary Serializable class?
- Records vs Lombok `@Value` — when would you still reach for Lombok or a plain class?
- How do sealed interfaces + records model algebraic data types, and how does that compare to the
  Visitor pattern (the expression problem)?

## References

- JEP 395: Records (finalized, JDK 16) — https://openjdk.org/jeps/395
- JEP 359 / JEP 384: Records (preview, JDK 14 / 15) — https://openjdk.org/jeps/359
- JEP 409: Sealed Classes (finalized, JDK 17) — https://openjdk.org/jeps/409
- JEP 360 / JEP 397: Sealed Classes (preview, JDK 15 / 16) — https://openjdk.org/jeps/360
- JEP 394: Pattern Matching for instanceof (finalized, JDK 16) — https://openjdk.org/jeps/394
- JEP 441: Pattern Matching for switch (finalized, JDK 21) — https://openjdk.org/jeps/441
- JEP 440: Record Patterns (finalized, JDK 21) — https://openjdk.org/jeps/440
- The Java Language Specification, Java SE 17 — §8.10 Record Classes, §8.1.1.2 sealed, non-sealed
- "Serialization of Records" — Java Object Serialization Specification / JEP 395 serialization section
- Oracle Java Records and Sealed Classes documentation — https://docs.oracle.com/en/java/javase/17/
