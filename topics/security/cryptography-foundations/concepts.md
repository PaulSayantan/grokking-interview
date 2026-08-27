# Cryptography Foundations: Symmetric, Asymmetric, Hashing & Signatures

Cryptography gives applications the primitives that enforce **confidentiality**
(encryption), **integrity** (MACs, hashes, signatures), **authenticity** (signatures,
AEAD), and **non-repudiation** (signatures). This topic teaches the primitives themselves
and how to use them correctly. It deliberately does **not** re-teach the TLS handshake
(that belongs to the networking domain) nor OAuth/JWT token mechanics (those belong to the
API/token topics) — here we focus on the building blocks and the ways they get misused.

> [!KEY-TAKEAWAY]
> The overwhelming majority of real-world crypto failures are **misuse of correct
> primitives** — ECB mode, reused nonces, `Math.random()` for tokens, unauthenticated
> encryption, MD5 for passwords — not broken algorithms. "Don't roll your own crypto"
> mostly means "don't assemble primitives yourself; use a vetted high-level construction."

---

## Symmetric Encryption and AES

**Symmetric encryption** uses a **single shared secret key** for both encryption and
decryption. It is fast (hardware-accelerated), so it does the bulk work of protecting data.
Its problem is **key distribution**: both parties must already share the secret over some
secure channel.

**AES (Advanced Encryption Standard, FIPS 197)** is the de-facto symmetric cipher. It is a
**block cipher** operating on **128-bit (16-byte) blocks**, with key sizes of **128, 192,
or 256 bits**. AES-128 and AES-256 are both considered secure; AES-256 is chosen mainly for
long-term/post-quantum margin (Grover's algorithm roughly halves the effective key
strength, so AES-256 gives ~128-bit post-quantum security).

**Block vs stream ciphers:**

| | Block cipher | Stream cipher |
|---|---|---|
| Unit | Fixed-size blocks (AES = 128 bit) | Bit/byte at a time (keystream XOR) |
| Examples | AES, 3DES (legacy) | ChaCha20, RC4 (broken) |
| Needs | A **mode of operation** to encrypt >1 block | A unique nonce per message |
| Note | AES in CTR/GCM *becomes* a stream cipher | ChaCha20-Poly1305 is a modern AEAD stream |

> [!TIP]
> ChaCha20-Poly1305 (RFC 8439) is the leading stream-cipher AEAD, preferred on devices
> without AES hardware (older mobile) because software AES is slower and can leak timing.

Key gotchas an interviewer probes:
- A raw block cipher only encrypts exactly one block. Encrypting real data requires a
  **mode of operation** (next section). The mode — not "AES" — is where most bugs live.
- Symmetric crypto gives confidentiality but, by itself (in a non-AEAD mode), **not
  integrity**. An attacker can flip ciphertext bits. You need a MAC or an AEAD mode.

---

## Block Cipher Modes and AEAD

A **mode of operation** (NIST SP 800-38 series) defines how to apply a block cipher across
multiple blocks. The choice of mode is where confidentiality and integrity are won or lost.

**ECB (Electronic Codebook) — never use it.** Each block is encrypted independently with
the same key, so **identical plaintext blocks produce identical ciphertext blocks**. This
leaks structure: the classic "ECB Penguin" image is still recognizable after encryption
because repeating pixel patterns map to repeating ciphertext. ECB also allows blocks to be
reordered/replayed. It provides neither semantic security nor integrity.

**CBC (Cipher Block Chaining).** Each plaintext block is XORed with the previous
ciphertext block before encryption; the first block uses a random **IV**. This hides
repetition, but:
- The IV must be **random and unpredictable** per message (a predictable IV enabled the
  TLS BEAST attack).
- CBC needs **padding** (PKCS#7), which historically enabled **padding-oracle attacks**
  (e.g., Vaudenay, POODLE) when the receiver reveals padding-valid vs invalid.
- CBC provides **no integrity** on its own — you must add a MAC (encrypt-then-MAC).

**CTR (Counter).** Turns a block cipher into a stream cipher: encrypt a counter
(nonce‖counter) and XOR with plaintext. Parallelizable, no padding, random access. But it
is **malleable** and provides **no integrity** — bit flips in ciphertext flip the same bits
in plaintext. And **nonce reuse is catastrophic** (see next section).

**GCM (Galois/Counter Mode) — the modern default.** CTR mode for confidentiality **plus** a
GHASH-based authentication tag for integrity. This makes it an **AEAD** cipher.

**AEAD = Authenticated Encryption with Associated Data.** A single primitive that provides
confidentiality **and** integrity/authenticity, and also authenticates (but does not
encrypt) **associated data (AAD)** — e.g., headers, a message sequence number, or a record
type that must be bound to the ciphertext but sent in the clear. Decryption **fails closed**
if the tag doesn't verify. Prefer AEAD (AES-GCM, ChaCha20-Poly1305, AES-CCM) for essentially
all new work.

| Mode | Confidentiality | Integrity | Parallel | Notes |
|---|---|---|---|---|
| ECB | ❌ leaks patterns | ❌ | ✅ | Never use |
| CBC | ✅ (random IV) | ❌ (add MAC) | Decrypt only | Padding-oracle risk |
| CTR | ✅ | ❌ | ✅ | Malleable; nonce-critical |
| GCM (AEAD) | ✅ | ✅ tag | ✅ | Default; nonce-critical |
| ChaCha20-Poly1305 (AEAD) | ✅ | ✅ tag | ✅ | Great in software |

> [!WARNING]
> "Encrypt-then-MAC" is the correct generic composition order. MAC-then-encrypt and
> encrypt-and-MAC have led to real attacks. Better: just use an AEAD mode and never compose
> it yourself.

---

## IV and Nonce Reuse Dangers

An **IV (initialization vector)** or **nonce ("number used once")** makes encrypting the
same plaintext under the same key produce different ciphertext. Its required properties
depend on the mode, and getting them wrong is one of the most common catastrophic bugs.

- **CBC:** IV must be **random and unpredictable**, but may be public (sent alongside
  ciphertext). Predictable IV → chosen-plaintext/BEAST-style attacks.
- **CTR / GCM:** the nonce must be **unique per key** (it need not be secret or random, but
  must never repeat for a given key).

**Why CTR/GCM nonce reuse is catastrophic:** the keystream is a function of (key, nonce).
Reuse the nonce and you produce the **same keystream** for two messages. Then:

```
C1 = P1 XOR KS
C2 = P2 XOR KS
C1 XOR C2 = P1 XOR P2      # keystream cancels — plaintext relationship leaks
```

For **AES-GCM specifically**, nonce reuse is worse than leaking plaintext: it also lets an
attacker **recover the GHASH authentication subkey (H)** and thereby **forge valid tags** for
arbitrary messages — a total break of integrity, not just confidentiality. This is the
"forbidden attack."

**GCM nonce sizing:** GCM nonces are recommended to be **96 bits (12 bytes)**. With random
96-bit nonces the birthday bound limits a single key to roughly **2^32 messages** before
repeat probability grows unsafe (NIST SP 800-38D). For high-volume systems use a
**deterministic counter** or a misuse-resistant AEAD like **AES-GCM-SIV** (RFC 8452), which
degrades gracefully on nonce reuse.

> [!INTERVIEW]
> A favorite question: "You store the same 12-byte nonce in a constant and reuse it for
> every AES-GCM message. What breaks?" Answer: confidentiality (C1⊕C2 leaks P1⊕P2) **and**
> integrity (attacker recovers H and forges tags). Fix: unique nonce per encryption —
> counter or CSPRNG-random 96-bit value, or switch to AES-GCM-SIV.

---

## Asymmetric Encryption RSA and ECC

**Asymmetric (public-key) cryptography** uses a **key pair**: a **public key** (shared
freely) and a **private key** (kept secret). It solves symmetric crypto's key-distribution
problem and enables signatures. It is **much slower** than symmetric crypto, so in practice
it is used to **exchange or wrap a symmetric key** (hybrid encryption), then AES does the
bulk work.

Directionality (the mental model interviewers want):

| Goal | Encrypt/sign with | Decrypt/verify with |
|---|---|---|
| **Confidentiality** | recipient's **public** key | recipient's **private** key |
| **Authenticity/signature** | sender's **private** key | sender's **public** key |

**RSA** — based on the hardness of factoring large integers.
- For encryption, **never use textbook/PKCS#1 v1.5 without care**; use **RSA-OAEP** for
  encryption and **RSA-PSS** for signatures. Raw/"textbook" RSA is deterministic and
  malleable; PKCS#1 v1.5 encryption padding enabled the **Bleichenbacher** oracle attack.
- Needs large keys: **2048-bit minimum today, 3072-bit for ~128-bit security** (SP 800-57).

**ECC (Elliptic Curve Cryptography)** — based on the elliptic-curve discrete-log problem.
Gives equivalent security with **far smaller keys** (256-bit ECC ≈ 3072-bit RSA ≈ 128-bit
symmetric security), meaning faster operations and less bandwidth. Common curves: **P-256
(secp256r1)**, **P-384**, and **Curve25519 / Ed25519**.

Signature schemes on ECC:
- **ECDSA** — the ECC analogue of DSA. **Requires a unique, secret random `k` per
  signature.** Reusing or leaking `k` (or a biased RNG) **leaks the private key** — this is
  exactly how the Sony PS3 and several Bitcoin wallets were compromised. **Deterministic
  ECDSA (RFC 6979)** derives `k` from the key+message to eliminate this class of bug.
- **EdDSA / Ed25519 (RFC 8032)** — modern, fast, **deterministic by design** (no per-signature
  RNG), resistant to many side channels; preferred for new signature work.

> [!WARNING]
> RSA and ECC (factoring / discrete log) are **broken by a large quantum computer**
> (Shor's algorithm). AES and SHA are only weakened (Grover), not broken. This is why
> post-quantum KEMs/signatures (ML-KEM/Kyber, ML-DSA/Dilithium — NIST FIPS 203/204) are
> being deployed for key exchange and signatures, while AES-256 stays fine.

---

## Key Exchange Diffie-Hellman and ECDH

**Diffie–Hellman (DH)** lets two parties who share **no prior secret** derive a shared
secret over a **public channel**, such that an eavesdropper who sees the whole exchange
cannot compute it. It relies on the discrete-log problem: each side sends `g^a` / `g^b`;
both compute `g^{ab}`; the attacker sees `g^a`, `g^b` but can't get `g^{ab}`.

**ECDH** is the elliptic-curve variant — same idea, smaller/faster keys. **X25519**
(Curve25519 ECDH) is the modern favorite.

Two things interviewers want you to nail:

1. **DH provides key agreement, not authentication.** Unauthenticated DH is vulnerable to a
   **man-in-the-middle**: the attacker runs a separate DH with each side. DH must be
   combined with authentication (signatures / certificates / a pre-shared key) to know
   *who* you agreed a key with.
2. **Ephemeral DH gives Forward Secrecy (PFS).** With **ephemeral** keys (DHE/**ECDHE** — a
   fresh key pair per session), compromising a server's long-term private key **later** does
   **not** decrypt **past** recorded sessions, because the session keys were never derived
   from the long-term key alone. Static RSA key transport lacks this: steal the key once,
   decrypt all recorded traffic.

The raw DH output is then run through a **KDF** (e.g., HKDF, RFC 5869) to produce actual
symmetric keys — never use the raw shared secret directly as an AES key.

> [!TIP]
> HKDF has two stages: **extract** (concentrate entropy from the DH secret into a pseudorandom
> key) and **expand** (derive multiple independent keys with context/`info` labels). Use
> distinct `info` labels so, e.g., the client→server and server→client keys differ.

---

## Cryptographic Hash Functions and Properties

A **cryptographic hash function** maps arbitrary-length input to a **fixed-length digest**
(SHA-256 → 256 bits) and is **one-way** and **deterministic**. It underpins integrity
checks, MACs, signatures (you sign the hash), commitments, and content addressing.

The three formal security properties (and the attacks they resist):

| Property | Definition | Broken means |
|---|---|---|
| **Preimage resistance** | Given digest `h`, infeasible to find any `m` with `hash(m)=h` | Can invert the hash / recover input |
| **Second-preimage resistance** | Given `m1`, infeasible to find `m2≠m1` with same hash | Can substitute a specific message |
| **Collision resistance** | Infeasible to find **any** `m1≠m2` with same hash | Can forge equivalent documents |

Collision resistance is the **hardest** to keep, because of the **birthday bound**: finding
a collision in an *n*-bit hash costs ~**2^(n/2)** work, not 2^n. So SHA-256 gives ~128-bit
collision resistance, ~256-bit preimage resistance. This is why digests are sized 256+ bits.

**Current families:**
- **SHA-2** (SHA-256/384/512) — Merkle–Damgård construction; secure and ubiquitous. SHA-256
  is the workhorse. (SHA-256 alone is vulnerable to **length-extension**, which matters for
  naive MAC construction — see HMAC.)
- **SHA-3 (Keccak, FIPS 202)** — sponge construction, structurally different from SHA-2,
  **not** length-extension-vulnerable. A good diversity hedge, not a replacement mandate.
- **BLAKE2/BLAKE3** — very fast modern hashes.

> [!WARNING]
> A cryptographic hash is **not** a password hash and **not** an integrity guarantee against
> an active attacker on its own. `hash(secret‖message)` is **not** a secure MAC (length
> extension); use HMAC. And a plain SHA-256 of a password is trivially brute-forced; use
> Argon2/bcrypt (see KDFs vs password hashes).

---

## Why MD5 and SHA-1 Are Broken

**MD5** and **SHA-1** are broken specifically on **collision resistance** — the property
signatures and certificates depend on.

- **MD5:** practical collisions since 2004–2008; collisions can be generated **in seconds**.
  The **Flame** malware (2012) forged a Microsoft code-signing certificate via an MD5
  chosen-prefix collision. MD5 must not be used for signatures, certificates, or integrity
  against an adversary.
- **SHA-1:** the **SHACtered** attack (Google/CWI, 2017) produced the first real SHA-1
  collision (two distinct PDFs, same hash); **chosen-prefix** collisions followed (2020),
  cheap enough to forge. Browsers and CAs deprecated SHA-1 certificates by 2017.

Key nuances interviewers probe:
- What's broken is **collision resistance**, not (fully) **preimage** resistance. MD5/SHA-1
  are not efficiently invertible yet. That's why **HMAC-SHA1** remains *technically*
  unbroken (HMAC's security doesn't rely on collision resistance) — but you still migrate
  off it because there's no reason to keep a wounded primitive around.
- The takeaway: use **SHA-256 or better** for anything needing collision resistance
  (signatures, certificates, integrity, dedup of adversarial content).

> [!KEY-TAKEAWAY]
> "MD5/SHA-1 are broken" ≈ **collisions are cheap**. That directly breaks digital
> signatures and certificates (an attacker crafts two documents with the same hash, gets the
> benign one signed, and the signature is valid for the malicious one).

---

## HMAC and Message Authentication Codes

A **MAC (Message Authentication Code)** proves **integrity + authenticity** of a message to
someone who **shares the secret key**: `tag = MAC(key, message)`. The receiver recomputes
the tag and compares. Without the key you cannot produce a valid tag, so an attacker cannot
tamper undetected.

**HMAC (RFC 2104)** is the standard hash-based MAC:
`HMAC(K,m) = H((K⊕opad) ‖ H((K⊕ipad) ‖ m))`. The nested construction is what makes it
**immune to length-extension attacks** that plague the naive `H(key‖message)`. Use
**HMAC-SHA256** by default. GMAC and Poly1305 are polynomial MACs used inside AEAD modes.

**MAC vs digital signature — the key distinction:**

| | HMAC / MAC | Digital signature |
|---|---|---|
| Key model | **Symmetric** (shared secret) | **Asymmetric** (private signs, public verifies) |
| Who can verify | Only holders of the secret | **Anyone** with the public key |
| Non-repudiation | ❌ (both parties hold key → either could forge) | ✅ (only signer holds private key) |
| Speed | Very fast | Slower |

So a MAC gives integrity/authenticity **between two parties who trust each other with a
shared key** but **cannot** prove *which* of them created it — hence **no non-repudiation**.

**Timing-safe comparison:** verify MACs with a **constant-time** comparison
(`constant_time_equals`), not `==`. A byte-by-byte early-exit compare leaks how many leading
bytes matched via timing, enabling forgery a byte at a time.

> [!WARNING]
> Vulnerable: `if (mac == expected) accept()` using ordinary string equality. Exploit:
> attacker measures response time to learn the correct tag byte-by-byte. Fix: use a
> constant-time comparison over the full length.

---

## Digital Signatures and Non-Repudiation

A **digital signature** provides **integrity, authenticity, and non-repudiation** using a
key pair. The signer **signs the hash of the message with their private key**; anyone can
**verify with the public key**.

```
sign:   signature = Sign(privateKey, hash(message))
verify: Verify(publicKey, hash(message), signature)  -> valid / invalid
```

Why hash-then-sign: signing is expensive and size-limited, so we sign a fixed-size digest.
This is also why the hash must be **collision-resistant** — otherwise an attacker forges two
messages with the same hash and transfers a signature (see MD5/SHA-1).

**Non-repudiation** is the property a MAC cannot give: because **only** the signer holds the
private key, a valid signature proves *they* produced it and they can't later deny it. With
a shared-secret MAC, either party could have produced the tag, so it proves integrity but
not authorship in a way that's binding to a third party.

Common algorithms: **RSA-PSS** (preferred over PKCS#1 v1.5), **ECDSA** (unique `k` per
signature — deterministic RFC 6979), **EdDSA/Ed25519** (deterministic, fast, robust).

> [!INTERVIEW]
> "Signature vs MAC vs hash?" — Hash: integrity vs accidental corruption (no key, anyone can
> recompute, no authenticity). MAC: integrity + authenticity to shared-secret holders, no
> non-repudiation. Signature: integrity + authenticity + non-repudiation, publicly
> verifiable. Also relevant to JWT: `HS256` is an HMAC (shared secret); `RS256`/`ES256` are
> signatures (public verification) — mixing them up is the classic key-confusion vuln.

---

## Key Derivation Functions vs Password Hashes

Both turn a secret into key material, but they solve **opposite** problems, and conflating
them is a frequent, serious bug.

**KDF (Key Derivation Function)** — derives one or more strong keys from an input that is
**already high-entropy** (a DH shared secret, a master key). It needs to be **fast** and to
produce independent keys. Example: **HKDF (RFC 5869)** extract-then-expand. Do **not** use
HKDF/PBKDF's fast siblings to protect human passwords.

**Password hashing function (a.k.a. password-based KDF)** — protects **low-entropy** human
passwords for storage. It must be **deliberately slow and memory-hard** so offline brute
force is expensive, and must use a **per-user random salt** (to defeat rainbow tables) and,
ideally, a server-side **pepper**.

Recommended (OWASP Password Storage Cheat Sheet):

| Function | Type | Recommended parameters (2023+) |
|---|---|---|
| **Argon2id** | memory-hard (preferred) | m=19 MiB, t=2, p=1 (or m=12 MiB, t=3, p=1) |
| **scrypt** | memory-hard | N=2^17, r=8, p=1 (min N=2^15) |
| **bcrypt** | CPU-hard | work factor ≥ 10; input ≤ 72 bytes |
| **PBKDF2** | CPU-hard (FIPS) | PBKDF2-HMAC-SHA256, ≥ 600,000 iterations |

- **PBKDF2** is only CPU-hard, so it's cheap to accelerate on GPUs/ASICs — acceptable only
  when FIPS compliance forces it; otherwise prefer **Argon2id**.
- **bcrypt** silently truncates input at **72 bytes**; pre-hash long passwords (e.g.,
  base64(SHA-256(pw))) before bcrypt if you allow long/passphrase inputs.

> [!WARNING]
> Using a plain/fast hash (MD5, SHA-1, **or even SHA-256**) for password storage is a
> critical flaw. Modern GPUs compute **billions of SHA-256/s**, so an unsalted or fast-hashed
> password DB is cracked in hours. This is OWASP A02:2021 – Cryptographic Failures.

---

## Entropy CSPRNG vs PRNG

**Entropy** is unpredictability. Cryptographic keys, IVs/nonces, salts, session IDs, tokens,
and `k` values must come from a source an attacker cannot predict.

- **PRNG (pseudo-random)** — e.g., `Math.random()`, `java.util.Random`, C `rand()`, Mersenne
  Twister. Statistically random-*looking* but **predictable**: from a few outputs an attacker
  can recover internal state and predict all past/future outputs. **Never** use for anything
  security-relevant.
- **CSPRNG (cryptographically secure PRNG)** — seeded from the OS entropy pool and designed
  so outputs are computationally unpredictable even given prior outputs. Use these:
  `/dev/urandom`, `getrandom(2)`, `crypto.getRandomValues` / `crypto.randomBytes`,
  `java.security.SecureRandom`, `secrets` module (Python), `RNGCryptoServiceProvider`.

**Concrete attack:** a "random" password-reset token or session ID generated from
`Math.random()` (seeded from time) can be predicted or brute-forced, letting an attacker
forge valid tokens and hijack accounts. Same for using `Random` to pick an ECDSA `k` or a
nonce. Session IDs should carry **≥ 128 bits of entropy** from a CSPRNG (OWASP Session
Management Cheat Sheet).

> [!TIP]
> On Linux, prefer `getrandom(2)` / `/dev/urandom`; it blocks only until the pool is
> initialized at boot, then never blocks. The old advice to use `/dev/random` for "extra
> security" is a myth that causes availability problems.

---

## Encryption at Rest vs in Transit

These protect data in **different states** and are **complementary** — you need both;
neither substitutes for the other.

- **Encryption in transit** protects data **moving over a network** from eavesdropping and
  tampering — TLS (HTTPS), mTLS, SSH, VPNs. (The TLS handshake itself is covered in the
  networking domain; here, note it composes exactly the primitives above: ECDHE for key
  agreement + a signature/cert for authentication + an AEAD cipher for the record layer.)
- **Encryption at rest** protects **stored** data — disks, DBs, backups, object storage —
  against theft of the physical media or the storage layer. Examples: full-disk encryption
  (LUKS/BitLocker), transparent DB encryption (TDE), application-level/field-level
  encryption, envelope encryption with a KMS.

**Envelope encryption** (the cloud-KMS pattern): a per-object **data encryption key (DEK)**
encrypts the data; the DEK is itself encrypted by a **key encryption key (KEK)** held in a
KMS/HSM. You store the wrapped DEK next to the ciphertext. This lets you **rotate the KEK
cheaply** (re-wrap DEKs, no data re-encryption) and keeps the root key in hardware.

Gotchas:
- At-rest encryption protects against **stolen disks/DB files**, **not** against a
  compromised app that has legitimate decrypt access — for that you need field-level
  encryption, tokenization, or access control.
- Data is **plaintext in memory/at the endpoints** while in use; "in-transit" and "at-rest"
  leave a **in-use** gap that confidential computing / enclaves aim at.
- TDE encrypts the whole DB file with one key; **application/field-level** encryption limits
  blast radius and enables per-tenant keys, at the cost of losing query/index capability on
  encrypted columns.

---

## Key Sizes and Algorithm Selection

Security is measured in **bits of security** (work ≈ 2^n). NIST SP 800-57 Part 1 maps
algorithms to comparable strength; pick a consistent level across the whole system (the
weakest link sets the strength).

| Security level | Symmetric | RSA / DH (modulus) | ECC (curve) | Hash (collision) |
|---|---|---|---|---|
| 112-bit | 3DES (legacy) | 2048 | 224 | SHA-224 |
| **128-bit** | **AES-128** | **3072** | **256 (P-256/X25519)** | **SHA-256** |
| 192-bit | AES-192 | 7680 | 384 (P-384) | SHA-384 |
| 256-bit | AES-256 | 15360 | 512 (P-521) | SHA-512 |

Practical guidance:
- **Minimum today:** AES-128, RSA-2048 (112-bit, being phased out — prefer 3072), ECC P-256,
  SHA-256. NIST is disallowing 112-bit (RSA-2048) for many uses after ~2030.
- **Match, don't over/under-provision:** pairing AES-256 with RSA-2048 (~112-bit) doesn't
  give 256-bit security — the RSA is the weak link. Choose one level end to end.
- Bigger RSA keys grow **super-linearly** in cost; ECC scales far better, which is why new
  systems prefer ECC/EdDSA.
- **Crypto-agility:** design so algorithms and key sizes can be swapped (versioned key IDs,
  algorithm identifiers in your formats) — you'll need it for the post-quantum migration to
  ML-KEM/ML-DSA.

> [!KEY-TAKEAWAY]
> Default "sensible modern" stack: **AES-256-GCM** or **ChaCha20-Poly1305** for symmetric
> AEAD, **X25519/ECDH** for key agreement, **Ed25519 / RSA-PSS-3072** for signatures,
> **SHA-256/SHA-3** for hashing, **HKDF** for key derivation, **Argon2id** for passwords,
> and a **CSPRNG** for every random value.

---

## Key-Committing AEAD and Partitioning Oracle Attacks

A subtle but important fact that trips up seniors: **standard AEADs are not
key-committing**. AES-GCM, ChaCha20-Poly1305, AES-GCM-SIV, and XSalsa20-Poly1305 all
guarantee that a ciphertext decrypts correctly under **the one key used to make it** — but
they do **not** guarantee it fails under *other* keys. An attacker can deliberately craft a
single ciphertext+tag that decrypts to valid (attacker-chosen) plaintext under **many
different keys** — a **key multi-collision**. This is possible because GHASH/Poly1305 tags
are algebraic and an attacker who knows several candidate keys can solve for a ciphertext
that authenticates under all of them.

**Partitioning oracle attacks** (Len, Grubbs & Ristenpart, USENIX Security 2021) weaponize
this against **password-based / low-entropy-key** systems. If a server (or peer) reveals
whether decryption *succeeded* for an attacker-submitted blob, the attacker sends one
crafted ciphertext that is valid under a large set of candidate passwords. A single
"success/fail" answer eliminates (partitions away) that whole set at once — turning an
online guessing attack into a **binary-search over the password dictionary**, hundreds of
guesses per query. The paper broke **Shadowsocks** proxy password recovery and early
**OPAQUE** / password-authenticated implementations.

- **Where it bites:** password managers / vault blobs shared across users, password-based
  file encryption, multi-recipient ("encrypt to N public keys") systems, and any protocol
  where the *key* is guessable or where "does this decrypt?" leaks.
- **The wrong mental model:** "It's AEAD, so it's safe." AEAD gives you confidentiality +
  integrity **for a fixed key**, not commitment to a key or to a recipient.
- **The fix — a committing AEAD.** Use a scheme that binds the ciphertext to exactly one
  key: e.g., append/verify a **collision-resistant commitment** to the key (a hash of the
  key or of a key-derived value), the **"padding fix"** (prepending a fixed zero block that
  must decrypt correctly — cheap but only *weakly* committing), or a dedicated construction
  such as those standardized in the CFRG committing-AEAD work. Note **AES-GCM-SIV does not
  fix this** — misuse-resistance and key-commitment are different properties.

> [!WARNING]
> "Given a crafted vault blob shared across users, what class of attack applies?" →
> **partitioning oracle / non-committing AEAD**. The remedy is a **key-committing AEAD**,
> not a bigger key or a different nonce policy.

---

## CBC Padding Oracles and AEAD Composition Order

**How a CBC padding oracle actually decrypts a byte.** In CBC, `P[i] = D_K(C[i]) ⊕ C[i-1]`,
where `D_K` is the raw block decryption and `C[i-1]` is the previous ciphertext block (the
IV for the first block). An attacker who can ask "is the padding valid?" targets the last
byte first:

1. Take target block `C[i]` and a controllable preceding block `C'` (initially arbitrary).
   The victim computes `I = D_K(C[i])` (the **intermediate** value) and `P = I ⊕ C'`.
2. Brute-force the **last byte** of `C'` (256 tries) until the oracle reports **valid
   padding** — which almost always means the last plaintext byte is `0x01`. Now
   `I[15] = C'[15] ⊕ 0x01`, so the attacker has learned one byte of the *key-independent*
   intermediate state.
3. Recover the real plaintext byte: `P[15] = I[15] ⊕ C[i-1][15]` using the **genuine**
   previous block. Then set `C'` bytes to force `0x02 0x02`, brute-force the next byte, and
   walk **right-to-left** through the whole block. ~256×16 queries decrypt a block with **no
   key**.

**MAC/encryption composition — the three orders and their fates:**

| Order | Definition | Real-world result |
|---|---|---|
| **Encrypt-then-MAC (EtM)** | MAC over the ciphertext; verify MAC *before* decrypting | **Secure / recommended** (ISO/IEC 19772). TLS 1.2 AEAD suites and TLS 1.3 behave this way; the EtM extension (RFC 7366) fixes TLS CBC |
| **MAC-then-Encrypt (MtE)** | MAC the plaintext, then encrypt both | **Fragile** — used by TLS 1.0–1.2 CBC suites; decryption happens before MAC check → padding/timing oracles (**Lucky13**) |
| **Encrypt-and-MAC (E&M)** | Encrypt plaintext, MAC plaintext separately, send both | Weak — the plaintext MAC can leak plaintext equality; used by **SSH** |

**Lucky13 (CVE-2013-0169)** is a *timing* padding oracle against TLS CBC (MtE): after
removing padding the server MACs a length that depends on how much padding it stripped, so
MAC-computation time leaks whether padding was well-formed — a few-microsecond difference,
amplified statistically. The real fix was to stop using CBC MtE suites; TLS 1.3 removed CBC
and mandates AEAD. **POODLE** (SSLv3) exploited the same class because SSLv3 padding wasn't
deterministic and couldn't be verified.

> [!KEY-TAKEAWAY]
> The correct generic order is **Encrypt-then-MAC**, and you verify the MAC/tag in
> **constant time before touching the plaintext**. Best of all: use an AEAD and never
> hand-compose.

---

## Length-Extension Attacks in Depth

Merkle–Damgård hashes (MD5, SHA-1, SHA-256, SHA-512) process input block-by-block and
**output their full internal state** as the digest. That means anyone holding
`H(secret ‖ msg)` and the *length* of `secret ‖ msg` can **resume** the hash from that state
and compute a valid `H(secret ‖ msg ‖ padding ‖ extension)` — **without knowing the
secret**. `padding` here is the deterministic Merkle–Damgård length padding (the "glue
padding") that the attacker can reconstruct because it depends only on lengths, not content.

**Worked forgery (the classic Flickr API bug):** an API signs requests as
`sig = MD5(secret ‖ "method=x&...")`. An attacker who captures one valid `(request, sig)`
pair sets internal state = `sig`, appends `&admin=1`, and produces a valid signature for the
extended request — escalating privileges with no knowledge of `secret`. Amazon S3's old
`H(secret‖msg)`-style signing had the same shape.

**Why HMAC is immune:** `HMAC(K,m) = H((K⊕opad) ‖ H((K⊕ipad) ‖ m))`. The **outer** hash
wraps the inner digest, so the exposed value is `H(opad-key ‖ inner)`, not a resumable state
of the secret-prefixed message. **SHA-3 (sponge)**, **BLAKE2/BLAKE3**, and the truncated
**SHA-512/256** are also not length-extendable because they don't emit the full absorbing
state. Fix for any keyed integrity: **use HMAC (or KMAC/a keyed BLAKE)** — never raw
`H(secret ‖ msg)`.

---

## Polynomial MACs and GCM-SIV Internals

**GHASH (inside AES-GCM)** authenticates by evaluating a **polynomial over GF(2¹²⁸)**: the
ciphertext/AAD blocks become polynomial coefficients, and the tag is that polynomial
evaluated at a **secret point `H = E_K(0¹²⁸)`** (encryption of the zero block), then masked
by `E_K(nonce‖counter=0)`. `H` is **the same across every message under a key** — so if the
per-message mask ever repeats (nonce reuse), two tags give two equations in the unknown `H`,
which the attacker solves by finding roots of a polynomial over the field. Recovering `H`
lets them forge tags for **any** message: this is the mechanism behind the "forbidden
attack" mentioned earlier.

**Poly1305 (RFC 8439)** is also a polynomial MAC, but it derives a **fresh one-time key**
`(r, s)` per (key, nonce) from the ChaCha20 keystream. Because the MAC key is one-time, a
nonce repeat with ChaCha20-Poly1305 still leaks the keystream (confidentiality break) but
does **not** hand the attacker a reusable authentication subkey the way GHASH's static `H`
does — the forgery blast radius is smaller.

**AES-GCM-SIV (RFC 8452) — nonce-misuse-resistant AEAD.** It computes a **synthetic IV**:
first it MACs the plaintext + AAD with **POLYVAL** (a GHASH cousin) to derive the tag/IV,
*then* uses that as the CTR nonce. Consequences: identical `(key, nonce, plaintext, AAD)`
produce identical ciphertext (deterministic), but accidental nonce reuse only leaks
**equality of messages**, never the catastrophic `H`-recovery/full forgery of plain GCM.
Crucially, **GCM-SIV is still *not* key-committing** — misuse-resistance ≠ commitment.

**Truncated tags are dangerous.** GCM allows tags shorter than 128 bits (e.g., 96/64/32).
NIST SP 800-38D Appendix C caps the number of invocations and requires much stricter message
limits for short tags, because forgery probability scales as ~`2^(−t)` per attempt and short
tags let an online attacker forge after feasibly few tries (a 32-bit tag ≈ forgeable in ~2³²
attempts). Use the **full 128-bit tag** unless a standard explicitly forces otherwise.

---

## RSA Padding Attacks: Bleichenbacher, ROBOT and Marvin

RSA needs padding, and the **wrong padding for the wrong job** (or a non-constant-time
implementation of it) is a recurring disaster.

**The padding trio:**
- **PKCS#1 v1.5 encryption** — legacy RSA key transport padding. Vulnerable to the
  **Bleichenbacher (1998) adaptive chosen-ciphertext / "million-message" oracle**: if the
  server behaves differently for "valid `00 02 ...` padding" vs invalid, the attacker
  submits mauled ciphertexts and narrows the plaintext interval until they recover it
  (decrypt a key or forge a signature).
- **RSA-OAEP** — the correct **encryption** padding: adds randomness + MGF1, provably
  IND-CCA2 under proper implementation.
- **RSA-PSS** — the correct **signature** padding: probabilistic (per-signature salt),
  provably secure. PKCS#1 v1.5 *signatures* are also still permitted but rigid.

**PKCS#1 v1.5 signature forgery (Bleichenbacher '06 / "BERserk").** With `e = 3` and a
**lax padding parser** that doesn't check that the hash occupies the rightmost bytes (allows
trailing garbage), an attacker can construct a perfect cube whose top bits look like valid
PKCS#1 padding — forging a signature **without the private key**. Fixed by strict,
constant-position padding validation (and by avoiding `e = 3`).

**ROBOT (2018)** revived Bleichenbacher against modern TLS stacks — many products still
leaked a padding oracle through subtly different error/timeout behavior.

**The Marvin Attack (2023–2024)** is the important modern twist: it's a **timing side
channel that lives in the bignum layer**, not the padding-check branch. Because RSA
decryption's modular exponentiation and the surrounding conversions (`BIGNUM`, Java
`BigInteger`, Go `math/big`) aren't fully constant-time, timing leaks whether the decrypted
value had a leading zero / valid structure — reviving Bleichenbacher and, critically,
**affecting RSA-OAEP too**, since OAEP still routes through the same non-constant-time bignum
decryption before unpadding. The CVE wave: Go **CVE-2023-45287**, Node **CVE-2023-46809**,
OpenJDK **CVE-2024-20952**, BouncyCastle **CVE-2024-30171**, GnuTLS **CVE-2023-0361**, NSS
**CVE-2023-5388**, pyca/cryptography **CVE-2023-50782**.

> [!WARNING]
> A scanner flagging "RSA key-exchange capable" in 2024 is **not** fixed by "we patched the
> padding check." The leak is in the constant-time behavior of the whole RSA decryption
> path. The real remediation is to **stop using RSA key transport entirely** — use
> **(EC)DHE** for key agreement (forward secrecy) and reserve RSA only for signatures /
> OAEP with an audited constant-time library.

---

## ECDSA Nonce Lattice Attacks and Signature Malleability

The earlier section covered *full* `k` reuse. Seniors are expected to know two subtler
facts.

**Partial nonce bias → full key via lattices.** You do **not** need `k` reused. If just a
**few bits** of each `k` are predictable (e.g., always zero in the top byte, or leaked via a
side channel) across **many** signatures, the private key falls out of a **lattice
reduction (LLL/BKZ) / hidden-number-problem** attack. Real cases: **Minerva** (2019,
timing-leaked nonce length in smartcards/libraries), **TPM-Fail / CVE-2019-11090** (timing
leak in TPM ECDSA), and **LadderLeak** (recovering keys with **under 1 bit** of nonce bias
per signature). This is *the* reason to use **deterministic ECDSA (RFC 6979)** or
**Ed25519** — and to ensure the implementation is constant-time.

**Signature malleability.** ECDSA signatures are `(r, s)`, and `(r, −s mod n)` is **also a
valid signature** for the same message. If a system uses the signature bytes as a unique
identifier (e.g., a transaction ID), an attacker can produce a second valid encoding —
the root of **Bitcoin transaction malleability**, which is why Bitcoin enforces a
**canonical low-`S`** rule (BIP 62/146). Ed25519 defines a canonical encoding and (in strict
mode) rejects malleable forms, but see the verification pitfalls below.

---

## Ed25519 Verification Pitfalls

Ed25519 (RFC 8032) derives its per-signature nonce **deterministically** from a hash of the
private key and message, eliminating the ECDSA RNG hazard, and is fast and side-channel
friendly. But **verification is under-specified across libraries**, causing interoperability
and security bugs catalogued in *"Taming the Many EdDSAs"* (Chalkias, Garillot,
Nikolaenko):

- **Cofactored vs cofactorless verification** — the group has a cofactor of 8; some libraries
  multiply by the cofactor in the verification equation and some don't, so a signature can
  verify in one library and fail in another. This breaks **batch vs single** verification
  agreement (a batch verifier may accept what single verification rejects).
- **Non-canonical `S` / point encodings** — RFC 8032 §5.4.6 requires rejecting `S ≥ L` and
  non-canonically encoded points; lax verifiers accept malleable signatures.
- **Small-subgroup / mixed-order points** — accepting such public keys or `R` values enables
  malleability and, in some protocols, cross-key forgeries.

Choose libraries that implement **RFC 8032 "strict" verification** consistently, and pick
one verification convention across your whole system.

---

## Diffie-Hellman Parameter Validation and Invalid-Curve Attacks

Unauthenticated DH's MITM problem was covered earlier; the *parameter/point validation*
failures are the senior-level gap.

**Invalid-curve / small-subgroup attacks (ECDH).** If an endpoint holds a **static** ECDH
private key and **fails to validate** that the peer's public point is actually on the
expected curve and in the correct prime-order subgroup, an attacker sends points lying on a
**different curve with small-order subgroups**. Each exchange leaks the static key
**modulo a small factor** (via the small subgroup); by CRT-combining many such leaks the
attacker recovers the full private key **bit-by-bit**. Real example: Go's P-256
**CVE-2017-8932**. Defense: **validate the peer key is on-curve and in the right subgroup**
(SP 800-56A key validation), or use **X25519** (see below).

**Finite-field DHE** needs **safe primes** (`p = 2q + 1`, `q` prime) and validation that the
peer's value is in the correct subgroup; otherwise small-subgroup confinement leaks the
exponent. **Logjam (2015)** was a *downgrade* attack: a MITM forced TLS to negotiate
**export-grade 512-bit DH**, which is precomputable, then broke the session — and many
servers shared the same 512/1024-bit groups, amortizing the precomputation.

**X25519 is engineered to sidestep this.** Curve25519's design (a Montgomery curve with a
twist of near-prime order, plus **scalar clamping** that clears the low cofactor bits and
sets a high bit) means the x-coordinate-only ECDH is **safe without explicit point
validation** — malicious points land in a large-order subgroup and don't leak the key.
That safety-by-construction is a big reason X25519 is the modern default.

---

## Constant-Time Programming and Side Channels

Cryptographic code must run in time (and with memory-access patterns) **independent of
secret data**, or it leaks keys through physical/microarchitectural channels. Generalizing
the timing-safe MAC compare:

- **Secret-dependent branches** — `if (secret_byte == x)` leaks via timing/branch prediction.
  Both padding oracles (Lucky13) and Marvin ultimately come from this.
- **Secret-dependent table lookups (cache timing).** Classic table-based (T-box) **AES**
  indexes lookup tables by key/plaintext bytes; an attacker sharing the CPU observes which
  cache lines are touched (Flush+Reload, Prime+Probe) and recovers the key. Mitigations:
  **AES-NI** hardware instructions (data-independent) or **bit-sliced** software AES; this is
  also *why* ChaCha20 (add-rotate-XOR, no secret table lookups) is timing-safe by design.
- **Secret-dependent memory access / division** in bignum code → Marvin, Minerva.
- **Comparisons** — never use `==`/`memcmp`/short-circuit equality on secrets or tags; use a
  constant-time comparison that always scans the full length.
- **Transient-execution classes (Spectre/Meltdown)** can read key material across boundaries;
  crypto libraries add barriers and keep keys out of speculatively reachable buffers.

Rule of thumb: **no branch, table index, or loop bound may depend on a secret.** Prefer
vetted constant-time libraries over hand-written primitives.

---

## Nonce-Reuse Resistance and Key Wear-Out

Two distinct limits govern how long one key is safe:

- **Random-nonce collision (birthday) limit.** With random 96-bit GCM nonces, after ~**2³²**
  messages the chance of a nonce repeat (→ catastrophic `H` recovery) becomes non-negligible.
- **Data-volume / block limit.** AES-GCM should encrypt at most ~**2³⁵ bytes (~32 GiB) under
  one key/nonce combination context** before CTR-mode block-collision distinguishers degrade
  confidentiality (OWASP's practical rekey threshold ≈ 2³⁵ bytes; NIST SP 800-38D bounds the
  invocations). **Rekey before wear-out.**

**Choosing a nonce strategy:**
- **Deterministic counter nonce** — safest when you can guarantee monotonic, non-repeating
  counters (single writer, persisted counter). Never reset on restart/crash without care.
- **AES-GCM-SIV** — when you *cannot* guarantee unique nonces; misuse degrades gracefully.
- **XChaCha20-Poly1305** — extends ChaCha20-Poly1305's nonce to **192 bits (24 bytes)** so
  that **random** nonces are collision-safe up to ~2⁸⁰ messages. This is the modern
  app-layer choice when you want to just pick a random nonce and not maintain a counter.

> [!INTERVIEW]
> "Encrypt 10¹² messages under one key with random nonces — is AES-GCM safe?" **No** — 10¹²
> ≈ 2⁴⁰ ≫ the ~2³² random-96-bit-nonce bound. Use a **counter nonce**, **AES-GCM-SIV**, or
> **XChaCha20-Poly1305**, and/or rotate keys.

---

## Post-Quantum Cryptography and Hybrid Key Exchange

The quantum threat is **asymmetric-specific**:

- **Shor's algorithm** solves factoring and discrete log in polynomial time → **fully
  breaks RSA, ECC (ECDSA/ECDH), and finite-field DH**.
- **Grover's algorithm** gives only a **√ speedup** on brute-force search → symmetric/hash
  strength is *halved*, not broken. Mitigation is simply **double the key/output size**:
  **AES-256 → ~128-bit post-quantum**, SHA-384/512 for hashing. So "why does AES-256 survive
  but RSA-3072 doesn't?" → Grover (quadratic, survivable) vs Shor (polynomial, fatal).

**NIST standards finalized August 2024:**
- **FIPS 203 — ML-KEM** (formerly **Kyber**): the key-encapsulation mechanism. Recommended
  default parameter set **ML-KEM-768** (~Category 3).
- **FIPS 204 — ML-DSA** (formerly **Dilithium**): lattice signatures; common set **ML-DSA-65**.
- **FIPS 205 — SLH-DSA** (formerly **SPHINCS+**): stateless hash-based signatures (conservative
  backup, large signatures).
- Still in progress: **FN-DSA (Falcon)** and **HQC** (a code-based KEM chosen in 2025 as a
  non-lattice backup). NIST IR 8547 sketches a **deprecate-quantum-vulnerable-by-2035**
  timeline.

**Harvest-now, decrypt-later (HNDL)** is why **KEM migration is more urgent than signature
migration**: an adversary can record ECDHE-protected traffic today and decrypt it once a
quantum computer exists, so *confidentiality* of long-lived data is already at risk;
signatures only need to resist forgery in the future.

**Hybrid key exchange** is the deployed transition pattern: run a classical KEM **and** a
PQ KEM and combine both shared secrets in the KDF, so the result is safe if **either** holds.
TLS 1.3 deploys **`X25519MLKEM768`** (X25519 + ML-KEM-768). This buys safety against both a
break of ML-KEM's newer math *and* the quantum break of X25519, and pairs naturally with
**crypto-agility** (versioned algorithm IDs).

---

## Key Management Lifecycle and Rotation

NIST SP 800-57 Part 1 §5.3 frames keys as having a **lifecycle and a cryptoperiod** (the
time a key is authorized for use). Senior "design a rotation scheme" answers should cover:

- **Key states:** *pre-active → active → deactivated/suspended → compromised → destroyed*.
  A **deactivated** key may still *decrypt/verify* old data but must not *encrypt/sign* new
  data; a **compromised** key must be revoked and its protected data re-encrypted/re-signed.
- **Cryptoperiods & rotation triggers:** time-based (e.g., annual), **data-volume-based**
  (rekey a symmetric key before ~2³⁵ bytes for AES-GCM), and event-based (suspected
  compromise, personnel change, algorithm deprecation).
- **Rotation cost — KEK re-wrap vs data re-encryption.** With **envelope encryption**,
  rotating the **KEK** only requires **re-wrapping the DEKs** (tiny, fast) — the bulk
  ciphertext is untouched. Rotating a **DEK** means **re-encrypting the data** (expensive).
  Design so routine rotation hits the KEK, not the data.
- **Separation of duties:** keys must be stored **separately from the data** they protect
  (never the encryption key next to the ciphertext in the same DB row/table unwrapped), and
  access to key use should be logged and least-privilege.
- **HSM / KMS assurance:** **FIPS 140-2/140-3** validation levels; **Level 3** adds physical
  tamper-resistance/response and identity-based operator auth. Root keys ("KEKs") live in the
  HSM and never leave in plaintext.

---

## PKI Trust Chains and Certificate Verification

Signatures "in practice" almost always mean a **certificate chain** (the TLS handshake
itself belongs to networking, but the *signature-verification chain* is a crypto-primitive
topic):

- **Chain of trust:** a **leaf** certificate is signed by an **intermediate** CA, which is
  signed by a **root** CA whose public key is in the client's **trust store**. Verification
  walks leaf → intermediate → root, checking each signature, validity dates, name
  constraints, and revocation.
- **A CA compromise is game over** for everything it can sign: a rogue/compromised CA (e.g.,
  **DigiNotar, 2011**) can mint valid certificates for **any** domain, defeating
  authentication entirely — which is why root CAs are guarded in HSMs and issuance is heavily
  controlled.
- **Defenses:** **Certificate Transparency (CT)** logs make every issued cert publicly
  auditable so mis-issuance is detectable; **certificate/public-key pinning** constrains
  which CA/key a client will accept for a service (used carefully — bad pins brick clients);
  **revocation** via CRL/OCSP (and OCSP stapling) handles compromised leaf certs.
- The primitive lesson: **a signature is only as trustworthy as the key that verifies it and
  the process that authorized that key** — the chain, not any single signature, is what you
  actually trust.

---

## Randomness Failures and Real Incidents

"Use a CSPRNG" is necessary but not sufficient — the *entropy source and its lifecycle*
matter. Named incidents worth knowing:

- **Debian OpenSSL (2008, CVE-2008-0166).** A maintainer removed code that fed uninitialized
  memory into the PRNG seed; the only remaining entropy was the **PID (~15 bits)**. All keys
  (SSH, TLS, OpenVPN) generated on affected Debian/Ubuntu for ~2 years were drawn from a tiny
  predictable set and could be enumerated. Lesson: don't "fix" entropy code you don't
  understand; the seeding lifecycle is security-critical.
- **Android SecureRandom (2013).** A flaw left `SecureRandom` improperly seeded on some
  devices; because the ECDSA nonce `k` was drawn from it, **Bitcoin wallet keys were
  recovered** (nonce reuse/bias) and coins stolen — ties directly to the ECDSA `k` hazard.
- **Fork / VM-snapshot reseeding.** After `fork()` or restoring a **VM/container snapshot**,
  two processes can share **identical RNG state** and emit the **same "random" values**
  (nonces, keys, session IDs). Modern CSPRNGs mitigate with fork-detection / `MADV_WIPEONFORK`
  and per-boot reseeding; be wary of golden-image cloning.
- **Early-boot entropy / `getrandom` blocking.** At boot the pool may be uninitialized;
  `getrandom(2)` **blocks until seeded** (correct) whereas reading `/dev/urandom` early can
  return low-entropy output. Ensure services that generate keys at startup wait for a seeded
  pool.

---

## HKDF Internals: KDF vs PRF vs XOF

Deepening the earlier extract/expand summary, and distinguishing related primitives:

- **HKDF-Extract(salt, IKM) → PRK.** "Concentrates" possibly-non-uniform input keying
  material (a DH secret) into a uniform pseudorandom key. The **salt** need not be secret;
  it *strengthens* extraction when present but HKDF is defined with an all-zero salt when you
  have none. A salt is most valuable when the IKM isn't already uniform.
- **HKDF-Expand(PRK, info, L) → OKM.** Stretches the PRK into as many independent keys as you
  need. The **`info` parameter binds context** — protocol name, version, key-id, direction
  (client→server vs server→client) — which **prevents cross-protocol/cross-purpose key
  reuse**: the same PRK with different `info` yields cryptographically independent keys.
- **KDF vs PRF vs XOF:**
  - A **KDF** assumes **high-entropy** input (never a raw password) and produces key
    material; HKDF is a KDF.
  - A **PRF** is a keyed function indistinguishable from random given the key (HMAC is a PRF;
    HKDF is built from HMAC-as-PRF).
  - An **XOF (extendable-output function)** like **SHAKE128/256** (FIPS 202) produces
    arbitrary-length output from an input and is used where you need variable-length hashing,
    not key separation semantics.
- **FIPS note:** for FIPS-validated key derivation from a key (not a DH secret), **SP 800-108
  KBKDF** (counter/feedback mode, typically HMAC-based) is the standard; HKDF (SP 800-56C for
  the extract step) is used for key-agreement outputs. Don't confuse either with a
  **password** KDF (Argon2/PBKDF2).

---

## Associated-Data Misuse in AEAD

AEAD authenticates but does **not encrypt** the **associated data (AAD)** — and *forgetting
to bind the right context into the AAD* creates real vulnerabilities even with a perfect
cipher:

- **Confused-deputy / ciphertext-relocation.** If a ciphertext isn't bound (via AAD) to its
  **intended context** — recipient id, key-id, record type, field name, message sequence — an
  attacker can **move a valid ciphertext to a different context** where it still decrypts and
  is accepted. Example: a value encrypted for field `A` (or user `A`, or record type
  "unprivileged") is spliced into field `B` (or user `B`, or "privileged") and the AEAD
  happily verifies because nothing tied it to `A`.
- **Nonce-as-AAD confusion.** The nonce and the AAD are different inputs with different
  requirements; don't conflate them or assume authenticating the nonce substitutes for a
  unique-nonce policy.
- **Fix:** bind all disambiguating context (version, key-id, recipient, purpose, sequence
  number) into the **AAD**, and verify it on decrypt. This is also what makes rotation and
  multi-tenant systems safe.

---

## Common follow-up questions

- Why is ECB mode insecure even with AES-256? Deterministic per-block encryption leaks
  plaintext patterns and allows block reordering; key size doesn't help.
- What exactly breaks if you reuse an AES-GCM nonce? Both confidentiality (keystream
  reuse → P1⊕P2 leaks) and integrity (GHASH subkey `H` recovered → tag forgery).
- MAC vs signature vs hash — when do you use each? Hash = integrity vs accidents; MAC =
  integrity+authenticity with a shared secret (no non-repudiation); signature =
  integrity+authenticity+non-repudiation, publicly verifiable.
- Why can't you use SHA-256 to store passwords? It's fast → GPUs brute-force billions/s;
  use a slow, memory-hard, salted function (Argon2id/bcrypt/scrypt/PBKDF2).
- HKDF vs Argon2 — why not one function for both? KDFs assume high-entropy input and must
  be fast; password hashes assume low-entropy input and must be deliberately slow/memory-hard.
- Why is `Math.random()` dangerous for tokens? It's a predictable PRNG; an attacker can
  recover state and forge tokens/session IDs. Use a CSPRNG with ≥128 bits of entropy.
- Why does ephemeral (EC)DHE give forward secrecy but static RSA key transport doesn't?
  Ephemeral session keys aren't derivable from the long-term key, so a later key compromise
  can't decrypt recorded past sessions.
- Is HMAC-SHA1 broken because SHA-1 is broken? No — HMAC security doesn't depend on
  collision resistance; but migrate to HMAC-SHA256 anyway.
- What is AEAD and why prefer it? One primitive giving confidentiality + integrity +
  associated-data authentication, failing closed on tamper — removes error-prone manual
  MAC composition.
- Why is deterministic ECDSA (RFC 6979) or Ed25519 safer? They remove the per-signature
  RNG whose failure/reuse leaks the private key.
- What survives quantum computers? Symmetric (AES-256) and hashes are only weakened;
  RSA/ECC/DH are broken (Shor) → migrate to ML-KEM/ML-DSA.
- Why isn't "it's AEAD" enough for a shared/password-based vault blob? AEAD isn't
  key-committing → partitioning-oracle attacks; use a **committing AEAD**.
- Is "we patched the RSA padding check" enough to close a Bleichenbacher finding in 2024?
  No — **Marvin** is a timing leak in the bignum layer (affects OAEP too); drop RSA key
  transport, use (EC)DHE.
- Why did TLS 1.2 CBC suites get Lucky13 but AEAD suites didn't? CBC used
  **MAC-then-encrypt**; decryption/padding-removal before the MAC check created a timing
  oracle. Correct order is **encrypt-then-MAC** / AEAD.
- Only a few bits of the ECDSA nonce leak across many signatures — is the key safe? No —
  a **lattice/HNP attack** (Minerva, TPM-Fail, LadderLeak) recovers the full key.
- A static-ECDH endpoint accepts arbitrary points — what's the risk?
  **Invalid-curve/small-subgroup** key recovery; validate points or use X25519.
- Encrypt 10¹² messages under one AES-GCM key with random nonces? Unsafe (>2³² nonce
  bound); use counter nonces, **AES-GCM-SIV**, or **XChaCha20-Poly1305**, and rotate keys.
- How would you make TLS/key-exchange post-quantum-ready? **Hybrid** (X25519 +
  ML-KEM-768) + crypto-agility; HNDL makes KEM migration the priority.

## References

- NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management (key sizes / strength):
  https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
- NIST SP 800-38A (modes), 800-38D (GCM), 800-38F (key wrapping):
  https://csrc.nist.gov/pubs/sp/800/38/d/final
- NIST SP 800-63B — Digital Identity (authenticators, secrets):
  https://pages.nist.gov/800-63-3/sp800-63b.html
- NIST FIPS 197 (AES), FIPS 180-4 (SHA-2), FIPS 202 (SHA-3), FIPS 203/204 (ML-KEM/ML-DSA)
- OWASP Top 10 2021 — A02:2021 Cryptographic Failures:
  https://owasp.org/Top10/A02_2021-Cryptographic_Failures/
- OWASP Cheat Sheets — Cryptographic Storage, Password Storage, Key Management,
  Transport Layer Security, Secrets Management:
  https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html ,
  https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP ASVS v4 — V6 Stored Cryptography, V2.4 Credential Storage:
  https://owasp.org/www-project-application-security-verification-standard/
- RFC 2104 (HMAC), RFC 5869 (HKDF), RFC 8439 (ChaCha20-Poly1305), RFC 8452 (AES-GCM-SIV)
- RFC 6979 (Deterministic ECDSA), RFC 8032 (EdDSA/Ed25519), RFC 8017 (PKCS#1 / RSA-OAEP/PSS)
- RFC 7748 (X25519/Curve25519 ECDH)
- SHAttered — first practical SHA-1 collision: https://shattered.io/
- Len, Grubbs, Ristenpart — Partitioning Oracle Attacks (USENIX Security 2021):
  https://www.usenix.org/conference/usenixsecurity21/presentation/len
- The Marvin Attack (Hubert Kario) + CVE list:
  https://people.redhat.com/~hkario/marvin/
- Lucky13 (CVE-2013-0169), ROBOT (2018), Logjam (2015) — CBC/RSA/DH downgrade & oracle attacks
- Chalkias, Garillot, Nikolaenko — "Taming the Many EdDSAs" (Ed25519 verification pitfalls)
- Minerva, TPM-Fail (CVE-2019-11090), LadderLeak — ECDSA nonce-bias lattice attacks
- Go invalid-curve P-256 (CVE-2017-8932); Debian OpenSSL PRNG (CVE-2008-0166)
- NIST SP 800-56A (DH/ECDH key validation), SP 800-108 (KBKDF), SP 800-56C (HKDF extract),
  SP 800-131A (transitions)
- NIST FIPS 205 (SLH-DSA) and IR 8547 (PQC transition timeline);
  RFC 9180 (HPKE), RFC 7366 (TLS Encrypt-then-MAC)
