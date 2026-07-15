# JVM Architecture and Class Loading

The Java Virtual Machine (JVM) is the abstract computing machine that executes Java bytecode. Understanding its architecture, memory model, and how classes are located, loaded, verified, and initialized is a staple of Java interviews because it explains *why* code behaves the way it does at runtime — from `NoClassDefFoundError` at startup to `OutOfMemoryError: Metaspace` in production.

This note is layered: each section starts with a plain definition and the *why*, moves to usage and comparisons, then digs into internals, edge cases, and gotchas.

---

## JVM vs JRE vs JDK

**Beginner definition.** These three acronyms describe nested layers of the Java platform:

- **JVM (Java Virtual Machine)** — the *specification and its implementation* (e.g., HotSpot) that loads bytecode, verifies it, and executes it. It is an abstract machine defined by *The Java Virtual Machine Specification*. The JVM is language-agnostic: it runs any language that compiles to valid `.class` bytecode (Kotlin, Scala, Groovy, Clojure).
- **JRE (Java Runtime Environment)** — the JVM **plus** the standard class libraries (`java.base`, etc.) and supporting files needed to *run* a Java application. It does **not** include compilers or developer tools.
- **JDK (Java Development Kit)** — the JRE **plus** development tools: `javac` (compiler), `jar`, `javadoc`, `jdb`, `jconsole`, `jshell` (since Java 9), and diagnostic tools like `jmap`, `jstack`, `jcmd`.

The containment relationship: **JDK ⊃ JRE ⊃ JVM**.

**Why it matters.** You compile with the JDK (`javac`) and produce `.class` files; you run those files on the JVM shipped inside a JRE/JDK. The distinction shows up when deciding what to ship in a container image.

**Intermediate / version notes.**
- **Since Java 9**, Oracle stopped shipping a standalone JRE download for most distributions. Instead, the module system (JPMS, JEP 200/261) lets you build a **custom trimmed runtime image with `jlink`** containing only the modules your app needs — this largely replaces the "install a JRE" workflow.
- The old `rt.jar` (the monolithic runtime JAR) was **removed in Java 9** and replaced by the modular `lib/modules` file plus the module system.

**Gotcha.** "The JVM is written in Java" is false — HotSpot is written mostly in C++ and assembly. Also, JIT compilation (C1/C2 compilers) is part of the JVM implementation, not a separate JDK tool.

---

## Runtime Data Areas

**Beginner definition.** When the JVM runs, it partitions memory into several **runtime data areas** (defined in JVMS §2.5–2.6). Some are shared across all threads; some are per-thread.

**Per-thread areas** (created when a thread starts, destroyed when it exits):

| Area | Purpose | OOM behavior |
|---|---|---|
| **PC (Program Counter) register** | Holds the address of the currently executing JVM instruction for that thread. Undefined for native methods. | Never throws OOM. |
| **JVM Stack** | Holds **frames**, one per method invocation. Each frame holds local variables, operand stack, and a reference to the runtime constant pool. Primitives and object *references* (not objects) live here. | `StackOverflowError` if a thread's stack exceeds its limit; `OutOfMemoryError` if the stack cannot be allocated/expanded. |
| **Native Method Stack** | Supports native (JNI/C) methods. Often merged with the JVM stack in HotSpot. | `StackOverflowError` / `OutOfMemoryError`. |

**Shared areas** (created at JVM startup):

| Area | Purpose | OOM behavior |
|---|---|---|
| **Heap** | Where **all objects and arrays** are allocated. Managed by the garbage collector. Divided (in generational GCs) into young (eden + survivor) and old generations. | `OutOfMemoryError: Java heap space`. |
| **Method Area** | Logical area for per-class structures: runtime constant pool, field/method metadata, method bytecode, static variables. In HotSpot this is implemented by **Metaspace** (since Java 8). | `OutOfMemoryError: Metaspace`. |
| **Runtime Constant Pool** | Per-class table of constants (literals, symbolic references), resolved from the `.class` constant pool. Logically part of the Method Area. | `OutOfMemoryError`. |

**Why it matters.** Interviewers probe whether you know *where* things live. Key facts:
- **Objects always live on the heap** (barring escape-analysis scalar replacement, an optimization); **references and primitives inside a method live on the stack.**
- **`static` fields live in the Method Area / Metaspace**, not the heap frame — but the *objects* they point to live on the heap.
- Each thread has its **own** stack and PC; the heap and method area are **shared**, which is why heap access needs synchronization but local variables are inherently thread-safe.

**Advanced internals.**
- **String pool**: The interned-string table (`String` literal pool) was **moved from PermGen to the heap in Java 7** (JDK 7). This is a common trap — it is *not* in Metaspace.
- **Escape analysis**: HotSpot's C2 compiler can prove an object never escapes a method and perform **scalar replacement**, allocating its fields on the stack/registers instead of the heap — so "objects always on the heap" is true at the language level but not always at the machine level.
- **TLAB (Thread-Local Allocation Buffer)**: the heap is subdivided so each thread bump-allocates in its own buffer, avoiding contention.
- **Compressed oops**: on 64-bit JVMs with heaps ≤ 32 GB, object references are stored as 32-bit compressed ordinary object pointers to save memory.

**Stack size flag**: `-Xss` sets per-thread stack size. Deep recursion → `StackOverflowError`; too many threads with large stacks → native OOM.

---

## Class Loading Phases

**Beginner definition.** Before a class can be used, the JVM must bring it through a defined lifecycle (JVMS §5.4–5.5). The three top-level phases are **Loading → Linking → Initialization**, and **Linking** itself has three sub-steps: **Verification → Preparation → Resolution**.

```
Loading
Linking
   ├─ Verification
   ├─ Preparation
   └─ Resolution   (may be lazy)
Initialization
```

**1. Loading.** A classloader finds the binary `.class` data (by name), parses it, and creates a `java.lang.Class` object in the heap representing the type. The result: a `Class` instance and internal metadata in the Method Area.

**2. Linking.**
- **Verification** — bytecode is checked for structural correctness and safety (valid constant pool, no operand-stack overflow/underflow, type-safe operations, `final` classes not subclassed). This is what makes the JVM safe against malformed/hostile bytecode. Can throw `VerifyError`.
- **Preparation** — memory for **static fields is allocated and set to *default* values** (0, `false`, `null`), **not** to their source-code initializers. `static final` compile-time constants (constant expressions of primitive/`String` type) may be assigned their real value here because they are inlined as `ConstantValue` attributes.
- **Resolution** — symbolic references in the runtime constant pool are replaced with direct references. This can be done **lazily** (at first use of each reference) — the spec permits eager or lazy resolution.

**3. Initialization.** The class's **static initializers (`static { }` blocks) and static field assignments** run, in textual order. This executes the `<clinit>` method the compiler synthesizes. Initialization of a class is **triggered lazily** on first *active use*.

**Active use** (triggers initialization) includes:
- Creating an instance (`new`).
- Invoking a static method.
- Accessing or assigning a **non-constant** static field.
- Reflection (`Class.forName("X")` with default `initialize=true`).
- Initializing a subclass (triggers superclass init first).
- Being the JVM startup class (contains `main`).

**NOT active use** (does *not* trigger initialization):
- Referencing a `static final` **compile-time constant** — it was inlined at compile time.
- Accessing a static field declared in a **superclass** through a subclass name (only the declaring class initializes).
- Declaring an array of the type (`MyClass[] a = new MyClass[10];` loads but does not initialize `MyClass`).
- `Class.forName(name, false, loader)` — explicitly requests no initialization.
- `ClassLoader.loadClass()` — loads but does not initialize.

**Code example — preparation vs initialization:**

```java
class Config {
    static int a;              // preparation: a = 0; initialization: stays via <clinit>
    static int b = 42;         // preparation: b = 0;  initialization: b = 42
    static final int C = 100;  // compile-time constant → inlined, no init needed to read C
    static { System.out.println("Config <clinit> ran"); }
}
```

Reading `Config.C` from another class does **not** print "Config <clinit> ran" because `C` is a constant inlined into the caller. Reading `Config.b` **does** trigger initialization.

**Thread-safety guarantee.** The JVM guarantees `<clinit>` runs **exactly once** and is **synchronized on the Class object** — this is the basis of the *initialization-on-demand holder* idiom for lazy singletons.

**Gotcha — `VerifyError` vs `LinkageError`.** `VerifyError` is a subclass of `LinkageError`, thrown during verification. `ExceptionInInitializerError` wraps any (unchecked) exception thrown from a static initializer during initialization.

---

## Classloader Hierarchy and Parent Delegation

**Beginner definition.** Classes are loaded by **classloaders**, arranged in a parent-child hierarchy. Three built-in loaders exist (naming updated in Java 9):

| Loader | Loads | Java 8 name | Java 9+ name |
|---|---|---|---|
| **Bootstrap** | Core JDK classes (`java.base` module: `java.lang.*`, etc.) | Bootstrap (from `rt.jar`) | Bootstrap (from `lib/modules`) |
| **Platform / Extension** | Platform modules / JDK extensions | Extension loader (from `jre/lib/ext`) | **Platform ClassLoader** (JEP 261) |
| **Application / System** | Classes on the application classpath / module path | Application (System) loader | Application (System) loader |

**Since Java 9**: the **Extension ClassLoader was replaced by the Platform ClassLoader**, and the old `ext` directory / extension mechanism was **removed** (JEP 220). All three loaders no longer extend `URLClassLoader` in Java 9+ (a source of migration bugs — code that cast `getSystemClassLoader()` to `URLClassLoader` broke).

**Parent Delegation Model.** When asked to load a class, a classloader **first delegates to its parent** before attempting to load the class itself:

```
loadClass(name):
    1. check if already loaded (findLoadedClass)
    2. else delegate to parent.loadClass(name)
    3. if parent fails (ClassNotFoundException), call findClass(name) yourself
```

The bootstrap loader is the top parent (represented as `null` in `getParent()`).

**Why delegation matters.**
1. **Safety** — you cannot override core classes. If someone writes their own `java.lang.String`, delegation ensures the *real* bootstrap `String` is loaded, never the impostor. (The JVM also forbids user code from defining classes in `java.*` packages via a `SecurityException`.)
2. **Uniqueness** — a class is loaded once per loader, avoiding duplicate `Class` objects for core types.

**Class identity = fully-qualified name + defining classloader.** Two classes with the same name loaded by **different** classloaders are **distinct types** at runtime. Assigning one to the other throws `ClassCastException`, and this is the root cause of the classic `LinkageError: loader constraint violation` and "com.foo.Bar cannot be cast to com.foo.Bar" messages in app servers.

**Advanced.**
- **`getParent()` returns `null` for the bootstrap loader** because it is implemented in native code, not as a Java object.
- **Thread Context ClassLoader (TCCL)** — parent delegation breaks down for SPI/frameworks: core JDK code (loaded by bootstrap) sometimes needs to load *application* classes (e.g., JDBC `DriverManager`, JNDI, JAXP). Since a parent loader cannot see child loader's classes, the **Thread Context ClassLoader** (`Thread.currentThread().getContextClassLoader()`) provides a back-door to reach the application loader. This is the standard "parent delegation violation" pattern.
- App servers (Tomcat, JBoss) deliberately **invert** delegation for web apps (child-first) to isolate each web app's libraries — Tomcat's `WebappClassLoader` tries itself first for most classes (except JDK/container classes) to allow different WAR files to bundle different library versions.

---

## Custom Classloaders

**Beginner definition.** You can subclass `java.lang.ClassLoader` to load bytecode from non-standard sources: over a network, from an encrypted JAR, generated at runtime, or from a database.

**Correct pattern — override `findClass`, not `loadClass`**, to preserve parent delegation:

```java
public class MyClassLoader extends ClassLoader {
    public MyClassLoader(ClassLoader parent) { super(parent); }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] bytes = loadBytecodeFor(name); // your source: file, net, db...
        if (bytes == null) throw new ClassNotFoundException(name);
        return defineClass(name, bytes, 0, bytes.length); // JVM verifies here
    }
}
```

- `defineClass(...)` converts a `byte[]` into a `Class` — this is where **verification** happens and where the loader becomes the class's **defining loader**.
- Overriding `loadClass` instead of `findClass` risks bypassing delegation (that's exactly how child-first loaders are built — deliberately).

**Why use custom loaders.**
- **Hot reloading / hot swapping** — discard a classloader and create a new one to reload changed classes (a `Class` can only be unloaded when *its defining classloader* becomes unreachable and is GC'd).
- **Isolation** — plugin systems (OSGi, application servers) give each module its own loader so they can use conflicting library versions.
- **Runtime code generation** — frameworks (Spring CGLIB proxies, Hibernate, mocking libraries) generate bytecode and define it via a loader.

**Advanced / gotchas.**
- **Class unloading**: a loaded class stays in Metaspace until *all* of the following are unreachable: the `Class` object, its defining `ClassLoader`, and all instances. A common **Metaspace leak** is repeatedly creating classloaders (or redeploying WARs) while something (a static reference, a thread, a `ThreadLocal`) keeps the old loader alive.
- **`defineClass` package sealing / same-package rules**: two classes are in the "same runtime package" only if they have the same package name **and** the same defining loader.
- **`parallelCapable`**: since Java 7, classloaders can register as parallel-capable (`ClassLoader.registerAsParallelCapable()`) to lock per-class-name instead of on the whole loader, improving concurrency.
- **Hidden classes (JEP 371, Java 15)** — `Lookup.defineHiddenClass` creates classes not discoverable by name, designed for frameworks and lambda/`invokedynamic` implementation, replacing the deprecated `Unsafe.defineAnonymousClass`.

---

## ClassNotFoundException vs NoClassDefFoundError

This pair is one of the most frequently confused topics in interviews.

| Aspect | `ClassNotFoundException` | `NoClassDefFoundError` |
|---|---|---|
| Type | **Checked `Exception`** (extends `ReflectiveOperationException` → `Exception`) | **`Error`** (extends `LinkageError` → `Error`) |
| When | The class was requested **explicitly by name at runtime** and not found | The class **was present at compile time** but is **missing/failed at runtime**, or its initialization previously failed |
| Typical cause | `Class.forName("...")`, `ClassLoader.loadClass("...")`, `loadClass` reflection with a wrong/absent name | Class was on the classpath during `javac` but not at run time; or a **prior `<clinit>` failure** left the class in an errored state |
| Who throws | Application code doing reflection | The JVM linker/initializer |

**ClassNotFoundException — example:**
```java
Class.forName("com.example.Missing"); // throws ClassNotFoundException if not on classpath
```

**NoClassDefFoundError — example:** You compile against `libX.jar` (so `javac` is happy) but run without it on the classpath. First reference to a class from that jar → `NoClassDefFoundError`.

**The subtle case — a failed static initializer:**
```java
class Bad {
    static final int X = 1 / 0; // throws ArithmeticException during <clinit>
}
// First access:
Bad b = new Bad();   // -> ExceptionInInitializerError (wraps ArithmeticException)
// Second access (class now in "erroneous" state):
Bad b2 = new Bad();  // -> NoClassDefFoundError: Could not initialize class Bad
```
This is a top interview trap: **the *first* time** initialization fails you get `ExceptionInInitializerError`; **every subsequent** attempt to use the class throws `NoClassDefFoundError` because the class is permanently marked erroneous.

**Rule of thumb.** *Exception (checked)* = "I asked for a class by name and it wasn't there." *Error* = "The class definition the runtime expected is not usable."

---

## Metaspace vs PermGen

**Beginner definition.** Class metadata (the runtime representation of classes: method bytecode, field info, constant pool, etc.) must be stored somewhere. Before Java 8 this lived in the **Permanent Generation (PermGen)**; **since Java 8 it lives in Metaspace.**

**PermGen (Java 7 and earlier).**
- A contiguous region of the **Java heap** with a fixed maximum size (`-XX:MaxPermSize`).
- Held class metadata, interned strings (until Java 7 moved them out), and static variables.
- **Removed in Java 8** (JEP 122). Passing `-XX:PermSize`/`-XX:MaxPermSize` on Java 8+ is ignored with a warning.
- Infamous for `java.lang.OutOfMemoryError: PermGen space`, especially in app servers that redeployed WARs (leaking classloaders) or generated lots of dynamic classes.

**Metaspace (Java 8+, JEP 122).**
- Allocated in **native memory (off-heap)**, not in the Java heap.
- **Grows automatically** by default, bounded only by available native memory — so the *default* is effectively unbounded (until the machine runs out of memory).
- Tunable with **`-XX:MaxMetaspaceSize`** (cap) and `-XX:MetaspaceSize` (initial GC threshold).
- Errors surface as `java.lang.OutOfMemoryError: Metaspace`.

| Aspect | PermGen (≤ Java 7) | Metaspace (Java 8+) |
|---|---|---|
| Location | Java heap | Native (off-heap) memory |
| Default max | Fixed (`-XX:MaxPermSize`, ~64–82 MB default) | Unlimited (auto-grow) |
| Interned strings | In PermGen (Java 6); **moved to heap in Java 7** | Heap |
| Static fields | PermGen | **Heap** (moved along with the class mirror) |
| Tuning flag | `-XX:MaxPermSize` | `-XX:MaxMetaspaceSize` |
| Typical OOM | `OutOfMemoryError: PermGen space` | `OutOfMemoryError: Metaspace` |

**Why the change.** PermGen's fixed sizing was hard to tune and a frequent source of OOM. Moving metadata to native, auto-growing memory removed a class of tuning headaches and aligned HotSpot with the JRockit VM (Oracle merged the two). It also enabled better class unloading.

**Gotcha.** Metaspace is *not* a silver bullet — a classloader leak now shows up as `OutOfMemoryError: Metaspace` instead of PermGen, and because it auto-grows it can exhaust *machine* memory and get the process OOM-killed by the OS if you never set `-XX:MaxMetaspaceSize`. Always cap Metaspace in containers.

---

## Static Initialization Order

**Beginner definition.** When a class initializes, its `static` field initializers and `static { }` blocks run **in the exact textual order they appear** in the source, together forming the `<clinit>` method.

**The complete ordering rules for `new Child()`:**
1. If the class isn't initialized yet, **initialize the superclass first** (recursively to the top).
2. Run **static** initializers/blocks of each class **once** (top-down: parent statics, then child statics) — but only the *first* time the class is initialized.
3. For instance creation, run **instance** initializers and constructors: superclass constructor first, then this class's instance-field initializers + instance `{ }` blocks (in order), then the constructor body.

**Static vs instance timing:**
- **Static blocks run once**, when the class is first initialized (before any instance exists).
- **Instance blocks + field initializers run on *every* `new`**, copied into the start of each constructor (after the `super(...)` call).

**Code example — predict the output:**
```java
class Parent {
    static { System.out.print("1 "); }
    { System.out.print("2 "); }
    Parent() { System.out.print("3 "); }
}
class Child extends Parent {
    static { System.out.print("4 "); }
    { System.out.print("5 "); }
    Child() { System.out.print("6 "); }
}
// new Child();  first time
```
Output: `1 4 2 3 5 6`
- Static: Parent `1`, then Child `4` (once).
- Then instance construction: `super()` runs → Parent instance block `2`, Parent ctor `3`; then Child instance block `5`, Child ctor `6`.

A **second** `new Child()` prints only `2 3 5 6` (statics already ran).

**Forward-reference gotcha — reading a static before it's assigned:**
```java
class Holder {
    static int x = getY();       // (1) runs first
    static int y = 10;           // (2)
    static int getY() { return y; }
}
// Holder.x == 0  because y was still at its default (0) when getY() ran at line (1)
```
During `<clinit>`, `y` was prepared to `0` and had not yet been assigned `10` when `getY()` executed — so `x` becomes `0`. This "illegal forward reference through a method" is a classic trap.

**Static field default trap:**
```java
class Counter {
    static int count;      // preparation → 0
    static { count++; count++; }  // now 2
    static final long START = System.nanoTime(); // runtime constant, assigned in <clinit>
}
```

**Advanced.**
- **`<clinit>` is thread-safe and runs exactly once** — the JVM holds an initialization lock per class. This underpins the **initialization-on-demand holder idiom** for lazy, thread-safe singletons:
  ```java
  class Singleton {
      private Singleton() {}
      private static class Holder { static final Singleton INSTANCE = new Singleton(); }
      static Singleton get() { return Holder.INSTANCE; } // Holder inits on first call only
  }
  ```
- **Circular static dependencies**: if class A's `<clinit>` uses B and B's uses A, the JVM's per-class init lock combined with "in progress" detection means a class already being initialized *by the current thread* is treated as initialized — so one side can observe **default/partial values**. This can deadlock across threads or yield surprising defaults; avoid static init cycles.
- `static final` **compile-time constants** (primitive/`String` constant expressions) are inlined and do **not** appear in `<clinit>` and do **not** trigger initialization when read — but `static final` values computed at runtime (like `System.nanoTime()`) *do* run in `<clinit>`.

---

## Common interview follow-up questions

1. What is the difference between the JDK, JRE, and JVM, and what changed about the JRE in Java 9?
2. Where do objects, references, and static fields live? Is a local `int` on the heap?
3. Walk through the class loading phases. What exactly happens during *preparation* vs *initialization*?
4. What triggers class initialization (active use), and what does *not*? Why doesn't referencing a `static final int` trigger it?
5. Explain the parent delegation model. What problem does it solve, and when is it deliberately inverted (Tomcat, TCCL, JDBC)?
6. Two classes have the same fully qualified name but are loaded by different classloaders — are they the same type? What error do you get assigning one to the other?
7. `ClassNotFoundException` vs `NoClassDefFoundError` — cause, type hierarchy, and the failed-`<clinit>` scenario.
8. Why was PermGen removed? What replaced it, where does it live, and how do you cap it?
9. Where did the interned String pool move, and in which Java version?
10. Predict the output of a static/instance initialization ordering puzzle across a class hierarchy.
11. How do you write a safe custom classloader? Why override `findClass` and not `loadClass`?
12. What causes a Metaspace leak, and how do classes get unloaded?
13. What is `getParent()` for the bootstrap loader, and why?
14. Explain the initialization-on-demand holder idiom and why it is thread-safe without synchronization.

---

## References

- *The Java Virtual Machine Specification, Java SE 21 Edition* — Chapter 2 (Structure of the JVM / runtime data areas) and Chapter 5 (Loading, Linking, and Initializing).
- **JEP 122**: Remove the Permanent Generation (Java 8).
- **JEP 200**: The Modular JDK; **JEP 220**: Modular Run-Time Images (removes `rt.jar`, `ext` mechanism, Java 9); **JEP 261**: Module System (introduces Platform ClassLoader).
- **JEP 282**: `jlink` — The Java Linker (Java 9).
- **JEP 371**: Hidden Classes (Java 15).
- Java SE API docs: `java.lang.ClassLoader`, `java.lang.Class`, `java.lang.NoClassDefFoundError`, `java.lang.ClassNotFoundException`, `java.lang.ExceptionInInitializerError`.
- Oracle HotSpot VM documentation: Metaspace tuning (`-XX:MaxMetaspaceSize`), compressed oops, TLAB.
- *Java Language Specification (JLS) SE 21* — §8.7 (static initializers), §12.4 (class initialization), §8.3.3 (forward references).
