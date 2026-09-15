export const meta = {
  name: 'architectural-patterns-authoring',
  description: 'Author a comprehensive "Architectural Patterns" group under system-design (6 topics covering all recognized architectural styles: distributed/infrastructure, code-organization, dataflow/event, UI, specialized), each style with a Mermaid diagram, problem-it-solves + trade-offs, and cross-references to existing deep-dive topics, via research -> author -> verify',
  phases: [
    { title: 'Research', detail: 'per group: enumerate every architectural style + map overlaps to existing topics' },
    { title: 'Author', detail: 'write concepts.md (each style: problem, diagram, trade-offs, cross-refs) + 40-60 MCQs' },
    { title: 'Verify', detail: 'fact-check, confirm completeness + valid cross-refs + Mermaid + schema' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const SCOPE = `
DOMAIN: a new "Architectural Patterns" group inside the system-design domain (slugs prefixed
"arch-"). These are SYSTEM-LEVEL architectural STYLES (how a whole application is structured/
deployed) — a DIFFERENT altitude from the object-level GoF "Design Patterns" group (dp-*).
Make that distinction explicit where useful. Interview-grade, language/vendor-agnostic.

REQUIREMENTS:
- EXTENSIVE research. Ground each style in authoritative sources (Software Architecture Patterns
  by Mark Richards/O'Reilly; "Fundamentals of Software Architecture" Richards & Ford; POSA vol 1;
  martinfowler.com; microservices.io; Azure Architecture Center; Clean Architecture / Hexagonal
  original sources — Alistair Cockburn (ports & adapters), Jeffrey Palermo (onion), Robert C.
  Martin (clean)).
- COVER EVERY style in the family (completeness is graded).
- For EACH style, MANDATORY in this order: (1) a bolded "Problem it solves:" line (the specific
  pain that motivates this style, plain language), (2) how it works / key components, (3) a
  MERMAID diagram (flowchart/graph for topology, or classDiagram/sequenceDiagram where clearer),
  (4) TRADE-OFFS (pros, cons, when to use, when to avoid, key -ilities it optimizes: scalability/
  deployability/testability/performance), (5) how it differs from adjacent styles.

CROSS-REFERENCE / DE-DUP RULE (user instruction): several of these styles already have DEEP-DIVE
topics elsewhere. The arch-* topic is the ARCHITECTURAL-STYLE overview and MUST cross-reference
the deep-dive rather than duplicate it. Known existing topics to reference by name:
- Microservices, Monolith, API design -> "microservices-monolith-api-design" and
  "microservices-ddd-and-boundaries" (deep-dive).
- Event-Driven / CQRS / Event Sourcing / Saga / CDC -> "event-driven-cqrs-saga-cdc" (deep-dive).
- Message brokers / queues / pub-sub (Broker style) -> "message-queues-and-async".
- Primary-Replica / replication / sharding -> "databases-sql-nosql-sharding-replication".
- MVC / MVP / MVVM and Repository/DTO etc. -> the Design Patterns group "dp-enterprise-application".
- Pipe-and-Filter / Sidecar / Ambassador etc. as patterns -> "dp-distributed-cloud".
- Serverless on AWS -> "aws-serverless-lambda-stepfunctions"; Space-Based/in-memory grid ->
  "caching-and-cdn" / "aws-caching-elasticache-dax".
For overlaps, give a 1-2 line architectural treatment + an explicit "Deep dive: see <topic>" pointer.

INCLUSIVE LANGUAGE (repo rule): use "Primary-Replica"; you MAY note "(historically called
master-slave)" ONCE for recognition, but use Primary-Replica everywhere else. Never use
master/slave, whitelist/blacklist.

DIAGRAMS: \`\`\`mermaid only (no ASCII-art); valid syntax; quote special-char labels.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md:
   - Single "# <Topic Name>" H1.
   - One "## <Style>" H2 per architectural style (MCQ anchor targets — keep stable).
   - Under each style H2 IN ORDER: bolded "Problem it solves:" line, how-it-works/components,
     a Mermaid diagram, trade-offs (pros/cons/when-to-use/when-to-avoid/-ilities), differs-from,
     and (where relevant) a "Deep dive: see <existing-topic>" cross-reference.
   - End with "## Common follow-up questions" and "## References".

2) questions.yaml: top-level topic / domain: system-design / topic_slug / version / questions.
   Each question: id "<slug>-NNN" (unique, 3-digit, prefix==slug), difficulty
   (beginner|intermediate|advanced|expert), tags[], question, options[3-5], answer (0-BASED,
   in range), explanation, ref ("concepts.md#anchor" -> real "## " heading, GitHub slug rules).
   RULES: 40-60 questions (min 40); every style >=1 question; VARY correct index; mixed
   difficulty; scenario/"which architecture fits?" and "X vs Y" and "which -ility does this
   optimize?" styles; distractors are OTHER real styles wrong for a real reason; no all/none.

Return one line: "<slug>: concepts.md (<n> styles) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'arch-fundamentals-and-styles', name: 'Architectural Patterns: Fundamentals & Style Selection',
    must: "What an architectural pattern/style IS and how it differs from a design pattern (system vs object altitude) and from an architectural characteristic; quality attributes / '-ilities' (scalability, availability, performance, deployability, testability, modifiability, evolvability, fault-tolerance, security, cost) and how styles trade them; architecture decision records (ADRs); the concept of architectural fitness functions; monolith vs distributed spectrum; how to CHOOSE a style from requirements; big-ball-of-mud anti-pattern; conway's law; the '1st law: everything is a trade-off'. Overview map of all styles covered in the other arch-* topics with pointers." },
  { slug: 'arch-distributed-infrastructure', name: 'Distributed & Infrastructure Architectures',
    must: "Client-Server (2-tier/3-tier, thick vs thin client); Peer-to-Peer (P2P — decentralized, node=client+server, BitTorrent/blockchain, structured DHT vs unstructured); Microservices (independently deployable, business-capability, API comms) — cross-ref microservices-monolith-api-design & microservices-ddd-and-boundaries; Service-Oriented Architecture / SOA (ESB, enterprise, heavier/more-coupled than microservices, contrast with microservices explicitly); Serverless / FaaS (event-triggered stateless functions, cold starts, cross-ref aws-serverless-lambda-stepfunctions); Space-Based Architecture (in-memory data grid, tuple space, removes central DB bottleneck for high-volume, processing units + virtualized middleware). Compare all on scalability/coupling/ops." },
  { slug: 'arch-code-organization', name: 'Code-Organization Architectures (Layered, Hexagonal, Clean, Microkernel)',
    must: "Layered / N-Tier (presentation/business/persistence/database, closed vs open layers, sinkhole anti-pattern); Hexagonal / Ports & Adapters (Cockburn — core isolated, driving vs driven ports, adapters, testability); Clean Architecture (Robert C. Martin — concentric circles, the Dependency Rule points inward, entities/use-cases/interface-adapters/frameworks) and Onion (Palermo) — compare Clean vs Onion vs Hexagonal (they're closely related); Microkernel / Plug-in (minimal core + plug-ins, VS Code/browsers/IDEs/OS, registry, contract). Emphasize the dependency-inversion idea shared by hexagonal/clean/onion and how it enables testability + swappable infra." },
  { slug: 'arch-dataflow-event', name: 'Data-Flow & Event-Driven Architectures',
    must: "Event-Driven Architecture (broker vs mediator topology, async event producers/consumers, decoupling, eventual consistency) — cross-ref event-driven-cqrs-saga-cdc for the deep dive; Pipe-and-Filter (sequential filters + pipes, Unix pipelines, streaming/ETL, composability); CQRS (separate read/write models, scale independently) — architectural-style treatment + cross-ref event-driven-cqrs-saga-cdc; Event Sourcing (append-only event log as source of truth, replay to derive state, git/ledger analogy, snapshots) — cross-ref event-driven-cqrs-saga-cdc; Batch Processing (large-volume, time-windowed, autonomous, vs stream). Note where these are patterns vs full architectures." },
  { slug: 'arch-ui-presentation', name: 'UI / Presentation Architectures (MVC, MVP, MVVM)',
    must: "MVC (Model-View-Controller — controller handles input, view displays model, origins in Smalltalk/web frameworks); MVP (Model-View-Presenter — passive/dumb view, presenter holds all UI logic, supervising-controller vs passive-view variants); MVVM (Model-View-ViewModel — two-way data binding, ViewModel, dominant in modern frontend/desktop frameworks); plus a note on MVU/MVI/Flux-Redux unidirectional flow as the modern web evolution. Compare MVC vs MVP vs MVVM on testability, coupling, data-binding, and where each dominates. Cross-ref dp-enterprise-application (which also treats these as enterprise patterns) — keep THIS as the presentation-architecture comparison." },
  { slug: 'arch-specialized', name: 'Specialized Architectures (Blackboard, Primary-Replica, Broker)',
    must: "Blackboard (non-deterministic problems like speech recognition/AI reasoning; knowledge sources + central blackboard + control component, opportunistic problem solving); Primary-Replica (one primary handles writes, read replicas sync & serve reads; replication lag, failover/promotion, read-scaling; historically called master-slave — note once then use Primary-Replica) — cross-ref databases-sql-nosql-sharding-replication for replication internals; Broker (POSA — decouples distributed components via a broker that routes requests/results/exceptions, message broker & RPC-broker forms, location transparency) — cross-ref message-queues-and-async. Note when each niche style is the right tool." },
]

phase('Research')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are researching the family "${t.name}" (slug: ${t.slug}) for an interview-prep "Architectural Patterns" reference. Produce the COMPLETE list of architectural styles this topic must cover so NOTHING is left out, and map each to any existing deep-dive topic it should cross-reference.\n\n${SCOPE}\n\n` +
    `Do EXHAUSTIVE web research. This family MUST cover at minimum: ${t.must}\n\n` +
    `Return a COMPLETE checklist: every style name, its one-line "problem it solves", the single most important trade-off, the best Mermaid diagram type, the adjacent style it's most confused with, and which existing repo topic (if any) holds the deep-dive to cross-reference. Add any recognized style in this family missing from the minimum list.`,
    { label: `research:${t.slug}`, phase: 'Research', effort: 'high' }
  ),
  (brief, t) => agent(
    `You are a principal engineer/architect authoring the "${t.name}" topic (slug: ${t.slug}) for an Architectural Patterns interview reference.\n\n${SCOPE}\n\n` +
    `RESEARCH CHECKLIST (COMPLETENESS CONTRACT — every style listed MUST get its own "## " section):\n${brief}\n\n${SCHEMA}\n\n` +
    `Write both files into ${DIR}/${t.slug}/ now. Each style: bolded "Problem it solves:" first, then how-it-works, a valid Mermaid diagram, trade-offs/-ilities, differs-from, and a "Deep dive: see <topic>" cross-ref where an existing topic covers it. Pass 1: 40-60 MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `Verify the Architectural Patterns topic "${t.name}" (slug: ${t.slug}). Read ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml. FIX IN PLACE:\n` +
    `1) COMPLETENESS: every architectural style in this family MUST have its own "## " section with (a) bolded "Problem it solves:" line, (b) how-it-works, (c) Mermaid diagram, (d) trade-offs, (e) differs-from. Re-derive the full list from your knowledge + web research; ADD any missing style or missing required element.\n` +
    `2) CROSS-REFERENCES: where a style has a deep-dive elsewhere (microservices-monolith-api-design, microservices-ddd-and-boundaries, event-driven-cqrs-saga-cdc, message-queues-and-async, databases-sql-nosql-sharding-replication, dp-enterprise-application, dp-distributed-cloud, aws-serverless-lambda-stepfunctions), confirm there's a pointer and it does NOT duplicate the deep-dive's depth. Add a pointer if missing.\n` +
    `3) FACTUAL errors (SOA-vs-microservices, hexagonal-vs-clean-vs-onion dependency rule, MVC-vs-MVP-vs-MVVM binding, space-based components, blackboard control loop, MVC origins) + any wrong MCQ 'answer' index — web-research anything uncertain. A wrong answer is the worst defect.\n` +
    `4) INCLUSIVE LANGUAGE: ensure Primary-Replica (not master/slave) throughout except one optional recognition note.\n` +
    `5) MERMAID valid; SCHEMA valid (unique ids prefix '${t.slug}-' 3-digit, difficulty valid, 3-5 options, 0-based in-range answer, refs resolve to real '## ' headings, correct-index varied — rebalance if any >35%); >=40 questions, every style covered, mixed difficulty, scenario questions present.\n\n` +
    `Return one line: "${t.slug}: <styleCount> styles, <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
