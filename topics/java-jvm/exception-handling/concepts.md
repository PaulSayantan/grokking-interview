# Exception Handling

Exception handling is Java's mechanism for signalling, propagating, and recovering
from abnormal conditions that disrupt the normal flow of a program. It is built on
the `Throwable` type hierarchy, the `throw`/`throws` keywords, and the
`try`/`catch`/`finally` construct. This document builds from the type hierarchy up
through modern language features (try-with-resources, multi-catch, suppressed
exceptions — all introduced in **Java 7**) and finishes with performance internals
and best practices.

---

## The Throwable hierarchy

Every object that can be thrown in Java is an instance of `java.lang.Throwable`.
The hierarchy has two direct subclasses:

```
Object
 └── Throwable
      ├── Error            (unchecked — serious, usually unrecoverable)
      └── Exception        (checked, EXCEPT its subtree RuntimeException)
           └── RuntimeException  (unchecked)
```

**Beginner view.** A `Throwable` is anything you can put after `throw` or catch in a
`catch` clause. You almost never subclass `Throwable` or `Error` directly; you extend
`Exception` or `RuntimeException`.

**Why it matters.** The *compiler* treats the three branches differently. Whether an
exception is "checked" is a purely compile-time, static property determined by its
position in this hierarchy — the JVM at runtime does not distinguish checked from
unchecked at all. `Throwable` carries a message, an optional *cause* (for chaining),
a stack trace, and (since Java 7) an array of *suppressed* exceptions.

**Advanced note.** `Throwable` implements `Serializable`. Its fields
`detailMessage`, `cause`, `stackTrace`, and `suppressedExceptions` are part of the
serialized form. `Throwable` is also the only type usable in a `catch` clause and as
the operand of `throw`; trying to throw an arbitrary `Object` is a compile error.

---

## Checked versus unchecked versus Error

This is the single most-tested distinction in Java interviews.

| Category | Root type | Compiler-enforced? | Typical meaning | Examples |
|---|---|---|---|---|
| Checked exception | `Exception` (excluding `RuntimeException` subtree) | Yes — must be caught or declared with `throws` | Recoverable, expected external failure | `IOException`, `SQLException`, `InterruptedException` |
| Unchecked exception | `RuntimeException` | No | Programming bug / precondition violation | `NullPointerException`, `IllegalArgumentException`, `IllegalStateException`, `IndexOutOfBoundsException` |
| Error | `Error` | No | Serious JVM/environment failure, normally not caught | `OutOfMemoryError`, `StackOverflowError`, `NoClassDefFoundError` |

**The rule ("handle or declare").** For a checked exception, the compiler forces the
enclosing method to either catch it or list it in a `throws` clause. Unchecked
exceptions (`RuntimeException` and `Error` and their subclasses) are exempt from this
rule — you *may* catch them but are never *required* to.

```java
// Checked: will NOT compile without try/catch or throws
void read() {
    Files.readAllBytes(path);   // throws IOException  -> compile error if unhandled
}

// Unchecked: compiles fine, may blow up at runtime
void parse(String s) {
    int n = Integer.parseInt(s);   // throws NumberFormatException (unchecked)
}
```

**`Error` is not "uncatchable".** You *can* write `catch (Error e)` or `catch
(Throwable t)` and it compiles and runs. The convention is that you should not,
because Errors usually indicate the JVM is in a compromised state. A notable
exception: frameworks and test harnesses sometimes catch `Throwable` at the top
level to log the failure before shutting down.

**Edge case — `Throwable`'s own children.** Catching `Exception` does *not* catch
`Error`, because `Error` is a sibling of `Exception`, not a subtype. To catch
everything you must catch `Throwable`.

---

## When to use checked versus unchecked

**The classic guidance** (from Bloch's *Effective Java*, Item 70): use *checked*
exceptions for **recoverable** conditions the caller can reasonably be expected to
handle, and *unchecked* (runtime) exceptions for **programming errors** —
precondition violations that indicate a bug.

**Modern practice leans unchecked.** Most modern frameworks (Spring, Hibernate) wrap
checked exceptions in unchecked ones. Reasons:

- Checked exceptions do not compose with lambdas and streams. A `java.util.function`
  interface like `Function` does not declare `throws`, so a checked exception inside
  `stream.map(...)` forces an ugly try/catch inside the lambda.
- Checked exceptions leak implementation details through API signatures and create
  brittle `throws` clauses that ripple up the call stack.
- They tempt developers into the anti-pattern of swallowing (`catch (IOException e)
  {}`) just to make the compiler happy.

**Counterpoint.** Checked exceptions are a compile-time contract: they document the
failure modes and guarantee the caller at least acknowledges them. For a library
boundary where the failure is genuinely recoverable and the caller must act (e.g. a
retryable network timeout), a checked exception is still defensible.

**Rule of thumb.** If the caller can meaningfully recover, consider checked (or a
result type / `Optional`). If it's a bug the caller cannot fix at runtime, use
unchecked. Never use exceptions for ordinary control flow.

---

## try, catch, finally

The foundational construct. `try` guards a block; zero or more `catch` clauses handle
matching throwables; an optional `finally` block runs regardless of outcome.

```java
try {
    doWork();
} catch (IllegalArgumentException e) {
    // most specific first
} catch (RuntimeException e) {
    // broader
} finally {
    cleanup();   // runs whether or not an exception was thrown/caught
}
```

**Catch ordering rule.** `catch` clauses are checked top-to-bottom. A more specific
subtype must appear *before* a supertype; otherwise the earlier broad clause makes the
later one unreachable and the code **does not compile** ("exception has already been
caught").

**`finally` semantics.** `finally` runs after the `try` (and any matching `catch`)
completes, including when the block exits via `return`, `break`, `continue`, or a
propagating exception. The only ways to skip `finally` are: `System.exit()`, a JVM
crash / hard kill, an infinite loop, or a daemon thread being killed at shutdown.

**Beginner definition, why.** `finally` guarantees cleanup (closing files, releasing
locks) even on the exceptional path — the reason try-with-resources (below) was later
created to automate.

---

## finally and return gotchas

`finally` interacts with `return` in surprising, heavily-tested ways.

**1. `finally` runs even after `try` returns — and can overwrite the return value.**

```java
int f() {
    try {
        return 1;
    } finally {
        return 2;   // this WINS -> method returns 2
    }
}
```
A `return` (or `throw`) inside `finally` *replaces* whatever the `try`/`catch` was
about to return or throw. This is considered a bug magnet — many linters flag
`return` inside `finally`.

**2. `finally` can silently swallow an exception.**

```java
int g() {
    try {
        throw new RuntimeException("boom");
    } finally {
        return 0;   // swallows the exception; caller never sees "boom"
    }
}
```

**3. But mutating a local in `finally` does NOT change an already-evaluated return.**

```java
int h() {
    int x = 1;
    try {
        return x;      // the VALUE 1 is captured here
    } finally {
        x = 99;        // too late; return value already computed
    }
}   // returns 1, not 99
```
The return *expression* is evaluated before `finally` runs, and its value is held on
the operand stack. Reassigning the variable afterward has no effect. (For a mutable
object, however, you *can* observe changes made in `finally` to the object's fields,
because the reference was captured, not a snapshot.)

---

## try-with-resources and AutoCloseable

**Since Java 7 (JSR 334 / "Project Coin").** try-with-resources (TWR) automatically
closes resources declared in the `try (...)` header, in reverse order of
declaration, whether the block completes normally or abruptly.

```java
// OLD way (Java 6 and earlier): verbose, easy to get wrong
InputStream in = null;
try {
    in = new FileInputStream(path);
    // use in
} finally {
    if (in != null) in.close();   // close() can itself throw, masking the real error
}

// NEW way (Java 7+): concise and correct
try (InputStream in = new FileInputStream(path)) {
    // use in
}   // in.close() called automatically, even on exception
```

**Requirements.** A resource must implement `java.lang.AutoCloseable` (introduced in
Java 7), whose single method is `void close() throws Exception`. `java.io.Closeable`
(pre-existing) extends `AutoCloseable` but narrows `close()` to throw only
`IOException`.

**Java 9 enhancement (JEP 213).** You can use an *effectively final* variable already
declared outside the header, instead of declaring a fresh one:

```java
final Resource r = acquire();
try (r) {          // legal since Java 9
    r.use();
}
```

**Multiple resources close in reverse order.**

```java
try (A a = new A(); B b = new B()) { ... }
// closes b first, then a
```

**Advanced — the masking problem TWR solves.** In the old idiom, if the body threw
`E1` and then `close()` threw `E2` inside `finally`, `E2` propagated and `E1` was
*lost*. TWR fixes this: the body's exception propagates and the `close()` exception is
attached as a **suppressed** exception (see below).

---

## Multi-catch

**Since Java 7.** A single `catch` clause can handle several unrelated exception
types, separated by `|`, eliminating duplicated handling code.

```java
try {
    risky();
} catch (IOException | SQLException e) {   // Java 7+
    log.error("data access failed", e);
    throw new ServiceException(e);
}
```

**Rules and internals.**

- The caught variable `e` is **implicitly final** — you cannot reassign it.
- Its static type is the *least upper bound* (most specific common supertype) of the
  listed types, so you may only call members common to all of them.
- The alternatives must not be in a **subclass/superclass relationship** with each
  other. `catch (IOException | FileNotFoundException e)` is a **compile error** because
  `FileNotFoundException` is already a subtype of `IOException` (redundant).
- The bytecode for multi-catch is more compact than duplicated single catches: the
  compiler generates one handler shared by multiple entries in the exception table
  rather than duplicating the handler body.

---

## Exception chaining

**Since Java 1.4.** Chaining wraps a low-level exception inside a higher-level one so
that the original *cause* is preserved while the abstraction is raised to a level the
caller understands.

```java
try {
    jdbc.query(...);
} catch (SQLException e) {
    throw new RepositoryException("could not load user " + id, e);  // e is the cause
}
```

**Mechanics.** `Throwable` has a `cause` field, set via the two-arg constructor
`Throwable(String, Throwable)` or the `initCause(Throwable)` method (which can be
called at most once, and only if a cause was not already set). `getCause()` retrieves
it. Printed stack traces show the full chain with `Caused by:` sections.

**Why chain instead of just rethrowing the original?** It preserves *abstraction*
(callers depend on your API's exception type, not JDBC's) while retaining full
diagnostic detail (the root SQL error). Losing the cause — `throw new
RepositoryException("failed")` without passing `e` — discards the stack trace of the
real problem and is a common debugging headache.

**`initCause` gotcha.** Calling `initCause` when a cause was already supplied via the
constructor throws `IllegalStateException`.

---

## Suppressed exceptions

**Since Java 7**, added specifically to support try-with-resources.

When TWR's body throws an exception *and* a resource's `close()` also throws, the body
exception is the *primary* one that propagates, and the `close()` exception is
**suppressed** — attached to the primary via `addSuppressed(Throwable)` and retrievable
with `getSuppressed()`.

```java
try (AutoCloseable a = () -> { throw new RuntimeException("close-fail"); }) {
    throw new IllegalStateException("body-fail");
}
// Propagates: IllegalStateException("body-fail")
// Suppressed: RuntimeException("close-fail")  -> e.getSuppressed()[0]
```

Printed traces show `Suppressed:` sections. Contrast with the pre-Java-7 manual
`finally { close(); }` idiom, where the `close()` exception would *replace* the body
exception and the real error would vanish.

**Manual suppression.** You can call `addSuppressed` yourself. Note
`Throwable.getSuppressed()` returns an empty array (not null) when there are none.
Suppression can be disabled per-throwable via the four-arg protected `Throwable`
constructor (`enableSuppression=false`) — used by things like optimized control-flow
exceptions.

---

## Custom exceptions

Guidelines for defining your own exception types.

```java
public class OrderNotFoundException extends RuntimeException {   // unchecked
    private final long orderId;

    public OrderNotFoundException(long orderId, Throwable cause) {
        super("No order with id " + orderId, cause);   // message + chaining
        this.orderId = orderId;
    }
    public long orderId() { return orderId; }
}
```

**Design points.**

- Extend `RuntimeException` for unchecked, `Exception` for checked. Choose based on
  the recoverability guidance above.
- Provide constructors that accept a `cause` so callers can chain.
- Prefer a small hierarchy over dozens of leaf types; carry structured data
  (`orderId`) as fields rather than encoding it only in the message string.
- Reuse the standard exceptions where they fit: `IllegalArgumentException`,
  `IllegalStateException`, `UnsupportedOperationException`,
  `NullPointerException` (via `Objects.requireNonNull`),
  `IndexOutOfBoundsException`. Don't invent `MyNullException`.

**Advanced — cheap exceptions.** If a custom exception is thrown on a hot path purely
for control flow (rare, e.g. parser backtracking), you can override
`fillInStackTrace()` to return `this` without walking the stack, or use the four-arg
constructor with `writableStackTrace=false` (Java 7+). This removes the dominant cost
of exceptions (see performance section) but sacrifices diagnosability.

---

## Performance of exceptions

**Beginner takeaway.** Throwing and catching exceptions is dramatically more expensive
than a normal return, so never use them for ordinary control flow (e.g. don't use an
exception to signal end-of-loop).

**Where the cost is.** The expensive part is **`fillInStackTrace()`**, invoked by the
`Throwable` constructor, which walks the current call stack to capture frames. The
`throw`/`catch` unwinding itself is comparatively cheap. Consequences:

- Constructing the exception (capturing the trace) dominates the cost, not the
  `throw`.
- **Deep call stacks** make it worse — more frames to capture.
- A `try` block that *doesn't* throw is essentially **free** in modern JVMs (HotSpot
  uses exception tables, not runtime instrumentation), so wrapping code in `try` has
  negligible cost until something actually throws.

**Optimizations.**

- **Stackless exceptions.** Override `fillInStackTrace()` or use
  `writableStackTrace=false`; this makes throwing orders of magnitude cheaper and is
  how some high-performance libraries model control-flow signals.
- **`-XX:-OmitStackTraceInFastThrow`** — by default HotSpot, after a hot built-in
  exception (like `NullPointerException`) recurs many times at the same site, starts
  throwing a **pre-allocated, stackless** instance with an empty stack trace (you see
  the exception with no message and no trace). This flag disables that optimization
  to restore full traces during debugging.

**Related — Helpful NullPointerExceptions (JEP 358, Java 14).** Since Java 14 (on by
default since Java 15), NPE messages describe precisely which variable was null (e.g.
`Cannot invoke "String.length()" because "<local1>" is null`), greatly improving
diagnosability at essentially no steady-state cost.

---

## Best practices

- **Fail fast.** Validate preconditions at the top of a method and throw immediately
  (`Objects.requireNonNull`, `IllegalArgumentException`) rather than letting bad state
  propagate and surface far from its origin.
- **Never swallow exceptions.** An empty `catch {}` hides bugs. At minimum log with
  the exception object (which carries the stack trace); usually rethrow (chained) or
  handle meaningfully.
- **Catch the most specific type**; avoid `catch (Exception e)` / `catch (Throwable
  t)` except at well-defined top-level boundaries (request handlers, thread run
  loops).
- **Always chain the cause** when wrapping (`new XException(msg, e)`), never discard
  it.
- **Don't log-and-rethrow** the same exception at every layer — it produces duplicate
  noisy stack traces. Log once, at the boundary that handles it.
- **Clean up with try-with-resources**, not manual `finally` close blocks.
- **Never `return`, `break`, `continue`, or `throw` from `finally`** — it silently
  discards the in-flight exception or return value.
- **Don't use exceptions for control flow** — they are for exceptional conditions.
- **Preserve the interrupt.** When catching `InterruptedException` without rethrowing,
  restore the flag: `Thread.currentThread().interrupt();`
- **Document thrown exceptions** with `@throws`, including unchecked ones that form
  part of the contract.

---

## Common interview follow-up questions

1. What is the difference between a checked exception, an unchecked exception, and an
   `Error`? Which does the compiler force you to handle?
2. Does `finally` always run? Name every situation in which it does *not*.
3. What does a method return if both the `try` and the `finally` block contain a
   `return`? Why?
4. In which Java version were try-with-resources, multi-catch, and suppressed
   exceptions introduced? (All three: Java 7.)
5. In the old `try/finally` close idiom, if both the body and `close()` throw, which
   exception does the caller see, and what happened before Java 7 versus after?
6. Why must the exception variable in a multi-catch be effectively final, and why can
   the alternatives not be in a subclass relationship?
7. What is the performance cost of throwing an exception, and specifically which
   operation dominates it? How would you make an exception cheap?
8. What is `-XX:-OmitStackTraceInFastThrow` and why might you set it?
9. When would you prefer an unchecked exception over a checked one in a modern
   codebase, especially with streams and lambdas?
10. How does exception chaining work and why not just rethrow the original exception?
11. What changed for try-with-resources in Java 9?
12. What are Helpful NullPointerExceptions and when did they arrive?

---

## References

- The Java Language Specification, Java SE 21 — Chapter 11 (Exceptions), §14.20
  (`try`), §14.20.3 (try-with-resources).
- JSR 334 "Project Coin" (Java 7): try-with-resources, multi-catch, more precise
  rethrow.
- JEP 213: Milling Project Coin (Java 9) — try-with-resources on effectively final
  variables.
- JEP 358: Helpful NullPointerExceptions (Java 14).
- `java.lang.Throwable`, `java.lang.AutoCloseable`, `java.io.Closeable` API docs
  (Java SE 21).
- Joshua Bloch, *Effective Java*, 3rd ed. — Items 69–77 (Exceptions).
