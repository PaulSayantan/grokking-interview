# API Documentation & Design-First with OpenAPI

An API's real contract is not the code that implements it — it is the set of
requests a client can send and the responses it can rely on. **OpenAPI** is the
industry-standard, machine-readable way to *write that contract down* so that
humans and tools agree on it. This topic is about the discipline of describing,
designing, and documenting HTTP APIs with OpenAPI — framework-agnostic, at the
wire-contract altitude.

The strong interview signal is that you treat the specification as a **first-class,
version-controlled artifact** that can drive documentation, mocks, client SDKs,
server stubs, and contract tests — not a `swagger.json` that gets auto-dumped by a
framework and drifts out of date. You should be able to reason about *design-first
vs code-first*, know the difference between **OpenAPI (the spec)** and **Swagger
(the tooling)**, and speak fluently about the document structure, `$ref` reuse, and
the 3.0 → 3.1 changes.

The anchor standards: **OpenAPI Specification 3.1** (which aligns its Schema Object
with **JSON Schema 2020-12**), and the underlying HTTP semantics of **RFC 9110**.

---

## OpenAPI vs Swagger

**What they are.** *OpenAPI* is the **specification** — a vendor-neutral,
language-agnostic format (YAML or JSON) for describing HTTP APIs, governed by the
OpenAPI Initiative under the Linux Foundation. *Swagger* is a **brand/toolset**
(now owned by SmartBear) that predates the donation of the spec.

**The history that trips people up.** The format was originally called the "Swagger
Specification." In 2015 SmartBear donated it to the newly formed OpenAPI Initiative,
and version 3.0 (2017) onward is called the **OpenAPI Specification (OAS)**. So:

| Term | Means |
|---|---|
| Swagger 2.0 | The old name for the spec (a.k.a. OpenAPI 2.0) |
| OpenAPI 3.0 / 3.1 | The current spec versions |
| Swagger UI | Tool: renders an OpenAPI doc as interactive HTML docs |
| Swagger Editor | Tool: browser editor with live validation/preview |
| Swagger Codegen | Tool: generates client SDKs / server stubs from a spec |

**Why it matters.** In an interview, saying "we use Swagger" is ambiguous. The
precise statement is "we describe the API with **OpenAPI 3.1** and render it with
**Swagger UI**." The spec is the standard; Swagger is one of many toolsets that
consume it (others: Redoc, Stoplight, Postman, Prism, openapi-generator).

> [!KEY-TAKEAWAY]
> OpenAPI = the *specification* (what you write). Swagger = a *family of tools*
> (UI, Editor, Codegen) that consume it. "Swagger 2.0" is the legacy name for the
> spec now called OpenAPI 2.0.

---

## Design-first vs code-first

**Two workflows for producing the spec.**

- **Design-first (a.k.a. contract-first / spec-first):** you *write the OpenAPI
  document first* — by hand or in a design tool — agree on it with consumers, then
  implement the server to match. The spec is the source of truth; code conforms to
  it.
- **Code-first (a.k.a. spec-later):** you write server code with annotations, and a
  library *generates* the OpenAPI document from that code as a build artifact. The
  code is the source of truth; the spec is derived.

**Trade-offs.**

| Dimension | Design-first | Code-first |
|---|---|---|
| Source of truth | The spec | The code |
| Early feedback | Consumers review before any code | Only after implementation |
| Parallel work | Frontend/mobile mock against spec immediately | Consumers wait for server |
| Drift risk | Server can diverge unless tested against spec | Spec always matches *this* code, but design accidents leak in |
| Design quality | Encourages deliberate, consistent design | API shape emerges from implementation details |
| Onboarding cost | Must learn OpenAPI authoring | Familiar (write code as usual) |

**Why design-first wins for public / cross-team APIs.** It forces the contract to
be an explicit, reviewable decision *before* implementation cost is sunk, enables
consumers to build in parallel against mocks, and prevents internal implementation
choices (ORM column names, framework quirks) from leaking into the public shape.

**When code-first is fine.** Small internal services with a single team owning both
sides, or rapid prototypes, where the cost of drift is low and the convenience of
generating docs from code outweighs deliberate design.

**The subtle gotcha.** "Design-first" does not mean "never generate anything." It
means the *human-authored spec is authoritative*; you then generate server stubs
and clients *from* it. Code-first's real risk is not that the spec is generated —
it is that the API design is an *afterthought* driven by whatever the code happened
to do.

> [!INTERVIEW]
> A common probe: "Your team does code-first and the docs keep drifting. What do
> you change?" Strong answer: flip to design-first *or* at minimum add a CI check
> that fails the build when the generated spec differs from the reviewed/committed
> spec — and mock/contract-test consumers against the committed spec.

---

## Contract-driven development and mock servers

**The core idea.** Once the OpenAPI document exists, it is executable in three ways
*before the real server is built*:

1. **Mock server:** a tool (Prism, Microcks, Stoplight) reads the spec and serves
   fake responses — either from the declared `examples`/`example` or generated to
   match the schema. Frontend and mobile teams develop against it immediately.
2. **Contract tests:** the real server's responses are validated against the spec
   in CI. If the server returns a field the spec doesn't declare, or the wrong
   status, the test fails. This is what prevents drift in code-first *and*
   design-first setups.
3. **Consumer-driven expectations:** consumers assert the parts of the contract
   they depend on, so the provider knows what it can safely change.

**Why it matters.** The spec becomes a shared, enforceable agreement, not a
document. Teams unblock each other (parallel development), and breaking changes are
caught at build time instead of in production.

**Example — a mock derived from an example.** Given this operation:

```yaml
paths:
  /orders/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
              examples:
                sample:
                  value: { id: "o_123", status: "SHIPPED", total: 4200 }
```

A mock server can immediately return `{"id":"o_123","status":"SHIPPED","total":4200}`
for `GET /orders/anything` — no backend required.

**Gotcha — mocks lie about behavior.** A schema-driven mock validates *shape*, not
*logic*: it won't enforce that `total` equals the sum of line items, or that a
`404` is returned for unknown ids unless you script it. Mocks de-risk integration
plumbing and shape mismatches, not business correctness.

---

## OpenAPI document structure

**The top-level (root) object.** An OpenAPI 3.1 document is a single JSON/YAML
object with these fields:

| Field | Required | Purpose |
|---|---|---|
| `openapi` | yes | Spec version string, e.g. `"3.1.0"` |
| `info` | yes | Metadata: `title`, `version` (of the *API*, not the spec), `description`, contact, license |
| `servers` | no | Base URLs the API is served from (with variables) |
| `paths` | no* | The endpoints and their operations |
| `webhooks` | no* | Out-of-band requests the API *sends* (new in 3.1) |
| `components` | no* | Reusable objects referenced via `$ref` |
| `security` | no | Global security requirements |
| `tags` | no | Grouping/labels for operations (used by doc UIs) |
| `externalDocs` | no | Link to more documentation |
| `jsonSchemaDialect` | no | Default JSON Schema dialect for Schema Objects (new in 3.1) |

\* In **3.1** a document must contain at least one of `paths`, `components`, or
`webhooks`. (In 3.0, `paths` was required.)

**The `info.version` trap.** `info.version` is the version of *your API*
(e.g. `"2.3.0"`), completely separate from the `openapi` field (the version of the
*specification format*). Interviewers love this distinction.

**Minimal skeleton:**

```yaml
openapi: 3.1.0
info:
  title: Orders API
  version: "1.4.0"
servers:
  - url: https://api.example.com/v1
paths:
  /orders:
    get:
      summary: List orders
      responses:
        '200': { description: OK }
components:
  schemas: {}
```

---

## Paths, operations, and parameters

**Paths.** The `paths` object maps a URL template to a **Path Item**. A path may
contain a templated parameter in braces: `/orders/{orderId}`. Path templating names
a variable segment; the variable is then described as a `parameter` with
`in: path`.

**Operations.** Within a Path Item, each HTTP method (`get`, `post`, `put`,
`patch`, `delete`, `head`, `options`, `trace`) is an **Operation Object** carrying:
`summary`, `description`, `operationId` (a unique string used by code generators to
name methods), `tags`, `parameters`, `requestBody`, `responses`, and `security`.

**Parameters** have four `in` locations:

| `in` | Where | Example |
|---|---|---|
| `path` | Templated URL segment | `/orders/{id}` → `id` |
| `query` | After `?` | `?status=OPEN&limit=20` |
| `header` | Request header | `X-Request-Id` |
| `cookie` | Cookie value | session cookie |

`in: path` parameters are **always `required: true`**. Request bodies are *not*
parameters in OpenAPI 3.x — they are a separate `requestBody` object with content
keyed by media type. (This was a 2.0 → 3.0 change: 2.0 had `in: body`.)

**Responses** are keyed by status code (as strings), plus `default` for
"everything else." Each response declares a `description` and optional `content`
(per media type), `headers`, and `links`.

```yaml
paths:
  /orders/{orderId}:
    get:
      operationId: getOrder
      parameters:
        - name: orderId
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: The order
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
        '404':
          description: No such order
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
```

> [!TIP]
> Give every operation a stable, unique `operationId`. Generators turn it into the
> client method name (`client.getOrder(...)`). Renaming it is a breaking change for
> generated SDKs even though the HTTP contract is unchanged.

---

## Schema components and $ref reuse

**Why components exist.** The `components` object is a container of reusable
definitions that are *not* live in the API until referenced. It has these keyed
maps: `schemas`, `responses`, `parameters`, `examples`, `requestBodies`,
`headers`, `securitySchemes`, `links`, `callbacks`, and (new in 3.1) `pathItems`.

**`$ref` — the reuse mechanism.** A `$ref` is a JSON Reference: a URI (often a
local JSON Pointer) pointing at another part of this document or an external file:

```yaml
# same document
schema: { $ref: '#/components/schemas/Order' }
# another local file
schema: { $ref: './schemas/order.yaml' }
# a fragment of another file
schema: { $ref: 'common.yaml#/components/schemas/Money' }
```

**Why it matters.** DRY contracts: define `Money`, `Address`, `Problem`, or a
`Pagination` envelope once and reference it everywhere. A change in one place
propagates; docs stay consistent; generators emit one model class instead of many
near-duplicates.

**Composition keywords** (from JSON Schema) let you build schemas from parts:

| Keyword | Meaning |
|---|---|
| `allOf` | Must match *all* subschemas (used for "extends"/merge) |
| `oneOf` | Must match *exactly one* (mutually exclusive variants) |
| `anyOf` | Must match *at least one* |
| `not` | Must *not* match |

**Polymorphism with `discriminator`.** Pair `oneOf`/`anyOf` with a `discriminator`
that names a property whose value picks the concrete schema — so tools and
generated code can dispatch on it:

```yaml
Pet:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
  discriminator:
    propertyName: petType
    mapping:
      cat: '#/components/schemas/Cat'
      dog: '#/components/schemas/Dog'
```

**Gotchas.**
- **`$ref` siblings are (mostly) ignored in JSON Reference.** In pure 3.0, keywords
  placed next to a `$ref` (like `description`) were ignored. **3.1**, aligning with
  JSON Schema 2020-12, allows sibling keywords alongside `$ref` in Schema Objects —
  a real behavioral difference between versions.
- **Circular `$ref`s** (a `Node` that references itself) are legal and common
  (trees, linked lists) but can break naive generators.

---

## OpenAPI 3.0 vs 3.1

**The headline change: JSON Schema alignment.** OpenAPI 3.0 used a *custom subset*
of JSON Schema Draft 4 that was *almost* but not fully compatible. **OpenAPI 3.1**
adopts **JSON Schema 2020-12** as a full superset — the Schema Object *is* a JSON
Schema. This removes years of "why doesn't my JSON Schema work in OpenAPI"
friction. This is the single most-asked 3.0-vs-3.1 interview point.

**Concrete differences:**

| Aspect | OpenAPI 3.0 | OpenAPI 3.1 |
|---|---|---|
| JSON Schema basis | Custom subset of Draft 4 | Full JSON Schema 2020-12 |
| Nullability | `nullable: true` (custom keyword) | `type: [string, "null"]` (type array); `nullable` removed |
| `exclusiveMinimum`/`Maximum` | boolean flag paired with `minimum` | a **number** (the bound itself) |
| `example` (singular) | supported | deprecated in favor of `examples` (JSON Schema array) inside schemas |
| Webhooks | not supported | `webhooks` root field added |
| Top-level requirement | `paths` required | one of `paths`/`components`/`webhooks` |
| `type` as array | not allowed | allowed (e.g. `["string","null"]`) |
| Sibling keywords by `$ref` | ignored | allowed |
| File uploads | driven by `format: binary` | JSON Schema `contentEncoding`/`contentMediaType` |

**Nullable example:**

```yaml
# 3.0
middleName:
  type: string
  nullable: true
# 3.1
middleName:
  type: [string, "null"]
```

**Why it matters.** Migrating 3.0 → 3.1 is mostly mechanical (nullable, exclusive
bounds), but tooling support lagged for a while — some generators/UIs adopted 3.1
slowly. Know that `3.1.x` patch versions (3.1.0, 3.1.1, 3.1.2) are semantically
equivalent to tooling; do not treat a patch bump as a spec change.

> [!WARNING]
> `nullable: true` does **not** exist in OpenAPI 3.1. Using it is a no-op that some
> validators will reject. Express nullability with a `"null"` entry in a `type`
> array instead.

---

## Servers and environments

**What `servers` does.** The root (and, if needed, per-path or per-operation)
`servers` array lists the base URLs where the API lives, and can parameterize them
with **server variables**:

```yaml
servers:
  - url: https://{region}.api.example.com/{basePath}
    description: Production
    variables:
      region:
        default: us-east-1
        enum: [us-east-1, eu-west-1]
      basePath:
        default: v1
  - url: https://staging.api.example.com/v1
    description: Staging
```

**Why it matters.** It documents environments (prod/staging), regional endpoints,
and versioned base paths, and lets Swagger UI's "Try it out" and generated clients
target the right host without hardcoding. In 2.0 this was three separate fields
(`host`, `basePath`, `schemes`); 3.0 unified them into `servers` with full URLs.

**Gotcha.** `servers` is descriptive, not a routing directive — it tells clients
where to send requests; it does not itself deploy or proxy anything.

---

## Security schemes

**What they are.** `components.securitySchemes` declares *how* the API is
protected; the `security` field (global or per-operation) then *applies* one or
more of those schemes. Declaring a scheme documents it and drives Swagger UI's
auth dialog and generated-client auth handling.

**Scheme types (OpenAPI 3.1):**

| `type` | Use |
|---|---|
| `http` | HTTP auth schemes via `scheme:` — `basic`, `bearer` (with `bearerFormat: JWT`) |
| `apiKey` | Key passed in a header, query param, or cookie (`in` + `name`) |
| `oauth2` | OAuth 2.0 with `flows` (authorizationCode, clientCredentials, implicit, password) and `scopes` |
| `openIdConnect` | Discovery via an OIDC `openIdConnectUrl` |
| `mutualTLS` | Client-certificate auth (**added in 3.1**) |

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
security:
  - bearerAuth: []          # applies globally
```

**Semantics of the `security` array.** The outer array is **OR** (any one entry
satisfies); the object *within* an entry is **AND** (all listed schemes required
together). An **empty `security: []`** on an operation means "no auth required" —
useful to make a login or health endpoint public under an otherwise-secured API.

**Why it matters.** This is documentation *and* a machine contract: it tells
clients exactly which credential to send where, and lets tools generate correct
auth code. It does **not** implement auth — the server still enforces it.

> [!WARNING]
> The spec describes security; it does not enforce it. Never assume that declaring
> `bearerAuth` protects an endpoint — the runtime must actually validate the token.
> Also: never put real secrets in the spec (only scheme *shapes*).

---

## Examples and documentation quality

**Two example mechanisms.** OpenAPI supports `example` (singular scalar) and
`examples` (a *map* of named, richer Example Objects with `summary`, `description`,
`value`, or `externalValue`). `examples` is preferred because you can show several
scenarios (success, edge case, error) side by side, and mock servers can serve them.

```yaml
requestBody:
  content:
    application/json:
      schema: { $ref: '#/components/schemas/Order' }
      examples:
        minimal:
          summary: Smallest valid order
          value: { items: [{ sku: "A1", qty: 1 }] }
        gift:
          summary: Order with gift wrap
          value: { items: [{ sku: "A1", qty: 1 }], giftWrap: true }
```

**What makes documentation high-quality (interview checklist):**
- Every operation has a `summary` and a meaningful `description`.
- **All** realistic responses are documented, including error codes
  (`4xx`/`5xx`) with problem-detail schemas — not just the happy `200`.
- Rich `examples` for requests and responses, including at least one error.
- Reusable `components` so shapes are consistent and self-documenting.
- `tags` group operations logically for the rendered UI.
- Descriptions explain *semantics and constraints* (units, formats, idempotency),
  not just restate the field name.

**Why it matters.** Documentation quality is the difference between an API a
developer can integrate in an afternoon and one that generates a support ticket per
field. Examples in particular power "Try it out," mock servers, and generated tests.

**Gotcha — examples must match the schema.** Nothing forces `examples` to be valid
against the `schema`; a stale example silently misleads consumers and produces
wrong mocks. Lint/validate examples against their schema in CI.

---

## Code and client generation

**What you can generate from a spec.** Because the document is machine-readable,
tools produce:

- **Client SDKs** in many languages (typed request/response models + methods named
  from `operationId`).
- **Server stubs / interfaces** you fill in (the "skeleton" of controllers/handlers).
- **Documentation sites** (Swagger UI, Redoc).
- **Mock servers** and **contract tests**.

**The two main generators.** *Swagger Codegen* (SmartBear) and
**openapi-generator** (a community fork of Swagger Codegen, now the more active and
widely used). Both take an OpenAPI doc + a target language/template and emit code.

**Design-first payoff.** Generation is what makes design-first efficient: agree on
the spec, then generate the client for every consumer *and* the server skeleton for
the provider from the *same* contract, so they cannot disagree by construction.

**Trade-offs and gotchas.**
- **Generated code quality varies** by language/template; you often customize
  templates or post-process. Treat generated SDKs as build artifacts, not code you
  hand-edit (edits are lost on regeneration).
- **`operationId` naming matters** — it becomes method names; keep it stable and
  human-friendly (`getOrder`, not `get_orders_id_v1`).
- **Missing/loose schemas generate weak types** (`object`/`any`); a vague spec
  yields a vague SDK. Generation rewards precise schemas.
- **Discriminators & `oneOf`** may generate awkwardly in languages without unions;
  test the output.

> [!TIP]
> Regenerate clients in CI from the committed spec and publish them as versioned
> packages. Consumers then upgrade the SDK to adopt new API versions, and a breaking
> spec change surfaces as a compile error in their build.

---

## Keeping docs in sync (spec as source of truth)

**The problem.** The most common failure mode is **drift**: the deployed API and
its published documentation disagree. A client integrates against docs that lie,
and the bug is discovered in production.

**Strategies, by workflow:**

- **Design-first:** the committed spec is authoritative. Enforce it with a
  **contract test in CI** that runs the real server's responses through a validator
  against the spec (e.g. Prism/Dredd/schema-assertions). The build fails on any
  mismatch.
- **Code-first:** the framework generates a spec from annotations. Prevent drift by
  **committing a reviewed copy** of the generated spec and failing CI if the freshly
  generated spec differs — turning "the docs match the code" into an enforced check
  and making design changes reviewable in the diff.

**Other sync tactics:**
- **Lint the spec** in CI (Spectral rules: naming, required descriptions, error
  responses present) so quality doesn't erode.
- **Version the spec alongside the code** in the same repo/PR, so a behavior change
  and its contract change land together and are reviewed together.
- **Publish docs from the spec automatically** (Swagger UI/Redoc built in the
  pipeline) so there is no separately-maintained doc that can rot.
- **Break the build on breaking changes** using an OpenAPI diff tool
  (e.g. `oasdiff`) that flags backward-incompatible changes between spec versions.

**Why it matters.** "Spec as source of truth" is only real if a machine enforces
it. A spec nobody validates against is just prettier drift. The interview signal is
naming the *enforcement mechanism*, not merely the aspiration.

> [!KEY-TAKEAWAY]
> Drift is prevented by *enforcement*, not intention: contract tests (server vs
> spec), a committed-spec diff check in CI, spec linting, and an automated
> breaking-change gate. The spec is "the source of truth" only when the pipeline
> fails if reality disagrees with it.

---

## Common follow-up questions

- **"Is OpenAPI the same as Swagger?"** No. OpenAPI is the specification; Swagger is
  a toolset (UI, Editor, Codegen) and the legacy name of the spec (2.0). Say
  "OpenAPI 3.1 rendered with Swagger UI."
- **"Design-first or code-first — which and why?"** Design-first for public/cross-team
  APIs (parallel work, deliberate design, consumer review before build); code-first
  is acceptable for small single-team internal services. Either way, enforce
  sync with CI.
- **"Biggest 3.0 → 3.1 change?"** Full JSON Schema 2020-12 alignment; `nullable`
  replaced by `type: [..., "null"]`; `exclusiveMinimum/Maximum` become numbers;
  `webhooks` added.
- **"How do you stop docs from drifting?"** Contract tests validating the live
  server against the committed spec, plus a generated-vs-committed diff check and
  spec linting in CI.
- **"How do mocks help before the backend exists?"** A mock server serves
  schema/example-driven responses so consumers integrate in parallel; but mocks
  validate shape, not business logic.
- **"What is `operationId` and why care?"** A unique operation identifier;
  generators use it as the client method name, so it's part of the SDK contract.
- **"AND vs OR in `security`?"** Outer array = OR (any entry suffices); object
  inside an entry = AND (all its schemes required). `security: []` = public.
- **"Does declaring a security scheme secure the endpoint?"** No — the spec
  documents auth; the runtime must enforce it.

## References

- OpenAPI Specification 3.1.0 — <https://spec.openapis.org/oas/v3.1.0.html>
- OpenAPI Specification 3.0.4 — <https://spec.openapis.org/oas/v3.0.4.html>
- OpenAPI Initiative — <https://www.openapis.org/>
- Migrating from OpenAPI 3.0 to 3.1 — <https://www.openapis.org/blog/2021/02/16/migrating-from-openapi-3-0-to-3-1-0>
- JSON Schema 2020-12 — <https://json-schema.org/specification-links#2020-12>
- Swagger tooling (SmartBear) — <https://swagger.io/tools/>
- OpenAPI Generator — <https://openapi-generator.tech/>
- Spectral (OpenAPI/AsyncAPI linter) — <https://github.com/stoplightio/spectral>
- Prism (mock/validation server) — <https://github.com/stoplightio/prism>
- RFC 9110 — HTTP Semantics — <https://www.rfc-editor.org/rfc/rfc9110>
- RFC 9457 — Problem Details for HTTP APIs — <https://www.rfc-editor.org/rfc/rfc9457>
