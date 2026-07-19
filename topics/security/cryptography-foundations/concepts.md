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

## Common follow-up questions

- **Why is ECB mode insecure even with AES-256?** Deterministic per-block encryption leaks
  plaintext patterns and allows block reordering; key size doesn't help.
- **What exactly breaks if you reuse an AES-GCM nonce?** Both confidentiality (keystream
  reuse → P1⊕P2 leaks) and integrity (GHASH subkey `H` recovered → tag forgery).
- **MAC vs signature vs hash — when do you use each?** Hash = integrity vs accidents; MAC =
  integrity+authenticity with a shared secret (no non-repudiation); signature =
  integrity+authenticity+non-repudiation, publicly verifiable.
- **Why can't you use SHA-256 to store passwords?** It's fast → GPUs brute-force billions/s;
  use a slow, memory-hard, salted function (Argon2id/bcrypt/scrypt/PBKDF2).
- **HKDF vs Argon2 — why not one function for both?** KDFs assume high-entropy input and must
  be fast; password hashes assume low-entropy input and must be deliberately slow/memory-hard.
- **Why is `Math.random()` dangerous for tokens?** It's a predictable PRNG; an attacker can
  recover state and forge tokens/session IDs. Use a CSPRNG with ≥128 bits of entropy.
- **Why does ephemeral (EC)DHE give forward secrecy but static RSA key transport doesn't?**
  Ephemeral session keys aren't derivable from the long-term key, so a later key compromise
  can't decrypt recorded past sessions.
- **Is HMAC-SHA1 broken because SHA-1 is broken?** No — HMAC security doesn't depend on
  collision resistance; but migrate to HMAC-SHA256 anyway.
- **What is AEAD and why prefer it?** One primitive giving confidentiality + integrity +
  associated-data authentication, failing closed on tamper — removes error-prone manual
  MAC composition.
- **Why is deterministic ECDSA (RFC 6979) or Ed25519 safer?** They remove the per-signature
  RNG whose failure/reuse leaks the private key.
- **What survives quantum computers?** Symmetric (AES-256) and hashes are only weakened;
  RSA/ECC/DH are broken (Shor) → migrate to ML-KEM/ML-DSA.

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
