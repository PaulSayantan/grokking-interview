export const meta = {
  name: 'rest-api-design-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 18 REST APIs & API Design topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/rest-api-design`

const SCOPE_NOTE = `
DOMAIN SCOPE — "REST APIs & API Design" is FRAMEWORK-AGNOSTIC. Teach the design
discipline and the HTTP/wire contract (the "what and why" a client actually consumes),
NOT any single framework's APIs. Concretely:
- Do NOT teach Spring/@RestController/ResponseEntity/jakarta.validation, Express, FastAPI,
  etc. Framework code belongs in the spring-boot domain, not here. Use language-neutral
  examples (raw HTTP requests/responses, JSON payloads, header exchanges, OpenAPI YAML).
- Stay at the API-CONTRACT altitude, distinct from the system-design domain (which decides
  service boundaries / gateways / distributed rate-limiter algorithms at whiteboard altitude).
  Here, gateways/rate-limiting/auth are taught as concrete request/response design decisions.
- Ground claims in the real standards: RFC 9110 (HTTP Semantics), RFC 9457 (Problem Details,
  obsoletes 7807), RFC 8288 (Web Linking), RFC 7519 (JWT), OAuth 2.0/2.1, OpenAPI 3.1,
  OWASP API Security Top 10 (2023). Verify anything version- or RFC-specific via web research.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - Interview-grade answers, LAYERED: beginner definition + why it matters -> intermediate
     trade-offs/comparisons -> advanced gotchas the interviewer probes.
   - Include concrete HTTP request/response snippets, header examples, JSON payloads, and
     comparison tables where they clarify. Framework-agnostic (see scope note).
   - End with a "## Common follow-up questions" section and a "## References" section
     (link the RFCs / OWASP / OpenAPI / authoritative docs you used).
   - Factual accuracy is critical. Cite the correct RFC numbers and current status.

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: rest-api-design
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
         ref: "concepts.md#<anchor>"   # deep-link to a concepts.md H2 (GitHub slug: lowercase, spaces->-, punctuation stripped)

   RULES:
   - Produce 40-60 questions (minimum 40). Cover EVERY subtopic with several questions each.
   - 3-5 options per question, EXACTLY ONE correct. 'answer' is 0-based.
   - VARY the correct option's position across the file (do not cluster on one index).
   - Mixed difficulty (mostly beginner/intermediate with some advanced; this is Pass 1 —
     depth/expert questions are added in a later deepening pass, so don't over-index on expert).
   - INCLUDE scenario-style questions with lengthy plausible options — e.g. "given this
     request/response or this API-design situation, which statement is correct?". Distractors
     must be plausible but wrong for a real reason.
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness.
Return a one-line summary: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'rest-fundamentals-and-constraints', name: 'REST Fundamentals & Architectural Constraints', hints: "Fielding's 6 constraints (client-server, stateless, cacheable, uniform interface, layered system, code-on-demand); what statelessness really means & why; uniform interface sub-constraints; REST vs RPC; the Richardson Maturity Model (levels 0-3) as a design lens; resource vs representation; common myth-busting (REST != JSON-over-HTTP, != CRUD)." },
  { slug: 'http-methods-and-status-codes', name: 'HTTP for APIs: Methods & Status Codes', hints: "GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS semantics per RFC 9110; SAFE vs IDEMPOTENT vs cacheable (which methods are which and why); PUT vs PATCH vs POST for updates/creates; correct status codes 2xx/3xx/4xx/5xx (200 vs 201 vs 202 vs 204; 400 vs 422; 401 vs 403; 404 vs 409; 429; 500 vs 502/503/504); Location header on 201; method-not-allowed 405 + Allow header." },
  { slug: 'resource-modeling-and-uri-design', name: 'Resource Modeling & URI Design', hints: "resources as nouns not verbs; collection vs singleton resources; sub-resources & relationships; path vs query parameters (when each); pluralization & naming conventions; hierarchy vs flat; avoiding verbs in URIs (and pragmatic exceptions/actions); identifiers (opaque ids vs slugs); trailing slashes/case; URI stability & cool URIs." },
  { slug: 'request-response-design-and-content-negotiation', name: 'Request/Response Design & Content Negotiation', hints: "DTO/payload shaping; JSON field naming conventions (camelCase vs snake_case), nulls vs omission; media types & the Accept / Content-Type headers; server-driven vs agent-driven content negotiation; Accept-Language/Charset/Encoding; vendor media types (application/vnd.*+json); partial responses / field selection (sparse fieldsets); envelope vs bare-body trade-offs; date/number formatting (ISO 8601)." },
  { slug: 'request-validation-and-data-integrity', name: 'Request Validation & Data Integrity', hints: "framework-agnostic input validation; schema/constraint validation (JSON Schema); required vs optional; syntactic vs semantic validation; sanitization vs validation; mass-assignment / over-posting control (allow-lists); where to validate (edge vs domain); 400 vs 422 for validation errors; returning field-level errors; defensive parsing; content-length/type limits." },
  { slug: 'error-handling-and-problem-details', name: 'Error Handling & Problem Details', hints: "consistent error contract; RFC 9457 (obsoletes 7807) application/problem+json (type/title/status/detail/instance + extensions); machine-readable error codes vs human messages; field-level/validation error arrays; do-not-leak internals (stack traces); mapping domain errors to status codes; idempotent error semantics; localization of messages; correlation/trace ids in errors." },
  { slug: 'api-versioning-and-evolution', name: 'API Versioning & Evolution', hints: "URI path vs query-param vs custom-header vs media-type (content negotiation) versioning — trade-offs; semantic versioning for APIs; backward vs forward compatibility; breaking vs non-breaking changes (adding fields safe, removing/renaming breaking); tolerant reader / Postel's law; deprecation policy, Sunset & Deprecation headers; version negotiation; evolving without versioning." },
  { slug: 'pagination-filtering-and-sorting', name: 'Pagination, Filtering & Sorting', hints: "offset/limit (page/size) vs cursor/keyset pagination — trade-offs (deep-paging cost, stability under writes, jumping to page N); page metadata (total counts — cost) & Link header (RFC 8288) next/prev; filtering conventions (query params, operators, RSQL/JSON filters); sorting (sort=field,-field); search; consistency under concurrent inserts/deletes; limits & defaults." },
  { slug: 'http-caching-and-conditional-requests', name: 'HTTP Caching & Conditional Requests', hints: "Cache-Control directives (max-age, no-cache, no-store, private/public, must-revalidate, s-maxage) vs legacy Expires; ETag (strong/weak) & Last-Modified; conditional GET with If-None-Match/If-Modified-Since -> 304; If-Match/If-Unmodified-Since for optimistic concurrency on writes -> 412; Vary header; freshness vs validation; CDN/shared vs private caches." },
  { slug: 'idempotency-and-reliable-delivery', name: 'Idempotency & Reliable Request Delivery', hints: "idempotency defined; which HTTP methods are idempotent and why; making POST idempotent with an Idempotency-Key header (Stripe-style); server-side dedup / stored responses; safe client retries with backoff; at-least-once delivery & duplicate handling; exactly-once as an illusion; idempotency window/TTL; distinction from safe methods; race conditions on concurrent same-key requests." },
  { slug: 'hypermedia-and-hateoas', name: 'Hypermedia & HATEOAS', hints: "HATEOAS as Richardson Level 3; hypermedia controls (links, actions); link relations & RFC 8288 Web Linking; HAL, JSON:API, Siren, JSON-LD formats; self/next/prev/related rels; pros (discoverability, loose coupling, evolvability) vs cons (complexity, few clients use it, chattiness); when it's worth it; the reality that most 'REST' APIs are Level 2." },
  { slug: 'api-documentation-openapi-swagger', name: 'API Documentation & Design-First with OpenAPI', hints: "OpenAPI Specification 3.0/3.1 (3.1 aligns with JSON Schema); Swagger tooling (UI, Codegen) vs OpenAPI the spec; design-first/contract-first vs code-first; contract-driven development & mock servers; schema components/$ref reuse; server/security/paths/operations structure; code & client generation; keeping docs in sync (spec as source of truth); examples & documentation quality." },
  { slug: 'api-authentication-and-authorization', name: 'API Authentication & Authorization Patterns', hints: "API keys (where to put them, rotation) vs OAuth2; OAuth2 flows at the API level (authorization code + PKCE, client credentials) & scopes; bearer tokens & JWT (access vs refresh, expiry, validation) — API-surface view not platform IdP internals; HMAC request signing (AWS SigV4-style); mTLS for service-to-service; session vs token for APIs; choosing an auth model; token placement (Authorization header vs cookie) & why not query string." },
  { slug: 'api-security-and-hardening', name: 'API Security & Hardening (OWASP API Top 10)', hints: "OWASP API Security Top 10 (2023): BOLA (broken object level auth / IDOR), broken authentication, BOPLA, unrestricted resource consumption, BFLA (function level auth), unrestricted access to sensitive business flows, SSRF, security misconfiguration, improper inventory mgmt, unsafe consumption of APIs; CORS misconfig & CSRF for cookie-auth APIs; security headers; input injection; not leaking data in errors/responses; TLS everywhere." },
  { slug: 'rate-limiting-and-throttling', name: 'Rate Limiting & Throttling (Client Contract)', hints: "client-facing CONTRACT (not the distributed algorithm internals): 429 Too Many Requests, Retry-After header, the draft RateLimit-Limit/Remaining/Reset headers; quotas vs rate limits vs throttling vs spike arrest; per-key/per-user/per-plan design; soft vs hard limits; client backoff & jitter expectations; documenting limits; graceful degradation; distinction from system-design's token/leaky-bucket algorithm topic." },
  { slug: 'api-gateways-and-bff', name: 'API Gateways & Backend-for-Frontend', hints: "gateway responsibilities (routing, TLS termination, authN/authZ offload, rate limiting, request/response transformation, aggregation, observability); BFF pattern (per-client backend: web vs mobile) & why; edge cross-cutting concerns; gateway vs load balancer vs reverse proxy vs service mesh (boundaries); API composition/aggregation; gateway anti-patterns (business logic in gateway)." },
  { slug: 'rest-vs-graphql-vs-grpc', name: 'REST vs GraphQL vs gRPC', hints: "over-fetching/under-fetching (GraphQL's pitch); GraphQL single endpoint, schema/typing, N+1 & query cost, caching difficulty; gRPC (HTTP/2, protobuf, streaming, strong contracts, browser limits, service-to-service); REST strengths (ubiquity, caching, simplicity); when to choose each; schema/typing & tooling comparison; streaming support; versioning approaches per paradigm." },
  { slug: 'webhooks-and-async-api-patterns', name: 'Webhooks & Async API Patterns', hints: "outbound webhooks (event delivery to subscriber URLs); delivery guarantees & retries with backoff; signing/verifying payloads (HMAC signature header) & replay protection (timestamp/nonce); idempotent webhook consumers; 202 Accepted + polling / status resource for long-running ops; callback URLs; async request-reply over HTTP; webhooks vs polling vs SSE vs WebSockets; dead-letter & observability for deliveries." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior API/backend engineer and interview coach authoring FRAMEWORK-AGNOSTIC study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous technical reviewer verifying FRAMEWORK-AGNOSTIC interview content for the "REST APIs & API Design" topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or in MCQ answers/explanations. Do web research to confirm anything uncertain, especially RFC numbers/status (RFC 9110, 9457-obsoletes-7807, 8288, 7519), OAuth 2.1, OpenAPI 3.1, and the OWASP API Security Top 10 (2023) item names. A wrong 'answer' index or misleading explanation is the worst defect — fix it.\n` +
    `2) SCOPE DRIFT: if the content teaches a specific framework's APIs (Spring, Express, etc.) instead of the language-neutral HTTP/design contract, rewrite it to be framework-agnostic.\n` +
    `3) SCHEMA violations in questions.yaml: valid YAML; top-level keys topic/domain(rest-api-design)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, 3-digit seq), difficulty in {beginner,intermediate,advanced,expert}, question, 3-5 options, 0-based 'answer' in range, explanation; ids unique; correct-option position VARIED (not all same index) — if clustered, rewrite some.\n` +
    `4) Every 'ref: concepts.md#anchor' must resolve to an actual '## ' heading in concepts.md (GitHub slug rules). Fix mismatches.\n` +
    `5) COVERAGE: at least 40 questions, every subtopic represented, mixed difficulty, some scenario-style questions present. If thin or a subtopic is uncovered, ADD questions to reach the bar.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
