# Caching: First & Second Level Cache

Hibernate has two distinct caches with completely different scopes, lifetimes, and
purposes — and interviewers love to probe whether you can tell them apart. The
**first-level cache (L1)** is *the persistence context itself*: mandatory, per-Session,
and the mechanism behind identity guarantees and dirty checking. The **second-level
cache (L2)** is *optional*, shared across all Sessions at the `SessionFactory` level,
requires a pluggable provider, and is a foot-gun if you cache the wrong data. On top of
L2 sits the separate **query cache**, which is subtle enough to be a net negative in
most systems.

> [!INTERVIEW]
> The single most common confusion this topic exposes: candidates say "Hibernate
> caches entities so the second query is free" without distinguishing *which* cache.
> The L1 cache is why the second `find(Author.class, 1L)` in the *same* transaction
> skips the DB. The L2 cache is why it skips the DB in a *different* transaction on a
> *different* Session. They are not the same thing, and only L1 is on by default.

Underlying distributed-cache infrastructure (Redis, cache invalidation patterns,
write-through vs cache-aside, TTL/eviction policy tradeoffs) lives in
`messaging-databases` — see `messaging-databases/caching-patterns` and
`messaging-databases/redis`. Here we stay at the ORM altitude: what Hibernate's own
caches store, when they hit, and how they go stale.

## First-Level Cache Is the Persistence Context

The first-level cache is not a separate feature you enable — it **is** the persistence
context (`EntityManager` / Hibernate `Session`). Every managed entity lives in a
`Map` keyed by `EntityKey` (entity type + primary key). It is:

- **Mandatory** — you cannot turn it off. Every Session has one.
- **Session-scoped** — bounded to a single `EntityManager`/`Session`, which is
  typically bounded to a single transaction in a Spring app.
- **Not shared** — two concurrent Sessions have completely independent L1 caches.
  Nothing one Session loads is visible to another via L1.

Its job is **identity scope** and **repeated-read avoidance**. Within one Session, a
given database row maps to exactly one Java object instance (the "guaranteed object
identity" / repeatable-read-within-a-Session property):

```java
Author a1 = em.find(Author.class, 1L);   // SELECT ... FROM author WHERE id = 1
Author a2 = em.find(Author.class, 1L);   // NO SQL — served from L1
assert a1 == a2;                          // same instance (== not just equals)
```

The second `find` issues **no SQL** — Hibernate looks up the `EntityKey` in the
persistence context and returns the existing instance. This is also why detached
entity equality and `equals`/`hashCode` matter (see
`hibernate-jpa/entity-lifecycle-states`).

```mermaid
flowchart TD
    A["em.find(Author, 1L)"] --> B{"EntityKey in<br/>persistence context?"}
    B -->|yes| C["return existing instance<br/>(no SQL)"]
    B -->|no| D["SELECT from DB"]
    D --> E["hydrate + store in L1"]
    E --> C
```

> [!KEY-TAKEAWAY]
> L1 is the persistence context. It gives you (1) guaranteed object identity within a
> Session and (2) avoidance of duplicate SELECTs for the same id in one transaction.
> It is always on and never shared.

## L1 Lifecycle: clear, detach, evict, close

Because L1 lives inside the Session, its contents are governed by the Session's
lifecycle and by explicit eviction:

- `em.clear()` — detaches **all** managed entities; the persistence context is emptied.
  Subsequent `find` for the same id re-hits the DB.
- `em.detach(entity)` (Hibernate `session.evict(entity)`) — removes **one** entity from
  the context; it becomes detached.
- `em.close()` / `session.close()` — closes the Session; everything becomes detached.

A crucial gotcha for long-running or batch operations: the L1 cache **grows unbounded**
for the life of the Session. Inserting a million rows in one transaction without
periodically `flush()` + `clear()` will exhaust the heap, because every persisted entity
is retained in the persistence context. The standard batch idiom flushes and clears
every N entities:

```java
for (int i = 0; i < 1_000_000; i++) {
    em.persist(new LogEntry(...));
    if (i % 50 == 0) {          // batch size
        em.flush();             // push INSERTs to the DB
        em.clear();             // drop them from L1 to free memory
    }
}
```

> [!WARNING]
> The L1 cache is not an LRU cache with a size limit — it holds every entity the
> Session has touched until `clear()`/`close()`. `OutOfMemoryError` during large batch
> jobs is almost always a missing `flush()`+`clear()` loop.

## Second-Level Cache: Shared Across Sessions

The second-level cache is **optional**, scoped to the `SessionFactory` (i.e. the whole
application / persistence unit), and **shared across all Sessions**. Its purpose is to
avoid hitting the database at all for entities that many transactions read repeatedly.

L1 vs L2 at a glance:

| Aspect | First-level (L1) | Second-level (L2) |
|---|---|---|
| Scope | Per `EntityManager`/`Session` | Per `SessionFactory` (app-wide) |
| Shared? | No — private to one Session | Yes — across all Sessions/threads |
| On by default? | Yes, mandatory | No — must be enabled + configured |
| Provider needed? | No | Yes (Ehcache, Infinispan, Caffeine, Hazelcast, …) |
| What's cached | Managed entity **instances** | **Dehydrated** state (see below) |
| Lifetime | Until `clear()`/`close()` | Until evicted / expired / invalidated |
| Concurrency concern | None (single-threaded per Session) | Yes — strategy matters (READ_WRITE etc.) |

The lookup path when both caches are enabled: check L1 first, then L2, then the DB.

```mermaid
flowchart TD
    A["em.find(Country, 1L)"] --> L1{"in L1<br/>(this Session)?"}
    L1 -->|hit| R1["return instance, no SQL"]
    L1 -->|miss| L2{"in L2<br/>(SessionFactory)?"}
    L2 -->|hit| H["hydrate entity from<br/>cached state, put in L1"]
    H --> R2["return, no SQL"]
    L2 -->|miss| DB["SELECT from DB"]
    DB --> S["store dehydrated state in L2<br/>+ managed instance in L1"]
    S --> R3["return"]
```

## Enabling L2: shared-cache-mode, @Cacheable, @Cache

Turning on L2 takes several coordinated pieces:

1. **A provider on the classpath and configured.** Hibernate 6/7 uses the JCache
   (JSR-107) region factory or a native one. Typical: Ehcache 3 via
   `hibernate.cache.region.factory_class = org.hibernate.cache.jcache.JCacheRegionFactory`,
   or Infinispan for clustered caches.
2. **`hibernate.cache.use_second_level_cache = true`.**
3. **Mark which entities are cacheable** — via the JPA `shared-cache-mode` and/or the
   `@Cacheable` / `@Cache` annotations.

The JPA-standard `shared-cache-mode` (in `persistence.xml`, or
`jakarta.persistence.sharedCache.mode` / Spring's
`spring.jpa.properties.jakarta.persistence.sharedCache.mode`) controls the policy:

| `shared-cache-mode` | Meaning |
|---|---|
| `ALL` | Cache all entities |
| `NONE` | Cache nothing (L2 effectively off) |
| `ENABLE_SELECTIVE` | Cache only entities annotated `@Cacheable(true)` (the common choice) |
| `DISABLE_SELECTIVE` | Cache all entities **except** those `@Cacheable(false)` |
| `UNSPECIFIED` | Provider-specific default |

`@Cacheable` is the **JPA-standard** (`jakarta.persistence.Cacheable`) boolean marker.
Hibernate's own `@Cache` (`org.hibernate.annotations.Cache`) is richer — it also sets
the **concurrency strategy** and region:

```java
@Entity
@Cacheable                                              // JPA: eligible for L2
@Cache(usage = CacheConcurrencyStrategy.READ_ONLY)      // Hibernate: strategy
class Country {
    @Id Long id;
    String isoCode;
    String name;
}
```

> [!TIP]
> Use `ENABLE_SELECTIVE` + `@Cacheable` so caching is opt-in per entity. `ALL` is
> dangerous: it caches write-heavy and large entities that should never be in L2.

## L2 Concurrency Strategies

The `CacheConcurrencyStrategy` (set via Hibernate's `@Cache(usage = ...)`) decides how
concurrent reads/writes to a cached entity are coordinated. Choosing the wrong one is
how you serve stale or even corrupted data.

| Strategy | Use when | Mechanism / cost |
|---|---|---|
| `READ_ONLY` | Data **never** changes after insert (reference/lookup tables) | Cheapest, no locking. Modifying a `READ_ONLY` entity throws an exception. |
| `NONSTRICT_READ_WRITE` | Rare updates, occasional stale reads tolerable | On update, **evicts** the entry (no locking). Small window where a stale value can be read. |
| `READ_WRITE` | Read-mostly data that does get updated, strong-ish consistency needed | Uses **soft locks** on the cache entry during the transaction; more overhead. |
| `TRANSACTIONAL` | Full JTA/XA transactional consistency needed | Cache participates in the JTA transaction (needs a transactional provider like Infinispan). Highest overhead, rarely used. |

Key mechanism points interviewers push on:

- **`READ_ONLY`** does no locking and is the fastest, but any attempt to update such an
  entity results in an error — it's genuinely for immutable data.
- **`NONSTRICT_READ_WRITE`** does not lock; on a write it just **invalidates** (removes)
  the entry so the next read reloads from DB. Because invalidation isn't perfectly
  synchronized with the DB commit, there's a brief staleness window — never use it where
  a stale read is unacceptable.
- **`READ_WRITE`** maintains soft locks so a concurrent transaction sees a consistent
  view; it's the safe default for mutable-but-read-mostly data, at higher cost.
- **`TRANSACTIONAL`** is only meaningful with a JTA transaction manager and a
  transactional cache provider.

> [!WARNING]
> None of these strategies make L2 safe for data changed **outside** Hibernate. A raw
> SQL `UPDATE`, a DB trigger, a bulk JPQL `UPDATE`/`DELETE`, or a second application
> writing the same table will **not** invalidate the L2 cache — Hibernate keeps serving
> the stale cached copy. This is the classic L2 staleness trap.

## L2 Stores Dehydrated State, Not Objects

A frequently-missed detail: the L2 cache does **not** store your entity objects. It
stores a **dehydrated** representation — essentially the disassembled column values (a
`Map`/array of the primitive/identifier state), keyed by entity id, with no object
references and no proxies.

Why it matters:

- On an L2 hit, Hibernate **rehydrates** a *new* entity instance from the cached state
  into the current Session. You never share a mutable object across threads via L2, so
  there's no thread-safety hazard from sharing instances.
- Associations are stored as **foreign-key identifiers**, not as the associated objects.
  A cached `Author` holding a `@ManyToOne Publisher` stores the `publisher_id`, and the
  `Publisher` is resolved separately (from L2 if it too is cached, else the DB).
- This is also why L2 cannot cache things that aren't part of the entity's persistent
  state.

> [!KEY-TAKEAWAY]
> L2 caches **data (dehydrated state) by id**, not object instances. Each hit produces a
> freshly hydrated entity in the requesting Session — which is exactly why the shared
> cache is safe to read from many threads.

## What L2 Does NOT Cache by Default

Enabling `@Cache` on an entity caches **that entity's own scalar state, by id**. It does
*not* automatically cache:

- **Collections / associations.** A `@OneToMany` or `@ManyToMany` collection is a
  *separate* cache region and needs its **own** `@Cache` annotation on the collection
  field. Otherwise, even with the parent cached, navigating the collection re-queries the
  DB (and can reintroduce N+1 — see `hibernate-jpa/fetching-lazy-eager-n-plus-one`).

  ```java
  @Entity @Cacheable @Cache(usage = READ_WRITE)
  class Author {
      @Id Long id;

      @OneToMany(mappedBy = "author")
      @Cache(usage = CacheConcurrencyStrategy.READ_WRITE)   // needed to cache the collection
      List<Book> books = new ArrayList<>();
  }
  ```

  Note the collection cache stores only the **ids** of the associated entities; the
  `Book` entities themselves must also be cached (via their own `@Cache`) or each id is
  re-fetched.

- **Query results.** `find`/`getReference` by id use the entity cache, but results of a
  JPQL/HQL/Criteria *query* are **not** cached unless you explicitly enable the separate
  **query cache** (next section).

## The Query Cache Is Separate (and Often a Net Negative)

The query cache is an **additional, opt-in** cache that stores the results of a specific
query. It must be enabled separately
(`hibernate.cache.use_query_cache = true`) **and** requested per query
(`query.setHint("org.hibernate.cacheable", true)` or `setCacheable(true)`).

Critical mechanism detail: the query cache **does not store entities**. It stores only
the **primary keys** returned by the query (keyed by the query string + bind
parameters). To materialize the results it then looks each id up — in L1, then the L2
entity cache, then the DB. So:

> [!WARNING]
> The query cache is nearly useless (or actively harmful) unless the entities it returns
> are **also** in the L2 entity cache. If the entity isn't L2-cached, a query-cache "hit"
> still fires N SELECTs by id — you get an N+1 *plus* the overhead of maintaining the
> query cache. Enable the query cache only alongside entity caching for the same types.

The bigger reason it's often a net negative:

- **Invalidation is coarse.** The query cache uses an `UpdateTimestampsCache` that tracks
  the last-write timestamp per table (query space). **Any** insert/update/delete to a
  table invalidates **every** cached query touching that table. On a table with any write
  traffic, cached queries are evicted constantly, so the hit rate collapses while you
  still pay the maintenance cost.
- It only helps for **frequently-repeated queries with identical parameters** against
  **rarely-written** tables.

```mermaid
flowchart TD
    Q["query.setCacheable(true)"] --> C{"query key<br/>(HQL + params)<br/>in query cache?"}
    C -->|miss| DB["run SQL, cache the<br/>list of IDs"]
    C -->|hit| TS{"table timestamp newer<br/>than cached entry?"}
    TS -->|yes stale| DB
    TS -->|no| IDS["for each cached id"]
    IDS --> L2{"entity in L1/L2?"}
    L2 -->|yes| OK["return, no SQL"]
    L2 -->|no| N["SELECT by id (N+1!)"]
```

## When L2 Helps vs When It Hurts

L2 is a specialized tool, not a general speedup. The senior judgment:

**Good candidates for L2:**
- Read-mostly / write-rarely **reference data**: countries, currencies, product
  categories, config/lookup tables.
- Entities read far more often than modified, where a small staleness window is
  acceptable.
- Data whose access pattern is **by primary key** (L2 is a by-id cache).

**Bad candidates / anti-patterns:**
- **Write-heavy** entities — constant invalidation kills the hit rate and adds overhead.
- **Large** entities or huge tables — memory blow-up and low reuse.
- Data mutated **outside Hibernate** (raw SQL, other apps, bulk JPQL, triggers) — L2 goes
  stale silently.
- Using L2 as a substitute for fixing N+1 or missing indexes — fix the query first (see
  `hibernate-jpa/fetching-lazy-eager-n-plus-one` and `messaging-databases/indexing`).

> [!INTERVIEW]
> "Should we turn on the second-level cache to speed up the app?" is a trap. The staff
> answer: measure first; L2 only helps read-mostly, by-id, reference-style data, and it
> introduces a distributed-invalidation problem across nodes. For general read scaling,
> an explicit application cache (Redis, cache-aside) with deliberate invalidation is
> usually clearer and easier to reason about — see
> `messaging-databases/caching-patterns`. Reach for L2 when the access is genuinely
> by-entity-id and the data rarely changes.

## Clustered L2 and Invalidation Across Nodes

In a multi-node deployment, each JVM has its own `SessionFactory` and therefore its own
L2. If node A updates a cached entity, node B's L2 must be told, or it serves stale data.
Two approaches:

- **Replicated/distributed cache** (Infinispan, Hazelcast): entries and invalidation
  messages propagate across the cluster over the network. Adds latency and network
  chatter; the invalidation is eventually consistent.
- **Local-only cache** (Ehcache/Caffeine per node): fast, but each node can hold a stale
  copy until its own TTL expires — acceptable only for truly read-mostly data.

This is the same distributed cache-coherency problem covered generally in
`messaging-databases/caching-patterns`; here the Hibernate-specific angle is that L2 is
per-`SessionFactory`, so scaling out multiplies the coherency problem.

## READ_WRITE Internals: Soft Locks and Async Refresh

The one-line summary ("READ_WRITE uses soft locks") is not enough for a senior loop. You
must be able to explain the actual **two-phase, asynchronous** protocol, because it is the
single biggest differentiator question on this topic.

`READ_WRITE` is an **asynchronous** strategy: the cache is refreshed *after* the database
transaction commits, not during it. The dance on an update:

1. **During the transaction (before commit):** Hibernate calls the strategy's synchronous
   `update()`, which for READ_WRITE is essentially a **no-op** for the value — instead the
   cache entry is replaced by a **`Lock` (soft-lock) placeholder**. A `Lock` is a special
   entry that is **never readable** (`isReadable()` returns `false`).
2. **The concurrency guarantee:** while the `Lock` sits in the region, any concurrent
   transaction that looks up that key gets a **cache miss** (the `Lock` is not readable) and
   **falls through to the database**. That is *how stale reads are prevented* during the
   write window — there is no way to read the pre-commit or post-commit value from the
   cache, so everyone reads the DB until the real value is installed.
3. **After the DB commits:** Hibernate's `afterUpdate` callback replaces the `Lock` with a
   real `Item` holding the freshly **disassembled (dehydrated)** state.

Reads use timestamp/version checks: an `Item` is only readable if the requesting session's
`txTimestamp` is **after** the entry's own timestamp (`isReadable(txTimestamp)` ⇒
`txTimestamp > entry.timestamp`), and a `putFromLoad` only stores if the incoming version is
higher (`isWriteable`). This is why a session that started before an entry was cached will
not read that entry.

```mermaid
sequenceDiagram
    participant Tx as Writing Tx
    participant C as L2 region
    participant Other as Concurrent Tx
    Tx->>C: update() installs Lock (soft lock)
    Other->>C: get(key)
    C-->>Other: miss (Lock not readable)
    Other->>Other: fall through to DB
    Tx->>Tx: DB COMMIT
    Tx->>C: afterUpdate() installs real Item (dehydrated state)
```

**IDENTITY-generator gotcha.** With `GenerationType.IDENTITY`, newly inserted entities are
**NOT put into L2 on insert**. IDENTITY requires the INSERT to run immediately (to obtain
the generated key), which breaks Hibernate's transactional write-behind design, so the
`afterInsert` cache put is skipped. Only `SEQUENCE`/`TABLE` (and `UUID`) generators, where
the id is known before flush, cache the entity on insert. This is the classic "why is my
just-persisted entity a cache *miss* on the very next request?" question — the answer is the
id generation strategy, not a misconfiguration.

**Stuck-lock / rollback edge case.** If the DB write **fails or rolls back**, the `afterX`
callback that would replace the `Lock` with a real value may not run, so the entry can stay
a `Lock`. Reads then keep missing L2 and hitting the DB until the soft lock **times out**.
The default is `DEFAULT_CACHE_LOCK_TIMEOUT = 60000` ms (**60 seconds**). So "after a failed
transaction, why does this entity miss L2 for a while?" ⇒ the 60-second soft-lock timeout.

> [!KEY-TAKEAWAY]
> READ_WRITE = *write-through/refresh* via a two-phase async soft lock: install a
> non-readable `Lock` before commit, replace it with dehydrated state after commit;
> concurrent readers miss and go to the DB in between. NONSTRICT_READ_WRITE, by contrast, is
> *read-through/invalidate*: it simply **evicts** on write and can briefly serve stale data
> because eviction is not atomic with the commit.

## Forcing Refresh and Bypass: CacheMode, CacheStoreMode, CacheRetrieveMode

There are two parallel APIs for per-operation cache control — the JPA-standard pair and
Hibernate's single enum — and interviewers like to see you map between them.

**JPA-standard (per-operation, `jakarta.persistence.cache.*`):**

| Property | Values | Meaning |
|---|---|---|
| `jakarta.persistence.cache.storeMode` | `USE` (default) | Write results into L2 normally |
| | `BYPASS` | Read from L2 but do **not** write to it |
| | `REFRESH` | Force-refresh the L2 entry from the DB |
| `jakarta.persistence.cache.retrieveMode` | `USE` (default) | Read from L2 if present |
| | `BYPASS` | Ignore L2, go straight to the DB |

Set them via `em.setProperty(...)`, per-lookup with `em.find(Entity.class, id, props)`, or as
a query hint.

**Hibernate-native (`org.hibernate.CacheMode`, session- or query-level):**

| `CacheMode` | Reads L2? | Writes L2? | = JPA (retrieve × store) |
|---|---|---|---|
| `NORMAL` | yes | yes | USE × USE |
| `GET` | yes | no | USE × BYPASS |
| `PUT` | no | yes | BYPASS × USE (warm the cache) |
| `REFRESH` | no | yes + force refresh | BYPASS × REFRESH |
| `IGNORE` | no | no | BYPASS × BYPASS |

Set with `session.setCacheMode(...)` or `query.setCacheMode(...)`. So Hibernate's `CacheMode`
is literally the product of the two JPA modes.

Practical answers to "how do I force a refresh / bypass the cache for one operation?":
`CacheStoreMode.REFRESH` or `CacheMode.REFRESH` to force-reload L2 from the DB;
`CacheRetrieveMode.BYPASS` or `CacheMode.GET`/`IGNORE` to ignore a possibly-stale entry; or
the explicit eviction API (next sections) to drop the entry entirely.

## Natural-Id Cache

Hibernate can cache a **natural-id → primary-key** mapping in its own region, separate from
the entity cache. Annotate the business key with `@NaturalId` and add `@NaturalIdCache`:

```java
@Entity
@Cacheable @Cache(usage = READ_WRITE)   // entity itself must be L2-cached too
@NaturalIdCache
class Product {
    @Id @GeneratedValue(strategy = SEQUENCE) Long id;
    @NaturalId String sku;               // the business key
    String name;
}

Product p = session.byNaturalId(Product.class)
                   .using("sku", "ABC-123")
                   .load();
```

`byNaturalId(...).load()` first resolves the SKU to a primary key from the **natural-id
cache**, then loads the entity from the **L2 entity cache** by that id. Because it is a
two-step resolve, the entity must *also* be `@Cache`-annotated, or you save only the
id-lookup and still SELECT the entity. This is the idiomatic pattern for lookup-by-business-key
(SKU, ISO code, username) and a favorite "did you know this exists?" senior question.

## Query Cache Layout (Hibernate 6.5+)

The flat statement "the query cache stores only primary keys" was true through Hibernate
**6.4** but is **configurable since Hibernate 6.5**. The `CacheLayout` enum (via
`@QueryCacheLayout(layout = ...)` on an entity/query or the property
`hibernate.cache.query_cache_layout`) controls what a cacheable query stores:

| `CacheLayout` | Stores | When to use |
|---|---|---|
| `SHALLOW` | Ids only (the classic pre-6.5 behavior) | Entity is also L2-cached (ids resolve cheaply) |
| `FULL` | Full entity/DTO state — no per-id refetch | Entity is **not** L2-cached; lets the query cache stand alone |
| `SHALLOW_WITH_DISCRIMINATOR` | Ids + type discriminator | Polymorphic result rows |
| `AUTO` | Picks `SHALLOW` if the entity is L2-cacheable, else `FULL` | Sensible default in 6.5+ |

This **softens the old "query cache is useless without entity caching" advice**: with `FULL`
or `AUTO`, a query-cache hit can materialize results directly from cached state, so it no
longer fans out into N SELECTs when the entity is not L2-cached. Version-flag your answer:
**HB ≤ 6.4 = ids only, always; HB ≥ 6.5 = configurable via `CacheLayout`.**

## Cache Tuning Properties

Beyond `use_second_level_cache`, the `hibernate.cache.*` namespace has several properties
that come up in senior tuning discussions:

| Property | Effect |
|---|---|
| `hibernate.cache.use_second_level_cache` | Master switch for L2 |
| `hibernate.cache.use_query_cache` | Master switch for the query cache |
| `hibernate.cache.region.factory_class` | The `RegionFactory` (JCache, Infinispan, …) |
| `hibernate.cache.region_prefix` | Prefix on region names (useful for shared cache infra) |
| `hibernate.cache.default_cache_concurrency_strategy` | Sets the strategy globally, so you can omit `usage` on `@Cache` |
| `hibernate.cache.use_minimal_puts` | Skip a `put` if the entry is already present (default **true** for clustered providers — saves network writes) |
| `hibernate.cache.use_reference_entries` | Store **immutable** entities *by reference* (no dehydration) — only valid for immutable entities with no to-one associations; otherwise silently ignored |
| `hibernate.cache.use_structured_entries` | Store entries in a human-readable `Map` form (debuggability, slower) |
| `hibernate.cache.auto_evict_collection_cache` | Default **false** — updating one side of an association does **not** auto-evict the collection region unless you enable this |
| `hibernate.cache.missing_cache_strategy` | `fail` / `create` / `create-warn` — what to do when a referenced region isn't preconfigured |

The `use_reference_entries` trap is a good "when does dehydration *not* happen?" question:
storing by reference only works for immutable entities with no to-one associations; anything
mutable or associated falls back to normal dehydration silently. And `auto_evict_collection_cache
= false` explains a real bug: you cache `Author` and its `books`, add a `Book`, and the
parent's cached collection still shows the old list because the collection region was not
auto-evicted.

## Managing the Cache Programmatically

Explicit eviction is the answer to "how do you fix staleness after a bulk update or
out-of-band write?" Two entry points, same underlying region:

- **JPA-standard** `jakarta.persistence.Cache` via `emf.getCache()`:
  `evict(Class, id)`, `evict(Class)`, `evictAll()`, and `contains(Class, id)`.
- **Hibernate-native** `org.hibernate.Cache` via `sessionFactory.getCache()`, which is finer-
  grained: `evictEntityData(Class, id)`, `evictEntityData(Class)`, `evictCollectionData(...)`,
  `evictQueryRegions()`, `evictQueryRegion(name)`, `evictNaturalIdData(...)`, and
  `evictAllRegions()`.

```java
// After a bulk JPQL UPDATE that bypassed L2:
em.getEntityManagerFactory().getCache().evict(Product.class);       // JPA: drop all Product entries
sessionFactory.getCache().evictQueryRegions();                      // Hibernate: also clear stale query results
boolean cached = emf.getCache().contains(Product.class, 42L);       // introspect
```

## Region Factories in Hibernate 6/7

The provider landscape changed in Hibernate 6:

- **Native Ehcache and Infinispan region factories were removed.** You no longer use
  `EhCacheRegionFactory`/`InfinispanRegionFactory` from the ORM jar.
- For a **local** cache, use `hibernate-jcache` (the JSR-107 bridge,
  `org.hibernate.cache.jcache.JCacheRegionFactory`) backed by **Ehcache 3** or **Caffeine**.
- For a **distributed/clustered** cache, use `org.infinispan:infinispan-hibernate-cache-v60`
  (packaged and versioned by the Infinispan project, not ORM).
- `hibernate.cache.missing_cache_strategy` decides what happens when a region referenced by an
  entity isn't defined in the provider's config: `fail` (throw — safest for prod so you notice
  a typo'd region), `create` (auto-create silently), or `create-warn` (auto-create + log).

Note the coherency model differs by provider: **Ehcache 3 / Caffeine are local-only** (no
cross-node coherence), while **Infinispan** offers **invalidation mode** (only eviction
messages cross the wire — the common/recommended L2 mode), **replication** (full copies on
every node — chatty), and **distributed** (sharded with a fixed number of owners). For L2,
invalidation mode is usually preferred: each node keeps its own copy and only invalidations
propagate. See `messaging-databases/caching-patterns` for the general coherency trade-offs.

## @Cacheable vs @Cache Precision

Two annotations, easy to conflate:

- `jakarta.persistence.@Cacheable` — JPA-standard, a **boolean marker only** (`@Cacheable`
  ≡ `@Cacheable(true)`). It says "eligible for L2" and nothing about *how*.
- `org.hibernate.annotations.@Cache` — Hibernate-specific; sets `usage` (the
  `CacheConcurrencyStrategy`), an optional `region` name, and `include` (`"all"` default, or
  `"non-lazy"` to exclude lazy properties from the cached state).

Which is required depends on `shared-cache-mode`: under `ENABLE_SELECTIVE` you need
`@Cacheable` (or `@Cacheable(true)`) for the entity to be cached; but Hibernate's own reading
treats a bare `@Cache` as opt-in too, so `@Cache` alone often works. **Default region names**:
an entity's region defaults to its fully-qualified class name (`com.example.Product`); a
collection's region defaults to `OwnerEntity.collectionField` (e.g.
`com.example.Author.books`).

**Default concurrency strategy is provider/version dependent.** If you mark an entity
cacheable but specify neither `@Cache(usage = ...)` nor
`hibernate.cache.default_cache_concurrency_strategy`, the effective strategy is not
guaranteed across setups (Hibernate has historically defaulted to `READ_WRITE` in several
configurations). The senior recommendation is to **always be explicit** about the strategy
rather than rely on the default.

## Common Interview Follow-ups

- **"Is the first-level cache on by default? Can you disable it?"** Yes it's always on;
  no you cannot disable it — it *is* the persistence context. You can only `clear()`,
  `detach`/`evict`, or `close` the Session.
- **"Two `find` calls for the same id in one transaction — how many SELECTs?"** One. The
  second is served from L1.
- **"Same two calls in two different transactions with L2 off?"** Two SELECTs — L1 isn't
  shared. With L2 on and the entity `@Cacheable`, the second is an L2 hit (zero SELECTs).
- **"What does L2 actually store?"** Dehydrated state (disassembled column values +
  fk ids) keyed by entity id — not object instances, not proxies.
- **"Does caching an entity cache its collections?"** No. Collections need their own
  `@Cache`, and the associated entities must be cached too or you re-fetch by id.
- **"Why is the query cache often a net negative?"** It stores only ids (so you still
  need the entities cached), and any write to a referenced table invalidates all queries
  over that table, collapsing the hit rate.
- **"You added L2 but still see stale data after a bulk update. Why?"** Bulk JPQL
  `UPDATE`/`DELETE` and raw SQL bypass the L2 invalidation path; the cache keeps the old
  copy until evicted/expired. Evict explicitly (`Cache#evict`) after bulk operations.
- **"Which concurrency strategy for a read-only lookup table?"** `READ_ONLY` — cheapest,
  no locking; updates would throw.
- **"When would you pick `READ_WRITE` over `NONSTRICT_READ_WRITE`?"** When updates happen
  and you can't tolerate the brief stale-read window `NONSTRICT_READ_WRITE` allows;
  `READ_WRITE` uses soft locks for consistency at higher cost.
- **"How do you prevent OOM when persisting a million rows?"** `flush()` + `clear()` in
  batches so the L1 cache doesn't retain every entity.
- **"Explain how READ_WRITE actually keeps concurrent reads consistent."** Two-phase async
  soft lock: install a non-readable `Lock` before commit, replace it with dehydrated state
  after commit; concurrent readers miss and hit the DB in between.
- **"Why is my just-persisted entity a cache miss on the next request?"** IDENTITY generator
  entities are not put into L2 on insert (the INSERT runs immediately, outside write-behind).
  SEQUENCE/TABLE generators do cache on insert.
- **"After a rolled-back transaction, reads miss L2 for ~a minute — why?"** A stuck soft
  `Lock` under READ_WRITE that isn't replaced; it clears at the 60s
  `DEFAULT_CACHE_LOCK_TIMEOUT`.
- **"A query-cache hit still fired N SELECTs — how do you fix it without entity caching?"**
  `SHALLOW` layout stores ids only. Either L2-cache the entity, or on HB 6.5+ set
  `@QueryCacheLayout(FULL)` so the query cache stores full state.
- **"Force a refresh / bypass the cache for one operation?"** `CacheStoreMode.REFRESH` /
  `CacheRetrieveMode.BYPASS` (JPA) or `CacheMode.REFRESH` / `GET` / `IGNORE` (Hibernate), or
  `getCache().evict(...)`.
- **"How do you look up by business key using the cache?"** `@NaturalId` + `@NaturalIdCache`
  and `session.byNaturalId(...).load()`, which resolves the PK from the natural-id cache then
  loads the entity from the L2 entity cache (which must also be enabled).

## References

- Jakarta Persistence 3.1/3.2 spec — `Cacheable`, `SharedCacheMode`, `Cache` API
  (`EntityManagerFactory#getCache`).
- Hibernate ORM 6/7 User Guide — "Caching": second-level cache, `@Cache`,
  `CacheConcurrencyStrategy`, region factories (JCache/Ehcache/Infinispan), query cache,
  `@NaturalIdCache`, `CacheMode`, `CacheStoreMode`/`CacheRetrieveMode`.
- Hibernate `CacheLayout` javadoc (since 6.5) and `@QueryCacheLayout`; the
  `hibernate.cache.*` configuration reference (`use_reference_entries`,
  `auto_evict_collection_cache`, `missing_cache_strategy`, `default_cache_concurrency_strategy`).
- Vlad Mihalcea — "How does the READ_WRITE CacheConcurrencyStrategy work" (soft-lock
  two-phase protocol, IDENTITY caveat, 60s lock timeout) and "How does Hibernate store
  second-level cache entries" (`CacheKey`/`CacheEntry`/disassembled state).
- Hibernate User Guide — "Batch processing" (flush/clear idiom for L1).
- Cross-references: `messaging-databases/caching-patterns` (cache-aside, write-through,
  invalidation), `messaging-databases/redis`, `messaging-databases/indexing`,
  `hibernate-jpa/fetching-lazy-eager-n-plus-one` (N+1),
  `hibernate-jpa/entity-lifecycle-states` (identity, detach), and `spring-*` for the
  Spring transaction/Session-per-request boundary.
