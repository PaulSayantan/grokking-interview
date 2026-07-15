# Advanced Bean Wiring: FactoryBean, Lazy, and Custom Registration

This topic covers the mechanisms Spring Framework offers beyond the everyday
`@Component` / `@Autowired` / `@Bean` flow. These are the tools you reach for
when a bean cannot be constructed by a plain constructor call, when you must
defer or break creation ordering, when you need on-demand or optional lookup,
or when you must register bean definitions programmatically rather than via
component scanning.

Everything here is **plain Spring Framework** (the `spring-context` /
`spring-beans` modules). None of it depends on Spring Boot auto-configuration.
Where a symbol moved from `javax.*` to `jakarta.*`, that is noted: Spring
Framework 6.x targets **Jakarta EE 9+** (`jakarta.inject`, `jakarta.annotation`),
while Spring 5.x used `javax.*`.

---

## FactoryBean versus a Bean factory method

A **`FactoryBean<T>`** is a bean that is itself a *factory* for another object.
It is an interface in `org.springframework.beans.factory`:

```java
public interface FactoryBean<T> {
    T getObject() throws Exception;        // the object actually exposed as the bean
    Class<?> getObjectType();              // type, or null if not known in advance
    default boolean isSingleton() { return true; } // is getObject() cached?
}
```

The key mental model: when you register a `FactoryBean` under the name
`myBean`, and someone asks the container for `myBean`, they do **not** get the
`FactoryBean` instance — they get the result of `getObject()`. The container
transparently "unwraps" the factory.

```java
public class ConnectionFactoryBean implements FactoryBean<Connection> {
    @Override public Connection getObject() throws Exception {
        return DriverManager.getConnection(url);   // complex construction
    }
    @Override public Class<?> getObjectType() { return Connection.class; }
    @Override public boolean isSingleton() { return true; }
}

@Configuration
class Config {
    @Bean
    ConnectionFactoryBean conn() { return new ConnectionFactoryBean(); }
}

// Elsewhere:
Connection c = ctx.getBean("conn", Connection.class);   // getObject() result
Object factory = ctx.getBean("&conn");                  // the FactoryBean itself
```

### The `&` (ampersand) dereference prefix

To retrieve the `FactoryBean` **instance itself** rather than its product,
prefix the bean name with `&` (the constant `BeanFactory.FACTORY_BEAN_PREFIX`):

- `ctx.getBean("conn")`  -> `Connection` (the product of `getObject()`)
- `ctx.getBean("&conn")` -> the `ConnectionFactoryBean` object

This is the classic interview gotcha: `getBean("&x")` returns the factory,
`getBean("x")` returns the product.

### FactoryBean vs a `@Bean` factory method

A `@Bean` method is *also* a factory — an ordinary method whose return value
becomes the bean. So when do you need `FactoryBean` at all? Mostly for
**framework/library integration** and when the object type is not known until
runtime.

| Aspect | `FactoryBean<T>` | `@Bean` factory method |
|---|---|---|
| Form | A class implementing an interface | A method on a `@Configuration` (or `@Component`) class |
| What container stores | The `FactoryBean`; product created via `getObject()` | The returned object directly |
| Access the factory itself | `getBean("&name")` | Not applicable (method, not a stored bean) |
| Singleton control | `isSingleton()` | `@Scope` on the method |
| Typical use | Integrating legacy/3rd-party factories, dynamic proxies, type unknown until runtime | The default, idiomatic Java-config style |
| Verbosity | More boilerplate (interface, 3 methods) | Concise |
| Introspection | Container can call `getObjectType()` before instantiating the product | Return type known from method signature |

**Guidance:** In modern application code prefer a `@Bean` method — it is
simpler and equally powerful. Reach for `FactoryBean` when you are writing
infrastructure that Spring itself must recognize as a factory (e.g. MyBatis'
`MapperFactoryBean`, Spring's own `ProxyFactoryBean`, `JndiObjectFactoryBean`,
`AbstractFactoryBean`), especially where the exposed type must be advertised via
`getObjectType()` before the product exists.

### `SmartFactoryBean` and eager init

`SmartFactoryBean<T>` extends `FactoryBean<T>` with `isPrototype()` and
`isEagerInit()`. `isEagerInit()` returning `true` lets a singleton
`FactoryBean` have its product created eagerly during context refresh instead
of lazily on first access.

### FactoryBean internals worth knowing

- The container caches the singleton product (when `isSingleton()` is true) in a
  separate `factoryBeanObjectCache`, keyed by bean name.
- `FactoryBean` instances are created **eagerly enough** to call
  `getObjectType()` during type matching, which is why they participate in
  autowiring-by-type of the *product* type.
- `getObjectType()` returning `null` weakens type-based autowiring and
  `getBeansOfType` matching, because the container cannot know the product type
  without instantiating the factory.
- A `FactoryBean` can itself have dependencies injected (it is a normal bean).

---

## Lazy initialization with @Lazy

By default, **singleton** beans are instantiated **eagerly** during
`ApplicationContext` refresh (startup). `@Lazy` defers a singleton's creation
until it is first requested or first injected somewhere that actually resolves
it.

```java
@Component
@Lazy                       // this singleton is created on first use, not at startup
class ExpensiveService { }
```

`@Lazy` can be placed on:

- a `@Component` / `@Bean` definition — marks that *bean* as lazy;
- an injection point (`@Autowired @Lazy Foo foo;` or a constructor/`@Bean`
  method parameter) — injects a **lazy-resolution proxy** so the target is only
  created when a method on it is first invoked.

### `@Lazy` at an injection point creates a proxy

This is the subtle part. `@Lazy` on the *injection point* does not just delay;
it injects a **proxy** standing in for the dependency. The real bean is
resolved from the container the first time you call a method on the proxy.

```java
@Component
class A {
    A(@Lazy B b) { this.b = b; }   // 'b' is a lazy proxy, real B built on first call
}
```

### Using `@Lazy` to break circular dependencies

Constructor-injection cycles (A needs B, B needs A) cannot be resolved by
Spring and throw `BeanCurrentlyInCreationException`. (Field/setter singleton
cycles *are* resolvable via early references / the third-level cache, but
constructor cycles are not.) A common fix is to mark **one** side `@Lazy`:

```java
@Component
class A {
    A(@Lazy B b) { this.b = b; }   // proxy injected -> A can finish constructing
}
@Component
class B {
    B(A a) { this.a = a; }
}
```

Because the `@Lazy` side receives a proxy instead of a fully built bean, the
first bean can finish construction, breaking the chicken-and-egg cycle. (This
is a pragmatic fix; the cleaner design is usually to remove the cycle.)

### Notes and gotchas

- `@Lazy` on a bean that is depended upon by a **non-lazy** bean has no delaying
  effect at startup unless the injection point is *also* lazy or goes through a
  proxy — the eager consumer forces creation.
- Prototype beans are already "lazy" in the sense that they are created per
  request; `@Lazy` on a prototype changes little at the definition level.
- You can set laziness globally in XML via `default-lazy-init="true"`, or a
  `LazyInitializationBeanFactoryPostProcessor` can flip beans to lazy. (Spring
  Boot exposes `spring.main.lazy-initialization`; that property is a Boot
  feature, not core Spring.)
- `@Lazy(false)` explicitly forces eager init even under a lazy default.

---

## ObjectProvider and ObjectFactory for on-demand lookup

`ObjectFactory<T>` and its richer sub-interface `ObjectProvider<T>` let a bean
obtain a dependency **on demand** rather than at injection time, and express
**optionality** and **multiplicity** without `null` or `Optional` gymnastics.

```java
public interface ObjectFactory<T> { T getObject() throws BeansException; }
```

`ObjectFactory` has just `getObject()`. `ObjectProvider<T>` (since Spring 4.3)
extends it with much more:

```java
interface ObjectProvider<T> extends ObjectFactory<T>, Iterable<T> {
    T getObject(Object... args);          // pass explicit ctor args (prototypes)
    T getIfAvailable();                    // null if no bean
    T getIfAvailable(Supplier<T> deflt);
    T getIfUnique();                       // null if zero OR multiple candidates
    T getIfUnique(Supplier<T> deflt);
    Stream<T> stream();                    // all matching beans
    Stream<T> orderedStream();             // honoring @Order / Ordered
    // + forEach via Iterable
}
```

You inject an `ObjectProvider<Foo>` and each `getObject()` call performs a fresh
lookup — invaluable for pulling a **prototype** bean into a singleton on each
use (a lightweight alternative to `@Lookup` or scoped proxies):

```java
@Component
class Client {
    private final ObjectProvider<Task> taskProvider;   // Task is @Scope("prototype")
    Client(ObjectProvider<Task> p) { this.taskProvider = p; }

    void run() {
        Task t = taskProvider.getObject();   // a NEW Task each call
    }
}
```

Optional dependency without failing startup:

```java
@Autowired
Client(ObjectProvider<MetricsSink> sink) {
    this.sink = sink.getIfAvailable(NoOpSink::new);   // graceful default
}
```

| Method | Zero candidates | One candidate | Multiple candidates |
|---|---|---|---|
| `getObject()` | throws `NoSuchBeanDefinitionException` | returns it | throws `NoUniqueBeanDefinitionException` (unless primary) |
| `getIfAvailable()` | `null` | returns it | throws unless one is primary |
| `getIfUnique()` | `null` | returns it | `null` |
| `stream()` | empty stream | one element | all elements |

`ObjectProvider` is preferred over `ObjectFactory` in new code; it is what
Spring itself injects for `Provider`-style needs. It is also lazy by nature —
injecting it does **not** create the target bean; only calling `getObject()`
does — so it is another way to break or defer wiring.

### Relationship to JSR-330 `Provider`

If `jakarta.inject:jakarta.inject-api` (Spring 6) or `javax.inject` (Spring 5)
is on the classpath, you can inject `jakarta.inject.Provider<T>` with the same
"call `.get()` to obtain the bean" semantics. `ObjectProvider` is the
Spring-native superset (adds `getIfAvailable`, `getIfUnique`, streams).

---

## Lookup method injection with @Lookup

**Method injection** solves the classic "singleton needs a fresh prototype each
call" scope-mismatch problem. Instead of injecting a prototype once (which would
freeze a single instance into the singleton), you declare an abstract or
concrete **lookup method** that Spring overrides to return a fresh bean from the
container on every invocation.

```java
@Component
abstract class Processor {

    public void handle() {
        Command c = createCommand();   // fresh prototype every call
        c.execute();
    }

    @Lookup
    protected abstract Command createCommand();   // Spring implements this
}
// Command is @Scope("prototype")
```

Key facts:

- Spring uses **CGLIB** to generate a runtime subclass overriding the
  `@Lookup` method; the override calls `getBean(...)`.
- If `@Lookup` has no value, Spring resolves the returned bean **by return
  type**. `@Lookup("beanName")` resolves **by name**.
- The method may be `abstract` (then the class must be, and Spring subclasses
  it) or concrete (the body is a throwaway/placeholder that gets overridden).
- Because it relies on subclassing, the containing bean cannot be `final`, and
  the lookup method cannot be `final` or `private`. `@Lookup` methods generally
  should take **no arguments** (the signature must be overridable).
- `@Lookup` is a Spring annotation; there is no JSR-330 equivalent. It is
  functionally similar to XML `<lookup-method>`.

**When to prefer alternatives:** `ObjectProvider<T>.getObject()` or an injected
`Provider<T>` achieves the same "fresh instance per call" without CGLIB
subclassing and without an abstract class, and is usually the more modern
choice. `@Lookup` remains handy when you want the lookup to look like an
ordinary polymorphic method.

---

## Programmatic bean registration with BeanDefinitionRegistry

Beyond annotations and XML you can register **bean definitions**
programmatically. A `BeanDefinition` is the container's metadata description of
a bean (class, scope, constructor args, property values, lazy flag, etc.) —
*not* an instance. `BeanDefinitionRegistry` is the SPI for adding/removing them.

### BeanDefinitionRegistryPostProcessor

The primary hook for adding definitions at runtime is
`BeanDefinitionRegistryPostProcessor` (a sub-interface of
`BeanFactoryPostProcessor`). Its `postProcessBeanDefinitionRegistry` runs early
— after definitions are loaded but before beans are instantiated — so you may
add more:

```java
class MyRegistrar implements BeanDefinitionRegistryPostProcessor {
    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
        BeanDefinition bd = BeanDefinitionBuilder
            .genericBeanDefinition(MyService.class)
            .setScope(BeanDefinition.SCOPE_SINGLETON)
            .addConstructorArgValue("hello")
            .getBeanDefinition();
        registry.registerBeanDefinition("myService", bd);
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory bf) { }
}
```

You can also register directly on a `GenericApplicationContext` /
`AnnotationConfigApplicationContext` before refresh:

```java
var ctx = new AnnotationConfigApplicationContext();
ctx.registerBean("svc", MyService.class, () -> new MyService("x")); // functional style
ctx.refresh();
```

`registerBean` with a `Supplier` (Spring 5+) registers a definition whose
instance-creation is delegated to your supplier — the functional-registration
style that underpins much of Spring's AOT/native support.

- `BeanFactoryPostProcessor` (BFPP) mutates existing definitions
  (`postProcessBeanFactory`) but should not add beans; `BeanDefinitionRegistryPostProcessor`
  (BDRPP) is the one that *adds* definitions.
- BFPPs (and BDRPPs) operate on **metadata**, before instantiation.
  `BeanPostProcessor` (BPP) operates on **instances**, during initialization.
  Don't confuse the three.

---

## Importing configuration with Import and registrars

`@Import` pulls extra configuration/beans into a `@Configuration` class. It
accepts three kinds of classes:

1. **`@Configuration` classes** — imports their `@Bean` methods.
2. **`ImportSelector`** — returns an array of fully-qualified class names to
   import, decided at runtime from the importing class's annotation metadata.
3. **`ImportBeanDefinitionRegistrar`** — given the metadata and a
   `BeanDefinitionRegistry`, registers bean definitions directly.

```java
@Configuration
@Import({ServiceConfig.class, MySelector.class, MyRegistrar.class})
class AppConfig { }
```

### ImportSelector

```java
class MySelector implements ImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata meta) {
        return new String[] { "com.acme.FooConfig", "com.acme.BarConfig" };
    }
}
```

Use it when *which* configuration classes to load depends on annotation
attributes or the environment. `DeferredImportSelector` is a variant whose
selections are processed **after** all `@Configuration`-declared regular
imports — used for ordering/overriding scenarios (this is the mechanism behind
Spring Boot's `@EnableAutoConfiguration`, though auto-configuration itself is a
Boot feature).

### ImportBeanDefinitionRegistrar

```java
class MyRegistrar implements ImportBeanDefinitionRegistrar {
    @Override
    public void registerBeanDefinitions(AnnotationMetadata meta,
                                        BeanDefinitionRegistry registry) {
        registry.registerBeanDefinition("dynamic",
            BeanDefinitionBuilder.genericBeanDefinition(Dynamic.class)
                                 .getBeanDefinition());
    }
}
```

This is the classic pattern behind `@EnableXxx` annotations (e.g.
`@MapperScan`, `@EnableCaching`-style helpers): a custom annotation carries
attributes, `@Import`s a registrar, and the registrar reads
`AnnotationMetadata` (via `meta.getAnnotationAttributes(...)`) to register beans
tailored to those attributes.

| Import target | You return / do | Sees annotation metadata | Registers definitions directly |
|---|---|---|---|
| `@Configuration` class | Nothing (its `@Bean`s are used) | n/a | via `@Bean` methods |
| `ImportSelector` | `String[]` of class names to import | yes | no (indirect) |
| `DeferredImportSelector` | `String[]`, processed last | yes | no (indirect) |
| `ImportBeanDefinitionRegistrar` | void; calls `registry.register...` | yes | yes |

**Ordering note:** classes imported via `@Import` (selectors, registrars) can
implement `Ordered` / `PriorityOrdered` or use `@Order`; registrars can also
implement `Aware` interfaces (`EnvironmentAware`, `BeanFactoryAware`,
`ResourceLoaderAware`, `BeanClassLoaderAware`) to receive context callbacks.

---

## Conditional registration with Conditional

Spring Framework's `@Conditional` (since 4.0) registers a bean/configuration
**only if** a supplied `Condition` matches. A `Condition` is evaluated at
definition-registration time:

```java
public interface Condition {
    boolean matches(ConditionContext ctx, AnnotatedTypeMetadata meta);
}

class OnProductionCondition implements Condition {
    @Override public boolean matches(ConditionContext ctx, AnnotatedTypeMetadata m) {
        return "prod".equals(ctx.getEnvironment().getProperty("app.env"));
    }
}

@Configuration
class Config {
    @Bean
    @Conditional(OnProductionCondition.class)
    MetricsExporter exporter() { return new MetricsExporter(); }
}
```

`ConditionContext` gives access to the `BeanDefinitionRegistry`,
`ConfigurableListableBeanFactory`, `Environment`, `ResourceLoader`, and
`ClassLoader`, so conditions can inspect properties, classpath presence,
existing bean definitions, etc.

### `@Conditional` versus `@Profile`

`@Profile` is actually **implemented on top of `@Conditional`** (via
`ProfileCondition`). `@Profile("dev")` activates a bean only when the `dev`
profile is active. Use `@Profile` for the common environment case; use a custom
`@Conditional` for arbitrary logic (property values, class presence, OS, etc.).

### Core Spring vs Spring Boot conditions

Plain Spring Framework ships only the generic `@Conditional` +
`Condition` SPI (plus `@Profile`). The rich, ready-made conditions —
`@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`,
`@ConditionalOnBean`, etc. — are **Spring Boot** additions in
`spring-boot-autoconfigure`. In an interview, be precise: if asked about
`@ConditionalOnMissingBean`, that is Boot, not core Spring. Core Spring gives
you the primitive to build such conditions yourself.

---

## Common follow-up questions

- **What does `getBean("&myFactory")` return?** The `FactoryBean` instance
  itself, not the product of `getObject()`. Without `&`, you get the product.

- **Why would `getObjectType()` return `null`, and what breaks?** When the
  product type isn't known before instantiation. It degrades type-based
  autowiring and `getBeansOfType` matching, since the container can't match by
  type without creating the factory.

- **How does `@Lazy` break a circular dependency?** On the injection point it
  supplies a proxy instead of the real bean, so the first bean can finish
  constructing before the second exists. Works for constructor cycles that
  otherwise throw `BeanCurrentlyInCreationException`.

- **`@Lazy` on a bean vs on an injection point?** On the bean/definition it
  defers that bean's creation until first requested; on an injection point it
  injects a lazy-resolving proxy for that specific dependency.

- **`ObjectProvider` vs `@Lookup` vs scoped proxy for prototype-in-singleton?**
  All give a fresh prototype per use. `ObjectProvider.getObject()` /
  `Provider.get()` are the modern, no-subclassing choices; `@Lookup` uses CGLIB
  method overriding; a scoped proxy wraps the target.

- **`getIfAvailable()` vs `getIfUnique()`?** `getIfAvailable` returns `null`
  only when there are zero candidates (throws on ambiguity unless primary);
  `getIfUnique` returns `null` when there are zero *or* multiple candidates.

- **Difference between `BeanFactoryPostProcessor`, `BeanDefinitionRegistryPostProcessor`,
  and `BeanPostProcessor`?** BDRPP adds definitions; BFPP mutates existing
  definitions; both act on metadata before instantiation. BPP acts on bean
  instances during initialization.

- **`ImportSelector` vs `ImportBeanDefinitionRegistrar`?** A selector returns
  class *names* for Spring to import; a registrar registers bean *definitions*
  directly against the registry. Registrars are used for `@EnableXxx` scanning
  annotations.

- **Is `@ConditionalOnMissingBean` part of core Spring?** No — it's Spring Boot.
  Core Spring provides only `@Conditional` + `Condition` (and `@Profile`).

- **How is `@Profile` related to `@Conditional`?** `@Profile` is meta-annotated
  with `@Conditional(ProfileCondition.class)`; it's a specialization.

---

## References

- Spring Framework Reference — Core Technologies: Customizing the Nature of a
  Bean / `FactoryBean`: https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html
- `FactoryBean` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/FactoryBean.html
- Lazy-initialized beans: https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-lazy-init.html
- `@Lazy` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/annotation/Lazy.html
- Method injection / `@Lookup` (Lookup Method Injection): https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-method-injection.html
- `ObjectProvider` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/ObjectProvider.html
- Fine-tuning annotation-based autowiring with `@Primary`/`ObjectProvider`: https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html
- `@Import` / `ImportSelector` / `ImportBeanDefinitionRegistrar`: https://docs.spring.io/spring-framework/reference/core/beans/java/composing-configuration-classes.html
- `BeanFactoryPostProcessor` and `BeanDefinitionRegistryPostProcessor`: https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html
- `@Conditional` and `Condition`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/annotation/Conditional.html
- Bean definition profiles: https://docs.spring.io/spring-framework/reference/core/beans/environment.html
