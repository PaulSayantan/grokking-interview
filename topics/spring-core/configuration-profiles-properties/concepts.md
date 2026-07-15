# Configuration, Profiles, and Externalized Properties

This topic covers how the **Spring Framework** (the core container, not Spring Boot) defines beans through Java-based configuration, how it models external configuration through the `Environment` and `PropertySource` abstractions, how values are injected and resolved with placeholders, and how profiles let you switch bean definitions per environment.

> Scope note: This is the **core Spring Framework** view. Spring Boot layers auto-configuration, `application.properties`/`application.yml` loading, relaxed binding, `@ConfigurationProperties`, and the `spring.config.*` machinery *on top of* these primitives. Wherever a feature is Boot-specific, it is called out explicitly. On **Spring Framework 6.x** the container runs on **Jakarta EE 9+** (packages moved from `javax.*` to `jakarta.*`); annotations like `@PostConstruct` now come from `jakarta.annotation`.

---

## Configuration and Bean

`@Configuration` marks a class as a source of bean definitions. Methods annotated with `@Bean` inside it declare beans; the **method name is the bean name** and the **return value is the bean instance** registered in the `ApplicationContext`.

```java
@Configuration
public class AppConfig {

    @Bean
    public DataSource dataSource() {
        return new HikariDataSource(/* ... */);
    }

    @Bean
    public OrderService orderService() {
        // Inter-bean reference: calling dataSource() returns the SAME
        // singleton, not a new instance, because of CGLIB enhancement.
        return new OrderService(dataSource());
    }
}
```

### Full (proxied) vs lite bean methods

A `@Configuration` class is **enhanced by a CGLIB subclass** at runtime (`proxyBeanMethods = true`, the default). The subclass intercepts calls to `@Bean` methods so that a direct method call (like `dataSource()` above) returns the container-managed singleton rather than executing the method body again. This preserves singleton scoping and inter-bean references.

If you set `@Configuration(proxyBeanMethods = false)` — or declare `@Bean` methods in a class that is **not** annotated with `@Configuration` (a "lite" configuration, e.g. a plain `@Component`) — no CGLIB proxy is created. Direct calls between `@Bean` methods then execute the method again and do **not** route through the container, so singleton guarantees between such calls are lost. Setting `proxyBeanMethods = false` is a startup-performance optimization used when a config class has no inter-bean method calls.

| Aspect | `@Configuration` (proxyBeanMethods=true) | Lite `@Bean` / proxyBeanMethods=false |
|---|---|---|
| CGLIB subclass created | Yes | No |
| Inter-`@Bean` method call returns singleton | Yes (intercepted) | No (fresh invocation) |
| Class must be non-final, methods non-final/non-private | Yes | Not required |
| Startup cost | Slightly higher | Lower |

### Registering configuration classes

```java
// Programmatic bootstrap of the core container
ApplicationContext ctx =
    new AnnotationConfigApplicationContext(AppConfig.class);
OrderService svc = ctx.getBean(OrderService.class);
```

`@Bean` attributes worth knowing: `name`/`value` (override/alias the bean name), `initMethod`, `destroyMethod` (lifecycle callbacks; `destroyMethod` defaults to auto-detecting a public `close()`/`shutdown()` method — set `destroyMethod = ""` to disable), and `autowireCandidate`. Scope is set with a separate `@Scope` annotation. `@Bean` method parameters are autowired by the container (by type), which is the idiomatic way to reference beans from other configuration classes.

Configuration classes can be composed with `@Import(OtherConfig.class)` and can enable features via `@Enable*` annotations (e.g. `@EnableAspectJAutoProxy`).

### Gotcha: interception is per-instance, not cross-class

The CGLIB interception only applies to `@Bean` method calls **on the same enhanced configuration instance**. If `ConfigA` and `ConfigB` are separate `@Configuration` classes, `ConfigA` cannot call `new ConfigB().someBean()` and expect the container singleton — it would run the un-enhanced method body. The correct pattern is to declare the dependency as a **`@Bean` method parameter** (autowired by type) or `@Autowired` a field. Also note `static` `@Bean` methods are **never** intercepted (they are invoked directly on the class), which is exactly why infrastructure beans like `BeanFactoryPostProcessor`s are declared static — but it also means that calling a `static` `@Bean` method *from* another `@Bean` method bypasses the proxy (a static invocation is never intercepted), so that call runs the raw method body and does **not** return the managed singleton.

---

## PropertySource annotation

`@PropertySource` adds a properties file to the `Environment`'s set of `PropertySource`s. It is declared on a `@Configuration` class and is processed when the context is refreshed.

```java
@Configuration
@PropertySource("classpath:app.properties")
public class AppConfig {

    @Autowired
    Environment env;

    @Bean
    public MyClient client() {
        return new MyClient(env.getProperty("api.url"));
    }
}
```

Key points:

- The `value` supports **resource location strings** with placeholders resolved against already-registered sources, e.g. `@PropertySource("classpath:${env.name}.properties")`.
- `@PropertySource` is **repeatable** (Java 8+); you can also use the container `@PropertySources`. When multiple sources define the same key, **the last one wins** for a given `@PropertySource` set — ordering matters.
- `ignoreResourceNotFound = true` suppresses the error if the file is missing (useful for optional overrides). By default a missing resource throws.
- `encoding` can be set (e.g. `UTF-8`).
- `name` lets you assign an explicit name to the registered `PropertySource` (otherwise it is derived from the resource description).
- `factory` lets you plug a custom `PropertySourceFactory` — the standard trick to support **YAML** files in core Spring (there is no built-in `@PropertySource` YAML support in the framework).

**Crucial limitation:** `@PropertySource` only understands `.properties` (and XML properties) files out of the box, and it does **not** support `.yml`/`.yaml` without a custom factory. Also, `@PropertySource` is evaluated relative to the `Environment`; it does not by itself enable `${...}` placeholder resolution in `@Value` — that requires a `PropertySourcesPlaceholderConfigurer` (auto-registered when using annotation config).

### Ordering gotcha: @PropertySource is appended, so it loses to system properties

`@PropertySource` files are added to the **end** of the `MutablePropertySources` list via `addLast`, which means they sit at the **lowest precedence** — behind `systemProperties` and `systemEnvironment`. A common surprise: a value set in your `app.properties` will be silently overridden by an OS env var or `-D` system property of the same (normalized) name, because those sources are consulted first. If you need a file to override system properties you must reorder the sources programmatically (e.g. via an `EnvironmentPostProcessor`-style hook, or a `BeanFactoryPostProcessor` that mutates `getPropertySources()` before resolution).

### Ordering gotcha: multiple @PropertySource across classes

Within a single `@PropertySource` set, "last wins." But across multiple `@Configuration` classes, the effective order depends on **the order in which the configuration classes are processed** (import order, `@Order` on config classes does *not* affect this — bean-definition processing order does). Because each `@PropertySource` uses `addLast`, a later-processed configuration's file will actually sit *below* an earlier one only if the earlier one was registered first. Two files with the same name (derived from the resource) are **merged into a `CompositePropertySource`**, not lost: `PropertySourceProcessor` detects the name collision and combines them, adding the newly processed source *first* inside the composite so it **wins per key**, while the earlier source's non-overlapping keys are retained. (This is the current behavior; older Spring versions instead replaced the entry in place, which could drop the earlier file's keys.) Give each source an explicit `name` only if you want them kept as separate, independently-ordered sources rather than merged.

### Timing gotcha: @PropertySource cannot feed @Profile evaluation

`@PropertySource` is processed by `ConfigurationClassPostProcessor` while parsing configuration classes, but the properties it adds are **not available early enough to influence which profiles are active** — profile activation (`spring.profiles.active`) is read from the `Environment` before your `@PropertySource` files are loaded. You therefore cannot activate a profile from a key placed inside a file loaded by `@PropertySource`. (Spring Boot's config-data machinery solves this separately; core Spring does not.)

---

## Environment abstraction

`Environment` is the container's model of two things: the **profiles** that are active, and the **properties** available. It is exposed as a bean and injected via `@Autowired Environment env` or obtained from `ctx.getEnvironment()`.

Two responsibilities:

1. **Profiles** — `getActiveProfiles()`, `getDefaultProfiles()`, and `acceptsProfiles(Profiles)` decide which profile-scoped beans are eligible.
2. **Properties** — `getProperty(String)`, `getProperty(key, defaultValue)`, `getProperty(key, TargetType.class)`, `getRequiredProperty(...)`, and `containsProperty(...)`. These delegate to an ordered list of `PropertySource`s.

### PropertySource and PropertySources

A `PropertySource<T>` is a named key/value source (backed by a `Map`, `Properties`, JNDI, servlet params, etc.). The `Environment` for a standalone app is a `StandardEnvironment`, whose `MutablePropertySources` contains, by default and **in precedence order (first wins)**:

1. `systemProperties` — JVM system properties (`-Dkey=value`, `System.getProperties()`).
2. `systemEnvironment` — OS environment variables (`System.getenv()`).

Web apps use `StandardServletEnvironment`, which additionally includes servlet config/context init params and JNDI, ordered ahead of the standard sources.

```
Resolution order (higher = checked first):
  [ ServletConfig initParams ]      (web only)
  [ ServletContext initParams ]     (web only)
  [ JNDI ]                          (web only)
  [ systemProperties ]              -Dfoo=bar
  [ systemEnvironment ]             OS env vars
  [ @PropertySource files ]         added by your config
```

You can inspect and reorder sources programmatically:

```java
ConfigurableEnvironment env = ctx.getEnvironment();
MutablePropertySources sources = env.getPropertySources();
sources.addFirst(new MapPropertySource("overrides", Map.of("api.url", "http://local")));
```

### Property name resolution and relaxed access

Core Spring does **not** do Spring Boot's "relaxed binding". However, `systemEnvironment` uses a `SystemEnvironmentPropertySource` that tolerates lookups where dots/hyphens map to underscores and case differences — so `getProperty("api.url")` can be satisfied by an env var `API_URL`. This behavior is limited to the system-environment source.

Type conversion in `getProperty(key, Class)` uses the `Environment`'s `ConversionService` (a `DefaultConversionService` by default).

### SystemEnvironmentPropertySource name mangling (exact rules)

The relaxed lookup on the system-environment source is precise, not magic. When you ask for a key like `api.url`, `SystemEnvironmentPropertySource.getProperty` tries, in order: (1) the exact name; (2) the name with `.` replaced by `_` (`api_url`); (3) the uppercased original (`API.URL`); (4) uppercased with `.`→`_` (`API_URL`). Hyphens `-` are treated the same as dots for replacement. This is **only** implemented by `SystemEnvironmentPropertySource` — a plain `MapPropertySource` or a `@PropertySource` file does **no** such normalization, so `getProperty("api.url")` will not find a file key spelled `API_URL`. This is why env-var overrides "just work" but file-based ones require exact key spelling.

### Thread-safety and mutation timing

`MutablePropertySources` is backed by a `CopyOnWriteArrayList`, so reads are safe under concurrency, but you should perform structural changes (add/remove/reorder sources) **before or during context refresh**, not while the running application is resolving properties on many threads — reordering at runtime can produce inconsistent reads for values captured at injection time versus values read live via `Environment.getProperty`. Values injected via `@Value` are resolved **once at bean creation** and cached in the field; they do **not** track later changes to a `PropertySource`. Only live `Environment.getProperty(...)` calls (or a refreshed/`@RefreshScope` bean in Spring Cloud) see subsequent mutations.

### Custom conversion pitfall

The `Environment`'s `ConversionService` is separate from the `ApplicationContext`'s bean-level `ConversionService`. Registering a `ConversionServiceFactoryBean` (or a `conversionService` bean) customizes `@Value`/property-binding conversion, but `ConfigurableEnvironment.setConversionService(...)` must be called to change what `Environment.getProperty(key, Class)` uses. Confusing the two is a classic reason a custom `Converter` "isn't picked up" for typed environment lookups.

---

## Value with placeholders and defaults

`@Value` injects a value into a field, constructor parameter, or method parameter. Its argument is a string that may contain **property placeholders** `${...}` and/or **SpEL expressions** `#{...}`.

```java
@Component
public class MailClient {

    @Value("${mail.host}")                    // required property
    private String host;

    @Value("${mail.port:25}")                 // default 25 if absent
    private int port;

    @Value("${mail.from:noreply@example.com}") // string default
    private String from;

    @Value("#{ systemProperties['user.region'] ?: 'us' }") // SpEL, not placeholder
    private String region;

    @Value("${mail.retries:3}")
    private int retries;
}
```

- **Placeholder `${...}`** is resolved against the `Environment`/`PropertySource`s by a `PropertySourcesPlaceholderConfigurer`.
- **Default value** uses a colon: `${key:default}`. Without a default, a missing key throws `IllegalArgumentException` ("Could not resolve placeholder") at bean creation — unless placeholder resolution is configured to ignore unresolvable placeholders.
- **SpEL `#{...}`** is evaluated by the SpEL engine and is a *different* mechanism from `${...}`. You can nest them: `#{'${some.key}'.toUpperCase()}` — the placeholder is resolved first, then SpEL runs.
- The escape character for a literal `${` is configurable (default `\`), e.g. `\${notAPlaceholder}`.

`@Value` can also inject collections/arrays from comma-separated properties via conversion, and can reference other beans via SpEL (`#{beanName.property}`).

### Resolution order and the two-pass model

There are actually two distinct processors involved. `${...}` placeholders are resolved by the `PropertySourcesPlaceholderConfigurer` (a `BeanFactoryPostProcessor`) which runs against `StringValueResolver`s. `#{...}` SpEL is evaluated by a `BeanExpressionResolver` (`StandardBeanExpressionResolver`) that the `AutowiredAnnotationBeanPostProcessor` invokes when populating the `@Value`. The key subtlety: the container **resolves `${...}` first** and **then** hands the *resulting* string to SpEL. Concretely, `DefaultListableBeanFactory.doResolveDependency` does `resolveEmbeddedValue(strValue)` (placeholder pass) and then `evaluateBeanDefinitionString(resolvedValue, bd)` (SpEL pass) on its output. So in `#{'${a}'.length()}` the placeholder is substituted into the string literal before SpEL parses it. A consequence that surprises people: because SpEL runs on the *post-placeholder* string, if a placeholder resolves to text that itself contains `#{...}`, that produced text **is** handed to the SpEL parser and gets evaluated — this is exactly the SpEL-injection risk of interpolating untrusted property values into `@Value`. (The reverse is not true: `${...}` is resolved only once, not re-scanned after SpEL runs.)

### Nested and recursive placeholders

Placeholders can be **nested**: `${${env}.datasource.url}` first resolves the inner `${env}` (say to `prod`) then resolves `${prod.datasource.url}`. Defaults nest too: `${a:${b:fallback}}`. But a placeholder that references itself (`x=${x}`) triggers a circular-reference `IllegalArgumentException`, not a stack overflow — PSPC detects the cycle.

### @Value on int/primitive with empty string

If a placeholder resolves to an empty string and the target is a primitive like `int`, conversion throws a `TypeMismatchException`/`NumberFormatException` at injection — not a silent zero. And `setNullValue` interacts badly here: resolving to the null-token for a primitive target produces a conversion failure because you cannot assign `null` to an `int`.

### @Value is resolved eagerly and cached

Because `@Value` is applied during bean population, the value is fixed for the bean's lifetime (for singletons, for the whole app). Two beans that both inject `@Value("${x}")` can observe **different** values only if the source changed between their creation times or they live in different contexts. For values that must change at runtime without a restart, read from `Environment` live or use Spring Cloud's `@RefreshScope` (not core Spring).

> Best practice: For grouped, typed configuration prefer constructor injection of individual `@Value`s sparingly; in Spring Boot you would use `@ConfigurationProperties` for binding whole objects — that is **not** a core-framework feature.

---

## PropertySourcesPlaceholderConfigurer

`PropertySourcesPlaceholderConfigurer` (PSPC) is a `BeanFactoryPostProcessor` that resolves `${...}` placeholders in bean definitions and in `@Value` annotations against the Spring `Environment`'s `PropertySource`s.

```java
@Configuration
public class PropertyConfig {

    @Bean
    public static PropertySourcesPlaceholderConfigurer pspc() {
        PropertySourcesPlaceholderConfigurer c =
            new PropertySourcesPlaceholderConfigurer();
        c.setIgnoreUnresolvablePlaceholders(false);
        c.setNullValue("@null");   // treat this token as null
        return c;
    }
}
```

Critical facts:

- The `@Bean` method that returns a `BeanFactoryPostProcessor` such as PSPC **must be `static`**. Because it is a `BeanFactoryPostProcessor`, it is instantiated very early — before the enclosing `@Configuration` class is fully processed — so a non-static method would prevent the configuration class from being handled correctly (you'll see a warning that the config class won't be enhanced).
- When you use annotation-based configuration (`@ComponentScan`/`AnnotationConfigApplicationContext` or `<context:property-placeholder/>` in XML), a PSPC is **registered for you automatically**, so `@Value("${...}")` works without manually declaring one. You declare one explicitly only to customize it (null value, prefix/suffix, ignore-unresolvable, ordering) or to add extra local properties.
- **PSPC vs the older `PropertyPlaceholderConfigurer`**: PSPC (Spring 3.1+) resolves against the `Environment`'s `PropertySources` (system properties, env vars, `@PropertySource` files, etc.). The legacy `PropertyPlaceholderConfigurer` resolves only against its own local `Properties` and optionally system properties via `systemPropertiesMode`. Prefer PSPC.
- PSPC operates on `String`-valued bean definition properties and `@Value`; it does not affect `Environment.getProperty(...)` calls (those already hit the sources directly).

### Multiple PSPCs and ordering

If you declare **more than one** `PropertySourcesPlaceholderConfigurer` (or mix in a legacy `PropertyPlaceholderConfigurer`), each is a `BeanFactoryPostProcessor` and runs according to its `Ordered`/`PriorityOrdered` rank. The critical trap: by default a PSPC has `ignoreUnresolvablePlaceholders = false`. If the first PSPC to run cannot resolve a placeholder it will **throw immediately**, before a second PSPC (which might have the value) ever gets a chance. The standard fix is to set `setIgnoreUnresolvablePlaceholders(true)` on all but the last configurer in the chain so that unresolved placeholders are passed through untouched to the next processor. Having two competing configurers with default settings is a frequent source of "Could not resolve placeholder" failures in modular apps.

### Why static, restated at the bytecode level

A `BeanFactoryPostProcessor` bean must be created before the `BeanFactoryPostProcessor` phase that enhances `@Configuration` classes finishes contributing bean definitions. If the `@Bean` method is an **instance** method, the container must instantiate the enclosing configuration class to call it — but that class may not yet be CGLIB-enhanced, so Spring logs a warning ("Cannot enhance @Configuration bean definition ... because its singleton instance has been created too early") and inter-bean singleton semantics for that class are lost. Declaring the method `static` lets the container invoke it **without instantiating** the configuration class, sidestepping the ordering problem entirely. This applies to every `BeanFactoryPostProcessor`/`BeanDefinitionRegistryPostProcessor` factory method, not just PSPC.

### PSPC does not resolve against beans, and runs before most beans exist

Because PSPC is a `BeanFactoryPostProcessor`, it runs before regular singletons are instantiated. It resolves purely against the `Environment`'s `PropertySource`s — it **cannot** call another bean to obtain a value. SpEL `#{...}` in `@Value` *can* reference beans, but only ones already available when that specific `@Value` is processed, which is a different (later) lifecycle point than PSPC's pass over bean-definition metadata.

| | PropertySourcesPlaceholderConfigurer | PropertyPlaceholderConfigurer (legacy) |
|---|---|---|
| Since | Spring 3.1 | Spring 2.x |
| Resolves against | `Environment` `PropertySource`s | Local `Properties` + system props |
| Env vars / system props integrated | Yes, via `Environment` | Only via `systemPropertiesMode` |
| Recommended | Yes | Deprecated in practice |

---

## Profile

`@Profile` conditionally registers beans (or entire `@Configuration` classes) based on which profiles are active in the `Environment`. A profile is just a named logical group.

```java
@Configuration
public class DataConfig {

    @Bean
    @Profile("dev")
    public DataSource devDataSource() {
        return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.H2).build();
    }

    @Bean
    @Profile("prod")
    public DataSource prodDataSource() {
        return new HikariDataSource(/* real db */);
    }
}
```

Profile expressions (Spring 5.1+ support boolean operators):

- `@Profile("prod")` — active when `prod` is active.
- `@Profile("!prod")` — active when `prod` is **not** active.
- `@Profile("prod & us-east")` — AND.
- `@Profile("dev | qa")` — OR.
- Parentheses group: `@Profile("prod & (us-east | eu-west)")`.

### Activating profiles

Profiles are activated (not by `@Profile`, which only *declares* eligibility) via any of:

- **`spring.profiles.active`** as a JVM system property: `-Dspring.profiles.active=prod,us-east` (comma-separated for multiple).
- The **`SPRING_PROFILES_ACTIVE`** environment variable.
- Programmatically before refresh:
  ```java
  AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext();
  ctx.getEnvironment().setActiveProfiles("prod", "us-east");
  ctx.register(AppConfig.class);
  ctx.refresh();
  ```
- In tests with `@ActiveProfiles("test")` (spring-test module).

`@Profile` can annotate a `@Bean` method, a `@Component`, or a whole `@Configuration` class (which then gates all its beans). Note `@Profile` is a `@Conditional(ProfileCondition.class)` under the hood; for arbitrary conditions use `@Conditional` directly.

Multiple active profiles are additive — beans from every active profile are registered. A bean **without** any `@Profile` is always registered regardless of active profiles.

### Profile is a registration-time condition, not a runtime toggle

`@Profile` (via `ProfileCondition`) is evaluated **once**, at configuration-class parsing / bean-definition registration time. It decides whether a bean definition is even added to the factory. It is *not* re-checked later, and you **cannot** change which profiled beans exist by calling `setActiveProfiles` after `refresh()`. This is why activating profiles must happen before refresh. It also means a `@Profile` bean that was skipped leaves **no** definition — a later `getBean` throws `NoSuchBeanDefinitionException`, and an `@Autowired` dependency on it fails unless marked optional or covered by a non-profiled fallback.

### Multiple @Profile beans of the same type = the injection ambiguity trap

If `devDataSource` (`@Profile("dev")`) and `prodDataSource` (`@Profile("prod")`) both return `DataSource`, activating **both** `dev` and `prod` registers **two** `DataSource` beans. A single-valued `@Autowired DataSource` then fails with `NoUniqueBeanDefinitionException`. Profiles are commonly assumed to be mutually exclusive, but the container does not enforce that — you must, via `@Primary`, `@Qualifier`, or ensuring the profile expressions are genuinely disjoint (e.g. `@Profile("prod")` vs `@Profile("!prod")`).

### Profile expression parsing details

Profile strings are parsed by `Profiles.of(...)`. Whitespace around operators is allowed; the operators are `&`, `|`, `!`, and parentheses. You **cannot mix** `&` and `|` at the same level without parentheses — `@Profile("a & b | c")` throws an `IllegalArgumentException` for ambiguous precedence; you must write `@Profile("(a & b) | c")` or `@Profile("a & (b | c)")`. A bare comma in the annotation array form `@Profile({"a","b"})` means **OR** (matches if *any* listed profile is active), which is a different semantic from the `&` operator — a subtle distinction candidates often miss.

---

## Default profile

The **default profile** is the profile whose beans are registered when **no** active profile is explicitly set. Its name is `default` unless changed.

- Query/inspect via `Environment.getDefaultProfiles()` (returns `{"default"}` by default).
- A bean annotated `@Profile("default")` is registered **only when no other profile is active**. As soon as you activate any profile via `spring.profiles.active`, the `default` profile is no longer in effect and `@Profile("default")` beans are skipped.
- Change the default profile name with `spring.profiles.default` (system property / env var) or `ConfigurableEnvironment.setDefaultProfiles(...)`.

```java
@Bean
@Profile("default")     // used only if nothing else is activated
public DataSource fallbackDataSource() { ... }
```

Distinction to remember:

| Concept | Meaning | Set by |
|---|---|---|
| Active profiles | Profiles currently switched on | `spring.profiles.active`, `setActiveProfiles`, `@ActiveProfiles` |
| Default profiles | Profiles used *only if none are active* | `spring.profiles.default` (default value `default`), `setDefaultProfiles` |

A common pattern: leave development beans on `@Profile("default")` so a plain run works, and require an explicit `spring.profiles.active=prod` in production.

### The "default is suppressed by any active profile" edge case

The default profiles are only consulted when the active-profile set is **empty**. Activating a completely unrelated profile — say `spring.profiles.active=metrics` — is enough to drop `default` out of scope, so a `@Profile("default")` bean silently disappears even though you never intended to replace it. If you want a bean present in the base case *and* when `metrics` is on, do **not** rely on `default`; either leave the bean un-profiled or explicitly list it (`@Profile({"default","metrics"})`).

### Empty vs blank active profiles

Setting `spring.profiles.active` to an empty string is treated as "no active profiles" (defaults apply). But whitespace-only or trailing-comma values (`"prod,"`) are trimmed and empty tokens ignored, so `"prod,"` activates only `prod`. Programmatic `setActiveProfiles((String)null)` throws `IllegalArgumentException` — nulls are rejected, unlike the string-property path which tolerates emptiness.

---

## Conditional and Conditional on Property

`@Profile` is a thin specialization of `@Conditional(ProfileCondition.class)`. For anything richer than profile matching, use `@Conditional` with a custom `Condition` (core Spring) — Spring Boot adds `@ConditionalOnProperty`, `@ConditionalOnMissingBean`, etc., but those are **Boot**, not core framework.

```java
public class OnCloudCondition implements Condition {
    @Override
    public boolean matches(ConditionContext ctx, AnnotatedTypeMetadata md) {
        return "aws".equalsIgnoreCase(ctx.getEnvironment().getProperty("platform"));
    }
}
```

Key internals a senior should know:

- `Condition.matches` receives a `ConditionContext` exposing the `Environment`, `BeanDefinitionRegistry`, `BeanFactory`, `ResourceLoader`, and `ClassLoader`. Crucially, at the point conditions run, **most beans are not yet instantiated**, so you must not call `getBean` for application beans — you inspect metadata and the `Environment`.
- Conditions are evaluated during configuration-class parsing. A `ConfigurationCondition` can additionally specify a `ConfigurationPhase` (`PARSE_CONFIGURATION` vs `REGISTER_BEAN`) to control **when** relative to other bean definitions it is checked — this matters for conditions like "only if no other bean of this type is defined," which must run in the register-bean phase after all definitions are known.
- Multiple `@Conditional`s on one element are **AND**-combined; all must match.
- `@Profile` and `@Conditional` compose: a class can be both profile-gated and condition-gated, and both must pass.

## Bean definition overriding and ordering

When two configuration sources define a bean with the **same name**, the later definition **overrides** the earlier one (in core Spring the default historically allowed overriding; the `DefaultListableBeanFactory.allowBeanDefinitionOverriding` flag controls it — Spring Boot flips the default to `false`, but core Spring's `AnnotationConfigApplicationContext` still allows it by default). This interacts with profiles and imports:

- Two same-named `@Bean` methods across imported configs: last-registered wins, silently, unless overriding is disabled (then `BeanDefinitionOverrideException`).
- Component-scanned `@Component` vs an explicit `@Bean` of the same name: the explicit `@Bean` in a processed `@Configuration` generally wins because configuration-class bean methods are registered in a way that can override scanned definitions, but relying on this is fragile — prefer distinct names.
- `@Import` order and `DeferredImportSelector` change registration order; `DeferredImportSelector`s (used heavily by Boot auto-config) are processed **after** all regular `@Configuration` classes, so their bean definitions can be overridden by, or serve as fallbacks to, user config.

## Environment post-processing and custom PropertySources

To contribute a `PropertySource` **programmatically and early** (before any `@Value`/`@PropertySource` resolution), core Spring options are:

- Add to `context.getEnvironment().getPropertySources()` **before** `refresh()` on a manually built `AnnotationConfigApplicationContext`.
- Register an `ApplicationContextInitializer` that mutates the environment (used with `ContextLoader`/`spring-test`).
- Implement `EnvironmentAware` on a `BeanFactoryPostProcessor` and reorder sources in `postProcessBeanFactory` — still early enough for `@Value` since PSPC runs during the BFPP phase, but you must ensure your BFPP is ordered **before** PSPC.

A subtle point: adding a `PropertySource` via `@Bean` (returning a `PropertySource`) does **not** register it with the `Environment` — the `Environment` is not assembled from beans. You must mutate `MutablePropertySources` directly. This trips people who expect declaring a `PropertySource` bean to "just work."

## Placeholder resolution failure modes

A consolidated list of the ways placeholder/property resolution throws or misbehaves, which senior interviews probe:

- **Unresolvable placeholder, no default:** `IllegalArgumentException: Could not resolve placeholder 'x'` at bean creation (from PSPC), unless `ignoreUnresolvablePlaceholders=true`.
- **Circular placeholder** (`a=${b}`, `b=${a}`): `IllegalArgumentException: Circular placeholder reference`.
- **Type mismatch on conversion:** placeholder resolves but target type conversion fails → `TypeMismatchException` wrapping a `NumberFormatException`/`ConversionFailedException`.
- **Wrong processor for the job:** a `${...}` in a string passed to `Environment.getProperty` is returned literally — `Environment.getProperty` does **not** resolve embedded placeholders; use `env.resolvePlaceholders(...)` / `resolveRequiredPlaceholders(...)` for that.
- **Placeholder in `@PropertySource` location unresolvable:** fails context startup because the resource path itself can't be built (independent of `ignoreResourceNotFound`, which only covers a *missing* file, not an *unresolvable location string*).
- **Escaped placeholder not escaped:** forgetting the escape (`\${...}`) when you want a literal `${` leads to an attempted resolution and possible failure.

## Common follow-up questions

- **Why must a `PropertySourcesPlaceholderConfigurer` `@Bean` method be `static`?** Because it is a `BeanFactoryPostProcessor` that must run before the `@Configuration` class is enhanced/instantiated; a non-static method would force early instantiation of the config class and break CGLIB enhancement.
- **What is the difference between `${...}` and `#{...}` in `@Value`?** `${...}` is a property placeholder resolved against the `Environment` by PSPC; `#{...}` is a SpEL expression evaluated by the SpEL engine. They are independent and can be nested.
- **Does `@PropertySource` support YAML?** Not out of the box in core Spring — you must supply a custom `PropertySourceFactory`. YAML support in `application.yml` is a Spring Boot feature.
- **What is the property precedence order?** For a `StandardEnvironment`: system properties beat OS environment variables, both beat `@PropertySource` files. First matching source wins.
- **How do inter-`@Bean` method calls stay singletons?** The CGLIB proxy created for a full `@Configuration` class intercepts method calls and returns the managed bean; with `proxyBeanMethods=false` or lite mode, they don't.
- **`@Profile("default")` vs no `@Profile`?** A bean with no `@Profile` is always registered; `@Profile("default")` is registered only when no active profile is set.
- **How do you activate multiple profiles?** Comma-separated in `spring.profiles.active` / `SPRING_PROFILES_ACTIVE`, or `setActiveProfiles("a","b")`.
- **What throws when a placeholder can't be resolved and has no default?** `IllegalArgumentException` (Could not resolve placeholder) during bean creation, unless `ignoreUnresolvablePlaceholders` is true.
- **Difference between `getProperty` and `getRequiredProperty`?** The latter throws `IllegalStateException` if the key is missing rather than returning null.

## References

- Spring Framework Reference — Core Technologies: Environment Abstraction — https://docs.spring.io/spring-framework/reference/core/beans/environment.html
- Spring Framework Reference — Java-based Container Configuration (`@Configuration`, `@Bean`) — https://docs.spring.io/spring-framework/reference/core/beans/java.html
- Spring Framework Reference — Bean Definition Profiles — https://docs.spring.io/spring-framework/reference/core/beans/environment.html#beans-definition-profiles
- Javadoc — `@Configuration`, `@Bean`, `@Profile`, `@PropertySource`, `@Value` — https://docs.spring.io/spring-framework/docs/current/javadoc-api/
- Javadoc — `PropertySourcesPlaceholderConfigurer`, `Environment`, `PropertySource`, `MutablePropertySources` — https://docs.spring.io/spring-framework/docs/current/javadoc-api/
