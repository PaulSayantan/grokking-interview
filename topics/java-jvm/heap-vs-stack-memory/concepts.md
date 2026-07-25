# JVM Memory Model: Heap versus Stack

Every Java interview about memory eventually comes down to one question: **where does this object /
variable actually live, and who cleans it up?** The JVM splits runtime memory into several regions
defined by the *Java Virtual Machine Specification* (JVMS §2.5). The two most important — and most
frequently confused — are the **heap** (one shared region for all objects, managed by the garbage
collector) and the **stack** (one per thread, holding method call frames and destroyed automatically
when a method returns).

This guide is layered: each section opens with the beginner definition and motivation, moves through
intermediate usage and comparisons, and closes with advanced internals, edge cases, and gotchas.
Version-specific facts are tagged explicitly (e.g. "Since JDK 8") because interviewers love
version-accuracy questions — the biggest one here is the removal of **PermGen** in favor of
**Metaspace** in **Java 8 (2014)**.

**JVM runtime data areas at a glance:**

| Region | Shared or per-thread | Holds | Reclaimed by | OOME on exhaustion |
|---|---|---|---|---|
| **Heap** | Shared | All objects, arrays, instance fields | Garbage collector | `OutOfMemoryError: Java heap space` |
| **Metaspace** (JDK 8+) | Shared | Class metadata, method bytecode | GC (class unloading) | `OutOfMemoryError: Metaspace` |
| **JVM (Java) stack** | Per-thread | Frames: locals, operand stack | Automatic on method return | `StackOverflowError` / OOME on frame alloc |
| **PC register** | Per-thread | Address of current instruction | n/a | n/a |
| **Native method stack** | Per-thread | State of native (JNI) calls | Automatic | `StackOverflowError` / OOME |
| **Direct / off-heap** | Shared (native) | `DirectByteBuffer` backing memory | Cleaner / Unsafe | `OutOfMemoryError: Direct buffer memory` |

---

## Heap versus Stack Overview

**Beginner.** The **heap** is a single, process-wide region where every object and array you `new`
lives. It is shared by all threads and is the region the **garbage collector (GC)** manages — you never
free heap memory manually in Java. The **stack** is a small, fast, per-thread region that stores the
chain of *method invocations* (call frames). When a method is called a frame is pushed; when it returns
the frame is popped and its memory is instantly reclaimed — no GC involved.

**Why two regions?** Method-local data has a strict LIFO (last-in-first-out) lifetime that matches
method call/return exactly, so a stack is the perfect, near-free allocator for it. Objects, by
contrast, can outlive the method that created them and be shared between threads, so they need a
general-purpose, GC-managed region — the heap.

**Intermediate comparison:**

| Aspect | Stack | Heap |
|---|---|---|
| Scope | One per thread | One shared by whole JVM |
| Stores | Frames: local variables, partial results, references | Objects, arrays, instance fields |
| Lifetime | LIFO, tied to method call/return | Until unreachable, then GC'd |
| Allocation cost | Push/pop a pointer — trivial | Bump-the-pointer (TLAB) or slower path |
| Thread safety | Inherently thread-confined | Shared — needs synchronization |
| Failure mode | `StackOverflowError` | `OutOfMemoryError: Java heap space` |
| Sizing flag | `-Xss` (per thread) | `-Xms` / `-Xmx` |

**Advanced / gotcha.** A common misconception is "primitives go on the stack, objects go on the heap."
That is only true for *local* primitives. A primitive **instance field** (e.g. `int count` inside an
object) lives *inside the object on the heap*. The precise rule is: it is the **storage location of the
variable** that determines placement — a local variable's slot is in the current frame (stack), an
instance field's slot is inside the object (heap), and a static field's slot is in the class's storage
(historically PermGen, now the heap/Metaspace area — statics themselves live on the heap since JDK 8).

---

## What Lives Where, Primitives versus References

**Beginner.** Java has two kinds of values:

- **Primitives** (`byte short int long float double char boolean`) — the value *is* the data.
- **References** — a handle (like a typed pointer) that *points to* an object on the heap. Java has no
  raw pointers you can do arithmetic on; a reference is either `null` or points to a valid object.

```java
void demo() {
    int x = 42;              // primitive slot 'x' lives in this frame (stack)
    Point p = new Point(1,2);// 'p' (a reference) is in the frame; the Point object is on the heap
    int[] a = new int[3];    // 'a' is on the stack; the array object (incl. its ints) is on the heap
}
```

When `demo()` returns, the slots `x`, `p`, and `a` vanish with the frame. The `Point` and `int[]`
objects remain on the heap until the GC proves nothing reachable references them.

**Intermediate — where fields live:**

- **Local variable** (primitive or reference): in the frame's local-variable array (stack).
- **Instance field**: inside the owning object, on the heap — *even if it is a primitive*.
- **Array elements**: inside the array object on the heap — an `int[]` stores its ints on the heap.
- **Static field**: since **JDK 8**, class statics are stored on the **heap** (in the `java.lang.Class`
  mirror), *not* in Metaspace; Metaspace holds the class *metadata*, not the static field values.

**Advanced / gotcha.** "Java passes objects by reference" is **false**. Java is *always*
**pass-by-value**; for reference types the *value copied is the reference* (the pointer), not the
object. So a method can mutate the pointed-to object (visible to the caller) but reassigning the
parameter does not affect the caller's variable:

```java
void mutate(StringBuilder sb) { sb.append("!"); }   // caller sees the "!"
void reassign(StringBuilder sb) { sb = new StringBuilder("x"); } // caller sees nothing
```

Boxing pitfall: an `Integer` (object, heap) is not an `int` (primitive). `Integer a = 127, b = 127;
a == b` is `true` because of the `Integer` cache (−128..127), but at `128` it is `false` — a classic
trap that lives at the boundary of "value on stack vs object on heap."

---

## Stack Frames and StackOverflowError

**Beginner.** Each thread has its own **JVM stack**. Every method call pushes a **frame** containing
three things (JVMS §2.6): the **local variable array** (arguments + locals, incl. `this` for instance
methods), the **operand stack** (scratch space where bytecode instructions compute), and a reference to
the run-time **constant pool** of the method's class. When the method returns (or throws), its frame is
popped.

The **operand stack** is the transient scratch area where bytecode actually computes, distinct from the
named **local-variable array**. For `int c = a + b;` (with `a` in local slot 1, `b` in slot 2, `c` in
slot 3) HotSpot runs:

```
iload_1   ; push a onto the operand stack        -> operand stack: [a]
iload_2   ; push b                                -> operand stack: [a, b]
iadd      ; pop two, push their sum              -> operand stack: [a+b]
istore_3  ; pop the sum into local slot 3 (c)    -> operand stack: []
```

So the operand stack is a small push/pop compute area that empties out between statements, while the
local-variable array is the frame's set of named, persistent slots.

**Intermediate.** When recursion (or any call chain) goes too deep, the thread's stack cannot allocate
another frame and the JVM throws **`StackOverflowError`** — a subclass of `VirtualMachineError`
(itself an `Error`, not an `Exception`). It is thrown *on the offending thread* and the stack unwinds so
the thread can survive — but the JVM may have been mid-operation at an arbitrary frame (even inside a
library invariant), so **catching `StackOverflowError` to resume is generally unsafe**. It signals a bug
(usually a missing base case), not a condition to recover from.

```java
long fib(int n) {           // no base case in some inputs -> deep recursion
    return fib(n-1) + fib(n-2);   // StackOverflowError, NOT OutOfMemoryError
}
```

**Advanced / internals & gotchas:**

- Stack size is set per thread with **`-Xss`** (e.g. `-Xss1m`). Smaller stacks allow *more threads* but
  overflow sooner; larger stacks allow deeper recursion but fewer threads for a given address space.
- The default `-Xss` is platform-dependent (commonly ~512 KB–1 MB on 64-bit HotSpot).
- Deep recursion causes `StackOverflowError`; **too many threads** (each needing a fresh stack) causes
  `OutOfMemoryError: unable to create new native thread` — a *different* error, because thread stacks
  are allocated from native memory, not the Java heap.
- The HotSpot JIT can perform **tail-call-like** optimizations only in limited cases; Java does **not**
  guarantee tail-call optimization, so tail-recursive algorithms can still overflow. Convert to
  iteration or an explicit stack for deep data.
- **Virtual threads** (finalized in **JDK 21**, JEP 444) have a *growable, heap-allocated* stack that is
  stored on the heap while the virtual thread is unmounted, which is why millions of them are feasible;
  platform threads keep fixed OS-backed stacks.

---

## Young Generation, Eden and Survivor Spaces

**Beginner.** Generational collectors split the heap into a **young generation** (for short-lived
objects) and an **old generation** (a.k.a. tenured, for long-lived objects). This exploits the **weak
generational hypothesis**: *most objects die young*. Collecting the small young gen frequently and
cheaply reclaims the bulk of garbage without touching the whole heap.

**Intermediate — layout of the young generation:**

- **Eden**: where almost all new objects are allocated.
- **Two survivor spaces** (`S0` / `S1`, "from" and "to"): one is always empty. A **minor GC** (young
  collection) copies the survivors from Eden + the live "from" survivor into the "to" survivor,
  swapping their roles. This is a **copying collector**, which naturally compacts.

```
[   Eden   ][ S0 ][ S1 ]   <-- Young gen
[        Old generation        ]
```

Ratios are tunable: `-XX:NewRatio=2` means old:young = 2:1; `-XX:SurvivorRatio=8` means
eden:survivor = 8:1 per survivor.

**Advanced / gotchas:**

- Each minor GC increments an object's **age**. When age reaches **`-XX:MaxTenuringThreshold`** (max 15,
  since the age is stored in 4 bits of the object header's mark word) the object is **promoted** to the
  old gen.
- **Premature promotion**: if survivor space is too small, medium-lived objects spill straight to old
  gen, increasing expensive major/full GCs.
- **Large objects** (e.g. huge arrays) may be allocated directly in the old gen to avoid churning the
  young gen (in G1, "humongous" objects that exceed half a region size get special handling).
- G1 (**default since JDK 9**, JEP 248) does not use fixed contiguous Eden/Survivor/Old regions; it
  divides the heap into equal-size **regions** dynamically tagged as Eden, Survivor, Old, or Humongous.
  The generational *concept* survives even though the physical layout differs.

**Worked example — one object aging to tenure.** Config: `Eden = 80 MB`, `S0 = S1 = 10 MB`,
`MaxTenuringThreshold = 6`. One survivor is always the empty "to" space. Follow object **O** (allocated
in Eden on day one) through successive minor GCs. Each minor GC copies the *live* set out of Eden **and**
out of the current "from" survivor into the "to" survivor, then swaps their roles and clears the old
space; every surviving object's age increments by 1.

| Minor GC | Copy step (from → to) | O's age after | O lives in |
|---|---|---|---|
| #1 | Eden live set → **S0** (S0 now "to") | 0 → **1** | S0 |
| #2 | Eden + S0 live → **S1**, swap | 1 → **2** | S1 |
| #3 | Eden + S1 live → **S0**, swap | 2 → **3** | S0 |
| #4 | Eden + S0 live → **S1**, swap | 3 → **4** | S1 |
| #5 | Eden + S1 live → **S0**, swap | 4 → **5** | S0 |
| #6 | age would hit 6 = threshold → **promote** | **6** → Old | **Old gen** |

So O is copied back and forth five times (ages 1–5, always inside a 10 MB survivor), and on the sixth
minor GC — where its age would reach `MaxTenuringThreshold = 6` — it is **tenured to the old gen** instead
of copied again. The copy-and-swap is why survivors come in pairs: one is always the empty target.

**Now the premature-promotion failure.** Suppose a minor GC finds **14 MB** of live survivors but the "to"
survivor is only **10 MB**. The 10 MB fills and the remaining **~4 MB spills straight to the old gen**
regardless of age — objects that were about to die get tenured anyway, feeding expensive major/full GCs.
The fix is a bigger survivor space (lower `-XX:SurvivorRatio`, e.g. `6` instead of `8`) so the young gen
can hold a full generation of survivors without overflowing.

---

## Old Generation and Object Promotion

**Beginner.** The **old (tenured) generation** holds objects that have survived enough young-gen
collections to be considered long-lived (caches, session data, singletons). It is collected by a
**major GC** (or a **full GC**, which collects the whole heap). These are less frequent but more
expensive than minor GCs.

**Intermediate.** Objects arrive in the old gen by:

1. **Aging out** — surviving `MaxTenuringThreshold` minor GCs.
2. **Premature promotion** — survivor space overflow forces early tenuring.
3. **Direct allocation** — objects too large for the young gen.

A **full GC** that cannot free enough space is the usual precursor to `OutOfMemoryError: Java heap
space`. Frequent full GCs (long pauses) are a classic production symptom of an undersized heap or a
memory leak (objects reachable but never used).

**Advanced / gotchas:**

- Modern low-pause collectors target the old gen differently: **ZGC** (production-ready in **JDK 15**,
  JEP 377; **generational** in **JDK 21**, JEP 439) and **Shenandoah** (production in **JDK 15**, JEP
  379) do most work concurrently to keep pauses sub-millisecond to low single-digit ms.
- The `-XX:+UseGCOverheadLimit` guard throws `OutOfMemoryError: GC overhead limit exceeded` when the JVM
  spends **>98%** of time in GC while recovering **<2%** of the heap — signalling the heap is
  effectively full even though a raw allocation has not yet failed.
- "Objects tenured too fast" is not just a performance issue — it can turn a young-gen-friendly workload
  into a full-GC storm.

---

## Metaspace

**Beginner.** **Metaspace** is the region that stores **class metadata**: the runtime representation of
loaded classes — field/method structures, method bytecode, the runtime constant pool, annotations, etc.
It was introduced in **Java 8 (2014)** to **replace PermGen** (the "permanent generation").

**The problem it solved (OLD way vs NEW way):**

| | PermGen (≤ JDK 7) | Metaspace (JDK 8+) |
|---|---|---|
| Location | Inside the Java heap (fixed max) | **Native (off-heap) memory** |
| Sizing | `-XX:PermSize` / `-XX:MaxPermSize` | `-XX:MetaspaceSize` / `-XX:MaxMetaspaceSize` |
| Default max | Small, fixed (e.g. 64–82 MB) → easy to blow | **Unlimited by default** (grows to native limit) |
| Typical error | `OutOfMemoryError: PermGen space` | `OutOfMemoryError: Metaspace` |
| String pool | **In PermGen** (moved out in JDK 7) | On the heap |

PermGen's fixed size caused frequent `PermGen space` OOMEs in app servers that loaded/reloaded many
classes (e.g. redeploys). Metaspace grows dynamically from native memory, so by default it is bounded
only by available RAM.

**Advanced / gotchas:**

- Because Metaspace is unbounded by default, a **classloader leak** (common with hot redeploys, dynamic
  proxies, bytecode generation via CGLIB/ASM, heavy reflection) can consume all native memory before
  you notice. Set **`-XX:MaxMetaspaceSize`** in production to fail fast with a clear error.
- Class metadata is reclaimed only when the *entire defining classloader* becomes unreachable — a class
  is unloaded as a unit with its loader, not individually.
- `-XX:MetaspaceSize` is the **initial high-water mark** that triggers the first Metaspace GC, *not* a
  minimum reservation — a frequently misread flag.
- **Compressed class space** is a sub-region of Metaspace holding compressed class pointers; its size is
  tuned separately with `-XX:CompressedClassSpaceSize`.

---

## The String Pool Location

**Beginner.** The **string pool** (a.k.a. the *string intern pool* or *string constant pool*) is a cache
of unique `String` objects so that identical string literals share one instance. String literals are
automatically interned; `String.intern()` adds a runtime string to the pool and returns the canonical
instance.

```java
String a = "hi";            // literal -> pooled
String b = "hi";            // same pooled instance
String c = new String("hi");// NEW object on the heap, NOT the pooled one
System.out.println(a == b);        // true  (same pool reference)
System.out.println(a == c);        // false (different object)
System.out.println(a == c.intern());// true (intern returns the pooled instance)
```

**Version-accurate location (a favorite interview trap):**

| JDK | Where the string pool lives |
|---|---|
| ≤ JDK 6 | **PermGen** (fixed size — interning heavily risked `PermGen space` OOME) |
| **JDK 7** | **Moved to the main Java heap** (so it can be GC'd and grows with the heap) |
| JDK 8+ | On the **heap** (PermGen removed entirely; pool stays on the heap) |

So the correct answer to "where is the string pool?" for any modern JVM (7+) is **the heap** — a subtle
distinction from "class metadata is in Metaspace." The *pooled String objects* are on the heap; only the
*bookkeeping/hashtable* is a native structure.

**Advanced / gotchas:**

- Since JDK 7 the pool's bucket count is tunable via `-XX:StringTableSize`; a poorly sized table hurts
  intern performance for intern-heavy apps.
- Compile-time constant expressions of strings are folded and interned: `"ab" == "a" + "b"` is `true`
  (both are compile-time constants), but `"ab" == ("a" + nonFinalVar)` is `false` (runtime concat →
  new heap object).
- Overusing `intern()` can bloat the pool and, historically (≤ JDK 6), exhaust PermGen.

---

## Escape Analysis and TLAB

**Beginner.** **TLAB** (Thread-Local Allocation Buffer) is a small chunk of Eden handed to each thread so
it can allocate objects by simply bumping a pointer **without locking** — the fast path for the vast
majority of allocations. **Escape analysis** is a JIT optimization that figures out whether an object's
lifetime is confined to a method/thread; if it "does not escape," the JIT can optimize it away.

**Intermediate — why TLAB matters.** The heap is shared, so naïve allocation would require
synchronization on the bump pointer. By giving each thread a private TLAB, allocation is a
lock-free pointer bump; only when a TLAB fills does the thread grab a new one (a rare, synchronized
event). Controlled by `-XX:+UseTLAB` (on by default) and `-XX:TLABSize`.

**Advanced — what escape analysis enables (HotSpot C2 JIT):**

- **Scalar replacement**: a non-escaping object is *never allocated as an object*; its fields become
  local scalars in registers/stack slots. This is the real optimization — people say "stack allocation"
  but HotSpot primarily does scalar replacement, not literal object-on-stack.

**Worked example — what scalar replacement does to your code.** Take a hot loop:

```java
long sum = 0;
for (int i = 0; i < 1_000_000; i++) {
    Point p = new Point(i, i + 1);   // p never escapes this iteration
    sum += p.getX() + p.getY();
}
```

Naïvely this is **1,000,000 heap allocations** (one `Point` per iteration → constant TLAB churn and GC
pressure). Escape analysis proves `p` never escapes the loop body, so C2 **scalar-replaces** it: the
`Point` object is never created, its two fields collapse into two local `int` slots, and the loop
compiles to roughly:

```java
long sum = 0;
for (int i = 0; i < 1_000_000; i++) {
    int px = i, py = i + 1;          // no object, no allocation
    sum += px + py;
}
```

Result: **zero heap allocations**, no GC pressure — the object simply vanished. Now defeat it by letting
`p` escape:

```java
Point p = new Point(i, i + 1);
this.last = p;   // stored in a field -> escapes the method
return p;        // returned -> escapes -> allocation MUST survive on the heap
```

Once the reference outlives the method (stored in a field, returned, or passed to a method C2 can't see
into), the JVM has no choice: the `Point` is heap-allocated normally. That is why this is a *performance*
optimization you can't rely on for correctness — a one-line change flips it off.
- **Lock elision (synchronization elimination)**: locks on a non-escaping object are removed, since no
  other thread can see it.
- **Gotcha**: escape analysis is a *JIT* optimization, so it only kicks in after methods are hot and
  compiled by C2; interpreted or C1-tier code still heap-allocates. You cannot *rely* on it for
  correctness — it is purely a performance win, and it can be defeated by the object escaping (returned,
  stored in a field, passed to an unknown method).
- Flags: `-XX:+DoEscapeAnalysis` (on by default), `-XX:+EliminateAllocations`,
  `-XX:+EliminateLocks`.

---

## OutOfMemoryError Kinds

**Beginner.** `OutOfMemoryError` (an `Error`, subclass of `VirtualMachineError`) is thrown when the JVM
cannot allocate memory and the GC cannot free enough. But there are **several distinct kinds**, each
pointing at a different region and root cause — naming the right one is a common senior-level question.

**The catalog (memorize the messages):**

| Message | Region | Typical cause |
|---|---|---|
| `Java heap space` | Heap | Too many live objects / leak / heap too small (`-Xmx`) |
| `GC overhead limit exceeded` | Heap | >98% time in GC, <2% reclaimed — heap effectively full |
| `Metaspace` | Metaspace (native) | Too many classes / classloader leak (set `-XX:MaxMetaspaceSize`) |
| `Requested array size exceeds VM limit` | Heap | Array length near `Integer.MAX_VALUE` |
| `Direct buffer memory` | Off-heap (native) | `DirectByteBuffer` / NIO exhausting `-XX:MaxDirectMemorySize` |
| `unable to create new native thread` | Native (per-thread stacks) | Too many threads; OS/native memory limit |
| `Compressed class space` | Metaspace sub-region | Too many classes with compressed class pointers |

**Advanced / gotchas:**

- **`StackOverflowError` is NOT an `OutOfMemoryError`** — different sibling under `VirtualMachineError`.
  Deep recursion → `StackOverflowError`; too many *threads* → `OOME: unable to create new native
  thread`. Interviewers test this distinction constantly. They are **siblings, not parent-child**:

  ```
  Throwable
   └─ Error
       └─ VirtualMachineError
           ├─ StackOverflowError      (thread stack can't push another frame)
           ├─ OutOfMemoryError        (a memory region is exhausted)
           └─ InternalError
  ```

  So `catch (OutOfMemoryError e)` will **not** catch a `StackOverflowError`, and vice versa.
- **Direct buffer memory** is off-heap: `ByteBuffer.allocateDirect(...)` and NIO/Netty use native memory
  freed by a `Cleaner`/`PhantomReference` tied to the buffer's GC — so a heap that never fills can still
  starve direct memory if buffers are held. Cap it with `-XX:MaxDirectMemorySize`.
- `GC overhead limit exceeded` is a *pre-emptive* OOME: it fires before a hard allocation failure to
  avoid a livelock of endless GCs. Disable (not recommended) with `-XX:-UseGCOverheadLimit`.
- Use `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=...` to capture a heap dump for post-mortem
  analysis (e.g. with Eclipse MAT).

---

## Heap and Stack Tuning Flags

**Beginner.** The three flags every Java developer should know:

- **`-Xms`** — initial (minimum) heap size, e.g. `-Xms512m`.
- **`-Xmx`** — maximum heap size, e.g. `-Xmx4g`. Hitting this ceiling with a full live set →
  `OutOfMemoryError: Java heap space`.
- **`-Xss`** — per-thread stack size, e.g. `-Xss1m`. Governs recursion depth vs thread count.

**Intermediate.**

- Setting **`-Xms` equal to `-Xmx`** pre-allocates the whole heap up front. This avoids the pauses and
  fragmentation of the JVM resizing the heap at runtime and is standard practice for latency-sensitive
  servers.
- `-Xmn` sets the young-gen size directly (alternative to `-XX:NewRatio`).
- Container awareness (**JDK 8u191+ / JDK 10+**): use `-XX:MaxRAMPercentage` so the heap scales with the
  container's cgroup memory limit instead of a hard-coded `-Xmx`. Modern JVMs are container-aware by
  default via `-XX:+UseContainerSupport`.

**Advanced / gotchas:**

- **`-Xmx` bounds the heap only** — it does *not* cap Metaspace, thread stacks, direct buffers, JIT code
  cache, or GC structures. Total JVM RSS (resident memory) is *substantially larger* than `-Xmx`; a
  common container-OOM-kill mistake is sizing the container to `-Xmx` without headroom.
- Bigger `-Xss` = deeper recursion but fewer threads per process (each thread reserves its stack from
  native address space).
- Non-standard `-X` and `-XX` flags are not part of the JVMS and can vary between vendors/versions;
  `java -XX:+PrintFlagsFinal -version` dumps the effective values.
- Rule of thumb for total footprint: `RSS ≈ heap (-Xmx) + Metaspace + (threads × -Xss) + direct memory
  + code cache + GC overhead`.

**Worked example — why the 4 GB container gets OOM-killed.** You set `-Xmx=4g` and, reasonably-sounding,
give the container a **4 GB** memory limit. Add up what actually lands in RSS:

| Component | Size |
|---|---|
| Heap (`-Xmx`) | 4096 MB |
| Metaspace (loaded classes) | 256 MB |
| Thread stacks (400 threads × `-Xss1m`) | 400 MB |
| Direct buffers (NIO/Netty) | 256 MB |
| JIT code cache | 240 MB |
| GC structures + misc native | 200 MB |
| **Total RSS** | **≈ 5448 MB (~5.3 GB)** |

The process needs **~5.3 GB** of resident memory but the cgroup limit is 4 GB, so the kernel OOM-killer
terminates it (`exit 137`) even though the Java heap itself never threw `OutOfMemoryError`. The lesson:
size the container to **RSS**, not to `-Xmx` — here you'd want a ~6 GB limit (or drop `-Xmx` to ~2.5 GB
and use `-XX:MaxRAMPercentage` so the heap scales *inside* the 4 GB budget with headroom for the rest).

---

## Common interview follow-up questions

1. **"Are primitives always on the stack?"** No — only *local* primitives. A primitive *instance field*
   lives inside its object on the heap; a static lives on the heap (JDK 8+).
2. **"Is Java pass-by-reference?"** No. Always pass-by-value; for objects the *reference value* (pointer)
   is copied, so you can mutate the object but not reassign the caller's variable.
3. **"Where is the string pool?"** On the **heap** since **JDK 7** (was in PermGen ≤ JDK 6). PermGen was
   removed entirely in JDK 8.
4. **"PermGen vs Metaspace — what changed and when?"** Java 8 removed PermGen and introduced Metaspace,
   which lives in native memory and is unbounded by default.
5. **"Difference between `StackOverflowError` and `OutOfMemoryError`?"** Different `VirtualMachineError`
   subclasses; deep recursion vs region exhaustion. Too many *threads* is `OOME: unable to create new
   native thread`, not `StackOverflowError`.
6. **"Name the kinds of `OutOfMemoryError`."** Java heap space, GC overhead limit exceeded, Metaspace,
   Direct buffer memory, Requested array size exceeds VM limit, unable to create new native thread.
7. **"What is escape analysis and does it put objects on the stack?"** A JIT optimization; it mainly does
   *scalar replacement* and lock elision for non-escaping objects — not literal stack allocation.
8. **"What is a TLAB and why does it exist?"** A per-thread slice of Eden enabling lock-free
   bump-pointer allocation.
9. **"How do young/old generations relate to G1?"** G1 (default since JDK 9) keeps the generational
   model logically but uses dynamic equal-size regions instead of fixed contiguous spaces.
10. **"Does `-Xmx` cap total JVM memory?"** No — only the heap. Metaspace, stacks, direct buffers, and
    code cache are extra.

## References

- **JVM Specification, Chapter 2 (§2.5 Run-Time Data Areas, §2.6 Frames)** — the authoritative
  definition of heap, method area, JVM stacks, PC register, native stacks.
- **JEP 122: Remove the Permanent Generation** (Java 8) — PermGen removal / Metaspace rationale.
- **JEP 248: Make G1 the Default Garbage Collector** (JDK 9).
- **JEP 377: ZGC: A Scalable Low-Latency Garbage Collector (Production)** (JDK 15).
- **JEP 379: Shenandoah: A Low-Pause-Time Garbage Collector (Production)** (JDK 15).
- **JEP 439: Generational ZGC** (JDK 21).
- **JEP 444: Virtual Threads** (final, JDK 21) — heap-stored, growable virtual-thread stacks.
- **HotSpot documentation** on TLAB, escape analysis (`-XX:+DoEscapeAnalysis`), and tuning flags
  (`java -XX:+PrintFlagsFinal`).
- **Oracle "Java Platform, Standard Edition HotSpot Virtual Machine Garbage Collection Tuning Guide"** —
  generations, survivor spaces, tenuring, Metaspace sizing.
