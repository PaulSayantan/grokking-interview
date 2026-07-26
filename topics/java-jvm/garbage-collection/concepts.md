# Garbage Collection

Garbage Collection (GC) is the JVM's automatic memory management subsystem. It reclaims heap
memory occupied by objects that are no longer reachable by the running program, freeing developers
from manual `malloc`/`free` bookkeeping and eliminating whole classes of bugs (dangling pointers,
double-frees, most leaks). The trade-off is that GC runs concurrently or in pauses that the
application does not fully control, so understanding **how** collectors work is essential for tuning
latency-sensitive and throughput-sensitive systems.

This note builds up from *what makes an object garbage* through the classic algorithms, the
generational model, each production collector (Serial, Parallel, G1, ZGC, Shenandoah), and finally
tuning, reference types, and logging.

---

## GC roots and reachability

The fundamental question GC answers is: **which objects are still in use?** The JVM does *not* use
reference counting (which cannot collect cycles); it uses **reachability analysis** (also called
tracing).

An object is **live (reachable)** if it can be reached by following a chain of references starting
from a **GC root**. Everything else is **garbage**, even if objects reference each other in a cycle.

**GC roots** are the entry points the collector treats as "definitely live":

- **Local variables and operands** on the stacks of every live thread (including method parameters).
- **Active thread objects** themselves.
- **Static fields** of loaded classes (reachable via the class, held by its class loader).
- **JNI references** (local and global) held by native code.
- **Monitors** used for synchronization (objects locked via `synchronized`).
- Certain internal structures (interned `String`s in some setups, the system class loader, etc.).

```
   GC Roots
   ┌───────────┐        ┌───────┐        ┌───────┐
   │ thread    │──────▶ │  A    │──────▶ │  B    │      (A, B reachable → LIVE)
   │ stack var │        └───────┘        └───────┘
   └───────────┘
                        ┌───────┐        ┌───────┐
                        │  C    │◀──────▶│  D    │      (C↔D cycle, no root → GARBAGE)
                        └───────┘        └───────┘
```

**Why cycles are collected:** because reachability starts from roots, an island of mutually
referencing objects with no path from a root is unreachable and therefore collectable. This is the
key advantage over reference counting.

**Advanced note — safepoints:** the collector can only reliably enumerate GC roots when application
threads are at a **safepoint** (a well-defined point where the thread's stack map is known: method
entries/returns, loop back-edges, allocation points). "Bringing threads to a safepoint" is what a
stop-the-world (STW) pause actually does. A thread stuck in a long counted loop with no safepoint
poll can delay the whole VM ("time-to-safepoint" latency), which is a real production pathology.

---

## Mark sweep and compact

The classic tracing algorithm has up to three phases:

1. **Mark** — starting from GC roots, traverse the object graph and mark every reachable object
   live (typically a bit in the object header or a side "mark bitmap").
2. **Sweep** — scan the heap; any object not marked is garbage and its space is reclaimed onto a
   free list.
3. **Compact** (optional) — relocate live objects so they sit contiguously, eliminating
   fragmentation and enabling fast **bump-the-pointer** allocation afterward.

| Variant | Fragmentation | Allocation cost | Moving? | Notes |
|---|---|---|---|---|
| Mark-Sweep | High (free lists) | Slower (find-fit) | No | Simple; fragmentation degrades over time |
| Mark-Compact | None | Fast (bump pointer) | Yes | Extra pass to slide/relocate objects |
| Copying (semi-space) | None | Fast (bump pointer) | Yes | Wastes half the space; great for sparse survivors |

**Copying collection** divides a region into two halves; live objects are copied from "from-space"
to "to-space", then the roles flip. Cost is proportional to the number of **live** objects, not the
heap size, which is why it shines when most objects die young (the generational hypothesis).

**Why moving matters:** after compaction/copying, allocation is just `pointer += size` (bump the
pointer) — extremely cheap. Non-moving collectors must search free lists, and fragmentation can
eventually cause allocation failures even when total free memory is sufficient.

**Trade-off:** moving collectors must update every reference to relocated objects, which
historically required an STW pause. Modern collectors (ZGC, Shenandoah) do this concurrently using
**load/read barriers** and forwarding pointers.

---

## Generational hypothesis

The **weak generational hypothesis** states: *most objects die young.* Empirically, the vast
majority of allocations (loop temporaries, request-scoped objects, boxing, iterators) become garbage
almost immediately, while a small fraction live a long time (caches, singletons, session state).

The JVM exploits this by splitting the heap into generations:

- **Young generation** — where new objects are allocated. Subdivided into **Eden** and two
  **Survivor** spaces (S0/S1). Collected frequently and cheaply.
- **Old generation (Tenured)** — objects that survive enough young collections are **promoted** here.
  Collected infrequently but more expensively.

```
Young Generation                         Old Generation
┌──────────────┬────────┬────────┐      ┌──────────────────────────┐
│    Eden      │  S0    │  S1    │      │       Tenured            │
└──────────────┴────────┴────────┘      └──────────────────────────┘
   allocate here  survivor spaces           long-lived / promoted
```

**Allocation and aging:** new objects go into Eden. A minor GC copies survivors from Eden + the
active survivor space into the *other* survivor space, incrementing each object's **age**. When an
object's age exceeds `MaxTenuringThreshold` (default **15**, or the survivor space overflows), it is
**promoted** to Old. Large objects may be allocated directly in Old (or in G1/ZGC as
**humongous**/large objects).

**How allocation stays fast *and* thread-safe — TLABs.** If Eden allocation is just "bump a shared
pointer," how do hundreds of threads bump it at once without a lock on every `new`? The answer is the
**Thread-Local Allocation Buffer**: each thread is handed its own private slab of Eden (say 512 KB)
and bumps *its own* pointer with no synchronization at all — allocation is a pointer add and a bounds
check, effectively lock-free. Only when a thread's TLAB is exhausted does it hit the shared path
(a single atomic bump to carve a fresh TLAB out of Eden), and objects too big for a TLAB are
allocated straight into shared Eden (or Old). This is why allocation rate is cheap until you either
churn through TLABs quickly or allocate many large objects.

> [!KEY-TAKEAWAY]
> **Worked minor-GC trace.** Heap: Eden = 256 MB, S0 = S1 = 32 MB, `MaxTenuringThreshold = 15`,
> and assume ~5% of each Eden's worth of objects is still live at collection time.
>
> - **Threads allocate** into Eden (via their TLABs) until Eden's 256 MB is full → **minor GC #1** fires.
> - GC traces live objects. Live ≈ 5% × 256 MB ≈ **12.8 MB**. It **copies** those (plus anything live in
>   the active survivor space, S0 — empty on the first pass) into **S1**, sets their **age = 1**, then
>   wipes Eden and S0 in one shot (just reset the bump pointers — nothing to sweep).
>   S1 now holds ~12.8 MB of a 32 MB space. Cost was proportional to the **12.8 MB copied**, not the 256 MB scanned.
> - Eden fills again → **minor GC #2**: copies Eden's new ~12.8 MB of survivors *and* whatever of S1's
>   objects are still alive into **S0** (roles flip). Objects that came from S1 age **1 → 2**; fresh
>   Eden survivors get age 1. Repeat, flipping S0↔S1 each time.
> - An object referenced by a long-lived cache keeps surviving. After it lives through **15** minor GCs
>   its age is 15; on the **16th**, age would exceed `MaxTenuringThreshold = 15`, so instead of copying
>   it into a survivor space again the GC **promotes** it to Old. That is the intended path: short-lived
>   garbage never leaves Eden; genuinely long-lived objects graduate to Old after ~15 cycles.
>
> **Premature-promotion case (the pathology).** Now suppose a traffic spike leaves **40 MB** live after
> one minor GC, but the target survivor space is only **32 MB**. The 32 MB fits; the extra **8 MB
> overflows** and is promoted straight to Old at **age 1** — far too young. Worse, HotSpot targets only
> ~50% survivor occupancy (`TargetSurvivorRatio`), so when survivors blow past ~16 MB it **dynamically
> lowers the effective tenuring threshold** (e.g. to 2 or 3), promoting *even more* objects early. The
> result is **old-gen fills up with objects that were about to die** → frequent old-gen/full GCs and
> latency spikes. The fix is usually a bigger young gen (or survivor spaces), not more old gen.

**Why generations help:** collecting only the young gen means work proportional to the few live
young objects, not the whole heap — very cheap and frequent. The old gen is scanned rarely.

**The catch — cross-generational references (old → young).** A minor GC must treat old-gen
references *into* the young gen as roots, but scanning all of old gen would defeat the purpose. The
solution is a **write barrier** that records such references in a **card table** (Parallel/G1 mark
"dirty cards") or **remembered sets** (per-region, G1/ZGC). The minor GC only scans dirty cards.

**Worked card-table trace.** Divide the heap into fixed **512-byte cards**; the card table is a
byte array with one entry per card (so a 1 GB old gen needs a ~2 MB table — cheap). Now the app runs
`oldObj.cache = youngObj` where `oldObj` sits in old gen. On that field write the JIT-emitted **write
barrier** fires: it computes the card for `oldObj`'s address (`cardIndex = (oldObj_addr - heapBase) >> 9`,
since 2⁹ = 512) and stamps `cardTable[cardIndex] = DIRTY`. At the next minor GC the collector does
**not** walk the entire old gen looking for old→young pointers; it scans only the handful of cards
marked dirty, treats the old→young references it finds there as extra roots, and clears the marks.
Concretely: with a 4 GB old gen that would be ~8 million cards, but if only 300 fields were written
since the last GC, the collector inspects ~300 cards instead of 8 million — that is the whole point.
G1 refines this with a **per-region remembered set** that tracks which regions hold references *into*
a given region (finer-grained, so it can collect one region without scanning others), at the cost of
more bookkeeping than a single global card table.

- **Historical note (JDK 8, PermGen removed):** the permanent generation (class metadata) was
  removed in Java 8 and replaced by **Metaspace**, which lives in native memory. This is not part of
  the young/old heap and is collected differently (on class-loader unloading).

Note: **Non-generational collectors also exist** — the Z and Shenandoah collectors were originally
non-generational (a "concurrent mark-region" model); generational modes were added later (see below).

---

## Minor major and full GC

Terminology is often muddled in interviews; be precise:

| Term | What it collects | Cost | Trigger |
|---|---|---|---|
| **Minor GC** (young GC) | Young generation only | Cheap, frequent | Eden fills up |
| **Major GC** | Old generation | Expensive | Old gen occupancy threshold |
| **Full GC** | Entire heap (young + old) + often Metaspace | Most expensive; usually STW | Old gen full, promotion failure, `System.gc()`, Metaspace pressure |

- A **minor GC is always a stop-the-world event** in the HotSpot generational collectors (Serial,
  Parallel, G1) — but it is short because the young gen is small.
- **"Major" vs "Full" is fuzzy.** Many people use them interchangeably. Precisely: a *major* GC
  targets old gen; a *full* GC collects the whole heap and is the worst case. G1's **Full GC** is a
  fallback (single-threaded until JDK 10, then parallel — JEP 307) that indicates the concurrent
  cycle couldn't keep up.
- **`System.gc()`** requests a full GC (usually). It is a *hint*; it can be disabled with
  `-XX:+DisableExplicitGC`. Avoid calling it in production code.
- **Promotion failure / concurrent mode failure:** if the old gen can't accept promoted objects, a
  cheap young GC degrades into an expensive full GC — a classic latency spike source.

---

## Serial collector

`-XX:+UseSerialGC`

- **Single-threaded** for both young (copying) and old (mark-compact) collection.
- **Stops the world** for the entire collection; uses exactly one CPU.
- Smallest footprint and lowest overhead of any collector — no threading/coordination cost.

**When to use:** small heaps (up to a few hundred MB), single-core or constrained containers, and
short-lived JVMs (CLI tools, batch jobs) where pause times don't matter. It is the **default in
certain small container/client environments** (ergonomics: single processor and <~1792MB heap).
Great for microservices with tiny heaps where GC threads would just add overhead.

---

## Parallel collector

`-XX:+UseParallelGC` (a.k.a. "Throughput Collector"; young + old both parallelized)

- **Multi-threaded** STW collection: young = parallel copying, old = parallel mark-compact.
- Optimizes for **throughput** (maximize application time / total time), *not* pause time.
- Was the **default from Java 5 through Java 8**; replaced by G1 as default in **Java 9** (JEP 248).

**Key flags:**
- `-XX:MaxGCPauseMillis=<n>` — soft pause goal.
- `-XX:GCTimeRatio=<n>` — throughput goal (GC time = 1/(1+n)).
- `-XX:ParallelGCThreads=<n>` — number of GC worker threads.

**When to use:** batch processing, analytics, scientific compute — anything where total completion
time matters more than individual pause length, and multi-second pauses are acceptable. It still
often wins on raw throughput because it does no concurrent bookkeeping.

---

## CMS collector removed

**Concurrent Mark Sweep** (`-XX:+UseConcMarkSweepGC`) was the first mainstream *low-pause* collector.

- Did most of its **marking concurrently** with the application, keeping the two STW phases (initial
  mark, remark) short.
- **Non-compacting** old-gen collector → suffered **fragmentation**, which could trigger a slow,
  single-threaded **full GC** ("concurrent mode failure") to compact.
- Complex, many tuning knobs, and stole CPU from the application.

**Version history — be precise:**
- **Deprecated in JDK 9** (JEP 291).
- **Removed in JDK 14** (JEP 363). It does not exist in JDK 17 or JDK 21. Passing
  `-XX:+UseConcMarkSweepGC` on a modern JDK is ignored with a warning (or refused).

**Successor:** G1 was designed to replace CMS with a compacting, region-based, pause-target design.
For true low-latency, ZGC/Shenandoah superseded both.

---

## G1 collector

**Garbage-First** (`-XX:+UseG1GC`) — the **default collector since JDK 9** (JEP 248).

**Model:** the heap is divided into ~2048 equal-size **regions** (1–32 MB each). Regions are tagged
dynamically as Eden, Survivor, Old, or **Humongous** (for objects ≥ 50% of a region size).
Generations are *logical sets of regions*, not contiguous memory blocks.

**Garbage-first strategy:** G1 concurrently marks the heap, then prioritizes collecting the regions
with the **most garbage** first — maximizing reclaimed space per unit of pause time. It uses
**remembered sets** per region to track incoming references so it can collect a subset of regions
(a **collection set**) without scanning the whole heap.

**Collection types:**
- **Young GC** — STW, evacuates (copies) live objects from young regions.
- **Mixed GC** — STW, collects all young regions plus a chosen set of old regions with high garbage.
- **Concurrent marking cycle** — mostly concurrent, with short STW phases (initial mark piggybacks
  on a young GC; remark; cleanup).
- **Full GC** — fallback; **parallel since JDK 10** (JEP 307), previously single-threaded.

**G1 is a compacting collector** (it evacuates/copies live objects), so it does not suffer CMS-style
fragmentation.

**Key flags:**
- `-XX:MaxGCPauseMillis=200` — the pause-time *goal* (default 200ms); G1 sizes the collection set to
  try to meet it. It is a **target, not a guarantee.**
- `-XX:G1HeapRegionSize=<n>` — region size.
- `-XX:InitiatingHeapOccupancyPercent` (IHOP, default 45) — old-gen occupancy that starts a
  concurrent marking cycle.

**When to use:** the general-purpose default for **large multi-GB heaps** where you want a balance of
throughput and predictable, moderate pauses (tens to low-hundreds of ms). Good for most server apps.

---

## ZGC collector

`-XX:+UseZGC` — a **scalable, ultra-low-latency** collector.

- **Concurrent everything:** marking, relocation/compaction, and reference processing all happen
  **concurrently** with the application. STW pauses are sub-millisecond and **do not grow with heap
  size** — they are O(roots), not O(heap).
- Target: **max pause times under ~1 ms** (originally "under 10ms"), on heaps from a few hundred MB
  up to **16 TB**.
- Uses **colored pointers** (metadata bits stored in the 64-bit reference) and **load barriers** to
  relocate objects concurrently and "self-heal" references. (ZGC is 64-bit only.)

**How concurrent relocation actually works (load-barrier trace).** The hard question: if the GC moves
object `X` from address `A` to `A'` *while the app is running*, what stops a thread from reading the
stale copy at `A`? A **colored pointer** reserves a few high bits of every reference as metadata
(marked, remapped, etc.), and *every time application code loads a reference*, a **load barrier**
runs first. Trace one read:
> 1. GC is relocating `X`: it copies `X` from `A` to `A'` and leaves a **forwarding pointer** at the
>    old slot `A` saying "I now live at `A'`."
> 2. A mutator thread executes `Point p = obj.location;` — this loads a reference still pointing at `A`
>    and tagged with a stale color. The load barrier inspects the color, sees the "not yet remapped"
>    bit set → **slow path**.
> 3. The barrier follows the forwarding pointer at `A` to `A'`, and — crucially — **writes `A'` back
>    into `obj.location`** ("self-healing"). The thread proceeds with the correct, current address.
> 4. The *next* time any thread loads `obj.location`, the color is already good → **fast path**, no
>    fix-up. So each stale reference is repaired at most once, lazily, by whoever touches it first.
>
> Shenandoah reaches the same goal differently: historically a **Brooks forwarding pointer** (an extra
> header word on every object that points to its current location — to itself if not moved) plus a
> **load-reference barrier**; a read dereferences through that word so it always lands on the live copy.
> Either way the STW work is only O(roots), because the expensive part — visiting and repointing the
> whole heap — happens lazily and concurrently as the app dereferences things.

**Version history — be precise:**
- **Experimental in JDK 11** (JEP 333), Linux/x64 only.
- **Production-ready in JDK 15** (JEP 377).
- **Generational ZGC in JDK 21** (JEP 439) — adds young/old generations for far better efficiency.
  In JDK 21 you opt in with `-XX:+UseZGC -XX:+ZGenerational`; the older non-generational mode is
  still the default when you pass `-XX:+UseZGC` alone (non-generational ZGC is deprecated for removal
  in later releases). Generational is the recommended mode.

**When to use:** latency-critical services (trading, ad-serving, low-latency APIs) and **very large
heaps** where G1 pauses would be too long or too variable. You trade some throughput and a bit of
extra CPU/memory (barriers) for consistently tiny pauses.

---

## Shenandoah collector

`-XX:+UseShenandoahGC` — a **low-pause-time** collector developed by Red Hat.

- Like ZGC, performs **concurrent compaction/evacuation** so pause times are independent of heap
  size. Uses **Brooks forwarding pointers** (historically) and **load reference barriers** to move
  objects while the application runs.
- Pause goals in the **sub-millisecond to low-single-digit-ms** range.

**Version history:**
- Available experimentally from JDK 12 (JEP 189); backported to JDK 8/11 builds by some vendors.
- **Production-ready in JDK 15** (JEP 379).
- Works on 32-bit and 64-bit; historically available across more architectures than ZGC.
- Note: **not included in Oracle's builds of the JDK** — it ships in OpenJDK builds from Red Hat,
  Adoptium/Temurin, Amazon Corretto, etc.

**ZGC vs Shenandoah:** both target consistent low pauses via concurrent compaction. ZGC uses colored
pointers (64-bit only) and scales to multi-TB heaps with O(roots) pauses; Shenandoah uses forwarding
pointers + load barriers and runs on more platforms. In practice pick based on your JDK vendor,
heap size, and benchmarking your workload.

---

## Stop the world and pause time goals

A **stop-the-world (STW) pause** is when the JVM suspends *all* application (mutator) threads so the
collector can work on a consistent view of the heap. Every collector has *some* STW work; they
differ in **how much** and whether the expensive phases are concurrent.

- The JVM cannot stop threads instantly — it must bring them to a **safepoint** first
  ("time-to-safepoint"). A thread in a tight counted loop or a long native call can delay this.
- **Pause-time goal** (`-XX:MaxGCPauseMillis`) is a *soft target*, not a hard real-time guarantee. G1
  and Parallel adjust generation sizes and collection-set size to try to meet it; missing it (e.g.,
  during a full GC) is still possible.

| Collector | STW phases | Pause scales with |
|---|---|---|
| Serial / Parallel | Entire collection | Heap / live-set size |
| G1 | Young/mixed evac, short mark pauses | Collection-set size (bounded by goal) |
| ZGC | Only root scanning (sub-ms) | Number of GC roots (≈ threads) |
| Shenandoah | Init/final mark (sub-ms) | Number of GC roots |

**Interview framing:** "concurrent" does not mean "zero pause" — it means the *bulk* of the work
(marking, relocation) overlaps with the application, leaving only tiny STW segments.

---

## Throughput versus latency

This is the central GC trade-off and a favorite interview theme.

- **Throughput** = fraction of total time spent running application code (not GC). Maximized by
  doing GC work in big efficient batches, even if each pause is long. **Parallel GC** wins here.

**Worked throughput math (read it off a GC log).** Over a **60 s** (60,000 ms) window you observe
**10 minor GCs at 20 ms each** plus **1 full GC of 400 ms**. Total GC time = 10 × 20 + 400 = **600 ms**.
Throughput = (60,000 − 600) / 60,000 = 59,400 / 60,000 = **99.0%**, i.e. **1.0% GC overhead**. Common
targets are **>95%** (comfortable) up to **>99%** (throughput-critical). This ties directly to
`-XX:GCTimeRatio=n`, which sets a goal of GC time = 1/(1+n): to target that same 1% overhead you set
**n = 99** (1/(1+99) = 1/100 = 1%); the default `n = 99` for Parallel GC is exactly this 1% goal,
while a laxer `n = 19` would allow 1/20 = 5% GC time. Note that latency and throughput can disagree:
that single 400 ms full GC barely dents throughput (still 99%) yet may blow a p99.9 latency SLA — so
always look at *both* the aggregate percentage *and* the worst individual pause.
- **Latency** = length and predictability of individual pauses (tail latency, p99/p99.9). Minimized
  by doing work concurrently in small increments. **ZGC/Shenandoah** win here.
- **Footprint** = memory/CPU overhead. Concurrent collectors use more (barriers, extra heap headroom,
  GC threads competing with the app for CPU).

You generally cannot maximize all three. Think of it as a triangle: **throughput, latency, footprint —
pick your priorities.**

| Priority | Recommended collector |
|---|---|
| Max throughput, pauses OK (batch/ETL) | Parallel |
| Balanced, general server, large heap | G1 (default) |
| Lowest/most predictable pauses, huge heap | ZGC (generational) or Shenandoah |
| Tiny heap / single core / short-lived JVM | Serial |

**Rules of thumb:** more frequent GC → lower per-pause time but lower throughput. Bigger young gen →
higher throughput but longer minor pauses and more promotion delay. Always **measure with GC logs
against a representative workload** before committing to a collector or flags.

---

## Reference types

`java.lang.ref` (since Java 1.2) lets you interact with reachability. Ordered from strongest to
weakest:

1. **Strong reference** — the normal case (`Object o = new Object();`). An object with any strong
   reference chain from a root is **never** collected.
2. **Soft reference** (`SoftReference<T>`) — collected only when the JVM is under **memory pressure**
   (approaching OOM). Ideal for **memory-sensitive caches** — the GC clears them as a last resort
   before throwing `OutOfMemoryError`.
3. **Weak reference** (`WeakReference<T>`) — collected **eagerly** at the next GC once no strong/soft
   references remain. Used by `WeakHashMap` for canonicalizing maps / metadata keyed on objects that
   should not be kept alive by the map.
4. **Phantom reference** (`PhantomReference<T>`) — `get()` **always returns `null`**. Enqueued in a
   `ReferenceQueue` *after* the object is finalized and its memory is about to be reclaimed. Used for
   **post-mortem cleanup** as a safe replacement for finalizers.

| Type | Cleared when | `get()` | Typical use |
|---|---|---|---|
| Strong | Never (while reachable) | object | normal references |
| Soft | Under memory pressure | object or null | memory-sensitive caches |
| Weak | Next GC once weakly reachable | object or null | `WeakHashMap`, canonical maps |
| Phantom | After finalization, pre-reclaim | always null | scheduled/native cleanup |

```java
ReferenceQueue<Object> queue = new ReferenceQueue<>();
Object obj = new Object();
WeakReference<Object> weak = new WeakReference<>(obj, queue);
obj = null;                       // drop the strong reference
System.gc();                      // hint: obj is now weakly reachable
// After GC: weak.get() may return null; the ref may be enqueued in `queue`.
```

**Reachability levels (JLS/GC terminology):** an object is *strongly*, *softly*, *weakly*,
*phantom*, or *un*reachable. The GC clears/enqueues references based on the weakest level at which
the object is reachable. A **`ReferenceQueue`** lets you learn *when* a referent has been collected
so you can clean up associated resources.

**Gotcha:** holding a `SoftReference` does not guarantee caching — under low memory the entries
vanish; under abundant memory they can outlive their usefulness. `WeakHashMap` keys are weak but
*values* are strong (a value referencing its key defeats the map — a classic leak).

---

## Finalization deprecation

`Object.finalize()` was the original mechanism for object cleanup, but it is fundamentally broken:

- **No guarantee it ever runs**, or when — the JVM may exit first.
- Runs on an **unspecified finalizer thread**; a slow/blocked finalizer stalls the queue and leaks.
- **Resurrection:** a finalizer can make the object reachable again, complicating GC (objects need an
  extra GC cycle to collect).
- **Security and performance** problems; exceptions in finalizers are swallowed.

**Version history — be precise:**
- **`finalize()` deprecated in JDK 9.**
- **Finalization deprecated for removal in JDK 18** (JEP 421); a future release will remove it, and
  it can already be disabled at runtime with `--finalization=disabled`.

**Modern replacements:**
- **`try-with-resources` + `AutoCloseable`** (Java 7) — the primary, deterministic way to release
  resources. Cleanup happens exactly when the block exits.
- **`java.lang.ref.Cleaner`** (**since Java 9**) — register a cleaning action tied to an object's
  phantom-reachability; runs on a dedicated thread when the object becomes unreachable. A safe
  backstop for native resources (not a substitute for `close()`).

```java
// OLD (broken): don't do this
@Override protected void finalize() { closeNativeHandle(); }

// NEW: deterministic
try (var in = Files.newInputStream(path)) { /* use in */ }   // auto-closed

// NEW: Cleaner as a safety net (Java 9+)
private static final Cleaner CLEANER = Cleaner.create();
CLEANER.register(this, () -> closeNativeHandle(handle));      // action must NOT capture `this`
```

**Gotcha:** a `Cleaner` action must not reference the object it cleans (capturing `this` keeps it
reachable forever, so cleanup never runs). Use a static nested state-holder class.

---

## GC tuning and logging basics

**First rule: measure, don't guess.** Choose a collector to match your goal, then tune with data
from GC logs and profilers. Premature GC tuning is a classic anti-pattern.

**Core sizing flags:**
- `-Xms` / `-Xmx` — initial / maximum heap. Setting `-Xms = -Xmx` avoids resize pauses in servers.
- `-Xmn` / `-XX:NewRatio` — young-gen size / old:young ratio.
- `-XX:MaxMetaspaceSize` — cap Metaspace (native class metadata).
- `-XX:MaxGCPauseMillis` — soft pause goal (G1/Parallel).
- `-XX:+UseStringDeduplication` — G1 can dedup identical `char[]`/`byte[]` backing `String`s.
- **Container awareness:** modern JDKs read cgroup limits; `-XX:MaxRAMPercentage` sizes the heap as a
  fraction of container memory (preferred over hardcoding `-Xmx` in containers).

**Unified GC logging (`-Xlog`) — a JDK 9+ change (JEP 158/271). Be precise:**
- **Old (JDK 8 and earlier):** `-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log` — these are
  **removed in JDK 9+**.
- **New (JDK 9+):** the unified `-Xlog` framework:

```
-Xlog:gc*                                  # all GC logging, info level, to stdout
-Xlog:gc*:file=gc.log:time,uptime,level,tags:filecount=5,filesize=10m
-Xlog:gc+heap=debug                        # per-generation heap details
```

The `-Xlog` syntax is `-Xlog:<selectors>:<output>:<decorators>:<output-options>`.

**Analyzing logs:** look for GC **frequency**, **pause durations** (and the p99 tail), **promotion
rate**, **full GC occurrences** (bad — indicates the concurrent cycle can't keep up or a promotion
failure), and **allocation rate**. Tools: GCeasy, GCViewer, JDK Mission Control (JMC), `jstat -gc`.

**Common symptoms → cause:**
- Frequent full GCs, heap fills right after → real memory leak (heap dump + `jmap`/MAT/`jhat`).
- Long, growing pauses on G1 → heap too small, humongous-object churn, or IHOP too high.
- High allocation rate → reduce garbage (object pooling only where measured, avoid boxing).
- `OutOfMemoryError: Metaspace` → class-loader leak (common in redeploying app servers).

**Diagnostic tools:** `jstat`, `jcmd <pid> GC.heap_info`, `jcmd <pid> GC.run`, `jmap`
(heap dump), Java Flight Recorder (`-XX:+FlightRecorder`, JFR) + JDK Mission Control.

---

## Common interview follow-up questions

1. Why does Java use reachability tracing instead of reference counting? (Cycles.)
2. Walk through what happens on a minor GC: Eden → survivor copying, aging, promotion.
3. What is the generational hypothesis and how do Eden/Survivor/Tenured exploit it?
4. Difference between minor, major, and full GC? Which are always STW?
5. Why was CMS removed, and what replaced it? (Fragmentation → full GC; G1/ZGC/Shenandoah.)
6. How does G1 achieve bounded pauses? (Regions + remembered sets + garbage-first collection set.)
7. How do ZGC and Shenandoah keep pauses sub-millisecond regardless of heap size? (Concurrent
   relocation via load/read barriers; pauses O(roots).)
8. When would you pick Parallel over G1? (Throughput-first batch jobs.)
9. Explain the four reference types and give a real use for each.
10. Why is `finalize()` deprecated, and what should you use instead? (`AutoCloseable`, `Cleaner`.)
11. What are GC roots? Name five kinds.
12. What is a safepoint and how does it relate to STW pauses and time-to-safepoint?
13. What changed about GC logging in JDK 9? (`-Xlog` unified logging; old flags removed.)
14. How do write barriers and card tables / remembered sets solve old→young references?
15. Which Java version made generational ZGC available and how do you enable it? (JDK 21, JEP 439,
    `-XX:+UseZGC -XX:+ZGenerational`.)
16. Does every `new` allocate on the heap? (No — the JIT's **escape analysis** can prove an object
    never escapes its method, then apply **scalar replacement** to explode it into local variables in
    registers/stack, eliminating the allocation entirely. It's opportunistic and not guaranteed, so
    treat it as a bonus, not a design assumption.)

## References

- JEP 248: Make G1 the Default Garbage Collector (JDK 9).
- JEP 291: Deprecate the Concurrent Mark Sweep (CMS) Garbage Collector (JDK 9).
- JEP 363: Remove the Concurrent Mark Sweep (CMS) Garbage Collector (JDK 14).
- JEP 307: Parallel Full GC for G1 (JDK 10).
- JEP 333: ZGC: A Scalable Low-Latency Garbage Collector (Experimental) (JDK 11).
- JEP 377: ZGC: A Scalable Low-Latency Garbage Collector (Production) (JDK 15).
- JEP 379: Shenandoah: A Low-Pause-Time Garbage Collector (Production) (JDK 15).
- JEP 439: Generational ZGC (JDK 21).
- JEP 421: Deprecate Finalization for Removal (JDK 18).
- JEP 158: Unified JVM Logging; JEP 271: Unified GC Logging (JDK 9).
- Oracle: "HotSpot Virtual Machine Garbage Collection Tuning Guide" (JDK 17/21).
- The Java Language Specification and `java.lang.ref` package documentation (reachability, reference
  types, `Cleaner`, `ReferenceQueue`).
