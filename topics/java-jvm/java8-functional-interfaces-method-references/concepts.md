# Java 8 Functional Interfaces and Method References

Java 8 (released March 2014) introduced lambda expressions, and the machinery that
makes them work: **functional interfaces**, the `java.util.function` package,
**method references**, and **default/static methods** on interfaces. This topic covers
the type-system rules (SAM, target typing, inference) and the everyday building blocks
you compose streams and callbacks from.

Everything described here is a **Java 8 feature** unless explicitly tagged with a later
version. None of the core concepts on this page were "finalized later" — they shipped
final in Java 8. Later versions only added ergonomics (e.g., `var` in lambda parameters
in Java 11, JEP 323).

---

## FunctionalInterface and the SAM concept

A **functional interface** is an interface with exactly **one abstract method** (the
*Single Abstract Method*, or **SAM**). Because there is only one abstract method, the
compiler can treat a lambda or method reference as an instance of that interface — the
lambda body *is* the implementation of that single method.

```java
@FunctionalInterface
interface Greeter {
    String greet(String name);          // the single abstract method (SAM)
}

Greeter g = name -> "Hello, " + name;   // lambda implements greet()
System.out.println(g.greet("Ada"));     // Hello, Ada
```

**Beginner — why it matters.** Before Java 8, you passed behavior around using anonymous
inner classes (`new Runnable() { public void run() { ... } }`). Lambdas remove that
boilerplate, but they need a *target type* — a functional interface — to know which
method they implement.

**`@FunctionalInterface` (Java 8).** This annotation is **optional but recommended**. It
does not *make* an interface functional; it asks the compiler to *verify* that the
interface has exactly one abstract method and to emit a compile error otherwise. It also
documents intent for maintainers. An interface can be used as a lambda target without the
annotation as long as it structurally qualifies.

**What counts as "one abstract method":**

- `default` methods do **not** count (they have a body).
- `static` methods do **not** count.
- `private` methods (Java 9+) do **not** count.
- **`public` methods inherited from `java.lang.Object`** (like `equals`, `hashCode`,
  `toString`) do **not** count against the SAM limit. This is why `Comparator<T>` is a
  valid functional interface even though it declares `int compare(T,T)` **and**
  `boolean equals(Object)` — `equals` is redeclared from `Object`, so it is exempt.

```java
@FunctionalInterface
interface Comparator2<T> {
    int compare(T a, T b);      // the SAM
    boolean equals(Object o);   // OK: an Object method, does not count
}
```

**Gotcha — generic methods.** An interface whose only abstract method is *generic*
(declares its own type parameters, e.g. `<T> T pick(T a, T b)`) is **not** a functional
interface for lambda purposes — a lambda cannot be generic, so such an interface cannot be
targeted by a lambda (though a method reference sometimes can, subject to inference).

---

## The java.util.function catalog

Java 8 added the `java.util.function` package with ~43 general-purpose functional
interfaces so you rarely need to declare your own. The **six core shapes**:

| Interface        | Abstract method        | Takes            | Returns | Mnemonic |
|------------------|------------------------|------------------|---------|----------|
| `Supplier<T>`    | `T get()`              | nothing          | `T`     | produces a value |
| `Consumer<T>`    | `void accept(T)`       | `T`              | nothing | consumes a value |
| `Function<T,R>`  | `R apply(T)`           | `T`              | `R`     | transforms T→R |
| `Predicate<T>`   | `boolean test(T)`      | `T`              | boolean | tests a condition |
| `UnaryOperator<T>` | `T apply(T)`         | `T`              | `T`     | Function where T=R |
| `BinaryOperator<T>`| `T apply(T,T)`       | `T,T`            | `T`     | BiFunction where all = T |

**Two-argument (`Bi`) variants:** `BiFunction<T,U,R>` (`R apply(T,U)`),
`BiConsumer<T,U>` (`void accept(T,U)`), `BiPredicate<T,U>` (`boolean test(T,U)`).

```java
Supplier<List<String>> newList = ArrayList::new;
Consumer<String> printer      = System.out::println;
Function<String,Integer> len  = String::length;
Predicate<String> nonEmpty    = s -> !s.isEmpty();
UnaryOperator<String> upper   = String::toUpperCase;
BinaryOperator<Integer> add   = Integer::sum;
BiFunction<String,String,Boolean> eq = String::equals;
```

**Note on inheritance.** `UnaryOperator<T> extends Function<T,T>` and
`BinaryOperator<T> extends BiFunction<T,T,T>`. They are subtypes that fix the type
parameters, giving cleaner signatures (e.g. `List.replaceAll` takes a `UnaryOperator<E>`,
`Stream.reduce` uses a `BinaryOperator<T>`).

### Primitive specializations

To avoid autoboxing overhead in hot code (e.g. streams over millions of ints), the package
provides primitive variants for `int`, `long`, and `double`:

| Category                | Examples |
|-------------------------|----------|
| Suppliers               | `IntSupplier`, `LongSupplier`, `DoubleSupplier`, `BooleanSupplier` |
| Consumers               | `IntConsumer`, `LongConsumer`, `DoubleConsumer` |
| Predicates              | `IntPredicate`, `LongPredicate`, `DoublePredicate` |
| Operators               | `IntUnaryOperator`, `IntBinaryOperator` (and long/double) |
| primitive→primitive fn  | `IntToLongFunction`, `IntToDoubleFunction`, `LongToIntFunction`, ... |
| primitive→object fn     | `IntFunction<R>`, `LongFunction<R>`, `DoubleFunction<R>` |
| object→primitive fn     | `ToIntFunction<T>`, `ToLongFunction<T>`, `ToDoubleFunction<T>` |
| two-arg object→primitive| `ToIntBiFunction<T,U>`, `ToLongBiFunction<T,U>`, `ToDoubleBiFunction<T,U>` |
| obj+primitive consumer  | `ObjIntConsumer<T>`, `ObjLongConsumer<T>`, `ObjDoubleConsumer<T>` |

```java
IntUnaryOperator square = x -> x * x;          // int -> int, no boxing
ToIntFunction<String> length = String::length; // String -> int
IntStream.rangeClosed(1, 5).map(square).sum(); // 55
```

**Gotcha — abstract method name changes with the primitive.** `IntSupplier` does **not**
declare `get()`; it declares `int getAsInt()`. Likewise `ToIntFunction` declares
`applyAsInt`, `IntPredicate` declares `test(int)`. Only the *generic* interfaces use
`get/apply/accept/test`. This matters when you implement them explicitly.

---

## Composing functions

Most core interfaces ship **default methods** that build new functions from existing ones —
this is the point of default methods: add behavior to an interface without breaking
implementers.

**`Function` composition — `andThen` vs `compose`:**

- `f.andThen(g)` runs `f` **first**, then feeds the result to `g`: `g(f(x))`.
- `f.compose(g)` runs `g` **first**: `f(g(x))`.

```java
Function<Integer,Integer> times2 = x -> x * 2;
Function<Integer,Integer> plus3  = x -> x + 3;

times2.andThen(plus3).apply(5); // (5*2)+3 = 13
times2.compose(plus3).apply(5); // (5+3)*2 = 16
```

`Function.identity()` (a **static** method) returns `t -> t`; handy in
`Collectors.toMap(keyFn, Function.identity())`.

**`Consumer.andThen`** chains side effects in order (there is no `compose` on Consumer):

```java
Consumer<String> a = s -> System.out.print("A:" + s + " ");
Consumer<String> b = s -> System.out.print("B:" + s);
a.andThen(b).accept("x");  // A:x B:x   (both receive the SAME input)
```

**`Predicate` combinators — `and`, `or`, `negate`:**

```java
Predicate<String> nonNull  = Objects::nonNull;
Predicate<String> nonEmpty = s -> !s.isEmpty();
Predicate<String> valid    = nonNull.and(nonEmpty);   // short-circuits
Predicate<String> invalid  = valid.negate();
```

`and`/`or` **short-circuit** exactly like `&&`/`||`. `Predicate.isEqual(target)` is a
static factory equivalent to `x -> Objects.equals(target, x)`. Java 11 added the static
`Predicate.not(...)` (JEP not required; library addition).

**`BinaryOperator` factories (static):** `BinaryOperator.minBy(comparator)` and
`maxBy(comparator)` return a `BinaryOperator<T>` — useful in `reduce`.

**Gotcha — operator precedence in chains.** `p1.and(p2).or(p3)` is `(p1 AND p2) OR p3`
because methods evaluate left to right; there is no operator-style precedence. Parenthesize
your calls to be explicit.

**Gotcha — `andThen` return type.** `Function<T,R>.andThen` takes a
`Function<? super R, ? extends V>` and returns `Function<T,V>`. `UnaryOperator` **inherits**
`andThen`/`compose` from `Function`, so chaining two `UnaryOperator<T>` yields a
`Function<T,T>`, **not** a `UnaryOperator<T>` — a subtle typing surprise.

---

## The four method reference kinds

A method reference (`::`) is shorthand for a lambda that just calls one existing method.
There are **four** kinds. Knowing which is which — and how each maps to a lambda — is a
classic interview question.

| Kind | Syntax | Equivalent lambda | Example |
|------|--------|-------------------|---------|
| 1. Static | `Type::staticMethod` | `(a,b) -> Type.staticMethod(a,b)` | `Integer::parseInt` |
| 2. Bound instance | `instance::method` | `(a) -> instance.method(a)` | `System.out::println` |
| 3. Unbound instance | `Type::instanceMethod` | `(obj,a) -> obj.method(a)` | `String::toUpperCase` |
| 4. Constructor | `Type::new` | `(a,b) -> new Type(a,b)` | `ArrayList::new` |

**1. Static method reference.** References a `static` method. Parameters map 1:1.
```java
Function<String,Integer> parse = Integer::parseInt; // s -> Integer.parseInt(s)
```

**2. Bound instance reference** (a.k.a. reference to an instance method of a *particular*
object). The receiver object is captured *now*; the lambda's parameters become the method's
parameters.
```java
String prefix = "log-";
Predicate<String> startsWithLog = prefix::startsWith; // s -> prefix.startsWith(s)
List<String> out = ...;
Consumer<String> add = out::add;                      // s -> out.add(s)
```

**3. Unbound instance reference** (reference to an instance method of an *arbitrary*
object of a type). The **first lambda parameter becomes the receiver**; remaining
parameters are the method's arguments.
```java
Function<String,String> up   = String::toUpperCase;   // s      -> s.toUpperCase()
BiPredicate<String,String> e = String::equals;        // (a,b)  -> a.equals(b)
Comparator<String> byNat     = String::compareTo;     // (a,b)  -> a.compareTo(b)
```

**4. Constructor reference.** `Type::new` targets a constructor; arg count/types pick the
overload.
```java
Supplier<List<String>> s1        = ArrayList::new;      // ()  -> new ArrayList<>()
Function<Integer,List<String>> s2 = ArrayList::new;     // cap -> new ArrayList<>(cap)
Function<String,BigInteger> big  = BigInteger::new;     // s   -> new BigInteger(s)
IntFunction<int[]> arr           = int[]::new;          // n   -> new int[n]  (array ctor)
```

**The classic ambiguity — bound vs unbound.** `String::toUpperCase` is *unbound* (the
receiver comes from the first argument). `"hi"::toUpperCase` is *bound* (receiver is the
literal). The compiler disambiguates by whether the left side is a **type name** or an
**expression/value**.

**Gotcha — overload/arity resolution.** `Type::method` may match either a static method or
an unbound-instance method of the same name; if both exist and both fit the target type,
you get a compile error (`reference to method is ambiguous`). Method references are resolved
against the target functional interface using the same overload rules as method calls.

**Gotcha — evaluation timing of the receiver.** In a *bound* reference `expr::m`, `expr` is
evaluated **once, when the method reference expression is evaluated**, not on each
invocation. So `getList()::add` calls `getList()` a single time and captures that list.

---

## Default and static methods on interfaces

**Default methods (Java 8, JEP 126 "Project Lambda").** An interface method with a body,
declared `default`. It solved the **interface evolution problem**: adding a method to
`Collection` (e.g. `stream()`, `forEach`, `removeIf`) would have broken every existing
implementation. Default methods let the JDK add methods with a supplied implementation, so
old implementers still compile.

```java
interface Vehicle {
    String name();
    default String describe() { return "Vehicle: " + name(); } // has a body
}
```

**Static interface methods (Java 8).** Utility methods that live on the interface itself
(e.g. `Comparator.comparing`, `Function.identity`, `Stream.of`). They are **not inherited**
by implementing classes and must be called via the interface name.

**Private interface methods — Java 9 (not Java 8).** `private` and `private static` methods
in interfaces were added in **Java 9** to share code between default methods without
exposing it. Do not attribute these to Java 8.

**The diamond problem / conflict resolution rules.** When a class inherits the same default
method from two interfaces, or a class and interface conflict, Java uses these rules:

1. **Classes win over interfaces.** A concrete/abstract superclass method beats any default.
2. **More specific subinterface wins.** If interface B extends A and both define the
   default, B's version is chosen.
3. **Otherwise the class must override** and may explicitly pick one via
   `InterfaceName.super.method()`.

```java
interface A { default String hi() { return "A"; } }
interface B { default String hi() { return "B"; } }
class C implements A, B {
    public String hi() { return A.super.hi(); } // must resolve explicitly
}
```

**Gotcha.** A functional interface can have any number of default/static methods and still
be functional — only the count of *abstract* methods matters.

---

## Target typing and type inference

A lambda or method reference has **no standalone type**; it is a *poly expression* whose
type is determined by its **target type** — the type expected by the context (variable
declaration, assignment, method argument, return statement, cast, ternary branch).

```java
Runnable r        = () -> System.out.println("hi"); // target type Runnable
Callable<String> c = () -> "hi";                    // SAME lambda shape, different target
```

**Where target types come from:**
- Variable/field assignment: `Predicate<String> p = s -> s.isEmpty();`
- Method parameter: `list.forEach(s -> ...)` → target is `Consumer<? super T>`.
- Return statement: the enclosing method's return type.
- Cast: `(Runnable) () -> {...}` — used to disambiguate overloaded methods.
- Ternary: each branch is typed against the ternary's target.

**Parameter type inference.** Lambda parameter types are usually inferred from the target,
so you write `s -> ...` not `(String s) -> ...`. You may add explicit types, but you must be
**all-or-nothing** — you cannot mix `(String s, t) -> ...`.

**`var` in lambda parameters — Java 11 (JEP 323).** You may write `(var s, var t) -> ...`.
The benefit is uniformity and allowing annotations like `(@NonNull var s) -> ...`. Rule:
if you use `var` for one parameter you must use it for **all**, and you cannot mix `var`
with explicit types or with implicitly-typed (bare) parameters.

**Overload ambiguity.** If a lambda matches two overloaded methods whose parameters are
different functional interfaces of the *same shape*, the call is ambiguous and needs a cast.
The lambda body must be compatible with **both** function types for the ambiguity to arise —
a method-call body is both *void-compatible* (a statement expression) and *value-compatible*,
so it fits `Runnable` and `Callable<Object>` alike:
```java
Object compute() { ... }
// exec(Runnable) and exec(Callable<Object>) both match () -> compute() → ambiguous
exec((Callable<Object>) () -> compute());
```
(Note: `() -> null` would NOT be ambiguous here — `null` is not a statement expression, so the
lambda is *not* void-compatible and only matches `Callable<Object>`.)

**Effectively final capture.** A lambda may reference local variables only if they are
**final or effectively final** (never reassigned after initialization). Unlike anonymous
classes historically requiring `final`, Java 8 relaxed this to *effectively final*.
Instance/static fields can be freely mutated (they are captured via `this`).

```java
int base = 10;              // effectively final
Function<Integer,Integer> f = x -> x + base;
// base = 20;               // would make it NOT effectively final → compile error
```

**`this` semantics.** Inside a lambda, `this` refers to the **enclosing instance**, not the
lambda object — lambdas are *not* a new scope for `this`/`super`/name shadowing. An anonymous
inner class introduces its own `this`; a lambda does not. Lambda parameters also cannot
shadow enclosing locals (that would be a compile error), whereas anonymous-class fields can.

**How lambdas compile (advanced).** Lambdas are **not** compiled to synthetic inner-class
`.class` files. `javac` emits an `invokedynamic` bytecode instruction whose bootstrap method
is `LambdaMetafactory` (in `java.lang.invoke`). At first execution the JVM spins up the
implementation class dynamically. This gives lambdas lower footprint than anonymous classes
and lets the runtime optimize/cache the instance (a *stateless*, non-capturing lambda is
typically instantiated once and reused).

---

## Common interview follow-up questions

1. What exactly makes an interface a functional interface, and why is `Comparator` still
   functional despite declaring both `compare` and `equals`?
2. Is `@FunctionalInterface` required for a lambda to compile? What does it actually do?
3. Explain `andThen` vs `compose` on `Function` with a concrete numeric example.
4. Name the four kinds of method reference and write the equivalent lambda for each.
5. Why is `String::length` unbound but `str::length` bound? How does the compiler decide?
6. What problem did default methods solve, and what are the conflict-resolution rules when
   two interfaces provide the same default method?
7. Which Java version added `private` interface methods? Which added `var` in lambda
   parameters? (Answers: Java 9 and Java 11 — *not* Java 8.)
8. What is "effectively final" and why do lambdas require it? Can you mutate a field from a
   lambda?
9. Does a lambda create a new `this`? How does that differ from an anonymous inner class?
10. How are lambdas compiled — inner classes or `invokedynamic`? Why does it matter for
    performance?
11. Why do the primitive functional interfaces exist, and what is the method name on
    `IntSupplier`/`ToIntFunction`?
12. When is a lambda-to-overloaded-method call ambiguous, and how do you fix it?

## References

- JSR 335 / JEP 126: *Lambda Expressions & Virtual Extension (default) Methods* (Java 8).
- The Java Language Specification, Java SE 8 Edition — §9.8 Functional Interfaces,
  §15.13 Method Reference Expressions, §15.27 Lambda Expressions, §15.12 target typing.
- `java.util.function` package documentation (Java SE 8 API).
- JEP 323: *Local-Variable Syntax for Lambda Parameters* (Java 11).
- JEP 213 and Java 9 release notes: *private methods in interfaces* (Java 9).
- `java.lang.invoke.LambdaMetafactory` API docs (lambda linkage via `invokedynamic`).
- Oracle Java Tutorials: *Method References* and *Lambda Expressions*.
