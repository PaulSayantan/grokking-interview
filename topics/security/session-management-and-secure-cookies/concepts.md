# Session Management & Secure Cookies

After a user authenticates, the application must **remember who they are** across the
many stateless HTTP requests that follow. That "memory" is the **session**, and the
credential the browser presents on every request — usually a cookie — is the single most
attacked artifact in web security: steal or forge it and you *are* the user, no password
required. This topic covers how sessions are established, stored, transported, timed out,
and destroyed, and the attacks (fixation, hijacking, theft via XSS) and defenses (secure
cookie attributes, ID regeneration, server-side invalidation) an interviewer will probe.

This is a **language- and framework-agnostic** treatment: we talk about the HTTP wire
format (`Set-Cookie`, `Cookie` headers), the threat model, and the mechanisms — not a
specific framework's session module. OAuth/JWT token *contracts* live in other topics;
here we treat tokens only through the lens of **where you store them and how they leak**.

> [!KEY-TAKEAWAY]
> A session identifier is a **bearer credential**: whoever holds it is treated as the
> authenticated user. Every defense in this topic exists to answer one of two questions —
> "can an attacker *guess* it?" (entropy) or "can an attacker *obtain* it?" (transport,
> XSS, fixation, CSRF, timeouts). Get both right and session management is largely solved.

## Sessions and Statelessness

HTTP is **stateless**: each request is independent and carries no memory of prior ones.
To create the illusion of a logged-in session, the server issues a **session identifier**
on the first authenticated response and the client returns it on every subsequent
request. The canonical transport is an HTTP cookie (RFC 6265): the server sends
`Set-Cookie: SESSIONID=abc123` and the browser automatically attaches
`Cookie: SESSIONID=abc123` to future same-origin requests.

The session ID is a **pointer**, not the data itself. In the classic model it points to
server-side state (a row in a session store) that holds the real information — user ID,
roles, CSRF token, last-activity timestamp. This indirection is what makes server-side
sessions revocable: delete the row and the pointer is worthless.

**The full lifecycle on the wire.** A user submits credentials; the server authenticates,
**kills any pre-login session ID, and issues a fresh one** in the same response:

```
POST /login HTTP/1.1
Host: app.com
Cookie: __Host-SESSIONID=PRE_AUTH_7c1e...          ← anonymous pre-login ID

HTTP/1.1 302 Found
Location: /dashboard
Set-Cookie: __Host-SESSIONID=POST_AUTH_a9f2...; Secure; HttpOnly; SameSite=Lax; Path=/
   ← server DELETES the PRE_AUTH_7c1e row and issues a brand-new POST_AUTH_a9f2
```

The browser overwrites its stored value and returns the new one on the redirected request:

```
GET /dashboard HTTP/1.1
Host: app.com
Cookie: __Host-SESSIONID=POST_AUTH_a9f2...          ← authenticated ID
```

`PRE_AUTH_7c1e` is now dead everywhere: if an attacker had planted it in the victim's
browser (session fixation, below), it points to an invalidated row and grants nothing.
That single rotation-at-login is the whole fixation defense — see the Session Fixation
section.

> [!INTERVIEW]
> "Why can't we just put the username in a cookie?" Because cookies are client-controlled
> — the user can edit `Cookie: user=alice` to `user=admin`. A session ID works because it
> is an **unforgeable, high-entropy random token** that the server maps to trusted state.
> If you must put data in the cookie itself, it has to be **cryptographically signed**
> (and possibly encrypted) so tampering is detectable — that is the stateless-token model.

## Server-Side Sessions vs Stateless Tokens

There are two fundamental architectures for holding session state:

| | **Server-side session** | **Stateless (signed/encrypted) token** |
|---|---|---|
| What the cookie holds | Opaque random **ID** (pointer) | The **data itself**, signed (e.g. JWT/JWE) |
| State lives | On the server (DB/cache/Redis) | On the client, in the token |
| Revocation | Trivial — delete server row | **Hard** — token valid until it expires |
| Horizontal scaling | Needs shared/sticky store | Any node can validate with the key |
| Size on the wire | Tiny (16–32 bytes) | Large (hundreds of bytes → every request) |
| Tamper protection | N/A (opaque) | Relies entirely on signature/MAC |
| Leakage blast radius | Revoke on detection | Valid until expiry unless you add a denylist |

The core trade-off is **revocability vs statelessness**. Server-side sessions give you
instant logout, forced invalidation, and easy concurrent-session control at the cost of a
shared session store. Stateless tokens scale effortlessly and remove the store, but you
cannot truly "log someone out" — a stolen token stays valid until it expires, so you must
keep lifetimes short and add a revocation/denylist mechanism (which reintroduces state).

> [!WARNING]
> "Stateless JWT sessions" are frequently misused as a session replacement without a
> revocation story. If you cannot answer "how do I immediately kill a compromised
> token?", you have built a system where a stolen credential is valid for its entire
> lifetime. Short expiry + refresh-token rotation, or a server-side denylist, is
> mandatory. Also: putting a JWT in a cookie does **not** make it revocable — the token is
> still self-contained.

## Session ID Generation: Entropy and CSPRNG

A session ID must be **unguessable**. The threat is brute force / prediction: if an
attacker can enumerate or predict valid IDs, they hijack sessions without ever touching
the victim.

Two requirements from the OWASP Session Management Cheat Sheet:

1. **Entropy ≥ 64 bits** to resist brute-force guessing. (64 bits needs ≥ 16 hex chars;
   fewer if a denser encoding like Base64 is used.) Framework session IDs are typically
   128 bits, which is comfortably safe.
2. **Generated by a CSPRNG** (cryptographically secure PRNG) — never `Math.random()`, a
   linear congruential generator, `rand()`, or anything seeded by time/PID. If you build
   your own ID, the OWASP guidance is a CSPRNG output of **at least 128 bits**.

The classic real-world failure is a **predictable PRNG**: an ID derived from a timestamp,
an incrementing counter, or a weak `Math.random()` lets an attacker who observes a few IDs
model the generator and predict others. Effective entropy also collapses if part of the
ID is fixed (a server prefix, a constant hostname) — only the *random* portion counts.

**Worked example — why 64 bits is safe and 32 is not.** Use OWASP's brute-force estimate:
with `A` guesses/second against `S` valid sessions live at once, the expected time to hit
*any* one of them is

```
time ≈ 2^bits / (2 × A × S)
```

Take an aggressive attacker at `A = 10,000` guesses/sec and a busy app with `S = 10,000`
concurrent sessions, so the denominator is `2 × 10^4 × 10^4 = 2×10^8` guesses/sec-effective:

- **64-bit ID:** `2^64 ≈ 1.84×10^19`. Time `≈ 1.84×10^19 / 2×10^8 = 9.2×10^10 s ≈ 2,900
  years`. Astronomically safe — and that is *already* assuming 10,000 valid targets.
- **128-bit ID (framework default):** `2^128 ≈ 3.4×10^38`, giving `~1.7×10^30 s ≈ 5×10^22
  years` — longer than the age of the universe by many orders of magnitude. This is why
  "128-bit is comfortably safe" needs no further thought.
- **32-bit ID:** `2^32 ≈ 4.3×10^9`. Time `≈ 4.3×10^9 / 2×10^8 ≈ 21 seconds`. A truncated
  or weak 32-bit ID is **guessable in seconds** — dropping 32 bits costs you a factor of
  `2^32 ≈ 4.3 billion` in attacker effort.

**Tie it to encoding:** entropy = (number of random characters) × (bits per character).
Hex is 4 bits/char, so **16 hex chars = 16 × 4 = 64 bits** — exactly the floor. Base64 is
6 bits/char, so the same 64 bits needs only `⌈64/6⌉ = 11` characters; a 128-bit ID is 32
hex chars or 22 Base64 chars. Only the *random* characters count: a `sess_` prefix or an
embedded server ID adds length but **zero entropy**.

> [!TIP]
> Interview soundbite: "High-entropy (≥128-bit) session IDs from a CSPRNG; the ID must be
> opaque, carry no meaning, and reveal nothing about the user or the generator's state."

## Session ID Storage and Transmission

**Server-side**, session records should be stored so that a store compromise is not
game-over. Treat the session ID like a password: many designs store a **hash** of the ID
(so a leaked store dump can't be replayed directly) and never log the raw ID. The
trade-off: hashing means the store is keyed by `hash(id)`, so every request pays one hash
before the lookup, and — since the hash is one-way — you can never recover the raw ID from
the store (fine, you never need to). Because the ID is already high-entropy random, a fast
single hash (e.g. SHA-256) suffices; you do **not** need a slow password KDF like bcrypt,
whose cost only buys resistance to low-entropy guessing.

**On the wire**, the golden rule is: the session ID must only travel inside a secure
cookie, never in a URL. Session IDs in the URL (`?sessionid=abc`) leak through:

- **Referer headers** to third-party sites,
- **Browser history**, bookmarks, and shared links,
- **Server/proxy access logs** (plaintext, widely readable),
- shoulder-surfing and copy-paste.

Always transmit over **HTTPS** so the cookie can't be sniffed in transit, and set the
`Secure` attribute so the browser refuses to send it over plaintext HTTP.

> [!WARNING]
> Never place a session identifier in a query string or path. URL rewriting for sessions
> (common in old servlet containers via `;jsessionid=`) is an OWASP anti-pattern precisely
> because of Referer and log leakage.

## Cookie Attributes: HttpOnly and Secure

Two attributes are the first line of defense for any session cookie:

- **`HttpOnly`** — the cookie is hidden from JavaScript (`document.cookie` can't read it).
  This is the primary mitigation against **session theft via XSS**: even if an attacker
  injects script, they can't exfiltrate an `HttpOnly` cookie. Note the cookie is *still
  sent* on `fetch()`/`XMLHttpRequest` calls — `HttpOnly` blocks *reading*, not *sending*.
- **`Secure`** — the browser only sends the cookie over HTTPS (`https:` scheme; localhost
  is exempted for dev). This prevents leakage over plaintext HTTP and downgrade attacks.
  An insecure `http:` page cannot set a `Secure` cookie.

```
Set-Cookie: SESSIONID=9f3a...; HttpOnly; Secure; SameSite=Strict; Path=/
```

> [!KEY-TAKEAWAY]
> `HttpOnly` defends against **XSS** exfiltration; `Secure` defends against **network**
> sniffing/downgrade; `SameSite` defends against **CSRF**. They address different threats —
> a session cookie should carry all three.

## Cookie Attributes: SameSite (Lax, Strict, None)

`SameSite` controls whether the cookie rides along on **cross-site** requests, and is the
built-in browser defense against **CSRF** (see the CSRF topic for the full attack).

| Value | Sent on same-site | Sent on cross-site |
|---|---|---|
| `Strict` | Yes | **Never** |
| `Lax` (modern default) | Yes | Only on **top-level navigation** with a **safe method** (GET) — e.g. clicking a link |
| `None` | Yes | Yes — **`Secure` is mandatory** |

- **`Strict`** is the safest but breaks "follow a link into the site while logged in" (the
  first request arrives without the cookie, so the user looks logged out).
- **`Lax`** is the pragmatic default: the cookie is sent when the user *navigates* to your
  site (top-level GET) but **not** on cross-site `POST`, `fetch()`, `<img>`, or iframe
  subresource loads — which blocks the classic form-POST CSRF.
- **`None`** re-enables full cross-site sending (needed for legitimate third-party
  contexts like embedded widgets or cross-site SSO) and **requires `Secure`** or the
  browser rejects it.

> [!WARNING]
> `SameSite` is **defense in depth, not a complete CSRF defense.** The `Lax` default still
> allows cross-site top-level GET requests, so any state-changing GET endpoint remains
> exploitable; older browsers may not enforce `SameSite` at all; and it does nothing for
> same-site attacks. Keep using anti-CSRF tokens (or the double-submit pattern) for
> state-changing requests.

## Cookie Attributes: Domain, Path, and Lifetime

- **`Domain`** — controls which hosts receive the cookie. **Omitting `Domain`** yields a
  *host-only* cookie (sent only to the exact host that set it) — the **more restrictive
  and preferred** choice. Setting `Domain=example.com` broadens it to `example.com` *and
  all subdomains*, which is dangerous: a compromised or untrusted subdomain
  (`blog.example.com`) then sees the main app's session cookie. You can only set `Domain`
  to your own domain or a parent (not a public suffix, not an unrelated domain).
- **`Path`** — the cookie is only sent for matching URL paths (`Path=/app` → sent for
  `/app` and `/app/*`, not `/`). Path is a **scoping convenience, not a security boundary**
  — same-origin script under a different path can still reach it, and path matching does
  not isolate cookies from XSS.
- **Lifetime** — `Max-Age=<seconds>` or `Expires=<HTTP-date>` make a **persistent** cookie
  written to disk. If **both** are present, **`Max-Age` wins**. If **neither** is present,
  it's a **session cookie** held only in memory and dropped when the browser closes.
  OWASP recommends **non-persistent (session) cookies** for session IDs so they don't
  survive on disk — and never rely on the cookie's expiry for security, since the client
  controls it. **Authoritative timeout enforcement must be server-side.**

## Cookie Prefixes: __Host- and __Secure-

Cookie *attributes* can be silently ignored or overwritten (e.g. a subdomain or a MITM on
a sibling `http://` origin overwriting your cookie — "cookie tossing"). The **`__Host-`**
and **`__Secure-`** name prefixes let the browser *enforce* attributes based on the name
itself:

- **`__Secure-`** — the browser only accepts the cookie if it was set with `Secure` from
  an HTTPS page.
- **`__Host-`** — the strongest: the browser only accepts it if it is `Secure`, set from
  HTTPS, has **`Path=/`**, and has **no `Domain` attribute** (so it's host-locked and
  cannot be set by or shared with subdomains). This defeats cookie-tossing/overwriting
  from subdomains.

```
Set-Cookie: __Host-SESSIONID=9f3a...; Secure; HttpOnly; SameSite=Strict; Path=/
```

OWASP explicitly **recommends the `__Host-` prefix for session ID cookies**.

> [!WARNING]
> A prefix is only enforced by browsers that understand it; on legacy browsers a
> `__Host-`-named cookie is accepted like any other. The prefix name is a *signal to the
> browser*, not to the server — your server must still set the actual attributes.

## Session Fixation

**Session fixation** is an attack where the attacker gets a *known* session ID established
in the victim's browser **before** login, then rides that same ID after the victim
authenticates.

**Vulnerable pattern:** the application accepts a session ID supplied by the client and
keeps the *same* ID after login (it never regenerates on privilege change).

**Concrete exploit:**
1. Attacker obtains a valid session ID `S` from the app (or plants one).
2. Attacker forces `S` into the victim's browser — e.g. a crafted link
   `https://app.com/?sessionid=S` (URL-rewriting sites), a cookie set via an XSS or a
   subdomain, or a `<meta>`/header injection.
3. Victim logs in. Because the app *keeps* `S`, the now-authenticated session is bound to
   the ID the attacker already knows.
4. Attacker uses `S` and is logged in as the victim.

**Defense:** **regenerate (rotate) the session ID on every privilege-level change**, above
all at **login** (and at logout, and on step-up such as entering an admin area). The old
pre-auth ID is invalidated; the attacker's known value is now dead. Combine with:
`Secure`/`HttpOnly` cookies, never accepting a session ID the app didn't issue, and never
passing IDs in URLs.

> [!KEY-TAKEAWAY]
> One line answers most fixation questions: **"Regenerate the session ID at authentication
> so the post-login session never reuses a pre-login identifier the attacker could know."**

## Session Hijacking

**Session hijacking** is the theft and replay of a *valid, active* session ID — the
attacker doesn't guess or fix it, they **steal it**. Common vectors:

- **XSS** — injected script reads a non-`HttpOnly` cookie or reads a token from
  `localStorage` and exfiltrates it. (Mitigation: `HttpOnly` + fix the XSS + CSP.)
- **Network sniffing / MITM** — cookie sent over plaintext HTTP. (Mitigation: HTTPS +
  `Secure` + HSTS.)
- **Referer/log leakage** — ID in a URL. (Mitigation: cookies only, never URLs.)
- **Physical/local access** — persistent cookie on disk. (Mitigation: session cookies.)

Because a stolen ID is a valid bearer credential, layered detection helps: **rotate the ID
periodically** (renewal timeout) so a captured ID has a short useful life; **bind loosely
to context** (e.g. flag or re-authenticate on a sudden User-Agent or coarse IP change —
but note IPs legitimately change on mobile, so hard IP-binding causes false logouts); and
**enforce idle + absolute timeouts** to cap the window.

> [!INTERVIEW]
> Fixation vs hijacking: **fixation** = attacker plants a *known* ID *before* auth and the
> app fails to rotate it; **hijacking** = attacker *steals* an already-valid ID. Fixation
> is prevented by ID regeneration on login; hijacking is prevented by protecting the ID in
> transit and at rest (HttpOnly, Secure, HTTPS, no URLs) plus short timeouts.

## Idle vs Absolute Timeout

Two independent timeouts limit how long a session — and thus a stolen ID — stays usable:

- **Idle (inactivity) timeout** — expires the session after a period with *no activity*.
  Sliding window, reset on each request. Bounds the risk of an unattended/abandoned
  session. OWASP guidance: ~**2–5 minutes** for high-value apps, **15–30 minutes** for
  lower-risk apps.
- **Absolute timeout** — expires the session a fixed time after *creation*, regardless of
  activity, forcing periodic re-authentication. OWASP guidance: on the order of
  **4–8 hours** for typical full-day use. This caps the lifetime of a hijacked session
  even if the attacker keeps it active.
- **Renewal timeout** — periodically **regenerates the session ID** mid-session while
  keeping the session alive, shrinking the window a captured ID is valid.

**Scaling gotcha — sliding-window write amplification.** A naive idle timeout updates the
`last_activity` timestamp on *every* request, so a session store handling 50k req/s takes
50k writes/s **just to bump timestamps** — often more write load than the app's real data.
Mitigations: **throttle** the update (only write if the stored timestamp is more than, say,
30–60 s old, trading timeout precision for far fewer writes), or go **lazy** (write only on
meaningful actions and check freshness on read). An interviewer probing "what happens at
scale?" is fishing for this write-amplification answer.

> [!WARNING]
> All timeouts must be **enforced server-side** against a stored timestamp. Relying on the
> cookie's `Max-Age`/`Expires` is not a control — the client can ignore or edit it. The
> server must reject requests whose server-side session has idled or aged out.

## Logout and Server-Side Invalidation

Logout must **destroy the session on the server**, not merely clear the cookie in the
browser.

**Vulnerable pattern:** logout only sends `Set-Cookie: SESSIONID=; Max-Age=0` (or the app
just deletes the client cookie). The server-side session record still exists and remains
valid — anyone who captured the ID can keep using it.

**Correct defense:**
1. **Invalidate the session record server-side** (delete/expire the store entry) so the ID
   is dead everywhere.
2. **Clear the cookie** client-side (`Set-Cookie: __Host-SESSIONID=; Max-Age=0; Path=/;
   Secure; HttpOnly`).
3. Regenerate/rotate on the next login.

For **stateless tokens** there is no server record to delete, which is the crux of the
"you can't really log out a JWT" problem: you need a **server-side denylist/revocation
list** (checked on each request) or **short expiry + refresh-token rotation with reuse
detection** so a logged-out or stolen token stops working promptly. Support **global
logout** ("log out of all devices") by invalidating all of a user's sessions/tokens
server-side.

> [!KEY-TAKEAWAY]
> Logout = **server-side invalidation** + clearing the client cookie. Clearing the cookie
> alone is a common, serious bug: the credential still works if it was ever captured.

## Concurrent Sessions and Session Fixation Cousins

Applications must decide their **concurrent session** policy: does one user get many
simultaneous sessions (multiple devices/tabs), or is only one allowed?

- **Allow multiple** (typical): maintain a **per-user list of active sessions** so the user
  (and admins) can view devices and **revoke individual sessions** — essential for "sign
  out other devices" and for evicting a suspected hijacker.
- **Restrict to one** (high-security): starting a new session invalidates the previous —
  simpler blast radius, but hostile to legitimate multi-device use.

Either way, keeping a server-side registry of active sessions is what enables **selective
and global invalidation**, concurrent-login detection, and anomaly alerting — none of
which is possible with purely stateless self-contained tokens unless you add server state
back in.

> [!TIP]
> The ability to *list and revoke* a user's active sessions is a hallmark of a mature
> session design and a frequent interview follow-up. It is essentially free with
> server-side sessions and requires extra machinery (denylist / session index) with
> stateless tokens.

## Cookies vs localStorage for Tokens (XSS Exposure)

A recurring design question: for a SPA/API, store the session token in a **cookie** or in
**`localStorage`/`sessionStorage`**?

| | **Cookie (HttpOnly, Secure, SameSite)** | **localStorage / sessionStorage** |
|---|---|---|
| Readable by JS | **No** (`HttpOnly`) | **Yes** — any script on the page can read it |
| XSS exfiltration | Blocked (can't read the cookie) | **One XSS discloses every token** |
| Sent automatically | Yes (subject to `SameSite`) | No — app must attach `Authorization` header |
| CSRF exposure | Yes → need `SameSite` + CSRF token | **No** (not auto-sent), so no CSRF |
| Best practice | **Preferred** for session credentials | Discouraged for auth tokens |

The security trade-off is **XSS vs CSRF**. Cookies are auto-sent, so they are exposed to
CSRF (mitigated by `SameSite` + anti-CSRF tokens) but protected from XSS reads via
`HttpOnly`. `localStorage` is immune to CSRF (nothing is auto-attached) but fully exposed
to XSS — a single injected script reads and exfiltrates the token.

**OWASP's position:** do **not** store session identifiers/tokens in `localStorage` or
`sessionStorage`; use `HttpOnly; Secure; SameSite` cookies, because a lone XSS otherwise
discloses every token. XSS is generally more prevalent and higher-impact than CSRF, and
`HttpOnly` is a hard barrier an attacker cannot script around, whereas CSRF has robust,
well-understood token defenses.

> [!INTERVIEW]
> If asked "cookie or localStorage for the JWT?", the strong answer is: **HttpOnly cookie
> for the credential, because it removes the token from JavaScript's reach — the biggest
> risk (XSS) is neutralized. Handle the resulting CSRF exposure with `SameSite=Strict/Lax`
> plus anti-CSRF tokens.** Choosing `localStorage` trades a solvable CSRF problem for an
> unsolvable "every XSS = total token compromise" problem.

---

> [!TIP]
> **Signpost:** everything above is table-stakes an interviewer expects any web engineer to
> know cold. The sections below — 6265bis limits, schemeful same-site, cookie tossing,
> session puzzling, DBSC/DPoP, CHIPS, BFF, the revocation toolkit, federated logout — are
> the **senior differentiators** an interviewer probes to separate levels. Where CSRF detail
> (SameSite, double-submit) overlaps here, the dedicated CSRF topic is authoritative; it is
> repeated only where it bears on cookie/session design.

## RFC 6265bis: Modern Cookie Rules and Limits

RFC 6265 (2011) is being superseded by **RFC 6265bis** (draft-ietf-httpbis-rfc6265bis),
which codifies the behavior modern browsers already enforce. The concrete changes a senior
candidate should be able to enumerate:

1. **`SameSite=Lax` is the default** when no `SameSite` attribute is present (§ SameSite).
2. **`SameSite=None` MUST be `Secure`** — a `None` cookie without `Secure` is **rejected**.
3. **Cookie name prefixes `__Host-` and `__Secure-` are formalized** and browser-enforced.
4. **Size cap: a single `Set-Cookie` is limited to 4096 bytes** (name + value + attributes,
   combined). Oversized cookies are rejected. Per-domain limits also apply (browsers commonly
   allow ~50 cookies per domain and cap total cookie bytes per domain).
5. **Schemeful same-site** — `http://` and `https://` versions of the same registrable domain
   are treated as **cross-site** for `SameSite` purposes.
6. **`Max-Age`/`Expires` are capped at 400 days** — Chrome enforces this upper bound on cookie
   lifetime regardless of a larger requested value.
7. **`Domain` cannot be a public suffix** — you cannot set a cookie `Domain=.com` or
   `Domain=.co.uk` (Public Suffix List / PSL enforcement), which prevents "supercookies."

> [!KEY-TAKEAWAY]
> The trend across 6265bis is **secure-by-default and browser-enforced**: Lax by default,
> `None` implies `Secure`, prefixes are honored, and hard limits (4096 bytes, 400 days, PSL,
> schemeful) close historical downgrade and tracking gaps that attributes alone couldn't.

## Schemeful Same-Site and the Lax POST Grace Window

Two subtle browser behaviors trip up CSRF reasoning:

- **Schemeful same-site.** Modern browsers treat `http://example.com` and
  `https://example.com` as **cross-site** for `SameSite`. This closes a downgrade gap: an
  active network attacker who can force traffic to the plaintext `http://` origin previously
  counted as "same-site" and could ride `Lax`/`Strict` cookies. With schemeful same-site the
  cross-scheme request is cross-site, so those cookies are withheld. (This is also why a
  legitimate cross-scheme flow can suddenly "break" after a browser update — a common
  "what changed recently?" probe.)
- **The Lax+POST two-minute intervention.** A cookie set with **no** `SameSite` attribute is
  treated as `Lax`, **but** Chrome added a compatibility carve-out: for the **first 2 minutes**
  after such a cookie is set, it is **still sent on top-level cross-site POST** navigations.
  This grace window preserves some legacy POST-based SSO/redirect flows — but it means a
  **freshly set default-`Lax` cookie is briefly CSRF-exposed on cross-site POST**.

> [!WARNING]
> Relying on the **default** is not the same as **explicitly** setting `SameSite=Lax`. A
> default-`Lax` cookie inherits the 2-minute Lax+POST window; an explicitly declared
> `SameSite=Lax` (or `Strict`) cookie does not get that carve-out. Always set `SameSite`
> explicitly and keep an anti-CSRF token for state-changing POSTs.

## Cookie Tossing and Shadowing

**Cookie tossing** (a.k.a. cookie shadowing / cookie injection) exploits a structural
weakness of RFC 6265: the `Cookie` request header carries **only name=value pairs, with no
attribute, origin, or scope information**. The server cannot tell which host set a cookie,
whether it was `Secure`, or what `Domain`/`Path` it had.

**Mechanism:**
1. An attacker who controls a sibling context — a compromised or attacker-registered
   subdomain (`evil.example.com`), or a MITM on a plaintext `http://example.com` sibling
   origin — sets a cookie with the **same name** as the real one, scoped `Domain=.example.com`.
2. The browser now holds **two cookies with the same name**. On requests to the app it sends
   **both** in the `Cookie` header: `Cookie: sess=REAL; sess=ATTACKER`.
3. RFC 6265 sort order for the `Cookie` header puts cookies with a **longer `Path` first**,
   then **earlier creation time**. By setting a more specific `Path` (e.g. `Path=/app/login`),
   the attacker's cookie sorts **ahead** of the real one, so a naive server that reads "the
   first `sess`" reads the **attacker's** value — the real cookie is *shadowed*.

Concretely, two same-name cookies with different paths:

| Cookie | Path | Set by | Path length → sort |
|---|---|---|---|
| `sess=ATTACKER` | `/app/login` | `evil.example.com`, `Domain=.example.com` | 10 chars → **first** |
| `sess=REAL` | `/` | `app.example.com` (the real app) | 1 char → second |

The browser emits them longest-path-first:

```
Cookie: sess=ATTACKER; sess=REAL
        └── server that reads "the first sess" gets the ATTACKER value
```

**Impact:** breaks the **naive double-submit CSRF** pattern (attacker overwrites the CSRF
cookie so it matches their forged token), can force **session fixation** (attacker's known ID
shadows the victim's), and generally lets a weaker sibling origin influence the main app.

**Defense:** the **`__Host-` prefix** is the direct fix — a `__Host-` cookie is host-locked
(no `Domain`, `Path=/`, `Secure`) so a subdomain **cannot set or shadow it**. Also validate the
session server-side (not "trust the first cookie value") and never grant trust based on a
cookie a sibling origin could write.

## Session Puzzling and Variable Overloading

**Session puzzling** (session variable overloading) is a logic/authorization flaw that lives in
**server-side session state**, not in the cookie attributes. It occurs when the application
**reuses the same session attribute for two different purposes** across different flows.

**Classic example:** a password-reset flow stores the target account in `session.userId` so
later steps know whose password to change. The authenticated area *also* reads `session.userId`
to decide who is logged in. An attacker who walks the password-reset flow far enough to populate
`session.userId` — **without ever authenticating** — can then hit an authenticated endpoint,
which trusts the now-present `session.userId` and treats them as that user. The attacker has
**populated an auth-granting session variable out of sequence**.

**Defense:**
- **Namespace session variables per flow** (`resetFlow.targetUserId` ≠ `auth.userId`); never
  let a pre-auth or side-flow variable feed an authorization decision.
- **Do not trust a partially populated session.** An authenticated area must require an explicit
  "authenticated" marker set *only* by successful login, not infer identity from whatever
  happens to be in the session bag.
- **Regenerate the session and reset flow state on privilege transitions** (ties back to
  fixation defense). When you regenerate the ID at login, be careful **not to carry over
  attacker-influenced pre-auth data**.

## Cookie Bomb and Header Overflow DoS

A **cookie bomb** (cookie jar overflow) is a **client-side denial-of-service** that turns the
victim's own browser against them. Cookies have limits (~4096 bytes per cookie, ~50 cookies per
domain, ~180 KB total per domain in some browsers).

**Mechanism:** an attacker — via **XSS**, a **subdomain** they control that sets
`Domain=.example.com` cookies, or a **shared-hosting/CDN neighbor** on the same registrable
domain — plants many large cookies scoped to the target domain. The victim's browser then
attaches a **huge `Cookie` header** to every request. The server (or an upstream proxy/CDN)
responds **`400 Bad Request`** or **`431 Request Header Fields Too Large`**, so the victim
**can no longer load the site** until they manually clear cookies. The attacker never touches the
server — they weaponize the browser's automatic cookie-sending.

**Why it matters:** it ties abstract cookie limits to a concrete **availability** attack, and it
underpins **cache-poisoned DoS** (a poisoned oversized response is cached and served to others).
Defenses: `__Host-` (blocks subdomain-set cookies), isolate untrusted content on a separate
registrable domain (not a subdomain), fix XSS, and keep cookie footprint small.

## Sender-Constrained Sessions: DBSC, DPoP, mTLS

Every cookie attribute in this topic protects against **guessing or interception** — none stops
an attacker who has **already obtained a valid, live session credential**. The #1 real-world
session threat today is exactly that: **infostealer malware** (Lumma, RedLine, Raccoon, etc.)
that runs on the victim's own machine and **exfiltrates session cookies directly from the browser
profile**, then replays them from attacker infrastructure. `HttpOnly`, `Secure`, and `SameSite`
are all set and all **irrelevant** — the malware reads the cookie store on disk, bypassing the
JavaScript sandbox entirely. This is the mechanism behind widely documented **"pass-the-cookie"**
attacks that **bypass MFA** against O365/Okta (2023–2025): the stolen live session already
represents a post-MFA state, so no second factor is re-prompted.

The strategic answer is to make a stolen credential **useless off the original device** by
**binding the session to a key the attacker cannot exfiltrate** (sender-constrained /
proof-of-possession sessions):

- **DBSC — Device Bound Session Credentials** (shipping in Chrome, 2025). The browser generates a
  key pair whose private key is stored in a **TPM/hardware security module** and is
  **non-exportable**. Cookies are issued short-lived; the browser silently refreshes them only by
  a **challenge–response signed with the hardware key**. Registration/refresh headers:
  `Sec-Session-Registration` and a `Sec-Secure-Session` challenge → server returns a challenge →
  the browser returns a signed **JWT proof**. A cookie copied to another machine can't be
  refreshed there (no private key), so it dies at the next short interval.
- **DPoP (RFC 9449)** — "Demonstration of Proof-of-Possession." The client holds a private key and
  attaches a per-request signed **`DPoP` JWT** proving possession; the access token is bound to the
  key's thumbprint (`cnf.jkt`). A stolen bearer token can't be used without the private key.
- **mTLS-bound tokens (RFC 8705)** — the token is bound to the client's **TLS client certificate**
  (certificate-bound access tokens); a stolen token replayed without the cert is rejected.
- **Token Binding (RFC 8471)** was the earlier attempt to bind tokens to a TLS-layer key, but it
  **failed to gain adoption and is effectively dead** — DBSC/DPoP/mTLS are its successors.

> [!INTERVIEW]
> "Infostealer malware stole a valid session cookie; `HttpOnly`/`Secure`/`SameSite` were all set.
> What actually stops replay?" **Nothing attribute-based** — cookie hygiene ≠ theft prevention.
> The real answers are **sender-constrained sessions (DBSC / DPoP / mTLS)** plus short renewal
> timeouts and anomaly detection (impossible-travel, new-device). A modern session token should
> be **bound to something the attacker can't copy**.

## Partitioned Cookies (CHIPS)

As browsers phase out third-party cookies, **CHIPS — Cookies Having Independent Partitioned
State** provides an opt-in for embeds that legitimately need per-embed state (e.g. a support
chat widget) without enabling cross-site tracking.

`Set-Cookie: __Host-widget=abc; Secure; Path=/; SameSite=None; Partitioned`

The **`Partitioned`** attribute **double-keys** the cookie by **(top-level site + cookie host)**
instead of only the cookie host. Consequences:

- The same third-party embed on `siteA.com` and `siteB.com` gets **separate, isolated cookie
  jars** — it cannot correlate the user across the two top-level sites, so it **can't be used for
  cross-site tracking**.
- Partitioned cookies must be `Secure` and are typically used with `SameSite=None` for the
  cross-site embed context; `__Host-` is recommended for scoping.

> [!TIP]
> The senior framing: after third-party-cookie deprecation, **`Partitioned`/CHIPS is how a
> cross-site embed keeps its own state** while being structurally incapable of shared tracking —
> state is isolated per top-level site.

## Stateless Token Revocation Toolkit

Deepening the "you can't log out a JWT" problem — the concrete toolkit for making stateless
tokens revocable, from least to most stateful:

- **Short access-token TTL (5–15 min) + long-lived refresh token.** The access token is stateless
  and never checked against a store; you only revoke by refusing to mint new ones. Worst-case
  exposure of a leaked/logged-out access token is one TTL window.
- **Refresh-token rotation with reuse detection.** Every refresh issues a **new** refresh token
  and invalidates the old one. If an **already-used (old) refresh token is presented again**, that
  signals theft — the server **revokes the entire token family/lineage** (OAuth 2.1 / RFC 6749-bis
  guidance). This detects a stolen refresh token even though tokens are opaque bearer credentials.
- **`jti` denylist.** Give each token a unique `jti` and maintain a server-side denylist of revoked
  IDs, checked per request. Effective but **reintroduces shared state** — you're partway back to a
  server-side session.
- **Token/session versioning (`token_version` / `sessionEpoch`).** Store a per-user integer; embed
  it as a claim. On logout / password change / "log out everywhere," **bump the integer**, which
  **invalidates all outstanding tokens at once** with a single cheap per-user lookup — far cheaper
  than a per-token denylist.
- **Reference (opaque) tokens + introspection** are the *hybrid* extreme: the token is just a
  handle and the resource server calls an introspection endpoint — fully revocable, but you've
  traded away statelessness.

> [!KEY-TAKEAWAY]
> Distinguish **stateless-but-not-revocable** (plain JWT) from **hybrid** (denylist / versioning /
> introspection). "JWT logout with 15-minute expiry — is the token dead the instant I click
> logout?" **No** — the access token still validates for up to its remaining TTL unless you
> denylist its `jti` or bump `token_version`; typically only the **refresh** token is revoked.

## Re-Authentication and Step-Up Authentication

A long-lived session should not silently authorize the **most sensitive** actions. Two related
controls, grounded in **NIST SP 800-63B §7.2** and OWASP:

- **Periodic reauthentication** by Authenticator Assurance Level:
  - **AAL2:** reauthenticate at least every **12 hours** of use, **or** after **30 minutes** of
    inactivity — whichever comes first.
  - **AAL3:** every **12 hours**, **or** after **15 minutes** of inactivity.
- **Step-up authentication** for high-value operations even *mid-session*: require a **fresh**
  factor (password re-entry, MFA, an OIDC `max_age=0`/re-`prompt`, or a higher `acr`) before
  **password change, email/phone change, adding MFA, payments, or admin actions**. This defeats an
  attacker riding an already-open session and limits blast radius if a session is hijacked.

Regenerate the session ID on a successful step-up (a privilege elevation, same rationale as
regenerating at login) and record the time of the last strong authentication so you can enforce a
`max_age` on sensitive endpoints.

## Persistent Remember-Me Tokens

"Remember me" deliberately survives browser close, so it is a **separate long-lived credential**,
not the session ID — and it must **not** defeat the **absolute session timeout** (the absolute
timeout still forces re-auth; remember-me only lets that re-auth be silent/streamlined, and even
then sensitive actions should step up).

The safe design is the **selector + validator** pattern:

- The token is `selector:validator`. The **selector** is a lookup key (indexed, stored in
  plaintext); the **validator** is a high-entropy secret stored **only as a hash** server-side.
- On use, look up by selector, then **constant-time compare** the hash of the presented validator.
- The token is **single-use / rotated**: each successful use issues a fresh validator (and often
  selector). If a token is presented whose selector exists but whose validator **doesn't match**,
  that indicates theft/cloning → **invalidate the whole remember-me series** and alert.

**Worked example — tracing one remember-me use.** Suppose the cookie is:

```
remember_me = 3f2a9d10 : 9c8b7a6f5e4d3c2b     ← selector : validator
```

The server row stores the selector in **plaintext** (it's just a lookup key, indexed for a
fast `WHERE selector = ?`) and the validator only as a **hash**:

```
{ selector: "3f2a9d10", validator_hash: sha256("9c8b7a6f5e4d3c2b"), user_id: 42, series }
```

On presentation the server:
1. Looks up the row by selector `3f2a9d10` (fast, indexed). No row → reject silently.
2. Computes `sha256("9c8b7a6f5e4d3c2b")` from the *presented* validator and **constant-time
   compares** it to the stored `validator_hash`. (Constant-time so an attacker can't time
   the comparison to learn the validator byte-by-byte; and hashed so a leaked DB dump can't
   be replayed — the same reason session IDs are stored hashed.)
3. **Match** → authenticate as user 42, then **rotate**: issue a new validator (and often a
   new selector), update the row, and re-set the cookie. The old validator is now dead.

Now the **theft-detection branch**. The attacker steals the cookie and uses it first: the
server rotates the validator to `V2`, so the attacker's stolen copy is stale. When the
*victim* later returns, they present the old validator — the selector `3f2a9d10` **exists**
but `sha256(old) ≠ validator_hash` (which now holds `sha256(V2)`). Selector-hit +
validator-mismatch is the tell-tale of a cloned token → **invalidate the entire series for
user 42 and alert**, forcing a fresh login. Splitting selector from validator is exactly
what makes this cheap: you get an O(1) indexed lookup *and* a constant-time secret compare
without leaking whether the selector alone was valid.

This avoids the classic mistakes: storing a raw persistent token (a store leak = instant account
takeover) or reusing the session ID as a long-lived disk cookie.

## Federated Logout and Clearing Client State

Server-side invalidation of the local session is necessary but, in **SSO/federated** setups, not
sufficient — "I logged out of the app but the IdP still has me logged in (and any relying party can
silently re-log me in)" is a classic gap. The **OpenID Connect** logout mechanisms:

- **RP-Initiated Logout** — the relying party redirects the user to the IdP's
  `end_session_endpoint` (with `id_token_hint`, `post_logout_redirect_uri`) to end the **IdP**
  session, not just the local one.
- **Front-Channel Logout** — the IdP loads hidden iframes to each RP's logout URL to clear RP
  sessions via the browser.
- **Back-Channel Logout** — the IdP sends a server-to-server POST of a signed **`logout_token`**
  (containing `sub`/`sid`) directly to each RP's back-channel logout endpoint. This is the robust
  option: it works even if the browser is closed and doesn't depend on third-party-cookie/iframe
  behavior. The task's "back-channel invalidation" refers to exactly this.

Additionally:

- **`Clear-Site-Data` response header** — `Clear-Site-Data: "cookies", "storage"` tells the browser
  to wipe cookies, `localStorage`/`sessionStorage`, and caches for the origin on logout, cleaning up
  client-side state the server can't reach.
- **Invalidate all sessions on password reset** (global logout), and on any credential change.
- **Logout must be CSRF-protected.** A `GET`/no-token logout endpoint is itself **CSRF-able** — an
  attacker can force-log-out the victim (a denial/annoyance, and it can be chained with login-CSRF).
  Make logout a **POST** with an anti-CSRF token.

## Backend-for-Frontend (BFF) Pattern

For SPAs, the modern (2025) answer to "cookie vs `localStorage` for the token" is often
**"neither — the browser holds no token at all."** In the **Backend-for-Frontend (BFF)** pattern:

- A small **server component** owned by the frontend performs the OAuth flow, **holds the access
  and refresh tokens server-side**, and exposes only an **`HttpOnly`, `Secure`, `SameSite`
  first-party session cookie** to the SPA.
- The SPA calls its own BFF (same origin); the BFF attaches the real tokens when it proxies to the
  resource/API. **No OAuth token ever reaches JavaScript**, so an XSS cannot exfiltrate a bearer
  token — it can at most ride the existing session, which is far easier to bound (short-lived,
  server-revocable) and to sender-constrain.

> [!INTERVIEW]
> "Cookies vs `localStorage` — and now a third answer." Beyond the XSS/CSRF trade-off, the mature
> answer is the **BFF pattern**: keep tokens on a first-party backend behind an `HttpOnly` session
> cookie so the SPA is token-less. It converts an unbounded "every XSS = token theft" problem into
> a bounded server-side session you fully control.

## Signed Double-Submit Cookies and CSRF Token Binding

The **naive double-submit cookie** CSRF defense (send a random value in both a cookie and a request
header/field, and compare them server-side) is attractive because it is **stateless** — but it is
**broken by cookie tossing**. An attacker who can write a cookie on the target domain (compromised
subdomain, sibling `http://` origin) **overwrites the CSRF cookie with a value they know**, then
submits a matching token in their forged request — the naive equality check passes.

The correct forms:

- **Signed / HMAC'd double-submit token** — the token is `HMAC(session_id, secret)` (bound to the
  authenticated session) rather than a bare random value. An attacker who can toss a CSRF cookie
  still cannot forge a token bound to the **victim's** session, and the server verifies the HMAC.
- **`__Host-` prefixed CSRF cookie** — host-locks the CSRF cookie so a subdomain **cannot toss/
  overwrite** it in the first place.
- For stateful apps, the **synchronizer token pattern** (token stored server-side in the session and
  compared) sidesteps the cookie-writability problem entirely.

> [!WARNING]
> "Our double-submit CSRF cookie is bypassed in prod — why?" The usual answer is **cookie tossing
> from a compromised/sibling subdomain overwriting the CSRF cookie**. Fix with a **`__Host-`
> prefixed** CSRF cookie **and/or an HMAC-signed token bound to the session** — not a plain random
> value the attacker can also set.

## Common follow-up questions

- "How much entropy does a session ID need and where does it come from?" ≥64 bits
  (128-bit is typical/recommended) from a CSPRNG — never `Math.random()` or a
  time/counter-seeded PRNG.
- "Difference between session fixation and session hijacking?" Fixation = attacker
  plants a known ID before login and the app fails to regenerate it; hijacking = attacker
  steals a valid active ID. Fix fixation by regenerating the ID at auth; fix hijacking by
  protecting the ID (HttpOnly, Secure, HTTPS, no URLs, short timeouts).
- "What does each cookie attribute defend against?" `HttpOnly` → XSS token theft;
  `Secure` → network sniffing/downgrade; `SameSite` → CSRF; `__Host-` prefix →
  cookie-tossing/overwrite from subdomains + enforces host-locking.
- "Is `SameSite` enough to stop CSRF?" No — `Lax` still allows top-level cross-site
  GETs, legacy browsers may not enforce it, and it doesn't cover same-site attacks. Keep
  anti-CSRF tokens for state-changing requests.
- "How do you log someone out of a stateless JWT session?" You can't with the token
  alone — add short expiry + refresh-token rotation with reuse detection, or a server-side
  denylist checked per request. Support global logout by invalidating all of a user's
  sessions server-side.
- "Why not store the token in localStorage?" It's readable by any JavaScript, so a
  single XSS exfiltrates it; an `HttpOnly` cookie is unreadable by script.
- "Idle vs absolute timeout?" Idle expires after inactivity (sliding, ~2–5 min high
  value / 15–30 min low risk); absolute expires a fixed time after creation (~4–8 h),
  forcing re-auth and capping a hijacked session's life. Enforce both server-side.
- "Server-side session or stateless token — which and why?" Server-side when you need
  easy revocation, forced logout, and concurrent-session control; stateless when you must
  scale without a shared store and can accept short lifetimes + a revocation mechanism.

## References

- OWASP Cheat Sheet Series — [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- OWASP Cheat Sheet Series — [Cross-Site Request Forgery (CSRF) Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- OWASP Cheat Sheet Series — [HTML5 Security / Web Storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
- OWASP ASVS — V3 Session Management verification requirements
- OWASP WSTG — Testing for Session Management (session fixation, cookie attributes, logout, timeout)
- OWASP Top 10 2021 — A07:2021 Identification and Authentication Failures
- NIST SP 800-63B — Digital Identity Guidelines (session bindings, reauthentication, session secrets ≥ 64 bits)
- RFC 6265 — HTTP State Management Mechanism (cookies)
- RFC 6265bis (draft-ietf-httpbis-rfc6265bis) — SameSite default, `None`+`Secure`, name prefixes, 4096-byte / 400-day / PSL limits, schemeful same-site
- RFC 9449 — OAuth 2.0 Demonstrating Proof-of-Possession (DPoP)
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens
- RFC 8471 — Token Binding Protocol (deprecated / effectively unused; predecessor to DBSC/DPoP)
- OAuth 2.1 / RFC 6749-bis — refresh-token rotation and reuse detection guidance
- NIST SP 800-63B §7 (session management), §7.1 (session secret ≥ 64 bits), §7.2 (reauthentication AAL2/AAL3 intervals)
- OWASP ASVS v4/v5 — V7 Session Management (formerly V3)
- OpenID Connect — RP-Initiated Logout, Front-Channel Logout 1.0, Back-Channel Logout 1.0 (`logout_token`, `sid`)
- CHIPS — Cookies Having Independent Partitioned State (`Partitioned` attribute)
- Chrome — Device Bound Session Credentials (DBSC) explainer
- W3C / MDN — [`Clear-Site-Data`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Clear-Site-Data) response header
- MDN — [Set-Cookie header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) and [SameSite cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
