# Reflection, Annotations and Dynamic Proxies

Reflection is the JVM's ability to inspect and manipulate classes, methods, fields, and
constructors *at runtime* — with no compile-time knowledge of the types involved.
Annotations attach machine-readable metadata to code, and dynamic proxies synthesize
implementation classes on the fly. Together these three form the backbone of nearly every
Java framework you use: Spring, Hibernate, Jackson, JUnit, Mockito, Guice, and Micronaut all
lean on some combination of them.

This topic covers *what* these facilities do, *how* the JVM implements them, and — critically —
*when to avoid them*, because reflection is powerful but carries real costs in performance,
type-safety, and (since Java 9) module encapsulation.

---

## The reflection API and Class objects

Every loaded type has exactly one `java.lang.Class<T>` object, created by the class loader and
cached. `Class` is the entry point to all reflection.

**Three ways to obtain a `Class`:**

```java
Class<String> c1 = String.class;              // class literal — compile-time, no init
Class<?> c2 = "hello".getClass();             // from an instance — runtime type
Class<?> c3 = Class.forName("java.util.List");// by fully-qualified name — triggers init
```

Key distinction (a classic gotcha): `String.class` does **not** run the class's static
initializer, while `Class.forName("X")` **does** (by default). The three-arg overload
`Class.forName(name, initialize, loader)` lets you suppress initialization.

`getClass()` returns the **runtime** (dynamic) type, not the declared type:

```java
Object o = new ArrayList<>();
o.getClass();   // -> class java.util.ArrayList, NOT Object
```

**Reflective members and their access rules:**

| Method                       | Returns                                              | Access scope                                   |
|------------------------------|------------------------------------------------------|------------------------------------------------|
| `getFields()`                | `Field[]`                                             | **public** fields, including inherited          |
| `getDeclaredFields()`        | `Field[]`                                             | **all** fields declared in *this* class, no inherited |
| `getMethods()`               | `Method[]`                                             | public methods, including inherited + interfaces|
| `getDeclaredMethods()`       | `Method[]`                                             | all methods declared here, no inherited         |
| `getConstructors()`          | `Constructor[]`                                        | public constructors                              |
| `getDeclaredConstructors()`  | `Constructor[]`                                        | all constructors                                 |

The mnemonic: **`getX()` = public + inherited; `getDeclaredX()` = everything declared here, no inheritance.**

**Instantiation.** `Class.newInstance()` is **deprecated since Java 9** because it swallowed and
mis-propagated checked exceptions from the constructor. The modern replacement:

```java
// Old (deprecated): clazz.newInstance();
Object instance = clazz.getDeclaredConstructor().newInstance();  // Since Java 9 preferred
```

**Type introspection extras:** `getGenericSuperclass()` / `getGenericInterfaces()` expose
`ParameterizedType` so you can recover generic type arguments retained in class/field/method
signatures (generics are erased for *instances* but retained in *declared signatures* — this is
how Jackson's `TypeReference` and Spring's `ResolvableType` work). `isAssignableFrom`,
`isInstance`, `getEnclosingClass`, `getNestHost` (Java 11 nestmates), and `getPermittedSubclasses`
(Java 17 sealed) round out inspection.

---

## Working with fields, methods and constructors

Once you have a `Method`, `Field`, or `Constructor`, you *invoke* or *access* it dynamically.

```java
Method m = target.getClass().getMethod("greet", String.class);
Object result = m.invoke(target, "world");         // instance method

Field f = target.getClass().getDeclaredField("count");
f.set(target, 42);
int val = (int) f.get(target);

Constructor<?> ctor = Point.class.getConstructor(int.class, int.class);
Point p = (Point) ctor.newInstance(3, 4);
```

**Exceptions you must handle:**
- `NoSuchMethodException` / `NoSuchFieldException` — member doesn't exist.
- `IllegalAccessException` — member not accessible (and `setAccessible` not called/allowed).
- `InvocationTargetException` — a **wrapper**: the invoked method threw. The real exception is in
  `getCause()`. This is the single most common reflection surprise: your `catch (RuntimeException)`
  around business logic won't catch it, because reflection re-wraps it.
- `IllegalArgumentException` — wrong receiver type or argument count/type mismatch.

**`static` members:** pass `null` as the receiver — `staticMethod.invoke(null, args)` and
`staticField.get(null)`.

**Primitive vs wrapper in signatures:** `getMethod("f", int.class)` and
`getMethod("f", Integer.class)` resolve to *different* overloads. Autoboxing does **not** apply
to reflective lookup — you must use `int.class`, `long.class`, etc. for primitive parameters.

**Overload resolution is your job.** Reflection performs *no* overload selection based on runtime
argument types the way `javac` does at compile time; you name the exact parameter types up front.

**`final` fields (precise current rule).** With `setAccessible(true)`, a **non-static** `final`
field is still writable via `Field.set` on most JDKs — but the JIT may have already inlined its
value at read sites, so the mutation is **not reliably observed** (you may see the old constant).
**`static final`** fields are blocked (`IllegalAccessException`) — the compiler treats them as
constants. And fields of **hidden classes and `record` components reject** reflective writes
outright. Bottom line: treat mutating any `final` as unsupported/undefined; if you need mutability,
don't declare the field `final`.

---

## setAccessible and strong encapsulation

`AccessibleObject.setAccessible(true)` suppresses Java language access checks so you can touch
`private`/`protected` members. This is how frameworks read your private fields (Hibernate, Jackson).

**Pre-Java 9:** with a permissive `SecurityManager` (or none), `setAccessible(true)` worked on
almost anything.

**Java 9+ (JPMS / JEP 261 modules) changed everything.** The Java Platform Module System added
*strong encapsulation*. `setAccessible` now also respects **module** boundaries, not just class
access modifiers:

- **Reflective access to a type in another module** requires that module to **open** the package,
  via `opens com.example.pkg;` (or `opens ... to some.module;`) in `module-info.java`, or the whole
  module via `open module M { }`.
- If the package is not open, `setAccessible(true)` throws `InaccessibleObjectException`
  (a subclass of `RuntimeException`, since Java 9).

**JDK 16 (JEP 396): "Strongly encapsulate JDK internals by default."** Before 16, deep reflection
into JDK internal packages (e.g. `sun.*`, non-exported `jdk.internal.*`) produced only a *warning*.
Since JDK 16 it is **denied by default** — you must pass `--add-opens java.base/java.lang=ALL-UNNAMED`
on the command line to permit it. This is why upgrading past 16 breaks old libraries that did
deep reflection (older Mockito, some serialization libs).

**"Illegal reflective access" warning.** The familiar
`WARNING: An illegal reflective access operation has occurred` appeared in Java 9–15 under the
default `--illegal-access=permit` mode. `--illegal-access=deny` became the default in **JDK 16**,
and in **JDK 17 (JEP 403)** the `--illegal-access` flag was made **obsolete** — it is silently
ignored (any value merely triggers a warning) and no longer re-enables deep access. (The option
was finally *removed entirely* in JDK 22.) From JDK 17 on, deep access into JDK internals *only*
works via explicit `--add-opens` / `opens`.

```
# Grant deep reflection at launch (all unnamed modules = classpath):
java --add-opens java.base/java.lang=ALL-UNNAMED -jar app.jar
```

**Rule of thumb:** an *exported* package (`exports`) lets you compile and call public API; only an
*opened* package (`opens`) permits `setAccessible` deep reflection at runtime.

**Concrete `module-info.java` showing both gates side by side:**

```java
module com.myapp {
    requires spring.core;

    exports com.myapp.api;          // callers may COMPILE against + call public API here
    opens   com.myapp.entity to     // Spring may DEEP-REFLECT (setAccessible) into here only,
            spring.core, hibernate.orm;  // and only from these two modules
    // com.myapp.internal is neither exported nor opened -> fully hidden
}
```

Trace the access decision for a caller in another module:
- Call `com.myapp.api.OrderApi.submit()` → **allowed** (package exported).
- `field.setAccessible(true)` on a private field of `com.myapp.entity.Order` from `spring.core`
  → **allowed** (package opened *to* `spring.core`).
- Same `setAccessible` on `com.myapp.internal.Secret` → **`InaccessibleObjectException`** (not opened).

---

## Annotations, retention and target

An annotation is metadata. It compiles to an interface extending `java.lang.annotation.Annotation`.

**`@Retention` — how long the annotation survives:**

| Policy    | Kept in `.class`? | Visible via reflection at runtime? | Typical use                         |
|-----------|-------------------|-------------------------------------|-------------------------------------|
| `SOURCE`  | No                | No                                  | `@Override`, Lombok, annotation processors only |
| `CLASS`   | Yes               | No (not loaded into runtime)        | bytecode tools, default if unspecified |
| `RUNTIME` | Yes               | **Yes** — readable with `getAnnotation` | Spring/JUnit/Jackson reflection |

**The default retention is `CLASS`** if you omit `@Retention`. This is a top interview trap: an
annotation without `@Retention(RUNTIME)` is **invisible to reflection**, so your framework's
`isAnnotationPresent(...)` returns `false` and the feature silently does nothing.

**`@Target` — where it may be applied** (`ElementType`): `TYPE`, `FIELD`, `METHOD`, `PARAMETER`,
`CONSTRUCTOR`, `LOCAL_VARIABLE`, `ANNOTATION_TYPE`, `PACKAGE`, plus **`TYPE_PARAMETER`** and
**`TYPE_USE`** (both added in **Java 8**, JSR 308). `TYPE_USE` enables annotations on *any* use of a
type — `List<@NonNull String>`, `@NonNull String x`, casts, `throws` clauses — powering pluggable
type checkers like the Checker Framework. Omitting `@Target` means the annotation is applicable
everywhere.

**Reading annotations reflectively:**

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Timed { String value() default "default"; }

Method m = svc.getClass().getMethod("run");
if (m.isAnnotationPresent(Timed.class)) {
    Timed t = m.getAnnotation(Timed.class);
    System.out.println(t.value());
}
```

**Annotation element rules:** members are declared like no-arg methods; allowed return types are
primitives, `String`, `Class`, enums, other annotations, and one-dimensional arrays of those.
`default` supplies a value; a member without a default must be given at use site. `value` is the
special name allowed to be set without `name=`.

**Java 8 additions:** `@Repeatable` (JSR 337) lets the same annotation appear multiple times on one
element; the compiler synthesizes a container annotation, and you read them with
`getAnnotationsByType(X.class)` (which handles the container transparently) rather than
`getAnnotation`.

---

## Meta-annotations

Meta-annotations are annotations that annotate *other* annotations. The core set in
`java.lang.annotation`:

- **`@Retention`** — lifetime (see above).
- **`@Target`** — legal application sites.
- **`@Documented`** — include in Javadoc.
- **`@Inherited`** — a class-level annotation is inherited by **subclasses**. Big caveats: it only
  works for `TYPE` targets, and it does **not** apply to interfaces or to methods/fields.
  `getAnnotation` walks up the superclass chain only for `@Inherited` annotations.
- **`@Repeatable`** (Java 8) — declares the container type for repeatable annotations.

**Composed / stereotype annotations.** Frameworks build higher-level annotations by meta-annotating.
Spring's `@RestController` is meta-annotated with `@Controller` + `@ResponseBody`, and `@Controller`
is itself meta-annotated with `@Component`. Note: the JLS `getAnnotation` does **not** natively
"see through" a meta-annotation (except `@Inherited` up the class hierarchy) — Spring implements its
own recursive *merged annotation* search (`AnnotatedElementUtils`) to discover
`@Component` transitively. So "does plain JDK reflection find `@Component` on a `@RestController`
class?" → **no**, only Spring's enhanced scanner does.

---

## Building annotation processors

Annotation processing runs at **compile time** via the Pluggable Annotation Processing API
(**JSR 269**, since Java 6), not at runtime. Processors run in *rounds* during `javac` and can
**generate new source files** — but cannot modify existing ones through the public API. This is how
Lombok (via internal hacks), MapStruct, Dagger, AutoValue, Micronaut, and the immutables library work.

**Anatomy:**

```java
@SupportedAnnotationTypes("com.example.Builder")
@SupportedSourceVersion(SourceVersion.RELEASE_17)
public class BuilderProcessor extends AbstractProcessor {
    @Override
    public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment env) {
        for (Element e : env.getElementsAnnotatedWith(Builder.class)) {
            // Inspect via the javax.lang.model mirror API (Element, TypeMirror),
            // then generate code with Filer:
            // processingEnv.getFiler().createSourceFile(...)
        }
        return true; // true = claim these annotations; other processors won't see them
    }
}
```

**Concrete round: input annotation → generated source.** Given this input the developer wrote:

```java
@Builder
public class Foo { int x; String name; }
```

the processor, during a `javac` round, inspects the `TypeElement` for `Foo`, reads its two
`VariableElement` fields (`x:int`, `name:String`), and writes a brand-new source file
`FooBuilder.java` through the `Filer`:

```java
// createSourceFile("com.example.FooBuilder").openWriter() writes exactly this text:
package com.example;
public class FooBuilder {
    private int x;
    private String name;
    public FooBuilder x(int x)        { this.x = x; return this; }
    public FooBuilder name(String n)  { this.name = n; return this; }
    public Foo build() {
        Foo f = new Foo();
        f.x = this.x; f.name = this.name;
        return f;
    }
}
```

That generated file is then compiled in the *same* `javac` invocation (a later round), so callers
can write `new FooBuilder().x(3).name("a").build()` with full compile-time type-safety and **zero
runtime reflection**. This is the exact mechanism behind MapStruct mappers and Dagger's DI graph —
strings-of-code written by `process()`, compiled alongside your code.

**Key points:**
- Registered via `META-INF/services/javax.annotation.processing.Processor`
  (or the `@AutoService` helper).
- Uses the **mirror API** (`javax.lang.model`: `Element`, `TypeElement`, `TypeMirror`), **not**
  runtime reflection — the classes aren't loaded yet, they're being compiled.
- Processors only require **`SOURCE`** retention on the annotations they consume (metadata not needed
  at runtime).
- **Generating** code is supported; **modifying** existing ASTs is not part of the public contract
  (Lombok reaches into compiler internals to do so, which is why it's fragile across JDK upgrades).
- Advantage over reflection: zero runtime cost, compile-time type-safety, works with GraalVM native
  image (which restricts runtime reflection). This is why MapStruct beats reflective mappers and why
  Micronaut/Quarkus prefer compile-time DI over Spring's runtime reflection.

---

## JDK dynamic proxies

`java.lang.reflect.Proxy` (since **Java 1.3**) generates, at runtime, a class implementing a set of
**interfaces**; every method call is routed to a single `InvocationHandler.invoke(...)`.

```java
interface Service { String hello(String name); }

Service proxy = (Service) Proxy.newProxyInstance(
    Service.class.getClassLoader(),
    new Class<?>[]{ Service.class },
    (Object p, Method method, Object[] args) -> {
        if (method.getName().equals("hello"))
            return "Hi " + args[0];
        return null;
    });
proxy.hello("Sam");   // -> "Hi Sam"
```

**Hard constraint: interfaces only.** JDK proxies *cannot* proxy a concrete class or abstract class —
the generated `$Proxy0` extends `java.lang.reflect.Proxy` and `implements` your interfaces. Since
Java has single inheritance and the proxy already extends `Proxy`, it can only add interfaces. If a
Spring bean has no interface, Spring falls back to CGLIB.

**Behavioral details:**
- The handler also receives calls to `equals`, `hashCode`, and `toString` (from `Object`), but
  **not** `getClass` or the `final` methods `wait`/`notify`.
- `proxy.getClass().getName()` looks like `com.sun.proxy.$Proxy0` (or a per-module name in JPMS).
- `Proxy.isProxyClass(clazz)` and `Proxy.getInvocationHandler(proxy)` let you introspect.
- Since Java 16+, `Proxy` also supports proxying interfaces with **non-public** access and can define
  proxy classes in specific modules.

> [!WARNING]
> **Object-method pitfall.** Because `equals`/`hashCode`/`toString` route through your handler, a
> naive handler that forwards everything (or returns `null`) silently breaks identity: two distinct
> proxies may test `equals` inconsistently, and a broken `hashCode` corrupts any `HashMap`/`HashSet`
> holding the proxy. Handle `Object` methods explicitly — e.g. `equals` → proxy-identity
> (`proxy == args[0]`), `hashCode` → `System.identityHashCode(proxy)`, `toString` → a fixed label.
> And **never** call a method *on the proxy* from inside `invoke` — that re-enters `invoke` and
> causes infinite recursion (`StackOverflowError`). Dispatch to the real target instead.

**Default methods:** an `InvocationHandler` that wants to *invoke* the interface's own `default`
method (rather than reimplement it) must use `InvocationHandler.invokeDefault(proxy, method, args)`
— **added in Java 16**. Before 16 this required brittle `MethodHandles.Lookup` hacks with
private-lookup reflection.

---

## Dynamic proxies versus CGLIB

Two mechanisms frameworks use to create proxies. Know the trade-offs cold.

| Aspect                 | JDK dynamic proxy                          | CGLIB / ByteBuddy subclassing               |
|------------------------|--------------------------------------------|---------------------------------------------|
| Mechanism              | Implements interfaces                       | Generates a **subclass** at runtime          |
| Can proxy              | Interfaces only                             | Concrete classes (and interfaces)            |
| `final` class/method   | N/A (interfaces)                            | **Cannot** proxy `final` classes/methods (silently not intercepted) |
| Requires no-arg ctor?  | No                                          | Historically yes (CGLIB); ByteBuddy/Objenesis relax it |
| Interception point     | `InvocationHandler`                         | `MethodInterceptor` (calls `super` via `MethodProxy`) |
| Part of the JDK        | Yes (`java.lang.reflect`)                   | No — third-party lib (CGLIB largely unmaintained; ByteBuddy is the modern successor) |
| `private` methods      | Not intercepted                             | Not intercepted (not overridable)            |
| Self-invocation        | Not intercepted (call goes to raw target)   | Not intercepted (internal `this.foo()` bypasses proxy) |

**Spring's rule:** Spring AOP uses **JDK dynamic proxies** if the target implements at least one
interface; otherwise it uses **CGLIB**. You can force CGLIB with `proxyTargetClass=true`
(`@EnableAspectJAutoProxy(proxyTargetClass = true)`). Spring Boot defaults to CGLIB proxying since
Boot 2.0.

**The self-invocation gotcha (both mechanisms):** a proxy only intercepts calls that go *through* the
proxy reference. When one method of the target calls another method on `this` (e.g. `@Transactional`
method A calls method B on the same bean), the call does **not** pass through the proxy, so B's
advice (transaction, caching) is **not** applied. This is the #1 real-world proxy bug.

**Concrete failure and the fixes.** The caller holds `proxy`; the proxy wraps `target`. The call
chain shows exactly where advice is lost:

```java
@Service
class OrderService {
    @Transactional
    public void placeOrder(Order o) {
        save(o);            // this.save(o) -> raw target, BYPASSES the proxy
    }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void save(Order o) { /* expects its OWN new transaction */ }
}

// controller injects the PROXY, so the outer call is advised:
orderService.placeOrder(o);
//   proxy.placeOrder  -> [tx advice fires] -> target.placeOrder
//     target.save     -> plain this.save  -> [NO tx advice] -> REQUIRES_NEW never happens
```

`save`'s `REQUIRES_NEW` silently does nothing because `this.save(o)` never re-enters the proxy.
Three fixes, in order of cleanliness:

```java
// FIX 1 (best): move save() into its own bean so the call crosses a proxy boundary.
class OrderService { @Transactional void placeOrder(Order o){ saver.save(o); } }  // saver is a separate proxied bean

// FIX 2: self-inject the proxy and call through it.
@Autowired @Lazy private OrderService self;
public void placeOrder(Order o){ self.save(o); }   // self IS the proxy -> advice fires

// FIX 3: grab the current proxy explicitly (needs exposeProxy=true).
((OrderService) AopContext.currentProxy()).save(o);
```

Each fix routes the inner call *back through the proxy reference* so the interceptor runs.

Modern successor: **ByteBuddy** has largely replaced CGLIB (Hibernate, Mockito, Spring's repackaged
CGLIB all moved to or bundle ByteBuddy) because CGLIB struggles on modern JDKs. All of these still
share the subclassing limitation regarding `final`.

---

## Performance and when to avoid reflection

Reflection is slower and less safe than direct calls; the gap has narrowed but not vanished.

**Why reflection is slower:**
1. **Access checks & lookup** — resolving `Method`/`Field` objects by name and validating access.
2. **Boxing** — `Method.invoke` takes/returns `Object`, so primitives are autoboxed each call
   (allocation + GC pressure), and args go through an `Object[]`.
3. **No inlining (historically)** — reflective calls were opaque to the JIT, blocking inlining and
   escape analysis. Modern HotSpot inflates hot reflective calls into generated bytecode accessors,
   which helps a lot but still trails direct/`MethodHandle` calls.
4. **Varargs array allocation** for arguments.

**Internal evolution (be precise):** In **JDK 18 (JEP 416)** the core reflection implementation
(`Method`, `Constructor`, `Field`) was **re-implemented on top of `MethodHandle`s**, removing the
old bytecode-generating "inflation" machinery and the `sun.reflect.*` generated accessor classes.
Semantics are unchanged; startup and maintainability improved.

**How much slower, concretely (approximate, warmed-up HotSpot):**

| Operation                                   | Rough cost per call | Notes                              |
|---------------------------------------------|---------------------|------------------------------------|
| Direct call `svc.hello(x)`                  | ~1 ns               | JIT inlines it                     |
| `MethodHandle.invokeExact` (resolved once)  | ~1–2 ns             | near direct; JIT-friendly          |
| Cached `Method.invoke` (warmed, `setAccessible` done) | ~5–10 ns  | boxing + `Object[]` overhead       |
| **Un**cached `getMethod(...)` lookup per call | ~hundreds of ns to µs | the lookup dominates everything    |

The takeaway to say out loud: **lookup cost >> invocation cost.** Trace a loop of 1,000,000 calls
on a method whose reflective lookup costs ~500 ns and whose cached invoke costs ~5 ns:

- **Look up every iteration:** 1,000,000 × (500 ns + 5 ns) = 505,000,000 ns ≈ **505 ms**.
- **Look up once, cache the `Method`, invoke in the loop:** 500 ns + 1,000,000 × 5 ns
  = 5,000,500 ns ≈ **5 ms**.

That is a **~100× speedup** from a single change — hoisting `getMethod` out of the loop — with no
change to the call itself. Reflection's bad reputation is mostly *repeated lookups*, not invocation.

> [!KEY-TAKEAWAY]
> If asked "how do I make reflection fast?", the first answer is *cache the `Method`/`Field`
> object and call `setAccessible(true)` once*; the second is *use a `MethodHandle`/`VarHandle`
> resolved once*. Never resolve inside a hot loop.

**Faster alternatives, in rough order of preference:**
- **`java.lang.invoke.MethodHandle` / `VarHandle`** (Java 7 / Java 9): resolved once, then close to
  direct-call speed because they're JIT-friendly. `VarHandle` (JEP 193, Java 9) is the modern
  replacement for field reflection and `sun.misc.Unsafe` field access.
- **`LambdaMetafactory`** — convert a `MethodHandle` into a functional-interface lambda once; repeated
  calls are essentially direct. Used by high-performance mappers.

**Worked snippet — resolve once, call many.** The fast pattern is: pay the lookup cost a single
time outside the loop, then invoke the handle repeatedly.

```java
// MethodHandle: resolve String.length() once, then call it hot.
MethodHandles.Lookup lk = MethodHandles.lookup();
MethodType mt = MethodType.methodType(int.class);          // returns int, no args
MethodHandle len = lk.findVirtual(String.class, "length", mt);  // one-time lookup
for (String s : words) {
    int n = (int) len.invokeExact(s);   // ~direct-call speed, no boxing of the receiver
}

// VarHandle: field get without reflective Field boxing (Java 9+).
VarHandle COUNT = MethodHandles
    .privateLookupIn(Counter.class, MethodHandles.lookup())
    .findVarHandle(Counter.class, "count", int.class);      // one-time
int c = (int) COUNT.get(counterInstance);                    // fast field read
```

Contrast with the reflective equivalent shown earlier (`f.get(target)` returning `Object`, which
autoboxes the `int` every call). `invokeExact` returns the primitive directly with **no allocation**,
which is why `MethodHandle`/`VarHandle` sit near the top of the speed table above.
- **Caching `Method`/`Field` objects** — never look them up per call; resolve once, call
  `setAccessible(true)` once, reuse. Most of reflection's cost is in lookup, not invocation.
- **Compile-time code generation** (annotation processors: MapStruct, Dagger) — zero runtime
  reflection at all; also the only approach that works cleanly with GraalVM native image.

**When to AVOID reflection:**
- **Hot paths / tight loops** — per-element reflective access in a serializer inner loop.
- **GraalVM native image / AOT** — runtime reflection needs explicit `reflect-config.json`
  registration and is fragile; prefer compile-time generation.
- **When type-safety matters** — reflection defers all errors to runtime; a rename that a compiler
  would catch becomes a `NoSuchMethodException` in production.
- **When a simpler design exists** — interfaces, generics, functional interfaces, or a
  `Map<String, Supplier<T>>` factory usually beat "reflect on a class name from config."
- **Security-sensitive contexts** — `setAccessible` breaks encapsulation and can expose internals.

**When reflection is the right tool:** frameworks doing DI/ORM/serialization, test runners,
plugin systems loading classes by name, and generic tooling — anywhere the types genuinely aren't
known at compile time and the call is not in a micro-hot path.

---

## Common interview follow-up questions

1. What is the difference between `getMethods()` and `getDeclaredMethods()`? Which one sees inherited
   and which sees private members?
2. Why does `Class.forName("X")` run static initializers but `X.class` does not?
3. An annotation you wrote isn't visible to your framework at runtime. What's the most likely cause?
   (Answer: missing `@Retention(RUNTIME)`; default is `CLASS`.)
4. Explain `InvocationTargetException` — why is it wrapping your real exception?
5. Why can a JDK dynamic proxy only proxy interfaces, and what does Spring do when the bean has no
   interface?
6. Explain the self-invocation problem with `@Transactional` / `@Cacheable`. Why doesn't the advice fire?
7. What is `InaccessibleObjectException` and what changed in Java 9 / 16 / 17 around
   `setAccessible` and `--illegal-access`?
8. Difference between `exports` and `opens` in `module-info.java`?
9. Difference between annotation processing (JSR 269) and runtime reflection? Which works with GraalVM
   native image?
10. What's faster than `Method.invoke` and why — `MethodHandle`, `VarHandle`, `LambdaMetafactory`?
11. Which JDK re-implemented core reflection on top of method handles? (JDK 18, JEP 416.)
12. Can you proxy a `final` method with CGLIB? What happens? (No — it's silently not intercepted.)
13. What does `@Inherited` do, and what are its limitations (types only, not interfaces/methods)?
14. What is `TYPE_USE` (Java 8) and what does it enable?

---

## References

- JEP 261: Module System (JPMS) — https://openjdk.org/jeps/261
- JEP 396: Strongly Encapsulate JDK Internals by Default (JDK 16) — https://openjdk.org/jeps/396
- JEP 403: Strongly Encapsulate JDK Internals (JDK 17; makes `--illegal-access` obsolete/ignored — the flag was removed outright in JDK 22) — https://openjdk.org/jeps/403
- JEP 416: Reimplement Core Reflection with Method Handles (JDK 18) — https://openjdk.org/jeps/416
- JEP 193: Variable Handles (`VarHandle`, JDK 9) — https://openjdk.org/jeps/193
- JSR 269: Pluggable Annotation Processing API — https://jcp.org/en/jsr/detail?id=269
- JSR 308 / Java 8: Type Annotations (`TYPE_USE`, `TYPE_PARAMETER`)
- `java.lang.reflect.Proxy` API docs — https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/reflect/Proxy.html
- `InvocationHandler.invokeDefault` (Java 16) — https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/reflect/InvocationHandler.html
- Java Language Specification, Ch. 9.6 (Annotation Types) — https://docs.oracle.com/javase/specs/
- Spring Framework docs: AOP proxying mechanisms — https://docs.spring.io/spring-framework/reference/core/aop/proxying.html
- Byte Buddy documentation — https://bytebuddy.net
