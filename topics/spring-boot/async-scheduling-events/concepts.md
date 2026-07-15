# Asynchronous Processing, Scheduling & Application Events

Spring provides first-class support for running work off the main request thread. This topic covers three closely related pillars: **scheduling** (`@Scheduled`), **asynchronous method execution** (`@Async`), and the **application event** system (`ApplicationEventPublisher` / `@EventListener` / `@TransactionalEventListener`). All three are built on top of Spring's AOP proxy infrastructure, so the same proxy gotchas (self-invocation, `public` methods only) apply.

> **Spring Boot 3.x / Jakarta note:** These features live in `spring-context` and are framework-level (not Jakarta EE). They are unaffected by the `javax.*` → `jakarta.*` migration. However, `@TransactionalEventListener` interacts with `@Transactional`, which in Spring 6 / Boot 3 uses `jakarta.transaction.Transactional` or `org.springframework.transaction.annotation.Transactional`. Virtual threads (Loom) support was added in Spring 6.1 / Boot 3.2 and directly affects executor choices.

---

## @EnableScheduling and @Scheduled

`@EnableScheduling` is the switch that activates Spring's scheduling infrastructure. Placed on a `@Configuration` class (or any bean-holding config), it registers a `ScheduledAnnotationBeanPostProcessor` that scans all beans for `@Scheduled` methods and wires them into a `TaskScheduler`.

```java
@Configuration
@EnableScheduling
public class SchedulingConfig { }

@Component
public class ReportJob {
    @Scheduled(fixedRate = 5000)
    public void generate() { /* runs every 5s */ }
}
```

**Rules for a `@Scheduled` method:**
- Must have **`void`** return type (a non-void return is simply ignored).
- Must take **no arguments** — there is no natural argument source for a scheduled invocation.
- The enclosing type must be a Spring-managed bean.

**Why it matters:** Scheduling lets you run cron-like maintenance, polling, cache eviction, and batch triggers inside your app without an external cron daemon or Quartz. In Spring Boot, simply adding `@EnableScheduling` is enough — Boot auto-configures a default single-threaded scheduler if you do not define one.

**Default executor gotcha:** Without a custom `TaskScheduler`/`ThreadPoolTaskScheduler` bean, Spring uses a **single-threaded** scheduler. That means one long-running or blocking job **delays every other scheduled job**. This is the most common scheduling production bug — see [ThreadPoolTaskScheduler](#threadpooltaskscheduler).

---

## fixedRate vs fixedDelay vs cron

The three trigger styles differ in *when the clock starts*:

| Attribute | Meaning | Overlap behavior |
|-----------|---------|------------------|
| `fixedRate` | Interval measured from **start** of one execution to the **start** of the next. | With a single-threaded scheduler, if a run overtakes the interval the next run waits (no concurrency by default). Rate is "aspirational" and can drift under contention. |
| `fixedDelay` | Interval measured from the **end (completion)** of one execution to the **start** of the next. | Always leaves a gap equal to the delay after completion; naturally prevents overlap. |
| `cron` | A cron expression evaluated against wall-clock time. | Fires at matching clock times; missed ticks (if the previous run is still going on a single thread) are simply skipped. |

```java
@Scheduled(fixedRate = 5000)          // start-to-start = 5s
@Scheduled(fixedDelay = 5000)         // end-to-next-start = 5s
@Scheduled(cron = "0 0 * * * *")      // top of every hour
@Scheduled(fixedRateString = "${job.rate:5000}")  // externalized
```

**Key distinction (classic trap):** If a task takes 8s and `fixedRate=5000`, with `fixedRate` the scheduler *wants* to start every 5s but a single thread forces serialization, so effectively it runs back-to-back. With `fixedDelay=5000` it runs at 8s + 5s = every 13s. Use `fixedRate` for "run as close to every N ms as possible"; use `fixedDelay` for "wait N ms after each finish" (safer when runs must not pile up).

**`Duration`/`timeUnit` support:** Since Spring 5.3 (the `timeUnit` attribute was added in 5.3.10), `fixedRate`/`fixedDelay`/`initialDelay` can be expressed with `timeUnit` (e.g. `@Scheduled(fixedRate = 5, timeUnit = TimeUnit.SECONDS)`), and the `*String` variants accept ISO-8601 `Duration` strings like `"PT5S"`.

**Cron specifics in Spring:** Spring cron has **6 fields** — `second minute hour day-of-month month day-of-week` (Quartz-style with seconds first), *not* the 5-field Unix cron. It supports macros like `@hourly`, `@daily`, `@midnight`, `@weekly`, `@monthly`, `@yearly`, and `@annually`. A `cron` value of `"-"` disables the trigger. You can also set a `zone` attribute; without it, the server's default timezone is used.

**Mutual exclusivity:** Exactly one of `cron`, `fixedRate`, or `fixedDelay` may be specified per annotation (you can't combine `fixedRate` and `fixedDelay`). `initialDelay` may accompany `fixedRate`/`fixedDelay` but is meaningless with `cron`.

---

## initialDelay

`initialDelay` (or `initialDelayString`) delays the **first** execution after the scheduler/context starts up, and is only valid alongside `fixedRate` or `fixedDelay`.

```java
@Scheduled(initialDelay = 10000, fixedRate = 5000)
public void warmup() { }  // first run 10s after startup, then every 5s
```

- With `cron`, `initialDelay` is **not allowed** — the next fire time is derived purely from the cron expression, so specifying it throws an `IllegalArgumentException` at startup.
- Common use: avoid all jobs firing simultaneously at boot ("thundering herd"), or wait for warm-up/cache priming before the first poll.
- `initialDelayString` supports property placeholders and ISO-8601 durations, enabling per-environment tuning.

---

## ThreadPoolTaskScheduler

`ThreadPoolTaskScheduler` is Spring's `TaskScheduler` implementation backed by a `ScheduledThreadPoolExecutor` (a `ScheduledExecutorService`). Define one as a bean to move scheduling off the default single thread:

```java
@Bean
public ThreadPoolTaskScheduler taskScheduler() {
    ThreadPoolTaskScheduler s = new ThreadPoolTaskScheduler();
    s.setPoolSize(10);
    s.setThreadNamePrefix("sched-");
    s.setWaitForTasksToCompleteOnShutdown(true);
    s.setAwaitTerminationSeconds(30);
    return s;
}
```

**Why it matters:** The default scheduler pool size is **1**. If you have five `@Scheduled` jobs and one blocks, the other four starve. Sizing the pool (or providing your own scheduler) is essential for independent jobs.

**How Spring picks a scheduler** (`ScheduledTaskRegistrar` resolution order): a `TaskScheduler` bean → a uniquely named `TaskScheduler` → a `ScheduledExecutorService` bean → otherwise a locally created single-threaded `ScheduledExecutorService`. In Spring Boot you can also configure the auto-configured scheduler via `spring.task.scheduling.pool.size` (default 1) and `spring.task.scheduling.thread-name-prefix` without defining a bean at all.

**Customizing via `SchedulingConfigurer`:** Implement `SchedulingConfigurer` to register tasks programmatically or supply the scheduler:

```java
@Configuration
@EnableScheduling
public class SchedConfig implements SchedulingConfigurer {
    @Override public void configureTasks(ScheduledTaskRegistrar registrar) {
        registrar.setScheduler(Executors.newScheduledThreadPool(10));
    }
}
```

**`TaskScheduler` vs `TaskExecutor`:** `TaskScheduler` is for time-based/delayed/recurring execution (`schedule`, `scheduleAtFixedRate`, `scheduleWithFixedDelay`); `TaskExecutor` (used by `@Async`) is for fire-and-forget parallel execution with no timing semantics. Do not conflate them.

**Virtual threads (Boot 3.2+):** Setting `spring.threads.virtual.enabled=true` makes `@Async` and web request handling use virtual threads. Scheduling still needs a platform-thread scheduler for timing, but scheduled *tasks* can be dispatched onto virtual threads via a `SimpleAsyncTaskScheduler` with virtual threads enabled.

---

## @EnableAsync and @Async

`@EnableAsync` activates asynchronous method execution; `@Async` marks the methods that should run on a separate thread. Together they let a caller return immediately while the annotated method runs on a `TaskExecutor`.

```java
@Configuration
@EnableAsync
public class AsyncConfig { }

@Service
public class MailService {
    @Async
    public void sendWelcome(String to) { /* runs on another thread */ }
}
```

**How it works (internals):** `@EnableAsync` imports infrastructure that creates an `AsyncAnnotationBeanPostProcessor`. This post-processor wraps each bean containing `@Async` methods in an AOP proxy (`AsyncAnnotationAdvisor`). When you call the method, the proxy's advice submits the actual invocation to a `TaskExecutor` and returns immediately. So `@Async` is **pure AOP** — same proxy machinery as `@Transactional`.

**Constraints:**
- Method must be **`public`** (proxy-based; non-public methods are not advised).
- Return type must be `void`, `Future`, `CompletableFuture`/`ListenableFuture` (deprecated), or a reactive type — see [@Async return types](#async-return-types).
- Applies to Spring-managed beans only.

**`@EnableAsync(proxyTargetClass = true)`** forces CGLIB (class) proxies instead of JDK dynamic (interface) proxies — needed when the bean has no interface or you inject the concrete class. In Spring Boot, `proxyTargetClass` defaults to `true` globally (CGLIB), so class-based proxies are the norm.

**`@Async("executorName")`** — the value/qualifier names a specific `Executor` bean to run this method on, overriding the default executor for just that method.

---

## @Async return types

| Return type | Semantics |
|-------------|-----------|
| `void` | Fire-and-forget. Caller cannot observe completion or exceptions (exceptions go to `AsyncUncaughtExceptionHandler`). |
| `Future<T>` | Caller can `get()` (blocking) and catch `ExecutionException`. Limited composition. |
| `CompletableFuture<T>` | Preferred. Non-blocking composition (`thenApply`, `thenCompose`, `exceptionally`), returned via `CompletableFuture.completedFuture(result)`. |
| `ListenableFuture<T>` | Legacy Spring type, **deprecated** in Spring 6 in favor of `CompletableFuture`. |
| Reactive (`Mono`/`Flux`) | Not the intended use; reactive types already run on their own schedulers. Avoid `@Async` on them. |

```java
@Async
public CompletableFuture<Order> loadOrder(Long id) {
    Order o = repo.findById(id);
    return CompletableFuture.completedFuture(o);  // must return a completed future
}
```

**Trap:** For a non-void `@Async` method you must still return a `Future`/`CompletableFuture` object *synchronously wrapping* the result. Returning a raw value type (other than one of the allowed wrappers) is not a valid `@Async` signature. When the method returns `void`, any thrown exception cannot propagate to the caller — it is routed to the exception handler.

---

## Custom TaskExecutor for @Async

By default (if you don't configure one) `@Async` uses a `SimpleAsyncTaskExecutor` in many older setups, but Spring Boot auto-configures a `ThreadPoolTaskExecutor` bean named `applicationTaskExecutor` (also exposed as `taskExecutor`) which `@Async` will use. **`SimpleAsyncTaskExecutor` does NOT reuse threads — it creates a new thread per task** (unless a concurrency limit is set), which is dangerous under load.

Two ways to customize:

**1. Implement `AsyncConfigurer`** to set the *default* executor for all `@Async` methods:
```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {
    @Override public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setCorePoolSize(8);
        ex.setMaxPoolSize(16);
        ex.setQueueCapacity(100);
        ex.setThreadNamePrefix("async-");
        ex.initialize();
        return ex;
    }
    @Override public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return new SimpleAsyncUncaughtExceptionHandler();
    }
}
```

**2. Define multiple `Executor` beans and select per-method** with `@Async("beanName")`.

**`ThreadPoolTaskExecutor` sizing semantics (classic trap):** tasks first fill up to `corePoolSize` threads; **additional tasks are queued** until `queueCapacity` is full; only when the queue is full does the pool grow toward `maxPoolSize`. So if `queueCapacity` is very large (e.g. `Integer.MAX_VALUE`, the default), `maxPoolSize` is effectively never reached. When both the queue and max pool are saturated, the `RejectedExecutionHandler` kicks in (default `AbortPolicy` → `TaskRejectedException`).

**Boot properties:** `spring.task.execution.pool.core-size`, `max-size`, `queue-capacity`, `thread-name-prefix` tune the auto-configured executor without a bean.

---

## AsyncUncaughtExceptionHandler and exception handling

Exception handling for `@Async` depends on the return type:

- **`Future`/`CompletableFuture` return:** the exception is captured in the future and re-thrown wrapped in `ExecutionException` when the caller invokes `get()` (or handled via `exceptionally`/`whenComplete`). The handler is NOT invoked.
- **`void` return:** there is no future to carry the exception, so it is passed to the configured **`AsyncUncaughtExceptionHandler`**. The default is `SimpleAsyncUncaughtExceptionHandler`, which just logs the error.

```java
public class CustomHandler implements AsyncUncaughtExceptionHandler {
    @Override public void handleUncaughtException(Throwable ex, Method m, Object... params) {
        log.error("Async method {} failed", m.getName(), ex);
    }
}
// registered via AsyncConfigurer.getAsyncUncaughtExceptionHandler()
```

**Trap:** A `try/catch` around the *call site* of a `void @Async` method never catches the async exception — the caller has already returned. You must use the `AsyncUncaughtExceptionHandler` (or switch to a `Future` return and inspect it).

---

## @Async proxy self-invocation caveat

Because `@Async` is implemented with an AOP proxy, calling an `@Async` method **from within the same class** (via `this.method()`) bypasses the proxy entirely, so the call runs **synchronously on the caller's thread** — the async behavior is silently lost. This is the exact same self-invocation trap as `@Transactional`.

```java
@Service
public class OrderService {
    public void process() {
        doAsync();   // BUG: internal call bypasses proxy → runs synchronously
    }
    @Async
    public void doAsync() { }
}
```

**Fixes:**
- Move the `@Async` method to a **separate bean** and inject it (most common, cleanest).
- Self-inject the proxy (`@Autowired private OrderService self;`) and call `self.doAsync()`.
- Obtain the proxy via `AopContext.currentProxy()` (requires `exposeProxy = true`).

**Related proxy caveats:** `@Async` also does not work on `private`/`final`/`static` methods, and (with CGLIB) the class itself cannot be `final`. Same limitations as any Spring AOP proxy. Also, `@Async` on a method whose bean is created *before* the `AsyncAnnotationBeanPostProcessor` (rare, e.g. `BeanPostProcessor`s themselves) will not be proxied.

---

## Application events: ApplicationEvent, ApplicationEventPublisher and @EventListener

Spring's event mechanism is an in-process **observer/pub-sub** pattern for decoupling components within a single application context. A publisher fires an event; any number of listeners react — without the publisher knowing who they are.

**Publishing:**
```java
@Component
public class OrderService {
    private final ApplicationEventPublisher publisher;   // inject
    public void place(Order o) {
        // ... persist ...
        publisher.publishEvent(new OrderPlacedEvent(o)); // POJO since Spring 4.2
    }
}
```
Since **Spring 4.2**, events need **not** extend `ApplicationEvent` — any POJO works. (Extending `ApplicationEvent` is still allowed and gives you a timestamp/source.)

**Listening — annotation style (preferred):**
```java
@Component
public class OrderListener {
    @EventListener
    public void on(OrderPlacedEvent e) { /* react */ }

    @EventListener(condition = "#e.amount > 100")   // SpEL condition
    public void onBig(OrderPlacedEvent e) { }
}
```
**Listening — interface style (legacy):** implement `ApplicationListener<MyEvent>`.

**Powerful features of `@EventListener`:**
- **Multiple event types:** `@EventListener({A.class, B.class})`.
- **Conditional dispatch** via SpEL `condition`.
- **Chained publishing:** if the listener method **returns** a (non-null) value or `Collection`/array of values, Spring publishes those as new events. Returning `void`/`null` publishes nothing.
- **Ordering:** annotate listeners with `@Order` to control invocation order for the same event.

**Built-in lifecycle events:** `ContextRefreshedEvent`, `ContextStartedEvent`, `ContextStoppedEvent`, `ContextClosedEvent`, and Boot's `ApplicationStartingEvent`/`ApplicationReadyEvent`/`ApplicationFailedEvent`, etc.

**Generics:** `ApplicationListener<PayloadApplicationEvent<T>>` or resolvable-type tricks let listeners target generic events; `@EventListener` resolves generics from the method parameter type.

---

## Synchronous-by-default event semantics

**The single most important event fact:** Spring event publication is **synchronous and single-threaded by default**. `publishEvent()` **blocks** until *all* matching listeners have finished, running them on the **publisher's thread** (and, if the publisher is inside a `@Transactional` method, within the **same transaction**).

Consequences:
- If a listener throws, the exception **propagates back to the publisher** (`publishEvent` re-throws), and can **roll back the caller's transaction**. Listeners are not isolated by default.
- Ordering among listeners for one event is controlled by `@Order`; there is no parallelism unless you opt in.
- Total publish latency = sum of all listener latencies.

This is a frequent trap: developers assume events are async "messaging" — they are not. To make a listener async, add `@Async` to it (and `@EnableAsync`) — see [Async events](#async-events-async-on-listener). The underlying multicaster is `SimpleApplicationEventMulticaster`; if you set a `taskExecutor` on it, *all* events become async.

---

## @TransactionalEventListener

`@TransactionalEventListener` binds listener invocation to the **transaction lifecycle** of the publishing transaction. Instead of firing immediately at `publishEvent()`, the listener is deferred until a chosen transaction phase.

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void handle(OrderPlacedEvent e) { /* runs only after commit succeeds */ }
```

**Phases (`TransactionPhase`):**
| Phase | When it fires |
|-------|---------------|
| `AFTER_COMMIT` (default) | After the transaction commits successfully. |
| `AFTER_ROLLBACK` | After the transaction rolls back. |
| `AFTER_COMPLETION` | After the transaction completes (commit *or* rollback). |
| `BEFORE_COMMIT` | Before commit is flushed. |

**Why it matters:** The canonical use case is "do X only if the DB change actually committed" — e.g. send a confirmation email or publish to Kafka *after* the order row is durably committed, avoiding the bug where you notify then the transaction rolls back.

**Critical gotcha:** By default, if there is **no active transaction** when the event is published, a `@TransactionalEventListener` **does not fire at all** (the event is silently dropped). Set `fallbackExecution = true` to make it run immediately when no transaction is present.

**`AFTER_COMMIT` + database writes trap:** Code in an `AFTER_COMMIT` listener runs *after* the transaction has committed, so any new DB writes there are **outside** the original transaction. In many setups they will **not be committed** unless a new transaction is started (e.g. the listener method or a called method is `@Transactional(propagation = REQUIRES_NEW)`). Naively writing to the DB in an `AFTER_COMMIT` listener can silently fail to persist.

**Combining with `@Async`:** `@TransactionalEventListener` is still synchronous by default (runs on the committing thread during the after-commit callback). Add `@Async` to run the after-commit work on a separate thread. Note that once async, it no longer shares the original transaction/thread context.

---

## Async events (@Async on listener)

To make an individual listener asynchronous, annotate it with **both** `@EventListener` (or `@TransactionalEventListener`) and `@Async`, and enable `@EnableAsync`:

```java
@Async
@EventListener
public void handle(OrderPlacedEvent e) { /* runs on a TaskExecutor thread */ }
```

Effects of making a listener `@Async`:
- `publishEvent()` returns immediately; the listener runs on a separate thread from the `@Async` executor.
- **Exceptions no longer propagate to the publisher** — they go to the `AsyncUncaughtExceptionHandler` (for `void`) instead of failing the publisher's flow. So an async listener can't roll back the caller's transaction.
- The listener **loses the caller's thread-bound context** — no shared transaction, no `SecurityContext`/request scope unless propagated explicitly.

**Global vs per-listener async:** Alternatively, set an `Executor` (`taskExecutor`) on the `applicationEventMulticaster` bean (via a `SimpleApplicationEventMulticaster`) to make **all** events async. Per-listener `@Async` is usually preferred because it's targeted and keeps other listeners synchronous.

**Ordering with async:** `@Order` still controls *dispatch* order, but once listeners run on different threads there is no completion-ordering guarantee.

---

## Common follow-up questions

1. **Why did my `@Scheduled` job block all other jobs?** Default scheduler pool size is 1; define a `ThreadPoolTaskScheduler` or set `spring.task.scheduling.pool.size`.
2. **`fixedRate` vs `fixedDelay` when the task takes longer than the interval?** `fixedRate` is start-to-start (runs pile up but serialize on one thread); `fixedDelay` is completion-to-start (always leaves the gap).
3. **Why isn't my `@Async` method running asynchronously?** Likely self-invocation (called via `this` in the same class) or the method isn't `public`, or `@EnableAsync` is missing.
4. **How many cron fields does Spring use?** Six (seconds first), unlike Unix's five.
5. **How do I catch exceptions from a void `@Async` method?** Register an `AsyncUncaughtExceptionHandler` via `AsyncConfigurer`; a try/catch at the call site won't work.
6. **Are Spring events synchronous?** Yes, by default — same thread, same transaction, blocking.
7. **Why did my `@TransactionalEventListener` never fire?** No active transaction at publish time; use `fallbackExecution = true`, or ensure the publisher is transactional.
8. **Why didn't my DB write inside an `AFTER_COMMIT` listener persist?** It runs after commit, outside the original transaction; use `REQUIRES_NEW`.
9. **`initialDelay` with `cron`?** Not allowed — throws at startup.
10. **Difference between `TaskScheduler` and `TaskExecutor`?** Scheduler = timing/recurring; Executor = fire-and-forget parallelism (`@Async`).
11. **Does `@Async` return type matter for exceptions?** Yes: `Future` carries exceptions to `get()`; `void` routes to the handler.
12. **How to make ALL events async?** Set a `taskExecutor` on the `SimpleApplicationEventMulticaster`.

## References

- Spring Framework Reference — Task Execution and Scheduling: https://docs.spring.io/spring-framework/reference/integration/scheduling.html
- Spring Framework Reference — Application Events (`@EventListener`, `@TransactionalEventListener`): https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html#context-functionality-events
- `@Scheduled` javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/Scheduled.html
- `@Async` / `AsyncConfigurer` / `AsyncUncaughtExceptionHandler` javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/Async.html
- Spring Boot — Task Execution and Scheduling: https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html
- Baeldung — Spring `@Scheduled`: https://www.baeldung.com/spring-scheduled-tasks
- Baeldung — Spring `@Async`: https://www.baeldung.com/spring-async
- Baeldung — Spring Events: https://www.baeldung.com/spring-events
- Baeldung — `@TransactionalEventListener`: https://www.baeldung.com/spring-transactional-event-listener
- Baeldung — Spring cron expressions: https://www.baeldung.com/cron-expressions
