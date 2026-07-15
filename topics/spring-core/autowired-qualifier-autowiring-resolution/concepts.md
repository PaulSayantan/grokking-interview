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

**Gotcha — name fallback needs parameter names.** For a *field*, the field name is always available through reflection, so the "match by injection-point name" fallback (step 4) always has something to compare against. For a *constructor or method parameter*, the parameter name is only available if the class was compiled with the `-parameters` flag (Java 8+) or with debug symbols (`-g`). Without either, the parameter name shows up as `arg0`, `arg1`, … and the name fallback silently fails to match any bean — so an ambiguity that "worked in the IDE" can blow up as `NoUniqueBeanDefinitionException` in a stripped production build. Spring Boot's Maven/Gradle plugins enable `-parameters` by default; plain Spring builds may not, which is why `@Qualifier` (independent of parameter names) is the robust choice.

**Gotcha — ambiguity is detected lazily.** By-type ambiguity is only reported when the injection point is actually resolved. A `@Lazy` proxy, an `ObjectProvider`/`ObjectFactory`, or a bean that is never instantiated can hide a latent ambiguity until first use rather than at context refresh.

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

**Where the resolution actually happens.** Single-value candidate selection is implemented in `DefaultListableBeanFactory.doResolveDependency` → `determineAutowireCandidate`. When multiple type matches remain, `determineAutowireCandidate` applies, in order: (1) `determinePrimaryCandidate` (the `@Primary` check — throws `NoUniqueBeanDefinitionException` if *two* primaries are found), (2) `determineHighestPriorityCandidate` (JSR-250 `@Priority`, lowest number wins — throws if two share the same highest priority), and (3) a fallback that matches the candidate whose bean name equals the injection-point name or a registered qualifier. Only if all three fail to isolate a single bean does the method return `null`, at which point `doResolveDependency` raises `NoUniqueBeanDefinitionException`.

**`@Priority` participates in single-value selection, but `@Order` does not.** This is a subtle but frequently-tested distinction: `jakarta.annotation.Priority` (or `javax.annotation.Priority`) placed on the *bean class* is consulted by `determineHighestPriorityCandidate` when breaking a single-injection tie, whereas `@Order`/`Ordered` only affects the *ordering of collections/arrays*, never which single bean wins. `@Primary` outranks `@Priority` because the primary check runs first.

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

**Gotcha — `@Primary` does NOT help a `@Qualifier`-less collection or an `ObjectProvider.orderedStream()`; it only breaks *single-value* ties.** For collection injection you get *all* candidates regardless of `@Primary`.

**Gotcha — qualifier matching vs. bean-name fallback are two distinct code paths.** `QualifierAnnotationAutowireCandidateResolver.isAutowireCandidate` first tries to match a declared `@Qualifier` value against the candidate's own qualifier metadata (including a `value` attribute and any custom-qualifier attributes). Only if no bean carries the qualifier as *metadata* does Spring fall back to treating the qualifier string as a *bean name*. Consequently, if two beans both carry `@Qualifier("primary")` as an annotation, requesting `@Qualifier("primary")` is still ambiguous — the string-as-name fallback never runs because the metadata path already matched two candidates.

**Gotcha — `@Primary` on the injection *point* is meaningless.** `@Primary` is only honored on bean definitions. Placing it at an injection point has no effect (it is not even an ambiguity resolver there); use `@Qualifier` instead.

**Custom qualifier with attributes.** A meta-annotated qualifier can carry attributes that must *all* match a bean's declared qualifier attributes:

```java
@Qualifier
@Retention(RUNTIME)
public @interface Genre { String value(); boolean legacy() default false; }

@Component @Genre(value = "action", legacy = true) class ActionA {}
@Component @Genre(value = "action")                class ActionB {}

// matches ActionA only — BOTH attributes (value AND legacy) must match
@Autowired @Genre(value = "action", legacy = true) MovieCatalog catalog;
```

You can also register a custom qualifier type with `CustomAutowireConfigurer` when you cannot meta-annotate it with `@Qualifier`.

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

**Gotcha — `required=false` field vs `Optional`/`ObjectProvider` interact differently with `NoUniqueBeanDefinitionException`.** `required=false` only suppresses the *zero-candidates* error; it does **not** suppress ambiguity. A `@Autowired(required=false)` field with two type matches and no qualifier still throws `NoUniqueBeanDefinitionException`. `Optional<T>` behaves the same way (ambiguity still throws). Only `ObjectProvider.getIfUnique()` gracefully returns `null` on multiplicity. `getIfAvailable()`, by contrast, still throws `NoUniqueBeanDefinitionException` when more than one candidate exists.

**Gotcha — `ObjectProvider` is thread-safe and lazy, which matters for scoping.** Because an `ObjectProvider`/`ObjectFactory` defers the actual `getBean` call, injecting one into a singleton is the idiomatic way to pull a fresh `prototype`- or `request`-scoped bean per call without a scoped proxy — each `getObject()`/`getIfAvailable()` performs a new lookup. Injecting the prototype *directly* into a singleton would freeze a single instance for the singleton's lifetime.

**`@Nullable` and Kotlin.** Spring also treats a Kotlin nullable type (`Foo?`) as an optional dependency. For a primitive-like injection where the framework must decide required-ness, `@Nullable`/`Optional`/`required=false` all funnel into the same `DependencyDescriptor.isRequired()` decision.

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

**Subtle `@Resource` fallback trap.** `@Resource` resolves by name first, but if the *specified/derived name matches no bean*, it falls back to a **by-type** primary match — and at that point it *does* honor `@Primary` and even a `@Qualifier` present on the field. So `@Resource` without a `name` on a field named `dataSource` will (1) look for a bean literally named `dataSource`, and only if that fails (2) do a by-type resolution. This makes `@Resource` behave like `@Autowired` in the no-name-match case, which surprises people who think "`@Resource` is purely by name."

**Which post-processor, and ordering.** `@Autowired`/`@Value`/`@Inject` are handled by `AutowiredAnnotationBeanPostProcessor`; JSR-250 `@Resource`/`@PostConstruct`/`@PreDestroy` by `CommonAnnotationBeanPostProcessor`. Both are `InstantiationAwareBeanPostProcessor`s that run during the *populate-bean* phase, after instantiation and before `@PostConstruct`. If a single field carries both `@Autowired` and `@Resource` (bad idea), both processors run and the later one wins the final value — behavior you should never rely on.

**`@Inject` requires the dependency on the classpath to even be processed.** If `jakarta.inject` (or legacy `javax.inject`) is absent, `@Inject`/`@Named` annotations are simply not recognized and the injection point is left unprocessed — a silent no-op rather than an error.

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

**Gotcha — a bean of the collection type itself is preferred over element aggregation.** If there is an actual bean of type `List<Notifier>` (e.g. a `@Bean List<Notifier> notifiers()`), Spring injects *that* bean instead of aggregating all `Notifier` beans. Element aggregation only kicks in when no single bean matches the collection type directly. The same is true for `Map<String, Notifier>`: a real `Map` bean of the matching generic type wins over name-keyed aggregation.

**Gotcha — `@Order`/`Ordered` ordering ignores `@Priority` for collections in a specific way.** For collection *elements*, Spring's `OrderComparator`/`AnnotationAwareOrderComparator` sorts by `@Order` and `Ordered`; JSR-250 `@Priority` is also honored by `AnnotationAwareOrderComparator`. Beans without any ordering annotation are placed last, in registration order — a common source of "the order changed after I renamed a class" surprises when relying on implicit ordering. Prefer explicit `@Order` if order is load-bearing.

**Gotcha — `Map<String, T>` keys are bean names, so two beans of the same type never collide, but a `Map` with a non-`String` key type is treated as an ordinary type-matched bean, not aggregation.** `Map<Class<?>, T>` will NOT aggregate; it must be satisfied by an actual matching bean.

**Self-reference exclusion.** When aggregating a collection, Spring excludes the *self* bean (the one currently being created) from the injected collection by default, to avoid a bean injecting itself into its own group. Single-bean self-injection is still possible via `@Autowired` on the same type (Spring 4.3+), but self is skipped for collection aggregation unless it is the only candidate.

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

**Gotcha — `@Lazy` breaks the cycle by injecting a proxy, not the real bean.** Putting `@Lazy` on one of the two constructor parameters makes Spring inject a lazy-resolving *proxy* immediately; the real target is fetched on first method call, by which time both beans exist. This works even for constructor injection because the proxy, not the actual collaborator, is what gets passed to the constructor.

**Gotcha — the setter/field cycle resolution relies on singleton early exposure.** Spring resolves setter/field cycles via the *third-level cache* (`singletonFactories`): a raw, not-yet-populated singleton reference is exposed early so the other bean can wire to it. This only works for **singleton** scope. `@Scope("prototype")` beans have no early exposure, so a prototype↔prototype cycle throws `BeanCurrentlyInCreationException` regardless of injection style. Also, if the early-exposed bean must be wrapped by an AOP proxy, Spring can end up injecting the raw instance into the collaborator and later proxy the "real" one — historically a source of `BeanCurrentlyInCreationException` with `allowRawInjectionDespiteWrapping` semantics.

---

## Autowiring internals, thread-safety, and ordering

**Metadata caching.** `AutowiredAnnotationBeanPostProcessor` scans each bean class once, building an `InjectionMetadata` object (the list of `@Autowired` fields/methods) that is cached keyed by class name in a `ConcurrentHashMap`. Subsequent instances of the same class reuse the cached metadata — reflection scanning is not repeated per instance. This cache, and the `DefaultSingletonBeanRegistry` singleton maps, are the reason container startup is single-scan but concurrent `getBean` lookups after refresh remain fast and thread-safe.

**`@Value` and `resolveDependency`.** `@Value` is processed by the same post-processor. Its string is resolved through the `Environment`/`BeanExpressionResolver` (SpEL) during dependency resolution, distinctly from bean-type matching. A field can carry `@Autowired` *and* `@Value`, but `@Value` short-circuits type matching by supplying an explicit value/expression.

**Resolution against the parent context.** In a parent/child `ApplicationContext` hierarchy, by-type autowiring searches the current factory and its parents (`DefaultListableBeanFactory` delegates to the parent via `getBeanNamesForType` with ancestor inclusion). A bean in the child can be satisfied by a candidate defined only in the parent. Ambiguity is computed across the merged set, which can cause a `NoUniqueBeanDefinitionException` that only appears once both contexts are combined.

**Order of injection within a single bean.** For one bean, Spring populates: constructor args at instantiation → then field/method injection during `populateBean`. Among fields and methods there is no guaranteed cross-cutting order you should depend on; do not write injection points that assume another field is already set. Use `@PostConstruct` for logic that needs all dependencies present.

**`@Autowired` on `@Bean` method parameters.** Parameters of a `@Bean` factory method are themselves autowired by type/qualifier without needing `@Autowired` — the container resolves each argument as a dependency. This is the config-class analog of constructor injection.

**`BeanFactoryPostProcessor` / `BeanPostProcessor` beans cannot be reliably autowired with normal collaborators.** Because BFPPs and some infrastructure beans are instantiated very early (before the full autowiring machinery for regular beans is ready), `@Autowired` into them may be ignored or partially applied. This is a classic "why is my `@Autowired` null in a `BeanPostProcessor`" trap — inject via constructor of a static `@Bean` method or use `ObjectProvider`/lookup instead.

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
