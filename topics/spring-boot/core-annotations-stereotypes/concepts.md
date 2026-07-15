# Core Annotations & Stereotypes

Spring's stereotype annotations (`@Component`, `@Service`, `@Repository`, `@Controller`, `@RestController`) and the configuration annotations (`@Configuration`, `@Bean`, `@Import`, `@Value`, `@Primary`, `@Qualifier`) are the entry points to the whole framework. Interviewers use them to probe whether you understand *how* the container discovers, wires, and proxies beans — not just what the annotations are named.

> Jakarta note: In Spring Boot 3.x (Spring Framework 6.x), the JSR-330/annotations moved from `javax.*` to `jakarta.*` (e.g. `jakarta.annotation.PostConstruct`, `jakarta.inject.Inject`). Spring's own annotations (`org.springframework.*`) never changed package.

---

## @Component / @Service / @Repository / @Controller / @RestController differences

All five are **class-level stereotype annotations** that mark a class as a Spring-managed bean eligible for component scanning. They are all, directly or indirectly, meta-annotated with `@Component`, so from the pure "is this a bean" standpoint they are interchangeable. The differences are **semantic intent** plus a few **behavioral extras**:

| Annotation | Meta-annotated with | Layer / intent | Extra behavior |
|---|---|---|---|
| `@Component` | (root) | Generic Spring-managed component | None beyond being a bean |
| `@Service` | `@Component` | Business/service layer | None today — purely semantic marker |
| `@Repository` | `@Component` | Persistence/DAO layer | **Exception translation** (persistence exceptions → `DataAccessException`) |
| `@Controller` | `@Component` | Web MVC controller (returns views) | Handler mapping; methods usually return view names |
| `@RestController` | `@Controller` + `@ResponseBody` | REST/JSON controller | Every handler method's return value is written to the response body |

Key interview points:

- `@Service` and `@Component` are functionally identical right now; `@Service` communicates a role and lets tooling/AOP target the service layer. Prefer the specific stereotype for readability.
- `@RestController` = `@Controller` + `@ResponseBody` at the type level. Without it you'd annotate every method with `@ResponseBody`. Returning `"user"` from a `@Controller` resolves a view named `user`; from a `@RestController` it writes the literal string `user` to the body.
- Only `@Repository` currently adds runtime behavior (exception translation, see below).

```java
@RestController                 // = @Controller + @ResponseBody
@RequestMapping("/api/users")
class UserController {
    private final UserService service;
    UserController(UserService service) { this.service = service; }

    @GetMapping("/{id}")
    User byId(@PathVariable Long id) { return service.find(id); } // serialized to JSON
}
```

## @Repository exception translation

`@Repository` is more than a semantic marker: when combined with a `PersistenceExceptionTranslationPostProcessor` (auto-registered in Spring Boot), Spring wraps the bean in an AOP proxy that **translates provider-specific persistence exceptions into Spring's unchecked `DataAccessException` hierarchy**.

Why it matters: JDBC throws `SQLException`, JPA throws `PersistenceException`/`jakarta.persistence` exceptions, Hibernate throws `HibernateException`. These are provider-specific. Translation gives you a **consistent, technology-agnostic, unchecked** exception hierarchy (`DataAccessException`), so service code isn't coupled to JDBC vs JPA vs Hibernate.

Mechanics / gotchas:
- The `PersistenceExceptionTranslationPostProcessor` is a `BeanPostProcessor` that adds an advisor to any bean annotated with `@Repository`.
- Translation uses `PersistenceExceptionTranslator` beans (e.g. `HibernateExceptionTranslator`, JPA's `EntityManagerFactory`) to map raw exceptions.
- Translation only applies at the proxy boundary, and only for exceptions thrown from methods invoked *through* the proxy. It does **not** magically translate if you swallow/re-wrap the exception yourself.
- Spring Data repositories get translation regardless because their proxy factory applies it; the `@Repository` annotation is what triggers it for hand-written DAOs.

## Meta-annotations

A **meta-annotation** is an annotation used on another annotation. Spring's stereotypes are built this way: `@Service` is annotated with `@Component`, so the container treats anything annotated `@Service` as a component.

- **Composed annotations**: you can create your own annotation combining several. `@RestController` is itself a composed annotation (`@Controller` + `@ResponseBody`). You can define `@Slf4jService` combining `@Service` + custom markers.
- **Attribute aliasing / overriding**: `@AliasFor` lets a composed annotation expose or rename attributes from its meta-annotations. e.g. `@RequestMapping`'s `path` is aliased into `@GetMapping` (`@GetMapping` is `@RequestMapping(method = GET)`).
- Spring performs **transitive meta-annotation search** via `MergedAnnotations` / `AnnotatedElementUtils` — it finds `@Component` even several levels deep.

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Service                     // meta-annotated → still a Spring bean
@Transactional               // composed: every such bean is transactional
public @interface TransactionalService {}
```

## Component scanning (how it works, filters, basePackages)

Component scanning is the process by which Spring discovers stereotype-annotated classes and registers them as bean definitions.

How it works:
1. `@ComponentScan` (or Spring Boot's `@SpringBootApplication`, which includes it) defines the base packages to scan.
2. `ClassPathScanningCandidateComponentProvider` scans the classpath using ASM to read class metadata **without loading the classes** (so it's fast and avoids side effects).
3. Candidates matching include filters (default: annotated with `@Component` or a meta-annotation) and not matching exclude filters become `BeanDefinition`s.
4. `@Configuration`, `@Bean`, `@Import`, etc. are then processed by `ConfigurationClassPostProcessor`.

Base packages:
- `@SpringBootApplication` scans the package of the main class **and all sub-packages**. This is why placing the main class in a root package matters — beans in sibling/parent packages won't be found.
- Explicit: `@ComponentScan(basePackages = "com.acme.app")` or type-safe `basePackageClasses = SomeMarker.class`.

Filters:

```java
@ComponentScan(
    basePackages = "com.acme",
    includeFilters = @Filter(type = FilterType.ANNOTATION, classes = FeatureFlag.class),
    excludeFilters = @Filter(type = FilterType.REGEX, pattern = "com\\.acme\\.legacy\\..*"),
    useDefaultFilters = false)          // turn OFF the default @Component filter
class ScanConfig {}
```

- `FilterType`: `ANNOTATION`, `ASSIGNABLE_TYPE`, `ASPECTJ`, `REGEX`, `CUSTOM`.
- **Gotcha**: `useDefaultFilters = true` (the default) keeps the built-in `@Component` filter. If you only set `includeFilters` without disabling defaults, you scan defaults *plus* your includes. Set `useDefaultFilters = false` to scan *only* your includes.
- Spring Boot's auto-configuration exclusion (`@SpringBootApplication(exclude = ...)`) is different from scan exclude filters.

## @Configuration: full vs lite mode, CGLIB proxying of @Bean methods

`@Configuration` marks a class as a source of bean definitions via `@Bean` methods.

**Full mode (`@Configuration`, `proxyBeanMethods = true` — the default):**
- Spring subclasses the config class at runtime with **CGLIB** and intercepts `@Bean` method calls.
- Inter-bean references: if one `@Bean` method calls another `@Bean` method, the CGLIB interceptor returns the **singleton from the container** instead of executing the method again. This guarantees singleton semantics even for programmatic calls.

```java
@Configuration
class AppConfig {
    @Bean ServiceA a() { return new ServiceA(b()); } // b() intercepted → returns the singleton
    @Bean ServiceB b() { return new ServiceB(); }     // called once; a() and any other caller share it
}
```

**Lite mode:** occurs when `@Bean` methods live on a class **not** annotated `@Configuration` (e.g. a `@Component`, or a plain class), OR when `@Configuration(proxyBeanMethods = false)`.
- No CGLIB subclass, no interception. A `@Bean` method calling another `@Bean` method executes it as a **plain Java call**, creating a *new* instance each time (not the container singleton).
- Lite mode is faster to start (no CGLIB) and lets the config class be `final`. Spring Boot's own auto-configs increasingly use `proxyBeanMethods = false` where inter-bean method calls aren't needed.

Interview trap: "Two beans both depend on B; with `proxyBeanMethods=false` and inter-bean method calls, do they share the same B?" → **No** — each direct method call builds a new B. Use method parameters (`@Bean ServiceA a(ServiceB b)`) instead, which always receive the container singleton regardless of proxy mode.

## @Configuration vs @Component

Both can host `@Bean` methods, but the proxying differs:

| Aspect | `@Configuration` (full) | `@Component` (lite) |
|---|---|---|
| CGLIB proxy of the class | Yes | No |
| Inter-`@Bean`-method call returns container singleton | Yes (intercepted) | No (plain call → new instance) |
| Startup cost | Slightly higher (proxy) | Lower |
| Can be `final` | No (needs subclass) | Yes |
| Intended use | Central bean definitions | Bean that also *happens* to expose factory methods |

Rule of thumb: use `@Configuration` for classes whose purpose is to define beans, especially when `@Bean` methods reference each other. Use method-parameter injection to sidestep the proxy dependency entirely.

## @Bean vs @Component

Both register beans, but they answer different questions.

| | `@Bean` | `@Component` |
|---|---|---|
| Applied to | A **method** (usually in a `@Configuration` class) | A **class** |
| Registration | Explicit, programmatic — you write the instantiation | Implicit, via component scanning |
| Control over construction | Full (call constructors, set props, conditional logic) | Container instantiates via constructor |
| Use for **third-party** classes you can't annotate | Yes — the canonical use case | No (can't add annotation to library code) |
| Naming | Method name = bean name (override with `@Bean("x")`) | Class name lower-camel, or `@Component("x")` |
| Multiple beans of same type | Easy (multiple methods) | Requires multiple classes |

Interview point: use `@Bean` when you need to configure a class you don't own (e.g. a `RestTemplate`, `ObjectMapper`, a DataSource) or when instantiation requires logic. Use `@Component` for your own classes you can annotate and let Spring construct.

```java
@Configuration
class InfraConfig {
    @Bean                                   // third-party type, needs custom setup
    ObjectMapper objectMapper() {
        return new ObjectMapper().findAndRegisterModules();
    }
}
```

## @Import

`@Import` pulls additional configuration/beans into the current context. It's how you compose configuration without component scanning everything.

Three things it can import:
1. **`@Configuration` classes** — registers their `@Bean` methods.
2. **`ImportSelector`** — returns class names to register *programmatically* at parse time (basis of `@Enable*` annotations; Spring Boot auto-config uses `DeferredImportSelector`).
3. **`ImportBeanDefinitionRegistrar`** — registers bean definitions directly via a `BeanDefinitionRegistry` (used by Spring Data, MyBatis mapper scanning, etc.).

```java
@Configuration
@Import({SecurityConfig.class, DataSourceConfig.class})
class RootConfig {}
```

- `@Enable*` annotations (`@EnableScheduling`, `@EnableCaching`, `@EnableTransactionManagement`) are typically `@Import`-driven meta-annotations.
- Spring Boot's `@EnableAutoConfiguration` uses `AutoConfigurationImportSelector` (a `DeferredImportSelector`) reading `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (Boot 2.7+/3.x; older Boot used `spring.factories`).

## @Value and property injection

`@Value` injects externalized values (properties, environment variables, SpEL results) into fields, constructor params, or method params.

```java
@Component
class MailService {
    @Value("${mail.host}")                       // property placeholder
    private String host;

    @Value("${mail.port:25}")                    // default if property absent
    private int port;

    @Value("${mail.recipients}")                 // "a@x,b@y" → List via conversion
    private List<String> recipients;

    // constructor injection (preferred over field)
    private final int timeout;
    MailService(@Value("${mail.timeout:5000}") int timeout) { this.timeout = timeout; }
}
```

Key points:
- `${...}` is **property placeholder** resolution (resolved by `PropertySourcesPlaceholderConfigurer`); `#{...}` is **SpEL**.
- `${prop:default}` supplies a default; without a default and no property, startup fails with `IllegalArgumentException: Could not resolve placeholder`.
- Type conversion is applied (String → int, comma-separated → `List`/array via `ConversionService`).
- For grouped, type-safe, validated config prefer `@ConfigurationProperties` over scattering many `@Value`s.
- Field `@Value` injection makes unit testing harder (needs reflection); constructor injection is testable.

## SpEL basics and use cases

Spring Expression Language (`#{...}`) is a runtime expression language supporting property access, method invocation, arithmetic, logical/relational operators, collection selection/projection, and bean references.

```java
@Value("#{2 * T(java.lang.Math).PI}")        double twoPi;          // static method/const
@Value("#{systemProperties['user.region']}") String region;         // implicit variable
@Value("#{userConfig.maxSessions ?: 10}")     int max;              // Elvis (null-safe default)
@Value("#{'a,b,c'.split(',')}")               String[] parts;
@Value("#{jobList.?[priority > 5]}")           List<Job> urgent;    // collection selection
@Value("#{@otherBean.someMethod()}")           String v;            // reference another bean
```

Common use cases:
- Defaults and computed values in `@Value`.
- `@ConditionalOnExpression`, cache/`@Cacheable(key = "#id")`, `@PreAuthorize("hasRole('ADMIN')")`, `@Scheduled(cron = "#{...}")`.
- `?:` Elvis operator and `?.` safe navigation to avoid NPEs.
- Distinctions to remember: `${...}` = property placeholder (resolved before SpEL), `#{...}` = SpEL, `#name` inside SpEL = a variable/argument reference (e.g. method args in security/cache expressions).

## @Primary vs @Qualifier

When multiple beans of the same type exist, autowiring by type is ambiguous (`NoUniqueBeanDefinitionException`). Two resolution mechanisms:

- **`@Primary`**: marks *one* bean as the default choice when several candidates match. Coarse-grained, defined at the bean/definition side.
- **`@Qualifier("name")`**: at the *injection point*, names exactly which bean to inject. Fine-grained, overrides `@Primary`.

```java
@Bean @Primary DataSource main() { ... }
@Bean @Qualifier("audit") DataSource audit() { ... }

@Service
class Reports {
    Reports(DataSource main,                          // gets @Primary
            @Qualifier("audit") DataSource auditDs) { ... }
}
```

Resolution order for a single-type injection point:
1. `@Qualifier` (or a custom qualifier annotation) — most specific, wins.
2. `@Primary` among remaining candidates.
3. Bean name matching the field/parameter name (fallback: if injecting `DataSource auditDs`, Spring tries a bean named `auditDs`).
4. Otherwise → `NoUniqueBeanDefinitionException`.

Notes:
- `@Primary` and `@Qualifier` at the injection point: `@Qualifier` wins.
- JSR-330 `@Named` is analogous to `@Qualifier`; `jakarta.inject.Inject` analogous to `@Autowired`.
- For a collection injection (`List<DataSource>`), Spring injects *all* candidates (ordered by `@Order`/`Ordered`), and `@Primary` is irrelevant.
- Constructor injection is preferred over field injection: it enables `final` fields, guarantees fully-initialized objects, exposes too-many-dependencies as a code smell, and needs no reflection for tests. With a single constructor, `@Autowired` is optional since Spring 4.3.

---

## Common follow-up questions

- **Are `@Service` and `@Component` different at runtime?** No behavioral difference today; `@Service` is a semantic marker meta-annotated with `@Component`. Only `@Repository` adds runtime behavior (exception translation).
- **What does `@RestController` add over `@Controller`?** It's `@Controller` + `@ResponseBody`, so return values are serialized to the response body instead of being resolved as view names.
- **Why is `@Configuration` proxied with CGLIB?** So inter-`@Bean`-method calls return the shared container singleton rather than creating new instances. `proxyBeanMethods = false` (lite mode) disables this for faster startup when not needed.
- **`@Bean` vs `@Component`?** `@Bean` = method-level, explicit, ideal for third-party/config-heavy beans; `@Component` = class-level, scanned, for your own classes.
- **How does component scanning read classes without loading them?** ASM-based metadata reading in `ClassPathScanningCandidateComponentProvider`.
- **`@Primary` vs `@Qualifier` precedence?** `@Qualifier` at the injection point beats `@Primary`.
- **`${}` vs `#{}`?** Property placeholder vs SpEL. Placeholders resolve first; SpEL is a full expression language.
- **Why does `@Value("${x}")` fail at startup?** No such property and no default → unresolved placeholder → `IllegalArgumentException`.
- **Field vs constructor injection?** Prefer constructor: immutability (`final`), testability, explicit dependencies, no reflection, fail-fast on missing deps.
- **JDK proxy vs CGLIB for AOP?** JDK dynamic proxy when the bean implements an interface (proxies the interface); CGLIB subclass when there's no interface (or `proxyTargetClass=true`). `@Configuration` always uses CGLIB.
- **Does exception translation work if I catch and rethrow inside the repository?** No — translation happens at the proxy boundary on exceptions propagating out; swallowing them bypasses it.

## References

- Spring Framework Reference — Core / IoC container: https://docs.spring.io/spring-framework/reference/core/beans.html
- Classpath scanning & managed components: https://docs.spring.io/spring-framework/reference/core/beans/classpath-scanning.html
- `@Configuration` / `@Bean` (full vs lite): https://docs.spring.io/spring-framework/reference/core/beans/java/basic-concepts.html and Javadoc for `@Configuration#proxyBeanMethods`
- Exception translation / `@Repository`: https://docs.spring.io/spring-framework/reference/data-access/orm/general.html
- Spring Expression Language (SpEL): https://docs.spring.io/spring-framework/reference/core/expressions.html
- Baeldung — Spring stereotype annotations: https://www.baeldung.com/spring-component-repository-service
- Baeldung — `@Component` vs `@Bean`: https://www.baeldung.com/spring-component-annotation
- Baeldung — `@Primary` / `@Qualifier`: https://www.baeldung.com/spring-qualifier-annotation
- Baeldung — `@Value` and SpEL: https://www.baeldung.com/spring-value-annotation
