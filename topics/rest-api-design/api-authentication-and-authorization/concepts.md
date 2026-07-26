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

**How this file is organized.** Core schemes come first (API keys, OAuth flows,
bearer/JWT, token placement, session-vs-token), then the *Choosing an auth model*
decision guide, then advanced and FAPI-grade extensions (DPoP, token exchange,
JWKS rotation, mTLS specifics, PAR/RAR, SigV4 internals). A couple of topics are
deliberately split — the scheme's essentials up front, its deep-dive later — with
a forward-reference where that happens; skim the core sections, treat the later
ones as reference by name.

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

```mermaid
sequenceDiagram
    participant U as User-Agent (browser)
    participant C as Client (app)
    participant AS as Authorization Server
    participant RS as Resource Server (API)
    C->>C: gen code_verifier; challenge=base64url(SHA256(verifier))
    C->>AS: /authorize?...&code_challenge=E9Mel...&method=S256&state=xyz
    Note over AS: stores challenge against issued code
    AS->>U: login + consent
    AS-->>C: 303 redirect ?code=Splxl...&state=xyz
    C->>AS: POST /token code=Splxl... + code_verifier=dBjft...
    Note over AS: recompute SHA256(verifier)==stored challenge?
    AS-->>C: access_token (+ refresh_token)
    C->>RS: GET /orders  Authorization: Bearer <access_token>
    RS-->>C: 200 (after validating token + object-level authz)
```

1. Client generates a random **`code_verifier`** and its SHA-256 hash,
   **`code_challenge`** (`S256` method — `plain` is discouraged).
2. Redirect the user to the authorization server's `/authorize`:

   ```
   GET /authorize?response_type=code
       &client_id=s6BhdRkqt3
       &redirect_uri=https://app.example.com/cb
       &scope=read:orders write:orders
       &state=xyz
       &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
       &code_challenge_method=S256
   ```
3. User authenticates and consents; the AS redirects back with a one-time
   `code` (and echoes `state` — a CSRF guard the client must verify).
4. Client exchanges the code at `/token`, proving it holds the verifier:

   ```
   POST /token HTTP/1.1
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code=SplxlOB...
   &redirect_uri=https://app.example.com/cb
   &client_id=s6BhdRkqt3
   &code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
   ```
5. AS returns tokens:

   ```json
   { "access_token": "eyJ...", "token_type": "Bearer",
     "expires_in": 300, "refresh_token": "def502...",
     "scope": "read:orders write:orders" }
   ```

**Worked example — how the verifier binds to the challenge (S256).** Take the
real RFC 7636 test vector so you can see the two values above are *not*
unrelated placeholders — they are a hash pair:

```
code_verifier  = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk   (43-char random, step 1)
                 │
                 ▼  SHA-256 over the ASCII bytes → 32 raw bytes
digest (hex)   = 13d31e96...cb70f9c3  (32 raw bytes, abbreviated)
                 │
                 ▼  base64url-encode, strip '=' padding
code_challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM   (sent to /authorize, step 2)
```

The AS stores `code_challenge` alongside the issued `code`. At `/token` (step 4)
the client sends the raw `code_verifier`; the AS recomputes
`base64url(SHA256(verifier))` and checks it **equals the stored challenge**. An
attacker who intercepted only the `code` never had the verifier, and
`SHA256(anything-else)` won't reproduce `E9Melhoa...`, so the stolen code is
dead. (With `plain` the "challenge" *is* the verifier, so anyone who saw the
`/authorize` URL could replay it — that's why `S256` is the norm.)

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

**Worked example — decode the header yourself.** Take the first segment of the
token in the `Authorization` example above (everything before the first dot):

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9
```

Base64URL-decode it (no key required — this is *encoding*, not encryption):

```
$ echo 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9' | base64 -d
{"alg":"RS256","typ":"JWT"}
```

Anyone on the wire can do the identical thing to the **payload** segment and
read every claim — `sub`, `scope`, `email`, whatever you put there. The
signature stops *tampering*, not *reading*. That is why a "readable JWT" is
fine for `sub`/`scope` but a breach if you ever park a password, API key, or PII
in a claim: use JWE if the payload must stay secret.

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

**Worked example — reuse detection revoking the family.** All tokens below
descend from one login, so the AS tracks them as one *family*:

1. Legit client refreshes with **R1** → AS marks R1 *consumed*, issues **R2**.
   The client now holds R2; R1 is spent.
2. An attacker who earlier stole **R1** replays it: `grant_type=refresh_token&refresh_token=R1`.
3. The AS looks up R1, sees it is **already consumed** — a refresh token should
   only ever be used once, so a second use means the family leaked. It
   **revokes the entire family** (R1, R2, and any access tokens minted from
   them).
4. Both the attacker *and* the honest client are now logged out; the honest
   client's next R2 refresh fails and it must re-authenticate.

The trade-off to name aloud: reuse detection can log out the *honest* user (a
false positive from the user's point of view), but that is accepted on purpose —
a duplicated refresh token means one copy was compromised, and forcing a fresh
login is far cheaper than letting an attacker mint tokens indefinitely.

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
→ signing key (HMAC chain over date/region/service) → signature`. The full
canonicalization and key-derivation algorithm is a deep-dive later in *§SigV4
signing internals*.

**Trade-offs.** Signing is **stateless and strong** but **complex** to implement
correctly (canonicalization bugs are common) and awkward for browsers. It shines
for **server-to-server** APIs and SDKs where a library handles it. Bearer tokens
are simpler; HMAC signing is stronger against interception and tampering.

**Gotcha.** Clock skew breaks signing: if the client clock drifts beyond the
allowed window, every request fails with an auth error — a classic
hard-to-diagnose production incident.

**Worked example — the skew check.** The request carries
`X-Amz-Date: 20260719T120000Z`. The server compares it to *its own* clock and
rejects if the gap exceeds the ~5-minute window:

```
server clock = 20260719T120400Z → |gap| = 4 min ≤ 5 → ACCEPT (verify signature)
server clock = 20260719T120600Z → |gap| = 6 min >  5 → REJECT 403 (RequestTimeTooSkewed)
```

Note the timestamp is *inside* the signed canonical request, so the client
can't just backdate the header to widen the window — changing `X-Amz-Date`
changes the signature. The fix in production is NTP on both ends, not a wider
window.

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
  can't be used without the matching cert; the client-auth methods and the
  `cnf.x5t#S256` binding are a deep-dive later in *§mTLS specifics*).

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
  secret). Reject unexpected `alg`s. *Why it works, in 3 steps:*
  1. The server intends **RS256**: it signs with its private key and verifies
     with a matching **public** key that it *publishes* (JWKS) — public by
     design, so the attacker has it verbatim.
  2. The attacker crafts a token with header `{"alg":"HS256"}`, sets any claims
     they want, and computes the signature as
     `HMAC-SHA256(key = <the PEM/JWK bytes of the public key>, header.payload)`.
  3. A naive verifier reads `alg` **from the token**, sees `HS256`, and calls
     `verify(token, publicKey)`. The HMAC branch treats those same public-key
     bytes as the shared secret, recomputes the HMAC over `header.payload`, and
     it **matches** the attacker's — forgery accepted. The attacker signed with
     the exact bytes the server verifies with.
  - **Fix:** never let the token pick the algorithm — allow-list `alg` to
    `["RS256"]` server-side, so an `HS256` token is rejected before any key is
    loaded. (Asymmetric-only setups can't be tricked this way at all.)
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

## OAuth 2.1 changes and the Security BCP (RFC 9700)

The three headline OAuth 2.1 changes above (PKCE mandatory; implicit removed;
ROPC removed) are only half the story. Senior candidates are expected to name
the **full set of six** and cite the standard that motivated them.

**The OAuth 2.0 Security Best Current Practice** was published in January 2025 as
**RFC 9700 (BCP 240)**. It updates RFC 6749/6750/6819 and is the "why" behind
almost every OAuth 2.1 change — cite the BCP, not just "best practice."

The remaining OAuth 2.1 changes:

4. **Redirect URIs are compared by exact string match** — no wildcard,
   suffix, or substring matching. The *only* relaxation is the loopback-port
   wildcard for native apps (`http://127.0.0.1:{any-port}/...`, RFC 8252).
   Loose matching is the root of most open-redirect / code-leak attacks.
5. **Bearer tokens are forbidden in the query string** — reinforcing RFC 6750
   §2.3 (the URL-logging leak) as a hard requirement, not a recommendation.
6. **Public-client refresh tokens must be sender-constrained *or* one-time-use
   (rotated)** — a static long-lived refresh token in a browser/native app is no
   longer acceptable; you either bind it (DPoP/mTLS) or rotate with reuse
   detection.

> [!INTERVIEW]
> "Name every OAuth 2.1 change." The strong answer is six, grouped: **remove**
> (implicit, ROPC), **require** (PKCE for all code clients, exact redirect
> matching), **forbid** (bearer in query string), **constrain** (public-client
> refresh tokens sender-bound or rotated) — all traceable to RFC 9700 / BCP 240.

---

## Redirect and authorization-code attacks

PKCE + `state` is necessary but **not sufficient**. The classic senior follow-up
is "your code flow already uses PKCE and `state` — what attacks remain?"

- **Mix-up attack (multi-AS clients).** A client that talks to more than one
  authorization server can be tricked into sending a code/token issued by AS-A
  to AS-B (or to the attacker's AS). Defenses: the **`iss` authorization-response
  parameter (RFC 9207)** so the client verifies *which* AS responded, or
  per-AS distinct redirect URIs.
- **Authorization Code Injection.** An attacker injects a code they obtained
  into a victim's session. Defended by **PKCE** (the injected code won't match
  the victim's `code_verifier`) or the OIDC **`nonce`** bound into the ID token.
- **PKCE downgrade attack.** An attacker strips the `code_challenge` from the
  authorization request, then later supplies any `code_verifier`. Countermeasure:
  the AS **MUST reject a token request carrying a `code_verifier` if the original
  authorization request had no `code_challenge`** (and vice-versa).
- **307 vs 303 on the authorization response.** If the AS redirects the browser
  back to the client with **HTTP 307 Temporary Redirect**, the browser re-sends
  the original POST body (which may contain the user's credentials) to the
  redirect target. The spec mandates **303 See Other**, which forces a GET.
- **Open redirect / `Referer` & history leakage.** Loose redirect-URI matching
  (see exact-match rule above) plus codes landing in browser history or the
  `Referer` header sent to third-party resources on the callback page.

> [!KEY-TAKEAWAY]
> PKCE stops code interception/injection; `state` stops CSRF; **`iss` (RFC 9207)
> stops mix-up**; **303 (not 307)** stops credential re-POST; exact redirect
> matching stops open-redirect code theft. Naming all five separates senior from
> mid-level.

---

## Device Authorization Grant

**RFC 8628** defines the flow for **input-constrained devices** — smart TVs,
media consoles, CLIs, IoT — that can't show a usable browser or keyboard.

1. The device POSTs to the AS's **device authorization endpoint** and gets back a
   `device_code`, a short human-typable `user_code`, a `verification_uri` (and
   often a `verification_uri_complete` with the code embedded, for a QR code),
   plus `expires_in` and a polling `interval`.
2. The device shows "go to example.com/activate and enter WDJB-MJHT."
3. The user completes login/consent **on a secondary device** (phone/laptop).
4. Meanwhile the device **polls the token endpoint** with
   `grant_type=urn:ietf:params:oauth:grant-type:device_code` + the `device_code`,
   receiving `authorization_pending` (keep waiting), `slow_down` (increase the
   poll interval by 5s), `access_denied`, or `expired_token` until it finally
   gets tokens.

This completes the grant-selection matrix: it's the answer to "how does a TV app
or a headless CLI log a user in?"

---

## Token Exchange and delegation

**RFC 8693 (OAuth 2.0 Token Exchange)** is the real answer to "propagate the end
user's identity across a chain of microservices without re-sending the original
token everywhere." A service presents an existing token and receives a new one
scoped/audience-narrowed for the *next* hop.

- `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`.
- **`subject_token`** = the token representing the party on whose behalf the
  request is made; **`actor_token`** = the token of the acting party (the
  service). `requested_token_type`, `audience`, and `scope` narrow the output.
- **Delegation vs impersonation.** *Impersonation:* the new token looks exactly
  like the subject — downstream can't tell a service is acting. *Delegation:* the
  new token records **both** identities via the **`act` (actor) claim** (a nested
  chain: "B acting for A"), preserving an audit trail. The **`may_act`** claim in
  a token declares *which* actor is permitted to act on the subject's behalf.
- Each hop should **narrow** audience and scope (downscoping), so a token leaked
  deep in the chain has minimal blast radius.

**The chain, visually.** A user's inbound token is exchanged at each hop for a
new token whose `aud` targets the *next* service and whose `scope` is trimmed to
just what that hop needs:

```mermaid
sequenceDiagram
    participant U as User
    participant A as Service A (edge)
    participant AS as Authorization Server
    participant B as Service B
    participant C as Service C
    U->>A: request + token (aud=A, scope=read:orders write:orders)
    A->>AS: token-exchange (subject_token=user tok, audience=B, scope=read:orders)
    AS-->>A: token2 (aud=B, scope=read:orders, act={sub:A})
    A->>B: call + token2
    B->>AS: token-exchange (subject_token=token2, audience=C, scope=read:inventory)
    AS-->>B: token3 (aud=C, scope=read:inventory, act={sub:B, act:{sub:A}})
    B->>C: call + token3
    Note over C: token3 valid only for C, read-only — leaked here, minimal blast radius
```

The nested `act` claim (`B acting for A acting for user`) is what preserves the
audit trail across hops — that's delegation, not impersonation.

> [!INTERVIEW]
> "Five microservices, one user — how do you carry identity?" Token exchange
> (RFC 8693): each hop exchanges its inbound token for a downscoped one with the
> next `audience`, using **delegation** (`act`/`may_act`) over impersonation so
> the call chain stays auditable.

---

## JWT access-token profile and validation checklist

**RFC 9068 (JWT Profile for OAuth 2.0 Access Tokens)** standardizes what a JWT
*access* token looks like, and crucially defines the header **`typ: at+jwt`** so
a resource server can tell an access token apart from an **ID token**. A frequent
trap: an API accepting an **ID token** (meant for the *client* to learn who the
user is) as if it were an access token. Reject it — an ID token's `aud` is the
client, not your API, and it lacks `scope`. Check `typ`, `aud`, and `scope`.

**The ordered validation routine** (recite this as a checklist, not prose):

1. Parse the header; **allow-list the `alg`** against expected values — never
   trust the token's own `alg`. (Watch case-bypass tricks like `nOnE`.)
2. Resolve the verification key by `kid` from a **pinned JWKS** (see below);
   never follow a `jku`/`kid` that points off-issuer.
3. **Verify the signature** before reading any claim as trusted.
4. Check **`iss`** by exact string match against the expected issuer.
5. Check **`aud`** contains this API's identifier.
6. Check **`exp`**, **`nbf`**, and **`iat`** with a small clock skew (≤ ~30–60s).
7. Check **`typ`/token-type** (`at+jwt`; reject ID tokens at the API).
8. Enforce **scope** and then **object-level authorization**.

Prefer **asymmetric** signing (EdDSA/`Ed25519`, ES256, RS256) over HS256 for
multi-party setups, so the resource server holds only a public key and can't mint
tokens — and the RS256→HS256 confusion attack is structurally avoided.

**RFC 8725 (JSON Web Token Best Current Practices)** is the BCP that consolidates
these rules (`alg` allow-listing, key/kid discipline, audience checks); cite it
by name.

---

## JWKS and signing-key rotation

The *legitimate* counterpart to the `jku`/`kid` attack is the **JWKS
(JSON Web Key Set)** mechanism for public-key distribution and zero-downtime
key rotation.

- The AS publishes its public signing keys at a **`jwks_uri`**, discovered from
  its **authorization-server metadata (RFC 8414)** document
  (`/.well-known/oauth-authorization-server`, or the OIDC
  `/.well-known/openid-configuration`).
- Each key has a **`kid`**; the resource server **caches** the JWKS (honoring
  `Cache-Control`) and selects the key whose `kid` matches the token header.
- **Rotation with overlapping keys:** publish the *new* public key to the JWKS
  **before** you start signing with it, and keep the *old* key in the set until
  every token signed with it has expired. Because clients pick by `kid`, both
  generations validate simultaneously — **zero rejected tokens, zero downtime.**
- **Pinning:** hard-pin `iss` and the `jwks_uri` to the trusted issuer. An
  attacker-supplied `jku`/`kid` pointing at their own key set is exactly the
  header-injection attack; never resolve keys from token-controlled URLs.

> [!INTERVIEW]
> "Rotate your JWT signing key with zero downtime and no rejected tokens." →
> JWKS with overlapping `kid`s: **publish-before-sign**, retire-after-expiry,
> clients select by `kid`, cache honors TTL.

---

## Token introspection, phantom and split tokens

**RFC 7662 (Token Introspection)** is how a resource server validates an
**opaque** token: it POSTs `token=<opaque>` to the AS's `/introspect` endpoint
(itself authenticated) and gets back JSON whose key field is **`active`** (a
boolean), plus `scope`, `sub`, `client_id`, `exp`, `aud`, etc. The RS should
**cache** the result briefly to avoid an introspection round-trip per request.

This resolves the opaque-vs-JWT dilemma (revocable but chatty vs stateless but
hard to revoke) with two gateway patterns:

- **Phantom Token pattern.** Clients hold an **opaque** token externally (so it's
  revocable and leaks nothing). At the edge, the **gateway introspects it once**
  and swaps in a **short-lived JWT** for internal service-to-service calls, which
  then validate statelessly. External revocability + internal stateless speed.
- **Split Token pattern.** The token is split: the client carries an opaque
  reference (or one half), while the signature/claims half is reconstructed at
  the gateway — combining revocation control outside with stateless validation
  inside, without a full introspection call per request.

> [!KEY-TAKEAWAY]
> "Opaque gives revocation, JWT gives stateless validation — can I have both?"
> Yes: **phantom/split tokens at the gateway** — introspect the opaque token
> once at the edge, forward a short-lived internal JWT.

---

## DPoP: sender-constrained tokens

A plain bearer token is a **movie ticket anyone can use** — steal it and you're
in. A DPoP-bound token is a ticket that **only works if you also show the
matching ID you registered at the door**: on every request the caller must prove
they still hold a private key, and the token itself was stamped with that key's
fingerprint. That is what "sender-constrained" means — the token is welded to
one holder.

mTLS cert-binding (RFC 8705) proves possession for backend/PKI clients, but is
impractical for SPAs and native apps. **DPoP — Demonstrating Proof-of-Possession
(RFC 9449)** is the **application-layer** answer: it makes a token
**sender-constrained** so a stolen/leaked token is useless without the client's
private key. This is the canonical 2025 answer to "how do you stop token replay
without mTLS?" (A **JWK thumbprint**, used below, is just a SHA-256 fingerprint
of the public key — a short stable ID for "which key.")

**How it works.** The client holds a key pair and sends a per-request **DPoP
proof JWT** in a `DPoP` header:

- Proof header: `typ: dpop+jwt`, `alg`, and the public key as **`jwk`**.
- Proof payload: **`htm`** (HTTP method), **`htu`** (the request URI),
  **`iat`**, **`jti`** (unique, replay-tracked), and — when calling a resource
  server — **`ath`** = base64url(SHA-256(access token)) binding the proof to that
  exact token.

**Token binding.** The AS binds the issued access token to the client key by
putting the JWK thumbprint in the token's confirmation claim:
**`cnf.jkt`** (JWK SHA-256 thumbprint). The RS recomputes the thumbprint of the
proof's `jwk` and checks it equals `cnf.jkt`. The `dpop_jkt` authorization-request
parameter can bind the *authorization code* to the key too.

**Worked example — one request, three checks.** The client calls
`GET https://api.example.com/orders` and attaches two headers:

```
Authorization: DPoP eyJ...            # the access token, cnf.jkt = "0ZcOCORZ...Nk"
DPoP:          eyJ0eXAiOiJkcG9wK2p3dCIsImp3ayI6ey...   # the per-request proof
```

Decode the proof JWT and the RS verifies:

```
proof.header:  { "typ":"dpop+jwt", "alg":"ES256",
                 "jwk": { <the client's PUBLIC key> } }
proof.payload: { "htm":"GET",
                 "htu":"https://api.example.com/orders",
                 "iat": 1737330900,
                 "jti": "e1b2...unique",
                 "ath": "sIyREHWzX7z...IkE" }   # base64url(SHA256(access token))
```

1. **Key match:** RS computes the JWK thumbprint of `proof.header.jwk` (i.e.
   `base64url(SHA-256(canonical jwk))`) and checks it equals the token's `cnf.jkt`
   (`0ZcOCORZ...Nk`) — thumbprint compared to thumbprint, not hashed again. A thief who copied only the
   two headers can't forge a fresh proof — they lack the private key that signs it.
2. **Request match:** `htm`/`htu` must equal the actual method+URL — a proof
   captured for `GET /orders` can't be replayed against `POST /transfers`.
3. **Token match:** `ath` must equal `base64url(SHA256(<this access token>))`, so
   the proof is welded to that exact token, not any token the client holds.

Reused `jti` or stale `iat` (outside the acceptance window) → rejected, which is
what kills replay of a captured proof.

**Nonce.** To stop pre-generated proofs, the server can demand a server-chosen
nonce via the **`DPoP-Nonce`** response header and the **`use_dpop_nonce`** error
(HTTP **400** at the AS, **401** at the RS); the client retries with the nonce in
the proof.

**Hard rule:** a resource server **MUST reject a DPoP-bound access token that is
presented as a plain `Bearer`** — otherwise binding is trivially bypassed.

- **DPoP vs mTLS:** both are proof-of-possession. Choose **DPoP** for public
  clients (SPA/native) where you control the app but not a PKI; choose **mTLS**
  (`cnf.x5t#S256`) for backend services already inside a PKI/mesh.

---

## mTLS specifics (RFC 8705 deep-dive)

Two client-authentication methods are defined:

- **`tls_client_auth`** — the client cert is issued by a **CA the AS trusts**;
  the AS binds the token to a configured subject/DN (or SAN) from the
  PKI-validated certificate.
- **`self_signed_tls_client_auth`** — the client registers a **self-signed**
  certificate (or its JWKS) out of band; the AS pins that exact cert. No CA
  needed, useful for closed ecosystems.

**Certificate-bound tokens** put the confirmation claim **`cnf.x5t#S256`** =
base64url SHA-256 of the DER client certificate into the access token. On each
call the RS compares the thumbprint of the **presented TLS client cert** to the
token's `cnf.x5t#S256`; a token without the matching cert is rejected. This is
the mTLS analogue of DPoP's `cnf.jkt`.

---

## Cookie hardening and CSRF defenses

"Add `SameSite`/`HttpOnly`" is only a start. `SameSite` is **not** a complete
CSRF defense (top-level `GET` navigations still send `Lax` cookies; some clients
default differently). Layer these:

- **`__Host-` cookie prefix.** A cookie named `__Host-session` is only accepted
  if it's `Secure`, has `Path=/`, and has **no `Domain`** attribute — pinning it
  to the exact host and blocking subdomain injection/overwrite.
- **`SameSite` values.** `Strict` (never sent cross-site — safest, but breaks
  inbound links to authenticated pages), `Lax` (sent on top-level `GET`
  navigations only — the common default), `None; Secure` (sent cross-site;
  required for third-party/embedded contexts).
- **CSRF token strategies:** the **synchronizer token** (server stores a
  per-session token, form echoes it — stateful, strongest); the **double-submit
  cookie** (token in both a cookie and a header/body; server checks they match —
  stateless but weaker if subdomains can set cookies); and **origin checks** via
  the `Origin`/`Referer` or **`Sec-Fetch-Site`** fetch-metadata headers.

---

## Authorization models: RBAC, ABAC, ReBAC

Scopes bound *token capability*; they are **not** a full application
authorization model. Senior candidates separate the **delegated-scope** layer
(OAuth) from the **application authorization** layer and can name the taxonomy:

- **Scopes** — what class of operation a *token* may invoke (`write:orders`).
  Coarse, delegation-oriented; never encodes per-object ownership.
- **RBAC (Role-Based Access Control)** — permissions attach to **roles**, users
  hold roles. Simple, auditable; explodes into "role sprawl" when rules get
  contextual.
- **ABAC (Attribute-Based Access Control)** — decisions from **attributes** of
  subject/resource/environment, evaluated by a **policy engine** (e.g. OPA/Rego,
  AWS Cedar). Flexible, context-aware; harder to reason about exhaustively.
- **ReBAC (Relationship-Based Access Control)** — permission derives from
  **relationships in a graph** ("user is editor of doc which is in folder shared
  with team"). The **Google Zanzibar** model (OpenFGA / SpiceDB) popularized it
  for fine-grained, hierarchical sharing at scale.
- **Claims / groups / entitlements** — attributes carried *in* the token
  (group membership, tenant) that feed whichever model above you run.

The BOLA object-level check lives in **this** layer, not in the scope: "scope
says `write:orders`, but the user is editing *someone else's* order" is resolved
by RBAC/ABAC/ReBAC evaluating ownership — the token alone can't.

---

## HTTP Basic authentication

**RFC 7617** defines the oldest scheme: `Authorization: Basic ` followed by
**base64(`username:password`)**. Base64 is *encoding, not encryption* — so Basic
auth is only safe **over TLS**. It has **no logout** (the browser/client re-sends
credentials every request) and no built-in expiry or rotation. Despite this it
survives for **machine-to-machine and internal/legacy tooling** and — notably —
as the transport for the OAuth **client credentials** at the token endpoint
(`Authorization: Basic base64(client_id:client_secret)`). Interviewers open with
it as a baseline before moving to tokens.

---

## OAuth for native and mobile apps

**RFC 8252 (BCP 212)** is the profile for OAuth in native/mobile apps:

- **Use the system browser** (in-app browser tab / `SFAuthenticationSession` /
  Custom Tabs), **never an embedded WebView** — a WebView lets the app read the
  user's credentials and defeats SSO/consent isolation.
- **PKCE is mandatory** (native apps are public clients and can't keep a secret).
- **Redirect delivery** back to the app uses one of: a **claimed `https` app
  link** (App Links / Universal Links — most secure, verified domain ownership),
  a **custom URI scheme** (`com.example.app:/cb` — weaker: another app can
  register the same scheme, hence PKCE), or a **loopback interface**
  (`http://127.0.0.1:{port}/` — for desktop apps, the only allowed redirect-URI
  port wildcard).

---

## BFF (Backend-for-Frontend) for browser apps

The current SPA guidance stops at "auth code + PKCE (public client)." The 2023+
recommendation (the **OAuth 2.0 for Browser-Based Apps** draft) is the
**Backend-for-Frontend** pattern, because **any token in the browser is
XSS-exfiltratable** (localStorage especially).

- A **server-side confidential component** (the BFF) runs the authorization-code
  flow, and **holds the tokens** — they never reach JavaScript.
- The BFF issues the SPA a **`HttpOnly`, `Secure`, `SameSite`, `__Host-`
  session cookie** and **proxies** the SPA's API calls, attaching the real access
  token server-side.
- Result: **no tokens in the browser at all**; XSS can still ride the session via
  the proxy but can't *exfiltrate* a token for offline use.

> [!KEY-TAKEAWAY]
> "Where should a React SPA keep its access token?" → **Not localStorage**
> (XSS-exfiltratable). Prefer a **BFF** with an `HttpOnly`+`__Host-` cookie and
> server-side token custody. If a token must live in the browser, keep it
> **in-memory only, short-TTL, and DPoP-bound.**

---

## Advanced hardening extensions (FAPI-grade)

For high-assurance (financial-grade / FAPI) APIs, several extensions come up:

- **PAR — Pushed Authorization Requests (RFC 9126).** The client POSTs the
  authorization parameters to the AS *first* over a back channel and receives a
  `request_uri` reference; the front-channel `/authorize` then carries only that
  reference. Parameters can't be tampered with or leaked in the browser URL.
- **RAR — Rich Authorization Requests (RFC 9396).** Replaces coarse `scope`
  strings with a structured **`authorization_details`** JSON array for
  fine-grained, per-transaction authorization ("transfer ≤ €500 from account X").
- **Step-up authentication (RFC 9470).** A resource server can demand stronger
  auth for a sensitive operation by returning an `insufficient_user_authentication`
  error with required **`acr`** (authentication context class) / **`max_age`**;
  the token's **`acr`/`amr`** claims report how/when the user authenticated.

---

## SigV4 signing internals (deep-dive)

The HMAC section sketched SigV4; here is the algorithm interviewers probe.

**1. Canonical request** — hash of four normalized elements:
HTTP method, **canonical URI** (percent-encoded path), **canonical query string**
(sorted), **canonical headers** + a **`SignedHeaders`** list naming exactly which
headers are signed, and the body hash **`x-amz-content-sha256`** (which may be the
literal `UNSIGNED-PAYLOAD` for streaming).

**2. String to sign** — the algorithm id (`AWS4-HMAC-SHA256`), timestamp, the
**credential scope** (`date/region/service/aws4_request`), and the hash of the
canonical request.

**3. Derived signing key** — an **HMAC chain**, not the raw secret:
`kDate = HMAC("AWS4"+secret, date)` → `kRegion = HMAC(kDate, region)` →
`kService = HMAC(kRegion, service)` → `kSigning = HMAC(kService, "aws4_request")`.
Scoping the key to date/region/service **limits blast radius**: a leaked derived
key works only for that day/region/service, not the whole account.

**4. Signature** = `HMAC(kSigning, stringToSign)`, placed in the `Authorization`
header (or as `X-Amz-Signature` query params for **presigned URLs**, which embed
`X-Amz-Expires` for time-boxed access). **SigV4A** extends this to multi-region
signing with an asymmetric (ECDSA) key valid across regions.

**Key rotation** mirrors API keys: run **two active secret keys** during
migration (sign with the new, accept both), then retire the old.

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
- **RFC 9449** — OAuth 2.0 Demonstrating Proof-of-Possession (DPoP):
  https://www.rfc-editor.org/rfc/rfc9449
- **RFC 9700 / BCP 240** — OAuth 2.0 Security Best Current Practice (Jan 2025):
  https://www.rfc-editor.org/rfc/rfc9700
- **RFC 8693** — OAuth 2.0 Token Exchange (`act`/`may_act`, delegation):
  https://www.rfc-editor.org/rfc/rfc8693
- **RFC 9068** — JWT Profile for OAuth 2.0 Access Tokens (`at+jwt`):
  https://www.rfc-editor.org/rfc/rfc9068
- **RFC 8725** — JSON Web Token Best Current Practices:
  https://www.rfc-editor.org/rfc/rfc8725
- **RFC 8414** — OAuth 2.0 Authorization Server Metadata (`jwks_uri`):
  https://www.rfc-editor.org/rfc/rfc8414
- **RFC 8628** — OAuth 2.0 Device Authorization Grant:
  https://www.rfc-editor.org/rfc/rfc8628
- **RFC 8252 / BCP 212** — OAuth 2.0 for Native Apps:
  https://www.rfc-editor.org/rfc/rfc8252
- **RFC 9207** — OAuth 2.0 Authorization Server Issuer Identification (`iss`):
  https://www.rfc-editor.org/rfc/rfc9207
- **RFC 7617** — The 'Basic' HTTP Authentication Scheme:
  https://www.rfc-editor.org/rfc/rfc7617
- **RFC 9126** — OAuth 2.0 Pushed Authorization Requests (PAR):
  https://www.rfc-editor.org/rfc/rfc9126
- **RFC 9396** — OAuth 2.0 Rich Authorization Requests (RAR):
  https://www.rfc-editor.org/rfc/rfc9396
- **RFC 9470** — OAuth 2.0 Step-up Authentication Challenge Protocol:
  https://www.rfc-editor.org/rfc/rfc9470
- **OAuth 2.0 for Browser-Based Apps** (BFF pattern), IETF draft:
  https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps
- **OpenID Connect Core** — identity layer on OAuth 2.0 (ID tokens):
  https://openid.net/specs/openid-connect-core-1_0.html
- **OWASP API Security Top 10 (2023)**:
  https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- **AWS Signature Version 4 signing process**:
  https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html
