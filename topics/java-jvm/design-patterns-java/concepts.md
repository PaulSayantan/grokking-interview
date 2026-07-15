# Design Patterns (framework-relevant)

Design patterns are reusable, named solutions to recurring design problems, catalogued
by the "Gang of Four" (GoF) — Gamma, Helm, Johnson, Vlissides — in *Design Patterns:
Elements of Reusable Object-Oriented Software* (1994). For Java interviews the value is
twofold: (1) you can name and correctly apply the classic patterns, and (2) you can point
to where the JDK and frameworks like Spring actually use them, and where a **modern Java
feature** (lambdas, records, sealed classes, enums) is now the idiomatic replacement.

This guide layers each pattern: a beginner definition and motivation, intermediate usage
and comparisons, then advanced internals, edge cases, and gotchas. Version-specific
language features are tagged with the JDK that finalized them.

---

## Singleton pattern including enum and double-checked locking

**Definition (beginner).** Singleton guarantees a class has exactly one instance and
provides a global access point to it. Used for stateless services, registries, caches,
loggers, and config holders where creating more than one instance is wasteful or wrong.

**Why it is controversial.** A singleton is effectively global mutable state. It hurts
testability (hard to mock/replace), hides dependencies, and can create hidden coupling.
In modern code, a **DI container-managed singleton bean** (Spring) is usually preferable
to a hand-rolled `getInstance()` because the container owns the lifecycle and you inject
the dependency rather than reaching for a global.

**Implementations, from worst to best:**

1. **Eager initialization** — simplest and thread-safe (class init is guaranteed
   thread-safe by the JVM), but the instance is created even if never used.

   ```java
   public final class Config {
       private static final Config INSTANCE = new Config();
       private Config() {}
       public static Config getInstance() { return INSTANCE; }
   }
   ```

2. **Lazy with synchronized method** — thread-safe but every call pays lock cost.

3. **Double-Checked Locking (DCL)** — the classic "clever" version. The `volatile`
   keyword is **mandatory**; without it a partially constructed object can be visible to
   another thread due to instruction reordering. DCL only became reliably correct after
   the Java 5 memory model (JSR-133) fixed `volatile` semantics.

   ```java
   public final class Config {
       private static volatile Config instance;   // volatile is REQUIRED
       private Config() {}
       public static Config getInstance() {
           Config result = instance;               // local read = single volatile read
           if (result == null) {
               synchronized (Config.class) {
                   result = instance;
                   if (result == null) {
                       instance = result = new Config();
                   }
               }
           }
           return result;
       }
   }
   ```

4. **Initialization-on-demand holder idiom** — lazy AND lock-free, using the JVM's
   guarantee that a nested class is initialized only when first referenced. Preferred
   lazy approach for its simplicity.

   ```java
   public final class Config {
       private Config() {}
       private static class Holder { static final Config INSTANCE = new Config(); }
       public static Config getInstance() { return Holder.INSTANCE; }
   }
   ```

5. **Enum singleton** — Joshua Bloch's recommended approach (*Effective Java*, Item 3).
   A single-element enum is concise, thread-safe on init, and **the only approach that is
   serialization-safe and reflection-safe by default**. Ordinary singletons can be broken
   by reflection (`setAccessible(true)` on the private constructor) and by serialization
   (deserialization creates a new instance unless you implement `readResolve()`).

   ```java
   public enum Config {
       INSTANCE;
       public void load() { /* ... */ }
   }
   ```

**Advanced gotchas.**
- A singleton loaded by two different classloaders yields two instances — the "singleton"
  guarantee is per-classloader, not per-JVM.
- `readResolve()` must return the canonical instance and fields that must not be
  re-created should be `transient` to defend against serialization attacks; enums avoid
  all of this.
- DCL on a non-`volatile` field is a real, subtle bug — a favorite interview trap.

---

## Factory method and abstract factory

**Definition (beginner).** A **factory** encapsulates object creation so callers depend on
an interface rather than a concrete constructor. Two GoF patterns are commonly conflated:

- **Factory Method**: define a method (often abstract) that subclasses override to decide
  which concrete type to instantiate. Creation is deferred to subclasses.
- **Abstract Factory**: an object that creates *families* of related products
  (e.g. a `GUIFactory` producing matching `Button` + `Checkbox` for a theme).

A **simple/static factory** (not a formal GoF pattern) is just a static method returning
an instance, e.g. `Integer.valueOf(int)`, `List.of(...)`, `Optional.of(x)`.

**Why use it.** Decouples client code from concrete classes, centralizes construction
logic, enables caching/pooling (`Integer.valueOf` caches -128..127), and lets you return a
subtype or a cached instance rather than always `new`.

**Static factory advantages over constructors** (*Effective Java* Item 1):
- They have meaningful names (`BigInteger.probablePrime` vs an overloaded constructor).
- They are not required to create a new object each call (instance control, flyweight).
- They can return any subtype of their return type (interface-based APIs).
- The returned class can vary by call, even by input parameters.

```java
interface Payment { void pay(long cents); }

// Factory Method: subclass decides the product
abstract class Checkout {
    abstract Payment createPayment();          // factory method
    void process(long cents) { createPayment().pay(cents); }
}
```

**JDK / Spring examples.** `Calendar.getInstance()`, `NumberFormat.getInstance()`,
`DriverManager.getConnection()`, `LoggerFactory.getLogger()`. Spring's entire
`BeanFactory`/`ApplicationContext` is an abstract-factory-like container;
`FactoryBean<T>` lets a bean itself be a factory.

**Gotcha.** Overusing factories for objects that have no polymorphism or variation is
over-engineering — a plain constructor or a record is clearer.

---

## Builder pattern

**Definition (beginner).** Builder separates the construction of a complex object from its
representation, letting you build it step by step and produce an immutable result. Solves
the **telescoping constructor** anti-pattern (many overloaded constructors) and the
**JavaBeans setter** anti-pattern (mutable, can be left in an inconsistent half-built
state).

```java
public final class HttpRequest {
    private final String url;         // required
    private final String method;      // optional, default GET
    private final Map<String,String> headers;
    private HttpRequest(Builder b) {
        this.url = b.url; this.method = b.method; this.headers = b.headers;
    }
    public static Builder builder(String url) { return new Builder(url); }

    public static final class Builder {
        private final String url;
        private String method = "GET";
        private final Map<String,String> headers = new HashMap<>();
        private Builder(String url) { this.url = Objects.requireNonNull(url); }
        public Builder method(String m) { this.method = m; return this; }   // fluent
        public Builder header(String k, String v) { headers.put(k, v); return this; }
        public HttpRequest build() { return new HttpRequest(this); }
    }
}
```

**Intermediate points.**
- The fluent methods return `this` (or `Builder`) to enable chaining.
- Validation belongs in `build()` so an invalid object is never constructed.
- Great when there are many optional parameters, or when the object must be immutable.

**JDK examples.** `StringBuilder`, `Stream.Builder`, `java.time`'s fluent APIs, and the
JDK 11 `java.net.http.HttpRequest.newBuilder()` (an actual GoF builder in the standard
library).

**Advanced: builder + generics for inheritance.** *Effective Java* Item 2 shows a
recursive generic "simulated self-type" `abstract class Builder<T extends Builder<T>>` so
subclass builders return the right type from chained calls.

**Records vs builder (since JDK 16).** A `record` gives you an immutable carrier with a
canonical constructor for free, but records have **no builder and no optional-parameter
ergonomics** — every component must be supplied positionally. For a handful of fields a
record is better; for many optional fields, keep the builder (you can even nest a builder
that produces a record). Lombok's `@Builder` generates the boilerplate builder for you.

---

## Adapter pattern

**Definition (beginner).** Adapter converts the interface of a class into another
interface clients expect, letting incompatible types work together — the "power plug
adapter." Also called Wrapper.

Two forms:
- **Object adapter** (composition, preferred in Java): the adapter *holds* an instance of
  the adaptee and delegates.
- **Class adapter** (inheritance): the adapter *extends* the adaptee — limited in Java
  because of single inheritance.

```java
// Adaptee: legacy API
class LegacyLogger { void writeLine(String s) { /* ... */ } }

// Target interface the client wants
interface Logger { void log(String level, String msg); }

// Object adapter
class LegacyLoggerAdapter implements Logger {
    private final LegacyLogger adaptee;
    LegacyLoggerAdapter(LegacyLogger a) { this.adaptee = a; }
    public void log(String level, String msg) { adaptee.writeLine(level + ": " + msg); }
}
```

**JDK examples.** `Arrays.asList(array)` adapts an array to a `List`;
`java.io.InputStreamReader` adapts a byte `InputStream` to a character `Reader`;
`Collections.list(Enumeration)` adapts the old `Enumeration` to a `List`.

**Adapter vs Decorator vs Proxy vs Facade (common exam confusion).**
- **Adapter** changes an interface (different interface, same functionality).
- **Decorator** keeps the same interface but adds behavior.
- **Proxy** keeps the same interface but controls access.
- **Facade** provides a simpler interface over a complex subsystem.

---

## Decorator pattern

**Definition (beginner).** Decorator attaches additional responsibilities to an object
dynamically by wrapping it in another object that implements the **same interface** and
delegates to the wrapped instance. A flexible alternative to subclassing for extending
behavior.

```java
interface DataSource { void write(String data); }

class FileDataSource implements DataSource {
    public void write(String data) { /* write raw */ }
}

abstract class DataSourceDecorator implements DataSource {
    protected final DataSource wrappee;
    protected DataSourceDecorator(DataSource d) { this.wrappee = d; }
}

class EncryptionDecorator extends DataSourceDecorator {
    EncryptionDecorator(DataSource d) { super(d); }
    public void write(String data) { wrappee.write(encrypt(data)); }
    private String encrypt(String s) { /* ... */ return s; }
}

// Usage: stack decorators
DataSource ds = new EncryptionDecorator(new FileDataSource());
```

**The canonical JDK example is `java.io`.** `new BufferedReader(new InputStreamReader(
new FileInputStream(file)))` stacks decorators, each adding buffering, char decoding, etc.
`Collections.unmodifiableList` / `synchronizedList` are decorators that add access control
around the same `List` interface.

**Decorator vs inheritance.** Subclassing is static (compile time) and can cause a
combinatorial class explosion (`BufferedEncryptedCompressedStream`...). Decorators compose
at runtime, one responsibility per wrapper.

**Gotcha.** Decorators break object identity (`wrapped != original`) and can make
debugging deep wrapper chains hard; `equals`/`hashCode` may not propagate as expected.

---

## Proxy pattern

**Definition (beginner).** Proxy provides a surrogate/placeholder for another object to
control access to it, keeping the same interface. Common flavors: **virtual proxy** (lazy
init of an expensive object), **protection proxy** (access control), **remote proxy**
(stand-in for a remote object, e.g. RMI stubs), and **smart proxy** (logging, ref
counting, caching).

**Dynamic proxies in the JDK.** `java.lang.reflect.Proxy.newProxyInstance(...)` creates,
at runtime, a class implementing given interfaces, routing every method through an
`InvocationHandler`. This is **interface-based** only.

```java
Foo proxy = (Foo) Proxy.newProxyInstance(
    Foo.class.getClassLoader(),
    new Class<?>[]{ Foo.class },
    (p, method, args) -> {
        long t = System.nanoTime();
        Object r = method.invoke(realTarget, args);   // delegate
        log(method.getName(), System.nanoTime() - t);
        return r;
    });
```

**Spring AOP uses proxies heavily.** Spring wraps beans in proxies to implement
`@Transactional`, `@Async`, `@Cacheable`, security, etc. It uses **JDK dynamic proxies**
when the bean implements an interface, and **CGLIB** (subclass-based bytecode proxy) when
it does not. Key gotcha: because these are proxies, a **self-invocation** (`this.method()`
calling another `@Transactional` method in the same class) bypasses the proxy, so the
advice (e.g. the transaction) does **not** apply. `final` classes/methods can't be
CGLIB-proxied.

**Proxy vs Decorator.** Structurally similar (both wrap and delegate on the same
interface). Intent differs: decorator *adds behavior*; proxy *controls access* (and often
manages the target's lifecycle, which a decorator does not).

---

## Strategy pattern

**Definition (beginner).** Strategy defines a family of interchangeable algorithms,
encapsulates each, and makes them swappable at runtime behind a common interface. Lets you
vary the algorithm independently of the client that uses it (favor composition over
inheritance / conditionals).

```java
interface DiscountStrategy { long apply(long cents); }

class Cart {
    private DiscountStrategy strategy;
    void setStrategy(DiscountStrategy s) { this.strategy = s; }
    long checkout(long cents) { return strategy.apply(cents); }
}
```

**JDK example.** `Comparator` passed to `Collections.sort`/`Stream.sorted` is a strategy;
`ThreadPoolExecutor`'s `RejectedExecutionHandler` is a pluggable strategy.

**Functional replacement (since Java 8).** When a strategy interface is a single abstract
method (a **functional interface**), you no longer need a concrete class per strategy — a
**lambda or method reference** *is* the strategy. This is the most important "modern Java
replaces a pattern" point in interviews.

```java
// OLD way: a class per strategy
cart.setStrategy(new PercentDiscount(10));
// NEW way (Java 8+): lambda IS the strategy
cart.setStrategy(cents -> cents * 90 / 100);
// Or a Map<String, DiscountStrategy> of lambdas replaces a switch
Map<String, DiscountStrategy> strategies = Map.of(
    "none", c -> c,
    "black-friday", c -> c / 2);
```

Strategy, Command, and Template Method with a single hook are all frequently collapsed
into lambdas / functional interfaces (`Function`, `Consumer`, `Supplier`, `Runnable`).

---

## Observer pattern

**Definition (beginner).** Observer defines a one-to-many dependency so that when one
object (the subject/observable) changes state, all its dependents (observers) are notified
automatically. Basis of event handling and publish-subscribe.

```java
interface Observer { void update(String event); }
class Subject {
    private final List<Observer> observers = new CopyOnWriteArrayList<>();
    void subscribe(Observer o) { observers.add(o); }
    void publish(String event) { observers.forEach(o -> o.update(event)); }
}
```

**Deprecations you must know.** `java.util.Observer` and `java.util.Observable` were
**deprecated in Java 9** — they are not generic, `Observable` is a class (forcing
inheritance), and the notification order/threading is unspecified. Do NOT cite them as the
recommended approach; use listeners, `PropertyChangeListener`, an event bus, or reactive
streams instead.

**Modern replacements.**
- Simple: a `List<Consumer<Event>>` of lambda listeners.
- Reactive: `java.util.concurrent.Flow` (the Reactive Streams API, **added in Java 9**)
  with `Publisher`/`Subscriber`/`Subscription`/`Processor` and backpressure; or libraries
  like Project Reactor / RxJava.
- Spring's `ApplicationEventPublisher` + `@EventListener`.

**Gotchas.** Notifying while iterating can throw `ConcurrentModificationException` if an
observer unsubscribes during notification — hence `CopyOnWriteArrayList`. Strong references
to observers cause **lister leaks** (memory leaks); consider weak references or explicit
unsubscription. Synchronous notification means a slow observer blocks the subject.

---

## Template method pattern

**Definition (beginner).** Template Method defines the skeleton of an algorithm in a base
method, deferring some steps to subclasses via overridable hook methods. The overall
sequence is fixed; specific steps vary. Uses inheritance and the **Hollywood Principle**:
"don't call us, we'll call you."

```java
abstract class HttpServletBase {
    // template method: fixed skeleton, calls overridable hooks
    public final void service(Request req, Response res) {
        if (req.method().equals("GET")) doGet(req, res);
        else if (req.method().equals("POST")) doPost(req, res);
    }
    protected void doGet(Request req, Response res) { /* default 405 */ }
    protected void doPost(Request req, Response res) { /* default 405 */ }
}
```

**JDK / framework examples.** `java.util.AbstractList`/`AbstractMap` (you implement `get`
and `size`, the base gives you `iterator`, `contains`, etc.); `HttpServlet.service()`
dispatching to `doGet`/`doPost`; Spring's `JdbcTemplate`, `RestTemplate`,
`TransactionTemplate` — you supply the varying callback, the template owns
open/execute/close/exception-translation. The template method itself is often `final` so
subclasses can't break the invariant sequence.

**Template Method vs Strategy.** Template Method uses **inheritance** (compile-time, one
fixed structure, override protected steps); Strategy uses **composition** (runtime-
swappable whole algorithm). Spring's `*Template` classes combine both: a template method
skeleton that takes a strategy callback (often a lambda since Java 8).

---

## Patterns in Spring and the JDK

A quick map of where the standard library and Spring embed these patterns — high-value for
"where have you seen this?" interview questions.

| Pattern | JDK example | Spring example |
|---|---|---|
| Singleton | `Runtime.getRuntime()`, enum constants | default bean scope is **singleton** (one per container) |
| Factory | `Calendar.getInstance()`, `List.of`, `valueOf` | `BeanFactory`, `FactoryBean`, `@Bean` methods |
| Builder | `StringBuilder`, `HttpRequest.newBuilder()` (JDK 11) | `BeanDefinitionBuilder`, `UriComponentsBuilder` |
| Adapter | `Arrays.asList`, `InputStreamReader` | `HandlerAdapter` in Spring MVC |
| Decorator | `java.io` streams, `Collections.synchronizedList` | `BeanPostProcessor` wrapping, `HttpServletRequestWrapper` |
| Proxy | `java.lang.reflect.Proxy`, RMI stubs | AOP proxies for `@Transactional`/`@Async`/`@Cacheable` |
| Strategy | `Comparator`, `RejectedExecutionHandler` | `Resource` loading strategies, `PlatformTransactionManager` |
| Observer | `java.util.concurrent.Flow` (JDK 9) | `ApplicationEvent` + `@EventListener` |
| Template Method | `AbstractList`, `HttpServlet.service` | `JdbcTemplate`, `RestTemplate`, `TransactionTemplate` |

**Spring bean scope nuance.** "Singleton" in Spring means **one instance per
`ApplicationContext`**, not one per JVM/classloader as the GoF pattern implies. Prototype
scope creates a new instance per lookup. Spring singletons are created eagerly at startup
by default (unless `@Lazy`).

**Spring proxy nuance (repeat, it's a classic follow-up).** JDK dynamic proxy needs an
interface; CGLIB subclass proxy is used otherwise. Self-invocation bypasses the proxy;
`final`/`private`/`static` methods aren't advised.

---

## Anti-patterns and over-engineering

**Definition.** An anti-pattern is a commonly-used but counter-productive "solution." A
pattern applied where it adds no value is itself an anti-pattern (over-engineering).

Common anti-patterns to recognize and critique in interviews:
- **God object / Blob** — one class that knows/does everything; violates single
  responsibility.
- **Singleton abuse** — global mutable state masquerading as design; hurts testability
  and hides dependencies. Often better handled by DI.
- **Anemic domain model** — data classes with only getters/setters and all logic in
  "service" classes; discussed by Martin Fowler as an anti-pattern to rich OO design.
- **Poltergeist** — short-lived classes that only pass control to others.
- **Golden hammer** — forcing one favorite pattern everywhere ("everything is a factory").
- **Yo-yo problem / deep inheritance** — excessive inheritance forcing constant navigation
  up and down a hierarchy; favor composition.
- **Premature abstraction / speculative generality** — interfaces and factories "just in
  case," adding indirection with no current benefit (YAGNI violation).

**When a pattern adds value vs over-engineering.**
- Add the pattern when there is *real, present* variation, a testability/decoupling need,
  or a maintenance pain the pattern removes.
- Skip it when a plain constructor, a record, an enum, or a lambda expresses the intent
  more directly. Two examples: a single-implementation "Strategy" interface is just
  indirection — inline it or use a lambda; a factory for a class that never varies is
  ceremony.
- Modern Java often *dissolves* patterns: **lambdas** replace many Strategy/Command
  classes; **records** (final in JDK 16) replace hand-written immutable value objects and
  many Builder cases; **sealed classes** (final in JDK 17) + **pattern matching for
  switch** (final in JDK 21) replace some Visitor/double-dispatch designs with exhaustive
  switches; **enums** are the best Singleton.

---

## Common interview follow-up questions

1. Why is `volatile` required in double-checked locking, and what bug appears without it?
2. Why is the enum the best singleton — what two attacks does it defend against that a
   classic singleton does not?
3. What does "singleton" mean in Spring, and how does it differ from the GoF singleton?
4. When does Spring use a JDK dynamic proxy vs CGLIB, and why does `@Transactional`
   self-invocation silently do nothing?
5. Adapter vs Decorator vs Proxy vs Facade — the intent differences.
6. Show how `java.io` is a Decorator and why decorators beat subclass explosion.
7. How do lambdas replace the Strategy and Command patterns since Java 8? When would you
   still write a named strategy class?
8. Why were `java.util.Observable`/`Observer` deprecated (Java 9) and what replaces them?
9. Template Method vs Strategy — inheritance vs composition trade-offs; how does
   `JdbcTemplate` combine both?
10. When is applying a design pattern over-engineering? Give a concrete example where a
    record/enum/lambda is better than the classic pattern.
11. Records vs Builder — when do you still need a builder in JDK 16+?
12. How can sealed classes (JDK 17) + pattern matching for switch (JDK 21) replace a
    Visitor?

## References

- Gamma, Helm, Johnson, Vlissides — *Design Patterns: Elements of Reusable OO Software*
  (GoF, 1994).
- Joshua Bloch — *Effective Java, 3rd ed.*: Item 1 (static factory), Item 2 (builder),
  Item 3 (singleton via private constructor or enum).
- JSR-133: Java Memory Model (Java 5) — the fix that makes `volatile`-based DCL correct.
- JEP 395: Records (final in JDK 16). JEP 409: Sealed Classes (final in JDK 17).
- JEP 441: Pattern Matching for switch (final in JDK 21). JEP 440: Record Patterns
  (final in JDK 21).
- `java.util.concurrent.Flow` — Reactive Streams API, added in JDK 9.
- `java.util.Observable`/`java.util.Observer` — deprecated in JDK 9 (JDK-8154801).
- Spring Framework Reference — Core (IoC container, bean scopes), AOP (proxying
  mechanisms: JDK dynamic proxies vs CGLIB), Data Access (`JdbcTemplate`).
- `java.lang.reflect.Proxy` and `java.net.http.HttpRequest.Builder` (JDK 11) API docs.
- Martin Fowler — "AnemicDomainModel".
