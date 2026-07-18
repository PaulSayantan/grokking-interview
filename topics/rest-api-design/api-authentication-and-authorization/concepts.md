# API Authentication & Authorization Patterns

Almost every non-trivial API question eventually becomes an auth question: *who
is calling, what are they allowed to do, and how do you prove it on every single
request?* This topic is the **framework-agnostic, wire-level** view of that
problem — the headers, tokens, and request/response exchanges a client actually
sends, independent of Spring Security, Passport, `django-rest-framework`, or any
IdP's internals.

Two words that are constantly (and dangerously) conflated:

- **Authentication (authN)** — *who are you?* Verifying identity. Answered by
  credentials: an API key, a signed request, a client certificate, or a bearer
  token that some trusted party issued.
- **Authorization (authZ)** — *what are you allowed to do?* Verifying
  permissions. Answered by scopes, roles, ownership checks, and policy.

HTTP encodes the *failure* of each differently: **`401 Unauthorized`** means "I
don't know who you are / your credentials are missing or invalid" (an authN
failure — the name is a historical misnomer), while **`403 Forbidden`** means "I
know who you are, but you may not do this" (an authZ failure). Getting that pair
right is table stakes.

The anchor standards throughout: **RFC 9110** (HTTP Semantics, status codes and
the `Authorization`/`WWW-Authenticate` headers), **RFC 6749 + RFC 6750** (OAuth
2.0 framework and Bearer token usage), the **OAuth 2.1** consolidation draft,
**RFC 7519** (JWT), **RFC 7636** (PKCE), and the **OWASP API Security Top 10
(2023)**, whose #1 and #2 entries are both authorization/authentication failures.

> [!KEY-TAKEAWAY]
> AuthN proves identity, authZ proves permission. `401` = "who are you?",
> `403` = "you can't do that." Never leak *which* by using the wrong code, and
> never skip the per-object authorization check just because the token is valid.

---

## Authentication vs authorization

**The distinction.** Authentication establishes a *verified principal* (a user,
a service, a client application). Authorization decides whether that principal
may perform a specific action on a specific resource. A request can be perfectly
authenticated and still be forbidden.

**Why interviewers push on it.** The single most common real-world API breach
is **Broken Object Level Authorization (BOLA / IDOR)** — OWASP API1:2023. The
API authenticates the caller correctly, then trusts an ID from the request
(`GET /accounts/12345`) *without checking the caller owns account 12345*.
Authentication alone never protects data; you must authorize **every object
access** against the authenticated principal.

**Status-code contract (RFC 9110):**

| Situation | Status | Meaning |
|---|---|---|
| No / invalid / expired credentials | `401 Unauthorized` | AuthN failed — must include `WWW-Authenticate` header |
| Valid identity, insufficient permission | `403 Forbidden` | AuthZ failed — re-authenticating won't help |
| Object exists but caller can't see it (avoid leaking existence) | `404 Not Found` | Deliberate — hide the resource from unauthorized callers |

A `401` response **must** carry a `WWW-Authenticate` header telling the client
how to authenticate:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api", error="invalid_token",
                  error_description="The access token expired"
```

**Gotcha — leaking existence.** For sensitive resources, returning `403` on an
object the caller can't access still confirms the object *exists*. Some APIs
deliberately return `404` instead to avoid the information leak. This is a
conscious trade-off, not an accident.

> [!INTERVIEW]
> If asked "your token is valid — is the request authorized?", the answer is
> "not necessarily." A valid token proves identity and *maybe* coarse scope; it
> does **not** prove the caller owns the specific object in the path. That
> object-level check is the one most commonly forgotten.

---

## API keys

**What it is.** An API key is a single opaque, high-entropy string that
identifies (and often authenticates) a calling *application* — not usually an
end user. The server stores a hash of it and matches on each request. It is the
simplest possible scheme: no handshake, no expiry negotiation.

**Where to put it.** The correct place is a **request header**, typically a
custom header or `Authorization`:

```
GET /v1/weather?city=London HTTP/1.1
Host: api.example.com
X-API-Key: sk_live_9c8b7a6f5e4d3c2b1a09
```

```
Authorization: Bearer sk_live_9c8b7a6f5e4d3c2b1a09
```

**Why NOT the query string.** Putting the key in the URL
(`?api_key=sk_live_...`) is an anti-pattern because URLs are logged everywhere:
server access logs, proxy logs, browser history, `Referer` headers sent to third
parties, and analytics. The credential leaks into places you don't control. The
same argument applies to *any* token — see *Token placement*.

**Trade-offs vs OAuth.**

| Property | API key | OAuth 2.0 access token |
|---|---|---|
| Identifies | An application/project | A user *and/or* client, with scopes |
| Granularity | Coarse (whole key) | Fine (per-scope, per-user) |
| Expiry | Usually long-lived until rotated | Short-lived (minutes) + refresh |
| Delegated user consent | No | Yes (authorization code flow) |
| Setup cost | Trivial | Higher (authz server, flows) |
| Revocation | Delete/disable the key | Revoke token / short TTL |

**Rotation.** Because keys are long-lived, rotation is the main hygiene control.
The safe pattern is **overlapping validity**: issue a new key, support *both* old
and new simultaneously, migrate clients, then revoke the old key. Supporting
multiple active keys per account makes zero-downtime rotation possible. Keys
should be scoped/least-privilege (read-only vs read-write, per-environment
`sk_live_` vs `sk_test_`) and rate-limited per key.

> [!WARNING]
> API keys authenticate the *app*, not a user, and they don't expire on their
> own. Treat a leaked key as a full breach: it's a bearer credential — whoever
> holds it *is* the client. Never embed a secret key in a mobile app, SPA, or
> any public client where it can be extracted.

---

## OAuth 2.0 and 2.1 at the API level

**What it is.** OAuth 2.0 (**RFC 6749**) is a *delegated authorization*
framework: it lets a client obtain a limited **access token** to call an API on
behalf of a resource owner (user) or on its own behalf, *without* the client
ever handling the user's password. Four roles: **resource owner** (user),
**client** (the app), **authorization server** (issues tokens), **resource
server** (your API, which validates them).

**Key insight for API design:** your API (the *resource server*) usually doesn't
run the login UI or issue tokens. It just **validates the access token** on each
request and enforces scopes. The heavy lifting (login, consent, token issuance)
lives at the authorization server. This is exactly the "API-surface view" —
you consume tokens, you don't mint them.

**OAuth 2.1** is a consolidation draft (`draft-ietf-oauth-v2-1`, Standards-Track,
still in progress as of 2026) that folds in a decade of security best practice
and **removes insecure features**. The three changes worth memorizing:

1. **PKCE is required** for *all* authorization-code clients (not just public
   ones).
2. **The Implicit grant (`response_type=token`) is removed.**
3. **The Resource Owner Password Credentials (ROPC) grant is removed** — clients
   must never see the user's password.

**Common confusion:** OAuth 2.0 is an *authorization* framework, not an
authentication protocol. **OpenID Connect (OIDC)** is the identity layer built
*on top* of OAuth 2.0 that adds an **ID token** (a JWT) for authentication. If
you need "who is the user," that's OIDC; if you need "may this client call this
API," that's OAuth scopes.

> [!KEY-TAKEAWAY]
> At the API level, OAuth = "validate the access token and enforce its scopes on
> every request." Token *issuance* is the authorization server's job. OAuth 2.1
> makes PKCE mandatory and deletes the implicit and password grants.

---

## Authorization Code flow with PKCE

**When to use it.** This is the flow for a client acting **on behalf of a user**
— web apps, mobile apps, SPAs, CLIs. **PKCE (RFC 7636, "pixy")** is mandatory
for public clients (SPA/mobile, which can't keep a secret) and required for
*all* clients under OAuth 2.1.

**The problem PKCE solves.** In the bare authorization-code flow, an attacker who
intercepts the one-time `code` (e.g. via a malicious app registered on the same
mobile URL scheme, or a leaked redirect) could exchange it for tokens. PKCE binds
the code to a secret the legitimate client generated, so a stolen code is useless.

**The exchange (conceptually):**

1. Client generates a random **`code_verifier`** and its SHA-256 hash,
   **`code_challenge`** (`S256` method — `plain` is discouraged).
2. Redirect the user to the authorization server's `/authorize`:

   ```
   GET /authorize?response_type=code
       &client_id=s6BhdRkqt3
       &redirect_uri=https://app.example.com/cb
       &scope=read:orders write:orders
       &state=xyz&code_challenge=E9Melhoa...&code_challenge_method=S256
   ```
3. User authenticates and consents; the AS redirects back with a one-time
   `code` (and echoes `state` — a CSRF guard the client must verify).
4. Client exchanges the code at `/token`, proving it holds the verifier:

   ```
   POST /token HTTP/1.1
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code=SplxlOB...
   &redirect_uri=https://app.example.com/cb
   &client_id=s6BhdRkqt3&code_verifier=dBjftJeZ4CVP...
   ```
5. AS returns tokens:

   ```json
   { "access_token": "eyJ...", "token_type": "Bearer",
     "expires_in": 300, "refresh_token": "def502...",
     "scope": "read:orders write:orders" }
   ```

**Gotchas.** `state` (CSRF) and PKCE (code-injection) protect *different*
things — you need both. The implicit grant, which returned tokens directly in
the redirect URL fragment, is removed precisely because tokens in URLs leak
(logs, history, `Referer`); PKCE + code flow replaces it even for SPAs.

---

## Client Credentials flow

**When to use it.** **Machine-to-machine (M2M)** — a backend service, cron job,
or daemon calling an API **as itself**, with *no user involved*. There is no
browser, no redirect, no consent screen. This is the OAuth answer to "how does
service A authenticate to service B's API."

**The exchange.** The client authenticates directly with its own credentials and
gets an access token:

```
POST /token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded
Authorization: Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW   # client_id:client_secret

grant_type=client_credentials&scope=inventory:read
```

```json
{ "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }
```

**Key differences from the auth-code flow.**

- **No refresh token** is issued (RFC 6749 §4.4.3) — the client can just request
  a new token with its credentials whenever the old one expires.
- The token represents the **application's own identity and scopes**, not a
  user's delegated permission. There is no "resource owner."
- Requires a **confidential client** that can safely store `client_secret` — so
  it's server-side only, never a browser or mobile app.

**Trade-off vs API keys / mTLS for M2M.** Client credentials give you
short-lived, scoped, centrally-revocable tokens (better than a static API key)
at the cost of running an authorization server and a token round-trip. For very
high-trust internal service meshes, **mTLS** is often used instead or alongside.

> [!INTERVIEW]
> "Service A needs to call service B's API — which OAuth flow?" → **client
> credentials**. If the interviewer adds "on behalf of the logged-in user," it
> flips to **authorization code + PKCE** (or token exchange / on-behalf-of).

---

## Scopes and least privilege

**What they are.** **Scopes** are space-delimited strings in the access token
(and requested at `/authorize` or `/token`) that bound what the token can do:
`read:orders`, `write:orders`, `payments:refund`. They implement **least
privilege** at the token level — a token for a read-only widget should not carry
`write` or `delete` scopes.

**Scopes are coarse, not a full authorization system.** A scope says "this token
may write orders"; it does **not** say "this token may write *order 12345*." That
object-level ownership check (BOLA, API1:2023) is *your API's* job and cannot be
delegated to a scope. Interviewers love this distinction: scope = *what class of
operation*, ownership/RBAC check = *which specific instance*.

**Enforcement on the resource server:**

```
GET /orders/12345 HTTP/1.1
Authorization: Bearer eyJ...        # token scope: "read:orders"
```

The API must: (1) validate the token, (2) confirm it has `read:orders`, **and**
(3) confirm the authenticated subject owns/ may see order 12345. Missing (3) is
the classic vulnerability.

**Insufficient scope response** uses `403` with a specific error:

```
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope",
                  scope="write:orders"
```

**Gotcha — scope creep.** Overly broad scopes (`admin`, `*`) defeat the purpose;
design narrow, resource-oriented scopes and grant the minimum. Audiences
(`aud`) further bound a token to a specific API so a token minted for service X
can't be replayed against service Y.

---

## Bearer tokens and JWT

**Bearer token (RFC 6750).** "Bearer" means *whoever holds the token can use
it* — like cash. There's no additional proof of possession, so bearer tokens
**must** travel over TLS and be treated as secrets. They're sent in the
`Authorization` header:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM...
```

**JWT (RFC 7519).** A JWT is one *format* for a token: three Base64URL parts —
`header.payload.signature` — joined by dots. The payload holds **claims**:

```json
{ "iss": "https://auth.example.com", "sub": "user-123",
  "aud": "https://api.example.com", "exp": 1737331200,
  "iat": 1737330900, "scope": "read:orders", "jti": "a1b2c3" }
```

Standard claims: `iss` (issuer), `sub` (subject), `aud` (audience), `exp`
(expiry), `nbf` (not before), `iat` (issued at), `jti` (unique id for
revocation/replay). The signature (JWS) lets the resource server verify
integrity **without calling the authorization server** — that's the headline
benefit: **stateless, self-contained validation**.

> [!WARNING]
> "Bearer" ≠ "JWT". A bearer token can be an opaque random string *or* a JWT.
> And **JWT ≠ encrypted** — a signed JWT (JWS) is only Base64-encoded and fully
> readable. Never put secrets in JWT claims unless you use JWE (encryption).

**Opaque vs JWT trade-off:**

| | Opaque token | JWT (self-contained) |
|---|---|---|
| Validation | Introspection call to AS (RFC 7662) | Local signature check — no network |
| Revocation | Immediate (AS is source of truth) | Hard — valid until `exp` |
| Payload visible to client | No | Yes (unless JWE) |
| Best for | Sensitive, revocation-critical | High-throughput, distributed APIs |

---

## Access tokens vs refresh tokens

**Why two tokens.** Bearer access tokens can't be un-issued once leaked, so you
keep them **short-lived** (minutes) to limit the blast radius. But forcing the
user to log in every 5 minutes is unusable — so a long-lived **refresh token**
lets the client silently get a fresh access token.

| | Access token | Refresh token |
|---|---|---|
| Sent to | The resource server (your API) on every call | Only the authorization server's `/token` |
| Lifetime | Short (e.g. 5–15 min) | Long (hours–days), or rotating |
| Format | Often JWT | Usually opaque |
| If leaked | Limited window | Serious — can mint new access tokens |

**Refresh exchange:**

```
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=def502...&client_id=s6BhdRkqt3
```

**Refresh token rotation** (OAuth security BCP): each refresh issues a *new*
refresh token and invalidates the old one. If a stolen refresh token is reused
after the legitimate client already rotated it, the AS detects the reuse
(replay) and revokes the whole token family — a key defense for public clients.

**Gotchas.** A refresh token should **never** be sent to the resource server —
only to the AS. Client-credentials tokens get **no** refresh token (just
re-request). Access-token expiry is a trade-off: shorter = safer but more token
traffic; that's why it pairs with revocation strategy and refresh.

---

## Token placement: header vs cookie vs query string

Where the token rides on the request has real security consequences.

**1. `Authorization: Bearer` header — the default and recommended.**
Not sent automatically by browsers, so it's **immune to CSRF**. Not logged by
default. Works uniformly for browser and non-browser clients (RFC 6750 §2.1).

```
Authorization: Bearer eyJ...
```

**2. Cookie.** Browsers attach cookies *automatically* to matching requests —
convenient for classic web apps, but that auto-send is exactly what enables
**CSRF**. If you use cookies for API auth you must add `SameSite=Strict/Lax`,
`HttpOnly`, `Secure`, and often a CSRF token. Upside: `HttpOnly` cookies aren't
readable by JavaScript, mitigating token theft via **XSS** — the mirror-image
trade-off to header tokens (which JS *can* read, so are XSS-exposed but
CSRF-safe).

**3. Query string — never.** RFC 6750 §2.3 and OWASP both warn against it. URLs
land in access logs, proxy logs, browser history, bookmarks, and the `Referer`
header sent to third-party sites. A token in a URL is a leaked token.

| Placement | CSRF | XSS token theft | Logged in URLs | Verdict |
|---|---|---|---|---|
| `Authorization` header | Safe | Exposed (JS-readable) | No | Recommended for APIs |
| Cookie (`HttpOnly`,`SameSite`) | Vulnerable → needs mitigation | Protected | No | OK for same-site web apps |
| Query string | — | — | **Yes** | Never |

> [!KEY-TAKEAWAY]
> Header tokens vs cookie tokens is a CSRF-vs-XSS trade, not a free choice: the
> `Authorization` header dodges CSRF but is XSS-readable; an `HttpOnly` cookie
> dodges XSS-theft but invites CSRF. Query-string tokens lose both ways — never
> do it.

---

## HMAC request signing (AWS SigV4-style)

**What it is.** Instead of sending a bearer secret over the wire, the client uses
a shared secret **key** to compute an **HMAC signature over the request** (method,
path, headers, body hash, timestamp) and sends only the *signature*. The server
recomputes the signature with its copy of the secret and compares. **AWS
Signature Version 4 (SigV4)** is the canonical example.

**Why it beats a plain bearer token.**

- **The secret never travels** — only a derived signature does, so intercepting
  one request doesn't hand over the credential.
- **Integrity** — the signature covers the body/headers, so a tampered request
  fails verification (protects even without TLS, though you still use TLS).
- **Replay resistance** — the signed timestamp (and often a nonce) lets the
  server reject old or replayed requests (e.g. `X-Amz-Date` outside a ~5-minute
  skew window).

**Sketch of a SigV4 request:**

```
GET /prod/items HTTP/1.1
Host: api.example.com
X-Amz-Date: 20260719T120000Z
Authorization: AWS4-HMAC-SHA256
  Credential=AKIA.../20260719/us-east-1/execute-api/aws4_request,
  SignedHeaders=host;x-amz-date,
  Signature=5d672d79c15b13162d9279b0855cfba...
```

The `Signature` is derived through a chain: `canonical request → string to sign
→ signing key (HMAC chain over date/region/service) → signature`.

**Trade-offs.** Signing is **stateless and strong** but **complex** to implement
correctly (canonicalization bugs are common) and awkward for browsers. It shines
for **server-to-server** APIs and SDKs where a library handles it. Bearer tokens
are simpler; HMAC signing is stronger against interception and tampering.

**Gotcha.** Clock skew breaks signing: if the client clock drifts beyond the
allowed window, every request fails with an auth error — a classic
hard-to-diagnose production incident.

---

## mTLS for service-to-service

**What it is.** **Mutual TLS** extends the normal TLS handshake so *both* sides
present X.509 certificates: the client verifies the server (as usual) **and** the
server verifies the client's certificate against a trusted CA. Identity is proven
at the **transport layer**, before any application data — the connection itself
authenticates the caller.

**Why it's the gold standard for M2M.** The credential is a private key that
**never leaves the client** and never appears in a header or body — so there's no
bearer secret to steal from a log or an intercepted request. It's the backbone of
**zero-trust service meshes** (Istio, Linkerd, SPIFFE/SPIRE), where every pod
gets a short-lived cert and services mutually authenticate automatically.

**Where it fits:**

- Internal microservice ↔ microservice calls.
- High-assurance partner/B2B integrations (banking, payments — often combined
  with OAuth as "certificate-bound access tokens," RFC 8705, so a stolen token
  can't be used without the matching cert).

**Trade-offs.**

| | mTLS | Bearer token / OAuth |
|---|---|---|
| Proof of possession | Yes (private key) | No (bearer) unless cert-bound |
| Where enforced | Transport layer / proxy | Application layer |
| Fine-grained scopes | No (identity only) | Yes |
| Operational cost | High: cert issuance, rotation, revocation (PKI) | Lower |
| Browser-friendly | No | Yes |

**Gotcha.** mTLS proves *identity*, not *authorization* — you still need to map
the certificate subject to permissions. And the operational burden is real:
certificate lifecycle (issuance, short-lived rotation, CRL/OCSP revocation) is
the hard part, which is why it's usually automated by a mesh rather than done by
hand. mTLS is often terminated at a gateway/sidecar, not the app itself.

---

## Session vs token authentication for APIs

**Session (stateful).** The classic web model: the server authenticates once,
creates a **session record server-side**, and hands the client a **session ID**
in a cookie. Every request sends the cookie; the server looks the session up.

**Token (stateless).** The server issues a **self-contained token** (e.g. a
signed JWT). The client sends it in the `Authorization` header; the server
validates the signature **without any server-side lookup**.

| | Session (server-side) | Token (JWT, stateless) |
|---|---|---|
| Server state | Yes — session store | No (self-contained) |
| Validation | Store lookup each request | Local signature check |
| Revocation | Instant — delete the session | Hard — valid until `exp` |
| Horizontal scaling | Needs shared/sticky store | Trivial — any node validates |
| Transport | Cookie (CSRF-prone) | Header (CSRF-safe) |
| Cross-domain / mobile | Awkward | Natural |

**When each wins.** Sessions are great for **single-domain server-rendered web
apps** where instant logout/revocation matters and you already have a fast store
(e.g. Redis). Tokens win for **stateless, horizontally-scaled, multi-client**
APIs (mobile + SPA + third parties) and cross-service calls.

**The revocation catch with JWTs.** Because a signed JWT is valid until `exp`
with no server check, you *can't* instantly log someone out. Mitigations: keep
access tokens short-lived (minutes) + refresh tokens, maintain a **denylist** of
revoked `jti`s (which reintroduces state), or use token introspection for
sensitive operations. "Stateless" and "instantly revocable" are in tension —
name the trade-off.

> [!INTERVIEW]
> "JWTs are stateless, so how do you log a user out immediately?" The honest
> answer: you largely can't without adding state. You approximate it with short
> TTLs + refresh rotation, or a revocation list. Claiming JWTs give free instant
> revocation is a red flag.

---

## Choosing an auth model

There's no universal best — match the scheme to *who calls* and *the trust
model*. A decision guide interviewers respond well to:

| Caller / scenario | Recommended | Why |
|---|---|---|
| Third-party app acting for a **user** | OAuth 2 **authorization code + PKCE** | Delegated consent, no password sharing, scopes |
| Your own SPA / mobile app | Auth code + PKCE (public client) | Implicit grant removed; PKCE required |
| **Service-to-service**, same org | **mTLS** or **client credentials** | No user; strong identity, scoped tokens |
| Simple public/dev API, per-app quota | **API key** (rotatable, scoped) | Low friction; identifies the app |
| Server-rendered same-domain web app | **Session cookie** (`SameSite`,`HttpOnly`) | Instant revocation, XSS-resistant |
| High-integrity partner / financial | **HMAC signing** or **mTLS** (+ cert-bound tokens) | Proof of possession, tamper/replay resistance |

**Layering.** These combine: a public API might use OAuth for user auth *and*
API keys for app identification/quota, behind a gateway doing mTLS to
downstream services. A gateway commonly terminates auth (validates the token,
mTLS) and forwards a trusted internal identity header.

**Decision factors to name aloud:** Is there a user or just a machine? Public or
confidential client? Do you need fine-grained scopes or just identity? How
critical is instant revocation? What's the operational budget for PKI/an authz
server? Cross-domain/third-party or single-domain?

> [!KEY-TAKEAWAY]
> Start from the caller: **user-delegated → auth code + PKCE; machine-to-machine
> → client credentials or mTLS; simple app identity → API key; same-domain web →
> session.** Then layer defenses (short TTLs, scopes, per-object authz, gateway).

---

## Common security pitfalls (OWASP API Security Top 10 2023)

Auth is where APIs bleed. The 2023 list's top entries are almost all authN/authZ:

- **API1:2023 Broken Object Level Authorization (BOLA/IDOR)** — the #1 API risk.
  Authenticated caller reads/writes an object they don't own because the API
  trusts an ID from the request without an ownership check. Fix: authorize
  **every** object access against the subject.
- **API2:2023 Broken Authentication** — weak/missing token validation, no expiry
  check, accepting `alg: none` JWTs, guessable API keys, credential stuffing.
- **API3:2023 Broken Object Property Level Authorization** — over-exposing or
  allowing writes to fields the caller shouldn't see/set (mass assignment).
- **API5:2023 Broken Function Level Authorization** — a regular user reaching an
  admin-only endpoint because function-level role checks are missing.

**JWT-specific traps interviewers probe:**

- **`alg: none`** — a JWT header claiming no signature; a naive verifier accepts
  it unsigned. Always pin the expected algorithm server-side.
- **Algorithm-confusion (RS256→HS256)** — attacker flips an RS256 token to HS256
  and signs it with the *public* key (which the server then uses as an HMAC
  secret). Reject unexpected `alg`s.
- **Not verifying `exp`, `aud`, `iss`** — accepting expired tokens, or tokens
  minted for a different API (`aud` mismatch enables cross-service replay).
- **Trusting claims without checking the signature**, or fetching the signing key
  from an attacker-controlled `jku`/`kid`.

**General hygiene:** always TLS; short token TTLs; least-privilege scopes; rate
limit and lock out on auth endpoints; never put credentials in URLs; return
generic `401`/`403` without leaking whether the *username* or the *password* was
wrong; log auth failures for detection.

> [!WARNING]
> A valid signature is **not** authorization. The most expensive breaches are
> BOLA: the token is genuine, the algorithm is fine, `exp` is in the future — and
> the API still hands back another user's data because it never checked
> ownership of the object in the path.

---

## Common follow-up questions

- **"401 vs 403 — which is which?"** `401` = not authenticated (unknown/invalid
  credentials, must send `WWW-Authenticate`); `403` = authenticated but not
  permitted. Re-auth fixes a `401`, never a `403`.
- **"Where do you put an API key and why not the query string?"** A header
  (`Authorization` or `X-API-Key`); not the URL because URLs get logged, cached,
  and put in `Referer`/history.
- **"Which OAuth flow for a backend service calling another API?"** Client
  credentials (no user, no refresh token). For acting on behalf of a user, auth
  code + PKCE.
- **"Why is PKCE needed if I already send `state`?"** They defend different
  attacks: `state` = CSRF on the redirect; PKCE = authorization-code
  interception/injection. OAuth 2.1 requires PKCE for all clients.
- **"Access token vs refresh token?"** Access token is short-lived, sent to the
  API every call; refresh token is long-lived, sent only to the authz server to
  mint new access tokens; rotate refresh tokens.
- **"Is a JWT encrypted?"** No — a signed JWT (JWS) is only Base64URL-encoded and
  readable by anyone. Use JWE for confidentiality; never store secrets in claims.
- **"How do you revoke a JWT immediately?"** You can't cleanly — use short TTLs +
  refresh rotation or a `jti` denylist (which adds state). Trade-off, not free.
- **"When mTLS over bearer tokens?"** Service-to-service/zero-trust meshes and
  high-assurance partners: proof of possession, secret never on the wire; cost is
  PKI/cert lifecycle. Often combined as certificate-bound tokens (RFC 8705).
- **"What's the #1 API vulnerability?"** BOLA (OWASP API1:2023) — missing
  per-object authorization even when authentication is correct.

## References

- **RFC 9110** — HTTP Semantics (status codes `401`/`403`, `Authorization` and
  `WWW-Authenticate` headers): https://www.rfc-editor.org/rfc/rfc9110
- **RFC 6749** — The OAuth 2.0 Authorization Framework:
  https://www.rfc-editor.org/rfc/rfc6749
- **RFC 6750** — OAuth 2.0 Bearer Token Usage (header/body/query, why not query):
  https://www.rfc-editor.org/rfc/rfc6750
- **OAuth 2.1** — `draft-ietf-oauth-v2-1` (PKCE required; implicit & ROPC
  removed): https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1
- **RFC 7636** — Proof Key for Code Exchange (PKCE):
  https://www.rfc-editor.org/rfc/rfc7636
- **RFC 7519** — JSON Web Token (JWT):
  https://www.rfc-editor.org/rfc/rfc7519
- **RFC 7662** — OAuth 2.0 Token Introspection (opaque token validation):
  https://www.rfc-editor.org/rfc/rfc7662
- **RFC 8705** — OAuth 2.0 Mutual-TLS Client Auth & Certificate-Bound Tokens:
  https://www.rfc-editor.org/rfc/rfc8705
- **OpenID Connect Core** — identity layer on OAuth 2.0 (ID tokens):
  https://openid.net/specs/openid-connect-core-1_0.html
- **OWASP API Security Top 10 (2023)**:
  https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- **AWS Signature Version 4 signing process**:
  https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html
