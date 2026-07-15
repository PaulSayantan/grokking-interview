# OOP Principles and Polymorphism

Object-Oriented Programming (OOP) organizes software around **objects** — bundles of state (fields) and behavior (methods) — rather than around functions and logic alone. Java is a class-based OOP language: every method (except top-level `static` utility code) lives inside a class or interface, and behavior is selected at runtime through **polymorphism**.

This topic covers the four classic pillars (encapsulation, inheritance, polymorphism, abstraction), the exact rules for overloading vs overriding, how the JVM performs dynamic dispatch, abstract classes vs interfaces (including default/static/private interface methods), composition over inheritance, a SOLID introduction, covariant return types, and access modifiers.

---

## Encapsulation

**Beginner.** Encapsulation is bundling data (fields) and the methods that operate on that data into a single unit (a class), and **restricting direct access** to the internal state. The idiomatic Java form: make fields `private` and expose controlled `public` getters/setters or richer behavior methods.

**Why it matters.** It lets a class enforce **invariants** (rules that must always hold) and change its internal representation without breaking callers. A `BankAccount` can guarantee `balance >= 0` only if nobody can reach in and set `balance = -100` directly.

```java
public class BankAccount {
    private long balanceCents;                 // hidden representation

    public void withdraw(long cents) {
        if (cents <= 0) throw new IllegalArgumentException("amount must be positive");
        if (cents > balanceCents) throw new IllegalStateException("insufficient funds");
        balanceCents -= cents;                 // invariant preserved
    }
    public long getBalanceCents() { return balanceCents; }  // read-only exposure
}
```

**Intermediate.** Encapsulation is about **information hiding**, not merely "add getters/setters." A getter/setter for every field re-exposes the representation and defeats the purpose. Prefer exposing *intent* (`withdraw`, `deposit`) over raw state. Return **defensive copies** of mutable fields (arrays, `Date`, collections) or return unmodifiable views (`List.copyOf`, `Collections.unmodifiableList`) so callers cannot mutate internal state through an alias.

**Advanced / gotchas.**
- **`final` does not mean immutable.** A `final` field cannot be reassigned, but if it references a mutable object (e.g. an `ArrayList`), the contents can still change. True immutability requires final fields, no setters, defensive copies in and out, and no leaking of internal references.
- **`records` (final in JDK 16)** give you shallowly-immutable, transparent carriers but do not deep-copy mutable components unless you write a compact constructor to do so.
- Module system (JPMS, Java 9+) adds *encapsulation of whole packages*: only `exported` packages are accessible to other modules; strong encapsulation blocks reflective access to non-open packages by default.

---

## Inheritance

**Beginner.** Inheritance lets a class (subclass/child) acquire the fields and methods of another class (superclass/parent) via `extends`, modeling an **is-a** relationship. A `Car` **is a** `Vehicle`. Java supports **single class inheritance** (one direct superclass) but **multiple interface inheritance**.

```java
class Vehicle { void start() { System.out.println("engine on"); } }
class Car extends Vehicle { void honk() { System.out.println("beep"); } }
```

**Intermediate — construction and `super`.**
- Every constructor implicitly calls `super()` (the no-arg superclass constructor) as its first statement unless you explicitly call `super(args)` or `this(args)`. If the superclass has no accessible no-arg constructor and you don't call `super(args)`, it's a **compile error**.
- Fields are **not polymorphic**: they are resolved by the *static* (declared) type, not the runtime type. Only instance methods are dynamically dispatched (see Dynamic Dispatch).
- `static` methods are **hidden**, not overridden (see Overloading versus overriding).

**Advanced / gotchas.**
- **Fragile base class problem:** changing a superclass can silently break subclasses that depended on its internal call patterns. This is a core argument for composition over inheritance.
- **Calling overridable methods from a constructor is dangerous.** During superclass construction the subclass's fields are still at their default values (`0`/`null`), yet an overridden method runs with the subclass body — observing uninitialized state.

```java
class A { A() { init(); } void init() { System.out.println("A.init"); } }
class B extends A {
    private int x = 10;
    @Override void init() { System.out.println("B.init x=" + x); } // prints x=0, not 10
}
// new B() prints "B.init x=0" — B's field initializer runs AFTER super() returns.
```

---

## Polymorphism

**Beginner.** Polymorphism ("many forms") means one interface/reference type can refer to objects of many concrete types, and the *actual* method invoked is chosen based on the runtime object. The two broad kinds in Java:

| Kind | Mechanism | Binding time |
|------|-----------|--------------|
| **Compile-time (ad hoc)** | Method **overloading** (same name, different parameter lists) | Static — resolved by compiler |
| **Runtime (subtype)** | Method **overriding** via inheritance/interfaces | Dynamic — resolved by JVM |

**Intermediate.** The canonical example: a `List<Shape>` where each element is a `Circle`, `Square`, etc.; calling `shape.area()` dispatches to the concrete class's implementation. This enables the **Open/Closed** principle — add new `Shape` subtypes without touching the loop that draws them.

**Advanced.** Java also has **parametric polymorphism** via generics (`List<T>`), but generics are **erased** at compile time — there is one `List` class at runtime, and type parameters are not available via `getClass()`. Subtype polymorphism (dynamic dispatch on the receiver) is the runtime mechanism; overloading and generics are compile-time.

---

## Abstraction

**Beginner.** Abstraction means exposing **what** an object does while hiding **how** it does it. In Java you express abstraction with `interface`s and `abstract class`es — they declare capabilities (method signatures) that concrete classes must implement.

```java
interface PaymentGateway { PaymentResult charge(Money amount); } // WHAT, not HOW
```

**Intermediate.** Abstraction and encapsulation are related but distinct: encapsulation hides *data/implementation details of a single object*; abstraction hides *complexity behind a simplified model/contract*. Programming to an abstraction (`PaymentGateway ref = new StripeGateway();`) decouples callers from implementations.

**Advanced.** Over-abstraction ("speculative generality") is a real cost: an interface with one implementation, created "just in case," adds indirection without payoff. Introduce abstractions when there is a demonstrated need for a seam (testing, multiple implementations, plugin points).

---

## Overloading versus overriding

**Beginner.**
- **Overloading**: multiple methods in the same class (or inherited) with the **same name but different parameter lists** (number, types, or order). Return type and thrown exceptions are *not* part of the signature and cannot alone distinguish overloads. Resolved at **compile time** based on the *static* types of the arguments.
- **Overriding**: a subclass provides a new implementation for an **inherited instance method with the same signature**. Resolved at **runtime** based on the object's actual class.

```java
class Printer {
    void print(int x)    { System.out.println("int"); }      // overload
    void print(long x)   { System.out.println("long"); }     // overload
    void print(Object x) { System.out.println("Object"); }   // overload
}
// print(5)  -> "int"   (exact match preferred over widening/boxing)
// print(5L) -> "long"
```

**Overriding rules (must satisfy all):**
1. Same name and **same parameter list** (a different parameter list is overloading, not overriding).
2. Return type must be the same or a **covariant** subtype (see Covariant return types).
3. Access modifier must be the **same or more permissive** (can widen `protected` → `public`, never narrow).
4. May throw **fewer or narrower** checked exceptions — never broader/new checked exceptions. Unchecked exceptions are unrestricted.
5. `static` methods are **hidden**, not overridden. `final` and `private` methods cannot be overridden. `private` methods are not inherited, so a same-signature method in a subclass is a brand-new method.

**Overload resolution phases (compile time).** The compiler picks the most specific applicable method in three phases, stopping at the first phase that yields a match:
1. Without boxing/unboxing and without varargs.
2. With boxing/unboxing but without varargs.
3. With varargs.

This is why `print(5)` chooses `int` over `long` (both applicable in phase 1, `int` is more specific) and why an exact `Integer` overload beats `int` only when the argument is already `Integer`.

**Gotcha — null argument:**
```java
void f(String s) {}
void f(Object o) {}
f(null); // resolves to f(String) — String is more specific than Object
```
If two equally-specific reference overloads both match `null` (e.g. `f(String)` and `f(Integer)`), it is an **ambiguous** compile error.

**Gotcha — `@Override` on `equals`:** `public boolean equals(MyType o)` does **not** override `Object.equals(Object)` — it overloads it. The `@Override` annotation catches this mistake at compile time; always use it.

---

## Dynamic dispatch

**Beginner.** Dynamic dispatch (a.k.a. dynamic/late binding) is the runtime mechanism that decides which overridden method body to run based on the **actual runtime class** of the receiver object, regardless of the reference's declared type.

```java
Vehicle v = new Car();
v.start();  // runs Car.start() if Car overrides start(), decided at runtime
```

**Intermediate — how it works.** The JVM invokes instance methods with the `invokevirtual` (class methods) or `invokeinterface` (interface methods) bytecode. Each class has a **method table (vtable)**; `invokevirtual` looks up the method slot on the object's actual class. Contrast:
- `invokestatic` — static methods, no receiver, statically bound.
- `invokespecial` — constructors, `private` methods, and `super.method()` calls; statically bound (non-virtual).
- `invokedynamic` — bootstrap-based; used for lambdas and string concatenation, not ordinary dispatch.

Because `private`, `static`, and `final` methods are not virtual, calls to them are bound statically and can be inlined more aggressively.

**Advanced — JIT devirtualization.** Even virtual calls are often optimized. If the JIT observes (via class hierarchy analysis) that only one implementation is loaded (**monomorphic** call site), it performs **monomorphic inlining** guarded by a class check. **Bimorphic** (2 targets) is still cheaply inlinable; **megamorphic** call sites (many targets) fall back to a vtable lookup and are hard to inline. This is why "make it `final`" rarely helps modern performance — the JIT already devirtualizes when it can.

**Gotcha — fields and statics are NOT dynamically dispatched:**
```java
class A { int x = 1; static String who() { return "A"; } }
class B extends A { int x = 2; static String who() { return "B"; } }
A a = new B();
System.out.println(a.x);        // 1  — field access uses static type A
System.out.println(a.who());    // "A" — static method hidden, uses static type A
```

---

## Abstract class versus interface

**Beginner.** Both let you program to an abstraction, but:

| Aspect | `abstract class` | `interface` |
|--------|------------------|-------------|
| Instantiable? | No | No |
| Multiple inheritance | Single (`extends` one class) | Many (`implements` several) |
| State (instance fields) | Yes, any kind | Only `public static final` constants |
| Constructors | Yes | No |
| Method bodies | Concrete + abstract methods | `default`, `static`, `private` methods (Java 8/9); rest abstract |
| Access modifiers on methods | Any | `public` by default; may be `private` (Java 9+) |
| "is-a" vs "can-do" | Strong is-a, shared base | Capability/contract; can add to unrelated types |

**Intermediate — interface method evolution:**
- **Java 8:** `default` methods (instance methods with a body — lets you add methods to an interface without breaking implementers) and `static` methods (utility methods on the interface itself, not inherited by implementers).
- **Java 9:** `private` and `private static` interface methods — for sharing code between `default`/`static` methods without exposing it in the API.

```java
interface Greeter {
    String name();
    default String greet() { return prefix() + name(); }   // Java 8
    static Greeter of(String n) { return () -> n; }         // Java 8 factory
    private String prefix() { return "Hello, "; }           // Java 9 helper
}
```

**Advanced — the diamond and `default` conflicts.** If a class inherits two `default` methods with the same signature from two interfaces, it **must override** the method to resolve the conflict (compile error otherwise). Inside the override you can disambiguate with `Interface.super.method()`. Rule of precedence: **classes win over interfaces**, and **more specific (sub)interfaces win over less specific** ones.

```java
interface X { default String hi() { return "X"; } }
interface Y { default String hi() { return "Y"; } }
class Z implements X, Y {
    @Override public String hi() { return X.super.hi() + Y.super.hi(); } // required
}
```

**When to choose which.** Use an **interface** for a capability that may apply to unrelated types (`Comparable`, `AutoCloseable`, `Runnable`), for multiple inheritance of type, and as the default for public APIs. Use an **abstract class** when you need shared *mutable state*, constructors, or non-public members, and all subtypes are genuinely a kind of the base. Since Java 8, "interfaces can't have behavior" is no longer a reason to prefer abstract classes.

---

## Composition over inheritance

**Beginner.** Instead of inheriting from a class to reuse its code, **hold an instance of it as a field** and delegate. "Favor composition over inheritance" (Gang of Four; Effective Java Item 18) because inheritance is a strong, compile-time, white-box coupling, while composition is looser and more flexible.

```java
// Inheritance (fragile): behavior tied to HashSet internals
class CountingSet<E> extends HashSet<E> { /* addAll calls add — double counting bug */ }

// Composition (robust): wrap and delegate
class CountingSet<E> {
    private final Set<E> delegate;
    private int addCount;
    CountingSet(Set<E> delegate) { this.delegate = delegate; }
    boolean add(E e) { addCount++; return delegate.add(e); }
}
```

**Intermediate — why the classic bug happens.** `HashSet.addAll` internally calls `add`. If a subclass overrides both `add` and `addAll` to increment a counter, `addAll` counts once and then delegates to `add` which counts again — the count is doubled. This is the **fragile base class / self-use** problem: subclasses depend on undocumented internal call patterns. Effective Java Item 18 uses exactly this example.

**Advanced — trade-offs.**
- Composition + delegation is more verbose (you forward methods), but the **decorator pattern** and interface-based delegation make it manageable.
- Inheritance is appropriate only for a genuine is-a relationship **and** when the superclass was **designed and documented for extension** (Effective Java Item 19: "design and document for inheritance or else prohibit it" — e.g. make the class `final`).
- Composition gives you **run-time** flexibility (swap the delegate, wrap multiple times) that `extends` (fixed at compile time) cannot.

---

## SOLID principles

**Beginner.** SOLID is five design guidelines (Robert C. Martin) for maintainable OO code:

| Letter | Principle | One-liner |
|--------|-----------|-----------|
| **S** | Single Responsibility | A class should have one reason to change. |
| **O** | Open/Closed | Open for extension, closed for modification. |
| **L** | Liskov Substitution | Subtypes must be usable anywhere their base type is expected. |
| **I** | Interface Segregation | Many small, client-specific interfaces beat one fat interface. |
| **D** | Dependency Inversion | Depend on abstractions, not concretions. |

**Intermediate — with Java flavor.**
- **SRP:** split a `User` class that does persistence + validation + email into focused collaborators.
- **OCP:** add behavior via new subtypes/strategies (polymorphism) rather than editing a growing `switch`.
- **LSP:** the classic violation is `Square extends Rectangle` — overriding `setWidth` to also set height breaks code that assumes width/height are independent. Overriding methods must honor the base contract (no strengthened preconditions, no weakened postconditions). Java's compiler enforces the *syntactic* subtyping rules (return covariance, exception narrowing); LSP is the *behavioral* extension of that.
- **ISP:** prefer `Runnable`/`Callable`-sized interfaces over one giant interface; Java 8 functional interfaces embody this.
- **DIP:** inject a `Repository` interface, not a concrete `JdbcRepository` — enables testing with fakes and swapping implementations. This is what DI frameworks (Spring, Guice) automate.

**Advanced.** SOLID is guidance, not law; over-applying it (e.g. one interface per class everywhere) produces "abstraction astronaut" code. LSP is the deepest: it constrains not just signatures but observable behavior, exceptions, invariants, and history. Covariant returns and exception-narrowing rules are the language-level guardrails that keep overrides substitutable.

---

## Covariant return types

**Beginner.** Since **Java 5 (2004)**, an overriding method may declare a return type that is a **subtype** of the overridden method's return type. Before Java 5, the return type had to be identical.

```java
class Animal { Animal reproduce() { return new Animal(); } }
class Cat extends Animal {
    @Override Cat reproduce() { return new Cat(); }   // covariant: Cat <: Animal — legal since Java 5
}
```

**Intermediate — why it's useful.** Callers holding a `Cat` reference get a `Cat` back without casting; it enables fluent APIs and self-typing (e.g. `clone()` returning the concrete type, builder patterns). `Object.clone()` returns `Object`, but you can override it to return your own type.

**Advanced / gotchas.**
- Covariance applies to **return types only**. Java is **invariant on parameter types**: changing a parameter type (even to a subtype) produces an **overload**, not an override — and the `@Override` annotation will fail to compile, catching the mistake.
- Return-type covariance is implemented via compiler-generated **bridge methods** (synthetic methods that keep the erased/original signature for binary compatibility, especially with generics). You may see these in stack traces or reflection.
- Primitives have no subtype relationship — you cannot covariantly change `long` to `int`.

---

## Access modifiers

**Beginner.** Java has four access levels controlling member visibility:

| Modifier | Same class | Same package | Subclass (diff package) | Everywhere |
|----------|:---------:|:------------:|:-----------------------:|:----------:|
| `private` | Yes | No | No | No |
| *(package-private / default, no keyword)* | Yes | Yes | No | No |
| `protected` | Yes | Yes | Yes | No |
| `public` | Yes | Yes | Yes | Yes |

**Intermediate — subtleties.**
- **`protected`** grants access to subclasses in other packages **and** to everything in the same package. But a subclass in another package can only access a `protected` member **through a reference of its own type (or a subtype)**, not through the base type — a JLS rule that surprises many.
- **Top-level classes/interfaces** may only be `public` or package-private (not `private`/`protected`). Nested types may use all four.
- There is **no `private` keyword combination that changes for interfaces' abstract methods** — interface members are implicitly `public` (Java 9 added the ability to write `private` helper methods only).

**Advanced — JPMS (Java 9+).** The module system adds a layer *above* access modifiers: even a `public` type is inaccessible from another module unless its package is `exported` (or `opens` for reflection). "Public" no longer means "accessible to all"; it means "accessible to all who can read the module and to whom the package is exported." Strong encapsulation (default since Java 16, JEP 396) blocks illegal reflective access to JDK internals.

---

## Common interview follow-up questions

1. What is the difference between overloading and overriding, and at what time is each resolved? Give the exact overriding rules (return type, access, exceptions).
2. Why does calling an overridable method from a constructor print unexpected (default) values? Walk through the initialization order.
3. Explain dynamic dispatch. Which bytecodes implement it (`invokevirtual`/`invokeinterface`) and which are statically bound (`invokespecial`/`invokestatic`)?
4. Are fields polymorphic in Java? What does `a.x` print when `A a = new B()` and both declare `x`?
5. When would you choose an abstract class over an interface after Java 8's default methods?
6. How does Java resolve a diamond conflict between two `default` methods? Show `Interface.super.method()`.
7. Reproduce the `HashSet` counting bug and explain why composition fixes it.
8. What is the Liskov Substitution Principle? Why is `Square extends Rectangle` a violation?
9. What are covariant return types, when were they added, and how are bridge methods involved?
10. Explain `protected` access across packages — the "must access through subclass reference" rule.
11. Which Java version added `default`/`static` interface methods, and which added `private` interface methods?
12. Why doesn't `public boolean equals(MyType o)` override `Object.equals`? How does `@Override` help?
13. How does the module system change the meaning of `public`?
14. What is the difference between abstraction and encapsulation?
15. How does the JIT devirtualize virtual calls (monomorphic/bimorphic/megamorphic call sites)?

## References

- JLS (Java Language Specification), Chapter 8 (Classes) §8.4.8 Inheritance/Overriding/Hiding, §8.4.9 Overloading; Chapter 15 §15.12 Method Invocation Expressions (overload resolution phases). https://docs.oracle.com/javase/specs/
- JLS §8.4.5 Method Return Type — covariant return types (since Java 5 / J2SE 5.0).
- JVMS (Java Virtual Machine Specification) §6.5 — `invokevirtual`, `invokeinterface`, `invokespecial`, `invokestatic`, `invokedynamic`.
- JEP 126 / JLS §9.4 — `default` and `static` interface methods (Java 8, 2014).
- JEP 213 (Milling Project Coin, Java 9) — `private` and `private static` interface methods.
- JEP 395 — Records (final in JDK 16). JEP 409 — Sealed Classes (final in JDK 17).
- JEP 261 — Module System (JPMS, Java 9). JEP 396 — Strongly Encapsulate JDK Internals by Default (JDK 16).
- Joshua Bloch, *Effective Java* (3rd ed.): Item 15 (minimize accessibility), Item 17 (minimize mutability), Item 18 (favor composition over inheritance), Item 19 (design for inheritance or prohibit it), Item 20 (prefer interfaces to abstract classes), Item 40 (`@Override`).
- Robert C. Martin, *Agile Software Development, Principles, Patterns, and Practices* — SOLID.
- Gang of Four, *Design Patterns* — "favor object composition over class inheritance."
