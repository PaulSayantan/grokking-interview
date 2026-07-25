# spring-core — Content Audit

**Executive summary.** The spring-core domain is in strong shape: across all 19 subtopics, interview *depth* is uniformly excellent (depth = 5/5 for every file — internals, gotchas, and dedicated "common follow-ups" layers that mirror real senior/staff probing), and *clarity* is high (avg ≈ 4.16/5). The domain's one systemic weakness is **worked examples** (avg ≈ 3.42/5): the hardest mechanics are repeatedly taught in dense, abstract prose without a single concrete numbers-in/numbers-out trace. No subtopic is rated **high** refine-priority (0), but **12 are medium** and **7 are low** — and, importantly, 11 of the medium/low files contain at least one *high-severity issue* (almost always a missing worked example for the topic's flagship concept). Headline takeaways: (1) the same missing trace — the three-level singleton cache breaking a circular dependency — is flagged in **six** separate files, making it the single highest-leverage fix in the domain; (2) content is written expert-first and under-delivers on the repo's #1 priority (intuition-before-formalism) in ~11 files; (3) the repo has standardized on mermaid diagrams but ~13 files still describe inherently spatial/sequential flows in prose only; and (4) **16 of 19 files carry version-pinned factual claims flagged for web verification** before any content is finalized.

## Scorecard

Sorted high-priority first (none), then lowest total (clarity + examples + depth) first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| spring-aop-and-proxies | 4 | 3 | 5 | medium | Senior depth, but advice-ordering and pointcut syntax taught only in prose — memorize, don't understand. |
| spring-data-persistence | 4 | 3 | 5 | medium | Staff-level gotchas, but count-query optimization and optimistic-lock race need numeric traces. |
| async-scheduling-caching | 4 | 3 | 5 | medium | Deep cheatsheet; caching has no hit/miss trace and distributed-scheduling gotcha is missing. |
| bean-lifecycle-callbacks | 4 | 3 | 5 | medium | Correct and deep, but three-level cache and SmartLifecycle phases lack a step-by-step trace. |
| bean-scopes | 4 | 3 | 5 | medium | Gotcha-rich, but the scoped-proxy "aha" and the cycle mechanics are never traced. |
| dependency-injection-types | 4 | 3 | 5 | medium | Accurate and deep; resolution algorithm and three-level cache are prose-only. |
| ioc-container-applicationcontext-vs-beanfactory | 4 | 3 | 5 | medium | Deep internals, but the most-probed A↔B trace is abstract; "why three levels?" unanswered. |
| spring-mvc-request-lifecycle | 4 | 3 | 5 | medium | Reference-manual feel; never traces one concrete request end-to-end; a PathPattern version claim is wrong. |
| transaction-management-events | 5 | 3 | 5 | medium | Excellent, but isolation anomalies / pool deadlock / rollback-distance need concrete traces. |
| actuator-observability | 4 | 4 | 5 | medium | Genuinely senior; percentile-vs-histogram and tag-cardinality claims need numeric walkthroughs. |
| testing-spring-applications | 4 | 4 | 5 | medium | Strong, but one listener-ordering paragraph is garbled; context-cache cost lacks numbers. |
| advanced-bean-wiring | 4 | 4 | 5 | medium | Interview-ready, but "third-level cache" jargon undefined and post-processor ordering un-traced. |
| configuration-profiles-properties | 4 | 3 | 5 | low | Strong and precise, but precedence conflicts and the two-pass ${}/#{} model aren't traced. |
| spring-vs-spring-boot | 5 | 3 | 5 | low | Outstanding; property precedence and auto-config firing described but never traced with values. |
| autowired-qualifier-autowiring-resolution | 4 | 4 | 5 | low | Senior-grade; missing a traced 5-step resolution example and a thin intuition on-ramp. |
| spel-and-value | 4 | 4 | 5 | low | Deeply gotcha-aware; missing a "why SpEL exists" hook and a few untraced power examples. |
| web-exception-handling | 4 | 4 | 5 | low | Source-accurate; needs a pipeline diagram and one end-to-end resolver-ordering trace. |
| bean-definition-stereotype-annotations | 4 | 4 | 5 | low | Senior reference; leans on undefined AOP/BPP jargon and lacks a lifecycle visual. |
| circular-dependencies | 5 | 4 | 5 | low | Excellent, intuition-first; only a diagram and one mixed-cycle trace missing. |

## Systemic issues

These themes recur across subtopics. They are ordered by leverage (how many files a single well-designed fix pattern would improve).

### 1. Missing concrete "numbers-in / numbers-out" worked examples for the flagship concept (≈16 files — the dominant theme)
Nearly every file states the hardest rule abstractly and never traces it. This is the root cause of the low examples average and of almost all the high-severity issues. Sub-clusters:
- **The three-level singleton cache breaking a circular dependency is un-traced in SIX files** — `advanced-bean-wiring`, `bean-lifecycle-callbacks`, `bean-scopes`, `dependency-injection-types`, `ioc-container-applicationcontext-vs-beanfactory`, and (partially) `circular-dependencies`. One canonical, reusable A↔B setter-cycle trace (showing what each of `singletonObjects` / `earlySingletonObjects` / `singletonFactories` holds at each step, and where the constructor cycle "has nothing to expose") should be authored once and referenced. **Highest-leverage fix in the domain.**
- **Autowiring/resolution algorithm traced nowhere** — the 5-/8-step resolution order is an abstract numbered list in `autowired-qualifier-autowiring-resolution`, `dependency-injection-types`, and `ioc-container...`; none shows a concrete ambiguous-candidate scenario resolving step-by-step to a winner (or to `NoUniqueBeanDefinitionException`).
- **Property/precedence resolution traced nowhere** — `configuration-profiles-properties` and `spring-vs-spring-boot` both list precedence order but never resolve a concrete collision (`--server.port` vs env var vs yaml) to a final value.
- **Other flagship traces missing:** cache hit/miss + SimpleKey (`async-scheduling-caching`), scoped-proxy per-request resolution (`bean-scopes`), advice-execution ordering + pointcut token decomposition (`spring-aop-and-proxies`), Page count-query optimization + optimistic-lock two-transaction race (`spring-data-persistence`), one concrete `doDispatch` request (`spring-mvc-request-lifecycle`), isolation-anomaly interleavings + connection-pool deadlock (`transaction-management-events`), percentile-vs-histogram + tag-cardinality math (`actuator-observability`), context-cache cost multiplication (`testing-spring-applications`).

### 2. Leads with formalism instead of intuition — the repo's #1 priority (≈11 files)
Files open with definitions/internals before a plain-language "why does this exist / what pain does it remove" hook: `actuator-observability`, `advanced-bean-wiring`, `async-scheduling-caching`, `autowired-qualifier...`, `bean-lifecycle-callbacks`, `configuration-profiles-properties` (x2), `dependency-injection-types`, `ioc-container...`, `spel-and-value`, `spring-mvc-request-lifecycle`, and the auto-config internals of `spring-vs-spring-boot`. (Counter-examples that already do this well and set the bar: `circular-dependencies`, `transaction-management-events`, `bean-scopes`, top of `spring-vs-spring-boot`.) Fix pattern: prepend one analogy + one pain sentence to each cold opener.

### 3. Missing diagrams for inherently spatial/sequential flows (≈13 files)
The repo has standardized on mermaid (per project memory), yet these control-flow / structural ideas are prose-only: Observation lifecycle (`actuator`), container-refresh & post-processor timeline (`advanced-bean-wiring`, `bean-definition...`, `ioc-container...`), proxy vs self-invocation (`async-scheduling-caching`, `spring-aop-and-proxies`), three-level-cache lookup path (`circular-dependencies`), two-pass ${}/#{} pipeline (`configuration-profiles-properties`), interceptor callback order (`spring-mvc-request-lifecycle`), Boot-on-Spring layer stack (`spring-vs-spring-boot`), context hierarchy & listener timeline (`testing-spring-applications`), physical-vs-logical tx & thread-binding (`transaction-management-events`), exception-resolution pipeline (`web-exception-handling`).

### 4. Version-pinned factual claims needing web verification (16 of 19 files)
`needs_web_verification=true` for all files **except** `autowired-qualifier...`, `bean-lifecycle-callbacks`, and `ioc-container...`. Recurring risky claims: exact Spring version thresholds (ObjectProvider "since 4.3", `@Conditional` "since 4.0", `proxyBeanMethods` "5.2", 6.2 locking rework / `spring.locking.strict`), Boot default-behavior versions (bean-override off in 2.1, circular refs off in 2.6, `@MockBean` deprecated in 3.4), and specific defaults/numbers (tracing sampling 0.1, SpEL `maxOperations` value, actuator default exposure). **One factual error already found:** `spring-mvc-request-lifecycle` states PathPattern *replaced* AntPathMatcher as the MVC default in 5.3 — it was opt-in in MVC 5.3 and became the MVC default in 6.0 (default in WebFlux since 5.0).

### 5. Undefined jargon assumed known (3 files) and missing interview gotchas (≈12 files)
- **Jargon:** "third-level cache" used before defining it (`advanced-bean-wiring`); "AOP proxy / bean post-processor / advisor / pointcut" assumed known (`bean-definition-stereotype-annotations`); "DAO" never expanded (`spring-data-persistence`).
- **Missing high-value follow-ups** an interviewer reliably asks: distributed/clustered `@Scheduled` double-firing (`async-scheduling-caching`), engine-specific isolation reality vs the ANSI floor (`transaction-management-events`), `@MockBean` deprecation signal (`testing-spring-applications`), `ConstraintViolationException` 500-instead-of-400 fix (`web-exception-handling`), plus smaller ones in `bean-scopes`, `bean-definition...`, `bean-lifecycle-callbacks`, `circular-dependencies`, `configuration-profiles...`, `dependency-injection-types`, `spel-and-value`, `spring-vs-spring-boot`.

## High-priority subtopics

No subtopic is rated `refine_priority: high`. The list below is therefore the **effective top of the queue**: the medium/low files that each carry at least one **high-severity** issue (almost always a missing worked example for the topic's flagship concept). These are the concrete first targets.

### spring-aop-and-proxies (medium) — 2 high-severity issues
1. **[high] Advice execution order is prose-only** (`## Advice types`, ~line 118). The most-asked, most-confused AOP topic. **Fix:** one method advised by all five advice types, with the exact ordered console output for both the returning and throwing paths.
2. **[high] `execution(...)` pointcut never decomposed** (used ~8×, never explained). **Fix:** token-by-token breakdown of `execution(* com.example.service.*.*(..))` (return type / declaring type / method / arg pattern) plus 2–3 contrasting patterns.
3. **[medium] Interceptor `proceed()` chain abstract.** **Fix:** ASCII/mermaid "onion" of two advisors around a target (tx + custom `@Around`) showing nesting and unwind order.
4. **[medium] Verify** Spring 5.2.7 deterministic ordering wording and Boot's `proxyTargetClass=true` default.

### spring-data-persistence (medium) — 2 high-severity issues
1. **[high] `Page<T>` count-query optimization un-traced** (`## Pageable and Sort`). **Fix:** numeric trace — 45 rows, `PageRequest.of(2,20)` → 5 elements → total inferred as 40+5=45, no COUNT; contrast `PageRequest.of(0,20)` → 20 elements → COUNT(*) fires.
2. **[high] Optimistic locking has no two-transaction trace** (`## Optimistic and Pessimistic Locking`). **Fix:** Tx A and B both read id=7 v=3; A's UPDATE ... `WHERE id=7 AND version=3` affects 1 row (wins), B's affects 0 rows → `OptimisticLockException`. Show SQL + row counts.
3. **[medium]** N+1 fix not quantified; `save()` merge-vs-persist extra SELECT un-traced; "DAO" jargon; intro topic list omits locking/tx sections.

### async-scheduling-caching (medium)
1. **[high] Caching taught with zero traces** (`## Enabling Caching`). **Fix:** `findBook("111")` miss → body runs → cache holds `{"111"→Book}`; second call hit → body skipped; then a 2-arg method to show `SimpleKey(a,b)` vs single-arg key.
2. **[medium] Missing distributed-scheduling gotcha:** `@Scheduled` fires on every instance in a scaled deployment; mitigations (ShedLock, clustered Quartz, external scheduler).
3. **[medium]** corePool→queue→maxPool ordering needs the "restaurant" intuition; cron AND-vs-OR contrast with Unix; self-invocation diagram.

### bean-lifecycle-callbacks (medium)
1. **[high] Three-level cache / early-proxy promotion is prose-only.** **Fix:** the canonical numbered A↔B trace showing each cache map's contents per step (shared with theme #1).
2. **[medium]** SmartLifecycle phase ordering (start order vs reversed stop order) needs a concrete phase list; intro needs an onboarding analogy.
3. **[low]** Add the Spring 6 "`@PostConstruct` silently no-ops if `jakarta.annotation-api` absent" gotcha; show a BPP that returns a wrapper/proxy.

### bean-scopes (medium)
1. **[high] Scoped-proxy per-request resolution never traced** — the topic's core "aha." **Fix:** two sequential HTTP requests hitting a singleton controller holding a `@SessionScope` cart proxy, showing which target identity is returned each time and where create/cache happens.
2. **[medium]** Singleton three-level-cache cycle un-traced; web-scopes section leads with a table before any motivating scenario.
3. **[low]** Add prototype GC-eligibility framing; state that web scopes DO fire destruction callbacks (unlike prototypes).

### dependency-injection-types (medium)
1. **[high] 8-step resolution algorithm is an abstract list** (`## How the Container Resolves an Injection Point`). **Fix:** three `PaymentGateway` beans (stripe `@Primary`, paypal `@Qualifier`, adyen `@Priority(1)`); trace two injection points to a winner plus one `NoUniqueBeanDefinitionException`.
2. **[medium]** Three-level-cache cycle prose-only; IoC intro leads with formal definitions (needs analogy); greedy-constructor matching needs a concrete example.

### ioc-container-applicationcontext-vs-beanfactory (medium)
1. **[high] The most-probed A→B→A setter-inject trace is abstract.** **Fix:** the canonical trace (theme #1) showing which map holds what at the moment the cycle breaks.
2. **[medium] "Why THREE levels, not two?" never answered.** **Fix:** level-2 caches the level-3 factory's output so every collaborator gets the identical early reference/proxy.
3. **[medium/low]** Autowiring ambiguity has no code + traced failure; `&`-prefix FactoryBean gotcha needs a concrete class; refresh() 12-phase list would benefit from a diagram.

### spring-mvc-request-lifecycle (medium)
1. **[high] Never traces one concrete request** despite calling `doDispatch` "the single most-asked diagram." **Fix:** trace `GET /api/users/42` (Accept: json) through mapping → adapter → preHandle → `@PathVariable id=42L` → converter selection → JSON bytes → postHandle(mav=null) → afterCompletion, naming the class at each step.
2. **[medium — correctness] PathPattern version claim is wrong** (see systemic theme #4). Rephrase: WebFlux default since 5.0, MVC opt-in in 5.3, MVC default in 6.0.
3. **[medium/low]** Front-controller needs a plain-language motivation; async section needs a when/why decision guide; exception-resolver precedence needs a traced example.

### transaction-management-events (medium)
1. **[high] Isolation anomalies purely abstract** (`## Isolation Levels`). **Fix:** two-transaction interleaved timelines for dirty / non-repeatable / phantom reads, then the same interleaving at REPEATABLE_READ vs SERIALIZABLE.
2. **[medium]** Connection-pool deadlock needs numbers (pool=10, 10 threads each in outer REQUIRED calling REQUIRES_NEW → deadlock; pool 11+ breaks it); rollback-rule inheritance distance needs a concrete hierarchy + hop counts.
3. **[medium]** Add "ANSI is a floor" gotcha (InnoDB gap locks, PostgreSQL SSI) — flag for web verification.

### actuator-observability (medium)
1. **[high] Percentile-vs-histogram aggregation argued in prose** (`## Micrometer ...`). **Fix:** host A p99=50ms, host B p99=500ms; show averaging (275ms) is meaningless, then merge bucket counts and recompute a correct fleet-wide p99.
2. **[medium]** Tag-cardinality "catastrophe" needs the explicit multiplication (5M users × 3 status × 4 methods = 60M series); metrics-recording example never shows the `/actuator/metrics` output or Prometheus scrape.
3. **[medium/low]** Opening front-loads formalism (needs the "dashboard/OBD-II port" analogy first); sampling propagation and Observation lifecycle would benefit from a trace and a diagram.

### testing-spring-applications (medium)
1. **[high — clarity] One listener-ordering paragraph is garbled/self-contradicting** ("only because … except …"). **Fix:** rewrite as two clean cause→effect sentences (DI order 5 before Transactional 9 before Sql 10; tx already active when `@Sql` fires, so INFERRED joins it and seeded data rolls back).
2. **[medium]** Context-caching cost never quantified. **Fix:** 50 classes / 1 config = 1 build + 49 cache hits (~2s); 10 distinct cache keys → 11 contexts → ~22s (11× blowup).
3. **[low]** Note `@MockBean`/`@SpyBean` deprecated in Boot 3.4; add `@ContextHierarchy` + listener-timeline diagrams.

### advanced-bean-wiring (medium)
1. **[medium — but load-bearing] "Third-level cache" jargon used, never defined.** **Fix:** 2–3 sentences on partially-constructed early references + name the three caches, so setter-vs-constructor-cycle behavior is understood, not memorized.
2. **[medium]** Post-processor ordering (BDRPP→BFPP→BPP, PriorityOrdered→Ordered, re-scan) needs a worked trace; FactoryBean section needs an up-front motivating problem; ObjectProvider candidate matrix needs a concrete `@Primary/@Priority/@Order` example.
3. **[low]** Add a container-refresh timeline diagram; web-verify FactoryBean product lifecycle callbacks and the version-introduced dates.

## Refinement plan

Recommended order of attack (front-load the highest-leverage, cross-cutting work; do factual verification before wording is locked):

1. **Author the canonical three-level-cache circular-dependency trace once, then reference it from all six files** (`circular-dependencies` as the home, cross-linked from `bean-lifecycle-callbacks`, `bean-scopes`, `dependency-injection-types`, `ioc-container...`, `advanced-bean-wiring`). This single artifact clears the most high-severity issues in the domain. Pair it with the "why three levels, not two?" paragraph (`ioc-container...`).
2. **Knock out the remaining high-severity worked examples**, one per file, in this order (most interview-critical first): `spring-aop-and-proxies` (advice order + pointcut decomposition), `spring-data-persistence` (count-query + optimistic lock), `transaction-management-events` (isolation anomalies), `spring-mvc-request-lifecycle` (one concrete request), `dependency-injection-types` / `autowired-qualifier...` (resolution trace), `async-scheduling-caching` (cache hit/miss), `bean-scopes` (scoped-proxy trace), `actuator-observability` (percentile math). Fix the garbled `testing-spring-applications` listener paragraph in the same pass (it's a correctness/clarity defect, not just an example gap).
3. **Batch the intuition-first openers** (theme #2, ~11 files) — a fast, uniform pass prepending one analogy + one pain sentence to each cold opener. Highest priority: `dependency-injection-types`, `ioc-container...`, `spring-mvc-request-lifecycle`, `actuator-observability`.
4. **Batch the mermaid diagrams** (theme #3, ~13 files) against the existing repo mermaid pipeline; several diagrams (three-level cache, proxy/self-invocation, container-refresh timeline) are reusable across files.
5. **Add the missing interview gotchas** (theme #5): distributed `@Scheduled`, engine-specific isolation, `@MockBean` deprecation, `ConstraintViolationException` handler, plus the smaller ones.

### Web verification required before finalizing (needs_web_verification = true — 16 of 19 files)
`actuator-observability`, `advanced-bean-wiring`, `async-scheduling-caching`, `bean-definition-stereotype-annotations`, `bean-scopes`, `circular-dependencies`, `configuration-profiles-properties`, `dependency-injection-types`, `spel-and-value`, `spring-aop-and-proxies`, `spring-data-persistence`, `spring-mvc-request-lifecycle`, `spring-vs-spring-boot`, `testing-spring-applications`, `transaction-management-events`, `web-exception-handling`.

**Do NOT need web verification** (3): `autowired-qualifier-autowiring-resolution`, `bean-lifecycle-callbacks`, `ioc-container-applicationcontext-vs-beanfactory`.

**Known factual error to fix now:** `spring-mvc-request-lifecycle` — PathPattern was opt-in for MVC in 5.3 and became the MVC default in 6.0 (WebFlux default since 5.0); the file's "replaced … as the default … via PathPatternParser … 5.3+" wording is wrong. Priority version facts to confirm elsewhere: Spring 6.2 locking rework + `spring.locking.strict` (6.2.6), Boot 2.6 circular-ref default and 2.1 bean-override default, `@MockBean` deprecation (Boot 3.4), SpEL `maxOperations` default, actuator default exposure/sampling, and the various "since X.Y" version tags.

_Files audited: 19 of 19 (0 missing/unreadable)._
