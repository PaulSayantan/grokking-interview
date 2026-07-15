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

**Beginner definition.** Auto-configuration is Boot's process of automatically registering beans your app likely needs, based on the classpath, existing beans, and properties. It is enabled by `@EnableAutoConfiguration` (included in `@SpringBootApplication`).

**How it works (intermediate).**
1. `@EnableAutoConfiguration` imports `AutoConfigurationImportSelector`.
2. That selector loads the list of candidate auto-configuration class names — in **Boot 2.7+/3.x** from `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`; in **Boot ≤2.6** from the `EnableAutoConfiguration` key in `META-INF/spring.factories`.
3. Candidates are **filtered** by `AutoConfigurationImportFilter`s (like `OnClassCondition`, `OnBeanCondition`, `OnWebApplicationCondition`) — cheap classpath checks discard classes whose required types are absent, *before* the context does expensive evaluation.
4. Surviving classes are ordered (`@AutoConfigureBefore`/`@AutoConfigureAfter`/`@AutoConfigureOrder`) and imported as `@Configuration` classes.
5. Each is evaluated against its `@Conditional...` annotations; only matching beans are registered.

**Key ordering guarantee (trap).** Auto-configuration classes are **always processed last**, after your own user-defined configuration. That is *why* `@ConditionalOnMissingBean` works: by the time an auto-config bean is evaluated, your own bean (if any) is already registered, so Boot backs off. Your explicit beans win.

**Advanced internals.** `AutoConfigurationImportSelector` implements `DeferredImportSelector`, which is the reason auto-config runs after regular `@Import`/`@Configuration` processing. Results are cached; the `spring-autoconfigure-metadata.properties` file (generated at build time) provides condition metadata used by the filters for fast exclusion.

**Debugging.** Run with `--debug` (or set `debug=true`) to print the **Condition Evaluation Report**: `Positive matches`, `Negative matches`, `Exclusions`, `Unconditional classes`.

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

**`matchIfMissing` (trap).** `@ConditionalOnProperty(name="feature.enabled", havingValue="true", matchIfMissing=true)` matches when the property is absent *or* equals `true`. Without `matchIfMissing`, an absent property means **no match**.

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

Extract them with `java -Djarmode=layertools -jar app.jar extract` (Boot 2.3–3.1) or the newer `-Djarmode=tools extract --layers` (3.2+), then `COPY` each layer as a separate Docker layer so a code-only change re-ships only the small `application` layer.

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

## Common follow-up questions

- **What three annotations make up `@SpringBootApplication`, and why must the main class sit in a root package?** `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`; component scan and `@AutoConfigurationPackage` default to the main class's package.
- **Why does `@ConditionalOnMissingBean` reliably let user beans win?** Auto-configuration is processed *after* user configuration (via `DeferredImportSelector`), so the user bean is already present when the condition is checked.
- **Where are auto-configuration classes registered in Boot 3?** `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`, one FQCN per line; classes are annotated `@AutoConfiguration`.
- **Is `spring.factories` gone in Boot 3?** No — only the `EnableAutoConfiguration` auto-config registration moved out; `spring.factories` still registers listeners, initializers, `EnvironmentPostProcessor`, `FailureAnalyzer`, etc.
- **How do you disable a specific auto-config?** `exclude`/`excludeName` on the annotation or `spring.autoconfigure.exclude` property.
- **How do you change the embedded server?** Exclude `spring-boot-starter-tomcat` and add the Jetty/Undertow starter.
- **What is the difference between a starter and a BOM?** A starter adds dependencies to the build; a BOM only manages their versions (`dependencyManagement`, adds nothing itself).
- **Why can't `java -jar` normally load a Boot fat JAR's dependencies without the loader?** JVM can't read classes from nested JARs; Boot's `JarLauncher` + custom class loader handle `BOOT-INF/lib/*.jar`.
- **What ordering do the SpringApplication lifecycle events follow?** starting → environmentPrepared → contextInitialized → prepared → (refresh) → started → runners → ready.
- **`CommandLineRunner` vs `ApplicationRunner`?** Raw `String...` args vs parsed `ApplicationArguments`; both run after context ready, orderable with `@Order`.
- **How does a custom starter get its beans loaded if its package isn't scanned?** Registration in the `AutoConfiguration.imports` file (not component scanning).

## References

- Spring Boot Reference Documentation — "Creating Your Own Auto-configuration and Starter": https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html
- Spring Boot Reference — "Auto-configuration" & Condition Evaluation Report: https://docs.spring.io/spring-boot/reference/using/auto-configuration.html
- Spring Boot Reference — "The Executable Jar Format": https://docs.spring.io/spring-boot/specification/executable-jar/index.html
- Spring Boot Reference — "Packaging Layered Jars / Efficient Container Images": https://docs.spring.io/spring-boot/reference/packaging/efficient.html
- Spring Boot Reference — "Dependency Management / Build Systems": https://docs.spring.io/spring-boot/reference/using/build-systems.html
- Spring Boot Reference — "Spring Application" (run flow, events, runners): https://docs.spring.io/spring-boot/reference/features/spring-application.html
- Spring Boot 2.7 Release Notes — auto-configuration registration change: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.7-Release-Notes
- Spring Boot 3.0 Migration Guide — Jakarta EE, Java 17: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide
- Spring Framework `SpringFactoriesLoader` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/io/support/SpringFactoriesLoader.html
- Baeldung — "Spring Boot Starters": https://www.baeldung.com/spring-boot-starters
- Baeldung — "Create a Custom Auto-Configuration with Spring Boot": https://www.baeldung.com/spring-boot-custom-auto-configuration
- Baeldung — "@ConditionalOnProperty and friends": https://www.baeldung.com/spring-conditionalonproperty
