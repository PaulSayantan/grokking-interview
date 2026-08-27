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

Deeper points a senior interviewer probes:
- **Proxy type**: because the advisor is added by a `BeanPostProcessor`, the `@Repository` bean is wrapped like any other AOP-advised bean — a JDK dynamic proxy if it implements an interface, CGLIB otherwise. **Self-invocation** (one method of the DAO calling another `this.foo()`) bypasses the proxy, so a translated exception is only guaranteed at the *external* call boundary.
- **`SQLException` is NOT auto-translated for raw JDBC.** Plain `SQLException` from a hand-written `Connection`/`PreparedStatement` is a checked exception and there is no registered translator that runs on it unless you go through `JdbcTemplate` (which uses a `SQLExceptionTranslator` reading the DB's `SQLState`/vendor error codes). `PersistenceExceptionTranslationPostProcessor` only chains registered `PersistenceExceptionTranslator` beans, which target JPA/Hibernate `RuntimeException`s — not checked `SQLException`.
- Translation is **independent of `@Transactional`**: you do not need a transaction for translation to occur, and translation happens *inside* the transactional advice ordering only if both advisors apply. Adding `@Transactional` does not enable translation and vice versa.
- If a raw exception has **no** matching translator, `translateExceptionIfPossible` returns `null` and the original exception propagates unchanged — translation is best-effort, never a guaranteed wrap.

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

Advanced internals & gotchas:
- **`@AliasFor` contract**: aliased attributes must declare the same return type, a default value, and be mutually pointing (or the composed side points to the meta side with `annotation = X.class`). Violating the contract throws `AnnotationConfigurationException` at first resolution, not at compile time.
- **Attribute overrides without `@AliasFor`**: since Spring 4.2, a composed annotation can *implicitly* override a meta-annotation attribute simply by declaring an attribute of the same name and type — `@AliasFor` is only needed for renaming or explicit cross-annotation aliasing. Two meta-annotations declaring a same-named attribute that both feed a lower level create an ambiguous override that Spring rejects.
- **Retention/Target matter**: a meta-annotation is only discoverable at runtime if it is `@Retention(RUNTIME)`. Spring's `@Component` is runtime-retained; if you compose with a `SOURCE`/`CLASS`-retained annotation, Spring cannot see it.
- **`@Inherited` vs Spring search**: Java's `@Inherited` only propagates *class-level* annotations to subclasses and is ignored for interfaces and meta-annotations. Spring's `MergedAnnotations` does its own transitive + interface-aware search, so stereotypes are found on superclasses/implemented interfaces regardless of `@Inherited`. This is why `@Transactional` on an interface method is honored by Spring even though standard Java reflection would not report it as inherited.
- **`MergedAnnotations.SearchStrategy`** governs how deep the search goes (`DIRECT`, `INHERITED_ANNOTATIONS`, `SUPERCLASS`, `TYPE_HIERARCHY`, `TYPE_HIERARCHY_AND_ENCLOSING_CLASSES`). This is the engine behind `@Transactional`/qualifier resolution across a type hierarchy.
- **Component-scan filter caveat**: the default `AnnotationTypeFilter(Component.class)` used by scanning is created with `considerMetaAnnotations=true` but `considerInterfaces=false` and does **not** traverse superclasses. So a concrete subclass that merely *extends* an `@Component`/`@Service`-annotated base (without its own stereotype) is **not** auto-registered — the annotation is not "inherited" for scanning purposes. Put the stereotype on the concrete class.
- **Abstract classes and interfaces are not candidate components**: `isCandidateComponent` requires the class to be *independent and concrete* (an abstract `@Component` base is skipped unless it declares `@Lookup` methods). This is why you annotate concrete implementations, not abstract templates or interfaces.

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

Ordering, naming, and duplicate-definition gotchas:
- **Scanning order is non-deterministic across the classpath** (filesystem/jar iteration order), so you must never rely on discovery order for bean creation. Bean *instantiation* order is driven by the dependency graph, not scan order. For ordered collection injection use `@Order`/`Ordered`, never scan order.
- **Bean name collisions**: two scanned classes with the same simple name in different packages both default to the same bean name (decapitalized simple name) → `ConflictingBeanDefinitionException` at startup. Fix with explicit `@Component("fullyQualifiedOrUnique")`. The default name is produced by `AnnotationBeanNameGenerator`.
- **Override vs conflict**: a *scanned* definition colliding with another *scanned* definition throws `ConflictingBeanDefinitionException`. A definition overriding one from a different source (e.g. a `@Bean` vs a scanned bean of the same name) is governed by `spring.main.allow-bean-definition-overriding`, which Spring Boot **defaults to `false`** since 2.1 — so a silent override becomes a startup failure unless explicitly enabled.
- **`@ComponentScan` is repeatable/aggregated**: multiple `@ComponentScan` declarations (including via imported configs) union their base packages. Scanning the same package twice does not create duplicate beans because bean definitions are keyed by name in the registry.

Performance: the ASM `MetadataReader` results are cached per scan; a huge classpath with broad base packages still costs startup time. The **Spring Context Indexer** (`spring-context-indexer`, generating `META-INF/spring.components` at compile time via an annotation processor) replaces runtime classpath scanning with an index lookup — useful for large apps or constrained/AOT environments. Note it is largely superseded by GraalVM-native/AOT processing in Boot 3.

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

**CGLIB restrictions that follow from full mode** (the class is subclassed at startup):
- The `@Configuration` class **must not be `final`** and must be subclassable — no `private` constructor that CGLIB can't call. Constructors are allowed (including `@Autowired` constructor injection into the config class), so a no-arg constructor is *not* required.
- `@Bean` methods **must not be `private` or `final`**, because the generated subclass overrides them to insert the container-lookup interception. A `private`/`final` `@Bean` method silently loses interception (it can't be overridden), so inter-bean calls to it create new instances — a subtle correctness bug, not a compile error.
- `@Bean` methods should not be `static` in full mode *if* you want interception — but `static` `@Bean` methods are exactly the right choice for `BeanPostProcessor`/`BeanFactoryPostProcessor` beans (see below).

**`static` `@Bean` methods for `BeanPostProcessor` / `BeanFactoryPostProcessor`:** these infrastructure beans must be instantiated **very early**, before the enclosing `@Configuration` class is fully processed and before other beans are wired. Declaring them `static` decouples them from the config-class instance, so Spring can create them without prematurely instantiating (and only partially configuring) the `@Configuration` class. If you declare such a `@Bean` method non-`static`, Spring must instantiate the config class early to call it, which can cause `@Autowired`/`@Value` on the config class to be **skipped/not-yet-applied** and typically logs a warning like *"is not eligible for getting processed by all BeanPostProcessors"*. Rule: **post-processor `@Bean` methods → `static`.**

**`@Configuration` cannot itself be advised by user AOP** in the normal sense — the CGLIB enhancement is Spring's own; you don't stack a `@Transactional`-style proxy on the config class's `@Bean` methods.

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

Processing order and phases (why `DeferredImportSelector` exists):
- `@Import` targets are processed by `ConfigurationClassPostProcessor` (a `BeanDefinitionRegistryPostProcessor`) while parsing configuration classes — **before** any regular bean is instantiated. This is why an `ImportSelector`/`ImportBeanDefinitionRegistrar` can only see *metadata*, not live beans, and cannot itself be `@Autowired` with application beans.
- A plain `ImportSelector` runs **during** the parsing of the config class that imports it. A `DeferredImportSelector` runs **after all other configuration classes have been processed**, so user configuration and `@Conditional` state are known — essential for auto-configuration, which must be overridable by user beans and evaluated last. `DeferredImportSelector.Group` further lets Boot sort and batch auto-config imports (respecting `@AutoConfigureOrder`/`@AutoConfigureBefore`/`@AutoConfigureAfter`).
- An `ImportSelector`/`Registrar` may implement `Aware` interfaces (`EnvironmentAware`, `BeanFactoryAware`, `ResourceLoaderAware`, `BeanClassLoaderAware`) to get container callbacks *before* it selects/registers — this is the supported way to make import decisions based on the `Environment`.
- **Importing a non-`@Configuration` regular class** via `@Import(SomePojo.class)` registers that class as a bean directly (since Spring 4.2) — a lesser-known way to register a single bean without a stereotype or `@Bean` method.
- Duplicate `@Import` of the same `@Configuration` class is de-duplicated; the config class is processed once.

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

Timing, relaxed binding, and subtle failures:
- **`@Value` does NOT do relaxed binding.** `@Value("${my.app-name}")` matches `my.app-name` exactly; it will not find `MY_APP_NAME`/`my.appName` the way `@ConfigurationProperties` does. Environment variable resolution works only because Spring's `PropertySource` for env vars adds mapped names — but the placeholder key must still resolve. This is a common "works in `@ConfigurationProperties`, fails in `@Value`" trap.
- **`@Value` is resolved by a `BeanPostProcessor`** (`AutowiredAnnotationBeanPostProcessor`). Therefore, like `@Autowired`, it **cannot be used inside a `BeanPostProcessor` or `BeanFactoryPostProcessor`** — those run too early and their own `@Value` fields will be `null`. Configuration values needed that early must be read from the `Environment` directly.
- **Field `@Value` fires after construction**, so referencing a `@Value` field from within a constructor sees the default (`null`/0). Only constructor-parameter `@Value` is available at construction time.
- **Escaping**: a literal `${` is written `\${`; nested/recursive placeholders (`${outer.${inner}}`) are supported. `${a:${b}}` uses another placeholder as the default.
- **`#{...}` vs `${...}` evaluation order**: placeholders are resolved *first* by the `PropertySourcesPlaceholderConfigurer` (a `BeanFactoryPostProcessor`), then the SpEL is evaluated by the bean post-processor at injection time. So `#{'${some.list}'.split(',')}` first substitutes the property, then runs SpEL on the resulting string.
- **`@Value` on a `static` field does nothing** — Spring only injects instance fields.

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

Evaluation-context and security nuances an interviewer may push on:
- **`@Value` SpEL runs in a `StandardEvaluationContext`** (full-power: type references via `T(...)`, bean references via `@`, method calls). By contrast, **SpEL in `@Cacheable`/`@PreAuthorize` uses a `MethodBasedEvaluationContext`** exposing method arguments as `#argName` (requires `-parameters` compilation or `@P`/`p[0]` indices) plus root objects like `#root`. Mixing these up is a classic mistake.
- **`#this` vs `#root`**: in collection selection/projection, `#this` is the current element; `#root` is the top-level context object.
- **Compiler modes**: SpEL can run interpreted (default) or be bytecode-compiled (`SpelCompilerMode.IMMEDIATE`/`MIXED`) for hot expressions. Compilation trades startup work for faster repeated evaluation; incompatible expressions fall back to interpretation in `MIXED`.
- **Security**: evaluating user-supplied strings as SpEL against a `StandardEvaluationContext` is a remote-code-execution risk (e.g. SpEL injection via `T(java.lang.Runtime)`). Untrusted expressions should use a `SimpleEvaluationContext`, which disables type references, bean references, and constructor calls.
- **`@` bean reference resolution** happens against the `BeanFactory`; `@systemProperties`/`@systemEnvironment`-style access uses implicit variables (`systemProperties`, `systemEnvironment`) — note those are variables, not beans, so they use `#{systemProperties['x']}` not `#{@systemProperties...}`.

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

Edge cases and precise failure modes:
- **Two `@Primary` beans of the same type** re-introduce ambiguity: Spring requires *exactly one* primary among candidates, so two primaries → `NoUniqueBeanDefinitionException` ("more than one 'primary' bean found").
- **`@Fallback` (Spring Framework 6.2+)** is the inverse of `@Primary`: it demarcates *non-preferred* beans, so if only one non-fallback (regular) bean remains it becomes effectively primary. Useful when a library supplies a default you want auto-superseded by any user bean.
- **`@Qualifier` semantics are AND-matched, not just name-matched.** `@Qualifier("x")` matches a bean whose id is `x` *or* which carries `@Qualifier("x")` on its definition. You can define custom qualifier annotations (`@Qualifier`-meta-annotated) with attributes, and Spring matches all attributes.
- **Resolution algorithm precedence (single-valued injection)**: (1) narrow by type; (2) apply `@Qualifier`/custom qualifiers to narrow candidates; (3) among survivors pick the `@Primary` one; (4) consider `@Priority` (lower value = higher priority, JSR-250, class-level only); (5) fall back to matching the injection-point *name* against a bean name; else fail. Note `@Priority` participates in *single* injection tie-breaking (after primary), whereas for *collection* ordering `@Order`/`Ordered`/`@Priority` sort but never filter.
- **`@Order` does not affect singleton startup/instantiation order** — that is determined purely by the dependency graph and `@DependsOn`. `@Order` only affects the order of elements handed to a *collection injection point* (and the order among `@Configuration` classes / AOP advisors). Confusing these is a common trap.
- **`@Order` on a `@Configuration` class** orders the config classes, not their `@Bean` methods; each `@Bean` needs its own `@Order` for collection ordering. `@Priority` cannot be placed on `@Bean` methods (methods can't carry it), so model bean-level priority with `@Order` + `@Primary`.
- **`Map<String, T>` injection** yields all beans of type `T` keyed by bean name. `ObjectProvider<T>` gives lazy, optional, and stream access (`getIfAvailable`, `getIfUnique`, `orderedStream()`), and is the idiomatic way to handle 0-or-many candidates without `required=false` gymnastics.
- **`@Autowired(required=false)`** leaves a field/setter untouched if unsatisfied; for *constructor* args the semantics differ — a single autowired constructor with unsatisfiable args means the bean can't be created unless the arg is an `Optional`/`@Nullable`/multi-element type (which resolves to empty). Only one constructor may be `required=true`.
- **Self-injection** is supported but is a last-resort fallback (used to call a method through the bean's own proxy, e.g. to make `@Transactional`/`@Cacheable` self-invocation work). A self-reference is never treated as `@Primary` and always has lowest precedence.
- **`@Resource` (JSR-250) resolves by name first, then type** — the opposite default of `@Autowired` (type first). This matters when a field name accidentally matches a different bean.

## Bean naming and BeanNameGenerator

The default bean name for a scanned stereotype is the **decapitalized simple class name** (`AnnotationBeanNameGenerator`) — `PaymentService` → `paymentService`. Two edge rules bite in interviews:
- **Consecutive leading capitals are NOT decapitalized** (per `java.beans.Introspector.decapitalize`): `URLParser` stays `URLParser`, and `RESTClient` stays `RESTClient`. This surprises people expecting `uRLParser`.
- An explicit value in the stereotype (`@Service("x")`) or `@Bean("x")`/`@Bean(name={...})` overrides and can supply aliases.
- Spring Boot's default uses `AnnotationBeanNameGenerator`; you can supply a `FullyQualifiedAnnotationBeanNameGenerator` (fully-qualified class name as the bean name) to avoid simple-name collisions across packages — set via `@ComponentScan(nameGenerator=...)` or `SpringApplicationBuilder`.
- `@Bean` method names are the bean names and are **not** decapitalized (they're already method-case). Overloaded `@Bean` methods of the same name are discouraged — only one definition survives, which is a silent footgun.

## Bean scopes and scoped-proxy interaction with stereotypes

Stereotypes default to **singleton** scope. Adding `@Scope("prototype")`, `@RequestScope`, `@SessionScope`, etc. changes lifecycle but introduces the classic **scoped-bean-injected-into-a-singleton** problem: a singleton captures the *first* instance forever. The fix is a **scoped proxy** (`@Scope(value="request", proxyMode=ScopedProxyMode.TARGET_CLASS)` or the meta-annotations `@RequestScope`/`@SessionScope` which set it for you). The proxy is a CGLIB/JDK proxy that, on each method call, resolves the correct scoped instance from the current scope context.
- Prototype beans are **created but not fully managed** — Spring does not call destruction callbacks (`@PreDestroy`/`DisposableBean`) on prototypes; the container hands off lifecycle responsibility. This is a frequent leak/gotcha.
- To get a fresh prototype on each use inside a singleton without scoped proxies, use `ObjectProvider<T>`/`Provider<T>` or method (lookup) injection (`@Lookup`).

## Lazy initialization and @Lazy nuances

`@Lazy` on a bean defers its creation until first use. On an **injection point**, `@Lazy` causes Spring to inject a lazy-resolving proxy, which is also a legitimate tool to **break a circular dependency** at the injection site (defer resolving one side). Spring Boot's global `spring.main.lazy-initialization=true` makes everything lazy — great for fast dev startup but hides wiring/`@Value` errors until runtime and can shift latency to the first request. `@Lazy` combined with `@Primary` on the same bean still resolves lazily; laziness and primacy are orthogonal.

## Conditional bean registration (@Conditional family)

`@Conditional` (and Boot's `@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`, `@ConditionalOnBean`, `@Profile`) gate whether a bean *definition* is registered. Two internals worth knowing:
- Conditions are evaluated by `ConfigurationClassPostProcessor` at **parse/registration time**, before instantiation. `@ConditionalOnBean`/`@ConditionalOnMissingBean` are therefore **order-sensitive**: they only see beans/definitions registered *so far*, which is why they are reliable only inside auto-configuration (ordered, runs after user config) and are discouraged in user configuration.
- `ConfigurationCondition` lets a condition declare a phase (`PARSE_CONFIGURATION` vs `REGISTER_BEAN`) to control when it is checked relative to definition registration.
- `@Profile` is itself implemented as a `@Conditional(ProfileCondition.class)` meta-annotation.

## AOT, GraalVM native image, and proxies

In Spring Boot 3 AOT / GraalVM native builds, CGLIB proxying and runtime classpath scanning are problematic (no bytecode generation, closed-world reflection). Spring's AOT engine pre-computes bean definitions at build time and generates proxy classes ahead of time. Practical consequences:
- `@Configuration(proxyBeanMethods=false)` (lite mode) is preferred in native/AOT because it avoids the CGLIB subclass entirely; many Boot auto-configs already use it.
- Reflection/proxy hints may be required for custom qualifier annotations, `@Value` targets accessed reflectively, and JDK-proxy-based beans.
- Component scanning still works via AOT-generated metadata, but heavy reliance on runtime-`@Conditional` decisions is frozen at build time — a condition that depends on runtime environment must be re-expressed as a build-time or a `@ConditionalOn*` that AOT can evaluate consistently.

---

## Common follow-up questions

- Are `@Service` and `@Component` different at runtime? No behavioral difference today; `@Service` is a semantic marker meta-annotated with `@Component`. Only `@Repository` adds runtime behavior (exception translation).
- What does `@RestController` add over `@Controller`? It's `@Controller` + `@ResponseBody`, so return values are serialized to the response body instead of being resolved as view names.
- Why is `@Configuration` proxied with CGLIB? So inter-`@Bean`-method calls return the shared container singleton rather than creating new instances. `proxyBeanMethods = false` (lite mode) disables this for faster startup when not needed.
- `@Bean` vs `@Component`? `@Bean` = method-level, explicit, ideal for third-party/config-heavy beans; `@Component` = class-level, scanned, for your own classes.
- How does component scanning read classes without loading them? ASM-based metadata reading in `ClassPathScanningCandidateComponentProvider`.
- `@Primary` vs `@Qualifier` precedence? `@Qualifier` at the injection point beats `@Primary`.
- `${}` vs `#{}`? Property placeholder vs SpEL. Placeholders resolve first; SpEL is a full expression language.
- Why does `@Value("${x}")` fail at startup? No such property and no default → unresolved placeholder → `IllegalArgumentException`.
- Field vs constructor injection? Prefer constructor: immutability (`final`), testability, explicit dependencies, no reflection, fail-fast on missing deps.
- JDK proxy vs CGLIB for AOP? JDK dynamic proxy when the bean implements an interface (proxies the interface); CGLIB subclass when there's no interface (or `proxyTargetClass=true`). `@Configuration` always uses CGLIB.
- Does exception translation work if I catch and rethrow inside the repository? No — translation happens at the proxy boundary on exceptions propagating out; swallowing them bypasses it.
- Why must post-processor `@Bean` methods be `static`? So Spring can create them very early without prematurely instantiating the (not-yet-fully-configured) `@Configuration` class; non-static risks skipped `@Autowired`/`@Value` and a warning.
- Can a `@Bean` method be `private` or `final` in full `@Configuration`? No — the CGLIB subclass must override `@Bean` methods to intercept them; `private`/`final` methods lose interception silently.
- What happens with two `@Primary` beans of the same type? `NoUniqueBeanDefinitionException` — Spring needs exactly one primary. `@Fallback` (6.2+) is the inverse marker.
- Difference between an `ImportSelector` and a `DeferredImportSelector`? The deferred one runs after all other config classes are parsed (so it sees the full picture and user overrides) — the basis of auto-configuration ordering.
- Does `@Order` change bean creation order? No — only collection-injection ordering and config/advisor ordering. Instantiation order follows the dependency graph and `@DependsOn`.
- Why can't `@Value`/`@Autowired` be used inside a `BeanFactoryPostProcessor`? Those post-processors run before the annotation-processing `BeanPostProcessor`, so the fields aren't injected yet — read the `Environment` directly.
- Does `@Value` support relaxed binding like `@ConfigurationProperties`? No — the placeholder key must match exactly.
- Are prototype beans' `@PreDestroy` callbacks invoked? No — the container does not manage prototype destruction.

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
