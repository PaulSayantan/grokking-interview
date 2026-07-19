export const meta = {
  name: 'security-deepen',
  description: 'Pass 2 for Security (App & Web): exhaustive research gap-analysis, then deepen concepts + append advanced/expert MCQs to 70-90 per topic, then verify — additively',
  phases: [
    { title: 'Research', detail: 'exhaustive web gap-analysis per topic: what appsec concepts/attacks are we missing?' },
    { title: 'Deepen', detail: 'fill gaps in concepts + append advanced/expert MCQs' },
    { title: 'Verify', detail: 'fact-check defenses, dedupe, schema-check each topic in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/security`

const SCOPE = `
DOMAIN SCOPE — "Security (Application & Web)" is LANGUAGE/FRAMEWORK-AGNOSTIC. Teach security
concepts, attacks, and defenses as they actually work, NOT a specific framework's security
module (no Spring Security / Passport / Django-auth code). Stay at the threat/mechanism altitude.
- BOUNDARY vs already-authored domains (teach the SECURITY/threat angle, do NOT re-teach their view):
  * rest-api-design owns OAuth/JWT as an API CONTRACT and the OWASP *API* Top 10. HERE, teach
    OAuth 2.1 / OIDC / JWT at the PROTOCOL & THREAT level (grant-flow attacks, token theft/
    replay/leakage, PKCE rationale, redirect-URI/mix-up attacks, JWKS, alg:none & key confusion,
    refresh rotation & reuse detection, sender-constrained tokens DPoP/mTLS).
  * networking owns TLS on the wire. HERE, 'cryptography-foundations' teaches the PRIMITIVES and
    their correct use — do NOT re-teach the TLS handshake step-by-step.
  * 'owasp-top-10-walkthrough' covers the WEB OWASP Top 10 (2021) and only REFERENCES the API
    Top 10 (rest-api-design owns it) — do not duplicate the API list.
- Distinct from system-design: stay at appsec mechanism altitude, not whiteboard architecture.
- Ground EVERY claim in authoritative sources: OWASP (Top 10 2021, ASVS, Cheat Sheet Series,
  WSTG), NIST (SP 800-63B, 800-57, 800-38, 800-207, 800-218 SSDF), the relevant RFCs (OAuth
  6749 / 2.1 draft, PKCE 7636, DPoP 9449, OIDC Core, JWT 7519 / JWS 7515 / JWA 7518 / JWE 7516 /
  JWK 7517, HOTP 4226 / TOTP 6238, WebAuthn L2/L3 & FIDO2 CTAP2, Cookie 6265bis & SameSite,
  CSP Level 3, CORS Fetch spec, bcrypt/scrypt 7914/Argon2 9106/PBKDF2). Verify specifics (algorithm
  params, header syntax, attack names/CVEs, current recommendations) via web research.
`

// slug -> current max question seq (new questions start at start); + research focus per topic.
const TOPICS = [
  { slug: 'security-fundamentals-and-threat-modeling', name: 'Security Fundamentals, CIA Triad & Threat Modeling', start: 55,
    dig: "STRIDE-per-element vs STRIDE-per-interaction, LINDDUN (privacy threat modeling), attack trees & kill chains (Lockheed/MITRE ATT&CK, Diamond model), PASTA 7 stages, threat-modeling-as-code & the 4-question framework (Shostack), trust boundaries & data-flow diagrams, DREAD critique & why deprecated, risk quantification (FAIR, ALE=SLE×ARO), CVSS v3.1 vs v4.0 metric groups, security principles depth (Saltzer-Schroeder 8), assurance vs security, supply-chain/SBOM threat surface, zero-trust (NIST SP 800-207) vs perimeter." },
  { slug: 'cryptography-foundations', name: 'Cryptography Foundations: Symmetric, Asymmetric, Hashing & Signatures', start: 53,
    dig: "AEAD internals (GCM GHASH, nonce-reuse forbidden-attack recovering H, AES-GCM-SIV nonce-misuse-resistance RFC 8452, ChaCha20-Poly1305 8439), CBC padding-oracle & MAC-then-encrypt vs encrypt-then-MAC, RSA padding (PKCS#1v1.5 Bleichenbacher vs OAEP/PSS), ECDSA nonce reuse private-key recovery (PS3/Sony) & deterministic k RFC 6979, EdDSA/Ed25519 8032, DH small-subgroup/invalid-curve, KDF vs PRF vs password-hash (HKDF 5869 extract-expand), key sizes & 128-bit security equivalences (SP 800-57), post-quantum (Shor vs Grover, ML-KEM/ML-DSA FIPS 203/204), timing/side-channel & constant-time, entropy/CSPRNG failures." },
  { slug: 'password-storage-and-credential-security', name: 'Password Storage & Credential Security', start: 51,
    dig: "Argon2id RFC 9106 param tuning (memory/time/parallelism trade-offs, OWASP m=19MiB/t=2/p=1), bcrypt 72-byte truncation + null-byte + password-shucking attack & the HMAC-SHA-384 pre-hash fix, scrypt N/r/p memory-hardness & PBKDF2 FIPS-only + iteration floors, peppering as keyed-HMAC/HSM vs pepper-in-DB, pwhash migration/upgrade-on-login & layered rehashing, breached-password screening (HIBP k-anonymity range), NIST SP 800-63B (no composition rules, no rotation, 8-64 length, blocklist), credential stuffing defense stack (device fingerprint, MFA, CAPTCHA, IP intel), timing-safe compare, secret-vs-password distinction." },
  { slug: 'authentication-and-mfa', name: 'Authentication & Multi-Factor Authentication', start: 49,
    dig: "WebAuthn/FIDO2 depth (CTAP2, attestation formats packed/none/tpm, RP ID & origin binding, resident/discoverable creds, user verification vs presence, syncable passkeys vs device-bound, credential-exclusion, signCount clone detection), AiTM/reverse-proxy phishing (Evilginx) defeating TOTP/push but not WebAuthn, TOTP drift window/rate-limit/replay (RFC 6238), SIM-swap & SS7 & why SMS is RESTRICTED, MFA fatigue + number-matching, magic links & OTP delivery risks, step-up/adaptive/risk-based auth, NIST AAL1/2/3 requirements, account recovery as the weakest link, enumeration via timing/response differences." },
  { slug: 'session-management-and-secure-cookies', name: 'Session Management & Secure Cookies', start: 49,
    dig: "cookie prefixes __Host-/__Secure- exact rules, SameSite Lax-by-default & the 2-min Lax+POST intervention & None-requires-Secure, cookie tossing/domain-scoping & subdomain trust, session fixation full flow + regenerate-on-privilege-change, session puzzling, JWT-as-session revocation problem (sliding vs absolute, denylist, refresh rotation), idle vs absolute timeout & re-auth for sensitive ops, secure logout & back-channel invalidation, session-in-localStorage XSS exfil vs HttpOnly cookie CSRF trade-off, cookie bomb DoS, RFC 6265bis changes." },
  { slug: 'authorization-and-access-control', name: 'Authorization & Access Control Models', start: 56,
    dig: "ReBAC/Google Zanzibar (relation tuples, usersets, consistency/zookies), ABAC policy (XACML PDP/PEP/PIP/PAP, OPA/Rego), RBAC role explosion & hierarchies & separation-of-duties/static-vs-dynamic, BOLA/IDOR vs BFLA server-side per-object enforcement patterns, mass-assignment/BOPLA property-level authZ, confused deputy & capability-vs-ACL, TOCTOU in authZ, JWT-scope-vs-server-authZ pitfall, multi-tenant isolation (row-level security, tenant-id enforcement), privilege escalation chains, deny-by-default & fail-closed, centralized policy vs scattered checks, delegation/impersonation audit." },
  { slug: 'oauth2-and-oauth21', name: 'OAuth 2.0 / 2.1 Delegated Authorization', start: 51,
    dig: "OAuth 2.1 consolidation (PKCE mandatory for all clients, implicit & ROPC removed, exact redirect-URI match, refresh rotation), PKCE S256 vs plain & the authorization-code interception it stops, mix-up attack (iss param RFC 9207), CSRF via state, authorization-code injection, redirect-uri open-redirect & path/param tricks, DPoP (RFC 9449) & mTLS sender-constrained tokens vs bearer theft, token leakage (Referer, logs, browser history, mix with fragment), PAR (RFC 9126) & JAR/JARM, device-code phishing, client authentication methods, token introspection vs JWT, scope-downscoping, refresh-token reuse detection & family revocation." },
  { slug: 'openid-connect-and-sso', name: 'OpenID Connect & Federated SSO', start: 51,
    dig: "ID-token validation full checklist (iss/aud/exp/iat/nonce/azp, sig via JWKS, at_hash/c_hash), nonce vs state distinct purposes, hybrid flow token substitution, IdP mix-up, SAML XML signature wrapping (XSW) attacks & why XML canonicalization is hard, SAML vs OIDC assertion contrast, audience confusion / token passing the wrong RS, front-channel vs back-channel logout & single-logout fragility, session management spec, discovery/.well-known tampering, PPID/pairwise subject identifiers & privacy, token exchange (RFC 8693), federation trust establishment, 'sign in with' account-takeover via email-not-verified." },
  { slug: 'jwt-and-token-security', name: 'JSON Web Tokens (JWT) & Token Security', start: 47,
    dig: "alg confusion HS/RS full mechanics (RSA public key as HMAC key) & the fix (algorithm allowlist, key-by-kid-and-type), alg:none / empty-sig, kid injection (path traversal, SQLi, command), jku/x5u/x5c header SSRF & key-injection, weak-HMAC-secret cracking (jwt_tool/hashcat), JWE vs JWS (RFC 7516 vs 7515) & when to encrypt claims, critical claim validation (exp/nbf/iat clock-skew, aud/iss binding, jti replay), embedded-JWK (jwk header) trust, psychic-signatures (CVE-2022-21449 ECDSA null sig), token-sidejacking & the fingerprint-hash cookie pattern, revocation (short TTL + refresh + denylist), nested JWT, why NOT to store PII/secrets in payload." },
  { slug: 'injection-attacks', name: 'Injection Attacks: SQL, NoSQL, Command & LDAP', start: 55,
    dig: "second-order/stored SQLi, blind boolean vs time-based vs out-of-band (DNS exfil) extraction, WAF/filter bypasses (comments, case, encoding, alternate syntax) & why blocklists fail, parameterized-query edge cases (dynamic table/column names, ORDER BY, IN-lists, LIKE wildcards) & allowlist for identifiers, ORM injection (HQL/JPQL, raw fragments), stored-procedure dynamic SQL still-injectable, NoSQL operator & where-clause JS injection (Mongo $where), OS command injection arg-array vs shell & argument injection (--flag), LDAP/XPath/SSTI/expression-language injection, header/CRLF/log injection & log4shell-style JNDI, least-privilege DB + prepared-statement defense-in-depth." },
  { slug: 'xss-csp-and-security-headers', name: 'Cross-Site Scripting (XSS), CSP & Security Headers', start: 55,
    dig: "DOM XSS source→sink taxonomy & DOM Clobbering, mutation XSS (mXSS) & innerHTML re-parsing, contextual output encoding per context (HTML/attr/JS-string/JSON/URL/CSS) & the JS-context escaping pitfalls, sanitizer bypasses & DOMPurify config, Trusted Types (require-trusted-types-for) enforcement, CSP strict-dynamic + nonce vs hash & why allowlists are bypassable (JSONP/AngularJS gadgets, base-uri, object-src), CSP bypass via dangling markup & script gadgets, report-to/Reporting-API, HSTS preload & max-age, X-Content-Type-Options/Referrer-Policy/COOP/COEP/CORP/Permissions-Policy, self-XSS & content-sniffing." },
  { slug: 'sop-cors-and-csrf', name: 'Same-Origin Policy, CORS & CSRF', start: 51,
    dig: "SOP boundaries (document.domain deprecation, cross-origin iframe/window messaging via postMessage & origin-check pitfalls), CORS deep (preflight cache Access-Control-Max-Age, wildcard + credentials forbidden, Vary:Origin cache poisoning, reflecting Origin misconfig, null-origin from sandboxed iframe/redirect), CORS is NOT a CSRF defense & does NOT restrict what the server receives, CSRF defense depth (SameSite Lax gaps for top-level GET & the sub-request nuance, double-submit vs synchronizer token, per-request vs per-session tokens, custom-header + fetch metadata Sec-Fetch-*), login/logout CSRF, clickjacking frame-ancestors vs X-Frame-Options & UI redressing, CSWSH (cross-site WebSocket hijacking)." },
  { slug: 'ssrf-and-server-side-request-attacks', name: 'SSRF & Server-Side Request Attacks', start: 51,
    dig: "cloud metadata specifics (AWS IMDSv1 vs IMDSv2 token+hop-limit, GCP Metadata-Flavor header, Azure IMDS), DNS rebinding (TOCTOU between validation & fetch) & the re-resolve/pin defense, IP encoding bypasses (decimal/octal/hex/mixed, IPv6 ::ffff:, [::], enclosed-alphanumeric), URL-parser confusion (RFC 3986 vs WHATWG, userinfo @ tricks, fragment), redirect-based SSRF & following-redirects to internal, scheme abuse (file/gopher/dict/ftp), allowlist-not-denylist + egress firewall + block link-local/RFC1918/CGNAT, blind SSRF detection via OAST, XXE as SSRF vector & billion-laughs, SSRF in PDF/image/thumbnail/webhook/URL-preview/proxy features, gopher-to-RCE (Redis/FastCGI)." },
  { slug: 'rate-limiting-and-dos-defense', name: 'Rate Limiting, DoS/DDoS Defense & Abuse Prevention', start: 49,
    dig: "algorithm internals & trade-offs (token vs leaky bucket burst behavior, fixed-window boundary-burst 2x problem, sliding-window-log memory vs sliding-window-counter approximation, GCRA), distributed rate limiting (Redis atomic INCR/Lua, cell-rate, sync lag & overcounting, local+global tiers), L7 attacks (slowloris/slow-read/RUDY, HTTP/2 Rapid Reset CVE-2023-44487, hash-flooding, cache-busting), algorithmic-complexity DoS (ReDoS catastrophic backtracking, zip/XML bombs, JSON/decompression bombs), reflection/amplification factors (DNS/NTP/memcached/CLDAP), SYN flood→SYN cookies, economic/wallet DoS on autoscale/serverless, defense layers (CDN/scrubbing, Anycast, WAF, proof-of-work, adaptive concurrency/load-shedding), 429 vs 503 + Retry-After." },
  { slug: 'secrets-management-and-key-lifecycle', name: 'Secrets Management & Key Lifecycle', start: 53,
    dig: "envelope encryption depth (DEK/KEK hierarchy, KMS GenerateDataKey, key rotation without re-encrypting data via KEK rotation, crypto-shredding by deleting DEK), key lifecycle NIST SP 800-57 (generation/distribution/storage/rotation/revocation/destruction/archival, crypto-periods), HSM & FIPS 140-2/3 levels & KMS custom key stores, dynamic/short-lived secrets & leasing (Vault), secret-zero/bootstrapping (instance identity, SPIFFE/SPIRE, cloud IAM roles vs static keys), secret sprawl & git-history leakage + scanning (trufflehog/gitleaks) + rotation-on-leak, secrets in env vars/args/logs/core-dumps/container layers/CI, BYOK/HYOK, key separation by purpose, break-glass & audit, secret injection (file vs env vs API)." },
  { slug: 'owasp-top-10-walkthrough', name: 'OWASP Top 10 & API Security Top 10 Walkthrough', start: 53,
    dig: "per-category deeper: A01 access-control patterns (deny-by-default, IDOR at scale), A02 crypto-failure specifics (weak modes, hardcoded keys, missing HSTS/TLS), A03 injection breadth incl. XSS mapping, A04 Insecure Design (threat modeling, secure design patterns, misuse cases, guardrails vs bugs), A05 misconfig (default creds, verbose errors, cloud storage, headers), A06 vulnerable components (SCA, transitive deps, SBOM, known-CVE), A07 auth failures (session/credential), A08 software+data integrity (insecure deserialization gadget chains, CI/CD & SolarWinds/Codecov, unsigned updates, SLSA), A09 logging/monitoring (what to log, tamper-proofing, detection), A10 SSRF; how the list is built (8 from data + 2 survey), 2017→2021 moves/merges; REFERENCE (do not duplicate) the API Top 10 2023 which rest-api-design owns; ASVS levels & how to use the list in interviews." },
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
    MISSING high-value concepts and deepen thin subtopics (advanced attack/defense internals,
    concrete exploit steps, edge cases, real CVEs/incidents, standards detail). You MAY add
    new "## " subsections for genuinely missing areas. Keep EXISTING "## " headings stable
    (questions ref them). Keep "## Common follow-up questions" and "## References" last.
  - Framework-agnostic; cite correct OWASP category IDs, NIST SP numbers, RFC numbers, and
    CURRENT best-practice defenses (never recommend an outdated/insecure fix).

STEP 3 — APPEND new questions to questions.yaml (do NOT rewrite existing ones):
  - Add AT LEAST 25 new questions (target total 70-90). New ids are "${t.slug}-NNN" starting
    at ${String(t.start).padStart(3, '0')}, incrementing, zero-padded 3-digit, unique.
  - Difficulty of NEW questions: heavily ADVANCED and EXPERT (~50% expert, 40% advanced,
    10% intermediate). Use 'expert' for deep standards detail, subtle attack/defense
    distinctions, and senior/staff scenario questions.
  - DEEP-DIVE every subtopic + the newly added concepts. Prioritize scenario questions
    ("given this request/cookie/token/CSP/policy, which is correct?" / "which fix actually
    closes the vulnerability?"), subtle-distinction, and multi-step reasoning with long
    plausible options. Distractors must be wrong for a real, specific reason (a plausible-but-
    insecure fix is a great distractor). Never let a dangerous/insecure option be the key.
  - No "all/none of the above". Do NOT duplicate an existing question's meaning.

SCHEMA (must hold for every new question): keys id, difficulty
(beginner|intermediate|advanced|expert), tags[], question, options[3-5], answer (0-BASED,
in range), explanation, ref ("concepts.md#anchor" resolving to a real "## " heading via
GitHub slug rules — lowercase, spaces->-, punctuation stripped, "A & B" -> "#a--b" double
dash). VARY correct-option position (do NOT cluster on one index; aim for a roughly even
spread across 0..n-1). Keep top-level topic/domain(security)/topic_slug(${t.slug})/version intact.

Use Edit/Write. Return one line: "${t.slug}: +<newCount> questions (now <total>), concepts enriched: <yes/no>, gaps filled: <short list>".
`

phase('Research')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are researching the topic "${t.name}" for a LANGUAGE/FRAMEWORK-AGNOSTIC "Security (Application & Web)" interview library, to make sure Pass-2 deepening misses NOTHING.\n\n${SCOPE}\n\n` +
    `FIRST read the current material at ${DIR}/${t.slug}/concepts.md (its "## " headings show what's already covered).\n` +
    `THEN do EXHAUSTIVE web research (OWASP Cheat Sheets/ASVS/WSTG/Top 10, NIST SPs, the relevant RFCs, PortSwigger Web Security Academy, "senior/staff application-security interview questions 2024/2025", recent CVEs & attack write-ups) and produce a GAP BRIEF for this topic:\n` +
    `- MISSING concepts/attacks/defenses not in the current concepts.md that a strong 2025 senior appsec interview expects (with a one-line why each matters).\n` +
    `- THIN areas that need deeper treatment (advanced attack internals / concrete exploit steps / defense edge cases / standards detail).\n` +
    `- Specific hard/senior question angles worth adding (scenario / "which fix is correct" / CVE-based framings).\n` +
    `Focus hints to make sure you cover: ${t.dig}\n\n` +
    `Return a concise but COMPLETE brief (bullet lists). This brief is handed to the deepening author, so be concrete and specific (name the OWASP category, NIST SP, RFC section, header/param name, attack/CVE name, algorithm params).`,
    { label: `research:${t.slug}`, phase: 'Research', effort: 'high' }
  ),
  (brief, t) => agent(
    `You are a staff-level application-security engineer and senior interviewer deepening the interview-prep material for "${t.name}" (slug: ${t.slug}). Add the hard, real-world attack/defense questions and missing concepts that separate senior candidates from juniors.\n\n` +
    `RESEARCH BRIEF (gaps + angles found for this topic — incorporate these):\n${brief}\n\n${RULES(t)}`,
    { label: `deepen:${t.slug}`, phase: 'Deepen', effort: 'high' }
  ),
  (deepenSummary, t) => agent(
    `Verify the deepened Security topic "${t.name}" (slug: ${t.slug}). Read ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL errors in any concept text, MCQ answer index, or explanation — web-research anything uncertain (OWASP category IDs 2021 web / 2023 API, NIST SP 800-63B/57/38/207, RFC numbers/status: OAuth 6749/PKCE 7636/DPoP 9449, JWT 7519/JWS 7515/JWA 7518/JWE 7516, TOTP 6238/HOTP 4226, Cookie 6265, OIDC Core, HKDF 5869, Argon2 9106/scrypt 7914; algorithm params, attack/CVE names). A wrong 'answer' index or a wrong security claim is the WORST defect — fix it.\n` +
    `2) DANGEROUS ADVICE: ensure no question's correct answer or concept text recommends an insecure/outdated fix (e.g. escaping over parameterized queries, MD5/SHA1 for passwords, blocklist-only XSS, "CORS prevents CSRF", disabling CSP, alg allowlist missing). A plausible-but-insecure option must be a DISTRACTOR, never the key. Fix any such error.\n` +
    `3) SCOPE DRIFT: refocus any framework-specific content, TLS-handshake re-teaching (networking owns it), OAuth/JWT API-contract view or OWASP API Top 10 detail (rest-api-design owns those) onto the framework-agnostic threat/mechanism view.\n` +
    `4) DUPLICATES: if a newly added question is a semantic duplicate of an existing one, rewrite it to cover something new.\n` +
    `5) SCHEMA: valid YAML; unique ids all prefixed '${t.slug}-' 3-digit seq, no collisions; difficulty in {beginner,intermediate,advanced,expert}; 3-5 options; 0-based in-range 'answer'; every 'ref' resolves to a real '## ' heading. Fix violations. Confirm correct-option positions are VARIED (not clustered on one index) — REBALANCE by reordering options if any index exceeds ~35% share.\n` +
    `6) DIFFICULTY/COVERAGE: confirm the bank now has a strong block of advanced+expert questions and reaches 70-90 total; expert-tagged ones must be genuinely hard. Re-tag/ADD if short.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
