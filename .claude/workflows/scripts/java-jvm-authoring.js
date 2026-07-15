export const meta = {
  name: 'java-jvm-authoring',
  description: 'Author interview-grade concepts.md + all-tier MCQ questions.yaml for all 24 Java/JVM topics (incl. Java 8 depth + modern JDK 17/21 features), then verify',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check (version accuracy) + schema-check each topic, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/java-jvm`

const VERSION_NOTE = `
VERSION ACCURACY IS CRITICAL for this domain. Be precise about WHICH Java version introduced or
finalized a feature, and its status:
- Java 8 (2014): lambdas, streams, functional interfaces, method refs, Optional, java.time, default methods, CompletableFuture.
- Records: preview JDK 14/15, FINAL in JDK 16. Sealed classes: preview 15/16, FINAL in JDK 17.
- Text blocks: FINAL in JDK 15. Switch expressions: FINAL in JDK 14.
- Pattern matching for instanceof: FINAL JDK 16. Pattern matching for switch: preview 17-20, FINAL in JDK 21.
- Record patterns: FINAL in JDK 21. Sequenced Collections: JDK 21.
- Virtual threads (Project Loom): preview JDK 19/20, FINAL in JDK 21. Structured concurrency: still PREVIEW/incubating in 21 (be explicit it is not final).
- GCs: G1 default since JDK 9; ZGC production-ready JDK 15 (generational ZGC in JDK 21); Shenandoah production JDK 15.
- JDK 17 and JDK 21 are the current LTS releases. When unsure, WEB-RESEARCH the exact version/status — do not guess.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — study content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (MCQ anchor targets — keep stable).
   - IMPORTANT: heading text must NOT contain '/' or '&' (breaks anchor slugs). Use commas / "and".
   - LAYERED depth: beginner definition + why → intermediate usage/comparisons → advanced internals,
     edge cases, and gotchas. Include code snippets, comparison tables, and clearly TAG the Java version
     for version-specific features (e.g. "Since Java 16", "Final in JDK 21").
   - For modern features, explain the PROBLEM they solve and the OLD way vs NEW way (e.g. virtual threads
     vs platform-thread-per-request; records vs manual POJO/Lombok; sealed classes vs open hierarchies).
   - End with "## Common interview follow-up questions" and "## References" (cite JEPs / official docs used).

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"
     domain: java-jvm
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq from 001, prefix = topic-slug
         difficulty: intermediate  # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                # 0-BASED index of the correct option
         explanation: |
           <why correct; teach the concept and why distractors are wrong>
         ref: "concepts.md#<anchor>"   # resolves to a real "## " heading (GitHub slug rules)

   RULES:
   - Produce 50-70 questions. Cover EVERY subtopic with several questions each.
   - ALL FOUR difficulties present: roughly 20% beginner, 30% intermediate, 30% advanced, 20% expert.
   - Include CODE-ANALYSIS questions ("what does this print / compile error / throw?"), version questions
     ("which Java version finalized X?"), and scenario/trade-off questions. Use realistic code snippets in
     the question body. LONG, plausible options where it challenges the learner. Distractors wrong for a
     specific, defensible reason.
   - 3-5 options, exactly one correct, 'answer' 0-based, VARY the correct index across the file.
   - No "all/none of the above". Every 'ref' anchor resolves to a real "## " heading. id prefix = slug.

Use the Write tool to create both files. Do your own web research (JEPs, official docs) for accuracy.
Return one line: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions, all tiers)".
`

const TOPICS = [
  // --- existing core Java/JVM topics ---
  { slug: 'jvm-architecture-class-loading', name: 'JVM Architecture & Class Loading',
    hints: 'JVM vs JRE vs JDK; runtime data areas (heap, stacks, metaspace, PC, native); class loading phases (loading, linking=verify/prepare/resolve, initialization); classloader hierarchy (bootstrap, platform/ext, app) & parent-delegation; custom classloaders; ClassNotFoundException vs NoClassDefFoundError; metaspace vs PermGen (removed in Java 8); static init order.' },
  { slug: 'heap-vs-stack-memory', name: 'JVM Memory Model: Heap vs Stack',
    hints: 'heap vs stack (what lives where); young gen (eden/survivor) vs old gen; metaspace; stack frames & StackOverflowError; OutOfMemoryError kinds (heap, metaspace, GC overhead, direct buffer); primitives vs references; escape analysis & TLAB; string pool location; -Xms/-Xmx/-Xss tuning.' },
  { slug: 'garbage-collection', name: 'Garbage Collection',
    hints: 'GC roots & reachability; mark-sweep-compact; generational hypothesis; minor vs major/full GC; Serial, Parallel, CMS (removed), G1 (default since 9), ZGC, Shenandoah — how they differ & when to use; stop-the-world & pause-time goals; throughput vs latency trade-off; reference types (strong/soft/weak/phantom); finalization deprecation; GC tuning & logging basics.' },
  { slug: 'multithreading-concurrency', name: 'Multithreading & Concurrency Fundamentals',
    hints: 'thread lifecycle & states; Runnable vs Thread vs Callable; race conditions, deadlock/livelock/starvation; wait/notify/notifyAll & intrinsic locks; join; thread safety strategies; atomicity/visibility/ordering; daemon threads; ThreadLocal; interrupt mechanism; producer-consumer.' },
  { slug: 'synchronized-volatile-jmm', name: 'synchronized, volatile & the Java Memory Model',
    hints: 'JMM: happens-before, visibility, reordering; volatile (visibility + prevents reordering, not atomicity); synchronized (mutual exclusion + visibility, reentrant, monitor); atomic classes & CAS; double-checked locking (why volatile needed); final field semantics; false sharing; volatile vs atomic vs synchronized trade-offs.' },
  { slug: 'executor-framework-concurrency-utils', name: 'Executor Framework & java.util.concurrent',
    hints: 'Executor/ExecutorService/ThreadPoolExecutor (core/max/queue/rejection policies); Executors factory pitfalls (unbounded queues); Future vs CompletableFuture; ScheduledExecutorService; Fork/Join & work-stealing; concurrent collections (ConcurrentHashMap, CopyOnWriteArrayList, BlockingQueue); locks (ReentrantLock, ReadWriteLock, StampedLock); CountDownLatch/CyclicBarrier/Semaphore/Phaser.' },
  { slug: 'collections-hashmap-internals', name: 'Collections Framework & HashMap Internals',
    hints: 'collection hierarchy (List/Set/Map/Queue/Deque); ArrayList vs LinkedList; HashMap internals (buckets, hashing, load factor, resize/rehash, treeification at 8 since Java 8); HashMap vs Hashtable vs ConcurrentHashMap vs LinkedHashMap vs TreeMap; fail-fast vs fail-safe iterators; equals/hashCode contract in maps; Comparable vs Comparator.' },
  { slug: 'java8-streams-lambdas-optional', name: 'Java 8+ Features: Lambdas, Streams & Optional',
    hints: 'lambdas & closures (effectively final capture); Stream API (intermediate vs terminal, lazy evaluation, short-circuiting); map/filter/reduce/collect; Collectors (groupingBy, joining, toMap, partitioningBy); parallel streams & when they help/hurt; Optional correct usage & anti-patterns; primitive streams; flatMap; stream vs loop trade-offs.' },
  { slug: 'immutability-strings', name: 'Immutability & String Handling',
    hints: 'why immutability (thread-safety, caching, safe sharing); building immutable classes; String immutability & the string pool, intern(); String vs StringBuilder vs StringBuffer; concatenation & compact strings (Java 9); why String is immutable (security, hashing, pool); defensive copies; records as immutable carriers (link modern).' },
  { slug: 'exception-handling', name: 'Exception Handling',
    hints: 'checked vs unchecked vs Error; try-catch-finally; try-with-resources & AutoCloseable; multi-catch; exception chaining; custom exceptions; finally + return gotchas; suppressed exceptions; best practices (fail fast, don\'t swallow); performance of exceptions; when checked vs unchecked.' },
  { slug: 'oop-principles-polymorphism', name: 'OOP Principles & Polymorphism',
    hints: 'encapsulation/inheritance/polymorphism/abstraction; overloading (compile-time) vs overriding (runtime) & rules; dynamic dispatch; abstract class vs interface (and default/static/private interface methods since Java 8/9); composition over inheritance; SOLID intro; covariant returns; access modifiers.' },
  { slug: 'generics-type-system', name: 'Generics & the Type System',
    hints: 'generics motivation & type safety; type erasure & its consequences (no new T[], no instanceof T); bounded types; wildcards (? extends / ? super) & PECS; generic methods & classes; invariance of generics vs array covariance; bridge methods; reifiable types; interaction with reflection.' },
  { slug: 'reflection-annotations-proxies', name: 'Reflection, Annotations & Dynamic Proxies',
    hints: 'reflection API (Class, Method, Field, setAccessible & strong encapsulation in modern JDK); annotations (retention/target, @Retention runtime for reflection); meta-annotations; building annotation processors (intro); JDK dynamic proxies (Proxy/InvocationHandler, interfaces only) vs CGLIB (subclassing) — the mechanism frameworks use; performance & when to avoid reflection.' },
  { slug: 'object-methods-equality', name: 'Object Class Contract: equals, hashCode, toString & clone',
    hints: 'equals contract (reflexive/symmetric/transitive/consistent/non-null); hashCode contract & the equals-hashCode link; consequences of breaking it in hash collections; overriding correctly; == vs equals; clone() pitfalls & why it is discouraged (shallow vs deep, Cloneable); records auto-generate equals/hashCode/toString (link modern).' },
  { slug: 'design-patterns-java', name: 'Design Patterns (framework-relevant)',
    hints: 'creational (singleton incl. enum/DCL, factory, builder), structural (adapter, decorator, proxy), behavioral (strategy, observer, template method); patterns Spring/JDK use (proxy, template, factory, singleton beans); anti-patterns; when patterns add value vs over-engineering; functional replacements for some patterns (strategy via lambda).' },
  { slug: 'serialization', name: 'Serialization & Deserialization',
    hints: 'Java native serialization (Serializable, serialVersionUID, transient, writeObject/readObject); why native serialization is discouraged (security/deserialization attacks, brittleness); Externalizable; JSON serialization (Jackson) as the modern default; records & serialization; versioning/compatibility; alternatives (protobuf).' },
  // --- Java 8 additions ---
  { slug: 'java8-functional-interfaces-method-references', name: 'Java 8 Functional Interfaces & Method References',
    hints: '@FunctionalInterface & the SAM concept; the java.util.function catalog (Function, BiFunction, Predicate, Consumer, Supplier, UnaryOperator, BinaryOperator + primitive variants); composing functions (andThen/compose/and/or/negate); the four method-reference kinds (static, bound instance, unbound instance, constructor) and how each maps to a lambda; default & static methods on interfaces; target typing & type inference.' },
  { slug: 'java8-date-time-api', name: 'Java 8 Date/Time API (java.time)',
    hints: 'why java.util.Date/Calendar were broken (mutable, not thread-safe, 0-based months); LocalDate/LocalTime/LocalDateTime; ZonedDateTime & ZoneId; Instant vs LocalDateTime (machine vs human time); Duration vs Period; DateTimeFormatter (thread-safe unlike SimpleDateFormat); immutability of the API; converting legacy Date <-> Instant; temporal adjusters; common pitfalls.' },
  { slug: 'completablefuture-async', name: 'CompletableFuture & Asynchronous Programming',
    hints: 'Future limitations; CompletableFuture creation (supplyAsync/runAsync); chaining thenApply vs thenCompose vs thenCombine; async vs non-async variants & which thread runs the callback; the common ForkJoinPool vs a custom executor (important!); exception handling (exceptionally/handle/whenComplete); allOf/anyOf; composing pipelines; blocking (join/get) pitfalls; comparison to reactive & to virtual threads (modern).' },
  // --- JDK 16/17 modern language ---
  { slug: 'records-sealed-classes', name: 'Records, Sealed Classes & Modern Data Modeling (JDK 16-17)',
    hints: 'records (final in JDK 16): auto components/accessors/equals/hashCode/toString, canonical vs compact vs custom constructors, implicit final, cannot extend, can implement interfaces, static members, validation in compact ctor; sealed classes/interfaces (final JDK 17): permits, sealed/non-sealed/final subtypes, exhaustiveness enabling; records + sealed = algebraic data types / pattern-matching synergy; records vs Lombok vs classic POJO trade-offs; serialization of records.' },
  { slug: 'pattern-matching-switch-expressions', name: 'Pattern Matching, Switch Expressions & Text Blocks (JDK 14-21)',
    hints: 'switch expressions (final JDK 14): arrow labels, yield, exhaustiveness, no fall-through; text blocks (final JDK 15): """ syntax, incidental whitespace stripping; pattern matching for instanceof (final JDK 16): binding variable & flow scoping; pattern matching for switch (final JDK 21): type patterns, guarded patterns (when), null handling, exhaustiveness with sealed types; record patterns (final JDK 21): deconstruction, nested patterns; version/status accuracy is essential here.' },
  // --- JDK 21 concurrency ---
  { slug: 'virtual-threads-structured-concurrency', name: 'Virtual Threads & Structured Concurrency (JDK 21, Project Loom)',
    hints: 'virtual threads (final JDK 21): what they are (lightweight, JVM-scheduled, mounted on carrier platform threads), the thread-per-request model without the cost, why they solve the blocking-IO scalability problem; carrier threads & the ForkJoinPool scheduler; PINNING (synchronized blocks / native calls pin the carrier — key gotcha) vs ReentrantLock; when virtual threads do NOT help (CPU-bound); virtual vs platform threads; thread pools become an anti-pattern with VTs; structured concurrency (StructuredTaskScope — still PREVIEW in 21, be explicit); scoped values; comparison to reactive/CompletableFuture.' },
  // --- modern JVM ---
  { slug: 'modern-jvm-gc-jit-graalvm', name: 'Modern JVM: ZGC, Shenandoah, JIT, GraalVM & JFR',
    hints: 'low-pause collectors ZGC (sub-millisecond, colored pointers/load barriers; generational ZGC in JDK 21) & Shenandoah (concurrent compaction) vs G1 — trade-offs (pause vs throughput vs footprint); JIT compilation (C1/C2 tiered compilation, interpretation → compilation, deoptimization, inlining, JITWatch); AOT & GraalVM native image (fast startup/low memory vs no JIT peak perf, closed-world, reflection config) — trade-offs for microservices/serverless; JFR & JDK Mission Control for profiling; when native image helps vs hurts.' },
  { slug: 'java-module-system-jpms', name: 'Java Platform Module System (JPMS)',
    hints: 'JPMS (Project Jigsaw, Java 9): module-info.java, requires/exports/opens/uses/provides; strong encapsulation (why setAccessible/reflection broke); readability & accessibility; named vs automatic vs unnamed modules & the classpath vs module path; jlink custom runtimes; migration challenges; module trade-offs & why adoption is uneven; relation to reflection encapsulation in modern JDKs.' },
  { slug: 'parallelism-parallel-streams-forkjoin', name: 'Parallelism: Parallel Streams, Fork/Join & Data Parallelism',
    hints: 'concurrency vs parallelism (the distinction interviewers probe); data parallelism vs task parallelism; the Fork/Join framework (RecursiveTask/RecursiveAction, work-stealing, the common pool, compute/fork/join, threshold splitting); parallel streams (how they use the common ForkJoinPool, spliterators & splitting, when they help vs hurt — small datasets, boxing, stateful/ordered ops, shared mutable state, the common-pool contention gotcha & customizing parallelism); Arrays.parallelSort / parallelPrefix; Amdahl\'s law & diminishing returns; when to prefer CompletableFuture (task/async) or virtual threads (blocking IO) over parallel streams (CPU-bound data); measuring before parallelizing.' },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior Java engineer and interview coach authoring study material for the JAVA/JVM topic ` +
    `"${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n${VERSION_NOTE}\n\n` +
    `FOCUS / subtopics to cover:\n${t.hints}\n\n${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Full-depth concepts, all four MCQ tiers (50-70). ` +
    `Be meticulous about Java version accuracy.`,
    { label: `author:${t.slug}`, phase: 'Author', effort: 'high' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer verifying JAVA/JVM interview content for "${t.name}" (slug: ${t.slug}).\n\n${VERSION_NOTE}\n\n` +
    `Read BOTH ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors — ESPECIALLY Java VERSION accuracy (which JDK introduced/finalized a feature; ` +
    `preview vs final status — e.g. virtual threads FINAL in 21 but structured concurrency still PREVIEW; ` +
    `records final 16, sealed final 17, pattern matching for switch final 21). Web-research anything uncertain. ` +
    `Also verify code-analysis question outputs actually compile/print/throw as claimed. A wrong 'answer' index ` +
    `or a wrong version claim is the worst defect — fix it.\n` +
    `2) SCHEMA: valid YAML; top-level topic/domain(java-jvm)/topic_slug(${t.slug})/version/questions; ids prefixed ` +
    `'${t.slug}-', unique, contiguous 3-digit from 001; difficulty in {beginner,intermediate,advanced,expert} with ` +
    `all four represented; 3-5 options; 0-based in-range 'answer'; correct index VARIED; every 'ref' anchor resolves ` +
    `to a real '## ' heading (no '/' or '&' in headings — rename with comma/"and" + fix refs).\n` +
    `3) COVERAGE: 50-70 questions, every subtopic represented, all four tiers. If thin, ADD questions. Dedupe by rewriting.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
