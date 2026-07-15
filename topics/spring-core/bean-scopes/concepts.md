# Bean Scopes

A **bean scope** controls the *lifecycle and visibility* of the object(s) that the Spring
IoC container creates from a single bean definition: how many instances exist, when they
are created, how long they live, and which callers share them. A bean *definition* is a
recipe; the scope decides how many objects that recipe produces and who sees each one.

Spring Framework supports **six scopes**. Two are always available (`singleton`,
`prototype`); the other four (`request`, `session`, `application`, `websocket`) require a
**web-aware `ApplicationContext`**. You can also define **custom scopes**.

The scope is a property of the bean *definition*, declared with `@Scope("...")` (annotation
config), `scope="..."` (XML), or the composed shortcuts `@RequestScope`, `@SessionScope`,
`@ApplicationScope`. The default, when nothing is specified, is `singleton`.

| Scope | Availability | Instances per definition | Bound to / lifetime |
|-------|--------------|--------------------------|---------------------|
| `singleton` | always (default) | exactly one **per container** | the IoC container |
| `prototype` | always | a new one **per request for the bean** | caller (container forgets it) |
| `request` | web only | one per HTTP request | `HttpServletRequest` |
| `session` | web only | one per HTTP session | `HttpSession` |
| `application` | web only | one per `ServletContext` | `ServletContext` |
| `websocket` | web only (STOMP) | one per WebSocket session | WebSocket session |

```java
@Component
@Scope("prototype")           // string constants also in ConfigurableBeanFactory.SCOPE_*
public class Task { }

// XML equivalent:
// <bean id="task" class="com.example.Task" scope="prototype"/>
```

---

## Singleton scope

`singleton` is the **default** scope. The container creates **exactly one shared instance
per bean definition per IoC container**, caches it, and returns that same instance for every
injection point and every `getBean()` call that resolves to that definition.

> "Scopes a single bean definition to a single object instance for each Spring IoC container."

### "One per container", NOT one per JVM

This is the single most-tested nuance. The Spring "singleton" is **not** the classic
Gang-of-Four singleton (one instance per classloader/JVM). It means **one instance per
Spring container (per `ApplicationContext`) per bean definition**:

- If you start **two `ApplicationContext`s** in the same JVM, each has its **own** instance
  of the same bean definition — two objects, not one.
- If you declare the **same class under two different bean names/ids**, you get **two**
  singletons, because scope is keyed on the *definition*, not the *type*.

```java
ApplicationContext a = new AnnotationConfigApplicationContext(AppConfig.class);
ApplicationContext b = new AnnotationConfigApplicationContext(AppConfig.class);
a.getBean(MyService.class) != b.getBean(MyService.class);  // different instances
```

### Eager instantiation and lazy option

By default, singletons are created **eagerly** at container startup (during
`refresh()` / `preInstantiateSingletons()`), so wiring errors surface immediately rather
than on first use. Mark a bean `@Lazy` (or `lazy-init="true"`) to defer creation until first
requested. Note that a lazy singleton injected into a non-lazy singleton is still created at
startup (to satisfy the eager dependency) unless the injection point is also lazy.

### Lifecycle

The container manages the **full** lifecycle of a singleton: instantiation → dependency
injection → `BeanPostProcessor`s → `@PostConstruct` / `InitializingBean` / init-method →
(in use) → on context close, `@PreDestroy` / `DisposableBean` / destroy-method. Singletons
are destroyed when the container shuts down.

### Advanced internals

- Singletons live in the `DefaultSingletonBeanRegistry`'s `singletonObjects` map.
- **Circular references** between constructor-injected singletons cannot be resolved and
  throw `BeanCurrentlyInCreationException`. Setter/field circular references between
  singletons *can* be resolved via the **three-level cache** (`singletonObjects`,
  `earlySingletonObjects`, `singletonFactories`) which exposes an early object reference
  before initialization completes. (Prototypes can never participate in this resolution —
  Spring cannot cache a half-built prototype, so a prototype circular reference always
  fails.)
- The break-glass fix for a constructor cycle is to annotate **one** injection point with
  `@Lazy` — Spring then injects a lazy-resolving proxy there, so the constructor completes
  without eagerly forcing the other bean into creation, breaking the cycle. (Spring Framework
  6.1+ also *prohibits* the field/setter three-level-cache path by default when the involved
  beans are subject to certain post-processing/proxying, and may fail fast instead — the
  robust design is to avoid cycles rather than rely on early references.)
- **Singleton creation is guarded**: `getSingleton(...)` synchronizes on the
  `singletonObjects` map so that concurrent first-time `getBean()` calls for the same
  definition create the object once and publish it safely. This is *creation-time* locking
  only — it says nothing about concurrent business-method calls (see thread-safety section).
- **Destruction ordering**: on context close, singletons are destroyed in **reverse
  registration order**, and dependencies expressed via injection or `@DependsOn` are honored
  so a bean is destroyed *before* the beans it depends on. Creation order is the mirror image:
  `@DependsOn("x")` forces `x` to be fully instantiated first.
- A **`@Lazy` bean injected into a non-lazy singleton** is still instantiated at startup to
  satisfy that eager dependency — unless the **injection point itself** is `@Lazy` (which
  injects a proxy and defers the target's creation to first method call).

---

## Prototype scope

`prototype` produces a **brand-new instance every time the bean is requested** — every
injection, every `getBean()`, every `ObjectProvider.getObject()`. Spring treats the
container as a **replacement for the Java `new` operator** for these beans.

> "Scopes a single bean definition to any number of object instances."

### The container does NOT manage the full lifecycle

This is the second most-tested nuance:

> "In contrast to the other scopes, Spring does not manage the complete lifecycle of a
> prototype bean. The container instantiates, configures, and otherwise assembles a
> prototype object and hands it to the client, with no further record of that prototype
> instance."

Concretely:

- **Initialization** callbacks (`@PostConstruct`, `afterPropertiesSet()`, init-method) **ARE**
  invoked on every prototype instance.
- **Destruction** callbacks (`@PreDestroy`, `DisposableBean.destroy()`, destroy-method) are
  **NOT** invoked by the container for prototypes. The container hands the object to the
  client and forgets it. **The client is responsible** for releasing expensive resources the
  prototype holds (e.g. via a custom `BeanPostProcessor` that keeps references, or explicit
  cleanup).

### When to use prototype

Use `prototype` for **stateful** objects that must not be shared — e.g. a per-operation
command object, a builder, an accumulator, a per-user conversational object. Use `singleton`
(the default) for **stateless** services, DAOs, controllers, configuration holders — the vast
majority of beans. Prototypes are comparatively rare in typical applications.

### Prototype internals and gotchas

- **`destroy()` on a scoped-proxy prototype does not reach past instances.** Because Spring
  keeps no reference to prototype instances, a `@PreDestroy`/`DisposableBean` on a prototype
  is never called by the container even when the prototype is behind a scoped proxy. If you
  need deterministic cleanup, use `ObjectProvider` and a try-with-resources/finally block, or
  register instances with a manager bean yourself.
- **`@Scope("prototype")` on a `@Bean` factory method** produces a new instance per lookup,
  but only if the method is *called through the container*. Inside a `@Configuration` class,
  calling one `@Bean` method from another is intercepted by the CGLIB-enhanced config proxy
  and routed through `getBean`, so prototype semantics are preserved; calling a prototype
  `@Bean` method on a `@Configuration(proxyBeanMethods = false)` "lite" config, or via a
  plain `@Component`, is a *direct* Java call that bypasses the container and returns a plain
  `new` object every time — losing container post-processing.
- **Prototype beans are not eagerly instantiated** at `refresh()`. They are created only on
  demand, so a broken prototype definition (bad wiring) is discovered lazily at first request,
  not at startup — the opposite of the fail-fast singleton behavior.
- A prototype **injected by `ObjectProvider.stream()`** into a collection is materialized once
  per stream call; each terminal operation that pulls elements creates fresh instances.

---

## Web scopes request, session, application, websocket

These four scopes require a **web-aware container** (e.g. `WebApplicationContext`) and are
only usable when there is a bound web request/session on the thread.

| Scope | One instance per | Underlying attribute store | Shortcut |
|-------|------------------|----------------------------|----------|
| `request` | HTTP request | request attributes | `@RequestScope` |
| `session` | HTTP session | session attributes | `@SessionScope` |
| `application` | `ServletContext` | servlet context attributes | `@ApplicationScope` |
| `websocket` | WebSocket session | WebSocket session attributes | (no shortcut) |

- **request** — a new instance per HTTP request; discarded when the request completes.
- **session** — one instance shared across all requests within one user's `HttpSession`;
  discarded when the session is invalidated/expires.
- **application** — one instance per `ServletContext`. It resembles a singleton but differs
  in two ways: it is a **singleton per `ServletContext`, not per `ApplicationContext`**
  (there can be several contexts in one app), and it is **exposed as a `ServletContext`
  attribute**, visible to plain servlet code.
- **websocket** — bound to a WebSocket session; applies to **STOMP-over-WebSocket**
  applications. Typically declared with a scoped proxy because it's injected into
  longer-lived beans.

```java
@Component
@RequestScope                 // == @Scope(value = "request", proxyMode = TARGET_CLASS)
public class RequestContextHolderBean { }

@Component
@SessionScope
public class ShoppingCart { }
```

### Web setup and thread binding

- Inside **Spring MVC**, no special setup is needed: `DispatcherServlet` already exposes and
  binds all relevant request/session state to the thread servicing the request.
- Outside `DispatcherServlet` (e.g. JSF, a servlet from another framework), you must register
  `RequestContextListener` (a `ServletRequestListener`) or `RequestContextFilter`.
  "`DispatcherServlet`, `RequestContextListener`, and `RequestContextFilter` all do exactly
  the same thing, namely bind the HTTP request object to the `Thread` that is servicing that
  request", making request/session scopes usable via `RequestContextHolder`.

### jakarta vs javax (Spring Framework 6.x / 7.x)

Spring Framework **6.0+ baselines on Jakarta EE 9+**, so the servlet types behind these
scopes are `jakarta.servlet.*` (`jakarta.servlet.http.HttpServletRequest`,
`HttpSession`, `ServletContext`). Spring 5.x used the legacy `javax.servlet.*` namespace.
Spring 6/7 no longer support `javax.servlet.*`. Beyond the scopes, a `WebApplicationContext`
can also inject `HttpServletRequest`, `HttpServletResponse`, `HttpSession`, and `WebRequest`
directly by type — Spring injects **proxies** for these so a singleton can safely hold a
reference to the current request/session.

### Web-scope failure modes and edge cases

- **`ScopeNotActiveException` / `BeanCreationException` with "No thread-bound request found".**
  Accessing a `request`/`session`-scoped bean (through its scoped proxy) on a thread that has
  no bound request throws at *method-call* time — a classic trap when work is offloaded to an
  `@Async` executor thread or a `@Scheduled` task, because the request context is bound to the
  original servlet thread only and is **not inherited** by pooled threads. Fixes: capture the
  needed data before crossing threads, use `RequestContextHolder` with
  `setInheritable(true)`/a task decorator that propagates context, or redesign to pass values
  explicitly.
- **Session-scope concurrency.** A single `HttpSession` can service multiple simultaneous
  requests (e.g. parallel AJAX calls, tabs). A `session`-scoped bean is therefore *shared
  across concurrent threads*, so it is **not** automatically thread-safe despite being
  "one per user". Mutable session-scoped state needs its own synchronization.
- **Session replication/serialization.** In a clustered container that replicates or persists
  sessions, `session`-scoped beans (stored as session attributes) may be **serialized**; they
  should be `Serializable` and hold serializable state, or replication fails.
- **`request` vs `session` proxy resolution.** The scoped proxy resolves the *current*
  request/session on each call via `RequestContextHolder`, so the *same* injected proxy in a
  singleton transparently maps to a different backing instance for each user/request — that is
  precisely why the proxy is mandatory when the lifetime mismatch exists.
- **`application` scope vs true singleton on redeploy.** Because `application`-scoped beans
  live as `ServletContext` attributes, they can outlive an individual `WebApplicationContext`
  refresh differently than container singletons and are visible to non-Spring servlet code —
  a subtle sharing/lifecycle distinction.
- **`websocket` scope** requires `proxyMode = TARGET_CLASS` (there is no `@WebSocketScope`
  shortcut) and is only meaningful under the STOMP messaging infrastructure; the bean is bound
  to the WebSocket session's attributes.

---

## Singleton thread safety responsibility

Because a singleton instance is **shared across all threads** that use the container, Spring
provides **no synchronization** for it. **Thread safety is entirely the developer's
responsibility.** The container guarantees the instance is fully initialized and safely
published before use, but says nothing about concurrent method calls.

Guidelines:

- Keep singletons **stateless** — no mutable instance fields that hold per-request/per-user
  data. Stateless beans are inherently thread-safe. This is why services, DAOs, and
  controllers are singletons by default.
- If per-call state is needed, keep it in **local variables / method parameters** (each thread
  has its own stack), not in fields.
- Immutable fields (set once at construction, e.g. injected collaborators) are safe to share.
- If a singleton *must* hold mutable shared state, you must guard it yourself
  (`synchronized`, `java.util.concurrent` structures, `Atomic*`, locks) or use `ThreadLocal`.
- A common design fix for "I need mutable per-user state" is not synchronization but a
  **narrower scope** (`prototype`, `request`, or `session`) for the stateful part, injected
  into the stateless singleton via a scoped proxy or provider.

Injected collaborators being singletons too means the object graph is generally shared; the
same stateless-by-default rule applies transitively.

---

## Injecting a prototype into a singleton

### The problem

Dependency injection happens **once**, when the container instantiates and wires the bean.
So if you inject a `prototype` bean into a `singleton` by plain injection:

> "the prototype instance is the sole instance that is ever supplied to the singleton-scoped
> bean."

The singleton captures **one** prototype instance at wiring time and reuses it forever — you
do **not** get a fresh prototype per method call. The prototype's per-request-of-the-bean
semantics are effectively defeated. (The same "wired once, stale" issue applies to injecting
a shorter-lived web-scoped bean into a longer-lived one.)

```java
@Component                       // singleton
class OrderService {
    @Autowired Task task;        // WRONG if you wanted a fresh Task each call:
                                 // this Task is captured once and never changes
}
```

### Solution 1 — `ObjectProvider` / `ObjectFactory` (recommended)

Inject a provider and call it **on demand**; each call returns the current/fresh instance
without the singleton holding onto it.

```java
@Component
class OrderService {
    private final ObjectProvider<Task> taskProvider;

    OrderService(ObjectProvider<Task> taskProvider) {
        this.taskProvider = taskProvider;
    }

    void handle() {
        Task task = taskProvider.getObject();   // NEW prototype each call
        // ...
    }
}
```

- `ObjectFactory<T>.getObject()` — minimal: fetch the current instance on demand.
- `ObjectProvider<T>` — richer API: `getObject()`, `getIfAvailable()`, `getIfUnique()`,
  plus stream/iterator access. Introduced in Spring 4.3; the preferred modern approach
  because it is explicit, needs no proxy, and no subclassing.
- JSR-330 equivalent: `jakarta.inject.Provider<T>.get()` (was `javax.inject.Provider` pre-6).

### Solution 2 — Scoped proxy (`@Scope(proxyMode = ...)` / `<aop:scoped-proxy/>`)

Put a **proxy** at the injection point that looks like the target but resolves the real
instance from the scope on **each method call**.

```java
@Component
@Scope(value = "prototype", proxyMode = ScopedProxyMode.TARGET_CLASS)
class Task { }

// XML: <bean id="task" class="..." scope="prototype"><aop:scoped-proxy/></bean>
```

> "When declaring `<aop:scoped-proxy/>` against a bean of scope `prototype`, every method
> call on the shared proxy leads to the creation of a new target instance to which the call
> is then being forwarded."

Proxy type:

- **`TARGET_CLASS`** (default for the shortcuts) → **CGLIB** class-based proxy; works without
  interfaces but **cannot intercept `private`/`final` methods**.
- **`INTERFACES`** → JDK dynamic proxy; the bean's class must implement at least one
  interface, and only interface methods are proxied.

Scoped proxies are the *usual* solution for **web scopes** (injecting a `request`/`session`
bean into a singleton), because the shorter-lived bean often doesn't even exist at singleton
wiring time.

### Solution 3 — `@Lookup` / Method Injection

Let the container **override an abstract or concrete method** to return a fresh prototype on
each invocation. This is "method injection".

```java
@Component
abstract class OrderService {
    void handle() {
        Task task = createTask();     // container returns a NEW prototype each call
    }

    @Lookup                            // Spring overrides this via CGLIB
    protected abstract Task createTask();
}
```

The CGLIB-generated subclass implements `createTask()` to call `getBean(Task.class)`. Because
it relies on subclassing, the method (and class) must not be `private`/`final`, and the bean
cannot be `final`. `@Lookup` predates `ObjectProvider`; for new code `ObjectProvider` is
usually cleaner.

### Comparison

| Approach | Fresh instance per use? | Needs proxy/subclass | Notes |
|----------|------------------------|----------------------|-------|
| Plain `@Autowired` | No (wired once) | no | the bug to avoid |
| `ObjectProvider`/`ObjectFactory` | Yes (on `getObject()`) | no | explicit, modern, preferred |
| Scoped proxy | Yes (per method call) | CGLIB/JDK proxy | best for web scopes |
| `@Lookup` / method injection | Yes (per call) | CGLIB subclass | older; class can't be final |

### Scoped-proxy subtleties

- **The scoped proxy is itself a singleton.** When you inject a `@RequestScope` bean into a
  singleton, the injected reference is a single, long-lived CGLIB/JDK proxy object; only the
  *target* it delegates to changes per request/session. So the field is stable; the behavior
  routes dynamically.
- **`getBean()` on a scoped-proxied bean returns the proxy, not the target.** `instanceof`
  checks against concrete subtypes, reflection on declared fields, and `getClass()` see the
  proxy (a generated subclass for CGLIB). State set directly on the proxy object's own fields
  is *not* the target's state — always go through methods.
- **CGLIB proxy construction and `final`.** A `TARGET_CLASS` scoped proxy is a generated
  subclass, so the target class cannot be `final`, and `final`/`private`/`static` methods are
  not intercepted (calls to them hit the empty proxy shell, not a resolved target — a source
  of `NullPointerException` on uninitialized proxy fields). Since Spring 4.0+/objenesis the
  target's constructor is bypassed for the proxy, so a no-arg constructor is not strictly
  required, but the *concrete class* must still be non-final.
- **Ordering with AOP.** A scoped proxy and other AOP proxies (transactions, security) stack;
  the scoped proxy sits at the injection point and resolves the target, then the target's own
  advice applies. Mixing `proxyMode = INTERFACES` with class-based AOP elsewhere can surface
  `ClassCastException`/proxy-type mismatches if code casts the injected proxy to the concrete
  class.
- **`ObjectProvider` vs scoped proxy for web scopes.** `ObjectProvider.getObject()` throws
  `ScopeNotActiveException` when no request is bound, giving you an explicit failure/`getIfAvailable()`
  fallback; a scoped proxy defers the same failure to the intercepted method call. Choose the
  provider when you want to *detect* absence of scope; choose the proxy for transparent
  drop-in injection.

---

## Custom scopes

You can **define your own scope** or (rarely, and considered bad practice) redefine an
existing one — but you **cannot override the built-in `singleton` and `prototype`** scopes.

### The `Scope` interface

Implement `org.springframework.beans.factory.config.Scope`:

```java
public interface Scope {
    Object get(String name, ObjectFactory<?> objectFactory);   // return existing or create via factory
    Object remove(String name);                                // remove; null if not managed
    void registerDestructionCallback(String name, Runnable callback);
    Object resolveContextualObject(String key);                // e.g. "request" -> current request
    String getConversationId();                                // scope's conversation id (e.g. session id)
}
```

`get(...)` returns the cached object for the current scope context or, if absent, creates it
via the supplied `ObjectFactory` and caches it. The scope decides what "current context"
means (a thread, a tenant, a conversation, etc.).

### Registering a custom scope

Register the `Scope` implementation with the container **before** beans using it are created:

```java
// Programmatic:
beanFactory.registerScope("thread", new SimpleThreadScope());  // ConfigurableBeanFactory
```

```xml
<!-- Declarative, via a BeanFactoryPostProcessor -->
<bean class="org.springframework.beans.factory.config.CustomScopeConfigurer">
    <property name="scopes">
        <map>
            <entry key="thread">
                <bean class="org.springframework.context.support.SimpleThreadScope"/>
            </entry>
        </map>
    </property>
</bean>
```

Then reference it: `@Scope("thread")` / `scope="thread"`. Scoped-proxy rules still apply when
injecting a custom-scoped bean into a wider-scoped one.

### `SimpleThreadScope`

Spring ships `org.springframework.context.support.SimpleThreadScope`, a `ThreadLocal`-backed
scope, but it is **NOT registered by default** — you must register it as above. Caveat: it
does **not** clean up its `ThreadLocal` state or run destruction callbacks when a thread is
returned to a pool, so it can leak in thread-pooled environments; it is primarily for demos
and simple cases. (Spring Web's request/session scopes are the production-grade thread-bound
scopes.)

Note on `FactoryBean`: placing `<aop:scoped-proxy/>` on a `FactoryBean` definition scopes the
**factory bean itself**, not the object returned from `getObject()`.

### Custom-scope internals and correctness

- **`get(name, objectFactory)` is the caching contract.** Spring calls it whenever it needs an
  instance for a custom-scoped definition. Your implementation must: look up the current
  "conversation" context (thread, tenant, actor…), return the cached object if present, else
  invoke `objectFactory.getObject()` (which triggers the *full* creation + init lifecycle) and
  cache it. Getting this wrong (e.g. returning a new object every call) silently breaks the
  scope's identity semantics.
- **Destruction callbacks are your job.** The container hands you a `Runnable` via
  `registerDestructionCallback`; *you* must invoke it when the conversation ends. If you never
  call it, `@PreDestroy`/`DisposableBean` never runs for that scope — exactly the leak in
  `SimpleThreadScope`, which registers callbacks but never fires them on thread return to a
  pool. A production request scope (`RequestScope`) fires them when the request completes.
- **Registration must precede use.** `registerScope`/`CustomScopeConfigurer` runs as a
  `BeanFactoryPostProcessor` step, before singleton pre-instantiation, so the scope name is
  known when scoped bean definitions are resolved. Referencing an unregistered scope name
  yields `IllegalStateException: No Scope registered for scope name '...'` when the bean is
  first needed.
- **Scoped proxies still apply.** Injecting a custom-scoped bean into a wider-scoped bean
  needs the same `proxyMode`/`<aop:scoped-proxy/>` treatment as web scopes, because the
  narrower bean may not exist (or may differ) at the wider bean's wiring time.
- **`resolveContextualObject` and `getConversationId`** let advice and diagnostics ask the
  scope for its current key/context object (e.g. `"request"` → the current request); returning
  `null`/unstable ids degrades tooling but not core resolution.

---

## Common follow-up questions

- **Is a Spring singleton the same as the GoF singleton pattern?** No. GoF = one per
  classloader/JVM; Spring = one per bean definition per container. Two contexts → two
  instances.
- **Are initialization and destruction callbacks called for prototypes?** Init callbacks:
  yes. Destruction callbacks: **no** — the client must clean up.
- **What's the default scope?** `singleton`.
- **How do you get a fresh prototype each time inside a singleton?** `ObjectProvider`/
  `ObjectFactory`, a scoped proxy (`proxyMode`), or `@Lookup` method injection — not plain
  `@Autowired`.
- **Why does injecting a prototype into a singleton "not work"?** Injection runs once at
  wiring time, so the singleton keeps a single prototype forever.
- **Are singletons thread-safe?** Spring doesn't make them thread-safe; keep them stateless
  or synchronize yourself.
- **When are singletons created?** Eagerly at startup by default; use `@Lazy` to defer.
- **What's the difference between `application` scope and `singleton`?** `application` is one
  per `ServletContext` and exposed as a servlet context attribute; `singleton` is one per
  `ApplicationContext`.
- **Which scopes need a web-aware context?** `request`, `session`, `application`, `websocket`.
- **CGLIB vs JDK proxy for scoped proxies?** `TARGET_CLASS` → CGLIB (no interface needed, no
  private/final method interception); `INTERFACES` → JDK proxy (needs an interface).
- **javax vs jakarta?** Spring 6/7 use `jakarta.servlet.*`; Spring 5 used `javax.servlet.*`.

## References

- Spring Framework Reference — Core / Bean Scopes:
  https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html
- Bean Scopes — Singleton:
  https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html#beans-factory-scopes-singleton
- Bean Scopes — Prototype:
  https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html#beans-factory-scopes-prototype
- Request, Session, Application, and WebSocket scopes:
  https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html#beans-factory-scopes-other
- Scoped beans as dependencies (scoped proxies):
  https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html#beans-factory-scopes-other-injection
- Method Injection / `@Lookup`:
  https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-method-injection.html
- Custom scopes:
  https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html#beans-factory-scopes-custom
- Javadoc: `ConfigurableBeanFactory`, `Scope`, `CustomScopeConfigurer`, `SimpleThreadScope`,
  `ObjectProvider`.
