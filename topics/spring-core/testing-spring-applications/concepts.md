# Testing Spring Applications

Testing is a first-class concern in the Spring Framework. The framework ships a dedicated
`spring-test` module (part of core Spring, **not** Spring Boot) that provides the *Spring TestContext
Framework* — the machinery that loads an `ApplicationContext`, caches it, injects beans into your
test, manages transactions, activates profiles, and integrates with JUnit and TestNG.

A key mental model for interviews: Spring encourages **two complementary styles of testing**.

1. **Unit tests** — plain object tests with *no Spring container*. You instantiate the class under
   test with `new`, hand it collaborators (often mocks), and assert behaviour. These are fast and need
   nothing from `spring-test`.
2. **Integration tests** — tests that boot a real `ApplicationContext` so that dependency injection,
   AOP proxies, transactions, `@Configuration` wiring, and other container features participate. These
   use the Spring TestContext Framework.

Everything below is about the Spring Framework itself (6.x runs on **Jakarta EE / `jakarta.*`**
namespaces; Spring 5.x and earlier used `javax.*`). Where Spring Boot adds convenience on top, it is
called out explicitly and contrasted — but the framework primitives (`@ContextConfiguration`,
`TestContext`, `MockMvc`, transactional rollback) all live in core Spring.

---

## spring-test module

`spring-test` is the artifact (`org.springframework:spring-test`) that contains Spring's testing
support. It is independent of Spring Boot; you can use it in a plain Spring project. Its major pieces:

- **Spring TestContext Framework** (`org.springframework.test.context`) — the engine that manages the
  test's `ApplicationContext`, dependency injection, transactions, and profiles. It is *agnostic* to
  the test runner: it integrates with JUnit 4 (`SpringRunner`/`SpringJUnit4ClassRunner`), JUnit 5
  Jupiter (`SpringExtension`), and TestNG (`AbstractTestNGSpringContextTests`).
- **`MockMvc`** and the server-side Spring MVC Test framework
  (`org.springframework.test.web.servlet`) — drive controllers without a running servlet container.
- **Servlet API mocks** (`org.springframework.mock.web`) — `MockHttpServletRequest`,
  `MockHttpServletResponse`, `MockServletContext`, etc.
- **`MockEnvironment` / `MockPropertySource`** for testing property and profile logic.
- **`ReflectionTestUtils`** for setting private fields / invoking non-public methods in tests.
- **`TestPropertySource`**, `@DirtiesContext`, `@ActiveProfiles`, `@Sql` and other annotations.
- The **`WebTestClient`** (reactive) and client-side `RestTemplate` test support (`MockRestServiceServer`).

Typical Maven dependency (test scope):

```xml
<dependency>
  <groupId>org.springframework</groupId>
  <artifactId>spring-test</artifactId>
  <version>6.1.x</version>
  <scope>test</scope>
</dependency>
```

You also pull in a mocking library (Mockito) and an assertion/test runner (JUnit Jupiter) separately —
`spring-test` does not bundle them.

**Interview soundbite:** `spring-test` gives you the *TestContext Framework*; its job is to bootstrap
and cache an `ApplicationContext` for your tests and wire container features into the test lifecycle.

---

## ContextConfiguration and SpringJUnitConfig

An integration test needs to tell Spring **which configuration to load** into the `ApplicationContext`.
`@ContextConfiguration` is the primary annotation for that. It declares component classes
(`@Configuration` classes / `@Component`s) via `classes = ...` or XML/Groovy locations via
`locations = ...`.

```java
@ExtendWith(SpringExtension.class)                 // JUnit 5: activates TestContext Framework
@ContextConfiguration(classes = AppConfig.class)   // which config to load
class OrderServiceTests {

    @Autowired
    OrderService orderService;                     // injected from the context

    @Test
    void placesOrder() { /* ... */ }
}
```

With JUnit 5 you must register the `SpringExtension` (via `@ExtendWith(SpringExtension.class)`) so the
TestContext Framework participates. Because that pairing is so common, Spring provides a **composed
annotation** `@SpringJUnitConfig`, which is `@ExtendWith(SpringExtension.class)` **plus**
`@ContextConfiguration` in one:

```java
@SpringJUnitConfig(AppConfig.class)   // == @ExtendWith(SpringExtension.class) + @ContextConfiguration(classes = AppConfig.class)
class OrderServiceTests { ... }
```

The web variant is `@SpringJUnitWebConfig`, which additionally applies `@WebAppConfiguration` (loads a
`WebApplicationContext` with a `MockServletContext`).

| Annotation | Equivalent to | Test runner |
|---|---|---|
| `@ContextConfiguration` | (config source only) | needs `@ExtendWith(SpringExtension.class)` on JUnit 5 |
| `@SpringJUnitConfig` | `@ExtendWith(SpringExtension.class)` + `@ContextConfiguration` | JUnit 5 |
| `@SpringJUnitWebConfig` | `@ExtendWith(SpringExtension.class)` + `@ContextConfiguration` + `@WebAppConfiguration` | JUnit 5 |
| `@ContextHierarchy` | multiple `@ContextConfiguration` levels (parent/child contexts) | any |

**Config detection / nested `@Configuration`:** If you use `@ContextConfiguration` (or
`@SpringJUnitConfig`) without specifying `classes` or `locations`, Spring will look for a **static
nested `@Configuration` class** inside the test class as a default. This is a common convenience:

```java
@SpringJUnitConfig                 // no explicit classes
class PricingTests {
    @Configuration
    static class Config {          // auto-detected
        @Bean PricingService pricing() { return new PricingService(); }
    }
}
```

**`@ContextConfiguration(initializers = ...)`** lets you register
`ApplicationContextInitializer`s (useful for programmatic property setup, e.g. Testcontainers).

**JUnit 4 note:** the equivalent is `@RunWith(SpringRunner.class)` (alias for
`SpringJUnit4ClassRunner`) + `@ContextConfiguration`.

---

## Loading and caching the application context across tests

Loading an `ApplicationContext` is expensive (component scanning, bean instantiation, connection
pools, embedded DBs). The TestContext Framework's most important performance feature is that it
**caches the context and reuses it across test classes and methods** within the same JVM / test suite
run. By default a context is built **once** and shared by every test that requests an *equivalent*
configuration.

**How the cache key is computed.** The context cache is keyed by the combination of attributes that
define the context, including:

- the set of `locations` / `classes` (`@ContextConfiguration`)
- context `initializers`
- active profiles (`@ActiveProfiles`) — order-independent since Spring normalizes them
- `@TestPropertySource` locations and inlined properties
- the `ContextLoader` used
- resource-override and parent-context info (`@ContextHierarchy`)
- `@MockBean` / `@SpyBean` definitions (Boot) and `@DynamicPropertySource` participate too

If two test classes declare the **same** combination of these attributes, they **share one cached
context** — the container is not rebuilt. If any attribute differs, a *separate* context is created and
cached under a different key. This is why gratuitously varying profiles or property sources across
tests silently multiplies the number of contexts and slows the suite.

**Defaults:** the cache holds up to **32** contexts (LRU eviction), configurable via the
`spring.test.context.cache.maxSize` JVM/`SpringProperties` setting. Contexts are held statically for
the lifetime of the test JVM.

**`@DirtiesContext`** — tells the framework that a test *mutated* the context (e.g. changed a
singleton's state, or you want a fresh DB), so it should be **removed from the cache and closed** after
the test. Use it sparingly: every `@DirtiesContext` forces the next matching test to rebuild the
context, undermining the caching benefit. It can be applied at class or method level and configured
with `methodMode`/`classMode` (e.g. `BEFORE_EACH_TEST_METHOD`, `AFTER_CLASS`).

```java
@SpringJUnitConfig(AppConfig.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MutatingTests { ... }
```

**Interview soundbite:** context caching is keyed by configuration attributes; identical config =
shared context = fast suite. `@DirtiesContext` evicts and closes the context, sacrificing that reuse.

**Deeper gotchas senior interviewers probe:**

- **The cache is a static, JVM-wide, per-fork singleton.** It lives in `DefaultCacheAwareContextLoaderDelegate`'s
  static `ContextCache`. If your build forks multiple JVMs (`forkCount > 1` in Surefire/Gradle), each fork
  has its own cache and rebuilds contexts independently — parallelism can *reduce* cache hit rates and
  paradoxically slow a suite that was tuned for one JVM. Conversely, running everything in one JVM
  maximizes reuse but serializes context-mutating tests.
- **Failure to load is also cached (as of Spring 6.1).** If a context fails to load, the framework records
  the failure and will *not* retry loading the same broken context for every subsequent matching test —
  it fails fast with the cached exception, avoiding N slow failures. Before 6.1 each matching test retried
  the load.
- **`@DirtiesContext` and context hierarchies:** dirtying a *child* context with the default
  `hierarchyMode = EXHAUSTIVE` closes and evicts the entire hierarchy (parents included) because a parent
  may be shared. `hierarchyMode = CURRENT_LEVEL` limits eviction to the current level and below.
- **Mutating a shared singleton without `@DirtiesContext` is a cross-test bug**, not just a smell: because
  the same context (and thus the same singleton instances) is reused, state written by test A is visible to
  test B, producing order-dependent failures that vanish when a single test is run in isolation.
- **Statistics:** you can log `ContextCache` hit/miss/size statistics by setting the
  `org.springframework.test.context.cache` logger to `DEBUG` — the fastest way to diagnose "why do I have
  40 contexts?"

---

## TestExecutionListeners and execution order

The TestContext Framework does its real work through **`TestExecutionListener`** implementations. The
`TestContextManager` holds an ordered list of listeners and invokes their callbacks
(`beforeTestClass`, `prepareTestInstance`, `beforeTestMethod`, `beforeTestExecution`,
`afterTestExecution`, `afterTestMethod`, `afterTestClass`) at the right lifecycle points. `@Autowired`,
transactions, `@Sql`, `@DirtiesContext`, bean overrides, etc. are **not** hard-coded into the runner —
each is a listener.

The **default listeners** are discovered via `SpringFactoriesLoader` (from `spring.factories` under
`org.springframework.test.context.TestExecutionListener`) and then **sorted by
`AnnotationAwareOrderComparator`** (honoring `Ordered` / `@Order`). As of Spring Framework 6.x the
default ordered set is, roughly:

1. `ServletTestExecutionListener` (order 1000) — sets up servlet API mocks for a `WebApplicationContext`.
2. `DirtiesContextBeforeModesTestExecutionListener` — handles `@DirtiesContext` *before* modes.
3. `ApplicationEventsTestExecutionListener` — supports `@RecordApplicationEvents` / `ApplicationEvents`.
4. `BeanOverrideTestExecutionListener` — wires `@MockitoBean`/`@TestBean` overrides into the instance.
5. `DependencyInjectionTestExecutionListener` — performs `@Autowired`/`@Resource` injection into the test.
6. `MicrometerObservationRegistryTestExecutionListener` — sets up the observation registry.
7. `DirtiesContextTestExecutionListener` — handles `@DirtiesContext` *after* modes.
8. `CommonCachesTestExecutionListener` — clears certain resource caches when a context is dirtied.
9. `TransactionalTestExecutionListener` — starts/rolls back the test transaction.
10. `SqlScriptsTestExecutionListener` — runs `@Sql` scripts.
11. `EventPublishingTestExecutionListener` — publishes test-execution events to the context.
12. `MockitoResetTestExecutionListener` — resets `@MockitoBean`/`@MockitoSpyBean` mocks.

**Why order matters (a classic trap):** DI (5) runs *before* the transaction listener (9) and the SQL
listener (10). So injected fields are populated before a transaction begins; `@Sql` scripts run inside
the test's transaction only because the transactional listener has already opened it by the time the SQL
listener fires at `beforeTestMethod`... except the ordering is arranged so that when `@Sql` uses
`INFERRED` mode it detects the already-active test transaction. The reset of Mockito mocks happens
*after* the method, so stubbing leaks across methods unless reset — which is exactly why
`MockitoResetTestExecutionListener` exists.

**`@TestExecutionListeners` replaces, it does not add.** Declaring
`@TestExecutionListeners(MyListener.class)` **switches off all defaults** — a very common mistake that
silently disables `@Autowired`, `@Transactional`, and `@Sql`. To keep the defaults, use
`@TestExecutionListeners(listeners = MyListener.class, mergeMode = MergeMode.MERGE_WITH_DEFAULTS)`; the
merged set is re-sorted by order, so a custom listener implementing `Ordered` can slot itself between
built-ins. For suite-wide listeners, register them via your own `spring.factories` instead (how Spring
Security and Boot add theirs automatically).

**Interview soundbite:** every test-time feature is a `TestExecutionListener`; defaults are order-sorted
by `AnnotationAwareOrderComparator`, and a bare `@TestExecutionListeners` *replaces* the defaults unless
you set `MERGE_WITH_DEFAULTS`.

---

## Executing SQL scripts with Sql

**`@Sql`** declaratively runs SQL scripts (or literal statements) against a `DataSource` in the test
context, driven by the default **`SqlScriptsTestExecutionListener`**.

- **Default phase is `BEFORE_TEST_METHOD`.** `executionPhase = AFTER_TEST_METHOD` runs cleanup after.
  Since Spring 6.1, class-level `BEFORE_TEST_CLASS` / `AFTER_TEST_CLASS` phases exist and run once per
  class (they cannot be overridden by method-level declarations).
- **`@Sql` is repeatable**; `@SqlGroup` is the explicit container (needed mainly for non-Java JVM
  languages). Each `@Sql` can carry its own `@SqlConfig` (comment prefix, separator, error mode, encoding).
- **`@SqlConfig(transactionMode = ...)`** is the subtle part:
  - **`INFERRED`** (default): if a Spring-managed transaction is active (i.e. the test is `@Transactional`),
    the script **joins that transaction** and is rolled back with the test. If not, and a
    `PlatformTransactionManager` exists, the script runs in its own transaction; otherwise without one.
  - **`ISOLATED`**: the script always runs in its **own transaction that commits independently**, outside
    the test transaction. This is how you seed data that must be *visible to code running outside* the
    test transaction (e.g. a new thread, a `REQUIRES_NEW` service call). Because it commits, you must
    provide an `AFTER_TEST_METHOD` cleanup script — the test rollback won't undo it.
- **`@SqlMergeMode`**: by default method-level `@Sql` **overrides** class-level. `@SqlMergeMode(MERGE)`
  makes them combine (common schema at class level + per-method data).
- A `javax.sql.DataSource` must exist in the context (`transactionManager`/`dataSource` names are
  configurable via `@SqlConfig` when several are present).

```java
@SpringJUnitConfig(DataConfig.class)
@Transactional
@Sql("/schema.sql")                 // class-level: runs before each method, in the test tx (rolled back)
class UserRepoTests {
    @Test
    @Sql("/users.sql")              // method-level; with default OVERRIDE this REPLACES the class-level @Sql
    void findsUsers() { /* ... */ }
}
```

**Gotcha:** the snippet above surprises people — because default `@SqlMergeMode` is `OVERRIDE`, the
method-level `/users.sql` *replaces* the class-level `/schema.sql` for that method, so the schema is
missing. Add `@SqlMergeMode(MERGE)` to run both.

**Interview soundbite:** `@Sql` runs via `SqlScriptsTestExecutionListener`; `INFERRED` joins the test
transaction (rolled back), `ISOLATED` commits in its own transaction (needs explicit cleanup), and
method-level `@Sql` overrides class-level unless `@SqlMergeMode(MERGE)`.

---

## Bean override internals with TestBean, MockitoBean, and MockitoSpyBean

Spring Framework 6.2 moved "replace a bean in the running context" into core `spring-test` via the
`@BeanOverride` infrastructure (`BeanOverrideProcessor`, `BeanOverrideHandler`, a
`BeanFactoryPostProcessor`, a `ContextCustomizerFactory`, and `BeanOverrideTestExecutionListener`). Three
built-in annotations sit on top, each mapping to a **`BeanOverrideStrategy`**:

| Annotation | Strategy | If the target bean is missing | Backing |
|---|---|---|---|
| `@MockitoBean` | `REPLACE_OR_CREATE` | **creates** a new mock bean (unless `enforceOverride = true` → `REPLACE`, then fails) | Mockito mock |
| `@MockitoSpyBean` | `WRAP` | **fails** — requires exactly one existing candidate to wrap | Mockito spy over the real bean |
| `@TestBean` | `REPLACE_OR_CREATE` | creates from the factory method (unless `enforceOverride = true`) | static factory method |

**Selection heuristics (weaker than autowiring).** The override infrastructure does *not* run full
autowiring resolution. On a field it selects **by type**; if several beans match it falls back to the
**field name** as a qualifier (or you add `@Qualifier`), or you force **by name** via the `name`/`value`
attribute. At the **type level** you must list the target types explicitly (`@MockitoBean(types = {...})`)
and the annotations are repeatable / usable as meta-annotations.

**`@TestBean` requires a `static`, no-arg factory method** whose return type is compatible with the field,
whose **name defaults to the field name** (or the bean name) — override with `methodName`, or point to an
external `FQCN#method`. (Note the contrast: `@TestBean`'s convention is the *field name* with no suffix.)

```java
class PricingTests {
    @TestBean
    PricingService pricing;                 // by type; factory method must be named "pricing"

    static PricingService pricing() {       // static, no-arg, compatible return type
        return new FixedPricingService(BigDecimal.TEN);
    }
}
```

**Two facts interviewers love:**

1. **Bean overrides participate in the context cache key.** A `ContextCustomizer` derived from the set of
   override handlers is part of the merged context configuration, so a class with `@MockitoBean Foo` gets a
   *different* cached context from one without it — even if the rest of the config is identical. Varying
   overrides across test classes multiplies contexts.
2. **Overriding a non-singleton or a `FactoryBean` changes its nature.** A prototype/scoped target is
   replaced with a **singleton**; for `FactoryBean`, `REPLACE`/`REPLACE_OR_CREATE` replaces the factory
   itself with a singleton, while `WRAP` (spy) wraps the *object the factory produces*. You also cannot spy
   a scoped-proxy target.

**Mock reset lifecycle.** `MockitoResetTestExecutionListener` runs **after** each test method (default
`MockReset.AFTER`) so stubbing/verification state does not leak into the next method that reuses the same
cached context. This is essential precisely *because* the context (and thus the mock instances) is cached
and shared.

**Interview soundbite:** `@MockitoBean` = `REPLACE_OR_CREATE` (creates if absent), `@MockitoSpyBean` =
`WRAP` (must already exist), `@TestBean` = static no-arg factory named after the field; all three select
by type-then-name, alter the context cache key, and mocks are reset after each method.

---

## Constructor injection, TestConstructor, and Nested tests

`SpringExtension` implements JUnit Jupiter's `ParameterResolver`, so Spring can inject into **test
constructors, `@Test`/lifecycle method parameters**, not just fields. This lets you make injected
collaborators `final`.

```java
@SpringJUnitConfig(AppConfig.class)
class OrderTests {
    private final OrderService service;
    @Autowired OrderTests(OrderService service) { this.service = service; }  // constructor injection

    @Test void places(@Autowired InventoryService inv) { /* param injection */ }
}
```

**When is the whole constructor autowired?** A test constructor is treated as autowirable (Spring resolves
*all* parameters, and no other JUnit resolver may touch them) if, in precedence order: the constructor is
`@Autowired`; or `@TestConstructor(autowireMode = ALL)` is present; or the global default was switched via
the `spring.test.constructor.autowire.mode = all` property. Otherwise only parameters explicitly annotated
(`@Autowired`/`@Qualifier`/`@Value`) are resolved by Spring, leaving the rest to JUnit.

**Danger with `@TestInstance(PER_CLASS)`:** the single test instance is created once for the class. If
constructor injection captures beans and a method-level `@DirtiesContext` closes the context mid-class, the
instance now holds references to a **closed context**. Prefer field/setter injection in that combination.

**`@Nested` classes** inherit the enclosing class's Spring configuration by default
(`@NestedTestConfiguration(INHERIT)`), so an outer `@SpringJUnitConfig` applies to all nested classes and
each `@Nested` can layer its own `@ActiveProfiles` — but note each *distinct* profile set is still a
*different cached context*. Switch to `OVERRIDE` mode to stop inheriting.

**Interview soundbite:** `SpringExtension` is a `ParameterResolver`, enabling constructor/parameter
injection; full-constructor autowiring needs `@Autowired` or `@TestConstructor(ALL)`; and `@Nested`
classes inherit enclosing config by default.

---

## Context hierarchy and dynamic property sources

**`@ContextHierarchy`** builds **parent-child `ApplicationContext`s** for a single test (e.g. a root
context of shared infrastructure and a child web context). Beans in the child can see parent beans, not
vice versa. Each named level is cached independently, and a *parent* context can be **shared** across
multiple test classes while children differ — a real performance lever. Naming levels (`name = "..."`)
lets a subclass merge or override a specific level.

**`@DynamicPropertySource`** (Spring 5.2.5+) registers properties *programmatically* just before the
context loads — the canonical use is Testcontainers, where the DB URL/port is only known after the
container starts:

```java
@DynamicPropertySource
static void props(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);   // Supplier — resolved lazily
}
```

The method must be **`static`** and take a single `DynamicPropertyRegistry`; values are **`Supplier`s**
resolved lazily. These properties are added to the `Environment` with high precedence and, like
`@TestPropertySource`, they **participate in the context cache key**.

**Ordering vs `ApplicationContextInitializer`:** `@ContextConfiguration(initializers = ...)` runs an
initializer against the context *before* refresh — also a valid place to register property sources (and
what Testcontainers used before `@DynamicPropertySource`). The difference: `@DynamicPropertySource` is
declarative and its suppliers are evaluated when the property is first read, whereas an initializer runs
imperative setup code at a fixed point in the bootstrap.

**Interview soundbite:** `@ContextHierarchy` gives parent/child contexts (parents shareable across
classes); `@DynamicPropertySource` is a static method registering lazy `Supplier`-backed properties before
refresh (ideal for Testcontainers), and it affects the context cache key.

---

## MockBean and Mock and how they differ

These two annotations look similar but come from different libraries and operate at different layers.

- **`@Mock`** — from **Mockito** (`org.mockito.Mock`). It creates a *standalone* mock object. It has
  **nothing to do with the Spring container** — the mock is not registered as a bean and is not
  injected into other Spring beans. You typically enable it with `@ExtendWith(MockitoExtension.class)`
  (JUnit 5) or `MockitoAnnotations.openMocks(this)`, and inject it into the class-under-test with
  `@InjectMocks`. This is the tool for **unit tests without a Spring context**.

- **`@MockBean`** — from **Spring Boot Test**
  (`org.springframework.boot.test.mock.mockito.MockBean`). It creates a Mockito mock **and registers /
  replaces it as a bean in the `ApplicationContext`**, so any Spring bean that depends on that type
  receives the mock. It only works when a Spring context is loaded (integration/slice tests). Because
  it changes the bean definitions, a `@MockBean` **participates in the context cache key** — tests with
  different `@MockBean` sets get different cached contexts.

> Framework note: `@MockBean`/`@SpyBean` historically live in **Spring Boot**, not core `spring-test`.
> As of **Spring Framework 6.2**, core Spring introduced its own equivalents in
> `org.springframework.test.context.bean.override.mockito`: **`@MockitoBean`** and **`@MockitoSpyBean`**
> (plus the generic `@TestBean` for replacing a bean with a factory-produced instance). These bring
> "replace a bean in the context with a mock" into the framework itself; Boot's `@MockBean` is
> effectively superseded by `@MockitoBean` going forward.

```java
// Pure unit test — no Spring context. Fast.
@ExtendWith(MockitoExtension.class)
class OrderServiceUnitTest {
    @Mock InventoryClient inventory;         // Mockito mock, not a bean
    @InjectMocks OrderService service;        // constructed with the mock
    @Test void reservesStock() {
        when(inventory.reserve("A", 2)).thenReturn(true);
        assertTrue(service.place("A", 2));
    }
}

// Integration test — the mock replaces the real bean in the context.
@SpringJUnitConfig(AppConfig.class)
class OrderServiceIntegrationTest {
    @MockitoBean InventoryClient inventory;  // Spring 6.2 core; (Boot: @MockBean)
    @Autowired OrderService service;          // real bean, wired with the mocked InventoryClient
    @Test void reservesStock() {
        when(inventory.reserve("A", 2)).thenReturn(true);
        assertTrue(service.place("A", 2));
    }
}
```

| Aspect | `@Mock` (Mockito) | `@MockBean` / `@MockitoBean` |
|---|---|---|
| Origin | Mockito | Spring Boot Test / Spring 6.2 core |
| Needs Spring context? | No | Yes |
| Registered as a bean? | No | Yes — replaces matching bean |
| Injected into other beans? | No (only via `@InjectMocks`) | Yes, via DI |
| Affects context cache key? | No | Yes |
| Use case | unit test | integration / slice test |

**Interview soundbite:** `@Mock` is a bare Mockito mock for context-free unit tests; `@MockBean`
(Boot) / `@MockitoBean` (Spring 6.2) swaps a real bean out of the running `ApplicationContext` and thus
requires — and affects the caching of — a Spring context.

---

## MockMvc for web-layer tests

`MockMvc` (`org.springframework.test.web.servlet.MockMvc`) lets you exercise Spring MVC controllers by
sending simulated HTTP requests through the **`DispatcherServlet`** and the full MVC infrastructure
(handler mapping, argument resolvers, `@ControllerAdvice`, message converters, view resolution,
validation) **without starting a real servlet container or opening a socket**. It is a *server-side*
test tool: fast, in-process, and does not use real network I/O.

Two ways to build it:

1. **Standalone setup** — register specific controllers directly. No Spring context needed; you supply
   the controller instance (with hand-wired/mocked collaborators). Great for focused unit-ish tests of
   one controller.

   ```java
   MockMvc mvc = MockMvcBuilders
       .standaloneSetup(new GreetingController(mockService))
       .build();
   ```

2. **WebApplicationContext setup** — build `MockMvc` from a loaded `WebApplicationContext`, so all your
   real MVC beans, filters, and advice participate. This is the integration flavour.

   ```java
   @SpringJUnitWebConfig(WebConfig.class)   // loads a WebApplicationContext (adds @WebAppConfiguration)
   class GreetingControllerTests {
       MockMvc mvc;
       @BeforeEach void setup(WebApplicationContext wac) {
           mvc = MockMvcBuilders.webAppContextSetup(wac).build();
       }
       @Test void greets() throws Exception {
           mvc.perform(get("/greet").param("name", "Sam"))
              .andExpect(status().isOk())
              .andExpect(content().string("Hello Sam"))
              .andExpect(jsonPath("$.msg").doesNotExist());
       }
   }
   ```

The fluent API: `perform(requestBuilder)` → `ResultActions`, then `.andExpect(matcher)`,
`.andDo(print())`, `.andReturn()`. Static helpers come from `MockMvcRequestBuilders` (`get`, `post`,
...) and `MockMvcResultMatchers` (`status()`, `content()`, `jsonPath()`, `header()`, `model()`,
`view()`, `redirectedUrl()`).

**Framework vs Boot:** `MockMvc` and `@WebAppConfiguration` are **core spring-test**. Spring Boot adds
`@WebMvcTest` (a *slice* that auto-configures MockMvc and loads only the web layer) and
`@AutoConfigureMockMvc` — those are Boot conveniences layered on the same MockMvc primitive. In plain
Spring you wire MockMvc yourself as shown above.

For the **reactive** (WebFlux) stack the analogous tool is `WebTestClient`, not `MockMvc`.

**Advanced traps:**

- **`standaloneSetup` is *not* your production MVC config.** It builds a minimal, defaulted MVC setup:
  your real `WebMvcConfigurer`s, custom message converters, `@ControllerAdvice`, interceptors, and
  argument resolvers are **absent** unless you register them explicitly on the builder. Tests can pass in
  standalone that fail in `webAppContextSetup` (and in production) because, e.g., a custom exception
  handler or `Jackson` module wasn't wired. Reach for `webAppContextSetup` when fidelity matters.
- **MockMvc never opens a socket and never invokes the real servlet container**, so container-level
  concerns — real filters registered by the container, actual async dispatch, HTTP/1.1 chunking, servlet
  container error pages — are simulated, not exercised. Async controllers need `asyncDispatch(mvcResult)`
  to complete the deferred result; a naive `andExpect` on the first result sees an unfinished request.
- **Filters must be added deliberately.** Spring Security's filter chain, for instance, only participates
  if you call `.apply(springSecurity())` (Security's `MockMvc` configurer) or `.addFilters(...)`; a bare
  MockMvc bypasses security entirely, so an endpoint that is 401 in production returns 200 in the test.
- **`jsonPath` matching and content negotiation** run through the *real* `HttpMessageConverter`s in
  `webAppContextSetup`, so a missing Jackson module or wrong `Accept` header reproduces production
  serialization behavior — a strength of the full-context flavour over standalone.

**Interview soundbite:** MockMvc drives controllers through the real `DispatcherServlet` in-process
(no container, no socket); use `standaloneSetup` for isolated controller tests and `webAppContextSetup`
for full-context integration tests.

---

## Transactional test rollback

Annotating a test class or method with **`@Transactional`** (the standard
`org.springframework.transaction.annotation.Transactional`) causes the TestContext Framework's
`TransactionalTestExecutionListener` to run each test method inside a transaction that is
**rolled back by default at the end of the method**. This keeps the database clean between tests —
data written during the test is undone, so tests don't pollute each other.

Key points:

- **Default = rollback.** Test transactions roll back automatically; you do *not* need to configure
  rollback explicitly. This differs from `@Transactional` on production beans, which commit on success.
- **Force a commit** with **`@Commit`** (or the older `@Rollback(false)`) on the method/class.
  `@Rollback(true)` is the explicit default.
- The transaction is bound to the current thread, so JPA/JDBC operations in the test and in the beans
  it calls share it — enabling you to read-your-writes within the test.
- **`@BeforeTransaction` / `@AfterTransaction`** mark methods to run *outside* the test's transaction
  boundary (e.g. to set up or verify data in its own transaction).
- A **`PlatformTransactionManager`** bean must exist in the context; if there are several, name the one
  to use with `@Transactional(transactionManager = "...")`.
- **Gotcha — false confidence:** because everything runs in one rolled-back transaction, a test can
  pass even though the entities were never actually flushed/committed. Force a flush
  (`EntityManager.flush()`) or use `TestEntityManager`/`@Commit` when you need to verify real
  persistence behaviour (constraints, ID generation).
- `TestTransaction` (programmatic API) lets you `flagForCommit()`, `end()`, and `start()` a new
  transaction mid-test for advanced scenarios.
- **Propagation trap:** the test's transaction is a normal Spring transaction. A bean method annotated
  `@Transactional(propagation = REQUIRES_NEW)` suspends the test transaction and opens a *new* one that
  **commits independently** — data it writes is *not* rolled back by the test, leaking across tests. Same
  for anything spawned on another thread, since the transaction is thread-bound.
- **Lazy-loading surprise:** because the single test transaction stays open for the whole method, JPA lazy
  associations that would throw `LazyInitializationException` in production (session already closed) load
  fine inside the test — a false negative. The test can pass while production fails.
- **`@Transactional` on the test vs. `@Commit`/`@Rollback` precedence:** method-level `@Commit` or
  `@Rollback` overrides class-level defaults for that method only; a class-level `@Rollback(false)` flips
  the whole class to commit-by-default.
- **`@Sql` interaction:** with `transactionMode = INFERRED`, `@Sql` scripts join the test transaction and
  are rolled back with it; `ISOLATED` scripts commit and survive rollback (see the `@Sql` section).

```java
@SpringJUnitConfig(DataConfig.class)
@Transactional                       // each test runs in a transaction, rolled back after
class AccountRepositoryTests {
    @Autowired AccountRepository repo;

    @Test
    void savesAndReloads() {
        repo.save(new Account("sam", 100));
        assertEquals(1, repo.count());   // visible within the same tx
    }                                    // <-- rolled back here; DB untouched for next test

    @Test
    @Commit                              // this one actually commits
    void persistsForReal() { repo.save(new Account("jo", 50)); }
}
```

**Interview soundbite:** `@Transactional` on a test rolls the transaction back after each method by
default (via `TransactionalTestExecutionListener`), giving DB isolation between tests; use `@Commit` to
opt into committing.

---

## Profiles in tests with ActiveProfiles

**`@ActiveProfiles`** declares which Spring **bean-definition profiles** are active when the test's
`ApplicationContext` is loaded. Beans guarded by `@Profile("...")` are included/excluded accordingly,
and `Environment`-based property resolution honours the active set.

```java
@SpringJUnitConfig(AppConfig.class)
@ActiveProfiles({"test", "in-memory"})   // activate these profiles for this context
class RepositoryTests { ... }
```

Details worth knowing:

- Profiles are part of the **context cache key**. `@ActiveProfiles("test")` and
  `@ActiveProfiles("prod")` produce two *different* cached contexts. (Spring sorts the profile names
  when computing the key, so `{"a","b"}` and `{"b","a"}` are treated as the same context.)
- **`inheritProfiles = false`** stops a subclass from inheriting the superclass's profiles (default is
  `true`).
- For dynamic/programmatic resolution, implement **`ActiveProfilesResolver`** and reference it via
  `@ActiveProfiles(resolver = MyResolver.class)` — useful when the active profile depends on an env var.
- `@ActiveProfiles` sets **`spring.profiles.active`** for the test context; it is the test-time
  counterpart of setting that property in production.
- Combine with **`@TestPropertySource`** to also override individual properties for the test.

```java
@Configuration
class AppConfig {
    @Bean @Profile("test")     DataSource testDs()  { return new EmbeddedDatabaseBuilder()...build(); }
    @Bean @Profile("prod")     DataSource prodDs()  { return realPooledDataSource(); }
}
```

**Interview soundbite:** `@ActiveProfiles` selects the active bean profiles for the test context (test
equivalent of `spring.profiles.active`); different profile sets create different cached contexts.

---

## Unit test versus integration test

A core interview distinction. Spring supports both, and choosing the right level matters for speed and
signal.

| | Unit test | Integration test |
|---|---|---|
| Spring context loaded? | **No** | **Yes** (TestContext Framework) |
| How the SUT is built | `new` + inject mocks manually / `@InjectMocks` | container wires beans; `@Autowired` |
| Collaborators | Mockito `@Mock` stubs | real beans or `@MockitoBean`/`@MockBean` for boundaries |
| Speed | Very fast (ms) | Slower (context startup, though cached) |
| What it verifies | one class's logic in isolation | wiring, AOP, transactions, config, DB, MVC |
| Typical annotations | `@ExtendWith(MockitoExtension.class)`, `@Mock`, `@InjectMocks` | `@SpringJUnitConfig`, `@ContextConfiguration`, `@Transactional` |
| Needs `spring-test`? | No | Yes |

Rules of thumb:

- Prefer **unit tests** for business logic, algorithms, and edge cases — no reason to pay for a
  container. If a class has no framework dependency (no AOP, no injection subtleties), test it plainly.
- Use **integration tests** to verify things a unit test *cannot* see: that beans are wired correctly,
  that `@Transactional`/AOP proxies actually apply, that `@Configuration` produces the intended graph,
  that repositories map to the DB, and that MVC endpoints route/serialize correctly.
- **Do not overuse integration tests.** They are slower and more brittle; a healthy suite is a broad
  base of unit tests with a focused layer of integration tests (a "test pyramid").
- A subtle point: annotating a class with `@ExtendWith(SpringExtension.class)` /
  `@ContextConfiguration` and injecting real beans makes it an integration test even if it *feels*
  small — you are paying for a container.

**Interview soundbite:** unit tests use no Spring container (mock collaborators, `new` the SUT);
integration tests boot a cached `ApplicationContext` to exercise wiring, transactions, AOP, and I/O
that unit tests deliberately stub out.

---

## SpringBootTest as a Boot slice, contrasted

This subtopic exists to draw the boundary between **core Spring testing** and **Spring Boot testing**,
because interviewers often conflate them.

- **`@SpringBootTest`** is a **Spring Boot** annotation (`org.springframework.boot.test.context`), not
  part of core `spring-test`. It bootstraps the test context using Boot's `SpringBootTestContextBootstrapper`,
  discovers your configuration by searching upward for a `@SpringBootConfiguration`
  (typically your `@SpringBootApplication`), and applies **auto-configuration**. It can optionally
  start an embedded web server via `webEnvironment = RANDOM_PORT` / `DEFINED_PORT` for real HTTP tests
  (with `TestRestTemplate`/`WebTestClient`).
- **"Slice" tests** are Boot's *sliced* variants that load only part of the application and
  auto-configure a narrow set of beans: `@WebMvcTest` (MVC layer + MockMvc), `@DataJpaTest`
  (JPA + in-memory DB + rollback), `@JsonTest`, `@RestClientTest`, `@WebFluxTest`, etc. Each is a
  focused, faster alternative to a full `@SpringBootTest`. (Strictly, `@SpringBootTest` loads the *full*
  context and is not itself a "slice"; the slices are the narrow ones.)
- **Core-Spring equivalents:** in a non-Boot project you achieve integration testing with
  `@SpringJUnitConfig` / `@ContextConfiguration` (you name the config explicitly — there is **no
  auto-configuration or component discovery from a main class**), wire `MockMvc` by hand via
  `MockMvcBuilders`, and manage rollback with `@Transactional`. Everything `@SpringBootTest` does on top
  — auto-config, property source layering, embedded server, config discovery, slices — is *Boot* value
  added over these framework primitives.

| Concern | Core Spring (`spring-test`) | Spring Boot Test |
|---|---|---|
| Load full context | `@SpringJUnitConfig` / `@ContextConfiguration(classes=...)` | `@SpringBootTest` |
| Config discovery | explicit `classes`/`locations` (or nested `@Configuration`) | finds `@SpringBootConfiguration` automatically |
| Auto-configuration | none | yes |
| Web layer test | hand-built `MockMvc` (`webAppContextSetup`/`standaloneSetup`) | `@WebMvcTest` + injected `MockMvc` |
| Repository/DB test | `@SpringJUnitConfig` + `@Transactional` | `@DataJpaTest` |
| Mock a bean | `@MockitoBean` (6.2+) | `@MockBean` |
| Real HTTP server | not built-in | `@SpringBootTest(webEnvironment = RANDOM_PORT)` |

**Interview soundbite:** `@SpringBootTest` and the slice annotations are *Spring Boot* additions that
layer auto-configuration and config discovery over the core TestContext Framework; the framework itself
gives you `@ContextConfiguration`/`@SpringJUnitConfig`, MockMvc, and transactional rollback with no
auto-config and explicit configuration.

---

## Common follow-up questions

- Why is my test suite slow even though contexts are cached? Usually too many *distinct* context
  configurations (varying `@ActiveProfiles`, `@TestPropertySource`, `@MockBean` sets) or overuse of
  `@DirtiesContext`, each of which forces a new/rebuilt context.
- When does the cached context get closed? On JVM shutdown, on LRU eviction beyond `maxSize` (32),
  or when `@DirtiesContext` marks it dirty.
- My `@Transactional` test passes but data isn't really saved — why? The transaction rolls back and
  may never flush; force `flush()` or use `@Commit` to verify real persistence.
- `@MockBean` vs `@MockitoBean` vs `@Mock`? `@Mock` = bare Mockito (no context); `@MockBean` = Boot,
  replaces a context bean; `@MockitoBean` = the Spring Framework 6.2 core equivalent of `@MockBean`.
- Do I need `@ExtendWith(SpringExtension.class)` if I use `@SpringJUnitConfig`? No — it is already
  composed in. You'd need it explicitly only with a bare `@ContextConfiguration`.
- How do I test a WebFlux endpoint? Use `WebTestClient` (bindToController / bindToApplicationContext),
  not `MockMvc`.
- Can I run tests without any Spring annotations? Yes — that's a unit test; construct the class and
  its mocks yourself.
- JUnit 4 vs 5 integration? JUnit 4: `@RunWith(SpringRunner.class)`; JUnit 5:
  `@ExtendWith(SpringExtension.class)` (or the composed `@SpringJUnitConfig`).

## References

- Spring Framework Reference — Testing:
  https://docs.spring.io/spring-framework/reference/testing.html
- Spring TestContext Framework:
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework.html
- Context caching:
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html
- Transaction management in tests:
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/tx.html
- Spring MVC Test (MockMvc):
  https://docs.spring.io/spring-framework/reference/testing/spring-mvc-test-framework.html
- Bean overriding (`@MockitoBean`, `@TestBean`, Spring 6.2):
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/bean-overriding.html
- `@TestBean` reference:
  https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-testbean.html
- `@MockitoBean` / `@MockitoSpyBean` reference:
  https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html
- TestExecutionListener configuration and ordering:
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/tel-config.html
- Executing SQL scripts (`@Sql`):
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/executing-sql.html
- TestContext support classes, `@TestConstructor`, `@Nested`:
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/support-classes.html
- `@ActiveProfiles` / annotations:
  https://docs.spring.io/spring-framework/reference/testing/annotations.html
- Spring Boot testing (`@SpringBootTest`, slices) for contrast:
  https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html
