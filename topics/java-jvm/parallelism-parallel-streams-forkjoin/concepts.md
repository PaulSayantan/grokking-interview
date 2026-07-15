# Parallelism: Parallel Streams, Fork/Join and Data Parallelism

Parallelism is about doing many things *at the same time* to finish a single job
faster, using multiple CPU cores. In Java the headline tools are the **Fork/Join
framework** (Java 7, 2011), **parallel streams** (Java 8, 2014), and the parallel
array utilities (`Arrays.parallelSort`, `Arrays.parallelPrefix`, Java 8). This note
builds from the conceptual distinctions interviewers probe, through practical usage,
down to the internals and the gotchas that separate a confident answer from a shaky one.

---

## Concurrency versus parallelism

**Beginner definition.** These two words are used interchangeably in casual speech but
mean different things, and interviewers love the distinction:

- **Concurrency** is a *structuring* concept: dealing with many tasks that are *in
  progress* at overlapping time intervals. It is about **composition of independently
  executing tasks**. A single CPU core can be concurrent by time-slicing (interleaving)
  tasks — none actually run at the same instant.
- **Parallelism** is an *execution* concept: literally executing multiple computations
  **simultaneously**, which requires more than one hardware execution unit (multiple
  cores/CPUs). It is about **simultaneous execution**.

Rob Pike's famous one-liner: *"Concurrency is about dealing with lots of things at once.
Parallelism is about doing lots of things at once."* Concurrency is a way to *structure*
a program; parallelism is a way to *run* it faster.

**Why it matters.** You can have:

| | Single core | Multiple cores |
|---|---|---|
| One task at a time | sequential | sequential (wastes cores) |
| Many tasks | **concurrent** (time-sliced) | **concurrent and parallel** |

- Concurrency **without** parallelism: async I/O on one thread, coroutines, an event loop.
- Parallelism **without** (much) concurrency complexity: a data-parallel `parallelStream()`
  that splits an array across cores with no shared state.

**Interview framing.** Concurrency is primarily about **correctness under interleaving**
(locks, visibility, races, deadlock). Parallelism is primarily about **throughput and
speedup** (Amdahl's law, load balancing, core count). Parallel streams and Fork/Join are
*parallelism* tools; `synchronized`, `ReentrantLock`, and `CompletableFuture` composition
lean more toward *concurrency*. Virtual threads (final in **JDK 21**, JEP 444) are a
concurrency tool for high-volume blocking workloads — they do **not** add parallelism for
CPU-bound work.

---

## Data parallelism versus task parallelism

**Beginner definition.** Two ways to decompose a problem so it can run on many cores:

- **Data parallelism**: the *same operation* applied to *many pieces of data*
  simultaneously. Split the data, run identical work on each partition, combine. Example:
  square every element of a 10-million-element array. This is exactly what parallel
  streams and `Arrays.parallelSort` do.
- **Task parallelism** (a.k.a. functional parallelism): *different operations* run at the
  same time, possibly on the same or different data. Example: fetch a user profile, their
  order history, and their recommendations concurrently, then merge. `CompletableFuture`
  composition is the idiomatic task-parallel tool.

**Comparison.**

| Aspect | Data parallelism | Task parallelism |
|---|---|---|
| What varies | the data (same op) | the operations |
| Java tool | parallel streams, Fork/Join, `parallelSort` | `CompletableFuture`, `ExecutorService`, threads |
| Scaling | scales with data size and core count | scales with number of independent tasks |
| Typical bottleneck | CPU-bound crunching | often I/O-bound / latency |
| Load balancing | via splitting + work-stealing | manual task submission |

**Advanced nuance.** Fork/Join *implements* data parallelism by recursively splitting data
into sub-tasks — so under the hood a data-parallel job becomes a tree of tasks. The two
concepts are lenses, not mutually exclusive. The interview point: **use data parallelism
for CPU-bound bulk data (parallel streams / Fork/Join); use task parallelism for
independent, often I/O-bound, heterogeneous work (CompletableFuture / virtual threads).**

---

## The Fork Join framework

**Beginner definition.** Introduced in **Java 7 (2011)** via `java.util.concurrent`,
Fork/Join is a framework for **divide-and-conquer** parallelism. You recursively **split**
a task into subtasks (fork), execute them in parallel, and **combine** their results
(join). It is the engine underneath parallel streams and `parallelSort`.

Core classes:

- `ForkJoinPool` — the executor that runs the tasks; uses **work-stealing**.
- `ForkJoinTask<V>` — abstract base for tasks.
  - `RecursiveTask<V>` — a task that **returns a result** (override `compute()`).
  - `RecursiveAction` — a task that returns **no result** (`void compute()`).
  - `CountedCompleter<T>` — advanced; completion-triggered continuation, no explicit join.

**The canonical pattern (threshold splitting).**

```java
class SumTask extends RecursiveTask<Long> {
    private static final int THRESHOLD = 10_000;
    private final long[] arr; private final int lo, hi;
    SumTask(long[] arr, int lo, int hi) { this.arr = arr; this.lo = lo; this.hi = hi; }

    @Override protected Long compute() {
        if (hi - lo <= THRESHOLD) {                 // base case: compute directly
            long sum = 0;
            for (int i = lo; i < hi; i++) sum += arr[i];
            return sum;
        }
        int mid = (lo + hi) >>> 1;
        SumTask left  = new SumTask(arr, lo, mid);
        SumTask right = new SumTask(arr, mid, hi);
        left.fork();                 // schedule left asynchronously on the pool
        long rightResult = right.compute();  // compute right in THIS thread
        long leftResult  = left.join();      // wait for and retrieve left's result
        return leftResult + rightResult;
    }
}
long total = ForkJoinPool.commonPool().invoke(new SumTask(data, 0, data.length));
```

**Why the fork/compute/join order matters (a classic gotcha).** The idiomatic order is
`left.fork(); right.compute(); left.join();`. Do **not** write
`left.fork(); right.fork(); left.join(); right.join();` — while it works, forking both and
then joining wastes the current thread. Calling `left.join()` *before* doing
`right.compute()` (`left.fork(); long l = left.join(); long r = right.compute();`)
**serializes** the work — the current thread blocks on the fork instead of doing useful
work, defeating the parallelism entirely. Best practice: fork one side, compute the other
directly on the current thread, then join.

**`fork()` vs `invoke()` vs `invokeAll()`:**
- `fork()` — asynchronously pushes the task onto the current worker's deque; returns
  immediately.
- `join()` — waits for completion and returns the result (or rethrows exceptions,
  wrapped where applicable).
- `invoke(task)` — forks and joins in one call (synchronous).
- `invokeAll(t1, t2, ...)` — forks all but one and computes it, a convenient balanced form.

**Choosing the threshold.** Too small → task-management overhead dominates (millions of
tiny tasks). Too large → poor load balancing, idle cores. Rule of thumb: aim for enough
subtasks that all cores stay busy (often a small multiple of parallelism), but each subtask
large enough that its work dwarfs the fork/join bookkeeping.

---

## Work stealing and the common pool

**Beginner definition.** `ForkJoinPool` uses a **work-stealing** scheduler. Each worker
thread has its **own double-ended queue (deque)** of tasks. A worker pushes newly forked
subtasks onto the **head** (LIFO for its own work — good cache locality). When a worker
runs out of work, it **steals** a task from the **tail** of another worker's deque (FIFO
for stolen work — steals the oldest, largest tasks). This keeps all cores busy and balances
load automatically without a central bottleneck.

**Why LIFO for self, FIFO for stealing?** A worker processing its own newest tasks
maximizes cache locality and mimics a recursive call stack. Stealing from the far end grabs
the *biggest* remaining chunk (near the root of the split tree), so a thief gets substantial
work and won't have to steal again immediately.

**The common pool.** `ForkJoinPool.commonPool()` is a **shared, static, JVM-wide** pool.
Parallel streams, `Arrays.parallelSort`, and `CompletableFuture`'s async methods (when no
executor is supplied) all use it by default.

- **Default parallelism** = `Runtime.getRuntime().availableProcessors() - 1` (the common
  pool targets `availableProcessors() - 1` *worker threads*; the submitting thread also
  helps, so the effective parallelism is roughly the number of cores). On a
  single-processor machine parallelism is 1 and tasks run in the caller.
- Configure it globally at startup via the system property
  `-Djava.util.concurrent.ForkJoinPool.common.parallelism=N`.

**The common-pool contention gotcha (very common interview point).** Because the common
pool is *shared* across the entire JVM, if one part of your app runs a long/blocking
parallel stream, it can **starve every other parallel stream** in the process. Worse:
**never do blocking I/O inside a parallel stream on the common pool** — you tie up the
handful of shared workers and stall unrelated parallel work.

**Escaping the common pool.** To isolate work (or use more threads), submit your stream
pipeline as a task to your *own* `ForkJoinPool`:

```java
ForkJoinPool custom = new ForkJoinPool(16);
try {
    long r = custom.submit(() ->
        list.parallelStream().filter(...).mapToLong(...).sum()
    ).get();       // the pipeline now runs on `custom`, not the common pool
} finally {
    custom.shutdown();
}
```

This works because a parallel stream runs on the pool that is *current* when the terminal
operation executes. Note this is a widely used idiom rather than a documented public API
guarantee. Managed blocking inside Fork/Join is possible via `ForkJoinPool.managedBlock(...)`,
which lets the pool spawn a compensation thread while a worker blocks.

---

## Parallel streams

**Beginner definition.** A parallel stream (Java 8) transparently splits a stream's
elements across multiple cores using the common `ForkJoinPool`, runs the pipeline on each
partition, and combines the results — all with (nearly) the same code as a sequential
stream. Create one via `collection.parallelStream()` or `stream.parallel()`.

```java
long count = list.parallelStream()
                 .filter(s -> s.length() > 3)
                 .count();
```

**How it works.** The stream source provides a `Spliterator` (see next section). The
framework recursively splits it into chunks, wraps each in a Fork/Join task, applies the
(stateless, side-effect-free) intermediate operations, and merges via the collector's
combiner or the reduction's combiner. `parallel()` / `sequential()` just flip a flag on the
pipeline — the *last* one wins, and it applies to the **whole** pipeline (you cannot make
part of a pipeline parallel and part sequential).

**Ordering.** Streams have an *encounter order*. For ordered sources, parallel pipelines
preserve encounter order for order-sensitive operations, which can cost performance. Use
`.unordered()` to explicitly drop the ordering constraint and let operations like
`distinct`, `limit`, and `findFirst`/`findAny` go faster. `findAny()` is preferable to
`findFirst()` in parallel because it needn't respect encounter order.

**`forEach` vs `forEachOrdered`.** In a parallel stream, `forEach` runs in **arbitrary
order** across threads; use `forEachOrdered` if you need encounter order (at a performance
cost). Printing inside a parallel `forEach` yields nondeterministic interleaving.

**Correctness rules.** Lambdas passed to stream ops must be:
- **Non-interfering** — do not modify the source during the pipeline.
- **Stateless** — do not depend on mutable state that could change during execution.
- **Side-effect-free** for the most part; **shared mutable state is a bug** (see gotchas).

---

## Spliterators and splitting

**Beginner definition.** A `Spliterator<T>` ("splittable iterator", Java 8) is the
abstraction that lets a source be **partitioned** for parallel traversal. Its key method,
`trySplit()`, returns a *new* Spliterator covering a **prefix** of the elements (and the
original is left covering the rest); returning `null` means it cannot split further.

**Why it decides parallel performance.** How well a source splits determines how well it
parallelizes:

| Source | Splittability | Parallel-friendliness |
|---|---|---|
| `ArrayList`, arrays, `IntStream.range` | split by index, exact halves, known size | **excellent** |
| `HashSet` / `HashMap` | reasonable | good |
| `LinkedList` | must traverse to split | poor |
| `Stream.iterate`, `BufferedReader.lines`, most I/O | effectively sequential / unknown size | **poor** |

Spliterators expose **characteristics** flags that the framework uses to optimize:
`SIZED`, `SUBSIZED`, `ORDERED`, `SORTED`, `DISTINCT`, `NONNULL`, `IMMUTABLE`, `CONCURRENT`.
A `SIZED`/`SUBSIZED` source can be split into evenly balanced tasks cheaply, which is why
arrays and `ArrayList` parallelize so well while `LinkedList` and `Stream.iterate` do not.

**Advanced.** `Stream.iterate(seed, next)` (the two-arg form) produces an inherently
sequential, unsized stream — splitting it is nearly useless, so it rarely benefits from
`parallel()`. The three-arg `Stream.iterate(seed, hasNext, next)` (Java 9) is bounded but
still ordered/sequential in nature. For ranges prefer `IntStream.range(0, n)` which splits
perfectly.

---

## When parallel streams help and when they hurt

**The core trade-off.** Parallelism has fixed **setup, splitting, task-scheduling, and
merging costs**. It only pays off when the parallelizable work is large enough to amortize
that overhead across cores. Reaching for `.parallel()` reflexively frequently makes code
*slower*.

**Parallel streams tend to HELP when (the "NQ" heuristic — N elements × Q cost-per-element
is large):**
- Large `N` (typically at least ~10,000 elements, though it depends on Q).
- Each element's work `Q` is non-trivial (CPU-bound compute).
- The source splits cheaply and evenly (`ArrayList`, arrays, `IntStream.range`).
- Operations are stateless, independent, and ideally unordered.
- The reduction/collector is cheap to combine.

**Parallel streams tend to HURT when:**
- **Small datasets** — overhead dwarfs the work; sequential wins.
- **Cheap per-element work** — e.g. a trivial arithmetic op; overhead dominates.
- **Boxing** — using `Stream<Integer>` instead of `IntStream` costs boxing/unboxing and
  destroys locality; prefer primitive streams.
- **Poorly splitting sources** — `LinkedList`, `Stream.iterate`, I/O-backed streams.
- **Order-sensitive ops** — `limit`, `findFirst`, `skip`, and ordered `distinct`/`sorted`
  force merging/buffering that erodes gains.
- **Stateful lambdas / shared mutable state** — not just slow, but **incorrect**.
- **Expensive-to-merge results** — e.g. combining into ordered structures.
- **Common-pool contention** — other parallel work in the JVM competes for the same threads.

**The shared-mutable-state trap (correctness bug, not just slowness):**

```java
// BROKEN: data race on the ArrayList; may lose elements, corrupt state, or throw
List<Integer> result = new ArrayList<>();
IntStream.range(0, 1_000_000).parallel()
         .forEach(result::add);          // ArrayList is NOT thread-safe

// CORRECT: let the framework combine, no shared mutable state
List<Integer> ok = IntStream.range(0, 1_000_000).parallel()
                            .boxed()
                            .collect(Collectors.toList());
```

Similarly, `reduce` requires the accumulator/combiner to be **associative** and the
identity to truly be an identity; otherwise parallel results differ from sequential ones.
`Collectors.toMap` combiners must be associative, and `Collectors.groupingByConcurrent`
exists precisely to allow an unordered concurrent collection.

**Boxing example:**

```java
// slower: boxed stream, poor locality
Stream.iterate(1L, i -> i + 1).limit(N).parallel().reduce(0L, Long::sum);
// faster: primitive, splittable, no boxing
LongStream.rangeClosed(1, N).parallel().sum();
```

---

## Arrays parallelSort and parallelPrefix

**Beginner definition.** Java 8 added parallel array utilities in `java.util.Arrays`:

- **`Arrays.parallelSort(array)`** — a parallel sort that uses Fork/Join. For arrays above
  a threshold (**8192 elements** by default, `MIN_ARRAY_SORT_GRAN`) it splits the array,
  sorts partitions in parallel, and merges; below the threshold it falls back to the
  ordinary sequential `Arrays.sort`. It is a parallel **merge sort** for objects (stable)
  and a parallel sort for primitives; contrast with sequential `Arrays.sort` which is
  Dual-Pivot Quicksort for primitives and TimSort for objects.
- **`Arrays.parallelPrefix(array, op)`** — computes a **cumulative** (prefix) operation
  in place: each element becomes the running reduction of all elements up to it, using an
  associative operator. E.g. with `(x,y)->x+y`, `[1,2,3,4]` becomes `[1,3,6,10]`. The
  operator **must be associative** for the parallel algorithm to be correct.
- **`Arrays.parallelSetAll(array, i -> f(i))`** — populates each index in parallel from a
  generator function of the index.

**Why prefer these over a hand-rolled parallel stream sort?** They are tuned, in-place, and
avoid stream/boxing overhead. For sorting a large primitive array, `parallelSort` is the
right tool — you would not sort via a stream.

**Gotcha.** `parallelSort` also runs on the common pool, so the same contention and
threshold caveats apply. On small arrays it is *identical* to `Arrays.sort` (it simply
delegates), so there's no penalty but no benefit either.

---

## Amdahl's law and diminishing returns

**Beginner definition.** **Amdahl's law** bounds the maximum speedup from parallelization
based on the fraction of the program that is inherently **serial**. If `P` is the parallel
fraction (0..1) and `s` is the number of processors:

```
Speedup(s) = 1 / ( (1 - P) + P/s )
```

As `s → ∞`, speedup is capped at `1 / (1 - P)`. So if 10% of the work is serial
(`P = 0.9`), the maximum possible speedup is **10×** no matter how many cores you throw at
it. If 5% is serial, the ceiling is **20×**.

**Why it matters.** It explains **diminishing returns**: doubling cores from 4→8 rarely
halves runtime. The serial portion (stream setup, merging, the single-threaded parts of
your program, I/O, synchronization) dominates as core count grows. It's also why reducing
the serial fraction often beats adding hardware.

**Related: Gustafson's law.** Amdahl assumes a *fixed problem size*. Gustafson's law
observes that in practice we scale the *problem* with the machine — with bigger datasets
the parallel fraction grows, so large data-parallel jobs scale better than Amdahl's
fixed-size pessimism suggests. Interviewers occasionally contrast the two.

**Practical corollaries.**
- Overhead (splitting, task scheduling, merging, cache/memory-bandwidth contention) makes
  real speedup *worse* than Amdahl's optimistic ceiling.
- More threads than cores for CPU-bound work causes context-switching overhead, not speedup.
- Memory bandwidth becomes the bottleneck for simple ops over large arrays long before you
  saturate cores.

---

## Choosing between parallel streams, CompletableFuture, and virtual threads

This is the key "senior" trade-off question. Match the tool to the workload:

| Workload | Best tool | Why |
|---|---|---|
| CPU-bound bulk data transform / reduce | **Parallel stream** or **Fork/Join** | Data parallelism; splits across cores; common pool sized to CPUs |
| Heterogeneous independent async tasks | **`CompletableFuture`** | Task parallelism; compose/`thenCombine`/`allOf`; supply your own executor |
| Many **blocking I/O** calls (HTTP, JDBC) | **Virtual threads** (final JDK 21) | Cheap threads that park on blocking; thread-per-task without pool exhaustion |
| Low latency, few independent lookups | `CompletableFuture` or virtual threads | Overlap latency, not crunch numbers |

**Why NOT parallel streams for blocking I/O.** Parallel streams run on the **common
ForkJoinPool** sized to the number of cores. Blocking those few threads on I/O starves all
other parallel work and gives you no throughput benefit (threads sit idle waiting).
Historically people wrapped I/O in a custom `ForkJoinPool` — but since **JDK 21**, virtual
threads are the correct answer for high-volume blocking work.

**Virtual threads (Project Loom):**
- **Preview in JDK 19 and JDK 20** (JEP 425, JEP 436); **finalized in JDK 21** (JEP 444,
  Sept 2023).
- Lightweight threads scheduled by the JVM onto a small pool of *carrier* platform
  threads (which is itself a `ForkJoinPool`). When a virtual thread blocks on I/O, it
  **unmounts** from its carrier, freeing it for other work.
- They enable the simple **thread-per-request** style at massive scale without the old
  thread-pool-tuning dance. **They do not speed up CPU-bound work** — you still have only
  as many carriers as cores.

**Structured concurrency:** Be precise — it is **NOT final** as of JDK 21. It was an
**incubator/preview API** (`java.util.concurrent.StructuredTaskScope`, JEP 428 incubator in
JDK 19, JEP 453 preview in JDK 21) and continued through further preview rounds in later
JDKs. In an interview, say "still preview, not finalized in 21."

**CompletableFuture (Java 8):** the composition tool for task parallelism. Use
`supplyAsync`, `thenApply`/`thenCompose`, `thenCombine`, `allOf`/`anyOf`. **Always pass an
explicit `Executor`** for I/O-bound work rather than defaulting to the common pool.

---

## Measuring before parallelizing

**The senior mantra: measure, don't guess.** Parallelism intuition is frequently wrong —
overhead, boxing, source characteristics, and memory bandwidth interact in ways that only a
benchmark reveals.

**How to measure correctly:**
- Use **JMH** (Java Microbenchmark Harness), the OpenJDK tool built specifically to avoid
  the traps of naive microbenchmarks: JIT warmup, dead-code elimination, constant folding,
  and on-stack replacement. `System.nanoTime()` loops are almost always misleading.
- Use **`Blackhole`** to consume results and prevent dead-code elimination; run proper
  **warmup** iterations so the JIT (C2) has compiled the hot path.
- Benchmark with **realistic data sizes and shapes**, on hardware resembling production.
- Profile to find the actual hotspot before parallelizing; Amdahl's law says only the
  dominant parallelizable fraction matters.

**Checklist before adding `.parallel()`:**
1. Is this a proven hotspot (profiled), or a guess?
2. Is `N × Q` large enough to amortize overhead?
3. Does the source split well (array/`ArrayList`/`range`, not `LinkedList`/`iterate`)?
4. Are the operations stateless, associative, side-effect-free?
5. Am I on the shared common pool — will I contend with or block other work?
6. Did a JMH benchmark actually show a win on representative data?

If any answer is shaky, prefer the sequential stream. It is simpler, deterministic, and
often faster than a poorly-suited parallel one.

---

## Common interview follow-up questions

1. **What's the difference between concurrency and parallelism?** Give an example of
   concurrency without parallelism (async I/O on one thread) and parallelism as a subset of
   concurrent execution.
2. **How does the Fork/Join framework achieve load balancing?** (Work-stealing deques:
   LIFO for own tasks, FIFO steals from other workers' tails.)
3. **Which pool do parallel streams use, and why is that dangerous?** (The shared common
   `ForkJoinPool`; blocking or long tasks starve all other parallel work in the JVM.)
4. **How do you make a parallel stream use a different thread pool?** (Submit the pipeline
   as a task to your own `ForkJoinPool`; note it's an idiom, not a guaranteed API.)
5. **What is the default parallelism of the common pool and how do you change it?**
   (`availableProcessors() - 1` workers; `-Djava.util.concurrent.ForkJoinPool.common.parallelism`.)
6. **Why might a parallel stream be slower than sequential?** (Small N, cheap Q, boxing,
   `LinkedList`/`iterate` sources, ordered ops, expensive merge, contention.)
7. **What makes a source good or bad for parallel streams?** (Spliterator splittability;
   `SIZED`/`SUBSIZED`; arrays vs `LinkedList`.)
8. **Why is shared mutable state in a parallel `forEach` a bug?** (Data race; use a
   collector / associative reduce instead.)
9. **State Amdahl's law and its implication for adding cores.** (Serial fraction caps
   speedup at `1/(1-P)`; diminishing returns.)
10. **When would you use `CompletableFuture` or virtual threads instead of a parallel
    stream?** (Task parallelism / blocking I/O vs CPU-bound data parallelism.)
11. **Which Java version finalized virtual threads? Is structured concurrency final?**
    (Virtual threads final in JDK 21 / JEP 444; structured concurrency still preview.)
12. **What threshold does `Arrays.parallelSort` use, and what does it do below it?**
    (8192 elements; delegates to sequential `Arrays.sort`.)
13. **Why prefer `findAny()` over `findFirst()` in a parallel stream?** (No encounter-order
    constraint, so it can return faster.)
14. **What requirements must a `reduce` combiner satisfy for correct parallel results?**
    (Associativity, valid identity, non-interference.)

---

## References

- **JSR 166** — `java.util.concurrent` (Fork/Join framework), Doug Lea. Java 7.
- Doug Lea, *"A Java Fork/Join Framework"* (2000) — the design paper behind work-stealing.
- **`ForkJoinPool`, `ForkJoinTask`, `RecursiveTask`, `RecursiveAction`** — Java SE API docs.
- **`java.util.stream`** package summary — parallelism, ordering, non-interference,
  statelessness, associativity, reduction/mutable reduction sections. Java SE 8+ docs.
- **`java.util.Spliterator`** — API docs, characteristics and `trySplit()` contract.
- **`java.util.Arrays`** — `parallelSort`, `parallelPrefix`, `parallelSetAll`; note the
  `MIN_ARRAY_SORT_GRAN` (8192) granularity threshold. Java SE 8+ docs.
- **JEP 425** — Virtual Threads (Preview), JDK 19.
- **JEP 436** — Virtual Threads (Second Preview), JDK 20.
- **JEP 444** — Virtual Threads (final), JDK 21.
- **JEP 428** — Structured Concurrency (Incubator), JDK 19; **JEP 453** — Structured
  Concurrency (Preview), JDK 21 (still not finalized).
- **Amdahl, G. (1967)** and **Gustafson, J. (1988)** — speedup laws.
- Urma, Fusco, Mycroft, *Modern Java in Action* — parallel data processing and the
  Fork/Join framework (NQ heuristic, common-pool guidance).
- **JMH (Java Microbenchmark Harness)** — OpenJDK `openjdk.org/projects/code-tools/jmh`.
