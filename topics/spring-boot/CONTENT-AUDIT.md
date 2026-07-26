# spring-boot — Content Audit

**Executive summary.** The spring-boot domain is in strong shape: across all 18 subtopics, **depth is uniformly excellent (5/5 everywhere)** and **clarity is high (avg 4.44/5)** — the content reads at a genuine senior/staff interview bar, with reasoned trade-offs, precise gotchas, version-specific behavior, and dedicated "common follow-up" sections that mirror how interviewers actually probe. The one dimension dragging the whole domain is **worked examples (avg 3.22/5)**: nearly every file explains mechanisms in prose and annotated config/code snippets but stops short of *numbers-in/numbers-out traces* — the single most repeated finding in the audit. No subtopic is rated **high** refine-priority; **15 are medium** and **3 are low** (`aop-filters-interceptors`, `core-annotations-stereotypes`, `ioc-dependency-injection`). However, **9 subtopics carry at least one high-severity issue** (all example-gaps or factual errors), and **3 files contain outright correctness errors** that would mislead a student (`reactive-webflux` mislabels `zip`, `async-scheduling-events` mis-attributes fixedRate non-overlap, `fundamentals` cites a non-existent property). **16 of 18 files are flagged `needs_web_verification`** for version/default claims. Headline takeaway: this domain does not need rewriting — it needs a **worked-example pass** (traces + capacity math), a lighter **intuition/diagram pass**, and a **fact-verification sweep**.

## Scorecard

Sorted high-priority first, then lowest total (clarity + examples + depth) first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| messaging-event-driven-integration | 4 | 2 | 5 | medium | Deep & gotcha-rich but almost entirely prose — teaches rules without a single traced example; two high-severity gaps (Kafka durability/partitioning, idempotent-consumer race). |
| actuator-monitoring-embedded-servers | 4 | 3 | 5 | medium | Outstanding depth; needs numeric walkthroughs for cardinality, thread-pool capacity, and percentile aggregation. |
| bean-scopes-lifecycle | 4 | 3 | 5 | medium | Exceptional depth; lifecycle firing order (the most-tested concept) lacks a traced output; needs extension-point analogies. |
| exception-handling-validation | 4 | 3 | 5 | medium | Deep traps but never shows the actual serialized `application/problem+json` body a client receives. |
| spring-data-jpa-persistence | 4 | 3 | 5 | medium | Staff-level depth; dense "Expert" bullet walls + no traced SQL for isNew/allocationSize/N+1 counts. |
| spring-mvc-rest-apis | 4 | 3 | 5 | medium | Deep & gotcha-rich; idempotency, async thread-handoff, and ETag exchanges all lack concrete traces. |
| spring-security-basics | 4 | 3 | 5 | medium | Outstanding depth; JWT/BCrypt never decoded, filter-chain lacks a traced request + intuition lead-in. |
| async-scheduling-events | 5 | 3 | 5 | medium | Exceptionally deep; executor sizing needs a numeric trace + one misleading fixedRate-overlap claim to fix. |
| caching-abstraction | 5 | 3 | 5 | medium | Deep & clear; cache-stampede and key-collision are the richest untapped worked-example opportunities. |
| fundamentals-autoconfiguration-starters | 5 | 3 | 5 | medium | Staff-level; needs precedence trace + a real Condition Evaluation Report sample; one invented property to fix. |
| microservices-spring-cloud-resilience | 5 | 3 | 5 | medium | Outstanding breadth; circuit-breaker/retry/token-bucket flagship concepts never traced with numbers. |
| reactive-webflux | 5 | 3 | 5 | medium | Deep with strong intuition; lacks threading/backpressure/flatMap traces and mis-defines `zip` as "latest". |
| transaction-management | 5 | 3 | 5 | medium | Senior-grade; isolation anomalies, propagation, and optimistic-lock races need interleaved timelines. |
| configuration-profiles-properties | 4 | 4 | 5 | medium | Deep on precedence/internals; definition-first tone, needs end-to-end precedence trace + collection-replacement example. |
| testing-spring-boot-applications | 4 | 4 | 5 | medium | Deep & gotcha-rich; context-caching (its hardest idea) lacks a concrete trace; back half is bullet-walls. |
| aop-filters-interceptors | 4 | 4 | 5 | low | Senior-grade reference; advice-ordering + proxy concepts would land harder with one traced example. |
| core-annotations-stereotypes | 5 | 4 | 5 | low | Staff-bar; only exception-translation and scoped-proxy bug want a concrete trace. |
| ioc-dependency-injection | 5 | 4 | 5 | low | Near-exhaustive, intuition-first; only gaps are diagrams (three-level cache, context hierarchy). |

## Systemic issues

These themes recur across many subtopics; fixing them at the domain level is higher-leverage than per-file edits.

### 1. Missing numbers-in / numbers-out worked examples (18/18 files — THE dominant issue)
Every single subtopic was dinged for explaining mechanisms in prose or annotated snippets but never *tracing* them with concrete inputs and outputs. This is the direct cause of the low example average (3.22) and the refinement bar's #2 weight. The pattern is identical everywhere: "the student can recite the rule but cannot predict behavior." High-value untapped traces called out by the audit:
- **Capacity/quantitative math:** actuator (Little's-Law thread capacity, metric-cardinality multiplication, cross-instance percentile aggregation), reactive (MVC-vs-WebFlux throughput/memory ceiling, backpressure `request(n)` counter), microservices (circuit-breaker state transitions, retry backoff sequence, token-bucket timeline), spring-mvc (deep-offset vs keyset pagination cost), caching (stampede DB-call spike, cache break-even latency), data-jpa (N+1 query counts, `@BatchSize`, `allocationSize=50` pooling).
- **Traced request/response artifacts:** exception (`application/problem+json` body), spring-mvc (ETag 304/412 exchange, idempotency-key replay, async thread timeline, 406-vs-415), spring-security (decoded JWT, bcrypt hash anatomy, filter-by-filter request walk), fundamentals (Condition Evaluation Report sample).
- **Interleaved/state-transition traces:** transaction (isolation anomalies, propagation DB-state, optimistic-lock race), bean (lifecycle callback firing order, scoped-proxy per-request resolution), messaging (Kafka durability under ISR loss, idempotent-consumer interleaving, delivery-semantics crash sequences, outbox flow), async (executor core→queue→max→reject), testing (context-cache hit/miss with timing).

### 2. Definition-first / missing plain-language intuition lead-in (12/18 files)
Many sections open with formal machinery (interface signatures, bolded "Definition.", jargon) before giving a mental model — the exact opposite of the refinement bar's #1 weight. Slugs: `configuration-profiles-properties` (nearly every section leads with "Definition."), `spring-security-basics` (filter chain, CSRF — 2 findings, plus undefined BREACH/synchronizer-token/token-fixation jargon), `bean-scopes-lifecycle` (BFPP/BPP/BDRPP machinery), `messaging` (EDA styles table, `fold(events)` jargon), `aop-filters-interceptors` (proxy assumed, not introduced), `fundamentals`, `microservices` (circuit-breaker analogy never stated), `spring-data-jpa`, `spring-mvc` (method-validation 500-vs-400 rationale), `transaction`, `ioc` (early-reference intuition arrives late), plus `testing`'s undefined "Ryuk".

### 3. Missing diagrams for inherently spatial/sequential concepts (11/18 files)
The repo already has a mermaid render pipeline, yet pipeline/hierarchy/state-transition concepts are taught as prose or ASCII arrow-chains. Recurring diagram requests: three-level singleton cache (`ioc`, `bean`), filter/interceptor chains (`spring-security`, `spring-mvc`, `microservices` gateway), saga orchestration + span trees (`microservices`), request lifecycle/DispatcherServlet (`spring-mvc`), OSIV/N+1 fan-out (`spring-data-jpa`), precedence tiers + lifecycle-hook timeline (`configuration`, `core`, `fundamentals`), RabbitMQ routing + Kafka partition assignment (`messaging`), transaction proxy/self-invocation (`transaction`), slice-boundary layer stack (`testing`).

### 4. Unverified version/default claims + 3 outright factual errors (16/18 flagged `needs_web_verification`)
A large cluster of load-bearing version-pinned assertions needs a verification sweep (only `bean-scopes-lifecycle` and `core-annotations-stereotypes` are clean). Most are "probably right but drift-prone" (Kafka idempotence defaults, Eureka timings, Resilience4j decorator order, `@MockBean` 3.4 deprecation, bcrypt/cache-size constants). **Three are actual errors that would mislead a candidate and should be fixed, not just verified:**
- `reactive-webflux`: describes `zip` as combining the *latest* item from each publisher — that is `combineLatest`; `zip` pairs by index. Mislabels the exact distinction interviewers probe.
- `async-scheduling-events`: attributes fixedRate non-overlap to the *single-threaded scheduler*, implying a bigger pool makes one job overlap itself. `scheduleAtFixedRate` never runs the same task concurrently regardless of pool size.
- `fundamentals-autoconfiguration-starters`: cites a non-existent property `spring.main.background-initialization` (real toggle is `spring.backgroundpreinitializer.ignore`).

### 5. Dense "Expert" bullet-walls / redundancy hurting clarity (4/18 files)
`spring-data-jpa-persistence` (comma-spliced multi-fact Expert bullets — the main reason its clarity is 4 not 5), `testing-spring-boot-applications` (back half degrades into bold-lead-in bullet dumps), `exception-handling-validation` (Spring 6.1 dual-path explained twice, with an editor's-note "the statement above…" that confuses), `bean-scopes-lifecycle` (prototype-destruction restated twice).

## High-priority subtopics

No subtopic carries a `high` **refine_priority** rating — the content is too strong overall for that. But **9 subtopics contain high-*severity* issues**, and these are the practical top of the work queue. Each is listed with its most severe issues and the concrete fix.

### messaging-event-driven-integration (medium priority; 2 high-severity, lowest score in domain — 4/2/5)
1. **[high] Kafka durability & partitioning never traced** (Delivery Semantics / Kafka core model). Fix: walk RF=3, min.insync.replicas=2 across all-up / 1-down (commits) / 2-down (blocks with `NotEnoughReplicasException`); and a partition trace `hash("order-42")%4 → partition 2` showing key-affinity.
2. **[high] Idempotent-consumer check-then-act race in prose only** (Expert). Fix: trace two pods both `SELECT`-ing "not processed", then `INSERT idempotency_key='abc'` succeeding on A and throwing a unique-constraint violation on B (caught → skip), in the same tx as the side effect.
3. **[medium] Delivery semantics not shown as crash sequences.** Fix: 3-line at-least-once vs at-most-once traces with concrete offsets (charge-twice vs lost-charge).
4. **[medium] Transactional outbox referenced but never laid out end-to-end.** Fix: 4-step walkthrough (business write + outbox insert in one tx → relay publishes → marks sent → crash = re-publish), stating the relay is at-least-once → why idempotent consumers are still required.
5. **[medium] EDA styles table jargon-forward** (empty CQRS cell, `fold(events)`). Fix: fill the CQRS example, replace `fold(events)` with "replay past events to rebuild state," add one-line intuition per style.

### spring-security-basics (medium priority; 2 high-severity — 4/3/5)
1. **[high] JWT never decoded concretely.** Fix: show a truncated real token, decode header+payload JSON (sub/iat/exp/scope), note the middle part is base64-decodable by anyone, then a tampered-payload verification failure.
2. **[high] BCrypt hash anatomy in words only.** Fix: label a real `$2a$10$…` hash (version / cost=2^10 / 22-char salt / 31-char hash) + 2-line `matches()` re-derivation trace.
3. **[medium] Filter chain has no intuition lead-in and no traced request.** Fix: bouncer/checkpoint analogy + a filter-by-filter walk of anonymous `GET /admin/**` → login redirect vs authenticated USER → 403.
4. **[medium] CSRF jargon undefined + attack not concretized.** Fix: one-line defs for synchronizer-token / BREACH / token-fixation, plus a 3-step cookie-auto-attach attack scenario contrasted with a bearer-token API being immune.

### spring-mvc-rest-apis (medium priority; 2 high-severity — 4/3/5)
1. **[high] Idempotency-Key and async thread-handoff untraced.** Fix: two identical POSTs with same key → 201-replay vs 409; a named-thread timeline of a `DeferredResult` from arrival → release → `setResult` → ASYNC dispatch (ties into the ThreadLocal-reads-wrong-thread gotcha).
2. **[high] ETag/conditional requests have no wire-level exchange.** Fix: round-1 `200 + ETag:"v3"`, round-2 `If-None-Match:"v3"` → 304; then `If-Match:"v3"` against server-at-"v5" → 412.
3. **[medium] Method-validation 500-vs-400 feels arbitrary.** Fix: 1-2 sentences explaining AOP method-interception path vs MVC binding path (and Spring 6.1 folding them together) before the table.
4. **[medium] Deep-offset pagination cost asserted, not shown.** Fix: `OFFSET 1,000,000 LIMIT 20` scans/discards ~1M rows vs keyset `WHERE id > :lastId` reading ~20.

### reactive-webflux (medium priority; 2 high-severity + a correctness error — 5/3/5)
1. **[high] MVC-vs-WebFlux threading claim has no capacity math.** Fix: 200 threads × 1MB stack × 100ms blocking → ~2000 req/s ceiling vs N=cores event-loop threads holding tens of thousands in-flight because threads park only on CPU work.
2. **[high] Backpressure / prefetch=256 mechanic untraced.** Fix: request 256 → after 192 (75%) consumed, operator requests 192 more, keeping the queue bounded; fast-producer/slow-consumer demand-as-counter.
3. **[medium/correctness] `zip` mislabeled as "latest".** Fix: reword to index-pairing (buffer faster sources until slowest emits Nth) and explicitly contrast `combineLatest`.
4. **[medium] flatMap unordered / flatMapSequential not demonstrated.** Fix: flatMap over [A(100ms),B(10ms)] → emits B,A; contrast concatMap (A,B) and flatMapSequential.

### bean-scopes-lifecycle (medium priority; 1 high-severity — 4/3/5)
1. **[high] Lifecycle callback order has no traced output** — the most-tested concept in the topic. Fix: a bean printing in each callback showing `constructor → setter → @PostConstruct → afterPropertiesSet → init-method → @PreDestroy → destroy → destroy-method` in order.
2. **[medium] BFPP/BPP/BDRPP introduced as signatures, no "why".** Fix: blueprint-vs-house analogies tied to concrete motivating scenarios.
3. **[medium] Scoped-proxy per-request resolution not shown.** Fix: request A vs B printing different identityHashCodes through the same injected field.
4. **[medium] Three-level cache is dense prose.** Fix: mermaid sequence or per-step map-contents table.

### exception-handling-validation (medium priority; 1 high-severity — 4/3/5)
1. **[high] Never shows the actual serialized error body** — the single most-probed artifact of the topic. Fix: sample invalid POST → exact `application/problem+json` (type/title/status/detail/instance + `errors[]`), contrasted with the plain Boot `/error` body.
2. **[medium] Spring 6.1 dual method-validation path not traced.** Fix: same `GET /products?page=0` with vs without class-level `@Validated` → the two different statuses/bodies (500 `ConstraintViolationException` vs 400 `HandlerMethodValidationException`).
3. **[medium] 6.1 explanation duplicated** across two sections with a confusing editor's-note. Fix: collapse to a one-line forward pointer.

### spring-data-jpa-persistence (medium priority; 1 high-severity — 4/3/5)
1. **[high] isNew/assigned-id extra-SELECT and `allocationSize=50` pooling in prose only.** Fix: SQL-log trace of `save()` on a UUID-keyed entity showing the wasted `SELECT…→ INSERT`; a concrete id-allocation trace (ids 1..50 in memory, next DB hit at the 51st insert).
2. **[medium] N+1 and pagination lack query-count arithmetic.** Fix: "100 orders → 101 queries; `@BatchSize(10)` → 11; JOIN FETCH → 1"; a page-size/row-count pair showing when COUNT is skipped.
3. **[medium] Dense Expert bullet-walls** — main clarity drag. Fix: split into one-fact-per-line, lead each mechanism with a plain-language "what/why".
4. **[medium] Missing DDD-aggregate + Hikari pool-sizing follow-ups.** Fix: add pool-sizing heuristic tied to the existing REQUIRES_NEW "2 connections per request" deadlock note.

### caching-abstraction (medium priority; 1 high-severity — 5/3/5)
1. **[high] Cache stampede explained abstractly.** Fix: 200ms query, key expires at T=0, 500 concurrent requests → without `sync`: 500 DB calls; with `sync=true`: 1 call, 499 block/reuse.
2. **[medium] SimpleKey collision bug in prose.** Fix: a key class with mismatched equals/hashCode showing `findRate("USD","EUR")` and `findRate("USD","GBP")` colliding → wrong cached value returned.
3. **[medium] No end-to-end miss-then-hit trace.** Fix: `findBook("978-1")` first call (miss → store) then second (hit → body skipped), tied to the numbered interceptor steps.

### microservices-spring-cloud-resilience (medium priority; 1 high-severity — 5/3/5)
1. **[high] Circuit-breaker state machine never driven by the config numbers.** Fix: with `minimumNumberOfCalls=5`, `failure-rate-threshold=50`, walk calls 1-4 (no eval) → call 5 at 60% trips OPEN → 10s `CallNotPermittedException` → HALF_OPEN 3 trials → CLOSED; show count- vs time-based denominator difference.
2. **[medium] Retry backoff sequence and token-bucket timeline abstract.** Fix: "max-attempts=3 → waits 200ms then 400ms with jitter"; rate-limiter cycle trace (`limit-for-period=100`, caller 101 waits or `RequestNotPermitted`).
3. **[medium] Saga has no traced failure/compensation.** Fix: reserveCredit ok → reserveInventory FAILS → releaseCredit + rejectOrder, with the pivot transaction marked.

## Refinement plan

Recommended order of attack, front-loading the highest-severity, highest-traffic subtopics and batching the cross-cutting passes.

**Phase 0 — fast factual fixes (do first, low effort, high credibility risk).** Correct the 3 outright errors regardless of the broader passes: `reactive-webflux` `zip` definition, `async-scheduling-events` fixedRate-overlap attribution, `fundamentals-autoconfiguration-starters` invented `spring.main.background-initialization` property.

**Phase 1 — high-severity worked-example pass (the core of this effort).** Tackle in this order (worst score / most high-severity issues first):
1. `messaging-event-driven-integration` (lowest score 4/2/5; 2 highs)
2. `spring-security-basics` (2 highs: JWT + bcrypt anatomy)
3. `spring-mvc-rest-apis` (2 highs: idempotency/async + ETags)
4. `reactive-webflux` (2 highs: threading math + backpressure; already touched in Phase 0)
5. `bean-scopes-lifecycle` (high: lifecycle order trace)
6. `exception-handling-validation` (high: serialized error body)
7. `spring-data-jpa-persistence` (high: isNew/allocationSize + query counts)
8. `caching-abstraction` (high: stampede trace)
9. `microservices-spring-cloud-resilience` (high: circuit-breaker trace)

**Phase 2 — remaining medium worked-examples + intuition/jargon lead-ins.** `actuator`, `async` (executor sizing), `fundamentals` (precedence trace + condition report), `transaction` (interleaved timelines), `configuration` (mental-model lead-ins + collection-replacement + precedence trace), `testing` (context-cache trace + break up bullet-walls). Fold in the Theme-2 intuition/jargon fixes here since they touch the same sections.

**Phase 3 — diagram pass (batch).** Add mermaid diagrams for the 11 flagged spatial/sequential concepts using the existing render pipeline (three-level cache, filter chains, saga, request lifecycle, OSIV/N+1, precedence tiers, Rabbit/Kafka routing, transaction proxy, slice boundaries). Cheap once batched; lifts the low-priority `ioc` and `core` files to 5s.

**Phase 4 — low-priority polish.** `aop-filters-interceptors`, `core-annotations-stereotypes`, `ioc-dependency-injection` — one traced example each + the diagrams from Phase 3; otherwise these are already at bar.

**Web-verification sweep (run alongside every phase).** **16 of 18 files are flagged `needs_web_verification`** — only `bean-scopes-lifecycle` and `core-annotations-stereotypes` are clean. Verify version-pinned claims as each file is edited: Kafka idempotence defaults / in-flight cap / RabbitMQ 3.8 quorum queues / Boot 3 ActiveMQ removal (`messaging`); Eureka timings + Resilience4j decorator order (`microservices`); Spring 6.1/6.2 method-validation behavior (`exception`, `spring-mvc`); `@ConditionalOnProperty` case-sensitivity + BackgroundPreinitializer (`fundamentals`); properties-vs-yaml within-location precedence (`configuration`); `proxyTargetClass` Boot default (`caching`); bcrypt/`@MockBean`-3.4/cache-size-32/Mockito-2.1.0 constants (`testing`); plus the version notes in `actuator`, `aop`, `ioc`, `reactive`, `spring-data-jpa`, `spring-security`, `transaction`.

_Data source: 18 of 18 per-subtopic audit JSON files read successfully; 0 missing or unreadable._
