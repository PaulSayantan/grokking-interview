# IoC Container & Dependency Injection

Inversion of Control (IoC) and Dependency Injection (DI) are the foundation of the
Spring Framework. Nearly every other Spring feature — AOP, transactions, MVC, Data,
Security — is layered on top of the IoC container. This topic covers what IoC/DI are,
how the container resolves and wires beans, the injection styles and their trade-offs,
the autowiring resolution algorithm, and the internals that come up in interviews such
as circular dependency resolution via the three-level singleton cache.

---

## IoC vs DI

**Inversion of Control (IoC)** is a *design principle*: instead of your objects creating
and managing their own collaborators, control over object creation and lifecycle is
"inverted" and handed to an external entity (a framework/container). Your code no longer
calls `new` on its dependencies; the framework calls your code and supplies them.
The Hollywood Principle summarizes it: "Don't call us, we'll call you."

**Dependency Injection (DI)** is the most common *implementation technique* for IoC:
the container supplies (injects) an object's dependencies from the outside rather than
the object looking them up or instantiating them. Other implementations of IoC exist too
(e.g., the Service Locator pattern, template methods, strategy callbacks), so DI is a
subset of IoC.

```java
// WITHOUT IoC/DI — the class controls its own dependency (tight coupling)
public class OrderService {
    private final PaymentGateway gateway = new StripePaymentGateway(); // hard-wired
}

// WITH DI — the dependency is supplied from outside (loose coupling)
public class OrderService {
    private final PaymentGateway gateway;
    public OrderService(PaymentGateway gateway) { this.gateway = gateway; }
}
```

Key distinction to state in interviews: **IoC is the principle (the "what/why"); DI is a
pattern that achieves it (the "how").** Spring's IoC container performs DI. The term
"IoC container" and "DI container" refer to the same thing in Spring: the
`ApplicationContext`/`BeanFactory`.

Why it matters: DI enables loose coupling, easier unit testing (inject mocks/stubs),
swappable implementations, centralized configuration, and clear expression of a class's
collaborators.

---

## Loose coupling

**Loose coupling** means a class depends on *abstractions* (interfaces) rather than
concrete implementations, and does not construct or locate its collaborators itself.
DI is the mechanism Spring uses to achieve this: because dependencies are injected, you
can substitute a different implementation without changing the dependent class.

Benefits:
- **Testability** — inject a mock/fake in a unit test without a running container.
- **Flexibility** — swap implementations via configuration (`@Profile`, `@Qualifier`,
  `@Primary`) without editing consumers.
- **Single Responsibility / separation of concerns** — a class focuses on its logic,
  not on wiring.
- **Maintainability** — wiring is centralized and explicit.

Depending on an interface rather than a concrete class also aligns with the Dependency
Inversion Principle (the "D" in SOLID): high-level modules and low-level modules both
depend on abstractions. Note that DI (the technique) and Dependency Inversion (the SOLID
principle) are related but distinct — DI is one way to realize dependency inversion.

---

## BeanFactory vs ApplicationContext

Both are IoC containers. `ApplicationContext` is a superset of `BeanFactory`.

| Aspect | `BeanFactory` | `ApplicationContext` |
|---|---|---|
| Package/role | Basic container, lazy | Advanced, enterprise container |
| Bean instantiation | **Lazy** by default (created on `getBean`) | **Eager** for singletons at startup (pre-instantiates) |
| BeanPostProcessor / BeanFactoryPostProcessor | Must register manually | Auto-detected and registered |
| Annotation config (`@Autowired`, etc.) | Not automatic | Supported out of the box |
| Internationalization (`MessageSource`) | No | Yes |
| Event publishing (`ApplicationEvent`) | No | Yes |
| Environment / property resolution | Limited | Full `Environment` abstraction |
| AOP / auto-proxying | Manual | Automatic |

`ApplicationContext extends BeanFactory` (via `ListableBeanFactory` and
`HierarchicalBeanFactory`). In practice you almost always use an `ApplicationContext`;
`BeanFactory` is used for very memory-constrained or lazy scenarios.

Common implementations: `AnnotationConfigApplicationContext`,
`ClassPathXmlApplicationContext`, `GenericWebApplicationContext`,
`AnnotationConfigServletWebServerApplicationContext` (Spring Boot web apps).

Interview trap: **"Are singletons eager or lazy?"** By default, an `ApplicationContext`
pre-instantiates singleton beans at startup (eager), which surfaces configuration errors
early ("fail fast"). A raw `BeanFactory` creates them lazily on first `getBean`.

---

## Context hierarchy

Spring supports a **parent-child hierarchy** of `ApplicationContext`s. A child context can
see beans defined in its parent, but the parent cannot see beans in the child. Bean lookup
walks up: if a bean isn't found in the child, the request is delegated to the parent.

Classic example — Spring MVC:
- The **root** context (loaded by `ContextLoaderListener`) holds shared beans:
  services, repositories, data sources.
- Each `DispatcherServlet` has its own **child** web context holding web-layer beans:
  controllers, view resolvers, handler mappings.
- Web-layer beans can inject service-layer beans from the root; the reverse is not
  possible.

Rules and gotchas:
- Beans are resolved child-first, then parent. A bean defined in both is effectively
  overridden for the child's consumers.
- Parent beans cannot depend on child beans.
- In Spring Boot, a single application context is the norm; hierarchies appear with
  Spring Cloud (the bootstrap context is a parent of the main context) or when explicitly
  building multiple `DispatcherServlet`s. Spring Cloud's bootstrap context is disabled by
  default in newer versions (requires `spring-cloud-starter-bootstrap` or a property).

---

## Constructor vs setter vs field injection

Spring supports three injection styles.

```java
// Constructor injection (RECOMMENDED)
@Service
public class OrderService {
    private final PaymentGateway gateway;
    private final InventoryClient inventory;
    // @Autowired optional on a single constructor since Spring 4.3
    public OrderService(PaymentGateway gateway, InventoryClient inventory) {
        this.gateway = gateway;
        this.inventory = inventory;
    }
}

// Setter injection
@Service
public class OrderService {
    private PaymentGateway gateway;
    @Autowired
    public void setGateway(PaymentGateway gateway) { this.gateway = gateway; }
}

// Field injection (DISCOURAGED)
@Service
public class OrderService {
    @Autowired
    private PaymentGateway gateway;
}
```

| Criterion | Constructor | Setter | Field |
|---|---|---|---|
| Mandatory dependencies | ✅ enforced | optional | not enforced |
| `final` / immutability | ✅ yes | ❌ no | ❌ no |
| Fully initialized object | ✅ guaranteed | ❌ can be partially built | ❌ |
| Testability without container | ✅ `new` with mocks | ✅ via setters | ❌ needs reflection/injection |
| Optional / changeable deps | awkward | ✅ good fit | — |
| Circular dependency | ❌ fails fast (BeanCurrentlyInCreation) | ✅ can be resolved | ✅ can be resolved |
| Hides too many deps (code smell) | ✅ constructor gets bloated → visible signal | hidden | hidden |

**Why field injection is discouraged (say this in interviews):**
1. **No immutability** — the field can't be `final`, so the object is mutable.
2. **Poor testability** — you can't inject mocks with plain Java `new`; you need
   Spring, reflection, or `@InjectMocks`. Constructor injection lets you write a POJO
   unit test with `new OrderService(mockGateway, mockInventory)`.
3. **Hidden dependencies** — a class can accumulate many `@Autowired` fields without the
   pain being visible; a long constructor signals a class doing too much (SRP violation).
4. **Tight coupling to the DI container** — the class can only be instantiated by a
   container capable of reflection-based injection.
5. **Risk of `NullPointerException`** if the object is created outside Spring.
6. IDEs/compilers can warn about unused/uninitialized `final` fields with constructors;
   field injection loses that.

The Spring team and Spring Boot documentation **officially recommend constructor
injection** for mandatory dependencies and setter injection for optional/changeable ones.

Since Spring 4.3, if a class has a **single constructor**, `@Autowired` on it is optional —
Spring will use it automatically. With multiple constructors you must annotate the one to
use (or provide a no-arg + `@Autowired` on one).

Boot tip: with Lombok, `@RequiredArgsConstructor` generates a constructor for all `final`
fields, giving clean constructor injection with no boilerplate.

---

## @Autowired resolution algorithm

When Spring resolves an `@Autowired` dependency it follows this order:

1. **Match by type.** Find all beans assignable to the required type.
2. If **exactly one** candidate → inject it. Done.
3. If **no candidate** → behavior depends on `required`:
   - `required=true` (default) → throw `NoSuchBeanDefinitionException`
     (a `NoUniqueBeanDefinitionException` is thrown for the multiple-match case below).
   - `required=false` / `Optional` / `@Nullable` → leave null / empty.
4. If **multiple candidates** → disambiguate, in this order:
   a. A candidate annotated **`@Primary`** wins.
   b. Otherwise, a **`@Qualifier("name")`** on the injection point narrows to the bean
      with that qualifier/name.
   c. Otherwise, fall back to matching the **field/parameter name** against the bean
      name (name-based fallback).
   d. `@Priority(n)` (jakarta/javax) can also break ties (lower number = higher priority).
5. If still ambiguous → **`NoUniqueBeanDefinitionException`**.

```java
@Component("card")   public class CardPayment   implements PaymentGateway {}
@Component("wallet") public class WalletPayment implements PaymentGateway {}

@Service
public class OrderService {
    // Two candidates of type PaymentGateway → name-based fallback:
    // the parameter name 'card' matches bean name "card" → injects CardPayment
    public OrderService(PaymentGateway card) { ... }
}
```

Advanced: `@Autowired` is processed by `AutowiredAnnotationBeanPostProcessor`. Generics
are considered part of the type: `@Autowired Repository<Order>` will only match a bean
whose generic type is `Repository<Order>`. Arrays, `Collection`, `List`, `Set`, and `Map`
of a type are injected with *all* matching beans (see collections injection).

---

## @Qualifier vs @Primary

Both resolve the ambiguity of multiple candidates of the same type, but differently:

| | `@Primary` | `@Qualifier` |
|---|---|---|
| Where it's declared | On the **bean definition** (the default choice) | On the **injection point** (and matching beans) |
| Granularity | One global default per type | Per-injection-point selection |
| Intent | "When in doubt, pick me" | "Here, specifically pick this one" |
| Precedence | Lower — a `@Qualifier` at the injection point overrides `@Primary` | Higher — wins over `@Primary` |

```java
@Bean @Primary DataSource primaryDs() { ... }   // default for DataSource injections
@Bean @Qualifier("audit") DataSource auditDs() { ... }

@Autowired DataSource ds;                         // gets primaryDs (Primary)
@Autowired @Qualifier("audit") DataSource audit;  // gets auditDs (Qualifier overrides)
```

Rule of thumb: use **`@Primary`** when there's a sensible default and most consumers want
it; use **`@Qualifier`** when consumers must choose explicitly. If both apply,
**`@Qualifier` at the injection point wins** over `@Primary`.

You can also create custom qualifier annotations (meta-annotated with `@Qualifier`) for
type-safe selection instead of string names.

---

## @Resource vs @Inject vs @Autowired

Three annotations can drive injection. They differ in origin and default matching mode.

| Annotation | Origin | Default match | Qualifier mechanism | `required` |
|---|---|---|---|---|
| `@Autowired` | Spring | **by type**, then by name fallback | `@Qualifier` | `required=false` supported |
| `@Resource` | Jakarta (`jakarta.annotation`, was `javax.annotation`) | **by name** (the `name` attr or field name), then by type | `name` attribute | not supported (throws if unmatched) |
| `@Inject` | JSR-330 (`jakarta.inject`, was `javax.inject`) | **by type**, then by name | `@Named` / `@Qualifier` | not supported (use `Provider` / `Optional`) |

Key points:
- **`@Autowired` matches by type first**; the field name is only a *fallback* tie-breaker.
- **`@Resource` matches by name first** (using the field/setter name or its explicit
  `name`), then falls back to type. This makes it handy when you want to pick a specific
  bean by name without a separate `@Qualifier`.
- **`@Inject`** is the JSR-330 standard; it behaves like `@Autowired` (by type) but is
  vendor-neutral. Requires the `jakarta.inject`/`javax.inject` dependency on the classpath.
- `@Autowired` supports `required=false`; `@Resource` and `@Inject` do not (an `@Inject`
  optional dependency is expressed via `Provider<T>` or Spring's `ObjectProvider<T>`).

**Jakarta EE / Spring Boot 3.x note:** Spring Framework 6 / Spring Boot 3 migrated from
the `javax.*` namespace to `jakarta.*`. So it's now `jakarta.annotation.Resource` and
`jakarta.inject.Inject`. On Spring Boot 2.x / Spring 5 they were `javax.annotation.Resource`
and `javax.inject.Inject`. Using the wrong namespace on the wrong version is a common
migration bug.

---

## required=false and Optional injection

By default `@Autowired` dependencies are **mandatory**: if no matching bean exists, the
context fails to start. To make a dependency optional you have several idioms:

```java
// 1) required=false — field/param left null if no bean present
@Autowired(required = false)
private AuditService audit;

// 2) java.util.Optional — empty if no bean
@Autowired
private Optional<AuditService> audit;

// 3) @Nullable on the parameter
public OrderService(@Nullable AuditService audit) { ... }

// 4) ObjectProvider — lazy, supports getIfAvailable/getIfUnique, safest for optional
private final ObjectProvider<AuditService> auditProvider;
public OrderService(ObjectProvider<AuditService> auditProvider) {
    this.auditProvider = auditProvider;
}
// ... auditProvider.getIfAvailable();
```

Notes and gotchas:
- With **constructor injection**, `required=false` on `@Autowired` is only meaningful when
  there are multiple constructors; the recommended optional patterns are `Optional<T>`,
  `@Nullable`, or `ObjectProvider<T>`.
- `ObjectProvider<T>` (Spring) is the most flexible: it defers resolution (lazy) and
  offers `getIfAvailable()`, `getIfUnique()`, and stream access — great for optional or
  0-to-many dependencies without failing the context.
- Mixing `required=true` fields with a genuinely absent bean is the classic
  `NoSuchBeanDefinitionException` at startup.

---

## Collections and map injection

You can inject **all beans of a type** as a `List`, `Set`, array, or `Map`.

```java
public interface Validator { }
@Component class EmailValidator implements Validator {}
@Component class PhoneValidator implements Validator {}

@Service
public class SignupService {
    private final List<Validator> validators;         // all Validator beans
    private final Map<String, Validator> byName;       // key = bean name, value = bean
    public SignupService(List<Validator> validators, Map<String, Validator> byName) {
        this.validators = validators;
        this.byName = byName;
    }
}
```

Details that come up in interviews:
- **`List<T>` / `Set<T>` / `T[]`** are injected with every bean assignable to `T`.
- **`Map<String, T>`** injects a map whose **keys are bean names** and values are the
  beans. (A `Map` with a non-`String` key type is not treated as a collection injection.)
- **Ordering:** collection order is not guaranteed by default. Use `@Order(n)` on beans
  or implement `Ordered` to control it; `@Priority` also participates. Lower value = earlier.
- If **no beans** of the type exist, an `@Autowired` collection is by default required and
  fails — unless you add `required=false`, in which case you get an empty collection (or
  use `ObjectProvider`).
- A `@Qualifier` on a collection injection point restricts it to beans carrying that
  qualifier — useful for grouping a subset.

---

## Circular dependencies and the three-level singleton cache

A **circular dependency** occurs when bean A depends on B and B depends on A (directly or
transitively).

**Behavior by injection type:**
- **Constructor injection on both sides → unresolvable.** Spring throws
  `BeanCurrentlyInCreationException` (a `BeanCreationException`). Neither object can be
  fully constructed before the other exists.
- **Field or setter injection → resolvable** (for singletons) via early references,
  because Spring can create the raw instance first and inject the collaborator afterward.

**The three-level cache** (in `DefaultSingletonBeanRegistry`) is how Spring exposes an
early reference to a half-built singleton so the cycle can be closed:

| Level | Field | Holds |
|---|---|---|
| 1 (first) | `singletonObjects` | fully initialized, ready singletons |
| 2 (second) | `earlySingletonObjects` | early-exposed instances (raw, populated on demand from L3) |
| 3 (third) | `singletonFactories` | `ObjectFactory` lambdas that can produce an early reference (possibly a proxy) |

Creation flow for a singleton A that needs B which needs A:
1. Start creating A → instantiate A (constructor) → place an `ObjectFactory` for A into
   **level 3** (`singletonFactories`) and mark A "in creation".
2. Populate A's fields → A needs B → start creating B.
3. Instantiate B → put B's factory in level 3 → populate B's fields → B needs A.
4. Resolve A: `getSingleton` checks L1 (miss) → L2 (miss) → **L3**: calls A's
   `ObjectFactory`, which returns A's early reference (running any
   `SmartInstantiationAwareBeanPostProcessor`, e.g. to create an AOP proxy). That early
   reference is moved to **L2** and removed from L3.
5. B receives the early A reference, finishes initialization, moves to **L1**.
6. Control returns to A; A finishes populating (now has the finished B), completes
   initialization, and moves to **L1**.

**Why three levels and not two?** The third level stores *factories*, not objects. The
factory allows Spring to create the *correct* early reference lazily — critically, if A
needs an AOP proxy, the factory produces the proxy exactly once and consistently, so B
gets the same proxy A ends up as. A two-level cache couldn't both defer proxy creation and
guarantee a single consistent proxy instance.

**Spring Boot 2.6+ change:** circular references are **prohibited by default**. If your
app has one, startup fails with a clear message. You can re-enable with
`spring.main.allow-circular-references=true`, but the recommended fix is to break the
cycle (redesign, extract a third bean, or use `@Lazy` / `ObjectProvider` /
`ApplicationContext.getBean` / setter injection / an event) rather than allow it.

**`@Lazy` as a cycle-breaker:** annotating one injection point with `@Lazy` injects a
proxy instead of the real bean, deferring the real lookup until first use, which breaks
the construction-time cycle (works even with constructor injection).

---

## @Lazy injection and when beans are created

**When are beans created?**
- By default, **singleton** beans are **eagerly instantiated** when the
  `ApplicationContext` is refreshed (at startup). This "fail fast" behavior surfaces
  wiring/config errors immediately.
- **Prototype** beans are created **on demand** — a new instance each time they are
  requested (via `getBean` or injected into another bean). The container does not manage
  their full lifecycle (no destruction callbacks).
- Beans of other scopes (`request`, `session`, etc.) are created when their scope begins.

**`@Lazy`** defers creation:
- On a **`@Component`/`@Bean`**: the singleton is not created at startup but on first
  access (first injection or `getBean`).
- On an **injection point** (`@Autowired @Lazy`): Spring injects a **lazy proxy**; the
  target bean is resolved only when a method is first invoked on the proxy. This is the
  mechanism that lets `@Lazy` break constructor circular dependencies and speed startup.
- `@Lazy` on a `@Configuration` class makes all its `@Bean` methods lazy.

Trade-offs of lazy initialization:
- Pros: faster startup, lower memory if some beans are never used.
- Cons: errors surface **later** (at first use, possibly in production) instead of at
  startup; first request pays the initialization cost. Generally prefer eager for
  fail-fast behavior; use `@Lazy` selectively or for rarely used heavy beans.

Boot-wide switch: `spring.main.lazy-initialization=true` makes *all* beans lazy — useful
for dev/test startup speed, but disables fail-fast and adds latency to first requests, so
it's generally not recommended for production.

Order of a bean's own creation lifecycle: instantiate (constructor) → populate
properties/inject → `BeanNameAware`/`*Aware` → `BeanPostProcessor.before` →
`@PostConstruct` → `InitializingBean.afterPropertiesSet` → custom `init-method` →
`BeanPostProcessor.after` (proxy often created here) → bean ready. (Covered in depth in
the Bean Scopes & Lifecycle topic.)

---

## Common follow-up questions

- **"What's the difference between IoC and DI?"** IoC is the principle (control of
  creation/wiring is inverted to the container); DI is one implementation of it.
- **"Which injection type do you prefer and why?"** Constructor injection: immutability
  (`final`), guaranteed non-null fully-initialized objects, easy POJO testing, and it
  makes too-many-dependencies visible.
- **"Can constructor injection cause a circular dependency failure?"** Yes —
  `BeanCurrentlyInCreationException`. Field/setter can be resolved via early references;
  fix by redesign or `@Lazy`.
- **"Why three levels in the singleton cache?"** The third level holds *factories* so
  Spring can lazily produce a single consistent early reference — importantly the correct
  AOP proxy — for beans in a cycle.
- **"How does `@Autowired` resolve when there are two candidates?"** `@Primary` →
  `@Qualifier` → bean-name fallback → else `NoUniqueBeanDefinitionException`.
- **"`@Resource` vs `@Autowired`?"** `@Resource` matches by name first; `@Autowired`
  by type first (name only as fallback).
- **"What changed in Spring Boot 3 regarding these annotations?"** `javax.*` →
  `jakarta.*` namespaces (`jakarta.annotation.Resource`, `jakarta.inject.Inject`).
- **"Are singletons lazy or eager?"** Eager by default in `ApplicationContext`; use
  `@Lazy` or `spring.main.lazy-initialization` to defer.
- **"BeanFactory vs ApplicationContext — when would you use BeanFactory?"** Rarely; only
  for extreme memory/lazy constraints. `ApplicationContext` adds events, i18n, AOP,
  annotation config, and eager singletons.
- **"How do you inject all implementations of an interface?"** Inject `List<T>` or
  `Map<String,T>`; order with `@Order`.
- **"What happens if a required bean is missing?"** Startup fails with
  `NoSuchBeanDefinitionException` unless the dependency is optional
  (`required=false`/`Optional`/`ObjectProvider`).

## References

- Spring Framework Reference — Core / IoC Container:
  https://docs.spring.io/spring-framework/reference/core/beans.html
- Spring Framework Reference — Dependencies and configuration in detail:
  https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html
- Spring Framework Reference — Autowiring & `@Autowired`:
  https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html
- Spring Framework Reference — Using `@Qualifier`, `@Primary`, JSR-330 `@Inject`/`@Named`,
  `@Resource`:
  https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired-qualifiers.html
- Spring Boot Reference — Constructor injection guidance & Spring Beans and DI:
  https://docs.spring.io/spring-boot/reference/using/spring-beans-and-dependency-injection.html
- Spring Boot 2.6 Release Notes — circular references prohibited by default:
  https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.6-Release-Notes
- Baeldung — Constructor vs Field Injection:
  https://www.baeldung.com/constructor-injection-in-spring
- Baeldung — `@Autowired`, `@Qualifier`, `@Primary`:
  https://www.baeldung.com/spring-qualifier-annotation
- Baeldung — Spring Circular Dependencies & the three-level cache:
  https://www.baeldung.com/circular-dependencies-in-spring
- Baeldung — `@Resource` vs `@Inject` vs `@Autowired`:
  https://www.baeldung.com/spring-annotations-resource-inject-autowire
