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

## Common follow-up questions

- **What is the difference between `${...}` and `#{...}`?** `${}` is a property-placeholder
  lookup resolved by `PropertySourcesPlaceholderConfigurer`; `#{}` is a SpEL expression
  evaluated by `StandardBeanExpressionResolver`. Placeholders are resolved before SpEL, so
  you can nest `${...}` inside `#{...}`.
- **How do you give a default when a property is missing?** Use the placeholder default
  syntax `${key:default}`. This is separate from the SpEL Elvis operator `?:`.
- **Can `@Value` inject into a static field?** No — Spring does not inject into statics.
- **How do you call a static method in SpEL?** With the `T()` operator, e.g.
  `T(java.lang.Math).max(a, b)`; `java.lang` classes may use the simple name.
- **How do you reference another bean in a SpEL expression?** Use `@beanName` (or
  `@beanName.method()`); `&beanName` returns the FactoryBean itself.
- **What is the difference between selection and projection?** Selection `.?[...]` filters a
  collection; projection `.![...]` maps/transforms each element. `.^[]`/`.$[]` return the
  first/last match.
- **When is `@Value` SpEL evaluated?** During dependency injection at bean creation; it is a
  one-time evaluation, not a live binding.
- **How do you enable `${...}` in plain Spring?** Register a
  `PropertySourcesPlaceholderConfigurer` (as a `static @Bean`) or use
  `<context:property-placeholder>`; Spring Boot does this automatically.
- **Is SpEL safe with untrusted input?** Use `SimpleEvaluationContext` to disable `T()`,
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
