# Pattern Matching, Switch Expressions and Text Blocks (JDK 14-21)

This topic covers a cluster of related language features that landed between JDK 14 and
JDK 21. They were deliberately sequenced by the JDK team (Project Amber) so that each one
builds on the last: switch expressions made `switch` a first-class expression, pattern
matching for `instanceof` introduced *binding variables*, pattern matching for `switch`
generalized both, and record patterns added *deconstruction*. Getting the exact version and
preview/final status right matters a lot in interviews, so every section is tagged.

Quick version map (memorize this):

| Feature | Preview | Final (standard) |
|---|---|---|
| Switch expressions | JDK 12 (JEP 325), JDK 13 (JEP 354) | **JDK 14** (JEP 361) |
| Text blocks | JDK 13 (JEP 355), JDK 14 (JEP 368) | **JDK 15** (JEP 378) |
| Pattern matching for `instanceof` | JDK 14 (JEP 305), JDK 15 (JEP 375) | **JDK 16** (JEP 394) |
| Records | JDK 14/15 | **JDK 16** (JEP 395) |
| Sealed classes | JDK 15/16 | **JDK 17** (JEP 409) |
| Pattern matching for `switch` | JDK 17 (JEP 406), 18, 19, 20 | **JDK 21** (JEP 441) |
| Record patterns | JDK 19 (JEP 405), 20 | **JDK 21** (JEP 440) |

LTS releases relevant here: **JDK 17** and **JDK 21**. On JDK 17 you get switch
expressions, text blocks, `instanceof` pattern matching, records and sealed classes as
final features, but pattern matching for `switch` and record patterns are still *preview*
there — they only became final in **JDK 21**.

## Switch expressions

**Beginner — what and why.** Before Java 14, `switch` was only a *statement*: it performed
side effects but did not produce a value, used colon labels with implicit fall-through, and
was a notorious source of bugs (forgotten `break`). A **switch expression** (final in
**JDK 14**, JEP 361) lets `switch` *evaluate to a value* and adds a new arrow (`->`) label
form with no fall-through.

Old way (statement, fall-through, mutable variable):

```java
int numLetters;
switch (day) {
    case MONDAY:
    case FRIDAY:
    case SUNDAY:
        numLetters = 6;
        break;          // forget this and you fall through -> bug
    case TUESDAY:
        numLetters = 7;
        break;
    default:
        throw new IllegalStateException("Bad day: " + day);
}
```

New way (expression, arrow labels, no fall-through):

```java
int numLetters = switch (day) {
    case MONDAY, FRIDAY, SUNDAY -> 6;   // multiple labels, comma-separated
    case TUESDAY                -> 7;
    case THURSDAY, SATURDAY     -> 8;
    case WEDNESDAY              -> 9;
};  // note the semicolon: it is an expression assigned to a variable
```

**Intermediate — arrow vs colon, and `yield`.** There are two label forms:

- **Arrow form** (`case L ->`): the right-hand side is a single expression, a block, or a
  `throw`. There is **no fall-through**. Only the matched label's code runs.
- **Colon form** (`case L:`): the traditional form, still with fall-through. Inside a colon-form
  switch expression you produce the value with the **`yield`** keyword (a *contextual*
  keyword introduced with switch expressions, not `return`).

```java
int numLetters = switch (day) {
    case MONDAY, FRIDAY, SUNDAY: yield 6;
    case TUESDAY:                yield 7;
    default: throw new IllegalStateException("Bad day: " + day);
};
```

A block on the arrow form must also `yield` a value:

```java
int result = switch (code) {
    case 1 -> {
        int x = compute();
        yield x * 2;          // block must yield, not return
    }
    default -> 0;
};
```

`return` inside a switch expression block is a compile error — it would return from the
enclosing method, which is not allowed inside an expression. Use `yield`.

**Advanced — exhaustiveness.** A switch *expression* must be **exhaustive**: every possible
input value must be handled, because the expression must always produce a value. The compiler
enforces this. Concretely:

- For an `enum`, if you cover all constants you do *not* strictly need a `default`, but the
  compiler will still require handling for future/unknown constants. Since JDK 14, when all
  enum constants are covered the compiler inserts a synthetic default that throws
  `MatchException` (JDK 21+) / `IncompatibleClassChangeError` (earlier) if an enum gains a
  constant at runtime that the compiled switch does not know about.
- For other types (e.g. `int`, `String`) you generally need a `default`.

A switch *statement* is **not** required to be exhaustive (it can silently do nothing), which
is one reason expressions are safer.

**Gotchas.**
- You cannot mix arrow and colon forms in the same `switch`.
- Arrow form eliminates fall-through, so a single `case` can list multiple labels with commas
  instead of stacking empty `case` labels.
- Switch expressions can throw directly on the arrow: `case FOO -> throw new ...;`.
- The whole construct is an expression, so it ends with a semicolon when used in an assignment.

## Text blocks

**Beginner — what and why.** A **text block** (final in **JDK 15**, JEP 378) is a multi-line
string literal delimited by three double-quotes (`"""`). It solves the pain of embedding
multi-line content (JSON, SQL, HTML) in Java, where the old way required `\n`, concatenation,
and escaped quotes.

Old way:

```java
String json = "{\n" +
              "  \"name\": \"Alice\",\n" +
              "  \"age\": 30\n" +
              "}";
```

New way (text block):

```java
String json = """
        {
          "name": "Alice",
          "age": 30
        }""";
```

The opening `"""` must be followed by a line terminator (you cannot put content on the same
line as the opening delimiter). The content starts on the next line.

**Intermediate — incidental whitespace.** Indentation you add to keep the code readable is
called **incidental whitespace** and is stripped automatically; the whitespace you actually
want is **essential whitespace**. The algorithm:

1. Consider all non-blank content lines *and* the line containing the closing `"""`.
2. Find the minimum indentation (the common leading whitespace) across those lines.
3. Strip that many leading spaces from every line.

So the position of the **closing delimiter** controls the left margin. Placing the closing
`"""` further left preserves more leading whitespace; aligning it under the content removes it.

```java
String s = """
        hello
        world
        """;      // closing """ at column 8 -> "hello\nworld\n"
```

Trailing whitespace on each line is also stripped. A text block that ends with content on the
same line as the closing `"""` (as in the JSON example) has **no trailing newline**; putting
the closing delimiter on its own line **adds** a trailing `\n`.

**Advanced — escapes and new escape sequences.** Text blocks support the usual escapes plus
two that were added specifically for them (JDK 15):

- `\` at end of a line (line-continuation) **suppresses the newline** — useful for wrapping a
  long single-line string across source lines.
- `\s` is a **space escape** that translates to a single space and *prevents* trailing
  whitespace from being stripped (it acts as a fence).

```java
String colors = """
        red  \
        green\
        blue""";     // -> "red  greenblue" (newlines suppressed by trailing \)

String padded = """
        item1 \s
        item2""";    // \s preserves the trailing space before it
```

Other facts:
- A `"""` sequence inside the content is escaped as `\"""` or by escaping one quote.
- Text blocks are still `String` — there is no new type. They are compiled to the same string
  constant, so `"abc" == """abc"""` (interned) is `true`.
- Since JDK 15, `String` gained helpers that pair well: `stripIndent()` (applies the same
  algorithm to a normal string), `translateEscapes()`, and `formatted(Object...)` (an instance
  alias for `String.format` handy on a text block).
- Line terminators in the source (CRLF vs LF) are **normalized to LF (`\n`)** in the resulting
  string regardless of the source file's line endings.

## Pattern matching for instanceof

**Beginner — what and why.** Pattern matching for `instanceof` (final in **JDK 16**, JEP 394)
lets you test a type *and* bind the cast result to a variable in one step, removing the
redundant explicit cast.

Old way:

```java
if (obj instanceof String) {
    String s = (String) obj;   // redundant cast
    System.out.println(s.length());
}
```

New way (type pattern with a **binding variable** `s`):

```java
if (obj instanceof String s) {   // s is bound only if the test succeeds
    System.out.println(s.length());
}
```

**Intermediate — flow scoping.** The binding variable `s` is in scope exactly where the
compiler can prove the `instanceof` matched — this is called **flow scoping** (not simple
lexical/block scoping). This enables:

```java
if (obj instanceof String s && s.length() > 5) { ... }   // && short-circuits, s in scope

if (!(obj instanceof String s)) {
    return;                 // if not a String, bail out
}
// s IS in scope here, because control only reaches this line when the match succeeded
System.out.println(s.length());
```

Note that `||` does **not** extend the binding to the right operand the way `&&` does, because
reaching the right side of `||` means the pattern *failed*. `if (obj instanceof String s || s.length() > 0)`
is a compile error (`s` not in scope on the right of `||`).

**Advanced — gotchas.**
- The binding variable is effectively a normal local variable; it is **not final** unless you
  add `final`, so you can reassign it (though that is poor style and breaks flow reasoning).
- Since the binding is a local variable, it can shadow fields, and you can combine it with
  `equals`-based patterns like the classic `equals` override:

```java
@Override
public boolean equals(Object o) {
    return o instanceof Point p && p.x == x && p.y == y;
}
```

- `null instanceof AnyType` is always `false` (as it always was), so a type pattern never binds
  `null`. This is an important contrast with pattern matching for `switch`, which handles `null`
  explicitly.
- Flow scoping means the compiler tracks *definite assignment*-style reasoning; a binding can be
  in scope after an early `return`/`throw` in the negative branch.

## Pattern matching for switch

**Beginner — what and why.** Pattern matching for `switch` (final in **JDK 21**, JEP 441;
preview in 17-20) lets `case` labels be **type patterns** instead of just constants. Instead of
a chain of `if / else if (x instanceof ...)`, you switch directly on the object's type.

Old way:

```java
String format(Object o) {
    if (o instanceof Integer i)      return "int " + i;
    else if (o instanceof Long l)    return "long " + l;
    else if (o instanceof String s)  return "str " + s;
    else                             return o.toString();
}
```

New way:

```java
String format(Object o) {
    return switch (o) {
        case Integer i -> "int " + i;
        case Long l    -> "long " + l;
        case String s  -> "str " + s;
        default        -> o.toString();
    };
}
```

**Intermediate — guarded patterns with `when`.** You can attach a boolean guard to a case label
using the **`when`** contextual keyword. The case matches only if the pattern matches *and* the
guard is true.

```java
String describe(Object o) {
    return switch (o) {
        case Integer i when i > 100 -> "big int";
        case Integer i              -> "small int";   // order matters: guarded case first
        case String s when s.isBlank() -> "blank string";
        case String s               -> "string of length " + s.length();
        default                     -> "other";
    };
}
```

The old preview syntax used `case Integer i && i > 100` (a `&&`); the **final JDK 21 syntax is
`when`**. `when` is a contextual keyword, so existing code using `when` as an identifier still
compiles.

**Null handling.** Traditionally `switch` throws `NullPointerException` if the selector is
`null`. With pattern matching you may add an explicit **`case null`**; without it, a `null`
selector still throws NPE (preserving backward compatibility). You can combine it:
`case null, default ->` handles null and everything else in one label. `case null` may be
combined only with `default`, and it must appear before other patterns that could match.

```java
switch (obj) {
    case null      -> System.out.println("was null");
    case String s  -> System.out.println("string " + s);
    default        -> System.out.println("something else");
}
```

**Advanced — exhaustiveness and sealed types.** A switch that uses pattern labels (a "pattern
switch") must be **exhaustive**. The compiler checks that the patterns cover all possible values
of the selector type. For a **sealed** interface/class the compiler knows the complete set of
permitted subtypes, so you can be exhaustive *without a `default`*:

```java
sealed interface Shape permits Circle, Square, Rectangle {}
record Circle(double r) implements Shape {}
record Square(double side) implements Shape {}
record Rectangle(double w, double h) implements Shape {}

double area(Shape s) {
    return switch (s) {                 // no default needed: sealed hierarchy fully covered
        case Circle c    -> Math.PI * c.r() * c.r();
        case Square sq   -> sq.side() * sq.side();
        case Rectangle r -> r.w() * r.h();
    };
}
```

If a new permitted subtype is added later and the switch is not recompiled, the JVM throws
**`MatchException`** (new in JDK 21) at runtime rather than silently doing the wrong thing.

**More advanced points and gotchas.**
- **Dominance ordering.** Case labels are tested top-to-bottom. A more general pattern
  *dominates* a more specific one; if `case CharSequence cs` precedes `case String s`, the
  `String` case is unreachable and it is a **compile error**. Likewise an unguarded
  `case Integer i` dominates a later `case Integer i when ...`. Guarded cases must precede the
  matching unguarded case.
- The compiler cannot generally prove a guarded case makes the switch exhaustive, so a switch
  whose only "total" coverage comes from guarded patterns still requires a `default` (or an
  unguarded total pattern).
- A "total" type pattern (e.g. `case Object o`) on a pattern switch also handles `null` only if
  you additionally opt in with `case null`; a bare total type pattern does **not** match `null`.
- `MatchException` is also thrown when a record deconstruction pattern's component accessor
  throws, wrapping the original exception.
- Constants and patterns can mix in the same switch (e.g. `case 0 ->`, `case Integer i ->` for a
  boxed selector), subject to dominance rules.

## Record patterns

**Beginner — what and why.** Record patterns (final in **JDK 21**, JEP 440; preview in 19/20)
let you **deconstruct** a record directly in a pattern, binding its components to variables in
one step. This works with both `instanceof` and pattern-matching `switch`.

```java
record Point(int x, int y) {}

// Type pattern (binds the whole record):
if (obj instanceof Point p) {
    int sum = p.x() + p.y();
}

// Record pattern (deconstructs into components x and y):
if (obj instanceof Point(int x, int y)) {
    int sum = x + y;   // x and y bound directly
}
```

**Intermediate — nested patterns.** Record patterns nest, so you can destructure composite
structures in a single pattern:

```java
record Point(int x, int y) {}
record Line(Point start, Point end) {}

static String describe(Object obj) {
    return switch (obj) {
        case Line(Point(var x1, var y1), Point(var x2, var y2)) ->
            "from (%d,%d) to (%d,%d)".formatted(x1, y1, x2, y2);
        default -> "not a line";
    };
}
```

`var` is allowed for component patterns and the type is inferred from the record's component
type. You may also spell out the type: `Point(int x, int y)`.

**Advanced — details and gotchas.**
- **Type inference on the record itself:** with a generic record you can write
  `case Box(var content)` and the component type is inferred. Explicit type arguments are also
  allowed. A raw record pattern is not permitted; the compiler infers type arguments.
- **No `var` on the record type in nested form** — but for components `var` works and is common.
- Record patterns require the type to be a **record**; the component bindings come from the
  record's *canonical* accessors. If an accessor throws, the switch wraps it in
  `MatchException`.
- **Exhaustiveness composes:** switching over a sealed type whose permitted subtypes are records
  can be exhaustive using nested record patterns without a `default`, and the compiler verifies
  it.
- Record patterns can carry guards too:
  `case Point(int x, int y) when x == y -> "on diagonal"`.
- **No unnamed/`_` pattern in JDK 21 final** — unnamed patterns and variables (`_`) were a
  *preview* feature in JDK 21 (JEP 443) and became final only in **JDK 22** (JEP 456). Do not
  claim `_` is available as a standard feature in 21.
- Primitive vs boxed: a record pattern component declared `int x` requires the actual component
  to be `int`; you cannot use it to match/adapt across primitive/reference types (primitive type
  patterns in general were still preview after 21).

## Common interview follow-up questions

- Which exact JDK **finalized** switch expressions? (14) Text blocks? (15) `instanceof` pattern
  matching? (16) Pattern matching for `switch` and record patterns? (**both 21**).
- What is the difference between `yield` and `return` in a switch expression, and when is each
  legal?
- Why must a switch *expression* be exhaustive but a switch *statement* need not be?
- Explain flow scoping. Why does `instanceof String s` stay in scope after an early `return` in
  the negative branch, and why not after `||`?
- How does a text block decide how much indentation to strip? What role does the closing `"""`
  play? When do you get a trailing newline?
- What do the `\` (line continuation) and `\s` escapes do in a text block?
- How does a pattern `switch` handle `null`, and how is that different from a classic `switch`?
- What is `MatchException` and when is it thrown (JDK 21)?
- Why can a switch over a sealed type omit `default`, and what happens at runtime if a new
  subtype is added without recompiling?
- What is dominance ordering and why can it cause a compile error? Where must guarded (`when`)
  cases go relative to their unguarded counterparts?
- Difference between a type pattern `Point p` and a record pattern `Point(int x, int y)`.
- Is `_` (unnamed pattern) a final feature in JDK 21? (No — preview in 21, final in 22.)
- On JDK 17 (LTS), which of these features are final and which are still preview? (Pattern
  `switch` and record patterns are preview on 17.)

## References

- JEP 361: Switch Expressions (final, JDK 14) — https://openjdk.org/jeps/361
- JEP 378: Text Blocks (final, JDK 15) — https://openjdk.org/jeps/378
- JEP 394: Pattern Matching for instanceof (final, JDK 16) — https://openjdk.org/jeps/394
- JEP 395: Records (final, JDK 16) — https://openjdk.org/jeps/395
- JEP 409: Sealed Classes (final, JDK 17) — https://openjdk.org/jeps/409
- JEP 441: Pattern Matching for switch (final, JDK 21) — https://openjdk.org/jeps/441
- JEP 440: Record Patterns (final, JDK 21) — https://openjdk.org/jeps/440
- JEP 456: Unnamed Variables and Patterns (final, JDK 22) — https://openjdk.org/jeps/456
- The Java Language Specification, Java SE 21 Edition (JLS §14.11 switch, §14.30 patterns,
  §3.10.6 text blocks).
- Oracle Java documentation: Text Blocks programmer's guide.
