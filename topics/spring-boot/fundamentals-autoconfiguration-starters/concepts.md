# Spring Boot Fundamentals, Auto-Configuration & Starters

Spring Boot is an opinionated, convention-over-configuration layer built **on top of** the Spring Framework. It does not replace Spring; it accelerates it by auto-configuring beans based on the classpath, providing "starter" dependencies, and embedding a servlet container so an application ships as a single runnable JAR. This topic covers what Boot adds, how `@SpringBootApplication` and `SpringApplication.run()` work, the auto-configuration engine, conditional annotations, starters, BOM-based dependency management, embedded servers, and the fat/layered JAR format.

---

## Spring vs Spring Boot

**Beginner definition.** *Spring Framework* is a modular application framework whose core is the IoC (Inversion of Control) container and dependency injection, plus modules for AOP, transactions, MVC, data access, etc. *Spring Boot* is a project built on top of Spring that removes boilerplate configuration through auto-configuration, starter dependencies, an embedded server, and production-ready features (Actuator).

**Why it matters.** With plain Spring you manually declare a `DispatcherServlet`, view resolvers, data sources, transaction managers, and wire XML or `@Configuration` classes, then deploy a WAR to an external Tomcat. Boot lets you run `main()` and get a working web server with sensible defaults.

**Key differences.**

| Aspect | Spring Framework | Spring Boot |
|---|---|---|
| Configuration | Manual (XML / Java `@Configuration`) | Auto-configuration + `application.properties/yml` |
| Server | External (deploy WAR) | Embedded (Tomcat/Jetty/Undertow) by default |
| Dependencies | Pick each library + compatible version | Starters pull curated, version-aligned sets |
| Boilerplate | High | Low (opinionated defaults) |
| Entry point | `web.xml` / `WebApplicationInitializer` | `SpringApplication.run()` in `main()` |
| Production tooling | Add manually | Actuator (health, metrics, info) |

**Common trap.** Boot is *not* a different container or a fork of Spring — it uses the same `ApplicationContext` and bean lifecycle. Boot does not make Spring "faster at runtime"; it makes *setup* faster. You can still drop to raw Spring config any time and Boot backs off (see conditional annotations).

---

## @SpringBootApplication

**Beginner definition.** `@SpringBootApplication` is a convenience meta-annotation placed on the main class. It combines three annotations:

```java
@SpringBootApplication            // = the three below
// @Configuration (via @SpringBootConfiguration)
// @EnableAutoConfiguration
// @ComponentScan
public class MyApp {
    public static void main(String[] args) {
        SpringApplication.run(MyApp.class, args);
    }
}
```

- **`@SpringBootConfiguration`** — a specialization of `@Configuration`; marks the class as a source of bean definitions (and there should be exactly one per app; test slices look for it).
- **`@EnableAutoConfiguration`** — triggers Boot's auto-configuration machinery.
- **`@ComponentScan`** — scans the package of the annotated class *and its sub-packages* for `@Component`/`@Service`/`@Repository`/`@Controller` beans.

**Why the package placement matters (trap).** Because `@ComponentScan` (and auto-config's `@AutoConfigurationPackage`) default their base package to the main class's package, the main class should live in a **root/top-level package** above all other code. If you put it in a deep package, components in sibling packages won't be scanned and beans "mysteriously" go missing.

**Intermediate.** You can customize the composite: `@SpringBootApplication(scanBasePackages = "com.example.other")`, or `exclude = {DataSourceAutoConfiguration.class}` to turn off specific auto-config. If you need finer control you can replace the meta-annotation with the three individual annotations.

**Advanced.** `@EnableAutoConfiguration` also imports `@AutoConfigurationPackage`, which registers the package of the annotated class so that other features (e.g. Spring Data JPA entity scanning, `@EntityScan` default) know where to look. That is a separate mechanism from `@ComponentScan`.

---

## SpringApplication.run() Flow

**Beginner definition.** `SpringApplication.run(MyApp.class, args)` bootstraps the whole application: it creates and refreshes the `ApplicationContext`, runs auto-configuration, starts the embedded server, and returns the running context.

**High-level flow.**

1. **Create `SpringApplication`** — deduce the *web application type* (`SERVLET`, `REACTIVE`, or `NONE`) by inspecting the classpath; load `ApplicationContextInitializer`s and `ApplicationListener`s from `spring.factories`.
2. **`run(args)`**:
   - Start a `StopWatch`, configure headless.
   - Get `SpringApplicationRunListeners` (e.g. `EventPublishingRunListener`) and fire **`starting`**.
   - Prepare the `Environment` (property sources, profiles, command-line args) → fire **`environmentPrepared`**.
   - Print the **banner**.
   - **Create the `ApplicationContext`** (e.g. `AnnotationConfigServletWebServerApplicationContext`).
   - **`prepareContext`** — apply initializers, register the primary source, fire **`contextPrepared`** / **`contextLoaded`**.
   - **`refreshContext`** — this is the standard Spring `AbstractApplicationContext.refresh()`: bean factory post-processors run, auto-configuration classes are evaluated, **all singletons are instantiated**, and for web apps the **embedded server starts** (in `onRefresh`).
   - Fire **`started`**, then call all `ApplicationRunner` and `CommandLineRunner` beans.
   - Fire **`ready`** and return the context.

**Event order (trap).** `ApplicationStartingEvent` → `ApplicationEnvironmentPreparedEvent` → `ApplicationContextInitializedEvent` → `ApplicationPreparedEvent` → (context refresh) → `ApplicationStartedEvent` → `AvailabilityChangeEvent(LivenessState.CORRECT)` → runners → `ApplicationReadyEvent` → `AvailabilityChangeEvent(ReadinessState.ACCEPTING_TRAFFIC)`. On failure: `ApplicationFailedEvent`.

**`CommandLineRunner` vs `ApplicationRunner`.** Both run once after the context is ready but before `run()` returns. `CommandLineRunner.run(String... args)` gets raw args; `ApplicationRunner.run(ApplicationArguments args)` gets parsed option/non-option args. Order them with `@Order` or `Ordered`.

**Advanced.** You can customize before running: `new SpringApplicationBuilder(MyApp.class).web(WebApplicationType.NONE).run(args)`, add listeners, set a `Banner`, or set `setLazyInitialization(true)`.

**Why `EnvironmentPostProcessor` and `ApplicationListener` run so early (expert).** The `Environment` is prepared and `ApplicationEnvironmentPreparedEvent` fires **before** the `ApplicationContext` is even created. This is why an `EnvironmentPostProcessor` (registered in `spring.factories`) can mutate property sources that later influence which beans/auto-configs match — but it also means such a post-processor **cannot** `@Autowire` anything or reference beans; the container doesn't exist yet. Config Data (`application.properties`/`.yml`, `spring.config.import`) is itself processed by `ConfigDataEnvironmentPostProcessor` at this stage.

**Lazy initialization gotcha.** `spring.main.lazy-initialization=true` defers bean creation until first use, speeding startup — but it also **defers startup failures** (a mis-wired bean throws on first request, not at boot) and delays `@PostConstruct`/validation. Fatal-fast behavior is usually preferable in production; use `@Lazy(false)` on critical beans to opt them back in.

**`ApplicationReadyEvent` vs runners (subtle).** `CommandLineRunner`/`ApplicationRunner` execute **before** `ApplicationReadyEvent` is published. So if a runner throws, the app fails and `ApplicationReadyEvent` never fires (an `ApplicationFailedEvent` fires instead). Readiness probes keyed to `ApplicationReadyEvent` therefore won't flip to "ready" until all runners have completed successfully — a deliberate ordering for correct traffic gating.

**Thread-safety at startup.** Singleton bean instantiation during `refresh()` happens on the **main (bootstrap) thread**, single-threaded by default, so bean construction order is deterministic. Boot's `BackgroundPreinitializer` does move *some* framework warm-up work (e.g. validator, message-converter, and conversion-service initialization) onto a background thread, but it runs **automatically** on multi-core JVMs — its gate is simply `availableProcessors() > 1`, and it is disabled by setting the system property `spring.backgroundpreinitializer.ignore=true` (there is no `spring.main.background-initialization` key). This preinitialization touches only internal helpers; your *own* singletons are still constructed sequentially on the main thread, so do not assume your bean constructors run concurrently.

---

## Convention over Configuration

**Beginner definition.** "Convention over configuration" means the framework assumes sensible defaults so you only configure what deviates from them. Boot applies this pervasively.

**Examples.**
- Property files at `src/main/resources/application.properties` / `application.yml` are picked up automatically.
- A datasource on the classpath + no explicit config → Boot configures an in-memory H2 (if present) or reads `spring.datasource.*`.
- `spring-boot-starter-web` on the classpath → Boot assumes a servlet web app, starts embedded Tomcat on port 8080, configures Jackson, `DispatcherServlet`, error handling.
- Static content served from `/static`, `/public`, `/resources`, `/META-INF/resources`.
- Templates for Thymeleaf resolved from `src/main/resources/templates`.

**Why it matters.** Fewer decisions and less boilerplate; teams share conventions so onboarding is faster. You override via properties or by defining your own beans (Boot backs off through `@ConditionalOnMissingBean`).

**Trap.** Convention over configuration is *not* magic reflection at runtime — everything is driven by explicit auto-configuration classes guarded by conditions. When defaults surprise you, the mechanism is inspectable via the **auto-configuration report** (`--debug` flag or `/actuator/conditions`), which lists positive and negative matches.

---

## Auto-Configuration Mechanism

**Intuition first.** Think of auto-configuration as a long checklist Spring runs *last*, after all your own config. For each entry it asks two questions: "is library X on the classpath?" and "did the user *not* already configure this themselves?" — if both are yes, it wires a sensible default. Everything below is just the machinery for how that checklist is discovered, filtered, ordered, and evaluated.

**Beginner definition.** Auto-configuration is Boot's process of automatically registering beans your app likely needs, based on the classpath, existing beans, and properties. It is enabled by `@EnableAutoConfiguration` (included in `@SpringBootApplication`).

**How it works (intermediate).**
1. `@EnableAutoConfiguration` imports `AutoConfigurationImportSelector`.
2. That selector loads the list of candidate auto-configuration class names — in **Boot 2.7+/3.x** from `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`; in **Boot ≤2.6** from the `EnableAutoConfiguration` key in `META-INF/spring.factories`.
3. Candidates are **filtered** by `AutoConfigurationImportFilter`s (like `OnClassCondition`, `OnBeanCondition`, `OnWebApplicationCondition`) — cheap classpath checks discard classes whose required types are absent, *before* the context does expensive evaluation.
4. Surviving classes are ordered (`@AutoConfigureBefore`/`@AutoConfigureAfter`/`@AutoConfigureOrder`) and imported as `@Configuration` classes.
5. Each is evaluated against its `@Conditional...` annotations; only matching beans are registered.

**Key ordering guarantee (trap).** Auto-configuration classes are **always processed last**, after your own user-defined configuration. That is *why* `@ConditionalOnMissingBean` works: by the time an auto-config bean is evaluated, your own bean (if any) is already registered, so Boot backs off. Your explicit beans win.

**Advanced internals.** `AutoConfigurationImportSelector` implements `DeferredImportSelector`, which is the reason auto-config runs after regular `@Import`/`@Configuration` processing. Results are cached; the `spring-autoconfigure-metadata.properties` file (generated at build time) provides condition metadata used by the filters for fast exclusion.

**How `@ConditionalOnClass` avoids `NoClassDefFoundError` (deep internal).** A naive reading suggests that referencing an absent class in `@ConditionalOnClass(SomeType.class)` would itself fail to load the condition. Boot avoids this two ways. First, condition evaluation reads annotation attributes as **strings via ASM metadata** (`SimpleMetadataReader`) rather than resolving the `Class` — so the annotated class's bytecode is inspected without loading the referenced type. Second, when a `.class` literal is unavoidable, Boot places the condition on a **nested** static class or uses the `name` (String) attribute so the enclosing auto-config can be parsed even when the type is missing. This is why you'll see auto-config written with `@ConditionalOnClass(name = "...")` or split into inner classes. The `spring-autoconfigure-metadata.properties` filter step short-circuits most of this before the class is even considered.

**`DeferredImportSelector.Group` and ordering (staff-level).** `AutoConfigurationImportSelector` uses an inner `AutoConfigurationGroup` that collects all candidates across every `@EnableAutoConfiguration` source, then sorts them **once** using `@AutoConfigureOrder` (coarse, integer, default 0) followed by `@AutoConfigureBefore`/`@AutoConfigureAfter` (fine, dependency-graph based). These ordering hints only order auto-config classes **relative to each other** — they have no effect on user `@Configuration` (which always precedes all of them) and are ignored if applied to a regular `@Component`.

**Debugging.** Run with `--debug` (or set `debug=true`) to print the **Condition Evaluation Report**: `Positive matches`, `Negative matches`, `Exclusions`, `Unconditional classes`.

**Worked example — tracing one auto-config end to end.** You add `spring-boot-starter-jdbc` and the H2 driver to the classpath but write *no* `DataSource` bean and *no* `spring.datasource.*` properties. Here is exactly what happens to `DataSourceAutoConfiguration`:

1. **Discovery.** `AutoConfigurationImportSelector` reads `.../AutoConfiguration.imports` from `spring-boot-autoconfigure.jar`; `DataSourceAutoConfiguration` is one of ~140 candidate FQCNs on the list.
2. **Filter (cheap, ASM).** `OnClassCondition` checks the class's `@ConditionalOnClass({DataSource.class, EmbeddedDatabaseType.class})`. Both types are present (H2 + `spring-jdbc` bring them), so the candidate **survives** the filter instead of being discarded early.
3. **Order.** It carries no user beans yet; it is sorted among survivors via `@AutoConfigureOrder`/`Before`/`After` and imported as a `@Configuration`.
4. **Condition evaluation.** Its `@ConditionalOnMissingBean(DataSource.class)` runs in the `REGISTER_BEAN` phase (after all user bean *definitions* are registered). You defined none → **no match found → condition passes → auto-config proceeds.**
5. **Bean registration.** Because no explicit URL is set and H2 is on the classpath, the embedded-database branch matches and Boot registers an **H2 `HikariDataSource`** (Hikari is the default pool) pointed at an in-memory URL like `jdbc:h2:mem:<uuid>`.

Now flip one input: you add your *own* `@Bean DataSource myDs() {...}`. In step 4 the `@ConditionalOnMissingBean(DataSource.class)` now *finds* your bean → **condition fails → Boot backs off** and never creates the Hikari one. Your bean wins — which is the whole point of ordering auto-config last.

**What the Condition Evaluation Report actually prints.** Running the first case above with `--debug` yields lines like these (abbreviated):

```
Positive matches:
-----------------
   DataSourceAutoConfiguration matched:
      - @ConditionalOnClass found required classes 'javax.sql.DataSource',
        'org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType' (OnClassCondition)

   DataSourceAutoConfiguration.EmbeddedDatabaseConfiguration matched:
      - @ConditionalOnMissingBean (types: javax.sql.DataSource; ...) did not find any beans (OnBeanCondition)

Negative matches:
-----------------
   GsonAutoConfiguration:
      - @ConditionalOnClass did not find required class 'com.google.gson.Gson' (OnClassCondition)

   RabbitAutoConfiguration:
      - @ConditionalOnClass did not find required class 'com.rabbitmq.client.Channel' (OnClassCondition)
```

Read it like a diff: a **Positive match** shows *why a bean got wired* (the classes/beans that were found or missing), and a **Negative match** shows *why one didn't* (usually a class absent from the classpath). This is the first place to look when a bean "mysteriously" does or doesn't appear.

---

## spring.factories vs AutoConfiguration.imports

**Beginner definition.** Both files are how Boot discovers auto-configuration classes on the classpath; the location changed across versions.

| | Boot ≤ 2.6 | Boot 2.7 | Boot 3.x |
|---|---|---|---|
| File | `META-INF/spring.factories` | Both supported (2.7 introduced the new file; old one deprecated for auto-config) | `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` |
| Format | `key=CommaSeparated,ClassNames` under `EnableAutoConfiguration` key | new file: one FQCN per line | one FQCN per line |
| Status of old approach | Standard | Deprecated (still read with a warning) | **Removed** for auto-configuration registration |

**Boot ≤2.6 `spring.factories`:**
```properties
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
com.example.MyAutoConfiguration,\
com.example.OtherAutoConfiguration
```

**Boot 2.7+/3.x `.../AutoConfiguration.imports`:** (plain list, one per line, `#` comments allowed)
```
com.example.MyAutoConfiguration
com.example.OtherAutoConfiguration
```

**Important nuance (trap).** `spring.factories` **still exists** in Boot 3.x and is still used for *other* extension points — `ApplicationContextInitializer`, `ApplicationListener`, `EnvironmentPostProcessor`, `FailureAnalyzer`, etc. Only the **`EnableAutoConfiguration` auto-config registration** moved to the new imports file. So "spring.factories is gone" is false; only that one key/purpose moved. In Boot 3.x, classes registered via the new file **must** be annotated `@AutoConfiguration`.

---

## Conditional Annotations

**Beginner definition.** `@Conditional...` annotations gate whether a `@Configuration` class or `@Bean` method is applied, based on runtime/classpath conditions. They are the heart of auto-configuration's "back off if the user did it themselves" behavior.

**Most common conditions.**

| Annotation | Matches when… |
|---|---|
| `@ConditionalOnClass` | The named class **is present** on the classpath |
| `@ConditionalOnMissingClass` | The named class is **absent** |
| `@ConditionalOnBean` | A bean of the given type/name **already exists** |
| `@ConditionalOnMissingBean` | **No** bean of that type/name exists (→ define a default) |
| `@ConditionalOnProperty` | A property has a given value (`havingValue`, `matchIfMissing`) |
| `@ConditionalOnResource` | A resource (file) exists |
| `@ConditionalOnWebApplication` / `OnNotWebApplication` | App is (not) a web app (SERVLET/REACTIVE) |
| `@ConditionalOnExpression` | A SpEL expression is true |
| `@ConditionalOnSingleCandidate` | Exactly one candidate bean (or one primary) exists |
| `@ConditionalOnJava` | JVM version matches |
| `@ConditionalOnJndi` | JNDI is available |

**Example.**
```java
@AutoConfiguration
@ConditionalOnClass(DataSource.class)
public class MyDataAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean
    public MyRepository myRepository(DataSource ds) { return new MyRepository(ds); }
}
```

**Ordering trap for `@ConditionalOnBean`/`OnMissingBean`.** These inspect the *current* state of the bean factory, so they are **order-sensitive**. Spring's guidance: only use them on **auto-configuration** classes (which run last), *not* on user configuration, because during user-config processing the bean you're checking for may not have been registered yet, giving nondeterministic results. `@ConditionalOnMissingBean` without a type defaults to the return type of the `@Bean` method.

**`matchIfMissing` (trap).** `@ConditionalOnProperty(name="feature.enabled", havingValue="true", matchIfMissing=true)` matches when the property is absent *or* equals `true`. Without `matchIfMissing`, an absent property means **no match**. Subtlety: `havingValue=""` (empty) is special — it matches when the property is set to **anything other than `false`**. And `@ConditionalOnProperty` is case-**insensitive** for `havingValue` comparison against the resolved property string.

**`@ConditionalOnBean` type erasure & generics (advanced).** `@ConditionalOnMissingBean( repository = ...)` and the plain type form work off **bean definition types**, so beans whose type is only known via a `FactoryBean` or a `@Bean` method with an erased/generic return type can be missed. Boot resolves generics where possible (e.g. `Converter<String, Foo>`) but a bean registered without full generic type information (such as one produced by a raw `FactoryBean`) can defeat a parameterized `@ConditionalOnMissingBean`, causing a duplicate bean. Prefer declaring precise return types on `@Bean` methods.

**Custom `@Conditional` and `ConfigurationCondition` (expert).** A plain `Condition` is evaluated during the "parse configuration classes" phase. But `@ConditionalOnBean`/`@ConditionalOnMissingBean` implement `ConfigurationCondition` with `ConfigurationPhase.REGISTER_BEAN`, forcing them to be evaluated **after** all bean *definitions* have been registered (not merely during class parsing). If you write a bean-inspecting condition as a bare `Condition` (phase `PARSE_CONFIGURATION`), it runs too early and sees an incomplete bean factory — a classic source of nondeterministic "sometimes the bean is there, sometimes not" bugs.

**Combining conditions: AND semantics (trap).** Multiple `@Conditional...` annotations on the same class/method are combined with **AND** — every one must match. There is no built-in OR across annotations; for OR logic you must write a custom `AnyNestedCondition` (Boot provides `AnyNestedCondition` and `AllNestedConditions`/`NoneNestedConditions` base classes precisely for this).

---

## Disabling Auto-Configuration

**Beginner definition.** You can turn off specific (or all) auto-configuration classes when a default gets in your way.

**Ways to disable.**
1. **Annotation attribute:** `@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class})` or `@EnableAutoConfiguration(exclude = ...)`.
2. **By name (class not on classpath):** `excludeName = "com.example.SomeAutoConfiguration"`.
3. **Property:** `spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration` (comma-separated) in `application.properties`.

**Classic trap.** Adding `spring-boot-starter-data-jpa` without configuring a datasource → app fails at startup with "Failed to configure a DataSource". Fixes: provide `spring.datasource.*`, add an embedded DB (H2) to the classpath, or exclude `DataSourceAutoConfiguration` (and `HibernateJpaAutoConfiguration`) if you truly don't need a DB.

**Advanced.** Excluding a class that isn't actually an auto-configuration candidate throws an error unless you use `excludeName`. Excluding does not remove the JAR from the classpath — it only prevents that auto-config class from contributing beans.

---

## Writing Custom Auto-Configuration

**Beginner definition.** Library authors write auto-configuration so that *merely adding their JAR* configures beans for consumers, with the ability to back off when the consumer overrides.

**Steps (Boot 3.x).**
1. Create a config class annotated `@AutoConfiguration` (a specialized `@Configuration(proxyBeanMethods=false)` that also carries ordering support).
2. Guard beans with conditions (`@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`, etc.).
3. Register the class in `src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (one FQCN per line). *(Boot ≤2.6: use the `EnableAutoConfiguration` key in `spring.factories`.)*
4. Optionally bind config with a `@ConfigurationProperties` class.

```java
@AutoConfiguration
@ConditionalOnClass(GreeterClient.class)
@EnableConfigurationProperties(GreeterProperties.class)
public class GreeterAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public GreeterClient greeterClient(GreeterProperties props) {
        return new GreeterClient(props.getEndpoint());
    }
}
```
`.../AutoConfiguration.imports`:
```
com.acme.greeter.GreeterAutoConfiguration
```

**Ordering.** Use `@AutoConfigureBefore`, `@AutoConfigureAfter`, `@AutoConfigureOrder` — or the equivalent attributes on `@AutoConfiguration(after = ...)`. Never rely on `@ComponentScan` to pick up your auto-config class; consumers should be able to add your JAR without scanning your package. Registration via the imports file is required precisely because the class lives outside the consumer's scanned packages.

**Testing.** Use `ApplicationContextRunner` to assert conditional behavior without booting a full app:
```java
new ApplicationContextRunner()
    .withConfiguration(AutoConfigurations.of(GreeterAutoConfiguration.class))
    .run(ctx -> assertThat(ctx).hasSingleBean(GreeterClient.class));
```

---

## Starter Dependencies

**Beginner definition.** A **starter** is a curated, empty (usually) aggregator dependency that pulls in a coherent set of libraries for a capability — e.g. `spring-boot-starter-web` brings Spring MVC, Jackson, and embedded Tomcat. You add one dependency instead of a dozen version-matched ones. (Note: since Boot 2.3, `spring-boot-starter-web` does **not** pull in Bean Validation; add `spring-boot-starter-validation` explicitly if you need it.)

**Common starters.**

| Starter | Provides |
|---|---|
| `spring-boot-starter` | Core: auto-config, logging, YAML |
| `spring-boot-starter-web` | Spring MVC + embedded Tomcat + Jackson |
| `spring-boot-starter-webflux` | Reactive web + Netty |
| `spring-boot-starter-data-jpa` | Spring Data JPA + Hibernate |
| `spring-boot-starter-security` | Spring Security |
| `spring-boot-starter-test` | JUnit 5, Mockito, AssertJ, Spring Test |
| `spring-boot-starter-actuator` | Production endpoints (health/metrics) |
| `spring-boot-starter-validation` | Bean Validation (Hibernate Validator) |

**Intermediate details.**
- Naming convention: official starters are `spring-boot-starter-*`; **third-party** starters should be named `xyz-spring-boot-starter` (name-first) to avoid the reserved `spring-boot` namespace.
- Most starters have no code themselves — they're POMs listing transitive dependencies.
- Swapping servers: exclude `spring-boot-starter-tomcat` from `spring-boot-starter-web` and add `spring-boot-starter-jetty` or `-undertow`.

**Trap.** A starter and an auto-configuration are different things. The starter brings JARs onto the classpath; auto-configuration (shipped in `spring-boot-autoconfigure` or the library's own JAR) reacts to those JARs. Adding a starter without the corresponding auto-config JAR wouldn't wire anything automatically.

---

## Creating a Custom Starter

**Beginner definition.** A custom starter lets your organization package a capability so teams add one dependency and get auto-configured beans.

**Recommended two-module layout.**
1. **`acme-spring-boot-starter`** — an (almost) empty module whose POM depends on your autoconfigure module and the third-party libs. This is what consumers depend on.
2. **`acme-spring-boot-autoconfigure`** — contains the `@AutoConfiguration` classes, `@ConfigurationProperties`, and the `AutoConfiguration.imports` file.

(For simple cases the two can be combined into a single module.)

**Naming rule (trap).** Do **not** start a third-party starter name with `spring-boot`; that prefix is reserved for official Spring Boot starters. Use `<name>-spring-boot-starter`.

**Best practices.**
- Depend on `spring-boot-autoconfigure` as `optional`/`provided` so you inherit conditions and metadata annotations without forcing versions.
- Add `spring-boot-configuration-processor` (annotation processor) to generate `META-INF/spring-configuration-metadata.json` for IDE property autocompletion.
- Make third-party libraries that a consumer might not need `optional` and guard beans with `@ConditionalOnClass` so the starter degrades gracefully.

---

## Dependency and Version Management (BOM)

**Beginner definition.** Boot manages the versions of ~hundreds of common libraries via a **BOM** (Bill of Materials) so you declare dependencies *without versions* and get a tested, compatible set.

**Maven — two options.**
1. **Inherit the parent** `spring-boot-starter-parent` (which imports `spring-boot-dependencies` and adds plugin config, Java version, resource filtering):
```xml
<parent>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-parent</artifactId>
  <version>3.3.0</version>
</parent>
```
2. **Import the BOM** in `dependencyManagement` (when you already have a corporate parent):
```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>3.3.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

**Gradle.** Apply the `io.spring.dependency-management` plugin, or in modern Gradle use `platform`:
```groovy
dependencies {
    implementation platform('org.springframework.boot:spring-boot-dependencies:3.3.0')
    implementation 'org.springframework.boot:spring-boot-starter-web'  // no version
}
```

**Overriding a managed version.** Maven parent: set the documented property, e.g. `<jackson.version>2.17.0</jackson.version>`; or redeclare the dependency with an explicit version. Gradle: `ext['jackson.version'] = '2.17.0'`.

**Trap.** A BOM only manages versions (`dependencyManagement`) — importing it does **not** add any dependency to your build. You still declare the starters/artifacts you want; the BOM just supplies their versions.

---

## Embedded Server

**Beginner definition.** Boot bundles a servlet container *inside* the application so you run a plain JAR (`java -jar app.jar`) instead of deploying a WAR to an external server. Default is **Tomcat**; alternatives are **Jetty** and **Undertow** (Netty for WebFlux/reactive).

**How it starts.** For a servlet web app, the context is a `ServletWebServerApplicationContext`. During `refresh()`, its `onRefresh()` calls `createWebServer()`, which looks up a `ServletWebServerFactory` bean (e.g. `TomcatServletWebServerFactory`) and starts the container. Default port 8080, configurable via `server.port` (`server.port=0` picks a random free port).

**Switching servers.**
```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
  <exclusions>
    <exclusion>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-tomcat</artifactId>
    </exclusion>
  </exclusions>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-undertow</artifactId>
</dependency>
```

**Deploying as a traditional WAR (trap).** If you need to deploy to an external container, package as `war`, extend `SpringBootServletInitializer` and override `configure()`, and mark the embedded server starter as `provided`. Boot then works both as a runnable JAR and inside the external server.

**Jakarta EE / Boot 3 note.** Spring Boot 3.x requires **Java 17+** and moved from `javax.*` to `jakarta.*` namespaces (Servlet, Persistence, Validation). Embedded Tomcat 10+ implements the `jakarta.servlet` API — old `javax.servlet` code will not compile/run.

---

## Fat/Executable JAR and Layered JAR

**Beginner definition.** The Spring Boot Maven/Gradle plugin repackages your app into an **executable "fat" (uber) JAR** that contains your classes *and* all dependency JARs, plus a launcher, so `java -jar app.jar` just works.

**Structure of a Boot fat JAR.**
```
app.jar
├── META-INF/MANIFEST.MF        (Main-Class: JarLauncher; Start-Class: your main)
├── org/springframework/boot/loader/...   (the launcher classes)
├── BOOT-INF/classes/           (your compiled classes + resources)
├── BOOT-INF/lib/               (dependency JARs, nested)
└── BOOT-INF/classpath.idx / layers.idx
```

**Nested JAR loading (advanced).** Standard Java can't load classes from a JAR nested inside a JAR. Boot solves this with its own `org.springframework.boot.loader.launch.JarLauncher` (Boot 3.2+ package) plus a custom class loader that reads nested `BOOT-INF/lib/*.jar` entries. The manifest's `Main-Class` is the launcher, not your class; your entry point is recorded as `Start-Class`. This is why you don't unzip and run your class directly.

**Layered JAR (Boot 2.3+).** To make Docker images cache efficiently, the JAR is split into **layers** (`layers.idx`) ordered least-to-most likely to change:
1. `dependencies` (release deps)
2. `spring-boot-loader`
3. `snapshot-dependencies`
4. `application` (your code — changes most often)

Extract them with `java -Djarmode=layertools -jar app.jar extract` (Boot 2.3–3.1) or the newer `-Djarmode=tools -jar app.jar extract --layers` (Boot 3.2+; `layertools` is deprecated in favor of the `tools` jarmode), then `COPY` each layer as a separate Docker layer so a code-only change re-ships only the small `application` layer.

**`tools` jarmode beyond layers (Boot 3.2+).** The `tools` jarmode does more than layer extraction. `java -Djarmode=tools -jar app.jar extract` (no `--layers`) produces an **exploded** structure (application jar + a `lib/` folder of dependency jars) that starts faster than the nested-jar layout because the custom class loader no longer pays the small cost of reading nested jars. This exploded layout is also **CDS- and AOT-cache-friendly** (Class Data Sharing / ahead-of-time caches want real files on disk, not entries inside a jar), which is why production Docker images increasingly run the extracted form rather than `java -jar app.jar` directly.

**Fat JAR vs thin/traditional (trap).** A fat JAR is self-contained but large and duplicates deps across microservices; a plain library JAR is not runnable. `spring-boot:repackage` keeps the original thin JAR as `*.jar.original`. WAR packaging is for external containers, not `java -jar` (though Boot WARs are also executable).

---

## SpringFactoriesLoader

**Beginner definition.** `SpringFactoriesLoader` is the general-purpose Spring (core) mechanism that loads implementation class names listed under a given interface key in `META-INF/spring.factories` files across all JARs on the classpath. It is a lightweight service-provider style discovery (similar in spirit to Java's `ServiceLoader`).

**What it loads.** Anything keyed in `spring.factories`, e.g.:
```properties
org.springframework.context.ApplicationListener=com.example.MyListener
org.springframework.boot.env.EnvironmentPostProcessor=com.example.MyEnvPostProcessor
org.springframework.boot.diagnostics.FailureAnalyzer=com.example.MyFailureAnalyzer
```
Boot uses it during `SpringApplication` startup to load `ApplicationContextInitializer`s, `ApplicationListener`s, `SpringApplicationRunListener`s, `EnvironmentPostProcessor`s, `FailureAnalyzer`s, and (in ≤2.6) auto-configuration classes.

**Relationship to auto-config (trap).** Historically `SpringFactoriesLoader` loaded auto-configuration via the `EnableAutoConfiguration` key. In Boot 2.7+, auto-config moved to `AutoConfiguration.imports` (loaded by an `ImportCandidates` mechanism, not `SpringFactoriesLoader`). But `SpringFactoriesLoader` is **still used** for the *other* factory types above — it was not removed. So the correct statement is: auto-configuration *registration* left `spring.factories`, but `SpringFactoriesLoader` and `spring.factories` remain for the rest.

**Advanced.** `SpringFactoriesLoader.loadFactoryNames(Class, ClassLoader)` returns the class names; `loadFactories(...)` instantiates them. Results are cached per class loader. Order among providers can be influenced with `@Order`/`Ordered`. `ServiceLoader` differs: it uses `META-INF/services/<FQCN>` files (one file per interface) and always instantiates, whereas `spring.factories` is a single properties file holding many keys and lets Spring control instantiation and ordering.

---

## Externalized Configuration and Property Source Ordering

**Beginner definition.** Boot lets configuration live outside code — properties/YAML files, environment variables, command-line args, etc. — and merges them into a single `Environment` composed of ordered `PropertySource`s.

**Precedence (highest wins; abbreviated, Boot 3.x).** Later/higher sources override earlier ones:
1. Devtools global settings (when devtools active)
2. `@TestPropertySource` on tests
3. `@DynamicPropertySource` / `properties` attr on `@SpringBootTest`
4. **Command-line arguments** (`--server.port=9000`)
5. `SPRING_APPLICATION_JSON` (inline JSON in an env var / system property)
6. `ServletConfig` / `ServletContext` init params
7. JNDI (`java:comp/env`)
8. **Java system properties** (`-Dserver.port=...`)
9. **OS environment variables** (`SERVER_PORT`)
10. Profile-specific `application-{profile}.properties` (outside jar, then inside)
11. `application.properties`/`.yml` (Config Data)
12. `@PropertySource` on `@Configuration`
13. `SpringApplication.setDefaultProperties(...)` (lowest)

**Worked example — four sources set `server.port` at once.** The classic follow-up: you set the *same* key in four places and are asked which port boots. Concretely you run:

```
# application.properties (inside the jar)
server.port=8080

# then launch:
SERVER_PORT=8083 java -Dserver.port=8081 -jar app.jar --server.port=8082
```

Now map each to its rank in the list above and sort highest-wins:

| Source | Value | Rank (lower = higher priority) |
|---|---|---|
| Command-line arg `--server.port=8082` | 8082 | **4** |
| Java system property `-Dserver.port=8081` | 8081 | 8 |
| OS env var `SERVER_PORT=8083` (relaxed-bound) | 8083 | 9 |
| `application.properties` | 8080 | 11 |

Spring walks the ordered `PropertySource`s and takes the **first** that has `server.port`. Rank 4 (command-line) is highest, so **the app boots on port 8082** — the `-D`, the env var, and the properties file are all shadowed. Note this is *not* "biggest number wins" and *not* "last one on the line wins": it is purely position in the precedence list. If you then delete `--server.port=8082`, the winner becomes the system property (8081); delete that too and the env var (8083) wins; only with all three removed does the file's 8080 take effect. Corollary: `setDefaultProperties` sits at the *bottom* (rank 13), so it is a fallback anything can override, whereas the command-line argument (rank 4) is the highest slot an operator can inject at launch — the practical "always wins" position.

**Relaxed binding + env var mapping (trap).** `server.port`, `SERVER_PORT`, `server_port`, and `serverPort` all bind to the same property because Boot uses **relaxed binding**. Environment variables in particular are matched by uppercasing and replacing `.`/`-` with `_`, so `spring.datasource.url` ← `SPRING_DATASOURCE_URL`. This is how you configure Boot in containers without a properties file.

**`spring.config.import` (Boot 2.4+).** Replaces the older, order-fragile `spring.config.location` chaining for pulling in extra config: `spring.config.import=optional:configtree:/run/secrets/` (Kubernetes/Docker secrets), `optional:file:./dev.properties`, `env:MY_JSON`. Imported documents are inserted **immediately below** the importing document and their values take precedence over the importer; the `optional:` prefix prevents a startup failure if the location is absent.

**Boot 2.4 config-data ordering change (gotcha).** Boot 2.4 replaced the legacy property-loading order with the "config data" model. Two consequences bite migrators: (a) profile-specific documents now always override profile-agnostic ones **regardless of file order**, and (b) `spring.profiles.active` **cannot** be set from within a profile-specific document — use `spring.config.activate.on-profile` and `spring.profiles.group` instead. `spring.profiles` (the old key) was removed.

---

## @ConfigurationProperties vs @Value

**Beginner definition.** Both read externalized config. `@Value("${a.b}")` injects a single resolved value into a field/param; `@ConfigurationProperties(prefix="a")` binds a whole tree of properties onto a POJO.

**Why `@ConfigurationProperties` is preferred for real config.** It supports **relaxed binding**, type conversion, `Duration`/`DataSize` parsing, nested objects, `List`/`Map` binding, JSR-303 validation (`@Validated`), and IDE metadata via `spring-boot-configuration-processor`. `@Value` supports SpEL (`#{...}`) but **not** relaxed binding and gives poor errors for missing/typo'd keys.

**Constructor binding (Boot 2.2+/immutable, expert).** Annotate the properties class with `@ConfigurationProperties` and use a constructor (records work great in Boot 3). To activate it you either put `@EnableConfigurationProperties(MyProps.class)` on a config class, add `@ConfigurationPropertiesScan`, or annotate the class with `@ConfigurationProperties` **and** register it as a bean. With constructor binding the class need not have setters and can be `final`/immutable; `@ConstructorBinding` is now inferred when there's a single parameterized constructor (explicit annotation only needed to disambiguate multiple constructors).

**Common trap.** A bare `@ConfigurationProperties` POJO annotated only with `@ConfigurationProperties` (no `@Component`, not in `@EnableConfigurationProperties`, no `@ConfigurationPropertiesScan`) is **never registered as a bean** and silently does nothing. Also: `@Value` is resolved by a `BeanPostProcessor` and does not see relaxed-bound names, so `@Value("${serverPort}")` fails where `server.port` is defined.

---

## Bean Overriding and Definition Conflicts

**The Boot 2.1+ default (trap).** Bean definition overriding is **disabled by default** since Boot 2.1. If two beans register the same name, startup fails with `BeanDefinitionOverrideException` rather than one silently clobbering the other. Re-enable (rarely advisable) with `spring.main.allow-bean-definition-overriding=true`.

**`@Primary`, `@Qualifier`, and `@ConditionalOnSingleCandidate` interplay.** When multiple candidates of a type exist, injection needs a `@Primary` bean or a `@Qualifier` at the injection point, else `NoUniqueBeanDefinitionException`. `@ConditionalOnSingleCandidate(T.class)` matches when there is exactly one bean of `T` **or** multiple but exactly one marked `@Primary` — auto-config uses this to safely consume a user-provided bean only when it's unambiguous.

**Auto-config back-off is name-and-type aware.** `@ConditionalOnMissingBean` by default matches on **type**, but you can scope it by `name`, `value` (types), `annotation`, or `ignored` types. A user bean of a *subtype* still triggers back-off of a supertype `@ConditionalOnMissingBean` because assignability is checked — a frequent "why didn't my auto-config bean appear?" surprise.

---

## Failure Analysis and Diagnostics

**`FailureAnalyzer` (advanced).** Registered in `spring.factories`, a `FailureAnalyzer` turns a raw exception into a readable `FailureAnalysis` with a description and an "action". This is why "Failed to configure a DataSource" prints a tidy, actionable message instead of a stack trace — `DataSourceBeanCreationFailureAnalyzer` produced it. Custom libraries can ship their own analyzers; they run at startup failure time, before the context is usable, so they must not depend on beans.

**Condition Evaluation Report on failure.** When startup fails, Boot can still print the condition report (with `debug=true`) — invaluable for "why did/didn't auto-config X apply?" investigations. `/actuator/conditions` exposes the same data at runtime for a healthy app.

**Startup timing (`ApplicationStartup`).** Boot 2.4+ can record fine-grained startup steps via `BufferingApplicationStartup`; `/actuator/startup` exposes them so you can find which bean/auto-config dominates cold-start time — the modern replacement for ad-hoc `StopWatch` logging.

---

## Profiles and Environment

**Definition.** A **profile** is a named logical group of beans/config activated via `spring.profiles.active` (or `SPRING_PROFILES_ACTIVE`). `@Profile("prod")` on a bean/config includes it only when active; `@Profile("!prod")` negates.

**Interaction with auto-config (trap).** `@Profile` is evaluated as an ordinary condition during context refresh, so a profile-guarded **user** bean may or may not exist when an auto-config's `@ConditionalOnMissingBean` runs — but because auto-config runs last, the profile decision is already settled by then, so back-off is still reliable. Activating profiles from *within* profile-specific documents is forbidden (see config-data note above).

**Programmatic activation.** `SpringApplication.setAdditionalProfiles(...)` or `spring.profiles.include` add profiles without replacing the active set. `spring.profiles.group.prod=prod,monitoring` expands one activated profile into several.

---

## Common follow-up questions

- What three annotations make up `@SpringBootApplication`, and why must the main class sit in a root package? `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`; component scan and `@AutoConfigurationPackage` default to the main class's package.
- Why does `@ConditionalOnMissingBean` reliably let user beans win? Auto-configuration is processed *after* user configuration (via `DeferredImportSelector`), so the user bean is already present when the condition is checked.
- Where are auto-configuration classes registered in Boot 3? `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`, one FQCN per line; classes are annotated `@AutoConfiguration`.
- Is `spring.factories` gone in Boot 3? No — only the `EnableAutoConfiguration` auto-config registration moved out; `spring.factories` still registers listeners, initializers, `EnvironmentPostProcessor`, `FailureAnalyzer`, etc.
- How do you disable a specific auto-config? `exclude`/`excludeName` on the annotation or `spring.autoconfigure.exclude` property.
- How do you change the embedded server? Exclude `spring-boot-starter-tomcat` and add the Jetty/Undertow starter.
- What is the difference between a starter and a BOM? A starter adds dependencies to the build; a BOM only manages their versions (`dependencyManagement`, adds nothing itself).
- Why can't `java -jar` normally load a Boot fat JAR's dependencies without the loader? JVM can't read classes from nested JARs; Boot's `JarLauncher` + custom class loader handle `BOOT-INF/lib/*.jar`.
- What ordering do the SpringApplication lifecycle events follow? starting → environmentPrepared → contextInitialized → prepared → (refresh) → started → runners → ready.
- `CommandLineRunner` vs `ApplicationRunner`? Raw `String...` args vs parsed `ApplicationArguments`; both run after context ready, orderable with `@Order`.
- How does a custom starter get its beans loaded if its package isn't scanned? Registration in the `AutoConfiguration.imports` file (not component scanning).

## References

- Spring Boot Reference Documentation — "Creating Your Own Auto-configuration and Starter": https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html
- Spring Boot Reference — "Auto-configuration" & Condition Evaluation Report: https://docs.spring.io/spring-boot/reference/using/auto-configuration.html
- Spring Boot Reference — "The Executable Jar Format": https://docs.spring.io/spring-boot/specification/executable-jar/index.html
- Spring Boot Reference — "Packaging Layered Jars / Efficient Container Images": https://docs.spring.io/spring-boot/reference/packaging/efficient.html
- Spring Boot Reference — "Dependency Management / Build Systems": https://docs.spring.io/spring-boot/reference/using/build-systems.html
- Spring Boot Reference — "Spring Application" (run flow, events, runners): https://docs.spring.io/spring-boot/reference/features/spring-application.html
- Spring Boot source — `BackgroundPreinitializer` (runs when `availableProcessors() > 1`; disabled via `spring.backgroundpreinitializer.ignore`): https://github.com/spring-projects/spring-boot/blob/v3.3.0/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/BackgroundPreinitializer.java
- Spring Boot 2.7 Release Notes — auto-configuration registration change: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.7-Release-Notes
- Spring Boot 3.0 Migration Guide — Jakarta EE, Java 17: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide
- Spring Framework `SpringFactoriesLoader` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/io/support/SpringFactoriesLoader.html
- Baeldung — "Spring Boot Starters": https://www.baeldung.com/spring-boot-starters
- Baeldung — "Create a Custom Auto-Configuration with Spring Boot": https://www.baeldung.com/spring-boot-custom-auto-configuration
- Baeldung — "@ConditionalOnProperty and friends": https://www.baeldung.com/spring-conditionalonproperty
- Spring Boot Reference — "Externalized Configuration" (property source order, relaxed binding, spring.config.import): https://docs.spring.io/spring-boot/reference/features/external-config.html
- Spring Boot Reference — "Type-safe Configuration Properties" (@ConfigurationProperties, constructor binding): https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.typesafe-configuration-properties
- Spring Boot Reference — "Profiles": https://docs.spring.io/spring-boot/reference/features/profiles.html
- Spring Boot 2.4 Config Data Migration Guide: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-Config-Data-Migration-Guide
- Spring Boot Reference — "Efficient Container Images" (tools jarmode, CDS/AOT): https://docs.spring.io/spring-boot/reference/packaging/efficient.html
- Spring Framework — `ConfigurationCondition` and `AnyNestedCondition` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/annotation/ConfigurationCondition.html
