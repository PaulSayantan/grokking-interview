# JSON Web Tokens (JWT) & Token Security

A **JSON Web Token (JWT, RFC 7519)** is a compact, URL-safe way to carry a set of
**claims** (assertions) between two parties. In practice the acronym "JWT" almost
always means a **signed** token — a **JWS (JSON Web Signature, RFC 7515)** — that an
authorization server issues and a resource server verifies. The whole point is
*stateless verification*: the recipient can trust the claims by checking a signature
with a key it already has, without a database lookup back to the issuer.

That statelessness is also the source of nearly every JWT vulnerability. Because the
token is self-describing (it literally announces which algorithm and key were used to
sign it) and because verification is spread across many independent services, a JWT
library that trusts the token's own header, skips a claim check, or accepts a weak key
turns "stateless auth" into "attacker-controlled auth." This topic teaches JWTs at the
**protocol and threat level**: how the format works on the wire, the classic signature-
bypass attacks (`alg:none`, HS/RS key confusion, weak-secret brute force, `kid`/`jku`
injection), the claim-validation failures, and the hard problem statelessness creates —
**revocation**.

> [!INTERVIEW]
> The single most repeated JWT interview question is some form of *"how can an attacker
> forge a valid-looking JWT, and how do you stop it?"* If you can walk through `alg:none`,
> RS→HS key confusion, and weak-secret brute force — and give the one-line fix for each
> (pin the algorithm, never derive keys from the token header) — you have covered the
> majority of what interviewers probe.

The anchor specifications are **RFC 7519 (JWT)**, **RFC 7515 (JWS)**, **RFC 7516 (JWE)**,
**RFC 7518 (JWA — the algorithms)**, and **RFC 7517 (JWK / JWKS)**, plus the OWASP JSON
Web Token Cheat Sheet and OWASP ASVS.

---

## JWT structure: header, payload, signature

A signed JWT (JWS Compact Serialization) is **three base64url-encoded parts joined by
dots**:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9   <- header
.eyJzdWIiOiIxMjMiLCJhZG1pbiI6ZmFsc2V9   <- payload (claims)
.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk   <- signature
```

- **Header** — a JSON object describing the token, e.g.
  `{"alg":"HS256","typ":"JWT"}`. `alg` names the signing algorithm; `typ`/`cty`
  describe the media type; `kid` (optional) identifies which key was used.
- **Payload** — a JSON object of **claims** (see next section).
- **Signature** — the output of the `alg` over the ASCII string
  `base64url(header) + "." + base64url(payload)`.

**base64url is encoding, not encryption.** It uses the URL-safe alphabet (`-` and `_`
instead of `+` and `/`) and strips `=` padding. Anyone can decode the first two parts:

```
$ echo 'eyJzdWIiOiIxMjMiLCJhZG1pbiI6ZmFsc2V9' | base64 -d
{"sub":"123","admin":false}
```

> [!WARNING]
> A signed JWT protects **integrity and authenticity**, not **confidentiality**. The
> header and payload are readable by anyone who has the token. Never put passwords,
> full PANs, secret keys, or sensitive PII in a JWS payload.

The signature is what makes the token trustworthy: it lets the verifier detect any
tampering with the header or payload. Change a single byte of the payload (e.g. flip
`"admin":false` to `"admin":true`) and the signature no longer validates — *unless* one
of the signature-bypass attacks below succeeds.

---

## JWS vs JWE: signed vs encrypted

There are two distinct JOSE token types, and confusing them is a classic mistake:

| | **JWS (RFC 7515)** | **JWE (RFC 7516)** |
|---|---|---|
| Guarantees | Integrity + authenticity | Confidentiality (+ integrity via AEAD) |
| Structure | **3** dot-separated parts | **5** dot-separated parts |
| Payload visible? | **Yes** (base64url, readable) | **No** (ciphertext) |
| Typical use | Access/ID tokens | Tokens carrying sensitive claims |

A JWE has five parts: `header.encrypted_key.iv.ciphertext.tag`. It uses a two-layer
scheme — a **content-encryption key (CEK)** encrypts the payload with an AEAD algorithm
(e.g. `A256GCM`), and the CEK itself is wrapped for the recipient using `alg` (e.g.
`RSA-OAEP`, `ECDH-ES`). The header's `enc` parameter names the content-encryption
algorithm.

> [!TIP]
> "Is a JWT encrypted?" — By default, **no**. A plain JWT is a JWS: signed but readable.
> Encryption requires a JWE. You can also nest them: sign then encrypt (a "nested JWT")
> to get both authenticity and confidentiality.

The interview trap: candidates say "the JWT is secure because it's encrypted." A signed
JWT is *not* encrypted. If confidentiality of the claims matters, you need JWE (or you
keep the sensitive data server-side and only reference it by an opaque id).

---

## JWT claims: iss, sub, aud, exp, nbf, iat, jti

RFC 7519 defines seven **registered claims**. None are mandatory by the spec, but a
secure verifier treats several of them as required:

| Claim | Name | Meaning | Verifier must |
|---|---|---|---|
| `iss` | Issuer | Who minted the token | Match the expected issuer |
| `sub` | Subject | The principal (user id) | — |
| `aud` | Audience | Who the token is *for* | Confirm this service is in `aud` |
| `exp` | Expiration | Not valid after (NumericDate) | Reject if `now >= exp` |
| `nbf` | Not Before | Not valid before | Reject if `now < nbf` |
| `iat` | Issued At | When it was minted | Optional freshness / age checks |
| `jti` | JWT ID | Unique token identifier | Use for replay/denylist/revocation |

`NumericDate` values are **seconds since the Unix epoch (UTC)**, not milliseconds — a
common bug is passing JavaScript `Date.now()` (milliseconds), which pushes `exp`
thousands of years into the future and effectively disables expiry.

Beyond registered claims, tokens carry **public claims** (collision-resistant, e.g.
namespaced URIs or IANA-registered like OIDC's `email`) and **private claims** (agreed
between issuer and consumer, e.g. `roles`, `tenant_id`).

> [!KEY-TAKEAWAY]
> The three claims an interviewer expects you to validate on *every* request are `exp`
> (is it expired?), `aud` (is this token meant for me?), and `iss` (did I trust the
> issuer that signed it?). See "Missing claim validation" for why each matters.

---

## Signing algorithms: HS256 vs RS256 and ES256

JWA (RFC 7518) defines the `alg` values. They fall into two families:

**Symmetric (HMAC)** — `HS256`, `HS384`, `HS512`. One shared secret both **signs and
verifies**. Fast and simple, but everyone who can verify can also forge. Only suitable
when the same trust boundary owns both sides (e.g. one service issues and verifies its
own tokens).

**Asymmetric (digital signature)** — `RS256`/`RS384`/`RS512` (RSASSA-PKCS1-v1_5),
`PS256`... (RSA-PSS), `ES256`/`ES384`/`ES512` (ECDSA). A **private key signs**; the
**public key verifies**. This is the right choice for distributed systems: the
authorization server holds the private key, and any number of resource servers verify
with the freely-distributable public key. A compromised resource server cannot mint
tokens.

| | Symmetric (HS*) | Asymmetric (RS*/ES*/PS*) |
|---|---|---|
| Keys | One shared secret | Private (sign) + public (verify) |
| Who can forge | Anyone who can verify | Only the private-key holder |
| Key distribution | Must share secret secretly | Publish public key (JWKS) |
| Best for | Single trust boundary | Multi-service / third-party verify |

- `ES256` (ECDSA on P-256 with SHA-256) produces much smaller signatures and keys than
  `RS256` and is generally preferred for new asymmetric designs.
- `HS256` with a strong, high-entropy secret is fine within one service; the danger is
  a *weak* secret (see brute force) or *sharing* it across boundaries.

> [!WARNING]
> Mixing families is where **key-confusion** attacks live: if a public verification key
> can be fed to an HMAC verifier as its "secret," an attacker who has the (public) key
> can forge tokens. See "HS/RS key-confusion attack."

---

## Attack: alg:none signature bypass

**Vulnerable pattern.** RFC 7518 defines `"none"` as the "Unsecured JWS" algorithm — a
token with an *empty* signature. Some libraries historically honored it: if the header
says `{"alg":"none"}`, the verifier skipped signature checking entirely.

**Concrete exploit.** The attacker takes a legitimate token, rewrites the header to
`{"alg":"none","typ":"JWT"}`, edits the payload freely, and drops the signature (leaving
the trailing dot):

```
# Forged token — note the empty third segment
eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9.
```

If the server calls `decode()`/`verify()` without pinning the algorithm, it reads the
`alg` from the token, sees `none`, and accepts the forged claims. This bypasses the
signature completely.

**Correct defense.**
- **Pin the accepted algorithm(s) at the verifier** — pass an explicit allowlist (e.g.
  "only `RS256`") and reject everything else, including `none`. Never let the token's own
  header choose the verification algorithm.
- Ensure your library rejects `none` by default (most modern ones do, but confirm).
- Case-check: some filters that blocked `"none"` were bypassed with `"None"`, `"nOnE"`,
  or `"NONE"` — the fix is an algorithm allowlist, not a string blocklist.

> [!KEY-TAKEAWAY]
> The root cause of `alg:none` is **trusting the token to describe how to verify itself**.
> The verifier, not the token, must decide the algorithm.

---

## Attack: HS/RS key-confusion (algorithm confusion)

**Vulnerable pattern.** A server is designed to verify `RS256` tokens using the
authorization server's **public** RSA key. But the verification code passes that key
into a generic `verify(token, key)` that reads the algorithm from the token header. RSA
public keys are, by definition, **public** — often served at a JWKS or `.pem` endpoint.

**Concrete exploit.** The attacker:
1. Obtains the server's RSA **public** key (it's published).
2. Crafts a token with header `{"alg":"HS256"}`.
3. Computes the signature as **HMAC-SHA256 using the RSA public key bytes as the HMAC
   secret**.

Now the verifier, reading `alg:HS256` from the header, runs HMAC verification with the
same public key it holds — and it matches. The attacker forged a valid token using only
public information.

```
Server expects:  RS256, verify with RSA public key  (asymmetric)
Attacker sends:  HS256, HMAC over header.payload keyed with that same public key
Vulnerable code: verify(token, publicKey)  # alg taken from token -> HMAC path
Result:          signature valid -> forged token accepted
```

**Correct defense.**
- **Restrict `alg` to an allowlist** that matches the key type. If you verify with an RSA
  public key, only accept `RS256`/`PS256` — never let an HS* token be verified with an
  asymmetric key.
- Use verification APIs that bind the **key type to the algorithm** so an RSA key can
  never be used as an HMAC secret.

This is CVE-worthy and has hit many libraries; it is one of the most-asked JWT interview
attacks precisely because the fix ("pin the algorithm to the key type") is so easy to
get wrong.

---

## Attack: weak HMAC secret brute force

**Vulnerable pattern.** An `HS256` token's security rests entirely on the secret. If the
secret is a short/dictionary word (`secret`, `changeme`, `password`, a framework's
default), it can be recovered **offline**.

**Concrete exploit.** The attacker captures one valid token (they see it in their own
session) and runs an offline cracker (e.g. `hashcat` mode 16500, or `jwt_tool`) that
tries candidate secrets, recomputes the HMAC over `header.payload`, and compares to the
token's signature. No server interaction, no rate limit — pure offline compute. Once the
secret is found, the attacker signs arbitrary tokens (any `sub`, any `role`).

**Correct defense.**
- Use a **high-entropy random secret of at least 256 bits (32 bytes)** for HS256 — RFC
  7518 §3.2 requires a key **at least as long as the hash output**. Generate it with a
  CSPRNG; never a passphrase.
- Prefer **asymmetric** algorithms (RS256/ES256) so verifiers never hold a forge-capable
  secret at all.
- Store the secret in a secrets manager, rotate it, and never commit it to source.

> [!WARNING]
> "Just use HS256, it's simpler" is fine only with a truly random 32+ byte key kept
> inside one trust boundary. A human-memorable HMAC secret is a forged-token generator.

---

## Attack: missing claim validation of exp aud and iss

Even with a perfect signature, a JWT is only as safe as the claim checks. Signature
validity means "this token was signed by a key I trust" — **not** "this token is for me,
right now."

**Missing `exp`.** If the verifier doesn't check expiry, a leaked token is valid forever.
A stolen token from months ago still works. Always reject when `now >= exp` (with only a
small clock-skew leeway, e.g. 60 s).

**Missing `aud`.** Suppose one issuer mints tokens for several services (a billing API and
an admin API) with the same key. If the admin API doesn't verify `aud`, a token minted
for the *billing* API — obtained legitimately — is accepted by the admin API. Always
confirm this service's identifier is in `aud`.

**Missing `iss`.** If you fetch keys by `kid` from a JWKS but never check `iss`, a token
signed by a *different* trusted issuer (or an attacker-controlled issuer you also trust
for something else) may validate. Pin the expected `iss`.

```
# Vulnerable: signature-only
if verify_signature(token, key): grant_access()   # forgets exp/aud/iss

# Fixed: signature AND claims
claims = verify(token, key, algorithms=["RS256"],
                audience="https://admin.api.example.com",
                issuer="https://auth.example.com")
# library rejects on bad sig, expired exp, wrong aud, wrong iss
```

> [!KEY-TAKEAWAY]
> Signature verification and claim validation are **two separate gates**. A token can
> have a perfect signature and still be expired, replayed, or meant for another service.

---

## Attack: kid header injection via path traversal and SQLi

The optional **`kid` (key ID)** header tells the verifier *which* key to use — handy for
key rotation. The vulnerability arises when the server uses the attacker-controlled `kid`
value **unsanitized** to locate the key.

**Path traversal.** If `kid` is used as a filename — `keys/<kid>.pem` — an attacker sets
`kid` to point at a file with **predictable contents** and signs the token accordingly.
Classic payloads target a file whose bytes the attacker knows:

```
{"alg":"HS256","kid":"../../../../dev/null"}
```

`/dev/null` reads as an **empty** string. If the server uses the file's (empty) contents
as an HMAC key, the attacker just signs the token with an empty key and it verifies.
Other variants point at a static, world-readable file with known contents.

**SQL injection.** If `kid` indexes a keys table — `SELECT key FROM keys WHERE id='<kid>'`
— a `kid` like `' UNION SELECT 'attacker-known-secret' -- ` makes the query *return an
attacker-chosen key*, which the attacker then uses to sign the token. `kid` injection can
also be a generic injection sink (LDAP, command, etc.).

**Correct defense.**
- Treat `kid` as **untrusted input**: allowlist it against known key IDs, or use it only
  as an exact-match lookup key in a parameterized query / fixed map.
- Never interpolate `kid` into a filesystem path, SQL string, or shell command.
- Pin the algorithm regardless, so even a recovered/empty key can't downgrade to `none`.

---

## Attack: jku and x5u header SSRF and key injection

`jku` (JWK Set URL) and `x5u` (X.509 URL) are JOSE header parameters that point at a
**URL where the verifier should fetch the key**. Trusting them blindly is dangerous on
two axes.

**Key injection / forgery.** If the verifier fetches the JWK Set from whatever URL the
token's `jku` names, an attacker hosts their *own* keypair at
`https://attacker.example/jwks.json`, signs the token with their private key, and points
`jku` at their JWKS. The server downloads the attacker's public key and happily verifies
the attacker's signature — total auth bypass.

**SSRF.** Because the server makes an outbound request to a token-controlled URL, `jku`/
`x5u` are also a **Server-Side Request Forgery** primitive: point them at
`http://169.254.169.254/…` (cloud metadata), internal admin endpoints, or use them to
port-scan the internal network via response/timing differences.

```
{"alg":"RS256","jku":"https://attacker.evil/jwks.json","kid":"1"}   # key injection
{"alg":"RS256","jku":"http://169.254.169.254/latest/meta-data/"}    # SSRF
```

**Correct defense.**
- **Do not fetch keys from a token-supplied URL.** Configure the JWKS URI out-of-band
  (from issuer metadata / config), not from the token header.
- If `jku`/`x5u` must be honored, **strictly allowlist the host** to the known issuer's
  domain and use TLS with cert validation; never follow redirects to other hosts.
- Verify the certificate chain (`x5u`/`x5c`) to a trusted CA and check it belongs to the
  expected issuer.

---

## JWKS and key rotation

A **JWK (RFC 7517)** is a JSON representation of a key; a **JWK Set (JWKS)** is
`{"keys":[…]}`. Asymmetric issuers publish their public keys at a well-known JWKS
endpoint (for OIDC, discoverable via `/.well-known/openid-configuration` →
`jwks_uri`). Each key has a `kid`; tokens reference it via the `kid` header.

This enables **key rotation without downtime**:
1. Issuer generates a new keypair with a new `kid` and adds the public key to the JWKS
   (now the set has both old and new keys).
2. Issuer starts signing new tokens with the new `kid`.
3. Verifiers pick the key by `kid` — old tokens still verify with the old key.
4. After all old tokens have expired, the issuer removes the old key from the JWKS.

**Threat-relevant practices for verifiers:**
- **Cache JWKS** but honor rotation — refetch on an unknown `kid` (with rate limiting to
  avoid a token-driven fetch storm / DoS on the JWKS endpoint).
- **Match `kid` exactly** against the fetched set; if `kid` is missing/unknown, fail
  closed rather than guessing.
- Still **pin the algorithm** and validate the certificate/host of the JWKS URI (fetched
  from trusted config, never from `jku`).

> [!TIP]
> Rotation is also your **incident response** lever: if a signing key is suspected
> compromised, roll the `kid`, remove the bad key from the JWKS, and shorten token TTL so
> already-issued tokens age out fast.

---

## The revocation problem: short TTL, denylists, jti

The defining trade-off of JWTs: **statelessness means you cannot instantly un-issue a
token.** A self-contained signed token is valid until it *expires*, regardless of whether
the user logged out, was banned, or had their session compromised — the verifier does no
lookup, so there is nothing to flip. This is the flip side of the performance win.

Mitigation strategies (usually combined):

- **Short TTL + refresh tokens (the primary answer).** Give access tokens a short life
  (minutes). A stolen access token is only useful briefly. A long-lived **refresh token**
  (opaque, stored/tracked server-side) is exchanged for new access tokens and *can* be
  revoked because refresh is a stateful operation. This bounds exposure without a lookup
  on every request.
- **Denylist / blocklist by `jti`.** Maintain a server-side set of revoked token IDs
  (`jti`), checked on each request. This reintroduces state and a lookup — you trade some
  of JWT's statelessness for immediate revocation. Keep entries only until each token's
  `exp` (then they're moot), so the list stays small.
- **Token versioning / "not-valid-before" per user.** Store a `token_version` or
  `min_iat` per user; bump it on logout/password-change/ban so all older tokens fail. One
  small lookup, revokes *all* of a user's tokens at once.

| Approach | Statelessness | Revocation latency | Cost |
|---|---|---|---|
| Short TTL only | Fully stateless | Up to TTL | None |
| `jti` denylist | Stateful lookup/request | Immediate | Store + check per request |
| Per-user version/`min_iat` | Small lookup | Immediate (all tokens) | One record per user |

> [!INTERVIEW]
> "How do you log a user out / revoke a JWT immediately?" There is no clean stateless
> answer — say so. The honest response is: short-lived access tokens + revocable refresh
> tokens for the common case, plus a `jti` denylist or per-user token-version bump when
> you genuinely need *instant* revocation (and accept the added state).

---

## Refresh-token rotation and reuse detection

Refresh tokens are long-lived and therefore high-value theft targets. The modern defense
(recommended by OAuth 2.1 / the OAuth Security BCP) is **rotation with reuse detection**:

1. Every time a refresh token is exchanged, the server issues a **new** refresh token and
   invalidates the old one (one-time use).
2. The server remembers which refresh tokens belong to a **token family** (a chain from
   one login).
3. If an **already-used (rotated-out) refresh token is presented again**, that's a strong
   signal of theft — either the attacker or the victim is replaying an old token. The
   server **revokes the entire family**, forcing re-authentication.

```
login -> RT1
RT1 -> (AT, RT2)     RT1 now invalid
RT2 -> (AT, RT3)     RT2 now invalid
...
attacker replays RT1 -> REUSE DETECTED -> revoke whole family
```

This limits the damage of a stolen refresh token: either the legitimate client's next
rotation invalidates the stolen copy, or the attacker's use trips reuse detection and
kills the family. Store refresh tokens hashed at rest, bind them to the client, and give
them an absolute maximum lifetime.

---

## Sender-constrained tokens: DPoP and mTLS

Ordinary JWT access tokens are **bearer tokens**: *whoever holds it can use it*. If it
leaks (logs, referer headers, XSS, a proxy), the thief has full access. **Sender-
constrained (proof-of-possession)** tokens fix this by binding the token to a key only
the legitimate client holds, so a stolen token is useless without the key.

- **mTLS-bound tokens (RFC 8705).** The access token is bound to the client's **TLS
  client certificate**; the token embeds a thumbprint (`cnf.x5t#S256`). The resource
  server checks that the TLS connection used the matching certificate. A stolen token
  presented over a different TLS connection is rejected.
- **DPoP (RFC 9449, Demonstrating Proof-of-Possession).** The client generates a keypair
  and sends a signed **DPoP proof** JWT in a `DPoP` header on each request; the access
  token carries a thumbprint (`cnf.jkt`) of the client's public key. The server checks the
  proof is signed by the matching key and is fresh (bound to method/URI, has a nonce/`jti`
  against replay). Works over plain HTTPS without client certs.

```
Authorization: DPoP eyJ...   <- the access token (cnf.jkt binds it to a key)
DPoP: eyJ...                 <- fresh proof JWT signed by the client's private key
```

> [!KEY-TAKEAWAY]
> Bearer tokens fail open on theft; sender-constrained tokens (mTLS / DPoP) fail closed —
> a leaked token can't be used without the client's private key. Combine with short TTLs
> and HTTPS-only transport.

---

## Storing and transporting JWTs securely

Where the browser keeps a token decides its exposure:

| Storage | XSS-readable? | Sent automatically? | CSRF-exposed? |
|---|---|---|---|
| `localStorage`/`sessionStorage` | **Yes** (JS can read it) | No | No |
| Cookie **without** `HttpOnly` | Yes | Yes | Yes |
| Cookie with `HttpOnly; Secure; SameSite` | **No** | Yes | Mitigated by SameSite/CSRF token |

- **`localStorage`** is convenient but any XSS on the page can exfiltrate the token. Its
  risk is theft-via-script.
- **`HttpOnly` cookies** keep the token out of JavaScript's reach (mitigating XSS theft),
  but because cookies are sent automatically they need CSRF defenses (`SameSite`,
  anti-CSRF tokens). Set `Secure` (HTTPS only) and `HttpOnly` always.
- Regardless of storage: transport only over **TLS**, keep access-token TTL short, and
  avoid putting tokens in URLs/query strings (they leak into logs, history, `Referer`).

And, restating the confidentiality rule from the structure section: a signed JWT's
payload is **readable**, so don't store secrets there. Put only the minimum claims the
resource server needs; keep sensitive data server-side keyed by `sub`/`jti`.

---

## Common follow-up questions

- **"Is a JWT encrypted?"** No — a default JWT is a JWS: signed and integrity-protected,
  but the payload is base64url and readable. Encryption needs JWE.
- **"Why is `alg:none` dangerous and how do you stop it?"** It tells the verifier to skip
  the signature. Fix: pin an algorithm allowlist at the verifier; never read the algorithm
  from the token.
- **"Explain the RS256→HS256 confusion attack."** The public RSA key is fed to an HMAC
  verifier as its secret; since the key is public, anyone can forge. Fix: bind algorithm
  to key type.
- **"HS256 vs RS256 — when each?"** HS256 within one trust boundary with a strong random
  secret; RS256/ES256 when multiple/third-party services must verify without being able to
  mint.
- **"How do you revoke a JWT before it expires?"** No purely stateless way — short TTL +
  revocable refresh tokens, plus `jti` denylist or per-user token-version bump for instant
  revocation.
- **"Which claims do you always validate?"** Signature first, then `exp` (not expired),
  `nbf`, `aud` (for this service), and `iss` (trusted issuer).
- **"localStorage or cookie for the token?"** Trade-off between XSS (localStorage) and CSRF
  (cookie); `HttpOnly; Secure; SameSite` cookies mitigate XSS theft but need CSRF defense.
- **"What are sender-constrained tokens?"** mTLS-bound (RFC 8705) or DPoP (RFC 9449) tokens
  that bind the token to a client-held key so a stolen bearer token is useless.

## References

- RFC 7519 — JSON Web Token (JWT): https://www.rfc-editor.org/rfc/rfc7519
- RFC 7515 — JSON Web Signature (JWS): https://www.rfc-editor.org/rfc/rfc7515
- RFC 7516 — JSON Web Encryption (JWE): https://www.rfc-editor.org/rfc/rfc7516
- RFC 7517 — JSON Web Key (JWK / JWKS): https://www.rfc-editor.org/rfc/rfc7517
- RFC 7518 — JSON Web Algorithms (JWA): https://www.rfc-editor.org/rfc/rfc7518
- RFC 8725 — JSON Web Token Best Current Practices: https://www.rfc-editor.org/rfc/rfc8725
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Auth & Certificate-Bound Access Tokens: https://www.rfc-editor.org/rfc/rfc8705
- RFC 9449 — OAuth 2.0 Demonstrating Proof-of-Possession (DPoP): https://www.rfc-editor.org/rfc/rfc9449
- OWASP JSON Web Token Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
- OWASP Web Security Testing Guide — Testing JSON Web Tokens: https://owasp.org/www-project-web-security-testing-guide/
- OWASP ASVS (V3 Session Management, V6 Cryptography): https://owasp.org/www-project-application-security-verification-standard/
- NIST SP 800-57 — Recommendation for Key Management: https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
