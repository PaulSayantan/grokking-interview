# Bean Scopes & Lifecycle

Spring beans are objects that the Spring **IoC container** (IoC = Inversion of Control — the container, rather than your own code, creates objects and injects their dependencies) instantiates, assembles, configures and manages. Two orthogonal questions define a bean's runtime behavior: **scope** ("how many instances exist and for how long?") and **lifecycle** ("what callbacks fire between creation and destruction?"). Interviewers probe both because misunderstanding them causes the most common production bugs: shared mutable state in singletons, memory-leaking prototypes, and initialization-order surprises.

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

Key nuance: "singleton" here means **one-per-Spring-container**, NOT the classic GoF (Gang of Four — the four authors of the canonical *Design Patterns* book) one-per-classloader/JVM singleton. Two `ApplicationContext`s each get their own instance of a "singleton" bean.

---

## Singleton scope

The default scope. The container creates **one shared instance** per bean definition and returns the same object reference for every injection point and every `getBean` call.

- **Eager by default**: singletons are instantiated when the `ApplicationContext` starts (during `refresh()` → `finishBeanFactoryInitialization` → `preInstantiateSingletons`). This surfaces wiring errors at startup ("fail fast") rather than at first use.
- **Lazy option**: `@Lazy` (or `default-lazy-init`) defers creation until first requested.

> [!INTERVIEW]
> "Then why not just make everything `@Lazy`?" Trade-off: `@Lazy` trims startup time and heap for beans that are rarely (or never) used on a given deploy — genuinely useful for a fat app with many optional code paths. But you **give up fail-fast**: a misconfigured dependency or a bad `@Value` binding that would have blown up at startup now surfaces on the *first request that touches the bean*, i.e. in production traffic instead of at deploy time. Pick eager (the default) for anything on the critical path of a service that must be healthy the moment it reports "up"; reserve `@Lazy` for heavy, optional, or seldom-used beans where the startup saving is worth deferring the wiring check.
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

- **The container does NOT manage the full lifecycle of a prototype — because plain prototype scope does not track instances at all.** Spring instantiates, populates, and runs initialization callbacks (`@PostConstruct`), then hands the bean to the caller and keeps **no reference** to it. Consequently `@PreDestroy` / `DisposableBean.destroy()` are **NOT called** for prototypes, and prototypes holding OS resources (sockets, file handles, native memory) are a classic leak source. Cleanup is the client's responsibility (or a custom `BeanPostProcessor` / explicit `destroyBean`). This is the famous "prototype destruction caveat." The one exception: when a prototype is obtained through a **scope that tracks its instances** and calls `registerDestructionCallback` (custom scopes, and the request/session scopes), destruction does run. `ObjectProvider`/`getBean` for a plain prototype always returns an untracked instance.
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

The core problem: how do you inject a short-lived `request`/`session` bean into a **singleton** (like a controller or service)? You inject a **scoped proxy** — a proxy (either a CGLIB subclass proxy — CGLIB being the bytecode library Spring uses to generate a runtime subclass of your class — or a JDK interface proxy) that, on each method call, resolves the *real* current-request/session instance from the scope. Use `proxyMode`:

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
6. **`BeanPostProcessor.postProcessAfterInitialization`** — for every BPP. **AOP proxies are created here** (AOP = Aspect-Oriented Programming; Spring wraps the bean in a proxy that adds cross-cutting behaviour such as `@Transactional`, `@Async`, or caching around the real method calls).
7. Bean is **ready and in use**.

**Destruction** (on container shutdown / `context.close()`), in order:
8. `@PreDestroy` annotated method
9. `DisposableBean.destroy()`
10. custom `destroy-method` (`@Bean(destroyMethod=...)`)

```java
@Component
public class LifecycleBean implements InitializingBean, DisposableBean {
    public LifecycleBean() { System.out.println("1 constructor"); }
    @Autowired void setDep(Dep d) { System.out.println("2 setDep (populate)"); }
    @PostConstruct void post() { System.out.println("5a @PostConstruct"); }
    public void afterPropertiesSet() { System.out.println("5b afterPropertiesSet"); }
    public void customInit() { System.out.println("5c init-method"); }
    @PreDestroy void pre() { System.out.println("8 @PreDestroy"); }
    public void destroy() { System.out.println("9 destroy"); }
    public void customDestroy() { System.out.println("10 destroy-method"); }
}
// registered via @Bean(initMethod = "customInit", destroyMethod = "customDestroy")
```

**Worked trace — what actually prints.** Start the context, then call `context.close()`. The console shows the callbacks fire in exactly this order (the numbers are the step labels above, not print statements the bean emits on its own):

```
1 constructor
2 setDep (populate)
5a @PostConstruct
5b afterPropertiesSet
5c init-method
   ... bean is ready and in use ...
8 @PreDestroy
9 destroy
10 destroy-method
```

Note what is *absent* between steps 2 and 5a: the `Aware` callbacks (step 3) and `postProcessBeforeInitialization` (step 4) run there but produce no output because `LifecycleBean` implements no `Aware` interface and we registered no custom BPP. The load-bearing takeaway a student must be able to reproduce is the init triple `@PostConstruct → afterPropertiesSet → init-method`, and its mirror image on shutdown `@PreDestroy → destroy → destroy-method`.

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

Intuition: think of the container as a house-building crew. A `BeanPostProcessor` is the **inspector who walks each finished house** — the object already exists and is furnished (properties populated), and the inspector can touch it up or even swap it for a renovated version (a proxy) before the owner moves in. That is why `@Transactional`/`@Async` wrapping happens here: you can only wrap an object that already exists. Contrast this with a `BeanFactoryPostProcessor`, which edits the **blueprint before any house is built** (see below).

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

Intuition (continuing the house analogy): a `BeanFactoryPostProcessor` is the **architect editing the blueprints before construction starts** — no house exists yet, but you can change the spec (property values, scope) on paper so every house is built to the amended plan. This is exactly why placeholder resolution lives here: `${db.url}` in a bean definition must become a real value *before* the bean is instantiated, because the instance's fields get set from the (now-resolved) definition. Two hook layers exist because the two problems are fundamentally different: some things you must decide on the blueprint (a value the constructor needs), and some things you can only do to a finished object (wrap it in a transaction proxy).

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

Intuition: if BFPP is "edit existing blueprints," a `BeanDefinitionRegistryPostProcessor` is "**add brand-new blueprints to the set**." A plain BFPP can tweak a definition that already exists; it cannot conjure new ones. `@ComponentScan`, `@Bean` processing, and MyBatis mapper scanning all need to *create* definitions the developer never typed by hand — that requires this earlier, more powerful hook.

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

**Worked trace — one injected field, two requests, two instances.** A singleton controller injects a `@RequestScope RequestContext` (so the field holds *one* proxy for the app's whole lifetime). Each request stores a value and prints the identity of the resolved instance:

```java
@RequestScope
public class RequestContext {                    // proxyMode = TARGET_CLASS
    final int id = System.identityHashCode(this); // captured when the REAL bean is created
    String user;
}

@RestController
public class MeController {
    @Autowired RequestContext ctx;               // injected ONCE — this field holds the proxy
    @GetMapping("/me") String me(@RequestParam String u) {
        ctx.setUser(u);                           // proxy resolves the current request's real bean
        return ctx.getId() + " / " + ctx.getUser();
    }
}
```

Fire two requests against the same running app:

```
GET /me?u=alice   ->  1a2b3c4d / alice     (proxy resolved request A's real RequestContext)
GET /me?u=bob     ->  9f8e7d6c / bob       (proxy resolved request B's real RequestContext)
```

The proxy field (`ctx`) is the same object across both calls — but the two lines print **different `id` values** (each captured when a distinct real bean was constructed) and **no bleed-through of `alice`'s value into bob's request**. That proves the proxy is not a cached reference to one instance; on every method call it looks up the real `RequestContext` bound to the *current* request's `RequestAttributes`, and each request got its own freshly created (and freshly `@PostConstruct`-ed) instance. Swap `@RequestScope` for a plain field and both requests would share one instance — bob would sometimes see `alice`. `ObjectProvider<RequestContext>.getObject()` gives the same per-request resolution without a compile-time proxy, returning a distinct object per active request.

---

## Circular dependencies and the three-level cache

Circular references between singletons are resolved (for setter/field injection) by a three-level cache inside `DefaultSingletonBeanRegistry`:

| Level | Map | Holds |
|---|---|---|
| 1 | `singletonObjects` | fully initialized, ready singletons |
| 2 | `earlySingletonObjects` | early references — instantiated but not yet fully populated/initialized |
| 3 | `singletonFactories` | `ObjectFactory` producing an early reference (needed so AOP returns the *proxy*, not the raw bean) |

Resolution of `A → B → A` with field/setter injection: A is instantiated and its `ObjectFactory` is placed in level 3; while populating A, B is created; B needs A, finds A's factory in level 3, promotes the early A reference to level 2, and injects it into B; B finishes (level 1) and is injected into A; A finishes.

```mermaid
sequenceDiagram
    participant C as Container
    participant A as Bean A
    participant Cache as 3-level cache
    participant B as Bean B
    C->>A: new A() (instantiate)
    A->>Cache: put A's ObjectFactory in L3
    C->>A: populate A — needs B
    C->>B: new B() (instantiate)
    C->>B: populate B — needs A
    B->>Cache: look up A (miss L1, miss L2, hit L3)
    Cache->>B: factory yields early A ref (proxy if AOP); move A to L2
    B->>B: finish init → promote B to L1
    C->>A: inject finished B, finish init → promote A to L1
```


**Worked trace — which map holds what, step by step.** Columns are the three caches (L1 `singletonObjects`, L2 `earlySingletonObjects`, L3 `singletonFactories`); read top to bottom:

| Step | Action | L3 (factories) | L2 (early refs) | L1 (ready) |
|---|---|---|---|---|
| 1 | `new A()` — instantiated, not populated | `A→factory` | — | — |
| 2 | Start populating A; A needs B → create B | `A→factory` | — | — |
| 3 | `new B()`; populating B, B needs A | `A→factory`, `B→factory` | — | — |
| 4 | B asks for A: miss L1, miss L2, **hit L3** → call factory (returns A's proxy if AOP), move A to L2, drop A's factory | `B→factory` | `earlyA` | — |
| 5 | Inject `earlyA` into B; B finishes init → promote B to L1, drop B's factory | — | `earlyA` | `B` |
| 6 | Return finished B into A; A finishes init → promote A to L1, drop `earlyA` from L2 | — | — | `A`, `B` |

The key moment is **step 4**: B does not wait for A to be finished — it accepts A's *early* reference. That early reference must be identical to whatever ends up in L1 at step 6, which is exactly why L3 stores a *factory* (not the raw object): if A is AOP-proxied, the factory produces the proxy once, so B and the final L1 entry point at the same proxy. A constructor cycle can't use any of this — A can't even reach step 1's "instantiated but not populated" state without B, so there is no early reference to expose, and Spring throws `BeanCurrentlyInCreationException`.

Key senior-level points:

- **Constructor-injection cycles cannot be resolved** — there is no post-instantiation moment at which to expose an early reference, so Spring throws `BeanCurrentlyInCreationException` at startup. This is a fail-fast, not a runtime, error.
- **Spring Boot 2.6+ forbids circular references by default** (`spring.main.allow-circular-references=false`). Even setter/field cycles now fail at startup unless you flip the flag or annotate one side `@Lazy`. `@Lazy` on one injection point injects a lazy proxy, breaking the cycle because the real bean isn't needed until first use.
- **The third-level factory exists purely for AOP**: if A is proxied, B must be injected with A's *proxy*, and the proxy must be identical to the one placed in level 1. The `getEarlyBeanReference` callback (via `SmartInstantiationAwareBeanPostProcessor`) creates the proxy early so both references match.
- **`@Async` cycles still break** even with the flag on: `@Async` proxies are not created through `getEarlyBeanReference`, so an early reference exposed for a cycle will be the *raw* bean while the final reference is the async proxy — Spring detects the mismatch and throws `BeanCurrentlyInCreationException`.

## FactoryBean vs factory beans vs lifecycle

`FactoryBean<T>` is a special bean whose `getObject()` produces the *actual* bean; `getBean("x")` returns the product, while `getBean("&x")` returns the `FactoryBean` itself (the `&` prefix). Lifecycle nuance:

- The `FactoryBean` instance's own lifecycle callbacks (`@PostConstruct`, `afterPropertiesSet`) run when the factory is created.
- The **produced object's** lifecycle is only partly managed: if `isSingleton()` is true, the product is cached; `@PostConstruct`/`@Autowired` are **not** processed on objects returned from `getObject()` unless you wire them yourself — the container did not instantiate them. Destruction callbacks on the product only run if the `FactoryBean` implements the destruction contract or the product is a `DisposableBean` that the container tracks.
- Do not confuse `FactoryBean` (an interface) with "factory bean" (a `@Bean` method / static/instance factory method). The former is a lower-level SPI used by things like `SqlSessionFactoryBean`.

## Startup ordering, @DependsOn, and @Lazy

Beyond the per-bean lifecycle, the *order in which distinct beans* are created matters:

- **`@DependsOn("other")`** forces `other` to be fully initialized before this bean, and destroyed *after* it — useful when there is no injected reference but an initialization-order requirement (e.g. a bean that registers a JDBC driver must come up first).
- **`@Lazy` at class level** delays creation of that singleton until first access; `@Lazy` at an *injection point* injects a lazy-resolving proxy, which is a legitimate way to break init-order coupling or a circular reference.
- **`@Order` does NOT affect instantiation order** of ordinary singletons — it only orders injected collections (`List<T>`), `@Configuration` import processing in some cases, and web components; a common misconception is that `@Order` controls bean creation sequence.
- Spring instantiates singletons roughly in registration order, but dependency edges override that: a dependency is always created before its dependent.

## Configuration class proxying (@Configuration full vs lite)

`@Configuration(proxyBeanMethods = true)` (the default) makes Spring create a **CGLIB subclass** of the config class so that inter-`@Bean` method calls (`this.foo()` inside `bar()`) return the shared singleton rather than a new instance. This is "full" mode. Setting `proxyBeanMethods = false` ("lite" mode) skips the CGLIB proxy: `@Bean` methods run as plain Java, so calling one `@Bean` method from another creates a **new, unmanaged instance**. Lite mode is faster and startup-friendly (Spring Boot's own auto-configuration uses it heavily) but you must not rely on cross-method singleton semantics. This is a frequent trap: moving to `proxyBeanMethods = false` silently changes bean identity for beans wired via method calls.

## DestructionAwareBeanPostProcessor and shutdown mechanics

Destruction callbacks (`@PreDestroy`, `DisposableBean`, `destroy-method`) are driven at container shutdown only for beans the container tracks (singletons, and scoped beans via `registerDestructionCallback`). Mechanics worth knowing:

- `@PreDestroy`/`@Resource`-style destruction is implemented by `CommonAnnotationBeanPostProcessor`, which is a `DestructionAwareBeanPostProcessor`.
- Shutdown runs in **reverse creation order** and honors `@DependsOn` (dependents destroyed first).
- A JVM **shutdown hook** (`registerShutdownHook()`, auto-registered by Spring Boot) triggers `close()`; if the process is `kill -9`ed, no destruction callbacks run at all — never rely on `@PreDestroy` for critical durability.
- Exceptions thrown from a destroy callback are logged and swallowed; they do not stop the rest of shutdown.

## SmartLifecycle internals and phases

Precise semantics that separate seniors from juniors:

- `SmartLifecycle.DEFAULT_PHASE == Integer.MAX_VALUE`, so an auto-start `SmartLifecycle` with no overridden phase starts **last** and stops **first**. Plain `Lifecycle` beans behave as phase `0`.
- Startup goes low→high phase; shutdown reverses (high→low). Beans in the same phase start together (and the processor may stop same-phase beans concurrently).
- `stop(Runnable callback)` is the *only* stop method the `LifecycleProcessor` calls on a `SmartLifecycle`; plain `stop()` is not invoked unless your `stop(Runnable)` delegates to it. You **must** call `callback.run()` when done, or shutdown blocks until `timeoutPerShutdownPhase` (default 30s) elapses.
- `SmartLifecycle.start()` fires at the very end of `refresh()` (via `finishRefresh()`), strictly after every singleton's `@PostConstruct`/`afterPropertiesSet`. This is why network servers, Kafka listeners, and schedulers belong in `SmartLifecycle`, not `@PostConstruct` — at `@PostConstruct` time, other beans they depend on may not yet be initialized.
- Spring's own `WebServerStartStopLifecycle` (embedded Tomcat/Jetty) and message-listener containers are `SmartLifecycle` beans, which is how Boot delays accepting traffic until the context is fully ready.

## Scope proxy and lifecycle edge cases

- A scoped-proxy target bean's `@PostConstruct` runs when the **real** short-lived instance is first created (per request/session), not when the singleton holding the proxy is created. Its `@PreDestroy` runs when that scope ends (request completes / session invalidates) — this *is* tracked via `registerDestructionCallback`, unlike plain prototype.
- Injecting a **shorter into shorter** or same scope needs no proxy; the mismatch problem only arises when a longer-lived bean holds a shorter-lived one.
- A `session`-scoped bean must be `Serializable` if the servlet container serializes/replicates sessions (clustering, passivation), or you risk `NotSerializableException` on failover.
- `ScopeNotActiveException` (introduced to give a clearer message) is thrown when a scoped-proxy method is invoked with no active request/session — e.g. from a `@Scheduled` background thread or an `@Async` thread that lacks the request context. `RequestContextFilter`/`RequestContextListener` are what bind the request to the thread; async threads need explicit context propagation.

## Common follow-up questions

- Is a Spring "singleton" the same as the GoF singleton pattern? No — Spring's is one-per-container (per bean name); GoF is one-per-classloader/JVM. Two contexts → two instances.
- Why isn't `@PreDestroy` called on my prototype bean? The container doesn't manage prototype destruction; you must clean up yourself (or use a custom BPP / `ConfigurableApplicationContext` hooks).
- I injected a prototype into a singleton but always get the same instance — why? Injection resolves once at singleton creation. Use `@Lookup`, `ObjectProvider`, `Provider`, or a scoped proxy to get fresh instances.
- How do I inject a request-scoped bean into a singleton? Use a scoped proxy (`@RequestScope` defaults to `proxyMode = TARGET_CLASS`).
- What's the difference between `application` scope and `singleton`? `singleton` is per Spring container; `application` is per `ServletContext`. They usually coincide but diverge when multiple contexts share a servlet context.
- `@PostConstruct` vs `InitializingBean` vs `@Bean(initMethod)` order? `@PostConstruct` → `afterPropertiesSet()` → `init-method`.
- Difference between `SmartLifecycle` and `@PostConstruct`? `@PostConstruct` runs during bean init; `SmartLifecycle.start()` runs after the whole context is initialized and supports phased ordering and graceful stop.
- When are AOP proxies (e.g. `@Transactional`) created? In `BeanPostProcessor.postProcessAfterInitialization`, i.e. after init callbacks.
- What broke when moving to Spring Boot 3? `javax.annotation.PostConstruct`/`PreDestroy` moved to `jakarta.annotation.*`; update imports.
- Are singletons thread-safe automatically? No. Only if stateless/immutable or explicitly synchronized.
- BFPP vs BDRPP? BDRPP extends BFPP and can register new definitions (`postProcessBeanDefinitionRegistry` runs first); BFPP only modifies existing definitions.

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
