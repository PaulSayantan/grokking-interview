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
  The trade-off is about *who controls the clients*: latest-by-default is acceptable for
  internal/simple APIs where you own every consumer and can coordinate deploys (you upgrade the
  callers in lockstep with the server). Pinned-or-explicit is mandatory for public/partner APIs,
  where clients upgrade on their own schedule and a silent latest-substitution becomes a breaking
  change you shipped *for* them — see the internal-vs-public follow-up below.
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

Reading the two dates concretely: `@1688169599` decodes to **2023-06-30 23:59:59 UTC** (the
Unix timestamp of the moment the resource became deprecated), while `Sunset` is
**2027-06-30 23:59:59 GMT** — the moment it stops working. So this single response says
"deprecated four years ago, removed at the future sunset": the `Deprecation` date sits in the
*past* (already discouraged) and the `Sunset` date sits in the *future* (still serving, for now).
That is the whole "deprecated now, removed later" lifecycle expressed in two headers.

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

**Worked example — renaming `name` → `fullName` with expand/contract.** The wire state at each
phase makes the "parallel change" concrete. Say the resource is a user and we are renaming a
single field. Trace the actual response body over the three phases:

| Phase | Duration | Response body | Request accepts | Server behavior |
|---|---|---|---|---|
| 1. Expand | rename ships | `{"id":42,"name":"Ada Lovelace","fullName":"Ada Lovelace"}` | either `name` **or** `fullName` | **Dual-write**: on read, populate both from one source; on write, if client sends `name`, copy it into `fullName` (and vice versa) |
| 2. Migrate | weeks–months | *same as Phase 1* (both fields still present) | either field | Telemetry watches per-field reads/writes; wait until `name` usage → 0 |
| 3. Contract | after zero usage | `{"id":42,"fullName":"Ada Lovelace"}` | only `fullName` | `name` removed; requests still sending `name` now get a `400`/ignored per policy |

The key is Phase 1's **overlap window**: both fields carry the *same* value, so an old client
reading `name` and a new client reading `fullName` both see `"Ada Lovelace"` — no one breaks.
On writes the server **dual-reads**: `fullName = request.fullName ?? request.name`, so a legacy
`PUT {"name":"Grace Hopper"}` and a new `PUT {"fullName":"Grace Hopper"}` are stored identically.
Only after Phase 2 telemetry proves `name` is dead do you contract to the clean single-field
shape — the rename completed with *zero* version bump.

## Three axes of compatibility (source, wire, semantic)

"Compatibility" is not one thing. Google's API design guide (AIP-180) separates three
distinct axes, and a change can break one while preserving the others:

- **Source compatibility** — does existing *client source code* still compile against the
  new contract/SDK? Renaming a generated field or narrowing a type breaks source compat even
  if the wire bytes are unchanged. (Relevant when you ship generated SDKs.)
- **Wire compatibility** — do bytes serialized under the old contract still deserialize
  correctly under the new one, and vice versa? Adding a Protobuf field with a new tag number
  is wire-compatible; reusing a deleted tag number is not.
- **Semantic (behavioral) compatibility** — does the *behavior a reasonable developer expects*
  stay the same, even when the shape is byte-identical? Changing a default, sort order, unit,
  or precision passes schema validation and passes a wire diff, yet still silently breaks
  clients. This is the hardest and most overlooked class.

> [!KEY-TAKEAWAY]
> A change can be perfectly wire- and source-compatible and still be a **breaking change**
> because it violates *semantic* compatibility. Contract linters and schema diffs catch the
> first two axes; only domain review and per-field telemetry catch the third.

## Semantic (behavioral) breaking changes

Beyond shape changes, a whole class of breakages leaves the JSON/schema identical but changes
what the values *mean*. These pass schema validation, pass a diff linter, and still break
clients. Canonical examples (several from AIP-180):

- **Changing a default value.** A `genre` field that defaulted to `FICTION` now defaults to
  `NONFICTION`; clients that relied on the old default silently mis-categorize.
- **Retrofitting pagination.** Adding a `page_size` whose default (say 50) is *smaller* than
  the old "return everything" behavior silently truncates result sets for clients that never
  paginated.
- **Changing sort order** of a previously-ordered (or apparently-ordered) collection.
- **Changing units, format, or representation** of a value — e.g. an `ip_address` that starts
  returning IPv6, a duration that switches from seconds to milliseconds, a timestamp whose
  timezone or precision changes.
- **Newly serializing a previously-omitted field.** A field that was always absent (or omitted
  when equal to its default) starts appearing; strict parsers or exhaustive validators break.
- **Tightening rate limits or quotas** that clients had implicitly depended on.
- **String/numeric bound changes.** Raising a string's documented max length, or widening a
  numeric range, breaks clients with fixed-length database columns or `int32` storage that can
  no longer hold the value. AIP-180 explicitly calls out increasing a string length limit and
  changing numeric ranges as breaking, precisely because clients size their storage to the
  documented bound.

> [!WARNING]
> "It's the same JSON shape" is not a proof of compatibility. The most damaging incidents come
> from semantic changes that no schema diff flags — a default flip or a units change ships as a
> "minor tweak" and corrupts downstream data for months.

## String and numeric bound changes

A subtle senior gotcha worth isolating: **relaxing an output bound is breaking**. If your docs
promised IDs fit in `int32` (≤ 2,147,483,647) or a name is ≤ 64 characters, clients provisioned
`INT`/`VARCHAR(64)` columns and fixed buffers. When you later return a value that exceeds the
old bound, those clients overflow, truncate, or reject the row — even though the field name and
JSON type are unchanged. The safe migration is expand/contract with a **new parallel field**
(e.g. add an `int64` `id_long` alongside `id`, or a new resource version), never a silent
widening of the existing field. This is the exact mechanism behind the "we're running out of
`int32` IDs — how do we migrate?" interview question: type/bound widening is breaking, so you
introduce a parallel `int64` field and migrate clients before contracting.

## Media type versioning: the header grammar

Media-type versioning rewards precision about the actual header grammar (RFC 9110 §12 content
negotiation; RFC 6838 media type structure; RFC 6839 structured syntax suffixes):

- **The `+json` structured syntax suffix** (RFC 6839) says "this media type is *serialized as*
  JSON," so generic JSON tooling still works: `application/vnd.example.user.v2+json`. The
  `vnd.` **vendor tree** (RFC 6838) marks it as a vendor-specific type; formal registration is
  encouraged for public types.
- **Version as a parameter vs as part of the type name.** Two live conventions:
  `application/vnd.example.user+json; version=2` (a media-type *parameter*) versus
  `application/vnd.example.user.v2+json` (version baked into the subtype). The parameter form
  keeps one subtype and negotiates the version; the embedded form makes each version a distinct
  media type. Both are used in the wild; the parameter form composes more cleanly with `Accept`
  negotiation.
- **Quality values (`q`) for fallback.** `Accept` supports quality weighting per RFC 9110, so a
  client can express a preference order:
  `Accept: application/vnd.example.user+json; version=2; q=1.0, application/vnd.example.user+json; version=1; q=0.5`
  — "give me v2 if you can, else v1." The server picks the best mutually-supported representation.
- **`406 Not Acceptable` + `Vary: Accept`.** If no representation matches, return `406`. Because
  the response now depends on the `Accept` header, you MUST emit `Vary: Accept` so shared caches
  do not serve one client's v2 to another client that asked for v1.

## Enum evolution and the UNSPECIFIED sentinel

Enums are the sharpest tolerant-reader trap, so their evolution deserves explicit design:

- **Always design enums as open-ended lists** (Zalando guideline #112): document that new
  values may appear, so clients treat the enum as extensible rather than closed.
- **Reserve a zero/`UNSPECIFIED` sentinel.** Protobuf *mandates* that the first enum value be
  `0` and, by convention, named `*_UNSPECIFIED`; it is the default for any unset field and the
  bucket for values the client's generated code does not yet know. This gives every enum a safe
  "I don't recognize this" landing zone instead of a crash.
- **Open vs closed enum handling.** A *closed* enum deserializer throws on an unknown value; an
  *open* one maps unknowns to a sentinel/`UNKNOWN` bucket and keeps going. Only open handling is
  forward-compatible.
- **The request/response asymmetry.** Adding an accepted enum value to a *request* is
  non-breaking (the server simply accepts more input). Adding a value to a *response* is
  breaking for any client with closed-enum handling — the same add is safe in one direction and
  dangerous in the other.

## HATEOAS as versioning avoidance (and why it mostly failed)

HATEOAS (Hypermedia As The Engine Of Application State) is the theoretical answer to
versioning: if clients discover URLs by following server-provided links (RFC 8288 relations,
media types like HAL, JSON:API, Siren) instead of hardcoding paths, the server can relocate or
restructure endpoints without breaking anyone. Fielding considers link-following and
self-descriptive messages a *precondition* for calling an API RESTful.

**Why it largely failed to eliminate versioning in practice:**

- Clients **hardcode URLs anyway** — it is simpler, and most developers construct the next URL
  from a template rather than reading a `Link` relation.
- **Codegen and tooling assume fixed paths.** OpenAPI generators, SDKs, and typed clients bake
  in concrete routes, so a "movable" endpoint still breaks them.
- **It adds real complexity** for a benefit most teams never realize, and it does not solve the
  hard cases — HATEOAS lets you *move* an endpoint, but it does not tell an old client how to
  interpret a field whose *semantics* changed.
- Where hypermedia *does* deliver value is in the **media type itself** (HAL/JSON:API/Siren)
  and in relation-driven navigation (pagination `next`/`prev`, deprecation/successor links) —
  not as a universal replacement for explicit versions.

> [!INTERVIEW]
> "Why didn't HATEOAS eliminate versioning?" The strong answer: it works on paper for *endpoint
> relocation*, but clients hardcode URLs, tooling assumes fixed paths, and — critically — it
> does nothing for *semantic* changes. It survives as a useful pattern for navigation and
> discovery, not as a versioning silver bullet.

## Serving multiple versions from one codebase

Interviewers push past policy to implementation: "you run ~100 API versions — architecturally,
how?" There are three patterns, in increasing sophistication:

1. **Duplicated controllers / branch-by-abstraction.** Each version has its own handler (or a
   shared core behind version-specific adapters). Simple, but code and test surface grow with
   every version; it does not scale to dozens of live versions.
2. **Gateway/proxy translation layer.** A gateway rewrites old-shaped requests/responses into
   the current internal contract. Centralizes translation but couples the gateway to every
   version's quirks.
3. **Transformation / version-adapter pipeline (Stripe's model).** The core service always
   computes the **latest** representation internally. Each breaking change is encapsulated as
   one ordered, declarative **version-change module** that knows how to *downgrade* the latest
   response to the previous version (and *upgrade* the request the other way). To serve a client
   pinned to an old version, the server "walks back" through the chain of change modules newer
   than the client's version, applying each transform. This keeps the business logic
   single-versioned; each historical version is just a stack of small reversible diffs. A large
   bonus: because each change module is declarative, it can **auto-generate the changelog** and
   documentation for that version.

**Worked example — walking a v2-pinned request back through two change modules.** Suppose the
latest internal version is **v4**, and two breaking changes happened after v2:

- **v2 → v3:** split the single `name` field into `first_name` + `last_name`.
- **v3 → v4:** renamed `email` to `email_address`.

The core service only ever computes the **latest (v4)** representation:

```json
// v4 — what the business logic produces internally
{ "id": 42, "first_name": "Ada", "last_name": "Lovelace", "email_address": "ada@example.com" }
```

Each breaking change is one declarative module that knows how to **downgrade** the response one
step (and upgrade the request the other way). Sketching the two downgrade transforms:

```text
DowngradeV4toV3:  rename email_address -> email          (drop the v4 name)
DowngradeV3toV2:  combine first_name + last_name -> name (drop the two v3 fields)
```

A client pinned to **v2** hits the endpoint. The server sees the pin is *older* than v4, so it
walks back through every module newer than v2, newest first, applying each transform to the JSON:

```json
// Start: v4 internal representation
{ "id": 42, "first_name": "Ada", "last_name": "Lovelace", "email_address": "ada@example.com" }

// After DowngradeV4toV3  (email_address -> email)
{ "id": 42, "first_name": "Ada", "last_name": "Lovelace", "email": "ada@example.com" }

// After DowngradeV3toV2  (first_name + last_name -> name)
{ "id": 42, "name": "Ada Lovelace", "email": "ada@example.com" }   // <- served to the v2 client
```

A client pinned to **v3** would run *only* `DowngradeV4toV3` and stop — it gets
`{"id":42,"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com"}`. A **v4** client
runs no transforms at all and gets the raw internal shape. Requests flow the opposite way: a v2
`POST {"name":"Ada Lovelace"}` is *upgraded* forward — `UpgradeV2toV3` splits `name` on the last
space into `first_name`/`last_name`, `UpgradeV3toV4` renames `email` → `email_address` — before
the single-versioned business logic ever sees it. That is why complexity grows with the *number
of changes* (here, 2 modules), not versions × endpoints: adding v5 is one more module, not a
rewrite of every handler.

> [!KEY-TAKEAWAY]
> The transformation-pipeline model is the answer to "how does one codebase serve a hundred
> versions?": write your logic against the latest schema once, express every breaking change as
> a reversible transform, and compose transforms to project the response back to any pinned
> version. Complexity grows with the *number of changes*, not the product of versions × endpoints.

## Version pinning and per-field usage telemetry

- **Pin on first use (safe default).** Stripe auto-pins each account to the newest version at
  the time of its *first request*, so no one is ever silently upgraded into a breaking change.
  A per-request `Stripe-Version` header overrides the pin; OAuth apps can pin at the app level.
  Contrast with "latest by default," which silently breaks clients the moment you ship a new
  major.
- **Rollout mechanics for breaking changes.** Dark-launch / dual-write the new behavior, canary
  by version, and gate the final *contraction* on telemetry — remove a field only after
  per-field usage hits zero.
- **How you actually measure per-field usage.** Field-level access logging on the server
  records which response fields each client deserializes/requests. In GraphQL this is
  first-class: the server sees exactly which fields every operation selects, so field-usage
  tracking (e.g. Apollo) tells you precisely when a `@deprecated` field is safe to remove. In
  REST you approximate it with request-shape logging, sparse-fieldset (`fields=`) parameters, or
  instrumentation in the serializer. Without this telemetry, "remove after no one uses it" is a
  guess.

## Enforcing compatibility: contract diffing, CDC tests, schema registries

"How do you stop a junior from shipping a breaking change?" The senior answer is *automated
enforcement*, not human review:

- **Contract-diff / breaking-change linters in CI.** Tools like **oasdiff**, **openapi-diff**,
  **Optic**, and **Spectral** rules diff the new OpenAPI 3.1 spec against the published one and
  fail the build on a breaking delta (removed field, narrowed type, new required param). This is
  how you *mechanically* enforce the additive-only policy. OpenAPI 3.1's `info.version` records
  the document version; the diff — not the number — is the gate.
- **Consumer-driven contract (CDC) tests — Pact.** Each consumer publishes the exact
  request/response shape it depends on to a broker; the provider's CI verifies it still satisfies
  every registered consumer contract before deploying. This detects breakage *for real consumers*
  rather than against a hypothetical schema — especially valuable for internal microservices.
- **Schema registries with compatibility modes.** For serialized schemas (Avro/Protobuf/JSON
  Schema), a registry (e.g. Confluent Schema Registry) enforces a compatibility mode on every
  schema evolution: `BACKWARD`, `FORWARD`, `FULL`, and their `TRANSITIVE` variants. A registration
  that would violate the configured mode is rejected at publish time.

## Stability channels (alpha, beta, GA)

Not every version carries the same compatibility promise. Cloud providers publish **maturity
channels** that decouple "released" from "stable":

- **Google (AIP-181/185):** `v1alpha1`, `v1beta1`, `v1`. Alpha/beta versions explicitly carry
  **weaker** guarantees — they may break without the normal deprecation runway.
- **Microsoft/Azure:** GA vs **preview** (`api-version` values suffixed `-preview`).
- **Stripe:** beta features gated behind explicit beta version headers.

This is distinct from major-version bumping: a `v1beta1` → `v1` promotion is a *stability*
promotion, not necessarily a breaking API change, and the whole point of the pre-GA channel is
that consumers accept instability in exchange for early access. The same resource name should
still resolve across stable major versions (AIP: `v1` and `v2` refer to the same underlying
resource).

## Deprecated and zombie versions as a security risk (OWASP API9:2023)

Versioning is an *attack surface*, not just a design concern. **OWASP API Security Top 10 2023,
API9: Improper Inventory Management** names old, undocumented, or un-retired API versions as a
leading risk. The failure mode:

- You ship `/v2` but leave `/v1` running "just in case." `/v1` stops getting security patches,
  its dependencies rot, and it still exposes the full data set. These are **shadow / zombie
  APIs** — live endpoints no one is maintaining.
- Attackers routinely probe `/v1`, `/beta`, `/internal`, and old hosts precisely because the
  newest version is hardened while the forgotten one is not.

Mitigations tie directly back to the deprecation lifecycle: maintain an authoritative inventory
of every deployed version and environment, apply the same patch/authz baseline to *all* live
versions, and actually **retire** versions after their sunset date (return `410 Gone`) instead
of leaving them running indefinitely. "Deprecated but still serving unpatched traffic" is the
single most common versioning-related vulnerability.

## Post-sunset status codes: 410 vs 404 vs redirect

After a version or endpoint passes its sunset date, the status code you choose communicates
intent (RFC 9110 §15):

- **`410 Gone`** — permanent, intentional removal. It tells clients (and caches — 410 is
  cacheable by default) to *stop retrying*, which `404` does not. Prefer `410` when you want
  callers to notice and migrate.
- **`404 Not Found`** — ambiguous; the client cannot tell "removed on purpose" from "wrong URL /
  temporary glitch," so it may keep retrying. Acceptable but less informative than `410`.
- **`301`/`308` redirect to the successor** — only when the new version is a true 1:1 relocation
  of the *same* resource with a compatible representation. `308 Permanent Redirect` preserves the
  method and body (unlike `301`, which historically let clients switch to GET). Do **not** redirect
  when the successor's contract differs — a client silently following a redirect into a different
  representation is exactly the "silent version substitution" anti-pattern.

## Versioning contrast: REST vs gRPC/protobuf vs GraphQL

A favorite senior question: contrast the three philosophies. They sit at very different poles.

**REST — explicit version selector.** The version is a first-class, visible choice (URI path,
header, media type, or query param). Compatibility is a property of the *whole contract*, and a
breaking change means a new version. This is the "version stamp on the whole surface" pole.

**gRPC / Protobuf — deliberately *no* version number.** Compatibility is a property of
*individual fields*, not a version stamp:

- **Field numbers (tags) are immutable, permanent identifiers** (range 1–536,870,911). Changing
  a field's number is wire-incompatible.
- **Never reuse a deleted field's number or name.** Reuse causes decode ambiguity, data
  corruption, and even **PII leakage** (old clients decode new bytes into the old field). Use
  `reserved 2, 9 to 11; reserved "foo", "bar";` to fence off retired numbers *and* names.
- **Some type changes are wire-compatible but lossy/risky:** `int32`/`uint32`/`int64`/`bool` are
  interchangeable on the wire; `string`↔`bytes` if the bytes are valid UTF-8; an embedded
  message ↔ `bytes`. Wire-compatible does not mean safe.
- **proto3 has no `required`;** `optional` is recommended for presence tracking. Adding a field
  is always safe because old binaries **ignore unknown fields and preserve them on
  re-serialize** — that unknown-field preservation is what gives Protobuf both backward *and*
  forward compatibility without any version number.
- **The first enum value must be `0`** (`*_UNSPECIFIED` by convention).

**GraphQL — deliberately "versionless."** Clients request only the fields they need, so:

- **Adding fields, types, or optional args never breaks anyone** — no client over-fetches a new
  field it did not select.
- **`@deprecated(reason: "use X")`** marks fields, enum values, and args as deprecated *inline*
  in the schema, introspectable by tooling, replacing global version bumps.
- **Nullability is a compatibility tool:** adding a *nullable* field is safe; making a nullable
  field non-null, or adding a non-null argument, is breaking.
- **Schema-change classification** (e.g. Apollo schema checks) grades every change as *safe*,
  *dangerous*, or *breaking*, gated in CI against **field-level usage metrics** — you may remove
  a field only once telemetry shows no live operation selects it.

> [!KEY-TAKEAWAY]
> REST versions the *whole contract explicitly*; Protobuf and GraphQL are engineered to *never*
> version by making compatibility a property of individual fields (immutable tag numbers +
> unknown-field preservation for Protobuf; client-selected fields + `@deprecated` for GraphQL).
> These are opposite answers to the same problem, and a strong candidate can defend each.

## Event and async API versioning (schema registry compatibility modes)

Event/message contracts (Kafka, pub/sub) are *harder* to version than REST because you cannot
negotiate per request and **old events live forever in the log** — a consumer replaying from the
beginning must handle every schema that ever existed. There is no `Accept` header to pick a
version.

The dominant approach is **serialized schemas (Avro/Protobuf) + a schema registry** enforcing a
compatibility mode on every schema change:

- **`BACKWARD`** — a consumer using the *new* schema can read data written with the *previous*
  schema. Lets you upgrade consumers first. (Adding an optional field / deleting a field are the
  typical allowed changes.)
- **`FORWARD`** — a consumer using the *previous* schema can read data written with the *new*
  schema. Lets you upgrade producers first.
- **`FULL`** — both backward and forward between adjacent versions.
- **`TRANSITIVE`** variants (`BACKWARD_TRANSITIVE`, etc.) check compatibility against **all**
  prior versions, not just the immediately preceding one — the right choice when consumers
  replay the whole log.

Complementary techniques: **upcasting** (a consumer transforms an old event into the current
shape on read), **event-carried versioning** (the event embeds its own schema id/version), and
**AsyncAPI** for documenting the channels and message schemas. The mental model: for events,
compatibility is not a per-request negotiation but a *contract enforced at publish time across
the entire history of the topic*.

## Common follow-up questions

- "Is adding a field to a JSON response a breaking change?" Not for tolerant readers; it can
  break strict clients whose deserializer fails on unknown properties — which is why you publish
  tolerant-reader guidance up front. Adding an *enum value* to a response is breaking for clients
  that exhaustively switch on the known set.
- "URI vs header vs media-type versioning — which do you pick and why?" Give the trade-off
  matrix; default to URI path for pragmatism/tooling, and note it is the least RESTful. Choose
  media-type/header when REST purity, per-resource evolution, or date-pinned snapshots matter.
- "What status code for an unsupported version?" `400` for a bad/unknown version parameter;
  `406 Not Acceptable` when using media-type content negotiation and no representation matches.
  Never silently fall back to another version.
- "Difference between the Deprecation and Sunset headers?" `Deprecation` (RFC 9745) is a
  structured-field Date marking *when* it became discouraged; `Sunset` (RFC 8594) is an HTTP-date
  marking *when it stops working*. Sunset must not precede Deprecation. Different date formats.
- "Backward vs forward compatibility?" Backward = new server serves old clients (server's
  job). Forward = old client survives new-server data (achieved via tolerant readers).
- "How would you rename a field without breaking anyone?" Expand/contract: add the new field
  alongside the old, migrate clients, remove the old after telemetry confirms no usage.
- "Should you version internal microservice APIs the same way as public ones?" Internal APIs
  can move faster (you control both ends and can coordinate deploys), but still benefit from
  additive/tolerant patterns; public APIs need longer deprecation windows and stronger guarantees.
- "When is a `/v2` justified?" Only when a change is genuinely breaking *and* cannot be done
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
- RFC 6839 — Additional Media Type Structured Syntax Suffixes (the `+json` suffix):
  https://www.rfc-editor.org/rfc/rfc6839.html
- Google AIP-180 — Backwards compatibility (three axes; semantic breaking changes):
  https://google.aip.dev/180
- Google AIP-181 / AIP-185 — Stability levels and versioning (alpha/beta/GA, resource naming):
  https://google.aip.dev/181 and https://google.aip.dev/185
- Zalando RESTful API Guidelines (media-type versioning #114-115, avoid versioning #113,
  tolerant reader #108, open enums #112): https://opensource.zalando.com/restful-api-guidelines/
- OWASP API Security Top 10 2023 — API9:2023 Improper Inventory Management:
  https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/
- OpenAPI Specification 3.1 (`info.version`, content negotiation): https://spec.openapis.org/oas/v3.1.0
- oasdiff — OpenAPI breaking-change detection in CI: https://www.oasdiff.com/
- Protocol Buffers — proto3 language guide (field numbers, `reserved`, enum 0, unknown fields):
  https://protobuf.dev/programming-guides/proto3/
- GraphQL specification — `@deprecated` directive: https://spec.graphql.org/
- Confluent Schema Registry — compatibility modes (BACKWARD/FORWARD/FULL/TRANSITIVE):
  https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
- Pact — consumer-driven contract testing: https://docs.pact.io/
- Stripe API upgrades — version pinning and transformation model:
  https://stripe.com/blog/api-versioning
- Semantic Versioning 2.0.0: https://semver.org/
- Martin Fowler — Tolerant Reader: https://martinfowler.com/bliki/TolerantReader.html
- Stripe API versioning: https://stripe.com/docs/api/versioning
- Microsoft Azure REST API versioning guidance:
  https://github.com/microsoft/api-guidelines
