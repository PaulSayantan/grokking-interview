export const meta = {
  name: 'design-patterns-authoring',
  description: 'Author a comprehensive "Design Patterns" group under system-design (7 pattern-family topics covering ALL GoF + enterprise + concurrency + distributed patterns), each pattern with a Mermaid diagram + trade-offs, via research -> author -> verify with a completeness gate',
  phases: [
    { title: 'Research', detail: 'per family: enumerate EVERY pattern that must be covered (completeness gate)' },
    { title: 'Author', detail: 'write concepts.md (each pattern: intent, example, Mermaid diagram, trade-offs) + 40-60 MCQs' },
    { title: 'Verify', detail: 'fact-check, confirm NO pattern omitted, Mermaid valid, schema-check' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const SCOPE = `
DOMAIN: a new "Design Patterns" group inside the system-design domain (slugs are prefixed
"dp-"). Language-agnostic and OO-first (use pseudo-code / language-neutral UML-style examples;
you MAY show a short idiomatic snippet but do NOT teach a specific framework). This is
INTERVIEW-GRADE reference material: patterns are heavily tested.

REQUIREMENTS the user set explicitly:
- EXTENSIVE online research. Ground each pattern in authoritative sources (the GoF book
  "Design Patterns" by Gamma/Helm/Johnson/Vlissides; Martin Fowler's "Patterns of Enterprise
  Application Architecture" (PoEAA) + martinfowler.com; refactoring.guru; POSA concurrency
  patterns; Azure/AWS cloud design pattern catalogs; microservices.io by Chris Richardson).
- EVERY pattern in this family must be covered — NOTHING left out. Completeness is graded.
- For EACH pattern, ALL of these are MANDATORY:
  (1) THE PROBLEM IT SOLVES — lead each pattern's section with a crisp, plain-language
      "Problem it solves:" statement: the specific pain/smell (e.g. "you need one shared
      instance and global access without global variables") that this pattern removes. This
      is the #1 thing an interviewer probes — make it explicit and memorable, not buried.
  (2) intent / how it works,
  (3) a concrete example,
  (4) a MERMAID diagram (classDiagram for structure, or sequenceDiagram/stateDiagram-v2 where
      a flow/state is clearer),
  (5) TRADE-OFFS (pros, cons, when to use, when NOT to, common misuse).
- Also cover: how it differs from similar patterns (a frequent interview probe), and any
  well-known real-world/library usage.

BOUNDARY: the system-design domain already has trade-off topics for several DISTRIBUTED
patterns (event-driven-cqrs-saga-cdc, resilience-tradeoffs-deep-dive, microservices-*). The
dp-distributed-cloud topic is a PATTERN-CATALOG view (intent + structure diagram + trade-offs
per pattern) and should CROSS-REFERENCE those deep-dive topics rather than duplicate their
whiteboard/scenario treatment.

DIAGRAMS: use \`\`\`mermaid fenced blocks (classDiagram / sequenceDiagram / stateDiagram-v2).
Do NOT use ASCII-art. Keep any code snippets in normal fenced code blocks (\`\`\`java etc.).
Mermaid class/sequence syntax must be valid (quote labels with special chars; balanced blocks).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - One "## <Pattern or Subtopic>" H2 per pattern (these are MCQ anchor targets — stable).
     For a family topic, that means ONE H2 PER PATTERN (e.g. "## Singleton", "## Factory Method").
   - Under each pattern H2, IN THIS ORDER: a bolded "Problem it solves:" line (the specific
     pain the pattern removes, in plain language), then intent/how-it-works, a concrete
     example, a Mermaid diagram, and an explicit trade-offs paragraph (pros / cons / when to
     use / when to avoid / vs. similar patterns).
   - Layered depth (beginner definition -> intermediate application -> advanced gotchas).
   - End with "## Common follow-up questions" and "## References" (cite GoF/Fowler/etc.).

2) questions.yaml. Top-level keys:
     topic: "<Topic Name>"
     domain: system-design
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq; prefix == slug
         difficulty: beginner     # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2                # 0-BASED index
         explanation: |
           <why correct; teach the concept>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: 40-60 questions (min 40); cover EVERY pattern with >=1 question each; 3-5 options,
   exactly one correct, 0-based 'answer'; VARY the correct index (no clustering); mixed
   difficulty (some advanced, this is Pass 1); scenario/"which pattern fits this problem?" and
   "which pattern is this code/diagram?" and "X vs Y difference" styles; distractors are OTHER
   real patterns (great distractors) wrong for a real reason; no "all/none of the above";
   every 'ref' resolves to a real "## " heading; id prefix == slug.

Return one line: "<slug>: concepts.md (<n> patterns) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'dp-fundamentals-and-principles', name: 'Design Patterns: Fundamentals & Principles',
    must: "What a design pattern is; the GoF catalog history & the 3 categories (creational/structural/behavioral); pattern structure (intent/participants/collaborations/consequences); SOLID principles (SRP, OCP, LSP, ISP, DIP) each with example; DRY, KISS, YAGNI, separation of concerns, law of Demeter; composition over inheritance; coupling vs cohesion; program-to-an-interface-not-an-implementation; encapsulate-what-varies; anti-patterns (God object, spaghetti, golden hammer, premature abstraction) & pattern OVERUSE; how to choose a pattern; idioms vs patterns vs architectural styles." },
  { slug: 'dp-creational', name: 'Creational Design Patterns',
    must: "ALL 5 GoF creational: Singleton (incl. thread-safety, double-checked locking, enum, why it's often an anti-pattern), Factory Method, Abstract Factory, Builder (incl. fluent), Prototype (clone/deep-vs-shallow). PLUS closely-related creational: Object Pool, Dependency Injection / IoC container, Simple/Static Factory (idiom), Multiton, Lazy Initialization. Differences: Factory Method vs Abstract Factory vs Builder vs Simple Factory." },
  { slug: 'dp-structural', name: 'Structural Design Patterns',
    must: "ALL 7 GoF structural: Adapter (object vs class), Bridge, Composite, Decorator, Facade, Flyweight, Proxy (virtual/remote/protection/smart). Differences frequently probed: Decorator vs Proxy vs Adapter vs Facade; Bridge vs Adapter; Composite vs Decorator. Real usages (java.io streams=Decorator, collections=Composite, etc.)." },
  { slug: 'dp-behavioral', name: 'Behavioral Design Patterns',
    must: "ALL 11 GoF behavioral: Chain of Responsibility, Command, Interpreter, Iterator, Mediator, Memento, Observer, State, Strategy, Template Method, Visitor. Differences: Strategy vs State vs Template Method; Observer vs Mediator vs pub-sub; Command vs Strategy; Visitor double-dispatch. Real usages." },
  { slug: 'dp-enterprise-application', name: 'Enterprise & Application Architecture Patterns',
    must: "Fowler PoEAA + common enterprise/backend patterns: Repository, DAO, Data Mapper, Active Record, Unit of Work, Identity Map, Lazy Load; Domain Model vs Transaction Script vs Table Module; Service Layer; DTO & Assembler/Mapper; Value Object vs Entity; Specification; MVC vs MVP vs MVVM vs MVU; Front Controller & Page Controller; Gateway; Registry; Money/Special Case/Null Object. Differences: Repository vs DAO; Active Record vs Data Mapper; DTO vs Value Object." },
  { slug: 'dp-concurrency', name: 'Concurrency & Reactive Design Patterns',
    must: "POSA/concurrency patterns: Producer-Consumer (bounded buffer), Thread Pool / Worker, Future & Promise, Reactor, Proactor, Read-Write Lock, Monitor Object, Active Object, Half-Sync/Half-Async, Leader/Followers, Balking, Guarded Suspension, Double-Checked Locking, Thread-Local Storage, Scheduler, Immutable Object, Copy-on-Write; plus reactive (backpressure, event loop). Trade-offs & correctness pitfalls (races, deadlock). Note the language-agnostic mechanism." },
  { slug: 'dp-distributed-cloud', name: 'Distributed & Cloud Design Patterns',
    must: "Pattern-CATALOG (intent+diagram+trade-offs, cross-reference the existing SD deep-dive topics, don't re-derive them): Circuit Breaker, Retry (+backoff/jitter), Bulkhead, Timeout, Rate Limiter/Throttling, Fallback; Sidecar, Ambassador, Anti-Corruption Layer, Adapter (cloud); Strangler Fig, Gateway Aggregation/Offloading, Backends-for-Frontends; Saga (orchestration vs choreography), CQRS, Event Sourcing, Transactional Outbox, Inbox, Event-Carried State Transfer; Leader Election, Sharding, Consistent Hashing, Cache-Aside, Materialized View; Competing Consumers, Publish-Subscribe, Claim-Check, Priority Queue, Pipes-and-Filters, Scatter-Gather, Choreography; Health Endpoint, Deployment Stamps, Geodes, Sidecar; Idempotent Receiver. Cross-ref: event-driven-cqrs-saga-cdc, resilience-tradeoffs-deep-dive, api-gateways-and-bff, microservices-ddd-and-boundaries." },
]

phase('Research')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are researching the family "${t.name}" (slug: ${t.slug}) for an interview-prep "Design Patterns" reference. Your job: produce the DEFINITIVE, COMPLETE list of patterns this topic must cover so NOTHING is left out.\n\n${SCOPE}\n\n` +
    `Do EXHAUSTIVE web research (GoF, Fowler PoEAA/martinfowler.com, refactoring.guru, POSA, Azure/AWS cloud design patterns, microservices.io). This family MUST cover at minimum: ${t.must}\n\n` +
    `Return a COMPLETE checklist for the author: every pattern name to include (grouped), and for each a one-line intent + the single most important trade-off + the best diagram type (classDiagram/sequenceDiagram/stateDiagram-v2) + the most common "vs which similar pattern" confusion to address. Be exhaustive — if you know a pattern in this family that isn't in the minimum list, ADD it. This checklist is the completeness contract.`,
    { label: `research:${t.slug}`, phase: 'Research', effort: 'high' }
  ),
  (brief, t) => agent(
    `You are a senior engineer and interview coach authoring the "${t.name}" topic (slug: ${t.slug}) for a Design Patterns interview reference.\n\n${SCOPE}\n\n` +
    `RESEARCH CHECKLIST (this is your COMPLETENESS CONTRACT — every pattern listed MUST get its own "## " section; do not skip any):\n${brief}\n\n${SCHEMA}\n\n` +
    `Write both files into ${DIR}/${t.slug}/ now. One "## " per pattern, each with intent + concrete example + a valid Mermaid diagram + explicit trade-offs + "vs similar pattern" note. Pass 1: 40-60 MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `Verify the Design Patterns topic "${t.name}" (slug: ${t.slug}). Read ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and the research checklist context. FIX IN PLACE:\n` +
    `1) COMPLETENESS (critical — user requirement "no patterns left out"): every pattern that belongs to this family MUST have its own "## " section with (a) an explicit bolded "Problem it solves:" line, (b) intent, (c) example, (d) a Mermaid diagram, and (e) trade-offs. Re-derive the full expected list from your own knowledge + web research; if ANY pattern is missing, or lacks the "Problem it solves" line, a diagram, or trade-offs, ADD it. For dp-creational confirm all 5 GoF + extras; dp-structural all 7 GoF; dp-behavioral all 11 GoF.\n` +
    `2) FACTUAL errors in pattern descriptions, participants, or MCQ answers/explanations — web-research anything uncertain (GoF intent, Fowler definitions, Strategy-vs-State, Repository-vs-DAO, Circuit-Breaker states). A wrong 'answer' index or a mischaracterized pattern is the worst defect.\n` +
    `3) MERMAID: every \`\`\`mermaid block must be syntactically valid (correct header classDiagram/sequenceDiagram/stateDiagram-v2, quoted special-char labels, balanced blocks, no ASCII-art leakage). Fix invalid diagrams.\n` +
    `4) SCHEMA: valid YAML; ids unique, prefix '${t.slug}-', 3-digit seq; difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based in-range 'answer'; every 'ref' resolves to a real '## ' heading; correct-option positions VARIED (rebalance if any index >35%).\n` +
    `5) COVERAGE: >=40 questions, every pattern represented, mixed difficulty, scenario/"which pattern" questions present. Add if thin.\n\n` +
    `Return one line: "${t.slug}: <patternCount> patterns, <questionCount> questions, <fixed|clean>, notes: <any pattern you had to add>".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
