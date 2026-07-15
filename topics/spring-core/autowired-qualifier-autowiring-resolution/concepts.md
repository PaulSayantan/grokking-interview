# @Autowired, @Qualifier, and Autowiring Resolution

Autowiring is the mechanism by which the Spring container satisfies a bean's dependencies automatically, without you having to explicitly wire collaborators in XML or a `@Bean` factory method argument list. This note covers how `@Autowired` resolves candidates, how ambiguity is detected and broken (`@Qualifier`, `@Primary`), how optionality is expressed (`required=false`, `Optional`, `ObjectProvider`), the differences between `@Autowired`, `@Resource`, and `@Inject`, injecting collections of beans, and constructor injection rules.

Everything here targets the **Spring Framework** core container (`spring-beans` / `spring-context`), not Spring Boot. Where the JSR annotations matter, note that Spring Framework 6.x runs on **Jakarta EE 9+** namespaces (`jakarta.annotation`, `jakarta.inject`), while Spring Framework 5.x and earlier used `javax`.

---

## How @Autowired resolves dependencies

`@Autowired` is a Spring-specific annotation processed by the `AutowiredAnnotationBeanPostProcessor`. It can be placed on constructors, setter methods, arbitrary config methods, and fields. Resolution follows a well-defined order:

1. **By type first.** Spring asks the `BeanFactory` for all beans that are assignable to the declared dependency type (including generics, e.g. `Repository<Customer>`). This is the primary matching rule.
2. **Narrow by `@Qualifier`.** If a `@Qualifier` is present on the injection point, only candidates whose bean also carries a matching qualifier (or whose bean name equals the qualifier value) survive.
3. **Narrow by `@Primary`.** If multiple candidates remain and exactly one is marked `@Primary`, that one wins.
4. **Fall back to the bean name / field name / parameter name.** If there is still ambiguity, Spring uses the injection point's name (field name or parameter name) as an implicit qualifier and tries to match it against a bean name.
5. If exactly one candidate remains → inject it. If zero → behavior depends on `required` (see below). If more than one → `NoUniqueBeanDefinitionException`.

```java
@Service
public class OrderService {
    private final PaymentGateway gateway;

    // Type-based match: container finds the single PaymentGateway bean.
    @Autowired
    public OrderService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

**Key facts:**

- `@Autowired` matches by **type**, not by name (name is only a tiebreaker fallback). This is the opposite default of `@Resource`.
- The annotation attribute is `required` (default `true`).
- Field and setter injection happen **after** the constructor runs and during bean population/initialization; constructor injection happens at instantiation.
- Static fields/methods are **not** supported for injection.
- `@Autowired` on a method injects all of that method's parameters (each resolved independently by type/qualifier).
- Generics-aware matching has been supported since Spring 4.0 (and self-injection since Spring 4.3); an injection of `Store<String>` will not match a `Store<Integer>` bean.

---

## NoUniqueBeanDefinitionException on ambiguity

When `@Autowired` matches **more than one** candidate by type and cannot narrow to a single bean via qualifier, primary, or name, the container throws `NoUniqueBeanDefinitionException` (a subclass of `NoSuchBeanDefinitionException`). The message typically reads: *"expected single matching bean but found 2: fooImpl,barImpl"*.

```java
public interface Notifier {}

@Component class EmailNotifier implements Notifier {}
@Component class SmsNotifier   implements Notifier {}

@Service
public class AlertService {
    @Autowired
    private Notifier notifier;   // BOOM: NoUniqueBeanDefinitionException — 2 candidates
}
```

**Ways to resolve the ambiguity:**

| Technique | How it disambiguates |
|-----------|----------------------|
| `@Qualifier("emailNotifier")` at the injection point | picks the named/qualified candidate |
| `@Primary` on one bean definition | that bean becomes the default winner |
| Rename the field/param to a bean name (`private Notifier emailNotifier;`) | name-based fallback matches a bean |
| Inject `List<Notifier>` / `Map<String,Notifier>` | not ambiguous — you asked for *all* of them |
| Remove/condition one of the beans | only one candidate remains |

Note: if **zero** beans match, you get `NoSuchBeanDefinitionException` (with `required=true`), which is a different error than the *no-unique* case. `NoUniqueBeanDefinitionException` specifically means "too many," not "none."

---

## @Qualifier vs @Primary

Both break ambiguity, but they operate from opposite ends and have different precedence.

- **`@Primary`** is declared on the **bean definition** (the producer side). It designates a default candidate to use whenever multiple beans of a type exist and no more specific qualifier is given. It is a coarse, "unless told otherwise" preference.
- **`@Qualifier`** is declared (typically) at the **injection point** (the consumer side) and names exactly which candidate to inject. It is a fine-grained, per-injection selection.

**Precedence:** a `@Qualifier` at the injection point is more specific and **overrides** `@Primary`. So if bean A is `@Primary` but the injection point says `@Qualifier("b")`, bean B is injected.

```java
@Configuration
class Config {
    @Bean @Primary DataSource main()   { ... }   // default winner
    @Bean            DataSource audit() { ... }
}

@Component
class ReportJob {
    @Autowired DataSource ds;                       // -> main (primary)

    @Autowired @Qualifier("audit") DataSource audit; // -> audit (qualifier beats primary)
}
```

**Qualifier matching details:**

- `@Qualifier("foo")` matches a bean that either (a) is itself annotated `@Qualifier("foo")` on its class/`@Bean` method, or (b) simply has the bean name `foo`. So a plain `@Qualifier("beanName")` degrades gracefully to name matching.
- You can define **custom qualifier annotations** by meta-annotating with `@Qualifier` (e.g. `@Genre("action")`), including qualifiers with attributes for richer matching.
- `@Qualifier` can also be used on `@Bean` methods and on constructor parameters.
- Only **one** bean should be `@Primary` among candidates of a type; two primaries reintroduce ambiguity → `NoUniqueBeanDefinitionException`.

| Aspect | `@Primary` | `@Qualifier` |
|--------|-----------|--------------|
| Where declared | bean definition (producer) | injection point (consumer), also on beans |
| Granularity | one global default per type | per injection point |
| Precedence | lower (default) | higher (overrides primary) |
| Typical use | "the usual one" | "specifically this one" |

---

## required false and Optional and ObjectProvider

By default `@Autowired` requires the dependency to be satisfiable; an unsatisfied required dependency fails container startup. Three idioms make a dependency optional:

**1. `@Autowired(required = false)`** — if no matching bean exists, the field is left `null` (or the setter/method is simply not called). Note: a `required=false` **method/constructor** is skipped entirely if *any* of its parameters is unsatisfied.

```java
@Autowired(required = false)
private AuditListener auditListener;   // stays null if no bean
```

**2. `java.util.Optional<T>`** — declare the dependency as `Optional`; Spring injects `Optional.empty()` when absent, otherwise a populated `Optional`. Cleaner than null checks.

```java
@Autowired
private Optional<AuditListener> auditListener;   // never null; empty if absent
```

**3. `@Nullable`** — annotating the parameter/field with `@Nullable` (Spring's or JSR-305) tells Spring the dependency is optional, equivalent to `required=false` for that point.

**4. `ObjectProvider<T>`** (Spring 4.3+) — a lazy, programmatic handle that defers lookup until you call it, and offers convenience methods:

```java
@Autowired
private ObjectProvider<AuditListener> auditProvider;

void run() {
    AuditListener l = auditProvider.getIfAvailable();          // null if absent
    AuditListener m = auditProvider.getIfUnique();             // null if 0 or >1
    AuditListener n = auditProvider.getIfAvailable(Default::new); // fallback supplier
    auditProvider.ifAvailable(listener -> listener.onStart()); // callback
    auditProvider.stream().forEach(...);                        // iterate all candidates
}
```

`ObjectProvider` also elegantly handles the *multiple candidates* case via `getIfUnique()` / `orderedStream()`, avoiding `NoUniqueBeanDefinitionException` at injection time. It is the recommended way to express both optionality and lazy access. (`ObjectFactory<T>` is the simpler predecessor exposing only `getObject()`.)

Notes on rules: you can only mark **one** constructor as `@Autowired(required=true)`. If you have multiple `@Autowired` constructors they must all be `required=false`, and Spring treats them as candidates and picks the greediest satisfiable one.

---

## @Resource by name vs @Inject vs @Autowired

Spring supports three injection annotations. They differ in origin and default resolution strategy.

| Annotation | Source | Default resolution | Qualifier mechanism | `required`/optional |
|-----------|--------|--------------------|--------------------|---------------------|
| `@Autowired` | Spring (`org.springframework.beans.factory.annotation`) | **by type**, then qualifier/name | `@Qualifier` | `required=false`, `Optional`, `@Nullable` |
| `@Resource` | JSR-250 (`jakarta.annotation` / old `javax.annotation`) | **by name** (field/setter name, or `name` attr), then by type | the `name` attribute | no built-in optional flag |
| `@Inject` | JSR-330 (`jakarta.inject` / old `javax.inject`) | **by type**, then qualifier/name (like `@Autowired`) | `@Qualifier` (JSR-330) or `@Named` | wrap in `Provider<T>`; no `required` attr |

**`@Resource`** resolves by name first. It uses the specified `name`, or defaults to the field name (field injection) / property name (setter). Only if no name match is found does it fall back to type. It does **not** support `@Qualifier` for narrowing (use the `name` attribute). `@Resource` supports field and setter injection but **not** constructor injection.

```java
@Resource(name = "auditDataSource")   // by explicit name
private DataSource ds;

@Resource                              // by field name -> looks for bean "audit"
private DataSource audit;
```

**`@Inject`** (JSR-330) behaves almost identically to `@Autowired`: by-type with `@Qualifier`/`@Named` narrowing. Differences: `@Inject` has **no `required` attribute** (always required — use `Provider<T>` or `Optional` for optionality), and it uses JSR-330's own `@Qualifier`/`@Named`. To use `@Inject`/`@Named` you need the `jakarta.inject` (or legacy `javax.inject`) dependency on the classpath.

**Namespace note (Spring 6):** with Spring Framework 6 on Jakarta, the JSR-250/330 imports are `jakarta.annotation.Resource`, `jakarta.inject.Inject`, and `jakarta.inject.Named`. Spring 5 used `javax.*`. Spring still processes both to ease migration in some versions, but new code on Spring 6 must use `jakarta`.

**Rule of thumb:** prefer `@Autowired` (richest feature set, `required`, `ObjectProvider`, `@Primary` awareness) in Spring codebases; use `@Resource` when you want name-first semantics; use `@Inject` for framework-neutral / JSR-330-portable code.

---

## Injecting List, Map, and array of beans

When the dependency type is an array, `Collection`/`List`/`Set`, or a `Map<String, T>`, Spring injects **all** matching beans of the element type rather than throwing on ambiguity.

```java
// All Notifier beans, as a list
@Autowired
private List<Notifier> notifiers;

// Array form
@Autowired
private Notifier[] notifierArray;

// Map keyed by bean name -> bean instance
@Autowired
private Map<String, Notifier> notifiersByName;
```

**Ordering:** the elements of a `List`/array respect `@Order`, `@Priority` (JSR-250), and the `Ordered` interface. Standalone `@Order` on `@Component`/`@Bean` methods controls collection injection order (note: `@Order` alone does *not* determine `@Autowired` single-bean primary selection — that's `@Primary`/`@Priority`). Using `ObjectProvider.orderedStream()` also yields ordered candidates.

**Map injection:** the key type must be `String` (bean names); the value type is the bean type. You get a map from bean name to instance for every matching bean.

**Empty collections:** by default, if no beans of the element type exist, injection of a collection/map is treated as an unsatisfied *required* dependency and fails. Combine with `required=false` (or `ObjectProvider`) to allow an empty result.

**Qualifiers with collections:** a `@Qualifier` on a collection injection point filters the collection to only the beans carrying that qualifier — useful for grouping a subset of beans.

---

## @Autowired on constructor and single-constructor optionality

Constructor injection is the recommended style (enables `final` fields, guarantees fully-initialized objects, and aids testability).

**Single-constructor rule (Spring 4.3+):** if a class has exactly **one constructor**, you do **not** need `@Autowired` on it — Spring will use it for autowiring automatically, resolving each parameter by type/qualifier. This is why modern Spring beans (and Lombok `@RequiredArgsConstructor` beans) work without any injection annotation.

```java
@Service
public class OrderService {
    private final PaymentGateway gateway;
    private final Inventory inventory;

    // No @Autowired needed — single constructor is used automatically (Spring 4.3+)
    public OrderService(PaymentGateway gateway, Inventory inventory) {
        this.gateway = gateway;
        this.inventory = inventory;
    }
}
```

**Multiple constructors:** if there is more than one constructor, Spring will **not** guess. You must annotate exactly one with `@Autowired` (`required=true`), OR annotate several with `@Autowired(required=false)` so Spring can choose the greediest constructor whose dependencies are all satisfiable, falling back to a default/no-arg constructor if present.

**Qualifiers on constructor params:** put `@Qualifier` directly on the parameter:

```java
public OrderService(@Qualifier("stripe") PaymentGateway gateway) { ... }
```

**Circular dependencies:** pure constructor injection cannot resolve a true A↔B cycle (throws `BeanCurrentlyInCreationException`); setter/field injection can because the bean is created first, then populated. Breaking the cycle (or `@Lazy` on one injection point) is the fix.

**Why constructor injection:** immutability (`final`), clear mandatory-dependency contract, no partially constructed beans, easy unit testing (just call `new`), and it surfaces excessive-dependency code smells.

---

## Common follow-up questions

- **What is the resolution order of `@Autowired`?** By type → `@Qualifier` → `@Primary` → bean name / field-or-parameter name → error (unique or none).
- **`@Primary` vs `@Qualifier` — who wins?** `@Qualifier` at the injection point overrides `@Primary` because it is more specific.
- **What exception on two matching beans and no tiebreaker?** `NoUniqueBeanDefinitionException`. On zero beans with `required=true`: `NoSuchBeanDefinitionException`.
- **Does `@Autowired` inject by name or type?** By type first; name is only a fallback tiebreaker. `@Resource` is the name-first one.
- **How do I make a dependency optional?** `@Autowired(required=false)`, `Optional<T>`, `@Nullable`, or `ObjectProvider<T>`.
- **Difference between `@Resource`, `@Inject`, `@Autowired`?** `@Resource` = JSR-250, by name; `@Inject` = JSR-330, by type (no `required`); `@Autowired` = Spring, by type with rich options.
- **How do I inject all beans of a type?** Declare `List<T>`, `T[]`, or `Map<String,T>`; ordering via `@Order`/`@Priority`/`Ordered`.
- **When can I omit `@Autowired` on a constructor?** When the class has exactly one constructor (Spring 4.3+).
- **Can `@Resource` do constructor injection?** No — field and setter only.
- **javax vs jakarta?** Spring 5 uses `javax.annotation`/`javax.inject`; Spring 6 uses `jakarta.*`.

## References

- Spring Framework Reference — Core Technologies, "Using @Autowired": https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html
- Spring Framework Reference — "Fine-tuning Annotation-based Autowiring with Qualifiers": https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired-qualifiers.html
- Spring Framework Reference — "Using @Primary": https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired-primary.html
- Spring Framework Reference — "Using JSR 330 Standard Annotations" (@Inject, @Named): https://docs.spring.io/spring-framework/reference/core/beans/standard-annotations.html
- Javadoc — `org.springframework.beans.factory.annotation.Autowired`, `Qualifier`, `org.springframework.beans.factory.ObjectProvider`
- JSR-250 (`@Resource`) and JSR-330 (`@Inject`, `@Named`, `Provider`) specifications
