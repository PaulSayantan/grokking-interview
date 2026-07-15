# synchronized, volatile and the Java Memory Model

Concurrency correctness in Java rests on the **Java Memory Model (JMM)** — the part of the
Java Language Specification (JLS Chapter 17) that defines *when* a write by one thread is
guaranteed to be *visible* to a read by another thread, and *which* reorderings a compiler,
JIT, or CPU is allowed to perform. The modern JMM was defined by **JSR-133** and shipped in
**Java 5 (2004)**; before that, `volatile` and `final` had weaker, partly-broken semantics.

This document builds from beginner definitions to advanced internals and gotchas for the
core low-level concurrency tools: `volatile`, `synchronized`, atomic classes / CAS,
double-checked locking, `final` field semantics, and false sharing.

---

## The Java Memory Model and happens-before

**Beginner.** Each thread may keep its own working copy of variables (in registers, store
buffers, or per-core caches). Without synchronization there is *no guarantee* that a write
made by thread A is ever seen by thread B, or in what order. The JMM does not talk about
caches directly — it is an abstract model defined in terms of a **happens-before** partial
ordering over memory actions. If action X *happens-before* action Y, then the effects of X
(including all writes) are visible to Y.

**The happens-before rules (JLS 17.4.5):**

- **Program order rule:** within a single thread, each action happens-before every action
  that comes later in program order.
- **Monitor lock rule:** an unlock on monitor M happens-before every subsequent lock on M.
- **Volatile rule:** a write to a volatile field happens-before every subsequent read of
  that same field.
- **Thread start rule:** `Thread.start()` happens-before any action in the started thread.
- **Thread join rule:** any action in a thread happens-before another thread returning from
  `join()` on it.
- **Thread interruption rule:** a call to `interrupt()` happens-before the interrupted
  thread detecting the interrupt.
- **Finalizer rule:** the end of a constructor happens-before the start of `finalize()`.
- **Transitivity:** if X hb Y and Y hb Z, then X hb Z.

**Intermediate.** Happens-before is a *partial* order, not a total one. Two actions with no
happens-before relationship are said to be in a **data race** if at least one is a write and
they touch the same non-final, non-volatile location — such a program's behavior is not
guaranteed to be sequentially consistent. The JMM's guarantee is the **DRF-SC** theorem:
*correctly synchronized (data-race-free) programs behave as if sequentially consistent.* Your
job is to insert enough synchronization to remove data races; then you get the intuitive
interleaving semantics.

**Advanced.** Happens-before does **not** mean "happens-before in wall-clock time," and it
does **not** forbid reordering — it only constrains the *values reads are allowed to return*.
A JIT may freely reorder actions that are not ordered by happens-before as long as the
single-thread (as-if-serial) semantics are preserved. The JMM is also careful to forbid
*out-of-thin-air* values via a causality model, so that data races (while unspecified in
ordering) still cannot fabricate arbitrary values for references (which would break memory
safety). Note happens-before is not transitively "consistent" across different variables
unless a synchronization action bridges them.

---

## Visibility, reordering, and atomicity

**Beginner.** Three distinct concerns are often conflated:

- **Visibility** — whether a write by one thread is observable by another.
- **Ordering / reordering** — whether operations appear to execute in program order.
- **Atomicity** — whether a compound operation executes as one indivisible step.

They are independent. `volatile` gives visibility and ordering but *not* atomicity of
compound actions. `synchronized` and atomics give all three (within their scope).

**Intermediate — the classic infinite loop.** A missing visibility guarantee:

```java
boolean stop = false;            // not volatile

// Thread T
while (!stop) { /* spin */ }     // JIT may hoist to: if(!stop) while(true){}

// Main thread
stop = true;                     // T may never observe this
```

The JIT is allowed to hoist the non-volatile read out of the loop because, in the absence of
a happens-before edge, it can prove nothing forces a re-read. Marking `stop` volatile fixes
it. This is *not* merely a cache-flush issue — it is a legal compiler optimization.

**Intermediate — 64-bit non-atomicity.** Per JLS 17.7, writes/reads of `long` and `double`
are permitted to be split into two 32-bit halves on some JVMs, so a non-volatile `long` can
be read as a "word-torn" mix of two writes. Declaring it `volatile` guarantees atomic 64-bit
access. (In practice HotSpot on 64-bit platforms writes them atomically anyway, but the spec
only guarantees it for `volatile`.) References are always read/written atomically.

**Advanced — reordering sources.** Reordering can come from (1) the compiler / JIT,
(2) the processor's out-of-order execution, and (3) the memory hierarchy (store buffers,
invalidate queues). x86 is a relatively strong TSO model (only store-load reordering is
visible); ARM/POWER are weakly ordered and expose far more. The JMM abstracts over all of
these; correct JMM usage is portable regardless of the underlying hardware memory model.

---

## volatile

**Beginner.** `volatile` on a field guarantees:

1. **Visibility** — a read always sees the most recent write (establishes a happens-before
   edge between the write and subsequent reads).
2. **Ordering** — reads/writes of the volatile are not reordered with each other, and act as
   memory barriers for surrounding operations.
3. **Atomicity of the single read or single write** (including 64-bit `long`/`double`).

It does **NOT** provide atomicity of compound actions like `count++` (which is
read-modify-write) or `if (x == null) x = ...`.

```java
volatile int v;
v++;   // NOT atomic: load v, add 1, store v — lost updates under contention
```

**Intermediate — the piggyback / release-acquire pattern.** Since JSR-133, a volatile write
acts as a *release* and a volatile read as an *acquire*. Everything a thread wrote *before*
a volatile write is visible to any thread that *reads* that same volatile afterward — even
non-volatile fields.

```java
int data;                 // plain
volatile boolean ready;   // guard

// Writer
data = 42;                // (1)
ready = true;             // (2) volatile write — release

// Reader
if (ready) {              // (3) volatile read — acquire
    use(data);            // (4) guaranteed to see 42
}
```

Because (1) hb (2), (2) hb (3), (3) hb (4) by transitivity, the plain write of `data` is
visible. This "piggybacking" is the single most useful volatile idiom.

**Advanced — barriers HotSpot emits.** Conceptually the JMM requires: LoadLoad + LoadStore
after a volatile read; StoreStore + LoadStore before a volatile write, and a
**StoreLoad** barrier after a volatile write (the expensive one — a full fence, e.g. `mfence`
/ `lock addl` on x86). This StoreLoad is what makes a volatile write followed by a volatile
read of a *different* variable ordered, and is why volatile writes are more expensive than
volatile reads.

**Gotchas:**

- `volatile` on an array reference makes the *reference* volatile, not the elements.
  Use `AtomicIntegerArray` / `VarHandle` for element-level volatile semantics.
- Compound checks (`v == 5 && ...`) built from separate volatile reads are not atomic.
- `volatile` does not make an object's internal state thread-safe — only the field access.

---

## synchronized, monitors, and reentrancy

**Beginner.** `synchronized` acquires an object's intrinsic lock (**monitor**). It provides
both **mutual exclusion** (only one thread in the block per monitor) and **visibility**
(unlock happens-before subsequent lock on the same monitor — flushing writes). Two forms:

```java
synchronized (lockObject) { ... }   // block on an explicit monitor
synchronized void m() { ... }        // instance method -> locks 'this'
static synchronized void s() { ... } // static method -> locks the Class object
```

**Intermediate.**

- **Reentrant:** a thread already holding monitor M can re-acquire M without deadlocking; a
  hold count is maintained and the lock is released only when the count returns to zero.
- **Which monitor matters:** locking on different objects gives no mutual exclusion. A common
  bug is `synchronized` on `Integer`/`Boolean`/`String` (interned/cached), or reassigning the
  lock object. Always lock on a `private final Object lock = new Object();`.
- Instance and static synchronized methods use *different* monitors (the instance vs the
  `Class`), so they don't exclude each other.

**Advanced — lock internals in HotSpot.** An object header's mark word encodes lock state.
HotSpot historically supported:

- **Biased locking** — optimized for a single thread repeatedly locking. **Disabled by
  default since JDK 15 (JEP 374)** and deprecated for removal because it hurt more than it
  helped on modern hardware.
- **Thin / lightweight locks** — CAS on the mark word for uncontended locks (no OS mutex).
- **Fat / heavyweight locks (inflation)** — a real OS monitor (`ObjectMonitor`) with a wait
  set and entry list, used under contention.

`wait()`/`notify()`/`notifyAll()` are defined on `Object` and **must be called while holding
that object's monitor** or they throw `IllegalMonitorStateException`. `wait()` releases the
monitor and must be used in a loop guarding against spurious wakeups:

```java
synchronized (lock) {
    while (!condition) lock.wait();   // never 'if' — spurious wakeups + missed signals
    ...
}
```

**Trade-off vs `ReentrantLock` (java.util.concurrent, Java 5):** explicit `Lock` adds
`tryLock`, timed/interruptible acquisition, fairness policy, and multiple `Condition`s, at
the cost of a mandatory `try/finally unlock()`. Use `synchronized` for simple cases; reach
for `ReentrantLock`/`StampedLock`/`ReadWriteLock` when you need those features.

---

## Atomic classes and CAS

**Beginner.** `java.util.concurrent.atomic` (Java 5) provides lock-free, thread-safe single
variables: `AtomicInteger`, `AtomicLong`, `AtomicBoolean`, `AtomicReference`, plus array and
field-updater variants. They solve the `count++` atomicity problem without locks:

```java
AtomicInteger n = new AtomicInteger();
n.incrementAndGet();      // atomic read-modify-write
```

**Intermediate — CAS.** Atomics are built on **Compare-And-Swap**: an instruction that
atomically sets a location to a new value *only if* it currently equals an expected value,
returning success/failure. The typical loop:

```java
int prev, next;
do {
    prev = value.get();
    next = prev + 1;
} while (!value.compareAndSet(prev, next));  // retry on contention
```

CAS is **optimistic**: no blocking, threads retry on conflict. It maps to hardware
(`cmpxchg` on x86, LL/SC on ARM). Atomic reads/writes carry the same happens-before
guarantees as volatile (the backing field is volatile).

**Advanced.**

- **ABA problem:** a value changes A→B→A; a plain CAS can't tell it changed. Use
  `AtomicStampedReference` (version stamp) or `AtomicMarkableReference`.
- **LongAdder / DoubleAdder (Java 8):** under high contention, `AtomicLong` CAS retries
  become a bottleneck. `LongAdder` spreads the count over multiple *cells* (striping) to
  reduce contention, summing them on `sum()`. Prefer it for hot counters where you rarely
  read; prefer `AtomicLong` when you need an exact instantaneous value cheaply.
- **VarHandle (Java 9, JEP 193)** replaced `sun.misc.Unsafe` for fine-grained access modes:
  `getPlain`, `getOpaque`, `getAcquire`/`setRelease`, `getVolatile`, and `compareAndSet`.
  This exposes the C11-style access-mode spectrum directly in the standard API.
- Atomics give lock-freedom (system-wide progress) but not wait-freedom; under extreme
  contention a lock can outperform a spinning CAS loop.

---

## Double-checked locking

**Beginner.** A lazy-initialization idiom that tries to avoid locking on the common (already
initialized) path:

```java
class Holder {
    private volatile Singleton instance;          // volatile is MANDATORY
    Singleton get() {
        if (instance == null) {                   // 1st check (no lock)
            synchronized (this) {
                if (instance == null) {           // 2nd check (locked)
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

**Intermediate — why `volatile` is required.** `instance = new Singleton()` is not atomic:
it (a) allocates memory, (b) runs the constructor, (c) publishes the reference. Without
`volatile`, the compiler may reorder so the reference is published *before* the constructor
finishes. Another thread's first check could then see a non-null but **partially constructed**
object. This is the famous reason DCL was *broken* before Java 5. Since JSR-133 (Java 5),
declaring the field `volatile` makes DCL correct (the volatile write is a release; the reader's
volatile read is an acquire, so it sees a fully constructed object).

**Advanced — better alternatives:**

- **Initialization-on-demand holder idiom** — relies on JVM class-init laziness and is often
  cleaner (no volatile, no explicit synchronization):

```java
class Singleton {
    private Singleton() {}
    private static class Holder { static final Singleton INSTANCE = new Singleton(); }
    static Singleton getInstance() { return Holder.INSTANCE; }   // lazy + thread-safe
}
```

  The JVM guarantees class initialization is thread-safe and happens exactly once (JLS 12.4),
  and `Holder` is not loaded until `getInstance()` first touches it.

- **enum singleton** — simplest thread-safe, serialization-safe singleton.

- For a `volatile` local optimization, read the field into a local variable once to avoid a
  second volatile read.

---

## final field semantics

**Beginner.** A `final` field must be assigned exactly once, in the constructor (or field
initializer / instance initializer). Beyond immutability, `final` has crucial *memory-model*
meaning added by JSR-133.

**Intermediate — the final-field guarantee (JLS 17.5).** If an object is *properly
constructed* (the `this` reference does not escape the constructor), then any thread that
sees a reference to that object — even through a **data race** — is guaranteed to see the
correctly initialized values of its `final` fields, without any synchronization.

```java
class Point {
    final int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
}
// A thread reading a Point reference (even unsafely published) sees x,y correctly set.
```

This is why immutable objects (all-`final` fields, no `this` escape) are safe to publish via
a data race. `String`, `Integer`, etc. rely on this.

**Advanced — the escape caveat and freeze.** The guarantee holds only if `this` does not
escape during construction (e.g. registering `this` in a static map or starting a thread that
uses `this` inside the constructor breaks it). Semantically there is a **freeze** action at
the end of the constructor for each final field; reorderings that would let another thread
see the pre-freeze (default) value are forbidden. Note: for a `final` reference to a mutable
object, only the *reference* and the field values reachable through final fields *at
construction time* get the guarantee — later mutations still need normal synchronization.
Reflectively mutating a `final` field is undefined territory w.r.t. these guarantees.

---

## False sharing

**Beginner.** CPUs move memory in **cache lines** (commonly 64 bytes), not individual
variables. If two threads on different cores write to two *different* variables that happen
to sit on the *same* cache line, each write invalidates the other core's copy of the whole
line, causing cache-coherence traffic (ping-ponging). This is **false sharing** — the
variables are logically independent but physically share a line, silently killing scalability.

**Intermediate — diagnosing and fixing.** Symptoms: a "shared-nothing" parallel algorithm
that scales poorly. Classic fix is **padding** to push hot fields onto separate lines:

```java
// Manual padding (fragile; JIT may eliminate unused fields)
long p1,p2,p3,p4,p5,p6,p7;   // pad before
volatile long value;
long q1,q2,q3,q4,q5,q6,q7;   // pad after
```

**Advanced — `@Contended` (Java 8, JEP 142).** `jdk.internal.vm.annotation.Contended`
(was `sun.misc.Contended` in Java 8) tells the JVM to pad a field/class onto its own cache
line. It requires `-XX:-RestrictContended` for application code (it is restricted to JDK
internals by default). `LongAdder`'s cells and the fork/join framework use it internally.
This is why `LongAdder` scales far better than a single padded `AtomicLong` under contention.
Prefer letting the JDK (LongAdder, ConcurrentHashMap) handle padding rather than rolling your
own, which the JIT may optimize away.

---

## volatile vs atomic vs synchronized trade-offs

**Summary comparison:**

| Aspect | `volatile` | Atomic (`AtomicX` / CAS) | `synchronized` / `Lock` |
|---|---|---|---|
| Visibility | Yes | Yes | Yes |
| Ordering (happens-before) | Yes | Yes | Yes |
| Mutual exclusion | **No** | No (single var, lock-free) | **Yes** |
| Atomic compound ops | No | Yes (single variable) | Yes (arbitrary block) |
| Blocking | Never | Never (spins/retries) | Can block / park |
| Multi-variable invariants | No | No | **Yes** |
| Typical cost | Cheap read; write has StoreLoad fence | Cheap; retries under contention | Uncontended cheap; contended = OS monitor |

**Decision guide:**

- **One flag / reference, single writes and reads, no compound update →** `volatile`.
- **One variable needing atomic read-modify-write →** `AtomicInteger`/`AtomicLong`/CAS
  (or `LongAdder` for hot counters read rarely).
- **Multiple variables that must change together, or check-then-act invariants →**
  `synchronized` / `ReentrantLock`.

**Gotchas:**

- Do not "upgrade" a `volatile` counter to fix `count++` — it is still a race; use an atomic
  or a lock.
- `synchronized` gives visibility even for non-volatile fields written inside the block (via
  the monitor happens-before edge) — you don't also need volatile inside a lock.
- Prefer `java.util.concurrent` (concurrent collections, `Executor`s) over hand-rolled
  low-level primitives when possible.

---

## Common interview follow-up questions

1. What is happens-before, and can you list the main rules from the JMM?
2. Why can a non-volatile `while(!stop)` loop never terminate, and how does `volatile` fix it?
3. Does `volatile` make `count++` thread-safe? Why not — and what do you use instead?
4. Explain the release/acquire ("piggyback") semantics of a volatile write and read.
5. Why was double-checked locking broken before Java 5, and why does `volatile` fix it?
6. Compare double-checked locking with the initialization-on-demand holder idiom and enum
   singleton.
7. What memory guarantee do `final` fields give, and what breaks it (this-escape)?
8. What is the difference between `synchronized` and `ReentrantLock`? When use each?
9. What is biased locking and why was it disabled by default (JDK 15)?
10. Explain CAS and the ABA problem; how do `AtomicStampedReference` and `LongAdder` help?
11. Why must `wait()` be called in a loop and while holding the monitor?
12. What is false sharing, how do you detect it, and what does `@Contended` do?
13. When is a 64-bit `long` read non-atomic in Java, and how do you guarantee atomicity?
14. What is the DRF-SC guarantee, and what is a "data race" precisely?
15. Compare volatile vs atomic vs synchronized on visibility, ordering, atomicity, and cost.

## References

- JLS SE 21, Chapter 17 "Threads and Locks" (17.4 Memory Model, 17.4.5 happens-before,
  17.5 final field semantics, 17.7 non-atomic long/double).
- JSR-133: Java Memory Model and Thread Specification (finalized in Java 5, 2004);
  Brian Goetz & JSR-133 FAQ.
- Brian Goetz et al., *Java Concurrency in Practice* (2006).
- JEP 142: Reduce Cache Contention on Specified Fields (`@Contended`, Java 8).
- JEP 193: Variable Handles (`VarHandle`, Java 9).
- JEP 171: Fence Intrinsics (Java 8).
- JEP 374: Disable and Deprecate Biased Locking (JDK 15).
- `java.util.concurrent.atomic` package docs (`LongAdder`, `AtomicStampedReference`).
- Doug Lea, "Using JDK 9 Memory Order Modes."
