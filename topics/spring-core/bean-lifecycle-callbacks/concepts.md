# Bean Lifecycle and Lifecycle Callbacks

Spring's IoC container does far more than construct objects: it manages a full
*lifecycle* for every bean it owns — from instantiation, through dependency
injection and initialization, to destruction. Understanding the precise ordering
of these phases and the hooks you can register at each one is a staple of Spring
interviews, because it explains *why* your `@PostConstruct` runs when it does,
*why* a proxy or configured property is (or is not) available in a callback, and
*why* a prototype bean's cleanup never fires.

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

## Common follow-up questions

- **In what order do `@PostConstruct`, `afterPropertiesSet()`, and a custom
  `init-method` run?** `@PostConstruct` first, then `afterPropertiesSet()`, then
  the custom init method. Destruction mirrors this: `@PreDestroy`,
  `DisposableBean.destroy()`, then the custom destroy method.

- **Why doesn't my prototype bean's `@PreDestroy` run?** Because the container
  does not manage prototype destruction — it forgets the instance after handing
  it out. You must clean up prototypes yourself.

- **What's the difference between `BeanPostProcessor` and
  `BeanFactoryPostProcessor`?** The former works on bean *instances* during
  initialization (and can return a proxy); the latter works on bean *definitions*
  before any singleton is instantiated. Factory-processors run first.

- **When are `*Aware` callbacks invoked?** After property population, before the
  before-init `BeanPostProcessor` hooks and `@PostConstruct`. `BeanNameAware`,
  `BeanFactoryAware`, `BeanClassLoaderAware` are called directly; the
  ApplicationContext-family ones are called via `ApplicationContextAwareProcessor`.

- **Can I access field-injected dependencies in the constructor?** No — field and
  setter injection happen after instantiation. Use constructor injection or move
  the logic into `@PostConstruct`.

- **Where does AOP proxying happen in the lifecycle?** In
  `postProcessAfterInitialization` — the auto-proxy creator returns a proxy that
  replaces the raw bean, so callers receive the proxy.

- **javax vs jakarta?** Spring Framework 6 / Spring Boot 3 use
  `jakarta.annotation.PostConstruct` / `PreDestroy`. Spring 5 and earlier use
  `javax.annotation.*`. `@PostConstruct`/`@PreDestroy` support also requires the
  Jakarta/Java annotation API on the classpath.

- **What triggers singleton destruction callbacks?** Closing the context —
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
