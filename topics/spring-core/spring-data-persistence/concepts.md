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

---

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
