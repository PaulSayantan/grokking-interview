# Bean Lifecycle and Lifecycle Callbacks

Spring's IoC container does far more than construct objects: it manages a full
*lifecycle* for every bean it owns — from instantiation, through dependency
injection and initialization, to destruction. Understanding the precise ordering
of these phases and the hooks you can register at each one is a staple of Spring
interviews, because it explains *why* your `@PostConstruct` runs when it does,
*why* a proxy or configured property is (or is not) available in a callback, and
*why* a prototype bean's cleanup never fires.

A useful analogy: think of it like onboarding an employee. They are *hired*
(instantiated), *given their tools and logins* (dependencies injected), *shown
the building and org chart* (aware callbacks), sent through *orientation before
their first real task* (init callbacks), then they *do the job* (ready), and
finally have an *exit interview and return their badge* (destruction). The
container is doing the setup work you would otherwise hand-write in a
constructor — but in a controlled order, so that every dependency actually
exists at the moment a phase needs it.

This note covers Spring **Framework** 6.x (Jakarta EE, `jakarta.annotation.*`).
Where the older Spring 5 / `javax.annotation.*` naming matters, it is called out
explicitly. None of the behavior here depends on Spring Boot — it is all core
container behavior provided by `ApplicationContext` / `BeanFactory`.

---

## Overview of the bean lifecycle

At the highest level a singleton bean managed by an `ApplicationContext` goes
through the following phases, in this order:

1. **Instantiation** — the container calls the constructor (or a factory
   method) to create the raw object instance.
2. **Populate properties (dependency injection)** — setter/field injection of
   collaborators and configured values happens after instantiation.
   (Constructor injection happens *during* step 1.)
3. **Aware interface callbacks** — the container injects container
   infrastructure by calling `BeanNameAware`, `BeanClassLoaderAware`,
   `BeanFactoryAware`, and (for `ApplicationContext`) the `*Aware` interfaces
   handled by `ApplicationContextAwareProcessor`
   (`ApplicationContextAware`, `EnvironmentAware`, `ResourceLoaderAware`,
   `ApplicationEventPublisherAware`, `MessageSourceAware`, etc.).
4. **`BeanPostProcessor.postProcessBeforeInitialization`** — every registered
   `BeanPostProcessor` gets a chance to wrap/modify the bean *before* init
   callbacks. This is also where `@PostConstruct` is invoked (see below).
5. **Initialization callbacks** — in order:
   `@PostConstruct` → `InitializingBean.afterPropertiesSet()` →
   custom `init-method` / `@Bean(initMethod=...)`.
6. **`BeanPostProcessor.postProcessAfterInitialization`** — every registered
   `BeanPostProcessor` runs again *after* init callbacks. This is where AOP
   proxies are typically created, so the object handed to callers may be a proxy
   wrapping the bean.
7. **Bean is ready** — fully initialized and available for use.
8. **Destruction callbacks** (on container shutdown, for singletons): in order:
   `@PreDestroy` → `DisposableBean.destroy()` →
   custom `destroy-method` / `@Bean(destroyMethod=...)`.

A useful mental model of the "creation" half:

```
new Bean()                         // 1. instantiate
  -> setDependencies(...)          // 2. populate properties
  -> setBeanName / setBeanFactory  // 3. aware callbacks
  -> BPP.beforeInit (+ @PostConstruct fires here)   // 4
  -> afterPropertiesSet()          // 5b
  -> init-method()                 // 5c
  -> BPP.afterInit (AOP proxy created here)         // 6
  -> READY                         // 7
```

Note the two *pairs* that people conflate: (a) instantiation vs. initialization
are different phases — a bean is instantiated (constructed) long before it is
initialized (init callbacks); (b) `BeanPostProcessor` (per-bean, at runtime)
vs. `BeanFactoryPostProcessor` (on bean *definitions*, before any bean of that
kind is instantiated).

---

## Instantiation and dependency population

**Instantiation** is the creation of the object. Spring supports:

- constructor injection (the recommended default), where dependencies are passed
  to the constructor — so they are available *before* any other lifecycle step;
- static/instance factory methods (`@Bean` methods are effectively factory
  methods on a configuration class);
- reflective no-arg construction followed by setter/field population.

**Dependency population** ("populate properties") is the phase where Spring
performs setter injection and field injection (`@Autowired`, `@Resource`,
`@Value`) after the object exists. Concretely, in
`AbstractAutowireCapableBeanFactory` the sequence inside `doCreateBean` is:

1. `createBeanInstance` — construct the object.
2. `populateBean` — resolve and inject dependencies (this is where
   `AutowiredAnnotationBeanPostProcessor`, an `InstantiationAwareBeanPostProcessor`,
   injects `@Autowired`/`@Value` fields).
3. `initializeBean` — aware callbacks, `BeanPostProcessor` before-init,
   init callbacks, `BeanPostProcessor` after-init.

Key consequence for interviews: **inside a constructor you cannot rely on
setter/field-injected dependencies** (they haven't been injected yet), but you
*can* rely on constructor-injected ones. If you need all dependencies present,
put initialization logic in `@PostConstruct` / `afterPropertiesSet()`, not in the
constructor.

```java
@Component
class OrderService {
    private final PricingClient pricing;   // constructor-injected: ready in ctor
    @Autowired private AuditLog audit;      // field-injected: NULL in ctor

    OrderService(PricingClient pricing) {
        this.pricing = pricing;
        // this.audit is still null here!
    }

    @PostConstruct
    void init() {
        // both pricing and audit are guaranteed non-null here
    }
}
```

**Circular dependencies:** Spring can resolve circular references between
singletons that use *setter/field* injection via early bean references (the
"three-level cache": `singletonObjects`, `earlySingletonObjects`,
`singletonFactories`). It *cannot* resolve a circular dependency expressed
purely through *constructor* injection — that throws
`BeanCurrentlyInCreationException`.

The three-level cache is subtler than "singletons are cached once built":

- `singletonObjects` (level 1) holds fully initialized singletons.
- `earlySingletonObjects` (level 2) holds raw early references that have been
  *exposed* but not yet initialized.
- `singletonFactories` (level 3) holds `ObjectFactory` lambdas that, when
  invoked, run the `getEarlyBeanReference` chain of
  `SmartInstantiationAwareBeanPostProcessor`s. This is the hook that lets AOP
  produce an **early proxy** when a bean is referenced mid-creation.

Why three levels and not two? The factory level exists so that the early proxy
is created **at most once** and only **on demand**. If a bean B, mid-creation,
injects a reference to A (also mid-creation), A's factory is invoked, the early
(possibly proxied) reference is promoted from level 3 to level 2, and B receives
*that same* reference A will ultimately expose.

**Worked trace — A and B in a setter cycle.** Say `A` needs `B` and `B` needs
`A`, both via field/setter injection, and neither is AOP-advised. Watch which
map holds what after each step (L1 = `singletonObjects`, L2 =
`earlySingletonObjects`, L3 = `singletonFactories`):

1. `getBean(A)` starts. A is instantiated (raw `new A()`), and A's
   `ObjectFactory` is placed in **L3**.
   `L1={} · L2={} · L3={A}`
2. `populateBean(A)` runs; A needs B, so it triggers `getBean(B)`.
   (A is still parked mid-population.)
   `L1={} · L2={} · L3={A}`
3. B is instantiated; B's factory goes into **L3**. `populateBean(B)` runs; B
   needs A, so it calls `getBean(A)`. A is not in L1 or L2, but its factory is
   in L3 — so that factory is invoked, running `getEarlyBeanReference` (which
   would create an early proxy *if* A were advised; here it just returns raw A).
   That early reference is promoted **L3 → L2**, and B's setter receives it.
   `L1={} · L2={A} · L3={B}`
4. B now has its A reference, so B finishes initialization. The finished B is
   promoted to **L1** and dropped from L3.
   `L1={B} · L2={A} · L3={}`
5. Control returns to step 2: A's `populateBean` gets the finished B and injects
   it. A finishes initialization. Before caching, Spring checks that the object
   it finished equals the early reference sitting in L2 (identity match here,
   since no proxy diverged), then promotes A to **L1**, clearing L2.
   `L1={A,B} · L2={} · L3={}`

The key insight the trace makes concrete: B never sees a half-built A getter by
getter — it gets one stable reference (from L3, cached in L2) that becomes the
*same* object A ends up publishing in L1. Level 3 exists so that reference is
minted **once, lazily, only if something actually asks for A mid-creation**.

**The AOP + circular-reference gotcha:** if A is proxied and lands in a setter
cycle, Spring compares the object it finished initializing against the early
reference already handed to B. If the final wrapping differs from the early
reference (e.g., a post-processor other than the standard auto-proxy creator
wraps A *after* B already captured the early reference), Spring throws
`BeanCurrentlyInCreationException` ("Bean with name 'a' has been injected into
other beans ... in its raw version as part of a circular reference, but has
eventually been wrapped"). The fix is to break the cycle (e.g. `@Lazy` on one
injection point) rather than to rely on early-reference identity.

**`@Lazy` as a cycle-breaker:** annotating an injection point `@Lazy` injects a
lazy-resolution proxy instead of forcing the target's creation, so the cycle
never forms during instantiation. This works even for constructor injection,
which is otherwise unresolvable in a cycle.

Note that `allowCircularReferences` defaults to `true` in the framework but
Spring Boot 2.6+ flips it to `false`, so a setter cycle that "worked" on the
plain framework can fail under Boot unless explicitly re-enabled.

---

## Aware interfaces

`*Aware` interfaces are callback interfaces that let a bean receive references to
container infrastructure. The container detects them and calls their single
setter during the `initializeBean` phase — **after** properties are populated but
**before** the `BeanPostProcessor` before-init hooks / `@PostConstruct`.

Two groups exist, invoked at slightly different points:

- Invoked directly by `AbstractAutowireCapableBeanFactory.invokeAwareMethods`
  *before* the before-init post-processors run:
  `BeanNameAware`, `BeanClassLoaderAware`, `BeanFactoryAware`.
- Invoked by a dedicated `BeanPostProcessor` (`ApplicationContextAwareProcessor`)
  registered automatically when you use an `ApplicationContext`:
  `EnvironmentAware`, `EmbeddedValueResolverAware`, `ResourceLoaderAware`,
  `ApplicationEventPublisherAware`, `MessageSourceAware`,
  `ApplicationContextAware`, `ApplicationStartupAware`.

| Aware interface | Injects |
|---|---|
| `BeanNameAware` | the bean's id/name in the container |
| `BeanFactoryAware` | the owning `BeanFactory` |
| `BeanClassLoaderAware` | the class loader used to load the bean |
| `ApplicationContextAware` | the `ApplicationContext` |
| `EnvironmentAware` | the `Environment` (profiles, properties) |
| `ResourceLoaderAware` | a `ResourceLoader` |
| `ApplicationEventPublisherAware` | an event publisher |
| `MessageSourceAware` | the `MessageSource` for i18n |

Modern style prefers dependency injection (e.g. `@Autowired
ApplicationContext ctx`) over implementing `*Aware`, because `*Aware` couples
your code to Spring. The `*Aware` interfaces remain useful in framework/infra
code and where you genuinely need the callback timing.

```java
@Component
class Infra implements BeanNameAware, ApplicationContextAware {
    public void setBeanName(String name) { /* called first */ }
    public void setApplicationContext(ApplicationContext ctx) { /* called via BPP */ }
}
```

---

## The three init and destroy mechanisms and their order

Spring offers **three** ways to hook initialization and three parallel ways to
hook destruction. You can use more than one on the same bean; when you do, Spring
runs them in a **fixed order**.

### Initialization order

1. `@PostConstruct`-annotated method
   (`jakarta.annotation.PostConstruct` in Spring 6; `javax.annotation.PostConstruct`
   in Spring 5). Processed by `CommonAnnotationBeanPostProcessor`, whose
   before-init hook invokes it — so it runs inside the *before-init* phase.
2. `InitializingBean.afterPropertiesSet()` — the container calls this after
   before-init post-processors, if the bean implements the interface.
3. Custom init method — `@Bean(initMethod = "...")`, or XML `init-method`, or the
   default-init-method. Invoked by reflection right after `afterPropertiesSet()`.

### Destruction order

1. `@PreDestroy`-annotated method (again via `CommonAnnotationBeanPostProcessor`
   / `DestructionAwareBeanPostProcessor`).
2. `DisposableBean.destroy()`.
3. Custom destroy method — `@Bean(destroyMethod = "...")` / XML `destroy-method`.

| Mechanism | Init hook | Destroy hook | Coupling to Spring | Notes |
|---|---|---|---|---|
| JSR-250 annotations | `@PostConstruct` | `@PreDestroy` | none (Jakarta/Java annotations) | runs **first**; recommended for app code |
| Spring interfaces | `InitializingBean.afterPropertiesSet()` | `DisposableBean.destroy()` | tight (implements Spring types) | avoids reflection lookup; couples code to Spring |
| Bean metadata | `@Bean(initMethod)` / XML `init-method` | `@Bean(destroyMethod)` / XML `destroy-method` | none | best for 3rd-party classes you can't annotate |

Interview trap: the annotation-based callbacks run **first**, then the Spring
interface, then the named method. So for one bean using all three, init order is
`@PostConstruct` → `afterPropertiesSet()` → `initMethod`, and destroy order is
`@PreDestroy` → `destroy()` → `destroyMethod`.

```java
@Configuration
class AppConfig {
    @Bean(initMethod = "start", destroyMethod = "stop")
    Server server() { return new Server(); }
}

class Server implements InitializingBean, DisposableBean {
    @PostConstruct void post()          { /* 1 */ }
    public void afterPropertiesSet()    { /* 2 */ }
    void start()                        { /* 3 */ }

    @PreDestroy  void pre()             { /* 1 */ }
    public void destroy()               { /* 2 */ }
    void stop()                         { /* 3 */ }
}
```

**Inferred destroy methods:** For `@Bean` methods, if you do *not* set
`destroyMethod`, Spring by default (`destroyMethod = AbstractBeanDefinition.INFER_METHOD`)
will look for a public, no-arg `close()` or `shutdown()` method and call it on
shutdown. Set `destroyMethod = ""` to disable this inference (e.g., to avoid an
unwanted double close). This inference applies to `@Bean` methods, not to
XML-defined beans.

**Recommendation:** Prefer JSR-250 `@PostConstruct` / `@PreDestroy` for your own
code — no Spring coupling and clear intent — and use `@Bean(initMethod/destroyMethod)`
for third-party classes you cannot annotate. Note that `@PostConstruct` /
`@PreDestroy` detection requires `CommonAnnotationBeanPostProcessor` to be
registered, which happens automatically with annotation-config or component
scanning (`<context:annotation-config/>`, `@ComponentScan`, or an
`AnnotationConfigApplicationContext`).

> [!WARNING]
> Since Spring 6 / Boot 3, `@PostConstruct` / `@PreDestroy` live in
> `jakarta.annotation.*`, whose `jakarta.annotation-api` JAR is **not always on
> the classpath** in plain (non-web) Spring Framework projects. If that JAR is
> absent, the annotations are **silently ignored** — no error, your init method
> just never runs. This is the classic "my `@PostConstruct` stopped firing after
> I upgraded to Spring 6" bug. Boot's starters pull the dependency in
> transitively; a bare Framework project may need to add it explicitly.

### Deduplication when the same method is targeted twice

The "three mechanisms run in order" rule assumes three *distinct* methods. If two
or more mechanisms resolve to the **same method name**, Spring runs that method
**once**, not multiple times. For example, if a bean implements
`InitializingBean` and also declares `@Bean(initMethod = "afterPropertiesSet")`,
`afterPropertiesSet()` runs a single time. The same collapsing applies to
`@PostConstruct` placed on a method that is also the named init-method. This is
why you rarely see a method double-invoked even when configs overlap.

### Ordering and inheritance edge cases

- **Multiple `@PostConstruct` in a class hierarchy:** JSR-250 permits one
  `@PostConstruct` method per class. When a subclass and its superclass each
  declare one, Spring invokes the **superclass** `@PostConstruct` **before** the
  subclass one (parent-first), mirroring construction order. `@PreDestroy`
  ordering is the reverse (subclass first). Declaring more than one
  `@PostConstruct` in a *single* class is illegal per the spec.
- **`@PostConstruct` on a private method** still works — Spring invokes it
  reflectively, making it accessible — but such a method is *not* overridable, so
  a subclass cannot replace it.
- **Static or parameterized methods are invalid:** `@PostConstruct` /
  `@PreDestroy` must be non-static and take no arguments; a non-void return is
  tolerated but ignored.
- **Init methods and AOP:** init callbacks (`@PostConstruct`,
  `afterPropertiesSet`, init-method) run on the **target instance**, *before*
  the after-init post-processor creates the AOP proxy. So an init method that
  calls another advised method on `this` bypasses the proxy — the advice
  (transactions, caching) does **not** apply during initialization.

---

## BeanPostProcessor

`BeanPostProcessor` is a container extension point that lets you run logic
against **every bean instance** as it is being created — both before and after
the initialization callbacks. It has two methods (both `default` since Spring
5, returning the bean unchanged):

```java
public interface BeanPostProcessor {
    default Object postProcessBeforeInitialization(Object bean, String beanName) { return bean; }
    default Object postProcessAfterInitialization(Object bean, String beanName)  { return bean; }
}
```

Key points:

- It operates on **already-instantiated bean instances**, not on bean
  definitions.
- `postProcessBeforeInitialization` runs after aware callbacks and before init
  callbacks; `@PostConstruct` is itself implemented via a `BeanPostProcessor`'s
  before-init hook.
- `postProcessAfterInitialization` runs after init callbacks. **Returning a
  different object here replaces the bean** — this is exactly how Spring AOP
  (`AbstractAutoProxyCreator`) wraps beans in proxies. So the reference callers
  get can be a proxy, not the raw instance.

```java
@Component
class TimingBpp implements BeanPostProcessor {
    public Object postProcessAfterInitialization(Object bean, String name) {
        if (!(bean instanceof Service)) return bean;   // guard: only wrap Service
        return Proxy.newProxyInstance(               // return a DIFFERENT object
            bean.getClass().getClassLoader(),
            bean.getClass().getInterfaces(),
            (proxy, method, args) -> {
                long t = System.nanoTime();
                try { return method.invoke(bean, args); }   // delegate to raw bean
                finally { log.info(name + "." + method.getName() + " took " +
                                   (System.nanoTime() - t) + "ns"); }
            });
    }
}
```

Because this returns the proxy rather than `bean`, the container stores **that
wrapper** in the singleton cache. Every later injection point that asks for the
`Service` gets the timing proxy, not the original instance — the raw bean now
only exists as the proxy's private delegate.
- A `BeanPostProcessor` applies to beans in the **same container**, not to beans
  in a parent context.
- Beans that are themselves `BeanPostProcessor`s are instantiated early (before
  the ordinary beans they process). Because of this, a `BeanPostProcessor` (and
  its own dependencies) may not be eligible for auto-proxying/other
  post-processing — Spring logs a warning like "not eligible for getting
  processed by all BeanPostProcessors" if a BPP's dependencies are instantiated
  too early.
- Ordering among multiple `BeanPostProcessor`s follows `PriorityOrdered` then
  `Ordered` then registration order (`Ordered.getOrder()`).

Well-known built-in `BeanPostProcessor`s: `AutowiredAnnotationBeanPostProcessor`
(`@Autowired`/`@Value`), `CommonAnnotationBeanPostProcessor`
(`@PostConstruct`/`@PreDestroy`/`@Resource`),
`ApplicationContextAwareProcessor` (the ApplicationContext-family aware
callbacks), and `AbstractAutoProxyCreator` subclasses (AOP).

There is also a sub-interface, `InstantiationAwareBeanPostProcessor`, whose
`postProcessBeforeInstantiation` / `postProcessAfterInstantiation` /
`postProcessProperties` hooks fire around the *instantiation* and
*property-population* phases (earlier than the standard init hooks). This is how
field/setter injection is actually applied.

### Ordering, early instantiation, and self-processing gotchas

The ordering rules deserve care, because they are a frequent source of subtle
bugs:

- `BeanPostProcessor`s are sorted into three tiers when applied:
  `PriorityOrdered` first, then `Ordered`, then the remaining (unordered)
  processors in registration order. Crucially, this ordering is only honored for
  BPPs **registered as beans** in the context and applied via
  `AbstractApplicationContext.refresh()` → `registerBeanPostProcessors`. BPPs
  added *programmatically* through
  `ConfigurableBeanFactory.addBeanPostProcessor` are appended in call order and
  **do not participate** in the `Ordered` sort — a common surprise.
- Because BPPs must exist *before* the beans they process, the container
  instantiates all BPP beans eagerly during `refresh()`, ahead of ordinary
  singletons. A consequence: **a `BeanPostProcessor` (and the beans it depends
  on, pulled in transitively) is created too early to be post-processed by
  other BPPs.** If your BPP `@Autowired`s a service that would normally be
  AOP-proxied or `@Transactional`, that service may be instantiated as a *raw,
  unproxied* instance, and Spring logs
  *"is not eligible for getting processed by all BeanPostProcessors (for
  example: not eligible for auto-proxying)."* The remedy is to make the BPP's
  dependency `@Lazy` or `ObjectProvider`-wrapped so it is not forced early.
- A `BeanPostProcessor`'s own callbacks are **never applied to itself**, and BPPs
  do not process other BPPs unless the other one was created earlier — ordering
  among BPP beans affects which infrastructure beans a given BPP sees.
- `BeanPostProcessor` methods are invoked for essentially every bean, including
  many internal/infrastructure beans. Throwing from a BPP, or doing expensive
  work unconditionally, is a global tax; guard on `beanName`/type and return
  fast for beans you do not care about.

### InstantiationAwareBeanPostProcessor short-circuiting

`InstantiationAwareBeanPostProcessor.postProcessBeforeInstantiation` runs
**before** the constructor is even called. If it returns a non-null object,
Spring treats that object as the finished bean and **skips normal
instantiation, population, and init callbacks entirely** — only
`postProcessAfterInitialization` still runs on the substitute. This is the
lowest-level interception point and is how some frameworks return fully custom
or proxied stand-ins in place of the real bean.

---

## BeanFactoryPostProcessor

`BeanFactoryPostProcessor` is a different extension point that operates on the
**bean definitions (metadata)**, not on bean instances, and it runs **earlier**
than any `BeanPostProcessor` activity:

```java
public interface BeanFactoryPostProcessor {
    void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory);
}
```

- It executes after all bean definitions have been loaded but **before any
  (non-lazy) singleton bean is instantiated**. Therefore it can read and modify
  property values, scopes, and other definition metadata — but it should **not**
  instantiate beans (doing so forces premature instantiation and can break other
  post-processors).
- The canonical example is `PropertySourcesPlaceholderConfigurer` (and the older
  `PropertyPlaceholderConfigurer`), which resolves `${...}` placeholders in bean
  definitions. Because it must rewrite definitions before beans are built, it is
  a `BeanFactoryPostProcessor`.
- A `BeanDefinitionRegistryPostProcessor` is a sub-interface that can **add or
  remove bean definitions** (its `postProcessBeanDefinitionRegistry` runs even
  earlier than `postProcessBeanFactory`). `ConfigurationClassPostProcessor` —
  which processes `@Configuration`, `@Bean`, `@ComponentScan`, `@Import` — is
  one of these.

### BeanPostProcessor vs BeanFactoryPostProcessor

| | `BeanFactoryPostProcessor` | `BeanPostProcessor` |
|---|---|---|
| Operates on | bean **definitions** (metadata) | bean **instances** |
| When | after definitions loaded, **before** any singleton instantiated | during each bean's initialization (before/after init) |
| Typical use | placeholder resolution, tweaking scopes/definitions, `@Configuration` processing | dependency injection, `@PostConstruct`, AOP proxying, validation |
| Can change the object handed to callers? | not directly (changes metadata) | yes — `postProcessAfterInitialization` can return a proxy |
| Granularity | once over the whole factory | once per bean instance |

Mnemonic: **BeanFactoryPostProcessor** works on the *factory* (the recipes /
definitions), **BeanPostProcessor** works on the *products* (the instances). The
factory processors necessarily finish before the product processors begin.

---

## Prototype bean lifecycle and destruction

Bean scope changes what the container manages:

- **Singleton (default):** the container creates the instance, caches it, and
  manages its **full** lifecycle including destruction callbacks at context
  shutdown.
- **Prototype:** the container creates and configures a **new** instance on every
  request (each `getBean` / injection point), runs all *initialization*
  callbacks — but then **hands the instance to the client and forgets about it.**

The critical interview point: **Spring does NOT call destruction callbacks for
prototype-scoped beans.** `@PreDestroy`, `DisposableBean.destroy()`, and any
configured `destroy-method` are **not** invoked by the container for prototypes,
because the container does not retain a reference to them. Initialization
callbacks *do* run for prototypes; only destruction is skipped.

> "In contrast to the other scopes, Spring does not manage the complete lifecycle
> of a prototype bean: the container instantiates, configures, and otherwise
> assembles a prototype object and hands it to the client, with no further record
> of that prototype instance." — Spring reference documentation.

Consequences and remedies:

- The **client** is responsible for cleaning up prototype instances that hold
  expensive resources (connections, file handles, etc.).
- To force cleanup you can use a custom `BeanPostProcessor` that holds references
  and cleans them up, or a factory/`ObjectProvider` and explicit disposal, or
  access `beanFactory.getBean(...)` and call the cleanup yourself.
- A related gotcha: injecting a prototype bean into a singleton yields **one**
  prototype instance captured at singleton-creation time (it is not re-created
  per call). To get a fresh prototype each time, use `@Lookup` method injection,
  an `ObjectProvider<T>` / `Provider<T>`, or a scoped proxy.

```java
@Component @Scope("prototype")
class Task implements DisposableBean {
    @PreDestroy void pre()   { /* NEVER called by the container */ }
    public void destroy()    { /* NEVER called by the container */ }
}
```

Web scopes (`request`, `session`) *do* have their destruction callbacks invoked
by the web-aware container when the request/session ends — those are managed,
unlike plain prototypes.

---

## Startup and shutdown, Lifecycle and SmartLifecycle

Beyond per-bean init/destroy, Spring provides `Lifecycle` / `SmartLifecycle`
for components that need coordinated **start/stop** semantics tied to the context
(e.g., message listeners, schedulers):

- `Lifecycle` has `start()`, `stop()`, `isRunning()`; the context propagates
  `start()`/`stop()` to `Lifecycle` beans.
- `SmartLifecycle` adds `getPhase()` (ordering — lower phases start first, stop
  last), `isAutoStartup()` (start automatically with the context), and a
  callback-style `stop(Runnable)` for asynchronous shutdown.

**Phase semantics precisely:** startup goes from the **lowest** phase to the
**highest**; shutdown is the exact reverse (highest phase stops first). A plain
`Lifecycle` (non-Smart) bean is treated as phase `0`. The `SmartLifecycle`
`DEFAULT_PHASE` is `Integer.MAX_VALUE`, which deliberately places auto-started
smart components **last to start and first to stop** — the rationale being that
a component started last generally depends on everything before it, so it should
be torn down first. A negative phase therefore starts *before* ordinary
`Lifecycle` beans; a positive phase starts *after* them. Beans sharing a phase
have no guaranteed order among themselves. Explicit `depends-on` relationships
override phase: a dependent bean starts after, and stops before, its dependency.

**Worked example — four beans, four phases.** Take:

- `Metrics` — `SmartLifecycle`, phase **-10**
- `Cache` — plain `Lifecycle` (no phase) → treated as phase **0**
- `HttpServer` — `SmartLifecycle`, phase **100**
- `Scheduler` — default `SmartLifecycle` → phase **`Integer.MAX_VALUE`** (2,147,483,647)

Sort the phases ascending: `-10 < 0 < 100 < MAX_VALUE`.

- **Start order (lowest → highest):** `Metrics(-10)` → `Cache(0)` →
  `HttpServer(100)` → `Scheduler(MAX_VALUE)`.
- **Stop order (exact reverse, highest → lowest):** `Scheduler(MAX_VALUE)` →
  `HttpServer(100)` → `Cache(0)` → `Metrics(-10)`.

Read off the two rules the trace makes concrete: the default `MAX_VALUE`
component (`Scheduler`) starts **last** and stops **first** — sensible, since a
thing started last usually depends on everything before it and should be torn
down before its dependencies go. And the negative-phase bean (`Metrics`) starts
**before** the plain-`Lifecycle` `Cache` (phase 0) and stops **after** it, so
metrics collection is up first and down last.

**`stop(Runnable)` and the shutdown timeout:** on context close, the
`DefaultLifecycleProcessor` stops beans one phase at a time, and within a phase
invokes the async `stop(Runnable)` form; it then **blocks waiting** for each
bean to call `callback.run()` before moving to the next phase, up to a per-phase
timeout (default **30 seconds**, configurable via
`setTimeoutPerShutdownPhase`). If your `stop(Runnable)` implementation forgets to
invoke the callback, context shutdown stalls for the full timeout on that phase.

**Lifecycle stop vs. destruction:** `stop()` is *not* the same as
`@PreDestroy`. On an orderly `close()`, Spring first sends `stop` to `Lifecycle`
beans (in phase order) and *then* runs destruction callbacks. But this ordering
guarantee holds only for a regular shutdown — on a "stopped"/failed refresh,
Spring may run destroy callbacks **without** a preceding `stop`. Do not rely on
`stop()` always running before `@PreDestroy`.

To ensure singleton destruction callbacks actually run in a standalone
(non-web) application, either call `context.close()` explicitly or register a JVM
shutdown hook with `context.registerShutdownHook()`. If the context is never
closed, `@PreDestroy` / `destroy()` on singletons will not fire. The
`ConfigurableApplicationContext` interface declares both `close()` and
`registerShutdownHook()`.

```java
ConfigurableApplicationContext ctx =
        new AnnotationConfigApplicationContext(AppConfig.class);
ctx.registerShutdownHook();   // ensures @PreDestroy runs on JVM exit
// ... use beans ...
ctx.close();                  // triggers singleton destruction callbacks
```

---

## Exceptions and failure modes during the lifecycle

What happens when a callback throws is a favorite senior probe because the
answer varies by phase:

- **Exception in a constructor, `populateBean`, an aware callback, or any init
  callback** (`@PostConstruct` / `afterPropertiesSet` / init-method) propagates
  out of `getBean`, is wrapped in a `BeanCreationException`, and **aborts context
  refresh**. For a non-lazy singleton this means the whole `ApplicationContext`
  fails to start. The half-created bean is *not* left in the singleton cache.
- **Cleanup of already-created singletons on a failed refresh:** when `refresh()`
  fails partway, Spring calls `destroyBeans()` and invokes destruction callbacks
  on the singletons it *had* already fully created, so their `@PreDestroy` runs
  even though startup ultimately failed. A bean whose own init threw, however,
  never reached the "registered as disposable" point, so its destroy callbacks
  do **not** run.
- **Exception in a destruction callback** (`@PreDestroy` / `destroy()` /
  destroy-method) is **caught and logged**, not propagated, and Spring continues
  destroying the remaining beans. One misbehaving `@PreDestroy` will not prevent
  other beans from being destroyed, but it also will not fail the `close()` call.
- **Exception thrown from `postProcessBeforeInitialization` /
  `postProcessAfterInitialization`** propagates and fails that bean's creation
  (and thus refresh, for a non-lazy singleton), because BPPs run inline in
  `initializeBean`.
- **`SmartLifecycle.stop` throwing** is logged by the `LifecycleProcessor`;
  shutdown proceeds to the next bean/phase.

Because a throwing init callback aborts startup, `@PostConstruct` /
`afterPropertiesSet` are the correct place to **fail fast** on misconfiguration —
you want the app to refuse to start rather than serve traffic in a broken state.

## Ordering of bean creation, depends-on, and destruction

Init-callback ordering *within* one bean is fixed, but the order in which
different beans are created and destroyed is governed by dependencies:

- Spring instantiates beans in **dependency order**: a bean is created after the
  beans it needs (constructor args, `@Autowired` collaborators, and any
  `@DependsOn`). `@DependsOn` forces an ordering even when there is no injection
  edge — useful when one bean has a side effect (registering a driver, priming a
  cache) another relies on.
- **Destruction is the reverse of creation order.** A dependency is destroyed
  *after* the beans that depend on it, so a bean's collaborators are still valid
  during its `@PreDestroy`. `@DependsOn` similarly reverses at shutdown.
- This creation/destruction ordering is **independent** of `SmartLifecycle`
  phase ordering. Phases control `start()`/`stop()`; dependency order controls
  instantiation and destroy callbacks. A bean can therefore be *stopped* (via
  `Lifecycle`) in one order and *destroyed* (via `@PreDestroy`) in another.
- Ties (beans with no dependency relationship) fall back to bean-definition
  registration order, which for component scanning is effectively filesystem /
  classpath order — do **not** depend on it.

## Thread-safety and timing of lifecycle callbacks

- **Singleton creation is guarded by a lock.** `getSingleton` in
  `DefaultSingletonBeanRegistry` synchronizes on the singleton cache, so a given
  singleton is created (and its init callbacks run) exactly once even under
  concurrent `getBean` calls. Init callbacks therefore need no synchronization
  against *other threads creating the same bean* — but this lock has historically
  been a **deadlock risk** if a `@PostConstruct` spawns a thread that itself
  calls `getBean` on a bean currently mid-creation.
- **`@PostConstruct` is not a "container fully started" signal.** It runs while
  the owning bean is being created, which may be *before* other beans (even ones
  in a later part of the same refresh) exist. Publishing events or touching
  not-yet-created beans from `@PostConstruct` is fragile. For "everything is
  ready" logic, listen for `ContextRefreshedEvent` / `ApplicationReadyEvent`, or
  use `SmartLifecycle.start()`, which run after *all* singletons are initialized.
- **Prototype creation is not globally serialized** the way singletons are; two
  threads requesting a prototype get two independent instances, each running its
  own init callbacks concurrently. Any shared state a prototype's init touches
  must be thread-safe.
- **Visibility:** because the creating thread publishes the fully initialized
  singleton into the cache under a lock and readers acquire it through the same
  structures, a correctly injected singleton is safely published; but a bean that
  hands out `this` from within its constructor or init method (e.g. registering a
  callback) risks exposing a partially constructed object.

## Common follow-up questions

- In what order do `@PostConstruct`, `afterPropertiesSet()`, and a custom
  `init-method` run? `@PostConstruct` first, then `afterPropertiesSet()`, then
  the custom init method. Destruction mirrors this: `@PreDestroy`,
  `DisposableBean.destroy()`, then the custom destroy method.

- Why doesn't my prototype bean's `@PreDestroy` run? Because the container
  does not manage prototype destruction — it forgets the instance after handing
  it out. You must clean up prototypes yourself.

- What's the difference between `BeanPostProcessor` and
  `BeanFactoryPostProcessor`? The former works on bean *instances* during
  initialization (and can return a proxy); the latter works on bean *definitions*
  before any singleton is instantiated. Factory-processors run first.

- When are `*Aware` callbacks invoked? After property population, before the
  before-init `BeanPostProcessor` hooks and `@PostConstruct`. `BeanNameAware`,
  `BeanFactoryAware`, `BeanClassLoaderAware` are called directly; the
  ApplicationContext-family ones are called via `ApplicationContextAwareProcessor`.

- Can I access field-injected dependencies in the constructor? No — field and
  setter injection happen after instantiation. Use constructor injection or move
  the logic into `@PostConstruct`.

- Where does AOP proxying happen in the lifecycle? In
  `postProcessAfterInitialization` — the auto-proxy creator returns a proxy that
  replaces the raw bean, so callers receive the proxy.

- javax vs jakarta? Spring Framework 6 / Spring Boot 3 use
  `jakarta.annotation.PostConstruct` / `PreDestroy`. Spring 5 and earlier use
  `javax.annotation.*`. `@PostConstruct`/`@PreDestroy` support also requires the
  Jakarta/Java annotation API on the classpath.

- What triggers singleton destruction callbacks? Closing the context —
  `ctx.close()` or a shutdown hook via `ctx.registerShutdownHook()`. Without
  closing the context, destruction callbacks do not fire.

---

## References

- Spring Framework Reference — Core: "Customizing the Nature of a Bean"
  (Lifecycle Callbacks, InitializingBean/DisposableBean, initialization/destruction
  method ordering): https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html
- Spring Framework Reference — Core: "Container Extension Points"
  (`BeanPostProcessor`, `BeanFactoryPostProcessor`):
  https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html
- Spring Framework Reference — Core: "Bean Scopes"
  (singleton vs prototype, prototype not fully managed):
  https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html
- Spring Framework Reference — Core: "Aware interfaces":
  https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html#aware-list
- Javadoc: `org.springframework.beans.factory.config.BeanPostProcessor`,
  `BeanFactoryPostProcessor`, `InitializingBean`, `DisposableBean`,
  `SmartLifecycle`, `ConfigurableApplicationContext`.
- JSR-250 Common Annotations (`@PostConstruct`, `@PreDestroy`).
