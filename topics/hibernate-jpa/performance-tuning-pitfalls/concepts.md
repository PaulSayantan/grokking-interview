# Performance Tuning & Common Pitfalls

This is the senior-level "make it fast / here is what goes wrong" topic — the
synthesis of every gotcha in the ORM. A junior calls `save()` and `findById()`; a
senior knows *what SQL Hibernate actually generates*, *how many round-trips it costs*,
and *which default will silently blow up in production*. Almost every Hibernate
performance disaster traces back to a handful of causes: the **N+1 problem**,
**over-fetching**, **broken JDBC batching**, an **unbounded persistence context**, or
**`equals`/`hashCode` written wrong on entities**. This page covers each mechanism, the
real fix, and the trade-offs.

> [!INTERVIEW]
> The single best signal in a Hibernate interview is that you *measure* before you
> tune: turn on SQL logging (or `hibernate.generate_statistics`) and count the
> queries a request issues. "It felt slow so I added a second-level cache" is a
> junior answer. "I saw 200 SELECTs for a 50-row page, recognized N+1, and replaced
> it with one `JOIN FETCH`" is a senior one.

The underlying database mechanics — index selection, join algorithms, lock
granularity, MVCC read consistency, isolation-level anomalies — live in
`messaging-databases` (see `messaging-databases/indexing`, `messaging-databases/sql-joins`,
`messaging-databases/transactions-isolation`). The Spring container, `@Transactional`
proxying, and propagation live in `spring-boot`/`spring-core`. Here we stay at the ORM
altitude: what SQL Hibernate *emits*, why, and how to control it.

## Measuring Before Tuning

You cannot tune what you cannot see. Hibernate hands you several observation tools:

- **`hibernate.generate_statistics=true`** — exposes a `Statistics` object with query
  counts, cache hit/miss ratios, entity load counts, flush counts, and the slowest
  query. This is the primary "how many queries did that request run?" tool.
- **SQL logging** — set the `org.hibernate.SQL` logger to `DEBUG` to see every
  statement, and `org.hibernate.orm.jdbc.bind` (Hibernate 6+; formerly
  `org.hibernate.type.descriptor.sql`) to `TRACE` to see bound parameters.
- **`hibernate.format_sql=true` / `highlight_sql=true`** — pretty-print for reading.
- **A query counter in tests** — libraries like *datasource-proxy* or a JUnit
  assertion on `Statistics.getPrepareStatementCount()` let you *fail the build* when a
  method suddenly issues 100 queries. This is how you prevent N+1 regressions.

> [!WARNING]
> Never ship `show_sql=true` (which writes to `System.out`, unformatted, bypassing the
> logging framework) to production. Use the `org.hibernate.SQL` logger instead so it
> honors log levels and appenders.

Do NOT profile with a single-row dataset. N+1, Cartesian products, and large
persistence contexts only reveal themselves with realistic data volumes.

## The N+1 Problem and the Fix Menu

The N+1 problem is the number-one Hibernate performance issue. You run **1** query to
load N parents, then Hibernate runs **N** more queries (one per parent) to load a lazy
association — 1 + N round-trips where 1 or 2 would do.

```java
List<Post> posts = em.createQuery("select p from Post p", Post.class).getResultList();
for (Post p : posts) {
    p.getComments().size();   // triggers a SELECT per post
}
```

```sql
select * from post;                              -- 1 query
select * from comment where post_id = 1;         -- +N
select * from comment where post_id = 2;
...                                              -- one per post
```

It also strikes with **EAGER `@ManyToOne`**: loading N children via JPQL fires one
SELECT per distinct parent (JPQL EAGER associations are fetched with secondary selects,
not an automatic join). The fix menu — memorize it:

| Fix | Mechanism | When to use |
|---|---|---|
| `JOIN FETCH` (JPQL/HQL) | One query with a join; initializes the association | Per-query, one collection |
| `@EntityGraph` | Declarative fetch plan on a query/repository method | Reusable, Spring Data friendly |
| `@BatchSize(size=n)` / `hibernate.default_batch_fetch_size` | Loads lazy associations in batches of `n` via `IN (?,?,…)` | Many associations, keeps pagination |
| `@Fetch(SUBSELECT)` | One extra query re-running the parent query as a subselect | Collections on a large result set |
| DTO projection | Select only needed columns, no entities/associations | Read-only views/reports |

```java
// JOIN FETCH — collapses N+1 into ONE query
select p from Post p join fetch p.comments where p.id in :ids
```

> [!KEY-TAKEAWAY]
> The senior answer to "how do you fix N+1?" is never "make it EAGER." EAGER *causes*
> N+1 and Cartesian products as often as it prevents them. Keep everything LAZY, then
> fetch exactly what each use case needs per query. Full detail lives in
> `hibernate-jpa/fetching-lazy-eager-n-plus-one`.

## JDBC Batching for Inserts and Updates

By default Hibernate sends one JDBC statement (one network round-trip) per
insert/update/delete. **JDBC batching** groups many statements into a single
`PreparedStatement.executeBatch()` call, cutting round-trips dramatically for bulk
writes. It is **off by default** — you must enable it:

```properties
hibernate.jdbc.batch_size=50          # >0 turns batching on
hibernate.order_inserts=true          # group same-table inserts so they batch
hibernate.order_updates=true          # same for updates
hibernate.batch_versioned_data=true   # allow batching of @Version updates
```

The mechanism: Hibernate accumulates statements and flushes them in batches of
`batch_size`. Batching only works when consecutive statements are *identical* (same SQL
string, same table). If you interleave inserts to `Post` and `Comment`,
`order_inserts=true` reorders them so all `Post` inserts group together, then all
`Comment` inserts — otherwise each table switch breaks the batch.

> [!WARNING]
> A single query cache line and interleaved entity types silently defeat batching.
> Verify with `generate_statistics` that the JDBC batch count is far below the row
> count, not equal to it.

## Why IDENTITY Generation Disables Insert Batching

This is a classic senior gotcha. With `GenerationType.IDENTITY`, the database assigns
the primary key via an auto-increment column, and Hibernate can only learn the
generated id by executing the `INSERT` and reading it back (`Statement.getGeneratedKeys()`).

Because JPA requires a persisted entity to have its id populated, Hibernate **must
execute each INSERT immediately** to obtain the key — it cannot defer and batch them.
Therefore **IDENTITY disables JDBC insert batching entirely**.

`GenerationType.SEQUENCE` (or the modern default `GenerationType.AUTO` backed by a
sequence, with a `pooled`/`pooled-lo` optimizer) lets Hibernate fetch a block of ids
*up front*, so it can assign keys in memory and batch the inserts. This is why on
PostgreSQL/Oracle you prefer SEQUENCE for write-heavy workloads.

| Strategy | id known before INSERT? | Insert batching | Notes |
|---|---|---|---|
| `IDENTITY` | No — read back after INSERT | **Disabled** | Fine for low write volume; MySQL default |
| `SEQUENCE` | Yes — allocated ahead | **Works** | Preferred for batching; use pooled optimizer |
| `TABLE` | Yes | Works | Legacy; extra table + locking, avoid |

> [!KEY-TAKEAWAY]
> "Why aren't my inserts batching?" → check for `IDENTITY`. Switching to a sequence
> with a pooled optimizer both enables batching and cuts sequence round-trips. See
> `hibernate-jpa/primary-keys-and-id-generation`.

## equals() and hashCode() on Entities

Getting `equals`/`hashCode` wrong on entities is a subtle, data-corrupting pitfall —
especially with `Set` collections. The trap: a generated `@Id` is **null until the
entity is persisted**. If `hashCode()` is derived from the id:

```java
// BROKEN for new entities
@Override public int hashCode() { return Objects.hash(id); }
```

then a transient entity's hash is based on `null`, and *changes* once the id is
assigned on flush. An entity added to a `HashSet` while transient lands in one bucket
(hash of null), then after persist its hash changes — you can no longer find it in the
set, `contains()` returns false, and iteration/removal breaks. This is the
**"detached-entity-in-a-HashSet"** bug.

The rules for entity `equals`/`hashCode`:

- **Never use the auto-generated `@Id` in `hashCode()`** for entities that may live in
  a `Set` before being persisted.
- Prefer a **stable business key** (a natural, immutable unique field — e.g. an
  order number, ISBN, email) if one exists.
- If none exists, **assign a UUID in the constructor** and base `equals`/`hashCode` on
  it. It is stable across the transient→managed transition.
- A pragmatic pattern: `hashCode()` returns a **constant** (e.g. `getClass().hashCode()`)
  and `equals()` compares the id when both are non-null. Constant hashCode is legal (all
  entities collide into one bucket) and avoids the mutation bug, at the cost of `Set`
  lookup degrading to O(n) — usually fine for small collections.

```java
@Entity
class Customer {
    @Id @GeneratedValue Long id;

    @Column(nullable = false, updatable = false, unique = true)
    private UUID businessKey = UUID.randomUUID();   // stable from construction

    @Override public boolean equals(Object o) {
        return (o instanceof Customer c) && businessKey.equals(c.businessKey);
    }
    @Override public int hashCode() { return businessKey.hashCode(); }
}
```

> [!WARNING]
> Lombok's `@Data`/`@EqualsAndHashCode` on an entity generates id-and-all-fields
> equality — a double footgun (id mutation bug *and* touching lazy associations,
> which can trigger `LazyInitializationException` or extra queries inside
> `equals`/`hashCode`). Never put `@Data` on a JPA entity.

## LazyInitializationException and the OSIV Debate

`LazyInitializationException` (LIE) is thrown when you navigate a LAZY association
*after* the persistence context that created the proxy has closed. The proxy has no
open `Session` to run its initializing SELECT, so it fails.

```java
Post p = repo.findById(id).orElseThrow();   // tx commits, session closes
// ... later, in the view/controller layer:
p.getComments().size();   // LazyInitializationException
```

The **legitimate fixes** (fetch the data *while the session is open*):

- `JOIN FETCH` / `@EntityGraph` on the query so the association is initialized eagerly
  for that use case.
- A **DTO projection** that selects exactly what the view needs — no proxies to
  initialize.
- Initialize inside the transactional service method (`Hibernate.initialize(...)` or
  just touch it) before returning.

**Open Session In View (OSIV)** is the controversial "fix": it keeps the `Session`/
`EntityManager` open for the entire HTTP request (through view rendering), so lazy
access in the view never fails. Spring Boot enables it by default
(`spring.jpa.open-in-view=true`) and logs a warning.

| | With OSIV | Without OSIV |
|---|---|---|
| Lazy access in view | Works | Throws LIE |
| N+1 risk | **High** — view triggers hidden queries per row | Forced to fetch explicitly, so N+1 surfaces early |
| DB connection held | For the whole request (incl. rendering) | Released at tx commit |
| Recommendation (senior) | Disable in services/APIs | **Preferred** — fetch explicitly |

> [!INTERVIEW]
> The senior stance: **disable OSIV** (`spring.jpa.open-in-view=false`) and fetch
> exactly what each endpoint needs. OSIV hides N+1 by making lazy loads "just work" in
> the view, and it holds the DB connection open through view rendering, hurting
> connection-pool throughput under load. The tx/proxy mechanics are in `spring-boot`.

## Over-Fetching and DTO Projections

Over-fetching is loading more than you need: `SELECT *` of a wide entity when you need
two columns, EAGER associations dragging in object graphs, or loading full managed
entities for a read-only screen. Costs: network, memory, persistence-context bloat
(every loaded entity is dirty-checked on flush), and a hydration/snapshot cost per
entity.

The fix is **projections** — fetch only the columns you need:

- **JPQL constructor expression** → immutable DTO:
  `select new com.app.PostView(p.id, p.title) from Post p`
- **Spring Data interface projection** → `interface PostView { Long getId(); String getTitle(); }`
  used as the method return type. Hibernate selects only the mapped columns.
- **Record/class-based DTO** with Spring Data, or `Tuple`/`Object[]` for ad-hoc.

Projections return **detached, read-only data** — no dirty checking, no lazy proxies,
no LIE, a smaller persistence context. For read paths (dashboards, list screens,
reports) they are almost always the right tool.

> [!KEY-TAKEAWAY]
> Load *entities* when you intend to *modify* them (you need dirty checking and the
> lifecycle). Load *DTO projections* when you only intend to *read*. Reaching for a
> full entity graph on a read-only screen is the most common over-fetching mistake.
> See `hibernate-jpa/querying-jpql-hql-criteria-native`.

## MultipleBagFetchException and Cartesian Products

If you `JOIN FETCH` **two collections** in one query, the SQL produces a **Cartesian
product**: N comments × M tags = N×M rows for one post, exploding result size and
memory. Hibernate refuses this for two `List`s (which it treats as *bags* — unordered,
duplicate-allowing) by throwing:

```
org.hibernate.loader.MultipleBagFetchException: cannot simultaneously fetch multiple bags
```

Fixes:

- **Fetch collections in separate queries** — fetch one collection per query, let the
  persistence context stitch them onto the same managed entities (Hibernate merges them
  because it is the same session). This is the cleanest fix.
- Change one or both collections from `List` to `Set` — Hibernate then allows the fetch
  (a `Set` de-duplicates), but you *still* pay the Cartesian product in transferred rows.
  Not a real performance fix.
- Use `@BatchSize` / `default_batch_fetch_size` so the second collection loads in a
  batched `IN (…)` instead of a fetch join.

> [!WARNING]
> Two `Set` collections avoid the *exception* but not the *Cartesian product*. The
> genuinely scalable approach is to fetch at most one collection per query (or batch
> the rest), never two collection fetch-joins in one statement.

## Pagination with Collection Fetch (HHH000104)

Combining `setFirstResult`/`setMaxResults` (pagination) with a `JOIN FETCH` of a
**collection** is a trap. Because the join produces multiple rows per root entity,
Hibernate cannot apply the SQL `LIMIT`/`OFFSET` to *entities* — a `LIMIT 10` on rows
might return 3 posts. So Hibernate **pages in memory**: it fetches *all* rows, then
applies the limit in Java, logging:

```
HHH000104: firstResult/maxResults specified with collection fetch; applying in memory!
```

On a large table this reads the entire result set into memory — a latent OOM. Fixes:

- **Two-query approach**: page the root ids first (`select p.id … limit/offset`), then
  fetch the collection for that id set with `where p.id in :ids` + `JOIN FETCH`. This
  paginates on the DB and avoids in-memory paging.
- Use **`@BatchSize`** so pagination works on roots (no fetch join) and the collection
  loads in batches.
- In Hibernate 6+, this is still the behavior; the two-query / batch approach remains
  the fix.

> [!INTERVIEW]
> "How do you paginate a query that also needs a child collection?" Correct answer:
> page the parent ids in query 1 (DB-side LIMIT), then fetch children by id-set in
> query 2 — *never* `JOIN FETCH` a collection together with `setMaxResults`, or you
> silently page in memory (HHH000104).

## Managing the Persistence Context in Batch Loops

The persistence context (first-level cache) holds **every managed entity** for the
duration of a transaction, plus a **dirty-checking snapshot** of each. In a long batch
loop this grows unbounded → memory pressure, and each `flush()` re-scans *every*
managed entity (O(n) dirty check per flush → O(n²) overall). This is why naive bulk
inserts get slower and slower.

The canonical batch pattern: flush and **clear** the context every `batch_size` rows.

```java
for (int i = 0; i < list.size(); i++) {
    em.persist(list.get(i));
    if (i % 50 == 0) {          // == batch_size
        em.flush();             // push this batch's INSERTs to the DB
        em.clear();             // detach them → free memory, shrink dirty-check set
    }
}
```

`flush()` synchronizes pending SQL to the DB (does *not* commit); `clear()` detaches
all managed entities so they can be garbage-collected and are no longer dirty-checked.
Together with JDBC batching (`batch_size` + `order_inserts`) and a sequence generator,
this is the standard high-throughput write loop.

> [!WARNING]
> Calling `flush()` too often (e.g. inside a tight loop with no `clear()`) gives you
> the worst of both worlds: repeated full dirty-check scans of an ever-growing context.
> Flush/clear *together*, at the batch boundary. See
> `hibernate-jpa/transactions-dirty-checking-flushing` for flush timing and modes.

## StatelessSession for Bulk Work

For pure bulk import/export, Hibernate's **`StatelessSession`** is often the better
tool. It is a thin wrapper over JDBC that **has no persistence context**: no
first-level cache, no dirty checking, no automatic flush, no cascade, no lazy
proxies, no event listeners, no second-level cache interaction.

```java
StatelessSession ss = sessionFactory.openStatelessSession();
Transaction tx = ss.beginTransaction();
for (Row r : rows) ss.insert(new Record(r));   // no context accumulation
tx.commit();
ss.close();
```

Because there is no context to accumulate or dirty-check, memory stays flat and you
skip the snapshot/flush overhead entirely — you don't even need `clear()`. Trade-offs:
you lose cascade, dirty checking, and the L1/L2 caches, and you must manage
associations by hand. Use it for one-shot ETL-style bulk work, not general application
logic. (JDBC batching still applies to a `StatelessSession`.)

## Second-Level and Query Cache Misuse

The second-level cache (L2) and query cache can *cause* problems when misapplied. Cache
mechanics live in `hibernate-jpa/caching-first-second-level`; here are the
*performance pitfalls*:

- **L2 on volatile, write-heavy entities** → constant invalidation churn and cache-miss
  overhead that costs more than it saves. Cache read-mostly reference data, not hot
  mutable rows.
- **Query cache without also caching the entities** → the query cache stores only
  *entity ids*; on a hit it then loads each entity — re-introducing N+1 unless those
  entities are in L2. Enabling the query cache alone is a classic footgun.
- **Query cache on frequently-changing tables** → any write to a table invalidates
  *all* cached queries touching it, so the cache is perpetually cold.
- **Distributed L2 correctness** → in a cluster, a plain local cache serves stale data;
  you need a distributed/invalidating provider and must reason about consistency (see
  `system-design` for cache-coherence patterns).

> [!KEY-TAKEAWAY]
> Caching is not a substitute for fixing N+1 or over-fetching — fix the query first.
> The query cache in particular only helps when the target entities are *also* L2-cached
> and the underlying table changes rarely.

## Optimistic Locking and @Version Misuse

`@Version` enables optimistic locking: Hibernate adds `WHERE version = ?` to updates and
throws `OptimisticLockException`/`StaleObjectStateException` if zero rows match (someone
else changed the row). Common misuses:

- **Mutating the `@Version` field by hand** — it is provider-managed; setting it
  yourself corrupts the concurrency check.
- **Ignoring/blanket-catching `OptimisticLockException`** instead of retrying the whole
  transaction with a fresh read.
- **Assuming optimistic locking prevents lost updates for detached/DTO round-trips**
  without carrying the version back — if the client doesn't return the version you read,
  the check is defeated.
- **Reaching for pessimistic locks (`PESSIMISTIC_WRITE`) by default** — they hold DB row
  locks for the transaction, hurting concurrency. Prefer optimistic unless contention is
  genuinely high.

| | Optimistic (`@Version`) | Pessimistic (`PESSIMISTIC_WRITE`) |
|---|---|---|
| DB lock held | No — checks version at update | Yes — `SELECT … FOR UPDATE` |
| Best when | Low/moderate contention | High contention, short critical section |
| Failure mode | Exception at commit → retry | Lock wait / deadlock / timeout |
| Cost | Cheap; scales | Serializes access; can deadlock |

Lock-mode and isolation-level details are in `messaging-databases/transactions-isolation`;
JPA lock modes here.

## Using an ORM for Bulk and Reporting

An ORM's job is mapping an *object graph* you will manipulate. It is the **wrong tool**
for set-based bulk operations and complex reporting:

- **Bulk update/delete** — don't load 100k entities to change a flag. Use a JPQL bulk
  operation (`update Post p set p.archived = true where …`) which compiles to a single
  SQL `UPDATE`. Caveat: bulk JPQL **bypasses the persistence context and cascade** —
  managed entities go stale, so `em.clear()` after, and it does not cascade or run
  `@PreUpdate`.
- **Complex reports/analytics** — multi-way joins, window functions, aggregations map
  poorly to entities and drag in over-fetching. Use **native SQL**, a projection to a
  DTO, or a dedicated SQL library like **jOOQ**. Hibernate 6's typed SQM helps, but
  reporting is a native-SQL job.
- **Streaming huge result sets** — use `Stream`/scrollable results plus periodic
  `clear()`, or a `StatelessSession`, so you don't materialize everything.

> [!INTERVIEW]
> "You need to archive 5 million rows — how?" Wrong: load them as entities and loop.
> Right: a single bulk `UPDATE` (JPQL or native), or batches with flush/clear/
> `StatelessSession` if per-row logic is required. Recognize when to *step outside* the
> ORM. Set-based SQL semantics live in `messaging-databases`.

## Anti-Pattern Checklist

A rapid-fire senior review checklist — each maps to a section above:

- **N+1**: lazy association accessed in a loop, or EAGER `@ManyToOne` on a list query.
  Fix: `JOIN FETCH` / `@EntityGraph` / `@BatchSize`.
- **OSIV on**: `spring.jpa.open-in-view=true` hiding N+1 and holding connections. Turn
  it off; fetch explicitly.
- **EAGER by default**: to-one associations left EAGER "to avoid LIE." Make them LAZY,
  fetch per query.
- **`@Data`/id-based `hashCode` on entities**: Set corruption + lazy-load in equals.
  Use a business key or constructor-assigned UUID.
- **IDENTITY on a write-heavy entity**: insert batching disabled. Use SEQUENCE + pooled.
- **Batching not enabled**: `hibernate.jdbc.batch_size` unset, `order_inserts` off.
- **No flush/clear in batch loops**: persistence context grows unbounded, O(n²) dirty
  checks. Or use `StatelessSession`.
- **Two collection `JOIN FETCH`es**: `MultipleBagFetchException` / Cartesian product.
  Fetch one per query or batch.
- **Pagination + collection fetch**: HHH000104 in-memory paging. Page ids first.
- **Full entities for read-only screens**: over-fetching. Use DTO projections.
- **Query cache alone / L2 on hot mutable data**: cache churn. Cache read-mostly data,
  and L2-cache entities the query cache references.
- **Loading entities for bulk update/delete**: use bulk JPQL / native SQL.
- **Manually setting `@Version`** or swallowing `OptimisticLockException`.

## Common Interview Follow-ups

- *"Walk me through diagnosing a slow endpoint that got worse as data grew."* — Enable
  statistics/SQL logging, count queries per request; the growth signature points to N+1
  (query count ∝ rows) or persistence-context bloat (memory/flush time ∝ rows).
- *"Why won't my inserts batch even though I set `batch_size`?"* — `IDENTITY`
  id-generation, interleaved entity types without `order_inserts`, or `batch_size`
  applied after the session was built.
- *"What's wrong with EAGER everywhere?"* — Causes N+1 and Cartesian products, can't be
  overridden to LAZY per-query, and drags whole graphs into memory. LAZY + per-query
  fetch is correct.
- *"Explain the HashSet bug with entity `equals`/`hashCode`."* — Id is null when
  transient and changes on persist; if hashCode uses id, the entity's bucket moves and
  the Set loses it. Use a stable business key/UUID.
- *"OSIV — on or off, and why?"* — Off for services/APIs: it hides N+1 and holds
  connections through view rendering; fetch exactly what each endpoint needs.
- *"How do you paginate with a child collection?"* — Page parent ids first, then fetch
  children by id-set; never `JOIN FETCH` a collection with `setMaxResults`.
- *"When would you drop out of the ORM entirely?"* — Bulk update/delete, complex
  reporting/analytics, and high-volume ETL — use bulk JPQL, native SQL/jOOQ, or a
  `StatelessSession`.

## References

- Jakarta Persistence 3.1/3.2 specification — `jakarta.persistence.*` (fetch types,
  `@Version`, lock modes, bulk update/delete via `Query`).
- Hibernate ORM 6.x/7.x User Guide — Performance chapter (batch fetching, `@BatchSize`,
  fetch profiles, statistics), Batching chapter (`jdbc.batch_size`, `order_inserts`),
  `StatelessSession`, and the Caching chapter.
- Vlad Mihalcea, *High-Performance Java Persistence* — the definitive treatment of N+1,
  batching, IDENTITY vs SEQUENCE, and entity `equals`/`hashCode`.
- Sibling topics: `hibernate-jpa/fetching-lazy-eager-n-plus-one`,
  `hibernate-jpa/transactions-dirty-checking-flushing`,
  `hibernate-jpa/primary-keys-and-id-generation`,
  `hibernate-jpa/caching-first-second-level`,
  `hibernate-jpa/querying-jpql-hql-criteria-native`,
  `hibernate-jpa/spring-data-jpa-repositories`.
- Cross-domain: `messaging-databases/indexing`, `messaging-databases/sql-joins`,
  `messaging-databases/transactions-isolation`; `spring-boot`/`spring-core` for the
  container and `@Transactional`; `system-design` for caching/data architecture.
