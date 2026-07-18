export const meta = {
  name: 'rest-api-design-deepen',
  description: 'Pass 2 for REST APIs & API Design: exhaustive research gap-analysis, then deepen concepts + append advanced/expert MCQs to 70-90 per topic, then verify — additively',
  phases: [
    { title: 'Research', detail: 'exhaustive web gap-analysis per topic: what concepts are we missing?' },
    { title: 'Deepen', detail: 'fill gaps in concepts + append advanced/expert MCQs' },
    { title: 'Verify', detail: 'fact-check, dedupe, schema-check each topic in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/rest-api-design`

const SCOPE = `
DOMAIN SCOPE — "REST APIs & API Design" is FRAMEWORK-AGNOSTIC: teach the design discipline
and the HTTP/wire contract, NOT any single framework's APIs (no Spring/Express/FastAPI code;
those belong to other domains). Stay at API-contract altitude (distinct from system-design's
whiteboard altitude). Ground every claim in the real standards (RFC 9110 HTTP semantics,
RFC 9111 caching, RFC 9112 HTTP/1.1, RFC 9457 Problem Details [obsoletes 7807], RFC 8288 Web
Linking, RFC 6570 URI Templates, RFC 3986 URIs, RFC 7519 JWT, RFC 5789 PATCH, RFC 6902/7386
JSON Patch/Merge Patch, OAuth 2.0/2.1, OpenAPI 3.1, OWASP API Security Top 10 2023).
`

// slug -> current max question seq (new questions start here); + research focus per topic.
const TOPICS = [
  { slug: 'rest-fundamentals-and-constraints', name: 'REST Fundamentals & Architectural Constraints', start: 53,
    dig: "Fielding dissertation nuance, HATEOAS as the defining constraint, statelessness edge cases (server-side session vs token, load-balancing implications), idempotence/safety at the architecture level, layered-system & code-on-demand real examples, REST vs RPC vs REST-ish, when NOT to use REST, common misconceptions senior interviewers probe." },
  { slug: 'http-methods-and-status-codes', name: 'HTTP for APIs: Methods & Status Codes', start: 61,
    dig: "subtle status distinctions (200 vs 204 vs 202; 409 vs 422 vs 400; 401 vs 403; 404 vs 410; 429; 503 + Retry-After), 307/308 vs 301/302 method preservation, conditional-request status (304/412/428), Allow/WWW-Authenticate/Accept-Post headers, TRACE/CONNECT, method override, non-idempotent retries, PATCH formats." },
  { slug: 'resource-modeling-and-uri-design', name: 'Resource Modeling & URI Design', start: 49,
    dig: "actions/controllers on resources (Google AIP custom methods, POST /resource:action), composite/compound keys, singleton vs collection edge cases, matrix params, URI templates RFC 6570, opaque vs meaningful ids, canonicalization/normalization RFC 3986, versioned URIs, i18n in URIs, relationship modeling (nesting depth), pagination-of-relationships." },
  { slug: 'request-response-design-and-content-negotiation', name: 'Request/Response Design & Content Negotiation', start: 51,
    dig: "quality values (q-weights) in Accept, vendor + versioned media types, +json/+xml structured suffixes (RFC 6839), 406 vs 415, charset/encoding negotiation, sparse fieldsets & partial responses, envelope vs bare debate, hypermedia payload shapes, big-number/precision/JSON pitfalls, streaming/NDJSON, compression (Accept-Encoding, Content-Encoding)." },
  { slug: 'request-validation-and-data-integrity', name: 'Request Validation & Data Integrity', start: 56,
    dig: "JSON Schema keywords & Draft 2020-12, semantic vs syntactic layering, mass-assignment/over-posting defenses, canonicalization/normalization attacks, duplicate keys/type coercion pitfalls, validation of nested/array/polymorphic bodies, 400 vs 422 debate, problem+json validation errors, idempotent validation, request-size/complexity limits (billion-laughs, deeply-nested JSON)." },
  { slug: 'error-handling-and-problem-details', name: 'Error Handling & Problem Details', start: 51,
    dig: "RFC 9457 fields incl. extension members & type URIs, problem+json vs custom envelopes, error taxonomies/codes, partial success & 207 Multi-Status, batch error semantics, ret/ trace/correlation ids, i18n, security (info leakage in errors), validation error arrays, gRPC/GraphQL error mapping contrast." },
  { slug: 'api-versioning-and-evolution', name: 'API Versioning & Evolution', start: 51,
    dig: "media-type/content negotiation versioning deep-dive, hypermedia to avoid versioning, evolution rules (tolerant reader, additive-only, default values), breaking-change catalog, Sunset (RFC 8594) & Deprecation headers, API lifecycle & deprecation policy, semver-for-APIs debate, GraphQL/gRPC (protobuf field numbers) versioning contrast." },
  { slug: 'pagination-filtering-and-sorting', name: 'Pagination, Filtering & Sorting', start: 47,
    dig: "keyset/cursor pagination internals (opaque cursors, tie-breakers, stable sort keys), deep-paging cost & why offset degrades, total-count cost & estimates, Link header vs envelope, bidirectional cursors, filtering DSLs (RSQL, OData $filter, JSON:API), n+1 in expansions, consistency under concurrent writes, GraphQL Relay connections contrast." },
  { slug: 'http-caching-and-conditional-requests', name: 'HTTP Caching & Conditional Requests', start: 51,
    dig: "RFC 9111 freshness model, Cache-Control full directive set (stale-while-revalidate, stale-if-error, immutable, no-cache vs no-store nuance, s-maxage, private), strong vs weak ETag generation, Vary pitfalls & cache-key explosion, 304/412/428 (require conditional), optimistic concurrency via If-Match, CDN/surrogate keys, cache invalidation strategies." },
  { slug: 'idempotency-and-reliable-delivery', name: 'Idempotency & Reliable Request Delivery', start: 51,
    dig: "IETF idempotency-key draft specifics, fingerprinting & key scope/collision, concurrent same-key race handling (409/425 Too Early), stored-response TTL & storage, at-least-once vs exactly-once illusion, dedup at gateway vs service, retries & backoff/jitter, non-idempotent method retry safety, distributed idempotency store trade-offs." },
  { slug: 'hypermedia-and-hateoas', name: 'Hypermedia & HATEOAS', start: 61,
    dig: "HAL vs JSON:API vs Siren vs JSON-LD/Hydra vs Collection+JSON detailed contrast, link relation registries (IANA) & extension rels, templated links (RFC 6570), affordances/actions, versioning-via-hypermedia, client complexity & why adoption is low, profile/curies, HATEOAS in microservices/BFF." },
  { slug: 'api-documentation-openapi-swagger', name: 'API Documentation & Design-First with OpenAPI', start: 51,
    dig: "OpenAPI 3.1 vs 3.0 (JSON Schema 2020-12 alignment, nullable removal, webhooks object), components/$ref/allOf-oneOf-anyOf/discriminator, security schemes, examples vs example, contract testing & mocking off the spec, code/client generation trade-offs, spec linting (Spectral), API-design-first governance, AsyncAPI contrast, JSON Schema dialects." },
  { slug: 'api-authentication-and-authorization', name: 'API Authentication & Authorization Patterns', start: 61,
    dig: "OAuth 2.1 changes (PKCE mandatory, implicit/password removed, exact redirect match), grant selection matrix, token introspection vs JWT self-contained, refresh-token rotation & reuse detection, sender-constrained tokens (DPoP, mTLS), scopes vs roles vs claims, API key vs OAuth trade-offs, HMAC signing (SigV4) deep-dive, key rotation, JWKS." },
  { slug: 'api-security-and-hardening', name: 'API Security & Hardening (OWASP API Top 10)', start: 57,
    dig: "each OWASP API 2023 item with a concrete attack+defense (BOLA/IDOR, broken auth, BOPLA, unrestricted resource consumption, BFLA, unrestricted sensitive business flows, SSRF, misconfig, improper inventory, unsafe consumption), CORS misconfig deep-dive, JWT attacks (alg:none, key confusion), injection at the API layer, secrets in URLs/logs, security headers." },
  { slug: 'rate-limiting-and-throttling', name: 'Rate Limiting & Throttling (Client Contract)', start: 51,
    dig: "IETF RateLimit header draft (RateLimit-Limit/Remaining/Reset/policy), 429 vs 503 semantics, Retry-After (delay vs date), quota vs rate vs concurrency vs spike-arrest, per-key/tenant/plan design, distributed-limit consistency at the contract level, client backoff+jitter expectations, graceful degradation, documenting limits, retry storms." },
  { slug: 'api-gateways-and-bff', name: 'API Gateways & Backend-for-Frontend', start: 59,
    dig: "gateway offload patterns (authN/authZ, TLS, rate limit, transform, aggregate, cache), BFF per-client trade-offs & ownership, gateway vs mesh vs LB vs reverse proxy boundaries, request collapsing/aggregation & partial failures, GraphQL federation as a BFF alternative, edge caching, gateway anti-patterns (logic in gateway), API composition consistency." },
  { slug: 'rest-vs-graphql-vs-grpc', name: 'REST vs GraphQL vs gRPC', start: 51,
    dig: "GraphQL depth (query cost/complexity limiting, persisted queries, N+1/dataloader, caching difficulty, subscriptions, federation), gRPC depth (HTTP/2 framing, 4 streaming modes, protobuf wire/field-number evolution, deadlines, grpc-web/browser limits, status codes), REST strengths, decision matrix by use case, mixing paradigms." },
  { slug: 'webhooks-and-async-api-patterns', name: 'Webhooks & Async API Patterns', start: 57,
    dig: "webhook signing (HMAC, timestamp+nonce replay defense), delivery guarantees/retries/backoff, dead-letter & redelivery, idempotent consumers, thundering-herd on fan-out, CloudEvents spec, 202+polling & status-resource patterns, async request-reply correlation, webhooks vs SSE vs WebSockets vs long-poll, subscription mgmt & verification handshakes (challenge-response)." },
]

const RULES = (t) => `
GOAL: make this topic's MCQ bank DEEPER and HARDER and fill any concept gaps — WITHOUT
removing or altering existing content. This is Pass 2; a research brief of likely-missing
concepts is provided.

${SCOPE}

STEP 1 — READ both existing files first:
  ${DIR}/${t.slug}/concepts.md
  ${DIR}/${t.slug}/questions.yaml
Understand what's already covered so you do NOT duplicate existing questions or concepts.

STEP 2 — ENRICH concepts.md (edit in place, ADDITIVE):
  - Use the RESEARCH BRIEF (provided separately) plus your own web research to add any
    MISSING high-value concepts and deepen thin subtopics (advanced internals, edge cases,
    trade-offs, failure modes, standards detail). You MAY add new "## " subsections for
    genuinely missing areas. Keep EXISTING "## " headings stable (questions ref them).
  - Framework-agnostic; cite correct RFC/spec numbers and current status.

STEP 3 — APPEND new questions to questions.yaml (do NOT rewrite existing ones):
  - Add AT LEAST 25 new questions (target total 70-90). New ids are "${t.slug}-NNN" starting
    at ${String(t.start).padStart(3, '0')}, incrementing, zero-padded 3-digit, unique.
  - Difficulty of NEW questions: heavily ADVANCED and EXPERT (~50% expert, 40% advanced,
    10% intermediate). Use 'expert' for deep standards detail, subtle distinctions, and
    senior/staff scenario/design questions.
  - DEEP-DIVE every subtopic + the newly added concepts. Prioritize scenario questions
    ("given this request/response exchange, which is correct?"), subtle-distinction, and
    multi-step reasoning with long plausible options. Distractors wrong for a real reason.
  - No "all/none of the above". Do NOT duplicate an existing question's meaning.

SCHEMA (must hold for every new question): keys id, difficulty
(beginner|intermediate|advanced|expert), tags[], question, options[3-5], answer (0-BASED,
in range), explanation, ref ("concepts.md#anchor" resolving to a real "## " heading via
GitHub slug rules — "A & B" -> "#a--b" double dash). Vary correct-option position. Keep
top-level topic/domain(rest-api-design)/topic_slug(${t.slug})/version intact.

Use Edit/Write. Return one line: "${t.slug}: +<newCount> questions (now <total>), concepts enriched: <yes/no>, gaps filled: <short list>".
`

phase('Research')
const briefs = await pipeline(
  TOPICS,
  (t) => agent(
    `You are researching the topic "${t.name}" for a FRAMEWORK-AGNOSTIC "REST APIs & API Design" interview library, to make sure Pass-2 deepening misses NOTHING.\n\n${SCOPE}\n\n` +
    `FIRST read the current material at ${DIR}/${t.slug}/concepts.md (its "## " headings show what's already covered).\n` +
    `THEN do EXHAUSTIVE web research (current API-design guides, the relevant RFCs/specs, "top API interview questions 2024/2025", OWASP, OpenAPI, cloud API style guides like Google AIP / Microsoft REST guidelines / Zalando) and produce a GAP BRIEF for this topic:\n` +
    `- MISSING concepts/subtopics not in the current concepts.md that a strong 2025 interview expects (with a one-line why each matters).\n` +
    `- THIN areas that need deeper treatment (advanced internals / edge cases / standards detail).\n` +
    `- Specific hard/senior question angles worth adding.\n` +
    `Focus hints to make sure you cover: ${t.dig}\n\n` +
    `Return a concise but COMPLETE brief (bullet lists). This brief is handed to the deepening author, so be concrete and specific (name the RFC sections, header names, attack names, spec versions).`,
    { label: `research:${t.slug}`, phase: 'Research', effort: 'high' }
  ),
  (brief, t) => agent(
    `You are a staff-level API engineer and senior interviewer deepening the interview-prep material for "${t.name}" (slug: ${t.slug}). Add the hard, high-level questions and missing concepts that separate senior candidates from juniors.\n\n` +
    `RESEARCH BRIEF (gaps + angles found for this topic — incorporate these):\n${brief}\n\n${RULES(t)}`,
    { label: `deepen:${t.slug}`, phase: 'Deepen', effort: 'high' }
  ),
  (deepenSummary, t) => agent(
    `Verify the deepened REST/API topic "${t.name}" (slug: ${t.slug}). Read ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in any concept text, MCQ answer index, or explanation — web-research anything uncertain (RFC 9110/9111/9112/9457/8288/6570/3986/7519/5789/6902/7386, OAuth 2.1, OpenAPI 3.1, OWASP API Top 10 2023). A wrong 'answer' is the worst defect.\n` +
    `2) SCOPE DRIFT: rewrite any framework-specific content to be framework-agnostic.\n` +
    `3) DUPLICATES: if a newly added question is a semantic duplicate, rewrite it to cover something new.\n` +
    `4) SCHEMA: valid YAML; unique ids all prefixed '${t.slug}-' 3-digit seq, no collisions; difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based in-range 'answer'; every 'ref' resolves to a real '## ' heading. Fix violations.\n` +
    `5) DIFFICULTY: confirm the bank now has a strong block of advanced+expert questions and reaches 70-90 total; expert-tagged ones must be genuinely hard. Re-tag/ADD if short.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return briefs.filter(Boolean)
