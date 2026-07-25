# security — Content Audit

**Executive summary.** The security domain is in strong health. Across all 17 subtopics, depth is uniformly at the senior/staff bar (average depth **5.0/5**) and intuition-first clarity is excellent (average clarity **4.76/5**). The single consistent weakness is **worked examples** (average **3.65/5**): the content explains quantitative mechanics in prose and formulas but rarely traces them numbers-in/numbers-out, which is the #2-weighted refinement dimension. No subtopic is rated **high** refine-priority; **4 are medium** (authentication-and-mfa, security-fundamentals-and-threat-modeling, session-management-and-secure-cookies, password-storage-and-credential-security) and **13 are low**. Note that all four medium files each carry exactly one **high-severity** issue — invariably a missing worked calculation for the file's most math-amenable concept (HOTP/TOTP derivation, session-ID entropy, crack-time capacity math, DREAD/SLE-ALE/FAIR/CVSS scoring). Headline takeaways: (1) the domain needs a coordinated "add the missing calculation" pass more than any structural rework; (2) **every one of the 17 files has `needs_web_verification = true`** — a batch fact-check of version/limit/stat claims (NIST 800-63B-4, OWASP editions/rankings, amplification factors, incident stats) should run before publish; (3) a secondary wave of mermaid diagrams for inherently sequential/spatial flows would lift several files from "very good" to "excellent."

## Scorecard

Sorted: medium priority first, then low; within each group lowest (clarity+example+depth) first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| authentication-and-mfa | 5 | 2 | 5 | medium | Exceptionally deep, intuition-first; held back by no numeric trace for its most mechanical concepts (HOTP/TOTP, DPoP). |
| security-fundamentals-and-threat-modeling | 4 | 3 | 5 | medium | Deep and well-structured, but DREAD/SLE-ALE/FAIR/CVSS give formulas with no worked number, and one matrix diagram is garbled. |
| session-management-and-secure-cookies | 5 | 3 | 5 | medium | Senior-grade, modern (DBSC/DPoP/CHIPS/BFF); gap is missing entropy brute-force math and end-to-end wire trace. |
| password-storage-and-credential-security | 5 | 4 | 5 | medium | Near-model with great gotchas; missing crack-time capacity math and an 8-vs-15-char NIST ordering collision. |
| xss-csp-and-security-headers | 4 | 3 | 5 | low | Staff-grade depth; CSP nonce/hash/strict-dynamic mechanics explained in prose without a traced block/allow walkthrough. |
| openid-connect-and-sso | 4 | 4 | 5 | low | Near-exhaustive threat coverage; needs a fully-numeric at_hash/c_hash trace and intuition for the mix-up attack. |
| owasp-top-10-walkthrough | 4 | 4 | 5 | low | Near-exhaustive; likely misstates the "94%" BAC statistic and mixes 2021-vs-2025 numbering in deep-dive headers. |
| secrets-management-and-key-lifecycle | 5 | 3 | 5 | low | Unusually complete; shortage of numbers-in/out examples (GCM nonce bound, envelope/DEK counts, Shamir quorum). |
| application-cryptography-and-data-protection | 5 | 4 | 5 | low | Polished senior-bar file; lacks KMS cost/latency math and blind-index bucket arithmetic; AES-SIV "fixed nonce" nit. |
| authorization-and-access-control | 5 | 4 | 5 | low | Senior-grade deep-dive; Zanzibar graph traversal and RFC 8693 nested `act` lack a concrete walkthrough. |
| cryptography-foundations | 5 | 4 | 5 | low | Standout crypto file; Diffie-Hellman and envelope/HKDF stated in notation without a small numeric trace. |
| injection-attacks | 5 | 4 | 5 | low | Near-model; blind-extraction binary-search lacks a numeric trace; emulated-prepares gotcha missing. |
| jwt-and-token-security | 5 | 4 | 5 | low | Outstanding threat-first doc; minor HMAC brute-force numbers, a diagram, and trimming triple-covered alg:none. |
| oauth2-and-oauth21 | 5 | 4 | 5 | low | Near-exemplary; JWT-validation-attacks section is prose-only; PKCE crypto asserted not demonstrated. |
| rate-limiting-and-dos-defense | 5 | 4 | 5 | low | Outstanding, modern; GCRA, sliding-window-counter, and Little's Law taught with bare formulas, no trace. |
| sop-cors-and-csrf | 5 | 4 | 5 | low | Exceptionally thorough; wants a synthesis matrix, two flow diagrams, and a 128-bit CSRF-token entropy fix. |
| ssrf-and-server-side-request-attacks | 5 | 4 | 5 | low | Elite SSRF reference; missing IP-encoding derivation, a safe-fetch pseudocode block, and any diagram. |

## Systemic issues

These themes recur across subtopics; they are the highest-leverage targets because a single editorial pass can fix the same class of gap everywhere.

### 1. Missing numbers-in / numbers-out worked examples (≈16 of 17 files; 4 at high severity) — THE dominant theme
The content repeatedly states a formula or rate and asserts a conclusion, but never plugs in real numbers to reach a result. This is the #1 refinement priority for the domain. High-severity instances: HOTP/TOTP dynamic-truncation trace (`authentication-and-mfa`), session-ID entropy brute-force math (`session-management-and-secure-cookies`), fast-hash-vs-Argon2id crack-time capacity math (`password-storage-and-credential-security`), and DREAD/SLE-ALE/FAIR scoring (`security-fundamentals-and-threat-modeling`). Medium/low instances span nearly every other file: GCRA/sliding-window/Little's Law traces (`rate-limiting-and-dos-defense`), Zanzibar graph traversal and XACML combining-algorithm conflict (`authorization-and-access-control`), Diffie-Hellman small-number trace and birthday-bound intuition (`cryptography-foundations`), boolean-blind binary-search extraction (`injection-attacks`), at_hash leftmost-16-bytes trace (`openid-connect-and-sso`), RS256→HS256 forge and PKCE SHA-256 computation (`oauth2-and-oauth21`), CSP nonce/hash allow-block decision and same-payload-two-contexts demo (`xss-csp-and-security-headers`), IP-encoding octet arithmetic (`ssrf-and-server-side-request-attacks`), HMAC double-submit recomputation (`sop-cors-and-csrf`), HMAC-secret brute-force sizing (`jwt-and-token-security`).

### 2. Universal `needs_web_verification` on drifting version/limit/stat claims (17 of 17 files)
Every file was flagged for a fact-check pass. The claims cluster tightly: **NIST SP 800-63B/-63C numbers** (8-vs-15-char minimums, AAL2/AAL3 reauth intervals, ≤100 failed-attempt cap, salt bits, SMS RESTRICTED status) in `authentication-and-mfa`, `session-management`, `password-storage`, `rate-limiting`; **OWASP editions/rankings** (A01:2021 "94%" statistic, 2021-vs-2025 numbering, 2025 methodology counts, API 2023 numbering) in `owasp-top-10-walkthrough`, `authorization`; **amplification factors and DDoS incident figures** (DNS/NTP/memcached/CLDAP multipliers, GitHub 1.35 Tbps, Rapid Reset rps/botnet size, Cloudflare Q4-2024) in `rate-limiting`; **crypto/OWASP guidance** (RS256-not-recommended, 160-bit HMAC entropy source, CSP "94% bypassable", FF3→FF3-1) in `jwt`, `xss`, `application-cryptography`; **incident/compliance stats** (FIPS 140-2 CMVP Sept-2026 sunset, GitGuardian 2024, Capital One, Microsoft 38 TB, Samy worm) in `secrets-management`, `xss`. Run one consolidated verification sweep rather than per-file.

### 3. Missing diagrams for inherently sequential/spatial flows (≈10 files)
The repo standard is mermaid, but flow-heavy concepts are carried entirely by prose. Recurring requests: AiTM relay and WebAuthn origin-binding (`authentication-and-mfa`), PKI chain-of-trust and CBC chaining and DH exchange (`cryptography-foundations`), structure-vs-data channel (`injection-attacks`), JWKS rotation and DPoP request (`jwt`), auth-code+PKCE flow (`oauth2`), HIBP k-anonymity round-trip and hashing pipeline (`password-storage`), cookie-tossing header sort-order (`session-management`), preflight and CSRF flows (`sop-cors-and-csrf`), DNS-rebinding TOCTOU (`ssrf`). Separately, `security-fundamentals` has a **garbled** likelihood×impact ASCII matrix (severity medium) that actively confuses rather than merely being absent — fix that one first.

### 4. Envelope-encryption / DEK-KEK explained without a numeric or API-traced flow (3 files, cross-cutting)
The same concept is under-exemplified in three places: `application-cryptography-and-data-protection` (KMS cost/latency and request-size math), `cryptography-foundations` (4-step encrypt/decrypt trace), and `secrets-management-and-key-lifecycle` (GenerateDataKey inputs/outputs, DEK-count blast-radius for KEK rotation). A single canonical worked envelope-encryption example could be authored once and referenced across all three for consistency.

### 5. Redundancy, ordering, and structural seams (≈6 files)
Long files accumulate repetition and linear-read hazards: alg:none fix stated three times (`jwt`), overlapping blind-SSRF sections and gopher→RCE repeated three places (`ssrf`), 8-char-then-15-char NIST whiplash (`password-storage`), 2021-vs-2025 OWASP header numbering (`owasp`), meta self-references that break teaching voice ("the doc already covers…") in `security-fundamentals`, and core-vs-advanced signposting plus CSRF-topic overlap in `session-management`. Individually low severity, but collectively they cost reader time in the domain's longest files.

### 6. Small correctness nits an interviewer would catch (≈6 files, low severity each)
Distinct from stat-drift: AES-SIV mischaracterized as "fixed key/nonce" (`application-cryptography`), OOB UNC-path payload presented as DB/OS-universal (`injection`), auth-code lifetime "≤60s recommended" conflated with RFC 6749's 10-min max (`oauth2`), Saltzer-Schroeder attribution of defense-in-depth (`security-fundamentals`), CSRF token placeholder at 64 bits vs recommended 128-bit+ (`sop-cors-and-csrf`), inconsistent Argon2 verify-latency target 100 ms vs 250-500 ms (`password-storage`), HYOK-vs-XKS under-defined (`secrets-management`).

## High-priority subtopics

No subtopic is rated **high** refine-priority. The four **medium**-priority files below are the recommended focus of the first refinement wave — each is otherwise excellent (depth 5, clarity 4–5) but carries one **high-severity** worked-example gap that lands on the top-weighted rubric dimensions.

### authentication-and-mfa (clarity 5 / examples 2 / depth 5)
Lowest example score in the domain. Otherwise senior-bar deep.
- **[high] HOTP/TOTP have formulas but no numbers-in/out trace** (`## HOTP mechanics`, `## TOTP mechanics`). Fix: pick a concrete Unix time (e.g. 1700000000 → T=56666666), walk the RFC 4226 dynamic-truncation on a sample 20-byte HMAC (offset byte → 4 bytes read → top-bit mask → mod 10^6 → a specific 6-digit code), then show the ±1 step window = 3 candidate T's ≈ 90s acceptance.
- **[medium] DPoP/mTLS section is dense and fully abstract** (`## Sender-constrained tokens`). Fix: show a sample request with a decoded DPoP proof JWT, the access token's `cnf.jkt`, then a 3-step server validation and the stolen-token case failing at step 1.
- **[medium] NIST 800-63B-4 numeric/normative claims need verification** (`## NIST SP 800-63-4 updates`). Fix: web-verify the 8-vs-15-char SHALL/SHOULD framing, AAL2/AAL3 timeouts, salt ≥32 bits, ≤100 attempts against the published -4.
- **[low] AiTM and WebAuthn flows want a sequence diagram**; **[low] TOTP rate-limit gotcha states intuition but not the arithmetic** (per-attempt success ≈ 3/10^6, time-to-hit ≈ 10^6/(3·N)).

### security-fundamentals-and-threat-modeling (clarity 4 / examples 3 / depth 5)
- **[high] The three math-heavy sections give formulas with no worked number** (`## DREAD`, `## Risk Rating (SLE/ALE)`, `## Quantitative Risk with FAIR`). Fix: one walkthrough each — DREAD score a sample SQLi (D8/R9/E6/A10/D7 → 8.0), SLE/ALE ($1M PII × EF 30% → SLE $300k × ARO 0.5 → ALE $150k justifies a $40k/yr control), FAIR (TEF 2/yr × Vuln 0.25 → LEF 0.5, LM $200k–$5M → read the loss-exceedance curve).
- **[medium] The OWASP likelihood×impact ASCII matrix is garbled** (left-axis label split as "High / LIKE Med / LIHD Low"; a cell literally says "Note"). Fix: redraw a clean 3×3 with a single LIKELIHOOD axis, proper cell values, and a legend for the "Note"/informational band.
- **[medium] CVSS taught as metric groups but no vector decoded** (`## CVSS Scoring Basics`). Fix: decode Log4Shell's `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H = 10.0` line-by-line, showing why Scope:Changed reaches 10.0, then contrast a lower vector.
- **[low] Meta self-references** ("the doc already covers…") break teaching voice; **[low]** flag defense-in-depth/secure-defaults as later additions, not Saltzer & Schroeder's original eight.

### session-management-and-secure-cookies (clarity 5 / examples 3 / depth 5)
- **[high] Session-ID entropy left entirely abstract** (`## Session ID Generation`). Fix: 64-bit ID = 2^64 ≈ 1.8e19; at 10,000 guesses/sec against one valid session of N active, expected time ≈ 2^63/(rate·active) → astronomically long; show 32-bit (4.3e9) becomes guessable in hours; tie "≥16 hex chars" to 16×4 = 64 bits.
- **[medium] No single end-to-end wire trace** of login Set-Cookie → authenticated Cookie header → regeneration-on-login rotation. Fix: add one traced exchange near the top anchoring fixation/regeneration.
- **[medium] Selector:validator remember-me pattern is prose-only.** Fix: sample token `3f2a:9c8b…`, row `{selector:'3f2a', validator_hash: sha256('9c8b…')}`, lookup → hash → constant-time compare → theft-detection branch.
- **[low] Cookie-tossing sort-order diagram; [low] idle-timeout write-amplification and hashed-ID trade-off gotchas; [low] core-vs-advanced signpost and CSRF-topic cross-reference; [low] verify 4096-byte/50-cookie/400-day/OWASP/NIST numeric limits.**

### password-storage-and-credential-security (clarity 5 / examples 4 / depth 5)
- **[high] The flagship crack-time calculation is missing** (`## Why never plaintext…`, `## Adaptive and memory-hard hashes`). Fix: 8-char lowercase+digit ≈ 36^8 ≈ 2.8e12; at 100e9 MD5/s ≈ 28 seconds; at Argon2id ~250 ms/guess (4/s) ≈ 22,000 years on one core; note GPU parallelism collapses the fast-hash number but memory-hardness blunts it.
- **[medium] NIST 8-char then 15-char ordering collision** reads as contradiction top-to-bottom. Fix: forward-pointer at the "8 characters" line or merge into one Rev-3-vs-Rev-4 delta callout.
- **[medium] HIBP k-anonymity "client" is ambiguous** (browser vs your backend). Fix: clarify "client" = your backend API caller and add a concrete SHA1→prefix `5BAA6`→suffix-match trace.
- **[low] Inconsistent verify-latency target (100 ms vs 250-500 ms); [low] encrypt-the-hash pepper verify-path trace; [low] HIBP + hashing-pipeline diagrams.**

## Refinement plan

**Verification gate (do first, batched).** All 17 files have `needs_web_verification = true`. Run one consolidated fact-check sweep before any prose edits, grouped by claim family (see Systemic issue #2): NIST 800-63B-4 numbers, OWASP editions/rankings/statistics, DDoS amplification factors and incident figures, crypto/OWASP guidance strings, and compliance/incident stats. Fixing numbers first avoids re-editing worked examples that depend on them.

**Wave 1 — the four medium-priority files (highest severity, top-weighted dimensions).** Order: (1) **authentication-and-mfa** (lowest example score, 2/5; add HOTP/TOTP + DPoP traces), (2) **security-fundamentals-and-threat-modeling** (three scoring walkthroughs + fix the garbled matrix + CVSS decode), (3) **session-management-and-secure-cookies** (entropy math + wire trace + selector:validator), (4) **password-storage-and-credential-security** (crack-time box + NIST ordering + HIBP trace). Each closes a single high-severity gap.

**Wave 2 — cross-cutting example passes (touch many low-priority files cheaply).** (a) Author one canonical **envelope-encryption / DEK-KEK worked example** and reuse it across `application-cryptography`, `cryptography-foundations`, `secrets-management` (Systemic #4). (b) Add the remaining numeric traces flagged as example-gaps in the low-priority files: GCRA/sliding-window/Little's Law (`rate-limiting`), Zanzibar traversal (`authorization`), Diffie-Hellman (`cryptography-foundations`), blind-extraction binary search (`injection`), at_hash (`openid-connect`), RS256→HS256 + PKCE (`oauth2`), CSP nonce/hash decision (`xss`), IP-encoding arithmetic + safe-fetch pseudocode (`ssrf`), HMAC double-submit (`sop-cors-and-csrf`).

**Wave 3 — diagrams and polish.** Add the ~10 flagged mermaid diagrams (Systemic #3), then knock out the low-severity redundancy/ordering (Systemic #5) and correctness nits (Systemic #6).

**Missing files:** 0 of 17 (all read successfully).
