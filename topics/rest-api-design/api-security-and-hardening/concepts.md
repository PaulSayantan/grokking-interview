# API Security & Hardening (OWASP API Top 10)

APIs are the front door to your data, and attackers know it. Unlike a classic
web app where the server renders HTML, an API hands raw objects and operations
to any client that can craft an HTTP request — so **authorization, not just
authentication, is the hard part**. The strongest interview signal here is
showing that you reason about security as a property of the *request/response
contract*: every endpoint, every object id, every field, and every header is an
attack surface you consciously design around.

This topic is framework-agnostic. We reason in terms of raw HTTP exchanges,
JSON payloads, and headers — the wire contract an attacker actually manipulates.
The anchor reference is the **OWASP API Security Top 10 (2023 edition)**, layered
on the real standards: **RFC 9110** (HTTP Semantics), **RFC 6749/OAuth 2.0** and
the **OAuth 2.1** draft, **RFC 7519** (JWT), **RFC 6265** (cookies), and the
Fetch/CORS living standard.

A mental model to carry throughout: **authentication answers "who are you?",
authorization answers "are you allowed to touch *this* object / call *this*
function / see *this* field?" Most API breaches are authorization failures, and
they cannot be caught by a login check alone — every request must re-verify
access to the specific resource it names.**

---

## The OWASP API Security Top 10 2023 at a glance

**What it is.** A community-ranked list of the ten most critical API security
risks, republished by OWASP in 2023 (the previous edition was 2019). It is the
canonical checklist interviewers reference.

The 2023 list, with the codes you should recognize:

| Code | Name | One-line essence |
|---|---|---|
| API1:2023 | Broken Object Level Authorization (BOLA) | Can I read/modify an object that isn't mine by changing its id? |
| API2:2023 | Broken Authentication | Can I forge, steal, or bypass credentials/tokens? |
| API3:2023 | Broken Object Property Level Authorization (BOPLA) | Can I read/write *fields* I shouldn't (mass assignment / excessive data exposure)? |
| API4:2023 | Unrestricted Resource Consumption | Can I exhaust CPU, memory, money, or quota (no rate/size limits)? |
| API5:2023 | Broken Function Level Authorization (BFLA) | Can I call an admin/privileged *operation* as a regular user? |
| API6:2023 | Unrestricted Access to Sensitive Business Flows | Can I automate/abuse a business flow (scalping, spam) at scale? |
| API7:2023 | Server-Side Request Forgery (SSRF) | Can I make the server fetch a URL I control? |
| API8:2023 | Security Misconfiguration | Are defaults, headers, CORS, verbose errors, or TLS wrong? |
| API9:2023 | Improper Inventory Management | Are there forgotten/undocumented hosts, versions, or debug endpoints? |
| API10:2023 | Unsafe Consumption of APIs | Do I blindly trust data from third-party/upstream APIs? |

**What changed from 2019.** The old "Excessive Data Exposure" and "Mass
Assignment" were merged into **BOPLA (API3)**. "Injection" and "Improper Assets
Management" evolved — injection was folded into the broader picture and
**Security Misconfiguration (API8)** absorbed much of it, while **Unrestricted
Access to Sensitive Business Flows (API6)** and **Unsafe Consumption of APIs
(API10)** are new categories reflecting business-logic abuse and supply-chain
trust.

> [!KEY-TAKEAWAY]
> The top three risks (BOLA, Broken Auth, BOPLA) are all *authorization* problems
> at the object or field level. Injection — the classic web #1 — is no longer the
> headline for APIs. Interviewers want to hear "authorization per request", not
> just "sanitize inputs".

---

## API1 Broken Object Level Authorization

**What it is (BOLA, a.k.a. IDOR).** The #1 API risk. The endpoint authenticates
the caller but fails to check that the caller is *allowed to access the specific
object* named in the request — usually by an id in the path, query, or body.

**Canonical attack.** User A is logged in and calls their own invoice:

```
GET /invoices/1001   Authorization: Bearer <A's token>   → 200 (A owns 1001)
```

Then A simply increments the id:

```
GET /invoices/1002   Authorization: Bearer <A's token>   → 200  ← BOLA! (1002 is B's)
```

The token is valid, so authentication passes — but the server never verified
that invoice 1002 belongs to A.

**Why it matters.** It leaks or lets you modify other tenants' data with a
trivial, fully-authenticated request. No exotic tooling needed; a for-loop over
ids dumps the database.

**The fix — object-level checks on every access.** Derive ownership/authorization
from the *authenticated principal*, not from the request. For every object
reference, verify the subject is permitted to perform the action on *that*
object (e.g., `WHERE invoice.owner_id = :subject`), and enforce it server-side.

**Gotcha — GUIDs/UUIDs are not authorization.** Using unguessable ids raises the
bar for *discovery* but is not access control; ids leak (URLs, logs, referrers,
shared screenshots). You must still check ownership. Likewise, nested routes
(`/users/{me}/invoices/{id}`) don't help if you resolve `{id}` without checking
it belongs to `{me}`.

> [!WARNING]
> BOLA cannot be caught by a gateway or a generic filter — it needs the object's
> owner, which only the application knows. It must be enforced in the code path
> that loads the object.

---

## API2 Broken Authentication

**What it is.** Weaknesses that let an attacker forge, steal, or bypass identity:
credential stuffing tolerated (no lockout/rate limit on login), weak or missing
token validation, tokens in URLs, no expiry/rotation, accepting the JWT `alg:
none`, or not verifying the token signature/issuer/audience.

**JWT-specific gotchas (RFC 7519 + JWS).**
- **`alg: none`** — a token with header `{"alg":"none"}` has no signature; a
  library that honors it accepts anything. Reject it; pin the expected algorithm.
- **Algorithm confusion (RS256 → HS256).** If the verifier picks the algorithm
  from the token header, an attacker can sign an HS256 token using the *public*
  RSA key (which is public) as the HMAC secret. Pin the algorithm server-side.
- **Missing claim checks.** Always validate `exp` (expiry), and where applicable
  `iss`, `aud`, and `nbf`. A token minted for another service/audience must not
  be accepted.
- **Revocation.** JWTs are self-contained and can't be un-issued; keep lifetimes
  short and use refresh tokens or a revocation/denylist for logout.

**Design guidance.** Prefer standard, battle-tested schemes (OAuth 2.0 / OIDC).
Send credentials only in the `Authorization` header (or a `Secure; HttpOnly`
cookie), never in query strings — URLs land in logs and browser history. Apply
brute-force protection and MFA to the auth endpoints themselves.

```
# Bad — token in the query string ends up in access logs, proxies, referrers
GET /account?access_token=eyJhbGciOi...   ← leaks the credential

# Good — credential in a header
GET /account
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6...
```

---

## API3 Broken Object Property Level Authorization

**What it is (BOPLA).** Authorization enforced at the object level but not at the
*property/field* level. It has two symmetric halves:

- **Excessive Data Exposure (read side).** The response includes fields the
  caller shouldn't see because the server serializes the whole object and relies
  on the client to hide fields. Example: a user profile endpoint returns
  `passwordHash`, `internalRiskScore`, or another user's `email`.
- **Mass Assignment (write side).** The server binds client-supplied JSON
  directly onto an internal object, so a client can set fields it was never
  offered — like `"role": "admin"` or `"accountBalance": 999999`.

**Mass-assignment attack.** The signup form only shows name and email, but the
API blindly maps the body:

```
PATCH /users/me
{ "displayName": "Mallory", "isAdmin": true, "emailVerified": true }
   → server binds all three → privilege escalation
```

**Fixes.**
- **Read side:** use an explicit response DTO/schema — return an allowlist of
  fields, never "serialize the entity". Define the exact response shape in
  OpenAPI so it's reviewable.
- **Write side:** bind only an explicit allowlist of writable properties; ignore
  or reject unknown/read-only fields. Never `entity = deserialize(body)` over the
  whole domain object.

> [!TIP]
> "Return a DTO, bind a DTO." Treat the wire schema as a deliberate projection of
> your internal model, in both directions. This single discipline kills both
> halves of BOPLA.

---

## API4 Unrestricted Resource Consumption

**What it is.** The API places no limits on the resources a request can consume:
no rate limiting, no payload-size cap, no pagination cap, no timeout, no upload
limit, no bound on expensive operations. This enables DoS and, in the cloud,
direct financial damage ("denial of wallet" — SMS, compute, third-party API
spend).

**Concrete controls (all live in the request/response contract):**
- **Rate limiting / throttling** with `429 Too Many Requests` and a `Retry-After`
  header. Expose limits via headers so clients can back off:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 30
```

- **Max request body size** → `413 Content Too Large` when exceeded.
- **Pagination caps** — clamp `?limit=`; never let a client request 1,000,000
  rows (a `limit=10000000` is a classic amplification vector).
- **Timeouts and complexity limits** — cap execution time; for GraphQL, limit
  query depth/complexity.
- **Bounds on fan-out** — file uploads, number of array items, batch sizes.

**Gotcha — validation before work.** Reject an oversized/over-broad request
*before* allocating memory or making downstream calls, or the limit itself
becomes the DoS.

---

## API5 Broken Function Level Authorization

**What it is (BFLA).** The caller can invoke an *operation/function* they aren't
authorized for — typically an admin action or a different HTTP method — because
authorization is enforced inconsistently across endpoints and verbs. BOLA is
about *which object*; BFLA is about *which function/role*.

**Canonical attacks.**
- A regular user calls an admin route directly:

```
DELETE /admin/users/42     Authorization: Bearer <regular-user token>  → 200  ← BFLA
```

- The UI only shows "edit" to admins, but the API doesn't enforce it — a normal
  user sends `PUT /articles/9` and it works ("the button was hidden" is not
  authorization).
- One verb is protected but another isn't: `GET /orders/9` checks role but
  `DELETE /orders/9` doesn't.

**Fixes.** Deny by default. Enforce role/permission checks *consistently* on
every route and every method, ideally centralized so a new endpoint is protected
unless explicitly opened. Don't rely on obscurity of admin URLs or on the client
hiding controls.

---

## API6 Unrestricted Access to Sensitive Business Flows

**What it is (new in 2023).** The API technically works as designed, but a
sensitive *business flow* can be automated and abused at scale without
technical exploitation: buying all concert tickets to scalp them, creating fake
accounts, posting spam/reviews, draining a promo/coupon, hoarding limited stock.

**Why it's distinct.** Each individual request is legitimate and authorized — no
BOLA, no injection. The vulnerability is the *lack of anti-automation* on a flow
whose value depends on human-scale, fair use.

**Mitigations (business-logic layer):**
- Identify sensitive flows (purchase, signup, transfer, "add to cart").
- Device fingerprinting / bot detection; CAPTCHA or proof-of-work on abuse
  signals.
- Per-user and per-flow limits (e.g., N tickets per customer), not just per-IP
  rate limits (attackers rotate IPs).
- Detect non-human patterns (velocity, headless clients, missing human timing).

> [!INTERVIEW]
> The tell for API6 in an interview: "the request is valid and authorized, but a
> script can run it a million times to corner a scarce resource." That's business
> logic abuse, mitigated by anti-automation, not by authn/authz.

---

## API7 Server-Side Request Forgery

**What it is (SSRF).** The API fetches a remote resource using a URL/host taken
from client input without validating it, letting the attacker make the *server*
send requests to destinations of their choosing — including internal-only
addresses the attacker can't reach directly.

**Why APIs are exposed.** Modern APIs routinely accept URLs: webhooks, "import
from URL", avatar/image fetch by URL, PDF/screenshot generators, link previews.

**Classic cloud attack.** Point the server at the cloud metadata endpoint to
steal credentials:

```
POST /profile/avatar
{ "imageUrl": "http://169.254.169.254/latest/meta-data/iam/security-credentials/" }
   → server fetches metadata, returns/leaks temporary IAM credentials
```

Other targets: `http://localhost:.../` internal admin panels, `file://`,
`http://10.0.0.5/` internal services, DNS-rebinding tricks.

**Defenses (layered — no single check is enough):**
- **Validate and allowlist** the destination: scheme (`https` only), host/domain
  allowlist. Deny by default rather than denylist.
- **Resolve DNS and block private/link-local ranges** (127.0.0.0/8, 10/8,
  172.16/12, 192.168/16, 169.254.169.254, `::1`, IPv6 unique-local) — and
  re-check *after* resolution to defeat DNS rebinding and redirects.
- **Disable unneeded URL schemes and following of redirects** to internal IPs.
- **Network egress controls** — the fetcher runs with no route to metadata /
  internal subnets (e.g., IMDSv2 with hop limit, egress firewall).
- Don't return the raw fetched response to the caller.

---

## API8 Security Misconfiguration

**What it is.** The broadest category: insecure defaults, incomplete or ad-hoc
configuration that leaves the API exposed. This is where **security headers,
CORS, verbose errors, unnecessary HTTP methods, missing TLS, and unpatched
components** live.

**Common misconfigurations:**
- Missing or wrong **security headers** (see below) and permissive **CORS** (see
  below).
- **Verbose error responses** leaking stack traces, SQL, framework/version, or
  internal hostnames (overlaps with data leakage).
- **Unneeded HTTP methods** enabled (`TRACE`, `PUT`, `DELETE`) or `OPTIONS`
  divulging too much.
- Missing TLS / accepting plaintext HTTP.
- Default credentials, open management/debug endpoints, directory listing.
- Not rejecting unexpected `Content-Type`, or auto-parsing XML with external
  entities enabled (**XXE**).

**Injection under this umbrella.** Untrusted input concatenated into SQL, OS
commands, NoSQL queries, LDAP, or XML is still exploitable. The API-contract
defenses are: validate/allowlist inputs against a schema, use parameterized
queries / prepared statements (never string concatenation), and reject payloads
that don't match the declared schema. See *Input injection and validation* below.

**Fix.** A repeatable, hardened, automated configuration; disable everything not
needed; keep components patched; review headers/CORS/errors as part of the API
contract.

---

## API9 Improper Inventory Management

**What it is.** You can't protect what you don't know exists. Organizations lose
track of **hosts** (which environments expose the API) and **API versions**
(old, unpatched `/v1` still live next to `/v2`), plus undocumented/debug/beta
endpoints. These "shadow" and "zombie" APIs often bypass the newer security
controls.

**Why it matters.** An attacker enumerates and hits the *weakest* variant. The
retired `v1` that still runs and still talks to prod data — but never got the
BOLA fix — is the breach.

**Mitigations:**
- Maintain a complete, current inventory of every API, host, and environment,
  with owners and data-sensitivity classification.
- Document every version and endpoint (OpenAPI is the source of truth); flag
  anything not in the spec.
- Have a formal **deprecation and retirement** process — actually turn old
  versions off, don't just stop advertising them.
- Lock down or remove non-production (staging/debug) endpoints reachable from the
  internet.

---

## API10 Unsafe Consumption of APIs

**What it is (new in 2023).** Developers trust data from *upstream/third-party*
APIs more than user input, applying weaker validation. If an integrated service
is compromised or malicious, that trust becomes your vulnerability — the risk
shifts from "what the client sends me" to "what the API I call sends back".

**Attack patterns.**
- Blindly following redirects returned by a third-party API.
- Injecting the third party's (attacker-controlled) response into SQL/commands/
  templates without validation.
- Not applying timeouts, size limits, or schema validation to upstream responses.
- Trusting an upstream over unencrypted transport.

**Defenses:**
- Validate and sanitize data from other APIs *exactly like* user input —
  schema-check every response.
- Use TLS for all upstream calls; verify certificates.
- Don't blindly follow redirects; enforce timeouts and response size caps.
- Maintain an allowlist of well-defined locations integrated services can
  redirect to.

---

## CORS misconfiguration

**What it is.** Cross-Origin Resource Sharing (Fetch/CORS standard) is a
**browser** mechanism that relaxes the Same-Origin Policy so a page on origin A
can read responses from API origin B *only if B opts in* via
`Access-Control-Allow-Origin` (ACAO). Misconfiguration turns this protection off.

**How it works (the preflight).** For "non-simple" requests the browser sends an
`OPTIONS` preflight first:

```
OPTIONS /data                          → request
Origin: https://app.example.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: authorization

HTTP/1.1 204 No Content                → response
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, PUT
Access-Control-Allow-Headers: authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
```

**The dangerous misconfigurations:**
- **`Access-Control-Allow-Origin: *` together with credentials.** The spec
  forbids combining wildcard ACAO with `Access-Control-Allow-Credentials: true`
  — browsers reject it. So developers "fix" it by **reflecting the `Origin`
  header** back into ACAO *and* setting credentials true — which trusts *every*
  origin and lets any site make authenticated requests as the victim.
- **Reflecting Origin without an allowlist** — same problem even without
  credentials for readable public-but-sensitive data.
- **Trusting `null` origin** (sandboxed iframes, `file://`) — attackers can force
  a `null` origin.
- **Overly broad regex** (`.*\.example\.com` that also matches
  `evil-example.com`).

**Correct approach.** Maintain a strict allowlist of trusted origins; echo back
only an exact match; set `Access-Control-Allow-Credentials: true` **only** for
allowlisted origins, never with `*`. Remember: CORS is *not* server-side access
control — it only governs what browsers let scripts read. A non-browser client
(curl, server) ignores CORS entirely, so CORS never replaces authn/authz.

> [!WARNING]
> A permissive `Access-Control-Allow-Origin: *` does **not** by itself leak
> cookie-authenticated data (wildcard + credentials is blocked). The real breach
> is *reflecting the Origin* while allowing credentials — that's what lets a
> malicious site read a logged-in user's data.

---

## CSRF for cookie-authenticated APIs

**What it is.** Cross-Site Request Forgery: a malicious site causes the victim's
browser to send a state-changing request to your API, and the browser
**automatically attaches the ambient credential** (a cookie), so the request is
authenticated as the victim without the attacker ever seeing the cookie.

**Why it's a cookie problem specifically.** CSRF only bites when the API
authenticates via something the browser sends *automatically* (cookies, HTTP
Basic, client certs). **APIs authenticated with a `Bearer` token in the
`Authorization` header are inherently CSRF-resistant** — a cross-site page can't
read or set that header (it's not attached automatically, and CORS blocks reading
it), so there's no ambient authority to hijack.

**Defenses for cookie-based APIs:**
- **`SameSite` cookies (RFC 6265bis).** `SameSite=Lax` (a common browser default)
  blocks cookies on cross-site *subrequests* like a POST from another site;
  `SameSite=Strict` is stronger; `SameSite=None` (required for cross-site) must
  be paired with other defenses.
- **Anti-CSRF tokens** — synchronizer token or double-submit cookie: a value the
  attacker's site cannot read/guess must accompany state-changing requests.
- **Require a custom header** (e.g., `X-Requested-With`) — simple cross-site form
  posts can't set custom headers, and setting one forces a CORS preflight the
  attacker's origin will fail.
- **Verify `Origin`/`Referer`** on state-changing requests.

Also mark session cookies `Secure; HttpOnly` — `HttpOnly` blocks JS theft (XSS),
`Secure` prevents transmission over plaintext.

---

## Security response headers

**What they are.** Response headers that instruct the browser to enable
protections. For APIs (JSON, non-rendered) some matter more than others, but
they're cheap defense-in-depth and a frequent misconfiguration finding.

| Header | Purpose |
|---|---|
| `Strict-Transport-Security` (HSTS) | Force HTTPS for future requests; `max-age`, `includeSubDomains`, `preload`. |
| `Content-Type: application/json` + `X-Content-Type-Options: nosniff` | Stop the browser from MIME-sniffing a JSON body into HTML/JS (mitigates some XSS). |
| `Content-Security-Policy` | Restrict resource loading; for a pure JSON API a locked-down `default-src 'none'` limits damage if a response is ever rendered. |
| `X-Frame-Options: DENY` / CSP `frame-ancestors` | Prevent clickjacking (mostly for HTML endpoints). |
| `Cache-Control: no-store` | Keep sensitive responses out of shared/browser caches. |
| `Referrer-Policy` | Limit leaking URLs (which may contain ids/tokens) via the `Referer` header. |

**Gotchas.**
- Always send an accurate `Content-Type` and `nosniff`; returning JSON as
  `text/html` invites content-sniffing attacks.
- HSTS only takes effect after the *first* HTTPS response and can't be sent over
  plain HTTP meaningfully — redirect HTTP→HTTPS and then set it.
- Set `Cache-Control: no-store` on responses containing personal/secret data so a
  shared cache or CDN doesn't retain them.

---

## Input injection and validation

**What it is.** Any place untrusted input is interpreted as code or query
structure: SQL, NoSQL, OS commands, LDAP, XPath, template engines, XML (XXE).
Even though APIs deal in structured JSON, the values inside are still attacker-
controlled strings.

**Contract-level defenses (framework-agnostic):**
- **Schema validation first.** Declare and enforce the request schema (types,
  formats, ranges, enums, string lengths, required/forbidden fields) — reject
  anything that doesn't match *before* processing. OpenAPI + JSON Schema make this
  a first-class part of the contract.
- **Allowlist, don't denylist.** Define what's valid; reject the rest. Denylists
  of "bad characters" are perpetually incomplete.
- **Parameterized queries / prepared statements.** Never concatenate input into a
  query string. This is the definitive SQL-injection defense; escaping is a
  fallback, not the primary control.
- **Contextual output encoding** when values are reflected into HTML/JS/other
  interpreters.
- **Disable XML external entities** to prevent XXE; prefer JSON.
- **Validate structural limits** too — max array length, max nesting depth, max
  string size (ties into API4).

**Gotcha — validate on the server, always.** Client-side validation is UX, not
security; an attacker crafts requests directly. Length/type checks in the
browser mean nothing to the API.

---

## Not leaking data in errors and responses

**What it is.** Responses that reveal more than the caller should know — either
in the *error path* (stack traces, SQL, framework and version banners, internal
hostnames/IPs, file paths) or the *happy path* (excessive fields, other users'
data — this overlaps with BOPLA/API3).

**Why it matters.** Verbose errors hand attackers a map: they reveal the tech
stack (to pick exploits), internal topology (for SSRF/lateral movement), and
sometimes the data itself. This is an aspect of API8 (misconfiguration).

**Design rules:**
- Return a **generic, structured error** (RFC 9457 problem+json) with a stable
  error code and a safe human message; log the *details* server-side keyed by a
  correlation id, and return only that id to the client.

```
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json

{ "type": "about:blank", "title": "Internal Server Error",
  "status": 500, "traceId": "b1946ac9-..." }   ← safe: no stack trace, no SQL
```

- **Don't let error messages distinguish "user not found" from "wrong password"**
  on login — that's a username-enumeration oracle. Return a uniform "invalid
  credentials".
- **Avoid oracles in status codes/timing** — returning `403` for "exists but
  forbidden" vs `404` for "doesn't exist" can itself leak existence; a common
  choice is `404` for objects the caller may not even know about (ties into BOLA
  hardening).
- Strip framework/server version banners (`Server`, `X-Powered-By`).

---

## TLS everywhere

**What it is.** All API traffic — client↔API and API↔upstream — carried over
TLS (HTTPS). Plaintext HTTP exposes credentials, tokens, and data to network
eavesdroppers and man-in-the-middle tampering.

**Requirements and gotchas:**
- **No plaintext, ever.** Don't offer HTTP endpoints for "convenience"; redirect
  HTTP→HTTPS and set **HSTS** so browsers won't downgrade.
- **Modern TLS only.** Disable SSLv3/TLS 1.0/1.1; prefer TLS 1.2+/1.3 with strong
  cipher suites.
- **Terminate carefully.** If TLS terminates at a load balancer/gateway, secure
  the hop to the backend too (mTLS or a trusted private network) — "internal"
  traffic is still a target.
- **mTLS** (mutual TLS) for service-to-service: both sides present certs, giving
  strong client authentication for internal APIs / zero-trust.
- **Validate certificates** on outbound calls (API10) — don't disable cert
  verification "to make it work".
- Tokens and cookies must be marked so they only travel over TLS
  (`Secure` cookie attribute); a bearer token sent over HTTP once is compromised.

> [!KEY-TAKEAWAY]
> TLS protects data *in transit* and is table stakes, but it does nothing for
> authorization — a perfectly encrypted request can still be a BOLA attack. TLS
> and OWASP-authz controls are complementary, not substitutes.

---

## OAuth 2.0 and 2.1 flows

**Why this matters.** "Walk me through OAuth for an SPA / mobile app" is one of
the most common senior API-auth probes. Name-dropping OAuth isn't enough; you
must know the *grants* and which are now forbidden.

**The grants (RFC 6749) and their fate under OAuth 2.1 (the consolidation draft
at oauth.net/2.1).**

- **Authorization Code + PKCE (RFC 7636)** — the default for *all* interactive
  clients (web, SPA, mobile). The client redirects the user to the authorization
  server, gets a short-lived `code`, and exchanges it for tokens at the token
  endpoint. PKCE (`code_challenge`/`code_verifier`) binds the code to the client
  that started the flow, defeating authorization-code interception. **OAuth 2.1
  mandates PKCE for every authorization-code client**, not just public/native
  ones.
- **Client Credentials** — machine-to-machine (no user present). The client
  authenticates with its own credentials and gets a token representing *itself*.
- **Implicit grant (`response_type=token`)** — **removed in OAuth 2.1.** It
  returned tokens in the URL fragment (leaks via history/referrer, no
  confidentiality). SPAs now use Authorization Code + PKCE instead.
- **Resource Owner Password Credentials (ROPC / password grant)** — **removed in
  OAuth 2.1.** Having the app collect the user's password defeats the entire
  point of delegated authorization.

**Other OAuth 2.1 hardening you should cite:**
- **Exact-string redirect-URI matching** — no wildcards, no prefix/substring
  matching. Loose matching enables token/code redirection to attacker URLs.
- **Bearer tokens must not travel in query strings** (same leak surface as
  credentials in URLs; see API2).
- **Refresh-token rotation** for public clients — each use issues a new refresh
  token and invalidates the old one, so a stolen refresh token is detectable
  (reuse of a rotated token signals compromise → revoke the chain).

> [!INTERVIEW]
> Canonical answer to "cookies or bearer tokens for an SPA?": there's no free
> lunch. Bearer tokens in JS-readable storage are exposed to XSS but immune to
> CSRF; `HttpOnly` cookies are immune to XSS token theft but need CSRF defenses
> (`SameSite`, anti-CSRF token). The modern SPA pattern is Authorization Code +
> PKCE with tokens held in memory (or a `Secure; HttpOnly; SameSite` cookie via
> a backend-for-frontend), never `response_type=token`.

---

## Scopes vs. permissions

**The distinction interviewers probe.** An OAuth **scope** (e.g., `orders:write`)
expresses what the *client application* was authorized by the user to *attempt*
on the user's behalf. It is **coarse-grained delegation**, not per-object or
per-user access control. Holding scope `orders:write` does **not** mean the
subject may edit *order 42* — that still requires a BOLA check
(`WHERE order.owner_id = :subject`) and, for privileged operations, a BFLA
role/permission check.

**Failure mode.** Teams gate an endpoint solely on `require_scope("orders:write")`
and ship a BOLA bug: any token with that scope can write *any* order. Scope
checks and object/function-level authorization are **orthogonal layers** — you
need both.

> [!KEY-TAKEAWAY]
> Scope = "what this app may try, per the user's consent." Authorization = "may
> *this subject* perform *this action* on *this object*." Never let a scope
> check stand in for a BOLA/BFLA check.

---

## API keys vs user authentication

**What an API key is.** OWASP is explicit: an API key **identifies the calling
application / project**, not an authenticated end user. It is a shared secret
(often long-lived, sometimes embedded in clients) that provides *identification
and coarse rate-limit/quota attribution* — not proof of a user's identity.

**Why it matters.**
- An API key alone must **not** gate access to a high-value or user-specific
  resource; you still need user authentication + per-object authorization.
- Keys leak easily (checked into repos, shipped in mobile binaries, logged).
  Treat a leaked key as a compromised app credential: rotate it, scope it, and
  rate-limit per key.
- Distinguish **app identity** (API key / client credentials) from **user
  identity** (an authenticated principal via OAuth/OIDC). Conflating them is a
  frequent API2 finding.

---

## Sender-constrained tokens (DPoP and mTLS-bound)

**The problem with bearer tokens.** A bearer token is like cash — *whoever holds
it can spend it*. Steal it (XSS, log leak, MITM on a misconfigured hop) and you
are the user until it expires. Short TTLs shrink the window but don't close it.
**Sender-constrained / proof-of-possession** tokens bind the token to a key the
legitimate client holds, so a stolen token is useless without the private key.

**DPoP — Demonstrating Proof-of-Possession (RFC 9449, application layer).**
- On each request the client sends a `DPoP` header containing a signed proof JWT
  (`typ: dpop+jwt`) with claims `htm` (HTTP method), `htu` (HTTP URI), `jti`
  (unique id, replay defense), `iat`, and — when presenting an access token —
  `ath` (hash of the access token).
- The access token is bound to the client's public key via a `cnf.jkt`
  confirmation claim (JWK SHA-256 thumbprint). The resource server checks that
  the DPoP proof was signed by the key whose thumbprint matches `cnf.jkt`.
- The server can issue a `DPoP-Nonce` (returned in a header) to force freshness
  and defeat pre-computed proofs.
- **Limitation:** DPoP does **not** stop an attacker who runs code *inside* the
  client (e.g., XSS can just mint fresh proofs with the in-memory key). It
  defeats *exfiltration* of the token, not code execution in the client.

**mTLS-bound tokens (RFC 8705, transport layer).** The token is bound to the
client's TLS client certificate via a `cnf.x5t#S256` claim (certificate
thumbprint). The resource server checks the presented client cert matches. This
is transport-layer proof-of-possession — strong for service-to-service, heavier
to deploy than DPoP for browser clients.

> [!INTERVIEW]
> "How do you make a stolen access token useless?" Layer the answer: short TTL +
> refresh-token rotation + **sender-constraining** (DPoP or mTLS-bound) + a
> revocation/`jti` denylist for the residual window. Bearer-only + "we'll rotate
> keys" is a junior answer.

---

## JWT hardening and advanced attacks

**The anchor spec.** RFC 7519 defines JWT, but **RFC 8725 (JSON Web Token Best
Current Practices)** is the authoritative "how to use JWT safely" document —
cite it, not just 7519. Its headline rules: use an **algorithm allowlist**
(never a denylist), validate all critical claims, and don't trust the token to
tell you how to verify it.

**Attacks beyond `alg:none` and RS256↔HS256 confusion:**

- **`kid` header injection.** The `kid` (key id) header tells the verifier which
  key to load. If the server uses it to build a filesystem path or SQL query,
  an attacker can do **path traversal** (`kid: "../../dev/null"` → empty/known
  key) or **SQL injection** to return an attacker-controlled key, then sign the
  token with it. Defense: treat `kid` as an opaque lookup key against a trusted
  keystore; never interpolate it into paths/queries.
- **`jku` / `x5u` header injection.** These headers point the verifier at a URL
  to fetch the signing JWKS/cert. An attacker sets them to an attacker-hosted
  JWKS. Defense: **allowlist the JWKS URI** to the trusted issuer; ignore
  token-supplied `jku`/`x5u`.
- **`alg:none` case-variant bypass.** Denylisting `"none"` misses `"nOnE"`,
  `"NONE"`, etc. Use an **allowlist** of exact expected algorithms — this is
  *why* 8725 says allowlist.
- **Weak HMAC secret brute-force.** HS256 with a guessable/short secret can be
  cracked offline from a single captured token. Use high-entropy secrets (or
  asymmetric keys).
- **JWT type confusion.** Accepting an **OIDC ID token as an access token**, or
  a token minted for another audience. Defenses: verify `aud` and `iss`, require
  a `typ` of `at+jwt` on access tokens (RFC 9068), and use separate keys/issuers
  for different token types.

> [!WARNING]
> The chained senior question is: "your verifier reads the algorithm from the
> token header — exploit it." The full answer chains `alg:none` (+ case variants),
> RS256→HS256 confusion, and `kid`/`jku` injection, and the fix is: pin the
> algorithm and key source server-side; never let the token choose either.

---

## Rate-limiting algorithms and headers

**Algorithms (know the trade-offs).**
- **Fixed window** — count per calendar window (e.g., per minute). Simple but
  allows a 2× burst at the window boundary (end of one window + start of next).
- **Sliding window** — smooths the boundary burst by weighting the previous
  window; more accurate, slightly more state.
- **Token bucket** — tokens refill at a steady rate up to a cap; a request
  spends a token. Allows controlled bursts up to the bucket size — the usual
  choice for APIs.
- **Leaky bucket** — requests queue and drain at a fixed rate; smooths bursts
  into a constant outflow.

**Dimensions — limit on the right key.** Per-IP alone is weak (attackers rotate
IPs, and NAT/CDN collapse many users to one IP). Limit per **user / token /
API key / tenant / endpoint**, and combine dimensions for sensitive flows (ties
into API4 and API6).

**Headers (note the spec status).** The `RateLimit-Limit` / `RateLimit-Remaining`
/ `RateLimit-Reset` family and the `X-RateLimit-*` prefix are **de-facto
conventions, not a finalized standard**. The IETF work
(`draft-ietf-httpapi-ratelimit-headers`) has moved to **structured fields**, e.g.
`RateLimit-Policy: "burst";q=100;w=60` and `RateLimit: "default";r=50;t=30`. All
three forms appear in the wild; the only always-standard signal for throttling is
**`429 Too Many Requests`** (RFC 6585) **+ `Retry-After`** (RFC 9110).

---

## GraphQL resource-consumption amplification

**Why GraphQL is a special API4 case.** A single GraphQL HTTP request can encode
arbitrarily expensive work, bypassing per-request throttles:

- **Query batching** — many operations in one HTTP request. A per-*request* rate
  limit sees "1 request" but executes N operations (also enables credential-
  stuffing amplification against a `login` mutation).
- **Deeply nested / recursive queries** — related types that reference each
  other (`author → posts → author → posts …`) let one query fan out to a
  combinatorial number of resolvers.

**Defenses:** query **depth limits**, **complexity/cost analysis** (assign a cost
to fields and cap the total), **pagination caps** on list fields, timeouts, and
**disabling batching** (or rate-limiting per operation, not per request). Persisted
queries (allowlisting known query documents) are the strongest control.

---

## HTTP method restriction and content-type enforcement

**Verb tampering (an API8 / BFLA overlap).** Enforce authorization per
*(method, resource)* pair, not per path. A route that checks auth on `GET
/orders/9` but not on `PUT`/`DELETE /orders/9` is a BFLA hole. Allowlist the
methods each route supports and return **`405 Method Not Allowed`** (with an
`Allow` header listing permitted methods, per RFC 9110) for the rest. Disable
`TRACE` and other unneeded verbs.

**Content-Type enforcement (RFC 9110 status codes).**
- Reject an unexpected or missing request `Content-Type` with **`415 Unsupported
  Media Type`** — don't guess/sniff the body format.
- When you can't produce a representation the client's `Accept` allows, return
  **`406 Not Acceptable`**.
- **Never reflect the request's `Accept` value into the response `Content-Type`**;
  set the response type to what you actually serialize, and make the body match.
- Combine with a body-size cap (**`413 Content Too Large`**) — content-type +
  size + schema validation are the edge gate before any parsing work.

---

## Logging, monitoring, and detection

**Why it's here.** "Insufficient Logging & Monitoring" was a 2019 OWASP API item
that didn't survive as a standalone 2023 entry, but detection is still half of a
real defense story — you cannot respond to BOLA enumeration you never observe.

**Do:**
- Log authentication and **authorization failures** with a correlation/trace id,
  the subject, the resource, and the decision — enough to reconstruct an attack.
- Alert on **velocity / enumeration patterns**: a token walking sequential ids,
  spikes of 403/404, credential-stuffing bursts on login (bridges API1/API4/API6).
- Centralize logs and retain long enough for incident forensics.

**Don't:**
- **Never log secrets** — tokens, passwords, API keys, full PANs, session
  cookies. A token in a log is a credential leak (this is the concrete reason
  tokens don't belong in URLs).
- **Prevent log injection** — untrusted input with newlines/control chars can
  forge or split log lines; encode/neutralize before writing.

---

## Authorization architecture (RBAC, ABAC, ReBAC)

**The scaling question:** "You have 300 endpoints and keep shipping BOLA/BFLA
bugs — how do you fix this *structurally*?" The answer is architectural, not
per-endpoint whack-a-mole.

**Models.**
- **RBAC (role-based)** — permissions attached to roles, roles to users. Simple;
  handles BFLA well (function-level), but roles alone can't express *object
  ownership*, so it doesn't solve BOLA.
- **ABAC (attribute-based)** — decisions from attributes of subject, resource,
  action, and environment (e.g., `subject.tenant == resource.tenant`). Expressive
  enough for object-level and contextual rules.
- **ReBAC (relationship-based)** — authorization from a graph of relationships
  (`user is owner of doc`, `doc is in folder shared with team`), popularized by
  **Google Zanzibar**. Fits object/hierarchy ownership — the BOLA-native model.

**Centralize the decision.** Extract authorization into a **policy engine / shared
authorization service** (e.g., OPA, or a Zanzibar-style service) so every endpoint
is **deny-by-default** and a new route is unprotected only if someone explicitly
opens it. Back it with **automated authorization tests** (each endpoint tested as
owner, non-owner, and unprivileged role). Scattered per-handler `if` checks are
why teams keep shipping the same class of bug.

---

## API gateway and WAF: what they can and can't enforce

"Just put it behind a gateway/WAF" is a common **wrong** answer — know the line.

**A gateway / WAF *can* enforce:** TLS termination, authentication (token
validation, signature/`iss`/`aud`/`exp` checks), coarse **rate limiting**,
schema/method/content-type validation at the edge, IP/geo filtering, and generic
injection signatures.

**A gateway / WAF *cannot* enforce:** **BOLA and BOPLA.** Object-level and
field-level authorization require knowing *who owns this object* and *which
fields this subject may see/set* — application-domain knowledge the edge does
not have. The gateway sees a well-formed, authenticated request to
`GET /invoices/1002` and has no way to know 1002 isn't the caller's. These checks
**must** live in the code path that loads the object.

---

## Common follow-up questions

- "What's the difference between BOLA and BFLA?" BOLA (API1) = wrong
  *object* (can I access another user's record by changing an id?); BFLA (API5) =
  wrong *function/role* (can I call an admin operation as a normal user?). Both
  are authorization gaps; one is per-object, one is per-operation.
- "Are bearer-token APIs vulnerable to CSRF?" Generally no — the token isn't
  sent automatically by the browser and cross-site pages can't read/set the
  `Authorization` header. CSRF is a concern for *cookie/Basic/cert* auth.
- "Does `Access-Control-Allow-Origin: *` leak my users' data?" Not by itself:
  wildcard + credentials is blocked by browsers, so no cookie-authed data is
  readable. The dangerous pattern is *reflecting the Origin* with
  `Allow-Credentials: true`.
- "How do UUIDs relate to BOLA?" They make object ids hard to guess but are
  not access control. You still must verify ownership; ids leak through logs,
  URLs, and referrers.
- "Where does injection sit in the 2023 list?" It's largely folded into
  Security Misconfiguration (API8) and mitigated with schema validation +
  parameterized queries; it's no longer the standalone #1 it is for web apps.
- "How do you stop `alg: none` and algorithm-confusion JWT attacks?" Pin the
  expected algorithm server-side; never trust the token's `alg` header to select
  the verification method; validate `exp`/`iss`/`aud`.
- "CORS vs CSRF — do they solve the same thing?" No. CORS controls what a
  browser lets a *script read* cross-origin; CSRF is about a browser *sending* an
  authenticated state-changing request. A permissive CORS policy can enable data
  theft; CSRF defenses (SameSite, tokens) stop forged writes.

## References

- OWASP API Security Top 10 — 2023 edition: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP API Top 10 2023, per-risk pages (API1–API10): https://owasp.org/API-Security/editions/2023/en/0x00-header/
- OWASP Cheat Sheet Series — REST Security, CORS, CSRF Prevention, Input Validation, Injection Prevention, Transport Layer Security: https://cheatsheetseries.owasp.org/
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457
- RFC 7519 — JSON Web Token (JWT): https://www.rfc-editor.org/rfc/rfc7519
- RFC 6749 — OAuth 2.0; OAuth 2.1 draft: https://www.rfc-editor.org/rfc/rfc6749 / https://oauth.net/2.1/
- RFC 6265 — HTTP State Management (Cookies); SameSite (6265bis): https://www.rfc-editor.org/rfc/rfc6265
- Fetch Standard (CORS): https://fetch.spec.whatwg.org/
- MDN — CORS, HTTP security headers, SameSite cookies: https://developer.mozilla.org/en-US/docs/Web/HTTP
- OWASP — Server-Side Request Forgery Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP — JWT for Java / REST Security / Injection Prevention Cheat Sheets: https://cheatsheetseries.owasp.org/
- RFC 8725 — JSON Web Token Best Current Practices: https://www.rfc-editor.org/rfc/rfc8725
- RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP): https://www.rfc-editor.org/rfc/rfc9449
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens: https://www.rfc-editor.org/rfc/rfc8705
- RFC 7636 — Proof Key for Code Exchange (PKCE): https://www.rfc-editor.org/rfc/rfc7636
- RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens (`at+jwt`): https://www.rfc-editor.org/rfc/rfc9068
- draft-ietf-httpapi-ratelimit-headers — RateLimit header fields for HTTP: https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- Google Zanzibar (ReBAC) — https://research.google/pubs/pub48190/
