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

## Common follow-up questions

- **"What's the difference between BOLA and BFLA?"** BOLA (API1) = wrong
  *object* (can I access another user's record by changing an id?); BFLA (API5) =
  wrong *function/role* (can I call an admin operation as a normal user?). Both
  are authorization gaps; one is per-object, one is per-operation.
- **"Are bearer-token APIs vulnerable to CSRF?"** Generally no — the token isn't
  sent automatically by the browser and cross-site pages can't read/set the
  `Authorization` header. CSRF is a concern for *cookie/Basic/cert* auth.
- **"Does `Access-Control-Allow-Origin: *` leak my users' data?"** Not by itself:
  wildcard + credentials is blocked by browsers, so no cookie-authed data is
  readable. The dangerous pattern is *reflecting the Origin* with
  `Allow-Credentials: true`.
- **"How do UUIDs relate to BOLA?"** They make object ids hard to guess but are
  not access control. You still must verify ownership; ids leak through logs,
  URLs, and referrers.
- **"Where does injection sit in the 2023 list?"** It's largely folded into
  Security Misconfiguration (API8) and mitigated with schema validation +
  parameterized queries; it's no longer the standalone #1 it is for web apps.
- **"How do you stop `alg: none` and algorithm-confusion JWT attacks?"** Pin the
  expected algorithm server-side; never trust the token's `alg` header to select
  the verification method; validate `exp`/`iss`/`aud`.
- **"CORS vs CSRF — do they solve the same thing?"** No. CORS controls what a
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
