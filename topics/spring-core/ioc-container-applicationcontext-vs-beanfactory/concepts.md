# IoC Container: ApplicationContext vs BeanFactory

Spring's core is a container that creates, wires, configures, and manages the
lifecycle of application objects ("beans"). Two interfaces model this container:
the low-level `BeanFactory` and the richer `ApplicationContext` (which extends
`BeanFactory`). Understanding the difference — and *why* Inversion of Control
matters — is one of the most commonly asked Spring interview topics.

---

## Inversion of Control principle and why it matters

**Inversion of Control (IoC)** is a design principle in which the control over
object creation and the wiring of collaborators is *inverted* — moved out of the
application code and handed to an external component (the container). Instead of
an object constructing or looking up its own dependencies, the dependencies are
supplied *to* it.

**Dependency Injection (DI)** is the specific implementation of IoC that Spring
uses: the container injects collaborators via constructors, setters, or fields.
(IoC is the broad principle; another form of IoC is the Service Locator pattern,
which Spring generally discourages in favor of DI.)

Traditional, tightly-coupled code:

```java
class OrderService {
    // OrderService decides which implementation to use and how to build it.
    private final PaymentGateway gateway = new StripePaymentGateway();
}
```

IoC / DI version:

```java
class OrderService {
    private final PaymentGateway gateway;

    // The collaborator is handed in; OrderService does not know or care
    // which concrete PaymentGateway it receives.
    OrderService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

**Why it matters:**

- **Loose coupling** — classes depend on abstractions, not concrete types.
- **Testability** — you can inject mocks/stubs in unit tests without a container.
- **Configurability** — swap implementations via configuration, not code changes.
- **Single Responsibility** — business classes focus on behavior, not wiring.
- **Lifecycle management** — the container handles construction order, singletons,
  init/destroy callbacks, and cleanup.

The phrase **"Hollywood Principle" — "Don't call us, we'll call you"** captures IoC:
the framework calls your code at the right time, rather than your code driving the
framework.

---

## The job of the IoC container

The container is the object that reads *configuration metadata*, then instantiates,
configures, wires, and manages beans. Its responsibilities:

1. **Read configuration metadata** — from XML, Java `@Configuration` classes, or
   component scanning of annotations. The metadata is parsed into `BeanDefinition`
   objects (a recipe describing how to create each bean: class, scope, constructor
   args, property values, init/destroy methods, lazy flag, etc.).
2. **Instantiate beans** — create instances according to each `BeanDefinition`,
   choosing constructors and resolving constructor arguments.
3. **Inject dependencies** — resolve and set collaborators (by type, by name, via
   `@Autowired`, `@Resource`, `@Inject`, constructor args, `<property>`, etc.).
4. **Apply lifecycle callbacks** — `@PostConstruct`, `InitializingBean.afterPropertiesSet()`,
   custom init methods on startup; `@PreDestroy`, `DisposableBean.destroy()`, custom
   destroy methods on shutdown.
5. **Manage scopes** — singleton (one shared instance per container, the default),
   prototype (a new instance per lookup), and web scopes (request, session, etc.).
6. **Apply post-processing** — `BeanPostProcessor` and `BeanFactoryPostProcessor`
   hooks that let the framework (and you) modify bean definitions or wrap beans
   (e.g., to create AOP proxies).

The key mental model: **configuration metadata + POJOs → container → fully wired,
production-ready objects.**

---

## BeanFactory: the basic container

`org.springframework.beans.factory.BeanFactory` is the **root interface** of the
Spring IoC container. It defines the most fundamental container contract: hold bean
definitions and hand back beans on demand.

Core capabilities:

- Bean instantiation and **basic dependency injection**.
- Bean lookup by name and/or type: `getBean(String)`, `getBean(Class<T>)`.
- Scope handling (singleton/prototype) and `isSingleton`/`isPrototype` queries.
- Lifecycle wiring at a basic level.

Key behavioral trait: **lazy initialization**. A plain `BeanFactory`
(e.g., `DefaultListableBeanFactory`) does not pre-instantiate singletons. A bean is
created only when it is first requested via `getBean(...)`. This gives a lighter,
more memory-frugal footprint and faster startup, at the cost of discovering
configuration errors later (at first access rather than at startup).

```java
// Programmatic, low-level use of a bean factory.
DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
BeanDefinition def = BeanDefinitionBuilder
        .genericBeanDefinition(OrderService.class)
        .getBeanDefinition();
factory.registerBeanDefinition("orderService", def);

// Bean is created lazily, only here on first request.
OrderService service = factory.getBean(OrderService.class);
```

What a plain `BeanFactory` does **not** do automatically:

- It does **not** automatically detect and register `BeanPostProcessor`s or
  `BeanFactoryPostProcessor`s — you must register them programmatically
  (`addBeanPostProcessor(...)`).
- No built-in support for internationalization (`MessageSource`).
- No built-in application event publishing.
- No convenient resource loading via `getResource(...)`.
- No automatic annotation processing (`@Autowired`, `@PostConstruct`, etc.) unless
  you register the relevant post-processors yourself.

`DefaultListableBeanFactory` is the full-featured, canonical `BeanFactory`
implementation and — importantly — it is the *engine* that `ApplicationContext`
implementations use internally.

---

## ApplicationContext: the enterprise container

`org.springframework.context.ApplicationContext` **extends `BeanFactory`** (through
several sub-interfaces) and is the interface you use in almost all real applications.
It is a superset: everything a `BeanFactory` can do, plus enterprise features.

Added capabilities beyond `BeanFactory`:

- **Automatic `BeanPostProcessor` registration** — post-processors declared as beans
  are detected and applied automatically (this is how `@Autowired`, `@Value`,
  `@PostConstruct`, AOP proxying, etc. "just work").
- **Automatic `BeanFactoryPostProcessor` registration** — e.g.,
  `PropertySourcesPlaceholderConfigurer` for `${...}` placeholder resolution.
- **Internationalization** via `MessageSource` (`getMessage(...)`).
- **Application event publishing** via `ApplicationEventPublisher` — publish and
  listen for events (`ApplicationEvent`, `@EventListener`,
  `ApplicationListener`).
- **Resource loading** — `ApplicationContext` is a `ResourceLoader`;
  `getResource("classpath:...")` returns `Resource` objects.
- **Environment abstraction** — access to `Environment` (profiles and properties).
- **Convenient integration with AOP**, declarative transactions, and other
  framework services.

Key behavioral trait: **eager initialization of singletons**. By default an
`ApplicationContext` pre-instantiates all singleton beans during startup (at the
end of `refresh()`). This surfaces misconfiguration *immediately* at startup
(fail-fast) rather than on first use, and means the first request is not slowed by
lazy construction. Individual beans can still opt out with `@Lazy` /
`lazy-init="true"`.

Interface hierarchy (simplified):

```
BeanFactory
   ^
   |  (extends, through several interfaces)
ListableBeanFactory, HierarchicalBeanFactory
   ^
ApplicationContext  ── also extends ─→ MessageSource,
   |                                    ApplicationEventPublisher,
   |                                    ResourcePatternResolver (ResourceLoader),
   |                                    EnvironmentCapable
ConfigurableApplicationContext (adds refresh(), close(), registerShutdownHook())
```

### BeanFactory vs ApplicationContext comparison

| Feature | BeanFactory | ApplicationContext |
|---|---|---|
| Basic DI and bean lookup | Yes | Yes |
| Default singleton init | Lazy (on first `getBean`) | Eager (at startup / `refresh()`) |
| `BeanPostProcessor` registration | Manual | Automatic |
| `BeanFactoryPostProcessor` registration | Manual | Automatic |
| Annotation config (`@Autowired`, `@PostConstruct`) | Manual setup | Automatic (post-processors registered) |
| Internationalization (`MessageSource`) | No | Yes |
| Event publishing / listeners | No | Yes |
| Resource loading (`ResourceLoader`) | No | Yes |
| `Environment` / profiles / properties | No | Yes |
| Convenient AOP / declarative services | No | Yes (via auto-registered infrastructure) |
| Startup footprint | Lighter | Heavier (more infrastructure) |
| Typical use | Rare / embedded / memory-constrained | Almost all applications |

Rule of thumb: **use `ApplicationContext` unless you have a specific reason not to.**
The Spring reference documentation explicitly recommends `ApplicationContext` and
describes `BeanFactory` usage as effectively deprecated for typical applications.

---

## Common ApplicationContext implementations

You rarely implement `ApplicationContext`; you pick a bundled implementation based
on where your configuration metadata lives.

**`ClassPathXmlApplicationContext`** — loads XML bean definitions from the
classpath.

```java
ApplicationContext ctx =
    new ClassPathXmlApplicationContext("applicationContext.xml");
OrderService svc = ctx.getBean(OrderService.class);
```

**`FileSystemXmlApplicationContext`** — loads XML bean definitions from absolute or
relative file-system paths (not the classpath).

```java
ApplicationContext ctx =
    new FileSystemXmlApplicationContext("/etc/app/beans.xml");
```

**`AnnotationConfigApplicationContext`** — the standard choice for Java-based
configuration. It reads `@Configuration` classes and/or performs component scanning
of `@Component`/`@Service`/`@Repository`/`@Controller` classes. No XML required.

```java
@Configuration
@ComponentScan("com.example.app")
class AppConfig {
    @Bean PaymentGateway paymentGateway() { return new StripePaymentGateway(); }
}

ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
// or register/scan explicitly:
// var ctx = new AnnotationConfigApplicationContext();
// ctx.register(AppConfig.class);
// ctx.scan("com.example.app");
// ctx.refresh();
```

**`GenericApplicationContext`** — a flexible, general-purpose implementation that is
*not* tied to a specific configuration format. You attach reader/scanner delegates
(e.g., `XmlBeanDefinitionReader`, `AnnotatedBeanDefinitionReader`,
`ClassPathBeanDefinitionScanner`) or register beans programmatically, then call
`refresh()` exactly once. `AnnotationConfigApplicationContext` and
`GenericWebApplicationContext` are built on top of it. Since Spring 5 it also
supports functional bean registration via `registerBean(...)` with a supplier.

```java
GenericApplicationContext ctx = new GenericApplicationContext();
ctx.registerBean(OrderService.class, () -> new OrderService(...));
ctx.refresh();   // must be called exactly once before use
```

**Web variants** — `XmlWebApplicationContext`,
`AnnotationConfigWebApplicationContext`, and (for Spring MVC / Servlet apps)
`GenericWebApplicationContext` / `AnnotationConfigServletWebServerApplicationContext`
(the latter being a Spring Boot type). In classic Spring MVC the root context is
created by `ContextLoaderListener` and the per-servlet context by `DispatcherServlet`.

| Implementation | Config source | Notes |
|---|---|---|
| `ClassPathXmlApplicationContext` | XML on classpath | Classic XML apps |
| `FileSystemXmlApplicationContext` | XML from file system | Absolute/relative FS paths |
| `AnnotationConfigApplicationContext` | `@Configuration` / scanning | Standard Java-config choice |
| `GenericApplicationContext` | Format-agnostic (readers/programmatic) | Fine-grained control; call `refresh()` once |
| `AnnotationConfigWebApplicationContext` | Java config, web | Spring MVC root/servlet context |

---

## Container startup and the refresh method

Every `ConfigurableApplicationContext` centralizes its startup in the
`refresh()` method (defined on `ConfigurableApplicationContext`, implemented in
`AbstractApplicationContext.refresh()`). It runs as a **synchronized, ordered
sequence of phases** and is where a context transitions from "configured" to
"fully initialized and ready." For XML/annotation context constructors, `refresh()`
is invoked automatically inside the constructor; for `GenericApplicationContext`
you call it yourself, and only once.

High-level phases of `AbstractApplicationContext.refresh()`:

1. **`prepareRefresh()`** — mark active, set start time, initialize property sources,
   validate required properties.
2. **`obtainFreshBeanFactory()`** — create/refresh the internal
   `DefaultListableBeanFactory` and load `BeanDefinition`s from the configuration.
3. **`prepareBeanFactory()`** — configure the bean factory: set the class loader,
   register default environment beans, add standard `BeanPostProcessor`s
   (e.g., `ApplicationContextAwareProcessor`), ignore certain dependency types.
4. **`postProcessBeanFactory()`** — subclass hook to register additional factory
   post-processing.
5. **`invokeBeanFactoryPostProcessors()`** — run all `BeanFactoryPostProcessor`s;
   this is where `@Configuration` classes are parsed (`ConfigurationClassPostProcessor`)
   and `${...}` placeholders resolved. These operate on **bean definitions**, before
   beans are instantiated.
6. **`registerBeanPostProcessors()`** — detect and register all `BeanPostProcessor`
   beans so they can intercept subsequent bean creation.
7. **`initMessageSource()`** — initialize the `MessageSource` (i18n).
8. **`initApplicationEventMulticaster()`** — set up the event multicaster.
9. **`onRefresh()`** — subclass hook (e.g., web contexts create the embedded/servlet
   web server here in Boot).
10. **`registerListeners()`** — register `ApplicationListener` beans.
11. **`finishBeanFactoryInitialization()`** — **instantiate all remaining non-lazy
    singleton beans** (eager initialization happens here).
12. **`finishRefresh()`** — publish `ContextRefreshedEvent`, start `Lifecycle` beans.

Important distinction:

- **`BeanFactoryPostProcessor`** modifies **bean definitions** (metadata) *before*
  any beans are instantiated (phase 5).
- **`BeanPostProcessor`** intercepts **bean instances** during their creation
  (before/after initialization callbacks), enabling proxying, injection of
  annotations, etc. (registered in phase 6, applied in phase 11 and later).

On shutdown, `close()` (or a JVM shutdown hook registered via
`registerShutdownHook()`) publishes `ContextClosedEvent`, destroys singleton beans
(invoking `@PreDestroy`, `DisposableBean.destroy()`, and custom destroy methods),
and releases resources.

---

## When a plain BeanFactory would ever be used

For the vast majority of applications you should use `ApplicationContext`. A plain
`BeanFactory` is a niche choice, appropriate only when its lighter footprint or
lazy behavior genuinely matters. Legitimate scenarios:

- **Severely memory-constrained environments** — historically applets, older mobile
  devices, or tiny embedded runtimes, where the extra infrastructure of a full
  `ApplicationContext` is undesirable.
- **Very fast startup with strictly lazy creation** — when you want beans created
  only on first access and can accept discovering config errors late.
- **Framework-internal / library code** — Spring itself uses
  `DefaultListableBeanFactory` internally as the engine inside every
  `ApplicationContext`. Library authors sometimes use a bare bean factory to embed a
  minimal container.
- **Simple programmatic registration** where you don't need i18n, events, resource
  loading, or automatic post-processor registration, and are willing to wire
  post-processors by hand.

Trade-offs you accept with a plain `BeanFactory`:

- You must **manually register** `BeanPostProcessor`s /
  `BeanFactoryPostProcessor`s; otherwise annotation-driven features
  (`@Autowired`, `@PostConstruct`, AOP, `${...}` placeholders) will not work.
- **Lazy singletons** mean configuration errors surface later, at first `getBean`,
  not at startup — you lose fail-fast behavior.
- No `MessageSource`, event publishing, resource loading, or `Environment`
  conveniences.

The Spring reference documentation states plainly that `ApplicationContext` is
preferred and that you should use `BeanFactory` only if there is a compelling
reason not to — for example, memory consumption in a resource-constrained scenario.

---

## Bean creation internals and the singleton cache

`DefaultSingletonBeanRegistry` (the singleton-management superclass of
`DefaultListableBeanFactory`) maintains a **three-level cache** that is central to
how singletons are created and how circular references are resolved:

1. **`singletonObjects`** — `Map<String,Object>` of *fully initialized* singletons
   (the final, post-processed, ready-to-use instances).
2. **`earlySingletonObjects`** — raw *early references* to beans that have been
   instantiated but not yet fully populated/initialized.
3. **`singletonFactories`** — `Map<String,ObjectFactory<?>>` of factories that can
   produce an early reference on demand (this is what allows an AOP proxy to be
   exposed *early* if a proxy will be needed).

**Why three levels and not two?** The obvious design is "finished beans" + "in-progress
early references." The third level exists because an early reference might need to be an
**AOP proxy**, and building that proxy must happen *at most once*. Level 3 holds a
*factory* (a lambda) that, when first invoked, produces the early reference (running
proxy-creation post-processors). Its result is then cached in level 2. So if two
different beans in the cycle both ask for the in-progress bean, the first probe runs the
factory once and every later probe returns the **identical** cached early reference (the
same proxy object) from level 2 — never a fresh proxy each time. Two levels alone could
not both *defer* proxy creation and *guarantee one shared instance*.

`getSingleton(beanName, allowEarlyReference)` probes these in order: level 1, then
level 2, then (if early references are allowed) it invokes the level-3 factory,
promotes the result into `earlySingletonObjects`, and removes the factory. The key
sequencing inside `doCreateBean` is:

```
1. instantiate (call constructor)            // bean exists but is "raw"
2. addSingletonFactory(...)                  // expose an EARLY reference (level 3)
3. populateBean(...)                          // inject properties/setters/fields
4. initializeBean(...)                        // BPPs + @PostConstruct + init methods
5. move to singletonObjects (level 1)         // fully ready
```

The early reference is exposed at step 2 — **after** the constructor but **before**
property population. That single fact explains why setter/field circular
dependencies can be broken but constructor cycles cannot (see next section).
`getEarlyBeanReference` runs `SmartInstantiationAwareBeanPostProcessor`s so that if
the bean will ultimately be an AOP proxy, the *proxy* (not the raw target) is what
gets injected into the other bean in the cycle.

**Gotcha — early proxy vs final proxy:** if a bean is wrapped by a
`BeanPostProcessor` *other* than the standard AOP auto-proxy creator (which is a
`SmartInstantiationAwareBeanPostProcessor`), the early reference handed to a
circular collaborator may not equal the final object placed in `singletonObjects`.
Spring detects this mismatch at the end of `doCreateBean` and throws
`BeanCurrentlyInCreationException` ("Bean with name X has been injected into other
beans ... in its raw version as part of a circular reference, but has eventually
been wrapped"). This is a classic, subtle failure mode.

---

## Circular dependencies and injection styles

Whether Spring can resolve an A↔B cycle depends entirely on the **injection style**:

| Cycle via | Resolvable by default? | Why |
|---|---|---|
| Setter / field injection | Yes | Early reference is exposed after construction, before population |
| Constructor injection (both sides) | No | Each side needs the *other* fully constructed before its own constructor can run |

A pure constructor cycle throws **`BeanCurrentlyInCreationException`** during
`refresh()` (wrapped in a `BeanCreationException` / `UnsatisfiedDependencyException`),
because there is no point at which an early reference can be published — the bean
does not exist until its constructor returns.

### Worked trace: how Spring breaks a setter cycle A↔B

Take two singletons that setter-inject each other:

```java
@Component class A { @Autowired void setB(B b) { this.b = b; } B b; }
@Component class B { @Autowired void setA(A a) { this.a = a; } A a; }
```

`refresh()`'s eager step (`preInstantiateSingletons`) calls `getBean("a")`. Watch the
three maps — L1 = `singletonObjects`, L2 = `earlySingletonObjects`, L3 =
`singletonFactories`:

| Step | Action | L1 (ready) | L2 (early) | L3 (factory) |
|---|---|---|---|---|
| 1 | `getBean("a")` → miss all caches → start creating A | — | — | — |
| 2 | instantiate A (`new A()`) — raw object exists | — | — | — |
| 3 | `addSingletonFactory("a", …)` — expose early A | — | — | `a` |
| 4 | `populateBean(A)`: A needs B → `getBean("b")` | — | — | `a` |
| 5 | instantiate B (`new B()`) | — | — | `a` |
| 6 | `addSingletonFactory("b", …)` | — | — | `a`, `b` |
| 7 | `populateBean(B)`: B needs A → `getSingleton("a", true)` | — | — | `a`, `b` |
| 8 | **cycle breaks:** L1/L2 miss `a`, so invoke L3 factory for `a`; cache result in L2, drop L3 entry | — | `a` | `b` |
| 9 | B's `setA` gets the **early A reference**; B has no more deps | — | `a` | `b` |
| 10 | `initializeBean(B)` runs (BPPs, `@PostConstruct`); B finished → move to L1, drop its L2/L3 | `b` | `a` | — |
| 11 | back in step 4: A's `setB` gets the now-complete `b` from L1 | `b` | `a` | — |
| 12 | `initializeBean(A)` runs; A finished → move to L1, drop early A from L2 | `a`, `b` | — | — |

The cycle is broken at **step 8**: because A's early reference was published at step 3
(after construction, before population), B can obtain a usable `A` handle even though A
is only half-built. B finishes first (step 10) with a reference to A that A will later
"grow into." When A finishes at step 12, the `b` field already points at the fully
initialized B, and B's `a` field points at that same A object — one consistent graph.

Now swap both to **constructor** injection: at step 2 there is no "instantiate then
populate" — A's constructor itself calls `getBean("b")`, and B's constructor calls
`getBean("a")`, which is *already in creation* with **no early reference ever published**
(step 3 never happens for a constructor arg). Spring detects the re-entrant request and
throws `BeanCurrentlyInCreationException`. That is the whole reason setter cycles resolve
and constructor cycles cannot.

Ways to break a constructor cycle without switching to setters:

- **`@Lazy` on one injection point** — Spring injects a lazy-initializing proxy for
  that dependency; the real bean is resolved on first method call, after both beans
  exist.
- **`ObjectProvider<T>` / `Provider<T>`** — defer the actual lookup to runtime rather
  than construction time.
- **Redesign** — a cycle is usually a design smell; extract a third collaborator.

**Version note:** the framework default is `allowCircularReferences = true` on the
context. Spring Boot flipped its own default to `false` (Boot 2.6+), so a
setter/field cycle that "worked" on the raw framework may fail fast under Boot —
that behavior is a Boot policy, not a change to the core container.

---

## Autowiring resolution and ambiguity

When a single-valued injection point matches more than one candidate by type, Spring
does **not** pick arbitrarily — it applies a deterministic resolution order and
otherwise throws `NoUniqueBeanDefinitionException`:

1. **`@Primary`** — a single designated default winner for that type. Having two
   `@Primary` beans of the same type reintroduces ambiguity and fails.
2. **`@Priority(n)`** (`jakarta.annotation.Priority`) — when no `@Primary` applies,
   the candidate with the **lowest** priority value wins. `@Priority` is a
   class-level annotation and cannot be placed on `@Bean` methods.
3. **Qualifier / bean-name fallback** — a `@Qualifier("name")`, or the
   *injection-point name* matching a bean name (e.g., a field named
   `firstCatalog` selects the bean named `firstCatalog`).

If none disambiguates, injection fails. Note the interaction: `@Primary` takes
precedence over `@Priority`. For collection/array/`Map` injection points, ambiguity
is *not* an error — all matching beans are injected, ordered by `@Order` / `Ordered`
/ `@Priority`.

### Worked example: two beans of the same type, which one wins?

```java
@Bean @Primary PaymentGateway stripe()  { return new StripeGateway(); }
@Bean            PaymentGateway paypal()  { return new PayPalGateway(); }

@Service class Checkout {
    Checkout(PaymentGateway gateway) { … }   // one candidate needed, two exist
}
```

Trace the resolution for `Checkout`'s single `PaymentGateway` parameter:

- **As written:** two candidates match by type (`stripe`, `paypal`). Step 1 of the
  order applies — exactly one carries `@Primary` (`stripe`), so it wins. Injected bean =
  `StripeGateway`. No exception.
- **Add a qualifier at the injection point** — `Checkout(@Qualifier("paypal") PaymentGateway gateway)`:
  a qualifier match is more specific than `@Primary`, so resolution narrows the candidate
  set to just `paypal` *before* the `@Primary` tiebreak matters. Injected bean =
  `PayPalGateway`, overriding the `@Primary` default.
- **Remove `@Primary`** (two plain beans, no qualifier at the injection point): none of
  the three tiebreaks applies — no `@Primary`, no `@Priority`, and the parameter name
  `gateway` matches neither bean name (`stripe`/`paypal`). Two candidates survive →
  `NoUniqueBeanDefinitionException: expected single matching bean but found 2: stripe,paypal`.
- **Rename the parameter to `paypal`** (still no `@Primary`): the name-fallback in step 3
  kicks in — the injection-point name `paypal` matches the bean named `paypal`, so that
  one is selected and startup succeeds.

**Gotcha:** `@Qualifier` on a `@Bean`/component narrows candidacy but a bean with
`defaultCandidate=false` (Spring 6.2+) or `autowireCandidate=false` is excluded from
plain by-type injection entirely — a common source of "expected 1 bean but found 0"
confusion.

---

## BeanPostProcessor ordering and infrastructure beans

`registerBeanPostProcessors()` (phase 6 of `refresh()`) does more than a naive
scan — it registers `BeanPostProcessor`s in strict groups so that ordering-sensitive
infrastructure behaves predictably:

1. BPPs implementing **`PriorityOrdered`** first (sorted by `getOrder()`),
2. then BPPs implementing **`Ordered`** (sorted),
3. then the remaining regular BPPs (registration order),
4. then internal `MergedBeanDefinitionPostProcessor`s are re-registered last, and an
   `ApplicationListenerDetector` is added at the very end.

Critical subtlety: `BeanPostProcessor` ordering honors the **`Ordered` /
`PriorityOrdered` interfaces**, *not* the `@Order` annotation. Annotating a
`BeanPostProcessor` with `@Order` alone does **not** reliably order it — you must
implement the interface. (The `@Order` annotation *is* honored for sorting injected
collections and for `@WebFilter`-style ordering, but not for BPP registration.)

A related trap: **a `BeanPostProcessor` (or any bean it depends on) is created very
early**, before the ordinary singletons. If a `BeanPostProcessor` bean pulls in
application beans as dependencies, those beans get instantiated *before* all BPPs are
registered — so they may **escape post-processing** (no AOP proxy, no `@Autowired`
handling by later BPPs). Spring logs a message like "Bean X is not eligible for
getting processed by all BeanPostProcessors". This is why configuration classes that
declare `BeanPostProcessor`/`BeanFactoryPostProcessor` `@Bean` methods should keep
them `static` and dependency-free.

`BeanFactoryPostProcessor`s (phase 5) follow the same three-group ordering, but
`BeanDefinitionRegistryPostProcessor`s (a sub-interface, e.g.
`ConfigurationClassPostProcessor`) run as an earlier sub-phase because they add/modify
*definitions* that later BFPPs must see.

---

## Thread safety and concurrency in the container

- **The container itself is thread-safe for lookups.** `getBean(...)` can be called
  concurrently; singleton creation is guarded by synchronization on the
  `singletonObjects` map, so a given singleton is created exactly once even under
  concurrent first-access.
- **Singleton beans are shared, so their mutable state is not thread-safe for you.**
  The container does not synchronize access to *your* fields. Singleton-scoped beans
  should be stateless (or use thread-safe/immutable state); per-request mutable state
  belongs in method-local variables, request/prototype scope, or `ThreadLocal`.
- **Lock-ordering deadlocks are possible.** Because singleton creation holds the
  singleton lock, a bean whose init logic spawns threads that call back into
  `getBean` for another in-progress singleton can deadlock. Spring 6.2 reworked
  singleton locking to reduce such deadlocks (background/lenient locking), but
  init-time cross-thread bean lookups remain a hazard.
- **Prototype scope has no full lifecycle management.** The container instantiates,
  configures, and hands over a prototype, then forgets it: **destroy callbacks are
  not invoked** for prototypes. Cleanup is the caller's responsibility (or use a
  custom `BeanPostProcessor`/`DisposableBean` handling).

---

## FactoryBean and the getBean name prefix

A `FactoryBean<T>` is a bean that *produces* another object: the container calls
`getObject()` and injects **the produced object**, not the factory. This powers many
framework beans (e.g., `ProxyFactoryBean`, `LocalSessionFactoryBean`).

The naming subtlety interviewers probe:

- `getBean("myFactory")` returns the **product** (`getObject()`), not the factory.
- `getBean("&myFactory")` — the **`&` prefix** (`BeanFactory.FACTORY_BEAN_PREFIX`)
  returns the **`FactoryBean` instance itself**.
- `getBean("myFactory", SomeProductType.class)` returns the product typed as the
  product.

Concretely, a factory that produces `Connection`s:

```java
@Component("conn")
class ConnectionFactoryBean implements FactoryBean<Connection> {
    public Connection getObject()   { return DriverManager.getConnection(url); }
    public Class<?>   getObjectType() { return Connection.class; }
    public boolean    isSingleton()   { return true; }
}
```

Register it under the name `conn`, then:

```java
Object plain = ctx.getBean("conn");   // runtime type: Connection  (the PRODUCT — getObject())
Object amp   = ctx.getBean("&conn");  // runtime type: ConnectionFactoryBean (the FACTORY itself)
```

So `plain instanceof Connection` is `true` while `amp instanceof FactoryBean` is `true` —
the very same registered name yields two different runtime types depending on the `&`.
Because `isSingleton()` returns `true`, repeated `getBean("conn")` calls return the *same*
cached `Connection`; returning `false` would call `getObject()` afresh each time.

`FactoryBean.isSingleton()` controls whether `getObject()` results are cached. Do not
confuse a `FactoryBean` (an interface your bean implements) with a *factory method*
(`@Bean` method or XML `factory-method`) — the latter is just a way to instantiate a
bean, with no `&`-prefix semantics.

---

## Bean definition overriding and registration order

In a plain `DefaultListableBeanFactory`, registering two definitions with the **same
bean name** means the **later one wins** (silently) — `allowBeanDefinitionOverriding`
defaults to `true` at the framework level. This makes registration order significant:
XML `<import>` order, `@Configuration` processing order, and `@Bean` method order can
determine which definition survives.

- **Two `@Bean` methods with the same name** in configuration classes: the later
  parsed definition overrides the earlier one.
- **Component scanning collisions** (two `@Component`s that resolve to the same bean
  name from different classes) throw `ConflictingBeanDefinitionException` — this is
  *not* silent overriding, because scanning cannot know intent.
- Spring Boot sets `allowBeanDefinitionOverriding = false` by default, turning silent
  overrides into a startup `BeanDefinitionOverrideException` — again a Boot policy on
  top of the same core switch.

`@Primary`, `@Order`, and profile activation are *not* about overriding — they select
among multiple coexisting definitions; overriding actually *replaces* a definition
under the same name.

---

## Scoped beans and proxy injection

Injecting a **shorter-lived bean into a longer-lived one** (e.g., a `request`- or
`prototype`-scoped bean into a `singleton`) is a classic trap: the singleton is wired
**once** at creation, so it would capture a single stale instance forever.

Solutions:

- **Scoped proxy** — `@Scope(value = "request", proxyMode = ScopedProxyMode.TARGET_CLASS)`
  injects a CGLIB/JDK proxy into the singleton; each method call is routed to the
  correct scope instance for the current context.
- **`ObjectProvider<T>`** — inject a provider and call `getObject()` per use, deferring
  resolution and yielding a fresh prototype each call.
- **`@Lookup` method injection** — the container overrides an abstract/lookup method to
  return a fresh instance from the factory on each invocation.
- **`Provider<T>`** (`jakarta.inject.Provider`) — the JSR-330 equivalent of
  `ObjectProvider` for lazy, per-call resolution.

`ObjectProvider` also elegantly handles "0 or 1" and "0 or many": `getIfAvailable()`,
`getIfUnique()`, `stream()`, and `orderedStream()` avoid `NoSuchBeanDefinitionException`
/ `NoUniqueBeanDefinitionException` for optional or multi-valued dependencies.

---

## Common follow-up questions

- **Is `ApplicationContext` a `BeanFactory`?** Yes — `ApplicationContext` extends
  `BeanFactory` (via `ListableBeanFactory` and `HierarchicalBeanFactory`), so every
  `ApplicationContext` *is* a `BeanFactory` with added enterprise features.
- **What is the default bean scope, and how are singletons initialized?** The default
  scope is `singleton` (one instance per container). In an `ApplicationContext`,
  non-lazy singletons are created eagerly during `refresh()`; a plain `BeanFactory`
  creates them lazily on first request.
- **How do you make an `ApplicationContext` bean lazy?** Annotate it with `@Lazy`
  (or `lazy-init="true"` in XML), or set `@Lazy` on a `@Configuration` class to make
  all its `@Bean`s lazy.
- **Difference between `BeanFactoryPostProcessor` and `BeanPostProcessor`?** The
  former modifies bean *definitions* before instantiation; the latter intercepts
  bean *instances* during initialization.
- **Which context implementation for annotation-based Java config?**
  `AnnotationConfigApplicationContext`.
- **What triggers eager singleton creation?** The
  `finishBeanFactoryInitialization()` phase of `refresh()`, which calls
  `preInstantiateSingletons()` on the underlying `DefaultListableBeanFactory`.
- **javax vs jakarta:** Spring Framework 6.x (and Boot 3.x) migrated to the
  `jakarta.*` namespace (e.g., `jakarta.annotation.PostConstruct`,
  `jakarta.inject.Inject`). Spring 5.x and earlier use `javax.*`. The IoC container
  concepts are unchanged; only the annotation package names differ.
- **Does Spring Boot change this?** Spring Boot builds on the same container; its
  `SpringApplication` still creates an `ApplicationContext` (e.g., a
  web `ServletWebServerApplicationContext`) and calls `refresh()`. Auto-configuration
  is a Boot feature layered on top — the core IoC container is identical Spring
  Framework machinery.

---

## References

- Spring Framework Reference — Core Technologies, "The IoC Container":
  https://docs.spring.io/spring-framework/reference/core/beans.html
- Spring Framework Reference — "Container Overview":
  https://docs.spring.io/spring-framework/reference/core/beans/basics.html
- Spring Framework Reference — "BeanFactory API":
  https://docs.spring.io/spring-framework/reference/core/beans/beanfactory.html
- Javadoc — `org.springframework.beans.factory.BeanFactory`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/BeanFactory.html
- Javadoc — `org.springframework.context.ApplicationContext`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/ApplicationContext.html
- Javadoc — `AbstractApplicationContext.refresh()`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/support/AbstractApplicationContext.html
- Spring Framework Reference — "Additional Capabilities of the ApplicationContext":
  https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html
