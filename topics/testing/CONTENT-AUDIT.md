# testing — Content Audit

**Executive summary.** The `testing` domain is in strong health. Across all 16 subtopics the content is intuition-first and senior-grade: every file audited leads concepts with a plain-language "why does this exist" before formalism, argues trade-offs rather than listing them, and closes with an interviewer-style follow-ups section. Clarity is near-perfect (avg 4.94/5) and interview depth is high (avg 4.69/5). The domain's one consistent weakness is **worked examples** (avg 4.0/5): the writing is excellent at asserting quantitative claims but repeatedly stops short of plugging in numbers or showing the concrete artifact/code for the very hardest concept in each file. **No subtopic is high-priority overall**; priorities break down as **0 high / 9 medium / 7 low**. Note, however, that five medium files carry an internally *high-severity* issue (a genuinely missing section or an outright contradiction) — those should be treated as the real front of the queue. Six files are flagged `needs_web_verification=true` for tool-version claims. Headline takeaways: (1) quantify the numeric claims the files already make; (2) fix the cross-cutting test-double taxonomy / mock-vs-stub story; (3) make "contract testing" concrete wherever it is invoked; (4) show the code for the one step each process file skips (refactor, lifecycle trace, Pact DSL, parameterized tests).

## Scorecard

Sorted high-priority first, then lowest total (clarity+examples+depth) first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| test-automation-in-cicd-and-flaky-tests | 5 | 3 | 4 | medium | Clear, well-ordered CI/flakiness treatment; missing numeric flakiness-at-scale + shard-timing walkthroughs and a couple of under-explained terms. |
| test-doubles-and-mocking-taxonomy | 4 | 4 | 4 | medium | Clear taxonomy + state-vs-behavior; teaching risk is an unresolved contradiction between the classical mermaid model and the arrange-act-verify Mockito examples. |
| contract-testing | 5 | 4 | 4 | medium | Exceptionally clear on HTTP CDC; under-serves async/message contracts and lacks a concrete can-i-deploy/matrix version walkthrough. |
| junit5-lifecycle-assertions-extensions | 5 | 4 | 4 | medium | Polished JUnit 5 mechanics; missing the parameterized/dynamic/repeated test family and a concrete traced-output lifecycle example. |
| unit-testing-principles-and-practices | 5 | 4 | 4 | medium | Interview-grade principles; missing test-double taxonomy and side-by-side code for solitary/sociable/mockist. |
| code-coverage-and-mutation-testing | 5 | 4 | 5 | medium | Nails coverage-vs-effectiveness; two hardest quantitative concepts (MC/DC independence, mutation-score arithmetic) asserted not walked through. |
| end-to-end-and-ui-testing | 5 | 4 | 5 | medium | Senior-grade E2E/UI; near-total absence of numeric worked examples (flakiness compounding, shard math) where claims most need quantifying. |
| parameterized-and-data-driven-tests | 5 | 4 | 5 | medium | Excellent tour incl. PBT; missing worked examples for pairwise row construction and shrinking, plus one confusing oracle assertion. |
| testing-fundamentals-and-test-pyramid | 5 | 4 | 5 | medium | Excellent foundation; unexpanded acronyms, missing double taxonomy + coverage-quality gotcha, pyramid argued abstractly. |
| api-and-http-service-testing-with-mock-servers | 5 | 4 | 5 | low | Excellent, intuition-first; Pact and circuit-breaker (most-emphasized concepts) lack the code walkthroughs every other tool gets. |
| bdd-and-specification-by-example | 5 | 4 | 5 | low | Senior-grade BDD; minor example-derivation gaps (interest magic number, no filled-in example map). |
| integration-testing-strategies | 5 | 4 | 5 | low | Senior tour of integration discipline; contracts/test-data-builders explained in prose without a concrete artifact. |
| performance-testing | 5 | 4 | 5 | low | Exemplary; a few worked-example (Little's Law w/ think time, percentile) and visual (knee curve) gaps. |
| tdd-red-green-refactor | 5 | 4 | 5 | low | Excellent debate landscape; no worked example ever shows the Refactor phase in code — the step it calls most-skipped. |
| testcontainers-for-integration-testing | 5 | 4 | 5 | low | Interview-ready; suite-time math and data-isolation idiom asserted repeatedly but never shown. |
| mockito-and-stubbing-frameworks | 5 | 5 | 5 | low | Exceptionally strong; only a couple of version-attribution correctness nits need a verification pass. |

## Systemic issues

These themes recur across subtopics. They are the highest-leverage refinement targets because a single editorial pattern fixes many files at once.

### 1. Quantitative claims stated but never computed (most pervasive — ~9 subtopics)
The domain's signature weakness. Files repeatedly assert a number-driven insight and then leave the arithmetic implicit, which is exactly what the worked-example bar penalizes.
- **Flakiness compounds across a suite (p^N):** the single most-asked senior flakiness fact is asserted as a slogan in both `end-to-end-and-ui-testing` ("1% flaky is worse than useless") and `test-automation-in-cicd-and-flaky-tests` (both rate these *high severity*) but never shown as `0.99^200 ≈ 13%` / `0.999^10000 ≈ 0.45%`.
- **Shard balancing by timing vs count:** asserted without a skew example in `end-to-end-and-ui-testing` and `test-automation-in-cicd-and-flaky-tests`.
- **Little's Law with think time:** `performance-testing` gives the formula `VUs = arrival_rate × (latency + think_time)` but never plugs numbers.
- **Mutation-score / test-strength arithmetic and MC/DC independence pairs:** `code-coverage-and-mutation-testing` gives both only symbolically.
- **Pyramid proportions and suite runtimes:** `testing-fundamentals-and-test-pyramid` argues the shape abstractly with no counts/wall-clock.
- **Testcontainers suite-startup savings:** `testcontainers-for-integration-testing` asserts the singleton win repeatedly but never quantifies it (~80× reduction).
- **Pairwise collapse (27→9 rows):** `parameterized-and-data-driven-tests` never shows the constructed table.
- **can-i-deploy matrix resolution:** `contract-testing` describes it abstractly with no traced versions.
Example slugs: `end-to-end-and-ui-testing`, `test-automation-in-cicd-and-flaky-tests`, `performance-testing`, `code-coverage-and-mutation-testing`, `testing-fundamentals-and-test-pyramid`, `testcontainers-for-integration-testing`, `parameterized-and-data-driven-tests`, `contract-testing`.

### 2. Test-double taxonomy is inconsistent / incomplete across the domain (3 subtopics, one high-severity)
Meszaros's five-type taxonomy (dummy/stub/spy/mock/fake) and the mock-vs-stub distinction are handled unevenly:
- `unit-testing-principles-and-practices` uses the terms interchangeably and **never defines them** (*high severity*) — despite "what's the difference between a mock and a stub?" being a top interview probe the file's own advice hinges on.
- `testing-fundamentals-and-test-pyramid` says "test double (mock/stub)" repeatedly but never gives the taxonomy (*medium*), risking mock==stub conflation.
- `test-doubles-and-mocking-taxonomy` — the dedicated file — has an unresolved **contradiction** (*medium*): its mermaid teaches the classical "mocks set expectations up front" model while every Mockito example arranges-acts-then-`verify()`s. Also missing `ArgumentCaptor`.
Fix once with a canonical 5-row taxonomy block, then cross-link; and explicitly reconcile the classical vs Mockito framework-era distinction in the dedicated file.
Example slugs: `unit-testing-principles-and-practices`, `testing-fundamentals-and-test-pyramid`, `test-doubles-and-mocking-taxonomy`.

### 3. "Contract testing" is invoked as the answer but left abstract wherever it appears (4 subtopics)
Contract testing is repeatedly named as the scalable alternative to broad integration/E2E, yet the concrete artifact and async case are consistently missing:
- `contract-testing` itself omits **async/message contract testing** entirely (*high severity*) though the file claims to cover "HTTP or a message broker," and never shows the superset-match rule concretely.
- `api-and-http-service-testing-with-mock-servers` elevates Pact as the answer to stub drift but gives it only a diagram — no consumer-side DSL code or emitted pact JSON, unlike every other tool in the file.
- `integration-testing-strategies` describes the contract flow well but never shows an actual contract artifact.
- `end-to-end-and-ui-testing` never contrasts E2E with contract testing for the N-service matrix — the exact pyramid philosophy it preaches.
Example slugs: `contract-testing`, `api-and-http-service-testing-with-mock-servers`, `integration-testing-strategies`, `end-to-end-and-ui-testing`.

### 4. Parallel / concurrent test execution under-treated (4 subtopics)
Parallelism is mentioned in passing but never treated head-on, though "how do you run tests in parallel safely?" is a common senior probe and interacts with the isolation trade-offs these files do well elsewhere.
- `junit5-lifecycle-assertions-extensions`: no coverage of `@Execution(CONCURRENT)`/`@ResourceLock` and the PER_CLASS shared-field data race (*medium*).
- `parameterized-and-data-driven-tests`: parallel invocation thread-safety of shared `@FieldSource`/`@MethodSource` data omitted.
- `integration-testing-strategies`: shared-container-vs-container-per-worker parallel trade-off missing.
- `test-automation-in-cicd-and-flaky-tests`: `strategy=dynamic` thread count unexplained (*medium jargon*), and over-subscription-causes-flakiness link not made.
Example slugs: `junit5-lifecycle-assertions-extensions`, `parameterized-and-data-driven-tests`, `integration-testing-strategies`, `test-automation-in-cicd-and-flaky-tests`.

### 5. Tool-version / default-value claims need a verification pass (6 subtopics, all `needs_web_verification=true`)
Version-sensitive factual claims that interviewers and readers may cite verbatim:
- `mockito-and-stubbing-frameworks`: "dynamic proxies" mischaracterization of the ByteBuddy subclass mock-maker; `any(T.class)` null-semantics attributed to 5.x vs the TIP's correct "2+".
- `code-coverage-and-mutation-testing`: JaCoCo `@Generated` since-version, PIT `DEFAULTS`/`OLD_DEFAULTS` membership, `RETURN_VALS` deprecation.
- `end-to-end-and-ui-testing`: Selenium implicit-wait mixing behavior, Playwright actionability list, Chrome `--headless=new`.
- `parameterized-and-data-driven-tests`: `@FieldSource` 5.11, `EnumSource` from/to 5.12, jqwik default tries=1000, `allowZeroInvocations`.
- `performance-testing`: Gatling "Netty/Akka" (Akka dropped in 3.4+).
- `api-and-http-service-testing-with-mock-servers`: mockwebserver3 builder vs accessor API consistency.
Example slugs: `mockito-and-stubbing-frameworks`, `code-coverage-and-mutation-testing`, `end-to-end-and-ui-testing`, `parameterized-and-data-driven-tests`, `performance-testing`, `api-and-http-service-testing-with-mock-servers`.

### 6. Magic numbers / implicit derivations in existing examples (5 subtopics)
Even where an example exists, the numbers-in → numbers-out chain is sometimes left for the reader to reconstruct:
- `bdd-and-specification-by-example`: "1004.17" interest never derived.
- `test-doubles-and-mocking-taxonomy`: `isEqualTo(Money.of(90))` with no cart-total/discount shown.
- `testcontainers-for-integration-testing`: upsert asserts `qty == 8` (5+3) implicitly.
- `unit-testing-principles-and-practices`: BAD example's `int` arithmetic truncates `(1 - discountRate)` to 0 — an incidental type bug distracting from the lesson.
- `performance-testing`: how a percentile is actually computed from a sample is never shown.
Fix: add one inline comment/parenthetical per example making the arithmetic explicit.

### 7. The one process step each file skips is shown in prose, not code (3 subtopics)
- `tdd-red-green-refactor`: no worked example ever shows the **Refactor** phase in code — the step it calls most-skipped; also the characterization-test two-step loop isn't traced.
- `junit5-lifecycle-assertions-extensions`: lifecycle ordering shown as an abstract skeleton, never a real class + printed execution trace; and the whole parameterized/dynamic/repeated family is absent (*high severity*).
- `api-and-http-service-testing-with-mock-servers`: circuit-breaker mechanism is prose-only while retries got full stateful-stub code.

## High-priority subtopics

**No subtopic scored `refine_priority: high` overall.** However, five *medium*-priority subtopics each carry an internally **high-severity** issue — a genuinely missing section or an outright contradiction. These are the true front of the queue and are documented here in place of high-priority slugs.

### test-automation-in-cicd-and-flaky-tests (medium; lowest total score, 12)
1. **[high] Flakiness-at-scale never quantified** — `## The flaky test problem / ## Retries`. The compounding argument (`p^N` suite reliability) has no numbers. Fix: add `p=0.999, N=10000 → ~0.45% green` vs `N=200 → ~82%` to motivate quarantine and per-test flip-rate tracking.
2. **[medium] Retry discussion hides a real prod bug** — `## Retries`. Frames flakiness as always a test/env defect; omits that an intermittent failure can be a genuine production race that auto-retry then ships. Fix: add a callout to confirm nondeterminism lives in the test/env before retrying, tied to the Concurrency taxonomy row.
3. **[medium] Shard-timing skew not shown** — `## Test parallelization and sharding`. Add the 4-shard / one-5-min-test example (count-split → 5 min wall-clock vs timing-split → ~1.5 min).
4. **[medium] `strategy=dynamic` jargon** — config block sets `dynamic`/`concurrent` without explaining thread count; note over-subscription itself induces timing flakiness.
5. **[low] Mutant mental model** — one concrete sentence on what PIT mutates (`>` → `>=`, remove call) and mutation score = killed/total.

### contract-testing (medium; total 13)
1. **[high] Async/message contract testing absent** — whole file. Every example is request/response HTTP despite claiming broker coverage. Fix: add a `## Async / message contract testing` section (consumer asserts message shape; provider verification invokes the producing function against the pact, no HTTP replay) with a Pact message-pact snippet and the schema-registry overlap.
2. **[medium] can-i-deploy/matrix has no traced versions** — add a worked scenario (consumer `v-abc123`, provider verified `v-def456`/`v-ghi789`, prod runs `v-def456`) tracing the decision, plus a mini matrix table.
3. **[medium] Superset-match rule shown only in prose** — add a concrete pass (provider adds fields) vs fail (renames `total`→`amount`) example contrasted with strict schema equality.
4. **[medium] Pending/WIP pacts — the WHY is thin** — add the 2-3 sentence deadlock scenario (new consumer expectation reddening the provider's main build).
5. **[low] BDCT false-compatible gap + missing matrix diagram**.

### end-to-end-and-ui-testing (medium; total 14)
1. **[high] Flakiness compounding not quantified** — `## Why few E2E tests`. Add `0.99^200 ≈ 13% green` to turn the slogan into intuition.
2. **[medium] Sharding math abstract** — add the 120-test / 4-shard / straggler capacity walkthrough.
3. **[medium] E2E vs contract testing never contrasted** — add the N-microservices follow-up: contract tests cover the integration matrix cheaply, E2E guards a few real journeys.
4. **[low] No mobile/native UI (Appium)** — add one row/sentence.
5. **[low] Version-sensitive claims** (Selenium wait-mixing, Playwright actionability, Chrome headless flag) — verify.

### junit5-lifecycle-assertions-extensions (medium; total 13)
1. **[high] Parameterized/dynamic/repeated test family missing** — `junit-jupiter-params` is in the architecture table but no section teaches `@ParameterizedTest`/`@CsvSource`/`@MethodSource`, `@RepeatedTest`, `@TestFactory`. Add a section with a worked `@CsvSource` example and when-to-use-which, tied back to JUnit 4's `@RunWith(Parameterized.class)`. (Note overlap with the dedicated `parameterized-and-data-driven-tests` file — cross-link rather than duplicate.)
2. **[medium] No concrete lifecycle trace** — replace/augment the abstract ordering skeleton with a real class (top-level + `@Nested` + one extension) and its printed 1..N execution log.
3. **[medium] Parallel execution absent** — add `@Execution(CONCURRENT)`, opt-in default, PER_CLASS shared-field race, `@ResourceLock`/`@Isolated` mitigation.
4. **[low] `@Timeout` vs `assertTimeout*`** — one contrasting line (declarative/class-level/threadMode vs imperative/per-block).
5. **[low] `ParameterResolver` has no code** — add a ~6-line `supportsParameter`/`resolveParameter` template.

### unit-testing-principles-and-practices (medium; total 13)
1. **[high] Test-double taxonomy missing** — file uses mock/stub/fake/spy interchangeably but never defines Meszaros's five types. Add a `## Test Doubles` section contrasting a stub (`when().thenReturn`) with a mock (`verify()`) and a fake (in-memory repo), tying to "verify state vs interactions."
2. **[high] Solitary vs sociable / classical vs mockist taught with no code** — add a side-by-side: the same `OrderService` test written mockist/solitary vs classical/sociable, and reason about why the mockist version breaks on a harmless refactor.
3. **[medium] No coverage/mutation-testing angle** — add the "coverage is a floor, assertion-free tests still cover; PIT measures effectiveness" note plus the "is 100% coverage a good goal?" follow-up.
4. **[low] Missing intuition hook before the solitary/sociable table.**
5. **[low] BAD example `int` truncation bug** — make types coherent so the lesson is "test re-derives the formula," not an incidental type bug.

## Refinement plan

Recommended order of attack (highest leverage first):

**Wave 1 — fix the five high-severity gaps (structural, one file each).** These are missing sections or a contradiction that a candidate would actually stumble on:
1. `contract-testing` — add async/message contract section (+ can-i-deploy worked example).
2. `junit5-lifecycle-assertions-extensions` — add the parameterized/dynamic/repeated family + concrete lifecycle trace.
3. `unit-testing-principles-and-practices` — add test-double taxonomy + solitary-vs-sociable side-by-side code.
4. `test-doubles-and-mocking-taxonomy` — reconcile the mermaid-vs-Mockito contradiction; add `ArgumentCaptor`.
5. `test-automation-in-cicd-and-flaky-tests` — add the flakiness-at-scale calculation.

**Wave 2 — the domain-wide "quantify it" editorial pass (Systemic issue #1).** Sweep in one sitting, adding a single numeric walkthrough per claim: `end-to-end-and-ui-testing` (0.99^N, shard math), `performance-testing` (Little's Law with think time, percentile derivation, knee-curve diagram), `code-coverage-and-mutation-testing` (MC/DC truth table, mutation-score tally), `testing-fundamentals-and-test-pyramid` (pyramid counts/runtimes), `testcontainers-for-integration-testing` (suite-startup math + data-isolation snippet), `parameterized-and-data-driven-tests` (pairwise table, shrink trace).

**Wave 3 — consistency + polish.** Test-double taxonomy cross-linking across `unit-testing` / `testing-fundamentals` / `test-doubles`; the "magic number" inline-comment pass (Systemic #6); the parallelism additions (Systemic #4); the process-step-in-code additions (`tdd-red-green-refactor` refactor phase, `api-...-mock-servers` Pact DSL + circuit-breaker code).

**Wave 4 — web-verification pass (do last, batched).** Six files have `needs_web_verification=true` — verify all tool-version/default claims against official docs in one session:
- `api-and-http-service-testing-with-mock-servers` (mockwebserver3 API surface)
- `code-coverage-and-mutation-testing` (JaCoCo `@Generated` version, PIT mutator groups, `RETURN_VALS`)
- `end-to-end-and-ui-testing` (Selenium wait behavior, Playwright actionability, Chrome headless flag)
- `mockito-and-stubbing-frameworks` (mock-maker mechanism wording, `any()` null-semantics version)
- `parameterized-and-data-driven-tests` (`@FieldSource` 5.11, `EnumSource` 5.12, jqwik defaults)
- `performance-testing` (Gatling Netty/Akka)

The remaining 10 files have `needs_web_verification=false` and need no external checks.

*Coverage note: all 16 requested audit files were read successfully; 0 files were missing or unreadable.*
