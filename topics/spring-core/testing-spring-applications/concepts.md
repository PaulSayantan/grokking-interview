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

- **Why is my test suite slow even though contexts are cached?** Usually too many *distinct* context
  configurations (varying `@ActiveProfiles`, `@TestPropertySource`, `@MockBean` sets) or overuse of
  `@DirtiesContext`, each of which forces a new/rebuilt context.
- **When does the cached context get closed?** On JVM shutdown, on LRU eviction beyond `maxSize` (32),
  or when `@DirtiesContext` marks it dirty.
- **My `@Transactional` test passes but data isn't really saved — why?** The transaction rolls back and
  may never flush; force `flush()` or use `@Commit` to verify real persistence.
- **`@MockBean` vs `@MockitoBean` vs `@Mock`?** `@Mock` = bare Mockito (no context); `@MockBean` = Boot,
  replaces a context bean; `@MockitoBean` = the Spring Framework 6.2 core equivalent of `@MockBean`.
- **Do I need `@ExtendWith(SpringExtension.class)` if I use `@SpringJUnitConfig`?** No — it is already
  composed in. You'd need it explicitly only with a bare `@ContextConfiguration`.
- **How do I test a WebFlux endpoint?** Use `WebTestClient` (bindToController / bindToApplicationContext),
  not `MockMvc`.
- **Can I run tests without any Spring annotations?** Yes — that's a unit test; construct the class and
  its mocks yourself.
- **JUnit 4 vs 5 integration?** JUnit 4: `@RunWith(SpringRunner.class)`; JUnit 5:
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
  https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-testbeans.html
- `@ActiveProfiles` / annotations:
  https://docs.spring.io/spring-framework/reference/testing/annotations.html
- Spring Boot testing (`@SpringBootTest`, slices) for contrast:
  https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html
