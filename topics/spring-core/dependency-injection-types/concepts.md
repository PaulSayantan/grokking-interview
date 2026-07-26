# Dependency Injection Types

Dependency Injection (DI) is the mechanism at the heart of the Spring Framework's core
container. This note covers what DI and Inversion of Control (IoC) are, the three ways to
express DI in Spring (constructor, setter, field), the trade-offs between them, why the Spring
team recommends constructor injection, when setter injection is appropriate, why field
injection is discouraged, method injection for mismatched bean scopes, and how to inject
collections and maps.

> Scope note: This is about the **Spring Framework** core container
> (`spring-core`, `spring-beans`, `spring-context`), not Spring Boot. There is no
> auto-configuration or starter machinery here — just the `ApplicationContext`,
> `BeanFactory`, and the annotations/XML that drive wiring. Package note: Spring Framework 6.x
> baselines on **Jakarta EE 9+** (`jakarta.*`), so `@Inject`/`@Resource` now come from
> `jakarta.inject` / `jakarta.annotation`; Spring 5.x and earlier used `javax.*`.

## IoC and Dependency Injection

You don't build your own power plant to run a toaster — you plug into a socket and the grid
supplies the power. DI is that socket, and the container is the grid: your class just declares
"I need a `PaymentGateway`" and something outside hands one in. The pain it removes is concrete:
before DI, every class `new`-ed its own collaborators, so a class that talked to a database
dragged a *real* database into every unit test — you couldn't swap in a fake. Handing wiring to
the container makes collaborators pluggable and tests trivial.

**Inversion of Control (IoC)** is a general design principle: instead of a component
constructing or looking up its own collaborators, control over object creation and wiring is
handed to an external entity (a container or framework). "Inversion" refers to the fact that
the *flow of control* for obtaining dependencies is reversed compared to traditional
programming, where an object calls `new` or a factory/service-locator itself.

**Dependency Injection (DI)** is the most common *implementation* of IoC. With DI, an object's
dependencies are *supplied to it* (injected) by the container rather than the object creating
or locating them. DI is a specialization of IoC — every DI mechanism is IoC, but IoC can also
be achieved by other patterns such as the Service Locator pattern, factory methods, or template
methods.

Key relationship to remember:

- **IoC** = the principle (control is inverted / given to the container).
- **DI** = a specific technique that realizes IoC by injecting collaborators.
- **Service Locator** = an alternative IoC technique where the object *pulls* dependencies from
  a registry. DI *pushes* dependencies in, which is generally preferred because dependencies
  become explicit and testable, and the class does not depend on the locator API.

In Spring, the **IoC container** is represented by the `BeanFactory` interface and its richer
sub-interface `ApplicationContext`. The container reads configuration metadata (annotations,
Java `@Configuration` classes, or XML), instantiates the beans, and injects their dependencies
according to that metadata. This is why Spring is often called an "IoC container" or "DI
container."

```java
// WITHOUT DI: the class controls its own dependency (tight coupling)
public class OrderService {
    private final PaymentGateway gateway = new StripePaymentGateway(); // hard-wired
}

// WITH DI: the container supplies the dependency (loose coupling)
public class OrderService {
    private final PaymentGateway gateway;
    public OrderService(PaymentGateway gateway) { // container injects the collaborator
        this.gateway = gateway;
    }
}
```

Benefits of DI: loose coupling, easier unit testing (pass in mocks/stubs), clearer dependency
contracts, easier swapping of implementations, and centralized configuration.

## Constructor Injection

**Constructor injection** supplies dependencies as arguments to the bean's constructor. The
container resolves and provides each argument when it instantiates the bean.

```java
@Component
public class OrderService {
    private final PaymentGateway gateway;
    private final InventoryRepository inventory;

    // Since Spring 4.3, @Autowired is OPTIONAL if the class has exactly one constructor.
    public OrderService(PaymentGateway gateway, InventoryRepository inventory) {
        this.gateway = gateway;
        this.inventory = inventory;
    }
}
```

Important details:

- **Single-constructor rule (Spring 4.3+):** if a class has exactly one constructor, you do not
  need `@Autowired` — Spring will use it automatically for autowiring. With multiple
  constructors, you must annotate exactly one with `@Autowired` (or mark it via
  `@Autowired(required=false)` combinations), otherwise Spring uses the default/no-arg
  constructor if present.
- Dependencies can be declared `final`, which enforces immutability and guarantees they are set
  exactly once, at construction.
- The bean is **never in a partially-constructed state**: by the time the constructor returns,
  every required collaborator is present.
- XML equivalent uses `<constructor-arg>`; Java config passes arguments in the `@Bean` method.

```xml
<bean id="orderService" class="com.example.OrderService">
    <constructor-arg ref="paymentGateway"/>
    <constructor-arg ref="inventoryRepository"/>
</bean>
```

**Circular dependency caveat:** two beans that require each other via constructor injection
cannot both be constructed — Spring throws `BeanCurrentlyInCreationException` /
`UnsatisfiedDependencyException`. This is actually a useful early signal of a design problem.
(Setter/field injection can sometimes resolve circular references for singletons because Spring
can inject a not-yet-fully-initialized reference after construction, but circular dependencies
are still a design smell.)

**Multiple constructors and the greedy-matching algorithm.** When a class has more than one
constructor and none is annotated with `@Autowired` (and there is no no-arg constructor), Spring
in many cases can still pick a constructor, but the deterministic contract is: annotate exactly
one constructor with `@Autowired` to force it. A subtle, powerful pattern is annotating
*several* constructors with `@Autowired(required = false)`. Spring then treats them as
*candidates* and chooses the **greediest constructor whose dependencies can all be satisfied**
from the container — a form of constructor auto-selection. Exactly one `@Autowired` with
`required = true` (the default) forbids this multi-candidate behavior, because a required
constructor must be used.

Worked trace of the greedy selection:

```java
@Component
public class ReportBuilder {
    @Autowired(required = false)
    public ReportBuilder(DataSource ds, Formatter fmt) { ... } // 2-arg candidate
    @Autowired(required = false)
    public ReportBuilder(DataSource ds) { ... }                // 1-arg candidate
}
```

- **Container has only a `DataSource` bean (no `Formatter`):** Spring tries the 2-arg
  constructor first (greediest), can't satisfy `Formatter`, drops it, then tries the 1-arg
  constructor, satisfies `DataSource` → **picks `ReportBuilder(DataSource)`**.
- **Container has both a `DataSource` *and* a `Formatter` bean:** the 2-arg constructor is fully
  satisfiable, so Spring stops there → **picks `ReportBuilder(DataSource, Formatter)`**. It never
  falls back to the 1-arg one; "greediest *satisfiable*" means most parameters that still resolve.
- **Container has neither bean:** no candidate is satisfiable and there is no no-arg constructor →
  `UnsatisfiedDependencyException` at startup.

**Mixing injected beans and resolved values.** Constructor parameters can freely mix
container-resolved beans with `@Value`-resolved literals/SpEL and `@Qualifier`-narrowed
candidates. The parameter annotations (`@Value`, `@Qualifier`, `@Lazy`, `@Nullable`) sit on the
individual parameters:

```java
public OrderService(@Qualifier("stripe") PaymentGateway gateway,
                    @Value("${orders.max-retries:3}") int maxRetries,
                    @Nullable AuditSink auditSink) { ... }
```

**Static factory and `@Bean` methods** are the constructor-injection analogue in Java config:
the `@Bean` method parameters are resolved from the container exactly like constructor arguments.
Note that lookup-method injection (below) does **not** apply to `@Bean` methods, because there
the container is not the one invoking `new`.

## Setter Injection

**Setter injection** supplies dependencies through JavaBean-style setter methods after the bean
is instantiated with its no-arg (or otherwise resolved) constructor.

```java
@Component
public class ReportService {
    private FormatterConfig config;

    @Autowired // on multiple optional setters, mark each; single-arg setter
    public void setConfig(FormatterConfig config) {
        this.config = config;
    }
}
```

Key details:

- The container first constructs the bean, then calls the annotated setters to inject
  dependencies. The bean therefore exists in a partially-initialized state between construction
  and setter completion.
- Fields generally cannot be `final` (a setter must be able to assign them), so setter injection
  does not give you compile-time immutability.
- Setter injection is well-suited to **optional dependencies** and dependencies that may need to
  be **reconfigured/re-injected** later. You can combine it with `@Autowired(required = false)`
  or `@Nullable` to mark a dependency as optional.
- XML equivalent uses `<property>` elements, which are backed by setters.

```xml
<bean id="reportService" class="com.example.ReportService">
    <property name="config" ref="formatterConfig"/>
</bean>
```

Historically, the Spring reference documentation recommended setter injection for optional
dependencies with reasonable defaults and constructor injection for mandatory dependencies.

## Field Injection

**Field injection** places `@Autowired` (or `@Inject` / `@Resource`) directly on a field; Spring
sets the field value using reflection after the object is constructed.

```java
@Component
public class NotificationService {
    @Autowired
    private EmailClient emailClient; // injected reflectively; no constructor/setter needed
}
```

Key details:

- The most concise form — no constructor or setter boilerplate.
- Fields cannot be `final` (Spring assigns them reflectively after construction; a `final` field
  would have to be set in a constructor).
- Requires the Spring container (or reflection) to populate the field, which makes the class hard
  to instantiate and test **without** Spring — you cannot simply `new` the object and pass
  dependencies; you must use reflection, a test framework's field injection, or expose an
  alternative wiring path.
- Because dependencies are invisible in the public API, a class can silently accumulate many of
  them, hiding growing complexity (a class with 10 `@Autowired` fields looks fine but likely
  violates the Single Responsibility Principle).
- Modern IDEs and the Spring team flag field injection with warnings such as "Field injection is
  not recommended."

> [!INTERVIEW]
> Whichever annotation you place on the field/setter changes *how* Spring resolves it — a common
> probe. `@Autowired` (Spring) resolves **by type first**, then disambiguates by
> `@Qualifier`/`@Primary`/bean name. `@Resource` (JSR-250) resolves **by name first** (the field
> name, or an explicit `name=`), falling back to by-type only if no name matches. `@Inject`
> (JSR-330) behaves like `@Autowired` — **by type**, with `@Named` as the qualifier. Practical
> consequence: when two beans of the same type exist, `@Resource private EmailClient smtp;`
> sidesteps the ambiguity by matching the bean named `smtp` directly, whereas `@Autowired` there
> throws `NoUniqueBeanDefinitionException` unless you add a `@Qualifier`.

## Constructor vs Setter vs Field Injection

| Aspect | Constructor | Setter | Field |
|---|---|---|---|
| When injected | At instantiation | After construction, via setter | After construction, via reflection |
| Supports `final` / immutability | Yes | No | No |
| Good for mandatory deps | Yes (guaranteed present) | No (may be skipped) | Works but hides contract |
| Good for optional deps | Awkward (nullable args) | Yes | Possible via `required=false` |
| Testability without Spring | Easiest (`new` + pass mocks) | Easy (call setters) | Hard (needs reflection) |
| Partially-constructed bean risk | None | Yes | Yes |
| Boilerplate | Most | Medium | Least |
| Circular deps between singletons | Fails fast | Can be resolved | Can be resolved |
| `@Autowired` needed | Optional if single constructor (4.3+) | Yes on each setter | Yes on each field |

General guidance from the Spring team: **use constructor injection for mandatory dependencies**
and **setter injection for optional or changeable dependencies**; **avoid field injection** in
production code.

## Why Constructor Injection is Preferred

The Spring team and the wider community recommend constructor injection for required
dependencies. The main reasons:

1. **Immutability.** Dependencies can be declared `final`, so they are set exactly once and can
   never be reassigned. This makes objects safe to share and reason about, and is friendlier to
   concurrency.
2. **Mandatory dependencies are enforced.** A bean cannot be created without its required
   collaborators. There is no way to construct an object missing a dependency, so you fail at
   context-startup / construction time rather than later with a `NullPointerException`.
3. **No partially-constructed / partially-initialized beans.** As soon as the constructor
   returns, the object is fully and validly initialized. With setter/field injection there is a
   window where the object exists but some dependencies are still `null`.
4. **Testability.** You can instantiate the class in a plain unit test with `new
   OrderService(mockGateway, mockRepo)` — no Spring context, no reflection. This keeps unit tests
   fast and framework-independent.
5. **Explicit dependency contract / design feedback.** Constructor parameters make all
   dependencies visible in one signature. If the parameter list grows long, that is a clear code
   smell signaling the class does too much (violating SRP) — feedback that field injection hides.
6. **Fail-fast on circular dependencies.** Unresolvable constructor cycles throw at startup,
   surfacing a design problem immediately instead of allowing a fragile, half-wired graph.

Since Spring Framework 4.3, a class with a single constructor no longer needs `@Autowired`,
which removed most of the boilerplate objection to constructor injection. Combined with Lombok's
`@RequiredArgsConstructor` or Java records, constructor injection is now very concise.

```java
@Component
public class OrderService {
    private final PaymentGateway gateway;      // final -> immutable, mandatory
    private final InventoryRepository inventory;

    public OrderService(PaymentGateway gateway, InventoryRepository inventory) {
        this.gateway = gateway;
        this.inventory = inventory;
    }
}
// Plain unit test — no Spring needed:
// new OrderService(mockGateway, mockInventory);
```

## When to Use Setter Injection

Setter injection is the recommended choice for **optional dependencies** and dependencies that
may need to be **changed or re-injected after construction**. Typical cases:

- The dependency has a **reasonable default** and only sometimes needs to be overridden.
- The dependency is genuinely **optional** — mark it with `@Autowired(required = false)` or
  annotate the setter parameter with `@Nullable` so Spring skips it when no matching bean exists.
- The object may be **reconfigured at runtime** (JMX-exposed properties, re-settable
  configuration).
- Breaking a **circular dependency** between singleton beans where redesign is not immediately
  possible (setter injection lets Spring construct both beans first, then wire them).

```java
@Component
public class SearchService {
    private RankingStrategy ranking = new DefaultRankingStrategy(); // sensible default

    @Autowired(required = false) // optional: override only if a bean is present
    public void setRankingStrategy(RankingStrategy ranking) {
        this.ranking = ranking;
    }
}
```

A widely cited rule of thumb (from the Spring reference documentation): use constructor
arguments for mandatory dependencies and setters/configuration methods for optional dependencies.
A caution with setter injection is that a required dependency configured via a setter can be
forgotten, leaving the bean partially initialized; annotations like `@Required` (deprecated in
Spring 5.1) historically guarded against that.

## Why Field Injection is Discouraged

Field injection is convenient but discouraged in production code for several reasons:

1. **Hard to test without the container.** Because the field is set reflectively, you cannot
   simply `new` the class and pass a mock. Tests must either start a Spring context or use
   reflection utilities (e.g. `ReflectionTestUtils.setField`), which is fragile and verbose.
2. **Cannot be `final` / not immutable.** Field-injected dependencies must be mutable, so you
   lose the immutability and single-assignment guarantees of constructor injection.
3. **Hides the dependency contract.** Dependencies do not appear in any constructor or method
   signature. A class can accumulate many `@Autowired` fields, masking that it has too many
   responsibilities (SRP violation) — the compiler and API give no warning.
4. **Encourages too many dependencies.** Adding one more field is trivial, so field injection
   makes it easy to keep piling on collaborators; a long constructor parameter list would have
   made the bloat obvious.
5. **Tight coupling to the DI container.** The class becomes essentially unusable outside a DI
   framework that understands the injection annotation, because nothing else populates the fields.
6. **`null` risk / no fail-fast on plain instantiation.** If someone constructs the object
   outside Spring, every injected field is `null` and you get `NullPointerException`s at runtime
   rather than a clear failure at construction.

The single legitimate mainstream use is convenience in **test classes** and quick prototypes,
where the Spring test context is always present. Even there, constructor injection is often
cleaner.

## Method Injection

"Method injection" in Spring has two distinct meanings.

**(1) Injecting dependencies through an arbitrary configuration method.** Any method (not just a
JavaBean setter) annotated with `@Autowired` will be called by the container with its parameters
resolved from the context. This is really a generalization of setter injection.

```java
@Component
public class MovieRecommender {
    private CatalogService catalog;
    private CustomerPreferenceDao dao;

    @Autowired // multi-argument config method; both args resolved from the context
    public void prepare(CatalogService catalog, CustomerPreferenceDao dao) {
        this.catalog = catalog;
        this.dao = dao;
    }
}
```

**(2) Lookup Method Injection — solving the scope-mismatch problem.** This is the more
interview-relevant "method injection." When a **singleton** bean needs a **new instance** of a
shorter-lived bean (e.g. a `prototype`-scoped bean) *on every use*, plain injection fails:
because the singleton is wired only once, it always holds the *same* prototype instance,
defeating the prototype scope.

Lookup method injection solves this: you declare an abstract (or concrete) method that returns
the needed bean, and Spring dynamically overrides it (via CGLIB subclassing) so each call
returns a fresh instance from the container.

```java
public abstract class CommandManager {
    public Object process(Object cmdState) {
        Command command = createCommand(); // fresh prototype every call
        command.setState(cmdState);
        return command.execute();
    }
    // Spring overrides this at runtime to return a new "myCommand" bean each time.
    @Lookup("myCommand")
    protected abstract Command createCommand();
}
```

Notes:

- The container generates a runtime subclass (CGLIB) that overrides the lookup method — so the
  class/method must not be `final`, and the class must be instantiable (Spring cannot subclass a
  `final` class or override a `final`/`private`/`static` method).
- Alternatives to lookup method injection for the singleton-needs-prototype problem:
  injecting `ObjectProvider<Command>` (or `ObjectFactory`/`Provider`) and calling `getObject()`
  / `getIfAvailable()` per use, or injecting the `ApplicationContext` and calling `getBean()`
  (a form of the Service Locator pattern, generally discouraged).
- A related feature is **arbitrary method replacement** via `<replaced-method>` in XML, which
  replaces a method's implementation entirely — rarely used.

## Injecting Collections and Maps

Spring can inject collections of beans and value collections.

**Autowiring all beans of a type into a collection.** If you declare a `List`, `Set`, or
array of an interface type, Spring injects *all* beans that match that type:

```java
@Component
public class NotificationDispatcher {
    private final List<NotificationChannel> channels; // all NotificationChannel beans

    public NotificationDispatcher(List<NotificationChannel> channels) {
        this.channels = channels;
    }
}
```

- **Ordering.** The elements are ordered according to `@Order` / the `Ordered` interface, or by
  `@Priority`. Without ordering annotations, order is not guaranteed (though it often follows
  registration/declaration order). Use `@Order(n)` (lower value = higher precedence) to control it.
- **Map injection by bean name.** If you inject a `Map<String, SomeType>`, Spring populates it
  with all matching beans keyed by their **bean name**:

```java
@Autowired
private Map<String, NotificationChannel> channelsByName; // key = bean name, value = bean
```

- **Empty collection behavior.** By default, if there are no matching beans, autowiring a required
  collection fails with `NoSuchBeanDefinitionException`. Marking it optional
  (`@Autowired(required = false)`) yields an empty collection / no injection instead.

**Injecting literal collections defined in configuration.** You can also inject explicitly
configured collection values (not beans-by-type) using XML `<list>`, `<set>`, `<map>`, `<props>`
elements, or with `@Value` and SpEL / property placeholders for simple cases.

```xml
<bean id="tagService" class="com.example.TagService">
    <property name="defaultTags">
        <list>
            <value>urgent</value>
            <value>review</value>
        </list>
    </property>
    <property name="limits">
        <map>
            <entry key="max" value="100"/>
            <entry key="min" value="1"/>
        </map>
    </property>
</bean>
```

```java
// SpEL / property injection of collections and maps:
@Value("#{'${app.tags}'.split(',')}")
private List<String> tags;

@Value("#{${app.limits}}") // e.g. app.limits={max:100,min:1}
private Map<String, Integer> limits;
```

**Combining with `@Qualifier`.** When injecting a single bean but several candidates match, use
`@Qualifier("beanName")`. When injecting into a collection, a `@Qualifier` on the injection point
can restrict which qualified beans are collected.

**Generics as an implicit qualifier.** Since Spring 4.0, generic type arguments act as an
automatic qualifier. `List<Handler<OrderEvent>>` collects only handler beans whose resolvable
generic type matches `OrderEvent`; a single injection point `Handler<OrderEvent>` unambiguously
selects the matching bean even when several `Handler` beans exist. This works because Spring
resolves the full parameterized type via `ResolvableType`, not just the raw class.

## How the Container Resolves an Injection Point

Regardless of injection style, Spring resolves a `@Autowired` point through
`DefaultListableBeanFactory.doResolveDependency`. Understanding this algorithm explains most
"which bean wins / why does this throw?" interview traps:

1. **Shortcut resolution** — a previously cached `@Qualifier`/name shortcut or a `@Value` is
   evaluated first.
2. **Type match** — find all bean names assignable to the required type (respecting generics
   via `ResolvableType`, and treating arrays / `Collection` / `Map` / `ObjectProvider` /
   `Stream` as multi-element wrappers).
3. **Filter self-references and non-autowire-candidates** — a bean is not injected into itself,
   and beans marked `autowire-candidate="false"` (or excluded by `defaultCandidate=false` on a
   qualifier) are skipped.
4. **Qualifier narrowing** — `@Qualifier` values and custom qualifier annotations filter the
   candidate set.
5. **`@Primary`** — if exactly one candidate is `@Primary`, it wins immediately. Two `@Primary`
   candidates of the same type throw `NoUniqueBeanDefinitionException`.
6. **`@Priority`** — if no primary, the candidate with the highest `jakarta.annotation.Priority`
   (lowest numeric value) wins. Note `@Priority` participates in single-injection tie-breaking
   but `@Order` does **not** (that only affects collection/stream ordering).
7. **Fallback to name match** — the field/parameter name is matched against the candidate bean
   names as an implicit qualifier.
8. If still ambiguous → `NoUniqueBeanDefinitionException`; if none and required →
   `NoSuchBeanDefinitionException` (wrapped in `UnsatisfiedDependencyException`).

A critical distinction: **`@Primary` vs `@Qualifier` precedence.** `@Qualifier` at the injection
point is more specific than `@Primary` — if a qualifier matches a specific bean, `@Primary` is
ignored for that point. `@Primary` is a factory-wide default; `@Qualifier` is a point-specific
override.

**Worked trace — "which `PaymentGateway` wins?"** Given three beans of the same type:

```java
@Component @Primary                 PaymentGateway stripe;   // bean name "stripe"
@Component @Qualifier("checkout")   PaymentGateway paypal;   // bean name "paypal"
@Component @Priority(1)             PaymentGateway adyen;    // bean name "adyen"
```

- **Injection point `@Autowired PaymentGateway gateway;`** (no qualifier). Step 2 collects all
  three candidates `{stripe, paypal, adyen}`. Step 3 removes nothing. Step 4 has no qualifier, so
  no narrowing. Step 5: exactly one `@Primary` → **`stripe` wins**, immediately. Steps 6-7 never
  run.
- **Injection point `@Autowired @Qualifier("checkout") PaymentGateway gateway;`.** Step 4 narrows
  the candidate set by the qualifier to just `{paypal}`. The set is now size 1 → **`paypal` wins**.
  `stripe`'s `@Primary` is irrelevant because the qualifier already resolved a unique bean (this is
  the "qualifier beats primary" rule).
- **Now remove `@Primary` from `stripe` and inject the plain `@Autowired PaymentGateway gateway;`.**
  Step 5 finds no primary. Step 6 checks `@Priority`: only `adyen` has one (`@Priority(1)`), so it
  is the unique highest-priority candidate → **`adyen` wins**. (If `stripe` also had `@Priority(2)`,
  `adyen` still wins — lower numeric value = higher priority.)
- **Ambiguity case:** with no `@Primary`, no `@Priority`, no matching qualifier, and no bean whose
  name equals the field name (step 7 fails too), the set stays size 3 → step 8 throws
  `NoUniqueBeanDefinitionException` ("expected single matching bean but found 3: stripe,paypal,adyen").

## Ordering, @Order vs @Priority, and Tie-Breaking

Two families of "ordering" behavior are frequently conflated:

- **Collection/stream ordering** — when you inject `List<T>`, `T[]`, or a `Stream<T>` via
  `ObjectProvider.orderedStream()`, elements are sorted by `@Order`/`Ordered`, with `@Priority`
  also honored. Lower value = earlier/higher precedence. Plain `Map`/`Collection` injection with
  no ordering annotation follows registration order, which is **not guaranteed by contract**.
- **Single-injection tie-breaking** — when a single-valued injection point is ambiguous,
  `@Order` is *ignored*; only `@Primary` then `@Priority` break the tie. This asymmetry
  surprises people: adding `@Order(0)` to a bean does *not* make it "win" a single autowire.

`@javax`/`jakarta.annotation.Priority` sits on the class; `@Order` may sit on the class,
`@Bean` method, or component. For `List` injection both are consulted, but `@Order` and
`Ordered` are the idiomatic Spring mechanism.

## Circular Dependency Resolution Internals

Spring resolves *singleton* setter/field cycles through a **three-level cache** of singletons in
`DefaultSingletonBeanRegistry`:

- `singletonObjects` — fully initialized singletons (level 1).
- `earlySingletonObjects` — raw instances exposed early to break cycles (level 2).
- `singletonFactories` — `ObjectFactory`s that can produce an early reference, importantly a
  *proxy* if the bean will be AOP-wrapped (level 3).

When A depends on B and B depends back on A (setter/field), Spring instantiates A, adds a
singleton factory for A to level 3, begins populating A, creates B, and when B needs A it obtains
the *early reference* of A from the factory. This is why setter/field cycles resolve but
**constructor cycles cannot**: with constructor injection the raw instance does not yet exist
when the dependency is needed, so there is nothing to expose early.

Numbered trace, `A` and `B` each `@Autowired` (setter/field) on the other:

1. `getBean(A)` → A not in level 1. Instantiate A via its no-arg constructor. `rawA` now exists
   but is *empty* (B still `null`).
2. Register A's `ObjectFactory` in **level 3** (`singletonFactories`) and mark A "in creation."
3. `populateBean(A)` starts → A needs B → `getBean(B)`. B is not in any cache, so recurse.
4. Instantiate B (`rawB`), register B's factory in level 3, `populateBean(B)` starts → B needs A →
   `getBean(A)`.
5. A is not in level 1, but it *is* "in creation," so Spring checks level 2 (empty), then **level 3
   finds A's factory**, calls it to produce the early reference of A, **promotes that reference to
   level 2** (`earlySingletonObjects`), and injects it into B. B now holds a valid (if not-yet-fully-
   initialized) A.
6. B finishes `populateBean` + init callbacks → B moves to **level 1** (`singletonObjects`). The
   recursive `getBean(B)` returns this finished B.
7. Back in step 3, A receives the finished B, completes init, and A moves to **level 1**. Because
   the early A reference in level 2 and the final A are the same object (no proxy), everything is
   consistent.

Now the **constructor-injection version** of the same cycle: at step 1 you cannot even
*instantiate* A, because `new A(b)` demands B up front → `getBean(B)` → `new B(a)` demands A →
back to A, which is still mid-instantiation with **no `rawA` to expose**. Step 5 has nothing in
level 3 to hand out, so Spring throws `BeanCurrentlyInCreationException` at startup.

Important gotchas:

- **Constructor cycles always fail** with `BeanCurrentlyInCreationException`, even mixed cycles
  where the *first* bean in the chain uses constructor injection.
- **Prototype-scoped cycles can never be resolved** — Spring does not cache prototypes, so there
  is no early reference. A prototype circular reference throws `BeanCurrentlyInCreationException`
  regardless of injection style.
- **AOP + early reference mismatch.** If a bean in a cycle is proxied, the early reference exposed
  might differ from the final proxied bean, historically producing subtle bugs. Spring detects
  this and throws `BeanCurrentlyInCreationException` ("Bean with name '...' has been injected into
  other beans ... in its raw version as part of a circular reference, but has eventually been
  wrapped") rather than silently injecting an unproxied instance.
- Since Spring Boot 2.6 circular references are prohibited by default (`spring.main.
  allow-circular-references=false`); that is a Boot default, not a Framework-core default. The
  Framework itself still resolves setter cycles unless configured otherwise. Breaking the cycle
  with `@Lazy` on one injection point (injecting a lazy proxy) is the clean workaround.

## Injection Timing, BeanPostProcessor, and Ordering of Callbacks

Field and setter injection are performed by `AutowiredAnnotationBeanPostProcessor`, an
`InstantiationAwareBeanPostProcessor` that runs during `populateBean`, *after* the constructor
returns but *before* initialization callbacks. The full per-bean lifecycle ordering that
matters for injection:

1. Constructor invoked (constructor injection happens here).
2. `populateBean` — field and setter injection applied by post-processors.
3. `Aware` callbacks (`BeanNameAware`, `ApplicationContextAware`, ...).
4. `@PostConstruct` (via `CommonAnnotationBeanPostProcessor`), then `InitializingBean.
   afterPropertiesSet`, then custom `init-method`.

Consequences interviewers probe:

- **You must not rely on field/setter-injected dependencies inside the constructor** — they are
  still `null` there. Logic needing injected collaborators belongs in `@PostConstruct`, not the
  constructor. With constructor injection this problem disappears because the dependency is a
  parameter.
- `@PostConstruct` is the first lifecycle point where *all* injection styles are guaranteed
  complete, which is why initialization work that touches injected beans is placed there.
- Ordering among multiple `BeanPostProcessor`s matters; `AutowiredAnnotationBeanPostProcessor`
  and `CommonAnnotationBeanPostProcessor` (which handles `@Resource`/`@PostConstruct`) are
  ordered so `@Autowired` and `@Resource` on the same bean both resolve predictably.

## Thread-Safety and Concurrency of Injected State

DI type has direct concurrency implications because most Spring beans are singletons shared
across all threads:

- **Constructor injection + `final` fields** gives *safe publication* under the Java Memory
  Model: `final` fields set in the constructor are guaranteed visible to all threads without
  additional synchronization once the object is safely published. This makes constructor-injected
  singletons inherently thread-safe with respect to their dependencies.
- **Setter/field injection loses the `final` guarantee.** The dependency reference is a mutable,
  non-`final` field. In practice the container publishes the fully-initialized singleton safely
  (init happens-before the bean is placed in `singletonObjects` and handed to consumers), so
  reads are usually fine — but nothing prevents application code from *reassigning* a setter later
  from another thread, reintroducing a visibility hazard. Constructor injection forecloses that
  entirely.
- The **stateless singleton** rule still governs everything: injected collaborators should
  themselves be thread-safe/stateless. DI does not add per-request isolation; for per-request
  state use request/prototype scope or lookup/`ObjectProvider` access rather than caching mutable
  state on a singleton.

## ObjectProvider, ObjectFactory, and Provider Semantics

`ObjectProvider<T>` (Spring 4.3+) is the modern, flexible handle for deferred and optional
resolution and is the preferred alternative to injecting `ApplicationContext`:

- `getObject()` — resolve now, throwing if zero or multiple candidates (like a required
  dependency).
- `getIfAvailable()` — returns `null` (or a `Supplier` default) if no bean; still throws on
  ambiguity.
- `getIfUnique()` — returns `null` if zero *or* multiple candidates (no exception on ambiguity).
- `stream()` / `orderedStream()` — iterate all candidates, the latter honoring `@Order`.
- Injecting `ObjectProvider<Prototype>` and calling `getObject()` per use is the idiomatic
  singleton-needs-prototype solution — lighter than lookup methods and testable without CGLIB.

`ObjectProvider` extends `ObjectFactory` and the JSR-330 `jakarta.inject.Provider`. The provider
is itself resolved and injected once (it is a thin handle bound to the factory), so it does not
suffer the "same instance forever" problem — each `getObject()` re-queries the container and, for
a prototype target, yields a fresh instance. `Optional<T>` and `@Nullable` are simpler
alternatives when you only need presence/absence, not repeated lookup.

## Common follow-up questions

- **What is the difference between IoC and DI?** IoC is the broad principle of handing control
  of object creation/wiring to a container; DI is the specific implementation that injects
  dependencies. DI is a form of IoC, but IoC also includes patterns like Service Locator.
- **Why is constructor injection preferred over field injection?** Immutability (`final`),
  guaranteed non-null mandatory dependencies, no partially-constructed beans, easy unit testing
  without Spring, and an explicit dependency contract that surfaces SRP violations.
- **Is `@Autowired` required on a constructor?** No, not since Spring 4.3 when the class has
  exactly one constructor. With multiple constructors you must annotate the intended one.
- **How do you inject an optional dependency?** Use setter injection with
  `@Autowired(required = false)`, or `@Nullable`, or `Optional<T>`, or `ObjectProvider<T>`.
- **How does Spring resolve a singleton that needs a prototype every time?** Lookup method
  injection (`@Lookup`), or inject `ObjectProvider`/`Provider`/`ObjectFactory` and call it per
  use; avoid caching the prototype in the singleton.
- **Can constructor injection cause circular dependency failures?** Yes — mutual constructor
  dependencies cannot be resolved and Spring throws at startup. Setter/field injection can
  sometimes resolve singleton cycles, but the cycle is still a design smell.
- **How do you inject all beans of a type?** Declare a `List`/`Set`/array of that type; Spring
  injects all matching beans (order via `@Order`). A `Map<String, T>` gives them keyed by bean
  name.
- **javax vs jakarta:** In Spring 6.x (Jakarta EE 9+), JSR-330 `@Inject` comes from
  `jakarta.inject` and `@Resource` from `jakarta.annotation`; earlier Spring used `javax.*`.
- **What is the difference between `@Autowired`, `@Inject`, and `@Resource`?** `@Autowired` is
  Spring's own (by type, then by qualifier/name); `@Inject` (JSR-330) is by type; `@Resource`
  (JSR-250) is primarily by name.

## References

- Spring Framework Reference — Core Technologies, "Dependency Injection":
  https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html
- Spring Framework Reference — "Autowiring Collaborators" and injection annotations:
  https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-autowire.html
- Spring Framework Reference — "Method Injection" (Lookup method injection):
  https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-method-injection.html
- Spring Blog — "Setter injection versus constructor injection and the use of @Required":
  https://spring.io/blog/2016/03/04/core-container-refinements-in-spring-framework-4-3
- Baeldung — "Constructor Dependency Injection in Spring":
  https://www.baeldung.com/constructor-injection-in-spring
- Baeldung — "Field Injection vs Constructor Injection vs Setter Injection":
  https://www.baeldung.com/spring-injection-field-constructor-setter
- Martin Fowler — "Inversion of Control Containers and the Dependency Injection pattern":
  https://martinfowler.com/articles/injection.html
