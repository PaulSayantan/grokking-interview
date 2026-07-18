# API Versioning & Evolution

APIs are contracts. Once a client depends on your response shape, URL, or status code,
you cannot change it freely without risking their integration. **Versioning and evolution**
is the discipline of changing an API over time *without breaking existing consumers* — and,
where possible, *avoiding* an explicit version bump altogether by evolving compatibly.

This topic is framework-agnostic: it is about the HTTP/wire contract a client actually
consumes (URLs, headers, media types, JSON shapes, status codes), not about any one
framework's routing or serialization APIs.

> [!KEY-TAKEAWAY]
> Versioning is a *cost*, not a feature. Every version you publish is a version you must
> maintain, document, test, and eventually sunset. The best versioning strategy is the one
> that lets you ship the most change with the fewest new versions — usually by making
> **additive, backward-compatible** changes and reserving version bumps for true breaking
> changes.

## Why version an API and what it costs

A version is a mechanism to let the server change its contract while old clients keep working.
Without it, any breaking change is a coordinated, all-at-once migration across every client
you do not control (mobile apps in the field, third-party integrators, partner batch jobs).

**Why you need it:** clients cannot all upgrade instantly. A native mobile app installed on a
phone may run unchanged for years; a partner's nightly job may be touched once a quarter. The
server must serve old and new contracts simultaneously during a transition window.

**What it costs:**
- Every live version multiplies maintenance: code paths, tests, docs, security patches.
- Version proliferation fragments your user base and complicates support.
- A "big bang" `/v2` that reshapes everything forces every client to do a large migration
  even for features they do not use.

The mature stance (used by Google, Stripe, GitHub, AWS) is: **version rarely, evolve constantly.**
Make additive changes that need no version bump; batch unavoidable breaking changes into
infrequent major versions with a long deprecation runway.

## Breaking vs non-breaking changes

The single most important skill in API evolution is classifying a proposed change. A
**breaking change** invalidates a reasonable existing client; a **non-breaking (additive)**
change does not.

**Non-breaking (backward-compatible) — safe to ship without a new version:**
- Adding a new **optional** request field/parameter (with a sane default).
- Adding a new field to a response body.
- Adding a new endpoint, resource, or HTTP method.
- Adding a new *optional* response header.
- Adding a new value to an output enum *only if clients were told to tolerate unknowns*
  (otherwise it is breaking — see gotcha below).
- Relaxing a validation constraint (accepting more input than before).
- Adding a new error code within an existing documented error structure.

**Breaking — requires a new version (or a compatibility shim):**
- Removing or renaming a field, endpoint, or parameter.
- Changing a field's **type** (`string` → `number`) or its semantics/units.
- Making a previously optional request field **required**.
- Adding a **required** request parameter.
- Tightening validation (rejecting input that used to be accepted).
- Changing default values, sort order, or pagination behavior clients relied on.
- Changing an HTTP status code or the structure of the error payload.
- Removing an enum value the client may send, or repurposing an existing one.

> [!WARNING]
> "Adding a field is always safe" is only true for **response** bodies read by tolerant
> clients. Adding a field to a *request* is safe only if it is optional. And adding an enum
> value to a *response* breaks strict clients that switch/case over the known set and throw on
> "unknown" — which is why tolerant-reader guidance must be published up front.

| Change | Request side | Response side |
|---|---|---|
| Add optional field | Non-breaking | Non-breaking |
| Add required field | **Breaking** | n/a |
| Remove field | **Breaking** (if server relied on it) | **Breaking** |
| Rename field | **Breaking** | **Breaking** |
| Change type/units | **Breaking** | **Breaking** |
| Add enum value | Non-breaking (server accepts more) | **Breaking** unless tolerant reader mandated |
| Loosen validation | Non-breaking | n/a |
| Tighten validation | **Breaking** | n/a |

## Backward vs forward compatibility

These two terms are frequently confused in interviews.

- **Backward compatibility**: a **new server** can still serve **old clients** correctly.
  A new server version understands and honors requests written for the old contract. This is
  the property you protect when you add fields rather than remove them.
- **Forward compatibility**: an **old client** can handle data produced by a **newer server**.
  An old client ignores fields it does not recognize instead of crashing. This is a property
  of how the *client* is written (tolerant reader), which the server encourages by making only
  additive changes.

A useful framing: backward compatibility is the *server's* responsibility (do not break old
requests); forward compatibility is achieved when *clients* are built to tolerate additive
change. Wire formats like Protocol Buffers are explicitly designed so that adding fields keeps
both properties intact.

> [!TIP]
> Mnemonic: **backward** compatibility looks *back* at older clients ("does my new code still
> serve the old callers?"). **Forward** compatibility looks *forward* at newer data ("can my
> old code survive data from the future?").

## Tolerant reader and Postel's law

**Postel's Law (the Robustness Principle):** "Be conservative in what you send, be liberal in
what you accept." Applied to APIs, this yields the **Tolerant Reader** pattern (named by Martin
Fowler): a client should extract only the data it needs and **ignore everything else**, rather
than validating the entire document against a rigid schema and failing on anything unexpected.

Concretely, a tolerant reader:
- Ignores unknown JSON fields instead of rejecting the payload.
- Does not depend on the *order* of fields or array elements it did not request ordering for.
- Does not break when an optional field is absent.
- Handles unknown enum values gracefully (a default/`UNKNOWN` bucket), rather than throwing.
- Avoids over-specifying: e.g., binding to a whole object when it needs one field.

```json
// Server adds "loyaltyTier" in a later release.
{ "id": 42, "name": "Ada", "email": "ada@example.com", "loyaltyTier": "gold" }
```
A tolerant client that only reads `id` and `name` keeps working unchanged; a strict client
whose deserializer is configured to fail on unknown properties would break — the classic reason
"just adding a field" causes a production incident.

> [!WARNING]
> Postel's Law has a well-known dark side: being *too* liberal in what you accept hides bugs,
> lets malformed data proliferate, and can create security ambiguity (e.g., inconsistent
> parsing between a gateway and a backend). Modern guidance (see RFC 9413, "Maintaining
> Robustness in Protocols") is to be tolerant of *additive* evolution but strict about clearly
> invalid input. Tolerance is a client-read strategy, not a license to accept garbage.

## URI path versioning

The version is embedded in the URL path, e.g. `/v1/users`, `/v2/users`.

```http
GET /v2/users/42 HTTP/1.1
Host: api.example.com
```

**Pros:**
- Maximally visible and explicit; trivial to test in a browser or `curl`.
- Easy to route (gateways/load balancers can route by path prefix).
- Unambiguous cache keys — different versions are different URLs.
- Dominant in practice: used by Stripe (path + date header), Twitter/X, GitHub (also supports
  media type), most public APIs.

**Cons / purist objection:**
- Violates REST's principle that a URI should identify a *resource*, not a representation
  version — `/v1/users/42` and `/v2/users/42` are arguably the *same* user. Roy Fielding and
  the HATEOAS camp consider this an anti-pattern.
- Encourages "big bang" versions: bumping the path version tends to reshape the whole surface,
  even for endpoints that did not change.
- Clients hardcode version into every URL; upgrading means rewriting URLs.

> [!INTERVIEW]
> The expected nuanced answer: URI path versioning is the most *pragmatic and common* choice
> and is what most teams should pick, **but** it is the least RESTful because it puts a
> representation concern in the resource identifier. Interviewers want you to name both the
> popularity and the theoretical objection.

## Query parameter versioning

The version is a query string parameter, e.g. `GET /users/42?version=2` or `?api-version=2023-10-01`.

```http
GET /users/42?api-version=2 HTTP/1.1
Host: api.example.com
```

**Pros:**
- Keeps a single, stable resource path; the base URL never changes.
- Easy to default (omit the param → latest or a pinned default).
- Simple to add to existing endpoints without new routes.

**Cons:**
- Muddies caching: caches must include the query string in the key, and some intermediaries
  treat query-only differences inconsistently.
- Easy to forget or drop the parameter, silently changing behavior.
- Mixes a contract-selection concern with resource-filtering parameters in the same namespace.
- Used by Azure ("`api-version`" is required on most Azure REST calls) and AWS query-protocol
  services (the `Version` parameter), so it is far from unheard of.

## Custom header versioning

The version travels in a request header, e.g. `X-API-Version: 2` or a vendor header, leaving
the URL clean.

```http
GET /users/42 HTTP/1.1
Host: api.example.com
X-API-Version: 2
```

Stripe's date-based versioning is a well-known real example: the account has a default pinned
version, and an individual request can override it with a `Stripe-Version: 2023-10-16` header.

**Pros:**
- URL identifies the resource cleanly (closer to REST ideals than path versioning).
- Version is orthogonal to the resource; good for pinning a client to a date-based snapshot.

**Cons:**
- Invisible in the URL — harder to test/share, easy to overlook in logs and docs.
- Custom `X-` headers are non-standard (RFC 6648 deprecates the `X-` convention).
- Caching requires a correct `Vary` header (`Vary: X-API-Version`) or caches will serve the
  wrong version.
- Harder for a plain browser hit; needs a tool that can set headers.

## Media type (content negotiation) versioning

The version is expressed through HTTP content negotiation, using a vendor-specific media type
in `Accept` (and `Content-Type` for requests). This is the most REST-purist approach and is what
Roy Fielding's dissertation implies.

```http
GET /users/42 HTTP/1.1
Host: api.example.com
Accept: application/vnd.example.user+json; version=2
```

GitHub uses this style: `Accept: application/vnd.github+json` plus an `X-GitHub-Api-Version`
date header for the current API. The vendor tree (`vnd.`) is registered per RFC 6838.

**Pros:**
- Cleanest separation of *resource* (URI) from *representation/version* (media type) — the
  most RESTful and the approach that respects HTTP content negotiation as designed.
- The server can advertise supported versions and use `406 Not Acceptable` when it cannot
  satisfy the requested media type.
- Version applies per-representation, so different resources can evolve independently.

**Cons:**
- Highest ceremony and lowest discoverability; poorly understood by many developers.
- `Accept` header is easy to get wrong; hard to exercise from a browser address bar.
- Requires correct `Vary: Accept` handling for caches.
- Overkill for many internal or straightforward APIs.

## Comparing versioning strategies

| Strategy | Example | RESTful? | Discoverable | Caching | Typical users |
|---|---|---|---|---|---|
| URI path | `/v2/users` | Least (version in identifier) | Highest | Simple (distinct URLs) | GitHub, Twitter/X, most public APIs |
| Query param | `/users?api-version=2` | Low | High | Needs query in cache key | Azure, AWS query protocol |
| Custom header | `X-API-Version: 2` | Medium | Low (hidden) | Needs `Vary` | Stripe (`Stripe-Version`) |
| Media type | `Accept: …;version=2` | Most (content negotiation) | Lowest | Needs `Vary: Accept` | GitHub (accept), HAL/HATEOAS APIs |

> [!KEY-TAKEAWAY]
> There is no single "correct" strategy — the interview answer is the trade-off matrix.
> Default recommendation for most teams: **URI path versioning** for its pragmatism and
> tooling support, combined with a strict rule that you only bump the major version for true
> breaking changes and evolve additively otherwise. Use header/media-type versioning when
> REST purity, per-resource evolution, or date-pinned snapshots matter.

## Semantic versioning for APIs

**SemVer** (`MAJOR.MINOR.PATCH`) formalizes what a version number *promises*:
- **MAJOR** — incompatible/breaking changes.
- **MINOR** — backward-compatible new functionality.
- **PATCH** — backward-compatible bug fixes.

For **web APIs**, the crucial adaptation is that only the **MAJOR** number is usually exposed
in the contract (e.g., `/v2`), because that is the only number a client must react to. Minor and
patch changes are additive and should be invisible to well-behaved clients — you do not create
`/v2.3.1` in the URL. Internally you may still track full SemVer for your SDKs and changelog.

```
v1  ──(additive: add fields, endpoints)──►  still v1 (minor/patch)
v1  ──(remove field, change type)──────────►  must become v2 (major)
```

**Date-based versioning** is a popular alternative to SemVer for the public contract (Stripe:
`2023-10-16`, Azure: `api-version=2023-10-01`). A date is monotonic, human-meaningful, and pins
a client to "the API as it behaved on that day," which pairs naturally with header versioning.
It is essentially an ever-incrementing major version keyed by release date.

> [!INTERVIEW]
> Common trap: "Should the URL be `/v1.2`?" No — exposing minor/patch in the contract defeats
> the purpose. Clients should only ever need to change their integration on a **major** bump;
> minor/patch are, by definition, changes they can absorb without action.

## Version negotiation and defaults

**Version negotiation** is how the client and server agree on which contract is in effect for a
request, and what happens when the request is ambiguous or asks for something unsupported.

Key design decisions:
- **Default when unspecified.** If a client omits the version, do you serve the *oldest* stable
  version or the *latest*? Serving "latest by default" is dangerous — a new major can silently
  break clients that never opted in. Safer: pin to a specific default (often the newest at the
  time the account/key was created, as Stripe does) or require the version explicitly.
- **Unsupported version requested.** Respond clearly — commonly `400 Bad Request` for a
  malformed/unknown version param, or `406 Not Acceptable` when using media-type negotiation and
  no representation matches the `Accept`. Do **not** silently fall back to a different version.
- **Advertising versions.** Document supported versions; some APIs expose a discovery endpoint
  or return the effective version in a response header (e.g., echo `X-API-Version` back).
- **`Vary` for cache correctness.** When version is in a header or `Accept`, the response MUST
  set `Vary` accordingly so shared caches key on it.

```http
# Media-type negotiation the server cannot satisfy:
GET /users/42 HTTP/1.1
Accept: application/vnd.example.user+json; version=99

HTTP/1.1 406 Not Acceptable
Content-Type: application/problem+json

{ "type": "https://api.example.com/errors/unsupported-version",
  "title": "Unsupported API version",
  "status": 406,
  "detail": "version=99 is not supported; supported: 1, 2, 3" }
```

## Deprecation policy, Deprecation and Sunset headers

Retiring a version or endpoint is a *process*, not a flip of a switch. A good deprecation policy
has: advance notice, a machine-readable signal, migration docs, and a firm removal date honored
after a guaranteed window (commonly 6–12 months for public APIs).

Two standardized HTTP response headers make deprecation machine-readable:

**`Deprecation` header — RFC 9745 (Standards Track, March 2025).** It is an *Item* Structured
Field whose value is a **Date** (per RFC 9651 structured fields), indicating when the resource
became (or will become) deprecated. The date may be in the past or future.

```http
HTTP/1.1 200 OK
Deprecation: @1688169599
Sunset: Wed, 30 Jun 2027 23:59:59 GMT
Link: <https://developer.example.com/deprecation>; rel="deprecation"; type="text/html"
Link: <https://api.example.com/v2/users/42>; rel="successor-version"
```

> [!WARNING]
> The `Deprecation` header value is a Structured-Fields **Date**, written as `@` followed by a
> Unix timestamp in seconds (e.g. `Deprecation: @1688169599`). Do **not** confuse it with the
> `Sunset` header's format. Earlier drafts used a plain `true`/boolean — that is obsolete;
> RFC 9745 finalized the Date form.

**`Sunset` header — RFC 8594 (Informational, May 2019).** Its value is an **HTTP-date** (the
same format as `Date`/`Expires`), giving the time after which the resource is expected to become
unresponsive. Note the two headers use *different* date formats.

```http
Sunset: Wed, 30 Jun 2027 23:59:59 GMT
```

Rules and relationships:
- Sunset MUST NOT be earlier than the Deprecation date (you cannot remove something before you
  deprecate it).
- `Deprecation` says "this is discouraged"; `Sunset` says "this will stop working at time T."
  A resource can be deprecated with no sunset date yet (no removal planned).
- Use `Link` headers (RFC 8288, Web Linking) with `rel="deprecation"` to point to the human
  docs, and relations like `rel="successor-version"`/`rel="latest-version"` (RFC 5829) to point
  to the replacement.
- Deprecation does not change the status code — a deprecated endpoint still returns `200`; it
  just carries the advisory headers. After the sunset date, `410 Gone` (permanent) or `404` is
  appropriate.

> [!TIP]
> Signal deprecation in *both* machine-readable (headers) and human channels (changelog, email,
> dashboard warnings, SDK deprecation notices). Headers alone are routinely ignored by clients
> who never log response headers.

## Evolving an API without versioning

The best version is often no new version. Many mature APIs go years without a major bump by
designing for change from day one. Techniques:

- **Additive-only changes.** Add fields/endpoints; never remove or repurpose. Combined with
  tolerant readers, this covers the vast majority of evolution needs.
- **Publish tolerant-reader expectations up front.** Tell clients in the docs: "ignore unknown
  fields; do not assume field order; handle unknown enum values." This makes future additive
  changes safe by contract.
- **Feature flags / capability negotiation.** Gate new behavior behind an opt-in flag or a
  request header so clients pull new behavior when ready, rather than having it pushed.
- **Expand/contract (parallel change).** To rename `name` → `fullName`: (1) *expand* — add
  `fullName` while still returning/accepting `name`; (2) migrate clients; (3) *contract* —
  remove `name` only after telemetry shows no one uses it. Same technique for changing types via
  a new parallel field.
- **Optional new fields with safe defaults**, so old requests remain valid.
- **Hypermedia / HATEOAS.** If clients follow links rather than hardcoding URLs, you can move or
  restructure endpoints without breaking them (the theoretical ideal; rarely fully realized).
- **GraphQL-style field deprecation.** In schema-based APIs, mark a field `@deprecated` and add
  a replacement; clients that request the new field migrate at their own pace — no global version.

> [!KEY-TAKEAWAY]
> Design for evolution *before* you need it: additive changes + tolerant readers + expand/contract
> lets you avoid most version bumps entirely. Reserve explicit versions for the genuinely
> unavoidable breaking change, and even then, run old and new in parallel with a clear
> deprecation runway.

## Common follow-up questions

- **"Is adding a field to a JSON response a breaking change?"** Not for tolerant readers; it can
  break strict clients whose deserializer fails on unknown properties — which is why you publish
  tolerant-reader guidance up front. Adding an *enum value* to a response is breaking for clients
  that exhaustively switch on the known set.
- **"URI vs header vs media-type versioning — which do you pick and why?"** Give the trade-off
  matrix; default to URI path for pragmatism/tooling, and note it is the least RESTful. Choose
  media-type/header when REST purity, per-resource evolution, or date-pinned snapshots matter.
- **"What status code for an unsupported version?"** `400` for a bad/unknown version parameter;
  `406 Not Acceptable` when using media-type content negotiation and no representation matches.
  Never silently fall back to another version.
- **"Difference between the Deprecation and Sunset headers?"** `Deprecation` (RFC 9745) is a
  structured-field Date marking *when* it became discouraged; `Sunset` (RFC 8594) is an HTTP-date
  marking *when it stops working*. Sunset must not precede Deprecation. Different date formats.
- **"Backward vs forward compatibility?"** Backward = new server serves old clients (server's
  job). Forward = old client survives new-server data (achieved via tolerant readers).
- **"How would you rename a field without breaking anyone?"** Expand/contract: add the new field
  alongside the old, migrate clients, remove the old after telemetry confirms no usage.
- **"Should you version internal microservice APIs the same way as public ones?"** Internal APIs
  can move faster (you control both ends and can coordinate deploys), but still benefit from
  additive/tolerant patterns; public APIs need longer deprecation windows and stronger guarantees.
- **"When is a `/v2` justified?"** Only when a change is genuinely breaking *and* cannot be done
  via expand/contract or a feature flag — e.g., a fundamental resource-model redesign.

## References

- RFC 9110 — HTTP Semantics (status codes, content negotiation, `Vary`, `406`, `410`):
  https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9745 — The Deprecation HTTP Response Header Field (Standards Track, Mar 2025):
  https://www.rfc-editor.org/rfc/rfc9745.html
- RFC 8594 — The Sunset HTTP Header Field (Informational, May 2019):
  https://www.rfc-editor.org/rfc/rfc8594.html
- RFC 8288 — Web Linking (the `Link` header, link relations):
  https://www.rfc-editor.org/rfc/rfc8288.html
- RFC 5829 — Link Relation Types for Simple Version Navigation (`successor-version`,
  `latest-version`, `predecessor-version`): https://www.rfc-editor.org/rfc/rfc5829.html
- RFC 9413 — Maintaining Robustness in Protocols (modern take on Postel's Law):
  https://www.rfc-editor.org/rfc/rfc9413.html
- RFC 6838 — Media Type Specifications (the `vnd.` vendor tree):
  https://www.rfc-editor.org/rfc/rfc6838.html
- RFC 6648 — Deprecating the `X-` prefix for headers:
  https://www.rfc-editor.org/rfc/rfc6648.html
- RFC 9651 — Structured Field Values for HTTP (Date type used by `Deprecation`):
  https://www.rfc-editor.org/rfc/rfc9651.html
- Semantic Versioning 2.0.0: https://semver.org/
- Martin Fowler — Tolerant Reader: https://martinfowler.com/bliki/TolerantReader.html
- Stripe API versioning: https://stripe.com/docs/api/versioning
- Microsoft Azure REST API versioning guidance:
  https://github.com/microsoft/api-guidelines
