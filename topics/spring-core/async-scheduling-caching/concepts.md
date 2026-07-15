# Asynchronous, Scheduled, and Caching Support

Spring Framework ships three closely related "declarative behavior" features that are all built on the **same AOP/proxy machinery**: asynchronous method execution (`@Async`), scheduled task execution (`@Scheduled`), and declarative caching (`@Cacheable` and friends). Each is switched on with an `@EnableXxx` annotation on a `@Configuration` class, and each works by wrapping your beans in a proxy that adds behavior *around* the target method invocation.

Because all three are proxy-based, they share one crucial limitation that interviewers love to probe: **self-invocation (calling an annotated method from another method of the same class through `this`) bypasses the proxy**, so the async/scheduled/caching behavior does not apply.

> Note on Jakarta: This document targets **Spring Framework 6.x**, which requires **Java 17+** and the **Jakarta EE 9+** namespace (`jakarta.*`). Older Spring 5.x used `javax.*`. The Spring-specific annotations discussed here (`@Async`, `@Scheduled`, `@Cacheable`, etc.) live in the `org.springframework.*` packages regardless of version. Spring also *supports* JSR-based annotations where relevant (e.g. JSR-107 / JCache `@CacheResult`), which use `javax.cache.*`.

---

## Enabling Asynchronous Execution with EnableAsync and Async

`@Async` marks a method (or an entire class) so that each invocation runs in a **separate thread**, returning control to the caller immediately. It is Spring's declarative alternative to manually submitting `Runnable`/`Callable` tasks to an `ExecutorService`.

To activate the feature you must add `@EnableAsync` to a `@Configuration` class. Without it, `@Async` annotations are simply ignored and methods run synchronously on the caller's thread.

```java
@Configuration
@EnableAsync
public class AsyncConfig {
    // optionally implement AsyncConfigurer to customize the executor
}

@Component
public class NotificationService {

    @Async
    public void sendEmail(String to) {
        // runs on a TaskExecutor thread, not the caller's thread
    }
}
```

How it works under the hood:

- `@EnableAsync` imports infrastructure that registers an `AsyncAnnotationBeanPostProcessor`. This post-processor creates an AOP proxy (`AsyncAnnotationAdvisor`) around any bean containing `@Async` methods.
- When you call the method, the proxy intercepts the call and submits the actual invocation to a `TaskExecutor`, then returns immediately.
- The `@Async` annotation can be placed on individual methods, or on a class/interface to make **all** its methods asynchronous.

Requirements and gotchas:

- The bean must be a **Spring-managed bean** and the call must go **through the proxy** (see the self-invocation section).
- Methods annotated with `@Async` should be **public** (with the default JDK/CGLIB proxying); private and package-private methods are not proxied.
- `@Async` **cannot be used together with lifecycle callbacks** such as `@PostConstruct` on the same method (the proxy is not yet fully in place during initialization).

`@EnableAsync` attributes:

| Attribute | Meaning |
|---|---|
| `annotation` | Custom annotation to detect (default: Spring's `@Async` and EJB's `jakarta.ejb.Asynchronous`). |
| `mode` | `PROXY` (default, Spring AOP) or `ASPECTJ` (compile/load-time weaving that also handles self-invocation). |
| `proxyTargetClass` | `true` forces CGLIB (class-based) proxies instead of JDK dynamic (interface) proxies. |
| `order` | Ordering of the async advice in the advisor chain. |

`@Async` also supports a **value** attribute naming a specific executor bean, e.g. `@Async("emailExecutor")`, so different methods can use different thread pools.

---

## Async Return Types void Future and CompletableFuture

The declared return type of an `@Async` method determines how (and whether) the caller can observe the result.

| Return type | Behavior |
|---|---|
| `void` | Fire-and-forget. The caller cannot get a result. Exceptions cannot be propagated to the caller. |
| `Future<T>` | Caller gets a handle; `future.get()` blocks until the result (or exception) is available. |
| `CompletableFuture<T>` | Preferred modern type; supports non-blocking composition (`thenApply`, `thenCompose`, etc.). |
| `ListenableFuture<T>` | Older Spring type with callbacks; **deprecated in Spring 6** in favor of `CompletableFuture`. |

```java
@Async
public CompletableFuture<User> findUser(String id) {
    User u = repository.load(id);
    return CompletableFuture.completedFuture(u); // wrap the already-computed value
}
```

Key points interviewers ask about:

- **Exception handling differs by return type.** For methods returning a `Future`/`CompletableFuture`, an exception thrown inside is captured and re-thrown when the caller calls `get()`. For `void` methods, the caller never sees the exception; instead it is routed to an `AsyncUncaughtExceptionHandler` (configurable via `AsyncConfigurer.getAsyncUncaughtExceptionHandler()`; the default just logs it).
- You return a **completed future** (`CompletableFuture.completedFuture(value)`) even though the method body ran on the async thread — the framework returns a *separate* future to the caller and completes it with your returned value. (Since Spring supports returning a real future, you can also return an in-flight `CompletableFuture`.)
- The return type must be `void` or a supported `Future` subtype; other return types cause an error at proxy time.

---

## Configuring the TaskExecutor for Async

`@Async` tasks run on a **`TaskExecutor`** (Spring's extension of `java.util.concurrent.Executor`). If you do not configure one explicitly, Spring searches for a suitable executor:

1. A unique `TaskExecutor` bean, or a bean named **`taskExecutor`** of type `Executor`.
2. If none is found, Spring **6+ falls back to a `SimpleAsyncTaskExecutor`** — which by default creates a **new thread per task and does not pool or bound them** (though it can be configured with concurrency limits / virtual threads). This is fine for demos but dangerous in production, so you almost always define your own pool.

To customize the default executor, implement `AsyncConfigurer`:

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        executor.initialize();
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return new SimpleAsyncUncaughtExceptionHandler();
    }
}
```

`ThreadPoolTaskExecutor` is the standard pooling executor. Important sizing semantics (they mirror `java.util.concurrent.ThreadPoolExecutor`):

- Threads are created up to **corePoolSize**.
- Additional tasks are **queued** up to **queueCapacity**.
- Only when the queue is full are new threads created up to **maxPoolSize**.
- If both the queue and maxPoolSize are exhausted, the configured `RejectedExecutionHandler` kicks in (default: `AbortPolicy`, which throws `RejectedExecutionException`).

You can route specific methods to named executors with `@Async("beanName")`. As of Spring 6.1, `ThreadPoolTaskExecutor`/`SimpleAsyncTaskExecutor` also support **virtual threads** (`setVirtualThreads(true)` / `Executors.newVirtualThreadPerTaskExecutor()`), which pairs well with `@Async` fire-and-forget or blocking calls.

---

## Enabling Scheduling with EnableScheduling and Scheduled

`@Scheduled` turns a method into a periodically- or cron-triggered task. Activate it with `@EnableScheduling` on a `@Configuration` class.

```java
@Configuration
@EnableScheduling
public class SchedulingConfig { }

@Component
public class ReportJob {

    @Scheduled(fixedRate = 5000)
    public void poll() { /* runs every 5 seconds */ }
}
```

Constraints on `@Scheduled` methods:

- The method must take **no arguments**.
- The method must return **`void`** (any returned value is ignored; more precisely non-void returns are not observed). Since Spring 6.1, returning a `CompletableFuture`/reactive type is supported for "one-shot" reactive scheduling, but classic scheduled tasks are `void`.
- The method should generally be on a Spring bean, and (like the other features) is invoked through a proxy/registrar, so **self-invocation caveats apply** for triggering.

How it works:

- `@EnableScheduling` registers a `ScheduledAnnotationBeanPostProcessor` that scans beans for `@Scheduled` methods and registers them with a `TaskScheduler`.
- By default all scheduled tasks run on a **single-threaded** scheduler. This means if one task overruns, it delays others. To parallelize, define your own `TaskScheduler` bean (e.g. `ThreadPoolTaskScheduler` with a pool size), or implement `SchedulingConfigurer`.

```java
@Bean
public TaskScheduler taskScheduler() {
    ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(5);
    scheduler.setThreadNamePrefix("sched-");
    return scheduler;
}
```

`@Scheduled` and `@Async` are orthogonal but composable: annotating a method with both makes each scheduled trigger run on the async executor rather than blocking the scheduler thread.

---

## fixedRate vs fixedDelay vs cron

`@Scheduled` supports three mutually informative trigger strategies. You configure exactly one primary trigger per annotation.

| Attribute | Timing anchor | Behavior |
|---|---|---|
| `fixedRate` | **Start** of previous execution | Next run scheduled `rate` ms after the *previous run began*. Runs at a fixed frequency regardless of how long each execution takes (a single-threaded scheduler will still serialize overlapping runs). |
| `fixedDelay` | **End** of previous execution | Next run scheduled `delay` ms after the *previous run finished*. Guarantees a gap between executions. |
| `cron` | Wall-clock calendar | Fires at times matching a cron expression; supports complex calendar schedules and time zones. |
| `initialDelay` | (modifier) | Delay before the *first* execution; combined with `fixedRate`/`fixedDelay`. |

```java
@Scheduled(fixedRate = 5000)                 // every 5s from each start
@Scheduled(fixedDelay = 5000)                // 5s after each finish
@Scheduled(fixedRate = 5000, initialDelay = 10000) // wait 10s, then every 5s
@Scheduled(cron = "0 0 9 * * MON-FRI")       // 09:00 on weekdays
@Scheduled(cron = "0 15 10 * * ?", zone = "America/New_York")
```

**fixedRate vs fixedDelay — the classic question.** If a task takes 7s and `fixedRate = 5000`: with a single-threaded scheduler, since the previous execution hasn't finished when the next is due, the next run starts immediately after (they can't overlap on one thread), so effectively back-to-back. With `fixedDelay = 5000`, the next run always starts 5s *after* the prior run completes, so total cycle ≈ 12s. Rate targets throughput/frequency; delay targets spacing.

Spring's **cron format has 6 fields** (unlike the classic Unix 5-field crontab): `second minute hour day-of-month month day-of-week`.

```
 ┌───────── second (0-59)
 │ ┌─────── minute (0-59)
 │ │ ┌───── hour (0-23)
 │ │ │ ┌─── day-of-month (1-31)
 │ │ │ │ ┌─ month (1-12 or JAN-DEC)
 │ │ │ │ │ ┌ day-of-week (0-7 or SUN-SAT; 0 and 7 = Sunday)
 * * * * * *
```

Special values: `*` (any), `?` (no specific value, for day-of-month/day-of-week), `/` (increments, e.g. `0/15`), `-` (ranges), `,` (lists), plus macros like `@hourly`, `@daily` (aka `@midnight`), `@weekly`, `@monthly`, and `@yearly` (aka `@annually`). Note Spring does **not** support the Unix `@reboot` macro. Since Spring 5.3 you can also disable a task with `cron = "-"` (Scheduled.CRON_DISABLED). The values can be supplied via property placeholders / SpEL, e.g. `fixedRateString = "${poll.rate}"` or `cron = "${report.cron}"`.

---

## Enabling Caching with EnableCaching Cacheable CacheEvict and CachePut

Declarative caching lets Spring transparently store a method's return value keyed by its arguments, so repeat calls with the same arguments skip the method body and return the cached value. Enable it with `@EnableCaching`.

```java
@Configuration
@EnableCaching
public class CacheConfig {
    @Bean
    public CacheManager cacheManager() {
        return new ConcurrentMapCacheManager("books");
    }
}
```

The three core annotations:

| Annotation | When the method body runs | Effect on cache |
|---|---|---|
| `@Cacheable` | **Only on a cache miss.** On a hit, the cached value is returned and the method is skipped. | Populates the cache with the return value on a miss. |
| `@CachePut` | **Always** (every invocation). | Stores/updates the cache with the fresh return value. Use to refresh an entry. |
| `@CacheEvict` | Always (normally). | Removes one entry, or with `allEntries = true`, clears the whole cache region. |

```java
@Cacheable("books")
public Book findBook(String isbn) { /* slow lookup */ }

@CachePut(value = "books", key = "#book.isbn")
public Book updateBook(Book book) { return repository.save(book); }

@CacheEvict(value = "books", key = "#isbn")
public void deleteBook(String isbn) { repository.delete(isbn); }

@CacheEvict(value = "books", allEntries = true)
public void reloadCatalog() { }
```

Important attributes and behaviors:

- **`key`** — SpEL expression for the cache key (default: all method parameters via `SimpleKeyGenerator`; a single param becomes the key directly, multiple params form a `SimpleKey`). You can reference args (`#isbn`, `#p0`), the result (`#result`, for `@CachePut`/conditional evict), etc.
- **`condition`** — SpEL evaluated *before* invocation; caching only applies if true.
- **`unless`** — SpEL evaluated *after* invocation (can use `#result`); vetoes caching if true. Classic use: `unless = "#result == null"`.
- **`sync = true`** (on `@Cacheable`) — serializes concurrent misses for the same key so the method runs once (prevents cache stampede).
- **`beforeInvocation`** (on `@CacheEvict`) — if `true`, evict *before* the method runs (so eviction happens even if the method throws); default `false` evicts *after* successful return.
- **`@Caching`** groups multiple cache annotations on one method; **`@CacheConfig`** sets class-level defaults (cache names, key generator, cache manager).

`@Cacheable` vs `@CachePut`: never put both on the same method — `@Cacheable` skips execution on a hit while `@CachePut` always executes, so their behaviors conflict.

Spring also supports the **JSR-107 (JCache) annotations** (`@CacheResult`, `@CachePut`, `@CacheRemove`, `@CacheRemoveAll` from `javax.cache.annotation`) when a JCache provider and the corresponding config are present.

---

## The CacheManager Abstraction

Spring's caching is a **thin abstraction over a caching backend**, not a cache implementation itself. Two SPIs form the abstraction:

- **`org.springframework.cache.CacheManager`** — a registry that returns named `Cache` instances via `getCache(String name)`.
- **`org.springframework.cache.Cache`** — a store with `get`, `put`, `evict`, `clear`, etc., keyed by arbitrary objects.

You must provide a `CacheManager` bean; `@EnableCaching` does **not** create one for you (this is a common Spring-vs-Spring-Boot distinction — Spring Boot auto-configures a `CacheManager`, plain Spring Framework does not).

Common `CacheManager` implementations shipped or integrated:

| CacheManager | Backend |
|---|---|
| `ConcurrentMapCacheManager` | Simple in-JVM `ConcurrentHashMap` (good for tests/dev; unbounded). |
| `SimpleCacheManager` | Wraps a set of `Cache` instances you supply manually. |
| `CaffeineCacheManager` | Caffeine (high-performance in-JVM, eviction/expiry). |
| `JCacheCacheManager` | Any JSR-107 provider (EhCache 3, etc.). |
| `RedisCacheManager` | Redis (from Spring Data Redis) — distributed. |
| `CompositeCacheManager` | Chains multiple managers. |
| `NoOpCacheManager` | Disables caching (always misses) — useful to toggle caching off. |

Notes:

- The abstraction **does not do serialization, TTL, or eviction itself** — those are backend concerns. `ConcurrentMapCacheManager` has no TTL/size limits; if you need expiry, use Caffeine, Redis, or a JCache provider.
- You can select among multiple cache managers per-annotation with `cacheManager = "..."` or via a `CacheResolver`.
- The abstraction stores `null` values by default (unless `allowNullValues = false`), so a cached `null` counts as a hit.

---

## Proxy AOP Basis and the Self-Invocation Caveat

All three features — `@Async`, `@Scheduled`-triggered advice for caching/async on scheduled methods, and `@Cacheable`/`@CacheEvict`/`@CachePut` — are implemented with **Spring AOP proxies** by default. Understanding the proxy model explains most of their "why didn't it work?" behaviors.

How the proxy works:

- When a bean has async/caching (or transactional) annotations, Spring wraps it in a proxy — a **JDK dynamic proxy** if the bean implements an interface, or a **CGLIB** subclass proxy otherwise (force CGLIB with `proxyTargetClass = true`).
- Other beans get the *proxy* injected, not the raw target. Calls made **through the proxy** trigger the surrounding advice (submit to executor / consult cache / manage transaction), then delegate to the real method.

### The self-invocation caveat (the #1 interview trap)

If a method inside the same class calls another annotated method via `this.method()`, the call **does not pass through the proxy** — it goes straight to the target instance. Therefore the advice never runs: `@Async` runs synchronously on the caller thread, `@Cacheable` neither reads nor writes the cache, `@CacheEvict` does not evict.

```java
@Service
public class OrderService {

    public void process() {
        // BUG: internal 'this' call bypasses the proxy — NOT async, NOT cached
        this.audit();
    }

    @Async
    public void audit() { /* intended to be async */ }
}
```

Why: the proxy wraps the object from the *outside*. Once execution is inside the target object, `this` is the raw target, which has no notion of the advice.

Ways to make self-invocation work (or avoid the problem):

1. **Refactor** the annotated method into a *separate bean* and inject it, so the call crosses a proxy boundary (recommended, cleanest).
2. **Self-injection**: inject the bean into itself (or use `ApplicationContext.getBean`) and call through that reference.
3. Use **`AopContext.currentProxy()`** and cast (requires `exposeProxy = true`); ties code to Spring AOP, generally discouraged.
4. Switch **`mode = ASPECTJ`** (load-time or compile-time weaving). AspectJ weaves the advice into the bytecode of the class itself, so even internal `this` calls are intercepted. This is the only mode that truly handles self-invocation.

Other proxy-related consequences shared by all three:

- Annotations on **private / final / static** methods are not advised by the default proxy mechanisms (CGLIB cannot subclass final classes/methods; JDK proxies only see interface methods). Effective methods should be `public` and non-final.
- The behavior only applies to **Spring-managed beans**; `new`-ing the object yourself gives you no proxy.

---

## Common follow-up questions

- **Why is my `@Async`/`@Cacheable` method running synchronously / not caching?** Almost always self-invocation (internal `this` call), a missing `@EnableAsync`/`@EnableCaching`, a non-public method, or the object not being a Spring bean.
- **What's the difference between `fixedRate` and `fixedDelay`?** Rate measures from the *start* of the previous run (fixed frequency); delay measures from the *end* (fixed gap between runs).
- **Does `@EnableCaching` give me a cache?** No — you must define a `CacheManager` bean in plain Spring. Spring Boot auto-configures one; the Spring Framework does not.
- **How do I handle exceptions from a `void @Async` method?** They never reach the caller; register an `AsyncUncaughtExceptionHandler`. For `Future`-returning methods the exception surfaces on `get()`.
- **Why does the default scheduler serialize my tasks?** The default `TaskScheduler` is single-threaded; supply a `ThreadPoolTaskScheduler` with a larger pool.
- **`@Cacheable` vs `@CachePut`?** `@Cacheable` skips the method on a hit; `@CachePut` always runs the method and updates the cache. Don't combine them on one method.
- **How do I avoid a cache stampede on a hot key?** Use `@Cacheable(sync = true)`.
- **JDK dynamic proxy vs CGLIB — which does Spring use?** Interface present → JDK dynamic proxy; no interface (or `proxyTargetClass = true`) → CGLIB subclass proxy.
- **Difference from Spring Boot?** Spring Boot adds auto-configuration (default executor, cache manager detection via `spring.cache.*`, starters). Core Spring Framework requires you to enable and configure everything explicitly.

## References

- Spring Framework Reference — Integration, "Task Execution and Scheduling": https://docs.spring.io/spring-framework/reference/integration/scheduling.html
- Spring Framework Reference — "Cache Abstraction": https://docs.spring.io/spring-framework/reference/integration/cache.html
- `@Async` / `@EnableAsync` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/Async.html
- `@Scheduled` Javadoc (trigger attributes and cron syntax): https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/Scheduled.html
- `CronExpression` Javadoc (6-field syntax, macros): https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/support/CronExpression.html
- `CacheManager` / `Cache` SPI Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/cache/CacheManager.html
- Spring AOP proxying mechanisms and self-invocation: https://docs.spring.io/spring-framework/reference/core/aop/proxying.html
