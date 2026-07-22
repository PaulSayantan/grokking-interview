# ORM Fundamentals & JPA vs Hibernate

Object-Relational Mapping (ORM) is the layer that bridges two worlds that were never
designed to talk to each other: an **object graph** in the JVM heap (classes, references,
inheritance, identity by reference) and a **relational database** (tables, rows, foreign
keys, identity by primary key). This topic is the foundation of the whole Hibernate/JPA
domain — before you can reason about the persistence context, dirty checking, lazy
proxies, N+1, or caching, you need to be crisp about *what* an ORM is, *why* the
mismatch exists, and the difference between **JPA the specification** and **Hibernate
the implementation**.

Interviewers open with this topic to calibrate seniority fast. A junior says "JPA and
Hibernate are the same thing." A senior explains: JPA is a *spec* (a set of interfaces
and annotations in `jakarta.persistence.*`), Hibernate is the most-used *provider* that
implements it plus a large superset of native features, and they can articulate the
impedance mismatch that makes ORM both useful and dangerous.

> [!KEY-TAKEAWAY]
> **JPA = the contract (Jakarta Persistence spec). Hibernate = an implementation of
> that contract (plus native extensions).** You code to `jakarta.persistence.*` for
> portability, and reach for `org.hibernate.*` when you need power the spec doesn't
> expose. Modern stack: **Jakarta Persistence 3.1/3.2**, **Hibernate ORM 6.x/7.x**,
> `jakarta.*` namespace (the `javax.*` era is legacy).

For the underlying database mechanics referenced throughout — SQL itself, B-tree/LSM
storage, ACID isolation levels, indexing, and transactions at the DB level — see
`messaging-databases/*`. This topic stays at the **ORM mechanism altitude**: how
Hibernate/JPA *uses* the database.

---

## What ORM is and the object-relational impedance mismatch

**ORM** is a technique (and the libraries that implement it) for mapping rows in
relational tables to objects in an object-oriented language, and vice versa, so you
manipulate persistent data as ordinary objects instead of hand-writing SQL and
JDBC `ResultSet` plumbing for every operation.

The reason ORM is *hard* — and the reason it leaks — is the **object-relational
impedance mismatch**: the object model and the relational model have fundamentally
different rules. The classic five mismatch dimensions (from Fowler / the original
Hibernate authors, Bauer & King) are:

| Mismatch | Object world | Relational world | ORM must reconcile |
|---|---|---|---|
| **Granularity** | Fine-grained classes (an `Address` value object) | Coarse-grained tables; you rarely want a table per tiny type | Embeddables (`@Embeddable`) flatten a value type into the owner's columns |
| **Inheritance** | `Employee extends Person`, polymorphism | No native inheritance; tables are flat | Inheritance strategies: `SINGLE_TABLE`, `JOINED`, `TABLE_PER_CLASS` (see `inheritance-embeddables-composite-keys`) |
| **Identity** | Two notions: `a == b` (same reference) and `a.equals(b)` (logical) | One notion: primary-key equality | Persistence context guarantees `==` within a session; `equals/hashCode` needs care |
| **Associations** | Object references, inherently **directional** (A holds a pointer to B) | Foreign keys, inherently **bidirectional** (a join can go either way) | Mapping directionality (`mappedBy`, owning vs inverse side) |
| **Data navigation** | Walk the graph: `order.getCustomer().getAddress()` | Set-based: you want to fetch what you need in as few round-trips as possible | Fetch strategies, lazy loading, `JOIN FETCH` — get this wrong and you get **N+1** |

**Identity** is the subtlest and a favorite follow-up. In Java there are two questions:
"are these the *same object*?" (`==`, reference identity) and "are these *logically
equal*?" (`equals()`). The database has exactly one: do the **primary keys** match. The
persistence context (first-level cache) bridges this by guaranteeing that within a single
`EntityManager`, repeated loads of the same row return the **same object instance** — so
`==` works *inside* a session. Across sessions, or for detached/transient entities, only
a properly implemented `equals()`/`hashCode()` (typically on a stable business key, never
on a DB-generated id that is null before insert) is reliable. See
`entity-mappings-associations` for the equals/hashCode entity contract in depth.

**Data navigation** is where the mismatch bites hardest in production. Objects invite you
to walk references freely; the database wants set-based access. If you lazily walk a
collection in a loop, the ORM issues one query per element — the **N+1 select problem**:

```java
// 1 query to load the orders...
List<Order> orders = em.createQuery("select o from Order o", Order.class).getResultList();
for (Order o : orders) {
    // ...then 1 query PER order to load its customer (lazy) = N more queries
    System.out.println(o.getCustomer().getName());
}
```

```sql
select * from orders;                       -- 1
select * from customer where id = ?;        -- N (once per order)
select * from customer where id = ?;
...
```

That is the impedance mismatch made concrete: fluent object navigation silently becomes a
flood of round-trips. The fix is `JOIN FETCH` / entity graphs / batch fetching, covered in
`fetching-lazy-eager-n-plus-one`.

```mermaid
flowchart LR
  subgraph OBJ[Object world - JVM heap]
    A[Order object] -->|reference| B[Customer object]
    B -->|reference| C[Address value]
  end
  subgraph REL[Relational world - RDBMS]
    T1[(orders row)] -->|FK customer_id| T2[(customer row)]
    T2 -->|columns| T3[address cols inline]
  end
  OBJ -. ORM maps + reconciles .-> REL
```

> [!WARNING]
> An ORM does not *eliminate* the impedance mismatch — it *manages* it and hides it
> behind an abstraction. The leaks (N+1, `LazyInitializationException`, cascade
> surprises, dirty-checking overhead) are exactly where the mismatch shows through, and
> exactly what senior interviews probe.

---

## JPA: the specification (Jakarta Persistence)

**JPA — Jakarta Persistence API** (formerly *Java* Persistence API) — is a
**specification**, not a library you can run by itself. It defines:

- A set of **interfaces**: `EntityManager`, `EntityManagerFactory`, `EntityTransaction`,
  `Query`, `TypedQuery`, `CriteriaBuilder`, etc. (package `jakarta.persistence.*`).
- A set of **annotations**: `@Entity`, `@Id`, `@GeneratedValue`, `@Table`, `@Column`,
  `@OneToMany`, `@ManyToOne`, `@Embeddable`, `@Version`, etc.
- A query language, **JPQL** (Jakarta Persistence Query Language), an object-oriented
  query language that operates over entities, not tables.
- The rules for the **persistence context**, entity lifecycle states, transactions,
  locking, and the `META-INF/persistence.xml` bootstrap descriptor.

JPA is delivered as an **API jar plus a TCK** (Technology Compatibility Kit). To do
anything at runtime you need a **provider** (implementation) — Hibernate, EclipseLink, or
OpenJPA — that supplies the actual engine behind those interfaces.

**Version lineage (know the current numbers):**

| Version | Namespace | Notes |
|---|---|---|
| JPA 2.2 | `javax.persistence.*` | Last release under the `javax` namespace (Java EE 8) |
| Jakarta Persistence 3.0 | `jakarta.persistence.*` | **Big-bang namespace rename**, no new features |
| Jakarta Persistence 3.1 | `jakarta.persistence.*` | `UUID` generation, more JPQL functions (`ceiling`, `floor`, `power`, `round`, `sign`, `extract`, `local date/time`) |
| Jakarta Persistence 3.2 | `jakarta.persistence.*` | Latest; `EntityManagerFactory`/`EntityManager` implement `AutoCloseable`, records for `@IdClass`/embeddables, more JPQL, programmatic schema APIs, `Enum`/`instant`/`year` improvements |

> [!TIP]
> Frame it in one line for the interviewer: *"JPA is the API and the rulebook;
> Hibernate is the engine that obeys the rulebook."* Coding against
> `jakarta.persistence.*` types keeps you provider-portable; coding against
> `org.hibernate.*` types couples you to Hibernate.

---

## Hibernate: the implementation (reference-grade JPA provider plus native features)

**Hibernate ORM** predates JPA — it was created by Gavin King around 2001 — and its
design directly inspired the JPA specification. Today Hibernate is the **most widely used
JPA provider** and is the default provider bundled with Spring Boot. It is *a* reference
implementation in practice (EclipseLink is the *official* JPA reference implementation),
and it implements the full JPA spec **plus** a large superset of native capabilities the
spec does not standardize:

- **Native query/session API**: `SessionFactory`, `Session`, `StatelessSession`.
- **HQL** (Hibernate Query Language) — a superset of JPQL.
- Extra id generators, `@NaturalId`, multi-tenancy, `@Filter`, `@Where`/`@SQLRestriction`,
  `@Formula`, `@DynamicUpdate`/`@DynamicInsert`, soft-delete, envers auditing.
- Second-level cache provider integration, batch fetching, `@BatchSize`,
  `@Fetch(FetchMode.SUBSELECT)`.
- Since Hibernate 6: a rewritten query engine built on the **SQM (Semantic Query
  Model)** — HQL/JPQL is parsed into a semantic AST, then translated to SQL, giving much
  better type safety and richer SQL generation. Hibernate 6 also moved fully to the
  `jakarta.*` namespace and requires **Java 11+** (Hibernate 7 requires **Java 17+**).

**The trade-off**: every native feature you use ties you to Hibernate. That is often the
right call (Hibernate is excellent and rarely swapped out), but it means "JPA-portable"
and "uses Hibernate" are not the same claim. Senior candidates make this distinction
explicitly.

```java
// JPA-portable: only jakarta.persistence.* types
@Entity
public class Book {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String title;
}

// Hibernate-native: org.hibernate.annotations.* — NOT portable to EclipseLink
@Entity
public class Book2 {
    @Id @GeneratedValue Long id;
    @org.hibernate.annotations.NaturalId String isbn;   // native
    @org.hibernate.annotations.Formula("(select count(*) from review r where r.book_id = id)")
    int reviewCount;                                     // native
}
```

---

## Other JPA providers: EclipseLink and OpenJPA

JPA is a spec, so multiple providers exist. Knowing they exist (and which is which)
signals you understand the spec/impl split.

| Provider | Role | Notes |
|---|---|---|
| **Hibernate ORM** | Most-used provider; Spring Boot default | Largest native feature set; created before JPA and inspired it |
| **EclipseLink** | **Official reference implementation** of Jakarta Persistence | Descended from Oracle TopLink; default provider in GlassFish/Payara |
| **Apache OpenJPA** | Apache's implementation | Descended from BEA Kodo; less active today |
| **DataNucleus** | Implements JPA *and* JDO | Notable for supporting non-relational stores too |

> [!INTERVIEW]
> Gotcha question: *"Which is the reference implementation of JPA — Hibernate or
> EclipseLink?"* The **official** reference implementation is **EclipseLink**. Hibernate
> is the most *popular* provider and the de-facto standard in Spring shops, but "most
> used" ≠ "the reference implementation." Getting this right is a quick seniority signal.

Because they all implement the same spec, an application written strictly against
`jakarta.persistence.*` can (in principle) swap providers by changing the
`provider` in `persistence.xml` and the dependency — the value proposition of coding to
the spec. In practice, real apps use provider-specific features and rarely migrate.

---

## The JPA architecture: EntityManagerFactory, EntityManager and the persistence unit

The three central runtime abstractions of JPA (this maps directly onto Hibernate's
native trio — see the next section):

| JPA concept | What it is | Lifecycle / cost | Thread-safety |
|---|---|---|---|
| **Persistence unit** | A named set of entity classes + config, declared in `META-INF/persistence.xml` (or built programmatically) | Design-time grouping | n/a |
| **`EntityManagerFactory` (EMF)** | Factory that builds `EntityManager`s for one persistence unit | **Expensive**, create **once** per unit, keep for app lifetime | **Thread-safe** — share it |
| **`EntityManager` (EM)** | The primary API: persist/find/merge/remove/query; owns the **persistence context** (first-level cache) | **Cheap**, short-lived, **one per transaction/request** | **NOT thread-safe** — never share across threads |

The `EntityManager` is the workhorse. It manages the **persistence context**: the set of
managed entity instances in the current unit of work. Within that context Hibernate
tracks changes (**dirty checking**), guarantees object identity (`==` for the same row),
batches writes, and flushes SQL at the right moment. Those mechanisms are the subject of
`session-entitymanager-persistence-context`, `entity-lifecycle-states`, and
`transactions-dirty-checking-flushing` — here just anchor the object hierarchy.

```mermaid
flowchart TD
  PU["Persistence unit<br/>persistence.xml"] --> EMF["EntityManagerFactory<br/>thread-safe, one per app"]
  EMF -->|createEntityManager| EM1["EntityManager<br/>request/tx scoped"]
  EMF -->|createEntityManager| EM2["EntityManager<br/>another thread"]
  EM1 --> PC1["Persistence context<br/>L1 cache, dirty tracking"]
  EM2 --> PC2["Persistence context"]
```

**Bootstrap (JPA-standard):**

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("my-unit");
EntityManager em = emf.createEntityManager();
em.getTransaction().begin();
em.persist(new Book("Effective Java"));
em.getTransaction().commit();   // flush + commit
em.close();
```

> [!WARNING]
> **`EntityManager` is not thread-safe.** Sharing one across threads corrupts the
> persistence context. In Spring you almost never manage this yourself: Spring injects a
> shared, thread-bound proxy `@PersistenceContext EntityManager` that delegates to the
> correct per-transaction instance. Container/transaction management is a **spring-***
> concern — see `spring-core`/`spring-boot` for `@Transactional` proxying and
> propagation; this domain owns only the JPA/Hibernate mechanics.

---

## Hibernate's native API: SessionFactory and Session

Hibernate's native abstractions predate JPA and map one-to-one onto the JPA ones:

| Hibernate native | JPA equivalent | Relationship in Hibernate 6/7 |
|---|---|---|
| `SessionFactory` | `EntityManagerFactory` | `SessionFactory` **extends** `EntityManagerFactory` |
| `Session` | `EntityManager` | `Session` **extends** `EntityManager` |
| `Transaction` | `EntityTransaction` | native transaction abstraction |
| `StatelessSession` | (no JPA equivalent) | no persistence context, no cache, no dirty checking — for bulk work |

Because `Session extends EntityManager` and `SessionFactory extends EntityManagerFactory`
in Hibernate 6/7, you can **unwrap** the JPA type to the Hibernate type to reach native
features while keeping JPA everywhere else:

```java
Session session = em.unwrap(Session.class);              // JPA -> Hibernate
SessionFactory sf = emf.unwrap(SessionFactory.class);
Book b = session.bySimpleNaturalId(Book.class).load("978-0134685991"); // native feature
```

**`StatelessSession`** is a key senior detail: it is a command-oriented API with **no
persistence context, no first-level cache, no automatic dirty checking, and no cascade**.
Because it doesn't accumulate managed entities in memory, it's the right tool for bulk
inserts/updates and large exports where a normal `Session` would balloon memory and force
constant flushing. It's the ORM-side answer to "the ORM is the wrong tool for bulk work"
(next section).

```mermaid
classDiagram
  EntityManagerFactory <|-- SessionFactory
  EntityManager <|-- Session
  class EntityManagerFactory { <<jakarta.persistence>> }
  class EntityManager { <<jakarta.persistence>> }
  class SessionFactory { <<org.hibernate>> }
  class Session { <<org.hibernate>> }
```

---

## javax to jakarta: the namespace migration

A version-history question that trips people up. Java EE was donated by Oracle to the
Eclipse Foundation and rebranded **Jakarta EE**. For legal/trademark reasons Oracle
retained the `javax` trademark, so **Jakarta EE 9 renamed every `javax.*` package to
`jakarta.*`** — a hard, breaking, package-level rename with **no new features** in that
release. For persistence specifically:

- **`javax.persistence.*` → `jakarta.persistence.*`** (e.g. `javax.persistence.Entity`
  becomes `jakarta.persistence.Entity`).
- This happened at **Jakarta Persistence 3.0**.
- **Hibernate ORM 5.x** used `javax.persistence.*`; **Hibernate ORM 6.0+** uses
  `jakarta.persistence.*`. This is often the single biggest hurdle in a Hibernate
  5→6 upgrade.
- **Spring Boot 2.x** is `javax`; **Spring Boot 3.x** requires `jakarta` (and Java 17+).

```java
// Legacy (Java EE 8 / JPA 2.2 / Hibernate 5 / Spring Boot 2)
import javax.persistence.Entity;
import javax.persistence.Id;

// Current (Jakarta EE 9+ / Jakarta Persistence 3.x / Hibernate 6-7 / Spring Boot 3)
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
```

> [!TIP]
> Migration tools exist (Eclipse Transformer, OpenRewrite `jakarta` recipes,
> IntelliJ's refactor) to bytecode/source-rewrite `javax.*` → `jakarta.*`. It is
> mechanical but all-or-nothing: you cannot mix `javax.persistence` and
> `jakarta.persistence` in the same running application because they are different types.
> The rename is *only* about package names — annotation names, semantics, and behavior
> are unchanged.

---

## When to use an ORM vs plain JDBC, jOOQ or MyBatis

An ORM is not always the right tool. A senior answer weighs the trade-offs rather than
treating Hibernate as a default hammer.

**Use an ORM (JPA/Hibernate) when:**

- You have a rich **domain model** with lots of entities and associations, and CRUD +
  navigation dominate the workload.
- You benefit from the **persistence context**: automatic dirty checking, identity
  guarantees, write batching, caching, and cascade of lifecycle operations.
- Portability across databases matters (Hibernate abstracts dialect differences).
- Developer productivity on transactional line-of-business logic matters more than
  micro-optimized SQL.

**Prefer plain JDBC / jOOQ / MyBatis (or Spring's `JdbcClient`/`JdbcTemplate`) when:**

| Tool | Strength | Use when |
|---|---|---|
| **Plain JDBC** | Full control, zero abstraction | Ultra-hot paths, simple scripts, you own every byte |
| **jOOQ** | Type-safe SQL DSL generated from your schema; SQL-first | You want to *write SQL* but type-checked and refactor-safe; complex analytical queries |
| **MyBatis** | SQL in XML/annotations mapped to objects; SQL-first | You want hand-tuned SQL with light object mapping and no persistence-context magic |
| **Spring Data JDBC** | Simpler than JPA, no lazy loading / dirty checking | You want repositories without the full JPA machinery |

**Where an ORM is the *wrong* tool (classic interview point):**

- **Bulk operations** — inserting/updating/deleting millions of rows one managed entity
  at a time is slow and memory-hungry. Use set-based `UPDATE`/`DELETE` JPQL, JDBC batch,
  or Hibernate's `StatelessSession`.
- **Reporting / analytics** — wide aggregations, pivots, window functions. Fetching
  entities to compute a report is wasteful; run SQL (or projections) and read scalars.
- **Complex, database-specific queries** — recursive CTEs, sophisticated window
  functions, vendor SQL. Native SQL, jOOQ, or a view is clearer than bending JPQL.

> [!KEY-TAKEAWAY]
> The mature position: **use an ORM for the transactional domain model, and drop to
> SQL-first tools (native query, jOOQ, `StatelessSession`, set-based JPQL) for bulk and
> reporting.** They coexist — many teams run Hibernate for OLTP writes and jOOQ/native
> SQL for reports against the same database. Reaching for the right tool per workload,
> rather than forcing everything through entities, is the senior move.

For the underlying SQL, JDBC driver, and database-engine mechanics that all these tools
sit on top of, see `messaging-databases/sql-query-language-advanced-queries` and
`messaging-databases/database-storage-internals-engines`.

---

## Common Interview Follow-ups

- **"Are JPA and Hibernate the same thing?"** No. JPA is a specification (interfaces +
  annotations in `jakarta.persistence.*`); Hibernate is an implementation (provider) of
  that spec plus native features. You can use JPA *through* Hibernate.
- **"Which is the official JPA reference implementation?"** EclipseLink. Hibernate is the
  most *popular* provider and Spring Boot's default, but not the official RI.
- **"What's the difference between `EntityManagerFactory` and `EntityManager`?"** EMF is
  expensive, thread-safe, created once per persistence unit; EM is cheap, not thread-safe,
  one per transaction/request, and owns the persistence context.
- **"How does Hibernate's `Session` relate to JPA's `EntityManager` in Hibernate 6?"**
  `Session extends EntityManager` (and `SessionFactory extends EntityManagerFactory`); you
  `em.unwrap(Session.class)` to reach native features.
- **"Why did the package change from `javax.persistence` to `jakarta.persistence`?"**
  Oracle donated Java EE to the Eclipse Foundation but kept the `javax` trademark, forcing
  the rename in Jakarta EE 9. Jakarta Persistence 3.0 and Hibernate 6 adopted it.
- **"Name a case where you would NOT use Hibernate."** Bulk data loads, heavy
  reporting/analytics, or vendor-specific complex SQL — use native SQL, jOOQ,
  `StatelessSession`, or set-based JPQL instead.
- **"What is the object-relational impedance mismatch, in one example?"** Object
  navigation (`order.getCustomer()`) is graph-oriented while the DB is set-oriented;
  walking a lazy association in a loop produces the N+1 select problem.
- **"Can you swap Hibernate for EclipseLink without code changes?"** Only if you coded
  strictly against `jakarta.persistence.*` and used no native features; in practice most
  apps use provider-specific features and don't migrate.

## References

- Jakarta Persistence 3.2 Specification — jakarta.ee/specifications/persistence/3.2/
- Jakarta Persistence 3.1 Specification — jakarta.ee/specifications/persistence/3.1/
- Hibernate ORM 6/7 User Guide — docs.jboss.org/hibernate/orm/current/userguide/html_single/
- Hibernate ORM Migration Guide (5→6, javax→jakarta) — docs.jboss.org/hibernate/orm/6.0/migration-guide/
- *Java Persistence with Hibernate* (Bauer, King, Gregory) — impedance mismatch chapter
- EclipseLink (official JPA RI) — eclipse.dev/eclipselink/
- Vlad Mihalcea, *High-Performance Java Persistence* — ORM vs JDBC trade-offs, N+1
- Related in this library: `session-entitymanager-persistence-context`,
  `entity-lifecycle-states`, `fetching-lazy-eager-n-plus-one`,
  `hibernate-6-7-and-jakarta-migration`; `messaging-databases/*` for SQL/JDBC/DB internals;
  `spring-boot`/`spring-core` for `@Transactional` and the container.
