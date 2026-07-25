# Virtual Threads and Structured Concurrency (JDK 21, Project Loom)

Project Loom is the OpenJDK effort to make high-throughput concurrent Java simpler and cheaper.
Its flagship deliverable, **virtual threads**, was **finalized in JDK 21 (September 2023) via JEP 444**,
after two preview rounds (JEP 425 in JDK 19, JEP 436 in JDK 20). Two sibling features shipped alongside
it but are **still in preview in JDK 21**: **Structured Concurrency** (JEP 453, preview) and **Scoped Values**
(JEP 446, preview). This distinction matters in interviews — be precise about what is final versus preview.

---

## What are virtual threads

A **virtual thread** is a lightweight thread implemented by the JVM (not the OS). It is an instance of
`java.lang.Thread`, so it runs the same `Runnable`/`Callable` code and uses the same APIs as a classic
thread — but the JVM, not the operating system, decides when it runs.

- A **platform thread** is a thin wrapper over an **OS thread**. It is a scarce, expensive resource:
  each carries a large (typically ~1 MB) fixed stack, kernel bookkeeping, and OS scheduling. A JVM can
  realistically host a few thousand of them before memory and context-switching costs dominate.
- A **virtual thread** is **not tied to a particular OS thread**. Its stack lives on the Java heap and
  grows/shrinks as needed. Creating one is cheap, and you can have **millions** of them at once.

Key idea: when a virtual thread executes a **blocking operation** (blocking I/O, `Thread.sleep`, a
`BlockingQueue.take`, etc.), the JVM **unmounts** it from its underlying OS thread and stores its
continuation (stack) on the heap. The OS thread is now free to run another virtual thread. When the
blocking call is ready to resume, the virtual thread is **mounted** back onto an available OS thread.
This mount/unmount cycle is invisible to your code — you write plain, blocking, sequential code.

> **Final in JDK 21 (JEP 444).** Virtual threads are a permanent, non-preview feature; no
> `--enable-preview` flag is required.

Beginner mental model: a virtual thread is a *task* that the JVM parks and resumes on a small shared
pool of real OS threads, so blocking one virtual thread does not block an OS thread.

---

## The thread-per-request model without the cost

Server frameworks historically used a **thread-per-request** model: dedicate one thread to each incoming
request for its whole lifetime. It is easy to write, easy to debug (a request maps to one stack trace),
and works with plain blocking calls. Its problem is **cost**: because platform threads are scarce, the
number of concurrent requests is capped by the number of threads, not by the actual resource being used
(CPU, DB connections, downstream capacity). Under blocking I/O, most threads sit idle *waiting*, yet you
cannot create more without exhausting memory.

The **old workarounds** all trade simplicity for scalability:

- **Bounded thread pools** — cap threads, queue the rest. Throughput is limited and latency spikes when
  the pool saturates.
- **Asynchronous / reactive styles** (`CompletableFuture`, RxJava, Reactor, callbacks) — never block an
  OS thread, but you must rewrite logic as chains of callbacks/operators, losing readable stack traces,
  simple debugging, and normal try/catch/finally control flow. This is the "async coloring" problem.

**Virtual threads restore thread-per-request while removing the cost.** You dedicate one *virtual* thread
per request and write ordinary blocking code. Because a blocked virtual thread does not hold an OS thread,
concurrency scales to the real bottleneck (e.g. downstream throughput), not to a thread count. You get
the readability and debuggability of synchronous code with the scalability of async.

```java
// Thread-per-request, but each "thread" is virtual and nearly free.
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : requests) {
        executor.submit(() -> handle(r)); // blocking calls inside handle() are fine
    }
} // close() waits for all tasks (ExecutorService is AutoCloseable since Java 19)
```

### Worked example: "scales to the bottleneck, not the thread count"

Put numbers on it. Say **10,000 requests arrive concurrently**, and each one spends
**200 ms waiting on a database** and **5 ms burning CPU** (≈ 205 ms total). You have an
**8-core box**.

**Platform-thread-per-request:** you need one OS thread parked on each in-flight request →
**~10,000 OS threads**. At ~1 MB of stack each that is **~10 GB of stack memory** — you OOM
(or exhaust native memory) long before you get there. Even if the memory existed, the kernel
context-switching 10,000 threads shreds throughput. The ceiling is the **thread count**, and
it is far below what the DB could actually take.

**Virtual-thread-per-request:** the carrier pool stays at **~8 OS threads** (~8 MB of stacks).
At any instant, of the 10,000 virtual threads, `200/205 ≈ 97.6 %` (~9,760 of them) are
**unmounted**, sitting on the heap waiting for the DB — holding *zero* OS threads. Only the
`5/205 ≈ 2.4 %` doing CPU work compete for the 8 carriers. Memory drops from **~10 GB to ~8 MB**.

Now apply **Little's Law** (`in-flight = throughput × latency`, so `throughput = in-flight / latency`)
to find the *new* ceiling — which is no longer threads:

- If the **DB** can serve 10,000 concurrent queries, throughput ≈ `10,000 / 0.205 s ≈ 48,000 req/s`,
  capped by DB concurrency.
- If instead the **8 cores** are the limit (each request needs 5 ms of CPU), throughput ≈
  `8 / 0.005 s = 1,600 req/s`, capped by CPU.

Either way the limiting resource is now a **real** resource you can reason about and scale
(DB pool, cores), not an artificial "we ran out of threads" wall. That is the whole pitch.

---

## Virtual threads versus platform threads

| Aspect | Platform thread | Virtual thread |
|---|---|---|
| Backed by | One dedicated OS thread | Many share a small pool of OS (carrier) threads |
| Creation cost | High (syscall, ~1 MB stack) | Very low (heap object, small growable stack) |
| Practical count | Thousands | Millions |
| Scheduler | OS kernel | JVM (a dedicated `ForkJoinPool`) |
| Stack | Fixed, in OS memory | Growable, on the Java heap |
| Best for | CPU-bound work; long-lived threads | High-volume blocking I/O, thread-per-request |
| Pooling | Pool them (creation is expensive) | Do **not** pool them (creation is cheap) |
| `Thread.isDaemon()` | Configurable | Always a daemon; always priority `NORM_PRIORITY` |
| Custom name | Optional | No name by default |
| `Thread.ofVirtual()` factory | n/a | Yes (Java 21) |

Both are `java.lang.Thread`. You choose at construction:

```java
Thread platform = Thread.ofPlatform().name("worker-1").start(task);
Thread virtual  = Thread.ofVirtual().name("vt-1").start(task);
boolean isVirtual = Thread.currentThread().isVirtual(); // Java 21
```

Virtual threads are always daemon threads — a running virtual thread will **not** keep the JVM alive,
and you cannot change their priority (priority calls are ignored).

---

## Carrier threads and the ForkJoinPool scheduler

The OS threads onto which virtual threads are mounted are called **carrier threads**. By default the
JVM schedules virtual threads on a dedicated **`ForkJoinPool` running in FIFO mode** (distinct from the
common pool used by parallel streams). Its parallelism defaults to the number of available processors
(`Runtime.getRuntime().availableProcessors()`), tunable via the system property
`jdk.virtualThreadScheduler.parallelism`.

- When a virtual thread runs, it is **mounted** on a carrier; the carrier's OS thread stack is used.
- When it blocks on a JDK-instrumented operation, the JVM copies its stack to the heap (a
  **continuation**) and **unmounts** it, freeing the carrier for other virtual threads.
- On completion of the blocking operation, the virtual thread is submitted back to the scheduler and
  eventually **remounted** — possibly on a *different* carrier thread.

```text
   V1   V2   V3   V4   V5   ...        virtual threads (millions, most parked)
    |         |         |
    v         v         v
 [ C1 ]    [ C2 ]    [ C3 ]            carrier threads (≈ #cores, e.g. 8)

Step 1: V1 mounted on C1, runs until it blocks on I/O.
Step 2: V1's stack is copied to the heap (a "continuation"); V1 is UNMOUNTED.
        C1 is now free and immediately picks up V2.
Step 3: I/O completes → V1 is resubmitted to the scheduler and REMOUNTED —
        possibly on a DIFFERENT carrier (say C3), not necessarily C1.
```

**How far can the pool grow? (compensation.)** The scheduler is a `ForkJoinPool` whose
*parallelism* defaults to the core count (say 8). When a carrier is legitimately blocked in a
way the JDK can detect (via a `ManagedBlocker`), the pool **temporarily spins up an extra
platform thread to compensate**, so all cores stay busy — but only up to
`jdk.virtualThreadScheduler.maxPoolSize` (**default 256**). This compensation is exactly what
**pinning defeats**: a pinned carrier cannot be compensated the same way. Concretely, if
parallelism = 8 and all **8** carriers are pinned on `synchronized` DB calls, **no other virtual
thread can be scheduled at all** until one of them unpins — a throughput collapse that looks
like a deadlock.

Consequences and gotchas:
- The carrier's thread identity is not the virtual thread's identity. Do **not** cache carrier identity
  across a blocking point.
- **Never rely on thread identity as a lock key** for a virtual thread; and heavy use of
  `ThreadLocal` is discouraged with virtual threads (millions of threads × per-thread copies = memory
  blow-up). Prefer **scoped values** (see below).
- The scheduler is **not** time-sliced/preemptive between blocking points: a virtual thread that runs a
  long CPU loop without blocking will occupy its carrier until it yields or blocks.

---

## Pinning: synchronized and native calls

**Pinning** is the key gotcha. A virtual thread is **pinned** when it *cannot be unmounted* from its
carrier while blocked. During pinning the carrier OS thread stays occupied, defeating the scalability
benefit; if enough virtual threads pin simultaneously, you can starve the scheduler (deadlock-like
throughput collapse), because the pool may add only a limited number of extra carriers.

In **JDK 21**, a virtual thread pins its carrier in two main cases:

1. It blocks **inside a `synchronized` block or method** (the monitor is tied to the OS thread).
2. It blocks while executing a **native method or a foreign function** (`native`/JNI/FFM downcall).

```java
// PINS the carrier for the whole DB call in JDK 21:
synchronized (lock) {
    result = db.query(sql);   // blocking I/O while holding a monitor -> pinned
}

// Does NOT pin — the carrier is released while blocked:
lock.lock();                  // java.util.concurrent.locks.ReentrantLock
try {
    result = db.query(sql);
} finally {
    lock.unlock();
}
```

Detect pinning with `-Djdk.tracePinnedThreads=full` (or `short`). In JDK 21 the recommended fix is to
**replace `synchronized` with `ReentrantLock`** around blocking calls, or narrow the `synchronized`
region so no blocking happens inside it.

**Pinning is not just *your* `synchronized`.** A few more gotchas a senior candidate should name:
- **`Object.wait()` inside a `synchronized` block also pins** (it releases the monitor logically but the
  wait still happens on a pinned carrier in JDK 21).
- **Library / JDK / driver code counts too.** An older JDBC driver, connection pool, or logging
  framework that holds a `synchronized` monitor across its blocking call pins your carrier even though
  *your* code has no `synchronized`. This is why you profile the *real dependency stack* with
  `-Djdk.tracePinnedThreads`, not just audit your own source.
- **Not every blocking call unmounts cleanly.** Socket NIO parks the virtual thread properly, but some
  **legacy synchronous file I/O** (`java.io.FileInputStream`/`FileOutputStream`) and certain filesystem
  operations are serviced by handing the work to a temporary carrier rather than truly unmounting — so
  heavy blocking file I/O does not scale as freely as socket I/O.

> **Version note:** This `synchronized`-pinning limitation was **later removed by JEP 491 in JDK 24
> (2025)**, where virtual threads can unmount even inside `synchronized`. In **JDK 21 (the LTS this
> topic targets) pinning on `synchronized` is real** — answer JDK-21 questions accordingly. Native/FFM
> calls still pin.

---

## ReentrantLock versus synchronized

Because `synchronized` pins in JDK 21, the guidance for code that **holds a lock across a blocking
operation** is to prefer `java.util.concurrent.locks.ReentrantLock`:

| | `synchronized` | `ReentrantLock` |
|---|---|---|
| Pins carrier when blocking inside (JDK 21) | **Yes** | No |
| Interruptible acquire / `tryLock(timeout)` | No | Yes |
| Fairness policy | No | Optional |
| Condition variables | Single (`wait`/`notify`) | Multiple `Condition`s |
| Must manually `unlock()` in `finally` | No (automatic) | Yes |

You do **not** need to replace *every* `synchronized`. Short, non-blocking critical sections (e.g. a
quick in-memory update) are fine — pinning only hurts when a virtual thread **blocks** while pinned.
Target the hot paths that hold a monitor across I/O.

---

## Creating and using virtual threads

Several entry points, all Java 21 (some usable in the 19/20 previews):

```java
// 1. Unstarted, then start
Thread t = Thread.ofVirtual().unstarted(runnable);
t.start();

// 2. Start immediately
Thread.ofVirtual().name("req-", 0).start(runnable);

// 3. Static convenience
Thread.startVirtualThread(runnable);

// 4. Executor (recommended for many tasks) — one virtual thread per task
try (ExecutorService es = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> f = es.submit(() -> fetch(url));
    System.out.println(f.get());
}

// 5. A ThreadFactory of virtual threads
ThreadFactory tf = Thread.ofVirtual().factory();
```

`Thread.Builder` (`Thread.ofVirtual()` / `Thread.ofPlatform()`) is new API in Java 21.
`newVirtualThreadPerTaskExecutor()` creates a **new** virtual thread for **every** task — it is not a
bounded pool, so submitting a million tasks creates a million virtual threads.

---

## Thread pools as an anti-pattern

With platform threads you pool because creation is expensive and you must cap the OS-thread count.
With **virtual threads, pooling is an anti-pattern**:

- Creation is cheap, so there is nothing to amortize by reusing threads.
- A **bounded** pool of virtual threads re-imposes the very limit virtual threads remove — you are back
  to capping concurrency by thread count.
- Reusing a virtual thread breaks the clean "one thread per task" identity that structured concurrency,
  scoped values, and thread dumps rely on.

**Do:** create one virtual thread per task (`newVirtualThreadPerTaskExecutor`).
**Don't:** wrap virtual threads in a fixed-size pool. If you must **limit concurrency** to a scarce
resource (e.g. 10 DB connections), use a **`Semaphore`** inside the tasks — not a small thread pool.

```java
Semaphore dbPermits = new Semaphore(10);
// each task:
dbPermits.acquire();
try { return db.query(sql); } finally { dbPermits.release(); }
```

**What actually happens with 10,000 tasks + `Semaphore(10)`:** exactly **10** tasks hold a permit
and hit the DB; the other **9,990** call `acquire()`, block, and are **unmounted virtual threads**
parked on the heap — costing only a few KB of heap each, **zero OS threads**. As each of the 10
finishes and calls `release()`, one parked virtual thread is unparked and takes its place.

Contrast with a `newFixedThreadPool(10)` of platform threads: it *also* caps DB concurrency at 10,
but the other 9,990 tasks sit in a **queue behind 10 OS threads** — they are not yet running as
anything, so there is no per-task thread identity, no live stack, no thread dump entry until one is
dequeued. The Semaphore version preserves the **one-virtual-thread-per-task** identity (clean stack
traces, structured concurrency, scoped values) while capping the scarce resource at 10 — you get the
concurrency limit *without* re-imposing a thread-count limit.

Also, **do not cache expensive per-thread objects in pooled `ThreadLocal`s** with virtual threads — with
millions of threads that pattern explodes memory. This is why scoped values were introduced.

---

## When virtual threads do not help (CPU-bound work)

Virtual threads speed up **blocking / I/O-bound** workloads by letting a small number of carriers serve
many waiting tasks. They do **not** create new CPUs. For **CPU-bound** work:

- Throughput is bounded by cores, not by thread count. Running more virtual threads than cores just adds
  scheduling overhead — the total compute time is unchanged (often slightly worse).
- Use a **bounded platform-thread pool sized near the core count** (e.g. `ForkJoinPool`,
  `Executors.newFixedThreadPool(nCores)`) for parallel computation.
- A long CPU-bound virtual thread that never blocks will **not be preempted** at safepoints between
  blocking operations, so it monopolizes its carrier.

Rule of thumb: **virtual threads = concurrency (many waiting tasks); platform-thread pools / parallel
streams = parallelism (many computing tasks).**

---

## Structured concurrency and StructuredTaskScope

**Structured Concurrency** treats a group of related concurrent subtasks as a **single unit of work**
with a well-defined scope, mirroring how a block of code has structured control flow. It is delivered by
`java.util.concurrent.StructuredTaskScope`.

> **Status: PREVIEW in JDK 21 (JEP 453).** It was a preview API in 21 (and had earlier incubation in
> JDK 19/20 via JEP 428/437). It requires `--enable-preview` to compile and run on JDK 21. It is
> **not** a finalized feature in 21 — call this out explicitly.

The problem it solves: with a bare executor, subtasks forked for one logical operation are unrelated —
if one fails you must manually cancel the others, and if the caller is cancelled the subtasks can leak
(orphaned threads, thread leaks, lost errors). Structured concurrency guarantees that subtasks started in
a scope **complete or are cancelled before the scope closes**, and errors propagate to the parent.

```java
// PREVIEW in JDK 21 — requires --enable-preview
Response handle() throws InterruptedException, ExecutionException {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        Supplier<String> user   = scope.fork(() -> fetchUser());
        Supplier<Integer> order = scope.fork(() -> fetchOrder());

        scope.join();            // wait for all forks
        scope.throwIfFailed();   // propagate the first failure, cancelling the rest

        return new Response(user.get(), order.get());
    }
}
```

> **Version caveat — the API surface changed after JDK 21.** The subclass-based shape above
> (`new StructuredTaskScope.ShutdownOnFailure()`, `throwIfFailed()`) is **JDK-21-preview-specific**.
> In later previews the API was reworked: the subclasses were replaced by a static factory
> `StructuredTaskScope.open(...)` that takes a `Joiner` strategy (e.g.
> `Joiner.awaitAllSuccessfulOrThrow()` for fail-fast, `Joiner.anySuccessfulResultOrThrow()` for
> racing), with `scope.join()` returning the result directly. This is the shape in the JDK 25 preview
> (JEP 505). If you are on JDK 23/24/25, the exact method names below will not compile — check your JDK's
> `StructuredTaskScope` Javadoc for the API version you have.

Built-in policies (in the JDK 21 preview API):
- **`ShutdownOnFailure`** — fail fast: the first subtask that throws cancels the others (invoke-all,
  all-must-succeed semantics).
- **`ShutdownOnSuccess`** — the first subtask that succeeds cancels the others (racing / "any" semantics).

Benefits: subtasks run on virtual threads, cancellation propagates automatically, errors are aggregated,
and thread dumps show the parent-child hierarchy. The scope's confinement is enforced (fork must be
called by the scope owner). Structured concurrency + virtual threads is the intended replacement for ad
hoc `CompletableFuture` fan-out.

---

## Scoped values

**Scoped values** (`java.lang.ScopedValue`) provide a way to share **immutable** data from a caller to
its callees (including forked subtasks) without passing explicit parameters — a safer, virtual-thread-
friendly alternative to `ThreadLocal`.

> **Status: PREVIEW in JDK 21 (JEP 446)** (incubated earlier). Requires `--enable-preview` on JDK 21.

Why not `ThreadLocal`? With millions of virtual threads, `ThreadLocal`s (a) cost memory per thread,
(b) are mutable and unbounded in lifetime, and (c) get **inherited/copied** awkwardly across forks.
Scoped values are **immutable**, **bounded to a dynamic scope**, and automatically visible to subtasks
forked inside that scope.

```java
// PREVIEW in JDK 21 — requires --enable-preview
final static ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

ScopedValue.where(CURRENT_USER, user).run(() -> {
    // anywhere in this dynamic scope, including forked subtasks:
    process();                       // can read CURRENT_USER.get()
});                                  // binding is unbound automatically when the block returns
```

`ScopedValue` is immutable once bound (rebind only via a nested `where(...)` scope), so it eliminates the
"someone mutated my thread-local" class of bugs and needs no cleanup/`remove()`.

---

## Comparison to reactive and CompletableFuture

Before virtual threads, scaling past the thread limit meant going **asynchronous**: `CompletableFuture`,
RxJava, Project Reactor, callbacks, Kotlin coroutines, etc. These achieve high throughput by never
blocking an OS thread, but at a cost.

| | Async / reactive (`CompletableFuture`, Reactor) | Virtual threads (blocking, thread-per-task) |
|---|---|---|
| Programming style | Callback/operator chains; "colored" async functions | Ordinary sequential blocking code |
| Stack traces | Fragmented across callbacks; hard to debug | Full, meaningful per-request stack |
| Control flow | Custom operators; try/catch doesn't span async | Native `try`/`catch`/`finally`, loops, locals |
| Backpressure / streaming | First-class (Reactive Streams) | Not built in — reactive still wins here |
| OS-thread usage under blocking I/O | Very low | Very low (carrier freed on block) |
| Learning curve | Steep | Minimal (looks like classic code) |

Key points for interviews:
- Virtual threads make **synchronous blocking code scale**, so for typical request/response fan-out they
  remove most of the *reason* to go reactive.
- Reactive/`CompletableFuture` is still valuable for **push-based streaming, backpressure, and
  declarative composition of async event streams** — virtual threads do not replace Reactive Streams
  semantics.
- To get the async-fan-out benefits with synchronous code, combine **virtual threads + structured
  concurrency** (though the latter is preview in 21).
- Virtual threads also do **not** change that CPU-bound parallelism should use a bounded platform pool.

---

## Common interview follow-up questions

1. Which JDK **finalized** virtual threads, and which JEP? (JDK 21, JEP 444.) What was the preview
   history? (JEP 425 in 19, JEP 436 in 20.)
2. Is structured concurrency final in JDK 21? (No — preview, JEP 453. Scoped values also preview, JEP 446.)
3. Explain **mount/unmount** and what a **carrier thread** is. What scheduler runs virtual threads?
4. What is **pinning**? Name the two things that pin a carrier in JDK 21 and how to fix/detect them.
5. Why is `ReentrantLock` preferred over `synchronized` around blocking calls with virtual threads?
6. Why is **pooling virtual threads** an anti-pattern, and how do you limit concurrency instead?
7. When do virtual threads **not** help? How would you handle CPU-bound work?
8. Why are `ThreadLocal`s discouraged with virtual threads, and what replaces them?
9. Are virtual threads preemptively time-sliced? What happens with a tight CPU loop and no blocking?
10. Compare virtual threads to `CompletableFuture`/reactive. When would you still choose reactive?
11. Are virtual threads daemon threads? Can you set their priority? (Yes daemon; priority ignored.)
12. How do you create a virtual thread (four ways)? What does `newVirtualThreadPerTaskExecutor` do?

## References

- JEP 444: Virtual Threads (Final in JDK 21) — https://openjdk.org/jeps/444
- JEP 425: Virtual Threads (Preview, JDK 19) — https://openjdk.org/jeps/425
- JEP 436: Virtual Threads (Second Preview, JDK 20) — https://openjdk.org/jeps/436
- JEP 453: Structured Concurrency (Preview, JDK 21) — https://openjdk.org/jeps/453
- JEP 505: Structured Concurrency (Fifth Preview, JDK 25) — reworked API: `StructuredTaskScope.open(...)` + `Joiner` strategies replace the `ShutdownOnFailure`/`ShutdownOnSuccess` subclasses — https://openjdk.org/jeps/505
- JEP 446: Scoped Values (Preview, JDK 21) — https://openjdk.org/jeps/446
- JEP 428/437: Structured Concurrency (Incubator, JDK 19/20)
- JEP 491: Synchronize Virtual Threads without Pinning (JDK 24) — https://openjdk.org/jeps/491
- Oracle: "Virtual Threads" — Core Libraries / JDK 21 documentation
- `java.lang.Thread`, `java.util.concurrent.StructuredTaskScope`, `java.lang.ScopedValue` Javadoc (JDK 21)
