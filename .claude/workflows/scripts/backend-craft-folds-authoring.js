export const meta = {
  name: 'backend-craft-folds-authoring',
  description: 'Author 12 gap-analysis fold-in topics into EXISTING authored domains (system-design, messaging-databases, rest-api-design, security): DDD tactical/strategic, strangler, multi-tenancy, money, search, soft-deletes, migrations, schema-evolution, file-upload, GraphQL, app-crypto. Author -> verify.',
  phases: [
    { title: 'Author', detail: 'one agent per fold-in topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check + cross-ref-check each, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'

const COMMON = `
These are FOLD-IN topics added to an EXISTING authored domain to fill gaps found by a backend/
senior interview gap-analysis. Interview-grade, layered (beginner def+why -> intermediate trade-offs
-> advanced internals/gotchas). Language/framework-agnostic unless the topic is inherently tied to a
tech. Ground every claim in authoritative sources + your own web research; factual accuracy is critical.

CROSS-REFERENCE, DON'T DUPLICATE: the library already has deep coverage of adjacent areas. Where this
topic overlaps an existing topic, give the focused treatment for THIS topic and add a short
"See also: <topic>" pointer rather than re-teaching. The per-topic XREF note lists what to point to.

DIAGRAMS: if a diagram helps, use a \`\`\`mermaid fenced block (flowchart/sequenceDiagram/erDiagram/
stateDiagram-v2/classDiagram). NO ASCII-art. CRITICAL: no semicolons in sequenceDiagram message text
(';' is a statement separator that breaks the parser — use commas/"then"). Keep code/SQL/YAML in
normal fenced code blocks; quote any YAML MCQ option that contains a colon+space or leading brace.
`

const SCHEMA = (domain, slug) => `
CONTENT CONTRACT (follow exactly). Write TWO files into ${REPO}/topics/${domain}/${slug}/ :

1) concepts.md — single "# <Topic Name>" H1; one "## <Subtopic>" H2 per subtopic (MCQ anchor
   targets, keep stable); layered interview-grade prose with concrete examples (code/SQL/config
   snippets, comparison tables, a diagram where it helps); end with "## Common follow-up questions"
   and "## References".

2) questions.yaml — top-level keys:
     topic: "<Topic Name>"
     domain: ${domain}
     topic_slug: ${slug}
     version: 1
     questions:
       - id: ${slug}-001    # unique, zero-padded 3-digit seq; prefix == slug
         difficulty: beginner   # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options: ["<0>","<1>","<2>","<3>"]
         answer: 2              # 0-BASED index
         explanation: |
           <why correct; teach the concept>
         ref: "concepts.md#<anchor>"  # resolves to a real "## " heading (GitHub slug rules)

   RULES: 40-60 questions (min 40); cover EVERY subtopic; 3-5 options, exactly one correct, 0-based
   answer; VARY the correct index (no clustering, no trivially-guessable repeating cycle); mixed
   difficulty (Pass 1); INCLUDE scenario-style questions; distractors plausible but wrong for a real
   reason; no all/none-of-the-above; every 'ref' resolves to a real "## " heading; id prefix == slug.

Use the Write tool. Do your own web research. Return: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  // ---- system-design (core group) ----
  { domain: 'system-design', slug: 'ddd-tactical-patterns', name: 'Domain-Driven Design: Tactical Patterns',
    xref: "See also microservices-ddd-and-boundaries (strategic boundaries deep-dive) and dp-enterprise-application (Repository/Value-Object as enterprise patterns) — here focus on the TACTICAL building blocks and how they fit together.",
    hints: "entity (identity + lifecycle) vs VALUE OBJECT (immutable, equality-by-value, no identity — money/date-range/address); AGGREGATE & aggregate ROOT (consistency boundary, one transaction per aggregate, reference other aggregates by id not object, keep small); domain events; repositories (per-aggregate, collection illusion) & factories; domain services vs application services; the anemic domain model anti-pattern (logic in services not entities) vs rich domain model; invariants enforced inside the aggregate; ubiquitous language in code; when tactical DDD is worth it (complex domains) vs overkill (CRUD)." },
  { domain: 'system-design', slug: 'ddd-strategic-context-mapping', name: 'DDD Strategic Design & Context Mapping',
    xref: "See also microservices-ddd-and-boundaries (bounded contexts as service boundaries) — here focus on context MAPPING relationships and strategic distillation.",
    hints: "bounded context (a model's boundary, ubiquitous language is context-local) & why the SAME term means different things across contexts; context MAP relationship patterns — Partnership, Shared Kernel, Customer/Supplier, Conformist, Anti-Corruption Layer (ACL), Open Host Service (OHS), Published Language, Separate Ways, Big Ball of Mud; upstream/downstream; core domain vs supporting vs generic subdomain (strategic distillation — invest in the core); how bounded contexts map to microservices (often 1:1 but not always); domain storytelling/event storming to discover contexts (brief); integrating contexts (ACL to protect your model)." },
  { domain: 'system-design', slug: 'strangler-fig-and-monolith-migration', name: 'Strangler Fig & Monolith-to-Microservices Migration',
    xref: "See also microservices-monolith-api-design and event-driven-cqrs-saga-cdc (CDC/outbox for data sync during migration).",
    hints: "the Strangler Fig pattern (incrementally replace a monolith by routing slices of functionality to new services behind a facade/proxy until the monolith is 'strangled' — vs risky big-bang rewrite); branch by abstraction (introduce an abstraction layer, swap implementations); parallel run (run old+new, compare outputs) & dark launching; the facade/routing layer (API gateway routes old vs new); identifying seams & extraction order (start with low-risk/high-value edges); DATA migration during decomposition (shared DB -> DB-per-service, the dual-write trap, CDC/outbox to sync, the transitional shared-DB anti-pattern); rollback safety; when NOT to migrate (monolith is fine); incremental vs big-bang trade-off." },
  { domain: 'system-design', slug: 'multi-tenancy-and-saas-isolation', name: 'Multi-Tenancy & SaaS Isolation',
    xref: "See also databases-sql-nosql-sharding-replication (sharding), security-authentication-data-protection (tenant authz), and rate-limiting-and-consistent-hashing (per-tenant limits).",
    hints: "tenancy models — SILO (isolated stack/DB per tenant: strongest isolation, priciest, hardest to operate at scale), POOL (shared everything, tenant_id column: cheapest/most scalable, noisy-neighbor + blast-radius risk), BRIDGE (hybrid, e.g. shared app + per-tenant schema/DB); the isolation spectrum & trade-offs (cost vs isolation vs ops); enforcing tenant isolation (row-level security, tenant_id on every query, the cross-tenant data-leak bug — the #1 SaaS security failure); noisy neighbor & per-tenant quotas/rate-limits; tenant onboarding/offboarding; data residency per tenant; per-tenant customization; tiered tenants (premium gets silo); the shared-schema vs schema-per-tenant vs db-per-tenant DB choice." },

  // ---- messaging-databases ----
  { domain: 'messaging-databases', slug: 'money-currency-and-financial-data', name: 'Money, Currency & Financial Data Handling',
    xref: "See also transactions-acid-isolation-levels (financial correctness) and relational-modeling-normalization (schema).",
    hints: "NEVER use float/double for money (binary floating point can't represent 0.10 exactly -> rounding errors) -> use DECIMAL/NUMERIC (fixed precision) or store MINOR UNITS as integers (cents/pennies as bigint); the money type = amount + CURRENCY (never assume one currency); rounding modes (half-even/banker's rounding vs half-up) & when each; multi-currency (store amount+currency, convert at a defined rate/time, never sum mixed currencies); the DOUBLE-ENTRY LEDGER pattern (every transaction = balanced debits+credits, append-only, derive balances — the accounting-correct model) vs a mutable balance column; idempotent financial ops (idempotency keys to avoid double-charge); reconciliation; precision in transit (JSON numbers -> string for money); allocation/splitting without losing pennies." },
  { domain: 'messaging-databases', slug: 'search-engines-and-elasticsearch', name: 'Search Engines & Elasticsearch Internals',
    xref: "See also vector-databases-similarity-search (semantic/hybrid search) and nosql-databases-data-models.",
    hints: "the INVERTED INDEX (term -> posting list of doc ids; the core of full-text search, why it's fast for text vs a B-tree LIKE scan); analysis pipeline (char filters -> tokenizer -> token filters: lowercase/stemming/stopwords/synonyms) at index & query time; relevance scoring (TF-IDF -> BM25, the default; boosting); Elasticsearch/OpenSearch model (index, shards+replicas, Lucene segments, near-real-time refresh, the translog); mapping (text vs keyword — analyzed vs exact; why you need both), dynamic mapping pitfalls; queries (match vs term vs bool, filters cached & score-less vs queries scored); aggregations; reindex + alias-swap for zero-downtime mapping changes; indexing pipeline from the DB (CDC/dual-write); ELK vs the DB as source of truth; when NOT to use a search engine." },
  { domain: 'messaging-databases', slug: 'soft-deletes-auditing-and-temporal-data', name: 'Soft Deletes, Auditing & Temporal Data',
    xref: "See also transactions-acid-isolation-levels and relational-modeling-normalization.",
    hints: "SOFT DELETE (deleted_at/is_deleted flag instead of DELETE) — pros (recoverable, audit, referential safety) vs cons (every query must filter deleted, unique-constraint conflicts with 'deleted' rows, index bloat, the forgotten-filter data-leak bug); partial indexes / views to manage it; AUDIT trails (who-changed-what-when: audit columns created/updated_by/at, separate audit/history table, triggers vs app-level vs CDC-based auditing, append-only tamper-evidence); TEMPORAL data — valid-time vs transaction-time, bitemporal tables, SQL:2011 system-versioned temporal tables, slowly-changing-dimensions (SCD type 2) for history; event sourcing as the ultimate audit (pointer); the tension between GDPR right-to-erasure and immutable audit/soft-delete (anonymization vs hard delete); retention/purge." },
  { domain: 'messaging-databases', slug: 'zero-downtime-schema-migrations', name: 'Zero-Downtime Schema Migrations & Backfills',
    xref: "See also transactions-acid-isolation-levels, database-scaling-replication-pooling, and (deployment side) devops-cicd/deployment-strategies.",
    hints: "the EXPAND/CONTRACT (parallel-change) pattern — 1) expand: add new column/table (nullable/defaulted, backward-compatible), 2) migrate: dual-write + backfill, 3) contract: switch reads, drop old — so old & new code run simultaneously during rolling deploy; why a naive ALTER can lock the table (blocking migrations) & tools that avoid it (pt-online-schema-change, gh-ost, pg online DDL, MySQL 8 instant/inplace algorithms); adding a NOT NULL / default safely (Postgres fast-default vs full rewrite); adding an index CONCURRENTLY (no table lock); BACKFILLS at scale (batched updates to avoid long transactions/replication lag/lock escalation, throttling, resumability, idempotent batches); renaming/removing columns safely (never in one step); migration ordering vs deploy; forward-compatible app code (tolerant reader)." },
  { domain: 'messaging-databases', slug: 'schema-evolution-and-registry', name: 'Serialization Formats & Schema Evolution',
    xref: "See also apache-kafka (Kafka message schemas) and stream-processing-cdc; and rest-api-design/api-versioning-and-evolution (API contract side).",
    hints: "wire formats compared — JSON (human-readable, schemaless, verbose), Protobuf (compact binary, field numbers, IDL), Avro (compact, schema travels/registry, great for data), Thrift, MessagePack; text vs binary trade-offs; SCHEMA EVOLUTION rules & COMPATIBILITY modes — BACKWARD (new schema reads old data: safe to add optional/defaulted fields, remove fields), FORWARD (old schema reads new data), FULL (both), NONE; why you must never reuse/renumber protobuf field numbers; adding/removing fields safely, defaults, enum evolution (unknown-value handling); the SCHEMA REGISTRY (Confluent/Apicurio — producers register, consumers fetch by id, enforces compatibility on register, decouples producer/consumer deploys); subject naming; who validates; contrast with REST/OpenAPI versioning." },

  // ---- rest-api-design ----
  { domain: 'rest-api-design', slug: 'file-upload-and-media-handling', name: 'File Upload, Storage & Media Delivery',
    xref: "See also http-methods-and-status-codes, request-response-design-and-content-negotiation, api-security-and-hardening (upload abuse), and system-design/caching-and-cdn (delivery).",
    hints: "upload mechanisms — multipart/form-data vs raw body vs base64-in-JSON (why base64 bloats ~33% & is wasteful); PRE-SIGNED URLs / direct-to-object-storage upload (client uploads straight to S3/GCS, bypassing the app server — offloads bandwidth, the standard pattern) vs proxying through the API; RESUMABLE / chunked uploads (tus protocol, multipart upload API) for large/flaky uploads; streaming vs buffering (don't load a 5GB file into memory); range requests (206 Partial Content) for downloads/video; content-type sniffing & validation (don't trust the extension/Content-Type — verify magic bytes), size limits, virus/malware scanning, image re-encoding to strip exploits; storing metadata in DB + blob in object storage; CDN delivery + signed URLs for private media; transcoding pipelines (async, 202 + status); upload security (path traversal, zip bombs, SSRF via URL-fetch uploads)." },
  { domain: 'rest-api-design', slug: 'graphql-schema-and-federation', name: 'GraphQL: Schema Design, Execution & Federation',
    xref: "See also rest-vs-graphql-vs-grpc (the paradigm comparison — here go DEEP on GraphQL itself), api-authentication-and-authorization, and rate-limiting-and-throttling.",
    hints: "the type system & SDL (object/scalar/enum/interface/union/input types, nullability !); queries vs mutations vs subscriptions; RESOLVERS (per-field, the execution model) & the N+1 problem -> DATALOADER (batch + cache per request); over/under-fetching solved vs REST; schema design (nullability strategy, errors-as-data vs top-level errors, pagination via Relay CONNECTIONS/cursors, global object ids, mutations returning payloads); the caching challenge (single POST endpoint, no HTTP caching -> persisted queries/APQ, response cache by query+vars); security — query DEPTH & COMPLEXITY limiting, cost analysis, disable introspection in prod, batching abuse; FEDERATION (Apollo Federation / subgraphs + @key + a gateway/router composing a supergraph, query planning) vs schema stitching vs a monolithic schema vs BFF; when GraphQL over REST." },

  // ---- security ----
  { domain: 'security', slug: 'application-cryptography-and-data-protection', name: 'Application Cryptography & Data Protection (Design)',
    xref: "See also cryptography-foundations (primitives), secrets-management-and-key-lifecycle (keys/secrets), and networking/tls-ssl-https (crypto-in-transit) — here focus on APPLYING crypto to protect data in an app.",
    hints: "the DESIGN-level application of crypto (the primitives live in cryptography-foundations — here it's how to USE them): encryption at rest vs in transit vs IN USE (confidential computing brief); ENVELOPE ENCRYPTION (a data key (DEK) encrypts data, a key-encryption-key (KEK) in a KMS/HSM wraps the DEK — enables cheap key rotation without re-encrypting data, and per-record/per-tenant DEKs); KMS vs HSM; FIELD-LEVEL / application-layer encryption (encrypt specific PII columns, not just disk); the searchable-encryption problem — deterministic (equality-searchable but leaks equality) vs randomized encryption, blind indexing/HMAC for exact-match search on encrypted data; TOKENIZATION vs encryption (replace sensitive value with a token, shrink PCI scope); key ROTATION strategy (rotate KEK cheaply; re-wrap DEKs); crypto-shredding (delete the key to 'delete' the data — GDPR erasure vs immutable stores); DATA MASKING/redaction for non-prod & logs; the erasure-vs-immutability tension." },
]

const domainDirs = {}
for (const t of TOPICS) domainDirs[t.domain] = `${REPO}/topics/${t.domain}`

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior/staff backend engineer and interview coach authoring a fold-in interview topic "${t.name}" (slug: ${t.slug}) that will live in the EXISTING "${t.domain}" domain of a learner's interview-prep library.\n\n` +
    `${COMMON}\n` +
    `CROSS-REFERENCES for THIS topic: ${t.xref}\n\n` +
    `FOCUS / frequently-asked subtopics to cover:\n${t.hints}\n\n` +
    `${SCHEMA(t.domain, t.slug)}\n\n` +
    `Write the two files now into ${REPO}/topics/${t.domain}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous reviewer verifying the fold-in interview topic "${t.name}" (slug: ${t.slug}) in the "${t.domain}" domain.\n\n` +
    `${COMMON}\n` +
    `CROSS-REFERENCES expected for THIS topic: ${t.xref}\n\n` +
    `Files: ${REPO}/topics/${t.domain}/${t.slug}/concepts.md and questions.yaml . Read BOTH. Check and FIX IN PLACE:\n` +
    `1) FACTUAL ERRORS in concepts.md or MCQ answers/explanations — web-research anything uncertain (e.g. float-is-wrong-for-money + banker's rounding + double-entry ledger; inverted index/BM25/analyzer/text-vs-keyword; expand-contract migration + CONCURRENTLY + gh-ost + fast-default; protobuf-never-reuse-field-numbers + backward/forward/full compatibility + schema registry; envelope encryption DEK/KEK + deterministic-vs-randomized + tokenization + crypto-shredding; DDD aggregate-consistency-boundary/value-object-immutability/ACL; strangler-fig/branch-by-abstraction; multi-tenancy silo/pool/bridge + tenant-isolation leak; GraphQL N+1/DataLoader/complexity-limiting/federation; pre-signed-URL upload + magic-byte validation). A wrong 'answer' index or a mischaracterized concept is the WORST defect — fix it.\n` +
    `2) SCOPE / NON-DUPLICATION: confirm the topic gives ITS focused treatment and points to the listed existing topics rather than re-teaching them.\n` +
    `3) SCHEMA: valid YAML; top-level keys topic/domain(${t.domain})/topic_slug(${t.slug})/version/questions; ids (prefix '${t.slug}-', unique, 3-digit seq); difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based 'answer' in range; explanation; correct-option position VARIED (rebalance if any index >40% OR a trivially-guessable repeating cycle). Quote any YAML option string with a colon+space or leading brace (it must not parse as a map).\n` +
    `4) Every 'ref: concepts.md#anchor' resolves to a real '## ' heading (GitHub slug rules). Any Mermaid blocks valid — no semicolons in sequenceDiagram message text.\n` +
    `5) COVERAGE: >=40 questions, every subtopic represented, mixed difficulty, scenario-style questions present. Add if thin.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
