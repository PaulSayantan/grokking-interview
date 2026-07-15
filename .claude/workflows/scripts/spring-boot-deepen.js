export const meta = {
  name: 'spring-boot-deepen',
  description: 'Deepen every Spring Boot topic: add advanced/expert high-level interview questions and deeper per-subtopic MCQ coverage, preserving all existing content',
  phases: [
    { title: 'Deepen', detail: 'append advanced/expert MCQs + enrich concepts per topic' },
    { title: 'Verify', detail: 'fact-check, dedupe, schema-check each topic in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/spring-boot`

// slug -> current max question sequence number (new questions start at max+1)
const TOPICS = [
  { slug: 'fundamentals-autoconfiguration-starters', name: 'Spring Boot Fundamentals, Auto-Configuration & Starters', start: 61 },
  { slug: 'ioc-dependency-injection', name: 'IoC Container & Dependency Injection', start: 56 },
  { slug: 'bean-scopes-lifecycle', name: 'Bean Scopes & Lifecycle', start: 59 },
  { slug: 'core-annotations-stereotypes', name: 'Core Annotations & Stereotypes', start: 57 },
  { slug: 'configuration-profiles-properties', name: 'Configuration, Profiles & Externalized Properties', start: 57 },
  { slug: 'spring-mvc-rest-apis', name: 'Spring MVC & REST APIs', start: 59 },
  { slug: 'exception-handling-validation', name: 'Exception Handling & Validation', start: 61 },
  { slug: 'spring-data-jpa-persistence', name: 'Spring Data JPA & Persistence', start: 61 },
  { slug: 'transaction-management', name: 'Transaction Management', start: 57 },
  { slug: 'aop-filters-interceptors', name: 'AOP, Filters & Interceptors', start: 58 },
  { slug: 'spring-security-basics', name: 'Spring Security Basics', start: 61 },
  { slug: 'actuator-monitoring-embedded-servers', name: 'Actuator, Monitoring & Embedded Servers', start: 61 },
  { slug: 'testing-spring-boot-applications', name: 'Testing Spring Boot Applications', start: 59 },
  { slug: 'async-scheduling-events', name: 'Asynchronous Processing, Scheduling & Application Events', start: 59 },
  { slug: 'caching-abstraction', name: 'Caching Abstraction', start: 57 },
  { slug: 'reactive-webflux', name: 'Reactive Programming with Spring WebFlux', start: 57 },
  { slug: 'microservices-spring-cloud-resilience', name: 'Microservices, Spring Cloud & Resilience', start: 61 },
  { slug: 'messaging-event-driven-integration', name: 'Messaging & Event-Driven Integration', start: 61 },
]

const RULES = (t) => `
GOAL: make this topic's MCQ bank deeper and HARDER, and enrich the study notes — WITHOUT
removing or altering any existing content.

STEP 1 — READ both existing files first:
  ${DIR}/${t.slug}/concepts.md
  ${DIR}/${t.slug}/questions.yaml
Understand what's already covered so you do NOT duplicate existing questions.

STEP 2 — ENRICH concepts.md (edit in place, additive):
  - For each subtopic (## heading), if the advanced internals / edge cases / trade-offs
    that a senior interviewer probes are thin, add depth (a paragraph, a code snippet, a
    comparison, a "gotcha"). You MAY add new "## " subsections for advanced areas that were
    missing (e.g. internals, failure modes, performance, concurrency, edge cases). Keep
    existing headings stable (questions ref them).
  - Factual accuracy is critical; do web research for anything version-specific
    (Spring Boot 3.x / Spring Framework 6 / Jakarta).

STEP 3 — APPEND new questions to questions.yaml (do NOT rewrite existing ones):
  - Add AT LEAST 40 new questions. New ids are "${t.slug}-NNN" starting at
    ${String(t.start).padStart(3, '0')} and incrementing, zero-padded 3-digit, unique.
  - Difficulty of the NEW questions: heavily weighted to ADVANCED and EXPERT
    (roughly 45% expert, 40% advanced, 15% intermediate). 'expert' is now a valid
    difficulty — use it for deep internals, tricky edge cases, and senior/staff-level
    scenarios. Use it liberally here.
  - DEEP-DIVE every subtopic: each subtopic should gain several new hard questions probing
    internals, edge cases, failure modes, concurrency/thread-safety, performance, ordering,
    and "why does this break?" traps.
  - STYLE: prioritize high-level, complex questions — code-analysis ("what does this print /
    which bean wins / why does this throw?"), scenario/design questions, subtle-distinction
    questions, and multi-step reasoning. Use LONG, plausible, descriptive options that force
    real understanding. Distractors must be wrong for a specific, defensible reason.
  - Do NOT duplicate the meaning of an existing question. New questions must add coverage.

SCHEMA (unchanged, must hold for every new question):
  - keys: id, difficulty (beginner|intermediate|advanced|expert), tags[], question, options[3-5],
    answer (0-BASED index, in range), explanation, ref ("concepts.md#anchor" resolving to a real
    "## " heading via GitHub slug rules — note "A & B" -> "#a--b" double dash).
  - Vary the correct-option position across the new questions.
  - Keep top-level topic/domain(spring-boot)/topic_slug(${t.slug})/version keys intact.

Use Edit/Write. Return one line: "${t.slug}: +<newCount> questions (now <total>), concepts enriched: <yes/no>".
`

phase('Deepen')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a staff-level Spring/Spring Boot engineer and senior interviewer deepening the ` +
    `interview-prep material for "${t.name}" (slug: ${t.slug}). Add the kind of hard, high-level ` +
    `questions that separate senior candidates from juniors.\n\n${RULES(t)}`,
    { label: `deepen:${t.slug}`, phase: 'Deepen', effort: 'high' }
  ),
  (deepenSummary, t) => agent(
    `Verify the deepened Spring Boot topic "${t.name}" (slug: ${t.slug}). Read ` +
    `${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in any concept text, MCQ answer index, or explanation — web-research anything ` +
    `uncertain (Spring Boot 3.x / Spring 6 / Jakarta). A wrong 'answer' is the worst defect.\n` +
    `2) DUPLICATES: if any newly added question is a semantic duplicate of another, rewrite it to ` +
    `cover something new (don't just delete — keep the bank rich).\n` +
    `3) SCHEMA: valid YAML; unique ids all prefixed '${t.slug}-' with 3-digit seq and NO gaps/collisions; ` +
    `difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based in-range 'answer'; ` +
    `every 'ref' anchor resolves to a real '## ' heading. Fix violations.\n` +
    `4) DIFFICULTY: confirm the bank now has a solid block of advanced+expert questions and that ` +
    `expert-tagged ones are genuinely hard (not mislabeled). Re-tag if needed.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeginner>/<nInter>/<nAdv>/<nExpert>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
