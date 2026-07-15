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
- **Trap:** Bulk updates also **skip cascade and `@Version` optimistic-lock checks** — they are not entity-lifecycle operations. Don't expect `@PreUpdate` callbacks or version increments to fire.

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

---

## Persistence context

The persistence context is the `EntityManager`'s set of managed entities — a
first-level cache and unit of work.

- Guarantees **identity**: within one context, one row = one object instance (`==` holds for the same id).
- Enables **dirty checking**, **write-behind** (batching SQL), and **lazy loading**.
- **Scope:** In Spring, the default is a **transaction-scoped** persistence context — created at transaction start, flushed & closed at commit. Bound to the thread via `TransactionSynchronizationManager`.
- **OSIV (Open Session In View):** Spring Boot enables `spring.jpa.open-in-view=true` by default, keeping the context open for the whole HTTP request so lazy loads work in the view/controller layer. **Trap:** this hides N+1 and holds DB connections longer; many teams disable it (`open-in-view=false`) and then must fetch what they need inside the service/tx.

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

---

## Flush modes

Flush = synchronizing the persistence context to the DB (executing pending SQL);
it does **not** commit.

- **`FlushModeType.AUTO`** (default): flush before every query that might be affected by pending changes, and before commit.
- **`FlushModeType.COMMIT`**: flush only at commit — faster but a query may read stale data ignoring in-memory changes.
- Triggers of an AUTO flush: transaction commit, executing a JPQL/HQL/native query (that touches affected tables), or explicit `em.flush()`.
- **Trap:** Native SQL queries under `AUTO` may not always trigger a flush for the right tables (Hibernate can't always tell which tables a native query touches), risking stale reads — flush manually if needed. Flushing is **not** committing; a flush can still be rolled back.

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

---

## @Version (optimistic locking)

```java
@Version
private Long version;   // or int, short, Timestamp, Instant
```

- Hibernate adds `... WHERE id = ? AND version = ?` to UPDATE/DELETE and `SET version = version + 1`. If **0 rows** update, another transaction changed the row → `OptimisticLockException` / Spring `ObjectOptimisticLockingFailureException`.
- Supported types: `int`/`Integer`, `long`/`Long`, `short`/`Short`, `java.sql.Timestamp`, and (Hibernate) `Instant`/`LocalDateTime`.
- **Trap:** Don't set/modify the version field manually. Also, a **detached** entity carries its version; merging it will detect a conflict if the DB version advanced — this is how you propagate optimistic locking across HTTP requests (send version to client, back on update).

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
