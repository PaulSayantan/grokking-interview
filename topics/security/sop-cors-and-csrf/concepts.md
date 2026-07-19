# Same-Origin Policy, CORS & CSRF

Three of the most-confused topics in web security sit on the same foundation: the browser
decides which sites may read which data. The **Same-Origin Policy (SOP)** is the default
isolation boundary. **CORS** is a *controlled relaxation* of that boundary so a server can
opt specific other origins into reading its responses. **CSRF** is a class of attack that
exploits the fact that the browser attaches your cookies to cross-site requests
*regardless* of SOP — and, crucially, is **not** stopped by CORS. Interviewers probe this
cluster because almost everyone gets one thing wrong: they think "CORS is a security
feature that protects my server," or "SOP blocks the request," or "CORS stops CSRF." All
three are misconceptions this topic dismantles.

This is a **language- and framework-agnostic** treatment: we work at the HTTP wire level
(`Origin`, `Access-Control-*`, `Set-Cookie`, `SameSite`) and the browser threat model, not
a specific framework's CSRF filter or CORS middleware.

> [!KEY-TAKEAWAY]
> SOP governs whether JavaScript on origin A can **read a response** from origin B — it
> does **not** stop the request from being *sent*, and it does **not** stop cookies from
> riding along. CORS lets a server *grant* cross-origin **read** access. CSRF abuses the
> automatic sending of credentials on *writes*. Because CORS is about reads and CSRF is
> about writes, **CORS does not prevent CSRF** — you need SameSite cookies and/or anti-CSRF
> tokens for that.

## Same-Origin Policy Definition

An **origin** is the triple **(scheme, host, port)**. Two URLs are same-origin only if all
three match exactly. The Same-Origin Policy (SOP) is a browser security mechanism that
restricts how a document or script loaded from one origin can interact with a resource
from another origin.

| URL compared to `https://app.example.com:443` | Same origin? | Why |
|---|---|---|
| `https://app.example.com/other/path` | ✅ Yes | scheme+host+port all match (path is irrelevant) |
| `http://app.example.com` | ❌ No | scheme differs (`http` vs `https`) |
| `https://api.example.com` | ❌ No | host differs (subdomain counts) |
| `https://example.com` | ❌ No | host differs |
| `https://app.example.com:8443` | ❌ No | port differs |

Note the port subtlety: the default port for the scheme is implied
(`https` → 443, `http` → 80), so `https://a.com` and `https://a.com:443` are the same
origin. "Same **site**" is a *looser* concept than "same **origin**" — it compares only the
registrable domain (eTLD+1), so `https://a.example.com` and `https://b.example.com:8443`
are same-*site* but not same-*origin*. This distinction matters for `SameSite` cookies.

> [!INTERVIEW]
> "Is `https://example.com` the same origin as `http://example.com`?" No — the scheme
> differs. A very common trap. Origin = scheme **and** host **and** port; site =
> registrable domain (eTLD+1), scheme-aware in modern definitions but ignoring subdomain
> and port.

## What SOP Blocks and Doesn't Block

This is the single most misunderstood point. SOP does **not** prevent your browser from
*sending* a cross-origin request. It prevents the calling JavaScript from **reading the
response**.

When `evil.com` runs `fetch('https://bank.com/api/balance', {credentials:'include'})`:

1. The browser **sends** the request — including `bank.com`'s cookies.
2. `bank.com` **receives** it and, unless it checks, **processes** it (this is why CSRF
   works — the side effect happens server-side).
3. When the response comes back, the browser checks CORS headers. If `bank.com` did not
   return an `Access-Control-Allow-Origin` permitting `evil.com`, the browser **blocks
   `evil.com`'s script from reading** the response body, status, and most headers.

So SOP is a **read** restriction enforced on the *response*, not a *request* firewall.

> [!WARNING]
> "SOP blocked my request so my server never saw it" is wrong. The server saw it and may
> have committed a write. The browser merely hid the *response* from the attacker's script.
> Never rely on SOP/CORS as server-side access control — the request already executed.

**What SOP does NOT block** (embedding/side effects are allowed cross-origin by design):
- `<img src>`, `<script src>`, `<link>`, `<video>`, `<audio>` — loading cross-origin
  resources (you can *use* them but not *read their bytes* from script).
- `<form>` submissions to any origin (the basis of classic CSRF).
- Navigation (`window.location`, links).
- Sending the request itself, with cookies, via `fetch`/`XHR`.

**What SOP DOES block from script:**
- Reading a cross-origin response body via `fetch`/`XHR` (without CORS permission).
- Reading cross-origin `iframe` DOM / `contentWindow` internals.
- Reading pixels from a cross-origin image drawn to `<canvas>` (taints the canvas).
- Reading cross-origin cookies, `localStorage`, `IndexedDB`.

## CORS as a Controlled Relaxation

**Cross-Origin Resource Sharing (CORS)** is a mechanism defined in the WHATWG Fetch
standard that lets a **server opt specific origins into reading its responses**, relaxing
SOP in a controlled way. The browser is the enforcer; the server is the decision-maker via
response headers.

The key mental model: **CORS is opt-in by the responding server, for the benefit of
legitimate cross-origin clients.** It is *not* a mechanism that protects the server from
requests — it protects the *user's data* from being read by unauthorized origins' scripts.

The primary header is **`Access-Control-Allow-Origin` (ACAO)**:
- `Access-Control-Allow-Origin: *` — any origin's script may read the response (only valid
  for non-credentialed requests).
- `Access-Control-Allow-Origin: https://app.example.com` — only that specific origin.

Browsers require the server to **echo a single origin** (not a list); to support multiple
allowed origins, the server maintains an allowlist and reflects the request's `Origin` back
*only if it is on the list* (and adds `Vary: Origin`).

> [!KEY-TAKEAWAY]
> CORS **loosens** SOP; it never tightens it. A server with no CORS headers is *more*
> locked-down (SOP default: no cross-origin reads). Misconfigured CORS is a
> **vulnerability**, never a missing "feature." The safe default is to send nothing.

## Simple Requests vs Preflighted Requests

The browser divides cross-origin requests into two categories. This determines whether an
extra round trip (**preflight**) happens.

A request is a **"simple request"** (no preflight) only if it meets **all** of:
- **Method** is `GET`, `HEAD`, or `POST`.
- **Headers** set by script are only CORS-safelisted ones: `Accept`, `Accept-Language`,
  `Content-Language`, `Content-Type`, and `Range` (with limits).
- **`Content-Type`**, if present, is one of exactly three values:
  `application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`.
- No event listeners on the `XMLHttpRequest.upload` object; no `ReadableStream` body.

Anything else triggers a **preflight**: the browser first sends an `OPTIONS` request to ask
permission before sending the real request.

```http
OPTIONS /api/transfer HTTP/1.1
Host: bank.com
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, x-csrf-token
```

The server answers (typically `204 No Content`) with what it will allow:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token
Access-Control-Max-Age: 600
Vary: Origin
```

Only if the preflight passes does the browser send the actual `POST`. Note the actual
request does **not** repeat `Access-Control-Request-*` headers — those are preflight-only.
`Access-Control-Max-Age` caches the preflight result (seconds) so repeated calls skip the
`OPTIONS` round trip; browsers cap this (e.g., Chromium caps at 7200s, Firefox at 86400s).

> [!INTERVIEW]
> "Why does sending `Content-Type: application/json` trigger a preflight but a form POST
> doesn't?" Because `application/json` is not one of the three safelisted content types.
> This is a security-relevant fact: an HTML `<form>` can only produce the three safelisted
> types, so it can send a cross-origin state-changing POST **without a preflight** — which
> is exactly why CSRF via auto-submitting forms works and why an API that only accepts
> `application/json` gets *some* incidental CSRF resistance (attacker's `fetch` with JSON
> gets preflighted, and the browser blocks the actual request if the server doesn't allow
> it). This is incidental, not a substitute for real CSRF defense.

## Allow-Credentials and the Wildcard Rule

By default, cross-origin `fetch`/`XHR` does **not** send cookies or HTTP auth. To include
them the client sets `credentials: 'include'` (fetch) or `withCredentials = true` (XHR),
**and** the server must respond with `Access-Control-Allow-Credentials: true`.

The critical security rule: **you cannot combine credentials with a wildcard.**

| Client sends credentials? | `Access-Control-Allow-Origin` | Result |
|---|---|---|
| No | `*` | Browser exposes response |
| Yes | `*` | Browser **blocks** — wildcard + credentials is forbidden |
| Yes | `https://app.example.com` + `Access-Control-Allow-Credentials: true` | Exposed |
| Yes | explicit origin but **missing** `Allow-Credentials: true` | **Blocked** |

Likewise, with credentials the values of `Access-Control-Allow-Headers`,
`Access-Control-Allow-Methods`, and `Access-Control-Expose-Headers` must be **explicit
lists**, not `*` (a literal `*` is treated as the header name "*", not a wildcard, when
credentials are involved). And a `Set-Cookie` in the response is ignored if ACAO is `*`.

This rule exists precisely to stop a lazy `Access-Control-Allow-Origin: *` from leaking
authenticated, per-user data to arbitrary origins.

## Common CORS Misconfigurations

CORS misconfiguration is a real vulnerability class (OWASP WSTG-CLNT and part of A05:2021
Security Misconfiguration). The dangerous ones all combine **reading credentialed data**
with **trusting the wrong origin**.

**1. Reflecting `Origin` without an allowlist + `Allow-Credentials: true`.** The server
copies whatever `Origin` the request carried straight into `Access-Control-Allow-Origin`:

```
# Vulnerable server logic
Access-Control-Allow-Origin: <echo request Origin>
Access-Control-Allow-Credentials: true
```

Now `https://evil.com` sends a credentialed request, the server reflects
`Access-Control-Allow-Origin: https://evil.com` + `Allow-Credentials: true`, and the
attacker's script reads the victim's authenticated response. **This is equivalent to
`*` + credentials but bypasses the browser's wildcard block.** Fix: reflect only origins on
a strict allowlist.

**2. Sloppy origin matching.** Using a substring/prefix/suffix check:
- `startsWith("https://app.example.com")` → `https://app.example.com.evil.com` passes.
- `endsWith("example.com")` → `https://notexample.com` or `https://evilexample.com` passes.
- Regex `example.com` without anchoring/escaping the dot → `https://exampleXcom` passes.
Fix: exact string equality against the allowlist.

**3. Trusting `null`.** `Access-Control-Allow-Origin: null` + credentials. The `Origin:
null` value is sent by sandboxed iframes, `data:`/`file:` documents, and some redirects — an
attacker can force it via a sandboxed iframe and read the response. Never allowlist `null`.

**4. Over-permissive `*` on internal/admin APIs** reachable by an authenticated browser
(even without credentials, `*` leaks any data the API returns to unauthenticated callers).

**5. Missing `Vary: Origin`** while reflecting origins → a shared cache may store the
response for origin A and serve it (with A's ACAO) to origin B, or vice-versa. Always add
`Vary: Origin` when the ACAO value depends on the request.

> [!WARNING]
> The most dangerous single line in web security is arguably `Access-Control-Allow-Origin`
> reflecting the request `Origin` **together with** `Access-Control-Allow-Credentials:
> true`. It turns SOP off for every attacker origin against authenticated endpoints.

## CSRF Mechanics

**Cross-Site Request Forgery (CSRF/XSRF)** tricks a logged-in victim's browser into sending
a **state-changing request** to a site where the victim is authenticated, *without the
victim's intent*. It exploits **ambient authority**: the browser automatically attaches
the victim's cookies (or HTTP Basic auth, or client certs) to requests to a site, no matter
what page triggered the request.

The three preconditions for classic cookie-based CSRF:
1. The victim is **authenticated via a mechanism the browser sends automatically** (a
   cookie without effective `SameSite`, HTTP Basic, etc.). Bearer tokens in an
   `Authorization` header or read from JS storage are **not** auto-sent, so those APIs are
   not CSRF-able the same way.
2. The action is **predictable** — the attacker knows the request shape (URL, params).
3. There is **no unguessable secret** the attacker cannot supply (no anti-CSRF token, no
   custom header the attacker can't set cross-origin).

**Exploit — state-changing GET (worst case):**
```html
<!-- On evil.com; auto-fires when victim (logged into bank.com) loads the page -->
<img src="https://bank.com/transfer?to=attacker&amount=10000">
```

**Exploit — auto-submitting form for POST:**
```html
<form action="https://bank.com/transfer" method="POST" id="f">
  <input type="hidden" name="to" value="attacker">
  <input type="hidden" name="amount" value="10000">
</form>
<script>document.getElementById('f').submit();</script>
```
The form POST uses `application/x-www-form-urlencoded` (a safelisted content type), so it is
a **simple request** — no preflight, and the request fires with cookies attached. The
attacker never needs to *read* the response (SOP/CORS can block that); the **side effect**
already happened server-side.

> [!KEY-TAKEAWAY]
> CSRF is a **write/side-effect** attack, and it does not require reading the response. That
> is why SOP and CORS — which govern *reading* responses — do nothing to stop it, and why
> **never using GET for state changes** is the first rule (GET is trivially forgeable via
> `<img>`, prefetch, links).

## CSRF Defense: SameSite Cookies

The `SameSite` cookie attribute (RFC 6265bis) tells the browser whether to send a cookie on
cross-**site** requests. It is the strongest single mitigation because it removes the
*ambient authority* CSRF depends on.

| Value | Cookie sent on cross-site requests? |
|---|---|
| `Strict` | **Never** on any cross-site request (even top-level navigation from a link) |
| `Lax` | Only on **top-level navigations** using **safe methods** (GET) — e.g., clicking a link. Not on cross-site POST, `<img>`, `fetch`, iframes |
| `None` | Always sent (must also set `Secure`) — required for legitimate cross-site cookies |

`Set-Cookie: session=...; SameSite=Lax; Secure; HttpOnly` blocks the auto-submitting POST
form attack because the cross-site POST won't carry the cookie. Most modern browsers now
**default to `Lax`** when no `SameSite` is specified.

Limitations interviewers probe:
- **`Lax` still allows cross-site top-level GET navigations** — so a state-changing GET
  endpoint remains exploitable via a link/redirect even under `Lax`. (Another reason GET
  must be side-effect-free.)
- **`SameSite` is scoped to the registrable *site*, not origin.** `evil.example.com` and
  `app.example.com` are the *same site*, so a compromised/attacker-controlled subdomain can
  still send "same-site" requests. Sibling-subdomain attacks bypass SameSite.
- Not a defense against **client-side CSRF** or when the attacker page is hosted on the same
  site.
- OWASP treats `SameSite` as **defense-in-depth**, to be combined with a token — not a
  complete replacement, unless narrow conditions hold (e.g., `Strict` or `Lax` + `__Host-`
  prefix, no state-changing GET, no shared registrable domain).

## CSRF Defense: Synchronizer Token Pattern

The **synchronizer token pattern (STP)** is OWASP's recommended defense for **stateful**
apps. The server generates a per-session (or per-request) random, unpredictable token, ties
it to the user's session server-side, and embeds it in every state-changing form/request.
On submission the server compares the submitted token to the stored one and rejects on
mismatch.

```html
<form action="/transfer" method="POST">
  <input type="hidden" name="csrf_token" value="8f3b...random-64bit+...">
  ...
</form>
```

Why it works: the attacker's cross-site page **cannot read** the token (SOP blocks reading
`bank.com`'s HTML), so it cannot include the correct value. The token must be:
- **Unpredictable** (CSPRNG, ≥ high entropy) and **unique per session**.
- **Not transmitted in a cookie** for this pattern (that would be double-submit; see below),
  and **not leaked** in URLs, logs, or `Referer`.
- Sent in a **request body or custom header**, and validated server-side.

Per-request tokens shrink the exploit window further but can break the Back button and
multi-tab UX. STP requires server-side per-session state, which is why stateless apps often
prefer double-submit.

## CSRF Defense: Double-Submit Cookie

The **double-submit cookie** pattern is OWASP's recommended approach for **stateless** apps
(no server-side token store). The token is sent **twice**: once as a cookie and once as a
request parameter/header. The server checks that the two match.

**Naive double-submit (discouraged):** cookie value == submitted value, no crypto binding.
It is **bypassable by an attacker who can write cookies** on the target domain — e.g., via a
subdomain (`SameSite` doesn't stop sibling subdomains) or a MITM on an `http://` subdomain
setting a cookie for the parent domain. The attacker sets both the cookie and the matching
parameter to a value they know. Because cookies aren't origin-isolated the way SOP isolates
reads, an attacker who can *inject* a cookie defeats naive double-submit.

**Signed double-submit (recommended):** the token is an **HMAC** over a **session-bound**
value using a server-side secret (plus a random anti-collision nonce). The server
recomputes/verifies the HMAC and checks the session binding. Because the attacker lacks the
server secret, they cannot forge a valid token even if they can write cookies.

> [!WARNING]
> "Double-submit cookie" alone (naive) is a common interview trap. Simply signing the token
> is *also* insufficient without **session binding** — otherwise a token minted for one user
> is replayable/injectable. The recommended form is HMAC + session binding.

## CSRF Defense: Custom Header and Fetch Metadata

**Custom request header.** Require a header like `X-CSRF-Token` (any value, or a real token)
on state-changing requests. This works because a cross-origin page **cannot set a custom
header on a simple request** — adding a custom header forces a **CORS preflight**, and the
attacker's server won't approve it (or the request never fires). So the mere *presence* of a
successfully-sent custom header proves the request came from a permitted origin's script (or
same-origin JS). This is the default for many JSON APIs and SPAs.

Caveat: this protects **XHR/fetch** requests but not `<form>` submissions (forms can't add
custom headers anyway, so pair it with the fact that your API only accepts JSON/custom-header
requests). Never rely solely on `Content-Type: application/json` as the "custom" marker
unless the server strictly rejects other content types.

**Fetch Metadata (`Sec-Fetch-*`).** Modern browsers automatically send
`Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`. These are **forbidden headers**
(script cannot set/spoof them). A server can reject state-changing requests where
`Sec-Fetch-Site: cross-site` (allowing `same-origin`, `same-site`, and `none` for direct
navigation). It is a lightweight, modern CSRF/clickjacking signal — with a mandatory
`Origin`/`Referer` fallback for older clients.

## CSRF Defense: Origin and Referer Validation

Because `Origin` and `Referer` are **forbidden request headers** (set by the browser, not
spoofable by cross-origin script), the server can verify them for state-changing requests:

1. If `Origin` is present, check it **exactly** equals an expected target origin.
2. Else fall back to the `Referer` **hostname** (strict match).
3. If neither is present on a state-changing request, **block** (fail closed).

```
# Reject if Origin present and not in allowed set
Origin: https://evil.com   → 403
Origin: https://app.example.com → allow
```

Pitfalls: strict matching is essential — `https://app.example.com.evil.com` and
`https://evil.com/app.example.com` must not pass. `Referer` can be stripped by privacy
settings/proxies (hence the fail-closed decision needs care to avoid breaking legit users),
and `Origin` may be absent on some same-origin GETs. Origin/Referer checking is a solid
defense-in-depth layer and the fallback for Fetch Metadata.

## CORS Does NOT Prevent CSRF

The single most important misconception in this topic. Candidates often say "we enabled a
strict CORS policy, so we're safe from CSRF." **False.**

- **CORS governs whether a cross-origin script may READ a response.** CSRF only needs the
  request's **side effect** to happen server-side; the attacker never reads the response.
- The classic CSRF vectors — `<img>`, `<form>` auto-submit, top-level navigation — are
  **not subject to CORS at all** (CORS applies to `fetch`/`XHR`, not form/image/navigation).
  A restrictive CORS policy does nothing to stop a cross-site form POST from firing with
  cookies.
- Even for `fetch`, a CORS policy that *blocks the read* still lets the **request execute**
  server-side (for simple requests) — so the write lands and only the response is hidden.

Where CORS *incidentally* helps: if your API **only** accepts `application/json` (or requires
a custom header), the attacker's cross-origin `fetch` gets **preflighted**, and if your
server doesn't approve the preflight the *actual* request is never sent. That is a happy
side effect of forcing non-simple requests — **not** CORS "preventing CSRF." Relying on it is
fragile (browser quirks, simple-request edge cases). Real CSRF defense = SameSite +
token/custom-header/origin-check.

> [!INTERVIEW]
> "We have a strict `Access-Control-Allow-Origin` allowlist — are we protected from CSRF?"
> No. CORS decides who can *read* responses; CSRF is about *making a write happen*.
> Conversely, a *loose* CORS policy (reflect-origin + credentials) makes things *worse* by
> also enabling data theft. Correct answer: CORS and CSRF are orthogonal; use SameSite +
> anti-CSRF tokens for CSRF, and a strict allowlist for CORS.

## Clickjacking and frame-ancestors

**Clickjacking** (UI redressing) loads your site in a transparent/obscured `<iframe>` over
attacker content, tricking the victim into clicking something on *your* site (e.g., a
"Delete account" or "Confirm transfer" button) while they think they're clicking the
attacker's page. Because the framed page carries the victim's cookies, the click executes an
authenticated action — like a CSRF that reuses the victim's *own* clicks, bypassing token
defenses (the real page with the real token is what's framed).

**Defenses (framing controls):**
- **CSP `frame-ancestors` directive** (Content Security Policy Level 2/3) — the modern,
  preferred control. It specifies which origins may frame the page:
  - `Content-Security-Policy: frame-ancestors 'none'` — no one may frame it.
  - `Content-Security-Policy: frame-ancestors 'self'` — only same-origin framing.
  - `Content-Security-Policy: frame-ancestors https://trusted.example.com` — allowlist.
- **`X-Frame-Options`** (legacy header) — `DENY` or `SAMEORIGIN`. The old `ALLOW-FROM` is
  obsolete/poorly supported. Keep it only for old-browser support; `frame-ancestors`
  **overrides** it in modern browsers.

```http
Content-Security-Policy: frame-ancestors 'self'
X-Frame-Options: DENY
```

Note `frame-ancestors` also interacts with `SameSite`: a cross-site iframe won't carry
`SameSite=Lax/Strict` cookies, which mitigates some clickjacking-to-CSRF chains — but
framing controls are the direct fix. `X-Frame-Options` cannot express an allowlist of
multiple origins; `frame-ancestors` can, which is another reason to prefer it.

## Common follow-up questions

- **"What exactly defines an origin, and how does it differ from a site?"** Origin =
  (scheme, host, port) exact match; site = registrable domain (eTLD+1), ignoring subdomain
  and port. SameSite cookies use *site*; SOP uses *origin*.
- **"If SOP blocks cross-origin reads, why does CSRF work?"** Because SOP blocks reading the
  *response*, not sending the *request*; the state change happens before/independent of the
  read.
- **"Why does `Content-Type: application/json` trigger a preflight but a form POST not?"**
  JSON isn't a CORS-safelisted content type; only `x-www-form-urlencoded`, `multipart/
  form-data`, and `text/plain` avoid preflight.
- **"Is `Access-Control-Allow-Origin: *` with `Allow-Credentials: true` allowed?"** No —
  browsers block wildcard + credentials. Attackers get around it by *reflecting* the origin
  with an allowlist bug.
- **"Why must you add `Vary: Origin` when reflecting origins?"** So shared caches don't serve
  one origin's ACAO response to another origin.
- **"Does putting the CSRF token in a cookie protect me?"** Only if double-submit is done
  **with HMAC + session binding**; naive same-value double-submit is bypassable via cookie
  injection from a subdomain.
- **"Why does requiring a custom header defend against CSRF?"** Custom headers force a CORS
  preflight cross-origin, which the attacker's origin can't get approved — and forms can't
  set custom headers.
- **"How is clickjacking different from CSRF, and what stops it?"** Clickjacking uses the
  victim's real clicks on a framed real page (defeating tokens); stop it with CSP
  `frame-ancestors` / `X-Frame-Options`.
- **"Are bearer-token (Authorization header) APIs vulnerable to CSRF?"** Not to classic
  cookie CSRF, because the token isn't auto-attached by the browser — the app must add it
  explicitly. Cookie/Basic-auth sessions are the vulnerable case.

## References

- OWASP CSRF Prevention Cheat Sheet — synchronizer token, signed double-submit, SameSite,
  custom headers, origin verification, Fetch Metadata: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Cross-Site Request Forgery (CSRF): https://owasp.org/www-community/attacks/csrf
- OWASP Clickjacking Defense Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
- OWASP HTTP Headers / CORS testing (WSTG): https://owasp.org/www-project-web-security-testing-guide/
- MDN — Same-origin policy: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- MDN — Cross-Origin Resource Sharing (CORS): https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- MDN — SameSite cookies: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#samesite_attribute
- WHATWG Fetch Standard (CORS protocol, safelisted headers): https://fetch.spec.whatwg.org/
- RFC 6265bis — Cookies, `SameSite` attribute: https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis
- CSP Level 3 — `frame-ancestors`: https://www.w3.org/TR/CSP3/#directive-frame-ancestors
- OWASP Top 10 2021 A05 Security Misconfiguration (CORS misconfig): https://owasp.org/Top10/A05_2021-Security_Misconfiguration/
- MDN — `Sec-Fetch-Site` (Fetch Metadata): https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site
