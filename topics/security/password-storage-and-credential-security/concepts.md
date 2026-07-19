# Password Storage & Credential Security

How a service stores and verifies user passwords is one of the highest-leverage
security decisions it makes: a single database leak turns every stored credential
into an offline cracking target, and password reuse means a crack here becomes an
account takeover *everywhere*. This topic is framework-agnostic — it teaches the
threat model (offline cracking, credential stuffing, replay) and the defenses
(adaptive hashing, salting/peppering, breached-password checks, throttling) as they
actually work, grounded in OWASP and NIST SP 800-63B.

> [!KEY-TAKEAWAY]
> The one-liner every interviewer wants: store passwords using a **salted, adaptive,
> memory-hard one-way hash** — **Argon2id** by default (or scrypt/bcrypt/PBKDF2 as
> alternatives) — never plaintext, never reversible encryption, and never a fast
> general-purpose hash like MD5/SHA-1/SHA-256.

---

## Why never plaintext, encrypted, or fast hashes

Three tempting-but-wrong ways to store passwords, in increasing order of subtlety:

**1. Plaintext.** The password is stored verbatim. A single `SELECT * FROM users`
via SQL injection, a leaked backup, or a curious DBA exposes every credential
directly. It also means the site can *email you your password* — a dead giveaway of
plaintext storage. This is an automatic fail and maps to OWASP A02:2021 —
Cryptographic Failures.

**2. Reversible encryption.** Storing `AES(password, key)` seems better, but it is
still fundamentally reversible: whoever holds the key holds every password. The key
must live somewhere the app can reach it, so an attacker who gets the database
usually gets (or eventually gets) the key too — app config, environment, or an HSM
that the compromised app can call. Passwords should be verified, not recovered, so
there is **no legitimate reason** the system needs to decrypt them.

**3. Fast/general-purpose hashes (MD5, SHA-1, SHA-256, SHA-512, unsalted).** Hashing
is one-way, which is the right idea, but general-purpose hashes are designed to be
*fast* — that is exactly wrong for passwords. Speed helps the attacker: modern GPUs
and ASICs compute **billions to hundreds of billions** of MD5/SHA-1 hashes per
second. Combined with the fact that human passwords have low entropy, an attacker who
steals the hash table can crack most passwords offline in hours.

| Storage method | Reversible? | Offline-crack resistant? | Verdict |
|---|---|---|---|
| Plaintext | n/a | No | Never |
| Encrypted (AES, etc.) | Yes (key holder) | No | Never for passwords |
| Fast hash (MD5/SHA-256), unsalted | No | No (too fast, rainbow tables) | Never |
| Fast hash + salt | No | Still no (billions/sec) | Insufficient |
| Adaptive hash (Argon2id/bcrypt/scrypt/PBKDF2) + salt | No | Yes (deliberately slow) | Correct |

> [!WARNING]
> MD5 and SHA-1 are **cryptographically broken** for collision resistance (MD5 since
> ~2004, SHA-1's SHAttered collision in 2017). But even if they weren't, their *speed*
> makes them unfit for passwords. Passwords need a *slow*, tunable function — the
> opposite design goal of a message-digest hash.

---

## Salting: per-user, unique, and its purpose

A **salt** is a unique, random value generated per password and stored (in the clear)
alongside the resulting hash. The verifier computes `hash(salt || password)` and
compares.

Salting defeats **precomputation** attacks:

- **Identical passwords produce different hashes.** Two users who both pick
  `hunter2` get different stored hashes, so an attacker can't spot shared passwords
  and can't crack them both at once.
- **Rainbow tables become useless.** A rainbow table is a precomputed
  hash→plaintext lookup. A unique per-user salt means the attacker would need a
  separate table *per salt* — precomputation is destroyed. The attacker is forced
  into per-user brute force.

Properties of a good salt:

- **Unique per password** (per-user, and re-generated on password change) — not a
  single global salt. A global salt still lets one rainbow table crack the whole DB.
- **Random**, from a CSPRNG. NIST SP 800-63B requires **at least 32 bits**; OWASP and
  common practice use **16 bytes (128 bits)** or more. Modern algorithms (bcrypt,
  Argon2, scrypt) generate and embed the salt for you.
- **Not secret.** The salt is stored with the hash. Its job is uniqueness, not
  secrecy. It is fine — expected — that the attacker who has the hash also has the
  salt.

> [!TIP]
> Modern password-hash outputs are *self-describing*: a bcrypt or Argon2 "PHC string"
> like `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` embeds the algorithm, its
> parameters, the salt, and the hash. You store that one string; verification re-reads
> the parameters from it. You do **not** manage a separate salt column.

---

## Peppering: an application-level secret

A **pepper** is a secret value added to the hashing process that, unlike a salt, is
**not stored in the database** — it lives outside it (app config, a secrets manager,
or an HSM). It is typically the *same* value shared across all users (contrast: salts
are unique per user).

The threat it addresses: a database-only compromise (leaked backup, SQL injection,
read-only breach) where the attacker gets the hashes+salts but *not* the application's
secrets. Without the pepper, the stolen hashes can't be attacked offline.

Two correct constructions (OWASP):

- **Pre-hash HMAC (recommended):** `argon2id( HMAC-SHA256(password, pepper) )` or,
  for bcrypt, `bcrypt( base64( HMAC-SHA384(password, pepper) ) )`. Using an HMAC
  keyed by the pepper *before* the slow hash avoids the raw-concatenation problems.
- NIST SP 800-63B frames this as "an additional iteration of a keyed one-way function
  using a **secret salt**" that **SHALL be stored separately** (e.g., in an HSM),
  providing at least 112 bits of security.

Caveats interviewers probe:

- A pepper **alone provides no benefit** if the attacker also compromises the app
  secret — it is *defense in depth*, layered on top of proper salted adaptive hashing.
- **Naive concatenation `hash(pepper || password)` is discouraged.** Use HMAC or
  encrypt the hash with the pepper as the key, so the pepper can be rotated and so
  you avoid length/null-byte pitfalls.
- **Pepper rotation is hard:** because it's shared and applied at hash time, changing
  it invalidates every stored hash. Encrypting the hash with the pepper (rather than
  mixing it into the hash) makes rotation feasible: decrypt-then-re-encrypt.

---

## Adaptive and memory-hard password hashes

Password hashes must be **deliberately slow and tunable** ("work factor") so that as
hardware gets faster you raise the cost, keeping the attacker's per-guess cost high
while a single legitimate login stays cheap (tens to a few hundred ms). This is why
they're called *adaptive*. **Memory-hard** functions additionally force each guess to
consume a lot of RAM, which neutralizes the huge parallelism advantage of GPUs/ASICs
(memory is expensive to replicate per core).

OWASP preference order: **Argon2id → scrypt → bcrypt → PBKDF2** (PBKDF2 chiefly for
FIPS-140 compliance).

### Argon2id (recommended default)

Winner of the 2015 Password Hashing Competition. The `id` variant is a hybrid of
Argon2i (side-channel resistant) and Argon2d (GPU-resistant) and is the recommended
mode. Three parameters:

- **m** — memory in KiB
- **t** — iterations (time cost)
- **p** — parallelism (lanes/threads)

OWASP minimum configs (equivalent strength, trading memory vs. CPU):

| m (memory) | t (iterations) | p |
|---|---|---|
| 47104 KiB (46 MiB) | 1 | 1 |
| **19456 KiB (19 MiB)** | **2** | **1** |
| 12288 KiB (12 MiB) | 3 | 1 |
| 9216 KiB (9 MiB) | 4 | 1 |
| 7168 KiB (7 MiB) | 5 | 1 |

### scrypt

A memory-hard KDF (RFC 7914). Parameters: **N** (CPU/memory cost, a power of two),
**r** (block size), **p** (parallelization). OWASP baseline: **N=2^17 (128 MiB),
r=8, p=1**. Use if Argon2id is unavailable.

### bcrypt

Based on the Blowfish cipher, in wide use since 1999. Single tunable **cost/work
factor** (log2 of rounds); OWASP recommends **≥ 10** (each +1 doubles the work). Its
main limitations (see next subtopic): a hard **72-byte input limit** and it is *not*
memory-hard. Fine for legacy systems; prefer Argon2id/scrypt for new ones.

### PBKDF2

The oldest, FIPS-140-approved option (NIST SP 800-132; also used in WPA2, etc.). It
is only CPU-hard (not memory-hard), so it's the *weakest* against GPU attacks — its
value is FIPS compliance. Tunable **iteration count**; OWASP current guidance:

- PBKDF2-HMAC-SHA256: **600,000** iterations
- PBKDF2-HMAC-SHA512: **210,000** iterations
- PBKDF2-HMAC-SHA1: 1,300,000 (legacy only)

NIST's floor is "at least 10,000 iterations" (SP 800-63B) — treat that as an absolute
minimum, not a target; use OWASP's much-higher numbers for real deployments.

> [!INTERVIEW]
> "Why not just SHA-256 many times in a loop?" That's essentially what PBKDF2 does —
> but rolling your own is error-prone, and crucially it's still *not memory-hard*, so
> GPUs shred it far faster than Argon2id/scrypt. Use a vetted, memory-hard KDF.

---

## bcrypt's 72-byte limit and password shucking

Two bcrypt-specific gotchas that interviewers love:

**1. The 72-byte truncation.** bcrypt only processes the **first 72 bytes** of input;
anything beyond is silently ignored. A 100-character passphrase is effectively
truncated. Two consequences:
- Enforce a max length ≤ 72 bytes, or communicate the truncation, so users don't get
  a false sense of extra security.
- Some implementations also mishandle a **NUL byte** in the input (Blowfish is a
  C-string cipher), truncating there.

**2. Password shucking.** A *dangerous anti-pattern* is pre-hashing to get around the
72-byte limit by doing `bcrypt(sha256(password))`. Because SHA-256 output is
predictable and unsalted, an attacker who already possesses a *separate* breach of
`sha256(password)` values (from some other broken site) can feed those directly into
the bcrypt verifier offline — "shucking" the bcrypt layer using the pre-existing fast
hashes. The fix is to pre-hash with a **keyed** function that the attacker can't
reproduce: `bcrypt( base64( HMAC-SHA384(password, pepper) ) )`. The HMAC key (pepper)
also handles the NUL-byte and length issues cleanly.

> [!WARNING]
> `bcrypt(sha256(password))` looks like a clever way to support long passwords but it
> reintroduces a fast-hash weakness and enables shucking. If you must pre-hash, use
> `HMAC` with a secret key, base64-encode (to avoid NUL bytes), *then* bcrypt.

---

## Timing-safe comparison

When verifying a password (or any secret: HMAC, token, API key), comparing the
computed value against the stored value with an ordinary `==` / `memcmp` /
`String.equals` leaks information through **timing**: those comparisons return as soon
as they hit the first differing byte, so a matching prefix takes measurably longer.
Over many requests an attacker can recover a secret byte-by-byte — a **timing side
channel**.

- Use a **constant-time comparison** that always examines all bytes:
  `crypto.timingSafeEqual`, `hmac.compare_digest`, `MessageDigest.isEqual`,
  `constant_time_compare`, etc.
- **For the password field specifically**, the adaptive hash already dominates timing
  and the comparison is over a fixed-length hash, so the risk is lower — but the
  discipline matters most for comparing **tokens, session IDs, HMAC signatures, and
  API keys**, which are checked directly.
- A subtler defense: don't reveal *which* factor failed. Return the same generic error
  and similar timing whether the **username doesn't exist** or the **password is
  wrong** — otherwise you leak valid usernames (user enumeration). A common trick is
  to hash a dummy password even when the user isn't found, so the response time is
  similar.

---

## Credential attacks: stuffing, brute force, dictionary, rainbow tables

Know the taxonomy — interviewers test whether you can tell these apart and which
defense stops which.

| Attack | Where it happens | What it needs | Primary defense |
|---|---|---|---|
| **Brute force** | Online (login) or offline (stolen hashes) | Compute over the keyspace | Slow adaptive hash (offline); rate limiting (online) |
| **Dictionary** | Online or offline | A wordlist of likely passwords | Same as brute force + breached-password checks |
| **Rainbow tables** | Offline | Precomputed hash→plaintext tables | **Per-user salt** (destroys precomputation) |
| **Credential stuffing** | Online | A list of `email:password` pairs from *other* breaches | MFA, breached-pw checks, bot/anomaly detection, rate limiting |

Key distinctions:

- **Brute force** tries all combinations; **dictionary** tries a curated list of
  likely passwords first (far more efficient against human passwords).
- **Rainbow tables** are a *time-memory trade-off* for reversing *unsalted* fast
  hashes. A unique salt makes them worthless — this is the canonical "why do we salt"
  answer. Note salting does **not** slow down a targeted brute force of one hash; the
  *adaptive/slow* hash does that.
- **Credential stuffing** does **not** attack your password storage at all. The
  attacker already has valid plaintext passwords from *another* site's breach and
  simply replays `email:password` pairs against your login, betting on **password
  reuse**. A strong Argon2id hash does nothing to stop it — the defenses are **MFA**,
  **breached-password screening**, **bot detection / device fingerprinting**,
  **rate limiting**, and watching for the tell-tale pattern of many logins each with a
  *different* username (low failure-per-account, high account count).

> [!KEY-TAKEAWAY]
> Salt defeats **precomputation** (rainbow tables) and cross-user correlation. The
> **slow/adaptive** hash defeats **offline brute force**. **Rate limiting + MFA +
> breached-password checks** defeat **online** brute force and **credential stuffing**.
> Different problems, different tools.

---

## Breached-password checks (k-anonymity / HIBP range API)

NIST SP 800-63B **requires** verifiers to screen new/changed passwords against a list
of values "known to be commonly-used, expected, or compromised" (breach corpuses,
dictionary words, sequential/repeated characters, context-specific terms) and reject
them. This stops users from picking a password that's already in an attacker's
credential-stuffing list.

The **Have I Been Pwned (HIBP) Pwned Passwords range API** lets you check without
sending the password (or even its full hash) anywhere, using **k-anonymity**:

1. Client computes `SHA1(password)` → 40 hex chars.
2. Client sends only the **first 5 hex chars** (the prefix) to
   `GET https://api.pwnedpasswords.com/range/{prefix}`.
3. Server returns *all* suffixes (the remaining 35 chars) that share that prefix,
   each with a breach count — typically several hundred to a thousand candidates.
4. Client checks locally whether the rest of its hash's suffix appears in the list.

The server never learns the full hash or the password; it only ever sees a 5-char
prefix shared by many possible passwords — that's the k-anonymity guarantee. (HIBP
also offers an `Add-Padding` header to defeat traffic-size analysis, and an
NTLM-hash variant.)

> [!TIP]
> Screen at **registration and password change**, giving actionable feedback
> ("this password has appeared in data breaches; choose another"). Screening should
> reject compromised passwords *without* imposing arbitrary composition rules — that's
> the NIST-endorsed replacement for "1 uppercase, 1 digit, 1 symbol" theater.

---

## NIST SP 800-63B password policy and the rotation myth

NIST Special Publication 800-63B (Digital Identity Guidelines) modernized password
rules. What it says about "memorized secrets":

- **Length over complexity.** Allow at least **8** characters minimum (SHALL), support
  at least **64** (SHOULD), accept **all** printable ASCII, Unicode, and spaces, and
  **do not truncate**.
- **No composition rules.** Verifiers **SHOULD NOT** require mixtures of character
  types (upper/lower/digit/symbol). These rules push users toward predictable patterns
  (`Password1!`) and don't add real entropy.
- **The rotation myth — no periodic expiry.** Verifiers **SHOULD NOT** require
  passwords to be changed arbitrarily/periodically (e.g., every 90 days). Forced
  rotation causes users to pick weaker, incremental passwords (`Spring2026!` →
  `Summer2026!`) and to reuse patterns. **Only force a change on *evidence of
  compromise*.** This overturns decades of "expire every 90 days" policy.
- **Screen against breach/dictionary lists** (previous subtopic) — the real defense.
- **Allow paste** and offer a **"show password"** toggle — both help password managers
  and reduce entry errors, improving security in practice.
- **Store salted + hashed** with an approved KDF; **rate-limit** failed attempts.
- **No password hints** or knowledge-based "security questions" (mother's maiden name,
  etc.) as they're often guessable/public.

> [!INTERVIEW]
> The "rotation myth" is a favorite question. Crisp answer: *NIST SP 800-63B says do
> NOT force periodic password changes; rotate only on evidence of compromise, because
> forced rotation makes users choose weaker, predictable variants and encourages
> reuse. Prioritize length, breached-password screening, and MFA instead.*

---

## Account lockout vs. throttling and rate limiting

Both defend the **online** login endpoint against brute force / credential stuffing,
but they trade off security against availability and usability differently.

**Account lockout** disables an account after N consecutive failures (e.g., lock for
15 min after 5 fails).
- *Pro:* simple, decisively stops sustained guessing of one account.
- *Con:* enables a **denial-of-service** — an attacker who knows your username can
  lock you out at will. Also gives a **user-enumeration** signal if lockout behavior
  differs for real vs. fake accounts. Permanent lockout requiring admin unlock is an
  operational and DoS burden.

**Throttling / rate limiting** slows attempts rather than blocking the account:
progressive delays (exponential backoff), per-IP and per-account limits, CAPTCHA after
a threshold, and device/risk signals.
- *Pro:* preserves availability (legitimate user isn't locked out), still crushes
  automated guessing (a few tries/min is useless to an attacker).
- *Con:* IP-based limits can be evaded by distributed/rotating IPs (botnets, proxies)
  and can punish users behind shared NAT/CGNAT.

NIST SP 800-63B: verifiers **SHALL** limit failed attempts — no more than **100**
consecutive failed attempts on a single account — and recommends layering rate
limiting, CAPTCHA, and risk-based throttling rather than blunt permanent lockout.

Good practice combines them: throttle by IP *and* account, use exponential backoff,
add CAPTCHA/step-up after several failures, and reserve full lockout for extreme cases
— while relying on **MFA** and **breached-password checks** as the durable defenses
against credential stuffing (which spreads few guesses across *many* accounts and thus
often slips under per-account thresholds).

---

## Rehashing and credential migration

Because work factors must rise over time and algorithms get deprecated, you need a
**seamless upgrade path** — you cannot re-hash a password you don't have in plaintext,
so migration happens **at login**, the one moment the plaintext is available:

- On successful login, check whether the stored hash uses outdated
  parameters/algorithm (the PHC string tells you). If so, re-hash the just-verified
  plaintext with the new algorithm/cost and overwrite the stored value.
- To migrate *off a broken fast hash* (e.g., a legacy `md5(password)` table) without
  waiting for each user to log in, **wrap the old hash**: store
  `argon2id( md5(password) )` for everyone immediately, then peel off the inner layer
  on next login. This upgrades the whole table at once and removes the naked fast hash.
- Store the algorithm identifier and parameters *with* each hash (PHC string) so the
  verifier supports multiple formats during the transition and knows when to upgrade.

---

## Common follow-up questions

- **"Walk me through storing a password from registration to login."** CSPRNG salt →
  Argon2id with tuned params → store the PHC string; on login, re-derive with the
  embedded salt/params, constant-time compare, and re-hash if params are outdated.
- **"Why is a salt not secret but a pepper is?"** Salt's job is *uniqueness* to defeat
  precomputation; it's fine for the attacker to have it. The pepper's job is *secrecy*
  — kept out of the DB so a DB-only breach yields uncrackable hashes.
- **"You have a legacy `sha256(password)` table and can't force everyone to reset. How
  do you migrate?"** Wrap: store `argon2id(sha256(password))` now; unwrap on next login.
- **"How do you pick Argon2id parameters?"** Benchmark on production hardware to a
  target verify time (~250–500 ms) at the highest memory you can afford; start from
  OWASP's m=19 MiB, t=2, p=1 and tune up.
- **"How does rate limiting stop credential stuffing if the attacker rotates IPs and
  each account only sees one attempt?"** It doesn't, alone — that's why you add
  breached-password screening, MFA, bot/device detection, and impossible-travel/risk
  scoring.
- **"Is bcrypt still OK in 2026?"** Acceptable for existing systems at cost ≥ 10, but
  it isn't memory-hard and truncates at 72 bytes; prefer Argon2id for new work.
- **"Why not encrypt passwords so we can recover them?"** You never need to recover a
  password, only verify it; encryption is reversible and the key is a single point of
  total compromise.

## References

- OWASP Cheat Sheet Series — *Password Storage Cheat Sheet* (Argon2id/scrypt/bcrypt/
  PBKDF2 parameters, peppering, shucking): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Cheat Sheet Series — *Authentication Cheat Sheet* (lockout, throttling,
  breached-password checks): https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Cheat Sheet Series — *Credential Stuffing Prevention Cheat Sheet*: https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html
- NIST SP 800-63B — *Digital Identity Guidelines: Authentication and Lifecycle Management* (§5.1.1 Memorized Secrets): https://pages.nist.gov/800-63-3/sp800-63b.html
- NIST SP 800-132 — *Recommendation for Password-Based Key Derivation (PBKDF2)*: https://csrc.nist.gov/pubs/sp/800/132/final
- OWASP Top 10 2021 — A02: Cryptographic Failures & A07: Identification and Authentication Failures: https://owasp.org/Top10/
- RFC 7914 — *The scrypt Password-Based Key Derivation Function*: https://www.rfc-editor.org/rfc/rfc7914
- RFC 9106 — *Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work*: https://www.rfc-editor.org/rfc/rfc9106
- Have I Been Pwned — *Pwned Passwords / k-anonymity range API*: https://haveibeenpwned.com/API/v3#PwnedPasswords
