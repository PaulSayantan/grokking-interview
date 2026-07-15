# Executor Framework and java.util.concurrent

The `java.util.concurrent` (JUC) package, introduced in **Java 5 (2004)** under JSR-166 and led by Doug Lea, gave the JVM a high-level toolkit for concurrent programming: thread pools, futures, concurrent collections, locks, and synchronizers. Before it, you wrote `new Thread(runnable).start()`, hand-rolled pools, and coordinated everything with `synchronized`, `wait()`, and `notify()` — verbose and error-prone. The Executor framework decouples **task submission** from **task execution** (thread management, scheduling, queueing), which is the single most important idea in this whole topic.

This guide layers each subtopic: a beginner definition and motivation, intermediate usage and comparisons, then advanced internals, edge cases, and gotchas that interviewers probe.

---

## Executor, ExecutorService, and ThreadPoolExecutor

**Beginner — what and why.** `Executor` is a tiny interface with one method: `void execute(Runnable command)`. It abstracts *how* a task runs (new thread? pooled thread? caller's thread?) from *what* the task is. `ExecutorService` extends it with lifecycle management (`shutdown()`, `awaitTermination()`) and submission methods that return a `Future` (`submit`, `invokeAll`, `invokeAny`). `ThreadPoolExecutor` is the workhorse concrete implementation.

**Intermediate — the ThreadPoolExecutor constructor.** Every tuning decision lives in these seven parameters:

```java
new ThreadPoolExecutor(
    int corePoolSize,           // threads kept alive even when idle
    int maximumPoolSize,        // hard ceiling on threads
    long keepAliveTime,         // idle timeout for threads above core
    TimeUnit unit,
    BlockingQueue<Runnable> workQueue,   // holds tasks awaiting a thread
    ThreadFactory threadFactory,          // names threads, sets daemon/priority
    RejectedExecutionHandler handler);    // what to do when saturated
```

**The task-admission algorithm (critical and counter-intuitive):**

1. If threads running `< corePoolSize`, start a **new core thread** for the task (even if other threads are idle).
2. Else, try to **enqueue** the task on `workQueue`.
3. Only if the queue is **full** does the pool create threads beyond core, up to `maximumPoolSize`.
4. If the queue is full **and** the pool is at `maximumPoolSize`, the task is **rejected** via the `RejectedExecutionHandler`.

The gotcha: with an **unbounded queue** (e.g., `LinkedBlockingQueue` with default capacity `Integer.MAX_VALUE`), step 2 always succeeds, so `maximumPoolSize` is **never reached** and is effectively ignored. That is why `newFixedThreadPool` core == max.

**Rejection policies** (`RejectedExecutionHandler`), all nested in `ThreadPoolExecutor`:

| Policy | Behavior |
|---|---|
| `AbortPolicy` (default) | Throws `RejectedExecutionException`. |
| `CallerRunsPolicy` | Runs the task on the **calling thread** — provides natural back-pressure by slowing the submitter. |
| `DiscardPolicy` | Silently drops the new task. |
| `DiscardOldestPolicy` | Drops the oldest queued task, then retries `execute`. |

**Advanced — internals and gotchas.**
- **`execute` vs `submit`**: `execute` takes a `Runnable` and returns void; an uncaught exception propagates to the thread's `UncaughtExceptionHandler`. `submit` wraps the task in a `FutureTask` and returns a `Future`; **an exception thrown by the task is captured and only re-thrown when you call `future.get()`**. A very common bug is `submit`-ing tasks and never calling `get()`, so exceptions vanish silently.
- **`shutdown()` vs `shutdownNow()`**: `shutdown()` is a graceful drain — no new tasks accepted, already-submitted tasks still run. `shutdownNow()` attempts to stop active tasks (interrupts worker threads) and returns the `List<Runnable>` of never-started tasks. Neither blocks; you must call `awaitTermination(timeout, unit)` to wait.
- **`prestartAllCoreThreads()`** warms the pool. **`allowCoreThreadTimeOut(true)`** lets core threads die when idle.
- Sizing: CPU-bound work ≈ `N_cpu + 1` threads; IO-bound work needs more, roughly `N_cpu * (1 + waitTime/computeTime)`.

---

## Executors Factory Methods and Their Pitfalls

**Beginner.** The `Executors` utility class provides one-liner factories so you rarely touch the raw constructor. Convenient, but several have footguns that cause production outages.

**Intermediate — the factories:**

```java
Executors.newFixedThreadPool(n);   // core=max=n, LinkedBlockingQueue (UNBOUNDED)
Executors.newSingleThreadExecutor(); // 1 thread, UNBOUNDED queue, sequential
Executors.newCachedThreadPool();   // core=0, max=Integer.MAX_VALUE, SynchronousQueue, 60s idle
Executors.newScheduledThreadPool(n);
Executors.newWorkStealingPool();   // Java 8: ForkJoinPool with parallelism = availableProcessors
Executors.newVirtualThreadPerTaskExecutor(); // Java 21: one virtual thread per task
```

**Advanced — the pitfalls (this is the classic interview trap):**

- **`newFixedThreadPool` / `newSingleThreadExecutor` use an unbounded `LinkedBlockingQueue`.** Under load, tasks pile up without bound → memory pressure and eventually `OutOfMemoryError`. There is no back-pressure and the rejection handler never fires.
- **`newCachedThreadPool` has `maximumPoolSize = Integer.MAX_VALUE`.** Because it uses a `SynchronousQueue` (zero capacity — every insert must be immediately matched by a take), a burst of tasks with no free thread spawns a new thread each time. A flood can create thousands of threads → `OutOfMemoryError: unable to create native thread`.
- **Best practice:** for production, construct `ThreadPoolExecutor` directly with a **bounded** queue (e.g., `new ArrayBlockingQueue<>(capacity)`), an explicit `maximumPoolSize`, a named `ThreadFactory`, and a deliberate rejection policy (often `CallerRunsPolicy` for back-pressure). Google's Guava and many style guides forbid the `Executors` factories for this reason.

`newVirtualThreadPerTaskExecutor()` (**final in JDK 21**) is the modern exception: it is *supposed* to create an unbounded number of (cheap) virtual threads, so the "too many threads" concern does not apply the same way — see the virtual threads section.

---

## Future and CompletableFuture

**Beginner — Future.** A `Future<V>` (Java 5) is a handle to a result that may not exist yet. `future.get()` blocks until the task completes; `get(timeout, unit)` blocks with a deadline; `isDone()`, `cancel(mayInterruptIfRunning)` round it out. The limitation: `Future` is **passive** — you can only poll or block. You cannot chain "when this finishes, do that," combine multiple futures, or react to completion without blocking a thread.

**Intermediate — CompletableFuture (Java 8).** `CompletableFuture<T>` implements both `Future<T>` and `CompletionStage<T>`, adding a fluent, non-blocking, composable API:

```java
CompletableFuture.supplyAsync(() -> fetchUser(id))          // run async, produce value
    .thenApply(user -> user.getName())                       // transform (sync stage)
    .thenCompose(name -> lookupAddressAsync(name))           // flat-map another future
    .thenCombine(loadSettingsAsync(), (addr, s) -> merge(addr, s)) // combine two
    .exceptionally(ex -> "fallback")                          // recover from failure
    .thenAccept(System.out::println);                        // consume, no result
```

Key method families:

| Method | Purpose |
|---|---|
| `thenApply` / `thenApplyAsync` | Transform result `T -> U`. |
| `thenAccept` / `thenRun` | Consume result / run action, no return. |
| `thenCompose` | Flat-map — chain a dependent `CompletableFuture` (avoids nested futures). |
| `thenCombine` | Combine **two independent** futures into one result. |
| `allOf` / `anyOf` | Wait for all / first of many; `allOf` returns `CompletableFuture<Void>`. |
| `exceptionally` | Recover from an exception, returning a fallback value. |
| `handle` | Process `(result, throwable)` — runs on both success and failure. |
| `whenComplete` | Side-effect observer of `(result, throwable)`; does **not** transform. |

**Advanced — internals and gotchas.**
- **The `Async` suffix and which thread runs the stage.** Non-`Async` variants (`thenApply`) run in the thread that completed the previous stage (or the caller if already complete). `...Async` without an executor uses the **common ForkJoinPool** (`ForkJoinPool.commonPool()`). `...Async(fn, executor)` uses your executor. Relying on the common pool for **blocking IO** is dangerous — it has few threads (`cores - 1`) and starving it stalls parallel streams and other CFs. **Always pass a dedicated executor for blocking work.**
- **`exceptionally` vs `handle` vs `whenComplete`:** `exceptionally` only fires on failure and lets you substitute a value. `handle` always fires and can transform result or error. `whenComplete` always fires but returns the **original** outcome (it observes, it does not repair) — if the action itself throws, that new exception is added.
- **Exception wrapping:** `join()` throws an unchecked `CompletionException` wrapping the cause; `get()` throws a checked `ExecutionException`. `join()` avoids checked-exception boilerplate in lambdas.
- **Cancellation is weak:** `CompletableFuture.cancel(true)` completes it exceptionally with `CancellationException` but the `mayInterruptIfRunning` flag has **no effect** — the running `supplyAsync` task is not actually interrupted (unlike `FutureTask`).
- **`orTimeout(t, unit)`** and **`completeOnTimeout(v, t, unit)`** were added in **Java 9** for deadline handling.

---

## ScheduledExecutorService

**Beginner.** `ScheduledExecutorService` (Java 5) runs tasks after a delay or periodically — the concurrent, pooled replacement for the legacy `java.util.Timer`/`TimerTask`.

**Intermediate — methods:**

```java
ScheduledExecutorService s = Executors.newScheduledThreadPool(4);
s.schedule(task, 5, TimeUnit.SECONDS);                       // one-shot after delay
s.scheduleAtFixedRate(task, 0, 1, TimeUnit.SECONDS);         // period measured start-to-start
s.scheduleWithFixedDelay(task, 0, 1, TimeUnit.SECONDS);      // delay measured end-to-start
```

**`scheduleAtFixedRate` vs `scheduleWithFixedDelay` (a favorite interview question):**
- **Fixed rate:** the next execution is scheduled at `initialDelay + n*period` regardless of how long the task takes. If a run overruns the period, subsequent runs happen back-to-back (they do **not** run concurrently — they queue), so the task can "fall behind."
- **Fixed delay:** the next run starts `delay` time units **after the previous one finished**. The gap between runs is constant regardless of task duration.

**Advanced — gotchas.**
- **`Timer` vs `ScheduledExecutorService`:** `Timer` uses a single thread, so one long/blocking task delays all others; an **uncaught exception in a `TimerTask` kills the Timer thread** and cancels all future tasks silently. `ScheduledThreadPoolExecutor` uses a pool and isolates failures better.
- **Silent death of periodic tasks:** if a task submitted via `scheduleAtFixedRate`/`WithFixedDelay` throws an **uncaught exception, the task is suppressed and never runs again** — but the pool keeps living. Always wrap periodic task bodies in try/catch, or inspect the returned `ScheduledFuture` (whose `get()` will surface the exception).
- Internally backed by `ScheduledThreadPoolExecutor` using a `DelayQueue` (an unbounded priority queue ordered by execution time), so `maximumPoolSize` is effectively ignored — only `corePoolSize` matters.

---

## Fork Join Framework and Work Stealing

**Beginner.** The Fork/Join framework (**Java 7**) targets **divide-and-conquer** parallelism: recursively split a task into subtasks, run them in parallel, and join their results. `ForkJoinPool` executes `ForkJoinTask`s, usually written as `RecursiveTask<V>` (returns a value) or `RecursiveAction` (no result).

```java
class SumTask extends RecursiveTask<Long> {
    final long[] arr; final int lo, hi;
    protected Long compute() {
        if (hi - lo <= THRESHOLD) {               // base case: compute directly
            long s = 0; for (int i = lo; i < hi; i++) s += arr[i]; return s;
        }
        int mid = (lo + hi) >>> 1;
        SumTask left = new SumTask(arr, lo, mid);
        left.fork();                               // schedule left asynchronously
        SumTask right = new SumTask(arr, mid, hi);
        long r = right.compute();                  // compute right in THIS thread
        return left.join() + r;                    // wait for left, combine
    }
}
```

**Intermediate — work stealing.** Each worker thread owns a **double-ended queue (deque)** of tasks. A worker pushes/pops its own subtasks from the **head** (LIFO — good cache locality, newest task is hottest). When a worker runs out of work, it **steals** from the **tail** of another worker's deque (FIFO — steals the oldest, largest task, minimizing contention). This keeps all cores busy without a central bottleneck and self-balances uneven workloads.

**Advanced — gotchas and idioms.**
- **The common pool:** `ForkJoinPool.commonPool()` (Java 8) backs parallel streams and `CompletableFuture` async methods. Default parallelism is `Runtime.getRuntime().availableProcessors() - 1`. **Never run blocking IO on it** — you starve every parallel stream in the JVM. For blocking sections inside FJP, implement `ForkJoinPool.ManagedBlocker` so the pool can spawn a compensation thread.
- **Correct fork/join ordering:** `fork()` the first half, `compute()` the second half in the current thread, then `join()`. Forking both and immediately joining the first is fine, but pattern `a.fork(); b.fork(); a.join(); b.join()` is acceptable while `a.fork(); a.join(); b.fork(); b.join()` serializes and defeats the purpose.
- **Threshold tuning:** too small → overhead of task creation dominates; too large → poor parallelism. Aim for enough subtasks to keep cores busy (typically 10x+ core count).
- `Executors.newWorkStealingPool()` (Java 8) is a factory over `ForkJoinPool` with async mode (FIFO) suited to event-style tasks rather than recursive joins.

---

## Concurrent Collections

**Beginner.** JUC provides thread-safe collections that scale far better than the legacy `Collections.synchronizedXxx` wrappers (which lock the whole collection on every operation) and the ancient `Hashtable`/`Vector`.

**ConcurrentHashMap (CHM).**
- **Reads are lock-free**; writes lock only a small portion. In **Java 7** it used lock striping with `Segment`s (default 16). **Since Java 8** it abandoned segments for a `synchronized` block on the **first node of each bin** plus CAS for empty bins, and it converts a long bin to a **red-black tree** when it exceeds 8 entries (treeification) for O(log n) worst case.
- `null` keys and values are **forbidden** (unlike `HashMap`) — ambiguity between "absent" and "mapped to null" in concurrent `get`.
- Atomic compound ops: `putIfAbsent`, `computeIfAbsent`, `compute`, `merge`. Bulk parallel ops `forEach`, `search`, `reduce` (Java 8).
- **Weakly consistent iterators**: never throw `ConcurrentModificationException`; reflect some but not necessarily all updates since creation. `size()` is an estimate.
- **Gotcha:** `computeIfAbsent`'s mapping function runs while holding the bin lock, so recursively updating the *same* map inside it can deadlock/throw (`IllegalStateException` "Recursive update" is detected in newer JDKs).

**CopyOnWriteArrayList / CopyOnWriteArraySet.**
- Every mutation copies the entire backing array. Reads are lock-free and never block. **Ideal when reads vastly outnumber writes** (e.g., listener lists). Iterators operate on an immutable snapshot — no `ConcurrentModificationException`, but they do not see later writes and do not support `remove`/`set`/`add`.

**BlockingQueue family.**

| Implementation | Notes |
|---|---|
| `ArrayBlockingQueue` | Bounded, array-backed, single lock, optional fairness. |
| `LinkedBlockingQueue` | Optionally bounded (default `Integer.MAX_VALUE`); separate put/take locks → higher throughput. |
| `SynchronousQueue` | Zero capacity; each `put` waits for a `take`. Used by `newCachedThreadPool`. |
| `PriorityBlockingQueue` | Unbounded, ordered by comparator; no blocking on `put`. |
| `DelayQueue` | Elements available only after their delay expires; backs scheduled pools. |
| `LinkedTransferQueue` | Java 7; `transfer()` blocks until a consumer takes the element. |

`put`/`take` block; `offer`/`poll` are non-blocking or timed; `add`/`remove` throw on capacity/empty. `BlockingQueue` is the backbone of the producer-consumer pattern.

**Advanced — memory visibility.** All JUC collections establish **happens-before**: actions in a thread prior to placing an object into a concurrent collection happen-before actions subsequent to accessing/removing it in another thread. `ConcurrentSkipListMap`/`Set` provide concurrent **sorted** navigable structures (lock-free skip lists).

---

## Locks: ReentrantLock, ReadWriteLock, and StampedLock

**Beginner.** `synchronized` is simple but limited: you cannot try-and-give-up, interrupt a waiter, time out, or use fairness. The `java.util.concurrent.locks` package (Java 5) provides explicit `Lock` objects with those capabilities.

**ReentrantLock.** A mutual-exclusion lock with the same reentrant semantics as `synchronized`, plus:
- `lock()`, `unlock()` (**always in a `finally`**), `tryLock()` / `tryLock(timeout, unit)` (non-blocking / timed), `lockInterruptibly()`.
- Optional **fairness**: `new ReentrantLock(true)` grants the lock in FIFO order (avoids starvation, lower throughput). Default is unfair (barging allowed).
- Explicit `Condition` objects via `newCondition()` — multiple wait-sets per lock (e.g., `notFull` and `notEmpty`), replacing the single `wait`/`notify` set of an intrinsic lock. Use `await`/`signal`/`signalAll`.

```java
Lock lock = new ReentrantLock();
lock.lock();
try { /* critical section */ }
finally { lock.unlock(); }   // MUST unlock in finally
```

**ReentrantReadWriteLock.** A pair of locks: many concurrent **readers** OR one exclusive **writer**. Great for read-heavy data. Supports **lock downgrading** (acquire write, then acquire read, then release write) but **not upgrading** (read→write deadlocks). Readers block writers, so under heavy read load writers can starve (unless fair mode).

**StampedLock (Java 8).** A non-reentrant lock offering three modes and returning a `long` **stamp** for release/validation:
- **Write lock** (`writeLock()`), **pessimistic read lock** (`readLock()`), and crucially **optimistic read** (`tryOptimisticRead()`).
- Optimistic read acquires **no lock**: you read fields, then call `lock.validate(stamp)`. If a writer intervened, validate returns false and you fall back to a pessimistic read. This gives near-zero read overhead when writes are rare.

```java
long stamp = sl.tryOptimisticRead();
double curX = x, curY = y;            // read fields
if (!sl.validate(stamp)) {            // a write happened — retry pessimistically
    stamp = sl.readLock();
    try { curX = x; curY = y; } finally { sl.unlockRead(stamp); }
}
```

**Advanced — gotchas.**
- `StampedLock` is **not reentrant** — re-acquiring in the same thread deadlocks. It does **not** support `Condition`. It is **not** a fair lock.
- `StampedLock` supports lock conversion (`tryConvertToWriteLock`).
- Prefer `synchronized` for simple cases (it's optimized, biased-locking-free since JDK 15, and auto-releases); reach for explicit locks only when you need their extra features.

---

## Synchronizers: CountDownLatch, CyclicBarrier, Semaphore, and Phaser

**Beginner.** Synchronizers coordinate the *flow* of threads rather than protect data. Most are built on `AbstractQueuedSynchronizer` (AQS), the framework at the heart of JUC locks and synchronizers.

**CountDownLatch.** A one-shot gate initialized to a count. Threads call `await()` to block until `countDown()` has been invoked `count` times. **Cannot be reset** — single use. Classic uses: main thread waits for N workers to finish; N workers wait on a start signal.

```java
CountDownLatch done = new CountDownLatch(N);
for (...) pool.submit(() -> { work(); done.countDown(); });
done.await();  // proceeds once count hits 0
```

**CyclicBarrier.** A **reusable** rendezvous: N threads each call `await()` and all block until the Nth arrives, then all proceed together. Optionally runs a **barrier action** on the last-arriving thread before releasing the others. "Cyclic" because it resets automatically for the next round. If any waiting thread is interrupted or times out, the barrier **breaks** and all others get `BrokenBarrierException`.

| | CountDownLatch | CyclicBarrier |
|---|---|---|
| Reusable | No (one-shot) | Yes (auto-resets) |
| Who waits | Any threads on a count | The participating threads on each other |
| Count changed by | Any thread via `countDown()` | Each party arriving via `await()` |
| Barrier action | No | Yes (optional Runnable) |

**Semaphore.** Maintains a set of **permits**; `acquire()` blocks until one is available, `release()` returns one. Used to bound concurrent access to a resource (e.g., a connection pool of size K). A binary semaphore (1 permit) acts like a lock, but — unlike `ReentrantLock` — a permit released by one thread can be acquired by another (no ownership). Supports fairness and `tryAcquire`.

**Phaser (Java 7).** A more flexible, reusable barrier that supports a **dynamic** number of parties (`register`/`arriveAndDeregister`) and **multiple phases**. `arriveAndAwaitAdvance()` is the per-phase rendezvous. It supersedes `CountDownLatch`+`CyclicBarrier` for staged, multi-round computations where participants join and leave over time.

**Advanced.** All of these are memory-visibility barriers (actions before `countDown`/`release`/`await` happen-before actions after the corresponding `await`/`acquire`). AQS uses a CLH-based FIFO wait queue and a single `volatile int` state manipulated via CAS. Interviewers may ask you to *implement* a latch or bounded semaphore, or to choose the right tool: use a latch for one-shot "wait for others," a barrier for iterative "sync at each step," a semaphore for "limit concurrency," and a phaser for "dynamic multi-stage."

---

## Virtual Threads and Modern Executors

**Beginner — the problem.** The classic server model dedicates one **platform thread** (a thin wrapper over an OS thread, ~1 MB stack) per request. OS threads are expensive, so you cap the pool (say 200) and share it; blocking IO idles a whole precious thread. Throughput is limited by thread count, not by hardware.

**New way — virtual threads (JEP 444, FINAL in JDK 21;** preview in JDK 19 and 20 via JEP 425/436**).** Virtual threads are lightweight threads managed by the JVM, not the OS. Millions can exist. When a virtual thread blocks (e.g., on IO), the JVM **unmounts** it from its carrier (platform) thread and mounts another, so blocking is cheap. You write plain, blocking, sequential code and get async-level scalability — no reactive/callback contortions.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {  // JDK 21
    for (var task : tasks) executor.submit(task);   // millions is fine
}   // close() waits for all tasks (ExecutorService is AutoCloseable since JDK 19)
```

**Advanced — gotchas.**
- **Pinning:** a virtual thread cannot unmount while inside a `synchronized` block/method or a native/JNI call — it stays "pinned" to its carrier, which can exhaust carriers under load. (JDK 21 recommends replacing `synchronized` with `ReentrantLock` on hot blocking paths; later JDKs reduced pinning.)
- **Do not pool virtual threads** — they are cheap and disposable; use `newVirtualThreadPerTaskExecutor()`, not a fixed pool. Do not use them to limit concurrency; use a `Semaphore` for that.
- `Thread.ofVirtual().start(r)` and `Thread.ofPlatform()` are the new builder APIs (JDK 21).

**Structured concurrency (JEP 453) is still a PREVIEW feature in JDK 21 — not final.** `StructuredTaskScope` treats a group of concurrent subtasks as a single unit of work (all succeed or the scope cancels the rest), improving observability and cancellation. Because it is preview, it requires `--enable-preview` and its API may change. Do not describe it as a finalized Java 21 feature.

---

## Common interview follow-up questions

1. Walk through exactly how `ThreadPoolExecutor` decides between creating a thread, queueing, and rejecting a task. Why can `maximumPoolSize` be ignored?
2. Why are `Executors.newFixedThreadPool` and `newCachedThreadPool` dangerous in production, and what would you build instead?
3. `execute` vs `submit`: where does an uncaught exception go in each case?
4. Difference between `thenApply` and `thenCompose`? Between `exceptionally`, `handle`, and `whenComplete`? Which thread runs a non-`Async` stage?
5. What is the risk of running blocking IO on `ForkJoinPool.commonPool()`? How does `ManagedBlocker` help?
6. `scheduleAtFixedRate` vs `scheduleWithFixedDelay` — and what happens if a periodic task throws?
7. How does `ConcurrentHashMap` achieve thread safety in Java 8+ vs Java 7? Why does it forbid null keys/values?
8. When would you pick `CopyOnWriteArrayList` over `ConcurrentHashMap`-backed structures or `Collections.synchronizedList`?
9. `ReentrantLock` vs `synchronized` — what does the lock give you? When is `StampedLock`'s optimistic read a win, and what are its restrictions?
10. `CountDownLatch` vs `CyclicBarrier` vs `Phaser` — pick the right one for concrete scenarios.
11. Which Java version made virtual threads final? What is thread pinning, and why should you not pool virtual threads? Is structured concurrency final in JDK 21?

## References

- JSR-166: `java.util.concurrent` (Java 5), Doug Lea. Java SE API docs for `ThreadPoolExecutor`, `Executors`, `CompletableFuture`, `ForkJoinPool`, `ConcurrentHashMap`, `StampedLock`, `Phaser`.
- JEP 425: Virtual Threads (Preview) — JDK 19. JEP 436: Virtual Threads (Second Preview) — JDK 20. **JEP 444: Virtual Threads — JDK 21 (final).**
- JEP 428: Structured Concurrency (Incubator) — JDK 19. JEP 453: Structured Concurrency (Preview) — JDK 21 (**still preview, not final**).
- JEP 266: More Concurrency Updates (`CompletableFuture` enhancements, `orTimeout`) — JDK 9.
- *Java Concurrency in Practice*, Goetz et al. (the canonical reference for this topic).
- Oracle "Java Language Updates" and JDK release notes for feature/version accuracy.
