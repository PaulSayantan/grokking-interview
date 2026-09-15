export const meta = {
  name: 'security-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 16 Security (App & Web) topics, then verify each for factual accuracy and schema compliance',
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
const DIR = `${REPO}/topics/security`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Security (Application & Web)" is LANGUAGE/FRAMEWORK-AGNOSTIC. Teach the
security concepts, attacks, and defenses as they actually work, NOT a specific framework's
security module (no Spring Security / Passport / Django-auth code — those belong to other
domains). Stay at the threat/mechanism altitude. Concretely:
- Framework-neutral: describe attacks and defenses conceptually with concrete wire/HTTP
  examples (headers, tokens, payloads), not one library's API.
- BOUNDARY vs already-authored domains (do NOT re-teach their view — teach the SECURITY/
  threat angle instead):
  * rest-api-design owns OAuth/JWT as an API CONTRACT and the OWASP *API* Top 10. HERE,
    teach OAuth 2.1 / OIDC / JWT at the PROTOCOL & THREAT level: grant-flow attacks,
    token theft/replay/leakage, PKCE rationale, redirect-URI attacks, JWKS, alg:none & key
    confusion, refresh-token rotation & reuse detection, sender-constrained tokens.
  * networking owns TLS on the wire and crypto-in-transit. HERE, 'cryptography-foundations'
    teaches the PRIMITIVES (symmetric/asymmetric/hashing/signatures/KDFs) and their correct
    use — do NOT re-teach the TLS handshake step-by-step.
  * The 'owasp-top-10-walkthrough' topic covers the WEB OWASP Top 10 (2021 edition) and only
    REFERENCES the API Top 10 (which rest-api-design owns) — do not duplicate the API list.
- Distinct from system-design: stay at appsec mechanism altitude, not whiteboard architecture.
- Ground EVERY claim in authoritative sources: OWASP (Top 10 2021, ASVS, Cheat Sheet Series,
  WSTG), NIST (SP 800-63B digital identity, SP 800-57 key mgmt, SP 800-38 modes), the
  relevant RFCs (OAuth 2.0 6749 / 2.1 draft, PKCE 7636, OIDC Core, JWT 7519 / JWS 7515 /
  JWA 7518 / JWE 7516, JWK 7517, HOTP 4226 / TOTP 6238, WebAuthn / FIDO2, Cookie 6265 &
  SameSite, CSP Level 3, CORS Fetch spec, bcrypt/scrypt/Argon2/PBKDF2). Verify specifics
  via web research (algorithm parameters, header syntax, current recommendations).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - Interview-grade answers, LAYERED: beginner definition + why it matters -> intermediate
     trade-offs/comparisons -> advanced attack/defense internals & gotchas the interviewer probes.
   - Include concrete examples: attack payloads, vulnerable-vs-fixed contrasts, header/token
     breakdowns, HTTP request/response snippets, comparison tables. Framework-agnostic.
   - Prefer a "vulnerable pattern -> concrete exploit -> correct defense" structure per attack.
   - End with a "## Common follow-up questions" section and a "## References" section
     (link the OWASP/NIST pages / RFCs you used).
   - Factual accuracy is critical. Cite correct RFC numbers, OWASP category IDs, NIST SP
     numbers, and current recommendations (e.g. Argon2id params, why MD5/SHA1 are broken).

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: security
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
     advanced/expert depth is added in a later deepening pass, so don't over-index on expert).
   - INCLUDE scenario-style questions with lengthy plausible options — e.g. "given this
     request / this cookie / this token / this CSP, which statement is correct?" or "which of
     these fixes the vulnerability?". Distractors must be plausible but wrong for a real reason.
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness.
Return a one-line summary: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'security-fundamentals-and-threat-modeling', name: 'Security Fundamentals, CIA Triad & Threat Modeling', hints: "CIA triad (confidentiality/integrity/availability) + AAA (authentication/authorization/accounting) + non-repudiation; defense in depth, least privilege, fail-secure, complete mediation, separation of duties, secure defaults, zero trust; attack surface & trust boundaries; threat modeling methods (STRIDE per element, DREAD critique, PASTA, attack trees); risk = likelihood x impact; vulnerability vs threat vs risk vs exploit; shift-left / secure SDLC; CVSS scoring basics." },
  { slug: 'cryptography-foundations', name: 'Cryptography Foundations: Symmetric, Asymmetric, Hashing & Signatures', hints: "symmetric (AES, block vs stream, modes ECB-why-bad/CBC/CTR/GCM, IV/nonce reuse danger, AEAD) vs asymmetric (RSA, ECC/ECDSA/EdDSA, key exchange DH/ECDH); cryptographic hashing (SHA-256/SHA-3, properties: preimage/second-preimage/collision resistance, why MD5/SHA1 broken); HMAC & MACs vs signatures; digital signatures (sign-with-private/verify-with-public, non-repudiation); KDFs vs password hashes; entropy & CSPRNG vs PRNG; encryption-at-rest vs in-transit; key sizes & NIST SP 800-57; DO NOT re-teach the TLS handshake (networking owns it) — teach the primitives & correct usage." },
  { slug: 'password-storage-and-credential-security', name: 'Password Storage & Credential Security', hints: "why never plaintext/encrypted/fast-hash; salting (per-user, unique, purpose) vs peppering; adaptive/memory-hard password hashes — Argon2id (recommended, params m/t/p), scrypt, bcrypt (72-byte limit, cost factor), PBKDF2 (iteration counts, when acceptable/FIPS); timing-safe comparison; credential stuffing vs brute force vs dictionary vs rainbow tables (why salt defeats them); breached-password checks (k-anonymity/HIBP range API); password rotation myth & NIST SP 800-63B guidance; account lockout vs throttling." },
  { slug: 'authentication-and-mfa', name: 'Authentication & Multi-Factor Authentication', hints: "authentication factors (something you know/have/are); MFA/2FA; TOTP (RFC 6238) vs HOTP (RFC 4226) mechanics & drift window; SMS OTP weaknesses (SIM swap, SS7); push-based & MFA fatigue/prompt-bombing + number matching; WebAuthn/FIDO2/passkeys (public-key, phishing-resistant, origin binding, attestation); recovery-code & fallback risks; step-up/adaptive auth; passwordless; NIST SP 800-63B AAL levels; where authN differs from authZ." },
  { slug: 'session-management-and-secure-cookies', name: 'Session Management & Secure Cookies', hints: "server-side session vs stateless token trade-offs; session ID generation (entropy, CSPRNG) & storage; cookie attributes (HttpOnly, Secure, SameSite Lax/Strict/None, Domain/Path, Max-Age/Expires, __Host-/__Secure- prefixes); session fixation (regenerate ID on login) & session hijacking; idle vs absolute timeout; logout & server-side invalidation; cookie vs localStorage for tokens (XSS exposure); concurrent sessions; RFC 6265." },
  { slug: 'authorization-and-access-control', name: 'Authorization & Access Control Models', hints: "authZ vs authN; access control models — DAC, MAC, RBAC (roles/permissions), ABAC (attributes/policy), ReBAC (Google Zanzibar); principle of least privilege & privilege escalation (horizontal vs vertical); BOLA/IDOR (object-level) vs BFLA (function-level) — enforce server-side, per-request, on every object; deny by default; centralized policy (PDP/PEP, OPA/Rego); confused deputy; TOCTOU; multi-tenancy isolation." },
  { slug: 'oauth2-and-oauth21', name: 'OAuth 2.0 / 2.1 Delegated Authorization', hints: "OAuth as DELEGATED AUTHORIZATION not authentication; roles (resource owner/client/authorization server/resource server); grant types & when — authorization code + PKCE (now default), client credentials, device code; DEPRECATED implicit & ROPC (removed in 2.1) & why; PKCE (RFC 7636) & the interception attack it stops; redirect_uri exact-match & open-redirect/mix-up attacks; state param & CSRF on the callback; access vs refresh tokens, rotation & reuse detection; scopes; token leakage via referrer/logs; teach the THREAT/protocol view (rest-api-design owns the API-contract view)." },
  { slug: 'openid-connect-and-sso', name: 'OpenID Connect & Federated SSO', hints: "OIDC as an identity layer ON TOP of OAuth 2.0; ID token (JWT) vs access token — different audiences/purposes; standard claims, nonce (replay defense) vs state, aud/iss/exp validation; UserInfo endpoint; flows (authorization code); discovery/.well-known & JWKS; SSO concepts; SAML vs OIDC contrast (assertions/XML vs JWT, XML signature wrapping attacks); IdP-initiated vs SP-initiated; logout (front/back-channel); federation trust & token audience confusion." },
  { slug: 'jwt-and-token-security', name: 'JSON Web Tokens (JWT) & Token Security', hints: "JWT structure (header.payload.signature, base64url, NOT encrypted by default — JWS vs JWE); claims (iss/sub/aud/exp/nbf/iat/jti); signing algs (HS256 symmetric vs RS256/ES256 asymmetric); CLASSIC ATTACKS — alg:none, HS/RS key-confusion (RSA public key used as HMAC secret), weak HMAC secret brute force, missing exp/aud/iss validation, kid injection (path traversal/SQLi), jku/x5u SSRF; token revocation problem (short TTL + refresh, denylist, jti); why not store sensitive data in payload; RFC 7519/7515/7518/7517; teach threat view (rest-api-design owns API-usage view)." },
  { slug: 'injection-attacks', name: 'Injection Attacks: SQL, NoSQL, Command & LDAP', hints: "root cause = mixing untrusted data with code/query; SQL injection (union/boolean-blind/time-blind/error-based, second-order, stacked queries) & the ONE correct fix: parameterized queries/prepared statements (not escaping/blocklists); ORM pitfalls; NoSQL injection (MongoDB operator injection $ne/$gt, JSON body); OS command injection & argument injection (use arg arrays, avoid shell); LDAP & XPath injection; least-privilege DB accounts & defense in depth; stored procedures nuance; why WAF is not a fix." },
  { slug: 'xss-csp-and-security-headers', name: 'Cross-Site Scripting (XSS), CSP & Security Headers', hints: "XSS types — stored/persistent, reflected, DOM-based (source->sink, no server round-trip); execution context & the real fix = context-aware output encoding (HTML/attr/JS/URL/CSS) + framework auto-escaping; input validation as defense in depth; dangerous sinks (innerHTML, document.write, eval); Trusted Types; CSP (script-src, nonce vs hash vs unsafe-inline, strict-dynamic, default-src, report-uri/report-to, why allowlist CSP fails); security headers — HSTS (+preload), X-Content-Type-Options nosniff, Referrer-Policy, X-Frame-Options vs frame-ancestors, Permissions-Policy; HttpOnly limits XSS cookie theft." },
  { slug: 'sop-cors-and-csrf', name: 'Same-Origin Policy, CORS & CSRF', hints: "Same-Origin Policy definition (scheme+host+port) & what it does/doesn't block (requests still SENT, responses blocked from JS); CORS as a controlled RELAXATION — simple vs preflighted (OPTIONS) requests, Access-Control-Allow-Origin (never reflect origin + Allow-Credentials:true), Allow-Credentials, Vary: Origin; common CORS misconfigs; CSRF mechanics (cookies auto-sent, state-changing GET/POST) & defenses — SameSite cookies, synchronizer/double-submit token, custom-header/fetch-metadata, origin/referer check; CORS does NOT prevent CSRF (common misconception); clickjacking & frame-ancestors." },
  { slug: 'ssrf-and-server-side-request-attacks', name: 'SSRF & Server-Side Request Attacks', hints: "SSRF definition (server tricked into making attacker-controlled requests); impact — cloud metadata (169.254.169.254 IMDSv1 vs IMDSv2 hop-limit/token), internal service access, port scanning, RCE pivot; blind vs in-band SSRF; bypasses — IP encodings (decimal/octal/hex/IPv6-mapped), DNS rebinding, redirect-based, URL parser confusion, allowlist bypass; defenses — allowlist destinations (not denylist), validate & re-resolve DNS, block link-local/private ranges, disable unused URL schemes (file://gopher://), egress filtering, IMDSv2; SSRF in webhooks/PDF/image fetchers/URL previews; XXE as a related vector." },
  { slug: 'rate-limiting-and-dos-defense', name: 'Rate Limiting, DoS/DDoS Defense & Abuse Prevention', hints: "DoS vs DDoS; layers — volumetric (L3/4 amplification: DNS/NTP/memcached reflection), protocol (SYN flood -> SYN cookies), application-layer L7 (slowloris, expensive-endpoint/query abuse); algorithms — token bucket, leaky bucket, fixed vs sliding window (log/counter) & burst behavior; per-key dimensioning (IP/user/API-key/tenant) & distributed counter consistency; 429 + Retry-After; abuse prevention — CAPTCHA, proof-of-work, progressive backoff, WAF, upstream CDN/scrubbing, autoscaling vs bill-shock (economic DoS); ReDoS & zip/xml bombs as algorithmic-complexity DoS; teach the abuse-defense view (rest-api-design owns the client-contract view)." },
  { slug: 'secrets-management-and-key-lifecycle', name: 'Secrets Management & Key Lifecycle', hints: "what counts as a secret; anti-patterns (hardcoded in source/git history, in env vars leaked via logs/error pages, in container images/config); secret managers (Vault, cloud KMS/Secrets Manager) & dynamic/short-lived secrets; encryption key hierarchy — envelope encryption (DEK wrapped by KEK), key rotation without re-encrypting all data; key lifecycle (generation with CSPRNG/HSM, distribution, rotation, revocation, destruction) NIST SP 800-57; secret zero / bootstrapping problem; leaked-secret detection (git scanning) & rotation-on-leak; least privilege for secret access & audit." },
  { slug: 'owasp-top-10-walkthrough', name: 'OWASP Top 10 & API Security Top 10 Walkthrough', hints: "walk the OWASP Top 10 2021 WEB list with a concrete example + defense per item: A01 Broken Access Control (BOLA/IDOR, now #1), A02 Cryptographic Failures (was Sensitive Data Exposure), A03 Injection (now includes XSS), A04 Insecure Design (new — threat modeling/secure design), A05 Security Misconfiguration, A06 Vulnerable & Outdated Components, A07 Identification & Auth Failures, A08 Software & Data Integrity Failures (insecure deserialization, CI/CD, SolarWinds-style supply chain), A09 Security Logging & Monitoring Failures, A10 SSRF (community-voted in); how the list is built (data + survey), what moved/merged since 2017; REFERENCE the API Security Top 10 2023 (rest-api-design owns the detail) — don't duplicate it." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior application-security engineer and interview coach authoring LANGUAGE/FRAMEWORK-AGNOSTIC study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous application-security reviewer verifying LANGUAGE/FRAMEWORK-AGNOSTIC interview content for the "Security (Application & Web)" topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or in MCQ answers/explanations. Do web research to confirm anything uncertain — OWASP category IDs (2021 web / 2023 API), NIST SP numbers (800-63B, 800-57, 800-38), RFC numbers/status (OAuth 6749, PKCE 7636, JWT 7519 / JWS 7515 / JWA 7518, TOTP 6238 / HOTP 4226, Cookie 6265, OIDC Core), algorithm facts (Argon2id/bcrypt-72-byte/PBKDF2, AES-GCM nonce reuse, why MD5/SHA1 are broken, alg:none & key-confusion attacks). A wrong 'answer' index or a wrong security claim (e.g. recommending escaping over parameterized queries, or claiming CORS prevents CSRF) is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT: if content teaches a specific framework's security module, or re-teaches the TLS handshake (networking owns it) or the OAuth/JWT API-contract view or the OWASP API Top 10 detail (rest-api-design owns those), refocus it on the framework-agnostic threat/mechanism view.\n` +
    `3) DANGEROUS ADVICE: ensure defenses recommended are the CORRECT current best practice (parameterized queries for injection; context-aware output encoding + CSP for XSS; Argon2id/bcrypt/scrypt for passwords; SameSite + anti-CSRF token for CSRF; allowlist + IMDSv2 for SSRF; PKCE for OAuth). Fix any outdated or insecure guidance (e.g. MD5/SHA1 for passwords, blocklist-only XSS, disabling CSP).\n` +
    `4) SCHEMA violations in questions.yaml: valid YAML; top-level keys topic/domain(security)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, 3-digit seq), difficulty in {beginner,intermediate,advanced,expert}, question, 3-5 options, 0-based 'answer' in range, explanation; ids unique; correct-option position VARIED (not all same index) — if clustered, rewrite/reorder some.\n` +
    `5) Every 'ref: concepts.md#anchor' must resolve to an actual '## ' heading in concepts.md (GitHub slug rules). Fix mismatches.\n` +
    `6) COVERAGE: at least 40 questions, every subtopic represented, mixed difficulty, some scenario-style ("which fix is correct?" / "given this request/cookie/token/CSP, what's true?") questions present. If thin or a subtopic is uncovered, ADD questions to reach the bar.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
