export const meta = {
  name: 'testing-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 16 Software Testing topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/testing`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Software Testing" for BACKEND + SENIOR developer interviews. Teach the testing
PRINCIPLES and practices language-agnostically, but USE the JVM ecosystem (JUnit 5, Mockito,
Testcontainers, AssertJ, WireMock, Pact, JMeter/Gatling/k6) for concrete examples — consistent
with this library's Java-heavy stack (java-jvm, spring-boot/spring-core domains exist). Where a
concept is universal (test pyramid, TDD, test doubles taxonomy, coverage), state it framework-
neutrally first, THEN show the idiomatic Java/JUnit example.

BOUNDARY vs already-authored domains (cross-reference, don't duplicate):
- spring-boot/testing-spring-boot-applications and spring-core/testing-spring-applications cover
  SPRING-specific test slices (@WebMvcTest, @DataJpaTest, @SpringBootTest, MockMvc). THIS domain
  owns the general testing discipline; mention the Spring slices only as a pointer.
- rest-api-design and system-design are separate; keep API/system testing here at the
  test-technique level (mock servers, contract tests), not API-design or capacity-planning.
- performance-testing here = the testing DISCIPLINE (load/stress/soak/spike, open vs closed
  workload models, coordinated omission, percentiles); capacity modeling stays in system-design.

Ground claims in authoritative sources: JUnit 5 User Guide, Mockito docs, Testcontainers docs,
Martin Fowler (test pyramid, test doubles, "Mocks Aren't Stubs", contract testing/CDC), Kent Beck
(TDD), the Pact/Spring Cloud Contract docs, k6/Gatling/JMeter docs, PIT (mutation testing). Verify
version-specific behavior (JUnit 5 Jupiter API, Mockito strictness) via web research.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - Interview-grade answers, LAYERED: beginner definition + why it matters -> intermediate
     trade-offs/comparisons -> advanced internals/gotchas the interviewer probes.
   - Concrete examples: short JUnit 5 / Mockito / Testcontainers snippets in \`\`\`java blocks,
     comparison tables, and a "good test vs bad test" contrast where useful.
   - If a diagram helps (test pyramid, red-green-refactor cycle, CI test stages, CDC handshake),
     use a \`\`\`mermaid fenced block (flowchart/sequenceDiagram/stateDiagram-v2). NO ASCII-art.
   - End with a "## Common follow-up questions" section and a "## References" section.
   - Factual accuracy is critical.

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: testing
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001     # globally unique within the file, zero-padded 3-digit seq
         difficulty: beginner      # one of: beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                 # 0-BASED index of the correct option
         explanation: |
           <why the correct answer is right; teach the concept>
         ref: "concepts.md#<anchor>"   # deep-link to a concepts.md H2 (GitHub slug rules)

   RULES:
   - Produce 40-60 questions (minimum 40). Cover EVERY subtopic with several questions each.
   - 3-5 options per question, EXACTLY ONE correct. 'answer' is 0-based.
   - VARY the correct option's position across the file (do not cluster on one index).
   - Mixed difficulty (mostly beginner/intermediate with some advanced; Pass 1 — don't over-index on expert).
   - INCLUDE scenario-style questions ("given this test/mock setup, what's wrong / what's true?",
     "which test double fits here?", "which fixes this flaky test?"). Distractors plausible but
     wrong for a real reason.
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness.
Return a one-line summary: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'testing-fundamentals-and-test-pyramid', name: 'Testing Fundamentals & the Test Pyramid', hints: "why we test; the test pyramid (unit/integration/e2e proportions) vs testing trophy vs ice-cream-cone anti-pattern; test levels & types (functional/non-functional, black vs white vs gray box); verification vs validation; test scope/isolation; fast-feedback principle; what makes a good test (FIRST: fast/isolated/repeatable/self-validating/timely); regression testing; smoke vs sanity; shift-left testing; cost of a bug over time." },
  { slug: 'test-doubles-and-mocking-taxonomy', name: 'Test Doubles & the Mocking Taxonomy', hints: "Meszaros/Fowler taxonomy — dummy, stub, spy, mock, fake — precise differences (state vs behavior verification); 'Mocks Aren't Stubs'; when to use each; classical/Detroit vs mockist/London TDD schools; over-mocking anti-pattern & mocking types you don't own; fakes (in-memory DB/repository); test-induced design damage; interaction vs state testing; seams & dependency injection for testability." },
  { slug: 'unit-testing-principles-and-practices', name: 'Unit Testing Principles & Practices', hints: "what a unit is (solitary vs sociable); AAA (Arrange-Act-Assert) / Given-When-Then; one-assert-per-test debate; test naming conventions; FIRST properties; deterministic tests (no time/random/IO dependence); testing edge cases & boundaries; test readability & DAMP-vs-DRY in tests; test fixtures & setup/teardown; testing exceptions; avoiding logic in tests; the four-phase test." },
  { slug: 'junit5-lifecycle-assertions-extensions', name: 'JUnit 5: Lifecycle, Assertions & Extensions', hints: "JUnit 5 architecture (Platform/Jupiter/Vintage); lifecycle annotations (@BeforeEach/@AfterEach/@BeforeAll/@AfterAll, per-method vs per-class instance lifecycle); @Test/@DisplayName/@Nested/@Tag; assertions (assertEquals/assertThrows/assertAll/assertTimeout) & AssertJ fluent assertions; assumptions; @Disabled; conditional execution; the Extension model (replaces @RunWith/@Rule) — BeforeEachCallback/ParameterResolver/TestInstancePostProcessor; extension registration (@ExtendWith, @RegisterExtension); migration from JUnit 4." },
  { slug: 'parameterized-and-data-driven-tests', name: 'Parameterized, Dynamic & Property-Based Tests', hints: "@ParameterizedTest with @ValueSource/@CsvSource/@MethodSource/@EnumSource/@ArgumentsSource; argument converters/aggregators; @DynamicTest & TestFactory (runtime-generated tests); data-driven testing patterns; property-based testing (jqwik/QuickCheck model — generators, shrinking, invariants over examples); when property-based beats example-based; combinatorial/pairwise testing; table-driven tests." },
  { slug: 'mockito-and-stubbing-frameworks', name: 'Mockito & Stubbing Frameworks', hints: "mock/spy creation (@Mock/@Spy/@InjectMocks, MockitoExtension); stubbing (when/thenReturn/thenThrow/thenAnswer); argument matchers (any/eq/argThat) & the can't-mix-raw-and-matcher rule; verify (times/never/atLeast/inOrder); ArgumentCaptor; strictness (STRICT_STUBS, UnnecessaryStubbingException); spy partial mocking & doReturn-vs-when-on-spy gotcha; mocking statics/finals/constructors (mockito-inline); BDDMockito given/willReturn; what NOT to mock (value objects, types you don't own)." },
  { slug: 'tdd-red-green-refactor', name: 'Test-Driven Development (Red-Green-Refactor)', hints: "the red-green-refactor cycle; test-first vs test-after; TDD benefits (design pressure, regression safety, documentation) & limits; baby steps & triangulation; fake-it-till-you-make-it; TDD and emergent design; the three rules of TDD (Uncle Bob); classicist vs mockist TDD; TDD on legacy code (characterization tests); TDD myths & when it's less useful; test-induced design damage debate (DHH/Fowler/Beck); double-loop TDD with acceptance tests." },
  { slug: 'bdd-and-specification-by-example', name: 'BDD & Specification by Example', hints: "BDD as TDD evolution; ubiquitous language & living documentation; Given-When-Then/Gherkin; feature files & step definitions (Cucumber); specification by example / example mapping; three amigos; executable specifications; BDD vs TDD vs ATDD; outside-in development; when BDD helps vs adds overhead; scenario outline/data tables; the automation-vs-collaboration value of BDD (collaboration is the point)." },
  { slug: 'integration-testing-strategies', name: 'Integration Testing Strategies', hints: "what integration testing covers (component boundaries, DB, external services); big-bang vs incremental (top-down/bottom-up/sandwich); test slices vs full-context; in-memory vs real dependencies (H2 pitfalls vs real DB via Testcontainers); test data management & isolation (transaction rollback vs truncate vs recreate); the integration test pyramid layer; narrow vs broad integration tests (Fowler); flakiness sources; test doubles at integration boundaries; contract tests as an alternative to broad integration." },
  { slug: 'testcontainers-for-integration-testing', name: 'Testcontainers for Integration Testing', hints: "why Testcontainers (real deps in Docker vs in-memory fakes); GenericContainer & specialized modules (PostgreSQLContainer, KafkaContainer, etc.); lifecycle (@Testcontainers/@Container, per-method vs per-class/static, singleton container pattern for speed); reuse & Ryuk cleanup; waiting strategies (wait-for-log/port/http); dynamic properties (@DynamicPropertySource) to wire the container into the app; network & compose support; cost (startup time) vs fidelity trade-off; CI considerations (docker-in-docker)." },
  { slug: 'api-and-http-service-testing-with-mock-servers', name: 'API & HTTP Service Testing with Mock Servers', hints: "testing HTTP clients/servers; WireMock/MockWebServer (stubbing responses, request matching, fault injection, latency simulation, verifying requests); REST Assured for API endpoint testing (given/when/then, JSON path assertions); testing against a mock server vs real service vs contract; recording/playback; simulating errors/timeouts/rate-limits; testing retries & circuit breakers; MockMvc/WebTestClient as a pointer to spring domain; snapshot/golden-file testing of payloads." },
  { slug: 'contract-testing', name: 'Contract Testing', hints: "the problem contract testing solves (integration tests are slow/brittle across services; broad integration doesn't scale in microservices); consumer-driven contracts (CDC); Pact (consumer generates pact, provider verifies; pact broker; can-i-deploy); Spring Cloud Contract (producer-driven, stubs generated for consumers); bi-directional contract testing; contract vs schema (OpenAPI) testing; provider states; versioning contracts & the deployment gate; contract testing vs e2e trade-off; where it fits in the pyramid." },
  { slug: 'end-to-end-and-ui-testing', name: 'End-to-End & UI Testing', hints: "e2e scope (full stack through the UI/API); why few e2e tests (slow, flaky, expensive — top of pyramid); Selenium/WebDriver vs Playwright/Cypress (auto-wait, flakiness); page object model; explicit vs implicit waits & the flakiness they fight; test data & environment setup for e2e; headless vs headed; visual regression testing; e2e in CI (parallelization, sharding, retries); when e2e is worth it (critical user journeys); the ice-cream-cone anti-pattern revisited." },
  { slug: 'code-coverage-and-mutation-testing', name: 'Code Coverage & Mutation Testing', hints: "coverage metrics (line/statement/branch/condition/MC-DC/path); JaCoCo; why high coverage != good tests (coverage measures execution, not assertion quality); Goodhart's law on coverage targets; mutation testing (PIT/PITest) — mutants, killed vs survived, mutation score as a measure of TEST STRENGTH; equivalent mutants; mutation testing cost; coverage as a floor not a goal; what to exclude from coverage; combining coverage + mutation for real signal." },
  { slug: 'performance-testing', name: 'Performance Testing: Load, Stress, Soak & Spike', hints: "types — load (expected), stress (find breaking point), soak/endurance (memory leaks over time), spike (sudden surge), scalability, volume; tools (JMeter, Gatling, k6, Locust); open vs CLOSED workload models & why it matters; the COORDINATED OMISSION problem (why average latency lies, why you must measure percentiles p95/p99/p999); throughput vs latency vs concurrency (Little's Law); think time & pacing; ramp-up; defining SLOs/pass-fail; bottleneck analysis; test environment fidelity; performance testing in CI." },
  { slug: 'test-automation-in-cicd-and-flaky-tests', name: 'Test Automation in CI/CD & Flaky Tests', hints: "test stages in a pipeline (fast unit -> integration -> e2e; fail-fast; test parallelization/sharding); build gates & quality gates; the flaky test problem (causes: async/timing/order-dependence/shared-state/external-deps/nondeterminism); detecting & quarantining flaky tests; retries as a smell vs necessity; test isolation & idempotency; deterministic tests (control time/random/concurrency); test data hygiene; test result reporting/trends; running tests on PRs; the cost of slow test suites; test impact analysis / selective test runs." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior backend engineer and interview coach authoring interview-grade study material for the Software Testing topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer verifying interview content for the Software Testing topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or in MCQ answers/explanations. Web-research anything uncertain — the test-doubles taxonomy (dummy/stub/spy/mock/fake precise definitions), JUnit 5 lifecycle & instance-per-method default, Mockito matcher/strictness rules & doReturn-on-spy, coordinated omission, mutation-score semantics, Pact CDC flow, coverage-metric definitions. A wrong 'answer' index or a mischaracterized test double is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT: keep it general testing discipline (JUnit/Mockito as examples). If it re-teaches Spring test slices in depth, trim to a pointer. Keep performance-testing at the testing-discipline level.\n` +
    `3) SCHEMA violations in questions.yaml: valid YAML; top-level keys topic/domain(testing)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, 3-digit seq), difficulty in {beginner,intermediate,advanced,expert}, question, 3-5 options, 0-based 'answer' in range, explanation; ids unique; correct-option position VARIED (rebalance if any index >40%).\n` +
    `4) Every 'ref: concepts.md#anchor' must resolve to an actual '## ' heading (GitHub slug rules). Any Mermaid blocks must be valid.\n` +
    `5) COVERAGE: at least 40 questions, every subtopic represented, mixed difficulty, some scenario-style questions present. Add if thin.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
