# Querying: JPQL, HQL, Criteria API & Native SQL

JPA and Hibernate give you four ways to ask the database for data, and a senior
interview probes whether you know *which to reach for, why, and what SQL each one
generates*. This page covers **JPQL** (the portable, object-oriented query language),
**HQL** (Hibernate's superset), the **Criteria API** (type-safe programmatic queries),
and **native SQL** (raw queries with result mapping) — plus the cross-cutting concerns
that trip people up: parameter binding, pagination, projections, `JOIN FETCH`, and
bulk update/delete.

> [!INTERVIEW]
> The one-liner that signals seniority: "JPQL and Criteria query the **entity model**
> — classes and fields — and Hibernate translates them to SQL against the mapped
> tables; native SQL queries the **database directly** and gives up portability and
> automatic dirty-tracking of scalar results." Everything else (N+1, pagination traps,
> bulk-DML cache invalidation) flows from understanding that boundary.

The raw SQL itself — join algorithms, index usage, execution plans, isolation — lives
in `messaging-databases` (see `messaging-databases/sql-joins`,
`messaging-databases/indexing`, `messaging-databases/transactions-isolation`). Here we
stay at the ORM altitude: what Hibernate *generates* and *why*. Query-injection
security is expanded in the security domain; here we cover the JPA-specific rule (always
bind parameters). The Spring Data repository layer (`@Query`, derived queries,
`Pageable`, projections) is owned by `hibernate-jpa/spring-data-jpa-repositories` — this
page teaches the underlying JPA query mechanics it delegates to.

## JPQL: Querying Objects, Not Tables

**JPQL** (Jakarta Persistence Query Language) is a SQL-like, **portable** query language
defined by the Jakarta Persistence spec. Its defining characteristic: it operates on the
**entity model**, not the database schema. You name **entity classes** and their
**fields/associations**, never tables and columns.

```java
// JPQL: 'Author' is the entity class, 'a.books' navigates the mapped association,
// 'a.name' is a persistent field. No table or column names appear.
List<Author> authors = em.createQuery(
        "SELECT a FROM Author a JOIN a.books b WHERE b.price > :min", Author.class)
    .setParameter("min", new BigDecimal("20"))
    .getResultList();
```

Hibernate parses this into its **Semantic Query Model (SQM)** — an AST of the query in
terms of the entity model — and then translates SQM to SQL for the configured dialect:

```sql
select a.id, a.name, a.version
from author a
join book b on b.author_id = a.id
where b.price > ?
```

Key JPQL facts interviewers check:

- **Entity and field names are case-sensitive**; JPQL keywords (`SELECT`, `FROM`,
  `WHERE`) are not.
- `SELECT a FROM Author a` returns **managed entities** — they go into the persistence
  context and are dirty-checked. (See
  `hibernate-jpa/session-entitymanager-persistence-context`.)
- **Implicit joins** via path navigation: `WHERE b.author.name = :n` silently generates
  a SQL join.
- JPQL defines **no `INSERT` statement at all** — its only bulk-DML statements are
  `UPDATE` and `DELETE`. (`INSERT` is a Hibernate HQL extension; see below.) There is no
  direct table access either — that is by design for portability.
- Polymorphism is built in: `SELECT p FROM Payment p` returns all subclasses of a mapped
  `Payment` hierarchy.

> [!KEY-TAKEAWAY]
> JPQL is portable because it targets the *object model*. The provider owns the
> object→SQL translation, so the same JPQL runs on PostgreSQL, Oracle, or MySQL — the
> generated SQL differs per dialect, your query does not.

## HQL: Hibernate's Superset of JPQL

**HQL** (Hibernate Query Language) is Hibernate's native query language. In modern
Hibernate (6/7) JPQL and HQL share the same SQM-based parser, so **HQL is a strict
superset of JPQL**: every valid JPQL query is valid HQL, but HQL adds features the spec
does not require. Interview-relevant extras:

- **`INSERT`** statements entirely — both `INSERT ... SELECT` and (Hibernate 6.1+)
  `INSERT ... VALUES` with literal rows. Standard JPQL has no `INSERT` at all, so any
  JPQL-level insert is really an HQL extension.
- Richer functions and operators, e.g. `str()`, extended date/time functions, and in
  Hibernate 6+ many standard SQL functions exposed portably.
- **Implicit and explicit polymorphism** on non-mapped superclasses/interfaces (query
  `FROM java.lang.Object` — rarely used, but legal).
- **`WITH`** clause for extra join conditions (`JOIN a.books b WITH b.price > 10`) — JPQL
  uses `ON` for the same purpose (`ON` was added to JPQL in later versions).
- Set operations, tuple constructors, and other conveniences.

You obtain HQL through the Hibernate `Session`:

```java
Session session = em.unwrap(Session.class);
List<Author> authors = session.createQuery(
        "from Author a where a.name like :p", Author.class)   // 'from' without 'select' is HQL-friendly
    .setParameter("p", "A%")
    .list();
```

> [!TIP]
> **Prefer JPQL unless you specifically need an HQL feature.** Sticking to JPQL keeps
> you provider-portable and keeps the query valid against the spec. Reach for HQL only
> for `INSERT ... VALUES`, `WITH`, or Hibernate-specific functions — and document why.

## The Criteria API & the JPA Metamodel

The **Criteria API** (`jakarta.persistence.criteria.*`) builds queries **programmatically
and type-safely** as a tree of Java objects instead of a string. It shines for **dynamic
queries** — where the set of filters/sorts is unknown until runtime (search screens with
optional filters) — because you conditionally append predicates instead of concatenating
strings.

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<Author> cq = cb.createQuery(Author.class);
Root<Author> author = cq.from(Author.class);

List<Predicate> filters = new ArrayList<>();
if (name != null) {
    filters.add(cb.like(author.get(Author_.name), name + "%"));  // metamodel: Author_.name
}
if (minBooks != null) {
    Join<Author, Book> b = author.join(Author_.books);
    filters.add(cb.gt(cb.count(b), minBooks));
}
cq.select(author).where(cb.and(filters.toArray(new Predicate[0])));

List<Author> result = em.createQuery(cq).getResultList();
```

**The JPA metamodel** is the `_` (underscore) suffixed classes — `Author_`,
`Author_.name` — generated at compile time by an annotation processor (Hibernate's
`hibernate-jpamodelgen`). Referencing `Author_.name` instead of the string `"name"` is
what makes Criteria **type-safe**: rename the `name` field and the code fails to compile
rather than blowing up at runtime. (You *can* use string attribute names —
`author.get("name")` — but you lose the type safety, so it is discouraged.)

| | JPQL/HQL string | Criteria API |
|---|---|---|
| Form | Text query | Java object tree |
| Type safety | None (string) | Type-safe with metamodel |
| Readability | High for static queries | Verbose, harder to read |
| Best for | Fixed queries | **Dynamic** queries (optional filters) |
| Refactor-safe | No | Yes (compile-time errors) |
| Injection risk | Only if you concatenate | None (always parameterized) |

> [!WARNING]
> Criteria is **verbose** — do not use it for static queries where a one-line JPQL string
> would do. Its sweet spot is dynamic query building. For anything static, JPQL/named
> queries read better and are easier to maintain.

## Native SQL Queries & Result Mapping

When you need database-specific SQL — vendor functions, hints, complex analytics,
recursive CTEs, or a hand-tuned query the ORM can't express — use a **native query**.

```java
// JPA
List<Author> authors = em.createNativeQuery(
        "SELECT * FROM author WHERE name LIKE ?1", Author.class)  // map to entity
    .setParameter(1, "A%")
    .getResultList();
```

Native queries can return:

1. **Entities** — pass the entity class; the columns must map to the entity's fields.
   Result rows become **managed** entities in the persistence context.
2. **Scalars** — omit the class; you get `Object[]` (or `Object` for one column). These
   are **not managed** — they are plain values.
3. **Mapped results** via **`@SqlResultSetMapping`** — for complex shapes (multiple
   entities per row, entities + scalars, DTOs via `@ConstructorResult`):

```java
@SqlResultSetMapping(
    name = "AuthorBookCount",
    classes = @ConstructorResult(
        targetClass = AuthorSummary.class,
        columns = {
            @ColumnResult(name = "name", type = String.class),
            @ColumnResult(name = "book_count", type = Long.class)
        }))
@NamedNativeQuery(
    name = "Author.summaries",
    query = "SELECT a.name AS name, count(b.id) AS book_count " +
            "FROM author a LEFT JOIN book b ON b.author_id = a.id GROUP BY a.name",
    resultSetMapping = "AuthorBookCount")
```

Trade-offs of native SQL:

- **Loses portability** — you're now tied to a dialect.
- **Bypasses SQM** — Hibernate does not understand the query semantically; it can't apply
  the same optimizations and it doesn't auto-add discriminator/version columns for you.
- **Cache & flush caveats:** by default a native query does **not** know which entities it
  touches, so Hibernate may **flush the entire persistence context** before running it
  (to keep the DB consistent) and may not auto-invalidate the second-level cache for
  affected tables unless you tell it (`addSynchronizedEntityClass` /
  `@NamedNativeQuery(... )` synchronization). See `hibernate-jpa/caching-first-second-level`.

> [!TIP]
> Prefer JPQL/HQL first; drop to native SQL only when the query genuinely can't be
> expressed portably. When you do, map results to a DTO with `@ConstructorResult` rather
> than dragging back managed entities you'll never modify.

## Named Queries (@NamedQuery & @NamedNativeQuery)

A **named query** is a query defined once (by name) and referenced everywhere else.
`@NamedQuery` holds JPQL/HQL; `@NamedNativeQuery` holds native SQL.

```java
@Entity
@NamedQuery(
    name = "Author.byName",
    query = "SELECT a FROM Author a WHERE a.name = :name")
class Author { /* ... */ }

// usage
List<Author> a = em.createNamedQuery("Author.byName", Author.class)
    .setParameter("name", "Ada")
    .getResultList();
```

The senior-level advantage: **named JPQL queries are parsed and validated at startup**
(when the persistence unit is built), not on first execution. A syntax error or a
reference to a non-existent field fails **fast at boot**, not at 3 a.m. in production.
They can also be **precompiled/cached** by the provider, saving per-call parse cost.

> [!KEY-TAKEAWAY]
> Named JPQL queries = **fail-fast validation at startup** + reuse + one place to change.
> Named *native* queries are validated as strings only (Hibernate can't semantically check
> raw SQL against the model), so their startup check is weaker.

## Parameter Binding: Named vs Positional (and Injection)

There are exactly two legitimate ways to pass values into a query — and **string
concatenation is never one of them.**

| Style | Syntax | Bind call |
|---|---|---|
| **Named** | `:name` | `.setParameter("name", value)` |
| **Positional** | `?1`, `?2` (1-based) | `.setParameter(1, value)` |

```java
// Named — preferred: self-documenting, reusable, order-independent
em.createQuery("SELECT a FROM Author a WHERE a.name = :n AND a.active = :act", Author.class)
  .setParameter("n", name)
  .setParameter("act", true);
```

> [!WARNING]
> **NEVER concatenate user input into a query string** — that is textbook
> **JPQL/SQL injection**. `"... WHERE a.name = '" + userInput + "'"` lets an attacker
> break out of the literal. Bound parameters are sent to the DB **separately** from the
> query text, so they can never be interpreted as query syntax. This holds for JPQL,
> HQL, and native SQL alike. (Deep dive in the security domain.)

Mechanism bonus: bound parameters also let the DB **reuse the prepared-statement plan
cache** (same SQL text, different bind values), which concatenation defeats. Positional
JPQL parameters are **1-based** (`?1`) — a classic gotcha for people used to 0-based
indexing.

## Projections: Scalar, Constructor Expressions, Tuple & Interface

Fetching whole entities when you only need a few columns is wasteful (and for read-only
data, pollutes the persistence context with dirty-check overhead). **Projections** return
just what you need.

- **Scalar / multi-column:** `SELECT a.name, a.email FROM Author a` returns
  `List<Object[]>` (or `List<Tuple>` if you ask for `Tuple.class`). Untyped, but cheap.
- **Constructor expression (DTO):** the interview favorite —

  ```java
  // AuthorDto must have a matching constructor. Fully-qualified class name required.
  List<AuthorDto> dtos = em.createQuery(
      "SELECT new com.example.AuthorDto(a.name, a.email) FROM Author a", AuthorDto.class)
      .getResultList();
  ```

  This returns plain **unmanaged DTOs** — no persistence-context overhead, no dirty
  checking, exactly the columns in the constructor. In Hibernate 6.1+ you can even
  skip the `new` and use `SELECT a.name, a.email ...` with `.getResultList()` typed to
  the DTO in some setups, but the constructor expression is the portable classic.
- **`Tuple`:** `em.createQuery(jpql, Tuple.class)` — access by alias (`t.get("name")`)
  or index; a typed alternative to `Object[]`.
- **Interface / class projections (Spring Data):** define an interface with getters and
  Spring Data JPA builds the projection for you — see
  `hibernate-jpa/spring-data-jpa-repositories`.

> [!TIP]
> For read-only screens and reports, project into a **DTO**. It's faster (less data,
> fewer columns, no entity hydration) and safer (unmanaged, so no accidental dirty-check
> writes). This is one of the highest-leverage performance habits in JPA.

Beware: you can only put **scalars/paths** in a constructor expression, not a collection
association — `SELECT new Dto(a.books)` is illegal.

## Fetching in Queries: JOIN FETCH vs Entity Graphs

A plain JPQL join **does not initialize** the associated collection — it only affects the
`WHERE`/filtering. To *load* an association in the same query (and avoid N+1), use
**`JOIN FETCH`**:

```java
// Loads authors AND their books in ONE query — no N+1
List<Author> authors = em.createQuery(
    "SELECT DISTINCT a FROM Author a JOIN FETCH a.books", Author.class)
    .getResultList();
```

```sql
select distinct a.*, b.*
from author a
join book b on b.author_id = a.id
```

Contrast with a plain `JOIN a.books` (no `FETCH`): the collection stays lazy, so touching
`author.getBooks()` for each of N authors fires N extra selects — the **N+1 problem** (owned
by `hibernate-jpa/fetching-lazy-eager-n-plus-one`). `JOIN FETCH` collapses that to one.

- Use **`DISTINCT`** with a to-many `JOIN FETCH` to de-duplicate parent rows (the SQL join
  produces one row per child). In Hibernate 6+ `DISTINCT` is automatically applied in-memory
  for entity queries and *not* pushed to SQL unnecessarily; historically
  `hibernate.query.passDistinctThrough=false` controlled that.
- **`@EntityGraph`** (JPA) achieves the same fetch declaratively without changing the query
  text — attach a fetch graph to `find()` or a query via a hint. Great with Spring Data
  (`@EntityGraph` on a repository method).

> [!WARNING]
> **You cannot `JOIN FETCH` two collection associations at once** (e.g.
> `JOIN FETCH a.books JOIN FETCH a.awards`) — that produces a **Cartesian product**
> (`MultipleBagFetchException` if they're `List`/bags). Fetch one collection per query;
> use batch fetching or separate queries for the rest.

## Pagination & the JOIN-FETCH-Collection Trap (HHH000104)

Pagination uses two `Query` methods:

- **`setFirstResult(int)`** — the offset (0-based) of the first row to return.
- **`setMaxResults(int)`** — the maximum number of rows.

Hibernate translates these into dialect-specific SQL (`LIMIT/OFFSET`, `FETCH FIRST ... ROWS`,
Oracle `ROWNUM`/`OFFSET`, etc.).

```java
em.createQuery("SELECT a FROM Author a ORDER BY a.name", Author.class)
  .setFirstResult(20)
  .setMaxResults(10)   // -> ... ORDER BY name OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY
  .getResultList();
```

The senior gotcha — **combining `setMaxResults` with a `JOIN FETCH` of a collection**:

```mermaid
flowchart TD
    A["JOIN FETCH collection + setMaxResults(10)"] --> B{"Can SQL LIMIT be applied safely?"}
    B -->|"No — one parent = many child rows"| C["Hibernate CANNOT push LIMIT to SQL<br/>without truncating a parent's children"]
    C --> D["Fetches ALL rows into memory"]
    D --> E["Applies pagination IN MEMORY"]
    E --> F["Logs WARN HHH000104:<br/>'firstResult/maxResults specified with<br/>collection fetch; applying in memory'"]
    F --> G["OutOfMemory risk on large tables"]
```

Because one parent maps to many joined child rows, a SQL `LIMIT 10` would slice a parent's
children in half. Hibernate refuses to corrupt the result, so it **loads the entire result
set into memory and paginates there** — logging the infamous warning
**`HHH000104: firstResult/maxResults specified with collection fetch; applying in memory`**.
On a big table this is an OOM waiting to happen.

**Fixes:**
1. **Two-query approach:** page over the **root IDs** first (no fetch, real SQL LIMIT), then
   a second query `WHERE a.id IN :ids JOIN FETCH a.books`.
2. **`@BatchSize`** or `hibernate.default_batch_fetch_size` — paginate roots lazily, batch-load
   collections in `IN (...)` chunks.
3. **`@EntityGraph`** with a to-**one** graph (no cardinality explosion) paginates fine.

> [!KEY-TAKEAWAY]
> Paginating (`setMaxResults`) a query that `JOIN FETCH`es a **collection** = in-memory
> pagination (`HHH000104`). Paginate the root IDs first, then fetch the collection for that
> page. To-**one** fetch joins paginate safely because cardinality is 1:1.

## Bulk Update & Delete (executeUpdate & the Persistence Context)

JPQL/HQL support **bulk `UPDATE` and `DELETE`** run directly against the database via
`Query.executeUpdate()`:

```java
int updated = em.createQuery(
    "UPDATE Author a SET a.active = false WHERE a.lastLogin < :cutoff")
    .setParameter("cutoff", cutoff)
    .executeUpdate();   // returns rows affected; ONE SQL statement
```

```sql
update author set active = false where last_login < ?
```

This is enormously faster than loading N entities and mutating them one by one. **But** it
comes with a sharp gotcha every senior must know:

> [!WARNING]
> **Bulk update/delete bypasses the persistence context and the first-level cache.** The
> SQL runs directly against the DB. Entities already loaded in the current persistence
> context are **NOT updated** — they hold stale state. It also does **not** cascade, does
> **not** run `@PreUpdate`/lifecycle callbacks, and does **not** increment `@Version`
> automatically unless you set it in the query. **Call `em.clear()` (or `flush()` then
> `clear()`) after a bulk operation** so subsequent reads reload fresh state.

```java
em.flush();                 // push any pending changes first
int n = em.createQuery("UPDATE Author a SET a.active = false WHERE ...").executeUpdate();
em.clear();                 // discard now-stale managed entities
```

Bulk DML also **invalidates affected regions of the second-level cache** for the entity
(Hibernate handles the standard case), but native bulk SQL does not unless you declare the
synchronized tables. See `hibernate-jpa/caching-first-second-level` and
`hibernate-jpa/transactions-dirty-checking-flushing` for flush/cache mechanics.

## Scalar vs Entity Results (and Managed State)

A crucial mental model for *any* query API:

| Result kind | Example | Managed? | Dirty-checked? |
|---|---|---|---|
| Entity | `SELECT a FROM Author a` | **Yes** — in persistence context | Yes |
| Scalar/`Object[]` | `SELECT a.name, a.email ...` | No | No |
| DTO (constructor expr) | `SELECT new Dto(...)` | No | No |
| `Tuple` | typed to `Tuple.class` | No | No |
| Native → entity class | `createNativeQuery(sql, Author.class)` | **Yes** | Yes |
| Native → scalar | `createNativeQuery(sql)` | No | No |

The takeaway: if the query returns **entities**, every returned object is put in the L1
cache and will be included in dirty checking on flush — mutate one and it silently
`UPDATE`s on commit. If it returns **scalars/DTOs**, they're detached values you can throw
around freely. For read-only work, project to DTOs to keep the persistence context lean.

## Choosing the Right Query Approach

| Need | Reach for |
|---|---|
| Static, portable query | **JPQL** (ideally a **named query**) |
| Dynamic filters/sorts at runtime | **Criteria API** |
| Hibernate-only feature (`INSERT VALUES`, `WITH`) | **HQL** |
| Vendor SQL, hints, recursive CTE, hand-tuned | **Native SQL** + `@SqlResultSetMapping` |
| Read-only rows / reports | Any of the above **projected to a DTO** |
| Load an association without N+1 | **`JOIN FETCH`** or **`@EntityGraph`** |
| Bulk change many rows | JPQL **`UPDATE`/`DELETE`** + `executeUpdate()` (then `clear()`) |
| Repository-level convenience | Spring Data JPA (`@Query`, derived, `Pageable`) — see that topic |

## Common Interview Follow-ups

- **"What's the difference between JPQL and SQL?"** JPQL queries entities/fields (object
  model) and is portable; the provider translates it to dialect SQL against tables/columns.
- **"JPQL vs HQL?"** HQL is Hibernate's superset — every JPQL query is valid HQL; HQL adds
  `INSERT` (JPQL has none), the `WITH` join clause, and extra functions. Modern Hibernate
  parses both through SQM.
- **"When Criteria over JPQL?"** Dynamic queries with optional predicates, and when you want
  compile-time type safety via the metamodel. Not for static queries (too verbose).
- **"Why does `setMaxResults` with a collection `JOIN FETCH` log HHH000104?"** Cardinality:
  one parent → many child rows, so SQL LIMIT can't be applied without truncating a parent's
  children; Hibernate paginates in memory. Fix with the two-query ID approach.
- **"What does `executeUpdate()` bulk DML NOT do?"** Doesn't update the persistence
  context/L1, doesn't cascade, doesn't run lifecycle callbacks, doesn't bump `@Version`
  automatically. Clear the EM after.
- **"Named vs positional parameters?"** Both bind safely; named (`:x`) is preferred for
  readability; positional (`?1`) is **1-based**. Never concatenate — injection.
- **"How do named queries help?"** JPQL named queries are validated at startup (fail-fast)
  and can be precompiled/reused.
- **"How do you avoid loading entities you'll only read?"** Constructor-expression DTO
  projection — unmanaged, minimal columns, no dirty-check overhead.
- **"Why can't you `JOIN FETCH` two collections?"** Cartesian product / `MultipleBagFetchException`;
  fetch one collection per query, batch the rest.

## References

- Jakarta Persistence 3.1 / 3.2 Specification — Query Language (JPQL), Criteria API,
  parameters, `@NamedQuery`, `@SqlResultSetMapping`, `@ConstructorResult`.
- Hibernate ORM 6.x / 7.x User Guide — HQL & JPQL, SQM (Semantic Query Model), native
  queries, pagination, bulk update/delete, entity graphs.
- Hibernate `hibernate-jpamodelgen` — static metamodel generation for the Criteria API.
- Cross-references in this library: `hibernate-jpa/fetching-lazy-eager-n-plus-one`
  (N+1 + JOIN FETCH), `hibernate-jpa/caching-first-second-level` (query cache & bulk-DML
  invalidation), `hibernate-jpa/transactions-dirty-checking-flushing` (flush/managed state),
  `hibernate-jpa/spring-data-jpa-repositories` (`@Query`, projections, `Pageable`),
  `messaging-databases/sql-joins` + `messaging-databases/indexing` (SQL & DB mechanics),
  and the security domain (injection).
