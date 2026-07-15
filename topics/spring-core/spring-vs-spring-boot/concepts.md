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

The Spring Framework itself has **no auto-configuration** — this is purely a Boot feature.

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

## Embedded server and packaging

- **Plain Spring MVC**: traditionally packaged as a **WAR** and deployed to an **external servlet container** (Tomcat, Jetty, WebLogic). You install and manage that server separately.
- **Spring Boot**: embeds the servlet container **inside** the application. It builds an executable **"fat"/"uber" JAR** containing your code, all dependencies, and the embedded server, so you run it with `java -jar app.jar`. This is ideal for containers, microservices, and cloud deployment.

Details worth knowing:

- The default embedded server for `spring-boot-starter-web` is **Tomcat**; you can swap to **Jetty** or **Undertow** by excluding Tomcat and adding the alternative starter.
- Boot's fat JAR uses a special nested-JAR layout and a custom launcher (`org.springframework.boot.loader.launch.JarLauncher`), created by the `spring-boot-maven-plugin` / `spring-boot-gradle-plugin` (the "repackage" goal).
- Boot can still produce a WAR for deployment to an external container (extend `SpringBootServletInitializer`), but the executable JAR is the default and recommended model.
- For reactive apps (`spring-boot-starter-webflux`) the default embedded server is **Netty**.

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

## SpringApplication and the bootstrap process

Plain Spring: you create the context yourself.

```java
ApplicationContext ctx =
    new AnnotationConfigApplicationContext(AppConfig.class);
MyService s = ctx.getBean(MyService.class);
```

Spring Boot: `SpringApplication.run(...)` does a lot of orchestration for you — it decides the application type (servlet, reactive, or none) from the classpath, creates the appropriate `ApplicationContext`, applies auto-configuration, loads externalized configuration and profiles, starts the embedded server, prints the banner, publishes lifecycle events (`ApplicationStartingEvent`, `ApplicationReadyEvent`, …), and runs any `CommandLineRunner`/`ApplicationRunner` beans.

None of this changes what a bean *is* — it is still an ordinary Spring bean in an ordinary Spring context. Boot is automating the bootstrap that you would otherwise write by hand.

## Configuration approaches: XML, Java config, properties

- **Plain Spring** historically favored **XML** (`applicationContext.xml`, `<bean>` definitions) and later **Java `@Configuration`** classes and annotations. Both are fully supported today; XML is legacy but still valid.
- **Spring Boot** discourages XML and centers on **annotation/Java config plus externalized properties** (`application.properties` / `application.yml`), with strong support for **`@ConfigurationProperties`** type-safe binding and **profiles** (`application-dev.yml`, `spring.profiles.active`).

Boot did not invent externalized configuration or profiles — Spring's `Environment` abstraction and `@Profile` predate Boot. Boot builds on them with conventions (standard file names, relaxed binding, property source ordering) and features like `@ConfigurationProperties`.

## Actuator and production-ready features

**Spring Boot Actuator** (`spring-boot-starter-actuator`) adds production-grade operational endpoints over HTTP or JMX with little configuration:

- `/actuator/health` — liveness/readiness and component health.
- `/actuator/metrics` and Micrometer integration — JVM, HTTP, datasource metrics, exportable to Prometheus, CloudWatch, etc.
- `/actuator/info`, `/actuator/env`, `/actuator/loggers`, `/actuator/conditions` (the auto-config report), `/actuator/beans`, `/actuator/mappings`, and more.

By default (Boot 2.x+) only `health` is exposed over HTTP; you opt in to others via `management.endpoints.web.exposure.include`.

The **Spring Framework has no Actuator** — monitoring/metrics/health endpoints are entirely a Boot feature (built, of course, on Spring beans and Spring MVC/WebFlux under the hood).

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

## Common follow-up questions

- **Does Spring Boot replace the Spring Framework?** No. Boot depends on and configures the Spring Framework; a Boot app is a normal Spring `ApplicationContext`.
- **What three annotations does `@SpringBootApplication` combine?** `@SpringBootConfiguration`, `@EnableAutoConfiguration`, `@ComponentScan`.
- **How does auto-configuration know what to configure?** Conditional annotations (`@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`, …) evaluated against the classpath and existing beans; auto-config runs after user config and backs off when you've defined a bean yourself.
- **What is a starter?** A curated transitive dependency bundle (e.g. `spring-boot-starter-web`) with versions managed by the Boot BOM.
- **How does a Boot app run without an external server?** It embeds Tomcat/Jetty/Undertow (Netty for WebFlux) and packages an executable fat JAR run via `java -jar`.
- **Can you override an auto-configured bean?** Yes — define your own bean and `@ConditionalOnMissingBean` makes Boot back off; you can also `exclude` auto-configuration classes.
- **What does Actuator give you and does plain Spring have it?** Health, metrics, info, env, and other operational endpoints; it is a Boot-only feature.
- **Java/Jakarta namespace?** Spring Framework 6 / Boot 3 need Java 17+ and use `jakarta.*`; Spring 5 / Boot 2 use `javax.*`.
- **When would you NOT use Boot?** Legacy WAR-to-external-server deployments, tightly constrained dependency environments, or minimal use of a single Spring module.

## References

- Spring Framework Reference Documentation — https://docs.spring.io/spring-framework/reference/
- Spring Boot Reference Documentation — https://docs.spring.io/spring-boot/
- Spring Boot "Auto-configuration" — https://docs.spring.io/spring-boot/reference/using/auto-configuration.html
- Spring Boot Starters — https://docs.spring.io/spring-boot/reference/using/build-systems.html#using.build-systems.starters
- `@SpringBootApplication` — https://docs.spring.io/spring-boot/reference/using/using-the-springbootapplication-annotation.html
- Spring Boot Actuator — https://docs.spring.io/spring-boot/reference/actuator/
- Spring Framework 6.0 Upgrade / Jakarta EE 9 baseline — https://github.com/spring-projects/spring-framework/wiki/Upgrading-to-Spring-Framework-6.x
- Spring Initializr — https://start.spring.io/
