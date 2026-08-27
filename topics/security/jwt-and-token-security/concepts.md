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

## Attack: embedded-key header injection (jwk and x5c)

The `jku`/`x5u` attacks above make the verifier *fetch* a key from a URL. A closer,
often-overlooked cousin embeds the key **directly in the token header** so no fetch is
needed at all. RFC 7515 §4.1.3 defines the `jwk` header parameter (an inline public JWK)
and §4.1.6 defines `x5c` (an inline X.509 certificate chain). Both describe the key that
*allegedly* signed the token.

**Embedded `jwk` injection (PortSwigger's #1 JWT lab).** The attacker generates their own
RSA/EC keypair, puts their **own public key** in the token's `jwk` header, edits the
claims, and self-signs with their matching private key:

```
{"alg":"RS256","typ":"JWT","jwk":{"kty":"RSA","n":"<attacker-n>","e":"AQAB"}}
```

A verifier that "helpfully" trusts the key advertised in the header will verify the
attacker's signature against the attacker's key — it always matches. This is total
forgery with no brute force and no SSRF. The bug is *self-referential trust*: the token
is telling the verifier which key proves the token, and the verifier believes it.

**Embedded `x5c` injection.** Same idea with a self-signed certificate chain in `x5c`.
It is more dangerous in a subtle way: verifying an `x5c` chain means parsing and
validating ASN.1/X.509, and complex certificate parsers have produced signature-forgery
and validation-bypass CVEs (e.g. CVE-2017-2800, CVE-2018-2633). An attacker can supply a
self-signed leaf and hope the library trusts the embedded chain instead of validating it
to a pinned CA.

**Correct defense.**
- **Never trust key material carried inside the token** — not `jwk`, not `x5c`, not
  `jku`/`x5u`. Resolve the verification key *only* from trusted server-side configuration
  or a JWKS URI pinned out-of-band, then match by `kid`.
- If a design genuinely needs `x5c`, validate the full chain to a **pinned trust anchor**
  and confirm the leaf's subject/thumbprint matches the expected issuer — do not accept a
  self-signed chain.
- Pin the algorithm to the resolved key regardless.

> [!KEY-TAKEAWAY]
> `jwk`/`x5c` (inline key) and `jku`/`x5u` (key URL) are the same root cause as
> `alg:none`: the token dictating its own verification. The universal fix is *the
> verifier chooses the key and algorithm, from trusted config, never from the token*.

---

## Header abuse: cty, crit, and content-type confusion

Two more JOSE header parameters are quietly security-relevant.

**`crit` (critical headers), RFC 7515 §4.1.11.** `crit` lists header parameters that the
recipient **MUST understand and process**. If a token carries a `crit` entry naming an
extension the verifier does not implement, the verifier is *required to reject the token*.
Libraries that silently ignore `crit` violate the spec and can be tricked into skipping
directives an attacker relies on (or into accepting tokens they should reject). Testable
"which behavior is spec-correct" material: unknown `crit` extension → reject, do not
ignore.

**`cty` (content type) chained injection.** Once a signature bypass already exists (say,
`alg:none` or a key-confusion forgery), the attacker can also control `cty`. Setting
`cty` to something like `text/xml` or `application/x-java-serialized-object` can steer a
naive consumer that dispatches on `cty` into an **XXE or insecure-deserialization** path
when it processes the (attacker-controlled) payload. This reframes JWT parsing as an
*injection vector*, not merely an authentication bypass — the token becomes a delivery
mechanism for a second-stage exploit.

**Correct defense.** Honor `crit` per the spec (reject unknown critical extensions), and
never feed a JWT payload into a content-type-driven deserializer/parser based on
attacker-controlled `cty`. Combined with a strict algorithm allowlist, this closes the
chained path.

---

## Algorithm confusion when the public key is not published

The key-confusion section above assumed the RSA public key is published at a JWKS
endpoint. Senior interviewers push further: *what if the public key is NOT exposed?*

Even then the attack is often feasible. RSA signatures leak enough structure that, given
**two different tokens** signed by the same key, tools such as PortSwigger's `sig2n`
(`rsa_sign2n`, run via `docker run portswigger/sig2n <token1> <token2>`) recover a small
set of **candidate RSA moduli `n`**. The attacker then tries each candidate as an HMAC
secret for a forged `HS256` token; if the server is vulnerable to HS/RS confusion, one
candidate will validate.

A crucial byte-exactness gotcha makes or breaks the forgery: the HMAC secret must match
the server's public key **byte-for-byte in the exact serialization the server uses** —
including PEM header/footer lines, the trailing newline, and X.509 (SPKI) vs PKCS#1
encoding. `sig2n` produces both a PKCS#1 and an X.509 variant precisely because the
attacker doesn't know which the server holds.

**Correct defense** is identical to the published-key case and does not depend on hiding
the key: **bind the accepted algorithm to the key type** (an RSA key can only be used
for `RS256`/`PS256`, never as an HMAC secret). Secrecy of the public key is not a
security control — treat every public key as public.

---

## Token sidejacking and the user-context fingerprint defense

**Token sidejacking** is the theft-and-replay of a bearer token: an attacker who captures
a token from logs, a shared machine, a network position, or an XSS payload simply presents
it and is indistinguishable from the victim. Short TTLs and TLS reduce the window but do
not, by themselves, stop replay within that window.

OWASP's primary stateless mitigation is a **user-context fingerprint** (a hardened-cookie
binding):

1. At login, generate a **high-entropy random string** with a CSPRNG (the "fingerprint").
2. Send the **raw** fingerprint to the client in a hardened cookie:
   `__Secure-Fgp=<random>; HttpOnly; Secure; SameSite=Strict; Max-Age <= JWT exp`.
3. Store only the **SHA-256 hash** of that fingerprint as a claim inside the JWT.
4. On each request, the verifier re-hashes the cookie value and compares it to the claim;
   mismatch → reject.

Why this design specifically works:

- A token stolen **alone** (e.g. leaked from an `Authorization` header, a proxy log, or a
  Referer) is useless without the matching `__Secure-Fgp` cookie, which the attacker did
  not capture.
- The token stores the **hash**, not the raw value, so an **XSS that reads the token**
  cannot reconstruct the cookie value — and the cookie itself is `HttpOnly`, so XSS
  cannot read it either. The attacker would need to steal *both* the token and the raw
  cookie.
- It doubles as a lightweight stateless logout: drop the cookie and the token no longer
  satisfies the fingerprint check.

This is defense-in-depth, not a substitute for sender-constrained tokens (DPoP/mTLS),
which cryptographically bind the token to a client-held key.

---

## RFC 8725: JWT Best Current Practices

RFC 8725 (BCP 225) is the consolidated "how not to get JWTs wrong" document, and
interviewers love a candidate who can cite it. Name the practices and the threats:

**Practices (§3).**
- **§3.1 Perform algorithm verification** — pin an explicit allowlist; never trust the
  token's `alg`.
- **§3.2 Use appropriate algorithms** — only vetted algorithms; reject `none` in secured
  contexts.
- **§3.5 Ensure cryptographic keys have sufficient entropy** — CSPRNG-generated,
  adequately sized.
- **§3.6 Avoid compression of encryption inputs** — compressing plaintext before
  encryption enables both DoS (decompression bombs) and compression side channels.
- **§3.8 / §3.9 Validate issuer and subject / audience** — check `iss`, `sub`, and `aud`.
- **§3.10 Do not trust received claims** — a claim's presence is not proof; validate
  against expectations and authorization state.
- **§3.11 Use explicit typing** — set and check the `typ` header (e.g. `at+jwt`) to
  prevent one token type being accepted where another is expected.
- **§3.12 Use mutually exclusive validation rules for different kinds of JWTs** — an
  access-token verifier and an ID-token verifier must not accept each other's tokens.

**Threats (§2).**
- **§2.7 Substitution** — a token valid in one context reused in another.
- **§2.8 Cross-JWT confusion** — one JWT type accepted where a different type was intended.
- **§2.3 Incorrect composition of encryption and signature** — e.g. relying on encryption
  for integrity, or the wrong sign/encrypt ordering.

---

## Cross-JWT confusion and explicit typing (at+jwt)

Distinct from a missing `aud` check: even when audiences look plausible, a resource
server can be tricked into accepting a token minted for a *different purpose* — the classic
case is a resource server that accepts an OIDC **ID token** as an **access token**. ID
tokens and access tokens have different intended recipients and semantics; conflating them
(RFC 8725 §2.8 cross-JWT confusion) can grant API access to a token that was only meant to
authenticate a user to a client.

The standards-based fix is **explicit typing** from **RFC 9068** ("JWT Profile for OAuth
2.0 Access Tokens"):

- Access tokens carry the header `typ: at+jwt`, and the verifier **must check `typ`** and
  reject anything that is not an access token.
- Each access token has a resource-specific `aud`, so a token for API A is not valid at
  API B.
- RFC 9068 **prohibits `none`** and makes **RS256 mandatory-to-implement**, with servers
  free to support stronger algorithms.

This operationalizes BCP §3.11 (explicit typing) and §3.12 (mutually exclusive validation
rules): the ID-token validator and the access-token validator use disjoint acceptance
criteria, so neither accepts the other's tokens.

---

## Clock skew and leeway for exp, nbf, and iat

`exp` and `nbf` are absolute `NumericDate` instants compared against the verifier's clock,
so **clock skew between issuer and verifier is a real operational hazard**. If the
verifier's clock trails the issuer's, a freshly minted token can appear *not yet valid*
(`nbf`/`iat` in the future); if it runs ahead, tokens appear expired early.

The standard remedy is a small **leeway** (grace window), commonly `<= 60s`, applied to
`exp`/`nbf` comparisons, plus clock synchronization (NTP). The trade-off is explicit:
- **Too little leeway** → legitimate tokens intermittently rejected on desynced hosts (the
  classic "valid tokens suddenly failing" incident).
- **Too much leeway** → an expired token stays acceptable longer, widening the replay
  window.

`iat` (issued-at) is not an expiry, but it enables **freshness/max-age** policies (reject
tokens older than N minutes for sensitive operations) and anchors the per-user `min_iat`
revocation trick from the revocation section.

---

## ECDSA pitfalls: psychic signatures and malleable signatures

ECDSA-signed JWTs (`ES256`/`ES384`/`ES512`) carry two subtle, high-severity traps.

**CVE-2022-21449 — "Psychic Signatures" (Java).** An ECDSA signature is a pair `(r, s)`
that must satisfy `1 <= r, s < n` (the curve order); the value `0` is invalid and the
point at infinity must be rejected. Java 15–18 (before the April 2022 CPU: fixed in
15.0.7 / 16.0.3 / 17.0.3 / 18.0.1) **failed to check that `r` and `s` are non-zero**, so an
all-zero signature `(r=0, s=0)` verified against **any** public key and message. Because
JWS uses raw `SHA256withECDSAinP1363Format`, an attacker could forge any `ES256` JWT by
sending a signature of all-zero bytes. Root cause: skipping the spec's `1 <= r,s < n` and
point-at-infinity checks. This is a canonical "name the CVE and the root cause" question.

**Signature malleability and denylist keying.** A valid ECDSA signature `(r, s)` has a
second, equally valid form `(r, (-s) mod n)`. Both verify successfully, but they are
**different bytes**, so the two tokens have different `SHA-256(token)` hashes. Consequence:
a revocation **denylist keyed on a hash of the raw token bytes** can be bypassed — the
attacker takes a revoked token, flips `s` to `(-s) mod n`, and the "new" token verifies but
is not in the denylist. The same problem arises from non-strict base64url parsing (extra
padding or trailing bits produce byte-different-but-accepted tokens).

**Correct defense.** Key the denylist on stable, **signed** payload fields — the pair
**`(jti, iss)`** — not on a hash of the raw serialized token. The pair is used (not `jti`
alone) because `jti` uniqueness is only guaranteed **per issuer**. Additionally: keep JVMs
patched, prefer libraries that enforce low-`s` canonical ECDSA, and consider deterministic
ECDSA (RFC 6979) in low-entropy/embedded environments to avoid nonce-reuse private-key
leakage.

---

## JWT denial-of-service: decompression bombs and resource exhaustion

Beyond forgery, JWT/JOSE processing has **algorithmic-complexity DoS** vectors that a
senior appsec engineer is expected to know.

**JWE decompression bomb — python-jose CVE-2024-33664.** JWE supports a `zip: "DEF"`
header that DEFLATE-compresses the plaintext before encryption. A tiny ciphertext can
inflate to an enormous plaintext on decryption, spiking a verifier's memory (a ~200-byte
token expanding to gigabytes). The standards hook is **RFC 8725 §3.6 "Avoid compression of
encryption inputs."** Defense: disable `zip` where not required, and **cap decompression
output size** with a hard limit.

**Other resource-exhaustion vectors.** Accepting **huge RSA keys** (multi-thousand-bit
moduli) makes verification arbitrarily expensive; **deeply nested JWEs** (encrypt inside
encrypt) multiply parsing cost; oversized JWKS responses can exhaust memory. Defenses:
**bound key sizes**, **limit nesting depth**, cap token and JWKS response sizes, and
enforce parse-time limits before doing crypto.

> [!KEY-TAKEAWAY]
> Availability is part of token security. Cap decompression output, bound key sizes, and
> limit nesting/response sizes so a small malicious token can't consume disproportionate
> resources.

---

## Algorithm selection and JWE hardening

**Current algorithm recommendations.** Guidance has shifted: OWASP now marks **`RS256`
(RSASSA-PKCS1-v1_5) as "not recommended"** for new designs and recommends **EdDSA
(Ed25519)**, **`ES256`**, or **`PS256`** (RSA-PSS) instead. (RFC 9068 still mandates
`RS256` as mandatory-to-implement for interop, but you may prefer stronger algorithms.)
For low-entropy or embedded signers, prefer **deterministic ECDSA (RFC 6979)** to avoid
catastrophic private-key leakage from nonce reuse.

**HMAC key sizing (tightened).** "At least 256 bits" is the floor; the precise bar is:
the secret **MUST be at least the hash output size** (256/384/512 bits for
HS256/384/512), **have at least ~160 bits of entropy**, and be **CSPRNG-generated** —
never a password or passphrase (RFC 2104 §3, RFC 7518 §3.2).

**`alg:none` nuance.** RFC 7515 requires the signature segment be **empty** for `none`.
The real fix is a **positive algorithm allowlist bound to key material**, not string
filtering — case variants (`None`, `nOnE`) and historical CVEs (the 2015 Auth0 disclosure;
multiple library CVEs 2018–2021) show why blocklists fail.

**JWE-specific threats (RFC 8725 §2.3–2.5).**
- **Sign-then-encrypt ordering** — for nested JWTs, **sign first, then encrypt**.
  Encrypt-then-sign lets an attacker strip or replace the outer signature.
- **AEAD only** — use authenticated encryption (`A256GCM`, or AES-CBC-HMAC with the
  integrated MAC). Non-AEAD modes are exposed to **padding-oracle** attacks.
- **Invalid-curve / ECDH attacks** — ECDH-ES key agreement without validating that the
  peer's point is actually on the curve leaked private keys in ~2017-era libraries;
  ensure point-on-curve validation.
- **Ciphertext-length leakage** — encryption hides content, not length; avoid leaking
  secrets through observable ciphertext size.

---

## When not to use a JWT

A staff-level answer includes knowing when a JWT is the *wrong* tool. OWASP's Session
Management guidance now explicitly cautions against using JWTs as general **session**
tokens, and many systems are better served by an **opaque server-side session** (or an
opaque reference token validated via introspection). Prefer opaque/server sessions when:

- **Instant revocation is a hard requirement** — a server session is deleted server-side
  and is gone immediately; a stateless JWT is valid until `exp` unless you bolt on a
  denylist (which reintroduces the very state JWTs were meant to avoid).
- **You need to store much data or mutable state** — a large JWT is sent on every request
  and inflates headers; server state is cheap to change without re-issuing tokens.
- **Simplicity and a single trust boundary** — if one app both creates and consumes the
  session, an opaque random session id in a `HttpOnly; Secure; SameSite` cookie is simpler
  and safer than stateless-verification crypto.

JWTs shine when **stateless, cross-service verification** genuinely matters (multiple
resource servers, third-party verifiers, no shared session store). If those forces are
absent, "we used JWTs because they're modern" is an antipattern.

> [!INTERVIEW]
> "When would you NOT use a JWT?" — When you need instant revocation, carry lots of mutable
> state, or have a single trust boundary. A plain opaque server session revokes instantly,
> stays small on the wire, and is simpler. Reach for JWTs when stateless multi-service
> verification is the actual requirement.

---

## Common follow-up questions

- "Is a JWT encrypted?" No — a default JWT is a JWS: signed and integrity-protected,
  but the payload is base64url and readable. Encryption needs JWE.
- "Why is `alg:none` dangerous and how do you stop it?" It tells the verifier to skip
  the signature. Fix: pin an algorithm allowlist at the verifier; never read the algorithm
  from the token.
- "Explain the RS256→HS256 confusion attack." The public RSA key is fed to an HMAC
  verifier as its secret; since the key is public, anyone can forge. Fix: bind algorithm
  to key type.
- "HS256 vs RS256 — when each?" HS256 within one trust boundary with a strong random
  secret; RS256/ES256 when multiple/third-party services must verify without being able to
  mint.
- "How do you revoke a JWT before it expires?" No purely stateless way — short TTL +
  revocable refresh tokens, plus `jti` denylist or per-user token-version bump for instant
  revocation.
- "Which claims do you always validate?" Signature first, then `exp` (not expired),
  `nbf`, `aud` (for this service), and `iss` (trusted issuer).
- "localStorage or cookie for the token?" Trade-off between XSS (localStorage) and CSRF
  (cookie); `HttpOnly; Secure; SameSite` cookies mitigate XSS theft but need CSRF defense.
- "What are sender-constrained tokens?" mTLS-bound (RFC 8705) or DPoP (RFC 9449) tokens
  that bind the token to a client-held key so a stolen bearer token is useless.
- "A token has an inline `jwk` header and verifies — what's wrong?" The verifier is
  trusting the key advertised in the token; an attacker self-signs with their own key. Same
  root cause as `jku`/`x5c`/`alg:none`: resolve keys only from trusted config, never the token.
- "A revoked ES256 token still works despite a denylist — why?" The denylist keys on a
  hash of the raw token; ECDSA malleability `(r, -s mod n)` yields a byte-different but valid
  token. Key the denylist on `(jti, iss)` from the signed payload instead.
- "ES256 verifies an all-zero signature on Java 17.0.2 — name it." CVE-2022-21449
  "psychic signatures": the JVM skipped the `1 <= r,s < n` / point-at-infinity check.
- "A 200-byte JWE spikes the verifier to gigabytes — why?" A `zip:"DEF"` decompression
  bomb (python-jose CVE-2024-33664); cap decompression output — RFC 8725 §3.6.
- "A resource server accepts an OIDC ID token as an access token — class and fix?"
  Cross-JWT confusion (RFC 8725 §2.8); enforce explicit typing `typ: at+jwt` and per-resource
  `aud` per RFC 9068.
- "When would you NOT use a JWT?" When you need instant revocation, carry lots of mutable
  state, or have a single trust boundary — an opaque server session is simpler and revokes now.

## References

- RFC 7519 — JSON Web Token (JWT): https://www.rfc-editor.org/rfc/rfc7519
- RFC 7515 — JSON Web Signature (JWS): https://www.rfc-editor.org/rfc/rfc7515
- RFC 7516 — JSON Web Encryption (JWE): https://www.rfc-editor.org/rfc/rfc7516
- RFC 7517 — JSON Web Key (JWK / JWKS): https://www.rfc-editor.org/rfc/rfc7517
- RFC 7518 — JSON Web Algorithms (JWA): https://www.rfc-editor.org/rfc/rfc7518
- RFC 8725 — JSON Web Token Best Current Practices: https://www.rfc-editor.org/rfc/rfc8725
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Auth & Certificate-Bound Access Tokens: https://www.rfc-editor.org/rfc/rfc8705
- RFC 9449 — OAuth 2.0 Demonstrating Proof-of-Possession (DPoP): https://www.rfc-editor.org/rfc/rfc9449
- RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens (`at+jwt`): https://www.rfc-editor.org/rfc/rfc9068
- RFC 6979 — Deterministic Usage of DSA and ECDSA: https://www.rfc-editor.org/rfc/rfc6979
- RFC 2104 — HMAC: Keyed-Hashing for Message Authentication: https://www.rfc-editor.org/rfc/rfc2104
- OWASP JSON Web Token Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Web Security Testing Guide — Testing JSON Web Tokens: https://owasp.org/www-project-web-security-testing-guide/
- OWASP ASVS (V3 Session Management, V6 Cryptography): https://owasp.org/www-project-application-security-verification-standard/
- PortSwigger Web Security Academy — JWT attacks: https://portswigger.net/web-security/jwt
- NIST SP 800-57 — Recommendation for Key Management: https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
- CVE-2022-21449 — ECDSA "Psychic Signatures" (Java): https://nvd.nist.gov/vuln/detail/CVE-2022-21449
- CVE-2024-33664 — python-jose JWE decompression DoS: https://nvd.nist.gov/vuln/detail/CVE-2024-33664
- CVE-2024-33663 — python-jose algorithm confusion with OpenSSH ECDSA keys: https://nvd.nist.gov/vuln/detail/CVE-2024-33663
- node-jsonwebtoken CVEs (2022-23529 / 23539 / 23540 / 23541): https://github.com/auth0/node-jsonwebtoken/security
- IETF Token Status List (draft-ietf-oauth-status-list): https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/
