# Circular Dependencies

A **circular dependency** occurs when two or more Spring beans depend on each other, directly or transitively, forming a cycle in the dependency graph. Whether Spring can resolve such a cycle depends almost entirely on *how* the beans are wired together (constructor vs. setter/field), on the bean *scope* (singleton vs. prototype), and — since Spring Boot 2.6 — on configuration flags that gate the behavior.

This topic explains what a cycle is, why constructor-injection cycles are impossible to satisfy, how Spring's three-level singleton cache resolves setter/field cycles by exposing *early references*, the Boot 2.6+ policy change, and the practical fixes.

> Note on versions: the mechanics below apply to the Spring **Framework** container itself (`DefaultListableBeanFactory` / `AbstractAutowireCapableBeanFactory`). Spring Framework 6.x runs on **Jakarta EE 9+** (the `jakarta.*` namespace, e.g. `jakarta.inject.Provider`, `jakarta.annotation.Resource`); Spring Framework 5.x used `javax.*`. The circular-dependency algorithm is unchanged across those versions — only the injection-annotation namespaces moved.

---

## What is a circular dependency

A circular dependency is a cycle in the bean dependency graph. The simplest form is a **direct cycle** between two beans:

```java
@Component
class A {
    private final B b;
    A(B b) { this.b = b; }   // A needs B
}

@Component
class B {
    private final A a;
    B(A a) { this.a = a; }   // B needs A
}
```

To create `A`, the container must first create `B`; to create `B`, it must first create `A` — an unbreakable loop when both use constructor injection.

Cycles can also be **indirect / transitive**, spanning several beans:

```
A -> B -> C -> A
```

A bean can even depend on **itself** (a self-reference), e.g. a service that injects a proxy of itself to invoke another method through the AOP proxy.

Key points to internalize:

- A circular dependency is a *design/graph* property, not an error by itself. Spring resolves *some* cycles automatically.
- Resolvability depends on the **injection style** (constructor vs. setter/field) and **bean scope**.
- The cycle is detected during **bean instantiation**, i.e. at container startup for eager singletons, or on first `getBean(...)` for lazy ones — not at compile time.

| Cycle type | Example | Resolvable by Spring? |
|---|---|---|
| Constructor <-> Constructor | `A(B)` and `B(A)` | No — `BeanCurrentlyInCreationException` |
| Setter/Field <-> Setter/Field | `A.setB()` / `@Autowired B` | Yes — via early singleton exposure |
| Mixed (one constructor, one setter) | `A(B)`, `B.setA()` | Often yes, if the *first-created* bean is not the one needing the other via constructor |
| Prototype <-> Prototype | any style | No — never cached, always recreated |

---

## Why constructor injection cycles cannot be resolved

Constructor injection requires all dependencies to be available **at instantiation time**, because the object literally cannot be constructed without its constructor arguments. This is the crux of why constructor cycles are unresolvable.

Walk through the flow for the `A <-> B` constructor example:

1. Container starts creating `A`. It marks `A` as *currently in creation* (adds `"a"` to the `singletonsCurrentlyInCreation` set).
2. To invoke `new A(B)`, it must resolve `B`, so it starts creating `B` and marks `"b"` in creation.
3. To invoke `new B(A)`, it must resolve `A`, so it calls `getBean("a")` again.
4. `A` has **not finished construction** — there is no instance yet, not even a raw one — and `A` is already flagged as in creation. The container has nothing to hand back.
5. Spring aborts with:

```
org.springframework.beans.factory.BeanCurrentlyInCreationException:
Error creating bean with name 'a': Requested bean is currently in creation:
Is there an unresolvable circular reference?
```

The fundamental reason: **there is no partially-constructed object to expose**. With constructor injection the object does not exist until the constructor returns, so Spring cannot break the cycle by handing out an early reference (which is exactly the trick it uses for setter/field injection).

```java
// This pair ALWAYS fails at startup with BeanCurrentlyInCreationException
@Component class A { A(B b) {} }
@Component class B { B(A a) {} }
```

Note the important asymmetry vs. setter/field injection: in setter/field injection Spring *can* instantiate the bean first (default constructor / factory) and inject later, giving it a raw instance to expose early. Constructor injection removes that opportunity entirely.

---

## The three level cache and early references

For **singleton** beans wired by **setter or field** injection, Spring breaks cycles by exposing an *early reference* — a not-yet-fully-initialized instance — to whoever needs it mid-cycle. This machinery lives in `DefaultSingletonBeanRegistry` and is known as the **three-level cache**.

The three maps (levels), in lookup order:

| Level | Field name | Holds | Purpose |
|---|---|---|---|
| 1 | `singletonObjects` | fully initialized, ready-to-use singletons | the final bean cache |
| 2 | `earlySingletonObjects` | raw early instances already exposed to resolve a cycle | prevents re-running the factory; stabilizes the exposed reference |
| 3 | `singletonFactories` | `ObjectFactory` lambdas that can produce an early reference on demand | lazily creates the early reference (and, if needed, an AOP proxy) |

`getSingleton(beanName, allowEarlyReference)` checks level 1, then level 2, then — if `allowEarlyReference` is true — calls the level-3 factory, moves the result up to level 2, and removes the level-3 factory.

### Lifecycle walkthrough (setter/field cycle A <-> B)

1. `getBean("a")` -> `A` marked in creation.
2. `createBeanInstance` instantiates a **raw** `A` via its no-arg (or resolvable) constructor.
3. Spring **eagerly registers a `singletonFactory` for `"a"` (level 3)** via `addSingletonFactory`, before populating properties. The factory can return the raw `A` (or an early AOP proxy of it — see below).
4. `populateBean` on `A` needs `B` -> `getBean("b")` -> `B` marked in creation.
5. Raw `B` is instantiated; its level-3 factory is registered.
6. `populateBean` on `B` needs `A` -> `getBean("a")` -> level 1 miss, level 2 miss, **level 3 hit**: the factory produces the early `A` reference. It moves to level 2. `B` receives this early `A`.
7. `B` finishes initialization, is promoted to level 1 (`singletonObjects`), and returned to `A`.
8. `A` receives the finished `B`, finishes its own initialization, and is promoted to level 1.

The cycle is broken because at step 3 there *was* a concrete (if incomplete) `A` object to hand out.

### Why THREE levels and not two?

The subtle reason is **AOP proxies**. If `A` needs to be proxied (e.g. `@Transactional`, `@Async`, custom `BeanPostProcessor`), the reference injected into `B` must be the **proxy**, not the raw bean — otherwise `B` would hold the raw target and bypass the proxy. The level-3 `ObjectFactory` calls `getEarlyBeanReference`, which runs `SmartInstantiationAwareBeanPostProcessor#getEarlyBeanReference` (e.g. `AbstractAutoProxyCreator`) to create the proxy *early* if a cycle forces it.

- Level 3 (factory) defers proxy creation so it only happens if a cycle actually demands the early reference.
- Level 2 caches the *result* so that if two different beans both pull the early reference, they get the **same** proxy instance (consistency), and the factory is not invoked twice.

A two-level cache could not both (a) avoid creating proxies unnecessarily and (b) guarantee a single, stable early reference. Hence three levels.

```java
// AbstractAutowireCapableBeanFactory#doCreateBean (simplified)
boolean earlySingletonExposure = mbd.isSingleton()
        && this.allowCircularReferences
        && isSingletonCurrentlyInCreation(beanName);
if (earlySingletonExposure) {
    addSingletonFactory(beanName,
        () -> getEarlyBeanReference(beanName, mbd, bean)); // level 3
}
```

### Important limitations of early exposure

- **Only singletons.** Prototype beans are never cached, so there is no early reference to expose; a prototype cycle throws `BeanCurrentlyInCreationException`.
- **A final-fields / constructor cycle can't use it** — no raw instance exists.
- If `A` is proxied and its `getEarlyBeanReference` proxy differs from the final proxy Spring would build, Spring performs a consistency check and can throw `BeanCurrentlyInCreationException` ("Bean with name 'a' has been injected into other beans ... in its raw version as part of a circular reference, but has eventually been wrapped"). This happens when the early-exposed reference and the final bean diverge.

---

## Spring Boot 2.6 plus prohibits circular references by default

Circular references — even the resolvable setter/field kind — are widely regarded as a **design smell**: they make beans harder to reason about, complicate initialization order, and interact badly with AOP proxying. Reflecting this, **Spring Boot 2.6 (released November 2021)** changed the default so that **circular references are prohibited**. If any cycle exists at startup, the application **fails to start** with an error like:

```
The dependencies of some of the beans in the application context form a cycle:

   ┌─────┐
|  a defined in file [.../A.class]
↑     ↓
|  b defined in file [.../B.class]
   └─────┘
```

Important scoping of this change:

- This is a **Spring Boot** default, **not** a Spring Framework default. The core `DefaultListableBeanFactory` still has `allowCircularReferences = true` by default; Spring Boot 2.6's `SpringApplication` sets it to `false` via a `BeanFactoryPostProcessor`/customizer during context creation.
- Boot exposes a property to restore the old behavior:

```properties
# application.properties — re-allow resolvable (setter/field) cycles
spring.main.allow-circular-references=true
```

  or programmatically:

```java
SpringApplication app = new SpringApplication(MyApp.class);
app.setAllowCircularReferences(true);
app.run(args);
```

- Even with the flag set to `true`, **constructor cycles still fail** — the flag only re-enables the early-reference mechanism, which cannot help constructor injection.
- In **plain Spring Framework** (no Boot), you toggle the same capability directly on the factory:

```java
AbstractAutowireCapableBeanFactory bf = ...;
bf.setAllowCircularReferences(false); // default is true in the framework
```

The intent of the Boot change is to *nudge* developers to fix the design rather than silently rely on early-reference wiring. The property is an escape hatch, not a recommendation.

| Context | Default for circular refs | How to change |
|---|---|---|
| Spring Framework (raw) | Allowed (`allowCircularReferences=true`) | `factory.setAllowCircularReferences(false)` |
| Spring Boot < 2.6 | Allowed | n/a |
| Spring Boot >= 2.6 | Prohibited | `spring.main.allow-circular-references=true` or `setAllowCircularReferences(true)` |

---

## How to fix or avoid circular dependencies

Preferred order: **redesign first**, then apply a targeted mechanical fix if the coupling is genuinely bidirectional.

### 1. Redesign to remove the cycle (best)

A cycle usually signals a missing abstraction or misplaced responsibility. Common refactors:

- **Extract a third component** that holds the shared logic both beans need, so `A -> C <- B` instead of `A <-> B`.
- **Merge** two beans that are so tightly coupled they always change together.
- **Introduce an event/callback** (`ApplicationEventPublisher`) so one side publishes and the other listens, removing the direct reference.
- **Move a method** to break the direction of the dependency.

### 2. Prefer constructor injection, then break the cycle explicitly

Constructor injection is the recommended default (immutability, required-by-construction, testability) precisely *because* it surfaces cycles at startup instead of hiding them. When you hit a `BeanCurrentlyInCreationException`, treat it as feedback to redesign rather than switching everything to field injection.

### 3. `@Lazy` on one injection point

Annotating one side with `@Lazy` injects a **proxy** instead of the real bean. The proxy is created immediately, but the real target is resolved on first *use*, so at construction time there is no need for the other bean to be fully built.

```java
@Component
class A {
    private final B b;
    A(@Lazy B b) { this.b = b; }  // proxy injected now; real B resolved on first call
}
```

This works even for **constructor** injection because the proxy — not the real `B` — is what gets passed to `A`'s constructor. `@Lazy` on the class or bean definition also delays creation.

### 4. Setter or field injection (weakest fix)

Switching one or both sides to setter/field injection lets Spring use the early-reference mechanism (Section "The three level cache and early references"). It works for singletons but is discouraged: it hides the cycle, allows partially-initialized beans to be observed, and (in Boot 2.6+) still requires `spring.main.allow-circular-references=true`.

### 5. `ObjectProvider` or `ObjectFactory` for deferred lookup

Inject an `ObjectProvider<B>` (Spring) or `jakarta.inject.Provider<B>` and call `getObject()` / `getIfAvailable()` **only when the dependency is actually needed**, deferring resolution past construction:

```java
@Component
class A {
    private final ObjectProvider<B> bProvider;
    A(ObjectProvider<B> bProvider) { this.bProvider = bProvider; }

    void doWork() {
        B b = bProvider.getObject(); // resolved lazily, breaks the construction-time cycle
        b.handle();
    }
}
```

`ObjectProvider` is a container-managed factory handle, so injecting it at construction time does not force `B` to be created yet.

### 6. `@PostConstruct` wiring (occasionally)

Inject the collaborator lazily and complete wiring in an `@PostConstruct` method, or use `ApplicationContextAware` to look the bean up after the context is built. This is a last resort.

| Fix | Works with constructor cycle? | Hides the cycle? | Recommended? |
|---|---|---|---|
| Redesign (extract/merge/event) | Yes | No | Best |
| `@Lazy` on one side | Yes | Partially | Good pragmatic fix |
| `ObjectProvider` / `Provider` | Yes | Partially | Good for genuine lazy use |
| Setter/field injection | Only setter side | Yes | Discouraged |
| `spring.main.allow-circular-references=true` | No (still fails constructor) | Yes | Escape hatch only |

---

## Common follow-up questions

**Q: Does `@Lazy` fix a constructor-injection cycle?**
Yes. `@Lazy` on a constructor parameter causes Spring to inject a lazy-initialization *proxy* rather than the real bean, so the target need not be fully constructed at injection time. It is the standard way to break a constructor cycle without switching injection styles.

**Q: Why doesn't the three-level cache help prototype beans?**
Prototype beans are never stored in any of the singleton caches — each request builds a fresh instance — so there is no early reference to expose. A prototype-scoped cycle throws `BeanCurrentlyInCreationException`.

**Q: Could Spring use only two cache levels?**
Not while supporting AOP correctly. Level 3 (the `ObjectFactory`) defers proxy creation so proxies are only built when a cycle actually forces an early reference, and level 2 caches that result so every consumer sees the *same* early reference/proxy. Two levels can't do both.

**Q: Is `spring.main.allow-circular-references` a Spring Framework property?**
No. It is a Spring Boot property that flips `SpringApplication`'s setting. In raw Spring Framework you call `AbstractAutowireCapableBeanFactory.setAllowCircularReferences(...)` directly; the framework default is `true`.

**Q: What exception signals an unresolvable cycle, and when is it thrown?**
`BeanCurrentlyInCreationException` (a subclass of `BeanCreationException`), thrown during bean instantiation — at context refresh for eager singletons, or on first `getBean` otherwise.

**Q: Why is constructor injection still recommended despite failing on cycles?**
Because failing fast at startup on a cycle is a *feature*: it forces you to fix a genuine design problem instead of hiding it behind partially-initialized beans. Constructor injection also gives immutability and guaranteed non-null dependencies.

**Q: Does `@Autowired` on a field vs. a setter behave differently for cycles?**
No functional difference for cycle resolution — both allow the bean to be instantiated first and populated later, so both can use the early-reference mechanism. Field injection just skips the setter method.

---

## References

- Spring Framework Reference — Core Technologies, "Dependencies and Configuration in Detail" / "Circular dependencies": https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html
- Spring Framework Javadoc — `DefaultSingletonBeanRegistry`, `AbstractAutowireCapableBeanFactory`, `BeanCurrentlyInCreationException`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/
- Spring Boot 2.6 Release Notes — "Circular references prohibited by default": https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.6-Release-Notes
- Spring Boot reference — `spring.main.allow-circular-references`: https://docs.spring.io/spring-boot/docs/current/reference/html/application-properties.html
- Baeldung — "Circular Dependencies in Spring": https://www.baeldung.com/circular-dependencies-in-spring
