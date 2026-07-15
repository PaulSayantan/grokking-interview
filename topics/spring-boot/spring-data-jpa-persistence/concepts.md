# Spring Data JPA & Persistence

Spring Data JPA sits on top of the JPA specification and a JPA provider
(Hibernate by default in Spring Boot). This topic covers the whole
persistence stack an interviewer probes: the layering of JPA/Hibernate/Spring
Data, the repository hierarchy, query mechanisms, the persistence context and
entity lifecycle, fetch strategies and the N+1 problem, caching, locking, and
auditing. Version note: Spring Boot 3.x uses **Jakarta Persistence** (packages
`jakarta.persistence.*`) with Hibernate ORM 6.x, replacing the old
`javax.persistence.*` packages from Spring Boot 2.x / Java EE.

---

## JPA vs Hibernate vs Spring Data JPA

These three are frequently confused. They are layers, not competitors.

| Layer | What it is | Concrete artifacts |
|---|---|---|
| **JPA** | A *specification* (JSR 338 / Jakarta Persistence). Defines annotations (`@Entity`, `@Id`), the `EntityManager` API, and JPQL. Ships **no** runtime. | `jakarta.persistence.*` interfaces & annotations |
| **Hibernate** | A *JPA provider* — a concrete ORM implementation of the spec, plus native extras (e.g. `Session`, `@BatchSize`, `Criteria`). | `org.hibernate.*`, `SessionFactory`, `Session` |
| **Spring Data JPA** | An abstraction *above* JPA that removes boilerplate: you declare repository interfaces and Spring generates the implementation at runtime. | `JpaRepository`, derived queries, `@Query` |

- **Beginner takeaway:** JPA is the "interface", Hibernate is the "implementation", Spring Data JPA is the "convenience wrapper" that saves you from writing DAO/`EntityManager` code by hand.
- **Intermediate:** You can drop from Spring Data down to raw `EntityManager` (inject with `@PersistenceContext`) or even to the Hibernate `Session` (via `entityManager.unwrap(Session.class)`) when you need provider-specific features.
- **Advanced / trap:** Spring Data JPA does **not** replace Hibernate — under the hood the generated repository still uses an `EntityManager`, which in Spring Boot is backed by Hibernate. Switching provider (e.g. to EclipseLink) is possible but rarely done. Also, Spring Data *JPA* is one module of the broader Spring Data family (Spring Data JDBC, MongoDB, Redis…) — Spring Data JDBC deliberately has **no** persistence context / lazy loading / dirty checking, which is a common comparison question.

---

## Repository hierarchy

Spring Data defines a layered set of repository interfaces. You extend the one
that gives the capabilities you need.

```
Repository<T, ID>                                // marker, no methods
   ├── CrudRepository<T, ID>                     // save, findById, findAll, delete, count, existsById
   │      └── ListCrudRepository<T, ID>          // (Spring Data 3+) returns List instead of Iterable
   └── PagingAndSortingRepository<T, ID>         // findAll(Pageable), findAll(Sort)  — in 3.x extends Repository, NOT CrudRepository
          └── ListPagingAndSortingRepository<T, ID>  // (Spring Data 3+) List-returning variant

JpaRepository<T, ID>  extends  ListCrudRepository + ListPagingAndSortingRepository + QueryByExampleExecutor  // combines CRUD + paging
```

- **`Repository<T,ID>`** — marker interface; carries no methods but activates Spring Data proxy generation.
- **`CrudRepository<T,ID>`** — generic CRUD: `save`, `saveAll`, `findById`, `existsById`, `findAll`, `count`, `deleteById`, `delete`.
- **`PagingAndSortingRepository<T,ID>`** — adds `findAll(Sort)` and `findAll(Pageable)`. In Spring Data 3.x this **no longer extends** `CrudRepository` (they were decoupled); `JpaRepository` still combines both.
- **`JpaRepository<T,ID>`** — JPA-specific superset: adds `flush()`, `saveAndFlush()`, `deleteAllInBatch()`, `getReferenceById()` (replaces the deprecated `getOne()`), and returns `List` instead of `Iterable`.

```java
public interface UserRepository extends JpaRepository<User, Long> {
    // inherited CRUD + paging + JPA methods for free
}
```

- **Advanced:** At startup, `JpaRepositoryFactory` creates a JDK dynamic **proxy** implementing your interface; calls route through `SimpleJpaRepository` (the base impl) plus query-method interceptors. That is why you never write an `@Repository` impl class. `@NoRepositoryBean` marks intermediate interfaces that should not get an instance (used when you create your own base repository).
- **Expert — how a call is dispatched:** The proxy holds an ordered chain of `MethodInterceptor`s (a `QueryExecutorMethodInterceptor`). For each invocation it decides, in order: is this a *custom fragment* method (from a `…Impl` class or a `@RepositoryDefinition` fragment)? Is it a *base* method implemented on `SimpleJpaRepository`? Otherwise it is a *query method* resolved by the `QueryLookupStrategy` (`CREATE`, `USE_DECLARED_QUERY`, or the default `CREATE_IF_NOT_FOUND`). Custom fragments always win over the base implementation, which is how you override, say, `save`.
- **Expert — `SimpleJpaRepository` is `@Transactional(readOnly=true)` at the class level**, with write methods (`save`, `delete`, …) overriding to `@Transactional` (read-write). So even without a service-layer transaction, a single repository call is transactional. But two repository calls from a non-transactional caller run in **two separate transactions/persistence contexts** — a classic source of `LazyInitializationException` and lost identity guarantees.
- **Expert — custom base repository:** To change behavior for *all* repositories, write a class extending `SimpleJpaRepository`, mark your base interface `@NoRepositoryBean`, and point `@EnableJpaRepositories(repositoryBaseClass = MyBaseRepo.class)` at it.

---

## Derived query methods

Spring Data parses the *method name* into a query. Structure: an
introducing keyword + `By` + property expressions joined by `And`/`Or`.

```java
List<User> findByLastNameAndActiveTrue(String lastName);
List<User> findByAgeGreaterThanEqualOrderByAgeDesc(int age);
Optional<User> findFirstByEmailIgnoreCase(String email);
long countByStatus(Status status);
boolean existsByEmail(String email);
List<User> findTop3ByOrderByCreatedAtDesc();
```

- Supported keywords: `Is`, `Equals`, `Between`, `LessThan`, `GreaterThan`, `Like`, `StartingWith`, `Containing`, `In`, `IsNull`, `True`/`False`, `IgnoreCase`, `OrderBy…Asc/Desc`, `Distinct`, `First`/`Top<N>`.
- Introducing keywords: `find`, `read`, `get`, `query`, `stream`, `count`, `exists`, `delete`.
- **Intermediate:** Property traversal follows associations: `findByAddressZipCode` resolves `x.address.zipCode`. Ambiguity is resolved greedily; use an underscore `findByAddress_ZipCode` to force the split.
- **Trap:** Long derived names become unreadable and error-prone; interviewers expect you to say "switch to `@Query`" past ~2–3 predicates. A misspelled property fails **fast at application startup** (bootstrapping validates the method), which is a plus vs runtime failure.
- **Expert — `findFirst`/`findTop` + `Sort` + delete semantics:** Limiting keywords (`First`, `Top<N>`) apply the limit *after* any `OrderBy` or dynamic `Sort`. When combined with a `Pageable`, the `Top`/`First` value sets the overall maximum and the `Pageable` can only narrow it further within that cap; they cannot be mixed with a `Limit` parameter. `deleteBy…` derived methods are *not* bulk queries — Spring Data first **SELECTs** the matching entities then calls `EntityManager.remove` on each, so cascade, `orphanRemoval`, and `@PreRemove` all fire (unlike `@Modifying delete`). This makes `deleteByStatus` far slower than a bulk delete but lifecycle-correct.
- **Expert — return-type contracts:** A single-result derived query returning more than one row throws `IncorrectResultSizeDataAccessException`; returning `Optional<T>` for a query that yields a `null` scalar (e.g. `SELECT max(...)`) still wraps `null` safely. `Stream<T>` return types must be consumed inside the transaction and closed (try-with-resources) or the underlying JDBC `ResultSet`/connection leaks.

---

## @Query: JPQL vs native

When derived methods aren't enough, annotate with `@Query`.

```java
// JPQL (operates on entities & fields, portable across DBs)
@Query("select u from User u where u.email = :email")
Optional<User> findByEmail(@Param("email") String email);

// Native SQL (operates on tables & columns)
@Query(value = "SELECT * FROM users WHERE email = ?1", nativeQuery = true)
Optional<User> findByEmailNative(String email);
```

| Aspect | JPQL | Native SQL |
|---|---|---|
| Operates on | Entities, fields | Tables, columns |
| Portability | DB-agnostic | DB-specific |
| Features | Limited to JPQL grammar | Full SQL (window functions, hints, CTEs) |
| Pagination | Works transparently | Works, but count query may need `countQuery` |
| Return type | Entities/DTOs | Entities (if columns match) or `Object[]`/projection |

- **Named vs positional params:** `:name` with `@Param("name")` vs `?1`. Named is preferred for readability.
- **`countQuery`:** For native paginated queries Spring can't always derive the count; supply `@Query(value=..., countQuery=..., nativeQuery=true)`.
- **SpEL / `#{#entityName}`** lets you write generic queries in base repositories.
- **Trap:** JPQL `SELECT u FROM User u` uses the **entity name**, not the table name; `User` is case-sensitive and refers to the `@Entity` name.
- **Expert — `@Query` + `@Param` + collection expansion:** For `where u.id in :ids`, an empty collection produces `IN ()`, which is invalid SQL on many databases; guard against empty lists in code. Also, positional `?1` and named `:x` cannot be mixed in one query.
- **Expert — SpEL injection surface:** `@Query` supports SpEL only in specific places via `?#{...}` / `:#{...}` (e.g. `?#{[0]}` for the first argument, `:#{#pageable}` in count queries). Interpolating a raw method argument into the query *string* (rather than binding it as a parameter) reopens JPQL/SQL injection — always bind, never concatenate.
- **Expert — `LIKE` with bound params:** You cannot write `like '%:term%'` (the `:term` inside quotes is a literal). Use `like %:term%` (Spring Data expands it) or `like concat('%', :term, '%')`, or pass the wildcards in the argument.
- **Expert — DTO/interface projections with `nativeQuery=true`:** interface projection column names must match the result-set aliases case-insensitively; a JPQL `new` constructor expression does **not** work with `nativeQuery=true` (use `@SqlResultSetMapping`/`@NamedNativeQuery` or an interface projection instead).

---

## @Modifying (updates & deletes)

Derived and `@Query` methods are read-only by default. For bulk
`UPDATE`/`DELETE`/DDL you must add `@Modifying`, and the method must run in a
transaction.

```java
@Modifying
@Transactional
@Query("update User u set u.active = false where u.lastLogin < :cutoff")
int deactivateStaleUsers(@Param("cutoff") LocalDateTime cutoff);
```

- Returns `int`/`void` (number of affected rows).
- **Critical gotcha:** A bulk `@Modifying` query goes **straight to the database, bypassing the persistence context**. Entities already loaded in the first-level cache are **not** updated and become stale. Use `@Modifying(clearAutomatically = true)` to clear the context after, and/or `flushAutomatically = true` to flush pending changes before executing.
- **Trap:** Bulk updates also **skip cascade and `@Version` optimistic-lock checks** — they are not entity-lifecycle operations. Don't expect `@PreUpdate` callbacks or version increments to fire. (You *can* manually bump the version in the JPQL: `set u.version = u.version + 1`.)
- **Expert — flush-then-clear ordering:** With both flags, the effective sequence is `flushAutomatically` (push pending managed-entity changes to the DB so the bulk statement sees them) → run the bulk statement → `clearAutomatically` (detach everything so subsequent reads reload). If you clear without flushing, pending dirty changes made *before* the bulk call are silently lost. If you neither flush nor clear, a later read may return a stale first-level-cached copy that overwrites the bulk change on the next flush.
- **Expert — transaction propagation:** Putting `@Transactional` on the repository method itself works, but if a surrounding service transaction already exists the `clearAutomatically` clears the *shared* context — detaching entities the caller still holds, another silent-staleness trap. Prefer scoping bulk operations to their own service method with clear boundaries.
- **Expert — return type / DDL:** `@Modifying` methods may return `void`, `int`, or `boolean`; anything else fails at bootstrap. Setting `@Modifying(flushAutomatically=true)` does nothing for a pure DDL statement, and some databases perform an implicit commit on DDL, escaping the JPA transaction entirely.

---

## Specifications & Criteria API

For dynamic, programmatic, type-safe queries (e.g. filter screens with
optional criteria) use the JPA **Criteria API**, wrapped by Spring Data's
`Specification<T>`. Extend `JpaSpecificationExecutor<T>`.

```java
public interface UserRepository
        extends JpaRepository<User,Long>, JpaSpecificationExecutor<User> {}

static Specification<User> hasStatus(Status s) {
    return (root, query, cb) -> cb.equal(root.get("status"), s);
}
static Specification<User> nameLike(String q) {
    return (root, query, cb) -> cb.like(root.get("name"), "%"+q+"%");
}

// compose at runtime
repo.findAll(hasStatus(ACTIVE).and(nameLike("jo")), pageable);
```

- **Why:** avoids the combinatorial explosion of writing one query per filter combination; predicates compose with `.and()`/`.or()`.
- **Criteria API** is the underlying JPA typesafe query builder (`CriteriaBuilder`, `CriteriaQuery`, `Root`). It is verbose; Specifications and libraries like QueryDSL make it ergonomic.
- **Advanced:** In Spring Data 3.x, `Specification` gained static combinators `Specification.where(...)`, `.allOf(...)`, `.anyOf(...)`, and null-safe handling. Use the metamodel (`User_`) for compile-time-safe attribute references.
- **Expert — the `query` parameter is the same `CriteriaQuery` for count and select:** `findAll(spec, pageable)` runs your specification twice — once for the data query and once for the COUNT query. If your `toPredicate` calls `root.fetch(...)` or `query.distinct(true)` unconditionally, the COUNT query breaks (`fetch` is illegal in a count, and `distinct` changes the count). Guard with `if (Long.class != query.getResultType() && long.class != query.getResultType())` before adding fetches — Spring Data sets the result type to `Long`/`long` for the count query so you can detect it.
- **Expert — duplicate joins:** Composing several specifications that each `root.join("orders")` creates *multiple* SQL joins to the same table unless you reuse the join. Look up an existing join from `root.getJoins()` or cache it in the query, otherwise you get a Cartesian blow-up.
- **Expert — Spring Data 3.0 deprecations:** `Specification.and`/`or` still work, but the old `Specifications` helper class is long gone; `JpaSpecificationExecutor` in 3.x also exposes `findAll(Specification, Sort)` and `findBy(Specification, queryFunction)` (fluent API) for projections/scrolling on top of specifications.

---

## Projections

Return a subset of columns / a DTO instead of the full entity.

```java
// 1. Interface-based (closed) projection
interface NameOnly { String getFirstName(); String getLastName(); }
List<NameOnly> findByActiveTrue();

// 2. Open projection with SpEL (loads full entity, computes in memory)
interface FullName { @Value("#{target.firstName + ' ' + target.lastName}") String getFullName(); }

// 3. Class-based DTO projection (constructor expression)
record UserDto(String firstName, String email) {}
List<UserDto> findByActiveTrue();   // or @Query("select new ...UserDto(u.firstName, u.email) from User u")

// 4. Dynamic projection — caller chooses the shape
<T> List<T> findByActive(boolean active, Class<T> type);
```

- **Closed interface projections** let Spring optimize the SELECT to only the needed columns — good for performance.
- **Open projections (`@Value` SpEL)** force loading of the whole entity, losing the column optimization.
- **DTO/record projections** are ideal for read models and API responses; a JPQL constructor expression `select new com.x.UserDto(...)` maps rows to DTOs.
- **Trap:** Interface projection getters must match property names; nested projections work for associations but can re-introduce N+1 if the association is lazy.
- **Expert — closed projection column optimization only applies to derived/JPQL entity queries, not everything:** Spring narrows the SELECT clause by inspecting the projection's getters, but if the projection getter names don't exactly match root entity properties (e.g. a nested path), or you use `@Query` selecting the full entity, the optimization is lost and the whole row is loaded. An **open** projection (any `@Value`/SpEL getter) makes the *entire* projection open — even the closed-looking getters then load the full entity.
- **Expert — DTO constructor projections and proxies:** A JPQL `select new Dto(u.dept)` cannot select an entity association into a DTO field the way you might expect; you must select scalar fields. Class-based DTOs with a matching constructor are instantiated per row, so they can't lazy-load anything (no managed entity, no session) — which is exactly why they're safe to return from the web layer even with OSIV off.
- **Expert — `@Value` open projection + method invocation:** SpEL in an open projection can call arbitrary methods on `target` and even other beans, but it runs *per row in Java*, so it defeats any DB-side pushdown and can hide expensive per-row work.

---

## Pagination & sorting (Pageable)

```java
Page<User> findByStatus(Status s, Pageable pageable);
Slice<User> findByActiveTrue(Pageable pageable);
List<User> findByStatus(Status s, Sort sort);

Pageable p = PageRequest.of(0, 20, Sort.by("lastName").ascending());
Page<User> page = repo.findByStatus(ACTIVE, p);
page.getTotalElements(); page.getTotalPages(); page.getContent();
```

| Type | Extra query? | Knows total count? | Use when |
|---|---|---|---|
| `Page<T>` | Yes — issues a **second `COUNT`** query | Yes (`getTotalElements`) | You need total pages / "page X of N" |
| `Slice<T>` | No count query; fetches `limit+1` to detect next | No | Infinite scroll / "load more" |
| `List<T>` | No | No | You just want a windowed list |

- **Advanced / trap 1:** `Page` triggers an extra COUNT query every call — on huge tables this is expensive; prefer `Slice` when you don't need the total.
- **Trap 2 — pagination + `JOIN FETCH` of a collection:** Hibernate cannot paginate in SQL when a collection is fetch-joined (rows are duplicated), so it fetches **all** rows and paginates **in memory**, logging `HHH000104: firstResult/maxResults specified with collection fetch; applying in memory`. Fix with `@EntityGraph`, a two-query approach (fetch IDs then entities), or `@BatchSize`.
- Sorting by a non-persistent/derived alias in native queries needs care; JPQL sort is on entity properties.
- **Expert — `Page` count-query optimization:** Spring Data does *not* always issue the COUNT. `PageableExecutionUtils` skips it when the result set is smaller than the page size **and** the page is the first (offset 0), or when the current page is the last one — it derives the total from `offset + content.size()`. So a `Page` on a small table may not run a COUNT at all.
- **Expert — offset pagination is O(offset):** `LIMIT ? OFFSET ?` forces the DB to scan and discard all preceding rows, so deep pages (`page=10000`) degrade linearly and can silently skip/duplicate rows if data is inserted between page fetches. The modern fix is **keyset (seek) pagination** — `WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?` — which is O(page size) and stable.
- **Expert — Spring Data 3.1 Scroll API:** `Window<T> scroll(Sort/Pageable + ScrollPosition)` supports both `OffsetScrollPosition` and `KeysetScrollPosition`. A repository method can return `Window<T>` and be driven by `ScrollPosition.offset()` / `ScrollPosition.keyset()`; `window.positionAt(...)` and `window.hasNext()` advance the cursor without a COUNT. This is the framework-blessed way to do keyset pagination.
- **Expert — `Sort` and injection:** `Sort.by(userSuppliedString)` is validated against entity properties for derived/JPQL queries (safe), but `JpaSort.unsafe("...")` and native-query sorting concatenate the string into SQL — an injection vector if fed from user input.

---

## save() vs saveAndFlush()

```java
repo.save(user);          // persist/merge into persistence context; SQL flushed later
repo.saveAndFlush(user);  // save + immediate flush() → SQL sent to DB now
```

- **`save`:** for a **new/transient** entity (id null) it calls `entityManager.persist`; for a **detached** entity (id set) it calls `merge`, returning a *new managed copy*. SQL is not necessarily executed immediately — it happens at flush (usually transaction commit).
- **`saveAndFlush`:** forces a `flush()` so INSERT/UPDATE hits the DB immediately (e.g. you need a DB-generated value, or want to trigger constraint violations early, or read your write via a native query in the same tx).
- **Trap — `merge` return value:** `save` on a detached entity returns the managed instance; the *argument you passed in stays detached*. Always use the returned reference (`user = repo.save(user)`).
- **Trap — `save` doesn't always INSERT:** for an existing managed entity, dirty checking may already handle the update; calling `save` can be redundant. And `save` on a non-null-id entity that isn't in the DB will attempt an UPDATE (0 rows) after a SELECT via `merge`, not an INSERT.
- **Expert — `isNew()` and assigned IDs:** `SimpleJpaRepository.save` calls `entityInformation.isNew(entity)`. For a generated `@Id` it checks null (or 0 for primitives). But with an **assigned identifier** (e.g. a natural key or a UUID you set yourself), the id is never null, so `save` always calls `merge` → an extra SELECT before every INSERT. Fixes: implement `Persistable<ID>` with your own `isNew()` (often backed by a `@Transient` flag set in a `@PrePersist`/lifecycle), or use `@Version` (a null version marks the entity new), or extend `AbstractPersistable`.
- **Expert — `merge` cascade and detached children:** `merge` cascades only along associations with `CascadeType.MERGE`/`ALL`. A detached graph with a child that has an assigned id but no matching row causes merge to attempt a re-attach/UPDATE that fails or inserts unexpectedly. Merge also copies state field-by-field into the managed instance, so `@Transient`/non-mapped fields on the argument are lost in the returned copy.
- **Expert — `saveAll` batching:** `saveAll` just loops `save`; it does **not** enable JDBC batching by itself. Real batch inserts require `spring.jpa.properties.hibernate.jdbc.batch_size`, an identity strategy that isn't `IDENTITY` (which disables insert batching because the id is needed immediately), and often `order_inserts`/`order_updates=true`.

---

## Entity lifecycle states

An entity moves through four states relative to the persistence context.

| State | Meaning | In persistence context? | In DB? |
|---|---|---|---|
| **Transient (new)** | Just `new`-ed, no id association | No | No |
| **Managed (persistent)** | Attached; tracked, dirty-checked | Yes | Yes (or will be at flush) |
| **Detached** | Was managed, but context closed / `detach`/`clear`/`evict` called | No | Yes |
| **Removed** | Marked for deletion (`remove`) | Yes (until flush) | Deleted at flush |

```
   new  ──persist──▶  MANAGED  ──remove──▶  REMOVED ──flush──▶ (gone)
                        ▲   │
                 merge  │   │ detach/clear/close/evict
                        │   ▼
                     DETACHED
```

- `persist` makes transient → managed. `merge` makes detached → managed (copy). `detach`/`clear`/`evict`/tx-close makes managed → detached. `remove` makes managed → removed.
- **Trap:** Modifying a **detached** entity has no effect until you `merge` it back. `LazyInitializationException` occurs when you touch a lazy association on a **detached** entity (context/session already closed).
- **Expert — `persist` vs `merge` on a transient entity:** Both attach it, but `persist` on an entity with an already-assigned (non-generated) id, or on a `remove`d-then-reused instance, can throw `EntityExistsException`. `persist` is void and makes the *argument* managed; `merge` returns a copy and leaves the argument as-is — mixing them up causes "I persisted it but the id is still null" confusion (the id is populated on the argument by `persist` only at flush for `IDENTITY`, immediately for `SEQUENCE` pre-allocated blocks).
- **Expert — removed → managed:** Calling `persist` on a `remove`d entity *before flush* cancels the removal (back to managed). After flush the row is gone and re-persisting inserts a new row.
- **Expert — re-attaching:** JPA has no `reattach`; you must `merge`. Hibernate's native `Session.update()`/`saveOrUpdate()` re-attach the *same* instance (no copy) but throw `NonUniqueObjectException` if another managed instance with the same id already exists in the context.

---

## Persistence context

The persistence context is the `EntityManager`'s set of managed entities — a
first-level cache and unit of work.

- Guarantees **identity**: within one context, one row = one object instance (`==` holds for the same id).
- Enables **dirty checking**, **write-behind** (batching SQL), and **lazy loading**.
- **Scope:** In Spring, the default is a **transaction-scoped** persistence context — created at transaction start, flushed & closed at commit. Bound to the thread via `TransactionSynchronizationManager`.
- **OSIV (Open Session In View):** Spring Boot enables `spring.jpa.open-in-view=true` by default, keeping the context open for the whole HTTP request so lazy loads work in the view/controller layer. **Trap:** this hides N+1 and holds DB connections longer; many teams disable it (`open-in-view=false`) and then must fetch what they need inside the service/tx.
- **Expert — OSIV holds the *persistence context* but not always the connection:** `OpenSessionInViewInterceptor`/`OpenEntityManagerInViewInterceptor` binds an `EntityManager` to the request thread. With Hibernate's default `AFTER_TRANSACTION` connection release mode, a JDBC connection is acquired lazily per query and released after each transaction — so OSIV's real cost is holding a *session* (and the pooled connection during lazy loads outside a tx) for the whole request, plus every lazy load in the view running in **auto-commit** mode outside any transaction (each is its own round-trip). Startup logs a warning that OSIV is enabled by default precisely because of this.
- **Expert — thread affinity:** The context is bound via `TransactionSynchronizationManager` to a `ThreadLocal`. Hand a managed entity to another thread (`@Async`, reactive, a thread pool) and you get either `LazyInitializationException` or non-thread-safe access to the same `Session` — the `EntityManager`/`Session` is **not** thread-safe.
- **Expert — `@Transactional(readOnly=true)`:** Sets Hibernate `FlushMode.MANUAL`, so dirty checking still tracks changes but no automatic flush/UPDATE occurs, and it hints the JDBC driver/replica routing. It does **not** make entities immutable — an accidental flush (e.g. calling `flush()` or a query that forces one under a non-MANUAL nested tx) could still write.

---

## EntityManager vs Session

- **`EntityManager`** (JPA, `jakarta.persistence`) is the standard, portable API: `persist`, `merge`, `remove`, `find`, `getReference`, `createQuery`, `flush`, `clear`.
- **`Session`** (Hibernate, `org.hibernate`) is Hibernate's native superset with extras: `saveOrUpdate`, `update`, `get`, `load`, `evict`, filters, and stateless sessions.
- `EntityManager` in Spring Boot is a thin wrapper delegating to a Hibernate `Session`. Get the native API via `em.unwrap(Session.class)`.
- **Analogy:** `EntityManagerFactory` ↔ `SessionFactory` (thread-safe, application-scoped); `EntityManager` ↔ `Session` (not thread-safe, short-lived).
- **Trap:** `em.getReference(id)` / Hibernate `load` returns a **lazy proxy** without hitting the DB; `find`/`get` execute a SELECT and return null if absent (whereas the proxy throws `EntityNotFoundException` on first access).

---

## Dirty checking

- When a **managed** entity's fields change, you do **not** call `save`/`update`. At flush time Hibernate compares each managed entity against its **loaded snapshot** and auto-generates UPDATE for changed rows.
- **Requirements:** the entity must be managed (inside an open persistence context / transaction) and actually modified.
- **Advanced:** Hibernate keeps the snapshot in `EntityEntry`; default dirty check is field-by-field comparison (O(managed entities × fields)). `@DynamicUpdate` makes the UPDATE include only changed columns instead of all columns.
- **Trap:** Changing a detached entity does nothing; you must merge. Changing a managed entity and *not* saving still persists at commit — surprising to beginners.
- **Expert — snapshot cost and bytecode enhancement:** The default "deep compare against a loaded snapshot" scales with (#managed entities × #attributes) at every flush; loading thousands of entities you only read makes flush slow. Mitigations: `@Transactional(readOnly=true)` (MANUAL flush, no dirty scan), `entityManager.clear()`/`detach`, `StatelessSession`, or **bytecode enhancement** with `enableDirtyTracking`, which makes entities self-report changed fields (`SelfDirtinessTracker`) instead of a full snapshot compare.
- **Expert — mutable-value pitfalls:** Dirty checking compares by the field's current value vs snapshot. A `@Convert`ed column or a mutable value type (`Date`, a JSON blob mapped to a `Map`) mutated *in place* may not be detected unless the type is a proper `MutableType`/custom `UserType`; conversely, reassigning an equal-but-not-`==` value can trigger a spurious UPDATE. `updatable=false` columns are excluded from dirty checking entirely.
- **Expert — `@DynamicUpdate` trade-off:** It avoids overwriting untouched columns (helps with concurrent partial updates and DB triggers) but forces Hibernate to build/parse a new SQL string per flavor of change instead of reusing a cached prepared statement — a throughput cost on hot paths.

---

## Flush modes

Flush = synchronizing the persistence context to the DB (executing pending SQL);
it does **not** commit.

- **`FlushModeType.AUTO`** (default): flush before every query that might be affected by pending changes, and before commit.
- **`FlushModeType.COMMIT`**: flush only at commit — faster but a query may read stale data ignoring in-memory changes.
- Triggers of an AUTO flush: transaction commit, executing a JPQL/HQL/native query (that touches affected tables), or explicit `em.flush()`.
- **Trap:** Native SQL queries under `AUTO` may not always trigger a flush for the right tables (Hibernate can't always tell which tables a native query touches), risking stale reads — flush manually if needed. Flushing is **not** committing; a flush can still be rolled back.
- **Expert — flush *ordering* is by operation type, not call order:** At flush Hibernate executes in a fixed order: inserts, updates, collection removals, collection updates, collection inserts, then deletes. So `persist(child); flush(); remove(parent)` in a single flush can violate FK constraints even though your code "looks" ordered. Insert a manual `flush()` between the conflicting operations, or model the order via the schema.
- **Expert — flush and generated ids:** With `GenerationType.IDENTITY`, `persist` must run the INSERT immediately (it needs the auto-increment id), so it flushes that row eagerly regardless of flush mode — which also disables JDBC insert batching. `SEQUENCE`/`TABLE` can defer the INSERT to flush because ids come from a pre-fetched allocation block.
- **Expert — Spring vs raw JPA default:** JPA's spec default is `AUTO`, but under a Spring `@Transactional(readOnly=true)` transaction Hibernate switches the session to `FlushMode.MANUAL`, so an intervening query will *not* auto-flush pending changes there.

---

## Fetch types: lazy vs eager

```java
@ManyToOne(fetch = FetchType.LAZY)  Department dept;   // default EAGER for *-to-one
@OneToMany(mappedBy="dept", fetch = FetchType.LAZY) List<User> users; // default LAZY for *-to-many
```

| Association | JPA default |
|---|---|
| `@ManyToOne` | **EAGER** |
| `@OneToOne` | **EAGER** |
| `@OneToMany` | **LAZY** |
| `@ManyToMany` | **LAZY** |

- **Best practice:** make **everything LAZY** (including `@ManyToOne`/`@OneToOne` with `fetch = LAZY`) and fetch what you need explicitly per query. Eager fetching causes over-fetching and N+1.
- **Advanced:** Lazy `@OneToMany`/`@ManyToOne` works via proxies/`PersistentBag`. But lazy `@OneToOne` on the **non-owning** (mapped-by) side often can't be proxied and stays eager unless bytecode enhancement is enabled, because Hibernate must know whether the association is null.
- **Trap:** `LazyInitializationException` — touching a lazy association after the session closes. Fix by fetching in the transaction (fetch join/entity graph), not by re-enabling eager or OSIV blindly.
- **Expert — `fetch=LAZY` on `@ManyToOne` is only a *hint* without bytecode enhancement:** For to-many, Hibernate returns a `PersistentBag`/`PersistentSet` proxy trivially. For a lazy to-one, it returns a runtime **proxy subclass** of the target — which means the target class can't be `final`, and `instanceof`/`getClass()` on it returns the proxy type, and `equals`/`hashCode` using fields directly (not getters) misbehave because the proxy's fields are uninitialized. True lazy loading of *basic* columns or precise to-one nullability needs `hibernate-enhance-maven-plugin` bytecode enhancement.
- **Expert — Hibernate 6 removed `@LazyToOne`/`LazyToOneOption.NO_PROXY`:** In older versions `NO_PROXY` (with enhancement) gave a truly lazy to-one without a proxy; Hibernate 6 dropped that annotation and relies on the global enhancement config instead. `@LazyCollection` is likewise deprecated in favor of standard `fetch`.
- **Expert — `@ManyToOne(optional=false)`:** Declaring the association non-optional lets Hibernate know a row always exists, so it can build a proxy for a lazy to-one without a null-check query — one reason `optional=false` can make lazy to-ones actually lazy where the inverse `@OneToOne` cannot.

---

## N+1 problem & fixes

**Definition:** You load N parent entities with one query, then accessing a
lazy association triggers **one additional query per parent** → 1 + N queries.

```java
List<Order> orders = orderRepo.findAll();      // 1 query
for (Order o : orders) o.getItems().size();    // N queries (one per order)
```

Fixes:

1. **`JOIN FETCH` (fetch join)** — single query with a join:
   ```java
   @Query("select distinct o from Order o join fetch o.items")
   List<Order> findAllWithItems();
   ```
2. **`@EntityGraph`** — declarative fetch plan, keeps derived-query benefits:
   ```java
   @EntityGraph(attributePaths = {"items", "customer"})
   List<Order> findAll();
   ```
3. **`@BatchSize` / `hibernate.default_batch_fetch_size`** — turns N queries into `N/batchSize` by loading associations with an `IN (...)` batch (`... where order_id in (?,?,?)`).
4. **Subselect fetching** (`@Fetch(FetchMode.SUBSELECT)`) — one extra query using the original query as a subselect.
5. **DTO projection** — fetch exactly the columns you need in one query.

- **Trap:** `join fetch` of a collection produces duplicate parent rows; use `distinct` (JPQL) — with Hibernate 6 the DISTINCT no longer emits an SQL DISTINCT unnecessarily due to `hibernate.query.passDistinctThrough`. Also, you can't paginate a collection fetch join in SQL (see Pagination). Eager fetch does **not** solve N+1 — it just moves it (still one query per association unless a join is used).
- **Expert — `MultipleBagFetchException`:** Fetch-joining **two** `List`-typed (`Bag`) collections in one query throws `MultipleBagFetchException: cannot simultaneously fetch multiple bags` because the Cartesian product can't be disambiguated. Fixes: change one collection to a `Set` (or `@OrderColumn` to make it an indexed `List`), or split into separate queries / `@BatchSize` so each collection is fetched independently. Two `Set`s fetch-joined together still produce a Cartesian product row explosion even if it doesn't throw.
- **Expert — where each fix issues its extra query:** `@BatchSize`/`default_batch_fetch_size` fires the batched `IN (...)` load lazily *when the first proxy in the batch is touched*, so it only helps if you actually iterate; Hibernate 6 pads batch sizes to a small set of predefined sizes (e.g. 1,2,3,4,5,10,…) to reuse prepared statements. `@Fetch(SUBSELECT)` re-runs the original query as a subselect on first access. `@EntityGraph` with `fetchgraph` vs `loadgraph` semantics differ: `javax/jakarta.persistence.fetchgraph` treats attributes *not* in the graph as LAZY regardless of mapping, while `loadgraph` keeps their mapped fetch type.
- **Expert — the N+1 that Hibernate 6 hides:** With `@BatchSize` or default batch fetching enabled globally, the query count drops but the problem can resurface as huge `IN` lists that blow past DB parameter limits (e.g. Oracle's 1000). Monitor with `hibernate.generate_statistics` / a query counter in tests rather than eyeballing logs.

---

## Cascade types

Cascade propagates `EntityManager` operations from a parent to associated
child entities.

| CascadeType | Propagates |
|---|---|
| `PERSIST` | `persist` |
| `MERGE` | `merge` |
| `REMOVE` | `remove` |
| `REFRESH` | `refresh` |
| `DETACH` | `detach` |
| `ALL` | all of the above |

```java
@OneToMany(mappedBy="order", cascade = CascadeType.ALL, orphanRemoval = true)
List<OrderItem> items;
```

- JPA has **no default cascade** (empty). Hibernate adds native `SAVE_UPDATE`, `REPLICATE`, `LOCK`.
- **Best practice:** cascade from parent to child in a true composition (order → items). Avoid `CascadeType.REMOVE` / `ALL` on `@ManyToMany` — you can delete shared rows unintentionally.
- **Trap:** cascade operates through the persistence context (entity ops), so bulk `@Modifying` deletes do **not** cascade.
- **Expert — cascade ≠ database `ON DELETE CASCADE`:** JPA cascade is application-side: Hibernate issues a `DELETE` per child. `@OnDelete(action = OnDelete.Action.CASCADE)` (Hibernate) or a DDL `ON DELETE CASCADE` pushes it to the DB — faster for large graphs but bypasses the persistence context, `@PreRemove`, and orphan tracking, and can leave stale managed children in the L1 cache.
- **Expert — `CascadeType.REMOVE` vs `deleteById`:** `repo.deleteById(id)` first loads the entity (so cascades work) unless overridden; `deleteAllInBatch()` issues a single bulk `DELETE` that skips cascade. Cascade order at flush follows FK dependencies — a cycle or self-reference can require `@OnDelete` or manual ordering.
- **Expert — `CascadeType.PERSIST` and transient children:** Forgetting `PERSIST` on a parent→child where you `persist(parent)` with a new child throws `TransientPropertyValueException` / `IllegalStateException: object references an unsaved transient instance` at flush. Adding the child to a cascade-persist collection fixes it without persisting the child directly.

---

## orphanRemoval

`orphanRemoval = true` deletes a child row when it is **removed from the parent
collection** (or the parent-child link is set null).

```java
order.getItems().remove(item);   // with orphanRemoval=true → DELETE for that item
```

- **`orphanRemoval` vs `CascadeType.REMOVE`:** REMOVE only deletes children when the **parent** is deleted. `orphanRemoval` *also* deletes a child when it is de-associated from the parent while the parent still lives.
- Implies deletion; only valid on `@OneToOne` / `@OneToMany` (ownership).
- **Trap:** Replacing the whole collection (`order.setItems(newList)`) with orphanRemoval can throw `A collection with cascade="all-delete-orphan" was no longer referenced`. Mutate the existing collection instead (`clear()` + `addAll()`).
- **Expert — orphan removal timing and re-add:** Orphan deletion is evaluated at flush by diffing the collection against its snapshot. `remove` then `add` the *same* child in one transaction is a no-op (still referenced), but `clear()` then re-add of an equal-by-id child can trigger a DELETE + INSERT depending on identity — rely on stable `equals`/`hashCode` (business key, not id) for entities in a `Set`.
- **Expert — orphanRemoval needs an owning to-one back-reference to delete via the child:** It works on `@OneToMany`/`@OneToOne` where the child's lifecycle is bound to the parent. It cannot be used on `@ManyToOne`/`@ManyToMany`. Setting the child's `@ManyToOne parent` to null (rather than removing from the collection) also orphans it when `orphanRemoval=true` is on the mapping the child is removed from.

---

## First-level vs second-level cache

| | First-level (L1) | Second-level (L2) |
|---|---|---|
| Scope | Persistence context / `Session` (one transaction) | `SessionFactory` (shared across sessions/tx) |
| On by default? | **Yes, always on**, can't disable | **No**, must configure a provider |
| Stores | Managed entity instances | Entity/collection data + query cache |
| Provider | Built into Hibernate | Ehcache, Infinispan, Caffeine, Hazelcast… |

- **L1** gives identity guarantee and dirty checking; repeated `find(id)` in one tx hits the cache, not the DB.
- **L2** is opt-in (`hibernate.cache.use_second_level_cache=true` + provider + `@Cacheable`/`@Cache` on entities) and shared across transactions/requests. The **query cache** (`use_query_cache`) caches query result *ids*, not entities.
- **Trap:** L2 is easy to get wrong — stale data across a cluster, bulk `@Modifying` bypasses it, and it must be invalidated on external DB writes. Don't confuse Hibernate L2 with Spring's `@Cacheable` abstraction (different layer entirely).
- **Expert — concurrency strategies:** L2 entity regions have a `CacheConcurrencyStrategy`: `READ_ONLY` (immutable reference data, fastest), `NONSTRICT_READ_WRITE` (may briefly serve stale data; invalidates rather than locks), `READ_WRITE` (soft-locks entries during writes using timestamps; no XA needed), and `TRANSACTIONAL` (participates in JTA, needs a transactional cache provider). Choosing `READ_WRITE` on hot rows can itself become a contention point.
- **Expert — what L2 stores is *dehydrated* state, not object graphs:** L2 caches a disassembled array of an entity's column values keyed by id, plus association *ids* — not the connected object instances. On a hit it rehydrates into the current session. So associations still resolve through their own regions (or the DB), and the query cache stores only result ids that must be re-resolved against the entity region — a query-cache hit with a cold entity region causes N SELECTs.
- **Expert — `@NaturalIdCache` / `getReference` interplay:** `find` can be served from L2 without a DB hit; `getReference` returns a proxy and may still hit L2 on initialization. A `@Version` mismatch or a `READ_WRITE` soft lock in flight forces a DB read. Second-level cache does not honor `@Filter`ed or row-level-security views — a correctness trap in multi-tenant apps.

---

## Optimistic vs pessimistic locking

Concurrency control to prevent lost updates.

| | Optimistic | Pessimistic |
|---|---|---|
| Assumes | Conflicts are rare | Conflicts are likely |
| Mechanism | `@Version` column checked at update | DB row locks (`SELECT … FOR UPDATE`) |
| DB lock held? | No | Yes, for the transaction |
| Failure mode | `OptimisticLockException` at commit → retry | Blocking / lock timeout / deadlock |
| Lock modes | `OPTIMISTIC`, `OPTIMISTIC_FORCE_INCREMENT` | `PESSIMISTIC_READ`, `PESSIMISTIC_WRITE`, `PESSIMISTIC_FORCE_INCREMENT` |

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select a from Account a where a.id = :id")
Account findForUpdate(@Param("id") Long id);
```

- **Optimistic** scales well (no locks), needs a retry strategy on conflict.
- **Pessimistic** guarantees exclusivity but risks deadlocks/timeouts and reduces throughput; use short transactions and set `jakarta.persistence.lock.timeout`.
- **Trap:** Optimistic locking only protects updates to entities you actually loaded and versioned; a bulk `@Modifying` update won't bump `@Version` unless you increment it in the query.
- **Expert — `OPTIMISTIC` vs `OPTIMISTIC_FORCE_INCREMENT`:** `LockModeType.OPTIMISTIC` (a.k.a. `READ`) merely *verifies* the version is unchanged at commit even if you only read the entity — protecting against a phantom change to data you based a decision on. `OPTIMISTIC_FORCE_INCREMENT` (`WRITE`) bumps the version even without a dirty change — used to signal "this aggregate changed" when you modify a child but want the parent's version to advance (aggregate-level locking, e.g. adding an `OrderItem` should version the `Order`).
- **Expert — pessimistic lock scope and skip-locked:** `PESSIMISTIC_WRITE` maps to `FOR UPDATE`; `PESSIMISTIC_READ` to `FOR SHARE` (DB permitting). `jakarta.persistence.lock.timeout=0` requests `NOWAIT` (fail immediately), and Hibernate exposes `FOR UPDATE SKIP LOCKED` via `PessimisticLockScope`/query hints for job-queue patterns. `PESSIMISTIC_FORCE_INCREMENT` takes the row lock *and* bumps `@Version`.
- **Expert — lock upgrade and re-read:** Acquiring a pessimistic lock on an entity already in the persistence context does **not** re-read it from the DB by default, so you may lock a stale snapshot; pass `PessimisticLockScope.EXTENDED` or `em.refresh(entity, LockModeType.PESSIMISTIC_WRITE)` to re-read under the lock. `PESSIMISTIC_WRITE` on a `@Version`ed entity also performs an optimistic check when the lock is acquired.

---

## @Version (optimistic locking)

```java
@Version
private Long version;   // or int, short, Timestamp, Instant
```

- Hibernate adds `... WHERE id = ? AND version = ?` to UPDATE/DELETE and `SET version = version + 1`. If **0 rows** update, another transaction changed the row → `OptimisticLockException` / Spring `ObjectOptimisticLockingFailureException`.
- Supported types: `int`/`Integer`, `long`/`Long`, `short`/`Short`, `java.sql.Timestamp`, and (Hibernate) `Instant`/`LocalDateTime`.
- **Trap:** Don't set/modify the version field manually. Also, a **detached** entity carries its version; merging it will detect a conflict if the DB version advanced — this is how you propagate optimistic locking across HTTP requests (send version to client, back on update).
- **Expert — when the version bumps:** The version increments on *any* flush that issues an UPDATE for the entity (or a forced-increment lock), not on read. A change that only touches an association table without a versioned column may not bump it — hence `OPTIMISTIC_FORCE_INCREMENT` for aggregate integrity. `@Version` on a `Timestamp`/`Instant` risks lost updates when two writes land within the timestamp's resolution; numeric versions are safer.
- **Expert — merge and stale version:** `merge` of a detached entity re-reads the current row, copies your state on top, and the flush UPDATE carries `WHERE version = <your detached version>`. If the DB advanced, 0 rows update → `ObjectOptimisticLockingFailureException`. But if you *reset* the version to match the DB (a common bug when re-fetching then copying fields), you defeat the check and silently overwrite the other writer's change — a lost update.
- **Expert — inheritance & embedded:** In `SINGLE_TABLE`/`JOINED` inheritance the `@Version` should sit on the root entity. `@Version` is not allowed on an `@Embeddable`; put it on the owning entity.

---

## Auditing

Spring Data JPA auditing auto-populates created/modified metadata.

```java
@Configuration
@EnableJpaAuditing               // 1. enable
class JpaConfig {
    @Bean AuditorAware<String> auditorProvider() {
        return () -> Optional.of(SecurityContextHolder.getContext()
                        .getAuthentication().getName());  // for @CreatedBy/@ModifiedBy
    }
}

@EntityListeners(AuditingEntityListener.class)   // 2. attach listener
@MappedSuperclass
abstract class Auditable {
    @CreatedDate     Instant createdAt;
    @LastModifiedDate Instant updatedAt;
    @CreatedBy       String createdBy;
    @LastModifiedBy  String updatedBy;
}
```

- `@CreatedDate`/`@LastModifiedDate`/`@CreatedBy`/`@LastModifiedBy` are filled by `AuditingEntityListener` on persist/update.
- `@CreatedBy`/`@LastModifiedBy` require an `AuditorAware` bean.
- **Distinguish** from **Hibernate Envers** (`@Audited`) which stores full **revision history** in `_AUD` tables — a different, heavier mechanism.
- **Trap:** Auditing fires on JPA lifecycle events, so bulk `@Modifying` updates skip it. Also remember `@EnableJpaAuditing` must be present or the annotations do nothing silently.
- **Expert — `AuditorAware` timing and reactive:** The `AuditorAware.getCurrentAuditor()` is invoked at persist/update flush time, on the persisting thread. In `@Async`/scheduled/message-listener flows there is no `SecurityContext` on that thread (unless propagated), so `@CreatedBy` silently gets `null`. For WebFlux use `ReactiveAuditorAware` with `@EnableReactiveMongoAuditing`-style setup — JPA auditing itself is blocking/thread-bound.
- **Expert — `@CreatedDate` on update / `setDates=false`:** Auditing uses `@PrePersist` and `@PreUpdate`. `@CreatedDate` is set only on insert; a `merge` of a detached entity whose created fields are null can overwrite them — guard by never trusting client-supplied audit fields. `DateTimeProvider` bean customizes the clock (inject a fixed `Clock` for tests).
- **Expert — auditing vs DB defaults:** `@CreatedDate` populated in Java can drift from a DB `DEFAULT CURRENT_TIMESTAMP` (different clocks/time zones, and app-side value wins on INSERT). Pick one source of truth. Envers, by contrast, records who/when per revision in a `REVINFO` table and can reconstruct entity state at any revision — use it when you need an audit *trail*, not just last-modified metadata.

---

## Identifier generation strategies

`@GeneratedValue` controls how primary keys are assigned, and the choice has deep performance and batching implications.

| Strategy | How | Batching-friendly? | Notes |
|---|---|---|---|
| `IDENTITY` | DB auto-increment column | **No** — INSERT must run immediately to read the id | Disables JDBC insert batching; simplest for MySQL/`AUTO_INCREMENT` |
| `SEQUENCE` | DB sequence, pre-allocatable | **Yes** | Preferred; supports `allocationSize` pooling |
| `TABLE` | A key table with row locks | Yes, but slow/contended | Legacy portability fallback; avoid |
| `AUTO` | Provider picks | — | Hibernate 6 maps `AUTO` to `SEQUENCE` (via `SequenceStyleGenerator`), even on MySQL where it emulates sequences with a table |
| `UUID` / assigned | App generates | Yes | Random UUIDs hurt index locality; prefer time-ordered (UUIDv7) |

- **Expert — `allocationSize` and the `pooled`/`pooled-lo` optimizer:** With `SEQUENCE`, Hibernate fetches one sequence value and multiplies by `allocationSize` (default 50) to hand out a block of ids without hitting the DB each insert. This is safe across app instances *only* with the `pooled`/`pooled-lo` optimizers, which interpret the DB sequence's increment correctly. A common bug: setting `allocationSize=50` in JPA but leaving the DB sequence `INCREMENT BY 1` under the legacy `hilo` optimizer causes id collisions across instances.
- **Expert — `IDENTITY` breaks batching:** Because the generated key is only known after the INSERT executes, Hibernate cannot defer/batch inserts for `IDENTITY` entities — each `persist` flushes. For high-volume inserts prefer `SEQUENCE` with a pooled optimizer and `hibernate.jdbc.batch_size`.
- **Expert — `@Version` + assigned id + `Persistable`:** See `save()` section — assigned ids make Spring Data treat entities as non-new, forcing a pre-INSERT SELECT via merge.

---

## Embeddables, @ElementCollection & value types

- `@Embeddable`/`@Embedded` map a *value type* (no identity) inline into the owner's table; the embeddable shares the owner's lifecycle and identity. `@AttributeOverride` remaps columns when the same embeddable is used twice.
- **Expert — value-type equality drives collection behavior:** Embeddables and `@ElementCollection` elements have no id; Hibernate identifies rows by *value*. Mutating an element in place plus a poorly-defined `equals`/`hashCode` leads Hibernate to `DELETE all + re-INSERT` the whole collection on change (visible in logs) — a classic `@ElementCollection` performance trap. Give value types proper immutable `equals`/`hashCode`.
- **Expert — `@ElementCollection` is `LAZY` by default and not an entity:** elements can't be queried independently or shared; there's no cascade concept (the owner fully controls them). For anything with identity or sharing, model a child `@Entity` with `@OneToMany` instead.
- **Expert — nullability:** An `@Embedded` with all-null columns may be materialized as either a null embeddable or an all-null instance depending on mapping; be explicit to avoid NPEs.

---

## Enum, temporal & converter mappings

- **`@Enumerated`:** defaults to `EnumType.ORDINAL` — storing the enum's *position*. **Trap:** reordering or inserting an enum constant silently corrupts existing rows. Always use `EnumType.STRING` (or an explicit `@Convert`) in real systems.
- **`AttributeConverter<X,Y>` (`@Convert`):** the portable way to map custom types (e.g. `Money`, encrypted strings, JSON). `autoApply=true` applies it to all attributes of the type. Converters run on read and write; a converted column participates in dirty checking by *value*, and cannot be `@Id` in some providers.
- **Temporal:** With Java 8 types (`LocalDate`, `Instant`, `OffsetDateTime`) Hibernate 6 maps them natively — `@Temporal` is only for legacy `java.util.Date`/`Calendar`. Time-zone handling is governed by `hibernate.timezone.default_storage` (Hibernate 6 defaults changed to `DEFAULT`/normalize-to-UTC behavior via `NORMALIZE_UTC`); store instants in UTC to avoid drift.

---

## Transaction management & propagation with JPA

- **`@Transactional` is proxy-based (Spring AOP):** a call from *within* the same bean to another `@Transactional` method (self-invocation) does **not** go through the proxy, so the annotation is ignored. Move the method to another bean or use `AopContext`/self-injection.
- **`Propagation.REQUIRES_NEW`** suspends the current persistence context and starts a new physical transaction/connection — the inner and outer contexts see different snapshots, and an entity managed in the outer tx is detached from the inner. **`REQUIRED`** (default) joins the existing transaction, sharing one persistence context.
- **Expert — rollback rules:** Spring rolls back only on `RuntimeException`/`Error` by default; **checked exceptions do not roll back** unless you set `rollbackFor`. A caught-and-swallowed exception inside a tx that was already marked rollback-only throws `UnexpectedRollbackException` at commit ("Transaction silently rolled back because it has been marked as rollback-only").
- **Expert — flush/commit failures surface late:** Because SQL is deferred to flush (commit), a constraint violation or optimistic-lock failure appears at *commit time*, often outside your try/catch around the repository call. `saveAndFlush` or an explicit `flush()` surfaces it where you can handle it.
- **Expert — connection & context binding:** The persistence context is bound to the transaction, which is bound to the thread. `REQUIRES_NEW` uses a second pooled connection while the first is held — a source of connection-pool deadlock if the pool is too small (each request needing 2 connections but the pool serves 1).

---

## StatelessSession & bulk processing

- **`StatelessSession`** (Hibernate) is a lightweight session with **no persistence context, no L1 cache, no dirty checking, no cascade, no L2 interaction, and no lifecycle events**. Operations (`insert`, `update`, `delete`) map directly to SQL and require explicit control — ideal for ETL/bulk jobs where the dirty-check overhead and memory growth of a normal session are prohibitive.
- **Expert — why batch jobs OOM with a normal session:** A regular `Session` keeps every loaded/persisted entity managed, so a million-row loop grows the L1 cache unbounded and each flush re-scans all of them (O(n²) behavior). The standard mitigations are `session.flush(); session.clear();` every *batch_size* rows, `hibernate.jdbc.batch_size`, and read-only/scroll access — or switch to `StatelessSession`.
- **Expert — trade-offs:** `StatelessSession` gives up cascade, automatic version increment (you manage `@Version` manually), and lazy loading (associations must be fetched explicitly), so it's not a drop-in replacement — use it for well-bounded bulk work, not general application logic.

---

## Common follow-up questions

1. **Why does `findById` return `Optional` but `getReferenceById` returns the entity?** `findById` executes a SELECT (eager, may be empty → `Optional.empty()`); `getReferenceById` returns a lazy proxy without a DB hit and throws `EntityNotFoundException` on first access if absent.
2. **How is a repository interface turned into a working bean with no impl?** `@EnableJpaRepositories` scans interfaces; `JpaRepositoryFactoryBean` builds a JDK proxy delegating to `SimpleJpaRepository` plus query-lookup strategies (derived name parsing / `@Query`).
3. **Why did my `@Transactional` + lazy load throw `LazyInitializationException` in the controller?** With `open-in-view=false` the context closes at the service boundary; fetch the association inside the transaction.
4. **`save()` returned a different object than I passed in — why?** For detached entities `save` uses `merge`, returning a managed copy; the input stays detached.
5. **My bulk update didn't reflect in already-loaded entities.** `@Modifying` bypasses L1; use `clearAutomatically = true`.
6. **How do I fix N+1 without eager fetching everything?** `@EntityGraph` / `JOIN FETCH` for the specific query, or `@BatchSize`/`default_batch_fetch_size`.
7. **Page vs Slice cost?** `Page` runs an extra COUNT query each call; `Slice` doesn't.
8. **javax vs jakarta?** Spring Boot 3 / Hibernate 6 use `jakarta.persistence.*`; Boot 2 uses `javax.persistence.*`.

## References

- Spring Data JPA Reference Documentation — https://docs.spring.io/spring-data/jpa/reference/
- Jakarta Persistence Specification (JPA) — https://jakarta.ee/specifications/persistence/
- Hibernate ORM 6 User Guide — https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html
- Spring Boot Reference — Data (JPA) — https://docs.spring.io/spring-boot/reference/data/sql.html
- Baeldung: Spring Data JPA guide — https://www.baeldung.com/the-persistence-layer-with-spring-data-jpa
- Baeldung: JPA/Hibernate lifecycle — https://www.baeldung.com/hibernate-entity-lifecycle
- Vlad Mihalcea: N+1, fetching, and locking articles — https://vladmihalcea.com/
