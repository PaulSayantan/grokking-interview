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
| `fixedRate` | Interval measured from **start** of one execution to the **start** of the next. | A single `@Scheduled` task **never overlaps itself** — if a run overtakes the interval the next run waits, regardless of pool size (see note below). Rate is "aspirational" and can drift under contention. |
| `fixedDelay` | Interval measured from the **end (completion)** of one execution to the **start** of the next. | Always leaves a gap equal to the delay after completion; naturally prevents overlap. |
| `cron` | A cron expression evaluated against wall-clock time. | Fires at matching clock times; missed ticks (if the previous run is still going on a single thread) are simply skipped. |

```java
@Scheduled(fixedRate = 5000)          // start-to-start = 5s
@Scheduled(fixedDelay = 5000)         // end-to-next-start = 5s
@Scheduled(cron = "0 0 * * * *")      // top of every hour
@Scheduled(fixedRateString = "${job.rate:5000}")  // externalized
```

**Key distinction (classic trap):** If a task takes 8s and `fixedRate=5000`, with `fixedRate` the scheduler *wants* to start every 5s but successive runs of the same task cannot overlap, so effectively it runs back-to-back. With `fixedDelay=5000` it runs at 8s + 5s = every 13s. Use `fixedRate` for "run as close to every N ms as possible"; use `fixedDelay` for "wait N ms after each finish" (safer when runs must not pile up).

**Worked example — 8s task, `fixedRate=5000ms`, timeline in seconds:**

```
t=0   run A starts        (scheduler wanted the next start at t=5)
t=5   next start is DUE, but A is still running → it does NOT start (no self-overlap)
t=8   run A finishes → the overdue run B starts immediately
t=13  next start due; B still running (until t=16) → waits
t=16  B finishes → run C starts immediately  ...
```

So actual starts land at t=0, 8, 16, 24, … — every 8s (paced by the task's own duration), not every 5s. The "5s" only wins once the body finishes faster than the interval.

> [!WARNING]
> **`fixedRate` does not overlap a slow job even with a big pool.** The JDK's `scheduleAtFixedRate` guarantees that successive executions of the *same* task never run concurrently — a late run starts late, never in parallel with the previous one. Raising `spring.task.scheduling.pool.size` therefore will **not** make one overrunning `fixedRate` job overlap itself; the pool only lets *different* scheduled jobs run in parallel (and stops one slow job from starving the others). If you genuinely need concurrent runs of the same logical job, make the body itself dispatch `@Async` work.

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

The default executor depends on whether you are on plain Spring or Spring Boot — a real interview gotcha:
- **Plain Spring** (`@EnableAsync`, no executor bean): `@Async` falls back to a `SimpleAsyncTaskExecutor`, which **does NOT reuse threads — it creates a new thread per task** (unless a concurrency limit is set). Dangerous under load: a burst of work spawns an unbounded number of threads.
- **Spring Boot:** auto-configures a bounded `ThreadPoolTaskExecutor` bean named `applicationTaskExecutor` (also exposed as `taskExecutor`), and `@Async` picks it up automatically — so on Boot you get pooling for free.

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

**Worked example — trace 130 tasks through `core=8, max=16, queue=100`** (the config above). Fire 130 `@Async` tasks in a burst while none have finished:

| Step | Tasks | Where they go | Running / Queued / Rejected |
|------|-------|---------------|------------------------------|
| 1 | #1–#8 | start core threads (fill to `corePoolSize=8`) | 8 running |
| 2 | #9–#108 | queue fills to `queueCapacity=100` | 8 running, 100 queued |
| 3 | #109–#116 | queue is full → pool grows threads 9..16 (up to `maxPoolSize=16`) | 16 running, 100 queued |
| 4 | #117–#130 | pool at max **and** queue full → `AbortPolicy` | 14 rejected → `TaskRejectedException` |

So the pool absorbs exactly `maxPoolSize + queueCapacity = 16 + 100 = 116` tasks; the remaining `130 − 116 = 14` (tasks #117 onward) are rejected. The counter-intuitive part: threads 9–16 only spin up **after** 100 tasks are already waiting — the queue is preferred over new threads.

Now change one thing: `queueCapacity = Integer.MAX_VALUE` (the raw `ThreadPoolExecutor` default). Steps 1–2 are the same, but the queue never fills, so step 3 never happens — the pool **stays at 8 threads forever**, `maxPoolSize=16` is dead config, and no task is ever rejected (they just pile up in memory, risking `OutOfMemoryError`). This is why a bounded queue is what actually lets `maxPoolSize` do anything.

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

**Worked example — trace a publish inside a transaction.** `OrderService.place()` is `@Transactional`; it saves the order row, then calls `publisher.publishEvent(new OrderPlacedEvent(o))`. Two listeners match: A (audit log, ~40ms) then B (throws `MailException`):

```
[TX begins]  order row saved (not yet committed)
publishEvent(OrderPlacedEvent) called on the request thread:
   → listener A runs on THIS thread, blocks ~40ms, returns
   → listener B runs on THIS thread, throws MailException
   → publishEvent does NOT swallow it → re-throws MailException to place()
place() unwinds with MailException:
   → Spring marks the transaction rollback-only → [TX ROLLS BACK]
Net result: order row is NOT persisted; caller sees MailException.
```

Total wall-clock inside `publishEvent` ≈ 40ms (A) + B's time-to-throw — the publisher paid for both listeners serially and lost the whole order because a *notification* listener failed. That coupling — a failed email rolling back a saved order — is exactly why `AFTER_COMMIT` and `@Async` listeners exist: they detach the side-effect from the publisher's thread and transaction.

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

## Scheduled task exception handling

A subtle but critical behavioral difference between **raw `ScheduledExecutorService`** and **Spring's `@Scheduled`** concerns what happens when a periodic task throws.

- **Raw JDK `ScheduledExecutorService.scheduleAtFixedRate(...)`:** if the task throws an uncaught exception, the executor **silently suppresses all future executions of that task** — the schedule dies and there is no error surfaced anywhere. This is a notorious JDK footgun.
- **Spring `@Scheduled`:** Spring wraps every scheduled invocation in a `DelegatingErrorHandlingRunnable` with an `ErrorHandler` from `TaskUtils`. For **repeating** tasks (fixedRate/fixedDelay/cron) the default is `LOG_AND_SUPPRESS_ERROR_HANDLER`: the exception is **logged and swallowed**, and — crucially — **the next execution is still scheduled**. So a throwing `@Scheduled` job keeps running on schedule (it does not die). For **one-shot** tasks the default is `LOG_AND_PROPAGATE_ERROR_HANDLER`.

**Gotcha:** Because the default error handler swallows exceptions, a broken `@Scheduled` job can fail on *every* run and only leave log lines — no metrics, no alerting, no propagation. Senior teams register a custom `ErrorHandler` (via `ScheduledTaskRegistrar`/`SchedulingConfigurer` on the scheduler, or a `ThreadPoolTaskScheduler.setErrorHandler(...)`) to emit metrics or re-raise. Note that suppressing the error is what *keeps the schedule alive* — a handler that re-throws on a fixedRate task backed by a raw `ScheduledExecutorService` would kill future runs, so custom handlers should record-and-return rather than propagate for repeating tasks.

---

## SimpleAsyncTaskScheduler and virtual-thread scheduling

Spring Framework 6.1 (Boot 3.2) added `SimpleAsyncTaskScheduler`, a `TaskScheduler` designed for **JDK 21 virtual threads**. Its model differs fundamentally from `ThreadPoolTaskScheduler`:

- `ThreadPoolTaskScheduler` is backed by a fixed-size `ScheduledThreadPoolExecutor`; the *same* pool threads both time and execute tasks, so pool size caps concurrency and a slow task can delay timing of others.
- `SimpleAsyncTaskScheduler` uses **one scheduling thread** for timing but **fires each task execution onto a brand-new thread** (a virtual thread when `setVirtualThreads(true)`). This means unbounded concurrency of task *bodies*, which is fine for virtual threads but dangerous for platform threads.

**Key restriction:** With `SimpleAsyncTaskScheduler`, **`fixedDelay` tasks still run on the single scheduling thread** (because the next start depends on the previous completion), so a long fixedDelay body blocks the scheduler. Spring therefore recommends **`fixedRate` or `cron`** with the virtual-thread-aligned scheduler; use `fixedDelay` only with pool-based schedulers.

When `spring.threads.virtual.enabled=true`, Boot's auto-configuration switches the scheduling infrastructure toward `SimpleAsyncTaskScheduler` with virtual threads, and the `@Async`/task-execution `Executor` becomes a virtual-thread `SimpleAsyncTaskExecutor` (which no longer pools threads, so `spring.task.execution.pool.*` sizing properties become irrelevant).

---

## Scheduler lifecycle and graceful shutdown

As of Spring 6.1, `ThreadPoolTaskScheduler` participates in Spring's `SmartLifecycle` and offers **pause/resume** plus **graceful shutdown**. On context close Spring **cancels scheduled tasks** (including the next scheduled trigger and any still-running reactive subscription).

Shutdown behavior is governed by:
- `setWaitForTasksToCompleteOnShutdown(true)` — on shutdown, stop accepting new tasks but let in-flight/queued tasks finish (calls `ExecutorService.shutdown()` rather than `shutdownNow()`).
- `setAwaitTerminationSeconds(n)` — block up to `n` seconds for tasks to drain before proceeding; without it, `shutdown()` returns immediately and the JVM may kill running tasks.

**Trap:** With the defaults (`waitForTasksToCompleteOnShutdown=false`, `awaitTerminationSeconds=0`), an in-progress scheduled/async job can be abruptly interrupted at shutdown, leaving work half-done. The same two properties exist on `ThreadPoolTaskExecutor` for `@Async` pools. Boot exposes them as `spring.task.scheduling.shutdown.await-termination` / `...await-termination-period` and `spring.task.execution.shutdown.*`.

---

## Advanced cron expressions and time zones

Spring's `CronExpression` (used by `@Scheduled(cron=...)`) is a rich 6-field parser (second minute hour day-of-month month day-of-week) supporting:

- `?` — "no specific value", used in day-of-month **or** day-of-week when the other field is set (avoids ambiguity).
- `L` — last: `L` in day-of-month = last day of month; `L-3` = third-to-last day; `5L` in day-of-week = last Friday; `THUL` = last Thursday.
- `W` — nearest weekday: `15W` = weekday nearest the 15th; `LW` = last weekday of the month.
- `#` — nth weekday: `5#2` = second Friday; `MON#1` = first Monday.
- Ranges/lists/steps: `MON-FRI`, `1,15`, `0/15` (every 15 units).

**Time-zone / DST gotcha:** `@Scheduled(cron="0 0 2 * * *", zone="Europe/Paris")` fires against the given zone (default: server default zone). Around **DST transitions** cron semantics get tricky: a `2:30` daily job **runs twice** on the fall-back day and is **skipped** on the spring-forward day if 2:30 doesn't exist. `fixedRate`/`fixedDelay` are DST-immune because they count elapsed real time, not wall-clock. Choose cron only when you truly need wall-clock alignment.

---

## Reactive and one-time scheduled tasks

**One-time tasks:** `@Scheduled(initialDelay = 1000)` with **no** `fixedRate`/`fixedDelay`/`cron` schedules the method to run **exactly once**, `initialDelay` ms after startup. Handy for deferred one-shot init without a `CommandLineRunner`.

**Reactive `@Scheduled` (Spring 6.1+):** `@Scheduled` may now annotate methods returning a reactive `Publisher` (or adaptable types like `Mono`/`Flux`, Kotlin suspending functions, `Flow`/`Deferred`). Spring **subscribes** to the returned publisher on each trigger and treats the subscription as the execution — completion of the publisher signals the run finished (important for `fixedDelay`). On context shutdown Spring cancels the active subscription. Note the method must return the publisher **without** subscribing itself; a fire-and-forget `subscribe()` inside a `void` method loses this integration.

---

## Context propagation with TaskDecorator

Thread-bound context — `SecurityContextHolder`, request-scoped beans, MDC/logging context, `TransactionSynchronizationManager`, Micrometer observation/trace context — is stored in `ThreadLocal`s and is **NOT** carried across the thread boundary when work moves to an `@Async` executor, an async event listener, or a scheduled thread. This is the root cause of "why is my SecurityContext null / MDC traceId missing in the async method?"

The clean fix is a **`TaskDecorator`** on the executor, which wraps each submitted `Runnable` to capture context on the *submitting* thread and reinstate it on the *worker* thread:

```java
executor.setTaskDecorator(runnable -> {
    Map<String,String> mdc = MDCContext.getCopyOfContextMap();
    SecurityContext sec = SecurityContextHolder.getContext();
    return () -> {
        MDC.setContextMap(mdc);
        SecurityContextHolder.setContext(sec);
        try { runnable.run(); } finally { MDC.clear(); SecurityContextHolder.clearContext(); }
    };
});
```

Compose multiple decorators with `CompositeTaskDecorator` (runs them in order). Spring Security ships `DelegatingSecurityContextAsyncTaskExecutor`, and Micrometer's `ContextPropagatingTaskDecorator` handles observation context. **Gotcha:** the decorator must reinstate context inside the returned wrapper (worker thread), capturing values *eagerly at decoration time* on the caller thread — reading `ThreadLocal`s lazily inside the wrapper would read the worker thread's (empty) context.

---

## Event error handling and the multicaster

The `SimpleApplicationEventMulticaster` exposes two orthogonal knobs beyond the default synchronous behavior:

- `setTaskExecutor(Executor)` — makes **all** listener dispatch run on that executor (global async).
- `setErrorHandler(ErrorHandler)` — routes any listener exception to the handler **instead of** propagating.

**Interaction gotcha:** By default (no `errorHandler`, no `taskExecutor`) a synchronous listener exception propagates to `publishEvent()` and can roll back the publisher's transaction. But if you set an `ErrorHandler`, exceptions are **caught by it and no longer reach the publisher** — even for synchronous listeners — which silently changes transaction-rollback semantics. Conversely, once a `taskExecutor` is set, exceptions can't propagate to the caller regardless (the caller has already returned), so an `ErrorHandler` is the *only* way to observe async multicaster failures.

---

## Generic events and ResolvableTypeProvider

`@EventListener void on(EntityCreatedEvent<Person> e)` only fires for `Person` if the published event **materializes its generic type**, because of type erasure. Two ways to satisfy this:

1. Publish a concrete subclass that fixes the type: `class PersonCreatedEvent extends EntityCreatedEvent<Person> {}`.
2. Have the generic event implement **`ResolvableTypeProvider`** and return `ResolvableType.forClassWithGenerics(getClass(), ResolvableType.forInstance(getSource()))`, so the multicaster can match the type parameter at runtime even for the raw generic class.

Arbitrary POJO payloads published via `publishEvent(Object)` are wrapped internally in a **`PayloadApplicationEvent<T>`**; interface-style listeners can target them as `ApplicationListener<PayloadApplicationEvent<Person>>`.

**Lazy-bean gotcha:** If a bean carrying `@EventListener` methods is defined `@Lazy` (or otherwise not instantiated), Spring **honors the laziness and never registers the listener**, so events silently go unhandled. Listener beans must be eagerly initialized.

---

## Async event limitations

Making a listener `@Async` (or setting a global multicaster executor) removes several capabilities that work only in the synchronous model:

- **No event chaining by return value:** a synchronous `@EventListener` can return an event (or `Collection`/array) that Spring re-publishes. An **async** listener's return value is *ignored* — to chain, it must inject `ApplicationEventPublisher` and publish manually.
- **No exception propagation:** an async listener's exception goes to the `AsyncUncaughtExceptionHandler` (void) / the future, never to `publishEvent()`. It cannot roll back the publisher's transaction.
- **No thread-bound context:** `ThreadLocal`s, `SecurityContext`, request scope, transaction synchronization, and logging/MDC context are not propagated unless you add a `TaskDecorator`.
- **No ordering across threads:** `@Order` still governs *dispatch* order, but once listeners run on different threads their *completion* order is unspecified.

**Combined trap — `@Async` + `@TransactionalEventListener(AFTER_COMMIT)`:** this is a common and correct pattern (offload post-commit side effects), but the async listener runs on a pool thread with **no transaction and no thread context**, so any DB access needs its own `@Transactional`, and captured user/trace context must be propagated explicitly.

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
13. **Does a throwing `@Scheduled` job stop repeating?** No — Spring's default error handler logs and suppresses, and re-schedules the next run (unlike raw `scheduleAtFixedRate`, which kills the schedule).
14. **Why is my `SecurityContext`/MDC null inside an `@Async` method?** Thread-bound `ThreadLocal`s are not propagated across threads; use a `TaskDecorator`.
15. **Why can't my async event listener publish a follow-up event by returning it?** Return-value chaining is unsupported for async listeners; inject `ApplicationEventPublisher` and publish manually.
16. **When should I avoid `fixedDelay` with the virtual-thread `SimpleAsyncTaskScheduler`?** Always if it blocks — fixedDelay runs on the single scheduling thread; prefer `fixedRate`/`cron`.

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
- Spring Framework Reference — Transaction-bound Events (`@TransactionalEventListener`): https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html
- `CronExpression` javadoc (L, W, #, ? support): https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/support/CronExpression.html
- `TaskDecorator` javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/TaskDecorator.html
- Micrometer Context Propagation: https://docs.micrometer.io/context-propagation/reference/
