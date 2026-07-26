# java-jvm — Content Audit

**Executive summary.** All 25 subtopics were audited (0 missing). This is a strong, senior-grade domain: mean **clarity 4.52/5** and mean **depth 4.48/5**, with consistently intuition-first framing, precise version/JEP tagging, and rich gotcha + interview-follow-up layers. The weak dimension is unambiguous and systemic: mean **example score 3.32/5**. Almost every file teaches the hardest mechanics in prose and API tables but stops short of the *numbers-in / numbers-out* worked traces the refinement bar weights second-highest. **Priority distribution: 0 high, 23 medium, 2 low** (`immutability-strings`, `java8-functional-interfaces-method-references`). No file is in poor shape, but no file fully clears the worked-examples bar either. Headline takeaways: (1) the single highest-leverage refinement across the whole domain is adding concrete traced examples, especially to the concurrency and GC/JVM-internals clusters; (2) one factual error must be fixed before publish (`serialization`: the enum/`readResolve` claim is a misconception that will make a candidate answer wrong); (3) 15 of 25 files carry version/behavior claims flagged `needs_web_verification`.

## Scorecard

Sorted high-priority first (none), then medium by lowest (clarity+example+depth) total first (example score breaks ties), then low.

| Subtopic | Clarity | Examples | Depth | Priority | Verdict |
|---|---|---|---|---|---|
| executor-framework-concurrency-utils | 4 | 2 | 5 | medium | Depth/gotchas excellent, but taught via API tables/prose; missing pool-sizing calc, admission trace, fixed-rate timeline. |
| garbage-collection | 5 | 2 | 4 | medium | Excellent intuition and version history, but almost no numbers (minor-GC trace, tenuring math, throughput math); no TLAB. |
| modern-jvm-gc-jit-graalvm | 4 | 2 | 5 | medium | Depth/correctness strong but nearly all prose; no colored-pointer bit layout, no traced deopt/tiered thresholds. |
| collections-hashmap-internals | 4 | 3 | 4 | medium | Great gotchas/follow-ups, but bucket-index, resize lo/hi split, and resize threshold stay abstract with no numbers. |
| design-patterns-java | 4 | 3 | 4 | medium | Strong reference, but Visitor/Command are name-dropped yet never taught, and DCL-volatile reordering is asserted not traced. |
| java-module-system-jpms | 4 | 3 | 4 | medium | Well-structured and correct, but examples are static declaration snippets, not traced failures/resolution. |
| java8-streams-lambdas-optional | 4 | 3 | 4 | medium | Semantics taught well but leans abstract exactly where numbers matter (reduce combiner, groupingBy, parallel cost). |
| multithreading-concurrency | 4 | 3 | 4 | medium | Strong tables/gotchas but happens-before & CAS are prose-only, and thread-pool sizing/internals are absent. |
| serialization | 4 | 3 | 4 | medium | Comprehensive, but the "most important" RCE theme is never walked through and the enum/readResolve claim is wrong. |
| records-sealed-classes | 4 | 4 | 4 | medium | Version-accurate and layered; missing sum/product intuition, guard-clause exhaustiveness gotcha, traced eval. |
| synchronized-volatile-jmm | 4 | 3 | 5 | medium | Technically excellent; lost-update, ABA, memory barriers, false sharing are asserted rather than traced. |
| virtual-threads-structured-concurrency | 5 | 3 | 4 | medium | Superb intuition/version precision but never shows the capacity/throughput arithmetic; StructuredTaskScope API drifted. |
| completablefuture-async | 5 | 3 | 5 | medium | Exceptional depth; snippets stop short of tracing which thread runs each stage and why the pool is sized as it is. |
| exception-handling | 5 | 4 | 4 | medium | Excellent teaching; performance section is all-qualitative (no numbers), and thread/async exceptions are missing. |
| generics-type-system | 5 | 4 | 4 | medium | Strong intuition-first deep-dive; names the F-bounded/raw-type traps without a concrete "why it bites" walkthrough. |
| heap-vs-stack-memory | 5 | 3 | 5 | medium | Exceptionally clear/deep; hardest quantitative bits (tenuring, scalar replacement, RSS) lack concrete numbers. |
| java8-date-time-api | 5 | 4 | 4 | medium | Strong intuition-first; end-of-month resolution, DST math, and Clock-for-testing are named but never worked through. |
| object-methods-equality | 4 | 4 | 5 | medium | Strong Object-contract coverage; HashMap.get trace and transitivity/inheritance failure lack worked numbers. |
| pattern-matching-switch-expressions | 5 | 4 | 4 | medium | Excellent Amber tour; thin text-block whitespace trace and missing under-the-hood/generics-in-patterns depth. |
| reflection-annotations-proxies | 5 | 3 | 5 | medium | Dense/accurate; perf numbers, self-invocation fix, and a MethodHandle speedup are prose only. |
| jvm-architecture-class-loading | 5 | 4 | 5 | medium | Unusually complete; memory-layout, TCCL, Metaspace-leak diagnosis stay abstract; Execution Engine/JIT under-covered. |
| oop-principles-polymorphism | 5 | 4 | 5 | medium | Excellent; LSP Square/Rectangle and protected cross-package access are prose only; vtable would teach better visually. |
| parallelism-parallel-streams-forkjoin | 5 | 4 | 5 | medium | Excellent; short on a split-tree trace and an actual sequential-vs-parallel benchmark number to anchor "when it helps." |
| java8-functional-interfaces-method-references | 4 | 4 | 5 | low | Gotcha-rich and example-driven; a few dense passages (poly-expression, overload ambiguity) need plain-language unpacking. |
| immutability-strings | 5 | 4 | 5 | low | Excellent senior-grade treatment; a few claims asserted not shown, plus the classic pre-7u6 substring leak is missing. |

## Systemic issues

The value here is cross-cutting: the same handful of gaps recur across nearly every file, so fixing them as *patterns* (not one-off edits) is the efficient path.

**1. Prose/tables where a numbers-in/numbers-out trace is needed — the dominant theme (≈20 of 25 files).**
This is the domain's defining weakness and it maps exactly to the #2-weighted refinement dimension. High-severity example-gaps of this exact shape appear in: `collections-hashmap-internals` (bucket index, resize lo/hi split), `completablefuture-async` (which thread runs each stage), `exception-handling` (throw cost in ns/µs), `executor-framework-concurrency-utils` (pool-sizing calc + admission trace), `garbage-collection` (traced minor GC + tenuring), `heap-vs-stack-memory` (tenuring + RSS arithmetic), `java-module-system-jpms` (accessibility-rule trace), `java8-date-time-api` (end-of-month + DST math), `java8-streams-lambdas-optional` (3-arg reduce combiner, parallel cost), `jvm-architecture-class-loading` (which slot holds what), `modern-jvm-gc-jit-graalvm` (colored-pointer bits, tiered thresholds), `object-methods-equality` (HashMap.get bit-trace, transitivity), `oop-principles-polymorphism` (LSP), `reflection-annotations-proxies` (perf ratios), `synchronized-volatile-jmm` (lost update, ABA), `virtual-threads-structured-concurrency` (capacity/Little's-law arithmetic), plus `generics-type-system`, `design-patterns-java`, `multithreading-concurrency`. Recommend a single house style: pick concrete inputs, show the intermediate values, show the output.

**2. The hardest mechanisms are named but not traced step-by-step (concurrency + GC/JVM cluster).**
Distinct from theme 1 in that these are the *crux* concepts an interviewer asks you to "walk through": CAS retry loops and happens-before/reordering (`synchronized-volatile-jmm`, `multithreading-concurrency`), colored pointers + self-healing load barriers + concurrent relocation (`modern-jvm-gc-jit-graalvm`, `garbage-collection`), TLAB allocation and write-barrier/card-table (`garbage-collection`), JIT tiered compilation + deoptimization (`modern-jvm-gc-jit-graalvm`, `jvm-architecture-class-loading`), DCL partial-construction reordering (`design-patterns-java`, `multithreading-concurrency`), mount/unmount continuation lifecycle (`virtual-threads-structured-concurrency`). These 6-file cluster deserves coordinated traced walkthroughs.

**3. Missing classic interview subtopics (depth omissions, ~8 files).**
Whole topics an interviewer expects are absent: thread-pool sizing + `ThreadPoolExecutor` internals + DCL (`multithreading-concurrency`), `Clock` for testability + `YearMonth`/`MonthDay` (`java8-date-time-api`), Visitor + Command + Chain of Responsibility (`design-patterns-java`), Execution Engine / JIT section (`jvm-architecture-class-loading`), TLAB + escape-analysis (`garbage-collection`), stateful-vs-stateless intermediate ops + encounter order (`java8-streams-lambdas-optional`), exceptions across threads/async + precise rethrow (`exception-handling`), raw-type contagion (`generics-type-system`), sealed classes as modern subtype control (`oop-principles-polymorphism`).

**4. Factual accuracy: one must-fix error + 14 more version claims to web-verify (15 files flagged).**
One outright misconception: `serialization` claims enums rely on `readResolve` (they do not — enums are serialized specially by name; the guarantee is automatic). Other correctness nits: `executor-framework` omits CHM's `MIN_TREEIFY_CAPACITY=64` rule; `virtual-threads` shows the JDK-21-preview `StructuredTaskScope` API that was later redesigned; `heap-vs-stack` overstates `StackOverflowError` recoverability; `exception-handling` overstates operand-stack mechanics as JVM-mandated. `needs_web_verification=true` (15): collections-hashmap-internals, completablefuture-async, exception-handling, garbage-collection, heap-vs-stack-memory, java8-functional-interfaces-method-references, java8-streams-lambdas-optional, jvm-architecture-class-loading, modern-jvm-gc-jit-graalvm, parallelism-parallel-streams-forkjoin, pattern-matching-switch-expressions, records-sealed-classes, reflection-annotations-proxies, serialization, virtual-threads-structured-concurrency.

**5. "Why these numbers/names" intuition gaps (~6 files).**
Magic constants and terms presented as givens: load factor 0.75 & treeify-at-8 Poisson rationale (`collections-hashmap-internals`), sum/product ADT naming (`records-sealed-classes`), "poly expression" jargon (`java8-functional-interfaces-method-references`), happens-before analogy (`synchronized-volatile-jmm`), admission-algorithm rationale "queue before max" (`executor-framework-concurrency-utils`), final-field freeze mechanism (`immutability-strings`).

**6. Missing diagrams where a visual would teach faster (low-severity, ~9 files).**
The repo standardizes on mermaid; candidates: classloader hierarchy (`jvm-architecture-class-loading`), thread state machine (`multithreading-concurrency`), vtable layout (`oop-principles-polymorphism`), fork/join split tree + worker deques (`parallelism-parallel-streams-forkjoin`), PECS/variance (`generics-type-system`), Error hierarchy (`heap-vs-stack-memory`), bucket/tree diagram (`object-methods-equality`), proxy round-trip (`serialization`), vthread mount/unmount (`virtual-threads-structured-concurrency`).

## High-priority subtopics

**No subtopic is tagged `high` priority** — the domain has no file in bad shape. All 23 non-low files are `medium`. To keep this section useful, below is the *de-facto* worst shortlist: the files that should be touched first because they either carry a factual error or score lowest on the (heavily-weighted) examples dimension while carrying high-severity example-gaps.

### serialization (correctness — fix first)
- **HIGH / correctness** — `## transient and custom writeObject/readObject` + follow-ups: claims enums rely on `readResolve` for their single-instance guarantee. Wrong. **Fix:** state that `readResolve` is essential only for *class-based* singletons; enums are serialized specially by name and get the guarantee automatically (this is exactly why the enum singleton is preferred, EJ Item 3/89). Reword the matching follow-up.
- **HIGH / depth** — `## Why native serialization is discouraged`: the "single most important interview theme" (deserialization RCE) is asserted with zero mechanism. **Fix:** add a 3-4 step gadget-chain walkthrough (stream names classes → OIS instantiates them and runs their `readObject`/`hashCode` → a classpath gadget reaches `Runtime.exec` → key insight that the *stream*, not your declared type, picks the classes), then a minimal `ObjectInputFilter` example and its allow-list limitation.
- **MEDIUM / gotchas** — `## JSON serialization with Jackson`: never warns that JSON has no cycle/identity model, so bidirectional graphs throw (`StackOverflowError`). **Fix:** note `@JsonManagedReference`/`@JsonBackReference`/`@JsonIdentityInfo`, tying back to native serialization's cycle handling as a migration trade-off.

### executor-framework-concurrency-utils (example score 2)
- **HIGH / example-gap** — sizing + admission: the two hardest mechanics are pure prose. **Fix:** work `N_cpu*(1+wait/compute)` with real numbers (8 cores, 90ms IO/10ms CPU → 80 threads) and trace `ThreadPoolExecutor(core=2,max=4,queue=2)` submitting 8 tasks to show "queue fills before max grows."
- **MEDIUM / missing-intuition** — explain *why* queue-before-max (standing staff / waiting room / emergency temps mental model), so students understand instead of memorizing.
- **MEDIUM / example-gap** — fixed-rate vs fixed-delay: add the overrun timeline (3s task, 1s period → fires 0,3,6,9 back-to-back vs 0,4,8,12).
- **MEDIUM / correctness** — CHM treeify also needs table capacity ≥ 64 (`MIN_TREEIFY_CAPACITY`); below that it resizes instead.

### garbage-collection (example score 2)
- **HIGH / example-gap** — minor GC / tenuring is prose only. **Fix:** trace Eden=256MB, S0/S1=32MB, `MaxTenuringThreshold=15` through several collections including a survivor-overflow premature-promotion case.
- **HIGH / depth** — no TLAB coverage. **Fix:** add a subsection on thread-local allocation buffers explaining lock-free bump-the-pointer and the shared refill path.
- **MEDIUM / example-gap** — write barriers / card tables (~512-byte cards) shown abstractly; add a `oldObj.field=youngObj` barrier-fires trace.
- **MEDIUM / missing-intuition + depth** — ZGC load barriers unexplained; throughput has no arithmetic. Add a self-healing-load-barrier trace and a "600ms GC / 60s = 1% overhead" calc.

### modern-jvm-gc-jit-graalvm (example score 2)
- **HIGH / example-gap** — colored pointers + load barriers pure prose. **Fix:** show a 64-bit pointer with example color/address bit fields and trace a stale-reference load that follows the forwarding entry and self-heals.
- **HIGH / example-gap** — JIT tiered levels 0-4 abstract. **Fix:** worked warm-up with approximate Tier3/Tier4 thresholds, an OSR note, and a monomorphic-inline → new-subclass → uncommon-trap/deopt trace.
- **MEDIUM / gotchas** — "concurrent everything / sub-ms" oversells; name the residual STW phases (mark start/end, relocate start) and why they're heap-size-independent.

*(Also carrying two high-severity example-gaps each and worth early attention: `collections-hashmap-internals`, `object-methods-equality`, `synchronized-volatile-jmm`, `multithreading-concurrency`, `reflection-annotations-proxies`, `java8-date-time-api`, `java8-streams-lambdas-optional`, `design-patterns-java`.)*

## Refinement plan

Recommended order of attack:

1. **Fix the factual error now** — `serialization` enum/`readResolve` claim (interview-wrong as written), plus the four smaller correctness nits (executor CHM treeify capacity, virtual-threads `StructuredTaskScope` API drift, heap-vs-stack SOE recoverability, exception-handling operand-stack wording). Low effort, high credibility payoff.

2. **Batch the example=2 files** (`executor-framework-concurrency-utils`, `garbage-collection`, `modern-jvm-gc-jit-graalvm`) — biggest single lift on the weighted examples dimension; each needs one or two concrete traces.

3. **Coordinated concurrency/GC mechanism traces** (Systemic theme 2) across `synchronized-volatile-jmm`, `multithreading-concurrency`, `collections-hashmap-internals`, `object-methods-equality`, `garbage-collection`, `modern-jvm-gc-jit-graalvm`, `virtual-threads-structured-concurrency` — reuse one worked-example style (CAS retry, happens-before interleaving, minor-GC trace, bucket-index bit-trace, capacity arithmetic).

4. **Fill missing subtopics** (theme 3): thread-pool sizing/DCL, `Clock`, Visitor/Command/CoR, Execution Engine/JIT, TLAB, stateful ops, async exceptions.

5. **Add the "why these numbers/names" intuition inserts** (theme 5) and the **mermaid diagrams** (theme 6) — cheap, high-clarity wins for the lower-priority files including the two `low`-priority ones (`immutability-strings`: add pre-7u6 substring-leak gotcha + O(n²) arithmetic; `java8-functional-interfaces-method-references`: unpack poly-expression and overload ambiguity).

6. **Single web-verification pass at the end** covering the **15 files** flagged `needs_web_verification=true` (listed in Systemic issue #4). These are version/default/JEP claims — HotSpot defaults (`-Xss`, PermGen, compressed-oops threshold, common-pool parallelism), JEP numbers/status (JEP 474 ZGC-default, JEP 491 pinning, Shenandoah generational, `SwitchBootstraps` behavior, `StructuredTaskScope` redesign), the ~43 functional-interface count, treeify Poisson probability, and micro-benchmark ballparks. Verify all in one sweep so version claims stay mutually consistent.
