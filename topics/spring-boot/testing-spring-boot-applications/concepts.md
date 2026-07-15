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

**How the config class is discovered (the `@SpringBootConfiguration` search):**
`@SpringBootTest` does *not* scan for `@Configuration` classes. It walks **up the
package hierarchy** from the test class looking for exactly one
`@SpringBootConfiguration` (your `@SpringBootApplication` is meta-annotated with
it). If it finds **none** it throws `IllegalStateException: Unable to find a
@SpringBootConfiguration`; if it finds **more than one** it also fails. This is
why your test package structure must mirror the main package structure — a test in
a package *above* the application class won't find it. You can bypass the search
by passing explicit `classes = {...}` to `@SpringBootTest`, but doing so means
auto-configuration and component scanning are **not** contributed unless those
classes bring them in.

**`MOCK` still needs `@AutoConfigureMockMvc` semantics:** with `webEnvironment =
MOCK`, `MockMvc` is only auto-configured on a `@SpringBootTest` if you add
`@AutoConfigureMockMvc` (or use the `@WebMvcTest` slice, which includes it).
Merely writing `@SpringBootTest` and autowiring `MockMvc` will fail with a
"no qualifying bean of type MockMvc" error unless `@AutoConfigureMockMvc` is
present.

**`DEFINED_PORT` and CI parallelism:** `DEFINED_PORT` binds the real configured
port (default 8080) and, unlike `MOCK`/`RANDOM_PORT`, is **not** transactional by
default in the same way — more importantly it makes tests non-parallelizable and
flaky under CI where the port may be taken. Prefer `RANDOM_PORT`. Note also that
with a real server (`RANDOM_PORT`/`DEFINED_PORT`) the server thread runs in its
**own** transaction, so a test-method `@Transactional` rollback does **not** roll
back what the server-side handler committed — a classic reason integration data
leaks between tests.

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

**What is and isn't in the slice (subtle boundaries):**
- `@WebMvcTest` includes `WebMvcConfigurer`, `HandlerMethodArgumentResolver`,
  `Filter`, `HandlerInterceptor`, `@ControllerAdvice`, `@JsonComponent`,
  `Converter`/`GenericConverter`, and the Jackson `ObjectMapper` — but **not**
  your `@Configuration` classes that are ordinary `@Component`s, and not
  `@Service`/`@Repository`. If a `@ControllerAdvice` depends on a `@Service`,
  the advice loads but its dependency does not, so you must `@MockitoBean` it or
  the context fails.
- Passing a controller class narrows the slice: `@WebMvcTest(OrderController.class)`
  registers *only* that controller. But `@ControllerAdvice` beans are **global**
  and are still loaded — so a global exception handler will affect the narrowed
  slice, which can be surprising when an advice you didn't expect maps your
  exception to a different status.
- **`MockMvc` matchers see the resolved response, not the raw exception:** if a
  handler throws and no advice maps it, `@WebMvcTest` returns 500 and, by
  default, may **rethrow** the unresolved exception so `mvc.perform(...)` throws
  rather than returning a 500 result. Use `.andExpect(status().isInternalServerError())`
  only when an advice actually produces the response.

**`addFilters` and security filters:** `@AutoConfigureMockMvc(addFilters =
false)` disables the servlet filter chain (including Spring Security's
`FilterChainProxy`), which is a common way to sidestep 401s without wiring test
security — but it also disables *any* custom filter, so it can mask real
behavior.

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

**The first-level cache masks `findById` bugs:** after `em.persist(entity)`, the
same entity instance lives in the persistence context. A subsequent
`repo.findById(id)` returns the **identical object from the first-level cache**
without hitting the DB — so a broken column mapping (wrong `@Column` name, missing
getter) can pass. To test a true round-trip, call `em.flush()` then `em.clear()`
(or `TestEntityManager.clear()`) to detach everything and force a fresh SELECT.

**Auto-generated schema vs your migrations:** `@DataJpaTest` sets
`spring.jpa.hibernate.ddl-auto` behavior such that Hibernate creates the schema
from your `@Entity` mappings by default on the embedded DB. This means Flyway/
Liquibase migrations are **not** the source of truth in the slice — a test can pass
against the Hibernate-generated schema while the real migration is broken. Use
`@AutoConfigureTestDatabase(replace = NONE)` + Testcontainers + migrations to test
the actual schema. (Flyway/Liquibase auto-configuration *does* run in
`@DataJpaTest` if present, which can itself conflict with Hibernate DDL.)

**`@DataJpaTest` and multiple `DataSource`s:** the slice expects a single
`DataSource`. If your app defines several, the auto-replacement and repository
wiring become ambiguous and you generally must fall back to `@SpringBootTest`
with explicit configuration.

**Repository query method verification:** validation timing differs by query kind.
`@Query` **JPQL/HQL** is parsed by Hibernate at `EntityManagerFactory` bootstrap,
and **derived** query methods are parsed by Spring Data (PartTree → property paths)
at repository initialization — so with the default (eager) bootstrap mode both a
JPQL typo and a derived-query property typo typically fail at **context startup**
(a `@DataJpaTest` catches them even without calling the method). The real blind spot
is a **native** query (`@Query(nativeQuery = true)`): its SQL is an opaque string
not validated until it actually executes against the DB, so a `@DataJpaTest` that
never invokes it won't catch a bad column/table name. (With lazy/deferred bootstrap
mode, even derived-query validation is deferred to first use.)

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

**`@RestClientTest` binding gotcha:** `MockRestServiceServer` binds to the
`RestTemplate`/`RestClient` **that the slice built for your client** via the
auto-configured `RestTemplateBuilder`/`RestClient.Builder`. If your client
constructs its own `new RestTemplate()` internally instead of accepting a builder,
the mock server is bound to a different instance and your expectations are **never
matched / never satisfied** (`server.verify()` reports no calls, or real HTTP
leaks out). Always inject the builder.

**Expectation ordering and counts:** by default `MockRestServiceServer` expects
requests in the **declared order** and **exactly once** each. Use
`ExpectedCount.manyTimes()`, `.times(n)`, `never()`, or build the server with
`ignoreExpectOrder(true)` when the client makes calls in a nondeterministic order.
Forgetting `server.verify()` means unfulfilled expectations pass silently.

**`@JsonTest` uses the app's `ObjectMapper` customizations:** it applies your
`Jackson2ObjectMapperBuilderCustomizer` beans and `spring.jackson.*` properties,
so it reflects real serialization config (e.g. `WRITE_DATES_AS_TIMESTAMPS=false`,
property naming strategy). A plain `new ObjectMapper()` in a unit test would
**not** — which is exactly why `@JsonTest` catches config-dependent bugs a POJO
test misses.

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

**Exactly what goes into the cache key (`MergedContextConfiguration`):** the key
is composed of the *locations/classes*, *context initializers*, *active
profiles*, *property sources* (`@TestPropertySource` inline + files),
*`ContextCustomizer`s* (which include the set of `@MockitoBean`/`@MockBean`
definitions, `@DynamicPropertySource`, `webEnvironment`, `@MockMvcPrint`, etc.),
the *`ContextLoader`*, and the *parent context*. Two test classes share a context
**iff all of these are equal**. Consequences interviewers probe:
- Even the **field name** of a `@MockitoBean` participates (via its
  `ContextCustomizer`'s equals/hashCode in recent versions) — inconsistent naming
  of the same mock across classes can create redundant contexts.
- `properties = {"a=1","b=2"}` and `properties = {"b=2","a=1"}` are normalized, so
  ordering there doesn't matter — but a value that differs (even a timestamp) does.
- `@DynamicPropertySource` values are resolved lazily, but their **presence**
  contributes a customizer, so tests with and without it don't share a context.

**Cache statistics for debugging:** enable `logging.level.org.springframework.
test.context.cache=DEBUG` to log hit/miss/size. A suite that is mysteriously slow
often has dozens of near-identical-but-not-equal configurations thrashing the
32-entry LRU — each miss triggers a full context build, and eviction **closes**
the evicted context (running `@PreDestroy`, shutting embedded servers).

**`@DirtiesContext` modes and timing:** `classMode`
(`AFTER_CLASS`/`AFTER_EACH_TEST_METHOD`/`BEFORE_CLASS`) and `methodMode`
(`BEFORE_METHOD`/`AFTER_METHOD`) control *when* eviction happens. `AFTER_CLASS` is
usually the least-bad option because it still shares the context within the class.
`hierarchyMode` controls whether the whole context hierarchy or just the current
level is evicted.

**Parallel execution caveat:** the context cache is thread-safe and shared, but
tests that mutate shared singleton/mock state are **not** safe to run in parallel
against the same cached context. JUnit 5 parallelism plus `@MockitoBean` on a
shared context is a well-known source of flakiness because mock reset and
concurrent stubbing race.

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

**Bean resolution rules for `@MockitoBean` (deep):**
- On a **field**, the target is resolved **by type**. If several beans of that
  type exist, Spring uses the field name (or a `@Qualifier`) as a fallback
  qualifier; if still ambiguous, the context **fails** with an error telling you
  to disambiguate.
- **`@MockitoBean` uses the `REPLACE_OR_CREATE` strategy:** if **no** bean of the
  type exists, it **creates a new one** rather than failing. That means a typo in
  the type or a bean that isn't actually in the slice will silently add a brand-new
  mock bean instead of replacing anything — a subtle source of "my stub does
  nothing" bugs. Set `enforceOverride = true` (`REPLACE` strategy) to require an
  existing bean and fail otherwise.
- **`@MockitoSpyBean` uses the `WRAP` strategy** and requires **exactly one**
  existing candidate; zero candidates is an error (it cannot create one), and
  multiple candidates need a qualifier.
- **Scoped-proxy beans cannot be spied** (`@Scope(proxyMode = TARGET_CLASS)`)
  — the attempt fails. Non-singleton (prototype/request) beans are **converted to
  singleton** when mocked/spied.
- For a `FactoryBean`, mocking replaces it with a mock of the **produced object
  type**, not the factory.

**Why `@MockitoBean` fields are static-safe but reset-sensitive:** the mock lives
in the (possibly cached) context, but Spring Boot resets it around every test
method. So a stub set in `@BeforeAll` (static, runs once) is **wiped** before the
first test unless re-stubbed in `@BeforeEach` — a frequent "stub disappeared"
gotcha.

**`@Mock` + `MockitoExtension` inside a Spring test:** if you *do* add
`@ExtendWith(MockitoExtension.class)` alongside `@SpringBootTest`, the two
extensions can conflict over lifecycle and, with strict stubbing, throw
`UnnecessaryStubbingException` for stubs that Spring-injected beans never touched
(because your `@Mock` isn't the injected instance). Keep Mockito's extension out of
Spring tests and use `@MockitoBean`.

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

**MockMvc's Hamcrest style vs `MockMvcTester` (Spring Framework 6.2+):** classic
`MockMvc` uses static-imported Hamcrest matchers (`status()`, `jsonPath()`),
requires `throws Exception` on the test method, and needs special handling for
async (`asyncDispatch`). **`MockMvcTester`** is the newer AssertJ-based entry point
(`MockMvcTester.from(context)` / `.create(mockMvc)`): both request building and
assertions are fluent (`assertThat(mvc.get().uri("/x")).hasStatusOk()`), it
**handles unresolved exceptions itself** so tests need not declare `throws
Exception`, and async results are **complete by default** with no `asyncDispatch`.
It coexists with plain MockMvc and can be created from an existing `MockMvc`.

**MockMvc does not run real filters unless configured:** with `@WebMvcTest`/
`@SpringBootTest` MockMvc *does* register the Spring-managed filter chain by
default (including Security). But it still bypasses the servlet container's own
request lifecycle (no real `ServletContext` request parsing, no connector). And
`forward`/`redirect` are asserted via `forwardedUrl`/`redirectedUrl` matchers —
MockMvc does not actually perform the forward.

**`WebTestClient.bindToController`/`bindToApplicationContext`:** `WebTestClient`
can test MVC controllers **without a server** (mock request/response, like
MockMvc) via `MockMvcWebTestClient`, or hit a real `RANDOM_PORT` server. So the
"WebTestClient == reactive only" belief is wrong; it's the unified fluent client.

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

**Bean overriding rules and `@Primary`:** since Spring Boot 2.1,
`spring.main.allow-bean-definition-overriding` defaults to **false**, so a
`@TestConfiguration` `@Bean` that has the **same name** as a production bean throws
`BeanDefinitionOverrideException` at startup unless you enable overriding or the
test bean is `@Primary` (which resolves by-type injection without a name clash) or
you give it a distinct name. This is why `@MockitoBean` (which *replaces* rather
than *redefines*) is often cleaner than a `@TestConfiguration` override — it
sidesteps the override flag entirely.

**`@Import` vs nested vs `@ContextConfiguration`:** a nested static
`@TestConfiguration` is auto-detected **only** for the test class that encloses it;
a top-level `@TestConfiguration` must be `@Import`ed (or referenced) and is *not*
picked up by another test's component scan. Importantly, `@Import`ing a
`@TestConfiguration` **adds** to the discovered `@SpringBootConfiguration` rather
than replacing it — so you still get full auto-configuration plus your test beans.

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

**Container reuse and the singleton-container pattern:** starting a container per
class (even `static`) is still expensive across many classes. Two techniques:
1. **`.withReuse(true)`** plus `testcontainers.reuse.enable=true` in
   `~/.testcontainers.properties` keeps the container **alive between JVM runs**
   (great for local iteration; usually disabled in CI). Reuse requires a stable
   container config so Testcontainers can match the existing one by hash.
2. **Singleton container pattern:** declare the container `static` in a base class
   and **start it manually** (`pg.start()` in a static block) *without* the
   `@Testcontainers`/`@Container` JUnit lifecycle, so a single container is shared
   across all test classes and never stopped (Ryuk cleans it up at JVM exit). This
   maximizes reuse and pairs well with a **shared cached context**.

**`@ServiceConnection` vs `@DynamicPropertySource` precedence:** `@ServiceConnection`
works through `ConnectionDetails` beans, which take precedence over ordinary
properties. If you register both, the `ConnectionDetails` win — mixing them can
mask a mistyped `@DynamicPropertySource`. `@ServiceConnection` only works for
container types Boot recognizes (Postgres, MySQL, Mongo, Redis, Kafka, etc.);
for arbitrary containers you still need `@DynamicPropertySource`.

**Boot 3.1 `@Testcontainers` at development time:** `@ImportTestcontainers` and the
`spring-boot-testcontainers` module let you define containers as `@Bean`s
(`@TestConfiguration`) and even run the app locally against them (`SpringApplication`
`.from(...).with(...)`), unifying test and dev-time infra.

**Startup ordering trap:** `@DynamicPropertySource` methods run **before** the
context is refreshed, and `static @Container` fields are started by the
`TestcontainersExtension` before that too — but only if `@Testcontainers` is
present. If you forget `@Testcontainers`, a `static` container is **never
started**, and `getJdbcUrl()` is called on a stopped container, yielding a
confusing `IllegalStateException`.

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

**Deeper Mockito traps interviewers use:**
- **Strictness levels:** `MockitoExtension` defaults to `Strictness.STRICT_STUBS`
  (unused stubs fail, argument mismatches are flagged). Override per class with
  `@MockitoSettings(strictness = Strictness.LENIENT)` or per-stub with
  `lenient().when(...)`. JUnit 4's `MockitoJUnitRunner` had `WARN` legacy
  behavior; plain `MockitoAnnotations.openMocks` has **no** strictness enforcement.
- **`@InjectMocks` injection algorithm:** Mockito tries **constructor injection
  first** (biggest constructor it can satisfy), then setter, then field. If the
  biggest constructor has a parameter with **no matching mock**, that parameter is
  injected as `null` — no error — which surfaces later as an NPE. Multiple mocks of
  the same type are matched **by field name**; a name mismatch leaves the field
  null.
- **`any()` vs `null` and primitives:** the **no-arg `any()`** matches
  *anything, including `null`* (and varargs); it is **`any(Class)`** that
  **excludes `null`** since Mockito 2.1.0 — use `isNull()` / `nullable(Class)` to
  match null there. Separately, `anyInt()`/`anyLong()` must be used for primitives —
  passing the object matcher `any()` for a primitive parameter returns `null`,
  which unboxes and throws an NPE.
- **Mixing matchers and raw values:** if one argument uses a matcher, **all** must
  (`eq("x")` for the literal), or Mockito throws
  `InvalidUseOfMatchersException`.
- **`spy()` self-invocation (contrast with AOP):** a Mockito spy is a ByteBuddy
  **subclass** with the real object's state copied in — every call on the spy
  reference, *including internal `this.other()` self-invocations*, dispatches
  through the spy subclass and **is** intercepted, so a stubbed self-invoked method
  **does** return its stub. This is the **opposite** of Spring AOP/`@Transactional`
  proxies, where `this` is the raw target and self-invocation bypasses the proxy.
  (The reason to prefer `doReturn(x).when(spy).m()` over `when(spy.m())` is
  different: the latter *executes the real `m()`* while setting up the stub.)
- **Static/final and mocking:** mocking `static` methods needs
  `mockito-inline`/`mockStatic` (a `MockedStatic` scoped in try-with-resources,
  thread-local — must be closed or it leaks to other tests on the same thread).

**`@ParameterizedTest` + `@MethodSource` gotcha:** the factory method must be
`static` (unless the class is `@TestInstance(PER_CLASS)`) and its name must match
or be given explicitly. Argument type coercion for `@CsvSource` follows implicit
conversion rules — a common surprise is that an empty string becomes `""` while a
missing value becomes `null`.

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

## Slice internals: @AutoConfigure*, @ImportAutoConfiguration, filters

Every slice annotation is assembled from smaller pieces, and understanding them
lets you extend a slice without escalating to `@SpringBootTest`:

- **`@ImportAutoConfiguration`** imports a *specific* auto-configuration class into
  a slice that wouldn't otherwise include it (e.g. pulling `FlywayAutoConfiguration`
  into a `@DataJpaTest`). Unlike `@EnableAutoConfiguration`, it imports **only**
  what you name (and its `META-INF/spring/...AutoConfiguration.imports` group),
  keeping the slice minimal.
- **`@AutoConfigure...` companions** (`@AutoConfigureTestDatabase`,
  `@AutoConfigureJson`, `@AutoConfigureMockMvc`, `@AutoConfigureWebTestClient`,
  `@AutoConfigureDataJpa`) each contribute a slice of auto-config. They are
  additive: you can stack `@WebMvcTest` + `@AutoConfigureRestDocs`.
- **`@TypeExcludeFilters`** is *how* slices keep other components out. Each slice
  registers a filter (e.g. `WebMvcTypeExcludeFilter`) that lets through only the
  slice's stereotypes and drops `@Service`/`@Repository`/`@Component`. Your custom
  `@ComponentScan` `includeFilters` won't re-add them inside a slice.
- **`@ContextConfiguration(initializers = ...)`** and `ApplicationContextInitializer`
  run **before** the context refreshes and can register additional property
  sources or bean definitions — the mechanism `@DynamicPropertySource` and
  Testcontainers integrations build on.

**Extending a slice with real collaborators:** to include one extra real bean in a
web slice, `@Import` its `@Configuration` or use `@AutoConfigureXxx` — but if you
find yourself importing many, you've outgrown the slice and should use
`@SpringBootTest` with `@AutoConfigureMockMvc`.

## Flaky tests, ordering, isolation, and parallelism

Senior interviews probe *why suites flake*:

- **Test ordering:** JUnit 5 runs methods in a **deterministic but intentionally
  non-obvious** order by default (`MethodOrderer` not applied). Never rely on
  method order; use `@TestMethodOrder(OrderAnnotation.class)` only when genuinely
  needed. Order-dependence usually signals **shared mutable state** — a leaked
  static, a committed row (real-server integration test), or a mutated cached
  singleton.
- **State leakage across the cached context:** because contexts are shared,
  a `@Component` that caches data, a static field, or a `@MockitoBean` whose stub
  from a prior class lingers (it shouldn't — it's reset — but a **manually created**
  Mockito mock stored in a bean would) all cause order-dependent failures. The fix
  is usually `@AfterEach` cleanup, `@DirtiesContext` (last resort), or redesigning
  away shared state.
- **Time and randomness:** inject a `Clock` and mock it (`Clock.fixed`) rather than
  calling `Instant.now()`; seed randomness. `@Scheduled`/`@Async` beans running in
  the background during a test are a classic flake source — disable scheduling in
  tests (`spring.task.scheduling.*` / conditional `@EnableScheduling`) or use
  `Awaitility` to await instead of `Thread.sleep`.
- **Parallelism:** JUnit 5 parallel execution
  (`junit.jupiter.execution.parallel.enabled=true`) can dramatically speed suites,
  but `@SpringBootTest` classes sharing a cached context that mutate state, or two
  `DEFINED_PORT` servers, will collide. Use `@ResourceLock` or
  `@Execution(SAME_THREAD)` to serialize the risky ones.
- **Testing `@Async`:** a method annotated `@Async` returns before completion; a
  test must await the returned `CompletableFuture` or use `Awaitility`. If the test
  is `@Transactional`, the async thread runs in a **different** transaction (and
  can't see the test's uncommitted data) — a subtle correctness trap.

## Testing security and web layers deeply

- **`@WithMockUser` / `@WithUserDetails` / `@WithSecurityContext`** populate the
  `SecurityContext` for a test method. `@WithMockUser(roles = "ADMIN")` sets
  authority `ROLE_ADMIN`; specifying `authorities` instead sets them verbatim
  (no `ROLE_` prefix) — mixing these up is a common cause of unexpected 403s.
- **`SecurityMockMvcRequestPostProcessors`** (`with(user(...))`, `with(csrf())`,
  `with(jwt())`) apply security per-request without an annotation. **CSRF:** for
  state-changing MockMvc requests against a Security-enabled slice you must add
  `with(csrf())` or the request is 403 — a frequent "my POST test returns 403"
  surprise.
- **`spring-security-test`** is a separate dependency; without it the annotations
  and post-processors aren't available.
- **`@WebMvcTest` + method security (`@PreAuthorize`)**: method-level security is
  applied by an AOP interceptor on the *service* layer, which the web slice does
  **not** load. So `@PreAuthorize` on a service is **not** exercised by
  `@WebMvcTest`; only URL-based `HttpSecurity` rules are.

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
- Spring Framework — MockMvcTester (AssertJ MockMvc integration):
  https://docs.spring.io/spring-framework/reference/testing/mockmvc/assertj.html
- Spring Security — Testing (`@WithMockUser`, MockMvc post-processors):
  https://docs.spring.io/spring-security/reference/servlet/test/index.html
- Testcontainers for Java: https://java.testcontainers.org/
- Testcontainers — container reuse:
  https://java.testcontainers.org/features/reuse/
- Spring Boot + Testcontainers (`@ServiceConnection`):
  https://docs.spring.io/spring-boot/reference/testing/testcontainers.html
- Baeldung — Testing in Spring Boot: https://www.baeldung.com/spring-boot-testing
- Baeldung — `@MockBean`: https://www.baeldung.com/java-spring-mockito-mock-mockbean
- JUnit 5 User Guide: https://junit.org/junit5/docs/current/user-guide/
- Mockito documentation: https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html
