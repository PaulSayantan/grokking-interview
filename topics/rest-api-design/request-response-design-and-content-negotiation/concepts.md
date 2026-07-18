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

## The Prefer request header and return=minimal

**`Prefer` (RFC 7240)** lets a client state a *preference* for how the server processes
a request — a hint the server MAY honor or ignore. The most important preference for
response design is **`return`**, which controls whether a write echoes the resource:

```http
POST /orders HTTP/1.1
Content-Type: application/json
Prefer: return=minimal          <-- "don't send the resource body back"

{ "items": [...] }
```
```http
HTTP/1.1 201 Created
Location: /orders/98f3
Preference-Applied: return=minimal   <-- server confirms it honored the preference
```

- **`return=minimal`** → the server SHOULD return an empty/`204 No Content` (or `201`
  with just headers) instead of the full representation. This is *the* standards answer
  to "how does a client tell the server **not** to echo the resource after a POST/PUT/
  PATCH?" It saves bandwidth on high-throughput writers.
- **`return=representation`** → explicitly ask for the full resource body back (useful
  when the server's default is minimal).
- **`handling=strict` / `handling=lenient`** → whether the server should hard-fail on
  problems it could otherwise tolerate (e.g. unknown fields).
- **`respond-async`** → asking for asynchronous handling, typically answered with
  **`202 Accepted`** and a status/polling location.
- **`wait=<seconds>`** → bound how long the server should block (pairs with
  `respond-async`).

Rules that matter:

- Because `Prefer` is optional, the server **MUST send `Preference-Applied`** listing the
  preferences it actually honored whenever the client cannot otherwise tell — e.g. after
  `return=minimal` there is no body to reveal what happened.
- A response that varies by `Prefer` and is cacheable needs **`Vary: Prefer`**, otherwise
  a cache could serve a bodyless response to a client that wanted the representation.
- `Prefer` is a *preference*, not a directive — a server is free to ignore it. Contrast
  with `Expect: 100-continue`, which is a mandatory protocol interaction.

> [!INTERVIEW]
> "A batch job POSTs 10k rows and doesn't need the created bodies back — how does it say
> so on the wire?" Answer: `Prefer: return=minimal`, server replies `201/204` with
> `Preference-Applied: return=minimal` and no body (add `Vary: Prefer` if cached).

## Problem Details error bodies (RFC 9457)

**RFC 9457** (which obsoletes RFC 7807) standardizes a machine-readable error body so you
don't invent a bespoke error shape per API. Media type **`application/problem+json`**
(or `application/problem+xml`). The five standard members:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Your request body was invalid",
  "status": 422,
  "detail": "The 'quantity' field must be a positive integer.",
  "instance": "/orders/98f3/attempts/7",
  "errors": [
    { "detail": "must be > 0", "pointer": "/items/0/qty" },
    { "detail": "unknown SKU",  "pointer": "/items/1/sku" }
  ]
}
```

- **`type`** — a URI identifying the *problem type* (the primary key of the error).
  Default is `about:blank`, which means "no specific type; use the status code's meaning."
  The URI need not be dereferenceable, but SHOULD point at human-readable docs if it is
  (RFC 9457 §3.1.1). Clients should key logic off `type`, not off `title`/`detail` text.
- **`title`** — a short, human-readable, *type-stable* summary (same for all instances of
  a type; don't put per-request data here).
- **`status`** — the HTTP status code, **advisory/duplicated** for out-of-band contexts;
  it MUST match the actual response status line. It does not replace it.
- **`detail`** — human-readable explanation *specific to this occurrence*.
- **`instance`** — a URI identifying this specific occurrence of the problem.

Key points:

- **Extension members** are allowed and encouraged — e.g. an `errors[]` array for
  per-field validation failures (using a JSON Pointer or field name). This is how you
  answer "design the error body for a 3-field validation failure": one Problem Detail
  with an `errors` extension listing each field.
- RFC 9457 added a **"HTTP Problem Types" IANA registry** (§4.2) — the headline change
  from 7807 — so common problems can share well-known `type` URIs.
- Don't leak internals (stack traces, SQL) into `detail`. The `type`/`title` are the
  stable contract; `detail`/`instance` vary per occurrence.
- Zalando's guidelines *mandate* Problem JSON; Google AIP-193 and Microsoft's guidelines
  define close analogues. Knowing RFC 9457 by name is table stakes at senior level.

## GET with a body and the HTTP QUERY method

**A body on `GET` has undefined semantics (RFC 9110 §9.3.1).** A GET request MAY include
a body, but there are *no defined semantics* for it; a server MAY reject such a request or
ignore the body, and intermediaries/caches will not include it in the cache key. The same
caveat applies to `DELETE`. So "GET with a body" is never a safe design.

This creates the classic **search trilemma** for a large filter payload:

| Approach | Problem |
|---|---|
| `GET /search?filter=...` | URI length limits (proxies/servers cap ~8 KB); leaks filters into logs |
| `GET` with a JSON body | Undefined semantics; not cacheable; often stripped |
| `POST /search` | Works, but POST is neither safe nor idempotent, so **not cacheable** |

**The HTTP `QUERY` method** (RFC 10008, 2026) resolves this. QUERY is **safe and
idempotent** like GET, but carries a **request body** describing the query:

```http
QUERY /orders HTTP/1.1
Content-Type: application/json
Accept: application/json

{ "filter": { "status": "PENDING", "createdAfter": "2026-01-01" }, "sort": ["-createdAt"] }
```

- **Cacheable** — and crucially the **request body is part of the cache key**, so two
  QUERYs with different bodies cache separately (unlike POST).
- The server MAY advertise which query media types it accepts via **`Accept-Query`**.
- A QUERY that produces a new resource/result location uses `Content-Location`/`Location`
  conventions to point at the concrete result representation.

> [!INTERVIEW]
> "A client sends a 20 KB search filter — GET-with-body, POST, or something else, and how
> do you keep it cacheable?" Strong answer: not GET (undefined body, URI limits) and not
> plain POST (uncacheable); use the **QUERY** method — safe, idempotent, body-in-cache-key
> — or fall back to POST with an explicit cache strategy if QUERY isn't available.

## I-JSON, binary data, and multipart payloads

**I-JSON (RFC 7493, "Internet JSON")** is a restricted *profile* of JSON (RFC 8259)
designed for maximum interoperability. Naming it lets you consolidate the "safe JSON"
rules under one authority:

- **No duplicate object keys.** RFC 8259 only *SHOULD* forbid them; I-JSON *MUST*. This is
  a real security issue — parsers disagree (first-wins vs last-wins), so a duplicate key
  can drive request-smuggling / authorization-bypass when a validator and an executor see
  different values (e.g. `{"role":"user","role":"admin"}`).
- **Object member order carries no meaning** — never depend on it.
- **UTF-8 is mandatory**; no unpaired surrogates.
- **Numbers**: keep integers within ±(2^53−1) and avoid relying on more than
  IEEE-754-double precision (the large-ID / money rule again).
- **Binary data as base64url strings** (see below).

**Carrying binary bytes in JSON:**

- **base64 in a JSON string** — simple, but inflates size ~33% and costs encode/decode CPU.
  Note **base64** (`+`,`/`,`=`) vs **base64url** (`-`,`_`, no padding) — I-JSON recommends
  base64url so the value is URL/filename-safe. Fine for small blobs (thumbnails, keys).
- **A separate binary media type** — return the bytes with their real `Content-Type`
  (`image/png`) at a sub-resource URI, and link to it from the JSON. Best for large blobs.
- **`multipart/form-data`** — combine a JSON metadata part with a raw binary file part in
  one request; each part has its own `Content-Type`. This avoids base64-bloating a large
  file into a JSON string:

```http
POST /documents HTTP/1.1
Content-Type: multipart/form-data; boundary=X

--X
Content-Disposition: form-data; name="metadata"
Content-Type: application/json

{ "title": "Q3 report", "tags": ["finance"] }
--X
Content-Disposition: form-data; name="file"; filename="q3.pdf"
Content-Type: application/pdf

%PDF-1.7 ...binary...
--X--
```

`multipart/mixed` is the sibling for a sequence of parts without form semantics. Rule of
thumb: **don't base64 a multi-MB file into JSON** — use multipart or a separate upload URL.

## Streaming response shapes: NDJSON, JSON sequences, and SSE

Returning "10 million rows" as one JSON array (`[ {...}, {...}, ... ]`) forces both server
and client to **buffer the entire array** before the first/last element is usable — a
memory bomb with no backpressure. Streaming formats emit one record at a time:

| Format | Media type | Delimiter | Notes |
|---|---|---|---|
| **NDJSON / JSON Lines** | `application/x-ndjson` (JSONL) | `\n` newline | One JSON value per line; incrementally parseable line-by-line |
| **JSON Text Sequences** | `application/json-seq` (RFC 7464) | `0x1E` (RS) prefix + `\n` | Self-synchronizing; a truncated record is detectable |
| **Server-Sent Events** | `text/event-stream` | `data:` lines, `\n\n` | Push channel over one HTTP response; auto-reconnect, `id:`/`event:` fields |

- These pair with the streaming transport: **`Transfer-Encoding: chunked`** (HTTP/1.1)
  or HTTP/2/3 framing, because the total length isn't known up front (so no
  `Content-Length`).
- NDJSON's win over a JSON array: a consumer can process and discard each record, applying
  **backpressure** and bounding memory. A `[...]` array is not incrementally valid until
  the closing `]`.
- SSE is for server→client *push* (notifications, progress); NDJSON/json-seq are for
  streaming a large *result set*. Don't confuse them with WebSockets (full-duplex, not HTTP
  request/response semantics).

## Payload integrity: Content-Digest and Repr-Digest

**RFC 9530** (obsoletes the RFC 3230 `Digest` header) defines integrity fields so a
recipient can verify a body wasn't corrupted in transit — useful across proxies where TLS
only protects each hop, not end-to-end:

- **`Content-Digest`** — a digest of the **actual message content** (the specific bytes on
  this hop, *after* content coding / range selection). Changes if the body is gzipped or a
  range is returned.
- **`Repr-Digest`** — a digest of the **full representation** (the resource's bytes
  independent of encoding/range). Stable across `Content-Encoding` and range requests.
- This **Content-vs-Repr split exactly parallels `Content-Encoding` vs the underlying
  representation**: `Content-Digest` is the on-the-wire bytes, `Repr-Digest` is the
  logical resource.
- **`Want-Content-Digest` / `Want-Repr-Digest`** let a client ask the server to include a
  digest (with algorithm preferences via q-values, e.g. `sha-256`, `sha-512`).
- Limitation: these protect **only the body, not headers**. For end-to-end integrity over
  selected headers you pair them with **HTTP Message Signatures (RFC 9421)**.

> [!INTERVIEW]
> "Two proxies disagree about where a body got corrupted — how do you localize it?" TLS
> gives per-hop integrity only; add `Repr-Digest`/`Content-Digest` so any hop (or the
> client) can verify the body against the origin's digest.

## Content-Location versus Location

Two headers that name a URI, frequently confused:

- **`Location`** — points at a *different* resource: the newly created resource (`201`),
  or the target of a redirect (`3xx`), or the status monitor for an async op (`202`). "Go
  here next."
- **`Content-Location`** — names the **canonical URI of the representation in *this*
  response body**. Under content negotiation it identifies the *specific negotiated
  variant*, so a client can cache or bookmark the concrete representation directly:

```http
GET /articles/42 HTTP/1.1
Accept: application/json
Accept-Language: fr
```
```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Language: fr
Content-Location: /articles/42.fr.json    <-- the concrete variant this body IS
Vary: Accept, Accept-Language
```

So `Content-Location` is directly a **content-negotiation** tool: the negotiated URL of
the variant you just received. `Location` is about *where else to go*.

## Message framing: Content-Length versus chunked transfer

A recipient must know where a message body ends. Two framing mechanisms:

- **`Content-Length`** — an exact byte count, used when the length is known up front.
- **`Transfer-Encoding: chunked`** — used when the length is *unknown* (streaming a
  generated response). The body arrives as size-prefixed chunks terminated by a zero-length
  chunk. This is **hop-by-hop** and distinct from `Content-Encoding` (end-to-end payload
  transform).

**Security — request smuggling:** if a message carries *both* `Content-Length` and
`Transfer-Encoding: chunked`, RFC 9112 says `Transfer-Encoding` wins and the
`Content-Length` MUST be treated as an error. When a front-end proxy and a back-end server
disagree about which to honor, an attacker can smuggle a second request past the front-end
(**CL.TE / TE.CL** attacks). Robust servers reject messages that contain both.

## Range requests and partial transfer

**Range requests (RFC 9110 §14)** transfer only *part of a representation's bytes* —
distinct from sparse fieldsets, which project *part of a resource's fields*. Interviewers
probe whether you conflate the two:

- Server advertises support with **`Accept-Ranges: bytes`**.
- Client asks with **`Range: bytes=0-1023`**.
- Server answers **`206 Partial Content`** with **`Content-Range: bytes 0-1023/2048`**,
  or **`416 Range Not Satisfiable`** if the range is invalid.
- Conditional ranges use `If-Range` (with an ETag/date) so a resume only proceeds if the
  resource hasn't changed. Used for download resumption, video seeking, parallel fetch.

**Range/206 = partial *transfer* (which bytes). Sparse fieldsets = partial *projection*
(which fields).** They operate on different axes and can coexist.

## Vary and cache-key mechanics

`Vary` (RFC 9111) is deeper than "just send it." A shared cache keys a stored response by
the request URL **plus** the request-header values named in `Vary`:

- Each distinct combination of the listed request-header values is a **separate cache
  entry**. `Vary: Accept-Encoding` correctly splits gzip vs identity variants.
- **`Vary: *`** means the response is effectively **uncacheable by shared caches** — the
  variance depends on something outside the request headers.
- **High-cardinality headers destroy hit rate.** `Vary: User-Agent` explodes into
  thousands of entries (one per UA string) — almost always a mistake. Normalize/collapse
  such dimensions server-side instead.
- **`Vary: Cookie` / `Vary: Authorization`** are dangerous: they can either poison the
  cache (serving one user's private response to another if `Vary` is *missing*) or make
  the response effectively per-user (useless in a shared cache). Private responses should
  use `Cache-Control: private`, not just `Vary`.
- CDNs often **normalize `Accept-Encoding`** to a few canonical values before keying so
  minor UA header ordering doesn't fragment the cache.
- You must `Vary` on *every* request header the representation was negotiated on — miss
  one (e.g. `Accept-Language`) and a cache serves the wrong variant.

## JSON Patch versus JSON Merge Patch

PATCH (RFC 5789) is the method; the *body format* is a separate contract. Two standard
formats, with different media types and trade-offs:

**JSON Merge Patch (RFC 7396)** — media type `application/merge-patch+json`. The patch
looks like the target document; the server recursively merges it:

```json
{ "name": "New name", "nickname": null }
```

- Simple and readable; `null` **deletes** a member, absence leaves it unchanged.
- **Cannot set a value *to* `null`** (null is overloaded as delete) and **cannot patch
  array elements** — arrays are replaced wholesale, which is painful for large lists.

**JSON Patch (RFC 6902)** — media type `application/json-patch+json`. An *ordered array of
operations* addressed by **JSON Pointer**:

```json
[
  { "op": "test",    "path": "/version", "value": 7 },
  { "op": "replace", "path": "/name",    "value": "New name" },
  { "op": "remove",  "path": "/nickname" },
  { "op": "add",     "path": "/tags/-",  "value": "urgent" }
]
```

- Operation set: **`add`, `remove`, `replace`, `move`, `copy`, `test`**.
- Can target individual array positions (`/tags/0`, `/tags/-` to append).
- **`test`** enables **optimistic concurrency**: the whole patch fails atomically if a
  value isn't what the client expected (a body-level analogue of `If-Match`/ETag).
- More expressive but more verbose and harder to author than Merge Patch.

Rule of thumb: Merge Patch for simple field updates on object-shaped resources; JSON Patch
when you need array-element edits, moves, or `test`-based concurrency.

## Structured syntax suffixes beyond +json

The structured-syntax-suffix mechanism (RFC 6839) is not limited to `+json`. A suffix tells
a *generic* parser the underlying syntax so it can dispatch even on an unknown type:

- **`+json`** (RFC 8259), **`+xml`**, **`+cbor`** (binary JSON-like), **`+zip`**,
  **`+json-seq`**, **`+ber`/`+der`**, etc.
- Well-known types that lean on `+json`: `application/problem+json` (RFC 9457),
  `application/hal+json` (HAL), `application/vnd.api+json` (JSON:API),
  `application/ld+json` (JSON-LD).
- A proxy/library can strip the suffix to decide "parse as JSON/XML" even if it has never
  heard of the vendor subtype — which is exactly why vendor media types append a suffix.

## Enum evolution and forward compatibility

"Send enums as strings" is only half the story; the harder question is **what happens when
you add a new enum value**:

- Adding a value is a **breaking change for strict clients** that reject unknown values
  (e.g. a generated client whose deserializer throws on an unrecognized string). It is
  *non*-breaking for clients built to the **"must ignore unknown values"** contract.
- Best practice (Google AIP-126): **document a must-ignore rule**, and reserve a sentinel
  member such as `UNSPECIFIED`/`UNKNOWN` (proto3 makes `0 = *_UNSPECIFIED`) so a client can
  map values it doesn't recognize to a safe default instead of crashing.
- Because of this, whether "add an enum value" is safe **depends on the client contract you
  published** — state the extensibility rule up front, the same way you document
  null-vs-omission and unknown-field handling (`handling=strict|lenient`).

## Compression trade-offs and attacks

Beyond BREACH (already noted), the senior-level compression picture:

- **BREACH** (HTTP-response-body level) and **CRIME** (TLS/SPDY-header level, historical,
  largely mitigated by disabling TLS-level compression) both exploit the fact that
  compression **leaks the length** of a secret when it sits next to attacker-controlled
  reflected input. Mitigations: don't compress responses mixing a secret (CSRF token) with
  reflected input, or mask/randomize the token per request.
- **Decompression bombs (zip bombs)** are a *request-side* DoS: a client sends a tiny
  `Content-Encoding: gzip` body that expands to gigabytes. Servers that accept compressed
  request bodies MUST **bound the decompressed size** and abort past a limit.
- Named codings and their specs: **gzip** (RFC 1952), **Brotli `br`** (RFC 7932),
  **zstd** (RFC 8878), **deflate**, **`identity`** (no coding). Brotli/zstd generally beat
  gzip on ratio; negotiate via `Accept-Encoding` q-values.

## 406, 415, and advertising acceptable types

Refinements to the 406/415 story:

- **In practice most APIs/frameworks don't return `406`** — RFC 9110 explicitly permits
  serving a default representation the client didn't ask for rather than failing, and that
  is what most stacks do. `406` is the strict-correct answer but is rarely emitted.
- On a `415 Unsupported Media Type` (bad request `Content-Type`) the server SHOULD tell the
  client what it *would* accept via the companion headers **`Accept-Post`** (for POST) and
  **`Accept-Patch`** (for PATCH). These are the request-body analogue of `Accept`.
- **q-value edge cases:** specificity ordering is `text/plain;format=flowed` >
  `text/plain` > `text/*` > `*/*` (more parameters / more specific range wins ties).
  **`q=0` means "not acceptable"** — an explicit *rejection* of that type, not merely low
  priority. When two ranges tie on q and specificity, servers may break the tie by their
  own preference.

## Bodyless responses: 204 and 304

Some status codes forbid a response body: **`204 No Content`** and **`304 Not Modified`**
MUST NOT include one (a `304` may carry validators like `ETag` but no body). This ties back
to `Prefer: return=minimal`, which is precisely how a client asks a write to answer with a
bodyless `204`/`201` rather than echoing the resource.

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
- **How does a client say "don't send the body back" after a write?** `Prefer:
  return=minimal`; the server answers `204`/`201` with `Preference-Applied: return=minimal`
  (and `Vary: Prefer` if cached).
- **How do you send a large search filter and keep it cacheable?** Not GET-with-body
  (undefined semantics, RFC 9110 §9.3.1) and not plain POST (uncacheable) — use the HTTP
  **QUERY** method (safe, idempotent, request body in the cache key).
- **What's the standard error body?** RFC 9457 Problem Details (`application/problem+json`):
  `type`, `title`, `status`, `detail`, `instance`, plus extension members like `errors[]`.
- **`Location` vs `Content-Location`?** `Location` = another resource (created/redirect/
  async monitor); `Content-Location` = canonical URI of the representation in *this* body
  (the specific negotiated variant).
- **Partial response vs partial representation?** Range/`206` transfers part of the *bytes*;
  sparse fieldsets project part of the *fields*. Different axes.
- **How do you stream a huge result set?** NDJSON (`application/x-ndjson`) or JSON sequences
  (`application/json-seq`) over chunked transfer — not one buffered JSON array; SSE for push.
- **Is adding an enum value breaking?** Depends on the client's unknown-value handling;
  publish a must-ignore rule and reserve `UNSPECIFIED` (AIP-126).

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
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) (`application/problem+json`, obsoletes 7807, §4.2 registry)
- [RFC 7240 — Prefer Header for HTTP](https://www.rfc-editor.org/rfc/rfc7240.html) (`return=minimal`, `Preference-Applied`)
- [RFC 7493 — The I-JSON Message Format](https://www.rfc-editor.org/rfc/rfc7493.html) (interoperable JSON profile)
- [RFC 9530 — Digest Fields](https://www.rfc-editor.org/rfc/rfc9530.html) (`Content-Digest`/`Repr-Digest`, obsoletes 3230)
- [RFC 7464 — JavaScript Object Notation (JSON) Text Sequences](https://www.rfc-editor.org/rfc/rfc7464.html) (`application/json-seq`)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html) (`Vary`, cache keys)
- [RFC 9112 — HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html) (message framing, `Content-Length` vs chunked, smuggling)
- [RFC 5789 — PATCH Method for HTTP](https://www.rfc-editor.org/rfc/rfc5789.html)
- [RFC 7932 — Brotli](https://www.rfc-editor.org/rfc/rfc7932.html) / [RFC 8878 — Zstandard](https://www.rfc-editor.org/rfc/rfc8878.html)
- [RFC 10008 — The HTTP QUERY Method](https://www.rfc-editor.org/rfc/rfc10008.html) (safe/idempotent method with a request body, cacheable on body)
- [Google AIP-126 (enums), AIP-157 (partial responses), AIP-193 (errors)](https://google.aip.dev/)
- [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines) / [Zalando RESTful API Guidelines](https://opensource.zalando.com/restful-api-guidelines/)
- [RFC 5646 / BCP 47 — Tags for Identifying Languages](https://www.rfc-editor.org/rfc/rfc5646.html)
- [OWASP API Security Top 10 (2023) — API3:2023 Broken Object Property Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/)
- [JSON:API specification](https://jsonapi.org/format/) (sparse fieldsets, `data` envelope, `include`)
- [Google JSON Style Guide](https://google.github.io/styleguide/jsoncstyleguide.xml) (camelCase, partial response)
