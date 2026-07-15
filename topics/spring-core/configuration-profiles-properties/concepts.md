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

---

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
