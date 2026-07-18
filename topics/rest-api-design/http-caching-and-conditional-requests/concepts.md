# HTTP Caching & Conditional Requests

HTTP caching lets clients, proxies, and CDNs reuse previously fetched responses
instead of re-fetching or re-computing them, cutting latency, bandwidth, and origin
load. As an API designer you are writing a **contract** in headers that tells every
cache on the path how long a representation is fresh, when it must be revalidated, and
which requests may share a cached copy. Conditional requests are the flip side: they let
a client say "only send me the body if it actually changed" (efficient reads) or "only
apply my write if the resource hasn't changed underneath me" (optimistic concurrency).

The modern normative references are **RFC 9110 (HTTP Semantics)** — which defines
validators (`ETag`, `Last-Modified`) and conditional request headers — and **RFC 9111
(HTTP Caching)** — which defines `Cache-Control`, freshness, and `Vary`. RFC 9111
obsoletes RFC 7234; RFC 9110 obsoletes RFC 7231/7232. Get the RFC numbers right in an
interview: citing 7234/7232 is not wrong historically, but 9110/9111 are current.

> [!KEY-TAKEAWAY]
> There are two orthogonal mechanisms. **Freshness** (`Cache-Control: max-age`,
> `Expires`) lets a cache serve a stored response with *zero* network round-trips until
> it expires. **Validation** (`ETag`/`Last-Modified` + conditional requests) lets a cache
> or client cheaply re-check a stale (or must-revalidate) response, getting a tiny `304`
> instead of the full body. Good APIs use both.

## Why HTTP caching matters and the freshness vs validation model

A cache stores a response and later reuses it to satisfy a matching request. RFC 9111
splits a cached response's life into two phases:

1. **Fresh** — the response is younger than its *freshness lifetime*. A cache MAY serve it
   directly with no contact with the origin. This is the big win: zero round-trips.
2. **Stale** — the freshness lifetime has elapsed. The cache generally must **revalidate**
   with the origin before reuse (unless allowed to serve stale, see extensions below).

Revalidation uses a **conditional request**: the cache sends the validator it stored and
the origin replies `304 Not Modified` (reuse the stored body, refresh its freshness) or
`200 OK` with a new body. A `304` carries no message body, so it is cheap even for large
representations.

```
Fresh?  ── yes ──►  serve from cache (0 RTT)
   │ no
   ▼
Revalidate (conditional GET) ── 304 ──►  serve stored body, reset freshness
                               └─ 200 ──►  store & serve new body
```

> [!INTERVIEW]
> A classic question: "What's the difference between an expired cache entry and a cache
> miss?" A miss has nothing stored, so it's a full fetch. An expired (stale) entry still
> has the body and a validator, so it can often be refreshed with a cheap `304` — much
> cheaper than a miss. This is why sending an `ETag` even with `max-age=0` is valuable.

## Cache-Control response directives

`Cache-Control` (RFC 9111 §5.2) is the primary caching contract; it overrides the legacy
`Expires` header when both are present. Response directives defined by RFC 9111:

| Directive | Meaning |
|---|---|
| `max-age=N` | Fresh for N seconds (relative to response age). |
| `s-maxage=N` | Like `max-age` but only for **shared** caches (CDN/proxy); overrides `max-age` and `Expires` for them. |
| `no-cache` | MAY be stored, but MUST be revalidated with the origin before every reuse. |
| `no-store` | MUST NOT be stored anywhere, in any form. |
| `private` | Only a single-user (browser) cache may store it; shared caches MUST NOT. |
| `public` | Explicitly cacheable even when it normally wouldn't be (e.g. authenticated). |
| `must-revalidate` | Once stale, MUST revalidate before reuse; MUST NOT serve stale on error. |
| `proxy-revalidate` | Like `must-revalidate` but only for shared caches. |
| `no-transform` | Intermediaries MUST NOT modify the payload (e.g. recompress images). |
| `must-understand` | Cache only if it understands the status code's caching requirements (paired with `no-store` as a fallback). |

Note: `immutable` and `stale-while-revalidate`/`stale-if-error` are **extensions** (the
latter from RFC 5861), not part of RFC 9111 itself.

```
Cache-Control: public, max-age=300, s-maxage=600, stale-while-revalidate=60
Cache-Control: private, no-cache
Cache-Control: no-store
```

> [!TIP]
> Directives combine. `public, max-age=0, must-revalidate` means "any cache may store
> this, but treat it as immediately stale and always revalidate before serving" — a
> common pattern for API responses that change unpredictably but benefit from `304`s.

## max-age, s-maxage, and shared vs private caches

Two kinds of caches sit on the path:

- **Private cache** — dedicated to one user (a browser's HTTP cache, a mobile app). May
  store `private` responses.
- **Shared cache** — serves many users (a CDN, a reverse proxy like Varnish, an API
  gateway cache). MUST NOT store `private` responses.

`max-age` applies to all caches; `s-maxage` overrides it **for shared caches only**. This
lets you keep a long CDN TTL while browsers hold a shorter copy, or vice versa:

```
Cache-Control: max-age=60, s-maxage=3600
```
Browsers treat it as fresh for 60s; the CDN keeps it fresh for an hour and absorbs the
traffic. Because `s-maxage` also implies the response is cacheable by shared caches, it
can make an otherwise-private-looking response CDN-cacheable — be careful with
authenticated data.

> [!WARNING]
> Never cache per-user or authenticated data in a shared cache without thought. If a
> response depends on `Authorization`, either mark it `private`/`no-store` or ensure the
> cache key varies correctly (see `Vary`). Serving user A's profile to user B from a CDN
> is a real and common security incident.

## no-cache vs no-store vs must-revalidate

These three are the most-confused directives and a frequent interview trap.

| Directive | Can it be stored? | When is it reused? |
|---|---|---|
| `no-store` | **No** — never written to any cache. | Never; always a full fetch. |
| `no-cache` | **Yes** — stored normally. | Only after a successful revalidation with the origin, on **every** use. |
| `must-revalidate` | Yes. | Freely while fresh; once **stale** it MUST be revalidated (and MUST NOT serve stale on error). |

- Use **`no-store`** for genuinely sensitive data that must never touch disk/proxy (e.g.
  a one-time token, a payment page). It is the strongest.
- Use **`no-cache`** when you want the caching *machinery* (stored body + validator) but
  correctness requires an origin check each time. Combined with an `ETag`, most checks
  come back `304`, so you get freshness guarantees at `304` cost.
- Use **`must-revalidate`** to forbid the "serve stale while disconnected" grace behavior
  once the entry expires.

> [!WARNING]
> `no-cache` does **not** mean "do not cache." That is `no-store`. `no-cache` means "cache
> but revalidate before use." This naming mistake causes real bugs where people send
> `no-cache` expecting no storage and are surprised proxies keep copies.

## Legacy Expires and Pragma

Before `Cache-Control` (HTTP/1.0), freshness was expressed with **`Expires`**, an absolute
HTTP-date, and **`Pragma: no-cache`**, a request directive.

```
Expires: Wed, 21 Oct 2026 07:28:00 GMT
```

Rules and gotchas:

- If both `Cache-Control: max-age` and `Expires` are present, **`max-age` wins** for caches
  that understand it. Send both only if you need HTTP/1.0 fallback.
- `Expires` relies on the client and server clocks being roughly in sync; `max-age` is a
  relative offset and avoids clock-skew problems, so it is preferred.
- An `Expires` value in the past (or a malformed/`0` value) means "already stale" — a
  common way to force revalidation on old caches.
- `Pragma: no-cache` is a **request** header from HTTP/1.0; modern specs treat it as a
  hint and it has no defined response semantics. Prefer `Cache-Control`.

## ETag: strong and weak validators

An **`ETag`** (entity tag) is an opaque token the origin assigns to a specific
representation of a resource. When the representation changes, the `ETag` changes. It is
the preferred validator because it is exact — it does not depend on timestamps.

```
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"      ← strong
ETag: W/"xyzzy"                                        ← weak (W/ prefix)
```

- **Strong validator** — byte-for-byte identical. Two responses share a strong `ETag`
  only if their bodies are identical octet-for-octet. Required for **range requests** and
  safe for any conditional.
- **Weak validator** (`W/` prefix) — "semantically equivalent." Two representations may be
  weakly equal despite trivial differences (e.g. a timestamp comment, different
  whitespace, gzip vs identity encoding). Weak `ETag`s MUST NOT be used with `If-Match` or
  range requests.

Comparison rules (RFC 9110 §8.8.3.2): **strong comparison** (byte-identical, used by
`If-Match`/ranges) requires both tags to be strong and equal; **weak comparison** (used by
`If-None-Match`) treats `W/"x"` and `"x"` as matching.

> [!TIP]
> For APIs, a common, cheap strong `ETag` is a hash of the serialized response body, or a
> version/revision counter of the resource. A weak `ETag` is fine when equivalent-but-not-
> identical bodies (e.g. reordered JSON keys, differing whitespace) should still count as
> "unchanged."

## Last-Modified and date-based validation

**`Last-Modified`** carries the time the representation last changed, as an HTTP-date. It
is a weaker validator than `ETag` and is used with `If-Modified-Since`/`If-Unmodified-Since`.

```
Last-Modified: Tue, 15 Jul 2026 12:45:26 GMT
```

Limitations that make `ETag` preferred:

- **One-second resolution.** Two changes within the same second are indistinguishable, so
  a client can serve a stale body. `ETag` has no such limit.
- **Clock trust.** Relies on the origin's clock and correct storage of mtimes.
- Cannot express "semantically equal but different bytes."

If a response has **both** `ETag` and `Last-Modified`, a validating cache SHOULD send both
in the conditional request; the `ETag` (`If-None-Match`) takes precedence when both are
evaluated. Sending `Last-Modified` alongside `ETag` helps older/simple caches that only
understand dates.

## Conditional GET: If-None-Match / If-Modified-Since and 304

A **conditional GET** asks the origin to return the body only if the client's cached copy
is out of date. Two request headers drive it:

- **`If-None-Match`** — carries one or more `ETag`s the client already holds (uses **weak**
  comparison). If none match the current representation, the server returns the new `200`;
  if one matches, it returns **`304 Not Modified`** with no body.
- **`If-Modified-Since`** — carries a date; the server returns `200` only if the resource
  changed after that date, else `304`. Used as a fallback when there's no `ETag`.

```http
GET /articles/42 HTTP/1.1
Host: api.example.com
If-None-Match: "v23"
If-Modified-Since: Tue, 15 Jul 2026 12:45:26 GMT
```
```http
HTTP/1.1 304 Not Modified
ETag: "v23"
Cache-Control: max-age=60
Date: Sat, 19 Jul 2026 09:00:00 GMT
```

Key rules:

- If **both** `If-None-Match` and `If-Modified-Since` are present, `If-None-Match` is
  evaluated and `If-Modified-Since` is **ignored** (RFC 9110 §13.2.2).
- `If-None-Match: *` matches if *any* current representation exists — used to make a
  cache serve only if it has something.
- A `304` MUST NOT include a body and SHOULD update the stored response's freshness
  headers (`Cache-Control`, `Date`, `ETag`, `Expires`, `Vary`).
- Conditional GET saves **bandwidth** (no body) but not the origin round-trip; freshness
  (`max-age`) is what saves the round-trip.

## Optimistic concurrency: If-Match / If-Unmodified-Since and 412

On **writes** (PUT/PATCH/DELETE), the same validators enable optimistic concurrency
control — preventing the "lost update" problem where two clients overwrite each other.

- **`If-Match`** — apply the write only if the current `ETag` matches (uses **strong**
  comparison). If it doesn't, the resource changed since the client read it → return
  **`412 Precondition Failed`**.
- **`If-Unmodified-Since`** — apply only if the resource hasn't changed since the given
  date; else `412`.

```http
PUT /articles/42 HTTP/1.1
If-Match: "v23"
Content-Type: application/json

{ "title": "Updated title" }
```
```http
HTTP/1.1 412 Precondition Failed
```
The client re-GETs, sees the newer `ETag`, merges, and retries. This is the standard
"read-modify-write with a version check" pattern over HTTP.

- **`If-Match: *`** means "the resource must already exist" — useful to make a PUT behave
  like update-only (fail if absent).
- **`If-None-Match: *`** on a write means "only create if it does **not** exist" — the
  standard way to make a PUT a safe *create*, returning `412` if the resource already
  exists (prevents accidental overwrite / handles create races).

| Header | Direction | Comparison | Success | Failure |
|---|---|---|---|---|
| `If-None-Match` | read (GET) | weak | `200` new body | `304` (unchanged) |
| `If-Modified-Since` | read (GET) | date | `200` | `304` |
| `If-Match` | write | strong | apply write | `412` |
| `If-Unmodified-Since` | write | date | apply write | `412` |

> [!INTERVIEW]
> "How do you prevent lost updates in a REST API?" Answer: expose an `ETag` on GET,
> require `If-Match` on PUT/PATCH/DELETE, and return `412 Precondition Failed` on mismatch
> so the client refetches and retries. This is stateless optimistic concurrency — no
> server-side locks. Contrast with `428 Precondition Required` (RFC 6585), which a server
> can use to *force* clients to send a precondition.

## The Vary header and the cache key

By default a cache keys stored responses on the request **method + URI**. But if the
response body depends on request headers (content negotiation, compression, language),
serving the wrong variant is a bug. **`Vary`** lists the request headers that must also
match for a cached response to be reused.

```
Vary: Accept, Accept-Encoding, Accept-Language
```

This tells caches: only reuse this response for a later request whose `Accept`,
`Accept-Encoding`, and `Accept-Language` match.

Gotchas:

- **`Vary: *`** means the response is effectively uncacheable by shared caches (every
  request is treated as unique).
- **Never `Vary: Cookie` or vary on `Authorization` carelessly** in a shared cache unless
  you intend per-user variants — high-cardinality headers explode the cache and destroy
  hit rates; for per-user data prefer `private`.
- Forgetting `Vary: Accept-Encoding` when you gzip is a classic bug: a proxy may serve a
  gzipped body to a client that sent `Accept-Encoding: identity`, or vice versa.
- `Authorization` requests are not stored by shared caches by default (RFC 9111 §3.5)
  unless a directive like `public` or `s-maxage` explicitly permits it.

## Freshness lifetime, Age, and expiration calculation

A cache computes whether a stored response is fresh by comparing its **age** to its
**freshness lifetime**.

- **Freshness lifetime** = `s-maxage` (shared caches) → else `max-age` → else
  `Expires - Date` → else a **heuristic** (only allowed when no explicit expiration is
  present, for heuristically-cacheable status codes; a common heuristic is ~10% of the
  time since `Last-Modified`).
- **`Age`** header — seconds the response has been sitting in caches. A cache that stores
  or forwards a response sets/updates `Age`. `current_age = Age + time since received`.
- **Response is fresh while** `current_age < freshness_lifetime`.

```
HTTP/1.1 200 OK
Date: Sat, 19 Jul 2026 09:00:00 GMT
Cache-Control: max-age=600
Age: 120
```
This response has 480s of freshness left at a downstream cache.

> [!WARNING]
> Heuristic freshness is a footgun for APIs. If you return `200 OK` with **no**
> `Cache-Control` and no `Expires`, a shared cache is allowed to guess a freshness
> lifetime and serve a stale body for minutes. Always send explicit caching directives on
> API responses — even `Cache-Control: no-store` or `no-cache` — so nothing is left to
> heuristics.

## CDN / shared caches and cache invalidation

Shared caches (CDNs, reverse proxies, gateway caches) sit between many clients and the
origin. Design levers:

- **TTL split with `s-maxage`** — long edge TTL, short/zero browser TTL, so the CDN
  absorbs load but users see fresh-ish data.
- **Invalidation / purge** — CDNs expose purge APIs (by URL, by tag/surrogate key) to
  evict content on change. Prefer **event-driven purge on write** over short TTLs when
  content changes unpredictably. `Surrogate-Control` / `Surrogate-Key` (a CDN convention,
  not RFC) let the origin tag responses so many URLs can be purged together.
- **Cache busting via versioned URLs** — for immutable static assets, embed a hash/version
  in the URL (`/app.9f8c.js`) and serve `Cache-Control: max-age=31536000, immutable`. New
  content = new URL, so no invalidation is ever needed.
- **`Cache-Control: private`** keeps a shared cache from ever storing per-user data.

> [!TIP]
> Two purge strategies: **TTL-based** (accept staleness up to the TTL; simple, no
> coupling) vs **active invalidation** (purge on write; fresh immediately but couples the
> write path to the CDN and can thundering-herd the origin on popular keys). Combine with
> `stale-while-revalidate` to hide revalidation latency.

## Stale-content extensions: stale-while-revalidate and stale-if-error

Defined in **RFC 5861** (a `Cache-Control` extension, not part of RFC 9111):

- **`stale-while-revalidate=N`** — after the response goes stale, a cache MAY serve the
  stale copy for up to N seconds **while** it revalidates in the background. The user gets
  an instant (slightly stale) response; the cache refreshes asynchronously. Great for
  hiding origin latency.
- **`stale-if-error=N`** — if revalidation fails (origin down, 5xx), the cache MAY serve
  the stale copy for up to N seconds instead of erroring. A cheap resilience win.

```
Cache-Control: max-age=600, stale-while-revalidate=30, stale-if-error=86400
```

Note that `must-revalidate` **forbids** serving stale, so it conflicts with the intent of
these extensions for a given response. Support varies by CDN/browser; treat them as
progressive enhancement.

## API design best practices and gotchas

- **Cache GETs (and HEAD), not writes.** Only safe methods are cacheable by default. A
  successful response to a POST is cacheable only if it carries explicit freshness info
  and (per RFC 9111) is generally keyed conservatively — don't rely on it.
- **Always send explicit `Cache-Control`** on API responses to avoid heuristic freshness.
- **Emit `ETag` on collection and item GETs** so clients/CDNs get cheap `304`s and you can
  offer `If-Match` concurrency on writes.
- **A mutating request invalidates the cache** for the target URI. RFC 9111 says a cache
  invalidates the request-URI (and `Location`/`Content-Location`) after a non-error
  response to an unsafe method — but this only helps caches on the write path; other edge
  nodes still need TTL/purge.
- **Don't cache error responses long.** Some 4xx/5xx are heuristically cacheable
  (`404`, `410`, etc.); set short/zero TTLs deliberately.
- **Vary correctly or mark private.** Content negotiation without `Vary` serves wrong
  variants; per-user data without `private` leaks across users in shared caches.
- **`304` must echo current validators.** Return the up-to-date `ETag`/`Cache-Control` so
  the client refreshes freshness, not just the body.

> [!KEY-TAKEAWAY]
> A well-designed cacheable API endpoint typically returns:
> `Cache-Control: public, max-age=60, stale-while-revalidate=30`, an `ETag`, and a `Vary:
> Accept, Accept-Encoding` — giving fresh-serving, cheap revalidation, safe negotiation,
> and (with `If-Match`) optimistic concurrency, all statelessly.

## Cache-Control request directives

Everything above is response-side; clients also steer caches with **request** directives
(RFC 9111 §5.2.1). Interviewers ask "how does a client force a fresh copy?" — the answer is
here, not in `Cache-Control` on the response.

| Request directive | Meaning |
|---|---|
| `no-cache` | Do not reuse a stored response without successful revalidation with the origin (forces a conditional request). This is what a browser hard-reload sends. |
| `no-store` | Do not store the request or its response in any cache. |
| `max-age=N` | Client will not accept a stored response older than N seconds. `max-age=0` effectively forces revalidation. |
| `max-stale[=N]` | Client *will* accept a stale response (up to N seconds beyond expiry, or any amount if bare). Loosens freshness. |
| `min-fresh=N` | Client wants a response that stays fresh for at least N more seconds. |
| `only-if-cached` | Return a stored response or `504 Gateway Timeout`; never contact the origin. Used for offline / cache-only modes. |
| `no-transform` | Intermediaries must not transform the payload. |

> [!TIP]
> A true "give me the absolute latest" client sends `Cache-Control: no-cache` (revalidate)
> — not `no-store`. Note the asymmetry: `no-cache` on a *request* forces revalidation of
> stored copies; `no-cache` on a *response* forbids reuse without revalidation on every
> subsequent request. A misbehaving client that sends `no-store` on every request just
> destroys its own cache benefit without any correctness gain over `no-cache`.

## Qualified no-cache and private

A senior "gotcha": `no-cache` and `private` can take an **argument** naming specific header
fields (RFC 9111 §5.2.2.4 and §5.2.2.7). The qualified form is *narrower* than the bare
form — the rest of the response is still cacheable/reusable.

- `Cache-Control: private="Set-Cookie"` — a shared cache MAY store and reuse the response,
  but MUST strip the named field(s) (`Set-Cookie`) before serving to a different user. The
  body and other headers are shared normally.
- `Cache-Control: no-cache="Set-Cookie"` — the response MAY be reused *without*
  revalidation, but the named field(s) MUST be removed before a stored response is served.

This lets you make a mostly-public response cacheable while protecting a single per-user
field, instead of marking the whole thing `private`/`no-cache` and losing all sharing.
Support is uneven across intermediaries, so treat the unqualified form as the safe default
and the qualified form as an optimization when a specific CDN honors it.

## immutable and must-understand

- **`immutable`** (RFC 8246, a `Cache-Control` extension) tells caches the representation
  will **not change** during its freshness lifetime, so a client SHOULD NOT send a
  conditional revalidation even on an explicit user reload (a normal reload otherwise adds
  `Cache-Control: max-age=0`, triggering needless `304`s for hashed assets). It only matters
  *while the response is still fresh*; once stale it is revalidated normally. It is advisory
  and support is limited, so pair it with a long `max-age` and content-hashed URLs.
- **`must-understand`** (RFC 9111 §5.2.2.3) says a cache should store the response only if it
  understands the caching requirements of the response's **status code**; it is meant to be
  sent together with `no-store` so caches that do *not* understand the status code fall back
  to not storing. This future-proofs caching of new status codes.

## Range requests and If-Range

Range requests (RFC 9110 §14) let a client fetch **part** of a representation — the
mechanism behind resumable downloads and video seeking, and a classic caching-adjacent
thread. The existing note that "strong ETags are required for ranges" is *because* of this
machinery:

- A server that supports ranges advertises `Accept-Ranges: bytes`.
- The client sends `Range: bytes=0-1023` (or multiple ranges). The server replies
  **`206 Partial Content`** with a `Content-Range` header and just those bytes, or
  **`416 Range Not Satisfiable`** if the range is invalid (e.g. beyond the current length).
- **`If-Range`** solves the "resource changed mid-download" race. The client sends
  `If-Range: "etag"` (a **strong** validator, or an HTTP-date) alongside `Range`. If the
  validator still matches, the server returns the requested `206`; if it changed, the server
  ignores `Range` and returns the **full `200`** with the new body — so the client never
  stitches together bytes from two different versions.

```http
GET /video.mp4 HTTP/1.1
Range: bytes=500000-999999
If-Range: "a1b2c3-strong"
```
```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 500000-999999/4200000
ETag: "a1b2c3-strong"
Accept-Ranges: bytes
```

A **weak** ETag MUST NOT be used with `Range`/`If-Range`, because a weak validator permits
byte-level differences and range reassembly requires byte-exact identity.

## Request collapsing (coalescing)

When many clients miss on the **same** key at once, a naive shared cache forwards every
miss to the origin — a **thundering herd** / cache stampede that can melt the origin the
instant a hot key expires. **Request collapsing** (a.k.a. request coalescing) folds
concurrent identical misses into a **single** origin request; the one response fans out to
all waiters.

- It is the primary stampede defense and is orthogonal to freshness: it helps even with
  `max-age=0` or `no-cache`, because it deduplicates the *in-flight* revalidations.
- It pairs with `stale-while-revalidate` (serve stale to everyone while one revalidation
  runs) and `stale-if-error` for a complete "hot key expiry" answer that does **not** require
  lengthening staleness.
- Opt out with `Cache-Control: private` or per-request differences (e.g. varying headers),
  since collapsing only makes sense when the responses are interchangeable.

> [!INTERVIEW]
> "Your origin melts every time a hot key expires at the CDN — fix it without lengthening
> staleness." Strong answer: enable **request collapsing** so only one request revalidates,
> add **`stale-while-revalidate`** so waiters get the stale copy instantly, and
> **`stale-if-error`** so a revalidation failure doesn't cascade. TTL stays the same.

## Web cache poisoning

Caching is also an **attack surface**. Web cache poisoning (see PortSwigger's research) is
when an attacker gets a shared cache to **store a harmful response** that is then served to
other users. The root cause is a mismatch between the **cache key** (the inputs the cache
uses to identify a stored entry — typically method + URI + `Vary` headers) and the response's
actual **footprint** (all inputs that influence the response).

- **Unkeyed inputs.** If the origin reflects an attacker-controllable header that is *not*
  part of the cache key — classically `X-Forwarded-Host`, `X-Forwarded-Scheme`,
  `X-Forwarded-For`, or a custom header — into the response (e.g. building an absolute URL,
  a script `src`, or a redirect), the poisoned response is cached under a clean key and
  served to everyone.
- **"Fat GET" / cache key injection / parameter cloaking.** Discrepancies in how the cache
  vs the origin parse the URL (duplicate params, delimiters, a request body on a GET) let an
  attacker smuggle a payload that the cache normalizes away from the key but the origin still
  processes.

Defenses: do **not** reflect unkeyed, attacker-controllable inputs into cached responses;
minimize the number of headers the app trusts; and where a header genuinely affects the
response, **rewrite/normalize** it into the cache key rather than leaving it unkeyed
(excluding it from the key is not enough if the origin still uses it). Cache only what you
can key correctly.

## Web cache deception

Web cache deception (WCD) is the mirror image of poisoning: instead of *delivering* a
payload, the attacker *exposes* a victim's **private** response by getting a shared cache to
store it under a **cacheable-looking** URL. The classic trick is a crafted path like
`/account/profile.css` or `/api/me/photo.jpg`: the origin ignores the bogus suffix and
returns the victim's authenticated profile, while the cache — keying off the static-looking
extension — stores it publicly. The attacker then requests the same URL and reads the
victim's data.

- **Poisoning vs deception:** poisoning is *payload injection* into others' responses;
  deception is *exposure* of one victim's private response. Both stem from cache-key /
  content mismatches.
- **Defenses:** cache by actual `Content-Type` rather than URL extension; never cache
  responses marked `Cache-Control: private`/`no-store`; disable path confusion so
  `/x/y.css` doesn't resolve to a dynamic handler; and align cache and origin on URL
  normalization.

## CDN-Cache-Control and targeted cache directives (RFC 9213)

The doc's existing note calls `Surrogate-Control`/`Surrogate-Key` "a CDN convention, not
RFC." The modern, **standardized** answer is **RFC 9213 — Targeted HTTP Cache Control**. It
defines a family of "targeted" cache-control fields addressed to specific classes of caches,
most importantly **`CDN-Cache-Control`** (directives only CDN/shared caches obey) alongside
the browser-facing `Cache-Control`.

- **Precedence at a CDN:** a targeted field like `CDN-Cache-Control` takes priority over
  `s-maxage`, which takes priority over `max-age`/`Expires`. So you can send a short
  `Cache-Control: max-age=60` for browsers, an `s-maxage` for generic proxies, and a
  distinct `CDN-Cache-Control: max-age=86400` that only the CDN tier honors.
- Targeted fields are **not** forwarded to downstream/browser caches, so edge-only directives
  don't leak into user agents. This cleanly separates the browser contract from the edge
  contract, which `s-maxage` alone cannot fully express.

```
Cache-Control: max-age=60
CDN-Cache-Control: max-age=86400, stale-while-revalidate=600
```

## Cache-Status observability (RFC 9211)

"How do you *prove* a response came from cache and diagnose a low hit rate in prod?" The
modern, standardized answer is the **`Cache-Status`** response header (**RFC 9211**), which
replaces ad-hoc, per-vendor `X-Cache` guessing. It is a **structured field**: each cache on
the path prepends an entry naming itself plus parameters.

```
Cache-Status: ExampleCDN; hit; ttl=299, OriginShield; fwd=miss; stored
```

- `hit` / `fwd=miss` / `fwd=stale` — whether this cache served from store or forwarded, and
  why (`miss`, `uri-miss`, `stale`, `request-header`, etc.).
- `stored` — the forwarded response was stored for future use.
- `ttl` — remaining freshness; `collapsed` — the request was satisfied by request collapsing.

Combined with the `Age` header, `Cache-Status` is *the* debugging answer. A low hit rate
usually traces to an over-broad `Vary`, unnormalized cache keys (varying query-param order,
header casing), or per-user directives (`private`, `Set-Cookie`) suppressing storage.

## ETag generation strategies and pitfalls

Deepening the earlier ETag material — generation strategy is where real systems break:

- **Strategies.** (a) *Content hash* of the serialized body (strong, exact, but you must
  serialize to hash); (b) *version/revision counter* bumped on every write (cheap, monotonic,
  survives byte-level noise — often exposed as a weak ETag); (c) *derived from `Last-Modified`
  + size* (cheap but inherits 1-second resolution).
- **The compression pitfall.** If you compute a **strong** ETag over the raw body and then a
  proxy/load balancer gzips or brotli-compresses it, the bytes on the wire differ per
  encoding while the ETag is unchanged — or, if the ETag is computed *after* compression, the
  same resource yields different ETags per encoding, breaking `If-None-Match`. Fix: use a
  **weak** ETag for content that varies only by encoding, *or* compute the ETag before
  compression and always send `Vary: Accept-Encoding` so each encoding is a distinct cache
  variant with its own validator.
- **Stability across replicas.** If ETags are per-node (server timestamp, process-local
  counter) or hash a non-deterministically serialized body (unordered map/JSON key order),
  two replicas return **different** ETags for the *same* logical resource. Behind a load
  balancer this causes spurious `200`s where a `304` was expected — cache misses and lost
  bandwidth savings. Make ETag generation deterministic and shared across replicas
  (canonical serialization, a stored version column, or a content hash of canonical bytes).
- **Middleware rewriting.** Some frameworks/proxies auto-generate or rewrite ETags (e.g.
  hashing the final compressed body); know what's in your path so you don't ship two
  conflicting ETag schemes.

## Heuristic freshness specifics

Sharpening the earlier heuristic warning with the testable details (RFC 9110/9111):

- **Heuristically cacheable status codes** are an explicit list: `200`, `203`, `204`, `206`,
  `300`, `301`, `308`, `404`, `405`, `410`, `414`, and `501`. Note `404`/`410` are on the
  list — a missing resource can be cached heuristically, which surprises people.
- **The LM-factor formula.** A common heuristic sets the freshness lifetime to roughly
  **10% of (`Date` − `Last-Modified`)** — an old resource is assumed to stay stable
  proportionally longer.
- **`Cache-Control` presence disables heuristics.** Any explicit expiration (`max-age`,
  `s-maxage`, `Expires`) turns heuristic freshness off. This is exactly why you always send
  an explicit directive on API responses.

## Vary internals: secondary cache keys and normalization

Beyond the "explosion" warning, the mechanism itself is a senior topic:

- **Secondary cache key.** A cache stores *multiple variants* under one URI. The primary key
  is method + URI; the **secondary key** is the tuple of the request-header values named in
  the stored response's `Vary`. On a later request, the cache selects the variant whose
  secondary key matches (RFC 9111 §4.1).
- **Normalization is a hit-rate lever.** Because matching is on raw header *values*,
  differences in case, ordering, or `Accept` q-values create distinct variants. Edge configs
  often **normalize** these headers (canonical casing, collapse to a small set of encodings)
  *before* keying, dramatically raising hit rates without changing correctness.
- **`Vary: Accept-Encoding` is almost always safe and necessary** (few values: gzip, br,
  identity), whereas `Vary: User-Agent` (thousands of values) or `Vary: Cookie` is toxic —
  near-unique keys, near-zero hits, and possible per-user leakage. For per-user data prefer
  `private`, not a `Vary` on a per-user header.

## Negative caching and invalidation precision

- **Negative caching.** Deliberately caching `404`/`410` with a **short** TTL shields the
  origin from floods of requests for missing keys (e.g. a scanner hitting nonexistent IDs).
  Do **not** cache `5xx` by default — a transient origin error would be pinned and amplified;
  `stale-if-error` is the right tool for serving *old good* content during an outage instead.
- **Invalidation vs eviction vs purge.** RFC 9111 §4.4: a **non-error response to an unsafe
  method** *invalidates* the target URI plus the `Location`/`Content-Location` URIs — but
  invalidation only marks entries stale (forcing revalidation), it does not delete them, and
  it only happens at caches **on that request's path**. *Eviction* is a cache reclaiming space
  under pressure. *Explicit purge* is an out-of-band API call (often **by surrogate/tag**,
  fanning out to many URIs). Because a purge of a popular key drops it from all edges at once,
  it can trigger a stampede — combine purge with request collapsing + `stale-while-revalidate`.

## bfcache and history navigation

A subtle browser caveat interviewers use to separate levels: the **back/forward cache**
(bfcache) stores a full in-memory *snapshot* of a page (DOM + JS state) for instant
back/forward navigation. It is **not** the HTTP cache, and `Cache-Control: no-cache` does
**not** force revalidation on a history navigation — the browser restores the snapshot,
which is why users sometimes see stale data after clicking Back. To keep a sensitive page out
of bfcache you use `Cache-Control: no-store` (and historically `unload`/`beforeunload`
listeners disqualified a page). This is the correct answer to "why did the back button show
data that should have been revalidated?"

## Common follow-up questions

- **What's the difference between `no-cache` and `no-store`?** `no-store` forbids storing
  at all; `no-cache` stores but revalidates before every reuse.
- **How does a conditional GET save resources — bandwidth, round-trips, or both?** Bandwidth
  (empty `304` body); the round-trip still happens. Freshness (`max-age`) saves the trip.
- **Strong vs weak ETag — when must you use strong?** Range requests and `If-Match`
  require strong comparison; `If-None-Match` uses weak comparison.
- **How do you prevent lost updates?** `ETag` + `If-Match` → `412` on mismatch; client
  refetches and retries. Consider `428 Precondition Required` to force it.
- **How do you make a PUT create-only (fail if it exists)?** `If-None-Match: *` → `412` if
  present. Update-only? `If-Match: *`.
- **Why prefer `ETag` over `Last-Modified`?** `Last-Modified` has 1-second resolution and
  depends on clocks; `ETag` is exact and opaque.
- **What does `Vary` do and what's the risk of `Vary: Cookie`?** It adds request headers to
  the cache key; high-cardinality headers destroy hit rates and can leak per-user data.
- **`s-maxage` vs `max-age`?** `s-maxage` targets shared caches only and overrides
  `max-age`/`Expires` for them.
- **Which status code for a failed precondition on a write vs a matched conditional GET?**
  `412 Precondition Failed` for writes; `304 Not Modified` for GETs.
- **What happens with no caching headers at all?** Shared caches may apply heuristic
  freshness and serve stale content — always be explicit.
- **Which RFCs govern this today?** RFC 9110 (semantics/validators/conditionals) and RFC
  9111 (caching); RFC 5861 for stale-* extensions.

## References

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) (validators §8.8, conditional requests §13; obsoletes 7231/7232)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111) (`Cache-Control` §5.2, freshness §4.2, `Vary` §4.1; obsoletes 7234)
- [RFC 5861 — HTTP Cache-Control Extensions for Stale Content](https://www.rfc-editor.org/rfc/rfc5861) (`stale-while-revalidate`, `stale-if-error`)
- [RFC 6585 — Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585) (`428 Precondition Required`)
- [RFC 8246 — HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246) (`Cache-Control: immutable`)
- [RFC 9211 — The Cache-Status HTTP Response Header Field](https://www.rfc-editor.org/rfc/rfc9211) (structured cache hit/miss/fwd/ttl reporting)
- [RFC 9213 — Targeted HTTP Cache Control](https://www.rfc-editor.org/rfc/rfc9213) (`CDN-Cache-Control` and targeted directives, precedence)
- [MDN — HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [MDN — Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
- [MDN — bfcache (back/forward cache)](https://developer.mozilla.org/en-US/docs/Glossary/bfcache)
- [PortSwigger — Web cache poisoning](https://portswigger.net/web-security/web-cache-poisoning)
- [PortSwigger — Web cache deception](https://portswigger.net/web-security/web-cache-deception)
- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x00-header/)
