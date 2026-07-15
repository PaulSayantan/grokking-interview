# Java 8+ Features: Lambdas, Streams and Optional

Java 8 (March 2014) was the largest language release since generics in Java 5. It introduced
lambda expressions, the Stream API, `java.util.function`, method references, `Optional`, default
methods, the `java.time` package, and `CompletableFuture`. These features shifted idiomatic Java
from imperative, statement-oriented code toward a more declarative, functional style. This document
covers the lambda/stream/`Optional` family in depth, and tags every version-specific behavior.

A quick version-accuracy anchor for this topic:

| Feature | Introduced / Status |
|---|---|
| Lambdas, Streams, `Optional`, method refs, default methods, `java.time`, `CompletableFuture` | **Java 8 (2014), final** |
| `Stream.iterate(seed, hasNext, next)` (3-arg), `takeWhile`, `dropWhile`, `Optional.stream()`, `Optional.or`, `Optional.ifPresentOrElse` | **Java 9** |
| `Collectors.flatMapping`, `Collectors.filtering` | **Java 9** |
| `Stream.toList()` (unmodifiable) | **Java 16** |
| `Collectors.teeing` | **Java 12** |
| `Optional.orElseThrow()` (no-arg) | **Java 10** |
| `var` in lambda parameters | **Java 11** |

Everything in the "Java 8" row is final and has been since 2014; the later rows are convenience
additions layered on top of the same model.

## Lambda expressions and functional interfaces

**Beginner.** A lambda expression is a concise literal for an instance of a *functional interface*
— an interface with exactly one abstract method (SAM: Single Abstract Method). Before Java 8 you
wrote an anonymous inner class; a lambda is shorthand for the same idea.

```java
// Old way (Java 7): anonymous class
Runnable r1 = new Runnable() {
    public void run() { System.out.println("hi"); }
};
// New way (Java 8): lambda
Runnable r2 = () -> System.out.println("hi");

Comparator<String> byLen = (a, b) -> Integer.compare(a.length(), b.length());
```

The `@FunctionalInterface` annotation is optional but documents intent and makes the compiler reject
an interface that does not have exactly one abstract method. Note: `default` and `static` methods do
NOT count against the single-abstract-method rule, and methods that override `public` methods of
`java.lang.Object` (like `equals`, `hashCode`, `toString`) also do not count.

**Intermediate — the core `java.util.function` interfaces:**

| Interface | Signature | Typical use |
|---|---|---|
| `Function<T,R>` | `R apply(T)` | transform / map |
| `BiFunction<T,U,R>` | `R apply(T,U)` | two-arg transform |
| `Predicate<T>` | `boolean test(T)` | filter |
| `Consumer<T>` | `void accept(T)` | side effect (forEach) |
| `Supplier<T>` | `T get()` | lazy value / factory |
| `UnaryOperator<T>` | `T apply(T)` | `Function<T,T>` |
| `BinaryOperator<T>` | `T apply(T,T)` | reduce accumulator |

**Lambda vs anonymous class — the crucial differences (advanced):**

1. **`this` binding.** Inside an anonymous class, `this` refers to the anonymous instance. Inside a
   lambda, `this` refers to the *enclosing* instance — a lambda is NOT a new scope for `this`,
   `super`, or local variable names. This is the single most tested semantic difference.
2. **No shadowing.** A lambda cannot re-declare a variable name that exists in the enclosing scope;
   an anonymous class can.
3. **Compilation strategy.** Anonymous classes compile to a separate `.class` file (`Outer$1.class`)
   and allocate an object eagerly. Lambdas compile to a private method plus an `invokedynamic`
   bootstrap (`LambdaMetafactory`) that the JVM links lazily on first use — no extra class file, and
   stateless lambdas can be cached as singletons.

```java
class Counter {
    int value = 0;
    Runnable asLambda()     { return () -> value++; }       // this.value, enclosing instance
    Runnable asAnonymous()  { return new Runnable() {
        public void run() { /* this == the Runnable */ }
    }; }
}
```

## Closures and effectively final capture

**Beginner.** A lambda can *capture* variables from the enclosing scope. Local variables it captures
must be **final or effectively final** — meaning assigned exactly once and never reassigned after.
This restriction has existed since Java 8; Java 8 merely relaxed the pre-Java-8 rule that required
the explicit `final` keyword.

```java
int base = 10;               // effectively final: never reassigned
Function<Integer,Integer> add = x -> x + base;  // OK
// base = 20;                // would break it: now 'base' is NOT effectively final -> compile error
```

**Intermediate — why the restriction exists.** Java captures local variables *by value* (a copy of
the variable's value is stored in the lambda's synthetic fields). If reassignment were allowed, the
copy and the original would diverge, creating confusing semantics. Instance and static fields are
NOT subject to this rule — they are captured *by reference* through `this`, so you can freely mutate
them (which is exactly why the `Counter.value++` example above compiles).

**Advanced — the mutable-holder anti-pattern.** People try to "get around" the rule with a one-element
array or an `AtomicInteger`:

```java
int[] sum = {0};
list.forEach(x -> sum[0] += x);   // compiles: 'sum' reference is effectively final; contents mutate
```

This compiles because the *reference* `sum` never changes. But it is an anti-pattern in streams:
in a parallel stream it is a data race. Prefer `reduce`/`collect` for accumulation. The captured
`this`-reference vs value-copy distinction is a frequent expert-level interview question.

## Method references

**Beginner.** A method reference (`::`) is shorthand for a lambda that does nothing but call an
existing method. Since Java 8.

| Kind | Syntax | Equivalent lambda |
|---|---|---|
| Static | `Integer::parseInt` | `s -> Integer.parseInt(s)` |
| Instance of a particular object | `System.out::println` | `x -> System.out.println(x)` |
| Instance of an arbitrary object of a type | `String::toLowerCase` | `s -> s.toLowerCase()` |
| Constructor | `ArrayList::new` | `() -> new ArrayList<>()` |

**Advanced gotcha — the "unbound" form.** `String::compareToIgnoreCase` used as a
`Comparator<String>` works because the *first* parameter becomes the receiver: `(a, b) ->
a.compareToIgnoreCase(b)`. This "arbitrary object" form is what makes `Comparator.comparing(
Person::getName)` read naturally. Ambiguity between the "particular object" and "arbitrary object"
forms is resolved by the target type; overload resolution can occasionally fail to compile and force
you to fall back to an explicit lambda.

## Stream API fundamentals: intermediate versus terminal operations

**Beginner.** A `Stream` is a *pipeline* of operations over a source (collection, array, generator).
It does NOT store data and does NOT mutate its source. A pipeline has three parts: a **source**, zero
or more **intermediate operations**, and exactly one **terminal operation**.

```java
long count = names.stream()          // source
    .filter(n -> n.length() > 3)     // intermediate (lazy)
    .map(String::toUpperCase)        // intermediate (lazy)
    .count();                        // terminal (triggers execution)
```

**Intermediate vs terminal:**

| Aspect | Intermediate | Terminal |
|---|---|---|
| Return type | another `Stream` | non-stream (value, collection, `void`, `Optional`) |
| Execution | lazy — records intent | eager — runs the pipeline |
| Examples | `filter`, `map`, `flatMap`, `sorted`, `distinct`, `limit`, `peek`, `takeWhile` (Java 9) | `forEach`, `collect`, `reduce`, `count`, `findFirst`, `anyMatch`, `toList` (Java 16) |

**Advanced — single use.** A stream can be traversed only once. After a terminal operation (or a
second intermediate chaining onto an already-consumed stream) you get
`IllegalStateException: stream has already been operated upon or closed`. Streams are not reusable
containers — create a fresh one from the source each time.

## Lazy evaluation and short-circuiting

**Beginner.** Because intermediate operations are lazy, nothing happens until a terminal operation
runs. The pipeline then processes elements one at a time (element-wise / vertical traversal), not
stage-by-stage. This enables *short-circuiting*: operations like `findFirst`, `anyMatch`,
`limit`, and `takeWhile` can stop before consuming the whole source.

```java
Stream.of("a","bb","ccc","dddd")
    .peek(s -> System.out.println("peek " + s))
    .filter(s -> s.length() > 1)
    .findFirst();
// prints: peek a, peek bb  -> then STOPS. "ccc"/"dddd" never touched.
```

**Advanced — infinite streams need short-circuiting.** `Stream.iterate` and `Stream.generate`
produce infinite streams; a terminal like `count()` on them never returns. You MUST bound them:

```java
Stream.iterate(1, n -> n * 2).limit(10).forEach(System.out::println);   // Java 8
Stream.iterate(1, n -> n < 1000, n -> n * 2).forEach(System.out::println); // Java 9 (3-arg, self-bounding)
```

**Gotcha — `peek` may be skipped.** Since `peek` is intermediate and lazy, and because some
pipelines can be optimized so elements are never realized (e.g. `stream.map(...).count()` where
the JDK 9+ optimization can elide the mapping when the count is derivable from the source size),
`peek` is documented as *for debugging only*. Never rely on `peek` for essential logic.

## Map, filter, reduce and collect

**Beginner.**
- `map(Function)` — one-to-one transform.
- `filter(Predicate)` — keep matching elements.
- `reduce` — fold elements into a single value.
- `collect` — mutable reduction into a container (list, map, string).

**Intermediate — the three `reduce` overloads:**

```java
Optional<Integer> sum1 = nums.stream().reduce((a,b) -> a+b);          // no identity -> Optional
int sum2 = nums.stream().reduce(0, (a,b) -> a+b);                     // identity -> plain value
int len  = words.stream().reduce(0, (acc,w) -> acc + w.length(), Integer::sum); // 3-arg: combiner for parallel
```

The 3-arg form takes an **identity**, an **accumulator** `(U, T) -> U`, and a **combiner**
`(U, U) -> U`. The combiner merges partial results across threads in a parallel stream and is only
actually invoked in parallel execution; the accumulator's result type may differ from the element
type. A correct `reduce` requires the identity to be a true identity value and the accumulator/combiner
to be **associative** — otherwise parallel and sequential runs disagree.

**Advanced — reduce vs collect.** `reduce` is an *immutable* reduction (each step returns a new
value); it is wrong for accumulating into a mutable container because it would copy on every element
(`O(n^2)` for string concatenation). `collect` is a *mutable* reduction designed for containers via a
`Supplier` (new container), `BiConsumer` accumulator (add to container), and `BiConsumer` combiner
(merge containers). Use `collect(Collectors.joining())` not `reduce(String::concat)`.

## Collectors: groupingBy, joining, toMap and partitioningBy

**Beginner.** `Collectors` is a factory of ready-made reduction recipes for `collect`.

```java
List<String> list  = s.collect(Collectors.toList());   // Java 8; may be mutable, no guarantee
List<String> list2 = s.collect(Collectors.toUnmodifiableList()); // Java 10, immutable
String joined      = s.collect(Collectors.joining(", ", "[", "]"));
```

Note: `Collectors.toList()` gives NO guarantee about mutability, type, serializability, or
thread-safety. If you need an immutable list use `toUnmodifiableList()` (Java 10) or `Stream.toList()`
(Java 16, always unmodifiable).

**Intermediate — grouping and partitioning:**

```java
Map<Dept, List<Emp>> byDept =
    emps.stream().collect(Collectors.groupingBy(Emp::getDept));

// Downstream collector: group then count
Map<Dept, Long> countByDept =
    emps.stream().collect(Collectors.groupingBy(Emp::getDept, Collectors.counting()));

// partitioningBy -> ALWAYS a Map<Boolean,...> with both true AND false keys present
Map<Boolean, List<Emp>> parts =
    emps.stream().collect(Collectors.partitioningBy(e -> e.getSalary() > 100_000));
```

`partitioningBy` is a specialized `groupingBy` for a boolean predicate; it is more efficient and
**guarantees both `true` and `false` keys exist** (possibly mapping to empty lists), whereas
`groupingBy` only creates keys for values that actually occur.

**Advanced — `toMap` and the duplicate-key trap:**

```java
// Throws IllegalStateException on duplicate key!
Map<String,Emp> m = emps.stream().collect(Collectors.toMap(Emp::getName, e -> e));

// Fix: supply a merge function
Map<String,Emp> m2 = emps.stream()
    .collect(Collectors.toMap(Emp::getName, e -> e, (a,b) -> a));  // keep first
```

Another `toMap` trap: a mapped **null value** throws `NullPointerException` (unlike `HashMap.put`
which accepts null values), because `toMap` is implemented with `Map.merge`. `groupingBy` uses
`HashMap` and `ArrayList` by default; supply a map factory for `TreeMap`:
`groupingBy(f, TreeMap::new, toList())`. Downstream collectors compose arbitrarily deep, e.g.
`groupingBy(byDept, mapping(Emp::getName, joining(",")))`.

## flatMap and stream flattening

**Beginner.** `flatMap` maps each element to a *stream* and concatenates all those streams into one
flat stream. Use it to flatten nested structures (list of lists, `Optional` of `Optional`, splitting
strings into words).

```java
List<List<Integer>> nested = List.of(List.of(1,2), List.of(3,4));
List<Integer> flat = nested.stream()
    .flatMap(List::stream)          // Stream<List<Integer>> -> Stream<Integer>
    .collect(Collectors.toList());  // [1,2,3,4]
```

**Intermediate — `map` vs `flatMap`.** `map` gives `Stream<Stream<X>>` when the mapper returns a
stream/collection; `flatMap` gives `Stream<X>`. Rule of thumb: mapper returns 0..N results per element
→ `flatMap`; exactly one → `map`.

**Advanced.** Since Java 16, `mapMulti` is an alternative to `flatMap` that avoids allocating an
intermediate stream per element by pushing results to a consumer — useful in hot paths with many
elements each producing few results. `Collectors.flatMapping` (Java 9) applies flat-mapping as a
downstream collector inside a `groupingBy`.

## Primitive streams

**Beginner.** `IntStream`, `LongStream`, `DoubleStream` are specialized streams that avoid
boxing/unboxing overhead and add numeric conveniences (`sum`, `average`, `range`, `summaryStatistics`).

```java
int total = IntStream.rangeClosed(1, 100).sum();           // 5050
double avg = users.stream().mapToInt(User::getAge).average().orElse(0);
IntSummaryStatistics st = IntStream.of(3,1,4,1,5).summaryStatistics(); // min/max/avg/sum/count
```

**Intermediate — conversions.** Object stream → primitive: `mapToInt`, `mapToLong`, `mapToDouble`.
Primitive → object: `boxed()` or `mapToObj(...)`. `range(1,5)` is `[1,5)`; `rangeClosed(1,5)` is
`[1,5]`.

**Advanced gotcha.** `IntStream.average()` returns `OptionalDouble` (empty on an empty stream), and
`sum()` returns a primitive `0` on an empty stream — do not confuse the two. Primitive streams have
no `filter`-to-object; and `Arrays.stream(intArray)` yields an `IntStream`, whereas
`Stream.of(intArray)` yields a single-element `Stream<int[]>` — a classic trap.

## Parallel streams: when they help and when they hurt

**Beginner.** `collection.parallelStream()` or `stream.parallel()` splits work across the common
`ForkJoinPool`. It can speed up large, CPU-bound, easily-splittable workloads — but often makes small
or I/O-bound workloads *slower*.

**Intermediate — the checklist for when parallel helps:**
- Large N (tens of thousands+ elements) and meaningful per-element cost.
- Source splits cheaply and evenly: arrays, `ArrayList`, `IntStream.range` split well; `LinkedList`,
  `Iterator`-based, and hash-based sources split poorly.
- The operation is stateless, associative, and side-effect-free.
- No ordering constraint that forces serialization (`findFirst`/`forEachOrdered` add cost;
  `findAny`/`forEach`/`unordered()` are cheaper).

**Advanced — the shared common pool trap.** All parallel streams in a JVM share one
`ForkJoinPool.commonPool()` (size = #cores − 1 by default). A blocking or long task in one parallel
stream starves every other one, including unrelated library code. For blocking work, submit the
stream task to your own `ForkJoinPool` (the "pool-submission" trick) or avoid parallel streams
entirely. Never mutate shared state from a parallel stream (data race); never use `forEach` for
ordered output in parallel (use `forEachOrdered` or `collect`). Also: `Collectors.toMap`/`groupingBy`
have concurrent variants (`toConcurrentMap`, `groupingByConcurrent`) that avoid the merge cost but
require an unordered stream to shine.

## Optional: correct usage and anti-patterns

**Beginner.** `Optional<T>` (Java 8) is a container that may or may not hold a non-null value. Its
*intended* purpose is a **return type** signaling "no result may be normal," making the absence
explicit in the API instead of returning `null`.

```java
Optional<User> found = repo.findById(id);
String name = found.map(User::getName).orElse("unknown");
found.ifPresent(u -> audit(u));
```

**Intermediate — the useful API:**

| Method | Behavior |
|---|---|
| `of(v)` | wraps non-null; NPE if null |
| `ofNullable(v)` | wraps, empty if null |
| `orElse(x)` | value or default (default *always* evaluated) |
| `orElseGet(supplier)` | value or lazily-computed default |
| `orElseThrow()` | value or `NoSuchElementException` (no-arg, **Java 10**) |
| `orElseThrow(supplier)` | value or custom exception (Java 8) |
| `map` / `flatMap` | transform; `flatMap` avoids `Optional<Optional<T>>` |
| `filter` | keep value if predicate holds, else empty |
| `ifPresentOrElse` | present-action or empty-action (**Java 9**) |
| `or(supplier)` | alternative `Optional` (**Java 9**) |
| `stream()` | 0- or 1-element stream (**Java 9**) |

**Advanced — anti-patterns to name in an interview:**

1. **`get()` without checking** — throws `NoSuchElementException`; defeats the purpose. Use `map`/
   `orElse`/`orElseThrow`.
2. **`isPresent()` + `get()`** — verbose null-check in disguise; prefer `map`/`ifPresent`.
3. **`Optional` fields / method parameters / collection elements** — `Optional` is not `Serializable`
   and adds an allocation; the JDK designers intended it only for return types. Use `null` or an empty
   collection instead. Never return `null` from a method whose type is `Optional` — return
   `Optional.empty()`.
4. **`orElse` with an expensive default** — `orElse(createDefault())` *always* calls `createDefault()`
   even when the value is present. Use `orElseGet(this::createDefault)` for lazy evaluation.
5. **`Optional<Collection>`** — return an empty collection, not `Optional` of a collection.

The `orElse` vs `orElseGet` eager/lazy distinction is one of the most common expert questions in this
whole topic.

## Stream versus loop trade-offs

**Beginner.** Streams are declarative and read well for map/filter/reduce; classic `for` loops are
imperative and sometimes clearer and faster for simple iteration.

**Intermediate / advanced considerations:**

| Dimension | Stream | Loop |
|---|---|---|
| Readability | wins for multi-stage transforms | wins for trivial iteration |
| Debugging | harder (breakpoints, stack traces span lambdas) | easy step-through |
| Performance | slight overhead; can win with parallel or primitive streams | lowest overhead for simple cases; can `break`/`continue`/`return` freely |
| Control flow | no `break`/`continue`; use `takeWhile`/`findFirst`/`anyMatch` | full control |
| Checked exceptions | awkward — lambdas can't throw checked exceptions unless the SAM declares them | natural try/catch |
| Mutation | discouraged; favors immutability | natural |

**Gotcha — checked exceptions.** A lambda passed to `map`/`forEach` cannot throw a checked exception
because `Function`/`Consumer` don't declare one; you must wrap-and-rethrow as unchecked, which is
uglier than a loop's `try`. For genuinely simple counting/summing loops, the JIT often makes a plain
loop marginally faster than a sequential stream; measure before rewriting hot paths.

## Common interview follow-up questions

- What does "effectively final" mean, and why must captured local variables satisfy it? How do
  instance fields differ?
- Inside a lambda, what does `this` refer to? How does that differ from an anonymous class?
- Explain lazy evaluation and short-circuiting. Trace the `peek`/`filter`/`findFirst` output.
- What is the difference between `reduce` and `collect`? When is the 3-arg `reduce` combiner invoked?
- `Collectors.toMap` on duplicate keys — what happens and how do you fix it? What about null values?
- `partitioningBy` vs `groupingBy` — what key guarantees does each give?
- `orElse` vs `orElseGet` — when does the difference matter? Give a concrete bug.
- List three `Optional` anti-patterns and why each is discouraged.
- When does a parallel stream hurt? What is the common-pool starvation problem?
- Difference between `Arrays.stream(intArr)` and `Stream.of(intArr)`?
- `IntStream.average()` vs `sum()` return types on an empty stream.
- Which Java version added `takeWhile`/`dropWhile`, `Optional.stream()`, `Stream.toList()`?
- Why can a stream only be consumed once? What exception do you get otherwise?
- `map` vs `flatMap` — when do you reach for each?

## References

- JSR 335 — Lambda Expressions for the Java Programming Language (Java 8).
- Java SE 8 API: `java.util.stream` package summary (stream operations, laziness, ordering,
  parallelism, reduction, associativity).
- Java SE API: `java.util.Optional`, `java.util.stream.Collectors`, `java.util.function`.
- Brian Goetz, "State of the Lambda: Libraries Edition."
- JEP 269: Convenience Factory Methods for Collections (Java 9, related immutable collections).
- Java 9 release notes: `Stream.takeWhile/dropWhile`, 3-arg `Stream.iterate`, `Optional.stream/or/
  ifPresentOrElse`, `Collectors.flatMapping/filtering`.
- Java 10 (`Optional.orElseThrow()` no-arg, `toUnmodifiableList`), Java 12 (`Collectors.teeing`),
  Java 16 (`Stream.toList()`, `Stream.mapMulti`) release notes.
