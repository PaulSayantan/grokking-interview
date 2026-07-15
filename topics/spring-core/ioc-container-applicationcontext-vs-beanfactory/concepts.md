# IoC Container: ApplicationContext vs BeanFactory

Spring's core is a container that creates, wires, configures, and manages the
lifecycle of application objects ("beans"). Two interfaces model this container:
the low-level `BeanFactory` and the richer `ApplicationContext` (which extends
`BeanFactory`). Understanding the difference — and *why* Inversion of Control
matters — is one of the most commonly asked Spring interview topics.

---

## Inversion of Control principle and why it matters

**Inversion of Control (IoC)** is a design principle in which the control over
object creation and the wiring of collaborators is *inverted* — moved out of the
application code and handed to an external component (the container). Instead of
an object constructing or looking up its own dependencies, the dependencies are
supplied *to* it.

**Dependency Injection (DI)** is the specific implementation of IoC that Spring
uses: the container injects collaborators via constructors, setters, or fields.
(IoC is the broad principle; another form of IoC is the Service Locator pattern,
which Spring generally discourages in favor of DI.)

Traditional, tightly-coupled code:

```java
class OrderService {
    // OrderService decides which implementation to use and how to build it.
    private final PaymentGateway gateway = new StripePaymentGateway();
}
```

IoC / DI version:

```java
class OrderService {
    private final PaymentGateway gateway;

    // The collaborator is handed in; OrderService does not know or care
    // which concrete PaymentGateway it receives.
    OrderService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

**Why it matters:**

- **Loose coupling** — classes depend on abstractions, not concrete types.
- **Testability** — you can inject mocks/stubs in unit tests without a container.
- **Configurability** — swap implementations via configuration, not code changes.
- **Single Responsibility** — business classes focus on behavior, not wiring.
- **Lifecycle management** — the container handles construction order, singletons,
  init/destroy callbacks, and cleanup.

The phrase **"Hollywood Principle" — "Don't call us, we'll call you"** captures IoC:
the framework calls your code at the right time, rather than your code driving the
framework.

---

## The job of the IoC container

The container is the object that reads *configuration metadata*, then instantiates,
configures, wires, and manages beans. Its responsibilities:

1. **Read configuration metadata** — from XML, Java `@Configuration` classes, or
   component scanning of annotations. The metadata is parsed into `BeanDefinition`
   objects (a recipe describing how to create each bean: class, scope, constructor
   args, property values, init/destroy methods, lazy flag, etc.).
2. **Instantiate beans** — create instances according to each `BeanDefinition`,
   choosing constructors and resolving constructor arguments.
3. **Inject dependencies** — resolve and set collaborators (by type, by name, via
   `@Autowired`, `@Resource`, `@Inject`, constructor args, `<property>`, etc.).
4. **Apply lifecycle callbacks** — `@PostConstruct`, `InitializingBean.afterPropertiesSet()`,
   custom init methods on startup; `@PreDestroy`, `DisposableBean.destroy()`, custom
   destroy methods on shutdown.
5. **Manage scopes** — singleton (one shared instance per container, the default),
   prototype (a new instance per lookup), and web scopes (request, session, etc.).
6. **Apply post-processing** — `BeanPostProcessor` and `BeanFactoryPostProcessor`
   hooks that let the framework (and you) modify bean definitions or wrap beans
   (e.g., to create AOP proxies).

The key mental model: **configuration metadata + POJOs → container → fully wired,
production-ready objects.**

---

## BeanFactory: the basic container

`org.springframework.beans.factory.BeanFactory` is the **root interface** of the
Spring IoC container. It defines the most fundamental container contract: hold bean
definitions and hand back beans on demand.

Core capabilities:

- Bean instantiation and **basic dependency injection**.
- Bean lookup by name and/or type: `getBean(String)`, `getBean(Class<T>)`.
- Scope handling (singleton/prototype) and `isSingleton`/`isPrototype` queries.
- Lifecycle wiring at a basic level.

Key behavioral trait: **lazy initialization**. A plain `BeanFactory`
(e.g., `DefaultListableBeanFactory`) does not pre-instantiate singletons. A bean is
created only when it is first requested via `getBean(...)`. This gives a lighter,
more memory-frugal footprint and faster startup, at the cost of discovering
configuration errors later (at first access rather than at startup).

```java
// Programmatic, low-level use of a bean factory.
DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
BeanDefinition def = BeanDefinitionBuilder
        .genericBeanDefinition(OrderService.class)
        .getBeanDefinition();
factory.registerBeanDefinition("orderService", def);

// Bean is created lazily, only here on first request.
OrderService service = factory.getBean(OrderService.class);
```

What a plain `BeanFactory` does **not** do automatically:

- It does **not** automatically detect and register `BeanPostProcessor`s or
  `BeanFactoryPostProcessor`s — you must register them programmatically
  (`addBeanPostProcessor(...)`).
- No built-in support for internationalization (`MessageSource`).
- No built-in application event publishing.
- No convenient resource loading via `getResource(...)`.
- No automatic annotation processing (`@Autowired`, `@PostConstruct`, etc.) unless
  you register the relevant post-processors yourself.

`DefaultListableBeanFactory` is the full-featured, canonical `BeanFactory`
implementation and — importantly — it is the *engine* that `ApplicationContext`
implementations use internally.

---

## ApplicationContext: the enterprise container

`org.springframework.context.ApplicationContext` **extends `BeanFactory`** (through
several sub-interfaces) and is the interface you use in almost all real applications.
It is a superset: everything a `BeanFactory` can do, plus enterprise features.

Added capabilities beyond `BeanFactory`:

- **Automatic `BeanPostProcessor` registration** — post-processors declared as beans
  are detected and applied automatically (this is how `@Autowired`, `@Value`,
  `@PostConstruct`, AOP proxying, etc. "just work").
- **Automatic `BeanFactoryPostProcessor` registration** — e.g.,
  `PropertySourcesPlaceholderConfigurer` for `${...}` placeholder resolution.
- **Internationalization** via `MessageSource` (`getMessage(...)`).
- **Application event publishing** via `ApplicationEventPublisher` — publish and
  listen for events (`ApplicationEvent`, `@EventListener`,
  `ApplicationListener`).
- **Resource loading** — `ApplicationContext` is a `ResourceLoader`;
  `getResource("classpath:...")` returns `Resource` objects.
- **Environment abstraction** — access to `Environment` (profiles and properties).
- **Convenient integration with AOP**, declarative transactions, and other
  framework services.

Key behavioral trait: **eager initialization of singletons**. By default an
`ApplicationContext` pre-instantiates all singleton beans during startup (at the
end of `refresh()`). This surfaces misconfiguration *immediately* at startup
(fail-fast) rather than on first use, and means the first request is not slowed by
lazy construction. Individual beans can still opt out with `@Lazy` /
`lazy-init="true"`.

Interface hierarchy (simplified):

```
BeanFactory
   ^
   |  (extends, through several interfaces)
ListableBeanFactory, HierarchicalBeanFactory
   ^
ApplicationContext  ── also extends ─→ MessageSource,
   |                                    ApplicationEventPublisher,
   |                                    ResourcePatternResolver (ResourceLoader),
   |                                    EnvironmentCapable
ConfigurableApplicationContext (adds refresh(), close(), registerShutdownHook())
```

### BeanFactory vs ApplicationContext comparison

| Feature | BeanFactory | ApplicationContext |
|---|---|---|
| Basic DI and bean lookup | Yes | Yes |
| Default singleton init | Lazy (on first `getBean`) | Eager (at startup / `refresh()`) |
| `BeanPostProcessor` registration | Manual | Automatic |
| `BeanFactoryPostProcessor` registration | Manual | Automatic |
| Annotation config (`@Autowired`, `@PostConstruct`) | Manual setup | Automatic (post-processors registered) |
| Internationalization (`MessageSource`) | No | Yes |
| Event publishing / listeners | No | Yes |
| Resource loading (`ResourceLoader`) | No | Yes |
| `Environment` / profiles / properties | No | Yes |
| Convenient AOP / declarative services | No | Yes (via auto-registered infrastructure) |
| Startup footprint | Lighter | Heavier (more infrastructure) |
| Typical use | Rare / embedded / memory-constrained | Almost all applications |

Rule of thumb: **use `ApplicationContext` unless you have a specific reason not to.**
The Spring reference documentation explicitly recommends `ApplicationContext` and
describes `BeanFactory` usage as effectively deprecated for typical applications.

---

## Common ApplicationContext implementations

You rarely implement `ApplicationContext`; you pick a bundled implementation based
on where your configuration metadata lives.

**`ClassPathXmlApplicationContext`** — loads XML bean definitions from the
classpath.

```java
ApplicationContext ctx =
    new ClassPathXmlApplicationContext("applicationContext.xml");
OrderService svc = ctx.getBean(OrderService.class);
```

**`FileSystemXmlApplicationContext`** — loads XML bean definitions from absolute or
relative file-system paths (not the classpath).

```java
ApplicationContext ctx =
    new FileSystemXmlApplicationContext("/etc/app/beans.xml");
```

**`AnnotationConfigApplicationContext`** — the standard choice for Java-based
configuration. It reads `@Configuration` classes and/or performs component scanning
of `@Component`/`@Service`/`@Repository`/`@Controller` classes. No XML required.

```java
@Configuration
@ComponentScan("com.example.app")
class AppConfig {
    @Bean PaymentGateway paymentGateway() { return new StripePaymentGateway(); }
}

ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
// or register/scan explicitly:
// var ctx = new AnnotationConfigApplicationContext();
// ctx.register(AppConfig.class);
// ctx.scan("com.example.app");
// ctx.refresh();
```

**`GenericApplicationContext`** — a flexible, general-purpose implementation that is
*not* tied to a specific configuration format. You attach reader/scanner delegates
(e.g., `XmlBeanDefinitionReader`, `AnnotatedBeanDefinitionReader`,
`ClassPathBeanDefinitionScanner`) or register beans programmatically, then call
`refresh()` exactly once. `AnnotationConfigApplicationContext` and
`GenericWebApplicationContext` are built on top of it. Since Spring 5 it also
supports functional bean registration via `registerBean(...)` with a supplier.

```java
GenericApplicationContext ctx = new GenericApplicationContext();
ctx.registerBean(OrderService.class, () -> new OrderService(...));
ctx.refresh();   // must be called exactly once before use
```

**Web variants** — `XmlWebApplicationContext`,
`AnnotationConfigWebApplicationContext`, and (for Spring MVC / Servlet apps)
`GenericWebApplicationContext` / `AnnotationConfigServletWebServerApplicationContext`
(the latter being a Spring Boot type). In classic Spring MVC the root context is
created by `ContextLoaderListener` and the per-servlet context by `DispatcherServlet`.

| Implementation | Config source | Notes |
|---|---|---|
| `ClassPathXmlApplicationContext` | XML on classpath | Classic XML apps |
| `FileSystemXmlApplicationContext` | XML from file system | Absolute/relative FS paths |
| `AnnotationConfigApplicationContext` | `@Configuration` / scanning | Standard Java-config choice |
| `GenericApplicationContext` | Format-agnostic (readers/programmatic) | Fine-grained control; call `refresh()` once |
| `AnnotationConfigWebApplicationContext` | Java config, web | Spring MVC root/servlet context |

---

## Container startup and the refresh method

Every `ConfigurableApplicationContext` centralizes its startup in the
`refresh()` method (defined on `ConfigurableApplicationContext`, implemented in
`AbstractApplicationContext.refresh()`). It runs as a **synchronized, ordered
sequence of phases** and is where a context transitions from "configured" to
"fully initialized and ready." For XML/annotation context constructors, `refresh()`
is invoked automatically inside the constructor; for `GenericApplicationContext`
you call it yourself, and only once.

High-level phases of `AbstractApplicationContext.refresh()`:

1. **`prepareRefresh()`** — mark active, set start time, initialize property sources,
   validate required properties.
2. **`obtainFreshBeanFactory()`** — create/refresh the internal
   `DefaultListableBeanFactory` and load `BeanDefinition`s from the configuration.
3. **`prepareBeanFactory()`** — configure the bean factory: set the class loader,
   register default environment beans, add standard `BeanPostProcessor`s
   (e.g., `ApplicationContextAwareProcessor`), ignore certain dependency types.
4. **`postProcessBeanFactory()`** — subclass hook to register additional factory
   post-processing.
5. **`invokeBeanFactoryPostProcessors()`** — run all `BeanFactoryPostProcessor`s;
   this is where `@Configuration` classes are parsed (`ConfigurationClassPostProcessor`)
   and `${...}` placeholders resolved. These operate on **bean definitions**, before
   beans are instantiated.
6. **`registerBeanPostProcessors()`** — detect and register all `BeanPostProcessor`
   beans so they can intercept subsequent bean creation.
7. **`initMessageSource()`** — initialize the `MessageSource` (i18n).
8. **`initApplicationEventMulticaster()`** — set up the event multicaster.
9. **`onRefresh()`** — subclass hook (e.g., web contexts create the embedded/servlet
   web server here in Boot).
10. **`registerListeners()`** — register `ApplicationListener` beans.
11. **`finishBeanFactoryInitialization()`** — **instantiate all remaining non-lazy
    singleton beans** (eager initialization happens here).
12. **`finishRefresh()`** — publish `ContextRefreshedEvent`, start `Lifecycle` beans.

Important distinction:

- **`BeanFactoryPostProcessor`** modifies **bean definitions** (metadata) *before*
  any beans are instantiated (phase 5).
- **`BeanPostProcessor`** intercepts **bean instances** during their creation
  (before/after initialization callbacks), enabling proxying, injection of
  annotations, etc. (registered in phase 6, applied in phase 11 and later).

On shutdown, `close()` (or a JVM shutdown hook registered via
`registerShutdownHook()`) publishes `ContextClosedEvent`, destroys singleton beans
(invoking `@PreDestroy`, `DisposableBean.destroy()`, and custom destroy methods),
and releases resources.

---

## When a plain BeanFactory would ever be used

For the vast majority of applications you should use `ApplicationContext`. A plain
`BeanFactory` is a niche choice, appropriate only when its lighter footprint or
lazy behavior genuinely matters. Legitimate scenarios:

- **Severely memory-constrained environments** — historically applets, older mobile
  devices, or tiny embedded runtimes, where the extra infrastructure of a full
  `ApplicationContext` is undesirable.
- **Very fast startup with strictly lazy creation** — when you want beans created
  only on first access and can accept discovering config errors late.
- **Framework-internal / library code** — Spring itself uses
  `DefaultListableBeanFactory` internally as the engine inside every
  `ApplicationContext`. Library authors sometimes use a bare bean factory to embed a
  minimal container.
- **Simple programmatic registration** where you don't need i18n, events, resource
  loading, or automatic post-processor registration, and are willing to wire
  post-processors by hand.

Trade-offs you accept with a plain `BeanFactory`:

- You must **manually register** `BeanPostProcessor`s /
  `BeanFactoryPostProcessor`s; otherwise annotation-driven features
  (`@Autowired`, `@PostConstruct`, AOP, `${...}` placeholders) will not work.
- **Lazy singletons** mean configuration errors surface later, at first `getBean`,
  not at startup — you lose fail-fast behavior.
- No `MessageSource`, event publishing, resource loading, or `Environment`
  conveniences.

The Spring reference documentation states plainly that `ApplicationContext` is
preferred and that you should use `BeanFactory` only if there is a compelling
reason not to — for example, memory consumption in a resource-constrained scenario.

---

## Common follow-up questions

- **Is `ApplicationContext` a `BeanFactory`?** Yes — `ApplicationContext` extends
  `BeanFactory` (via `ListableBeanFactory` and `HierarchicalBeanFactory`), so every
  `ApplicationContext` *is* a `BeanFactory` with added enterprise features.
- **What is the default bean scope, and how are singletons initialized?** The default
  scope is `singleton` (one instance per container). In an `ApplicationContext`,
  non-lazy singletons are created eagerly during `refresh()`; a plain `BeanFactory`
  creates them lazily on first request.
- **How do you make an `ApplicationContext` bean lazy?** Annotate it with `@Lazy`
  (or `lazy-init="true"` in XML), or set `@Lazy` on a `@Configuration` class to make
  all its `@Bean`s lazy.
- **Difference between `BeanFactoryPostProcessor` and `BeanPostProcessor`?** The
  former modifies bean *definitions* before instantiation; the latter intercepts
  bean *instances* during initialization.
- **Which context implementation for annotation-based Java config?**
  `AnnotationConfigApplicationContext`.
- **What triggers eager singleton creation?** The
  `finishBeanFactoryInitialization()` phase of `refresh()`, which calls
  `preInstantiateSingletons()` on the underlying `DefaultListableBeanFactory`.
- **javax vs jakarta:** Spring Framework 6.x (and Boot 3.x) migrated to the
  `jakarta.*` namespace (e.g., `jakarta.annotation.PostConstruct`,
  `jakarta.inject.Inject`). Spring 5.x and earlier use `javax.*`. The IoC container
  concepts are unchanged; only the annotation package names differ.
- **Does Spring Boot change this?** Spring Boot builds on the same container; its
  `SpringApplication` still creates an `ApplicationContext` (e.g., a
  web `ServletWebServerApplicationContext`) and calls `refresh()`. Auto-configuration
  is a Boot feature layered on top — the core IoC container is identical Spring
  Framework machinery.

---

## References

- Spring Framework Reference — Core Technologies, "The IoC Container":
  https://docs.spring.io/spring-framework/reference/core/beans.html
- Spring Framework Reference — "Container Overview":
  https://docs.spring.io/spring-framework/reference/core/beans/basics.html
- Spring Framework Reference — "BeanFactory API":
  https://docs.spring.io/spring-framework/reference/core/beans/beanfactory.html
- Javadoc — `org.springframework.beans.factory.BeanFactory`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/BeanFactory.html
- Javadoc — `org.springframework.context.ApplicationContext`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/ApplicationContext.html
- Javadoc — `AbstractApplicationContext.refresh()`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/support/AbstractApplicationContext.html
- Spring Framework Reference — "Additional Capabilities of the ApplicationContext":
  https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html
