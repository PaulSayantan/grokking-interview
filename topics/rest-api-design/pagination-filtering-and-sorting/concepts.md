# Pagination, Filtering & Sorting

Collection endpoints (`GET /orders`, `GET /users`, `GET /products`) almost never
return every row. Returning an unbounded list is a correctness bug and a
denial-of-service risk: it blows up response size, memory, and database load as
the table grows. So a well-designed REST API defines a **wire contract for
slicing collections** — how a client asks for a page, narrows the set with
filters, and orders the results.

This note treats pagination/filtering/sorting purely at the **HTTP contract
altitude**: the query parameters a client sends, the response body and headers a
server returns, and the trade-offs an interviewer will probe. It is
framework-agnostic — examples are raw HTTP, JSON, and OpenAPI, not any specific
web framework.

> [!KEY-TAKEAWAY]
> There is no single RFC that mandates a pagination style. The two dominant
> patterns are **offset/limit (a.k.a. page/size)** and **cursor/keyset**. The
> senior-level answer is knowing *when each breaks* — deep-paging cost, stability
> under concurrent writes, and the ability to jump to an arbitrary page — and
> picking accordingly.

## Why paginate, filter, and sort

**Pagination** bounds the size of any single response. **Filtering** lets the
client ask the server to return only matching resources (pushing the predicate to
the database instead of shipping everything and filtering client-side).
**Sorting** defines a deterministic order so paging is meaningful.

These three are intertwined: pagination is only correct if the sort order is
**stable and total** (ties fully broken), and filtering changes the result set
that pagination walks over. An interviewer who asks "how would you design
`GET /orders`?" is usually really asking you to reason about all three together.

Design goals:

- **Bounded responses** — a client can never accidentally (or maliciously)
  request the entire table in one call.
- **Deterministic order** — the same query returns rows in the same order, so
  "page 2" means something.
- **Predictable cost** — the server's work per page should not grow without
  bound as the client walks deeper.
- **Discoverability** — the client can learn how to get the next page without
  hard-coding URL construction.

## Offset / limit (page/size) pagination

The classic approach: the client says "skip N rows, then give me the next M."

```
GET /orders?offset=40&limit=20
```

or the equivalent page-number form (page numbers are just offset ÷ size):

```
GET /orders?page=3&size=20        # page 3, 20 per page  → offset = (3-1)*20 = 40
```

The server typically translates this to `... ORDER BY created_at, id LIMIT 20
OFFSET 40`. A common response embeds the page plus metadata:

```json
{
  "data": [ { "id": 41, "...": "..." }, "..." ],
  "page": 3,
  "size": 20,
  "total_elements": 1284,
  "total_pages": 65
}
```

**Why it's popular:** it's dead simple, it maps directly to SQL `LIMIT/OFFSET`,
and — crucially — it lets a client **jump to an arbitrary page** ("go to page 50")
and render a numbered pager (1, 2, 3, … 65). This is the killer feature offset has
and cursor pagination does not.

**Conventions/gotchas:**

- Decide and document whether `page` is **1-based or 0-based**. This is a
  notorious off-by-one source; both exist in the wild.
- `offset`/`limit` and `page`/`size` are two spellings of the same mechanism —
  pick one and be consistent across the API.
- Always clamp `limit`/`size` to a max (see "Limits, defaults & guardrails").

> [!WARNING]
> Offset pagination has two structural problems that get worse at scale:
> **deep-paging cost** and **instability under concurrent writes**. Both are
> covered below and are the #1 thing interviewers push on.

## Deep-paging cost of OFFSET

`OFFSET N` does **not** let the database skip ahead cheaply. To satisfy
`... ORDER BY created_at LIMIT 20 OFFSET 100000`, the engine must **generate,
sort, and count off the first 100,000 matching rows and then discard them**,
returning only rows 100,001–100,020. Cost grows **linearly with the offset** — an
O(N) scan for a page deep in the list — so page 5,000 is dramatically slower than
page 1 even though both return 20 rows.

This is why large public APIs cap how deep you can offset (e.g. many search APIs
refuse offsets beyond ~10,000 results and tell you to narrow the query or switch
to a cursor). Keyset pagination fixes this because it seeks via an indexed
`WHERE` predicate instead of counting-and-discarding.

> [!TIP]
> If an interviewer asks "why is page 900 slow but page 1 fast with the same
> `LIMIT 20`?", the answer is: `OFFSET` still reads and throws away all preceding
> rows. The database can't jump to row N of a sorted result without producing
> the first N−1.

## Cursor / keyset pagination

Cursor (a.k.a. **keyset** or "seek") pagination replaces "skip N rows" with
"give me rows **after this specific position**." The client passes back an opaque
`cursor` token that the server issued with the previous page:

```
GET /orders?limit=20                                  # first page
GET /orders?limit=20&cursor=eyJjcmVhdGVkIjoiMjAyNi0w  # next page, opaque token
```

Response returns a token to fetch the following page:

```json
{
  "data": [ "...20 orders..." ],
  "next_cursor": "eyJjcmVhdGVkIjoiMjAyNi0wNy0xOVQxMDozMDowMFoiLCJpZCI6MTQwMX0",
  "has_more": true
}
```

**Keyset** is the underlying database technique: instead of `OFFSET`, the query
seeks by the sort key of the last row seen:

```sql
-- Page after the row (created_at='2026-07-19T10:30:00Z', id=1401)
SELECT * FROM orders
WHERE (created_at, id) > ('2026-07-19T10:30:00Z', 1401)   -- row-value comparison
ORDER BY created_at, id
LIMIT 20;
```

Because `(created_at, id)` is indexed, the engine **seeks directly** to the
position and reads 20 rows — cost is O(page size) and **constant regardless of
depth**. The cursor token is just an opaque, usually base64-encoded, encoding of
that last-seen key (plus often the sort spec and a signature/version so it can't
be forged or misapplied).

**Critical requirement:** the sort key must be **unique / total** — you almost
always append a tiebreaker like the primary key (`ORDER BY created_at, id`).
Sorting by a non-unique column alone (`created_at`) means two rows can share the
key, so `WHERE created_at > X` would skip or duplicate the tied rows at the page
boundary.

**Stripe** popularized a cursor variant using resource IDs directly:
`?limit=20&starting_after=or_1401` / `ending_before=or_1350`. **Slack**, **Twitter/X**,
and **GitHub's GraphQL API** all use opaque cursors.

## Offset vs cursor — trade-offs

| Dimension | Offset / limit (page/size) | Cursor / keyset |
|---|---|---|
| Deep-page cost | O(offset) — degrades as you page deeper | O(limit) — constant depth |
| Jump to arbitrary page N | ✅ Yes (compute offset) | ❌ No — only next/prev sequential |
| Numbered pager (1…65) | ✅ Natural | ❌ Not without a separate count |
| Stability under inserts/deletes | ❌ Rows shift → skips & duplicates | ✅ Anchored to a key, stable |
| Total count available | Easy (but the count is itself costly) | Usually omitted / approximate |
| Implementation complexity | Trivial | Moderate (encode/validate cursor, tiebreaker) |
| Random access / bookmarkable page | ✅ `?page=7` is a durable link | ⚠️ Cursor is position-relative, can expire |

**Rule of thumb interviewers like to hear:**

- Use **offset/limit** for small, bounded, relatively static datasets and admin
  UIs where users expect to jump to page N.
- Use **cursor/keyset** for large, high-write, or infinite-scroll feeds (activity
  streams, logs, timelines) where you only ever page forward and correctness
  under concurrent writes matters.

> [!INTERVIEW]
> A strong answer names the *specific* failure each avoids: offset fails on
> **deep-paging performance** and **write instability**; cursor gives those up in
> exchange for losing **jump-to-page-N** and cheap **total counts**. "It depends
> on the access pattern" is only a good answer if you can state which pattern
> favors which.

## Page metadata and total counts

Clients often want more than the rows: which page this is, whether more exist, and
sometimes the grand total. Common metadata fields (envelope style):

```json
{
  "data": [ "..." ],
  "pagination": {
    "page": 3,
    "size": 20,
    "total_elements": 1284,
    "total_pages": 65,
    "has_next": true,
    "has_previous": true
  }
}
```

**The cost of `total_elements`:** computing an exact total generally requires a
separate `SELECT COUNT(*) ... WHERE <same filters>`, which on a large filtered
table can be **as expensive as or more expensive than fetching the page itself** —
it may scan the whole matching set. Consequences and mitigations:

- Make the total **opt-in** (e.g. `?with_count=true` or a separate
  `HEAD`/count endpoint) so the common path doesn't pay for it.
- Return an **approximate** count (e.g. from table statistics / `reltuples`, or
  "about 1,200 results") for search-style UIs — exactness is rarely worth the
  cost.
- Prefer a boolean **`has_more`/`has_next`** over a total. You can compute
  `has_more` cheaply by requesting `limit + 1` rows and checking whether the
  extra row came back — no `COUNT(*)` needed. This is why many cursor APIs return
  `has_more` but no total.

> [!WARNING]
> Under concurrent writes, `total_elements` and `total_pages` are a **snapshot
> that's stale the moment it's computed**. Don't let clients treat "65 pages" as
> a hard invariant; rows can appear/disappear between the count and the fetch.

## Link header for pagination (RFC 8288)

Rather than making clients construct next-page URLs themselves, the server can
return them. **RFC 8288 (Web Linking)** standardizes the `Link` header and the
IANA-registered relation types `next`, `prev`, `first`, and `last`. This is the
**HATEOAS-friendly** approach — the client follows a URL it was handed instead of
knowing the pagination scheme:

```
HTTP/1.1 200 OK
Content-Type: application/json
Link: <https://api.example.com/orders?page=4&size=20>; rel="next",
      <https://api.example.com/orders?page=2&size=20>; rel="prev",
      <https://api.example.com/orders?page=1&size=20>; rel="first",
      <https://api.example.com/orders?page=65&size=20>; rel="last"
X-Total-Count: 1284
```

**GitHub's REST API** is the canonical real-world example: it returns pagination
purely via the `Link` header with `rel="next"/"prev"/"first"/"last"` and expects
clients to follow those links rather than build page numbers. It **omits
`rel="last"` for very large or cursor-based results** because computing the last
page would require a full count.

Notes:

- `Link` is the standardized, discoverable choice; embedding links in the JSON
  body (e.g. HAL `_links`, JSON:API `links`) is an equally valid alternative —
  just pick one and document it.
- `X-Total-Count` / `X-Total-Pages` are **de-facto conventions, not standards**
  (custom `X-` headers). They work fine but aren't defined by any RFC.
- For cursor APIs, the `next` link simply carries the opaque cursor:
  `Link: <...?cursor=abc123&limit=20>; rel="next"`.

## Filtering conventions

Filtering narrows the collection to matching resources. The dominant styles, from
simplest to most expressive:

**1. Field-equality query params** (most common, simplest):

```
GET /orders?status=shipped&customer_id=42&currency=USD
```

Each param names a field; multiple params are ANDed. Repeated params or a
comma list express an `IN`:

```
GET /orders?status=shipped,delivered      # status IN (shipped, delivered)
GET /orders?status=shipped&status=delivered   # equivalent, repeated-key form
```

**2. Operator syntax** for ranges/comparisons (`>`, `<`, `>=`, `!=`, contains).
Several conventions exist; the important thing is to pick one and document it:

```
GET /orders?created_at[gte]=2026-01-01&created_at[lt]=2026-07-01   # bracket ops
GET /orders?amount=gt:100                                          # prefix ops
GET /products?price=gte..lte                                      # range sugar
```

**3. A filter query language** for complex/dynamic filtering:

- **RSQL / FIQL** — a compact, URL-friendly grammar:
  `?filter=status==shipped;amount=gt=100,customer.tier==gold` where `;` is AND
  and `,` is OR. Great expressiveness in a single param; steeper client learning
  curve.
- **JSON / structured filters** — a JSON object (often base64'd or in a POST
  body) like `{"status":"shipped","amount":{"$gt":100}}`. MongoDB-style operators
  are common. Powerful but effectively invents a query DSL you must secure and
  document.

**Design & security guidance:**

- **Allowlist filterable fields.** Never translate arbitrary client field names
  straight into SQL/column names — that's an injection and information-disclosure
  vector (OWASP API3:2023 *Broken Object Property Level Authorization* — clients
  filtering/sorting on fields they shouldn't even see).
- Keep filter semantics **consistent** (does `?status=` do exact match or
  substring? is it case-sensitive?). Document it.
- Filters must be applied **consistently across pagination** — page 2 of a
  filtered set must use the same predicate as page 1, or counts and cursors break.
- Reserve non-filter param names (`page`, `size`, `limit`, `offset`, `cursor`,
  `sort`, `fields`, `q`) so they don't collide with field names.

## Sorting

Sorting sets the order of results. The widely adopted convention is a single
`sort` param with a **comma-separated list of fields**, where a leading `-`
means descending (and `+`/nothing means ascending):

```
GET /orders?sort=-created_at,id        # created_at DESC, then id ASC (tiebreak)
GET /users?sort=last_name,first_name   # both ascending, multi-key
```

An alternative pairs `sort` with a separate `order`/`direction` param
(`?sort=created_at&order=desc`), but that doesn't cleanly express multi-field
sorts; the `-field` syntax scales better. **JSON:API** standardizes exactly the
`sort=-created,title` comma-and-minus form.

**Gotchas interviewers probe:**

- **Sorting must be total for pagination to be correct.** Always append a unique
  tiebreaker (typically the primary key). `ORDER BY created_at` alone is
  non-deterministic when timestamps tie — the database may return tied rows in
  different orders on different requests, causing **duplicated or skipped rows at
  page boundaries**. `ORDER BY created_at, id` is deterministic.
- **Allowlist sortable fields**, same reasoning as filters — don't let clients
  sort on arbitrary/unindexed columns (perf + authorization).
- Sorting on a **non-indexed** column forces a full sort of the result set;
  combined with deep offset it's a common latency cliff.
- For cursor/keyset pagination the **cursor is tied to the sort spec** — if the
  client changes `sort` mid-walk, the old cursor is meaningless. Encode the sort
  into the cursor (and reject cursors whose sort doesn't match).

## Search

**Search** (free-text / relevance) is distinct from structured filtering.
Filtering says "field X equals Y"; search says "find resources relevant to these
terms," usually with relevance ranking. The common convention is a `q` parameter:

```
GET /products?q=wireless+headphones&sort=relevance&limit=20
GET /articles?q=climate+policy&category=news
```

Points to make:

- Search often returns results **ranked by relevance score**, which is itself the
  default sort — and relevance is generally **not a stable total order** across
  time, which interacts badly with offset pagination and cursors (scores shift as
  the index changes).
- Exact **total counts for search are usually approximate** ("about 4,300
  results") because the corpus is large and counting is expensive — same cost
  argument as `COUNT(*)`.
- Search can be modeled as its own resource/endpoint (`/search?q=...`) or as a
  `q` filter on a collection; either is fine, but relevance-ranked results
  typically pair better with cursor/`has_more` than with numbered pages.
- Combining `q` (search) with structured filters (`?q=shoes&brand=acme&price[lt]=100`)
  is common and expected — search narrows by relevance, filters by facets.

## Consistency under concurrent inserts/deletes

This is the deepest and most commonly-probed area. Between fetching page 1 and
page 2, other clients are inserting and deleting rows. What happens?

**Offset pagination is not stable.** Suppose you sort newest-first
(`sort=-created_at`) and read page 1 (rows 1–20), then a new row is inserted at
the top before you read page 2 (`offset=20`):

- Every row shifts down by one. `OFFSET 20` now points at what *was* row 20 —
  which you **already saw** → **duplicate**.
- Symmetrically, a **delete** before your offset shifts rows up, so the row that
  was at position 21 moves to 20 and you **skip** it → **missing row**.

So offset pagination can both **duplicate and drop** rows during concurrent
writes. This is often acceptable for human-browsed admin lists but **not** for
batch/ETL jobs that must see every row exactly once.

**Cursor/keyset is stable *for its anchor*.** Because the next page is
`WHERE (created_at, id) > (last_seen)`, inserting or deleting rows *behind* your
cursor doesn't shift what "after last_seen" means. You won't duplicate or skip
rows relative to the key you've already passed. Caveats:

- New rows inserted **ahead** of your position (with keys greater than your
  cursor, e.g. a newer `created_at` when paging newest-first *forward*) — behavior
  depends on sort direction: paging *forward through older* records is fully
  stable; a "load newer" feed handles fresh inserts by paging the *other*
  direction from the newest cursor.
- If a row is **deleted or its sort key mutated**, a cursor pointing exactly at it
  can be handled by using strict `>` on the row-value tuple; because the key
  itself is the anchor, a missing exact match just resumes from the next greater
  key.
- **Mutable sort keys are dangerous for keyset.** If you sort/cursor on a column
  that changes (e.g. `updated_at`, a mutable status), a row can move from behind
  your cursor to ahead of it (or vice versa) and be seen twice or skipped. Cursor
  on **immutable** keys (creation time + id) for exactly-once semantics.

> [!INTERVIEW]
> "How do you page through a table that's being written to, seeing each row
> exactly once?" → **keyset pagination on an immutable, unique key** (e.g.
> `WHERE id > :last_id ORDER BY id`). Offset can't guarantee it; a `COUNT`-based
> total can't either. Snapshot isolation / a stable read transaction is the other
> answer for a single bounded job, but doesn't work across many independent HTTP
> requests.

## Limits, defaults & guardrails

Every collection endpoint needs sane bounds so a client can't (accidentally or
maliciously) request an unbounded page:

- **Default page size** when the client omits `limit` (e.g. 20). Never default to
  "everything."
- **Maximum page size** — clamp `limit` to a hard cap (e.g. 100). If a client
  asks for `limit=100000`, either **clamp** to the max (and ideally signal it) or
  reject with `400`. Silent clamping is common; document whichever you choose.
- **Reject invalid params** — negative/zero `limit`, non-numeric `page`, unknown
  sort/filter fields → `400 Bad Request` with a machine-readable error body
  (RFC 9457 Problem Details), rather than silently ignoring them.
- **Cap offset depth** for offset pagination (or push clients to cursors past a
  threshold), since deep offsets are a performance/DoS vector.
- **Stable defaults for sort** — define a default order (usually a unique key) so
  results are deterministic even when the client doesn't specify `sort`;
  otherwise pagination is undefined.
- These caps are part of the **OWASP API4:2023 (Unrestricted Resource
  Consumption)** defense — unbounded pagination is a documented API DoS vector.

```
GET /orders?limit=100000
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-page-size",
  "title": "Invalid page size",
  "status": 400,
  "detail": "limit must be between 1 and 100; received 100000",
  "maxLimit": 100
}
```

## Keyset internals: mixed sort directions & row-value comparison

The clean `WHERE (created_at, id) > (?, ?)` **row-value comparison** only works
when **every key in the tuple sorts in the same direction**. `(a, b) > (?, ?)` is
exactly `a > ?a OR (a = ?a AND b > ?b)` — a *lexicographic* comparison that assumes
both `a` and `b` are ascending.

The moment you need **mixed directions** (`price DESC, id ASC`), the tuple form is
wrong: `(price, id) < (?, ?)` would apply `<` to *both* columns. You must
**decompose the predicate by hand**, flipping the operator per column:

```sql
-- Seek page for  ORDER BY price DESC, id ASC  after (last_price, last_id)
SELECT * FROM products
WHERE price < :last_price
   OR (price = :last_price AND id > :last_id)
ORDER BY price DESC, id ASC
LIMIT 20;
```

The rule: **descending key → `<` / `>` flips; ascending key → keep**. For N keys
you get a nested OR chain (`k1 cmp OR (k1= AND (k2 cmp OR (k2= AND ...)))`). This
hand-written OR-decomposition is the single most-probed keyset internal in senior
interviews.

**Row-value portability & index direction.** `(a, b) > (?, ?)` is standard SQL
(SQL:1999 row-value constructors) and PostgreSQL optimizes it into a true index
range scan. Older MySQL versions materialized/failed to optimize row-value
comparisons (improved in MySQL 8.0), so many portable implementations write the
OR-decomposed form even for same-direction sorts. For a **pure seek with no sort
step**, the composite index's **column order *and* per-column direction must match
the `ORDER BY`**. A `(price ASC, id ASC)` index cannot serve `price DESC, id ASC`
as a range scan — the engine must add a sort (or you need a matching
`(price DESC, id ASC)` index, supported by Postgres and MySQL 8.0+). This is the
concrete precondition behind the claim "keyset is O(limit)."

## Bidirectional cursors (prev/next and load-newer)

Cursors are often called "forward-only," but real APIs (Slack, Relay, Zalando #248
`prev`/`next`) support **backward** navigation too. To fetch the **previous** page
you *reverse both the comparison operator and the `ORDER BY`*, fetch `limit` rows,
then **re-reverse the returned rows** for display:

```sql
-- Forward (next) after (last_created, last_id), newest-first:
WHERE (created_at, id) < (:c, :id) ORDER BY created_at DESC, id DESC LIMIT 20;

-- Backward (prev) before (first_created, first_id):
WHERE (created_at, id) > (:c, :id) ORDER BY created_at ASC,  id ASC  LIMIT 20;
--   then reverse the 20 rows in application code so they read newest-first again.
```

A "load newer" feed (Twitter-style pull-to-refresh) is just backward paging from
the newest cursor the client holds. GraphQL Relay formalizes the two directions as
`first`/`after` (forward) and `last`/`before` (backward). The important subtlety:
the *display order stays the same* in both directions — only the internal seek is
reversed.

## What goes inside a cursor (and cursor security)

An opaque cursor is not just a base64 id. To make page N+1 reproduce the exact
query of page N, the cursor should encode:

- the **last-seen sort-key tuple** (the seek anchor),
- the **sort spec** (so a mismatch with the request's `sort` is detectable),
- the **filter predicate** (so the walk stays on the same result set),
- the **direction** (forward/backward), and
- a **schema/version tag** (so old cursors are rejected after a format change).

**Base64 is encoding, not security.** Google **AIP-158** explicitly warns that
base64 alone is *not* obfuscation — anyone can decode it. If the cursor must not be
inspected or forged, **HMAC-sign it (integrity) or encrypt it (confidentiality)**.

**Cursors must never carry authorization.** AIP-158 is emphatic: a page token is
not a capability. Authorization is re-evaluated on **every** request from the
caller's identity; a leaked or shared token must not grant access to data the new
caller can't otherwise see. Treat the cursor as *where I was*, never *what I'm
allowed to see*.

## Cursor validation & error semantics

What happens when a client edits the cursor, or changes `sort`/`filter` mid-walk?

- **Malformed / undecodable / bad-signature / schema-version mismatch** → `400 Bad
  Request` with an RFC 9457 `application/problem+json` body and a distinct `type`
  URI (e.g. `.../problems/invalid-cursor`). **Never `404` or `500`** — the resource
  exists; the *token* is bad.
- **Cursor's embedded sort/filter ≠ the request's `sort`/`filter` params** → `400`.
  AIP-158 generalizes this: changing **any** request argument other than
  `page_size` while paging → `INVALID_ARGUMENT`. Encoding sort+filter in the token
  is what makes this detectable.
- **Expired cursor** is legitimate, not a bug — DB-backed tokens (snapshots,
  server-side scroll state) expire; AIP-158 suggests roughly a **3-day** lifetime.
  Return `400` with a distinct "cursor expired" `type` so the client knows to
  restart from page 1 rather than retry.
- An **empty/absent `next_cursor`** (AIP-158: empty `next_page_token`) is the
  canonical "you've reached the end" signal — not an error.

## Estimating total counts

When you want *a* number but not the `COUNT(*)` bill, use an estimate:

- **PostgreSQL planner statistics**: `SELECT reltuples::bigint FROM pg_class WHERE
  relname = 'orders'` gives the last-`ANALYZE` row estimate in O(1). For filtered
  sets, read the **estimated row count from `EXPLAIN` (no ANALYZE)** — the planner's
  estimate for the `WHERE` clause — without executing the query.
- **Elasticsearch** caps counting by default: `track_total_hits` is `10000`, so
  `hits.total` reports `{"value":10000,"relation":"gte"}` (i.e. "at least 10,000")
  rather than an exact count, unless you set `track_total_hits: true` and pay for
  the full count. This is a *count* cap, distinct from the `max_result_window`
  offset cap below.
- Present estimates honestly ("about 1,200 results") and reserve exact counts for
  small sets or explicit opt-in (`?with_count=true`).

## Field expansion, sparse fieldsets & the N+1 problem

APIs let clients pull related resources inline — JSON:API `include=`, Zalando
`embed=`, OData `$expand`, GraphQL nested selections — and trim fields with
**sparse fieldsets** (`fields=`, `select`, JSON:API `fields[type]`).

The classic failure: expanding a related resource **per row** issues one extra
query per item — the **N+1 problem**. A 100-row page with `include=customer` can
fire 1 + 100 queries and run 10× slower. Mitigations at the contract level:

- **Batch/join loading** (a single `IN (...)` or JOIN, or a DataLoader-style
  per-request batcher) instead of per-row fetches.
- **Cap expansion depth and breadth** — bound how many relations and how deep a
  client may expand, and count expansion against complexity limits.
- **Sparse fieldsets as the cost lever** — returning only requested fields shrinks
  payload and can avoid touching expensive columns/joins entirely.

Diagnosing "the list endpoint got 10× slower after we added `include=`" as N+1 (and
proposing batch loading + depth caps) is a common senior scenario.

## GraphQL Relay Cursor Connections

GraphQL's **Relay Cursor Connections** spec standardizes what REST leaves to
convention. The shape:

```graphql
type Connection { edges: [Edge!]!  pageInfo: PageInfo! }
type Edge       { node: Node!  cursor: String! }   # cursor per edge, not per page
type PageInfo   { hasNextPage: Boolean!  hasPreviousPage: Boolean!
                  startCursor: String  endCursor: String }
```

Arguments are `first`/`after` (forward) and `last`/`before` (backward). The
**slicing algorithm** is ordered: apply `before`/`after` to the ordered set
*first*, then `first` (drop from the **end** to keep the first N), then `last`
(drop from the **start**). Using `first` **and** `last` together is discouraged.
Crucially, **ordering must be identical for forward and backward** queries — you do
*not* reverse the result set the way a hand-rolled REST prev-page does; you reverse
only which end you slice from.

Contrast with REST: Relay standardizes **edge-level cursors** (every node carries
its own cursor, so any node is a valid anchor), the **`PageInfo`** booleans, and
**bidirectional args** — all of which REST cursor APIs reinvent per-API. `has_more`
in REST maps to Relay's `hasNextPage`, and both are typically implemented by the
same `limit + 1` fetch trick.

## HTTP caching of paginated responses (RFC 9111)

Under **RFC 9111**, each distinct URL (method + full URI including query string) is
a **separate cache key**. Consequences for collections:

- Every `page`/`cursor`/`filter`/`sort` combination is its own cache entry, so a
  wide filter space **fragments** the cache and lowers hit rate — opaque cursors
  fragment CDN caches especially, since each token is unique.
- **Query-param order matters** to naive caches (`?a=1&b=2` ≠ `?b=2&a=1` as keys),
  so canonicalize param order to improve hit rate.
- Use **`Cache-Control`** and **`ETag`** (validators) on collection responses, and
  **`Vary`** on request headers that change the body (e.g. `Accept`,
  `Authorization`). Note collection responses are typically **short-lived / private**
  because their contents change with every write.
- `POST`-based search bodies (below) are **not cacheable by default** under HTTP
  semantics, one of the trade-offs of moving a query into the body.

## POST-based search for oversized queries

When a filter DSL exceeds practical URL limits, move it to a **request body**:
`POST /orders/search` or Elasticsearch-style `POST /orders/_search`. RFC 9110
defines no hard URL-length limit, but servers cap it and return **`414 URI Too
Long`** (typical practical ceilings are ~2–8 KB). A 12 KB JSON filter simply can't
go in a query string.

The trade-off is REST purity vs pragmatism:

- **GET** is safe, idempotent, **cacheable**, and bookmarkable — but limited by URL
  length and leaks the filter into logs/history.
- **POST /search** carries an arbitrarily large, structured body — but is
  **not cacheable by default**, not bookmarkable, and blurs the "POST = create"
  expectation (you're querying, not creating). Some APIs offer both: GET for simple
  filters, POST /search for complex ones.

## Standardized query vocabularies (OData, JSON:API, Zalando)

Interviewers recognize the industry-standard reserved param sets:

- **Zalando (#137)** reserved query params: `q`, `fields`, `embed`, `offset`,
  `cursor`, `limit`. Its page object (#248) has `self`/`next`/`prev`/`items`; #159
  MUST paginate, #160 SHOULD prefer cursor over offset, #254 SHOULD avoid a total
  count, #236/#237 cover simple vs JSON query languages.
- **JSON:API**: `sort` (with `-field` for DESC), the `page[...]` family
  (`page[number]`/`page[size]`/`page[offset]`/`page[cursor]`), `filter`, `include`,
  and `fields[type]` for sparse fieldsets.
- **OData 4.01**: `$filter` with operators `eq ne gt ge lt le and or not`, grouping
  `()`, functions `contains`/`startswith`/`endswith`; `$orderby`, `$top`, `$skip`,
  `$count`, `$select`, `$expand`; server-driven paging via `$skiptoken` in the
  `@odata.nextLink`, and the `Prefer: odata.maxpagesize=N` request header.
  **Microsoft's Azure REST guidelines** drop the `$` prefix (`filter`, `orderby`,
  `top`, `skip`) and note that supporting `orderby` is "unusual" because arbitrary
  server-side sort is expensive.
- **RSQL/FIQL** full operator set (the Zalando/Apache CXF de-facto standard for
  complex queries): `==`, `!=`, `=gt=`, `=ge=`, `=lt=`, `=le=`, `=in=`, `=out=`,
  with `;` = AND and `,` = OR.

## Server-driven vs client-driven pagination

- **Client-driven**: the client dictates boundaries — sends `offset`/`limit` or
  `page`/`size` and computes the next request itself. Maximum control, but the
  client owns correctness (deep-offset cost, page arithmetic).
- **Server-driven**: the server decides page boundaries and hands back an opaque
  continuation — Google's `next_page_token` (AIP-158), Azure's `nextLink`,
  OData `$skiptoken`, GitHub's `Link: rel="next"`. The server may return **fewer
  items than requested — even mid-collection** (AIP-158) — and the client must keep
  following the link until it's absent/empty. This unifies the Google/Azure/GitHub
  style: the client treats the continuation as opaque and never constructs it.

Azure's `nextLink` has extra rules: it's **never `null`** (absent on the last
page), and it **must carry `api-version`** so following it doesn't drop the version.

## NULL ordering semantics

Sorting is under-specified until you decide where NULLs go. Engines differ:

- **PostgreSQL/Oracle** default: NULLs sort as the **largest** value (NULLS LAST for
  ASC, NULLS FIRST for DESC); `ORDER BY col ASC NULLS FIRST/LAST` overrides.
- **MySQL/SQLite** default: NULLs sort as the **smallest** value (NULLS FIRST for
  ASC). MySQL lacks `NULLS FIRST/LAST` syntax; you emulate with an
  `ORDER BY col IS NULL, col` expression.
- **Azure guidance**: sort NULL as **less than** any non-NULL value, for a
  consistent contract across backends.

This matters for keyset: a **NULL in the seek column breaks the `>`/`<` predicate**
(comparisons with NULL yield `UNKNOWN`, not true/false), so rows with NULL sort keys
can be silently skipped. Either forbid NULLs in cursor columns, or add explicit
`col IS NULL` handling to the seek predicate.

## Common follow-up questions

- "Offset vs cursor — when would you pick each?" Offset for small/static sets
  and jump-to-page-N UIs; cursor for large, high-write, forward-only feeds where
  deep-paging cost and write-stability matter.
- "Why is deep offset slow?" `OFFSET N` still reads/sorts and discards the
  first N rows; cost is O(N). Keyset seeks via an indexed `WHERE` predicate, cost
  O(page size).
- "How do you page a table exactly once while it's being written to?" Keyset
  on an immutable unique key; offset can duplicate/skip rows under concurrent
  inserts/deletes.
- "Why append `id` to the sort?" To make the order total; ties on a non-unique
  sort column make paging non-deterministic (skip/duplicate at boundaries) and
  break keyset predicates.
- "Why is returning `total_count` expensive?" It needs a separate
  `COUNT(*)` over the filtered set, which can scan the whole match set; prefer
  `has_more` (fetch `limit+1`) or an approximate count.
- "How should the client find the next page?" Follow the `Link` header
  (RFC 8288 `rel="next"`) or a `next`/`next_cursor` field in the body — don't make
  clients hand-build page URLs.
- "How do you filter safely?" Allowlist filterable/sortable fields; never map
  raw client input to column names (injection + OWASP API3 property-level authz).
- "What status code for `limit=1000000`?" Either clamp to the max (document
  it) or return `400` with a Problem Details body — don't return the whole table.
- "Is there an RFC for pagination?" No standard mandates a *style*; RFC 8288
  standardizes the `Link` header + `next/prev/first/last` relations, and RFC 9457
  standardizes the error body. The page/cursor mechanics themselves are
  convention.

## References

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) (methods,
  status codes, query semantics)
- [RFC 8288 — Web Linking](https://www.rfc-editor.org/rfc/rfc8288) (the `Link`
  header and `next`/`prev`/`first`/`last` relation types)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
  (obsoletes RFC 7807; error body for invalid pagination/filter params)
- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  — API3 Broken Object Property Level Authorization (filter/sort field exposure),
  API4 Unrestricted Resource Consumption (unbounded pagination as DoS)
- [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0) (describing
  query parameters, defaults, and constraints for pagination/filter/sort)
- [GitHub REST API — Pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
  (canonical `Link`-header pagination)
- [Stripe API — Pagination](https://docs.stripe.com/api/pagination)
  (cursor pagination with `starting_after`/`ending_before` and `has_more`)
- [JSON:API — Fetching: Sorting & Pagination](https://jsonapi.org/format/#fetching-sorting)
  (the `sort=-field` and `page[...]` conventions)
- [Use the Index, Luke — "No Offset" (keyset pagination)](https://use-the-index-luke.com/no-offset)
- [Google AIP-158 — Pagination](https://google.aip.dev/158) (`page_size`/`page_token`/
  `next_page_token`/`total_size`; opaque URL-safe tokens; base64 ≠ obfuscation; tokens
  carry no authz; empty token = end; changing args → `INVALID_ARGUMENT`)
- [GraphQL Relay Cursor Connections spec](https://relay.dev/graphql/connections.htm)
  (`Connection`/`Edge`/`PageInfo`, `first/after`/`last/before`, slicing algorithm)
- [OData 4.01 — Querying](https://docs.oasis-open.org/odata/odata/v4.01/) (`$filter`,
  `$orderby`, `$top`/`$skip`/`$count`, `$skiptoken`, `contains`/`startswith`)
- [Microsoft Azure REST API Guidelines](https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md)
  (`nextLink` never null + carries `api-version`; de-`$`'d `filter/orderby/top/skip`; NULL ordering)
- [Zalando RESTful API Guidelines](https://opensource.zalando.com/restful-api-guidelines/)
  (#137 reserved params, #159/#160/#161/#248/#254 pagination, #236/#237 query languages)
- [Elasticsearch — Paginate search results](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html)
  (`search_after`, Point-in-Time, `index.max_result_window` 10,000, `track_total_hits`)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111) (cache keys, `Vary`)
- [RFC 9110 §10.1.2 / §15.5.15 — 414 URI Too Long](https://www.rfc-editor.org/rfc/rfc9110)
