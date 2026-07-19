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

## Crypto-Shredding and Cryptographic Erasure

**Crypto-shredding** (cryptographic erasure) makes data permanently unrecoverable by
**destroying the key that encrypts it** instead of wiping the bytes. NIST SP 800-88 Rev 1
(Media Sanitization) recognizes **cryptographic erase (CE)** as a valid sanitization
technique: if data was encrypted with a strong cipher and you securely destroy the only copy
of the key, the ciphertext is computationally unrecoverable — you never have to overwrite the
storage.

**The killer use case: per-tenant / per-user DEKs.** Encrypt each tenant's (or user's) data
under its **own DEK**. To honor a deletion request, destroy that tenant's DEK and every copy
of its data — including data in **immutable/append-only backups, WORM archives, and replicas**
you cannot practically overwrite — becomes undecryptable at once. This is the standard answer
to **GDPR Article 17 (right to erasure)** at scale and to *"delete one customer from five
years of backups."*

**Hard caveats an interviewer wants stated:**

- It only works if **no copy of the key (or the plaintext) survives** — not in a backup, key
  escrow, RAM, a KMS with rotation retaining old versions, or a cached DEK. A single surviving
  key copy defeats it.
- The cipher must **remain strong** over the data's threat horizon (a future break, or
  harvest-now-decrypt-later against quantum, resurrects the data).
- You must actually *zeroize* the key everywhere; "mark deleted" in a KMS with a recovery
  window is not destruction until the window closes.

> [!INTERVIEW]
> "Delete one customer's data from immutable backups you legally must keep — how?" You can't
> rewrite the backups. Give each tenant a per-tenant DEK; **destroy that DEK** so all their
> ciphertext (live + backup) is unrecoverable. State the caveat: it fails if any copy of that
> DEK survives anywhere.

---

## HSMs and FIPS 140-2/140-3 Security Levels

A **Hardware Security Module (HSM)** is a tamper-resistant device that generates, stores, and
uses keys so the raw key material **never leaves** in plaintext. **FIPS 140** is the US/Canada
validation standard for cryptographic modules.

- **FIPS 140-3** (effective 2019) is based on **ISO/IEC 19790:2012** and tested per **ISO/IEC
  24759**; it supersedes **FIPS 140-2**. FIPS 140-2 validated modules are being moved off the
  CMVP active list (historical status) starting **September 2026**, so new designs target
  140-3. Validation is performed by CMVP-accredited labs, not self-asserted.
- **Security Levels 1–4** (increasing physical/logical rigor):

| Level | What it adds |
|---|---|
| **1** | Basic: approved algorithms, no physical security required (e.g. a software crypto library) |
| **2** | **Tamper-evidence** (seals/coatings that show intrusion) + **role-based** authentication |
| **3** | **Tamper-detection/response with active zeroization** of keys on intrusion, **identity-based** auth, physical/logical separation of critical security parameters |
| **4** | Robust **environmental-attack** protection (voltage/temperature/out-of-range detection) + immediate zeroization; highest assurance |

> [!INTERVIEW]
> "What FIPS 140 level do I need for keys that must be wiped if the box is physically
> attacked?" **Level 3** — it mandates tamper *response* (zeroization). Level 2 gives only
> tamper *evidence* (you can tell it happened, but keys aren't auto-destroyed). Cloud HSM
> offerings (AWS CloudHSM, KMS custom key stores) are typically FIPS 140-2/140-3 **Level 3**.

---

## BYOK, HYOK, and External Key Stores

Three distinct trust models control **who can ever decrypt** cloud-hosted data. They differ in
where the KEK lives and whether the cloud provider can technically access plaintext keys.

- **BYOK (Bring Your Own Key)** — you generate key material on-prem and **import it into the
  cloud KMS** (AWS key origin `EXTERNAL`). You control provenance and can re-import/delete, but
  once imported the **key material now exists inside the provider's KMS** — the provider
  *could*, technically, be compelled to use it. BYOK is about provenance/control, **not** about
  denying the provider access.
- **HYOK (Hold Your Own Key)** — key stays under your control; used for the strictest data
  where the cloud service must never see plaintext.
- **External Key Store / XKS** (AWS External Key Store, Google **EKM**, Azure equivalents) —
  the KEK **never enters the cloud**. Every encrypt/decrypt is a call-out from the cloud KMS to
  **your on-prem HSM via a proxy**. Trade-off: you get a hard **kill switch** — block the proxy
  and the cloud provider **physically cannot decrypt** your data — but you now own the
  **availability and latency** of every crypto op (proxy down = data unavailable).

**AWS KMS `KeyOrigin` values** worth knowing: `AWS_KMS` (KMS generates/holds), `EXTERNAL`
(BYOK imported material), `AWS_CLOUDHSM` (backed by your CloudHSM cluster), and
`EXTERNAL_KEY_STORE` (XKS — key stays in your external HSM).

> [!INTERVIEW]
> "Prove the cloud provider can *never* read our data." Answer: **XKS / External Key Store (or
> HYOK)** — the KEK lives only in your on-prem HSM and every decrypt calls out through a proxy
> you control; cut the proxy = kill switch. Contrast with **BYOK**, where the imported key
> *does* live in the cloud KMS, so it does **not** satisfy "never."

---

## Secret Injection Methods

*How* a secret reaches a running process is a security decision with different leak surfaces.
OWASP's Secrets Management guidance ranks these:

| Method | Leak surface | Rotatable without restart? |
|---|---|---|
| **Environment variable** | High — crash dumps, `/proc/<pid>/environ`, child-process inheritance, APM capture, startup logging. **OWASP: "not recommended."** | No (process must restart) |
| **In-memory file mount (tmpfs)** | Lower — file on a memory-backed volume (k8s `emptyDir: {medium: Memory}`), tight perms, never hits disk | Yes if the app re-reads |
| **Sidecar / agent injection** (Vault Agent Injector, CyberArk Conjur Secrets Provider, CSI Secrets Store driver) | Lowest — agent fetches to memory/tmpfs, can auto-renew and re-fetch; secret never in image or repo | Yes (agent renews the lease) |
| **Direct SDK/API fetch at startup** | Low if held only in memory; couples app to the manager's availability | Yes if the app re-fetches |

Prefer **tmpfs file mounts** or **sidecar/agent injection** over env vars. Compared dimensions
that matter: **log-leak surface**, **child-process inheritance**, and **rotatability** (env
vars fail all three).

---

## AES-GCM Nonce Reuse and Key Exhaustion

The concrete cryptographic reason a **DEK itself must be rotated / used narrowly** — not just
for blast-radius, but because the cipher fails if you overuse one key.

- **AES-GCM nonce (IV) reuse is catastrophic.** GCM is a stream-cipher-like mode: encrypting
  two messages with the **same key + same 96-bit nonce** XORs the keystream identically,
  leaking the XOR of plaintexts **and** — worse — allowing recovery of the GHASH
  authentication subkey, which lets an attacker **forge arbitrary messages** under that key.
  One nonce collision breaks both confidentiality and integrity.
- **Key exhaustion / birthday bound.** With random 96-bit nonces, the collision probability
  crosses safe limits after roughly **2^32 messages** under one key (NIST SP 800-38D limits a
  single key to ~2^32 invocations for random IVs). AWS KMS docs call this **key exhaustion**.
- **Why one DEK per object/tenant with bounded use.** Fresh DEKs keep each key's message count
  far below the exhaustion bound and make a nonce collision across keys irrelevant. This ties
  envelope encryption directly to a real A02:2021 cryptographic-failure mechanism, not just
  "smaller blast radius."

> [!WARNING]
> Deterministic/counter nonces avoid random-collision exhaustion **only if the counter is
> reliably persisted and never resets** — a VM snapshot restore, fork, or crash that rewinds
> the counter reintroduces nonce reuse. Random 96-bit nonces are safer under crash/restore but
> bounded by the ~2^32 birthday limit.

---

## Automated Rotation Orchestration

"Graceful overlap" in practice means a **staged, multi-step rotation** so consumers never see
an invalid credential.

**AWS Secrets Manager Lambda rotation** uses staging labels **`AWSCURRENT`** (what clients
read now) and **`AWSPENDING`** (the new value being provisioned) driven by a four-step state
machine:

1. **`createSecret`** — generate the new secret value, store it as `AWSPENDING`.
2. **`setSecret`** — apply the new value in the target system (e.g. change the DB user's
   password).
3. **`testSecret`** — verify the `AWSPENDING` value actually works (connect/authenticate).
4. **`finishSecret`** — move the `AWSCURRENT` label to the new version; the old one becomes
   `AWSPREVIOUS`.

**Two-user (alternating) strategy for zero-downtime DB rotation.** Provision **two** database
users. At any time one is live (`AWSCURRENT`) and one is idle. To rotate, change the password
of the **idle** user, test it, then flip `AWSCURRENT` to point at it. Because you never touch
the credential clients are actively using, there is **no window** where a valid connection
string is broken — the single-user approach risks a race where clients hold the old password
between `setSecret` and cache refresh.

> [!INTERVIEW]
> "Rotate a production DB password with zero downtime." Answer: **alternating two-user**
> strategy + `AWSPENDING`/`AWSCURRENT` staging — rotate the idle credential, `testSecret`, then
> flip the label. Never mutate the credential clients are currently using.

---

## Cloud Metadata SSRF and IMDSv2

The platform-identity approach that solves secret-zero has its **own** attack: the cloud
**Instance Metadata Service (IMDS)** at the link-local address `169.254.169.254` hands out the
instance role's **temporary credentials** to anything that can reach it from the host.

- **The exploit:** a **Server-Side Request Forgery (SSRF)** in an app tricks it into fetching
  `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>` and returning the
  role's temporary keys. This is exactly the **Capital One breach (2019)**: a WAF/SSRF flaw let
  the attacker read IMDS credentials and exfiltrate ~100M records from S3.
- **IMDSv1** is a simple unauthenticated `GET` — trivially reachable via reflected SSRF.
- **IMDSv2** requires a **session-oriented flow**: a `PUT` to `/latest/api/token` (with a TTL
  header) returns a token that must be sent in `X-aws-ec2-metadata-token` on every `GET`. Most
  SSRF primitives can only issue `GET`s (or can't set arbitrary headers), so IMDSv2 **defeats
  the common SSRF**.
- **Enforce it:** `HttpTokens=required` (reject IMDSv1) and **`HttpPutResponseHopLimit=1`** so
  a token response can't be routed out of the instance (e.g. through a container network to a
  proxied attacker).

> [!INTERVIEW]
> "Your app has an SSRF and runs on a cloud VM with an IAM role — what's the risk and the
> fix?" Risk: SSRF to `169.254.169.254` steals the role's temp credentials (Capital One). Fix:
> enforce **IMDSv2** (`HttpTokens=required`, hop limit 1), plus least-privilege role scoping
> and fixing the SSRF itself.

---

## CI/CD Secret Theft and OIDC Federation

CI/CD pipelines hold high-value secrets (cloud keys, signing keys, registry creds) and have
CI-specific theft techniques beyond "secrets in logs."

- **`pull_request_target` + untrusted checkout (GitHub Actions).** Unlike `pull_request`,
  `pull_request_target` runs in the context of the **base** repo with **access to
  `secrets.*`**. If the workflow then checks out and executes the **fork's untrusted code**
  (build scripts, `npm install` lifecycle hooks), that attacker code runs with the secrets in
  scope and can exfiltrate them. **Fix:** never check out or execute untrusted PR code in a
  secret-bearing context.
- **Self-hosted runner poisoning.** A public repo's self-hosted runner executes arbitrary PR
  code on your infrastructure; use **ephemeral, isolated** runners and don't attach standing
  credentials.
- **Log-mask bypass.** CI masks known secret strings in logs, but attackers can defeat masking
  by transforming the value (base64/hex/char-splitting) before printing. Masking is a
  backstop, not a control.
- **The real fix — OIDC federation (no static cloud keys in CI).** GitHub Actions / GitLab
  issue a short-lived **OIDC ID token** describing the workflow (repo, ref, environment). The
  cloud exchanges it for temporary credentials via **`AssumeRoleWithWebIdentity`**, with the
  trust policy scoped to `sub`/`aud` claims (e.g. only `repo:org/name:ref:refs/heads/main`).
  Result: **no long-lived cloud access keys are stored in CI at all** — the classic
  CircleCI-style mass-secret-theft blast radius disappears.

> [!INTERVIEW]
> "Your CI leaked env secrets to a forked PR — root cause and fix?" Root cause:
> `pull_request_target` running untrusted forked code with `secrets.*` in scope. Fix: don't
> execute untrusted refs in a privileged context, and move to **OIDC federation** so there are
> no static cloud keys to steal.

---

## Secrets in Memory and In-Use Protection

At-rest and in-transit are well covered; the **third state, "in use," lives in process memory**
and has its own hygiene rules and threats.

- **Use mutable buffers, not immutable `String`.** Immutable strings (Java `String`, many
  managed languages) can't be reliably overwritten, may be **interned**, and linger until GC —
  so they show up in **heap/core dumps**. Hold secrets in `byte[]`/`char[]` and **zeroize
  (overwrite) after use**. OWASP's Secrets Management Cheat Sheet calls this out explicitly.
- **Memory-disclosure threats:** process **crash/core dumps** and heap dumps, **swap /
  hibernation files** written to disk, **cold-boot attacks** (RAM retains bits after power
  loss), and side channels like **Meltdown/Spectre** (speculative-execution cross-boundary
  reads) and **Rowhammer**. Mitigations: lock pages (`mlock`) to prevent swapping, disable
  core dumps for the process, encrypt swap, minimize the plaintext's dwell time.
- **In-use protection with confidential computing (TEEs).** A **Trusted Execution Environment**
  keeps plaintext secrets out of reach of the host OS/hypervisor/root: **AWS Nitro Enclaves**,
  **Intel SGX**, **AMD SEV-SNP**. Crucially, **cryptographic attestation** lets a KMS release a
  key **only to a verified enclave measurement** — so even a root user on the parent instance
  can't read the plaintext. This is the modern answer to "process a secret without the host
  seeing it."

---

## SPIFFE/SPIRE Workload Attestation

SPIFFE/SPIRE is the "bottom turtle" for secret-zero: it establishes **cryptographic workload
identity with no bootstrap secret**, via a **two-stage attestation chain**.

1. **Node attestation** — the SPIRE **agent** proves the *node* it runs on to the SPIRE
   **server** using a platform signal it can't forge: a cloud **instance identity document**,
   a **Kubernetes projected SA token**, or a **TPM** quote.
2. **Workload attestation** — when a local process calls the **Workload API** (over a Unix
   domain socket), the agent inspects verifiable OS/orchestrator attributes of the *calling
   process*: Kubernetes **pod/namespace/service account**, Unix **UID/GID**, container image.
   No secret is presented — identity derives from *what the workload is*.
3. The agent issues a short-lived, **auto-rotated SVID**: an **X.509-SVID** (cert for mTLS) or
   **JWT-SVID** (bearer for APIs). Identity is a URI: `spiffe://<trust-domain>/<path>`, e.g.
   `spiffe://prod.acme/ns/payments/sa/api`.

Because SVIDs are short-lived and auto-rotated and the whole chain roots in unforgeable
platform facts, there is **no long-lived credential to steal** — the terminal answer to "how
does the very first identity get established without a secret?"

---

## Data-Key Caching and KMS Scaling

Envelope encryption's "call KMS to unwrap per object" hits **KMS request quotas, latency, and
cost** at high volume. Practical mitigations:

- **Data-key caching (AWS Encryption SDK).** Reuse a cached plaintext DEK across multiple
  encrypt operations within bounded limits — **max age**, **max messages/bytes per key**, and
  **max cache size**. This trades a small, deliberate reduction in key isolation for far fewer
  KMS calls; the limits must stay well under the AES-GCM **key-exhaustion / ~2^32** bound.
- **S3 Bucket Keys.** S3 uses one **bucket-level data key** to derive per-object keys, cutting
  KMS `GenerateDataKey`/`Decrypt` calls (and cost) by orders of magnitude versus one KMS call
  per object — reducing throttling on high-traffic buckets.

> [!WARNING]
> Data-key caching is a security/performance trade-off: a longer-lived cached DEK widens its
> blast radius and message count. Tune `max_age`/`max_messages` conservatively and never let a
> cached key exceed the GCM invocation limit.

---

## Break-Glass and Emergency Access

**Break-glass** is pre-provisioned emergency access for when normal auth is unavailable (the
secret manager itself is down, IdP outage, incident). Done right it is tightly controlled:

- **Stored in a *secondary* system** — not the same secrets manager it would be used to
  recover (or you can't reach it in the exact outage you need it for). Sealed, offline, or in a
  separate vault.
- **Multi-party / split control.** Vault's **Shamir seal** splits the unseal key into shares
  (e.g. 3-of-5) held by different operators, so no single person can unseal; **auto-unseal**
  delegates this to a KMS/HSM. Break-glass creds themselves can be split similarly.
- **Heavily audited and alarmed.** Any *use* of a break-glass credential fires an immediate
  alert to security and starts an incident review — its use is expected to be rare and always
  investigated.
- **Rotated and tested routinely** — dormant emergency creds rot; exercise the procedure and
  rotate afterward. Know how to **revoke a Vault root token** (generate one only for a specific
  operation, then revoke it) so no standing super-credential exists.

---

## Named Incidents and Lessons

Concrete cases interviewers use in scenario/behavioral rounds:

- **CircleCI (Jan 2023).** Malware on an engineer's laptop stole a valid **SSO session token**
  (bypassing MFA), giving access to production; **customer environment variables, tokens, and
  keys were exfiltrated**, forcing a mass customer-wide rotation event. *Lesson:* short-lived
  creds + **OIDC** so there are no static secrets to steal; device trust; session-token
  protection.
- **Microsoft AI research (2023).** A researcher shared training data via an Azure **SAS
  token** that was **over-scoped and long-lived**, accidentally exposing **~38 TB** including
  internal secrets and backups. *Lesson:* SAS/pre-signed URLs must be **least-privilege,
  narrowly scoped, and short-TTL**.
- **Capital One (2019).** SSRF → **IMDSv1** credential theft → S3 exfiltration of ~100M
  records. *Lesson:* enforce **IMDSv2** + least-privilege instance roles. (See the metadata
  section.)
- **Toyota / Mercedes / Sisense.** Hardcoded credentials and leaked GitHub/registry tokens led
  to source and customer-data exposure. *Lesson:* secret scanning + no long-lived static creds.
- **GitGuardian State of Secrets Sprawl 2024.** ~**12.8M** secrets leaked publicly in 2023
  (+28% YoY); **>90% of leaked secrets were still valid five days after detection** ("zombie"
  secrets), and leaked OpenAI keys surged ~1212×. *Lesson:* detection without **fast rotation**
  is nearly worthless — most orgs don't rotate.

> [!INTERVIEW]
> When asked "what went wrong and what control prevents it," name the incident and the *single
> control*: CircleCI → short-lived creds/OIDC; Capital One → IMDSv2; MS 38 TB → scoped
> short-TTL SAS; zombie secrets → automated rotation, not just scanning.

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
  clone recovers it. Assume compromised and rotate. Rewriting history (BFG/`git filter-repo`)
  also **changes commit SHAs**, and forks/mirrors/caches keep the old blob — so rewriting is
  cosmetic; **rotation is the only real fix**.
- **"Delete one tenant's data from immutable backups — how?"** Crypto-shredding: per-tenant
  DEK, destroy the DEK; state the caveat that any surviving key copy defeats it.
- **"Prove the cloud provider can never read our data."** External Key Store / XKS (or HYOK):
  KEK stays in your on-prem HSM, every decrypt calls out through a proxy, block it = kill
  switch. BYOK does **not** qualify — the imported key lives in the cloud KMS.
- **"Zero-downtime DB password rotation?"** Alternating two-user strategy with
  `AWSPENDING`/`AWSCURRENT` staging; rotate the idle credential, test, then flip.
- **"Your CI leaked env secrets to a forked PR — root cause and fix?"**
  `pull_request_target` running untrusted checkout with `secrets.*` in scope; fix is OIDC
  federation (`AssumeRoleWithWebIdentity`) so no static keys exist.
- **"What FIPS 140 level zeroizes keys on tamper?"** Level 3 (tamper *response*); Level 2 is
  tamper *evidence* only.
- **"Why does one DEK per object matter cryptographically?"** AES-GCM nonce reuse / key
  exhaustion (~2^32 messages), not just blast radius.
- **"Attacker got your KEK vs a DEK — what's exposed?"** KEK unwraps all DEKs → everything; a
  single DEK → only its one object/tenant slice.

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
- NIST **SP 800-88 Rev 1**, Media Sanitization (cryptographic erase):
  https://csrc.nist.gov/pubs/sp/800/88/r1/final
- NIST **SP 800-38D**, GCM/GMAC (nonce uniqueness, invocation limits):
  https://csrc.nist.gov/pubs/sp/800/38/d/final
- **FIPS 140-3** (ISO/IEC 19790:2012) & CMVP security levels:
  https://csrc.nist.gov/pubs/fips/140-3/final
- AWS KMS — External Key Store (XKS) & key origins:
  https://docs.aws.amazon.com/kms/latest/developerguide/keystore-external.html
- AWS Secrets Manager — Lambda rotation function & staging labels
  (`AWSCURRENT`/`AWSPENDING`, alternating-users):
  https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html
- AWS — Instance Metadata Service v2 (IMDSv2, `HttpTokens`, hop limit):
  https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
- GitHub Actions — OpenID Connect (`AssumeRoleWithWebIdentity`) & `pull_request_target`
  risks: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- SPIFFE/SPIRE — SVID, Workload API, node/workload attestation:
  https://spiffe.io/docs/latest/spiffe-about/overview/
- AWS Encryption SDK — Data key caching:
  https://docs.aws.amazon.com/encryption-sdk/latest/developer-guide/data-key-caching.html
- GitGuardian — State of Secrets Sprawl 2024:
  https://www.gitguardian.com/state-of-secrets-sprawl-report-2024
