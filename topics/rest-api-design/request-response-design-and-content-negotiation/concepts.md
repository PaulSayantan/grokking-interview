# Request/Response Design & Content Negotiation

How you shape the bytes on the wire — the request and response bodies, the headers
that describe them, and the negotiation dance that picks a representation — is the
part of an API a client actually consumes. This topic is **framework-agnostic**: it
is about the HTTP/wire contract and the design discipline behind it, grounded in
RFC 9110 (HTTP Semantics), not in any one framework's serialization APIs.

> [!KEY-TAKEAWAY]
> A resource has an abstract state; a *representation* is one concrete rendering of
> that state (JSON, XML, a specific language, a specific field subset). Content
> negotiation is the protocol for the client and server to agree on which
> representation to exchange. Design the representation deliberately — it is your
> long-lived public contract.

## DTO and payload shaping

A **DTO** (Data Transfer Object) is the shape of the JSON you send over the wire. The
core discipline: the wire payload is a *deliberately designed contract*, decoupled
from your internal domain/persistence model. Never serialize your database entity
straight to the client.

Why it matters:

- **Security / over-exposure.** Leaking `passwordHash`, `internalScore`, `isAdmin`,
  or soft-delete flags is a real breach class — OWASP API Security Top 10 (2023) calls
  it **API3:2023 Broken Object Property Level Authorization** (the merger of the old
  "excessive data exposure" and "mass assignment"). Return only fields the client is
  authorized to see.
- **Stability.** If the wire shape mirrors your table, every schema migration risks a
  breaking API change. A DTO is a translation layer that lets the two evolve
  independently.
- **Mass assignment on the way in.** Accepting a full entity on write lets a client set
  fields they shouldn't (`role`, `accountBalance`, `id`). Bind writes to an explicit
  *input* DTO with an allowlist of settable fields — never blind-bind the request body
  to a domain object.

Request and response DTOs are usually **asymmetric**. The input to create a resource is
not the output:

```http
POST /orders HTTP/1.1
Content-Type: application/json

{ "items": [{ "sku": "A-100", "qty": 2 }], "couponCode": "SPRING" }
```

```http
HTTP/1.1 201 Created
Location: /orders/98f3
Content-Type: application/json

{
  "id": "98f3",
  "status": "PENDING",
  "items": [{ "sku": "A-100", "qty": 2, "unitPriceCents": 1999 }],
  "totalCents": 3798,
  "createdAt": "2026-07-19T14:32:05Z"
}
```

Note what the server added (`id`, `status`, `totalCents`, `createdAt`, `Location`) and
what it ignored/derived. Server-controlled fields must be read-only on input.

> [!WARNING]
> "Just return the entity, it's faster to code" is the single most common source of
> both data-exposure vulnerabilities and accidental breaking changes. Design the DTO.

Advanced considerations interviewers probe:

- **Collections vs single-resource shape.** List endpoints often return a *summary*
  representation (fewer fields) and the item endpoint returns the *full* representation.
  Document both.
- **Embedding vs linking.** For `GET /orders/98f3`, do you embed the full `customer`
  object or return `customerId` / a link? Embedding cuts round-trips but couples and
  bloats; linking is leaner but chattier. Choose per access pattern, and consider
  making it opt-in (see sparse fieldsets / embedding params).
- **Enums as strings, not ordinals.** Send `"status": "PENDING"`, never `"status": 0`.
  Ordinals break the instant someone reorders the enum.
- **Money as integer minor units or decimal strings**, never IEEE-754 floats (see
  date/number formatting).

## JSON field naming conventions

JSON has no mandated case convention, so pick one and enforce it API-wide. The three
common styles:

| Convention | Example | Ecosystem where common |
|---|---|---|
| `camelCase` | `firstName`, `createdAt` | JavaScript/TS, Java, most JSON APIs |
| `snake_case` | `first_name`, `created_at` | Python, Ruby, Stripe, Twitter/X, GitHub |
| `PascalCase` | `FirstName` | .NET (legacy), some enterprise APIs |

Guidance:

- **Consistency beats correctness.** The single most important rule is that the *entire*
  API uses one convention. Mixing `first_name` and `lastName` in the same payload is a
  hallmark of leaking multiple internal models.
- **`camelCase`** is the most common choice for new JSON APIs because it maps cleanly to
  JavaScript object property access (`user.firstName`) without bracket syntax.
- **`snake_case`** is favored by APIs whose primary audience or implementation is Python/
  Ruby, and is used by several large public APIs (Stripe, GitHub).
- Google's JSON Style Guide recommends `camelCase`; many style guides simply say "be
  consistent."

Gotchas:

- The case convention is part of your **contract**. You cannot silently switch from
  `snake_case` to `camelCase` without breaking every client — that's a breaking change
  requiring versioning.
- Don't let your serializer's default leak an unintended convention (e.g., a framework
  defaulting to `PascalCase`). Configure it explicitly.
- Acronyms need a rule: is it `userId`/`userID`, `htmlUrl`/`htmlURL`? Pick one
  (`userId`, `htmlUrl` — treat acronyms as words) and apply it uniformly.
- Field names should be stable, descriptive nouns. Avoid abbreviations that need a
  glossary (`usr_nm`).

## Nulls versus omission

For an optional field with no value, you can send `null` or **omit the key entirely**.
These are semantically different and clients handle them differently.

```json
{ "nickname": null }      // key present, explicit "no value"
{ }                        // key absent
```

Semantics to establish and document:

- **`null` = "this field exists and is explicitly empty/unset."**
- **Omission = "no information about this field"** (unknown, not applicable, or simply not
  included in this representation).

Design guidance:

- Be **consistent and documented** — clients must know which pattern you use. JSON Schema
  distinguishes a property being `required` (must be present) from being `nullable`
  (may be `null`); these are independent axes.
- Many teams **omit null/empty fields from responses** to shrink payloads, but this makes
  the response shape vary per record, forcing clients to code defensively. Others always
  include every documented field (as `null` when empty) for a **stable, predictable
  shape**. Both are valid — decide and state it.
- **Empty array vs null vs omitted** for collections: prefer a consistent `[]` for "no
  elements" rather than `null` or omission; it lets clients iterate without null checks.

The killer distinction — **PATCH semantics**:

With `PATCH` (especially JSON Merge Patch, RFC 7396) the two are *not* interchangeable:

```http
PATCH /users/42 HTTP/1.1
Content-Type: application/merge-patch+json

{ "nickname": null }
```

In JSON Merge Patch, **`null` means "delete/clear this field"**, while **omitting the key
means "leave it unchanged."** So a client that wants to clear a value must send `null`;
a client that sends `{}` changes nothing. This is exactly why you cannot treat
null-vs-absent as equivalent on the write path. (JSON Merge Patch's inability to set a
value *to* `null` — because `null` is overloaded as "delete" — is a known limitation;
JSON Patch, RFC 6902, avoids it with explicit operations.)

> [!INTERVIEW]
> "What's the difference between sending `null` and omitting a field?" On reads it's a
> presence-vs-empty distinction you must document; on a JSON Merge Patch write `null`
> means *delete the field* and absence means *don't touch it* — a frequent bug source.

## Media types and the Content-Type and Accept headers

A **media type** (a.k.a. MIME type, `type/subtype[;params]`, e.g. `application/json;
charset=utf-8`) names the format of a representation. Two headers use it, and confusing
them is a classic mistake:

| Header | Set by | Means |
|---|---|---|
| `Content-Type` | sender (client or server) | "The body I am sending **is** this media type." |
| `Accept` | client (request) | "The media types I am **willing to receive**, ranked." |

```http
POST /invoices HTTP/1.1
Content-Type: application/json      <-- describes THIS request body
Accept: application/json, application/xml;q=0.8   <-- what I want back
```

```http
HTTP/1.1 201 Created
Content-Type: application/json      <-- describes THIS response body
```

Key rules from RFC 9110:

- `Content-Type` describes the body *actually present*. A request/response with no body
  needs no `Content-Type`. Sending `Content-Type: application/json` with an XML body is
  a lie clients/servers may reject.
- On a request, the server that can't parse the sent `Content-Type` returns
  **`415 Unsupported Media Type`**.
- On a request, if the server cannot produce *any* media type from the client's `Accept`,
  it returns **`406 Not Acceptable`** (or, pragmatically, ignores `Accept` and returns
  its default — RFC 9110 permits serving a non-acceptable representation, but 406 is the
  strict answer).
- **`q` values** (quality, 0–1, default 1) rank preferences. `Accept: text/html,
  application/json;q=0.9, */*;q=0.1` means "HTML best, JSON next, anything else as a last
  resort." More specific types outrank wildcards; `*/*` is the catch-all.
- Charset: for JSON, `charset` is effectively always UTF-8 (RFC 8259 mandates UTF-8 for
  JSON exchanged between systems), and the `application/json` media type does not even
  define a `charset` parameter — so `charset=utf-8` on JSON is at best redundant.

Gotchas:

- `Content-Type` on a `GET` request is meaningless (no request body) — don't rely on it.
- A `200 OK` that returns HTML when the client sent `Accept: application/json` is a
  content-negotiation bug, not a feature.

## Server-driven versus agent-driven content negotiation

RFC 9110 names two mechanisms for choosing a representation.

**Proactive / server-driven negotiation:** the client sends preference headers (`Accept`,
`Accept-Language`, `Accept-Encoding`, `Accept-Charset`), and the *server* picks the best
representation and returns it directly (usually `200`).

```http
GET /articles/42 HTTP/1.1
Accept: application/json
Accept-Language: fr-CA, fr;q=0.9, en;q=0.5
```

- Pros: one request, no extra round-trip; standard headers.
- Cons: the server must guess; headers may not capture true user intent; caches must
  `Vary` on the negotiated headers to avoid serving the wrong representation.

**Reactive / agent-driven negotiation:** the server responds with a list of available
representations (historically **`300 Multiple Choices`**) and lets the *client/agent*
choose by following one of the offered URIs.

- Pros: the agent (or user) makes the choice; avoids server guessing.
- Cons: extra round-trip; no widely-adopted standard format for the choice list, so it's
  rare in practice.

A common **practical hybrid** in REST APIs is putting the format in the URL —
`/articles/42.json` vs `/articles/42.xml`, or `?format=json`. This is sometimes called
"URI-driven" negotiation. It's cache-friendly and trivially debuggable, at the cost of
having multiple URIs for one resource (which can muddy the "one canonical URI" ideal).

> [!TIP]
> `Vary` is the linchpin of correct caching under server-driven negotiation. If a
> response depends on `Accept-Language`, you MUST send `Vary: Accept-Language` so a shared
> cache doesn't hand a French response to an English client.

Advanced points:

- The negotiation dimensions are orthogonal: type (`Accept`), language
  (`Accept-Language`), encoding (`Accept-Encoding`), charset (`Accept-Charset`).
- Server-driven negotiation is fine for format/language but a poor fit for
  device-specific responses (better handled by a BFF or explicit params) because
  `User-Agent` sniffing is brittle.

## Accept-Language, Accept-Charset and Accept-Encoding

These are the other proactive-negotiation request headers, each with a paired response
concern:

| Request header | Negotiates | Response side |
|---|---|---|
| `Accept` | media type / format | `Content-Type` |
| `Accept-Language` | natural language | `Content-Language` + `Vary: Accept-Language` |
| `Accept-Encoding` | content coding (compression) | `Content-Encoding` + `Vary: Accept-Encoding` |
| `Accept-Charset` | character set | (deprecated) |

**`Accept-Language`** carries BCP 47 / RFC 5646 language tags with `q`-weights:

```http
Accept-Language: fr-CA, fr;q=0.9, en-US;q=0.8, en;q=0.7
```

The server localizes text it controls (labels, error messages) and echoes the chosen
language in **`Content-Language`**. It does *not* mean "translate arbitrary user data."
Always `Vary: Accept-Language` for cacheable localized responses.

**`Accept-Encoding`** negotiates **compression**, not character encoding. Values:
`gzip`, `br` (Brotli), `zstd`, `deflate`, `identity` (no coding).

```http
Accept-Encoding: br, gzip;q=0.8
```
```http
Content-Encoding: br
Vary: Accept-Encoding
```

`Content-Encoding` is an end-to-end transformation of the payload; `Transfer-Encoding`
(e.g. `chunked`) is hop-by-hop and a separate concept — don't conflate them.

**`Accept-Charset` is deprecated** (RFC 9110): servers should ignore it. UTF-8 is the
universal default; for JSON, UTF-8 is required by RFC 8259. Sending `Accept-Charset` in a
new API design is a red flag.

> [!WARNING]
> Compression + secrets over TLS can leak data if a response reflects attacker-controlled
> input alongside a secret (BREACH-class attacks). Be cautious compressing responses that
> mix secrets (e.g. CSRF tokens) with reflected user input.

## Vendor media types

For a bespoke JSON contract you can define a **vendor media type** using the `vnd.` tree
and the structured-syntax suffix `+json` (RFC 6838 registration procedures; the `+json`
suffix per RFC 6839):

```
application/vnd.github+json
application/vnd.example.order.v2+json
application/vnd.api+json           (JSON:API)
application/vnd.oai.openapi+json   (OpenAPI)
```

Anatomy: `application/vnd.<vendor>[.<subtype>][.<version>]+json`. The `+json` suffix tells
generic tooling "parse me as JSON" even though the type is custom.

Why use them:

- **Semantic contract, not just format.** `application/json` says "it's JSON";
  `application/vnd.example.order.v2+json` says "it's *our order v2 schema* in JSON." The
  media type carries meaning a generic parser can dispatch on.
- **Media-type versioning.** Putting the version in the media type lets clients negotiate
  it via `Accept` without changing the URL — a legitimate (if debated) versioning strategy:

```http
GET /orders/98f3 HTTP/1.1
Accept: application/vnd.example.order.v2+json
```

Registration trees (RFC 6838):

- **`vnd.`** — vendor tree, for a specific product/organization (most common for APIs).
- **`prs.`** — personal/vanity tree.
- **`x.`** — unregistered/experimental (avoid in public contracts; the old `x-` prefix
  for parameters and such is discouraged by RFC 6648).
- Standards-tree names (no prefix, like `application/json`) require IANA registration.

Trade-offs / gotchas interviewers raise:

- Media-type versioning keeps URIs stable and is "more RESTful," but it's **harder to test
  in a browser** (you can't set `Accept` in an address bar) and harder to `curl` casually;
  URL-based versioning (`/v2/...`) is more discoverable. Many teams choose URL versioning
  for public APIs for exactly this reason.
- Custom media types with generic tools: clients/proxies that only special-case
  `application/json` may not recognize `application/vnd.foo+json` — the `+json` suffix
  exists precisely to mitigate this, but not all tooling honors it.
- JSON:API, HAL (`application/hal+json`), and Problem Details
  (`application/problem+json`, RFC 9457) are standardized `+json` media types worth
  knowing by name.

## Partial responses and sparse fieldsets

**Partial response / sparse fieldset / field selection** lets a client ask for a *subset*
of fields to cut payload size and over-fetching — a frequent answer to "how do you avoid
GraphQL-style over-fetching in REST?"

Common patterns (all query-param conventions; there is no single RFC standard):

```http
GET /users/42?fields=id,name,email            # flat allowlist (Google-style)
GET /users/42?fields=id,name,address(city,zip) # nested selection (Google partial-response)
GET /articles?fields[articles]=title,body      # JSON:API sparse fieldsets, per-type
```

Design considerations:

- **`fields` selects which properties to include** (projection). It's distinct from
  **filtering** (`?status=active`, which selects *which resources/rows*) and from
  **pagination**. Interviewers test whether you conflate projection with filtering.
- **Embedding/expansion** is the inverse lever: `?expand=customer` or `?include=author`
  pulls related resources *into* the response to cut round-trips. Sparse fieldsets shrink;
  expansion grows. Stripe (`expand[]`) and JSON:API (`include`) formalize this.
- Server should still enforce authorization per field — a `fields` param must not let a
  client request data they aren't allowed to see (that's a Broken Object Property Level
  Authorization issue).

Gotchas:

- **Caching:** two requests differing only by `fields=` are different representations of
  the same resource. Cache keys must include the query string (most caches key on the full
  URL, so this usually works), but be deliberate.
- **ETags:** a partial representation's `ETag` should reflect the partial content, or you
  risk conditional-request confusion.
- If you support nested selection you're effectively building a mini query language —
  weigh that complexity against just adopting GraphQL for genuinely graph-shaped needs.
- Always define behavior for an unknown/invalid field name (ignore silently vs `400`).
  Prefer explicit `400` for typo-catching.

## Envelope versus bare body

Should the response body be the resource itself (**bare**) or wrapped in a **envelope**
with metadata?

**Bare body** — the payload *is* the resource:

```json
{ "id": 42, "name": "Ada", "email": "ada@example.com" }
```

**Enveloped** — resource nested under a key, alongside metadata:

```json
{
  "data": { "id": 42, "name": "Ada" },
  "meta": { "requestId": "req_9f", "deprecation": null },
  "errors": []
}
```

Trade-offs:

| Aspect | Bare body | Envelope |
|---|---|---|
| Payload weight | Minimal | Extra nesting |
| Idiomatic HTTP | Yes — use status/headers for meta | Re-invents HTTP in the body |
| Pagination/collections | Needs a place for `next`/`total` | Natural home (`meta`, `links`) |
| Client ergonomics | Direct field access | Must unwrap `.data` everywhere |
| Consistency (item vs list) | Item bare, list needs wrapper anyway | Uniform shape everywhere |

Key principle: **use HTTP's own mechanisms for metadata before inventing an envelope.**
Status code carries success/failure; `Location`, `ETag`, `Link` (RFC 8288),
`X-Request-Id`, rate-limit headers carry metadata. An envelope that duplicates the status
code (`{"status": 200, ...}` in a `200` response) is an anti-pattern and can *mask* the
real HTTP status (some frameworks return `200` with an error in the body — this breaks
caching, monitoring, and generic clients).

Where envelopes genuinely help:

- **Collections/pagination** almost always need a wrapper so `next`/`prev`/`total` have a
  home: `{ "data": [...], "links": { "next": "..." }, "meta": { "total": 240 } }`.
  (RFC 8288 `Link` headers are the header-based alternative.)
- **Consistency for codegen**: a uniform `{data, meta, errors}` envelope can simplify
  generated clients. JSON:API mandates a `data` envelope for this reason.
- Cross-cutting metadata (deprecation notices, partial-result warnings) that has no
  natural header.

> [!INTERVIEW]
> A strong answer: "Bare bodies for single resources, lean on HTTP headers/status for
> metadata; a thin envelope only for collections where pagination links need a home — and
> never a `status` field that shadows the real HTTP status code."

## Date and number formatting with ISO 8601

**Dates/timestamps: use ISO 8601 / RFC 3339 strings, in UTC, with an explicit offset.**

```json
{ "createdAt": "2026-07-19T14:32:05Z" }        // UTC, "Z" = +00:00
{ "startsAt":  "2026-07-19T09:32:05-05:00" }   // explicit offset
{ "dueDate":   "2026-07-19" }                   // date-only, no time
```

Why:

- **Unambiguous and sortable.** ISO 8601 strings sort lexicographically in chronological
  order. `07/08/2026` is ambiguous (Jul 8 vs Aug 7); `2026-07-08` is not.
- **`Z` or an explicit offset removes timezone ambiguity.** A timestamp with no offset is
  a bug waiting to happen — the reader guesses the zone.
- RFC 3339 is the strict, interoperable profile of ISO 8601 used on the wire; prefer it.

Alternatives and when they apply:

- **Epoch seconds/milliseconds** (`1784471525`) are compact and unambiguous but
  human-unreadable and unit-ambiguous (seconds vs millis — a frequent bug). Some APIs use
  them; if you do, document the unit and be consistent.
- The **HTTP `Date`/`Last-Modified`/`Expires` headers** use a *different* format —
  IMF-fixdate (RFC 9110), e.g. `Sun, 19 Jul 2026 14:32:05 GMT`. That's for HTTP header
  fields, not JSON body fields; don't confuse the two.

**Numbers — the JSON float trap:**

- JSON numbers are, in practice, parsed as IEEE-754 doubles by most parsers. Integers
  larger than 2^53 − 1 (`9007199254740991`, `Number.MAX_SAFE_INTEGER`) **lose precision**.
  So a 64-bit `long` ID or a Twitter-style snowflake ID must be sent as a **string**, not
  a JSON number, to survive JavaScript clients intact.
- **Money must never be a float.** `0.1 + 0.2 !== 0.3` in IEEE-754. Represent money as an
  **integer count of minor units** (`"amountCents": 1999`) or as a **decimal string**
  (`"amount": "19.99"`) plus an explicit currency (`"currency": "USD"`, ISO 4217). Sending
  `19.99` as a JSON number invites rounding errors.
- Document units everywhere: `durationMs`, `distanceMeters`, `amountCents`. A bare
  `"amount": 1999` is ambiguous.

> [!WARNING]
> A 64-bit integer ID serialized as a JSON number is silently corrupted by any JavaScript
> client once it exceeds 2^53−1. Serialize large integer IDs as strings.

## Common follow-up questions

- **Why not just return the database entity as JSON?** Over-exposure of sensitive fields
  (OWASP API3:2023), mass-assignment on writes, and coupling the wire contract to schema
  migrations. Use request/response DTOs with explicit allowlists.
- **`camelCase` or `snake_case`?** Either — but be consistent across the whole API;
  switching later is a breaking change. `camelCase` is the common default for JS-facing
  JSON, `snake_case` for Python/Ruby-centric APIs.
- **`null` vs omitting a field — does it matter?** On reads, document which you mean
  (present-but-empty vs no-information). On a JSON Merge Patch write it's critical: `null`
  deletes the field, absence leaves it unchanged.
- **When do you return `415` vs `406`?** `415 Unsupported Media Type` when you can't parse
  the request's `Content-Type`; `406 Not Acceptable` when you can't produce anything the
  client's `Accept` allows.
- **What's the difference between `Content-Type` and `Accept`?** `Content-Type` describes
  the body being sent; `Accept` states what the client is willing to receive.
- **What does `Accept-Encoding` negotiate?** Compression (`gzip`, `br`, `zstd`), not
  character encoding. Charset for JSON is always UTF-8, and `Accept-Charset` is deprecated.
- **How do you avoid over-fetching in REST without GraphQL?** Sparse fieldsets
  (`?fields=...`) for projection and expansion (`?expand=...`) for related resources.
- **How would you version via media types?** `Accept: application/vnd.example.v2+json`;
  weigh it against URL versioning (more discoverable, browser/curl-friendly).
- **How do you send money and large IDs safely in JSON?** Money as integer minor units or
  decimal string + currency code; large 64-bit IDs as strings to dodge the 2^53 float limit.
- **Why must you send `Vary`?** So shared caches don't serve a representation negotiated
  for one client (e.g. French, gzip) to a client that asked for something else.

## References

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) (media types,
  `Content-Type`/`Accept`, proactive vs reactive negotiation, `406`/`415`, `Date` format,
  `Accept-Charset` deprecation)
- [RFC 3339 — Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339.html)
- [RFC 8259 — The JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259.html) (UTF-8 requirement)
- [RFC 7396 — JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396.html) (`null` = delete)
- [RFC 6902 — JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html)
- [RFC 6838 — Media Type Specifications and Registration Procedures](https://www.rfc-editor.org/rfc/rfc6838.html) (vnd./prs./x. trees)
- [RFC 6839 — Additional Media Type Structured Syntax Suffixes](https://www.rfc-editor.org/rfc/rfc6839.html) (`+json`)
- [RFC 8288 — Web Linking](https://www.rfc-editor.org/rfc/rfc8288.html) (`Link` header)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) (`application/problem+json`)
- [RFC 5646 / BCP 47 — Tags for Identifying Languages](https://www.rfc-editor.org/rfc/rfc5646.html)
- [OWASP API Security Top 10 (2023) — API3:2023 Broken Object Property Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/)
- [JSON:API specification](https://jsonapi.org/format/) (sparse fieldsets, `data` envelope, `include`)
- [Google JSON Style Guide](https://google.github.io/styleguide/jsoncstyleguide.xml) (camelCase, partial response)
