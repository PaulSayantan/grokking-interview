# Spring vs Spring Boot

One of the most common opening questions in a Spring interview is "What is the difference between Spring and Spring Boot?" The short, correct answer is: **Spring (the Spring Framework) is the foundational library that provides the core programming model — dependency injection, AOP, transaction management, the web MVC stack, and much more. Spring Boot is an opinionated, convention-over-configuration layer built _on top of_ the Spring Framework that removes most of the boilerplate setup through auto-configuration, starter dependencies, and an embedded server.**

The critical framing an interviewer wants to hear: **Spring Boot does not replace the Spring Framework. It uses it.** Every Spring Boot application is, at runtime, a Spring `ApplicationContext` full of Spring beans. Boot simply configures that context for you instead of making you write the configuration by hand.

This note contrasts the two, layer by layer, so you can answer both the one-line version and the deep follow-ups.

## What the Spring Framework is

The **Spring Framework** is a mature, modular Java application framework first released in 2003. Its heart is the **IoC (Inversion of Control) container**, which manages object creation, wiring, and lifecycle. Around that core it layers a broad set of libraries.

Core building blocks:

- **IoC / Dependency Injection (DI)** — the `BeanFactory` and its richer subtype `ApplicationContext` create beans, resolve their dependencies, and manage their lifecycle. You describe *what* you need (via `@Autowired`, constructor injection, XML, or `@Bean` methods) and the container supplies it.
- **AOP (Aspect-Oriented Programming)** — cross-cutting concerns (logging, security, transactions) expressed as aspects and applied via proxies, without polluting business code.
- **Data access and transactions** — `JdbcTemplate`, the `@Transactional` abstraction, ORM integration (JPA/Hibernate), and a consistent `DataAccessException` hierarchy.
- **Spring MVC / WebFlux** — the servlet-based `DispatcherServlet` web stack (`spring-webmvc`) and the reactive stack (`spring-webflux`).
- **Resource, SpEL, i18n, events, validation, scheduling, testing** support (`spring-test`, `@ContextConfiguration`, `MockMvc`).

Spring is deliberately **modular**: you pull in only the modules you need (`spring-core`, `spring-context`, `spring-web`, `spring-tx`, etc.). It is **unopinionated** — it gives you powerful mechanisms but expects *you* to decide the configuration: which view resolver, which `DataSource`, which servlet container, how to package and deploy.

Version note (interview-relevant): **Spring Framework 6.x** (and Spring Boot 3.x) requires **Java 17+** and moved from the `javax.*` namespace to **`jakarta.*`** (Jakarta EE 9+), e.g. `jakarta.servlet`, `jakarta.persistence`, `jakarta.validation`. Spring Framework 5.x / Boot 2.x still use `javax.*`.

```java
// Classic Spring: you define the configuration explicitly.
@Configuration
@ComponentScan("com.example")
public class AppConfig {

    @Bean
    public DataSource dataSource() {
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl("jdbc:postgresql://localhost/app");
        // ... you wire everything yourself
        return ds;
    }
}
```

## What Spring Boot is

**Spring Boot** is a project in the Spring ecosystem that makes it easy to create **stand-alone, production-grade, Spring-based applications that you can "just run."** It layers *conventions* on top of the Spring Framework so that a working application requires almost no manual configuration.

Its four pillars:

1. **Auto-configuration** — Boot inspects the classpath and existing beans and automatically configures sensible beans (a `DispatcherServlet`, a `DataSource`, a Jackson `ObjectMapper`, etc.).
2. **Starter dependencies** — curated, transitive dependency bundles (`spring-boot-starter-web`, `spring-boot-starter-data-jpa`) plus centrally managed, compatible versions.
3. **Embedded server** — an embedded Tomcat/Jetty/Undertow so the app runs as a plain executable JAR (`java -jar app.jar`) with no external application server.
4. **Production-ready features** — Spring Boot **Actuator** (health, metrics, info endpoints), externalized configuration (`application.properties`/`application.yml`, profiles), and sensible logging defaults.

The key point: Boot is **opinionated but overridable**. It picks defaults, but any bean you define yourself, or any property you set, wins over Boot's guess.

```java
// The entire runnable Spring Boot application.
@SpringBootApplication
public class MyApp {
    public static void main(String[] args) {
        SpringApplication.run(MyApp.class, args);
    }
}
// No XML, no DispatcherServlet wiring, no external Tomcat. It just runs.
```

## Spring Boot builds on Spring, it does not replace it

This is the single most important conceptual point of the topic and a frequent "gotcha."

- Spring Boot **depends on** the Spring Framework — `spring-boot` has `spring-core`, `spring-context`, etc. as dependencies. You cannot use Boot without Spring.
- At runtime a Boot app is an ordinary Spring `ApplicationContext` (specifically an `AnnotationConfigServletWebServerApplicationContext` for a servlet web app). The beans are ordinary Spring beans. `@Autowired`, `@Transactional`, `@Component`, Spring MVC controllers — all of that is **Spring Framework**, unchanged, when running under Boot.
- Boot does not add a new DI container, a new web framework, or a new transaction model. It **configures** the ones the Spring Framework already provides.

A clean way to phrase it in an interview: *"Spring gives you the engine and the parts; Spring Boot is the pre-assembled car with the engine already wired up, tuned, and ready to drive — but it's the same engine."*

Analogy table:

| Concern | Spring Framework | Spring Boot |
|---|---|---|
| DI container | Provides it (`ApplicationContext`) | Uses Spring's, auto-populates it |
| Web layer | Provides Spring MVC / WebFlux | Uses them, auto-configures `DispatcherServlet` |
| Transactions | Provides `@Transactional` / `PlatformTransactionManager` | Uses Spring's, auto-configures a manager |
| Configuration | You write it | Auto-configured with overridable defaults |

## Auto-configuration

**Auto-configuration** is Boot's flagship feature. Enabled by `@EnableAutoConfiguration` (included inside `@SpringBootApplication`), it conditionally configures beans based on what is present.

How it works, layer by layer:

- Boot ships many **auto-configuration classes** (e.g. `DataSourceAutoConfiguration`, `WebMvcAutoConfiguration`, `JacksonAutoConfiguration`). In Boot 2.7+ they are listed in `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`; older versions used the `spring.factories` key `EnableAutoConfiguration`.
- Each is guarded by **`@Conditional` annotations**:
  - `@ConditionalOnClass` — apply only if a class is on the classpath (e.g. Tomcat present → configure embedded Tomcat).
  - `@ConditionalOnMissingBean` — back off if the user already defined that bean. This is why **your explicit bean always wins** over Boot's default.
  - `@ConditionalOnProperty`, `@ConditionalOnBean`, `@ConditionalOnWebApplication`, etc.
- Auto-configuration runs **after** user configuration so it can "see" and defer to your beans.

Practical consequences:

- Add `spring-boot-starter-data-jpa` + an H2 driver, and Boot auto-configures a `DataSource`, an `EntityManagerFactory`, and a `JpaTransactionManager` — no code from you.
- Define your own `DataSource` bean and Boot backs off, leaving yours in place.
- You can inspect what fired with the `--debug` flag or the Actuator `conditions` endpoint (the "Auto-configuration Report"), and disable specific ones via `@SpringBootApplication(exclude = DataSourceAutoConfiguration.class)` or the `spring.autoconfigure.exclude` property.

**Worked example — tracing `DataSourceAutoConfiguration` condition by condition.** Say your `pom.xml` has `spring-boot-starter-data-jpa` and `com.h2database:h2`, and you wrote **no** `DataSource` bean. When Boot processes `DataSourceAutoConfiguration`:

| Condition on the auto-config | Evaluated against | Result |
|---|---|---|
| `@ConditionalOnClass({ DataSource.class, EmbeddedDatabaseType.class })` | classpath — both present (JDBC + H2) | **PASS** |
| `@ConditionalOnMissingBean(DataSource.class)` | beans registered so far — none of that type (auto-config runs last, saw no user bean) | **PASS** |

→ Both pass, so Boot registers an embedded H2 `DataSource` (and downstream, the `EntityManagerFactory` + `JpaTransactionManager`). Net result: a working datasource with zero configuration.

Now change **one** thing — add your own bean:

```java
@Bean
DataSource dataSource() { return myCustomPool(); }
```

Re-run the same trace. `@ConditionalOnClass` still **passes** (H2 is still on the classpath). But because user configuration is processed *before* auto-configuration, your `dataSource` bean is already registered when the condition is checked, so `@ConditionalOnMissingBean(DataSource.class)` now **FAILS** → the whole auto-config *backs off* and leaves your pool in place. This is the exact mechanism behind "your explicit bean always wins": the outcome flipped only because one condition flipped, not because of any special-casing.

The Spring Framework itself has **no auto-configuration** — this is purely a Boot feature.

**Gotcha — `@ConditionalOnMissingBean` is order-sensitive.** Conditions are evaluated *at the point the bean definition is processed*, against the beans registered *so far*. Because auto-configuration is guaranteed to run after user configuration, your `@Configuration`/`@Bean` beans and component-scanned beans are already registered when the auto-config condition is checked, so it backs off correctly. But if you place a `@ConditionalOnMissingBean` on your *own* `@Bean` method and another of your own `@Bean` methods (in a different user config class) also produces that type, the outcome depends on config-class processing order — user-vs-user ordering is **not** guaranteed the way user-vs-auto-config is. Rely on `@ConditionalOnMissingBean` only for the "back off in favour of a user bean" auto-configuration pattern, not for arbitrating between two user beans.

**Gotcha — type erasure and `@ConditionalOnMissingBean`.** The condition matches on bean *type*, and for generic types it can only match what is expressed in the bean definition metadata. A `@Bean` returning `Converter<String, Foo>` may not be distinguished from `Converter<String, Bar>` unless the return type is explicitly parameterized on the factory method, because condition matching relies on the declared return type, not the runtime object.

## Auto-configuration ordering and internals

Auto-configuration is more than "a list of `@Configuration` classes." Understanding the machinery answers a lot of senior follow-ups.

Before the terms fly, the intuition behind each mechanism — each one exists to solve one specific problem:

- **Deferred import selector** = "process auto-config *last*." It exists so auto-configuration can see every user bean already registered before it decides whether to back off. Register it eagerly and `@ConditionalOnMissingBean` would fire too early and clobber your beans.
- **The phase split (`PARSE_CONFIGURATION` vs `REGISTER_BEAN`)** = "do the cheap check first." A classpath check (`@ConditionalOnClass`) is nearly free; a bean-existence check needs bean definitions registered and is costlier. Splitting phases lets a failed classpath check discard an entire auto-config before any expensive bean check runs.
- **`proxyBeanMethods = false`** = "skip the CGLIB proxy we don't need." Auto-config classes rarely call one `@Bean` method from another, so Boot turns off the proxy to speed startup — at the cost that if you *do* make such a call it returns a new instance, not the singleton.

- **`@EnableAutoConfiguration` imports a `DeferredImportSelector`** (`AutoConfigurationImportSelector`). A *deferred* import selector is processed **after** all `@Configuration`-class (regular component) parsing is complete — this is the mechanism that guarantees auto-configuration is registered *last* and can therefore see user beans.
- **`@AutoConfiguration`** (Boot 2.7+) is a specialized `@Configuration(proxyBeanMethods = false)` used to *declare* an auto-configuration class, and it carries `before`/`after` attributes. Auto-config classes are listed in `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`.
- **Ordering among auto-configurations** is controlled by `@AutoConfigureBefore`, `@AutoConfigureAfter`, and `@AutoConfigureOrder`. This is *relative ordering of auto-configuration classes among themselves* — it is unrelated to `@Order` (which orders bean instances within a collection) and does not affect user configuration, which always precedes all of them. Example: `JpaRepositoriesAutoConfiguration` is `@AutoConfigureAfter(HibernateJpaAutoConfiguration.class)` so the `EntityManagerFactory` exists first.
- **`proxyBeanMethods = false`** on auto-configuration (and most Boot config) means the config class is in "lite" mode: `@Bean` methods are *not* intercepted by a CGLIB proxy, so an inter-bean method call (`this.foo()` calling another `@Bean` method) returns a **new instance** rather than the shared singleton. This is a real trap when copying auto-config patterns: with `proxyBeanMethods = true` (the default for plain `@Configuration`) such a call returns the container-managed singleton.
- **Conditions are evaluated in phases.** `OnClassCondition` / `OnBeanCondition` are `ConfigurationCondition`s tied to a `ConfigurationPhase`. Class conditions are evaluated during parsing (`PARSE_CONFIGURATION`); bean conditions are evaluated after bean definitions are registered (`REGISTER_BEAN`). This phase split is *why* `@ConditionalOnClass` can filter out an auto-configuration before its `@ConditionalOnMissingBean` methods are ever considered.

## Conditional evaluation gotchas

- **`@ConditionalOnBean` / `@ConditionalOnMissingBean` should generally only be used within auto-configuration**, not user configuration, precisely because their result depends on definition-processing order and user config is processed in a less predictable relative order.
- **`@Profile` is a condition too.** `@Profile` is implemented as a `@Conditional(ProfileCondition.class)`. Profile activation is resolved against the `Environment` very early, so `@Profile` on a `@Configuration` class can prune entire branches before other conditions run.
- **Custom conditions** implement `Condition` (or `SpringBootCondition`); the `ConditionContext` gives access to the `BeanFactory`, `Environment`, `ResourceLoader`, and `ClassLoader`, letting you branch on almost anything.

## Starters and dependency management

In plain Spring you assemble your own dependency list and must ensure the versions of `spring-web`, Jackson, Hibernate, the servlet API, a logging bridge, etc. are all mutually compatible — a common source of `NoSuchMethodError`/`NoClassDefFoundError` "JAR hell."

**Spring Boot starters** solve this:

- A **starter** is a convenient, transitive dependency descriptor. Adding `spring-boot-starter-web` pulls in Spring MVC, an embedded Tomcat, Jackson, validation, and a logging setup as a single coherent bundle.
- The **`spring-boot-dependencies` / `spring-boot-starter-parent` BOM** (Bill of Materials) pins compatible versions for hundreds of libraries. You typically omit version numbers for managed dependencies — Boot supplies a tested-together version.

```xml
<!-- Maven: no version needed; the Boot BOM manages it -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Naming convention: official starters are named `spring-boot-starter-*`; third-party starters are conventionally named `*-spring-boot-starter` (e.g. `mybatis-spring-boot-starter`).

The Spring Framework does **not** provide starters or a curated BOM of the whole ecosystem — dependency management is your responsibility with plain Spring.

**Starter dependency does not equal active feature.** Adding a starter puts JARs on the classpath, which *enables* the relevant auto-configuration to fire — but classpath presence and bean activation are distinct. A starter can be present while its auto-config backs off (because a condition fails, a property disables it, or you excluded it). Conversely, excluding a *starter* does not necessarily remove a transitive class if another dependency also pulls it in, so `@ConditionalOnClass` may still match. Reasoning about behaviour requires thinking in terms of the resolved classpath and evaluated conditions, not the declared starter list.

**BOM override precedence.** With `spring-boot-starter-parent`, you override a managed version by redefining the corresponding `<version.property>` (e.g. `<jackson-bom.version>`), *not* by pinning the artifact version directly — because the parent's `<dependencyManagement>` still wins over a plain transitive version. When importing `spring-boot-dependencies` as a BOM instead of using the parent, a `<dependencyManagement>` entry declared *before* the imported BOM in your own POM takes precedence, which is the supported override path. Getting this wrong yields the classic "I set the version but Boot keeps using its own" confusion.

## Writing a custom auto-configuration

Understanding how to author (not just consume) auto-configuration is a staff-level differentiator.

- A custom auto-configuration is a class annotated `@AutoConfiguration`, guarded by conditions, that registers `@Bean`s. It is made discoverable by listing its fully-qualified name in `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (one class per line).
- Convention: pair it with a `*-spring-boot-starter` (dependencies only) and a `*-spring-boot-autoconfigure` (the config + conditions), and expose settings via a `@ConfigurationProperties` class. Use `@ConditionalOnMissingBean` so consumers can override, and `@ConditionalOnClass` so it silently no-ops when the integration's library is absent.
- `@ConditionalOnProperty(prefix="mylib", name="enabled", matchIfMissing=true)` is the idiomatic on/off switch.
- Auto-configuration classes must **not** be picked up by component scanning. They live outside the application's scanned packages and are imported through the `.imports` file precisely so their conditions are evaluated in the deferred (post-user-config) phase; component-scanning them would evaluate their conditions too early and break the back-off semantics.

## Embedded server and packaging

- **Plain Spring MVC**: traditionally packaged as a **WAR** and deployed to an **external servlet container** (Tomcat, Jetty, WebLogic). You install and manage that server separately.
- **Spring Boot**: embeds the servlet container **inside** the application. It builds an executable **"fat"/"uber" JAR** containing your code, all dependencies, and the embedded server, so you run it with `java -jar app.jar`. This is ideal for containers, microservices, and cloud deployment.

Details worth knowing:

- The default embedded server for `spring-boot-starter-web` is **Tomcat**; you can swap to **Jetty** or **Undertow** by excluding Tomcat and adding the alternative starter.
- Boot's fat JAR uses a special nested-JAR layout and a custom launcher (`org.springframework.boot.loader.launch.JarLauncher`), created by the `spring-boot-maven-plugin` / `spring-boot-gradle-plugin` (the "repackage" goal).
- Boot can still produce a WAR for deployment to an external container (extend `SpringBootServletInitializer`), but the executable JAR is the default and recommended model.
- For reactive apps (`spring-boot-starter-webflux`) the default embedded server is **Netty**.

**Fat-JAR classloading internals (a favourite deep follow-up).** A Boot fat JAR is *not* a shaded/uber JAR — dependency JARs are stored **nested and uncompressed** under `BOOT-INF/lib/`, with your classes under `BOOT-INF/classes/`. This layout deliberately preserves each dependency's identity (signatures, `MANIFEST` entries) instead of flattening classes into one namespace. Because the standard JVM cannot load a JAR-within-a-JAR from the classpath, Boot's `JarLauncher` installs a custom `LaunchedClassLoader` (an URL classloader over the nested entries) and only then reflectively invokes your `main`. Consequences: (1) the `Main-Class` in the manifest is Boot's launcher, and `Start-Class` is *your* class; (2) tools that assume a flat classpath (some agents, some `Class.getResource` tricks) can misbehave; (3) two dependencies with the same class in different packages do **not** collide, unlike a shaded JAR.

**`@ServletComponentScan` and mixed models.** When running with the embedded container, plain `jakarta.servlet` `@WebServlet`/`@WebFilter`/`@WebListener` annotations are *not* scanned automatically the way a full app server would; you enable them with `@ServletComponentScan`. Under an *external* container those annotations are handled by the container itself, so behaviour differs between the two deployment modes — a subtle portability trap.

## The @SpringBootApplication annotation

`@SpringBootApplication` is a convenience **meta-annotation** that combines three annotations you would otherwise apply separately:

- **`@SpringBootConfiguration`** — a specialization of Spring's `@Configuration`, marking this class as a source of bean definitions.
- **`@EnableAutoConfiguration`** — turns on Boot's auto-configuration mechanism.
- **`@ComponentScan`** — scans the package of the annotated class and its sub-packages for `@Component`/`@Service`/`@Repository`/`@Controller` beans.

```java
@SpringBootApplication  // == @SpringBootConfiguration + @EnableAutoConfiguration + @ComponentScan
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

Because component scanning starts at the annotated class's package, the conventional practice is to put the main application class in the **root/top-level package** so all your components are discovered.

Contrast with the Spring Framework, where you would typically write `@Configuration @ComponentScan` yourself and bootstrap an `AnnotationConfigApplicationContext` (or `AnnotationConfigWebApplicationContext`) manually — and there is no `@EnableAutoConfiguration` because auto-configuration is a Boot concept.

**Gotcha — the "default package" trap.** If the main class is placed in the *default* (unnamed) package, `@ComponentScan` has no base package to anchor on and Boot will attempt to scan *everything* on the classpath, which is both slow and error-prone. Always give the application a real root package.

**Gotcha — auto-configuration vs `basePackages`.** `@ComponentScan`'s base package only controls *your* component scanning. It does **not** limit auto-configuration or `@EnableAutoConfiguration` (those are driven by the classpath and conditions, not by scan packages). Likewise, entity scanning (`@EntityScan`) and repository scanning (`@EnableJpaRepositories`) default to the `@SpringBootApplication` package but can be redirected independently.

**Gotcha — combining `@SpringBootApplication` with an explicit `@ComponentScan` or `@EnableAutoConfiguration`.** Re-declaring one of the composed annotations does not "add" to it — it *overrides* the composed meta-annotation's attributes. For example, adding your own `@ComponentScan(basePackages = "x")` alongside `@SpringBootApplication` replaces the default (annotated-class package) scan rather than augmenting it, which can silently stop discovering your own beans. Prefer `@SpringBootApplication(scanBasePackages = ...)`.

## SpringApplication and the bootstrap process

Plain Spring: you create the context yourself.

```java
ApplicationContext ctx =
    new AnnotationConfigApplicationContext(AppConfig.class);
MyService s = ctx.getBean(MyService.class);
```

Spring Boot: `SpringApplication.run(...)` does a lot of orchestration for you — it decides the application type (servlet, reactive, or none) from the classpath, creates the appropriate `ApplicationContext`, applies auto-configuration, loads externalized configuration and profiles, starts the embedded server, prints the banner, publishes lifecycle events (`ApplicationStartingEvent`, `ApplicationReadyEvent`, …), and runs any `CommandLineRunner`/`ApplicationRunner` beans.

None of this changes what a bean *is* — it is still an ordinary Spring bean in an ordinary Spring context. Boot is automating the bootstrap that you would otherwise write by hand.

**The startup sequence in more detail** (senior-level ordering questions hinge on this):

1. `SpringApplication` is constructed; it **deduces the `WebApplicationType`** (`SERVLET`, `REACTIVE`, or `NONE`) purely from classes on the classpath (e.g. `DispatcherServlet` + no `DispatcherHandler` ⇒ servlet).
2. `SpringApplicationRunListeners` (via `spring.factories`) fire `ApplicationStartingEvent`.
3. The `Environment` is prepared: property sources are assembled and `ApplicationEnvironmentPreparedEvent` fires. **This is where `EnvironmentPostProcessor`s run**, e.g. `ConfigDataEnvironmentPostProcessor`, which loads `application.properties`/`.yml`. Crucially this happens *before* the `ApplicationContext` is created, so property-driven decisions are available very early.
4. The `ApplicationContext` is created (type chosen from `WebApplicationType`), `ApplicationContextInitializer`s run, sources are loaded as bean definitions, and `ApplicationPreparedEvent` fires.
5. `refresh()` is invoked — the standard Spring lifecycle: `BeanFactoryPostProcessor`s (incl. `ConfigurationClassPostProcessor`, which processes `@Configuration` and triggers the deferred auto-configuration import), then `BeanPostProcessor`s, then singleton instantiation. For a web app the embedded server is started inside `refresh()` by the `WebServerStartStopLifecycle` / `ServletWebServerApplicationContext.onRefresh()`.
6. `ApplicationStartedEvent`, then `CommandLineRunner`/`ApplicationRunner` beans run, then `ApplicationReadyEvent`.

**Ordering subtlety.** The embedded web server begins accepting requests during context refresh, but `ApplicationRunner`/`CommandLineRunner` execute *after* refresh completes. So there is a narrow window in which the server is up but your runners have not finished — never rely on a `CommandLineRunner` to complete before the first HTTP request can arrive if the port is already open. Use readiness state (`ApplicationReadyEvent` / Actuator readiness probe) for that.

**Listeners vs. context events.** `ApplicationStartingEvent` and `ApplicationEnvironmentPreparedEvent` fire *before* the `ApplicationContext` (and thus its bean-based `@EventListener`s) exists, so they can only be observed by listeners registered through `SpringApplication`/`spring.factories`, not by `@EventListener` beans. `ApplicationReadyEvent` fires late enough that `@EventListener` beans can handle it.

## Configuration approaches: XML, Java config, properties

- **Plain Spring** historically favored **XML** (`applicationContext.xml`, `<bean>` definitions) and later **Java `@Configuration`** classes and annotations. Both are fully supported today; XML is legacy but still valid.
- **Spring Boot** discourages XML and centers on **annotation/Java config plus externalized properties** (`application.properties` / `application.yml`), with strong support for **`@ConfigurationProperties`** type-safe binding and **profiles** (`application-dev.yml`, `spring.profiles.active`).

Boot did not invent externalized configuration or profiles — Spring's `Environment` abstraction and `@Profile` predate Boot. Boot builds on them with conventions (standard file names, relaxed binding, property source ordering) and features like `@ConfigurationProperties`.

**Property source precedence (a classic trap).** Boot merges many property sources into one `Environment`, and *later-listed sources do not always win* — there is a fixed precedence order. Roughly (highest wins): devtools settings, `@TestPropertySource`, command-line args, `SPRING_APPLICATION_JSON`, servlet params, JNDI, Java system properties, OS environment variables, profile-specific `application-{profile}.properties`, then plain `application.properties`, then `@PropertySource`, then defaults. Two implications interviewers probe: (1) an OS env var **overrides** a value in `application.yml`; (2) `application-prod.yml` overrides plain `application.yml` but is itself overridden by command-line args and system properties.

**Worked example — resolving `server.port` when four sources disagree.** The `prod` profile is active and the *same* key is set four ways:

| Source | Value | Precedence rank (1 = highest wins) |
|---|---|---|
| Command line: `--server.port=6060` | 6060 | 1 |
| OS env var: `SERVER_PORT=7070` | 7070 | 2 |
| `application-prod.yml` (profile-specific) | 9090 | 3 |
| `application.yml` (plain) | 8080 | 4 |

Boot merges these into one `Environment` and asks the *highest-precedence* source that has the key. Walking down the ranks: rank 1 (command line) has it → resolution stops immediately. **Resolved `server.port` = 6060.** The app binds to port 6060.

To confirm you understand the *ordering* (not just "last one wins"), replay it removing the top source each time:

- Drop `--server.port` → env var `SERVER_PORT=7070` wins → **7070**.
- Also drop the env var → `application-prod.yml` wins → **9090**.
- Also drop the prod file (or deactivate the profile) → plain `application.yml` → **8080**.

Note the classic trap: `application-prod.yml` outranks `application.yml`, but *both* lose to the env var and the command line — profile-specific files are near the *bottom*, not the top.

**`@ConfigurationProperties` vs `@Value`.** `@Value("${...}")` is resolved by Spring's `PropertySourcesPlaceholderConfigurer`, supports SpEL, but is *not* relaxed-bound and fails fast per-field. `@ConfigurationProperties` does **relaxed binding** (`my.userName`, `my.user-name`, `MY_USER_NAME` all bind), supports nested objects, validation (`@Validated` + JSR-380), and type conversion, but does not support SpEL. For structured, validated config prefer `@ConfigurationProperties`; `@Value` is for one-off scalars.

**Relaxed binding and environment variables.** Because env vars cannot contain dots or dashes, Boot canonicalizes them: `spring.datasource.url` binds from `SPRING_DATASOURCE_URL`. This only works for `@ConfigurationProperties`-style binding, which is why a property that binds fine from YAML may appear "missing" when supplied as an env var to a `@Value` field.

**`@Profile` negation and expressions.** `@Profile("!prod")` activates when `prod` is *not* active, and Boot supports profile expressions like `@Profile("prod & us-east")`. A bean with no `@Profile` is always eligible. A common bug: putting environment-varying beans behind profiles but forgetting that `spring.profiles.active` empty means the `default` profile group is active, not "all profiles."

## Actuator and production-ready features

**Spring Boot Actuator** (`spring-boot-starter-actuator`) adds production-grade operational endpoints over HTTP or JMX with little configuration:

- `/actuator/health` — liveness/readiness and component health.
- `/actuator/metrics` and Micrometer integration — JVM, HTTP, datasource metrics, exportable to Prometheus, CloudWatch, etc.
- `/actuator/info`, `/actuator/env`, `/actuator/loggers`, `/actuator/conditions` (the auto-config report), `/actuator/beans`, `/actuator/mappings`, and more.

By default (Boot 2.x+) only `health` is exposed over HTTP; you opt in to others via `management.endpoints.web.exposure.include`.

The **Spring Framework has no Actuator** — monitoring/metrics/health endpoints are entirely a Boot feature (built, of course, on Spring beans and Spring MVC/WebFlux under the hood).

**Endpoint enablement vs exposure are two independent gates.** An endpoint must be *enabled* (`management.endpoint.<id>.enabled`, most default to true) **and** *exposed* over a technology (`management.endpoints.web.exposure.include`/`exclude` for HTTP, or the JMX equivalents). A common trap: setting `exposure.include=*` still will not surface `shutdown` because `shutdown` is *disabled* by default; you must enable it separately. Exposure over JMX and over HTTP are configured independently.

**Liveness vs readiness.** Boot's health system distinguishes *liveness* (the app is running; failure ⇒ restart the pod) from *readiness* (the app can serve traffic; failure ⇒ remove from load balancer). These map to Kubernetes probes via `/actuator/health/liveness` and `/actuator/health/readiness`, backed by `AvailabilityState` events. During graceful shutdown Boot flips readiness to `REFUSING_TRAFFIC` while liveness stays `CORRECT`, so orchestrators stop routing new requests before the context closes — conflating the two probes defeats zero-downtime deploys.

**`@Endpoint` is a Boot abstraction, not MVC.** Custom Actuator endpoints are written with `@Endpoint`/`@ReadOperation`/`@WriteOperation` and are automatically exposed over *both* web and JMX. This is deliberately technology-agnostic; you only drop to `@WebEndpoint`/`@RestControllerEndpoint` when you need HTTP-specific semantics. Health *indicators* (`HealthIndicator` beans) are aggregated by a `HealthContributorRegistry` with a configurable status-to-HTTP-code mapping (`DOWN` ⇒ 503 by default).

## What problems Spring Boot solves

Summarizing why Boot exists — a classic interview question:

1. **Boilerplate configuration** — auto-configuration eliminates most `@Bean`/XML wiring for common infrastructure (web, data, security, messaging).
2. **Dependency management / version conflicts** — starters + the managed BOM give a curated, mutually compatible set of library versions, killing "JAR hell."
3. **Deployment and packaging** — the embedded server + executable fat JAR remove the need to install and configure an external application server; the app is self-contained and cloud/container-friendly.
4. **Getting started speed** — Spring Initializr (`start.spring.io`) plus conventions let you go from nothing to a running app in minutes.
5. **Operational readiness** — Actuator, metrics, health checks, and sensible logging defaults out of the box.

Net effect: Boot lets developers focus on business logic rather than infrastructure plumbing, while keeping the full power and overridability of the underlying Spring Framework.

## When to use plain Spring vs Spring Boot

For **greenfield applications** — especially microservices, REST APIs, and cloud-native apps — **Spring Boot is the default choice** in modern development; there is rarely a good reason to hand-wire what Boot automates.

Situations where **plain Spring (without Boot)** may still be appropriate:

- **Legacy/existing systems** that already deploy a WAR to a managed external application server (WebLogic, WebSphere, standalone Tomcat) governed by ops policy.
- **Highly constrained environments** where you must control every dependency and bean explicitly and cannot accept opinionated defaults or Boot's transitive dependency footprint.
- **Very small or embedded uses** where you want just the Spring container or a specific module (e.g. only `spring-jdbc` or only the DI container) without Boot's machinery.
- **Learning/teaching**, where writing configuration by hand builds a clearer mental model of what Boot automates.

Even then you are still using the **Spring Framework**; the choice is really "with Boot's conventions" vs "configuring Spring myself." And Boot always lets you drop down to plain Spring config when its opinions don't fit — you are never locked out of the underlying framework.

The modern counter-argument an interviewer often raises here is **cold start and footprint**: "isn't Boot too heavy for FaaS/Lambda?" Historically Boot's JVM startup and memory overhead did hurt in serverless, where every cold start pays the bootstrap cost. But the answer today is *not* "drop Boot" — it's the AOT/native path covered in the *Spring Boot 3, AOT, and native images* section below: Boot 3's **AOT processing + GraalVM native image** compile the same application to a native executable with millisecond startup and low memory, and Spring's **functional bean registration** avoids reflection-heavy scanning. So the trade-off has shifted from "plain Spring vs Boot for serverless" to "JVM Boot vs AOT/native Boot."

## Common failure modes and why apps break

Senior interviews often pivot from "what is X" to "here is a broken app, why?" Recurring root causes:

- **Bean not found / component not scanned.** The `@Component` lives *above* or *beside* the `@SpringBootApplication` package rather than beneath it. Auto-configuration is fine; the class simply is not in scan range. Fix: move it under the root package or use `scanBasePackages`.
- **Two candidate beans, `NoUniqueBeanDefinitionException`.** Multiple beans of the injected type with no `@Primary`/`@Qualifier`. Note auto-config beans are usually `@ConditionalOnMissingBean`, so this is almost always caused by *your* duplicate definitions, not Boot's.
- **Auto-config silently did nothing.** A condition failed — often a missing property, a class you thought was present but is provided in a different scope (`test` vs `runtime`), or another auto-config ran first and registered the bean. Diagnose with `--debug`'s condition report or `/actuator/conditions`, never by guessing.
- **`DataSourceAutoConfiguration` fails at startup with "Failed to determine a suitable driver class."** A JDBC starter is on the classpath but no URL/driver is configured, and no `DataSource` bean exists to satisfy the condition. Either configure `spring.datasource.*` or `exclude` the auto-config.
- **Circular reference.** Since **Spring Boot 2.6** the framework **prohibits circular references by default** (`spring.main.allow-circular-references=false`), and Boot 3 keeps this default. Constructor-injection cycles always fail; the field/setter-injection workaround that used to mask them now errors unless explicitly re-enabled. The correct fix is to break the cycle (extract a third bean, use `@Lazy`, or an events indirection), not to flip the flag.
- **Overriding a bean throws `BeanDefinitionOverrideException`.** Bean-definition overriding is **disabled by default** since Boot 2.1. Defining a second bean with the same *name* (not just type) as an existing one fails fast rather than silently replacing it. This is a deliberate safety change from earlier Boot behaviour.

## Thread-safety and scope considerations

None of Spring-vs-Boot changes the container's concurrency model, but the traps recur:

- **Singleton beans are shared across all request threads.** The container guarantees a singleton is *created* once (with proper happens-before via `DefaultSingletonBeanRegistry`'s synchronized singleton lock), but it does **not** make the bean's mutable state thread-safe. A `@Service`/`@Controller` with mutable instance fields is a data-race waiting to happen under concurrent requests. Keep singletons stateless.
- **Injecting a shorter-lived scope into a singleton.** Injecting a `request`/`session`/`prototype` bean directly into a singleton captures a single instance forever, defeating the scope. The fix is a *scoped proxy* (`@Scope(value="request", proxyMode=TARGET_CLASS)`) or an `ObjectProvider`/`Provider` lookup, so each access resolves the correct-scoped instance on the current thread.
- **Prototype beans are not managed after creation.** The container instantiates and wires a prototype but does *not* track it or call its destruction callbacks; a singleton holding a prototype gets exactly one instance. This surprises people who expect a "new one per use."
- **Embedded server thread pool.** With embedded Tomcat, requests are served on the container's worker threads; the same singleton beans serve them all. Boot changes the *defaults* (pool sizes via `server.tomcat.threads.*`) but not the fundamental shared-singleton model.

## Spring Boot 3, AOT, and native images

Boot 3 (on Spring Framework 6) adds capabilities with no Spring-Framework-5 equivalent and no plain-Spring counterpart:

- **AOT (ahead-of-time) processing.** At build time Spring can pre-compute the bean definitions and generate Java source/`BeanFactoryInitializationCode` plus reflection/resource/proxy hints, shrinking startup work and enabling GraalVM. This is a build-time transformation of the *same* programming model — beans are still Spring beans; the wiring is just decided earlier.
- **GraalVM native image.** With AOT hints, a Boot 3 app can compile to a native executable with millisecond startup and low memory, at the cost of losing most runtime dynamism (no arbitrary runtime classpath scanning, reflection must be hinted). This is why AOT and `@ConditionalOn...` interact carefully: conditions are evaluated at *build* time for native images, so classpath/profile changes at runtime cannot re-open a branch that AOT already pruned.
- **Observability.** Boot 3 folds Micrometer Tracing and the `Observation` API in, unifying metrics and distributed tracing. Again, this is built on Spring beans and adds nothing to the core DI model.

These are additive: a Boot 3 app you never AOT-process behaves like any other Spring `ApplicationContext`.

## Common follow-up questions

- Does Spring Boot replace the Spring Framework? No. Boot depends on and configures the Spring Framework; a Boot app is a normal Spring `ApplicationContext`.
- What three annotations does `@SpringBootApplication` combine? `@SpringBootConfiguration`, `@EnableAutoConfiguration`, `@ComponentScan`.
- How does auto-configuration know what to configure? Conditional annotations (`@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`, …) evaluated against the classpath and existing beans; auto-config runs after user config and backs off when you've defined a bean yourself.
- What is a starter? A curated transitive dependency bundle (e.g. `spring-boot-starter-web`) with versions managed by the Boot BOM.
- How does a Boot app run without an external server? It embeds Tomcat/Jetty/Undertow (Netty for WebFlux) and packages an executable fat JAR run via `java -jar`.
- Can you override an auto-configured bean? Yes — define your own bean and `@ConditionalOnMissingBean` makes Boot back off; you can also `exclude` auto-configuration classes.
- What does Actuator give you and does plain Spring have it? Health, metrics, info, env, and other operational endpoints; it is a Boot-only feature.
- Java/Jakarta namespace? Spring Framework 6 / Boot 3 need Java 17+ and use `jakarta.*`; Spring 5 / Boot 2 use `javax.*`.
- When would you NOT use Boot? Legacy WAR-to-external-server deployments, tightly constrained dependency environments, or minimal use of a single Spring module.

## References

- Spring Framework Reference Documentation — https://docs.spring.io/spring-framework/reference/
- Spring Boot Reference Documentation — https://docs.spring.io/spring-boot/
- Spring Boot "Auto-configuration" — https://docs.spring.io/spring-boot/reference/using/auto-configuration.html
- Spring Boot Starters — https://docs.spring.io/spring-boot/reference/using/build-systems.html#using.build-systems.starters
- `@SpringBootApplication` — https://docs.spring.io/spring-boot/reference/using/using-the-springbootapplication-annotation.html
- Spring Boot Actuator — https://docs.spring.io/spring-boot/reference/actuator/
- Spring Framework 6.0 Upgrade / Jakarta EE 9 baseline — https://github.com/spring-projects/spring-framework/wiki/Upgrading-to-Spring-Framework-6.x
- Spring Initializr — https://start.spring.io/
