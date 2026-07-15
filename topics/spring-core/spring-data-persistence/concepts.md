# Spring Data and Persistence Integration

Spring's persistence story has several layers that interviewers love to conflate: the JPA
*specification*, Hibernate as a *provider* of that spec, Spring's *data-access support*
(templates, transaction management, exception translation), and Spring Data JPA as a
*repository-abstraction* library on top of all of them. This note untangles those layers and
then drills into the everyday building blocks: repository interfaces, derived queries, `@Query`,
paging/sorting, `JdbcTemplate`, the `DataAccessException` hierarchy, the N+1 problem, and the
`EntityManager` vs `Session` distinction.

A note on versions: **Spring Framework 6.x (and Spring Data 3.x / Hibernate 6.x)** moved from the
`javax.persistence.*` namespace to **`jakarta.persistence.*`** (Jakarta EE 9+). Spring Framework
5.x / Spring Data 2.x still use `javax.persistence.*`. Import statements are the most visible
symptom of this migration, but the concepts below are unchanged.

---

## Spring Data vs JPA vs Hibernate

These three terms sit at different levels of abstraction, and mixing them up is the most common
beginner mistake.

- **JPA (Jakarta Persistence API, formerly Java Persistence API)** is a *specification* — a set of
  interfaces and annotations (`EntityManager`, `@Entity`, `@Id`, `@OneToMany`, JPQL, the criteria
  API). It defines *what* an ORM should do but ships no runtime that talks to a database.
- **Hibernate** is the most popular *implementation (provider)* of the JPA spec. It predates JPA
  and also exposes its own richer native API (`Session`, `SessionFactory`, HQL, `Criteria`).
  Other JPA providers exist: EclipseLink (the reference implementation), OpenJPA.
- **Spring Data JPA** is a *library* that sits on top of a JPA provider. It removes boilerplate by
  generating repository implementations at runtime from interfaces you declare, so you rarely write
  `EntityManager` code by hand. It is part of the broader **Spring Data** umbrella (Spring Data
  JDBC, MongoDB, Redis, Cassandra, etc.), each with the same repository programming model.

A useful mental model:

| Layer | Role | Example artifacts |
|---|---|---|
| Spring Data JPA | Repository abstraction / boilerplate removal | `JpaRepository`, derived queries, `@Query` |
| JPA | Specification (interfaces + annotations) | `EntityManager`, `@Entity`, JPQL, criteria API |
| Hibernate (or EclipseLink) | Runtime ORM provider | `Session`, `SessionFactory`, dialects, SQL generation |
| JDBC | Low-level DB API | `Connection`, `PreparedStatement`, `ResultSet` |

Key clarifications interviewers probe:

- **Spring Data JPA is not an ORM.** It delegates all persistence work to the JPA provider
  (Hibernate by default in most stacks). It is a code-generation and abstraction layer.
- You can use **JPA/Hibernate without Spring Data** (hand-written DAOs using `EntityManager`), and
  you can use **Spring without JPA at all** (e.g., `JdbcTemplate` or Spring Data JDBC).
- **Spring ORM** (`spring-orm` module) is the part of the *core Spring Framework* that integrates
  JPA/Hibernate: `LocalContainerEntityManagerFactoryBean`, `JpaTransactionManager`,
  `HibernateTransactionManager`, and exception translation. Spring Data JPA builds on Spring ORM.

```
Your repository interface  →  Spring Data JPA proxy  →  JPA EntityManager  →  Hibernate  →  JDBC  →  DB
```

---

## Repository Abstraction Hierarchy

Spring Data defines a layered hierarchy of repository interfaces. You extend one of them; Spring
Data generates a proxy implementation at runtime (no implementation class needed).

- **`Repository<T, ID>`** — the root *marker interface*. It declares no methods. Extending it
  simply tells Spring Data "this is a managed repository" and captures the entity type `T` and id
  type `ID` via generics. Useful when you want to expose only a curated subset of methods.
- **`CrudRepository<T, ID>`** — adds generic CRUD: `save`, `saveAll`, `findById`, `existsById`,
  `findAll`, `findAllById`, `count`, `deleteById`, `delete`, `deleteAll`.
- **`PagingAndSortingRepository<T, ID>`** — adds `findAll(Sort)` and `findAll(Pageable)` for
  paging and sorting. (In Spring Data 3.x this interface no longer extends `CrudRepository`;
  historically in 2.x it did. `JpaRepository` still combines both regardless.)
- **`JpaRepository<T, ID>`** — the JPA-specific interface. Extends `CrudRepository` and
  `PagingAndSortingRepository` (via `ListCrudRepository`/`ListPagingAndSortingRepository` in 3.x)
  and adds JPA conveniences: `flush()`, `saveAndFlush()`, `deleteAllInBatch()`,
  `getReferenceById()` (formerly `getOne`/`getById`), and returns `List` from `findAll` instead of
  `Iterable`.

```java
public interface UserRepository extends JpaRepository<User, Long> {
    // inherits save, findById, findAll, count, deleteById, paging, sorting, flush, ...
}
```

Hierarchy (Spring Data 3.x, simplified):

```
Repository (marker)
  └── CrudRepository ──── ListCrudRepository
  └── PagingAndSortingRepository ──── ListPagingAndSortingRepository
                                    └── JpaRepository (also extends ListCrudRepository, QueryByExampleExecutor)
```

Advanced notes:

- The proxy is created by `RepositoryFactoryBean` (for JPA:
  `JpaRepositoryFactoryBean`). The default backing implementation for JPA is
  `SimpleJpaRepository`, which is annotated `@Repository` and `@Transactional(readOnly = true)`,
  wrapping each generated method in a transaction.
- You add custom behavior via a **custom fragment interface** plus an `...Impl` class; Spring Data
  weaves the fragment into the generated proxy (the "custom implementation" pattern).
- Return types can be `Optional<T>`, `List<T>`, `Stream<T>`, `Page<T>`, `Slice<T>`, or (with
  reactive Spring Data) `Mono`/`Flux`. `findById` returns `Optional<T>` in modern Spring Data.
- `getReferenceById` returns a **lazy proxy** (calls `EntityManager.getReference`) and does not hit
  the DB until a property is accessed — throwing `EntityNotFoundException` lazily if absent —
  whereas `findById` executes a `SELECT` immediately and returns `Optional.empty()` when missing.

**Deeper internals interviewers probe:**

- **`SimpleJpaRepository` transaction semantics.** Its class-level `@Transactional(readOnly = true)`
  is *overridden* by method-level `@Transactional` on mutators (`save`, `delete`, etc.), which run
  read-write. But note the subtlety: if a repository method is already invoked *inside* an existing
  transaction (e.g., a `@Transactional` service method), the repository's own annotation is
  ignored because the default `REQUIRED` propagation joins the caller's transaction — the
  `readOnly` hint only takes effect when the repository method *starts* the transaction. This is why
  putting `@Transactional` on the service layer, not the repository, is the recommended pattern.
- **`readOnly = true`** does not merely document intent: Spring sets the JDBC `Connection` to
  read-only (a hint to the driver/DB) and, crucially, sets the Hibernate `FlushMode` to `MANUAL`,
  so dirty checking and automatic flush are skipped — a real performance win for read paths, and a
  trap if you accidentally mutate a managed entity expecting it to be persisted.
- **Custom fragment ordering.** With multiple fragment interfaces, Spring Data resolves a method to
  the *first* fragment (in declaration order) that implements it; the base `SimpleJpaRepository` is
  consulted last. This ordering matters when two fragments could satisfy the same signature.
- **`@NoRepositoryBean`** marks an intermediate interface (like your own `BaseRepository<T,ID>`) so
  Spring Data does *not* try to instantiate a proxy for it directly — only concrete
  entity-specific repositories get proxies.

---

## Derived Query Methods

Spring Data can **derive a query from the method name**. It parses the name into a subject
(`find`, `read`, `get`, `query`, `count`, `exists`, `delete`) and a predicate, then builds the
JPQL for you at bootstrap time — no query string required.

```java
public interface UserRepository extends JpaRepository<User, Long> {

    List<User> findByLastName(String lastName);

    List<User> findByLastNameAndFirstName(String last, String first);

    List<User> findByAgeGreaterThanEqualOrderByAgeDesc(int age);

    Optional<User> findByEmailIgnoreCase(String email);

    List<User> findTop3ByStatusOrderByCreatedAtDesc(Status status);

    long countByStatus(Status status);

    boolean existsByEmail(String email);

    // property traversal: User has an Address, Address has a city
    List<User> findByAddressCity(String city);
}
```

Supported keywords (a partial list): `And`, `Or`, `Between`, `LessThan`, `LessThanEqual`,
`GreaterThan`, `GreaterThanEqual`, `After`, `Before`, `IsNull`, `IsNotNull`, `Like`, `NotLike`,
`StartingWith`, `EndingWith`, `Containing`, `In`, `NotIn`, `True`, `False`, `IgnoreCase`,
`OrderBy...Asc/Desc`, and result limiting `findFirst`/`findTop`/`findTopN`.

Key points and gotchas:

- Method names are **validated at application startup** (when the repository proxy is created), not
  at first call. A typo in a property name (`findByFrstName`) fails fast with a clear error.
- Property traversal can be ambiguous: `findByAddressCity` might mean `address.city` or a property
  `addressCity`. Spring resolves greedily; use an underscore to disambiguate:
  `findByAddress_City`.
- Derived queries get unwieldy fast. Long predicates (5+ conditions) are a smell — switch to
  `@Query`, the Criteria API, or Query by Example / Specifications.
- Adding a `Pageable` or `Sort` parameter to a derived method enables paging/sorting on it.

**Edge cases and gotchas that trip up seniors:**

- **`OrderBy` vs a `Sort` argument conflict.** If a method has a static `OrderBy...` in its name and
  *also* receives a `Sort`/`Pageable` argument, the dynamic `Sort` is *appended* — it does not
  replace the static ordering. To make ordering fully dynamic, drop the `OrderBy` from the name.
- **`delete...By` derived deletes are not bulk DML.** A method like `deleteByStatus(Status s)` (or
  its `removeBy` synonym) is *not* a single `DELETE ... WHERE` statement by default — Spring Data
  first `SELECT`s the matching entities into the persistence context and then removes them one by
  one, so lifecycle callbacks (`@PreRemove`) and cascades fire. Returning `int`/`long` gives you the
  count; returning `List<T>`/the entities returns what was deleted. Contrast this with a
  `@Modifying @Query("delete ...")` which issues a single bulk `DELETE` and bypasses the context.
- **`In` vs a large collection.** `findByIdIn(Collection)` expands to a SQL `IN (...)` list; very
  large collections can blow past database bind-variable limits (e.g., Oracle's 1000-element `IN`
  cap) — Hibernate may need `IN`-clause padding or chunking.
- **`First`/`Top` with a `Pageable`.** Combining `findFirstBy...` with a `Pageable` argument: the
  limiting keyword caps the *total* rows fetched, and paging is applied within that cap — rarely what
  people intend. Prefer one mechanism.
- **Nullable primitives.** A derived method returning a primitive `long count...` throws if the
  provider returns `null`; a boolean `existsBy...` is safe because it is translated to a
  `SELECT 1 ... LIMIT 1` / count comparison.
- **Property vs keyword collision.** If an entity legitimately has a property named `containing` or
  `orderBy`, the parser's greedy keyword matching can misinterpret it; underscores
  (`findBy_Containing`) or an explicit `@Query` resolve the ambiguity.

---

## The Query Annotation JPQL and Native

When method-name derivation is insufficient, declare the query explicitly with **`@Query`**.

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // JPQL (operates on entities/fields, provider-independent)
    @Query("select u from User u where u.email = ?1")
    Optional<User> findByEmailJpql(String email);

    // Named parameters
    @Query("select u from User u where u.status = :status and u.age >= :age")
    List<User> search(@Param("status") Status status, @Param("age") int age);

    // Native SQL (raw SQL against the actual table)
    @Query(value = "SELECT * FROM users WHERE email = ?1", nativeQuery = true)
    Optional<User> findByEmailNative(String email);

    // Modifying query — required for UPDATE/DELETE
    @Modifying
    @Query("update User u set u.status = :status where u.lastLogin < :cutoff")
    int deactivateStale(@Param("status") Status status, @Param("cutoff") LocalDateTime cutoff);
}
```

JPQL vs native SQL:

| Aspect | JPQL | Native SQL (`nativeQuery = true`) |
|---|---|---|
| Operates on | Entity classes and their fields | Database tables and columns |
| Portability | Portable across databases (provider translates) | Tied to a specific DB dialect |
| Type mapping | Automatic to entities | Maps to entity if columns match, else `Object[]`/DTO/`@SqlResultSetMapping` |
| Use vendor features | No (limited to JPQL grammar) | Yes (window functions, DB-specific functions) |
| Paging | Fully supported | Supported, but `count` query often must be supplied via `countQuery` |

Other essentials:

- **`@Param`** binds named parameters (`:name`); positional parameters use `?1`, `?2`.
- **`@Modifying`** is mandatory for `UPDATE`/`DELETE`/DDL `@Query` methods; without it Spring tries
  to run them as a `SELECT`. Modifying queries return `int`/`void` (rows affected) and require an
  active transaction. Use `clearAutomatically`/`flushAutomatically` to keep the persistence context
  consistent, since bulk updates bypass the first-level cache.
- **Named queries**: `@NamedQuery` on the entity, or a method matching `Entity.methodName`,
  are found automatically — an alternative to inline `@Query`.
- **SpEL & projections**: `@Query` supports SpEL (`?#{...}`, `#{#entityName}`) and results can be
  mapped to interface or DTO **projections** (constructor expressions `select new com...Dto(...)`).
- **Sort with native queries** and dynamic sorting can be fragile — `Sort` is applied for JPQL but
  for native queries you may need `JpaSort.unsafe(...)`.

**Advanced traps worth internalizing:**

- **The stale-persistence-context trap after a bulk `@Modifying` update.** A bulk
  `update User u set u.status = ...` runs directly in the database and does *not* touch the
  first-level cache. Any already-managed `User` in the current persistence context keeps its old
  in-memory state, so a subsequent read within the same transaction can return stale values. Set
  `@Modifying(clearAutomatically = true)` to `clear()` the context afterward, and
  `flushAutomatically = true` to flush pending changes *before* the bulk statement runs. Beware:
  `clearAutomatically` detaches *all* managed entities and silently discards their un-flushed
  changes — a subtle data-loss footgun.
- **JPQL bulk updates skip `@Version` and cascades.** A bulk `update`/`delete` does not increment
  the optimistic-lock `@Version` column (unless you set it explicitly) and does not cascade to
  associations or fire entity lifecycle callbacks. This can silently break optimistic locking for
  other in-flight transactions.
- **`countQuery` and native paging.** For a paginated native `@Query`, Spring cannot derive the
  count query by stripping the `ORDER BY`/`SELECT` list the way it does for JPQL; you must supply an
  explicit `countQuery`. Getting this wrong yields wrong `getTotalElements()` or a runtime error.
- **`?1` used twice.** With positional parameters, referencing `?1` multiple times is legal in JPQL
  but a frequent source of confusion; named parameters (`:x`) are clearer and can be reused freely.
- **SpEL `?#{...}` vs `:#{...}`.** `?#{}` splices a value as a *bind parameter* (safe);
  string-concatenating user input into the query text invites JPQL/SQL injection. Interviewers like
  to see you distinguish bound parameters from string interpolation.
- **Interface projections and `nativeQuery`.** Closed interface projections work with native queries
  only if the selected column *aliases* exactly match the projection's getter-derived names;
  otherwise Spring cannot map them.

---

## Pageable and Sort

Spring Data provides first-class abstractions for pagination and ordering that keep your
repository methods clean.

- **`Sort`** describes ordering: `Sort.by("lastName").ascending().and(Sort.by("age").descending())`.
- **`Pageable`** describes a page request: page number (**0-based**), page size, and an optional
  `Sort`. Construct with `PageRequest.of(page, size)` or `PageRequest.of(page, size, sort)`.
- **`Page<T>`** is the full result: the content plus metadata — `getTotalElements()`,
  `getTotalPages()`, `getNumber()`, `hasNext()`. Returning `Page` triggers an **extra `COUNT`
  query** to compute totals.
- **`Slice<T>`** is a lighter alternative: it knows only whether a next slice exists
  (`hasNext()`) and issues **no count query** — cheaper when you only need "load more" behavior.

```java
public interface UserRepository extends JpaRepository<User, Long> {
    Page<User> findByStatus(Status status, Pageable pageable);
    Slice<User> findByActiveTrue(Pageable pageable);
    List<User> findByLastName(String lastName, Sort sort);
}

// caller
Pageable p = PageRequest.of(0, 20, Sort.by("createdAt").descending());
Page<User> page = repo.findByStatus(Status.ACTIVE, p);
long total = page.getTotalElements();
List<User> rows = page.getContent();
```

Notes and pitfalls:

- **Page index is 0-based** — a very common off-by-one interview trap.
- A method can accept `Pageable` (paging + sorting) *or* `Sort` (sorting only). You can pass
  `Pageable.unpaged()` to disable paging while still using the method.
- Returning `List` from a `Pageable` method works but discards paging metadata (no total count).
- Deep offset paging (`OFFSET 1_000_000`) is slow at the DB level; keyset/seek pagination is the
  advanced remedy — Spring Data supports scroll/keyset via `Scroll`/`ScrollPosition` in recent
  versions.
- In web layers, `PageableHandlerMethodArgumentResolver` (from Spring Data Web support) can bind
  `?page=&size=&sort=` request params directly to a `Pageable` controller argument.

**Subtle behaviors experts should know:**

- **The count query is skipped even for `Page`.** Returning `Page<T>` does *not* always run a count
  query. Spring Data's `PageableExecutionUtils` optimizes it away when it can infer the total from
  the page contents: if the current page is the first page *and* its content size is smaller than
  the requested page size, or if a non-first page comes back short, the total is computed
  arithmetically. So "`Page` = always +1 count query" is an over-simplification.
- **`Sort` by an unmapped/derived property.** Sorting works on persistent entity properties; sorting
  by an alias or a function requires `JpaSort.unsafe("FUNCTION('...')")`, and unsafe sort strings are
  spliced into the query (injection risk if user-controlled).
- **Deep-offset cost is O(offset).** `LIMIT 20 OFFSET 1000000` still forces the DB to scan and
  discard a million rows. Keyset (seek) pagination — `WHERE (created_at, id) < (?, ?) ORDER BY ...
  LIMIT 20` — is O(page size). Spring Data's `Scroll`/`ScrollPosition` (6.x / Spring Data 3.1+)
  models this with `WindowIterator` and keyset positions.
- **`Pageable.unpaged()` still honors `Sort`.** In newer Spring Data you can pass a `Sort` to
  `Pageable.unpaged(sort)`; a returned `Page` from an unpaged request has one page containing all
  results and `getTotalElements()` equal to the content size (no separate count query).
- **Immutability and thread-safety.** `PageRequest`, `Sort`, and `Page` are immutable value objects;
  `next()`/`previous()` return new instances. This makes them safe to share, but reusing a stale
  `Pageable` after data changes can skip or double-count rows (another reason keyset paging is
  preferred for mutating datasets).

---

## JdbcTemplate Basics

`JdbcTemplate` (in `spring-jdbc`, part of the core framework) is Spring's classic helper for raw
JDBC. It handles the tedious, error-prone plumbing — acquiring/releasing `Connection`s,
creating/closing `Statement`s and `ResultSet`s, iterating rows, and translating `SQLException`
into Spring's `DataAccessException` hierarchy — while you supply only the SQL and the row mapping.
It has **no ORM, no caching, no dirty checking**: you write SQL directly.

```java
JdbcTemplate jdbc = new JdbcTemplate(dataSource);

// query for a single scalar
int count = jdbc.queryForObject("SELECT COUNT(*) FROM users", Integer.class);

// query for a list with a RowMapper
List<User> users = jdbc.query(
    "SELECT id, first_name, last_name FROM users WHERE status = ?",
    (rs, rowNum) -> new User(rs.getLong("id"),
                             rs.getString("first_name"),
                             rs.getString("last_name")),
    "ACTIVE");

// insert/update/delete
int rows = jdbc.update(
    "INSERT INTO users (first_name, last_name) VALUES (?, ?)",
    "Ada", "Lovelace");
```

Key APIs:

- **`query(...)` + `RowMapper<T>`** — map each row to an object.
- **`queryForObject(...)`** — exactly one row/one value; throws
  `EmptyResultDataAccessException` if none and `IncorrectResultSizeDataAccessException` if many.
- **`update(...)`** — INSERT/UPDATE/DELETE, returns affected row count.
- **`batchUpdate(...)`** — efficient batched writes.
- **`RowCallbackHandler`** (process rows, no return) and **`ResultSetExtractor`** (map the whole
  `ResultSet`, e.g. for one-to-many joins) are alternatives to `RowMapper`.
- **`NamedParameterJdbcTemplate`** supports `:name` placeholders instead of positional `?`, backed
  by a `MapSqlParameterSource` or `BeanPropertySqlParameterSource`.

`JdbcTemplate` is **thread-safe once configured** and is normally declared as a singleton bean.
Use it when you want full SQL control, minimal overhead, or to avoid ORM complexity; use JPA/Spring
Data JPA when you want object mapping, relationships, and change tracking.

**Internals and pitfalls seniors are expected to know:**

- **Why it is thread-safe.** `JdbcTemplate` holds only the `DataSource` (and immutable config like
  fetch size) as mutable-after-construction-then-frozen state; per-call working state lives in local
  variables. It obtains the `Connection` through `DataSourceUtils.getConnection(dataSource)`, which
  returns the transaction-bound connection when a Spring-managed transaction is active — so
  `JdbcTemplate` participates correctly in `@Transactional` boundaries and does *not* silently open a
  second connection.
- **`queryForObject` for a single row that maps to an entity** uses a `RowMapper` (or
  `BeanPropertyRowMapper`); `queryForObject(sql, Integer.class)` uses a `SingleColumnRowMapper` and
  throws `IncorrectResultSizeDataAccessException` if the row has more than one column.
- **`queryForObject` returning `null`.** If the single row's single column is SQL `NULL`, the method
  returns `null` (not an exception) — a classic NPE trap when autoboxing to a primitive.
- **Batch ordering and JDBC batching.** `batchUpdate` sends statements as a JDBC batch, but whether
  the driver actually batches over the wire depends on the driver and URL flags (e.g. PostgreSQL
  needs `reWriteBatchedInserts=true` to collapse inserts). Generated keys are generally *not*
  reliably returned from batch inserts.
- **`ResultSetExtractor` vs `RowMapper` for joins.** A one-to-many join returns duplicated parent
  rows; a `RowMapper` (one object per row) cannot deduplicate, so use a `ResultSetExtractor` that
  reads the whole `ResultSet` and assembles a `Map<parentId, Parent>` — this is how you avoid an
  N+1 without an ORM.
- **`SqlExceptionTranslator` resolution order.** By default `JdbcTemplate` uses
  `SQLErrorCodeSQLExceptionTranslator`, which matches vendor error codes from `sql-error-codes.xml`
  (keyed by the database product name it reads from `DatabaseMetaData`). If it can't identify the DB,
  it falls back to `SQLStateSQLExceptionTranslator`. Spring 6.x also offers
  `SQLExceptionSubclassTranslator` leveraging JDBC 4's `SQLException` subclasses.
- **Fetch size and streaming.** For huge result sets, set `setFetchSize(...)` and use a
  `RowCallbackHandler` (which returns nothing and processes rows as they stream) to avoid loading
  everything into memory.

---

## DataAccessException Hierarchy and Exception Translation

A cornerstone of Spring's data support is **consistent, technology-agnostic exception handling**.
Instead of leaking JDBC's checked `SQLException` or JPA's `PersistenceException`, Spring translates
them into a rich hierarchy rooted at **`org.springframework.dao.DataAccessException`**.

Crucial properties:

- **`DataAccessException` is unchecked** (extends `RuntimeException`). You are not forced to
  `try/catch` or declare `throws`, which keeps DAO signatures clean and lets transactions roll back
  by default on runtime exceptions.
- The hierarchy is **independent of the persistence technology**. The same
  `DataIntegrityViolationException` can arise from JDBC, JPA/Hibernate, or another store, so upper
  layers can catch a meaningful, portable exception instead of vendor-specific ones.

Common subtypes:

| Exception | Meaning |
|---|---|
| `DataIntegrityViolationException` | Constraint violation (e.g., unique/NOT NULL/FK) |
| `DuplicateKeyException` | Unique/primary-key violation (subclass of the above) |
| `EmptyResultDataAccessException` | Expected exactly one row, got none |
| `IncorrectResultSizeDataAccessException` | Wrong number of rows returned |
| `OptimisticLockingFailureException` | `@Version` optimistic-lock conflict |
| `PessimisticLockingFailureException` | Pessimistic-lock acquisition failed |
| `CannotAcquireLockException` | Could not obtain a lock (deadlock/timeout) |
| `DeadlockLoserDataAccessException` | Chosen as the deadlock victim |
| `QueryTimeoutException` | Query exceeded its timeout |
| `DataAccessResourceFailureException` | Resource failure (e.g., cannot connect) |
| `BadSqlGrammarException` | Malformed SQL (JDBC) |
| `TransientDataAccessException` (branch) | Retrying the same operation may succeed |
| `NonTransientDataAccessException` (branch) | Retrying will not help until the cause is fixed |

**How the translation happens (`@Repository`)**:

- Annotating a DAO with **`@Repository`** does two things: (1) marks it as a component for
  classpath scanning, and (2) makes it eligible for **automatic persistence exception
  translation**. A `PersistenceExceptionTranslationPostProcessor` bean adds an AOP advisor that
  intercepts beans annotated `@Repository` and translates native exceptions
  (`SQLException`, `PersistenceException`, Hibernate exceptions) into `DataAccessException`.
- `JdbcTemplate` performs translation **internally** via a `SQLExceptionTranslator`
  (`SQLErrorCodeSQLExceptionTranslator`, driven by `sql-error-codes.xml`, falling back to SQLState),
  so you get the hierarchy even without `@Repository`.
- The actual translator is `PersistenceExceptionTranslator`; JPA/Hibernate provide
  implementations that map their native exceptions.

```java
@Repository
public class JpaUserDao {
    @PersistenceContext EntityManager em;   // native PersistenceException here
                                            // is translated to DataAccessException
}
```

**When translation does and does not happen — the traps:**

- **Spring Data repositories are always translated.** The generated proxy applies a
  `PersistenceExceptionTranslationInterceptor` regardless of whether you added `@Repository`, so you
  get `DataAccessException`s from repository calls out of the box. The `@Repository` mechanism is for
  *your own* hand-written DAOs.
- **Translation is boundary-sensitive.** Native exceptions are frequently thrown not at the line you
  call the `EntityManager`, but at **flush/commit time** — often *outside* the `@Repository`
  method, when the transaction commits at the service-layer boundary. At that point the AOP advisor
  around the repository is no longer on the stack, so the exception surfaces as a raw
  `PersistenceException`/`ConstraintViolationException` unless a translator is invoked at the commit
  point. Spring's `JpaTransactionManager` does translate on commit for JPA, but this asymmetry is a
  classic "why is my DataIntegrityViolationException actually a PersistenceException?" puzzle.
- **`DuplicateKeyException` is not always thrown for a unique violation.** JPA/Hibernate frequently
  surfaces unique-constraint violations as the more general `DataIntegrityViolationException` because
  the specific error-code mapping that distinguishes duplicate keys lives in the JDBC translator, not
  the JPA dialect. Don't rely on catching `DuplicateKeyException` for ORM writes.
- **Transient vs non-transient branch.** The hierarchy splits into
  `TransientDataAccessException` (retry may succeed — deadlock loser, lock timeout, connection
  blip) and `NonTransientDataAccessException` (retry is futile until you fix the cause — bad SQL,
  constraint violation). This distinction is what `@Retryable`/retry templates key off of.
- **Custom translation.** You can register a `SQLErrorCodeSQLExceptionTranslator` with a
  `CustomSQLErrorCodesTranslation`, or supply your own `PersistenceExceptionTranslator` bean, to map
  vendor-specific codes to a chosen `DataAccessException` subtype.

---

## The N plus 1 Problem

The **N+1 select problem** is the classic ORM performance bug. It occurs when the ORM issues **1
query to load a collection of N parent entities, then N additional queries** — one per parent — to
load an associated (lazy) relationship. Total = **N + 1 queries** instead of 1 or 2.

```java
// 1 query: SELECT * FROM author
List<Author> authors = authorRepo.findAll();
for (Author a : authors) {
    // each call triggers: SELECT * FROM book WHERE author_id = ?   (N queries)
    a.getBooks().size();
}
```

Why it happens: JPA associations like `@OneToMany` default to **`FetchType.LAZY`** (`@ManyToOne`
and `@OneToOne` default to `EAGER`). Lazy collections are loaded on first access, and if you touch
each parent's collection in a loop you fan out into N queries.

Detection and fixes:

- **`JOIN FETCH` in JPQL** — load parents and children in one query:
  `@Query("select distinct a from Author a join fetch a.books")`.
- **`@EntityGraph`** on the repository method — declarative fetch plan without writing the join:
  `@EntityGraph(attributePaths = "books")`.
- **Batch fetching** — `@BatchSize(size = n)` or `hibernate.default_batch_fetch_size` turns N
  queries into `ceil(N/n)` `IN (...)` queries.
- **DTO projections** — select exactly the columns you need in a single query.
- Note: naïvely switching a collection to `EAGER` is *not* a real fix — it makes every load fetch
  the collection (often via a cartesian join) and can cause its own N+1 or over-fetching problems.
- Watch for a **cartesian product** when `JOIN FETCH`-ing multiple collections; use `distinct`,
  fetch one collection per query, or use `@BatchSize`.

The N+1 problem is not unique to Hibernate — it affects any lazy-loading ORM. It's a favorite
interview topic because it shows you understand the cost of the object-relational abstraction.

**Deeper edge cases and the trade-offs between fixes:**

- **`JOIN FETCH` + `Pageable` = in-memory pagination.** When you `join fetch` a collection *and*
  request a `Pageable`, Hibernate cannot apply `LIMIT`/`OFFSET` in SQL (the join multiplies rows, so
  a SQL limit would truncate a parent's children). It logs the infamous
  `HHH000104: firstResult/maxResults specified with collection fetch; applying in memory` warning and
  fetches the *entire* result set, then paginates in memory — a silent OOM/perf disaster on large
  tables. The correct fix is a **two-query strategy**: page the parent IDs first (no fetch), then
  fetch children for that page via an `IN` query or `@EntityGraph`/`@BatchSize`.
- **`distinct` in JPQL vs `Hibernate.FILTER`.** `select distinct a from Author a join fetch a.books`
  deduplicates parents in memory. In Hibernate 5.2.2+ the SQL-level `DISTINCT` can be suppressed with
  the `hibernate.query.passDistinctThrough=false` hint (or `.setHint(HINT_PASS_DISTINCT_THROUGH,
  false)`), so you get in-memory dedup without an unnecessary and costly SQL `DISTINCT`.
- **`@BatchSize` semantics.** `@BatchSize(size = 10)` turns N lazy loads into `ceil(N/10)` queries
  using `WHERE parent_id IN (?, ?, ...)`. It is the *only* fix that also helps when the association
  is accessed later, outside the original query. `hibernate.default_batch_fetch_size` applies it
  globally.
- **Two `EAGER` collections trigger `MultipleBagFetchException`.** Fetching two `List`-typed
  (`bag`) collections in one query throws
  `MultipleBagFetchException: cannot simultaneously fetch multiple bags`, because the cartesian
  product cannot be unambiguously mapped back into two lists. Fixes: change one to a `Set`, use
  `@OrderColumn` (making it an indexed `List`), or fetch collections in separate queries/`@BatchSize`.
- **N+1 can hide behind `@ManyToOne(EAGER)` too.** Eager to-one associations without an explicit
  `JOIN FETCH` in a JPQL query often produce a secondary SELECT per row — an N+1 in the other
  direction. Always be explicit about fetch plans in queries rather than trusting mapping defaults.
- **Open Session in View masks N+1.** OSIV keeps the persistence context open during view rendering,
  so lazy access "just works" — but it converts what should be one query into many, executed during
  rendering, off any transaction. It hides N+1 rather than fixing it, which is why it's discouraged
  in Spring services (and disabled explicitly in many configurations).

---

## EntityManager vs Session

At the JPA layer you interact with an **`EntityManager`**; the Hibernate-native equivalent is a
**`Session`**. Both represent a **persistence context** — a first-level cache of managed entities
within a unit of work — and both track changes for automatic dirty-checking flush.

| JPA (standard) | Hibernate (native) |
|---|---|
| `EntityManager` | `Session` |
| `EntityManagerFactory` | `SessionFactory` |
| `EntityTransaction` | `Transaction` |
| JPQL | HQL |
| `persist`, `merge`, `remove`, `find`, `getReference` | `persist`/`save`, `merge`/`update`, `delete`, `get`, `load` |
| `@PersistenceContext` injection | injected/obtained via factory |

Key facts:

- In Hibernate, **`Session extends jakarta.persistence.EntityManager`** (in HB 6.x /
  `javax.persistence.EntityManager` in HB 5.x). You can unwrap the provider-specific API:
  `Session session = em.unwrap(Session.class);` — handy for Hibernate-only features
  (`@BatchSize` tuning, `StatelessSession`, filters, multi-tenancy hooks).
- **Entity states** (both APIs): *transient/new* (not associated), *managed/persistent* (tracked by
  the context, changes auto-flushed), *detached* (was managed, context closed), *removed*
  (scheduled for delete).
- `EntityManager`/`Session` are **not thread-safe** — they're short-lived, one per transaction/
  request. `EntityManagerFactory`/`SessionFactory` are **thread-safe, expensive, singleton**.
- Spring injects a **shared, transaction-scoped `EntityManager` proxy** via `@PersistenceContext`;
  it routes each call to the correct thread-bound `EntityManager` for the active transaction.
- Semantic differences worth knowing: Hibernate's legacy `save` returns the generated id and is
  Hibernate-specific; JPA's `persist` returns `void`. Hibernate's `get` hits the DB immediately
  while `load` returns a lazy proxy (analogous to JPA `find` vs `getReference`).

**Subtle semantics staff engineers must nail:**

- **`persist` vs `merge`.** `persist(e)` makes a *transient* entity managed and throws
  `EntityExistsException` if it already exists; the argument instance itself becomes managed.
  `merge(e)` copies the state of a *detached* entity onto a managed instance and **returns that
  managed instance** — the argument you passed in stays detached. Continuing to mutate the original
  reference after `merge` is a classic bug: your changes are lost because they're on the detached
  copy, not the managed one. `merge` also issues a `SELECT` to load the current row (unless it's a
  known new entity), then an `UPDATE` on flush.
- **`save` in Spring Data is `merge`-or-`persist`.** `SimpleJpaRepository.save` calls `persist` when
  the entity is new (per `EntityInformation.isNew`, based on the `@Id`/`@Version` being null, or
  `Persistable.isNew`) and `merge` otherwise. For an entity with an assigned (non-generated) id,
  `isNew` returns false, so `save` does a `merge` → an extra `SELECT` before every insert. Implement
  `Persistable` or use `@Version`/a `@CreatedDate` audit field to fix this.
- **Flush ordering (`ActionQueue`).** Hibernate does *not* execute SQL in the order you call methods.
  On flush it orders operations by type: inserts, then updates, then collection removals/updates,
  then deletes — respecting insertion order within each type. This is why a `persist` followed by a
  `remove` in your code can still deadlock or violate a constraint in an order you didn't expect, and
  why `saveAndFlush`/manual `flush` is sometimes needed to force ordering.
- **`flush()` does not commit.** Flushing pushes pending SQL to the DB (so subsequent queries see the
  changes and constraints fire) but the transaction is still open and can roll back. `AUTO` flush
  mode also flushes before a query whose results could be affected by pending changes.
- **First-level cache is per-persistence-context.** Two `find`s for the same id in one transaction
  return the *same* object instance (identity guarantee) and the second is served from the L1 cache
  with no SQL. Across transactions there is no such guarantee unless the (optional) L2 cache is
  enabled.
- **`StatelessSession`** bypasses the persistence context, L1 cache, dirty checking, and cascades —
  ideal for bulk ETL, but you lose automatic dirty tracking and must manage everything manually.

---

## Optimistic and Pessimistic Locking

Concurrency control is where persistence integration meets real production scars.

- **Optimistic locking** uses a `@Version` field (an `int`/`long`/`short`/`Timestamp`). On update,
  Hibernate appends `WHERE id = ? AND version = ?` and increments the version. If zero rows match
  (someone else updated first), it throws `OptimisticLockException`, which Spring translates to
  `OptimisticLockingFailureException`. No database locks are held — it's a bet that conflicts are
  rare, resolved at flush/commit. The version check fires **only when the entity is dirty and
  flushed**; a bulk `@Modifying` update or a native SQL update does *not* bump `@Version`, which can
  silently corrupt the optimistic-locking contract for concurrent readers.
- **`@Version` gotchas:** the field must not be manually modified; a `merge` of a detached entity
  compares the detached version against the DB and can throw on merge; and `LockModeType.OPTIMISTIC`
  vs `OPTIMISTIC_FORCE_INCREMENT` differ in whether the version is bumped even without a change
  (useful for enforcing an aggregate-level lock when only a child changed).
- **Pessimistic locking** takes actual DB locks via `LockModeType.PESSIMISTIC_READ` (shared) or
  `PESSIMISTIC_WRITE` (exclusive, `SELECT ... FOR UPDATE`). In Spring Data, annotate the repository
  method `@Lock(LockModeType.PESSIMISTIC_WRITE)`. Lock acquisition failures surface as
  `PessimisticLockingFailureException`/`CannotAcquireLockException`; timeouts can be tuned with
  `jakarta.persistence.lock.timeout`. Pessimistic locks require an active transaction and are
  released at commit.
- **Choosing:** optimistic scales better under low contention and avoids deadlocks; pessimistic is
  right for hot rows where retrying an optimistic failure repeatedly would be worse. A common
  senior answer: default to optimistic with a retry loop, escalate to pessimistic only for genuinely
  contended resources (inventory counters, sequence tables).

## Transaction Semantics in the Data Layer

Persistence behavior is inseparable from transaction boundaries; several data-access surprises are
really transaction surprises.

- **`LazyInitializationException`.** Accessing a lazy association *after* the persistence context
  closes (e.g., in the view/controller after the `@Transactional` service returned) throws
  `LazyInitializationException`. The fix is to fetch what you need inside the transaction
  (`JOIN FETCH`, `@EntityGraph`, DTO projection), *not* to enable Open Session in View.
- **Self-invocation defeats `@Transactional`.** Because Spring's transaction management is
  proxy-based (AOP), calling one `@Transactional` method from another method *in the same bean*
  bypasses the proxy, so a new/nested transaction annotation is ignored. This equally affects
  repository fragments that call sibling methods.
- **`readOnly = true` in the persistence layer** switches Hibernate to `FlushMode.MANUAL` and hints
  the JDBC connection read-only. Dirty changes are silently not flushed — great for read
  performance, dangerous if you expected a write.
- **Rollback rules.** By default Spring rolls back on unchecked (`RuntimeException`) and `Error`, and
  commits on checked exceptions. Because `DataAccessException` is unchecked, data-access failures
  trigger rollback automatically — one reason Spring made the hierarchy unchecked. Override with
  `@Transactional(rollbackFor = ...)`.
- **`REQUIRES_NEW` and connection pool exhaustion.** A `REQUIRES_NEW` method suspends the current
  transaction and grabs a *second* connection from the pool while the first is still held. Nesting
  these under load can deadlock the pool — a subtle production failure mode.

## Persistence Context Lifecycle and Flush Timing

- **When does SQL actually run?** With `FlushMode.AUTO` (the JPA default), Hibernate flushes pending
  changes before a query that might be affected by them, and always before commit — but *not*
  necessarily at the moment you call `persist`/`setter`. Insert SQL for a `GenerationType.IDENTITY`
  id is an exception: it must run immediately on `persist` to obtain the key, whereas `SEQUENCE`/
  `TABLE` generators can defer the insert and batch it.
- **Write-behind (transactional write-behind).** The persistence context queues DML and flushes it
  as late as possible, enabling batching and letting dirty checking coalesce multiple setter calls
  into one `UPDATE`. This is why the order of your Java calls need not match the emitted SQL order
  (see `ActionQueue` ordering under EntityManager vs Session).
- **Dirty checking cost.** On flush Hibernate snapshots and compares every managed entity's state;
  a context bloated with thousands of managed entities makes each flush expensive. For large batch
  jobs, periodically `flush()` then `clear()`, use `StatelessSession`, or set a JDBC batch size.
- **Detachment.** `clear()` detaches everything; `detach(e)` detaches one entity; closing the
  `EntityManager` detaches all. Detached entities lose dirty tracking — further changes are ignored
  until `merge`.

## Common follow-up questions

- **Is Spring Data JPA an ORM?** No — it's a repository abstraction that delegates to a JPA
  provider (usually Hibernate). Hibernate is the ORM.
- **How is a repository interface turned into a working bean?** Spring Data creates a dynamic proxy
  at startup (`JpaRepositoryFactoryBean` → `SimpleJpaRepository`); derived methods are parsed and
  validated then, not at first call.
- **When would you use `JdbcTemplate` instead of Spring Data JPA?** For full SQL control,
  performance-critical reads, reporting queries, or when object mapping/dirty checking is unwanted.
- **Why is `DataAccessException` unchecked?** To avoid forcing boilerplate `catch`/`throws`, to keep
  DAO APIs clean, and to enable default transaction rollback on runtime exceptions.
- **What does `@Repository` actually add on a JPA DAO?** Component scanning eligibility *and*
  automatic native-to-`DataAccessException` translation (via
  `PersistenceExceptionTranslationPostProcessor`).
- **`Page` vs `Slice`?** `Page` runs an extra count query and exposes totals; `Slice` only knows if
  there's a next slice and is cheaper.
- **Difference between `findById` and `getReferenceById`?** `findById` runs a `SELECT` and returns
  `Optional`; `getReferenceById` returns a lazy proxy and defers the DB hit.
- **How do you fix N+1?** `JOIN FETCH`, `@EntityGraph`, batch fetching, or DTO projections.
- **`javax` vs `jakarta`?** Spring Framework 6 / Spring Data 3 use `jakarta.persistence.*`;
  Spring 5 / Spring Data 2 use `javax.persistence.*`.
- **Why must `@Modifying` accompany an update `@Query`?** So Spring executes it as an
  `executeUpdate()` (DML) rather than a `getResultList()` (SELECT).

## References

- Spring Data JPA Reference — https://docs.spring.io/spring-data/jpa/reference/
- Spring Data Commons — Repositories — https://docs.spring.io/spring-data/commons/reference/repositories.html
- Spring Framework — Data Access (DAO support, exception translation) — https://docs.spring.io/spring-framework/reference/data-access.html
- Spring Framework — JDBC (`JdbcTemplate`) — https://docs.spring.io/spring-framework/reference/data-access/jdbc.html
- Spring Framework — ORM (JPA/Hibernate integration) — https://docs.spring.io/spring-framework/reference/data-access/orm.html
- Jakarta Persistence Specification — https://jakarta.ee/specifications/persistence/
- Hibernate ORM User Guide — https://hibernate.org/orm/documentation/
- `DataAccessException` Javadoc — https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/dao/DataAccessException.html
