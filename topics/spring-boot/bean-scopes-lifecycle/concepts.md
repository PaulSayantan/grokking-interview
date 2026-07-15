# Bean Scopes & Lifecycle

Spring beans are objects that the Spring IoC container instantiates, assembles, configures and manages. Two orthogonal questions define a bean's runtime behavior: **scope** ("how many instances exist and for how long?") and **lifecycle** ("what callbacks fire between creation and destruction?"). Interviewers probe both because misunderstanding them causes the most common production bugs: shared mutable state in singletons, memory-leaking prototypes, and initialization-order surprises.

---

## Bean scopes overview

A **scope** controls the number of instances the container creates for a bean definition and the lifetime/visibility of each instance. Spring ships six built-in scopes:

| Scope | Bean lifetime | Beans per container / context | Availability |
|---|---|---|---|
| `singleton` (default) | Entire container lifetime | Exactly one per container | Always |
| `prototype` | Per request for the bean (`getBean`/injection) | New instance every time | Always |
| `request` | One HTTP request | One per HTTP request | Web-aware contexts only |
| `session` | One HTTP session | One per HTTP session | Web-aware contexts only |
| `application` | `ServletContext` lifetime | One per `ServletContext` | Web-aware contexts only |
| `websocket` | One WebSocket session | One per WebSocket session | WebSocket apps only |

You set a scope with `@Scope`:

```java
@Component
@Scope("prototype")                    // or @Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
public class Task { }
```

Key nuance: "singleton" here means **one-per-Spring-container**, NOT the classic GoF one-per-classloader/JVM singleton. Two `ApplicationContext`s each get their own instance of a "singleton" bean.

---

## Singleton scope

The default scope. The container creates **one shared instance** per bean definition and returns the same object reference for every injection point and every `getBean` call.

- **Eager by default**: singletons are instantiated when the `ApplicationContext` starts (during `refresh()` → `finishBeanFactoryInitialization` → `preInstantiateSingletons`). This surfaces wiring errors at startup ("fail fast") rather than at first use.
- **Lazy option**: `@Lazy` (or `default-lazy-init`) defers creation until first requested.
- Instances are cached in the container's singleton registry (`DefaultSingletonBeanRegistry`), keyed by bean name.

```java
@Service
public class PriceService { }   // singleton by default — one instance app-wide
```

Because the single instance is shared across all threads, **singletons must be stateless or otherwise thread-safe** (see below).

---

## Prototype scope

A new instance is created **every time the bean is requested** — whether via `getBean(...)` or via dependency injection into another bean.

```java
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
public class ShoppingCart { }
```

Critical gotchas:

- **The container does NOT manage the full lifecycle of a prototype.** Spring instantiates, populates, and runs initialization callbacks (`@PostConstruct`), then hands the bean to the caller and **forgets about it**. `@PreDestroy` / `DisposableBean.destroy()` are **NOT called** by the container for prototypes. Cleanup is the client's responsibility (or a custom `BeanPostProcessor` / explicit `destroyBean`). This is the famous "prototype destruction caveat."
- **Injection timing**: injecting a prototype into a singleton gives the singleton **one** prototype instance created at singleton-creation time — you do NOT get a fresh prototype per method call. To get a new instance each time, use one of: method injection via `@Lookup`, `ObjectProvider<T>`/`ObjectFactory<T>`, `Provider<T>` (JSR-330), or a scoped proxy.

```java
@Component
public class OrderProcessor {
    @Autowired private ObjectProvider<ShoppingCart> cartProvider;

    public void handle() {
        ShoppingCart cart = cartProvider.getObject();  // fresh prototype each call
    }
}
```

---

## Singleton vs prototype

| Aspect | Singleton | Prototype |
|---|---|---|
| Instances | One per container | One per request/injection |
| Creation timing | Eager at startup (unless `@Lazy`) | Lazily, on each request |
| Lifecycle managed | Full (init + destroy) | Init only; **destroy NOT called** |
| Thread safety | Must be ensured by developer | Usually per-use, less shared state |
| Default? | Yes | No |
| Memory | Fixed cost | Grows with usage; GC-reclaimed |

Interview trap — "how many prototype instances does a singleton get?" Answer: exactly one, injected at singleton creation, unless you use lookup/provider/scoped-proxy.

---

## Request, session, application scopes

These "web-aware" scopes require a web-capable context (they're registered by `WebApplicationContext` / Spring Boot web auto-config). Requesting them outside a web request throws `BeanCreationException` / `ScopeNotActiveException` unless a scoped proxy is used.

- **`request`** — one instance per HTTP request; discarded when the request completes.
- **`session`** — one instance per HTTP session; discarded when the session ends/invalidates.
- **`application`** — one instance per `ServletContext` (the whole web app). Similar to singleton but tied to the `ServletContext` rather than the container — subtle difference matters when multiple contexts share one `ServletContext`.

The core problem: how do you inject a short-lived `request`/`session` bean into a **singleton** (like a controller or service)? You inject a **scoped proxy** — a CGLIB/interface proxy that, on each method call, resolves the *real* current-request/session instance from the scope. Use `proxyMode`:

```java
@Component
@RequestScope   // meta-annotation = @Scope(value="request", proxyMode=TARGET_CLASS)
public class RequestContext { }

// equivalently:
@Scope(value = "session", proxyMode = ScopedProxyMode.TARGET_CLASS)
```

Spring Boot / Spring provide convenience composed annotations: `@RequestScope`, `@SessionScope`, `@ApplicationScope` (each defaults to `proxyMode = TARGET_CLASS`).

---

## WebSocket and custom scopes

- **`websocket`** — bean lives for the duration of a single WebSocket session; available when using Spring's WebSocket support (`spring-websocket`). Registered via `@Scope(scopeName = "websocket", proxyMode = TARGET_CLASS)`.

- **Custom scopes** — implement `org.springframework.beans.factory.config.Scope` (methods `get`, `remove`, `registerDestructionCallback`, `resolveContextualObject`, `getConversationId`) and register it with `ConfigurableBeanFactory.registerScope("myScope", new MyScope())`, typically via a `BeanFactoryPostProcessor` or `CustomScopeConfigurer`:

```java
@Bean
public static CustomScopeConfigurer scopeConfigurer() {
    CustomScopeConfigurer cfg = new CustomScopeConfigurer();
    cfg.addScope("thread", new SimpleThreadScope());
    return cfg;
}
```

Spring ships `SimpleThreadScope` (thread-bound; note it does NOT invoke destruction callbacks) as an example, but it is not registered by default.

---

## Thread safety of singletons

Because a singleton instance is shared across all threads, **any mutable instance state is shared** and must be guarded. This is the single most common cause of subtle concurrency bugs in Spring apps.

Safe patterns:
- **Stateless beans** — hold only immutable collaborators (other beans, config values). This is the idiomatic design and why most services are safe as singletons.
- Make mutable state **local to methods** (stack-confined) rather than instance fields.
- Use thread-safe types (`AtomicLong`, `ConcurrentHashMap`) for shared counters/caches.
- For per-request/per-thread state, use `request`/`session` scope or `ThreadLocal` (clean it up!).

Unsafe: instance fields that are read-modified across requests without synchronization.

```java
@Service
public class CounterService {
    private int count;              // BUG: shared mutable field in a singleton
    public void inc() { count++; }  // not thread-safe
}
```

Note: Spring's own `@Autowired`-injected collaborators are set once at startup, so injected-dependency fields are effectively final and safe to read concurrently.

---

## Full bean lifecycle

For a **singleton** the container drives this ordered sequence on startup and shutdown:

**Creation / initialization**
1. **Instantiation** — constructor called (constructor injection happens here).
2. **Populate properties** — setter/field dependency injection, `@Autowired`, `@Value`.
3. **Aware interfaces** invoked in order: `BeanNameAware.setBeanName`, `BeanClassLoaderAware`, `BeanFactoryAware.setBeanFactory`, then (in an `ApplicationContext`) `EnvironmentAware`, `EmbeddedValueResolverAware`, `ResourceLoaderAware`, `ApplicationEventPublisherAware`, `MessageSourceAware`, `ApplicationContextAware`.
4. **`BeanPostProcessor.postProcessBeforeInitialization`** — for every registered BPP.
5. **Initialization callbacks**, in this order:
   - `@PostConstruct` annotated method (via `CommonAnnotationBeanPostProcessor`)
   - `InitializingBean.afterPropertiesSet()`
   - custom `init-method` (XML `init-method` / `@Bean(initMethod=...)`)
6. **`BeanPostProcessor.postProcessAfterInitialization`** — for every BPP. **AOP proxies are created here** (e.g. `@Transactional`, `@Async` wrapping).
7. Bean is **ready and in use**.

**Destruction** (on container shutdown / `context.close()`), in order:
8. `@PreDestroy` annotated method
9. `DisposableBean.destroy()`
10. custom `destroy-method` (`@Bean(destroyMethod=...)`)

```java
@Component
public class LifecycleBean implements InitializingBean, DisposableBean {
    public LifecycleBean() { }                  // 1
    @Autowired void setDep(Dep d) { }           // 2
    @PostConstruct void post() { }              // 5a
    public void afterPropertiesSet() { }        // 5b
    @PreDestroy void pre() { }                  // 8
    public void destroy() { }                   // 9
}
```

Reminder: for **prototype** beans only steps 1–6 run; the destruction steps (8–10) never fire automatically.

Boot note: in Spring Boot 3.x these annotations are **Jakarta** (`jakarta.annotation.PostConstruct` / `jakarta.annotation.PreDestroy`), not `javax.annotation.*`. `@PostConstruct`/`@PreDestroy` support requires the `jakarta.annotation-api` (bundled in Boot web starters).

---

## Initialization callback order and mechanisms

Three ways to run init logic, and Spring runs them in a fixed order when more than one is present:

1. `@PostConstruct` (JSR-250 / Jakarta annotation) — **runs first**, most idiomatic.
2. `InitializingBean.afterPropertiesSet()` — interface-based; couples code to Spring.
3. `@Bean(initMethod = "...")` or XML `init-method` — **runs last**; no Spring coupling in the bean class.

Destruction mirrors this: `@PreDestroy` → `DisposableBean.destroy()` → `destroyMethod`.

Trade-offs: prefer `@PostConstruct`/`@PreDestroy` (or `@Bean` init/destroy methods) over the interfaces because the interfaces couple your domain class to the Spring API. `@Bean(destroyMethod)` even has a special convention: for beans exposing a public `close()` or `shutdown()` method, Spring **auto-detects** it as the destroy method by default (`destroyMethod = "(inferred)"`); set `destroyMethod = ""` to disable that.

---

## BeanPostProcessor

`BeanPostProcessor` (BPP) lets you intercept **every bean instance** right around its initialization. Two callbacks:

```java
public interface BeanPostProcessor {
    Object postProcessBeforeInitialization(Object bean, String beanName); // before @PostConstruct
    Object postProcessAfterInitialization(Object bean, String beanName);  // after init methods
}
```

- Runs **per bean instance**, after properties are populated.
- `postProcessAfterInitialization` is where Spring **wraps beans in AOP proxies** (transaction, async, caching, `@Configuration` enhancement is handled elsewhere). It can return a *different* object (the proxy) — the container then uses that.
- `@PostConstruct`/`@PreDestroy` and `@Autowired` are themselves implemented via BPPs (`CommonAnnotationBeanPostProcessor`, `AutowiredAnnotationBeanPostProcessor`).
- BPPs are instantiated **before** the regular beans they process. A BPP (and its dependencies) cannot itself be post-processed by all BPPs and may be created early — beans that a BPP depends on can be forced into early instantiation and skip some post-processing (a known caveat; you'll see warnings like "not eligible for auto-proxying").
- Order multiple BPPs with `Ordered`/`PriorityOrdered` or `@Order`.

---

## BeanFactoryPostProcessor

`BeanFactoryPostProcessor` (BFPP) operates on **bean definitions (metadata)**, not instances, and runs **before any bean is instantiated**.

```java
public interface BeanFactoryPostProcessor {
    void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory);
}
```

- Purpose: read and modify bean **definitions** (change property values, scope, etc.) before instantiation.
- Canonical example: `PropertySourcesPlaceholderConfigurer` resolves `${...}` placeholders in bean definitions.
- Runs **once**, over the whole factory (not per bean).

**BFPP vs BPP** — the classic comparison:

| | BeanFactoryPostProcessor | BeanPostProcessor |
|---|---|---|
| Operates on | Bean *definitions* (metadata) | Bean *instances* |
| Timing | Before any bean is instantiated | Around each bean's initialization |
| Invocation | Once per factory | Twice per bean (before/after init) |
| Typical use | Placeholder resolution, definition tweaks | Proxy creation, annotation processing |

Because a BFPP runs before instantiation, avoid having it trigger bean instantiation (e.g. by calling `getBean`) — doing so instantiates beans too early and bypasses other BFPPs/BPPs.

---

## BeanDefinitionRegistryPostProcessor

`BeanDefinitionRegistryPostProcessor` **extends** `BeanFactoryPostProcessor` and adds an earlier callback that can **register brand-new bean definitions** (not just modify existing ones):

```java
public interface BeanDefinitionRegistryPostProcessor extends BeanFactoryPostProcessor {
    void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry);
}
```

- `postProcessBeanDefinitionRegistry` runs **before** `postProcessBeanFactory`.
- This is how `ConfigurationClassPostProcessor` (which processes `@Configuration`, `@ComponentScan`, `@Bean`) and Spring Boot's auto-config, plus tools like MyBatis' mapper scanning, dynamically add bean definitions.

**Overall ordering of these processors during `refresh()`:**
1. `BeanDefinitionRegistryPostProcessor.postProcessBeanDefinitionRegistry` (register new definitions)
2. `BeanFactoryPostProcessor.postProcessBeanFactory` (modify definitions)
3. Bean instantiation begins
4. `BeanPostProcessor` before/after init callbacks (per bean)

Within each group, `PriorityOrdered` beans run first, then `Ordered`, then the rest.

---

## SmartLifecycle

`Lifecycle`/`SmartLifecycle` govern **start/stop of components** (things that need to run/connect while the context is active), distinct from init/destroy of individual beans.

- `Lifecycle` = `start()`, `stop()`, `isRunning()`. Managed by the context's `LifecycleProcessor`; `start()`/`stop()` are triggered by `context.start()`/`context.stop()` (and stop on `close()`).
- `SmartLifecycle` adds:
  - `getPhase()` — **ordering across components**. On startup, **lower phases start first**; on shutdown, **higher phases stop first** (reverse order). Default phase for SmartLifecycle is `Integer.MAX_VALUE` (starts last, stops first).
  - `isAutoStartup()` — if `true`, the component is started automatically on context refresh (you don't need to call `context.start()`).
  - `stop(Runnable callback)` — asynchronous, graceful shutdown; you must invoke the callback when done. There's a timeout (`timeoutPerShutdownPhase`, default 30s).

```java
@Component
public class MessagingBridge implements SmartLifecycle {
    private volatile boolean running;
    public void start() { running = true; /* open connections */ }
    public void stop()  { running = false; /* close */ }
    public boolean isRunning() { return running; }
    public int getPhase() { return 100; }        // lower starts earlier
}
```

Use `SmartLifecycle` for message listeners, network servers, schedulers — anything requiring ordered, phased startup/shutdown. Note `SmartLifecycle` runs **after** all singletons are fully initialized (its `start()` fires at the end of `refresh()`), which is later than `@PostConstruct`.

---

## Scoped proxies and the injection-mismatch problem

When a **shorter-lived** bean (prototype/request/session) is injected into a **longer-lived** one (singleton), a plain reference would freeze the first resolved instance. A **scoped proxy** solves this: Spring injects a proxy that delegates each call to the correct current-scope instance.

- `proxyMode = ScopedProxyMode.TARGET_CLASS` → **CGLIB** subclass proxy (works for classes; needs a non-final class/methods).
- `proxyMode = ScopedProxyMode.INTERFACES` → **JDK dynamic proxy** (target must implement interfaces).
- Under the hood the proxy holds no state; on each invocation it looks up the active instance from the `Scope` (e.g. current `RequestAttributes`).

This is analogous to how `@Transactional` proxies work, and it shares the same **self-invocation caveat**: calling another method on the same object internally (`this.foo()`) bypasses the proxy, so scope/transaction semantics don't apply to internal calls.

---

## Common follow-up questions

- **Is a Spring "singleton" the same as the GoF singleton pattern?** No — Spring's is one-per-container (per bean name); GoF is one-per-classloader/JVM. Two contexts → two instances.
- **Why isn't `@PreDestroy` called on my prototype bean?** The container doesn't manage prototype destruction; you must clean up yourself (or use a custom BPP / `ConfigurableApplicationContext` hooks).
- **I injected a prototype into a singleton but always get the same instance — why?** Injection resolves once at singleton creation. Use `@Lookup`, `ObjectProvider`, `Provider`, or a scoped proxy to get fresh instances.
- **How do I inject a request-scoped bean into a singleton?** Use a scoped proxy (`@RequestScope` defaults to `proxyMode = TARGET_CLASS`).
- **What's the difference between `application` scope and `singleton`?** `singleton` is per Spring container; `application` is per `ServletContext`. They usually coincide but diverge when multiple contexts share a servlet context.
- **`@PostConstruct` vs `InitializingBean` vs `@Bean(initMethod)` order?** `@PostConstruct` → `afterPropertiesSet()` → `init-method`.
- **Difference between `SmartLifecycle` and `@PostConstruct`?** `@PostConstruct` runs during bean init; `SmartLifecycle.start()` runs after the whole context is initialized and supports phased ordering and graceful stop.
- **When are AOP proxies (e.g. `@Transactional`) created?** In `BeanPostProcessor.postProcessAfterInitialization`, i.e. after init callbacks.
- **What broke when moving to Spring Boot 3?** `javax.annotation.PostConstruct`/`PreDestroy` moved to `jakarta.annotation.*`; update imports.
- **Are singletons thread-safe automatically?** No. Only if stateless/immutable or explicitly synchronized.
- **BFPP vs BDRPP?** BDRPP extends BFPP and can register new definitions (`postProcessBeanDefinitionRegistry` runs first); BFPP only modifies existing definitions.

## References

- Spring Framework Reference — Bean Scopes: https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html
- Spring Framework Reference — Lifecycle Callbacks: https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html
- Spring Framework Reference — Container Extension Points (BeanPostProcessor, BeanFactoryPostProcessor): https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html
- Javadoc — `SmartLifecycle`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/SmartLifecycle.html
- Javadoc — `BeanDefinitionRegistryPostProcessor`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/support/BeanDefinitionRegistryPostProcessor.html
- Baeldung — Spring Bean Scopes: https://www.baeldung.com/spring-bean-scopes
- Baeldung — Spring Bean Lifecycle: https://www.baeldung.com/spring-bean-life-cycle
- Baeldung — BeanPostProcessor / BeanFactoryPostProcessor: https://www.baeldung.com/spring-beanpostprocessor and https://www.baeldung.com/spring-beanfactorypostprocessor
- Baeldung — @Lookup and prototype-in-singleton: https://www.baeldung.com/spring-inject-prototype-bean-into-singleton
