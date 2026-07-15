# Testing Spring Boot Applications

Spring Boot ships a rich testing story built on **JUnit 5 (Jupiter)**, **Mockito**,
**AssertJ**, **Hamcrest**, **JSONassert**, and **JsonPath** — all bundled in the
`spring-boot-starter-test` dependency. The core ideas an interviewer probes are:
(1) the **test pyramid** — write many fast unit tests, fewer slice tests, and a
handful of full integration tests; (2) **`@SpringBootTest`** for full-context
integration tests vs **slice tests** (`@WebMvcTest`, `@DataJpaTest`, `@JsonTest`,
`@RestClientTest`) that load only part of the context; (3) how to replace
collaborators with **mocks** (`@MockBean`/`@MockitoBean` vs plain Mockito
`@Mock`); and (4) **context caching** so the pyramid stays fast.

This guide targets **Spring Boot 3.x** (Jakarta EE — `jakarta.*` packages,
JUnit 5, Spring Framework 6). Version-specific deprecations (e.g. `@MockBean`
being replaced by `@MockitoBean`) are called out where they matter.

---

## Test pyramid in Spring Boot

The **test pyramid** is a heuristic for how to distribute tests by cost and
scope:

| Layer | Scope | Speed | Count | Boot tools |
|---|---|---|---|---|
| **Unit** | One class, collaborators mocked; no Spring context | microseconds–ms | many (base) | JUnit 5 + Mockito, no Spring at all |
| **Slice / integration slice** | One "slice" of the app (web layer, JPA layer, JSON) with a *partial* Spring context | tens–hundreds of ms | fewer | `@WebMvcTest`, `@DataJpaTest`, `@JsonTest`, `@RestClientTest` |
| **End-to-end / full integration** | Whole application context, possibly a running server + real DB | seconds | fewest (top) | `@SpringBootTest`, Testcontainers |

**Why it matters:** loading a Spring context is expensive. If every test used
`@SpringBootTest` with a running server, the suite would be slow and brittle.
The pyramid says: keep pure logic in POJOs that you test *without* Spring, use
slices for wiring you can't easily fake, and reserve full-context/e2e tests for
critical happy-path flows.

**Advanced:** a common anti-pattern is the "test ice-cream cone" (mostly slow
e2e tests, few unit tests). Another is over-mocking unit tests until they assert
implementation details rather than behavior. Slice tests hit the sweet spot for
Spring apps because most bugs live at the wiring boundaries (serialization,
request mapping, query mapping).

---

## @SpringBootTest and webEnvironment options

`@SpringBootTest` bootstraps the **entire ApplicationContext** — it searches
upward from the test package for a `@SpringBootConfiguration` (usually your
`@SpringBootApplication` class) and loads *all* auto-configuration and beans.
Use it for integration tests that need many real collaborators wired together.

The `webEnvironment` attribute controls whether/how a web server starts:

| `webEnvironment` | Server | Typical client | Notes |
|---|---|---|---|
| `MOCK` (**default**) | No real server; **mock servlet environment** | `MockMvc` (auto-configured via `@AutoConfigureMockMvc`) | Fast; still loads web layer |
| `RANDOM_PORT` | **Real** embedded server on a random free port | `TestRestTemplate` / `WebTestClient` | Injectable `@LocalServerPort` |
| `DEFINED_PORT` | Real server on the configured port (e.g. 8080) | `TestRestTemplate` | Risk of port clashes; not for CI parallelism |
| `NONE` | No web environment at all | — | For non-web integration tests |

```java
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class OrderApiIT {
    @LocalServerPort int port;
    @Autowired TestRestTemplate rest;

    @Test
    void createsOrder() {
        var resp = rest.postForEntity("/orders", new OrderRequest("book", 2), OrderResponse.class);
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }
}
```

**Gotchas:**
- With the default `MOCK` environment, `MockMvc` does **not** go over HTTP —
  there is no real socket, so `TestRestTemplate` won't work unless you switch to
  `RANDOM_PORT`/`DEFINED_PORT`.
- `@SpringBootTest` properties can be set via `properties = {...}` or
  `@TestPropertySource`. Use `@ActiveProfiles("test")` to select a profile.
- Because it loads the full context, it's the slowest option — don't reach for
  it when a slice test would do.

---

## @WebMvcTest (web slice)

`@WebMvcTest` loads **only the web layer**: `@Controller`/`@RestController`,
`@ControllerAdvice`, `@JsonComponent`, `Converter`/`Filter`,
`HandlerInterceptor`, `WebMvcConfigurer`, and Jackson `ObjectMapper` — but
**not** `@Service`, `@Repository`, or `@Component` beans. It auto-configures
**`MockMvc`** so you can exercise controllers without a running server.

```java
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean OrderService orderService;   // @MockBean before Boot 3.4

    @Test
    void returns404WhenMissing() throws Exception {
        given(orderService.find(9L)).willThrow(new NotFoundException());
        mvc.perform(get("/orders/9"))
           .andExpect(status().isNotFound());
    }
}
```

**Key points:**
- You typically name the controller under test: `@WebMvcTest(OrderController.class)`
  narrows the slice to a single controller (faster, less noise). With no argument
  it registers *all* controllers.
- Collaborators (services) are **not** in the context — you must provide them as
  mocks (`@MockitoBean`/`@MockBean`), or the context fails to start with a
  "no qualifying bean" / unsatisfied dependency error.
- By default Spring Security auto-config **is** applied, so secured endpoints
  return 401/403 unless you add `@WithMockUser` or configure security. This
  surprises people who expected an open endpoint.
- For WebFlux controllers use **`@WebFluxTest`** (auto-configures `WebTestClient`).

---

## @DataJpaTest (persistence slice)

`@DataJpaTest` loads **only JPA components**: `@Entity` classes, Spring Data JPA
repositories, `EntityManager`/`TestEntityManager`, and a `DataSource`. It does
**not** load `@Service`/`@Component`/`@RestController` beans.

**Defaults an interviewer expects you to know:**
1. **In-memory embedded DB** — by default it replaces any configured `DataSource`
   with an embedded one (H2/HSQL/Derby) if present on the classpath. Disable with
   `@AutoConfigureTestDatabase(replace = Replace.NONE)` to test against the real
   configured DB (e.g. via Testcontainers).
2. **Transactional + rollback** — each test method runs inside a transaction that
   is **rolled back** at the end, so tests don't pollute each other. (This is the
   default `@Transactional` test behavior, not a commit.)
3. **SQL logging** — Hibernate SQL is logged; property `show-sql` is on.

```java
@DataJpaTest
class UserRepositoryTest {
    @Autowired TestEntityManager em;
    @Autowired UserRepository repo;

    @Test
    void findsByEmail() {
        em.persistAndFlush(new User("a@x.com"));
        assertThat(repo.findByEmail("a@x.com")).isPresent();
    }
}
```

**Gotchas:**
- Because the test transaction wraps the method, entities you `persist` may not
  be flushed to the DB until you call `flush()` — use `TestEntityManager.persistAndFlush`
  or `flush()` to force SQL and surface constraint violations.
- The default rollback can *hide* problems that only appear on commit
  (e.g. deferred constraints, flush-on-commit). Use `@Rollback(false)` /
  `@Commit` when you need to test commit-time behavior.
- Testing against H2 while production uses Postgres can hide dialect-specific
  bugs — hence Testcontainers with `replace = Replace.NONE`.

---

## @JsonTest and @RestClientTest (other slices)

**`@JsonTest`** tests JSON serialization/deserialization in isolation. It
auto-configures Jackson (`ObjectMapper`)/Gson/Jsonb plus helpers `JacksonTester`,
`GsonTester`, and integrates AssertJ + JSONassert + JsonPath.

```java
@JsonTest
class OrderJsonTest {
    @Autowired JacksonTester<Order> json;

    @Test
    void serializes() throws Exception {
        assertThat(json.write(new Order(1L, "book")))
            .hasJsonPathNumberValue("@.id")
            .extractingJsonPathStringValue("@.name").isEqualTo("book");
    }
}
```

**`@RestClientTest`** tests beans that **call** REST services via `RestTemplate`
(from a `RestTemplateBuilder`), `RestClient`, or `WebClient`. It auto-configures
a **`MockRestServiceServer`** so you stub the remote HTTP responses without a real
server.

```java
@RestClientTest(WeatherClient.class)
class WeatherClientTest {
    @Autowired WeatherClient client;
    @Autowired MockRestServiceServer server;

    @Test
    void parsesTemp() {
        server.expect(requestTo("/temp")).andRespond(withSuccess("{\"c\":21}", APPLICATION_JSON));
        assertThat(client.currentC()).isEqualTo(21);
    }
}
```

**Why they matter:** these narrow slices are extremely fast and pinpoint failures
to a single concern (JSON shape / outbound HTTP contract) without loading the
whole app.

---

## Slice tests and context caching

Every slice annotation is a composed meta-annotation combining `@BootstrapWith`,
a set of `@AutoConfigure...` annotations, `@TypeExcludeFilters` (to exclude beans
outside the slice), and (for `@DataJpaTest`) `@Transactional`. This gives a
**minimal, focused context** per test.

**Context caching:** the Spring TestContext framework **caches ApplicationContexts**
keyed by configuration (context classes, active profiles, properties, web env,
mock bean definitions, etc.). If two test classes request an *identical*
configuration, the **same cached context is reused** — this is the single biggest
factor in suite speed. The default cache size is **32** contexts (LRU eviction,
property `spring.test.context.cache.maxSize`).

**What busts the cache (creates a new context):**
- Different `@ActiveProfiles`, `@TestPropertySource`/`properties`, or
  `webEnvironment`.
- `@MockitoBean`/`@MockBean`/`@SpyBean` — a context containing mock definitions
  is a distinct cache key (and mocks are **reset around each test method** via
  Spring Boot's `ResetMocksTestExecutionListener` — the core-framework
  `@MockitoBean` support uses `MockitoResetTestExecutionListener`).
- `@DirtiesContext` — explicitly marks the context dirty so it is **closed and
  removed** from the cache (use sparingly; it forces expensive rebuilds).

**Interview trap:** mutating a shared bean's state in a test can leak into later
tests that reuse the cached context. Either avoid stateful singletons in tests,
use `@DirtiesContext`, or reset state in `@AfterEach`.

---

## @MockBean / @MockitoBean vs Mockito @Mock

This is a heavily-tested distinction.

| | `@Mock` (Mockito) | `@MockBean` / `@MockitoBean` (Spring Boot) |
|---|---|---|
| Provider | Plain Mockito | Spring Boot test support |
| Needs Spring context? | **No** | **Yes** — only works in a `@SpringBootTest`/slice context |
| Effect | Creates a mock object (init via `@ExtendWith(MockitoExtension.class)` or `openMocks`) | Creates a mock **and registers/replaces it as a bean** in the ApplicationContext |
| Injection | You wire it manually or with `@InjectMocks` | Autowired everywhere that bean type is injected |
| Context cache | N/A | Marks the context as unique; mock reset after each test |

- **`@Mock`** is for pure unit tests — no Spring involved. Combine with
  `@InjectMocks` to build the class under test:
  ```java
  @ExtendWith(MockitoExtension.class)
  class OrderServiceTest {
      @Mock OrderRepository repo;
      @InjectMocks OrderService service;   // constructor-injected with the mock
  }
  ```
- **`@MockBean`** (Spring Boot) replaces the real bean in the container so *other*
  Spring-managed beans receive the mock. Use it in slice/integration tests when a
  real collaborator (DB client, external service) shouldn't run.
- **Deprecation note (Spring Boot 3.4 / Spring Framework 6.2):** `@MockBean` and
  `@SpyBean` are **deprecated** in favor of the core-framework annotations
  **`@MockitoBean`** and **`@MockitoSpyBean`** (`org.springframework.test.context.bean.override.mockito`).
  Same idea, new home; expect either in interview answers.

**`@SpyBean` / `@MockitoSpyBean`:** wraps the **real** bean in a Mockito spy — real
methods run unless you stub them (`doReturn(...).when(spy).method()`). Use when you
want mostly-real behavior but need to verify or override one method. Note the
proxy caveat: spies wrap the bean instance, so `@Transactional`/AOP proxying may
interact subtly with the spy.

**Trap — `@Mock` in a `@SpringBootTest`:** annotating a field with `@Mock` in a
Spring test does **not** put it in the context; the real bean is still autowired
and your "mock" is ignored. You almost always want `@MockBean`/`@MockitoBean`
there.

---

## MockMvc vs TestRestTemplate vs WebTestClient

Three ways to invoke controllers in tests:

| Tool | Real HTTP? | Server needed | Typical use |
|---|---|---|---|
| **`MockMvc`** | **No** — calls the `DispatcherServlet` directly in-process | No | `@WebMvcTest` or `@SpringBootTest(MOCK)`; fast controller tests |
| **`TestRestTemplate`** | **Yes** — real HTTP over a socket | Yes (`RANDOM_PORT`/`DEFINED_PORT`) | Full-stack integration tests, MVC apps |
| **`WebTestClient`** | Yes (or bound directly to app) | Optional | Reactive (WebFlux) tests; also binds to MockMvc/context |

**`MockMvc`** exercises the entire Spring MVC machinery (handler mapping, argument
resolvers, message converters, `@ControllerAdvice`, filters) **without** a network
socket — so it's fast and deterministic, but it doesn't test the actual embedded
server, connectors, or real serialization over the wire.

```java
mvc.perform(post("/orders").contentType(APPLICATION_JSON).content("{\"name\":\"book\"}"))
   .andExpect(status().isCreated())
   .andExpect(jsonPath("$.id").exists());
```

**`TestRestTemplate`** is a fault-tolerant `RestTemplate` (doesn't throw on 4xx/5xx;
returns the `ResponseEntity`) tailored for integration tests. It requires a real
running server (`RANDOM_PORT`).

**`WebTestClient`** is the reactive, fluent client; it can bind to a real server,
to a `WebFlux` application context, or even to a `MockMvc`/controller directly. It's
the idiomatic choice for WebFlux and increasingly for MVC too.

**Trap:** using `TestRestTemplate` with the default `MOCK` web environment fails
because there is no listening port — switch to `RANDOM_PORT`.

---

## @TestConfiguration and test-specific beans

`@TestConfiguration` defines beans **only for tests**. Unlike a nested
`@Configuration` class, a `@TestConfiguration`:
- is **excluded** from component scanning of the main application (it won't be
  picked up accidentally by `@SpringBootTest`'s scan), and
- is applied **in addition to** the app's primary configuration when you either
  declare it as a **static nested class** of the test (auto-detected) or import it
  explicitly with `@Import(MyTestConfig.class)`.

```java
@SpringBootTest
@Import(OrderServiceTest.StubClock.class)
class OrderServiceTest {
    @TestConfiguration
    static class StubClock {
        @Bean Clock clock() { return Clock.fixed(Instant.EPOCH, ZoneOffset.UTC); }
    }
}
```

Use it to override a bean with a test double, provide a fixed `Clock`, or add
test-only infrastructure. Combine with `@Primary` or bean-name matching to
override an existing bean. (Overriding requires `spring.main.allow-bean-definition-overriding=true`
in some setups, or use `@MockitoBean` which is designed to replace.)

**Contrast with `@Configuration`:** a plain `@Configuration` placed in the test
source tree *can* be component-scanned and leak into production-style contexts;
`@TestConfiguration` is explicitly scoped to opt-in test usage.

---

## Testcontainers for real integration

**Testcontainers** runs real dependencies (Postgres, MySQL, Kafka, Redis,
LocalStack, etc.) in **Docker containers** during tests, giving production-like
fidelity that in-memory H2 can't (dialect, JSON columns, sequences, locking).

Two integration styles in Spring Boot 3.1+:

1. **JUnit 5 + `@DynamicPropertySource`** (classic):
   ```java
   @SpringBootTest
   @Testcontainers
   class OrderIT {
       @Container
       static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16");

       @DynamicPropertySource
       static void props(DynamicPropertyRegistry r) {
           r.add("spring.datasource.url", pg::getJdbcUrl);
           r.add("spring.datasource.username", pg::getUsername);
           r.add("spring.datasource.password", pg::getPassword);
       }
   }
   ```
   A **`static @Container`** is started once per class (shared across methods); a
   non-static one restarts per method.

2. **`@ServiceConnection`** (Boot 3.1+): annotate the container bean and Spring Boot
   auto-wires the connection details — no manual `@DynamicPropertySource` needed:
   ```java
   @Container @ServiceConnection
   static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16");
   ```

Pair with `@DataJpaTest` + `@AutoConfigureTestDatabase(replace = Replace.NONE)` to
run repository tests against a real DB. Downsides: requires Docker and is slower —
so keep these tests near the top of the pyramid.

---

## JUnit 5 and Mockito basics

**JUnit 5 (Jupiter)** replaced JUnit 4 idioms:

| JUnit 4 | JUnit 5 |
|---|---|
| `@Before` / `@After` | `@BeforeEach` / `@AfterEach` |
| `@BeforeClass` / `@AfterClass` (static) | `@BeforeAll` / `@AfterAll` (static) |
| `@Ignore` | `@Disabled` |
| `@RunWith(...)` | `@ExtendWith(...)` |
| `@Test(expected=...)` | `assertThrows(...)` |
| `@Category` | `@Tag` |

Key features: `@DisplayName`, `@Nested`, `@ParameterizedTest` (`@ValueSource`,
`@CsvSource`, `@MethodSource`), `assertAll`, and the `@ExtendWith` extension model.
Spring Boot's `@SpringBootTest` and slice annotations are meta-annotated with
`@ExtendWith(SpringExtension.class)`, so you don't add it yourself.

**Mockito essentials:**
- Stub: `when(mock.get(1)).thenReturn(x)` or BDD `given(mock.get(1)).willReturn(x)`.
- Stub void/spy safely: `doReturn(x).when(mock).get(1)`, `doThrow(...)`,
  `doNothing()`.
- Verify: `verify(mock, times(1)).save(any())`; `verifyNoMoreInteractions(mock)`.
- Capture args: `ArgumentCaptor<Order> c = ArgumentCaptor.forClass(Order.class)`.
- `@ExtendWith(MockitoExtension.class)` initializes `@Mock`/`@InjectMocks` and, by
  default, uses **strict stubbing** (flags unused stubs — a frequent gotcha).

```java
@ExtendWith(MockitoExtension.class)
class PricingTest {
    @Mock TaxService tax;
    @InjectMocks Pricing pricing;

    @Test
    void addsTax() {
        given(tax.rate("US")).willReturn(new BigDecimal("0.1"));
        assertThat(pricing.total(new BigDecimal("100"), "US")).isEqualByComparingTo("110");
        then(tax).should().rate("US");
    }
}
```

---

## Verifying transactions and rollback in tests

`@SpringBootTest`/`@DataJpaTest`-style tests annotated `@Transactional` **roll
back by default** at the end of each method (via `TransactionalTestExecutionListener`).
This keeps the DB clean but has consequences worth knowing:

- **Rollback by default in tests** is the opposite of production `@Transactional`
  on a service (which commits). Control it with `@Rollback(true|false)` or `@Commit`.
- Because the test method and the code under test can share **one** transaction,
  some behavior (lazy-loading works, flush deferred) differs from production where
  the service opens its own transaction. This can produce **false positives**
  (a test passes because the session stayed open) — an interview favorite.
- Use `TestTransaction` (`TestTransaction.flagForCommit()`, `.end()`, `.start()`)
  to programmatically control the test transaction and inspect committed vs
  rolled-back state.
- To assert rollback semantics of business code (e.g. that a `RuntimeException`
  rolls back and a checked exception doesn't, by default), you often need the code
  to run in its **own** transaction — e.g. call it in a separate transaction or
  use `TestTransaction` / a helper bean, then re-query.

**Self-invocation trap (carried from AOP):** `@Transactional` works via a proxy;
a call from one method to another `@Transactional` method **on the same bean**
bypasses the proxy, so the second method's transaction settings are ignored. Tests
that only check the entry method can miss this. Verify by calling through the
proxied (injected) bean.

---

## Common follow-up questions

- **Why is `@SpringBootTest` slow and how do you speed the suite up?** Use slice
  tests, share configuration so contexts are cached, avoid `@DirtiesContext`, and
  minimize distinct `@MockitoBean`/property combinations (each is a new cache key).
- **`@WebMvcTest` fails with "no qualifying bean of type OrderService" — why?**
  The web slice doesn't load `@Service` beans; provide the collaborator as
  `@MockitoBean`/`@MockBean`.
- **Difference between `@Mock` and `@MockBean`?** `@Mock` is plain Mockito (no
  context); `@MockBean`/`@MockitoBean` registers the mock as a bean, replacing the
  real one in the Spring context.
- **Why does my `@DataJpaTest` not fail on a constraint violation?** The test
  transaction hasn't flushed; call `flush()`/`persistAndFlush`, or the insert is
  rolled back before commit-time checks.
- **`TestRestTemplate` gives connection refused in a `@SpringBootTest` — fix?**
  Add `webEnvironment = RANDOM_PORT` (default `MOCK` starts no real server).
- **How do you test outbound REST calls?** `@RestClientTest` +
  `MockRestServiceServer`, or WireMock for full HTTP fidelity.
- **How do you get production-like DB tests?** Testcontainers with
  `@ServiceConnection` (Boot 3.1+) and `@AutoConfigureTestDatabase(replace = NONE)`.
- **Do you still add `@ExtendWith(SpringExtension.class)`?** No — Boot's test
  annotations already include it.
- **`@Mock` vs `@SpyBean`?** A mock replaces all behavior; a spy runs the real
  bean's methods unless stubbed, and is registered in the context (`@SpyBean`/`@MockitoSpyBean`).

---

## References

- Spring Boot Reference — Testing:
  https://docs.spring.io/spring-boot/reference/testing/index.html
- Spring Boot — Test Auto-configuration (slices) annotations index:
  https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html
- Spring Boot — Spring Boot Applications testing (`@SpringBootTest`, `webEnvironment`):
  https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html
- Spring Framework — TestContext framework & context caching:
  https://docs.spring.io/spring-framework/reference/testing/testcontext-framework.html
- Spring Framework — `@MockitoBean` / `@MockitoSpyBean` (bean overriding):
  https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html
- Testcontainers for Java: https://java.testcontainers.org/
- Spring Boot + Testcontainers (`@ServiceConnection`):
  https://docs.spring.io/spring-boot/reference/testing/testcontainers.html
- Baeldung — Testing in Spring Boot: https://www.baeldung.com/spring-boot-testing
- Baeldung — `@MockBean`: https://www.baeldung.com/java-spring-mockito-mock-mockbean
- JUnit 5 User Guide: https://junit.org/junit5/docs/current/user-guide/
- Mockito documentation: https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html
