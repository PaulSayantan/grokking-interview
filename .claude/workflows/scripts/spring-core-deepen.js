export const meta = {
  name: 'spring-core-deepen',
  description: 'Deepen every Spring Core topic: add advanced/expert high-level interview questions and deeper per-subtopic coverage, enrich concepts.md, preserving all existing content',
  phases: [
    { title: 'Deepen', detail: 'append advanced/expert MCQs + enrich concepts per topic' },
    { title: 'Verify', detail: 'fact-check, dedupe, schema-check each topic in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/spring-core`

// slug -> next question sequence number (= current max id + 1)
const TOPICS = [
  { slug: 'ioc-container-applicationcontext-vs-beanfactory', name: 'IoC Container: ApplicationContext vs BeanFactory', start: 43 },
  { slug: 'dependency-injection-types', name: 'Dependency Injection Types', start: 43 },
  { slug: 'bean-definition-stereotype-annotations', name: 'Bean Definition and Stereotype Annotations', start: 43 },
  { slug: 'bean-scopes', name: 'Bean Scopes', start: 43 },
  { slug: 'bean-lifecycle-callbacks', name: 'Bean Lifecycle and Lifecycle Callbacks', start: 43 },
  { slug: 'autowired-qualifier-autowiring-resolution', name: '@Autowired, @Qualifier, and Autowiring Resolution', start: 43 },
  { slug: 'circular-dependencies', name: 'Circular Dependencies', start: 42 },
  { slug: 'spring-aop-and-proxies', name: 'Spring AOP and Proxies', start: 43 },
  { slug: 'configuration-profiles-properties', name: 'Configuration, Profiles, and Externalized Properties', start: 46 },
  { slug: 'spring-vs-spring-boot', name: 'Spring vs Spring Boot', start: 43 },
  { slug: 'transaction-management-events', name: 'Transaction Management and Events', start: 46 },
  { slug: 'spring-mvc-request-lifecycle', name: 'Spring MVC and the Request Lifecycle', start: 46 },
  { slug: 'web-exception-handling', name: 'Exception Handling in the Web Layer', start: 43 },
  { slug: 'spring-data-persistence', name: 'Spring Data and Persistence Integration', start: 45 },
  { slug: 'testing-spring-applications', name: 'Testing Spring Applications', start: 46 },
  { slug: 'advanced-bean-wiring', name: 'Advanced Bean Wiring: FactoryBean, @Lazy, and Custom Registration', start: 43 },
  { slug: 'spel-and-value', name: 'Spring Expression Language (SpEL) and @Value', start: 44 },
  { slug: 'actuator-observability', name: 'Actuator, Observability, and Production Concerns', start: 43 },
  { slug: 'async-scheduling-caching', name: 'Asynchronous, Scheduled, and Caching Support', start: 45 },
]

const RULES = (t) => `
GOAL: make this Spring Core topic's MCQ bank deeper and HARDER, and enrich the study notes —
WITHOUT removing or altering any existing content. This complements the existing
beginner/intermediate questions with a strong advanced+expert block.

STEP 1 — READ both existing files first:
  ${DIR}/${t.slug}/concepts.md
  ${DIR}/${t.slug}/questions.yaml
Understand what's already covered so you do NOT duplicate existing questions.

STEP 2 — ENRICH concepts.md (edit in place, additive):
  - For each subtopic (## heading), if the advanced internals / edge cases / trade-offs a
    senior interviewer probes are thin, add depth (a paragraph, code snippet, comparison, "gotcha").
    You MAY add new "## " subsections for advanced areas that were missing (internals, failure
    modes, concurrency/thread-safety, performance, ordering). Keep existing headings STABLE
    (questions ref them). New/renamed headings must NOT contain '/' or '&' (breaks anchor slugs) —
    use commas or "and".
  - This is SPRING FRAMEWORK core (not Spring Boot) — keep Boot-specific behavior confined to the
    "Spring vs Spring Boot" and Actuator topics. Elsewhere, focus on the framework itself.
  - Factual accuracy is critical; web-research anything version-specific (Spring Framework 6.x / Jakarta).

STEP 3 — APPEND new questions to questions.yaml (do NOT rewrite existing ones):
  - Add AT LEAST 35 new questions. New ids are "${t.slug}-NNN" starting at
    ${String(t.start).padStart(3, '0')} and incrementing, zero-padded 3-digit, unique, contiguous.
  - Difficulty of the NEW questions: ONLY 'advanced' and 'expert' (roughly 55% advanced, 45% expert).
    'expert' = deep internals, tricky edge cases, senior/staff-level scenarios. Use it liberally here.
    Do NOT add more beginner/intermediate — those already exist.
  - DEEP-DIVE every subtopic with hard questions probing internals, edge cases, failure modes,
    concurrency/thread-safety, ordering, and "why does this break?" traps.
  - STYLE: high-level, complex questions — code-analysis ("what does this print / which bean wins /
    why does this throw?"), scenario/design questions, subtle-distinction questions, multi-step
    reasoning. LONG, plausible, descriptive options that force real understanding. Distractors wrong
    for a specific, defensible reason.
  - Do NOT duplicate the meaning of an existing question.

SCHEMA (must hold for every new question):
  - keys: id, difficulty (advanced|expert for new ones), tags[], question, options[3-5],
    answer (0-BASED index, in range), explanation, ref ("concepts.md#anchor" resolving to a real
    "## " heading via GitHub slug rules — "A & B" -> "#a--b" double dash; avoid '/' in headings).
  - Vary the correct-option position across the new questions.
  - Keep top-level topic/domain(spring-core)/topic_slug(${t.slug})/version keys intact.

Use Edit/Write. Return one line: "${t.slug}: +<newCount> questions (now <total>), concepts enriched: <yes/no>".
`

phase('Deepen')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a staff-level Spring Framework engineer and senior interviewer deepening the ` +
    `interview-prep material for the SPRING CORE topic "${t.name}" (slug: ${t.slug}). Add the kind of ` +
    `hard, high-level questions that separate senior candidates from juniors.\n\n${RULES(t)}`,
    { label: `deepen:${t.slug}`, phase: 'Deepen', effort: 'high' }
  ),
  (deepenSummary, t) => agent(
    `Verify the deepened Spring Core topic "${t.name}" (slug: ${t.slug}). Read ` +
    `${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in any concept text, MCQ answer index, or explanation — web-research anything ` +
    `uncertain (Spring Framework 6.x / Jakarta). A wrong 'answer' is the worst defect. Keep it framework-focused (not Boot-specific except the Spring-vs-Boot and Actuator topics).\n` +
    `2) DUPLICATES: if any newly added question is a semantic duplicate of another, rewrite it to cover something new (don't delete — keep the bank rich).\n` +
    `3) SCHEMA: valid YAML; unique ids all prefixed '${t.slug}-', 3-digit seq, contiguous with NO gaps/collisions vs the pre-existing ids; difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based in-range 'answer'; every 'ref' anchor resolves to a real '## ' heading (no '/' or '&' in headings). Fix violations.\n` +
    `4) DIFFICULTY: confirm the bank now has a solid advanced+expert block and that expert-tagged ones are genuinely hard (not mislabeled). Re-tag if needed. Do NOT downgrade the pre-existing beginner/intermediate ones.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
