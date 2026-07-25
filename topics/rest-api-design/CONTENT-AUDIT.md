# rest-api-design — Content Audit

**Executive summary.** This is a strong, mature domain. Across all 20 subtopics the content is consistently intuition-first and genuinely senior/staff-grade in depth: reasoned trade-off tables, dedicated "common follow-up questions" sections, and gotcha coverage (algorithm-confusion, BOLA, null propagation, retry amplification, parser differentials) that goes well past wikipedia level. Averages bear this out — clarity **4.9/5**, depth **4.95/5** — and there is not a single *high* refine-priority file. The one axis that lags is **worked examples (3.9/5)**: the hardest quantitative, cryptographic, and multi-actor-sequence concepts are repeatedly *argued in prose* instead of *traced with numbers/bytes/wire state*. Priority breakdown: **0 high, 7 medium, 13 low**. The headline takeaways: (1) the entire refinement budget should go to adding concrete numbers-in/numbers-out and traced-sequence examples; (2) **17 of 20** files carry `needs_web_verification=true`, and two of those are likely *factual errors* worth fixing first — a fabricated "RFC 10008" for the HTTP QUERY method and the Deprecation header mislabeled as an IETF draft (it is RFC 9745); (3) several inherently visual/state-machine/topology concepts still have no diagrams; (4) a handful of the longest files have duplicated or far-apart sections that would benefit from consolidation and forward-references.

## Scorecard

Sorted high-priority first, then lowest (clarity+example+depth) total first. (No file is rated high priority; medium tier listed before low tier.)

| Subtopic | Clarity | Examples | Depth | Priority | Verdict |
|---|:--:|:--:|:--:|:--:|---|
| api-authentication-and-authorization | 4 | 3 | 5 | medium | Outstanding breadth/gotchas; needs numbers-in/out traces for PKCE hashing, JWT decode, algorithm-confusion, plus flow diagrams. |
| request-response-design-and-content-negotiation | 4 | 4 | 5 | medium | Senior, RFC-anchored; **likely-fabricated "RFC 10008" for QUERY** and unttraced q-value/Vary mechanics. |
| api-gateways-and-bff | 5 | 3 | 5 | medium | Excellent reference; hardest quantitative claims (tail-latency amplification, token bucket, retry storms) lack any arithmetic. |
| api-versioning-and-evolution | 5 | 3 | 5 | medium | Near-reference; transformation-pipeline and expand/contract taught in prose without a traced JSON walkthrough. |
| file-upload-and-media-handling | 5 | 4 | 4 | medium | Very clear; S3 multipart-ETag-as-checksum nuance is wrong, and pre-signed POST policy is cited 4x but never shown. |
| api-documentation-openapi-swagger | 5 | 4 | 5 | medium | Near-comprehensive; allOf closed-schema trap and AND-security need worked YAML; version dates to verify. |
| graphql-schema-and-federation | 5 | 4 | 5 | medium | Strong; query cost/complexity limiting never computed; subscriptions-at-scale too shallow. |
| api-security-and-hardening | 5 | 4 | 5 | low | Near-model, threat-grounded; rate-limit math, CSRF double-submit, algorithm-confusion "why" a bit compressed. |
| error-handling-and-problem-details | 5 | 4 | 5 | low | Staff-level; GraphQL null-propagation named as unique but never shown; some late redundancy. |
| http-caching-and-conditional-requests | 5 | 4 | 5 | low | Exceptionally deep; LM-factor heuristic and If-Match 412 flow want numeric traces. |
| http-methods-and-status-codes | 5 | 4 | 5 | low | RFC-9110-grounded reference; POST-retry duplicate and PUT-as-merge gotcha need a timeline/note; 429-vs-503 repeated. |
| idempotency-and-reliable-delivery | 5 | 4 | 5 | low | Senior-bar; jitter formulas and outbox pattern want a numeric/traced flow; verify API-Gateway idempotency claim. |
| pagination-filtering-and-sorting | 5 | 4 | 5 | low | Near-exemplary; cursor base64 decode and offset duplicate/skip need a concrete numbered trace. |
| rate-limiting-and-throttling | 5 | 4 | 5 | low | Outstanding; backoff-with-jitter and cost-based limiting lack numbers-in/out traces. |
| request-validation-and-data-integrity | 5 | 4 | 5 | low | Near-exemplary; idempotency retries and optimistic concurrency explained in prose, not traced. |
| resource-modeling-and-uri-design | 5 | 4 | 5 | low | Near-reference; %2F double-decode gotcha untraced; several time-sensitive facts to verify. |
| rest-fundamentals-and-constraints | 5 | 4 | 5 | low | Near-model; HAL `_links.method` example is non-standard and self-contradicts later section; LRO poll cycle untraced. |
| rest-vs-graphql-vs-grpc | 5 | 4 | 5 | low | Outstanding comparison; Protobuf wire bytes and DataLoader still abstract. |
| webhooks-and-async-api-patterns | 5 | 4 | 5 | low | Senior, RFC-grounded; HMAC signing/constant-time compare given as formulas, not traced; one stray RFC-9110 §citation. |
| hypermedia-and-hateoas | 5 | 5 | 5 | low | Unusually complete with JSON for every format; only gaps are zero diagrams for a state-machine concept and no single end-to-end traced flow. |

## Systemic issues

The value here is that the *same* few weaknesses recur across the domain. In priority order:

### 1. Worked-example gaps — the dominant, cross-cutting theme (≈18/20 files)
The refinement bar's #2 axis is the domain's weakest link and it drives the entire 3.9 example average. Nearly every file states its hardest concept in prose and stops short of a traced example. Four recurring sub-clusters:

- **Cryptographic/hashing mechanics shown only in words.** PKCE `verifier → SHA-256 → challenge` (`api-authentication-and-authorization`), JWT `header.payload.sig` → decoded claims (`api-authentication-and-authorization`), HMAC webhook signing + constant-time compare (`webhooks-and-async-api-patterns`), CSRF double-submit (`api-security-and-hardening`), SigV4 signing chain (`api-authentication-and-authorization`). The **algorithm-confusion RS256→HS256** "why" is compressed in *three* files (`api-authentication-and-authorization`, `api-security-and-hardening`, `api-gateways-and-bff`).
- **Rate-limit / backoff / jitter / cost math never traced.** Token bucket (`api-gateways-and-bff`, `api-security-and-hardening`), fixed-window 2× boundary burst (`api-security-and-hardening`), full/equal/decorrelated jitter (`idempotency-and-reliable-delivery`, `rate-limiting-and-throttling`), cost/points budgets (`rate-limiting-and-throttling`, `graphql-schema-and-federation`), tail-latency amplification `1−0.99^N` (`api-gateways-and-bff`), retry fan-out 3×3×3 (`rate-limiting-and-throttling`, `api-gateways-and-bff`).
- **Multi-actor concurrency / idempotency sequences not stepped through with two actors + real ETags/keys.** Optimistic-concurrency If-Match→412 (`http-caching-and-conditional-requests`, `request-validation-and-data-integrity`, `http-methods-and-status-codes`), idempotency-key replay/conflict timeline (`http-methods-and-status-codes`, `error-handling-and-problem-details`, `request-validation-and-data-integrity`, `idempotency-and-reliable-delivery`), transactional outbox flow (`idempotency-and-reliable-delivery`), offset duplicate/skip under concurrent inserts (`pagination-filtering-and-sorting`).
- **Encoding / wire-byte traces missing.** Protobuf tag+varint byte layout (`rest-vs-graphql-vs-grpc`), cursor base64 → JSON tuple round-trip (`pagination-filtering-and-sorting`), `%252F` double-decode traversal (`resource-modeling-and-uri-design`), version-adapter downgrade JSON at each hop (`api-versioning-and-evolution`).

### 2. Time-sensitive facts needing web verification (17/20 files flagged; 2 are likely errors)
Nearly the whole domain asserts version/date/RFC facts that drift. Two rise to probable **correctness bugs** and should be fixed first:
- **`request-response-design-and-content-negotiation`: "the HTTP QUERY method (RFC 10008, 2026)"** — QUERY is an IETF draft (`draft-ietf-httpbis-safe-method-w-body`); "RFC 10008" appears invented. (high severity)
- **`api-gateways-and-bff`: Deprecation header labeled "IETF draft"** — published as **RFC 9745 (2025)**.

Other claims to confirm/correct on a web pass: S3 multipart **ETag treated as a content hash** (`file-upload-and-media-handling`, wrong for multipart — it is a hash-of-part-hashes with `-N`); **"AWS API Gateway has native idempotency support"** (`idempotency-and-reliable-delivery`, likely false — it's Lambda Powertools/service-level); OpenAPI 3.2.0/3.1.x/Arazzo version dates (`api-documentation-openapi-swagger`); IANA problem-types registry contents (`error-handling-and-problem-details`); heuristically-cacheable status-code list + RFC 9213 precedence (`http-caching-and-conditional-requests`); stray RFC 9110 §15.3.4 "203" citation for a 202 topic (`webhooks-and-async-api-patterns`); QUERY-method status, Google anti-UUID reversal, RFC 9727 date, URL-length caps (`resource-modeling-and-uri-design`); RateLimit draft revision/field syntax (multiple files).

### 3. Missing diagrams for inherently visual / state-machine / topology concepts (≈8 files)
Repo already uses mermaid, so these are cheap wins: multi-actor OAuth/PKCE/token-exchange/device flows (`api-authentication-and-authorization`), links-vs-callbacks-vs-webhooks-vs-AsyncAPI traffic direction (`api-documentation-openapi-swagger`), edge topology client→WAF→gateway→mesh→service, north-south vs east-west (`api-gateways-and-bff`), the **order-lifecycle state machine** (flagged as the single concept a picture teaches best — `hypermedia-and-hateoas`), status-code decision tree + If-Match sequence (`http-methods-and-status-codes`), validation-path-per-hop + parser-differential (`request-validation-and-data-integrity`), retry fan-out (`rate-limiting-and-throttling`).

### 4. Length / redundancy / split-section navigation (≈9 files)
Several of the longest files repeat a point across sections or split a topic far apart, costing re-reads: mTLS + OAuth 2.1 duplicated (`api-authentication-and-authorization`, ~1100 lines); 429-vs-503 + Idempotency-Key explained ~3× (`http-methods-and-status-codes`); 409/412 + Retry-After across multiple sections (`error-handling-and-problem-details`); "remaining is best-effort" stated 3× (`rate-limiting-and-throttling`); Content-Encoding-vs-Transfer-Encoding in 3 places across 24 H2s (`request-response-design-and-content-negotiation`); canonical-URI principle across 4 sections (`resource-modeling-and-uri-design`); CURIEs/JSON:API split (`hypermedia-and-hateoas`); "425 acceptable" stated 500 lines before it's corrected as spec-wrong (`idempotency-and-reliable-delivery`); Accept-param note twice (`api-documentation-openapi-swagger`). Fix pattern: keep one canonical spot, replace the rest with one-line forward-references, and add a short "how to read this file" orientation line to the longest ones.

### 5. Dense jargon / buried intuition on specific hard concepts (smaller cluster)
DPoP fires a burst of undefined tokens (htm/htu/ath/jti/cnf.jkt) before the "why" (`api-authentication-and-authorization`, `api-security-and-hardening`); APQ handshake mechanics skipped (`graphql-schema-and-federation`); weak-vs-strong comparator intuition unstated (`http-caching-and-conditional-requests`); equivalence-ladder payoff abstract (`resource-modeling-and-uri-design`). Lead these with a one-line analogy and inline definitions.

## High-priority subtopics

No subtopic is rated **high** `refine_priority` — the domain is healthy. However, **five medium-priority files carry high-severity individual issues**; these are the highest-leverage fixes and should be treated as the "must-fix" set.

### api-authentication-and-authorization (clarity 4, ex 3, depth 5)
1. **[high] PKCE verifier→challenge is words-only** (`## Authorization Code flow with PKCE`). The single most security-critical transform is never shown; the `code_challenge`/`code_verifier` placeholder strings in the snippets are unrelated. Fix: add a real pair where `code_challenge = base64url(SHA256(verifier))`, make the two snippet values actually match, and state the AS recomputes and compares at `/token`.
2. **[med] Algorithm-confusion RS256→HS256** — add a 3-step trace (server publishes public key → attacker signs with public key as HMAC secret, `alg=HS256` → naive `verify()` loads the public key as the HMAC key and matches), then tie to alg allow-listing.
3. **[med] JWT decode not shown** — show base64url-decoding `header.payload` to plaintext claims to make "JWT ≠ encrypted" visceral.
4. **[med] Multi-actor flows are prose-only** — add mermaid sequence diagrams for at least auth-code+PKCE and the token-exchange chain (audience/scope narrowing per hop).
5. **[med] Jargon burst + length/duplication** — lead DPoP with an analogy + inline "JWK thumbprint" definition; de-duplicate mTLS / OAuth 2.1 and add forward-references.

### request-response-design-and-content-negotiation (clarity 4, ex 4, depth 5)
1. **[high, correctness] "RFC 10008, 2026" for the QUERY method** — almost certainly fabricated; QUERY is an IETF draft. Relabel as an emerging draft, drop the RFC number, keep the "fall back to POST" caveat. **Web-verify.**
2. **[med] q-value negotiation untraced** — add a worked resolution (concrete Accept header + server's producible set → score each candidate, apply `q=0` rejection and specificity tie-breaks → name the winner).
3. **[med] Vary cache-key mechanics untraced** — show two requests producing two distinct keyed entries, then what breaks if a varying header is omitted from `Vary`.
4. **[low] DTO mapping counterargument + long-file navigation** — acknowledge mapping boilerplate/cost mitigations; add an orientation line and consolidate the Content-Encoding-vs-Transfer-Encoding restatements.

### api-gateways-and-bff (clarity 5, ex 3, depth 5)
1. **[high] Tail-latency amplification is prose-only** — add the arithmetic: N=10 backends each slow 1% of the time → `1 − 0.99^10 ≈ 9.6%`; contrast N=1/10/50 so amplification is visceral.
2. **[med] Token bucket never traced** — capacity 100, refill 10/s: burst 100 (all pass), 101st → 429, after 3s idle 30 tokens available; tie to AWS burst-vs-rate naming.
3. **[med] Retry storms / stacked timeouts** — add a retry-storm multiplier example and a stacked-timeout budget example (inner deadlines < outer).
4. **[med, correctness] Deprecation header labeled "IETF draft"** — cite **RFC 9745**; re-verify the RateLimit draft revision.
5. **[low] Partial-failure critical-vs-optional rule + topology diagram.**

### api-versioning-and-evolution (clarity 5, ex 3, depth 5)
1. **[high] Transformation/version-adapter pipeline is abstract** — add a traced example (e.g. v2→v3 split `name` into first/last; show the declarative downgrade module and the JSON at each hop v4→v3→v2).
2. **[med] Expand/contract has no wire timeline** — add a phase-by-phase JSON sequence for a `name → fullName` rename (dual-write/dual-read overlap window).
3. **[low] Decode the `Deprecation:` Unix timestamp inline**; add the "latest-by-default acceptable for internal-only" trade-off. **Web-verify version facts.**

### graphql-schema-and-federation (clarity 5, ex 4, depth 5) — the only high-severity file with `needs_web_verification=false`
1. **[high] Query cost/complexity limiting never computed** — add a worked cost calc on a concrete nested query (`posts(first:10){comments(first:20){author{name}}}`), sum it, compare to a budget, show the bucket deduction.
2. **[med] Subscriptions-at-scale too shallow** — add fan-out / pub-sub backplane / connection-affinity / stateful-tier trade-offs.
3. **[med] `@requires`/`@provides` bare-bullet** — add the canonical Shipping-needs-Product.weight `@requires` SDL snippet.
4. **[low] APQ handshake + DataLoader same-tick batching gotcha.**

## Refinement plan

Recommended order of attack (highest leverage first):

1. **Fix the two probable factual errors first** (fast, protects credibility): the fabricated **"RFC 10008"** in `request-response-design-and-content-negotiation` and the **Deprecation-header "draft" → RFC 9745** in `api-gateways-and-bff`. While there, correct the **S3 multipart-ETag-as-checksum** nuance in `file-upload-and-media-handling` and the **"API Gateway native idempotency"** claim in `idempotency-and-reliable-delivery`.
2. **Clear the 5 high-severity worked-example gaps** in the medium-priority files, in this order: `api-authentication-and-authorization` (PKCE), `api-gateways-and-bff` (tail-latency arithmetic), `api-versioning-and-evolution` (transformation pipeline), `graphql-schema-and-federation` (cost calc), and the QUERY relabel already covered in step 1 for `request-response-design-and-content-negotiation`.
3. **Finish the medium tier**: remaining example gaps in `file-upload-and-media-handling` (pre-signed POST policy) and `api-documentation-openapi-swagger` (allOf closed-schema + AND-security YAML).
4. **Sweep the low tier for the recurring worked-example clusters** (rate-limit/jitter math, two-actor concurrency/idempotency traces, encoding/byte traces) — batch by cluster rather than by file so the traces stay consistent in style.
5. **Add the missing diagrams** (batch pass): hypermedia state machine, auth flow sequences, gateway topology, retry fan-out, validation path, status-code decision tree.
6. **Consolidation pass** on the longest files (`api-authentication-and-authorization`, `http-methods-and-status-codes`, `request-response-design-and-content-negotiation`, `resource-modeling-and-uri-design`, `rate-limiting-and-throttling`, `error-handling-and-problem-details`): de-duplicate, add forward-references and short orientation lines.

**Web-verification required (`needs_web_verification=true`) — 17 of 20 files:** api-authentication-and-authorization, api-documentation-openapi-swagger, api-gateways-and-bff, api-security-and-hardening, api-versioning-and-evolution, error-handling-and-problem-details, file-upload-and-media-handling, http-caching-and-conditional-requests, hypermedia-and-hateoas, idempotency-and-reliable-delivery, pagination-filtering-and-sorting, rate-limiting-and-throttling, request-response-design-and-content-negotiation, request-validation-and-data-integrity, resource-modeling-and-uri-design, rest-vs-graphql-vs-grpc, webhooks-and-async-api-patterns. **Not flagged (`false`):** graphql-schema-and-federation, http-methods-and-status-codes, rest-fundamentals-and-constraints.

**Missing/unreadable audit files:** 0 (all 20 read successfully).
