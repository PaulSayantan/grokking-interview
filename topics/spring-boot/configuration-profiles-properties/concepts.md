# Configuration, Profiles & Externalized Properties

> Spring Boot's externalized configuration lets you write code once and run it in
> many environments (dev, test, staging, prod) by pushing environment-specific
> values *out* of the code and into properties files, environment variables,
> command-line arguments, and other sources. This topic covers how those sources
> are read, how they override one another, the two binding mechanisms
> (`@Value` and `@ConfigurationProperties`), relaxed binding, validation, the
> `Environment` abstraction, `@PropertySource`, and the profile system
> (`@Profile`, active/default profiles, profile-specific files, profile groups).
> Interviewers love this topic because it exposes whether you understand
> *precedence* (who wins when the same key is defined twice) and the subtle
> differences between the binding APIs.

## Externalized Configuration Overview

**Definition.** Externalized configuration is the practice of keeping
configuration values outside the compiled artifact so the *same* jar can be
deployed to different environments with different behavior. Spring Boot builds a
unified `Environment` from many `PropertySource`s and exposes every value
through a single flat key/value namespace.

**Why it matters.** It is the concrete implementation of the Twelve-Factor App
"config in the environment" principle. It means no rebuild is needed to change a
database URL, and secrets never have to be hard-coded.

**Sources Spring Boot reads (non-exhaustive):**

- `application.properties` / `application.yml` (bundled and external)
- Profile-specific files (`application-prod.yml`)
- OS environment variables
- Java system properties (`-Dkey=value`)
- Command-line arguments (`--key=value`)
- `SPRING_APPLICATION_JSON` (inline JSON)
- `@PropertySource` files
- `spring.config.import` targets (config trees, extra files, Vault/Consul, etc.)
- Defaults set via `SpringApplication.setDefaultProperties(...)`

All of these are merged into the `Environment`; the crucial rule is the
**precedence order** (see below) which decides who wins on a key collision.

**Two ways to consume config in code:** `@Value` (single-property injection via
placeholders/SpEL) and `@ConfigurationProperties` (type-safe binding of a whole
group of properties onto a POJO). You can also read directly from the
`Environment`.

## application.properties vs application.yml

Both formats express the same thing; Spring Boot loads whichever it finds (and
if both exist in the same location, `.properties` wins on conflicting keys
because it is processed *after* YAML within a location... in practice, avoid
having both).

**`.properties` — flat key/value:**

```properties
spring.datasource.url=jdbc:postgresql://localhost/app
spring.datasource.username=admin
app.servers[0]=alpha
app.servers[1]=beta
```

**`.yml` — hierarchical, less repetition:**

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost/app
    username: admin
app:
  servers:
    - alpha
    - beta
```

| Aspect | `.properties` | `.yml` |
|---|---|---|
| Structure | Flat | Hierarchical/nested |
| Lists/maps | Verbose (`x[0]`, `x[1]`) | Natural block/flow syntax |
| Comments | `#` | `#` |
| Multi-document | `#---` separator (Boot 2.4+) | `---` separator (native YAML) |
| Dependency | None | Needs SnakeYAML (bundled in `spring-boot-starter`) |
| `@PropertySource` support | Yes | **No** (not out of the box) |
| Duplicate keys | Last one wins | **Not allowed** — YAML parser errors |

**Gotchas:**

- YAML is indentation-sensitive; tabs are illegal.
- YAML interprets unquoted `yes/no/on/off` and `Norway problem` values
  (`no` → boolean `false`); quote strings when in doubt.
- `@PropertySource` **cannot** load YAML without a custom `PropertySourceFactory`.
- A YAML file cannot contain duplicate keys, whereas properties silently keep
  the last.

## @Value Annotation

**Definition.** `@Value` injects a *single* value resolved from a property
placeholder (`${...}`) or a SpEL expression (`#{...}`) into a field, constructor
parameter, or method parameter.

```java
@Component
class MailConfig {
    @Value("${app.mail.host}")               // property placeholder
    private String host;

    @Value("${app.mail.port:25}")             // default if key is absent
    private int port;

    @Value("#{systemProperties['user.region']}")   // SpEL
    private String region;

    @Value("${app.mail.recipients}")          // "a,b,c" -> List/array
    private List<String> recipients;
}
```

- **Default values:** `${key:default}`. Without a default, a missing key throws
  `IllegalArgumentException` at startup (unless a
  `PropertySourcesPlaceholderConfigurer` is configured to ignore unresolvable
  placeholders).
- **SpEL vs placeholder:** `${}` is a *property placeholder* resolved by the
  `Environment`; `#{}` is a *SpEL expression* evaluated by the expression engine.
  You can nest: `#{'${app.list}'.split(',')}`.
- **Gotcha — no relaxed binding.** `@Value("${myApp.pageSize}")` matches the key
  *exactly*; it does not perform the relaxed name matching that
  `@ConfigurationProperties` does.
- **Gotcha — timing/`static`.** `@Value` on a `static` field does not work
  (injection is instance-based). Values injected via `@Value` are not available
  in the constructor if injected on fields (use constructor injection for
  early availability).

## @ConfigurationProperties and Type-Safe Binding

**Definition.** `@ConfigurationProperties(prefix = "...")` binds a whole tree of
properties onto a strongly-typed POJO in one shot. It is the recommended
approach for grouped configuration.

```java
@ConfigurationProperties(prefix = "app.mail")
@Validated
public class MailProperties {
    private String host;
    private int port = 25;                    // default
    private List<String> recipients = new ArrayList<>();
    private Duration timeout = Duration.ofSeconds(30);   // "30s" binds here
    // getters/setters ...
}
```

**Registering it:**

- `@EnableConfigurationProperties(MailProperties.class)` on a config class, **or**
- `@ConfigurationPropertiesScan` (Boot 2.2+) to scan packages, **or**
- annotate the class with `@Component` (then it becomes a bean directly).

**Constructor (immutable) binding.** Use a `final`-field constructor or a Java
`record`. In **Spring Boot 3.x**, `@ConstructorBinding` is inferred when the
class has a single parameterized constructor, so you no longer annotate the
class — you only need `@ConstructorBinding` to *select* one constructor when
there are several. (In Boot 2.x `@ConstructorBinding` was required on the class.)

```java
@ConfigurationProperties(prefix = "app.mail")
public record MailProperties(String host, int port, List<String> recipients) {}
```

**Rich type conversion built in:** `Duration` (`30s`, `PT10M`), `DataSize`
(`10MB`), `List`/`Map`/arrays, enums, `java.time` types. Use `@DurationUnit` /
`@DataSizeUnit` to set the unit for unadorned numbers.

**Gotchas:**

- Mutable (setter) binding needs public setters; constructor binding needs no
  setters and gives immutability.
- If you use constructor binding you must **not** also annotate the class with
  `@Component` (the two registration styles conflict); use
  `@EnableConfigurationProperties` / `@ConfigurationPropertiesScan`.
- Binding is *tolerant*: unknown/extra properties are ignored by default
  (`ignoreUnknownFields = true`); a mistyped key silently does nothing unless
  you enable failure or use metadata tooling.

## @Value vs @ConfigurationProperties

| Feature | `@Value` | `@ConfigurationProperties` |
|---|---|---|
| Scope | One property at a time | A whole group (prefix) |
| Relaxed binding | **No** (exact key) | **Yes** (kebab, camel, env-var forms) |
| SpEL support | **Yes** (`#{...}`) | **No** |
| Meta-data / IDE autocomplete | No | Yes (via annotation processor) |
| JSR-303 validation | Awkward | `@Validated` + constraints |
| Complex types (List/Map/nested) | Limited | First-class |
| Default value syntax | `${k:def}` | Field initializer |
| Best for | One-off values, expressions | Structured, reusable config |

**Interview trap:** "You need to bind `app.servers` (a list) and validate that
`app.timeout` is positive — which do you pick?" → `@ConfigurationProperties`,
because it binds collections cleanly and supports `@Validated`. Choose `@Value`
only when you need SpEL or a single scalar and don't want a dedicated class.

**Another trap:** relaxed binding means the property `my-app.page-size` in a file
can be supplied as the env var `MYAPP_PAGESIZE` and still bind to a
`@ConfigurationProperties` field `pageSize` — but `@Value("${my-app.page-size}")`
would *not* resolve from that env var reliably because it matches names exactly.

## Relaxed Binding

**Definition.** `@ConfigurationProperties` matches property names loosely, so one
canonical field can be supplied in several naming styles depending on the source.

For a field `firstName` under prefix `app.person`:

| Form | Example | Typical source |
|---|---|---|
| Kebab-case | `app.person.first-name` | `.properties` / `.yml` (**recommended**) |
| Camel-case | `app.person.firstName` | `.properties` / `.yml` |
| Underscore | `app.person.first_name` | `.properties` / `.yml` |
| Upper-case + underscore | `APP_PERSON_FIRSTNAME` | **environment variables** |

**Environment-variable rule:** dots become underscores, dashes are **removed**,
and letters become upper-case. `spring.datasource.url` → `SPRING_DATASOURCE_URL`;
`my-app.page-size` → `MYAPP_PAGESIZE` (note the dash is dropped, not turned into
an underscore).

**Binding maps** keep the original case/format of the key (relaxation is not
applied to map keys, other than to lowercase in some cases). For list indexes use
`app.person.roles[0]` or the env form `APP_PERSON_ROLES_0_`.

**Gotchas:**

- Relaxed binding applies to `@ConfigurationProperties`, **not** `@Value`.
- The *recommended* canonical form to write in your files is **kebab-case**
  (`context-path`, not `contextPath`), because it is the lowest-common
  denominator that all sources map to.

## Validation of Configuration Properties

**Definition.** Annotate a `@ConfigurationProperties` bean with `@Validated` and
put JSR-303 (Bean Validation) constraints on the fields; Spring validates at
startup and fails fast if the config is invalid.

```java
@ConfigurationProperties(prefix = "app.mail")
@Validated
public class MailProperties {
    @NotNull
    private InetAddress host;

    @Min(1) @Max(65535)
    private int port;

    @NotEmpty
    private List<@Email String> recipients;
}
```

- **Spring Boot 3.x uses Jakarta**: import from `jakarta.validation.constraints.*`
  (e.g. `jakarta.validation.constraints.NotNull`), **not** `javax.validation.*`.
  This is the single most common migration break for this topic.
- Requires a Bean Validation implementation on the classpath (Hibernate
  Validator, pulled in by `spring-boot-starter-validation`).
- Nested objects need `@Valid` on the field to cascade validation.
- Failure throws a `BindValidationException` wrapped so the app **does not
  start** — this is the fail-fast benefit over `@Value`.

**Gotcha:** `@Validated` must be on the properties class; forgetting it means the
constraint annotations are silently ignored.

## Property Source Precedence Order

**The rule:** later (higher-priority) sources override earlier ones on the same
key. Spring Boot documents this exact order (lowest priority first, highest
last):

1. Default properties (`SpringApplication.setDefaultProperties`).
2. `@PropertySource` on `@Configuration` classes (added late — *after* the
   context begins refreshing, so too late for `logging.*` / `spring.main.*`).
3. Config data (`application.properties` / `application.yml` and profile variants).
4. `RandomValuePropertySource` (`random.*`).
5. **OS environment variables.**
6. **Java system properties** (`System.getProperties()`, i.e. `-Dkey=value`).
7. JNDI attributes (`java:comp/env`).
8. `ServletContext` init parameters.
9. `ServletConfig` init parameters.
10. `SPRING_APPLICATION_JSON` (inline JSON in an env var or system property).
11. **Command-line arguments** (`--key=value`).
12. `properties` attribute on `@SpringBootTest`.
13. `@TestPropertySource`.
14. Devtools global settings (`$HOME/.config/spring-boot`) when devtools is active.

**High-value facts interviewers probe:**

- **Command-line args beat environment variables and system properties.**
  `java -Dserver.port=8081 -jar app.jar --server.port=9090` → port **9090**.
- **System properties beat OS env vars** (item 6 > item 5).
- `@TestPropertySource` beats `@SpringBootTest(properties=...)`.
- You can disable command-line property source with
  `SpringApplication.setAddCommandLineProperties(false)`.

## Config Data Files and Location Precedence

Within the "config data" tier (item 3 above), Boot itself has an internal order.
**Profile-specific files override non-profile files, and external files override
bundled (in-jar) files:**

1. Bundled `application.properties`/`.yml` (inside the jar).
2. Bundled profile-specific `application-{profile}.properties`/`.yml`.
3. External `application.properties`/`.yml` (outside the jar).
4. External profile-specific `application-{profile}.properties`/`.yml`.

**Default search locations** (Boot resolves and merges these; later locations win):

```
optional:classpath:/            (classpath root)
optional:classpath:/config/
optional:file:./                (current dir)
optional:file:./config/
optional:file:./config/*/       (immediate subdirectories of config/)
```

So a `config/` folder next to the jar overrides the classpath copy, letting ops
drop an override file beside the deployable.

**Overriding locations:**

- `spring.config.location` — **replaces** the default locations entirely.
- `spring.config.additional-location` — **adds** locations (defaults still apply).
- `spring.config.name` — change the base name from `application` to something else.
- `spring.config.import` (Boot 2.4+) — pull in extra files, *config trees*
  (`configtree:/etc/config/` for Kubernetes secrets), or external systems.

**Boot 2.4 change (still current in 3.x):** file processing moved to
`ConfigDataEnvironmentPostProcessor` with document ordering rules; use
`spring.config.activate.on-profile` (not the old `spring.profiles`) to gate a
document, and `spring.config.import` replaced the ad-hoc loading logic.

## Environment Variables and Command-Line Arguments

**Environment variables** are read into a `SystemEnvironmentPropertySource`. Use
the upper-case underscore relaxed form:

```bash
export SPRING_DATASOURCE_URL=jdbc:postgresql://db/app
export SERVER_PORT=8082
export SPRING_PROFILES_ACTIVE=prod,metrics
```

- Great for containers/Kubernetes and for secrets (never commit them).
- Only reliably bind to `@ConfigurationProperties` (relaxed) or to canonical
  keys — the env form maps back to the dotted key.

**Command-line arguments** use the `--` prefix and become the highest-precedence
regular source:

```bash
java -jar app.jar --server.port=9090 --spring.profiles.active=prod
```

- `-D` args are *system properties*, not command-line args, and have **lower**
  precedence than `--` args.
- `SPRING_APPLICATION_JSON` lets you pass a JSON blob:
  `SPRING_APPLICATION_JSON='{"server":{"port":9000}}'`.
- Command-line properties can be disabled via
  `setAddCommandLineProperties(false)`.

**Trap:** `--debug` and `--trace` are special (enable debug logging), not
arbitrary properties. Positional (non-option) args are captured in
`ApplicationArguments` but are not property sources.

## @PropertySource

**Definition.** `@PropertySource` declaratively adds a `.properties` file to the
`Environment` from a `@Configuration` class.

```java
@Configuration
@PropertySource("classpath:custom.properties")
@PropertySource(value = "classpath:missing.properties", ignoreResourceNotFound = true)
public class ExtraConfig {
    @Autowired Environment env;
}
```

**Limitations / gotchas (frequent trap):**

- **Does not load YAML** out of the box — you must supply a custom
  `factory = YamlPropertySourceFactory.class`.
- It is registered *late* (during context refresh), so it is too low in the
  precedence list to affect `spring.main.*`, `logging.*`, or profile activation.
- No built-in profile-specific loading like `application-{profile}` — you'd have
  to include the profile in the filename manually.
- Prefer `spring.config.import` / `application.yml` for Boot apps;
  `@PropertySource` is mostly for plain Spring or legacy files.
- `@PropertySources` (plural) or repeatable `@PropertySource` for multiple files.

## The Environment Abstraction

**Definition.** `org.springframework.core.env.Environment` is Spring's unified
API over (a) profiles and (b) properties. It combines a `PropertyResolver`
(property lookup) with profile awareness.

```java
@Component
class Reader {
    private final Environment env;
    Reader(Environment env) { this.env = env; }

    void demo() {
        String url = env.getProperty("spring.datasource.url");
        int port  = env.getProperty("server.port", Integer.class, 8080); // typed + default
        String must = env.getRequiredProperty("app.key");                 // throws if absent
        String[] active = env.getActiveProfiles();
        String[] def    = env.getDefaultProfiles();
        boolean isProd  = env.acceptsProfiles(Profiles.of("prod & !legacy"));
    }
}
```

**Key methods:** `getProperty`, `getRequiredProperty`, `containsProperty`,
`getActiveProfiles`, `getDefaultProfiles`, and `acceptsProfiles(Profiles)`.

**Notes:**

- The old `acceptsProfiles(String...)` is deprecated; use
  `acceptsProfiles(Profiles.of("..."))` which supports `& | !` expressions.
- `ConfigurableEnvironment` (the mutable subtype) lets you inspect/reorder
  `getPropertySources()` — this is how you understand precedence at runtime.
- `EnvironmentPostProcessor` (registered in
  `META-INF/spring.factories` / `spring/…imports`) lets you add property sources
  very early, before beans are created — the correct hook for custom config
  loading that must beat most sources.

## @Profile and Conditional Beans

**Definition.** `@Profile` conditionally registers a bean (or an entire
`@Configuration`) only when the given profile expression is active. It is a
specialization built on `@Conditional`.

```java
@Configuration
class DataSourceConfig {
    @Bean @Profile("dev")
    DataSource h2() { ... }

    @Bean @Profile("prod")
    DataSource postgres() { ... }

    @Bean @Profile("!prod")               // any time prod is NOT active
    FakePaymentGateway fakeGateway() { ... }
}
```

**Profile expressions** (Boot/Spring 5.1+): `&`, `|`, `!`, parentheses —
`@Profile("prod & (us | eu)")`, `@Profile("!test")`.

**Gotchas / traps:**

- `@Profile` decides whether a bean *definition* is registered; it is evaluated
  during context startup, not at request time.
- Can annotate a `@Configuration` class (gates all its beans) or an individual
  `@Bean`/`@Component`.
- `@Profile("default")` beans are active **only when no profile is active**
  (see next section).
- Do not confuse `@Profile` with `@ConditionalOnProperty` — the former keys off
  active profiles, the latter off a property value.

## Active and Default Profiles

**Active profiles** are the profiles currently switched on; **the default
profile** is what applies when *no* profile is active.

- Set active profiles with `spring.profiles.active=dev,metrics`
  (property, env var `SPRING_PROFILES_ACTIVE`, or `--spring.profiles.active`).
- Multiple profiles are comma-separated and *additive* — beans for all listed
  profiles are registered; on key collisions, the **last-listed profile wins**
  for property values.
- If none is set, Spring uses the profile literally named **`default`**
  (changeable via `spring.profiles.default`). `application-default.yml` and
  `@Profile("default")` beans then apply.
- Programmatic: `SpringApplication.setAdditionalProfiles(...)` or
  `ConfigurableEnvironment.setActiveProfiles(...)`.

**Traps:**

- **You cannot set `spring.profiles.active` from within a profile-specific file**
  (e.g. inside `application-prod.yml`) or from a profile-gated document — Boot
  ignores/errs on it. Use profile *groups* for that (next section).
- Setting `spring.profiles.active` in `@TestPropertySource` or `@ActiveProfiles`
  overrides the file value in tests (`@ActiveProfiles` is the test-specific way).
- "Active" ≠ "default": once *any* profile is active, the `default` profile is no
  longer applied.

## Profile-Specific Configuration Files and Profile Groups

**Profile-specific files.** `application-{profile}.properties` / `.yml` is loaded
*in addition to* the base `application.*` and **overrides** it when the profile
is active. Example: with `spring.profiles.active=prod`, both `application.yml`
and `application-prod.yml` load, and `prod` values win.

**Multi-document files** put several logical documents in one file:

```yaml
# application.yml
spring:
  application:
    name: shop
---
spring:
  config:
    activate:
      on-profile: prod       # Boot 2.4+ way to gate a document
  datasource:
    url: jdbc:postgresql://prod-db/shop
---
spring:
  config:
    activate:
      on-profile: dev
  datasource:
    url: jdbc:h2:mem:shop
```

- YAML documents are separated by `---`; `.properties` multi-documents use
  `#---`.
- Use `spring.config.activate.on-profile` (Boot 2.4+) — the older
  `spring.profiles:` key inside a document is deprecated/removed.

**Profile groups** (`spring.profiles.group`) let one profile expand into several:

```yaml
spring:
  profiles:
    group:
      prod: prod-db, prod-mq, monitoring
```

Activating `prod` (`--spring.profiles.active=prod`) also activates `prod-db`,
`prod-mq`, and `monitoring`. Groups replaced the older additive
`spring.profiles.include` mechanism for most use cases and are the sanctioned
way to activate multiple profiles together.

**Trap:** `spring.profiles.include` adds profiles *unconditionally* and, unlike
`active`, may be used to layer profiles even from profile-specific documents in
some cases — but modern guidance is to use **profile groups**.

## Common follow-up questions

- **"Given `java -Dserver.port=8081 -jar app.jar --server.port=9090`, what port
  starts?"** → 9090. Command-line `--` args (item 11) beat system properties
  `-D` (item 6).
- **"An env var `SERVER_PORT=8082` and `application.yml` sets `server.port: 8080`
  — which wins?"** → 8082; OS env vars outrank config data files.
- **"Why doesn't my `@Value("${my-app.page-size}")` pick up `MYAPP_PAGESIZE`?"**
  → `@Value` doesn't do relaxed binding; only `@ConfigurationProperties` does.
- **"How do you validate config at startup?"** → `@ConfigurationProperties` +
  `@Validated` + `jakarta.validation` constraints + Hibernate Validator on the
  classpath; app fails fast on invalid values.
- **"How do you load YAML with `@PropertySource`?"** → Not supported directly;
  supply a custom `PropertySourceFactory`, or just use `application.yml` /
  `spring.config.import`.
- **"Difference between active and default profile?"** → default profile applies
  only when no profile is active; active profiles are the currently enabled ones,
  additive, last-wins on collisions.
- **"How do you turn one profile into many?"** → `spring.profiles.group.<name>`.
- **"Can you set `spring.profiles.active` inside `application-prod.yml`?"** → No;
  use a profile group instead.
- **"Constructor vs setter binding for `@ConfigurationProperties`?"** →
  Constructor binding gives immutability (records/final fields); in Boot 3.x it's
  inferred for a single constructor. Don't combine constructor binding with
  `@Component`.
- **"javax vs jakarta validation in Boot 3?"** → Boot 3 requires
  `jakarta.validation.*`; `javax.validation.*` no longer works.

## References

- Spring Boot Reference — Externalized Configuration:
  https://docs.spring.io/spring-boot/reference/features/external-config.html
- Spring Boot Reference — Profiles:
  https://docs.spring.io/spring-boot/reference/features/profiles.html
- Spring Boot — Working with Type-safe Configuration Properties:
  https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.typesafe-configuration-properties
- Spring Framework — Environment Abstraction:
  https://docs.spring.io/spring-framework/reference/core/beans/environment.html
- Spring Framework — Bean definition profiles (`@Profile`):
  https://docs.spring.io/spring-framework/reference/core/beans/environment.html#beans-definition-profiles
- Baeldung — Properties with Spring and Spring Boot:
  https://www.baeldung.com/properties-with-spring
- Baeldung — @ConfigurationProperties in Spring Boot:
  https://www.baeldung.com/configuration-properties-in-spring-boot
- Baeldung — Spring Profiles:
  https://www.baeldung.com/spring-profiles
- Baeldung — A Quick Guide to Spring @Value:
  https://www.baeldung.com/spring-value-annotation
