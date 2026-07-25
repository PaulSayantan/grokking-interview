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
- `proxyTargetClass` — `false` (the *framework* default) uses **JDK dynamic proxies**
  when the bean implements an interface; `true` forces **CGLIB** subclass proxies.
  Note: **Spring Boot flips this to `true`**, so CGLIB is the norm in Boot apps —
  don't assume JDK proxies just because your bean has an interface (see the
  self-invocation section).
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

**Async/reactive returns (Spring 6.1+):** `@Cacheable` now natively adapts to
`CompletableFuture<T>`, `Mono<T>` and `Flux<T>` return types. The value is cached
when the future/publisher completes; a lookup returns a completed future/publisher
wrapping the cached value. For `Flux` the emitted items are collected into a `List`
and that list is cached (coarse-grained — no per-element streaming or back-pressure
awareness). This requires the cache to support `CompletableFuture`-based retrieval:
`ConcurrentMapCacheManager` adapts automatically, but `CaffeineCacheManager`
requires `setAsyncCacheMode(true)`.

**`Optional<T>` unwrapping:** when a method returns `Optional<Book>`, Spring stores
the *unwrapped* `Book` (or `null` for an empty `Optional`) and, on a hit, re-wraps
it. Crucially, `#result` in `unless`/`key` refers to the unwrapped `Book`, never the
`Optional`, so use null-safe navigation: `unless = "#result?.hardback"`.

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

**Key-alignment gotcha:** the `@CachePut` on the writer must produce *exactly* the
same key (same cache, same key expression, same argument identity/`equals`) that the
`@Cacheable` reader uses, or you silently populate a different slot and the next read
still misses. If the reader keys on `#isbn` (a `String`) but the writer keys on
`#book` (the whole entity, keyed via `SimpleKey`), they never align.

**Nuanced exception to "never combine":** Spring's own docs allow `@Cacheable` and
`@CachePut` together *only* when their `condition`s are mutually exclusive (so at
most one ever fires). Because that decision is made up-front, such conditions
**must not** reference `#result`. In practice this corner case is rarely worth the
confusion; prefer separate methods.

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

**Gotcha — no guaranteed ordering between the grouped operations.** `@Caching` does
not define the execution order of the puts vs. evicts it contains, and you should not
rely on, say, an evict running before a cacheable within the same `@Caching`. If you
need ordering guarantees (evict-then-load), split into separate proxied methods. Also,
a `@Cacheable` inside `@Caching` still short-circuits the method on a hit, meaning the
sibling `evict`/`put` operations that were supposed to run alongside it may not behave
as you expect when the read hits — another reason to prefer explicit, single-purpose
methods for anything subtle.

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

**`SimpleKey` equals/hashCode history:** for multi-argument methods the default
generator builds a `SimpleKey` whose `equals`/`hashCode` are computed over **all**
arguments. This was fixed in Spring 4.0 — the earlier `DefaultKeyGenerator` used only
`hashCode()` (not `equals`) and could therefore produce colliding keys for distinct
argument tuples (a real correctness bug, spring-framework#14870). If you supply your
own multi-field key object, it **must** implement `equals`/`hashCode` correctly, or
you get silent cross-key collisions (wrong cached value returned) — this is the single
most common home-grown-key bug.

**Worked trace — how a broken key returns the wrong value.** Suppose you write a
custom key for a rate lookup keyed on `(from, to)`, but slip up: `hashCode()` uses
both fields, `equals()` compares only `from`:

```java
record RateKey(String from, String to) {
    @Override public int hashCode() { return Objects.hash(from, to); }   // both
    @Override public boolean equals(Object o) {                          // only `from`!
        return o instanceof RateKey k && from.equals(k.from);
    }
}
```

A `HashMap`-backed cache (Caffeine/ConcurrentMap) locates an entry by `hashCode()`
to find the bucket, then walks the bucket calling `equals()` to pick the match. Now
trace two calls:

1. `findRate("USD","EUR")` → miss → stores `RateKey("USD","EUR") → 0.92`.
2. `findRate("USD","GBP")` → `hashCode()` differs from #1 (`hash("USD","GBP") ≠
   hash("USD","EUR")`), so it lands in a *different* bucket → miss → stores
   `RateKey("USD","GBP") → 0.79`. So far so good — no collision yet.

The truly dangerous bug — a *silent wrong hit* — needs both methods to ignore `to`:
`equals` **and** `hashCode` computed over only `from`. Then `("USD","EUR")` and
`("USD","GBP")` both hash to the same bucket **and** compare equal. Take that case:

1. `findRate("USD","EUR")` → stored under bucket `h = hash("USD")`, value `0.92`.
2. `findRate("USD","GBP")` → same bucket `h` (hashCode ignored `to`), map walks the
   bucket, calls `equals()` → since `equals` also ignores `to`, `("USD",_).equals(("USD",_))`
   → **true** → **hit** → returns `0.92` (EUR rate) for a GBP request. Wrong currency, no
   exception, silent corruption.

(The subtler variant — correct `equals` over both fields but `hashCode` over only `from` —
is *not* corrupting: the two keys collide into one bucket, but `equals` still distinguishes
EUR from GBP, so the GBP lookup misses and stores `0.79` correctly. You only pay a
performance cost from the over-full bucket, not a wrong answer.)

The contract you must honor: **`a.equals(b)` ⇒ `a.hashCode() == b.hashCode()`**, and
both must span *every* field that distinguishes the key. A `record` (or a `String`)
gets this right for free — which is exactly why the default `SimpleKey` and immutable
value keys are the safe choice.

**Mutable keys are a landmine.** The key object is stored by reference in most local
providers. If you use a mutable object (or an array) as the key and later mutate it,
its `hashCode`/`equals` shift and the entry becomes unreachable (or worse, collides).
Prefer immutable, value-based keys (strings, records, boxed primitives).

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

**Subtle limits of `TransactionAwareCacheManagerProxy`:**
- It only defers the *write side* (`put`/`evict`). A `@Cacheable` **lookup** still
  reads the current cache state immediately, so within the same transaction a
  read-after-write does **not** see the deferred put.
- Deferral happens on the `AFTER_COMMIT` synchronization. If there is no active
  transaction, writes pass straight through (no deferral).
- It does not make the cache transactional/rollback-safe against other threads:
  between commit and the deferred cache write there is a small window where the DB is
  updated but the cache still holds the old value.

## CacheResolver, @CacheConfig, and multiple CacheManagers

When a single `CacheManager` isn't enough, Spring layers three more concepts:

- **`cacheManager` attribute** — pick a specific `CacheManager` bean per operation:
  `@Cacheable(cacheNames="books", cacheManager="l2CacheManager")`.
- **`CacheResolver`** — the SPI that actually decides *which `Cache` instances* an
  operation targets at runtime. The default resolver just looks up `cacheNames`
  against the configured `CacheManager`, but a custom `CacheResolver` can choose
  caches based on the method arguments. Reference it with
  `@Cacheable(cacheResolver="runtimeCacheResolver")`.
- **`cacheManager` and `cacheResolver` are mutually exclusive.** Specifying both is
  an error — the `CacheResolver` owns cache selection, so a `CacheManager` would be
  ignored. (Since Spring 4.1, `cacheNames`/`value` is even optional when a resolver
  supplies the caches.)
- **`@CacheConfig`** — a class-level annotation that shares common settings
  (`cacheNames`, `keyGenerator`, `cacheManager`, `cacheResolver`) across all cache
  operations in the class, so you don't repeat them. It **does not enable caching by
  itself**, and any attribute set on the individual operation **overrides** it.

The override hierarchy (lowest → highest precedence) is: global defaults (via
`CachingConfigurer`) → class-level `@CacheConfig` → operation-level attributes.

## CacheErrorHandler & failure modes

By default, exceptions thrown by the underlying cache store (e.g. Redis is down,
a serialization error, a timeout) **propagate to the caller** — a caching problem
becomes an application error. To change this, register a `CacheErrorHandler` (via
`CachingConfigurer.errorHandler()`), whose four callbacks handle failures of `get`,
`put`, `evict`, and `clear` independently:

```java
@Configuration
@EnableCaching
public class CacheConfig implements CachingConfigurer {
    @Override
    public CacheErrorHandler errorHandler() {
        return new SimpleCacheErrorHandler() { // default: rethrows everything
            @Override public void handleCacheGetError(RuntimeException e, Cache c, Object k) {
                log.warn("cache get failed, falling back to source", e); // swallow -> treat as miss
            }
        };
    }
}
```

The built-in `SimpleCacheErrorHandler` rethrows every exception. A common resilience
pattern is a handler that logs and **swallows GET errors** (so a cache outage
degrades to a cache miss and the method runs against the source of truth) while still
being careful about PUT/EVICT errors (a swallowed evict can leave stale data).
`CachingConfigurer` is also where you override the global `keyGenerator`,
`cacheManager`, and `cacheResolver`.

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
provider's job. Caffeine notably uses **Window TinyLFU**, not plain LRU, giving
higher hit ratios by admitting entries based on frequency as well as recency.

**`@CacheEvict(allEntries=true)` cost by provider:** on `ConcurrentMap`/Caffeine it is
a cheap `Map.clear()`. On Redis with `RedisCacheManager`, clearing a cache deletes all
keys under the cache's key prefix; historically this used a `KEYS`/pattern operation
that can be expensive/blocking on large keyspaces (newer versions use a batched
`SCAN`). Frequent `allEntries=true` on a large Redis cache is a real performance
footgun. Also note Caffeine's `maximumSize` eviction is **not immediate** — it is
amortized and may briefly overshoot the configured size before catching up.

---

## Cache stampede

A **cache stampede** (a.k.a. dog-piling / thundering herd) happens when a popular
key expires (or is cold) and many concurrent requests all miss simultaneously,
each triggering the expensive backing computation at once — hammering the DB.

**Worked trace — feel the load spike.** Say the backing query takes **200 ms**, and
the hot key's entry expires at `T=0`. In the next 200 ms window, **500 requests**
arrive for that same key.

- **Without `sync`:** request #1 misses at `T=0` and starts the 200 ms query. But the
  entry isn't stored until it *finishes* at `T=200 ms`, so every request that arrives
  during `[0, 200)` also sees an empty cache and launches its own query. Result:
  **500 concurrent DB queries** — a 500× load spike on the source exactly when the hot
  key drops. The cache made the failure *worse* (synchronized expiry → synchronized
  herd).
- **With `sync = true`:** request #1 acquires the per-key compute lock and runs the
  single 200 ms query. The other **499** requests find the lock held, **block**, and
  when #1 stores the result they all read that one value. Result: **1 DB query**,
  499 threads parked for ≤200 ms. Same latency for the herd, 1/500th the DB load.

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

## Interception internals & advice ordering

Under `mode=PROXY`, `@EnableCaching` registers a
`BeanFactoryCacheOperationSourceAdvisor` whose advice is the
`CacheInterceptor` (a `MethodInterceptor` extending `CacheAspectSupport`). At
invocation time the interceptor:

1. resolves the `CacheOperation`s for the method via the `CacheOperationSource`;
2. runs any `beforeInvocation=true` evictions;
3. for `@Cacheable`, computes the key and probes the caches; on a hit it returns the
   stored value **without proceeding** to the target method;
4. on a miss (or for `@CachePut`) invokes the target, then evaluates `unless`, and
   stores the result (`@CachePut` always stores; `@Cacheable` stores on a miss);
5. runs `beforeInvocation=false` evictions.

**Worked trace — one `findBook("978-1")` method, two calls.** Cache `"books"` starts
empty; the method is `@Cacheable("books")` with default key generation (one arg → the
arg itself, so `key = "978-1"`).

- **Call 1 (miss):** step 1 resolves one `@Cacheable` operation; step 2 has no
  before-evictions; step 3 computes `key = "978-1"`, probes `books.get("978-1")` →
  `null` (miss), so it does **not** short-circuit; step 4 proceeds to the target
  method, which runs the real DB fetch (say 50 ms) returning `Book#42`, evaluates
  `unless` (default absent → store), and calls `books.put("978-1", Book#42)`. Cache
  now holds `{ "978-1" → Book#42 }`. Returned: `Book#42`.
- **Call 2 (hit):** steps 1–2 identical; step 3 computes the same `key = "978-1"`,
  probes `books.get("978-1")` → `Book#42` (**hit**) → returns it **without proceeding**
  to step 4, so the DB fetch never runs (0 ms of method body). Returned: the *same*
  cached `Book#42`.

Net: two identical calls, one DB hit. Note the returned object is the cached instance
— if a caller mutates `Book#42`, every future hit sees the mutation (local caches
store by reference), which is why cached values should be treated as immutable.

**Ordering vs. `@Transactional`:** both are AOP advisors and their relative order
matters. The cache advisor's `order` defaults to `Ordered.LOWEST_PRECEDENCE`. In the
common case you want the **transaction advice to be the outermost** (lower order
value / higher precedence) so cache operations execute *inside* the transaction —
otherwise a `@CachePut` could commit a value the DB later rolls back. When ordering
is unspecified, the AOP subsystem's default determines the sequence, which is why
`TransactionAwareCacheManagerProxy` exists as a more robust guarantee than relying on
advisor ordering.

**Empty/absent `CacheManager`:** if `@EnableCaching` is present but no `CacheManager`
bean can be found, context startup fails with a "no unique/qualifying bean of type
CacheManager" error — unlike the missing-`@EnableCaching` case, which fails silently.

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

**Break-even math — is the cache worth it?** Average latency ≈
`hitRatio × cacheLatency + (1 − hitRatio) × (cacheLatency + sourceLatency)`
(you always pay the cache lookup; on a miss you also pay the source). With a 1 ms
cache and a 50 ms source:

- **90% hits:** `0.9×1 + 0.1×(1+50) = 0.9 + 5.1 = 6.0 ms` avg vs 50 ms uncached — a
  ~8× win.
- **50% hits:** `0.5×1 + 0.5×51 = 0.5 + 25.5 = 26.0 ms` — still helps, but you've
  added a moving part for a 2× gain.
- **10% hits:** `0.1×1 + 0.9×51 = 0.1 + 45.9 = 46.0 ms` vs 50 ms — barely faster, and
  you now pay memory, invalidation complexity, and a 1 ms tax on the 90% that miss.

The lesson: the payoff scales with hit ratio, so a cache only earns its keep when a
small hot set absorbs most reads. Low hit ratios add cost and risk for almost no gain.

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

**Q: What happens if Redis is unreachable during a `@Cacheable` call?** By default
the exception propagates and the call fails. Register a `CacheErrorHandler` that
swallows GET errors to degrade gracefully to a cache miss.

**Q: Can I use different `CacheManager`s per method?** Yes — set the
`cacheManager` attribute per operation, or supply a custom `CacheResolver`
(mutually exclusive with `cacheManager`).

**Q: Are reactive return types supported?** Since Spring 6.1, `Mono`/`Flux`/
`CompletableFuture` are adapted natively, but the cache must support
`CompletableFuture` retrieval (Caffeine needs `setAsyncCacheMode(true)`).

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
