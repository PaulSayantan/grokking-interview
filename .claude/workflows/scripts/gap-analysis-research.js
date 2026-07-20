export const meta = {
  name: 'gap-analysis-research',
  description: 'Exhaustive parallel gap-analysis: is the interview-prep library missing any topics/subtopics important for BACKEND + SENIOR developer interviews at product/startup companies? Multi-lens research -> dedup-vs-inventory synthesis -> completeness critic.',
  phases: [
    { title: 'Research', detail: 'parallel agents, each a distinct lens, find candidate topics vs the current inventory' },
    { title: 'Synthesize', detail: 'dedup against inventory, classify (missing/thin/covered), prioritize' },
    { title: 'Critic', detail: 'adversarial completeness check: what lens or topic did we still miss?' },
  ],
}

// ---- CURRENT LIBRARY INVENTORY (ground truth — agents must dedup against this) ----
const INVENTORY = `
The library has 8 AUTHORED domains + 7 unauthored (READMEs only). AUTHORED subtopics:

SYSTEM-DESIGN (70 topics): fundamentals-and-framework, scalability-and-load-balancing,
caching-and-cdn, databases-sql-nosql-sharding-replication, cap-theorem-and-consistency,
message-queues-and-async, microservices-monolith-api-design, rate-limiting-and-consistent-hashing,
networking-and-protocols, observability-monitoring-reliability, security-authentication-data-protection,
+ 8 design problems (search, web-crawler, coordination/locking, job-scheduler, url-shortener,
feed/chat/notification, video-platform, location/payment), event-driven-cqrs-saga-cdc,
genai-llm-system-design, realtime-streaming-systems, resilience-tradeoffs-deep-dive.
ADVANCED deep-dives (8): interview-method-scenario-playbooks, consensus-clocks-and-time,
distributed-transactions-advanced, capacity-modeling-and-tail-latency, failure-theory-advanced,
data-internals-storage-engines, probabilistic-data-structures, microservices-ddd-and-boundaries.
DESIGN PATTERNS group (7): dp-fundamentals-and-principles(SOLID/GoF taxonomy), dp-creational,
dp-structural, dp-behavioral (all 23 GoF), dp-enterprise-application (PoEAA, MVC/MVP/MVVM),
dp-concurrency (POSA), dp-distributed-cloud.
ARCHITECTURAL PATTERNS group (6): arch-fundamentals-and-styles, arch-distributed-infrastructure
(client-server/P2P/microservices/SOA/serverless/space-based), arch-code-organization (layered/
hexagonal/clean/onion/microkernel), arch-dataflow-event, arch-ui-presentation (MVC/MVP/MVVM),
arch-specialized (blackboard/primary-replica/broker).
AWS group (26): compute/serverless/containers/storage/databases/dynamodb/networking/messaging/
streaming/observability/security/ML-genai/cost/migration/reference-architectures.

JAVA-JVM (25): OOP, collections/hashmap internals, generics, exceptions, equals/hashCode,
immutability/strings, heap-vs-stack, GC, JVM architecture/classloading, modern-jvm(GC/JIT/GraalVM),
multithreading, synchronized/volatile/JMM, executors, CompletableFuture, parallelism/forkjoin,
virtual-threads/structured-concurrency, java8 (streams/lambda/functional-interfaces/date-time),
records/sealed, pattern-matching/switch, JPMS modules, reflection/annotations/proxies, serialization,
design-patterns-java.

SPRING-BOOT (18) + SPRING-CORE (19): IoC/DI, beans (scopes/lifecycle/wiring), autoconfiguration,
annotations, AOP/proxies, SpEL, MVC/request-lifecycle, WebFlux/reactive, spring-data-JPA,
transactions, security-basics, testing, actuator, caching, async/scheduling, profiles/properties,
spring-cloud/resilience, messaging-integration, circular-dependencies, exception-handling.

REST-API-DESIGN (18): rest constraints, http methods/status, resource/URI design, request-response/
content-negotiation, validation, error/problem-details, versioning, pagination/filtering,
http-caching, idempotency, hypermedia/HATEOAS, openapi/swagger, auth (oauth/jwt as API contract),
api-security(OWASP-API), rate-limiting, api-gateway/BFF, rest-vs-graphql-vs-grpc, webhooks/async.

NETWORKING (16): OSI/TCP-IP models, IP/subnetting, link-layer/ethernet/ARP, routing/NAT, TCP
deep-dive, UDP, sockets/IO-multiplexing, DNS, HTTP protocol, HTTP2/3/QUIC, TLS/SSL, gRPC/protobuf,
websockets/SSE, connection-mgmt/pooling, proxies/LB(L4-L7), troubleshooting/tools.

SECURITY (16): fundamentals/threat-modeling, crypto-foundations, password-storage, auth/MFA,
sessions/cookies, authz/access-control, oauth2/2.1, oidc/sso, jwt/token-security, injection,
xss/csp, sop/cors/csrf, ssrf, rate-limiting/dos, secrets-mgmt, owasp-top-10.

MESSAGING-DATABASES (15): relational-modeling/normalization, SQL query language, SQL indexing/
optimization, transactions/ACID/isolation, storage-internals/engines, nosql-data-models, vector-DBs,
analytics/columnar/timeseries, redis/caching, replication/read-replicas/pooling, distributed-SQL/
NewSQL, kafka, rabbitmq, messaging-reliability, stream-processing/CDC.

UNAUTHORED domains (READMEs exist, NOT yet written): docker, kubernetes, devops-cicd,
hibernate-jpa, apache-tomcat, observability, testing.
`

const MISSION = `
GOAL: find EVERY topic/subtopic important for a BACKEND developer and SENIOR/STAFF backend
engineer interviewing at PRODUCT-BASED and STARTUP companies that the library above is MISSING or
covers only thinly. Include even RARELY-asked topics — completeness matters more than frequency.

RULES:
- DEDUP against the inventory. If a topic is already an authored subtopic (even under a different
  name/domain), it is NOT a gap — say "covered by <domain>/<slug>" instead of listing it.
- A topic can be a gap in three ways: (a) MISSING ENTIRELY (no domain/subtopic covers it),
  (b) THIN (touched inside another topic but deserves its own dedicated treatment), or
  (c) NEEDS A NEW DOMAIN (a whole area with no home — name the proposed domain).
- Be concrete: give the specific topic/subtopic name, WHY it matters for backend/senior product/
  startup interviews, roughly how often it's asked, and where it should live (existing domain or new).
- Do EXHAUSTIVE web research for YOUR LENS: search current (2024/2025) backend + senior/staff
  interview guides, company-specific prep (FAANG + top product cos + well-known startups), the
  relevant canonical references, and "most asked X interview questions" lists. Cite what you find.
`

const LENSES = [
  { key: 'dsa-coding', focus: `DATA STRUCTURES, ALGORITHMS & CODING-INTERVIEW lens. The library has NO dedicated DSA/coding
    domain (only system-design's probabilistic-data-structures). Enumerate everything a backend/
    senior candidate is expected to know for coding rounds: core data structures (arrays, strings,
    linked lists, stacks/queues, hash tables, trees/BST/tries/heaps, graphs, union-find), algorithms
    (sorting, searching, recursion/backtracking, two-pointer/sliding-window, BFS/DFS, dynamic
    programming, greedy, divide-and-conquer, bit manipulation, string algorithms), Big-O/complexity
    analysis, and the common problem PATTERNS. Also: is there a case for an LeetCode-style patterns
    topic? Where should a DSA domain live?` },
  { key: 'cs-fundamentals', focus: `COMPUTER-SCIENCE & OPERATING-SYSTEM FUNDAMENTALS lens. Topics like: OS (processes vs threads,
    context switching, scheduling, virtual memory/paging, deadlocks at OS level, IPC, file systems),
    how memory works, how a CPU/cache works, compilation/interpretation, character encodings/Unicode,
    time zones/date handling, floating point, endianness, regular expressions. Which of these are
    asked of backend/senior devs and are missing (note: JVM memory/threads ARE covered under java-jvm
    — dedup carefully; OS-LEVEL treatment is different).` },
  { key: 'backend-craft', focus: `BACKEND ENGINEERING CRAFT lens (beyond APIs/DBs already covered). Topics like: background job
    processing / task queues at the app level, cron/scheduling, file upload/storage/streaming,
    email/SMS/notifications delivery, pagination at scale, batch/ETL jobs, feature flags, config
    management, internationalization/localization, PDF/report generation, search integration
    (Elasticsearch/OpenSearch as a skill), full-text search, rate-limiting implementation,
    multi-tenancy, soft deletes/auditing, money/currency handling, idempotency implementation. Which
    are missing vs covered (some may be in rest-api-design or system-design — dedup).` },
  { key: 'concurrency-perf', focus: `CONCURRENCY, PERFORMANCE & PROFILING lens (language-agnostic + backend). Topics like: concurrency
    models (threads vs async/event-loop vs actors vs CSP/goroutines), lock-free/atomics, memory models,
    performance profiling & flame graphs, benchmarking, latency vs throughput optimization, memory
    leaks & pressure, connection/thread pool tuning, caching strategy at app level, JIT/warmup, load
    testing. Dedup vs java-jvm concurrency + system-design capacity/tail-latency (those exist).` },
  { key: 'testing-quality', focus: `TESTING, CODE QUALITY & ENGINEERING-PRACTICE lens. The 'testing' domain is UNAUTHORED. Enumerate:
    unit/integration/e2e/contract testing, TDD/BDD, test doubles (mock/stub/fake/spy), test pyramid,
    property-based testing, mutation testing, coverage, flaky tests, testcontainers, load/perf/chaos
    testing, code review practices, clean code/refactoring, technical debt, static analysis/linting,
    pair programming. What subtopics should the testing domain have? Any quality topics with no home?` },
  { key: 'devops-cloud-sre', focus: `DEVOPS / CI-CD / CLOUD / SRE / PLATFORM lens. Domains docker, kubernetes, devops-cicd, observability
    are UNAUTHORED. Beyond their obvious contents, find gaps: Infrastructure-as-Code (Terraform/Pulumi),
    GitOps, config/secrets in deploys, blue-green/canary/feature-flag deploys, service mesh, containers
    security, cloud beyond AWS (GCP/Azure basics? multi-cloud?), Linux/bash/sysadmin skills, networking
    for ops, cost/FinOps, SLO/SLI/error-budgets, incident management/on-call/postmortems, chaos
    engineering. What subtopics for these unauthored domains + anything with no home?` },
  { key: 'data-engineering', focus: `DATA / DATA-ENGINEERING / ML-ADJACENT lens for backend devs. Topics like: data pipelines/ETL/ELT,
    data warehouse vs lake vs lakehouse, batch vs streaming (Spark/Flink/Beam), data modeling for
    analytics (star/snowflake — partly covered), data quality/governance, OLAP, search engines
    (Elasticsearch internals), graph databases, geospatial data, ML serving/feature stores/model
    deployment (some genai covered), recommendation basics, data privacy/GDPR. Dedup vs
    messaging-databases + system-design. What's missing?` },
  { key: 'language-runtime', focus: `LANGUAGE & RUNTIME BREADTH lens. The library is Java/JVM-heavy. For product/startup backend roles,
    consider: is there value in language-agnostic backend-language concepts (memory management/GC across
    languages, type systems, async models per language)? Common non-Java backend stacks startups use
    (Node.js/TypeScript, Python, Go, Rust) — are there cross-cutting concepts (event loop, GIL,
    goroutines, ownership) a senior backend dev should know regardless of stack? Also: functional
    programming concepts, API/library design, dependency management/build tools. Flag anything missing
    that isn't Java-specific.` },
  { key: 'interview-process-senior', focus: `INTERVIEW-PROCESS & SENIOR/STAFF-SPECIFIC lens. Beyond technical topics: behavioral interviews
    (STAR method), the specific SENIOR/STAFF signals (system-design leadership, technical judgment,
    mentorship, cross-team influence, handling ambiguity), engineering-management-adjacent (for tech
    leads), architecture-decision-records, writing design docs, code-review as a senior, estimation,
    trade-off articulation, how product/startup interviews DIFFER from FAANG (product sense, scrappiness,
    full-stack expectations, ownership). system-design has interview-method-scenario-playbooks — dedup.
    What non-coding topics are missing?` },
  { key: 'web-protocols-frontend-adjacent', focus: `WEB PLATFORM & FRONTEND-ADJACENT lens (what backend devs still get asked). Topics like: browser
    rendering/critical-path (light), CORS (covered in security), cookies/sessions (covered), CDN
    (covered), web performance, HTTP caching (covered in rest-api), WebSockets (covered), GraphQL as a
    skill (federation, dataloader, schema design — partly in rest-api), gRPC (covered), API design for
    mobile/BFF (covered), accessibility/i18n basics, SSR/SSG concepts, JAMstack. Dedup hard — much may
    be covered. Flag only genuine backend-relevant gaps.` },
  { key: 'reliability-ops-prod', focus: `PRODUCTION-READINESS & RELIABILITY-ENGINEERING lens. Topics like: logging best practices/structured
    logging, distributed tracing (OpenTelemetry), metrics/RED-USE methods, alerting, health checks/
    readiness/liveness, graceful shutdown/degradation, circuit breakers (covered as pattern), retries/
    backoff (covered), feature toggles, deployment safety, database migrations/zero-downtime schema
    changes, backfills, disaster recovery/backups, capacity planning (covered), runbooks. observability
    domain is unauthored. Dedup vs system-design resilience/observability + dp-distributed-cloud. Gaps?` },
  { key: 'domain-modeling-api-advanced', focus: `DOMAIN MODELING, DDD & ADVANCED API/INTEGRATION lens. Topics like: Domain-Driven Design tactical +
    strategic (bounded contexts covered in microservices-ddd), event storming, aggregate design,
    hexagonal/clean applied (arch covers styles), API integration patterns (webhooks covered, but:
    third-party API integration, OAuth client flows, API rate-limit handling as a consumer, SDK design,
    versioning consumers), gRPC/protobuf schema evolution (covered), GraphQL federation, BFF (covered),
    async request-reply, transactional outbox (covered). What DDD/integration subtopics are genuinely
    missing or deserve dedicated treatment?` },
]

phase('Research')
const briefs = await parallel(
  LENSES.map((l) => () =>
    agent(
      `You are a senior engineering interviewer doing EXHAUSTIVE gap analysis for ONE lens of a backend/senior interview-prep library.\n\n` +
      `CURRENT LIBRARY INVENTORY (dedup against this — do not report already-covered topics as gaps):\n${INVENTORY}\n\n` +
      `${MISSION}\n\nYOUR LENS: ${l.focus}\n\n` +
      `Return a structured gap list for YOUR LENS ONLY: for each candidate — name, status (MISSING / THIN / COVERED-BY<where>), why it matters for backend/senior product-or-startup interviews, rough ask-frequency (very-high/high/medium/low/rare), and where it should live (existing domain or a proposed NEW domain name). Group by status; put MISSING and THIN first. Be exhaustive; include rarely-asked items. Cite the sources/guides you researched.`,
      { label: `research:${l.key}`, phase: 'Research', effort: 'high' }
    )
  )
)
const valid = briefs.filter(Boolean)

phase('Synthesize')
const synthesis = await agent(
  `You are the lead engineer consolidating ${valid.length} lens-specific gap analyses into ONE authoritative gap report for a backend/senior interview-prep library.\n\n` +
  `CURRENT INVENTORY (ground truth):\n${INVENTORY}\n\n` +
  `THE ${valid.length} LENS REPORTS:\n\n${valid.map((b, i) => `===== LENS ${i + 1}: ${LENSES[i].key} =====\n${b}`).join('\n\n')}\n\n` +
  `Produce a SINGLE consolidated report:\n` +
  `1) DEDUP across lenses (many will overlap) and re-check each against the inventory — drop anything actually covered, noting where.\n` +
  `2) Classify survivors into: (A) MISSING ENTIRELY, (B) THIN / deserves-own-topic, (C) proposed NEW DOMAINS (with the subtopic list each would contain).\n` +
  `3) PRIORITIZE each item: P0 (core, expected — must add), P1 (commonly asked), P2 (valuable, less common), P3 (rare/nice-to-have). Base priority on backend + senior product/startup relevance.\n` +
  `4) For NEW-DOMAIN proposals, give a proposed domain slug + a full subtopic list (so it could be authored directly).\n` +
  `5) End with a RECOMMENDED SEQUENCE: what to author next, in order, and why.\n` +
  `Be specific and complete. This report goes to the human to decide what to author.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' }
)

phase('Critic')
const critic = await agent(
  `You are an adversarial completeness critic. Below is a consolidated gap analysis for a BACKEND + SENIOR developer interview-prep library (product/startup focus), plus the current inventory.\n\n` +
  `INVENTORY:\n${INVENTORY}\n\nCONSOLIDATED GAP REPORT:\n${synthesis}\n\n` +
  `Your job: find what the gap report ITSELF still missed. Do fresh web research. Ask: what entire AREA of backend/senior interviews is absent from BOTH the inventory AND this report? What rarely-asked-but-real topic did every lens overlook? Is any proposed classification/priority wrong? Are any "covered" claims actually wrong (the inventory topic doesn't really cover it)? Return: (1) ADDITIONAL gaps the report missed (name, why, priority, where it should live), and (2) any CORRECTIONS to the report's claims. If the report is genuinely complete, say so explicitly and justify.`,
  { label: 'critic', phase: 'Critic', effort: 'high' }
)

return { synthesis, critic }
