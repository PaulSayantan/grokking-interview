# Modern JVM: ZGC, Shenandoah, JIT, GraalVM and JFR

This topic covers the modern OpenJDK/HotSpot runtime: the low-pause garbage
collectors (ZGC and Shenandoah) and how they compare to G1; how the JIT compiler
actually turns bytecode into optimized machine code (interpretation, tiered
C1/C2 compilation, inlining, deoptimization); ahead-of-time compilation via
GraalVM Native Image and its trade-offs; and observability with JDK Flight
Recorder (JFR) and JDK Mission Control (JMC).

A recurring theme: **there is no universally best collector or compilation
strategy — everything is a trade-off between pause time, throughput, memory
footprint, startup time, and peak performance.** Interviewers probe whether you
understand *which* knob you are turning and *why*.

---

## G1 garbage collector baseline

**Beginner.** G1 (Garbage-First) is the **default collector since JDK 9**
(JEP 248). It replaced the Parallel collector as the default. G1 is a
*region-based*, *mostly-concurrent*, *evacuating (compacting)* collector that
targets a **pause-time goal** (default 200 ms via `-XX:MaxGCPauseMillis=200`)
rather than raw throughput.

**Why it exists.** The old collectors forced a choice: Parallel GC gave high
throughput but long stop-the-world (STW) pauses; CMS (Concurrent Mark Sweep)
gave shorter pauses but did not compact, suffered fragmentation, and had a
dreaded "concurrent mode failure" fallback to a full STW compaction. CMS was
deprecated in JDK 9 (JEP 291) and **removed in JDK 14** (JEP 363). G1 was
designed as its successor: predictable pauses *and* compaction.

**How G1 works (intermediate).**
- The heap is split into equal-sized **regions** (typically 1–32 MB, a power of
  two, ~2048 regions). Each region is dynamically tagged Eden, Survivor, Old, or
  **Humongous** (for objects larger than half a region).
- Generational: young collections are STW and copy live young objects into
  survivor/old regions.
- Concurrent marking runs alongside the application to find live data in old
  regions; then "mixed" collections evacuate the old regions with the most
  garbage first (hence "Garbage-First"), maximizing reclaimed space per unit of
  pause time.
- Uses **Remembered Sets (RSets)** and a **Snapshot-At-The-Beginning (SATB)**
  write barrier to track cross-region references and concurrent mutations.

**Trade-off summary.** G1 is the balanced default: good throughput, moderate and
*predictable* pauses that still scale roughly with live-set/region count, and
reasonable footprint. Its pauses (tens to low hundreds of ms) grow with heap
size because evacuation of the young generation and the final mark are STW. On
very large heaps (tens/hundreds of GB) where sub-10ms or sub-1ms pauses are
required, ZGC or Shenandoah become preferable.

**Gotcha.** G1 is **not** a "low-latency" collector in the ZGC/Shenandoah sense.
Its pause is bounded by a *goal*, not a guarantee; it can overshoot, and full GCs
(though rare) are still fully STW. Humongous allocations can cause fragmentation
and premature full GCs.

---

## ZGC low pause collector

**Beginner.** ZGC (the Z Garbage Collector) is a **scalable, low-latency**
collector whose design goal is **sub-millisecond max pause times** that **do not
increase with heap or live-set size**. It scales from a few hundred MB to
**multiple terabytes** of heap.

**Version timeline (memorize this):**
- **JDK 11** — introduced as **experimental** (JEP 333), Linux/x64 only, behind
  `-XX:+UnlockExperimentalVMOptions`.
- **JDK 15** — became a **production-ready** feature (JEP 377). Enable with
  `-XX:+UseZGC`.
- **JDK 21** — **Generational ZGC** (JEP 439) delivered as the recommended mode.
- **JDK 23** — Generational mode became the **default** for ZGC, and the
  non-generational mode was deprecated.

**The core trick: colored pointers and load barriers (advanced).** ZGC stores
**metadata bits inside the 64-bit object pointer itself** ("colored pointers" /
"color bits" such as Marked0, Marked1, Remapped, and — in generational ZGC —
Remembered). It is therefore a **64-bit-only** collector. When the application
loads an object reference, a **load barrier** inspects the color bits; if the
reference points to an object that has been relocated (or needs marking), the
barrier fixes up the pointer *at that moment* ("self-healing") — this is how ZGC
performs **concurrent relocation/compaction** without a STW pause to update all
references.

- **Load barrier** (ZGC) vs **write barrier** (G1/Shenandoah's SATB): ZGC's key
  barrier is on *reads* of references, letting relocation happen concurrently and
  lazily. (Non-generational ZGC uses a load barrier; generational ZGC adds a
  store/write barrier to track young-to-old references via remembered sets.)
- ZGC originally used **multi-mapped memory** and 42-bit colored pointers; newer
  versions (JDK 21+) shifted to a scheme with load *and* store barriers for the
  generational design.

**Worked example: tracing one self-healing load.** Take an *illustrative* colored
pointer layout (exact bit positions changed across versions — the idea is what
matters):

```
 63 ............... 45 | 44      | 43      | 42       | 41 .............. 0
 [   unused (zero)    ][Marked0 ][Marked1 ][Remapped ][   42-bit heap offset  ]
```

Only one color bit is the "good" (current) color at any moment. Say the current
phase's good color is **Remapped**. Trace an object `O` getting relocated:

1. **Before.** A field holds a reference to `O` at heap offset `0x0001000`, tagged
   with the *previous* good color `Marked0`. Bit view: `Marked0=1, Remapped=0,
   addr=0x0001000`.
2. **GC relocates `O`** concurrently to offset `0x0005000` and records a forwarding
   entry in the relocation table: `0x0001000 → 0x0005000`. The stale field is
   **not** touched yet — that's the whole point (no STW pass to fix every pointer).
3. **App thread loads the field** (`Object x = holder.field;`). The **load barrier**
   fires: it masks off the color bits and asks "is this the good color?" The
   pointer's color is `Marked0`, but the good color is `Remapped` → **bad color →
   slow path.**
4. **Slow path (self-healing).** The barrier looks up offset `0x0001000` in the
   forwarding table, finds `0x0005000`, **rewrites the in-memory field** to a
   pointer with `Remapped=1, addr=0x0005000`, and returns that healed reference.
5. **Next load of the same field** sees color `Remapped` = good color → **fast path,
   zero fixup.** The cost of relocation is paid lazily, once, by the first reader.

Contrast one load under **G1's SATB write barrier**: G1 doesn't intercept *reads* at
all. Instead, when the app *overwrites* a reference field during concurrent marking,
the write barrier records the *old* value into a log so the marker still visits it
(preserving the "snapshot at the beginning"). G1 then updates all references during a
**STW evacuation pause** — which is exactly why its pause grows with the live set,
while ZGC's healing is spread across mutator reads and stays heap-independent.

**Generational ZGC (JDK 21, JEP 439).** The original ZGC was
*single-generation*: it marked and relocated the *entire* heap every cycle.
Because "most objects die young" (the weak generational hypothesis), this wasted
CPU and memory. Generational ZGC maintains separate **young** and **old**
generations, collecting the young generation far more frequently and cheaply.
Benefits: much lower CPU overhead, less heap headroom needed, and better
handling of high allocation rates — while keeping the sub-millisecond pauses.

**Trade-offs.**
- **Pros:** pauses typically well under 1 ms and *independent of heap size*;
  scales to TB heaps; concurrent everything (mark, relocate, reference
  processing).
- **Cons:** the load barrier and concurrent work add **CPU and throughput
  overhead** vs Parallel/G1; historically a **larger memory footprint** (extra
  heap headroom for concurrent relocation, and multi-mapping); needs enough spare
  CPU to keep GC threads ahead of allocation, otherwise **allocation stalls**
  occur. Generational ZGC substantially reduces the footprint/CPU cost.

**Gotcha: "concurrent everything" ≠ truly pauseless.** ZGC still has a handful of
**short STW pauses** — chiefly **mark start** (scan thread stacks / GC roots),
**mark end**, and **relocate start**. What makes them sub-millisecond is that they
only scan **roots** (thread stacks, globals) — work that is `O(number of threads)`,
**not `O(heap)` or `O(live set)`**. The heavy lifting (concurrent marking, concurrent
relocation, reference processing) happens while the app runs. So the honest answer to
"is ZGC pauseless?" is: *no — it has bounded root-scanning pauses whose duration is
independent of how big the heap is*, which is what actually delivers the SLA.

**Gotcha.** ZGC does **not** aim for maximum throughput. If your workload is
batch/throughput-bound with generous pause budgets, Parallel or G1 may deliver
more work per second. ZGC shines when **tail latency (p99/p999)** matters.

---

## Shenandoah low pause collector

**Beginner.** Shenandoah is another **low-pause** collector (originally developed
by Red Hat) that performs **concurrent compaction** — it evacuates/relocates
live objects *while the application runs*, keeping pauses short and roughly
**independent of heap size** (like ZGC).

**Version timeline:**
- **JDK 12** — introduced as **experimental** (JEP 189).
- **JDK 15** — became a **production feature** (JEP 379). Enable with
  `-XX:+UseShenandoahGC`.
- Note: for a long time Oracle's own JDK builds shipped **without** Shenandoah;
  it was available in distributions like Red Hat/Adoptium builds. It is included
  in mainline OpenJDK.

**How it works (intermediate/advanced).** Shenandoah's historical mechanism was
the **Brooks forwarding pointer**: every object carried an extra word pointing to
either itself or its relocated copy, so reads/writes indirected through it. Newer
Shenandoah versions replaced this with **load-reference barriers (LRB)** to
reduce overhead. Concurrent evacuation copies live objects to new regions while
mutators run; barriers ensure mutators see the up-to-date copy.

**Intuition — the "forwarding slot."** Think of the Brooks word as a mandatory
mail-forwarding sticker on every object. Trace it:

1. Object `O` is created with a header that includes a forwarding slot. Normally
   that slot **points to `O` itself** — "I still live here." Every read/write of a
   field first dereferences the slot (one extra indirection), lands back on `O`, and
   proceeds.
2. GC evacuates `O` to a copy `O'` *while the app runs*. It flips `O`'s forwarding
   slot to **point to `O'`** — "I've moved; forward my mail to `O'`."
3. Any mutator that still holds the old `O` reference reads/writes a field: it
   follows the slot, is transparently redirected to `O'`, and operates on the current
   copy. No STW pass had to rewrite every reference first — the indirection *is* the
   fix-up.

That single extra word is what lets relocation be concurrent — but it costs **one
header word per object** (memory) plus **an indirection on every access** (time),
even when nothing has moved. **Load-reference barriers (LRB)** removed the always-on
extra word by doing the forwarding check in a barrier on reference loads instead
(closer in spirit to ZGC's load barrier), so the common "nothing moved" case gets
cheaper.

**Shenandoah vs ZGC (a very common interview question).**
- Both are concurrent, low-pause, region-based, compacting collectors with pauses
  largely decoupled from heap size.
- **ZGC** uses **colored pointers + load barriers**, is **64-bit only**, and
  scales to multi-TB heaps; generational since JDK 21.
- **Shenandoah** uses **forwarding pointers / load-reference barriers** and works
  well on more modest heaps; it added a generational mode more recently
  (experimental).
- In practice they overlap heavily; choice often comes down to distribution
  availability, heap size, and benchmarking your specific workload. Neither
  targets maximum throughput.

**Trade-offs.** Like ZGC: excellent pause times at the cost of throughput and
some footprint/CPU overhead from the concurrent evacuation barriers.

---

## Choosing a garbage collector

**How to reason about it (scenario framing).** Pick based on your dominant
requirement:

| Collector | Optimizes for | Typical pause | Heap sweet spot | Cost |
|-----------|---------------|---------------|-----------------|------|
| **Serial** | Footprint, tiny heaps / single core | Long (STW) | < ~100 MB | Not scalable |
| **Parallel** | **Throughput** (batch) | Long STW, scales w/ heap | Any | Long pauses |
| **G1** (default) | Balance, predictable pauses | ~tens–200 ms goal | ~4 GB–tens of GB | Not sub-ms |
| **ZGC** | **Ultra-low latency**, huge heaps | **< 1 ms**, heap-independent | Hundreds of MB–**TBs** | CPU/throughput, footprint |
| **Shenandoah** | **Low latency**, concurrent compaction | Low ms, heap-independent | Small–large | CPU/throughput overhead |
| **Epsilon** | No-op / benchmarking | N/A (no collection) | Test only | OOM when heap fills |

Rules of thumb:
- **Throughput/batch, don't care about pauses** → Parallel GC.
- **General-purpose service, moderate heap** → G1 (the default — start here).
- **Strict tail-latency SLAs (p99 in single-digit ms), large heap** → ZGC or
  Shenandoah; benchmark both.
- Always **measure** with your real workload and JFR/GC logs
  (`-Xlog:gc*`) before switching. The right GC is empirical.

**Gotcha.** Switching to a low-pause collector can *reduce* total throughput and
*increase* CPU and memory usage. "Low pause" is not "free" — you trade wall-clock
work and RAM for latency smoothness.

---

## JIT compilation and tiered compilation

**Beginner.** The JVM does **not** interpret your code forever. HotSpot starts by
**interpreting** bytecode, profiles which methods/loops are "hot" (executed
frequently), and then **Just-In-Time (JIT) compiles** those to optimized native
machine code. This is why the JVM is "warm-up" sensitive: peak performance
arrives only after hot code is compiled.

**The two JIT compilers:**
- **C1 (client compiler)** — fast to compile, lighter optimizations. Good for
  quick startup / responsiveness.
- **C2 (server compiler)** — slower to compile, aggressive optimizations
  (inlining, escape analysis, loop unrolling, vectorization). Produces the
  fastest code but costs more compile time.

**Tiered compilation (intermediate).** Since JDK 8, **tiered compilation is
enabled by default** (`-XX:+TieredCompilation`), combining C1 and C2 across
**five levels**:

| Level | What runs |
|-------|-----------|
| 0 | Interpreter |
| 1 | C1, no profiling (for trivial methods) |
| 2 | C1 with limited (invocation/backedge) counters |
| 3 | C1 with full profiling (collects branch/type data) |
| 4 | C2 — fully optimized using level-3 profile data |

Typical path: **0 (interpret) → 3 (C1 + profiling) → 4 (C2)**. Profiling at level
3 feeds C2's optimizations. Compilation is driven by **invocation counters** and
**back-edge counters** (loop iterations); crossing thresholds triggers
compilation. On-Stack Replacement (**OSR**) lets a long-running loop be replaced
by compiled code *mid-execution* without waiting for the method to be re-entered.

**Worked example: what actually triggers C2?** Under tiered defaults the key knobs
are `-XX:Tier3InvocationThreshold` (~200), `-XX:Tier4InvocationThreshold` (~5000),
and `-XX:CompileThreshold`-style back-edge counters (loop iterations). *(These values
are approximate and version-dependent — quote the mechanism, not exact numbers.)*
Trace a method `hot(int)` called in a loop:

```
for (int i = 0; i < 20_000; i++) sum += hot(i);
```

- Calls **1..~200**: level **0**, interpreted. Invocation + back-edge counters climb.
- At **~200 invocations**: crosses Tier3 threshold → JVM queues a **level-3 (C1 +
  profiling)** compile. `hot` now runs as profiled machine code, recording branch
  probabilities and receiver types.
- At **~5000 invocations** with a hot profile: crosses Tier4 → queues a **level-4
  (C2)** compile using that profile. `hot` now runs as fully optimized code.
- **OSR twist:** if `hot` had contained its *own* long loop, the back-edge counter
  could trip a compile *while the method is still on the stack* — the JVM compiles an
  OSR version and swaps execution into it mid-loop, rather than waiting for the next
  call. That's why a single `main()` with one giant loop still gets compiled.

**Worked example: a monomorphic inline that deopts.** Suppose:

```java
interface Shape { double area(); }
// For the whole warm-up, only Circle is ever loaded.
double total(List<Shape> shapes) {
    double t = 0;
    for (Shape s : shapes) t += s.area();   // virtual call
    return t;
}
```

1. During profiling, C2 sees **every** receiver at the `s.area()` call site is a
   `Circle` → the site is **monomorphic**. C2 speculates "this is always `Circle`,"
   **inlines `Circle.area()` directly**, and drops in a cheap type guard (a "class
   check") plus an **uncommon trap** on the else branch.
2. Steady state: the loop runs inlined `Circle` arithmetic with no virtual dispatch —
   fast.
3. **Then a `Square` is loaded and enters the list.** On the next iteration the type
   guard fails → the uncommon trap fires → **deoptimization**: C2's compiled `total`
   is discarded, the frame is rebuilt for the **interpreter**, and execution resumes
   there safely.
4. The method re-profiles (now **bimorphic**), and C2 recompiles a version that
   handles both types (e.g., inlining both behind a two-way guard). **Observed
   effect:** a brief, transient latency dip right after the new class appears —
   exactly the "deopt during class loading" bump the section below warns about. This
   is *why* deopt must exist: it lets C2 make the aggressive `Circle`-only bet in the
   common case without ever being *wrong* when the assumption breaks.

**Inlining (advanced).** The single most important optimization: the compiler
copies a callee's body into the caller, eliminating call overhead and, crucially,
**enabling further optimizations** across the boundary (constant folding, escape
analysis, dead-code elimination). Controlled by heuristics and flags like
`-XX:MaxInlineSize`, `-XX:FreqInlineSize`, `-XX:InlineSmallCode`. Megamorphic
call sites (many receiver types) inhibit inlining and hurt performance.

**Deoptimization (advanced, high-value interview topic).** C2 makes
**speculative** optimizations based on the profile and current class hierarchy —
e.g., "this virtual call is monomorphic," or "this branch is never taken," or
assuming a class has no subclasses (Class Hierarchy Analysis). If an assumption
is later **invalidated** (a new class is loaded that overrides the method, an
"uncommon trap" branch is finally taken, etc.), the JVM performs
**deoptimization**: it discards the compiled code, falls back to the interpreter
(reconstructing the interpreter stack frame), and may later recompile. This is
what makes speculative optimization *safe*. Deopt storms during warm-up or after
class loading can cause temporary performance dips.

**Compiler control / observability.**
- `-XX:+PrintCompilation` — logs methods as they compile/deoptimize.
- **JITWatch** — an open-source tool that parses the HotSpot compilation log
  produced by `-XX:+UnlockDiagnosticVMOptions -XX:+LogCompilation` (an XML log)
  and visualizes inlining decisions, why methods weren't inlined, deopts, and the
  generated assembly (with `-XX:+PrintAssembly` and the hsdis disassembler).
- `-XX:-TieredCompilation` disables tiering; `-XX:TieredStopAtLevel=1` forces C1
  only (faster startup, lower peak — sometimes used for short-lived CLI tools).

**Gotcha.** Microbenchmarks that don't warm up measure the *interpreter/C1*, not
steady-state C2 code — always use **JMH** (Java Microbenchmark Harness), which
handles warm-up, dead-code elimination via `Blackhole`, and fork isolation.

---

## AOT compilation and GraalVM Native Image

**Beginner.** **Ahead-Of-Time (AOT)** compilation compiles Java to native machine
code **before** the program runs, instead of JIT-compiling at runtime. **GraalVM
Native Image** is the mainstream tool: it compiles a Java application (plus the
JDK libraries and a minimal runtime called **Substrate VM**) into a **standalone
native executable** with **no JVM required at run time**.

**The problem it solves.** A normal JVM app has slow **startup** (class loading,
verification, interpretation, then JIT warm-up) and a large baseline **memory
footprint**. For **serverless (Lambda/functions)**, **CLIs**, and
**auto-scaling microservices** where processes start/stop frequently, warm-up is
pure waste — you may kill the process before C2 even kicks in.

**Old way vs new way.**
- *Old (JVM):* ship bytecode → JVM interprets → JIT warms up → reaches peak
  throughput after seconds/minutes. Great for long-running servers.
- *New (Native Image):* compile to native binary → **starts in milliseconds**,
  **uses a fraction of the memory**, no warm-up. Frameworks like **Quarkus**,
  **Micronaut**, and **Spring Boot (Spring Native / AOT)** target this.

**Closed-world assumption (advanced — the central constraint).** Native Image
performs **static analysis at build time** and must see **all reachable code**.
Anything discovered only at runtime breaks this:
- **Reflection**, **dynamic proxies**, **JNI**, **serialization**, and
  **resources** loaded by name must be **declared in configuration** (e.g.,
  `reflect-config.json`, `resource-config.json`, or via
  `@RegisterForReflection` / the `RuntimeReflection` API / build-time metadata).
  GraalVM's **tracing agent** (`-agentlib:native-image-agent`) can auto-generate
  this config by observing a normal JVM run.
- No dynamic classloading of unknown classes at runtime; the set of classes is
  fixed at build time.
- Some initialization is moved to **build time** vs **run time** (configurable),
  which can bake state into the image incorrectly if misused.

**Trade-offs (the crux question).**

| Dimension | JVM (JIT) | GraalVM Native Image (AOT) |
|-----------|-----------|-----------------------------|
| Startup | Slow (100s of ms–seconds) | **Very fast (ms)** |
| Memory footprint | High baseline | **Low** |
| **Peak throughput** | **Higher** (C2 + runtime profiling) | Often **lower** — no runtime profile-guided JIT |
| Warm-up | Needed | None |
| Build time | Fast | **Slow** (heavy static analysis) |
| Dynamic features | Full reflection/classloading | Restricted, needs config |
| Observability | Full JFR/agents/tooling | More limited (improving) |

- **Native image helps:** serverless functions, short-lived CLIs, high-density
  microservices, scale-to-zero, cold-start-sensitive workloads, low-memory
  containers.
- **Native image hurts:** long-running, throughput-critical services (a warmed
  JVM's C2 output usually beats AOT because JIT uses *runtime* profiles and can
  speculate/deoptimize); apps that lean heavily on reflection/dynamic
  code-generation; teams that need rich runtime profiling.

**Note on nuance.** Native Image supports **Profile-Guided Optimization (PGO)**
(collect profiles from a training run, feed them back into the build) to narrow
the peak-performance gap — but this is a GraalVM feature, largely in **Oracle
GraalVM** (commercial) editions, not something the runtime JIT does automatically.

**History gotcha.** OpenJDK once had an *experimental* AOT compiler (`jaotc`,
JEP 295 in JDK 9) and an experimental Graal JIT integration via JVMCI. Both the
experimental `jaotc` AOT and the experimental Graal JIT were **removed in JDK 17
(JEP 410)**. So "AOT in modern Java" effectively means **GraalVM Native Image**,
which is a separate project — not the removed `jaotc`. (Separately, **Project
Leyden** is the newer OpenJDK effort to bring AOT-style startup improvements —
e.g., AOT class loading and caching — into the JDK itself; still evolving.)

---

## JFR and JDK Mission Control

**Beginner.** **JDK Flight Recorder (JFR)** is a **low-overhead, built-in**
profiling and event-collection framework in the JVM. It continuously records
events (allocations, GC pauses, locks, exceptions, thread states, I/O, method
samples, JIT compilation, etc.) into a **`.jfr` recording file** that you analyze
afterwards. **JDK Mission Control (JMC)** is the desktop GUI that opens `.jfr`
files and visualizes them (flame graphs, allocation profiles, automated
analysis rules).

**Why it matters.** JFR's target overhead is **~1% or less** in typical
configurations, low enough to run in **production continuously**. This is its key
advantage over heavyweight sampling/instrumenting profilers.

**Version/licensing history (interview trivia):**
- JFR originated in the **JRockit** JVM, then shipped in Oracle JDK 7/8 as a
  **commercial feature** (required `-XX:+UnlockCommercialFeatures`).
- **JDK 11** — JFR was **open-sourced** into OpenJDK (JEP 328) and made freely
  available; JMC was also open-sourced (as a separate download).
- **JDK 14** — **JFR Event Streaming** (JEP 349): consume events
  *continuously/programmatically* via `jdk.jfr.consumer` for near-real-time
  monitoring rather than only post-hoc file analysis.

**How to use it (intermediate).**
- Start at launch: `-XX:StartFlightRecording=duration=60s,filename=rec.jfr`
- On a running JVM: `jcmd <pid> JFR.start`, `JFR.dump`, `JFR.stop`.
- Custom events: extend `jdk.jfr.Event` and annotate fields with `@Label`,
  `@Category`, etc. — your app's domain events land alongside JVM events.
- Analyze with **JMC**, or on the command line with **`jfr print`** /
  **`jfr summary`**.

**Worked example: reading JFR to solve the p99 spike (follow-up #14).** You dump a
recording during the incident and run `jfr summary rec.jfr`. An *illustrative*
GC-event excerpt:

```
Event Type                         Count   Bytes/Avg Duration
jdk.GarbageCollection                412    -
jdk.G1MMU (pause target 200ms)       ...
jdk.GCPhasePause  (max)                1    1240 ms   <-- outlier
jdk.ObjectAllocationOutsideTLAB      388    avg 20.4 MB  <-- large!
jdk.G1HeapRegionInformation          ...    Humongous: 47 regions
```

Reason from evidence → hypothesis → action:

1. **Evidence:** most G1 pauses hug the 200 ms goal, but one **1240 ms** pause blows
   past it, and there's a burst of `ObjectAllocationOutsideTLAB` events averaging
   ~20 MB each, matching dozens of **Humongous** regions. On a 64 GB heap G1 sizes
   regions at 32 MB (heap/~2048, capped at 32 MB), so the humongous threshold is
   16 MB (half a region) — those ~20 MB objects are **humongous**, allocated straight
   into old-gen regions and prone to forcing expensive collections.
2. **Hypothesis:** periodic **humongous allocations** (e.g., a big buffer/array built
   every few minutes) trigger costly collections and occasional full-GC-like pauses —
   the source of the p99 spike.
3. **Action:** first, **fix the allocation** — stream/chunk the large buffer or reuse
   a pooled one so each object drops under the 16 MB humongous threshold (region size
   is already at G1's 32 MB cap here, so you can't just raise `-XX:G1HeapRegionSize`
   to grow past it). If pauses must be flat regardless of allocation shape, **switch
   to generational ZGC** (`-XX:+UseZGC`) — its pauses are heap-independent. Re-measure
   with a fresh recording to confirm the outlier is gone.

**JFR vs traditional profilers (advanced).** Traditional sampling profilers
(e.g., attaching via JVMTI) often suffer **safepoint bias** — samples are only
taken at safepoints, skewing results. JFR uses the JVM's internal sampling and
event infrastructure with far lower and more predictable overhead, and captures
*context* (GC, allocation, lock contention, JIT) that a pure CPU sampler misses.
`async-profiler` is a popular complementary open-source tool that avoids
safepoint bias for CPU profiling and can also emit JFR-format output.

**Gotcha.** JFR is **not** a real-time alerting system by default (though event
streaming narrows that gap); it is primarily for **diagnosis** — capture during
an incident or run continuously and dump the buffer when something goes wrong.
Method profiling in JFR is *sampled*, so it shows statistical hot spots, not an
exact call count.

---

## Common interview follow-up questions

1. **Why can ZGC keep pauses sub-millisecond regardless of heap size, while G1
   pauses grow with the heap?** (Colored pointers + load barriers enable
   concurrent relocation; G1's evacuation and final mark are STW.)
2. **What is a load barrier and how does it differ from a write/SATB barrier?**
3. **What did Generational ZGC (JDK 21) change and why does the generational
   hypothesis make it more efficient?**
4. **Compare ZGC and Shenandoah — mechanisms, heap sizes, bitness.**
5. **Walk through tiered compilation levels 0–4. What triggers a compilation?
   What is OSR?**
6. **What is deoptimization and why is it *required* for aggressive speculative
   JIT optimization to be correct?**
7. **Why is inlining considered the "mother of all optimizations"? What inhibits
   it (megamorphic call sites, large methods)?**
8. **When does GraalVM Native Image *hurt* rather than help?** (Long-running
   throughput services; reflection-heavy apps.)
9. **Explain the closed-world assumption and how you handle reflection under
   Native Image** (build-time config / tracing agent).
10. **Why was JFR historically "commercial," and what changed in JDK 11?**
11. **Why does JFR run at ~1% overhead when other profilers cost much more?**
    (Safepoint bias, built-in event infra.)
12. **Which Java version made ZGC / Shenandoah production-ready?** (JDK 15 for
    both.)
13. **What happened to `jaotc` / experimental AOT and the Graal JIT?** (Removed
    in JDK 17, JEP 410.)
14. **You have a p99 latency spike every few minutes on a 64 GB heap under G1 —
    how would you investigate and what would you try?** (GC logs/JFR → maybe
    switch to ZGC/generational ZGC; check humongous allocations.)

---

## References

- **JEP 248**: Make G1 the Default Garbage Collector (JDK 9).
- **JEP 291**: Deprecate the Concurrent Mark Sweep (CMS) GC (JDK 9).
- **JEP 363**: Remove the CMS Garbage Collector (JDK 14).
- **JEP 333**: ZGC: A Scalable Low-Latency Garbage Collector (Experimental, JDK 11).
- **JEP 377**: ZGC: A Scalable Low-Latency Garbage Collector (Production, JDK 15).
- **JEP 439**: Generational ZGC (JDK 21).
- **JEP 189**: Shenandoah: A Low-Pause-Time GC (Experimental, JDK 12).
- **JEP 379**: Shenandoah: A Low-Pause-Time GC (Production, JDK 15).
- **JEP 318**: Epsilon: A No-Op Garbage Collector (JDK 11).
- **JEP 295**: Ahead-of-Time Compilation (`jaotc`, experimental, JDK 9).
- **JEP 410**: Remove the Experimental AOT and JIT Compiler (JDK 17).
- **JEP 328**: Flight Recorder (open-sourced, JDK 11).
- **JEP 349**: JFR Event Streaming (JDK 14).
- Oracle: *HotSpot Virtual Machine Garbage Collection Tuning Guide*.
- Oracle: *Java Virtual Machine Guide — Tiered Compilation*.
- GraalVM documentation: *Native Image*, *Reflection Configuration*, *Native
  Image Build Configuration*, *Profile-Guided Optimizations (PGO)*.
- JDK Mission Control and JDK Flight Recorder documentation.
- JITWatch project (AdoptOpenJDK/`AdoptOpenJDK/jitwatch`).
- OpenJDK Project Leyden (AOT/startup improvements in the JDK).
