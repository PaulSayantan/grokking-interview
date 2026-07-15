# Caching Abstraction

Spring's caching abstraction (introduced in Spring 3.1) applies caching to Java
methods declaratively, without you having to write cache-lookup/store code by
hand. It is a **cache-through/aside abstraction**, not a cache implementation:
you annotate methods and plug in a concrete provider (Caffeine, Ehcache, Redis,
Hazelcast, or a simple `ConcurrentHashMap`) via a `CacheManager`. The core idea:
for a given method + arguments, if a value already exists in the cache, return it
without invoking the method; otherwise invoke, store the result, and return it.

The abstraction lives in `spring-context` (`org.springframework.cache`) and is
built on the same **AOP proxy** machinery as `@Transactional` and `@Async`,
which is the source of its most famous interview trap: self-invocation.

---

## @EnableCaching

Caching is **opt-in**. You must add `@EnableCaching` to a `@Configuration` class
(or rely on Spring Boot auto-configuration, which registers it when a cache
provider is on the classpath and configured). Without it, the caching
annotations are silently ignored — the methods run normally with no caching.

```java
@Configuration
@EnableCaching
public class CacheConfig {
    @Bean
    public CacheManager cacheManager() {
        return new ConcurrentMapCacheManager("books", "authors");
    }
}
```

`@EnableCaching` imports the infrastructure that registers a
`BeanPostProcessor`-driven AOP advisor (`BeanFactoryCacheOperationSourceAdvisor`)
which wraps beans containing caching annotations in a proxy. Key attributes:

- `mode` — `PROXY` (default, Spring AOP proxies) or `ASPECTJ` (compile/load-time
  weaving, which defeats the self-invocation limitation because there is no proxy).
- `proxyTargetClass` — `false` (default) uses **JDK dynamic proxies** when the
  bean implements an interface; `true` forces **CGLIB** subclass proxies.
- `order` — advisor ordering relative to other advice (e.g. `@Transactional`).

In Spring Boot, you rarely define a `CacheManager` yourself: adding
`spring-boot-starter-cache` plus a provider triggers `CacheAutoConfiguration`.
Boot still requires `@EnableCaching` to be present — the starter does not enable
it implicitly; auto-config activates the annotation processing once a provider is
resolvable and `@EnableCaching` is on a config class.

---

## @Cacheable

`@Cacheable` marks a method whose result should be cached. Before the method
executes, Spring computes a key and checks the named cache(s). On a **hit**, the
cached value is returned and **the method body is skipped entirely**. On a
**miss**, the method runs and its return value is stored under the key.

```java
@Cacheable("books")
public Book findBook(String isbn) { ... }

@Cacheable(cacheNames = "books", key = "#isbn")
public Book findBook(String isbn, boolean includeReviews) { ... }
```

Key points and gotchas:

- **`value` / `cacheNames`** name one or more caches. If listed caches don't
  exist and the `CacheManager` can't create them dynamically, you get an error
  (e.g. `ConcurrentMapCacheManager` auto-creates by default; a manager with a
  fixed set does not).
- **`null` results are cached** by default (so a miss that returns `null` won't
  be recomputed). To avoid caching nulls use `unless = "#result == null"` (or a
  provider-level null policy).
- `@Cacheable` is intended for **idempotent, read-mostly** methods. It does NOT
  update the cache if the entry already exists — that's `@CachePut`.
- **`sync = true`** serializes concurrent misses for the same key so only one
  thread computes the value (the others wait) — a built-in mitigation for cache
  stampede. Not all providers support it, and it restricts you to a single cache
  with no `unless`.

---

## @CachePut

`@CachePut` **always executes the method** and stores (updates) the result in the
cache. Unlike `@Cacheable`, it never skips the invocation — it is used to keep
the cache in sync after a write (e.g. an update method).

```java
@CachePut(cacheNames = "books", key = "#book.isbn")
public Book updateBook(Book book) {
    return repository.save(book);
}
```

Interview trap: **do not put `@Cacheable` and `@CachePut` on the same method**.
Their semantics conflict — `@Cacheable` skips execution on a hit while `@CachePut`
forces execution — leading to unpredictable behavior. If you want "run and
refresh," use `@CachePut`; if you want "skip if present," use `@Cacheable`.

A common pattern: `@Cacheable` on the read method and `@CachePut` (with the same
key expression) on the update method so reads see fresh data without an eviction.

---

## @CacheEvict

`@CacheEvict` removes entries from a cache — used on delete/update methods to
invalidate stale data.

```java
@CacheEvict(cacheNames = "books", key = "#isbn")
public void deleteBook(String isbn) { ... }

@CacheEvict(cacheNames = "books", allEntries = true)
public void reloadCatalog() { ... }
```

Attributes:

- **`allEntries = true`** clears the whole cache (ignores `key`); useful for bulk
  changes.
- **`beforeInvocation`** — default `false` means eviction happens **after** the
  method returns successfully; if the method throws, nothing is evicted. Setting
  it `true` evicts **before** the method runs, so eviction happens even if the
  method fails (useful when the method might throw but you still want the stale
  entry gone).
- `@CacheEvict` methods may return `void` (unlike `@Cacheable`/`@CachePut`, whose
  return value is the cached value).

---

## @Caching

`@Caching` groups multiple caching annotations of the same or different types on
one method, for cases the single annotations can't express — e.g. multiple evicts
with different keys, or a cacheable + evict combination.

```java
@Caching(
    cacheable = { @Cacheable("books"), @Cacheable("recent") },
    evict     = { @CacheEvict(cacheNames = "outOfStock", key = "#isbn") }
)
public Book findAndTrack(String isbn) { ... }

@Caching(evict = {
    @CacheEvict(cacheNames = "byId",   key = "#book.id"),
    @CacheEvict(cacheNames = "byIsbn", key = "#book.isbn")
})
public void deleteBook(Book book) { ... }
```

Use it when you need several evictions/puts with distinct keys — Java (pre-repeatable
annotations in this API) does not otherwise allow two `@CacheEvict` on one method.

---

## Key generation & SpEL keys

Each cache entry needs a key. If you don't specify `key`, Spring uses a
**`KeyGenerator`**. The default is `SimpleKeyGenerator`:

- **no params** → `SimpleKey.EMPTY`
- **one param** → that param instance itself is the key
- **multiple params** → a `SimpleKey` wrapping all params (equals/hashCode over all).

You can override the key with a **SpEL** expression via `key`:

```java
@Cacheable(cacheNames = "books", key = "#isbn")
@Cacheable(cacheNames = "books", key = "#book.isbn")
@Cacheable(cacheNames = "books", key = "#root.methodName + '_' + #isbn")
@Cacheable(cacheNames = "books", key = "T(java.util.Objects).hash(#a, #b)")
```

SpEL metadata available in caching expressions:

| Expression | Meaning |
|---|---|
| `#paramName` / `#p0`, `#a0` | method arguments by name or index |
| `#root.methodName` | the invoked method's name |
| `#root.method` | the `Method` object |
| `#root.target` | the target object |
| `#root.targetClass` | the target class |
| `#root.args` | array of arguments |
| `#root.caches` | list of caches for this operation |
| `#result` | the return value (only in `unless`, `@CachePut`, and `key` of `@CacheEvict` with `beforeInvocation=false`) |

`#result` is **not** available in `@Cacheable`'s `key` (the key is needed *before*
the method runs). To use a custom key generator instead of `key`, set
`keyGenerator = "myKeyGen"` — but `key` and `keyGenerator` are mutually exclusive.

Gotcha: relying on parameter names (`#isbn`) requires the `-parameters` compiler
flag (default in Spring Boot's Maven/Gradle plugins) or you must use `#p0`/`#a0`.

---

## condition and unless

Both are SpEL predicates that gate caching, but at different times:

- **`condition`** is evaluated **before** the method runs. If it is `false`,
  caching is skipped entirely (method runs, result not stored/looked up).
  `#result` is NOT available here.
- **`unless`** ("veto") is evaluated **after** the method runs. If it is `true`,
  the result is NOT stored. `#result` IS available here.

```java
@Cacheable(cacheNames = "books",
           condition = "#isbn.length() > 5",
           unless    = "#result == null || #result.outOfPrint")
public Book findBook(String isbn) { ... }
```

Mental model: `condition` = "should we even try to cache/lookup?"; `unless` =
"having computed the result, should we refuse to store it?". `unless` is the
idiomatic way to avoid caching `null` or empty results. Note that `unless` only
vetoes *storing* a value — it does **not** suppress returning an already-cached
value on a hit. For `@Cacheable`, `condition` also governs the lookup: if
`condition` is `false` there is no cache lookup at all (the method just runs and
nothing is stored).

---

## CacheManager abstraction

`CacheManager` is the central SPI: it is a factory/registry of named `Cache`
instances. `Cache` in turn is a thin wrapper (`get`, `put`, `evict`, `clear`,
`putIfAbsent`, and a `get(key, valueLoader)` used by `sync`).

```java
public interface CacheManager {
    Cache getCache(String name);
    Collection<String> getCacheNames();
}
```

Because everything goes through these two interfaces, you can swap providers
without touching business code. Notable implementations:

| CacheManager | Backing store |
|---|---|
| `ConcurrentMapCacheManager` | in-heap `ConcurrentHashMap` (default fallback) |
| `CaffeineCacheManager` | Caffeine caches (size/TTL policies) |
| `JCacheCacheManager` | JSR-107 (JCache) — Ehcache 3, Hazelcast, etc. |
| `EhCacheCacheManager` | Ehcache 2.x (legacy) |
| `RedisCacheManager` | Redis (distributed, from spring-data-redis) |
| `HazelcastCacheManager` | Hazelcast (from Hazelcast Spring integration) |
| `CompositeCacheManager` | delegates to a list of managers in order |
| `TransactionAwareCacheManagerProxy` | defers cache writes to transaction commit |
| `NoOpCacheManager` | does nothing (disables caching, e.g. in tests) |

`TransactionAwareCacheManagerProxy` is a useful advanced tool: it delays `put`/
`evict` until the surrounding transaction commits, so a rolled-back transaction
doesn't leave the cache holding data that was never persisted.

---

## Cache providers

Spring Boot auto-detects a provider. The order of consideration (when
`spring.cache.type` is not set) is roughly: Generic → JCache (JSR-107) → Hazelcast
→ Infinispan → Couchbase → Redis → Caffeine → Cache2k → Simple. You can force one
with `spring.cache.type=redis` (or `none` to disable). (Spring Boot 3 removed the
legacy EhCache 2 auto-configuration; Ehcache 3 is used through the JCache API.)

- **Simple / `ConcurrentMap`** — the default fallback when nothing else is
  configured. In-heap, unbounded, no TTL, no eviction, not distributed. Fine for
  tests and tiny lookups; dangerous for large/growing data (memory leak / OOM).
- **Caffeine** — the recommended high-performance **in-JVM** cache (successor to
  Guava cache). Supports max size, TTL (`expireAfterWrite`/`expireAfterAccess`),
  weak/soft references, and stats. Configure via `spring.cache.caffeine.spec` or a
  `Caffeine` bean. Not distributed.
- **Ehcache** — Ehcache 3 is used via the JSR-107/JCache API. Supports heap +
  off-heap + disk tiers and TTLs. Ehcache 2.x uses the legacy
  `EhCacheCacheManager`.
- **Redis** — a **distributed/remote** cache shared across instances. Values are
  serialized (default JDK serialization; often switched to JSON). Supports
  per-cache TTL via `RedisCacheConfiguration`. Adds network latency and
  serialization cost but survives app restarts and scales horizontally.
- **Hazelcast** — distributed in-memory data grid; can also be embedded.

Choosing: local caches (Caffeine) are fastest and simplest but each node has its
own copy (coherence problems on writes across nodes). Distributed caches (Redis,
Hazelcast) give a single shared view at the cost of network I/O and serialization.

---

## Cache eviction & TTL

The Spring abstraction itself has **no notion of TTL, max-size, or eviction
policy** — those are provider concerns configured on the provider, not via the
Spring annotations. `@CacheEvict` gives you *manual/event-driven* invalidation;
time- and size-based expiry come from the provider.

- **Caffeine**: `Caffeine.newBuilder().maximumSize(10_000).expireAfterWrite(10, MINUTES)`
  or `spring.cache.caffeine.spec=maximumSize=500,expireAfterAccess=600s`.
- **Redis**: `RedisCacheConfiguration.defaultCacheConfig().entryTtl(Duration.ofMinutes(10))`,
  or `spring.cache.redis.time-to-live=600000`.
- **Ehcache**: `time-to-live-seconds` / `time-to-idle-seconds` in `ehcache.xml`.
- **ConcurrentMap / Simple**: none — entries live until explicitly evicted; this
  is why it's unsuitable for large or unbounded key spaces.

`expireAfterWrite` (TTL from creation) vs `expireAfterAccess` (TTL from last read)
is a frequent distinction. Eviction *policies* (LRU/LFU/size-based) are the
provider's job.

---

## Cache stampede

A **cache stampede** (a.k.a. dog-piling / thundering herd) happens when a popular
key expires (or is cold) and many concurrent requests all miss simultaneously,
each triggering the expensive backing computation at once — hammering the DB.

Mitigations:

- **`@Cacheable(sync = true)`** — Spring serializes concurrent misses for the
  **same key** so only one thread computes; others block and reuse the result.
  This is the built-in Spring answer. Caveats: supported only by some providers,
  limited to a single cache, and incompatible with `unless`. It only coordinates
  within one JVM unless the provider itself is distributed-lock aware.
- **Provider-level refresh-ahead** — Caffeine's `refreshAfterWrite` reloads a key
  asynchronously while still serving the stale value, avoiding a hard miss.
- **Randomized/jittered TTLs** to avoid many keys expiring at the same instant.
- **Distributed locks / request coalescing** (e.g. Redis lock) for cross-node
  coordination.
- **Pre-warming** the cache on startup for known-hot keys.

---

## Proxy self-invocation caveat

This is the flagship trap and it is **identical to `@Transactional` and
`@Async`**. Spring's caching (in default `PROXY` mode) works by wrapping the bean
in an AOP proxy. Caching advice only runs when the call comes **through the
proxy** — i.e. an external caller invoking a public method on the injected bean.

When a method calls **another method on the same instance via `this`**, the call
bypasses the proxy, so caching annotations on the internal method are **ignored**:

```java
@Service
public class BookService {

    @Cacheable("books")
    public Book findBook(String isbn) { ... }

    public Book findAndFormat(String isbn) {
        // self-invocation via `this` -> NO caching applied to findBook!
        return format(findBook(isbn));
    }
}
```

Additional consequences of the proxy model:

- Annotations on **`private`, `final`, or `static`** methods are ignored — a JDK
  proxy can only advise interface methods; CGLIB cannot subclass/override `final`
  or `private` methods.
- **JDK dynamic proxy vs CGLIB**: if the bean implements an interface and
  `proxyTargetClass=false`, Spring creates a JDK proxy (only interface methods are
  advised); otherwise CGLIB subclass proxy. Spring Boot defaults
  `proxyTargetClass` to `true`.

Fixes for self-invocation: (1) move the cached method to a **separate bean**;
(2) **self-inject** the proxy (`@Autowired BookService self;` then `self.findBook`)
or use `AopContext.currentProxy()` with `exposeProxy=true`; (3) switch to
**AspectJ weaving** (`mode = AdviceMode.ASPECTJ`), which weaves the aspect into
the bytecode so `this`-calls are also advised.

---

## When caching helps vs hurts

Caching is not free. It helps when reads dominate writes and recomputation is
expensive; it hurts (or is outright wrong) otherwise.

**Good fits:**
- Read-heavy, **idempotent** lookups (reference data, config, catalog).
- Expensive-to-produce, **rarely-changing** results (heavy queries, remote calls).
- High key-hit ratio (small hot set relative to total keys).

**Poor fits / hazards:**
- **Write-heavy or rapidly-changing** data → constant invalidation, low hit rate,
  stale reads.
- **Unbounded key space** with no eviction/TTL (esp. `ConcurrentMap`) → memory
  leak / OOM.
- **Non-idempotent** methods or those with side effects (caching skips execution,
  so side effects don't happen on a hit).
- **Cache coherence** across nodes with a local cache — each JVM has its own copy,
  so a write on node A leaves node B stale (use a distributed cache or eviction
  broadcasting).
- **Low hit ratio** → you pay lookup + store cost for little benefit.
- **Correctness-critical fresh data** (e.g. account balance) where staleness is
  unacceptable without careful eviction/TTL.

Rule of thumb: cache the *result* of pure, expensive, read-mostly computations;
pair `@Cacheable` reads with `@CachePut`/`@CacheEvict` on the writes that change
them; and always bound the cache with a size limit and/or TTL.

---

## Common follow-up questions

**Q: Does `@EnableCaching` need to be present if I use Spring Boot's cache
starter?** Yes. The starter and auto-config wire a `CacheManager`, but annotation
processing is only activated by `@EnableCaching` on a configuration class.

**Q: Why is my `@Cacheable` method still executing every time?** Common causes:
missing `@EnableCaching`; self-invocation (called via `this` from the same bean);
the method is `private`/`final`; you called it on `new`-ed instance not the Spring
bean; or `condition` is evaluating false.

**Q: `@Cacheable` vs `@CachePut`?** `@Cacheable` skips the method on a hit;
`@CachePut` always runs the method and refreshes the cache. Never combine them on
one method.

**Q: Where is `#result` available?** In `unless`, in `@CachePut` key/condition,
and in `@CacheEvict` key when `beforeInvocation=false` — never in `@Cacheable`'s
`key` or `condition`.

**Q: Does the abstraction give me TTL?** No — TTL/size/eviction policy are
provider-specific configuration. Spring only gives you explicit `@CacheEvict`.

**Q: How do I prevent caching nulls?** `unless = "#result == null"` (or a provider
null policy). By default nulls ARE cached.

**Q: How do I disable caching in tests?** Set `spring.cache.type=none` (uses
`NoOpCacheManager`).

**Q: How do I avoid a stampede on a hot key?** `@Cacheable(sync = true)` for
single-JVM coordination; Caffeine `refreshAfterWrite`; jittered TTLs; distributed
locks for multi-node.

**Q: Local vs distributed cache?** Local (Caffeine) = fastest, per-node copy,
coherence issues on writes. Distributed (Redis/Hazelcast) = shared view, network +
serialization cost, survives restarts.

---

## References

- Spring Framework Reference — Cache Abstraction:
  https://docs.spring.io/spring-framework/reference/integration/cache.html
- `@EnableCaching` / `@Cacheable` / `@CachePut` / `@CacheEvict` / `@Caching` Javadoc:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/cache/annotation/package-summary.html
- Spring Boot Reference — Caching:
  https://docs.spring.io/spring-boot/reference/io/caching.html
- Baeldung — A Guide To Caching in Spring:
  https://www.baeldung.com/spring-cache-tutorial
- Baeldung — Spring Boot Cache Providers:
  https://www.baeldung.com/spring-boot-caching
- Caffeine wiki: https://github.com/ben-manes/caffeine/wiki
