# Secrets Management & Key Lifecycle

A **secret** is any piece of data whose disclosure lets an attacker impersonate a
principal, decrypt data, or move laterally: passwords, API keys, database credentials,
private keys, TLS certificates' private halves, OAuth client secrets, signing/encryption
keys, session/HMAC keys, and even connection strings. Secrets management is the discipline
of **generating, storing, distributing, rotating, revoking, and destroying** those values
without ever exposing them, and of **detecting** when they leak. This topic teaches the
threat/mechanism view — where secrets leak, how attackers exploit that, and the controls
(secret managers, envelope encryption, dynamic short-lived credentials, key lifecycle per
NIST SP 800-57) that fix it. It does not re-teach OAuth/JWT token mechanics (see the token
topics) or the TLS handshake (networking).

> [!KEY-TAKEAWAY]
> The two ideas an interviewer wants: (1) **don't store long-lived secrets in code, images,
> or env — centralize them in a secret manager and prefer short-lived/dynamic credentials**,
> and (2) **encryption keys have a lifecycle** (generate → distribute → rotate → revoke →
> destroy) and a **hierarchy** (envelope encryption: a data key wrapped by a key-encryption
> key) that lets you rotate keys *without* re-encrypting all your data.

---

## What Counts as a Secret

A secret is any credential or key material that grants access, proves identity, or protects
confidentiality/integrity of data. If leaking it lets an attacker *do* something as you or
*read* something they shouldn't, it is a secret.

**Common secret types:**

| Category | Examples |
|---|---|
| Authentication credentials | Passwords, database passwords, service-account passwords |
| API / access keys | Cloud access keys, third-party API keys, webhook signing secrets |
| Private keys | TLS private keys, SSH private keys, code-signing keys, PGP keys |
| Symmetric keys | AES data-encryption keys, HMAC/JWT signing keys, session keys |
| OAuth/OIDC | Client secrets, refresh tokens, JWKS private signing keys |
| Connection material | Database connection strings (often embedding a password), message-broker creds |

**Not the same as identifiers.** A public key, a key *ID* (`kid`), a username, a client ID,
or a bucket name is **not** a secret — publishing it causes no direct compromise. Confusing
the two leads either to over-classifying (encrypting public data) or under-classifying
(treating a database password as "just config"). The test is: *does disclosure enable an
attack?*

> [!WARNING]
> Configuration is not automatically non-secret. A connection string like
> `postgres://app:S3cr3t@db.internal:5432/prod` is a secret because it embeds a password.
> "It's just config" is how database passwords end up committed to Git.

Secrets are distinct from *sensitive data* (PII, PHI, card data): sensitive data is
*protected by* secrets (keys), but the key is the higher-value target because one key
unlocks all the data it encrypts. This is why key management is treated as a first-class
security domain (OWASP A02:2021 – Cryptographic Failures; NIST SP 800-57).

---

## Secret Sprawl Anti-Patterns

**Secret sprawl** is the proliferation of the same or many secrets across code, config,
images, tickets, wikis, chat, and CI logs — each copy an independent leak surface. The
anti-patterns below are the ones interviewers expect you to name and fix.

**1. Hardcoded in source / committed to Git.** The classic. Even if you later delete the
line, **Git history retains it forever** — `git log -p`, `git show <oldsha>`, or any clone
recovers it. Deleting the file in a new commit does nothing.

```
# Vulnerable: committed to the repo
const STRIPE_KEY = "sk_live_51H...";   // in history forever once pushed
```

*Exploit:* attackers scrape public GitHub (and leaked private repos) with regexes/entropy
scanners; live cloud keys are often abused within **minutes** of a push (cryptomining, data
exfiltration). *Fix:* never commit secrets; load them at runtime from a secret manager or
injected env; if one is committed, **rotate it** — scrubbing history (BFG / `git
filter-repo`) removes the copy but the secret must be assumed compromised.

**2. Baked into container images.** `ENV API_KEY=...` or `COPY id_rsa .` in a Dockerfile
embeds the secret in an image **layer**. Anyone who can `docker pull` the image runs
`docker history` / unpacks layers to read it — even if a later layer "removes" the file, the
earlier layer still contains it. *Fix:* inject secrets at **runtime** (orchestrator secret,
mounted file, secret-manager fetch on startup), never at build time. Use multi-stage builds
and never `COPY` key files.

**3. Environment variables (leak-prone).** Env vars avoid the *image/repo* problem but leak
through many side channels: crash/error pages that dump the environment, `/proc/<pid>/environ`
readable by co-located processes, child-process inheritance, APM/observability agents that
capture env, and logging frameworks that print config on startup. They also don't rotate —
the process must restart to pick up a new value. *Fix:* prefer files with tight permissions
(`0400`, owned by the service user) or direct secret-manager reads; scrub env from error
handlers and log redaction filters.

**4. Secrets in logs / URLs / tickets.** Logging a full request (with `Authorization`
headers or query-string tokens), putting a token in a URL (which lands in access logs,
proxies, browser history, and `Referer` headers), or pasting a key into a Jira ticket or
Slack channel. *Fix:* redact known secret patterns in log pipelines; never put secrets in
query strings (use headers/body); scan wikis/tickets.

> [!INTERVIEW]
> "You find an AWS key hardcoded in a repo — what do you do?" Expected answer, in order:
> **(1) rotate/revoke the key immediately** (assume compromised), (2) audit usage via cloud
> logs (CloudTrail) for abuse, (3) remove it from code and load from a secret manager,
> (4) purge history *and* add pre-commit/CI scanning to prevent recurrence. Rotation first —
> scrubbing history alone is not remediation.

---

## Secret Managers and Dynamic Secrets

A **secret manager** is a centralized, access-controlled, audited store for secrets —
HashiCorp Vault, AWS Secrets Manager, AWS Systems Manager Parameter Store (SecureString),
GCP Secret Manager, Azure Key Vault. It replaces "secrets scattered everywhere" with a
single system that provides: **encryption at rest**, **fine-grained access policies**,
**audit logging** of every read, **versioning**, and often **automatic rotation**.

**Static secret in a manager** (better than sprawl, still long-lived): the app authenticates
to the manager and reads e.g. a database password. The secret lives until someone rotates
it, so a leak has a long exploit window.

**Dynamic secrets** (the strong pattern): the manager **generates a fresh, short-lived
credential on demand** and revokes it when its lease expires. With Vault's database secrets
engine, the app requests `database/creds/<role>`; Vault runs a configured SQL statement to
`CREATE` a new DB user with a random password and a **lease** (e.g. `default_ttl=1h`,
`max_ttl=24h`). When the lease ends (or is revoked), Vault `DROP`s the user. Benefits:

- **Tiny exposure window** — a leaked credential is useless after its short TTL.
- **No shared credential** — every app instance gets a unique credential, so audit logs
  attribute activity to a specific instance (great for forensics).
- **Instant revocation** — revoke the lease and the credential dies immediately.

| | Static secret in manager | Dynamic/short-lived secret |
|---|---|---|
| Lifetime | Until manual/scheduled rotation | Minutes–hours (lease TTL) |
| Leak blast radius | Large (long window, shared) | Small (expires fast, per-instance) |
| Revocation | Rotate + redeploy consumers | Revoke lease; expires automatically |
| Attribution | Shared cred → hard | Unique cred → precise |

Cloud KMS services (AWS KMS, GCP KMS, Azure Key Vault, CloudHSM) are a related but distinct
tool: they **hold key material and perform crypto operations** (encrypt/decrypt/sign) so the
raw key **never leaves** the HSM/KMS boundary. You send data to KMS and get ciphertext back;
you never see the key. This is the basis of envelope encryption (below).

> [!TIP]
> "Secrets Manager vs KMS": a **secret manager** stores and returns arbitrary secret *values*
> (passwords, API keys). A **KMS** guards *key material* and does crypto on your behalf
> without revealing the key. They compose: Secrets Manager encrypts stored secrets with a
> KMS key.

---

## Encryption Key Hierarchy and Envelope Encryption

**Envelope encryption** encrypts data with a **data-encryption key (DEK)**, then encrypts
(*wraps*) the DEK with a **key-encryption key (KEK)**. You store the ciphertext alongside the
**wrapped DEK**; the KEK stays in a KMS/HSM and never leaves it.

**Encrypt flow:**
1. Ask KMS to generate a DEK — it returns the **plaintext DEK** and the **DEK encrypted
   under the KEK** (the wrapped/encrypted data key).
2. Encrypt your data locally with the plaintext DEK (fast, AES-GCM).
3. **Discard the plaintext DEK from memory**; persist `ciphertext + wrapped DEK`.

**Decrypt flow:** send the wrapped DEK to KMS → KMS unwraps it with the KEK → you get the
plaintext DEK back → decrypt the data locally → discard the DEK.

**Why the hierarchy:**

- **Performance/scale** — bulk data is encrypted locally with a fast symmetric DEK; KMS is
  only called for the tiny wrap/unwrap operation, not the whole payload. You can have
  millions of DEKs (e.g. one per object/tenant) all protected by one KEK.
- **Blast-radius control** — the high-value KEK lives in an HSM and is used rarely; DEKs are
  cheap and disposable.
- **Cheap rotation of the KEK** — see the next section.

```
   [ Plaintext data ] --encrypt with--> DEK  ==>  [ Ciphertext ]
                                          |
                                     wrap with KEK (in KMS/HSM)
                                          v
                                  [ Wrapped DEK ]  (stored next to ciphertext)
```

A KEK hierarchy can be multi-level: a **root/master key** (often in an HSM) wraps KEKs, which
wrap DEKs. NIST SP 800-57 recommends keeping key-wrapping keys higher in the hierarchy and
using them narrowly.

> [!WARNING]
> The whole point is that the **plaintext DEK is ephemeral**. A common bug is logging or
> persisting the plaintext DEK "for convenience" — that defeats envelope encryption entirely,
> because now the DEK leaks without ever touching the KEK.

---

## Key Rotation Without Re-encrypting All Data

Naively "rotating an encryption key" sounds like it requires decrypting and re-encrypting
**all** data — infeasible at scale. Envelope encryption avoids this.

**Rotating the KEK (cheap):** because the KEK only ever encrypts **DEKs**, rotating it means
re-wrapping the (small, few) DEKs under the new KEK — you never touch the bulk ciphertext.
AWS KMS "automatic key rotation" goes further: the key **ID stays the same** while KMS keeps
old key *versions* internally, so new data uses the new version and old ciphertext still
decrypts with the retained old version — no re-wrapping visible to you at all.

**Rotating a DEK:** since each DEK protects a bounded slice of data (one object/tenant/file),
you only re-encrypt *that slice* when you rotate its DEK — and you can do it lazily
("rotate-on-write": next time the object is written, use a fresh DEK).

**Key versioning / `kid`.** Never rely on "the current key." Store a **key identifier**
(version) with each ciphertext (and with signed tokens via a JWKS `kid`) so you know which
key decrypts/verifies it. This enables **graceful rotation**: publish/enable the new key,
start using it for new data/signatures, but **keep the old key available for
decrypt/verify** until all data/tokens signed with it have aged out — *then* retire it. Doing
the reverse (removing the old key first) breaks verification of still-valid artifacts.

> [!INTERVIEW]
> "How do you rotate the master key for a 100 TB encrypted dataset without re-encrypting it
> all?" Answer: you don't encrypt data directly with the master key. Envelope encryption:
> data is encrypted with per-object DEKs; the master KEK only wraps DEKs. Rotating the KEK
> re-wraps the DEKs (small, fast) — the 100 TB of ciphertext is never touched.

---

## Key Lifecycle and NIST SP 800-57

NIST SP 800-57 Part 1 defines cryptographic key management as a **lifecycle** and gives keys
a **state model**. Interviewers expect the phases and the state transitions.

**Lifecycle functions:**

1. **Generation** — keys MUST come from a **CSPRNG** (cryptographically secure RNG) or an
   HSM's hardware RNG. Never `Math.random()`/`rand()`, timestamps, or predictable seeds. Use
   full-entropy keys of adequate length (e.g. AES-256, RSA-3072/ECC-P-256 per SP 800-57's
   comparable-strength tables). Keys should be generated where they'll be protected (ideally
   inside the HSM/KMS so raw material never exists in application memory).
2. **Distribution / establishment** — get the key to those who need it *without exposure*:
   key wrapping, key agreement (ECDH), or a KMS that never releases raw material. Avoid
   emailing/Slacking keys.
3. **Storage** — encrypted at rest (wrapped by a KEK), access-controlled, backed up (for keys
   that protect long-lived data — losing the key = losing the data).
4. **Use** — within its **cryptoperiod** and only for its intended purpose (don't reuse a
   signing key for encryption; separate keys per purpose limits blast radius).
5. **Rotation** — replace the key at the end of its cryptoperiod (see below).
6. **Revocation** — mark a key unusable before its natural expiry (e.g. on suspected
   compromise or role change).
7. **Destruction** — securely wipe all copies (zeroize) when the key is no longer needed for
   any data, so it can never be recovered.

**Cryptoperiod** = the time span a key is authorized for use. SP 800-57 recommends bounding
it to limit the amount of data exposed if the key is compromised and the time an attacker has
to attack it; it distinguishes the **originator-usage period** (while you encrypt/sign with
it) from the **recipient-usage period** (while you still decrypt/verify with it) — the latter
extends past the former, which is exactly why old keys must linger for decrypt/verify.

**Key states (SP 800-57 Part 1 Rev 5):**

| State | Meaning |
|---|---|
| **Pre-activation** | Generated but not yet authorized for use |
| **Active** | Authorized to protect (encrypt/sign) and/or process (decrypt/verify) |
| **Suspended** | Temporarily out of use (e.g. under investigation); may return to active |
| **Deactivated** | Past its cryptoperiod for *protecting* new data, but retained to process old data |
| **Compromised** | Known/suspected exposed — must not be used to protect; used to process only under strict control |
| **Destroyed** | Key material zeroized; unrecoverable |

> [!KEY-TAKEAWAY]
> Deactivated ≠ destroyed. A deactivated (or compromised) key often must stay available to
> **decrypt/verify** existing data even though it can no longer **encrypt/sign** new data.
> Destroy it only once nothing it protected is still needed.

---

## The Secret Zero (Bootstrapping) Problem

If all secrets live in a secret manager, the application still needs **one credential to
authenticate to the manager** — that's **secret zero** (a.k.a. the bootstrapping problem).
You can't store secret zero *in* the manager, so it seems you've only moved the problem.

The solution is to make secret zero either **non-secret**, **ephemeral**, or **derived from
the platform's trusted identity** rather than a shared static token:

- **Platform/workload identity (best).** The infrastructure vouches for the workload:
  - Cloud instance identity — AWS IAM roles via instance metadata (IMDSv2), GCP/Azure
    metadata identity: the VM/pod *is* the identity; no secret is stored at all.
  - Kubernetes service-account tokens / SPIFFE-SVID: the orchestrator issues a
    cryptographically verifiable identity document to the workload.
  - Vault auth methods that verify these (AWS auth, Kubernetes auth, JWT/OIDC auth) turn a
    platform identity into a short-lived Vault token.
- **Trusted orchestrator injection + response wrapping.** A trusted CI/deploy system fetches
  a **single-use, short-TTL wrapping token** (Vault "response wrapping") and hands it to the
  workload; the workload unwraps it once to get its real credential. If anyone else unwraps
  it first, the legitimate unwrap fails — you get **tamper evidence**. AppRole splits a
  `role_id` (non-secret, deployable) from a short-lived `secret_id` (delivered separately).
- **TPM/HSM-anchored identity.** Hardware attestation provides a root of trust that can't be
  copied off the machine.

The guiding principle: push the root of trust down to something the attacker **cannot copy**
(hardware/platform identity) and keep any bootstrap token **single-use and short-lived** so a
leak is self-limiting.

> [!WARNING]
> Solving secret-zero by baking a long-lived Vault token into the image or env just recreates
> the original problem with extra steps. The bootstrap credential must be ephemeral,
> single-use, or a non-copyable platform identity.

---

## Leaked-Secret Detection and Rotation-on-Leak

You cannot prevent every leak, so detection + fast rotation is a core control.

**Detection:**

- **Pre-commit / pre-push hooks** (gitleaks, git-secrets, detect-secrets) scan diffs *before*
  a secret is committed — cheapest place to catch it.
- **CI/CD and repo-history scanning** (gitleaks, trufflehog) scan full history and every PR;
  platform features like GitHub **Secret Scanning + push protection** block known
  provider-token patterns at push time and notify partners.
- **Partner/provider revocation programs** — many providers (AWS, Stripe, GitHub) accept
  leaked-secret reports from scanners and auto-quarantine/rotate the token.
- Detection combines **regex/pattern matching** (provider-specific token formats, e.g.
  `AKIA…`, `sk_live_…`, `ghp_…`) with **entropy analysis** (high-Shannon-entropy strings that
  look random) to catch unknown formats — at the cost of false positives.

**Rotation-on-leak (assume compromise).** Once a secret hits a repo, log, or ticket, treat it
as **compromised regardless of whether you can prove it was read**. Attacker scrapers are
fast, and you can't prove a negative. The response runbook:

1. **Rotate/revoke** the secret at the source (issue a new one, invalidate the old).
2. **Assess impact** via audit logs (who/what used it, from where).
3. **Remove** it from the code/log/history and load it from a secret manager instead.
4. **Prevent recurrence** — add scanning to pre-commit and CI, and prefer short-lived
   dynamic secrets so the next leak has a tiny window.

> [!TIP]
> Short-lived/dynamic secrets are the best *mitigation* for the leak problem: if a credential
> auto-expires in an hour, a leaked copy is largely worthless — you've turned "rotate in a
> panic" into "it already rotated."

---

## Least Privilege and Auditing for Secret Access

Centralizing secrets creates a high-value target, so access must be **least-privilege** and
**fully audited**.

**Least privilege for secrets:**

- **Scope by identity and path.** A service should read only the secrets it needs — policies
  bound to a specific workload identity and specific secret paths (e.g. `payments` service
  can read `secret/payments/*` only), never a broad `read *`.
- **Separate read from manage.** The app can *read* a value; only a small admin/rotation
  role can *write/rotate/delete* it. Humans generally shouldn't hold standing read access to
  production secrets — use break-glass with approval.
- **Purpose- and environment-separated keys.** Distinct keys per environment (dev/stage/prod)
  and per purpose (signing vs encryption) so a compromise or a dev leak can't touch prod.
- **Prefer dynamic secrets and workload identity** so there's no standing shared credential
  to over-grant in the first place.

**Auditing:** every secret **read, write, rotation, and denied access** must be logged
(who/what identity, when, from where, which secret) to a tamper-resistant, centralized log.
This gives you (a) **forensics** — after a leak, exactly which secrets were read and by whom,
which drives the blast-radius assessment; (b) **detection** — anomalous access (a service
reading secrets it never touched, or a spike in reads) triggers alerts; and (c) **compliance**
evidence. Dynamic per-instance credentials make audit trails precise because each credential
maps to one workload instance.

> [!INTERVIEW]
> Tie it together: least privilege *limits* what a compromised identity can reach, audit
> logging *detects and scopes* a breach, and short-lived dynamic secrets *shrink* the window —
> defense in depth around the secret store, which is now a single high-value target.

---

## Common follow-up questions

- **"A developer committed a live API key to a public repo an hour ago. Walk me through
  the response."** Rotate/revoke first (assume compromised), audit usage for abuse, remove
  from code and move to a secret manager, purge history, add scanning + push protection.
  Scrubbing history alone is not remediation.
- **"How do you rotate an encryption key for petabytes of data without re-encrypting it?"**
  Envelope encryption: data is encrypted with per-object DEKs; the KEK only wraps DEKs.
  Rotate the KEK by re-wrapping the DEKs (or let KMS version internally) — bulk ciphertext is
  untouched.
- **"What's the difference between a secret manager and a KMS?"** Secret manager stores/returns
  secret *values*; KMS guards *key material* and performs crypto without exposing the key.
  They compose (Secrets Manager uses a KMS key to encrypt stored secrets).
- **"How does an app authenticate to the secret manager without a stored secret?"** Secret-zero
  problem — solve with platform/workload identity (IAM role/IMDSv2, Kubernetes SA token,
  SPIFFE) or single-use short-TTL bootstrap tokens (Vault response wrapping / AppRole), not a
  baked-in static token.
- **"Why are env-var secrets risky if they're not in the repo?"** They leak via crash/error
  dumps, `/proc/<pid>/environ`, child processes, APM agents, and startup logging, and don't
  rotate without a restart.
- **"What are the states in a key's lifecycle?"** Pre-activation, active, suspended,
  deactivated, compromised, destroyed (NIST SP 800-57 Part 1) — and deactivated/compromised
  keys may still be needed to decrypt/verify old data.
- **"Why is deleting a secret from Git not enough?"** History retains every past version; any
  clone recovers it. Assume compromised and rotate.

## References

- OWASP Top 10 2021 — **A02:2021 Cryptographic Failures**:
  https://owasp.org/Top10/A02_2021-Cryptographic_Failures/
- OWASP **Secrets Management Cheat Sheet**:
  https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP **Key Management Cheat Sheet**:
  https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html
- OWASP ASVS — V6 (Stored Cryptography) / V2 (Authentication, secret management):
  https://owasp.org/www-project-application-security-verification-standard/
- NIST **SP 800-57 Part 1 Rev 5**, Recommendation for Key Management (key states,
  cryptoperiods, lifecycle): https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
- NIST **SP 800-133 Rev 2**, Recommendation for Cryptographic Key Generation:
  https://csrc.nist.gov/pubs/sp/800/133/r2/final
- HashiCorp Vault — Dynamic database secrets & leases:
  https://developer.hashicorp.com/vault/docs/secrets/databases
- HashiCorp Vault — Response wrapping / secret-zero (Cubbyhole & AppRole):
  https://developer.hashicorp.com/vault/docs/concepts/response-wrapping
- AWS KMS — Envelope encryption & key rotation:
  https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping
- GitHub — Secret scanning & push protection:
  https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning
