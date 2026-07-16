# CompletableFuture and Asynchronous Programming

`CompletableFuture<T>` (introduced in **Java 8**, 2014) is the JDK's primary tool for
composable, non-blocking asynchronous programming. It implements both `Future<T>`
(so you can still `get()` a result) and `CompletionStage<T>` (the interface that
defines the ~50 chaining/combining/exception methods). This document builds from
`Future`'s limitations up through creation, chaining, threading semantics,
exception handling, combinators, blocking pitfalls, and how it compares to
reactive streams and modern virtual threads (final in **JDK 21**).

---

## Future limitations

`java.util.concurrent.Future<T>` arrived in **Java 5** (2004) alongside
`ExecutorService`. It represents a pending result but is deliberately minimal, and
those gaps are exactly what `CompletableFuture` was created to fill.

**Beginner view — what `Future` can do:** submit a `Callable` to an executor, get
back a `Future`, then later call `get()` to retrieve the result (blocking until
ready), `cancel(...)`, `isDone()`, or `isCancelled()`.

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
Future<Integer> f = pool.submit(() -> compute());
Integer result = f.get();   // BLOCKS the calling thread until done
```

**The limitations (why it hurts):**

| Limitation | Consequence |
|---|---|
| No callback / completion notification | You must **block** on `get()` or poll `isDone()` — no "run X when it finishes". |
| Cannot be chained / composed | No way to say "when this completes, start that". You block, then submit the next task manually. |
| Cannot combine multiple futures | No built-in "wait for both A and B and merge results". |
| No exception composition | `get()` throws a checked `ExecutionException` wrapping the cause; you cannot declaratively recover. |
| Cannot be completed manually | The result comes only from the task submitted to the executor. No way to complete it from outside. |
| No timeout on the result itself | Only `get(timeout, unit)` blocks-with-timeout; there is no async "fail after N ms". |

**Advanced note:** `get()` throwing `ExecutionException` (checked) and
`InterruptedException` forces try/catch boilerplate and unwrapping via
`getCause()`. `CompletableFuture.join()` instead throws the *unchecked*
`CompletionException`, which is friendlier inside lambdas/streams. Also, `Future`
gives you no way to *push* a value in — `CompletableFuture` can be completed
imperatively via `complete(v)`, `completeExceptionally(ex)`, or (Java 9)
`completeAsync(...)`, which makes it a great adapter around callback-style APIs.

---

## Creating a CompletableFuture

There are two families: **factory methods** that run work on an executor, and
**manual completion** for adapting non-CF code.

**Factory methods (Java 8):**

```java
// Has a result (Supplier<U>) -> CompletableFuture<U>
CompletableFuture<String> a = CompletableFuture.supplyAsync(() -> "hello");

// No result (Runnable) -> CompletableFuture<Void>
CompletableFuture<Void> b = CompletableFuture.runAsync(() -> log("done"));

// Already-completed future (no async work)
CompletableFuture<String> c = CompletableFuture.completedFuture("cached");
```

- `supplyAsync` takes a `Supplier<U>` and yields a value.
- `runAsync` takes a `Runnable` and yields `CompletableFuture<Void>`.
- Both have an overload accepting an explicit `Executor`. **Without an executor
  argument they run on the common `ForkJoinPool` (`ForkJoinPool.commonPool()`).**

**Manual completion:**

```java
CompletableFuture<String> promise = new CompletableFuture<>();
// ... hand `promise` to some callback-based API ...
promise.complete("value");                 // fulfil it
promise.completeExceptionally(new IOException()); // or fail it
boolean won = promise.complete("late");    // false if already completed
```

**Intermediate — `completedFuture` vs `supplyAsync`:** `completedFuture(x)` never
touches a thread pool; it returns an already-done stage. Useful for tests, caching
hits, and default branches.

**Advanced (Java 9+ additions):**
- `completeAsync(Supplier, [Executor])` — complete a manually created future
  asynchronously.
- `orTimeout(long, TimeUnit)` — complete **exceptionally** with `TimeoutException`
  if not done in time.
- `completeOnTimeout(T, long, TimeUnit)` — complete with a **fallback value** on
  timeout.
- `delayedExecutor(long, TimeUnit)` — an `Executor` that runs tasks after a delay.
- `newIncompleteFuture()` — overridable factory used internally so subclasses
  propagate their own type through the chain (the "minimal" future / defensive
  copying design).

**Gotcha:** any exception thrown inside the `Supplier` passed to `supplyAsync`
does **not** propagate to the caller of `supplyAsync` — it completes the returned
future exceptionally and only surfaces when you `join()`/`get()` or via an
exception-handling stage.

---

## thenApply vs thenCompose vs thenCombine

These are the three most-confused transformation methods. The distinction is about
the **shape of the function** you pass and how many stages are involved.

| Method | Function type | Returns | Analogy (streams/Optional) |
|---|---|---|---|
| `thenApply` | `Function<T,U>` | `CompletableFuture<U>` | `map` |
| `thenCompose` | `Function<T, CompletionStage<U>>` | `CompletableFuture<U>` | `flatMap` |
| `thenCombine` | `(T, U) -> V` + another stage | `CompletableFuture<V>` | zip two |
| `thenAccept` | `Consumer<T>` | `CompletableFuture<Void>` | forEach |
| `thenRun` | `Runnable` | `CompletableFuture<Void>` | (ignores value) |

**`thenApply` (map):** transform the value with a plain function.

```java
CompletableFuture<Integer> len =
    CompletableFuture.supplyAsync(() -> "hello")
                     .thenApply(String::length);   // CF<Integer>
```

**`thenCompose` (flatMap):** use when your function *itself* returns a
`CompletableFuture` — it flattens `CF<CF<U>>` into `CF<U>`. Essential for
sequencing dependent async calls.

```java
CompletableFuture<User> lookup =
    fetchUserId(name)                         // CF<Long>
        .thenCompose(id -> fetchUserById(id)); // fetchUserById returns CF<User>
// thenApply here would give CF<CompletableFuture<User>> — nested, wrong.
```

**`thenCombine` (zip):** run two *independent* futures and merge their results once
both complete.

```java
CompletableFuture<Double> price = fetchPrice();
CompletableFuture<Double> tax   = fetchTax();
CompletableFuture<Double> total =
    price.thenCombine(tax, (p, t) -> p + t);
```

**Advanced gotcha:** `thenCombine` runs the two source futures concurrently and
*combines* results; `thenCompose` is strictly *sequential* (the second future's
work starts only after the first completes and its value is available). Choosing
`thenApply` when the lambda returns a future is the classic bug that yields a
`CompletableFuture<CompletableFuture<X>>`.

---

## Async vs non-async variants and callback threads

Almost every `CompletionStage` method has three forms. Understanding **which thread
runs your callback** is a top interview topic.

```
thenApply(fn)                 // non-async
thenApplyAsync(fn)            // async, common ForkJoinPool
thenApplyAsync(fn, executor)  // async, your executor
```

**Threading rules:**

- **Non-async (`thenApply`)**: the callback runs on **whatever thread completed the
  previous stage** — *or* on the calling thread if the previous stage was
  **already complete** when you attach the callback. It is intentionally
  unspecified/opportunistic. Do not assume it runs on a pool thread.
- **`...Async` without executor**: runs on the **common ForkJoinPool**.
- **`...Async` with executor**: runs on **your** executor.

```java
CompletableFuture.supplyAsync(() -> load())      // pool thread A
    .thenApply(x -> x + 1)      // MAY run on thread A, or caller if already done
    .thenApplyAsync(x -> x * 2) // common ForkJoinPool thread (maybe A, maybe other)
    .thenApplyAsync(x -> x - 3, myExecutor); // myExecutor thread
```

**Intermediate gotcha — the "hijacked thread":** with non-async chaining, a fast
callback can end up running on the thread that *completed* the upstream stage
(e.g., a Netty I/O thread or a thread that called `complete()`). If that callback
does blocking work, you can starve that thread. Use `...Async` with a dedicated
executor to control this.

**Advanced — already-completed edge case:** `CompletableFuture.completedFuture(x)
.thenApply(f)` executes `f` **synchronously on the current thread** because the
stage is already done. This surprises people who assume callbacks are always
deferred.

---

## Common ForkJoinPool vs a custom executor

**This is the single most important production gotcha.** By default, all the
`...Async` methods (and `supplyAsync`/`runAsync` without an executor) submit to
`ForkJoinPool.commonPool()`.

**Why it matters:**

- The common pool is sized to **`Runtime.getRuntime().availableProcessors() - 1`**
  threads by default (so on an 8-core box, ~7 workers). It is a **shared,
  JVM-wide** resource also used by parallel streams.
- It is designed for **CPU-bound, non-blocking** compute. If you run **blocking
  I/O** (JDBC, HTTP, file) on it, you exhaust the tiny worker set and stall
  everything else that relies on it, including parallel streams elsewhere in the
  app.
- If `availableProcessors()` returns 1 (small containers!), the common pool has
  parallelism 1 — effectively serial, and blocking tasks can deadlock chains.

**Best practice:** for any blocking work, pass a **dedicated, right-sized
`Executor`**:

```java
ExecutorService io = Executors.newFixedThreadPool(50); // sized for blocking I/O
CompletableFuture.supplyAsync(() -> jdbcCall(), io)
                 .thenApplyAsync(this::transform, io);
```

**Advanced notes:**
- Common pool parallelism can be tuned via the system property
  `java.util.concurrent.ForkJoinPool.common.parallelism`, but changing a global
  is fragile — prefer explicit executors.
- Threads spawned by the common pool are **daemon** threads; they will not keep the
  JVM alive, so a `main` that finishes before an async task can exit before the
  task runs. (`newFixedThreadPool` uses non-daemon threads by default, which *can*
  prevent JVM shutdown if not shut down.)
- With **virtual threads (JDK 21)**, `Executors.newVirtualThreadPerTaskExecutor()`
  is a great executor to hand to `CompletableFuture` for blocking work, since
  blocking a virtual thread is cheap.

---

## Exception handling with exceptionally, handle, and whenComplete

Three methods deal with failures; they differ in *what they receive* and *whether
they can change the result*.

| Method | Receives | Can recover / transform? | Runs on success? | Result type |
|---|---|---|---|---|
| `exceptionally(fn)` | `Throwable` only | Yes — supplies fallback value | No (only on failure) | `CompletableFuture<T>` |
| `handle(bifn)` | `(T value, Throwable ex)` | Yes — returns a new value | **Yes (always)** | `CompletableFuture<U>` |
| `whenComplete(bicons)` | `(T value, Throwable ex)` | **No** — side-effect only, original result passes through | **Yes (always)** | `CompletableFuture<T>` |

```java
// exceptionally: recover with a default, only fires on error
cf.exceptionally(ex -> "fallback");

// handle: always runs, can turn error into value or vice versa
cf.handle((val, ex) -> ex != null ? "err:" + ex.getMessage() : val.toUpperCase());

// whenComplete: observe result/error (logging), does NOT swallow the exception
cf.whenComplete((val, ex) -> { if (ex != null) log.error("failed", ex); });
```

**Key advanced points:**
- The `Throwable` passed to these callbacks is usually a **`CompletionException`**
  wrapping the real cause — call `ex.getCause()` to inspect the underlying
  exception. (When the stage was completed via `completeExceptionally(e)`,
  behavior around wrapping is subtle: methods generally wrap in
  `CompletionException` when propagating.)
- **`whenComplete` does NOT handle/consume the exception** — the returned stage
  still completes exceptionally. If the *action itself* throws, that new exception
  is added (the original is preferred/kept as primary in most cases). Use it for
  logging/cleanup, not recovery.
- **`handle`** runs on both paths and can *introduce* an exception path even after
  success. It is the most general.
- Java 12 added `exceptionallyAsync`, `exceptionallyCompose`, and
  `exceptionallyComposeAsync` for async recovery and recovering with another
  future. (The base `exceptionally` was Java 8.)
- Exceptions **short-circuit** the chain: once a stage fails, downstream
  `thenApply`/`thenCompose`/`thenAccept` stages are **skipped** (they complete
  exceptionally with the same cause) until an exception handler intervenes.

```java
supplyAsync(() -> { throw new RuntimeException("boom"); })
    .thenApply(x -> x + "!")          // SKIPPED
    .exceptionally(ex -> "recovered") // catches CompletionException(boom)
    .thenApply(s -> s.toUpperCase()); // runs -> "RECOVERED"
```

---

## Combining futures with allOf and anyOf

**`allOf(cf1, cf2, ...)`** returns `CompletableFuture<Void>` that completes when
**all** given futures complete. It does **not** aggregate results — you gather them
yourself after joining.

```java
CompletableFuture<String> a = fetchA();
CompletableFuture<String> b = fetchB();
CompletableFuture<Void> all = CompletableFuture.allOf(a, b);
CompletableFuture<List<String>> results =
    all.thenApply(v -> List.of(a.join(), b.join())); // join() is safe: already done
```

**`anyOf(cf1, cf2, ...)`** returns `CompletableFuture<Object>` that completes when
the **first** of them completes (with that future's value). Note the erased
`Object` result type — you often cast.

```java
CompletableFuture<Object> fastest =
    CompletableFuture.anyOf(mirror1(), mirror2(), mirror3());
```

**Advanced / gotchas:**
- **`allOf` and failure:** if any input future fails, the `allOf` future completes
  exceptionally. But the *other* futures keep running (they are not cancelled). If
  you call `a.join()` on a failed `a` you get the exception.
- **`anyOf` and failure:** if the *first to complete* completes exceptionally, the
  `anyOf` future completes exceptionally — even if slower futures would have
  succeeded. So `anyOf` is "first to settle", not "first to succeed".
- To implement **first-successful**, you typically use
  `exceptionally`/`handle` on each and a custom combinator, or wrap so failures
  are ignored until success.
- `allOf(...).join()` blocks; prefer chaining `thenApply`/`thenAccept` off the
  `allOf` result to stay non-blocking.

---

## Composing async pipelines

Real systems chain many stages into a pipeline. Good patterns:

```java
CompletableFuture<Response> pipeline =
    CompletableFuture.supplyAsync(() -> validate(req), pool)
        .thenCompose(v -> loadUserAsync(v))        // dependent async call
        .thenCombine(loadConfigAsync(), (user, cfg) -> enrich(user, cfg))
        .thenApply(this::toResponse)
        .orTimeout(2, TimeUnit.SECONDS)            // Java 9
        .exceptionally(ex -> Response.error(ex));  // single funnel for all errors
```

**Principles:**
- Use `thenCompose` for **dependent** sequential calls, `thenCombine`/`allOf` for
  **independent parallel** calls that fan-in.
- Put **one exception funnel** (`exceptionally`/`handle`) near the end rather than
  scattering try/catch.
- Keep blocking work on a **dedicated executor**; keep CPU-light transforms in
  non-async stages.
- **Cancellation caveat:** `CompletableFuture.cancel(true)` does **not** interrupt
  the running thread the way `FutureTask` does — the `mayInterruptIfRunning` flag
  is effectively ignored; it just completes the future exceptionally with
  `CancellationException`. The underlying computation keeps running. This surprises
  people migrating from `Future`.

---

## Blocking pitfalls with join and get

`get()` and `join()` both **block** the calling thread until the future completes.

| | Checked exceptions | Wrapping |
|---|---|---|
| `get()` | throws `InterruptedException`, `ExecutionException` (checked) | cause wrapped in `ExecutionException` |
| `join()` | unchecked only | cause wrapped in `CompletionException` |
| `get(timeout, unit)` | adds `TimeoutException` | — |
| `getNow(valueIfAbsent)` | non-blocking; returns fallback if not done | — |

**Pitfalls:**
- **Blocking defeats the purpose.** Calling `join()` in the middle of a pipeline
  (e.g., inside a `thenApply`) turns async back into sync and can **deadlock** if
  it blocks a pool thread that the awaited future needs to complete.
- **Common-pool deadlock:** blocking (`join`) on a common-pool thread while the
  task you wait on also needs the common pool can starve/deadlock when parallelism
  is low.
- Prefer composing (`thenCompose`/`thenAccept`) over `join()`; only block at the
  true edge of the application (e.g., a `main` method or a servlet boundary that
  must return a value).
- `getNow(fallback)` is handy for "give me the value if it's ready, else a
  default" without blocking.

---

## Comparison to reactive streams

`CompletableFuture` models a **single** future value (or void). **Reactive
Streams** (the `org.reactivestreams` spec; Project Reactor `Mono`/`Flux`, RxJava
`Observable`/`Flowable`; JDK's `java.util.concurrent.Flow` API since **Java 9**)
model **streams of 0..N values** with **backpressure**.

| Aspect | CompletableFuture | Reactive (Reactor/RxJava/Flow) |
|---|---|---|
| Cardinality | exactly one value (or void) | 0..N values over time |
| Backpressure | none | yes (core feature) |
| Laziness | eager — starts on creation | lazy — nothing runs until `subscribe()` |
| Operators | ~50 methods | hundreds (map, filter, retry, window, ...) |
| Reusability | one-shot | publishers can be re-subscribed |
| JDK built-in | yes (Java 8) | only the `Flow` interfaces (Java 9), no impl |

**Key mental model:** `CompletableFuture` is **eager** — the async work begins the
moment you call `supplyAsync`. A Reactor `Mono` is **lazy/cold** — defining the
pipeline does nothing until a subscriber arrives. This is a favorite interview
distinction.

Use `CompletableFuture` for one-shot async calls and simple fan-out/fan-in; reach
for reactive when you need streaming, backpressure, or rich operators.

---

## Comparison to virtual threads

**Virtual threads (Project Loom)** were a **preview in JDK 19 and 20** and became a
**final/permanent feature in JDK 21** (JEP 444). They change the calculus of async
programming dramatically.

**The problem CF solved (the OLD way):** platform threads are expensive (~1 MB
stacks, OS-scheduled), so you cannot have one blocking thread per request at scale.
`CompletableFuture` lets a small pool stay busy by **never blocking** — you chain
callbacks instead. The cost is **inverted, hard-to-read code**: business logic is
fragmented across `thenApply`/`thenCompose` lambdas, stack traces are unhelpful,
and debugging is painful ("callback hell").

**The NEW way (virtual threads):** a virtual thread is a lightweight,
JVM-scheduled thread mounted onto a small pool of carrier (platform) threads. You
can create **millions**. When a virtual thread blocks on I/O, it **unmounts** from
its carrier, freeing it for other work — so **simple, blocking, sequential code**
scales like async code.

```java
// OLD: non-blocking chains
fetchUserId(name).thenCompose(this::fetchUser).thenApply(this::render);

// NEW (JDK 21): plain blocking, sequential, readable — and still scalable
try (var exec = Executors.newVirtualThreadPerTaskExecutor()) {
    exec.submit(() -> {
        long id = fetchUserId(name);   // blocks the *virtual* thread cheaply
        User u = fetchUser(id);
        return render(u);
    });
}
```

**Nuances / interview points:**
- Virtual threads don't make `CompletableFuture` obsolete — CF still shines for
  **combining** independent async results (`allOf`, `thenCombine`) and adapting
  callback APIs. You can even run CF's async stages on a virtual-thread executor.
- **Pinning:** a virtual thread that blocks inside a `synchronized` block (in early
  releases) or a native/JNI call can **pin** its carrier, hurting scalability. JDK
  24 (JEP 491) largely removed the `synchronized` pinning problem; before that,
  prefer `ReentrantLock`.
- **Structured concurrency** (`StructuredTaskScope`) — a companion API for treating
  a group of subtasks as a unit — was still in **preview/incubating in JDK 21**
  (not final). Do not claim it was finalized in 21.
- Virtual threads are **not faster for CPU-bound work**; their win is **massive
  concurrency of blocking tasks**.

---

## Common interview follow-up questions

1. Why was `CompletableFuture` introduced when `Future` already existed? Name three
   concrete limitations of `Future`.
2. What is the difference between `thenApply`, `thenCompose`, and `thenCombine`?
   Which is `map` and which is `flatMap`?
3. Which thread runs a `thenApply` callback vs a `thenApplyAsync` callback? What
   happens if the upstream future is already complete?
4. Why is running blocking I/O on the default `CompletableFuture` executor
   dangerous? What is that default and how is it sized?
5. Compare `exceptionally`, `handle`, and `whenComplete`. Which can recover, which
   is side-effect only, and does `whenComplete` swallow the exception?
6. What does `CompletableFuture.cancel(true)` actually do to the running task?
7. What does `allOf` return, and how do you collect the results? What happens if one
   input fails? How does `anyOf` behave on failure?
8. `get()` vs `join()` — difference in exception handling? When can blocking on a
   common-pool thread deadlock?
9. How do virtual threads (JDK 21) change when you would reach for
   `CompletableFuture`? Is structured concurrency final in 21?
10. `CompletableFuture` vs reactive `Mono` — eager vs lazy, single vs stream,
    backpressure?

---

## References

- **JSR 166 / `java.util.concurrent`** — `Future` (Java 5), `CompletableFuture`
  (Java 8) Javadoc: `CompletableFuture` and `CompletionStage`.
- **JEP 266: More Concurrency Updates** (Java 9) — added `orTimeout`,
  `completeOnTimeout`, `completeAsync`, `delayedExecutor`, and the `Flow`
  (Reactive Streams) API. The `exceptionallyAsync`/`exceptionallyCompose`/
  `exceptionallyComposeAsync` methods came later, in **Java 12**.
- **JEP 425: Virtual Threads (Preview)** — JDK 19.
- **JEP 436: Virtual Threads (Second Preview)** — JDK 20.
- **JEP 444: Virtual Threads** — final in **JDK 21** (2023).
- **JEP 453: Structured Concurrency (Preview)** — JDK 21 (still preview).
- **JEP 491: Synchronize Virtual Threads without Pinning** — JDK 24.
- **Reactive Streams specification** (`org.reactivestreams`); Project Reactor and
  RxJava documentation for `Mono`/`Flux`/`Observable`.
- Oracle Java Tutorials and the official `ForkJoinPool.commonPool()` Javadoc for
  common-pool sizing semantics.
