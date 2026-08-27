# Spring Expression Language (SpEL) and @Value

The Spring Expression Language (SpEL) is a powerful expression language that supports
querying and manipulating an object graph at runtime. It is used throughout the Spring
Framework — in XML and annotation bean definitions, in `@Value`, in security expressions,
in Spring Data query derivation, in caching (`@Cacheable(condition = ...)`), and more.

This note focuses on SpEL as used in Spring Framework core (the `spring-expression`
module) and its most common entry point for interviews: the `@Value` annotation.

---

## What is Spring Expression Language

SpEL is a runtime expression language shipped in the standalone `spring-expression`
module. It is not tied to the Spring IoC container — you can use it on its own — but it
integrates deeply with the container so that bean definitions and injected values can be
computed dynamically.

Key characteristics:

- **String-based, evaluated at runtime.** An expression is written as a `String`, parsed
  into an `Expression` object, then evaluated against an optional *root object* and an
  *evaluation context*.
- **Feature set.** Literals, property/nested-property access, method invocation, operators
  (relational, logical, arithmetic), the ternary and Elvis operators, safe navigation,
  regular-expression `matches`, collection access, collection selection and projection,
  type references via `T(...)`, constructor invocation via `new`, bean references via
  `@beanName`, and variable/function references.
- **Not EL/JSP EL, not OGNL.** SpEL was designed by Spring but is a distinct language.
  It borrows ideas from Unified EL and OGNL but is independently implemented.

Standalone usage (useful to understand the underlying API that Spring wraps):

```java
ExpressionParser parser = new SpelExpressionParser();
Expression exp = parser.parseExpression("'Hello World'.concat('!')");
String message = (String) exp.getValue();   // "Hello World!"

// Against a root object:
Inventor tesla = new Inventor("Nikola Tesla", "Serbian");
Expression e = parser.parseExpression("name");
String name = (String) e.getValue(tesla);   // "Nikola Tesla"
```

The three pillars of the API are `ExpressionParser` (parses strings), `Expression`
(the compiled/parsed form), and `EvaluationContext` (supplies the root object, variables,
functions, property accessors, and type conversion).

**Parsing versus evaluation are separate phases.** `parseExpression(String)` runs the
lexer/parser once and produces an `Expression` (a `SpelExpression`) that holds the AST.
`getValue(...)` walks that AST. Because parsing is the expensive part, the parsed
`Expression` is meant to be **cached and reused** across many evaluations — Spring's own
`BeanExpressionResolver` caches parsed expressions keyed by the expression string. A
`SpelExpressionParser` and the `Expression` objects it produces are thread-safe for
concurrent evaluation *as long as the evaluation is read-only*; the mutable state that must
not be shared unsafely lives in the `EvaluationContext` (variables, root object), not in the
`Expression` itself.

---

## SpEL expressions versus property placeholders

This is the single most-asked distinction. Spring supports **two** different
`String`-embedded syntaxes, and they are handled by **different** infrastructure:

| Syntax | Name | Prefix | Resolved by | Purpose |
|--------|------|--------|-------------|---------|
| `${...}` | Property placeholder | dollar-brace | `PropertySourcesPlaceholderConfigurer` / `Environment` | Look up an external **property** value (from property files, system props, env vars) |
| `#{...}` | SpEL expression | hash-brace | `BeanExpressionResolver` (`StandardBeanExpressionResolver`) | **Evaluate** a SpEL expression (beans, methods, math, logic) |

```java
@Value("${app.timeout}")           // property placeholder: reads property "app.timeout"
private int timeout;

@Value("#{2 * 60}")                // SpEL: evaluates the expression -> 120
private int seconds;
```

Critical points:

- `${...}` performs a *lookup* of a named property. If the property is missing and there
  is no default, resolution fails (typically `IllegalArgumentException:
  Could not resolve placeholder`).
- `#{...}` performs *evaluation* of an expression. It can do arithmetic, call methods, and
  reference other beans.
- **Order of processing / nesting.** Placeholders are resolved *before* SpEL is evaluated.
  This means you can embed a placeholder inside a SpEL expression, and the `${...}` part
  is substituted first, then the resulting string is evaluated as SpEL:

  ```java
  @Value("#{'${app.regions}'.split(',')}")   // ${app.regions} substituted first, then split
  private List<String> regions;
  ```

  The reverse (a `#{...}` inside a `${...}`) is not meaningful — the placeholder resolver
  does not evaluate SpEL.
- **Enabling `${...}`.** In plain Spring Framework you must register a
  `PropertySourcesPlaceholderConfigurer` bean (usually as a `static @Bean` in Java config,
  or `<context:property-placeholder>` in XML) and point it at your property files. Spring
  Boot registers one automatically, but that is a Boot feature, not core Spring.

Mnemonic: **dollar = data (a property you look up); hash = happening (an expression that
runs).**

---

## @Value with literals, placeholders, and defaults

`@Value` (in `org.springframework.beans.factory.annotation`) injects a value into a field,
constructor parameter, or method/setter parameter. The injected value is derived from the
annotation's `String` argument, which may be a literal, a `${...}` placeholder, a `#{...}`
SpEL expression, or a combination.

```java
@Value("static text")                 // literal String
private String label;

@Value("42")                          // literal, converted to int by the type converter
private int answer;

@Value("${db.url}")                   // property placeholder lookup
private String url;

@Value("${db.pool.size:10}")          // placeholder with DEFAULT 10 if property absent
private int poolSize;

@Value("${feature.flags:}")           // default is empty string if absent
private String flags;
```

Defaults for placeholders:

- Syntax is `${key:defaultValue}` — everything after the first colon is the default.
- The default itself may contain nested placeholders: `${a:${b}}`.
- Without a default, a missing property causes a startup failure (by default
  `PropertySourcesPlaceholderConfigurer.ignoreUnresolvablePlaceholders` is `false`).

Type conversion: the raw resolved string is converted to the target type using the
container's `ConversionService`/`PropertyEditor` support. So `@Value("${port:8080}")
int port` yields an `int`, `@Value("${enabled:true}") boolean enabled` yields a boolean,
and comma-separated strings can be bound to `String[]`, `List`, or `Set` automatically.

`@Value` can annotate constructor parameters (preferred for immutability):

```java
@Component
class Mailer {
    private final String host;
    Mailer(@Value("${mail.host:localhost}") String host) { this.host = host; }
}
```

Note that `@Value` on a `static` field does not work — Spring cannot inject into statics.
Also, values injected via `@Value` are resolved during bean creation; a self-reference to
the same bean's not-yet-initialized field will not see the injected value inside the
constructor body running before injection completes for field injection.

---

## @Value with SpEL expressions

When the argument uses `#{...}`, `@Value` evaluates it as SpEL. This lets you compute a
value, transform a property, or pull data from another bean at injection time.

```java
@Value("#{2 * 60 * 1000}")                       // arithmetic -> 120000
private long timeoutMillis;

@Value("#{systemProperties['user.region'] ?: 'US'}")   // env access + Elvis default
private String region;

@Value("#{T(java.lang.Math).random() * 100.0}")  // static method call
private double sample;

@Value("#{myConfigBean.maxConnections}")          // read a property from another bean
private int maxConnections;

@Value("#{'${app.hosts}'.split(',')}")            // placeholder then SpEL split -> String[]
private String[] hosts;
```

Within a `@Value` SpEL expression:

- The evaluation context is a **`StandardEvaluationContext`** created by
  `StandardBeanExpressionResolver`. It exposes the `BeanFactory` (so `@beanName` and bare
  `beanName` references work), the `Environment`, and predefined variables such as
  `systemProperties` and `systemEnvironment`.
- There is **no root object** for a `@Value` expression, so a bare identifier like
  `foo.bar` is interpreted as bean `foo`'s property `bar`, not a property of some root.
- SpEL in `@Value` is evaluated once, when the value is injected (bean creation time),
  unless the injection target is a scoped-proxy/lookup that re-resolves. It is not a live,
  continuously re-evaluated binding.

Difference from `${...}`: `${db.url}` cannot do math or call methods; `#{...}` can, and can
reference beans. If you only need to read a configured property, prefer `${...}` (simpler
and clearer); reach for `#{...}` when you must transform or compute.

---

## Referencing beans, properties, and methods

Inside SpEL (including `@Value`), you can navigate an object graph and invoke behavior:

- **Property access.** `person.name` reads the `name` property (via getter). Nested
  access chains: `order.customer.address.city`.
- **Method invocation.** `person.getName()`, `'abc'.toUpperCase()`,
  `list.size()`, `text.substring(0, 3)`.
- **Bean references with `@`.** `@myBean` returns the bean named `myBean` from the
  `BeanFactory`; `@myBean.someMethod()` invokes a method on it. In `@Value` you may also
  reference a bean by its bare name (`myBean.someMethod()`) because the bean factory acts
  as the resolver, but `@` is explicit and always works.
- **Factory bean access with `&`.** `&myFactoryBean` returns the `FactoryBean` instance
  itself rather than the object it produces.
- **Safe navigation `?.`.** `person?.name` returns `null` instead of throwing if `person`
  is `null`.
- **Constructor invocation.** `new java.util.Date()`, `new com.example.Money('USD', 5)`.

```java
@Value("#{@systemConfig.getGreeting()}")
private String greeting;

@Value("#{@userService.findDefault()?.email}")   // safe navigation
private String defaultEmail;
```

XML equivalents also exist: `<property name="x" value="#{@otherBean.prop}"/>`.

---

## Collections, arrays, selection, and projection

SpEL provides rich collection support:

- **Indexing.** `list[0]`, `array[2]`, `map['key']`. For maps, `map[key]` or
  `map['key']`. For strings, `text[0]` yields the character.
- **Inline lists.** `{1, 2, 3, 4}` builds a `java.util.List`.
- **Inline maps.** `{name: 'Nikola', dob: '10-July-1856'}` builds a `java.util.Map`.
- **Selection `.?[...]`.** Filters a collection/map, returning a new collection of matching
  elements. Inside the selection, `#this` refers to the current element.
  `list.?[#this > 10]` returns all elements greater than 10;
  `members.?[nationality == 'Serbian']` filters beans by property.
- **First / last match.** `.^[...]` returns the first matching element; `.$[...]` returns
  the last matching element.
- **Projection `.![...]`.** Transforms each element, returning a new collection.
  `members.![name]` produces the list of names.

```java
// From property "app.ports" = "8080,8443,9090"
@Value("#{'${app.ports}'.split(',')}")
private List<String> portsRaw;

// Inline list literal
@Value("#{ {'red','green','blue'} }")
private List<String> colors;

// Selection: keep even numbers from a bean-provided list
@Value("#{@numberBean.values.?[#this % 2 == 0]}")
private List<Integer> evens;

// Projection: extract a field from each element
@Value("#{@orderBean.orders.![total]}")
private List<BigDecimal> totals;
```

Map selection filters entries; inside the expression `key` and `value` are available
(e.g. `map.?[value > 100]`).

**Subtleties seniors are expected to know:**

- **Map selection returns a new `Map`, not a `List`.** When the operand is a `Map`, the
  selection expression is evaluated against each `Map.Entry`, exposing `key` and `value` as
  properties, and the result is a *new map* of matching entries (`#map.?[value < 27]`
  yields a `Map`). Projection over a map (`#map.![...]`) instead iterates the *entries* and
  returns a `List`.
- **`#this` versus `#root` inside selection/projection.** `#this` is the *current element*
  and changes on each iteration; `#root` always refers to the root object of the whole
  expression. This lets a projection reach back to the root:
  `#root.inventions.![#root.name + ' invented ' + #this]`.
- **Selection/projection cannot be compiled.** The SpEL bytecode compiler explicitly does
  not support selection, projection, bean references, array construction, or expressions
  that rely on the conversion service — such expressions always run interpreted.
- **Safe collection selection/projection.** The null-safe variants `?.?[...]` and `?.![...]`
  return `null` (rather than throwing) when the operand collection itself is `null`. First-
  and last-match (`.^[]`, `.$[]`) return `null` when no element matches.
- **Inline lists are immutable when they contain only literals.** A purely-literal
  `{1,2,3}` is created as an unmodifiable list at parse time (a constant); a list containing
  a non-literal element is rebuilt on each evaluation and is mutable.

---

## Operators, ternary, and the Elvis operator

SpEL supports a full operator set. Both symbolic and textual forms exist for relational and
logical operators (textual forms are handy in XML where `<` and `&` are awkward):

| Category | Operators |
|----------|-----------|
| Arithmetic | `+`, `-`, `*`, `/`, `%`, `^` (power), string `+` concatenation |
| Relational | `==`, `!=`, `<` (`lt`), `>` (`gt`), `<=` (`le`), `>=` (`ge`) |
| Logical | `and` (`&&`), `or` (`||`), `not` (`!`) |
| Regex | `matches` |
| Ternary | `condition ? ifTrue : ifFalse` |
| Elvis | `value ?: fallback` |
| Type / instance | `instanceof`, `T(...)` |

Textual aliases: `lt`, `gt`, `le`, `ge`, `eq`, `ne`, `div`, `mod`, `not`, `and`, `or`.

**Ternary** chooses between two values based on a boolean:

```java
@Value("#{@config.enabled ? 'ON' : 'OFF'}")
private String status;
```

**Elvis operator `?:`** is shorthand for "use the left side unless it is `null`, otherwise
use the right side." It is the null-coalescing operator:

```java
// systemProperties['region'] ?: 'US'  ==  region != null ? region : 'US'
@Value("#{systemProperties['app.region'] ?: 'US'}")
private String region;
```

Do not confuse the Elvis operator (`?:`, null-coalescing in SpEL) with the placeholder
default syntax (`${key:default}`, missing-property default). They look similar but are
different mechanisms handled by different infrastructure.

Regex example:

```java
@Value("#{'someHost.example.com' matches '[a-zA-Z0-9\\.]+' }")
private boolean validHost;
```

**Gotchas that trip up seniors:**

- **`null` is treated as "nothing", not zero, in relational comparisons.** SpEL defines
  `X > null` as always `true` and `X < null` as always `false`, for *any* left operand.
  So `#{someBean.count > null}` is `true` even when `count` is `5`, and it never throws.
  If you want a numeric guard, compare against `0`, not `null`.
- **Relational operators require `Comparable`, and `==`/`!=` differ from `equals` for
  `Comparable` types.** `<`, `<=`, `>`, `>=` use `compareTo`, so `'black' < 'block'` is
  `true`. For `==`, SpEL first tries numeric/`Comparable` comparison where applicable
  (e.g. `new BigDecimal("1.0") == new BigDecimal("1.00")` is `true` because `compareTo`
  returns 0), which can diverge from Java's `equals`.
- **`between`** is a shortcut: `input between {low, high}` expands to
  `input >= low and input <= high`, so `1 between {5, 1}` is `false` (order matters).
- **`instanceof` boxes primitives:** `1 instanceof T(int)` is `false` but
  `1 instanceof T(Integer)` is `true`.
- **String operators:** `+` concatenates, `*` repeats (`'ab' * 2` -> `'abab'`), and `-` on
  single-character strings shifts the char (`'d' - 3` -> `'a'`).
- **The power operator `^` promotes to a wider type on overflow rather than wrapping:**
  because `2^31` (2147483648) exceeds the `int` range, SpEL returns it as a `Long`, so
  `(2^31) - 1` evaluates to `2147483647L` and narrows cleanly to `Integer.MAX_VALUE` for an
  `int` target — it does *not* silently wrap like Java `int` math. Numeric type promotion
  otherwise follows Java rules (mixing a `double` promotes the result to `double`).
- **`matches` is anchored per `Matcher.matches()` semantics** (the whole input must match),
  and an invalid pattern or a mismatched type raises a `SpelEvaluationException` at
  evaluation time, not parse time.

---

## Type access with T operator and statics

The `T(...)` operator returns a `java.lang.Class` reference, which is how SpEL accesses
**static methods, static fields, constants, and enums**:

```java
@Value("#{T(java.lang.Math).PI}")                 // static field/constant
private double pi;

@Value("#{T(java.lang.Math).max(3, 7)}")          // static method
private int biggest;

@Value("#{T(java.util.concurrent.TimeUnit).SECONDS}")   // enum constant
private TimeUnit unit;

@Value("#{T(Integer).parseInt('42')}")            // java.lang types can omit the package
private int parsed;
```

Rules:

- Classes in `java.lang` may be referenced by simple name (`T(Integer)`, `T(String)`).
  All other classes require the fully qualified name (`T(java.util.Date)`).
- `T(SomeEnum).VALUE` references an enum constant.
- `instanceof` and `T(...)` together enable type checks: `#{someObj instanceof T(String)}`.

The type locator that resolves `T(...)` is part of the `EvaluationContext`. In the
`StandardEvaluationContext` used for bean definitions, the full language (including `T()`,
`new`, and method invocation) is available. A more restricted `SimpleEvaluationContext`
(introduced in Spring 4.3.15) deliberately disables type references, constructors, and bean
references for use in untrusted/data-binding scenarios.

---

## Common use cases and where SpEL is evaluated

**Where SpEL shows up in Spring:**

- `@Value("#{...}")` field/parameter injection.
- XML and Java bean definitions: `<property value="#{...}">`, and annotation attributes.
- `@Scheduled`, `@Cacheable`/`@CachePut`/`@CacheEvict` `condition`, `unless`, `key`
  attributes; `@PreAuthorize`/`@PostAuthorize` in Spring Security; `@Query` SpEL in Spring
  Data (`?#{...}`).
- Bean definition profiles and conditional wiring.

**Typical use cases:**

- Provide a computed default (`#{...?: 'fallback'}`).
- Read a value from another bean or from the environment
  (`#{systemProperties['x']}`, `#{@config.timeout}`).
- Transform a configured property (split a CSV, uppercase, arithmetic scaling).
- Wire one bean's property into another without a full dependency.

**Where and when it is evaluated:**

- For `@Value` and bean definitions, SpEL is evaluated by the
  `StandardBeanExpressionResolver` during **bean creation / dependency injection**, i.e.
  at container startup for singletons. The `beanExpressionContext` exposes the bean factory
  so `@bean` references resolve.
- The default expression prefix/suffix is `#{` and `}`, configurable on the resolver.
- SpEL expressions are, by default, **interpreted**. For hot paths, SpEL also supports a
  **compiled** mode (`SpelCompilerMode.IMMEDIATE` or `MIXED`) that generates bytecode for
  faster repeated evaluation; this is configured on the `SpelParserConfiguration`, not
  typically used for one-shot `@Value` injection.
- The evaluation context matters for security: use `SimpleEvaluationContext` for
  expressions evaluated against untrusted input to avoid exposing `T()`, constructors, and
  arbitrary bean/method access.

**Framework version note:** In Spring Framework 5.x, `@Value` and related annotations live
under `javax.*` where JSR annotations are involved; the `@Value` annotation itself is a
Spring annotation (`org.springframework.beans.factory.annotation.Value`) and is unaffected.
In Spring Framework 6.x (baseline Java 17, Jakarta EE 9+), the JSR-330/JSR-250 annotations
migrated from `javax.*` to `jakarta.*`, but `@Value` and the SpEL API are Spring's own and
keep their package names across both versions.

---

## Evaluation contexts, security, and property accessors

The `EvaluationContext` is the single most important object for correctness *and* security,
and the difference between the two shipped implementations is a favourite senior probe.

- **`StandardEvaluationContext`** exposes the *full* language: type references via `T(...)`,
  constructor invocation via `new`, method invocation, bean references, and a
  `ReflectivePropertyAccessor` that reads/writes arbitrary properties via reflection. This
  is what `StandardBeanExpressionResolver` uses for `@Value` and bean-definition SpEL —
  appropriate because those expressions come from *your own trusted configuration*.
- **`SimpleEvaluationContext`** (since Spring 4.3.15) is a deliberately locked-down subset
  built for evaluating expressions against *untrusted* input (data binding, user-supplied
  filters). It **disables `T(...)` type references, `new` constructor calls, and bean
  references entirely** — those aren't "restricted", they simply do not resolve. You choose
  the property-access level explicitly via builders:
  `SimpleEvaluationContext.forReadOnlyDataBinding().build()`,
  `forReadWriteDataBinding().build()`, or `forPropertyAccessors(...)` with a custom
  (typically non-reflective) `PropertyAccessor` such as `DataBindingPropertyAccessor`.

```java
// UNSAFE: user string can call T(java.lang.Runtime).getRuntime().exec(...)
Expression e = parser.parseExpression(userSuppliedString);
e.getValue(new StandardEvaluationContext());   // full language exposed

// SAFE: no T(), no new, no @bean — only property navigation on the root
EvaluationContext ctx = SimpleEvaluationContext.forReadOnlyDataBinding().build();
e.getValue(ctx, rootObject);
```

This is the root cause of the SpEL remote-code-execution CVEs that have appeared in various
Spring components: expressions built from HTTP input and evaluated in a
`StandardEvaluationContext` allow `T(...).exec(...)`. The mitigation is always the same —
never concatenate untrusted input into a SpEL string, and evaluate against a
`SimpleEvaluationContext` when the input is not fully trusted.

**Property accessor resolution order.** An `EvaluationContext` holds an *ordered* list of
`PropertyAccessor`s consulted until one reports it can read the property. Spring adds
specialized accessors (e.g. a `MapAccessor`, or in bean SpEL a `BeanFactoryAccessor`) ahead
of or alongside the reflective one, which is how `map.someKey` can resolve as a map lookup
rather than a bean-method call. A custom `PropertyAccessor` lets you make SpEL navigate a
non-JavaBean structure (JSON tree, `Map`, etc.).

**Type conversion is generics-aware.** By default a `StandardEvaluationContext` uses Spring's
`ConversionService`, which preserves generic type information — writing the `String`
`"false"` into a `List<Boolean>` element converts it to a `Boolean`. `SimpleEvaluationContext`
can be configured with or without a converter.

---

## SpEL compilation, SpelCompilerMode, and performance

SpEL is **interpreted by default** (`SpelCompilerMode.OFF`). Because it is a dynamically
typed language, the interpreter re-resolves properties, methods, and conversions reflectively
on every evaluation, which is fine for one-shot `@Value` injection but costly on hot paths
(a documented micro-benchmark shows 50,000 iterations at ~75 ms interpreted versus ~3 ms
compiled). The compiler generates a real Java class implementing the expression.

The three modes, configured via `SpelParserConfiguration`:

| Mode | Behaviour |
|------|-----------|
| `OFF` | Default. Always interpreted. |
| `IMMEDIATE` | Compiles after the first interpreted evaluation. If a later compiled run fails (a type changed vs. what was observed), the **caller gets the exception**. |
| `MIXED` | Silently alternates: after some interpreted runs it compiles; if a compiled run throws, the failure is caught *internally* and it reverts to interpreted, possibly recompiling later, until a failure threshold permanently pins it to interpreted. |

**Why `IMMEDIATE` exists despite `MIXED` being more forgiving:** `MIXED` mode is dangerous for
expressions with **side effects**. A compiled expression can partially execute (mutating
state) and then fail; `MIXED` will silently re-run it in interpreted mode, executing part of
it twice. `IMMEDIATE` surfaces the failure to the caller instead. Because the compiler infers
types from the *first* interpreted evaluation, it assumes types are stable across runs — an
expression that returns `Integer` on run one and `Double` on run two is a classic breakage.

**What the compiler cannot compile** (these always fall back to interpreted): assignment,
expressions relying on the `ConversionService`, custom `PropertyAccessor`/resolvers,
overloaded operators, `Optional` with the null-safe or Elvis operator, array construction,
selection, projection, and bean references.

**ClassLoader note:** compiled expressions are defined in a *child* ClassLoader of the one you
supply (or the thread context ClassLoader). That ClassLoader must be able to see every type
referenced in the expression, which matters in modular/OSGi or plugin setups.

**Global limits (DoS guards).** `SpelParserConfiguration` caps expression length at
`maxExpressionLength` (default 10,000 chars, also settable via
`spring.context.expression.maxLength`) and total operations per evaluation at `maxOperations`
(default ~10,000, via `spring.expression.maxOperations`). These prevent pathological or
malicious expressions from exhausting resources.

---

## Failure modes: parse-time versus evaluation-time errors

A recurring senior distinction is *when* a bad SpEL expression fails and *what* it throws.

- **`ParseException` / `SpelParseException`** happens at `parseExpression(...)` time for
  syntactically invalid expressions (unbalanced brackets, illegal tokens). For `@Value`, this
  surfaces during bean creation as the container parses the expression.
- **`SpelEvaluationException` (an `EvaluationException`)** happens at `getValue(...)` time for
  a *syntactically valid* expression that fails at runtime: unknown property (`EL1008E`),
  method not found (`EL1004E`), type conversion failure, a `T(...)` referencing a
  non-existent class, division by zero, or a `null` navigation without safe-navigation.
- **`@Value` wrapping.** Because `@Value` SpEL runs during dependency injection, both kinds
  surface as a `BeanCreationException`/`BeanExpressionException` wrapping the underlying SpEL
  exception, failing the context startup for singletons — a syntactically-fine but
  semantically-wrong `@Value("#{@noSuchBean.foo}")` is only detected at startup, not compile
  time.
- **Missing placeholder versus failed SpEL are different failures.** An unresolved `${...}`
  throws `IllegalArgumentException: Could not resolve placeholder` from the placeholder
  resolver; a broken `#{...}` throws a SpEL exception from the expression engine. Because
  placeholders resolve *first*, a missing `${x}` inside `#{'${x}'.trim()}` fails before SpEL
  ever runs.
- **Null navigation:** `a.b.c` throws if `b` is `null`; `a?.b?.c` yields `null` instead. The
  Elvis operator only substitutes for a `null` *result*, it does not guard intermediate
  navigation — `#{user?.address?.city ?: 'N/A'}` needs both operators.

---

## Ordering, timing, and lifecycle of @Value resolution

Several bugs come from misunderstanding *when* `@Value` is resolved relative to the bean
lifecycle and infrastructure availability.

- **`PropertySourcesPlaceholderConfigurer` is a `BeanFactoryPostProcessor`.** It must be a
  `static @Bean` in Java config so it can be instantiated *before* the regular beans it
  configures, without forcing early instantiation of the `@Configuration` class and its other
  beans. A non-static factory method can cause the config class (and its `@Autowired`
  dependencies) to be created too early, and logs a warning that `@Autowired`/`@Value` inside
  that config class may not be honoured.
- **`@Value` fields are populated during the *population* phase**, after the constructor runs
  and before `@PostConstruct`. So a field-injected `@Value` is `null` inside the constructor
  but set by the time `@PostConstruct` runs; constructor-parameter `@Value` is the way to have
  the value available in the constructor (and enables `final` fields).
- **One-shot evaluation.** `@Value` SpEL/placeholders are resolved once at injection time. To
  get values that track changes at runtime you need indirection — inject the `Environment`
  and read it on demand, use `@RefreshScope` (Spring Cloud), or a scoped/`ObjectProvider`
  lookup. A plain `@Value` field never updates after startup.
- **Prototype and scoped beans.** For a prototype bean, `@Value` is re-evaluated for *each new
  instance*, so a `#{T(java.lang.Math).random()}` differs per instance; for a singleton it is
  evaluated exactly once. This is the mechanism behind "inject a fresh value per lookup".
- **Placeholder default versus Elvis timing.** `${key:default}` is resolved by the placeholder
  processor (before SpEL); `?:` is resolved by the expression engine (during SpEL). They are
  not interchangeable and fire at different stages.

---

## Common follow-up questions

- What is the difference between `${...}` and `#{...}`? `${}` is a property-placeholder
  lookup resolved by `PropertySourcesPlaceholderConfigurer`; `#{}` is a SpEL expression
  evaluated by `StandardBeanExpressionResolver`. Placeholders are resolved before SpEL, so
  you can nest `${...}` inside `#{...}`.
- How do you give a default when a property is missing? Use the placeholder default
  syntax `${key:default}`. This is separate from the SpEL Elvis operator `?:`.
- Can `@Value` inject into a static field? No — Spring does not inject into statics.
- How do you call a static method in SpEL? With the `T()` operator, e.g.
  `T(java.lang.Math).max(a, b)`; `java.lang` classes may use the simple name.
- How do you reference another bean in a SpEL expression? Use `@beanName` (or
  `@beanName.method()`); `&beanName` returns the FactoryBean itself.
- What is the difference between selection and projection? Selection `.?[...]` filters a
  collection; projection `.![...]` maps/transforms each element. `.^[]`/`.$[]` return the
  first/last match.
- When is `@Value` SpEL evaluated? During dependency injection at bean creation; it is a
  one-time evaluation, not a live binding.
- How do you enable `${...}` in plain Spring? Register a
  `PropertySourcesPlaceholderConfigurer` (as a `static @Bean`) or use
  `<context:property-placeholder>`; Spring Boot does this automatically.
- Is SpEL safe with untrusted input? Use `SimpleEvaluationContext` to disable `T()`,
  constructors, and bean references; `StandardEvaluationContext` exposes the full language.

## References

- Spring Framework Reference — Core Technologies, "Spring Expression Language (SpEL)":
  https://docs.spring.io/spring-framework/reference/core/expressions.html
- Spring Framework Reference — "Language Reference" (operators, types, selection,
  projection, Elvis): https://docs.spring.io/spring-framework/reference/core/expressions/language-ref.html
- Spring Framework Reference — "Annotation-based Container Configuration" (`@Value`):
  https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/value-annotations.html
- Javadoc — `org.springframework.beans.factory.annotation.Value`
- Javadoc — `org.springframework.context.expression.StandardBeanExpressionResolver`
- Javadoc — `org.springframework.expression.spel.support.SimpleEvaluationContext` and
  `StandardEvaluationContext`
