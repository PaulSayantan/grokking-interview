# Java Platform Module System (JPMS)

The Java Platform Module System (JPMS) was delivered in **Java 9 (2017)** under the
codename **Project Jigsaw** (JEP 261 for the module system runtime, JEP 200 for the
modular JDK, JEP 201 for modular source code, JEP 220 for the modular runtime image).
It introduced the *module* as a new, higher-level construct above packages: a named,
self-describing collection of packages plus a set of resources, governed by an explicit
declaration in `module-info.java`.

JPMS answered two long-standing pain points of the Java platform:

1. **The "JAR hell" / classpath problem** — the flat classpath had no notion of which
   JAR *needs* which other JAR, no encapsulation between JARs, no way to detect missing
   or duplicate/split packages until something blew up at runtime.
2. **Weak encapsulation** — `public` meant "public to the entire world". Any code could
   reach into `sun.misc.Unsafe`, `com.sun.*` internals, or your own "internal" packages.
   There was no way to say "this package is public *inside* my library but not exported
   to consumers."

**One picture to hang everything on.** Think of a module as a *building*: `requires` is
which other buildings you hold keys to, `exports` is the public lobby anyone with a key
may walk into, and `opens` is letting an inspector into the private back rooms (deep
reflection). A `public` class in a non-exported package is a nice room with no lobby door —
it exists, but no visitor can reach it.

This document layers from the basic mental model up through migration internals, edge
cases, and why adoption has been uneven.

## Modules and Project Jigsaw Overview

**Beginner definition.** A *module* is a named group of related packages and resources
that declares (a) what it depends on and (b) what it makes available to others. The JDK
itself was broken into ~90+ platform modules (e.g. `java.base`, `java.sql`,
`java.logging`, `java.xml`, `jdk.httpserver`). `java.base` is special: it exports
`java.lang`, `java.util`, `java.io`, etc., and **every module implicitly `requires
java.base`** — you never have to declare it.

**Why it matters.** Before Java 9 the runtime was a monolithic `rt.jar`. Modularizing the
JDK let tools like `jlink` build a runtime containing *only* the platform modules an app
uses, and let the platform enforce that internal APIs (`sun.*`, most `com.sun.*`) are no
longer accessible.

**The three core guarantees JPMS adds:**

| Guarantee | Meaning |
|-----------|---------|
| **Reliable configuration** | Dependencies are resolved at startup; missing/duplicate modules fail fast, not at some random later `NoClassDefFoundError`. |
| **Strong encapsulation** | A package is inaccessible from outside its module unless explicitly `exports`ed (compile+run) or `opens`ed (reflection). |
| **Scalable platform** | The JDK and apps can be assembled from just the modules they need. |

**Key vocabulary you must get right:**

- **Readability**: module M *reads* module N if M `requires` N (directly or transitively).
- **Accessibility**: a type is accessible to M only if (a) it is `public` (or the right
  narrower kind), (b) its package is `exports`ed by N, and (c) M reads N. All three must
  hold.

**How resolution actually works (what "resolved at startup" means).** The runtime does not
load every module it can find; it computes a *closure* from a set of roots:

1. **Pick the roots.** With `java -m com.acme.app/...`, the root is `com.acme.app`. When you
   run on the classpath with no explicit main module, the default roots are the platform's
   standard modules (`java.se` and friends). Flags expand the root set: `--add-modules
   ALL-MODULE-PATH` adds every module on the module path; `ALL-SYSTEM` adds every platform
   module.
2. **Walk the `requires` edges transitively** from each root, pulling in every module reached.
3. **Bind services**: for each resolved module with `uses S`, add any module that `provides S`
   (and its own requires closure) to the graph.
4. **Fail fast** if any required module is missing, if two resolved modules export the *same*
   package (split package), or if the `requires` edges form a cycle.

Worked trace: roots `= {com.acme.app}`; `app requires com.acme.core`, `core requires
com.acme.model`, and `app uses com.acme.spi.Codec`. Resolution pulls `app -> core -> model`
(plus the implicit `java.base` on each), then service-binding adds `com.acme.gzip` because it
`provides Codec`. Final resolved set: `{app, core, model, gzip, java.base}`. If `model` were
absent on the module path, startup aborts immediately with `FindException: Module com.acme.model
not found`, not a lazy `NoClassDefFoundError` deep into the run — that fail-fast is the whole
point of "reliable configuration".

## The module-info.java Descriptor

**Beginner.** Each module has exactly one module declaration in a file named
`module-info.java` placed at the **root of the module's source tree** (the default
package). It compiles to a `module-info.class`. Minimal form:

```java
module com.acme.orders {
    requires com.acme.model;          // I depend on this module
    exports com.acme.orders.api;      // others may use this package
}
```

**Intermediate.** The module *name* is a dotted identifier (reverse-DNS by convention,
but any legal identifier sequence works). The name is **not** tied to any package name,
though many modules mirror their root package. Directives allowed inside the body:

| Directive | Purpose |
|-----------|---------|
| `requires M;` | Depend on module M (readability). |
| `requires transitive M;` | Depend on M *and* re-export readability to my consumers ("implied readability"). |
| `requires static M;` | Compile-time-only dependency (optional at runtime). |
| `exports P;` | Make package P accessible (compile + runtime, incl. public reflection) to all modules. |
| `exports P to M1, M2;` | *Qualified* export — only to the named modules. |
| `opens P;` | Open P for deep reflection (incl. `setAccessible` on non-public members) at runtime. |
| `opens P to M1, M2;` | Qualified open. |
| `uses S;` | Declares this module consumes service interface S via `ServiceLoader`. |
| `provides S with Impl;` | Declares this module supplies an implementation of S. |
| `open module M { ... }` | Opens **every** package for reflection (but still must `exports` for compile-time access). |

**Advanced / gotchas.**

- `module-info.java` is **not** just metadata — it is compiled and verified. Referencing a
  package in `exports`/`opens` that the module doesn't actually contain is a compile error.
- Keywords like `module`, `requires`, `exports`, `to`, `with`, `transitive`, `open`,
  `opens`, `uses`, `provides` are **restricted keywords**: they only have meaning inside a
  module declaration, so existing code using `module` or `to` as identifiers still
  compiles.
- `transitive` and `static` as qualifiers on `requires` may be combined:
  `requires static transitive M;` is legal.

## requires and Module Readability

**Beginner.** `requires N;` establishes that your module can read module N — a
precondition for accessing any of N's exported types. Without it, even a `public` type in
an exported package of N is invisible: you get a *compile error* (`package X is not
visible`) or, if it slips through, an `IllegalAccessError`/`NoClassDefFoundError`.

**Intermediate — the three flavors:**

```java
module com.acme.web {
    requires com.acme.core;              // plain: readable by me only
    requires transitive com.acme.api;    // implied readability: my consumers read it too
    requires static com.acme.annotations; // needed to compile, optional at runtime
}
```

- **`requires transitive`** solves the "leaky API" problem. If `com.acme.web` exposes a
  method returning a type from `com.acme.api`, consumers of `com.acme.web` need to read
  `com.acme.api` to use that return value. `transitive` grants them that readability
  automatically so they don't each have to add their own `requires`. The classic platform
  example: `java.sql` has `requires transitive java.logging` and `java.xml`.
- **`requires static`** is for compile-time-only dependencies (annotation processors,
  optional integrations). At runtime the module may be absent; guard usage with reflection
  or catch `NoClassDefFoundError`. `requires static` does **not** pull the module into the
  resolution graph at runtime unless another non-static edge does.

**Advanced.**

- **`java.se` aggregator**: an *aggregator module* has no code, only
  `requires transitive` edges (e.g. `java.se`). Requiring it pulls in the whole Java SE
  API surface.
- **Cyclic dependencies at the module level are forbidden.** `A requires B` and
  `B requires A` fails at compile/resolution time. (Cycles *within* a module across
  packages are fine.)
- Readability is **not transitive by default** — only `requires transitive` propagates it.
  Plain `requires` gives readability solely to the declaring module.

## exports and Strong Encapsulation

**Beginner.** `exports com.acme.api;` makes the *public* types in that one package
accessible to modules that read you. Everything else — including public classes in
non-exported packages — is **strongly encapsulated**: invisible outside the module, at
compile time *and* runtime, *even via reflection*. This is the headline behavior change of
Java 9.

**Old way vs new way.**

| | Pre-Java 9 (classpath) | Java 9+ (module) |
|--|------------------------|------------------|
| Visibility unit | `public`/`protected`/package-private within a JAR; all JARs equal | Package must be `exports`ed by the module |
| "internal" package | Nothing stops callers; convention only (`impl`, `internal`) | Truly hidden unless exported |
| Reflection into internals | Always worked (`setAccessible(true)`) | Blocked unless `opens` |

**Intermediate — qualified exports.**

```java
module com.acme.core {
    exports com.acme.core.spi to com.acme.plugin.a, com.acme.plugin.b;
}
```

Only the two named modules can access `com.acme.core.spi`. This is how the JDK exposes
"friend" APIs — e.g. `jdk.internal.*` packages are qualified-exported to specific JDK
modules only. Attempting access from any other module fails.

**Advanced / gotchas.**

- `exports` covers **compile-time** and **normal runtime** access, including public
  reflection over public members. It does **not** grant deep reflection on
  private/non-public members — that needs `opens`.
- Exporting a package does not export its sub-packages. Packages are not hierarchical in
  JPMS; `com.acme.a` and `com.acme.a.b` are independent and each need their own directive.
- **Split packages** (the same package name spanning two modules) are illegal on the module
  path and cause resolution errors — a common migration blocker with old libraries.

## opens and Reflective Access

**Beginner.** `opens P;` allows **deep reflection** into package P at runtime — i.e.
`Field/Method/Constructor.setAccessible(true)` on any member, including private ones — by
any module. This is what frameworks like Jackson, Hibernate, Spring, and JAXB need to read
private fields and invoke non-public constructors.

**exports vs opens — a critical distinction:**

| Aspect | `exports P` | `opens P` |
|--------|-------------|-----------|
| Compile-time access to public types | Yes | **No** |
| Normal runtime access to public members | Yes | Yes (reflectively) |
| Deep reflection (`setAccessible` on private) | **No** | Yes |
| Typical consumer | Library API users | Reflection-based frameworks (Jackson, JPA, Spring) |

So a package meant for framework injection is often **`opens`ed but not `exports`ed** (you
don't want compile-time coupling, you just want the framework to reflect). Conversely a
public API is `exports`ed but usually not `opens`ed.

**Intermediate.**

```java
module com.acme.app {
    requires com.fasterxml.jackson.databind;
    opens com.acme.app.dto;                       // to everyone
    opens com.acme.app.entity to org.hibernate.orm.core; // qualified
}

open module com.acme.legacy {   // whole module open for reflection
    requires spring.context;
}
```

An `open module` implicitly opens **every** package; you then cannot add individual
`opens` directives (redundant), and it's the pragmatic escape hatch for reflection-heavy
apps during migration.

**Advanced.**

- `opens` is a purely **runtime** notion — it has no compile-time effect at all. You cannot
  satisfy a compile error by adding `opens`; you need `exports` (or `requires`).
- Because `opens` grants deep reflection, it is the JPMS-native replacement for the old
  "everything is reflectable" world. If a framework throws
  `InaccessibleObjectException` ("module X does not open package Y to module Z"), the fix is
  a targeted `opens ... to ...`.

## Services with uses and provides

**Beginner.** JPMS integrates the `java.util.ServiceLoader` mechanism directly into the
module descriptor, replacing the old `META-INF/services/<interface>` files (which still
work but the declarative form is preferred and verified).

- A **consumer** module declares `uses com.acme.spi.Codec;`
- A **provider** module declares `provides com.acme.spi.Codec with com.acme.impl.GzipCodec;`

```java
// api module
module com.acme.api { exports com.acme.spi; }

// provider module
module com.acme.gzip {
    requires com.acme.api;
    provides com.acme.spi.Codec with com.acme.impl.GzipCodec;
}

// consumer
module com.acme.app {
    requires com.acme.api;
    uses com.acme.spi.Codec;    // now ServiceLoader.load(Codec.class) finds providers
}
```

**Intermediate / advanced.**

- `ServiceLoader.load(Codec.class)` in a modular consumer scans the module graph for
  `provides` declarations — it does **not** need the classpath `META-INF/services` file.
- A provider can supply an instance in two ways: a **public no-arg constructor**, or a
  **public static `provider()` factory method** returning the service type. If a
  `provider()` method exists, ServiceLoader uses it and ignores the constructor.
- The service interface named in `uses`/`provides` must be *accessible* to the declaring
  module (its package must be exported by the defining module and required by yours).
- `provides ... with` may list multiple implementations:
  `provides S with ImplA, ImplB;`.
- The `uses` directive is what lets a consumer legally call `ServiceLoader.load`; without
  it you get an empty result / `ServiceConfigurationError` because the module system does
  not add the readability edge to providers.

**Worked trace — loading the service.** With the three modules above resolved, the consumer runs:

```java
List<Codec> codecs = ServiceLoader.load(Codec.class).stream()
    .map(ServiceLoader.Provider::get)   // instantiates via no-arg ctor or provider()
    .toList();
// codecs = [GzipCodec@...]  — one element
```

Step by step: `load` scans the *resolved module graph* (not the classpath) for `provides
Codec` declarations, finds `com.acme.gzip`, and — because `com.acme.app` declared `uses
Codec` — the system has already added the readability edge `app -> gzip` needed to
instantiate the impl. Calling `.get()` invokes `GzipCodec`'s public no-arg constructor
(or its `public static Codec provider()` factory if one exists) and yields one `GzipCodec`
instance.

Now delete the `uses com.acme.spi.Codec;` line from `com.acme.app`. The exact same call
returns an **empty stream** (`codecs = []`) — no error at load time, silently nothing —
because without `uses` the module system never granted `app` readability to any provider,
so the scan finds no eligible module. This "it compiled, it ran, but ServiceLoader found
nothing" is the classic modular-services bug interview follow-up #9 probes.

## Named, Automatic, and Unnamed Modules

This taxonomy is one of the most-tested and most-confusing parts of JPMS.

| Module kind | How you get it | Has module-info? | On which path | Reads what |
|-------------|----------------|------------------|---------------|------------|
| **Named (explicit)** | You wrote `module-info.java` | Yes | Module path | Only what it `requires` |
| **Automatic** | A plain JAR (no module-info) placed on the **module path** | No | Module path | Reads **all** other modules incl. unnamed; exports **all** its packages |
| **Unnamed** | Anything on the **classpath** | No | Classpath | Reads all modules; all its packages open/exported |

**Automatic modules — beginner.** Drop a legacy JAR onto the *module path* and it becomes
an *automatic module*. Its name is derived from the JAR file name (or the
`Automatic-Module-Name` header in its `MANIFEST.MF`, which is the recommended way for
library authors to reserve a stable name before fully modularizing). It is a bridge: it
exports everything and reads everything, so it can depend on classpath code — something a
named module cannot do.

**Worked trace — deriving the name from the file name.** The algorithm: (1) drop the
`.jar` extension; (2) strip a trailing version segment — the first `-` followed by a digit
and everything after it; (3) replace every run of non-alphanumeric characters with a single
`.`; (4) collapse any resulting repeated/edge dots. Example:

```
jackson-databind-2.15.2.jar
  -> jackson-databind-2.15.2      (drop .jar)
  -> jackson-databind             (strip "-2.15.2": first '-' before a digit)
  -> jackson.databind             (replace '-' run with '.')
module name = jackson.databind
```

This is exactly why version-stripping is a gotcha: the version match starts at the first
`-` that is followed by a digit (`-3.12.0` here), so `commons-lang3-3.12.0.jar` and an
internal rebuild `commons-lang3-3.12.0-patched.jar` **both** strip to `commons-lang3` ->
`commons.lang3`. Two modules with the same name on the module path make resolution fail.
Reserve a distinct name via `Automatic-Module-Name` to avoid the clash.

**Unnamed module — beginner.** All code loaded from the classpath lives in the single
*unnamed module*. It can read every other module and every package it contains is
effectively exported and open. Crucially:

- **A named module cannot `requires` the unnamed module.** There's no name to reference. So
  a fully modular application cannot depend on classpath-only code — you must move that
  code to the module path (making it automatic) or modularize it.
- Automatic modules *can* read the unnamed module, which is exactly why they're the
  migration bridge.

**Advanced / gotchas.**

- If two automatic modules would derive the **same** name (e.g. `commons-lang3-3.12.jar`
  and a fork), resolution fails — reserve names with `Automatic-Module-Name`.
- Automatic modules are the source of a lot of migration warnings; they undermine strong
  encapsulation (they open everything) but are necessary until the ecosystem modularizes.
- The `Automatic-Module-Name` manifest header lets a library declare its future module name
  *without* shipping a `module-info.class`, so it stays Java-8 compatible while being
  usable as a stable-named automatic module on Java 9+.

## Classpath versus Module Path

**Beginner.** Java 9+ has two independent locations to find code:

- `--class-path` / `-cp` — the traditional flat path; contents form the **unnamed module**.
- `--module-path` / `-p` — the new path; JARs here become **named** (if they have
  module-info) or **automatic** modules.

You can use **both at once** during migration. The command to launch a modular app:

```bash
java --module-path mods --module com.acme.app/com.acme.app.Main
# short form:
java -p mods -m com.acme.app/com.acme.app.Main
```

**Intermediate.** Placement determines identity:

| JAR contents | On classpath | On module path |
|--------------|--------------|----------------|
| Has `module-info.class` | Treated as **unnamed** (module-info ignored) | **Named** module |
| No `module-info` | Part of **unnamed** module | **Automatic** module |

So the *same* JAR behaves differently depending on which path it's on — a frequent source
of confusion.

**Advanced / gotchas.**

- **Encapsulation only applies to the module path.** Code on the classpath is not
  strongly encapsulated relative to itself. But platform-module internals are encapsulated
  regardless — classpath code still cannot reach `sun.*` without `--add-opens`.
- **Split packages between module path and classpath**: if a package exists both in a named
  module and in the unnamed module (classpath), the named module *wins* and the classpath
  copy is invisible to modules — leading to surprising `NoClassDefFoundError`s.
- Useful escape-hatch flags (also work at runtime):
  - `--add-modules M` — add modules not otherwise resolved (e.g. `ALL-SYSTEM`,
    `ALL-MODULE-PATH`).
  - `--add-reads M=N` — add a readability edge without editing module-info.
  - `--add-exports M/P=OTHER` — export a package at compile/run time from the command line.
  - `--add-opens M/P=OTHER` — open a package for deep reflection at runtime.
    The target `OTHER` can be a **module name** *or* the literal **`ALL-UNNAMED`** — the
    latter is the common real-world case, meaning "grant this to all classpath code."
    E.g. `--add-opens java.base/java.lang=ALL-UNNAMED` is what build tools (Maven Surefire,
    mocking libraries) inject so classpath-based frameworks can still reflect into
    `java.lang` on JDK 17+.
  - `--illegal-access=permit|warn|deny` — see the modern-JDK section below.

## Accessibility Rules and Why Reflection Broke

**Beginner.** For type `T` in package `P` of module `N` to be accessible from module `M`,
**all** must hold:

1. `T` (and the member) is declared with sufficient visibility (`public`, etc.).
2. `N` **exports** `P` (unqualified, or qualified to `M`).
3. `M` **reads** `N` (via `requires`, transitive, or an added-reads edge).

For **deep reflection** (`setAccessible(true)` on non-public members), replace #2 with:
`N` **opens** `P` (to all or to `M`).

**Worked trace — which condition fails?** `com.acme.web` (module M) wants to use
`public class Cache` in package `com.acme.core.internal` of module `com.acme.core` (module N).
Walk the three conditions:

| # | Condition | Holds? |
|---|-----------|--------|
| 1 | `Cache` is `public` | Yes |
| 2 | `com.acme.core` **exports** `com.acme.core.internal` | **NO** — it's an internal pkg, never exported |
| 3 | `com.acme.web` **requires** `com.acme.core` | Yes |

Two of three hold, but accessibility needs **all three**, so the compiler stops at
condition #2: `error: package com.acme.core.internal is not visible (package
com.acme.core.internal is declared in module com.acme.core, which does not export it)`.
**Flip the failing condition** — add `exports com.acme.core.internal;` (or, better,
`exports ... to com.acme.web;`) to core's module-info — and now all three hold, so it
compiles and runs.

**Worked trace — the deep-reflection variant.** Now Jackson (in `com.acme.web`) tries
`field.setAccessible(true)` on a *private* field of `Cache`. Even after the `exports` fix
above, condition #2 for reflection is different: it requires `opens`, not `exports`. So you
get, at runtime:

```
java.lang.reflect.InaccessibleObjectException: Unable to make field private ...
cannot access a member of class com.acme.core.internal.Cache with modifiers "private"
because module com.acme.core does not "opens com.acme.core.internal" to module com.acme.web
```

Fix: `opens com.acme.core.internal to com.acme.web;` in core's module-info (or the launch flag
`--add-opens com.acme.core/com.acme.core.internal=com.acme.web`). Note `exports` alone never
silences this — the two conditions are independent.

**Why existing reflection code broke in Java 9.** Before modules, `setAccessible(true)`
essentially always succeeded — that's how Jackson read private fields, how Spring injected
into non-public members, how tools poked `sun.misc.Unsafe`. Once packages became
encapsulated:

- Reflecting into a **platform internal** (e.g. `jdk.internal.misc.Unsafe`,
  `java.lang.reflect` internals, `com.sun.*`) started throwing
  `InaccessibleObjectException` unless the package was open to your module.
- Reflecting into an application module's non-opened package likewise throws
  `InaccessibleObjectException: Unable to make field X accessible: module N does not
  "opens P" to module M`.

**Advanced.**

- The check is enforced by `AccessibleObject.setAccessible` and by the core reflection /
  `MethodHandles.Lookup` machinery. A `Lookup` obtained across module boundaries only has
  the access the module graph permits.
- The mitigation ladder: prefer a real `opens` in module-info; if you can't edit the module
  (third-party), use the command-line `--add-opens N/P=M` (or `ALL-UNNAMED` as the target
  when your code is on the classpath). Many build tools inject these automatically.
- `MethodHandles.privateLookupIn(Target.class, lookup)` also requires the target's module to
  open the package to the caller's module, or it throws `IllegalAccessException`.

## jlink and Custom Runtime Images

**Beginner.** `jlink` (JEP 282, Java 9) assembles a **custom, self-contained runtime
image** containing only the platform modules (and optionally your app modules) that are
actually needed. Result: a much smaller runtime (tens of MB instead of a full JDK) that
ships without requiring a pre-installed JRE — ideal for containers and desktop apps.

```bash
jlink --module-path "$JAVA_HOME/jmods:mods" \
      --add-modules com.acme.app \
      --launcher run=com.acme.app/com.acme.app.Main \
      --output myapp-runtime \
      --strip-debug --compress=2 --no-header-files --no-man-pages
# then:
./myapp-runtime/bin/run
```

**Intermediate / advanced.**

- `jlink` requires everything (your app + its transitive deps) to be **proper modules**.
  Automatic modules are **not** allowed as input to jlink — this is a strong incentive to
  fully modularize, and a real adoption blocker when dependencies aren't modular. (Tools
  like `jdeps --generate-module-info` and the Moditect/Gradle plugins help synthesize
  descriptors.)
- The image bakes in a specific module set; you cannot add modules at runtime that weren't
  linked in (no `--add-modules` of an absent module).
- Related tooling: **`jdeps`** analyzes dependencies and flags uses of internal/JDK APIs;
  **`jpackage`** (JEP 392, final in **JDK 16**) wraps a jlink image into a native
  installer/executable (`.dmg`, `.msi`, `.deb`).
- `--compress`, `--strip-debug`, and plugins let you trade size vs. debuggability; the
  `jdk.crypto.ec` / locale (`jdk.localedata`) modules are commonly forgotten and cause
  runtime failures (TLS handshake, locale) if omitted.

## Migration Strategies and Challenges

**Beginner.** You do **not** have to modularize to run on Java 9+. Existing apps run
unchanged on the classpath (as the unnamed module). Migration is incremental.

**Bottom-up vs top-down:**

- **Bottom-up**: modularize your lowest-level libraries first, once all *their*
  dependencies are modules. Clean but blocked if a leaf dependency isn't modular.
- **Top-down**: put your own app JAR on the module path (it becomes an *automatic module*
  or you write a module-info) while dependencies stay as automatic modules / on the
  classpath, then modularize inward over time. This is the pragmatic default.

**Common migration challenges (frequently asked):**

| Problem | Cause | Fix |
|---------|-------|-----|
| `InaccessibleObjectException` from a framework | Package not opened for reflection | `opens`, or `--add-opens` on the CLI |
| `package X is not visible` at compile | Missing `requires` or package not exported | Add `requires`/`exports` |
| **Split package** error | Same package in two modules (classic: JAXB, `javax.annotation` across JARs) | Merge JARs, use `--patch-module`, or exclude one |
| Removed Java EE / CORBA modules (JDK 11, JEP 320) | `java.xml.bind`, `java.activation`, `java.corba` etc. removed | Add the standalone Maven artifacts (Jakarta) |
| Automatic-module name clash | Two JARs derive the same name | Add `Automatic-Module-Name`, or rename |
| jlink refuses build | Non-modular dependency present | Modularize or generate module-info with `jdeps` |

**Advanced.**

- **`--patch-module M=dir/jar`** injects extra classes into an existing module — the modern
  replacement for the old boot-classpath override, used to resolve split packages or patch
  platform classes in tests.
- **JEP 396 (JDK 16): strong encapsulation of JDK internals by default**, and
  **JEP 403 (JDK 17): strongly encapsulate JDK internals** — after JDK 17 you can no longer
  reflectively access most JDK internals even with `--illegal-access`; you must use explicit
  `--add-opens`/`--add-exports`. This broke libraries relying on `Unsafe`-style hacks and is
  a major migration/upgrade consideration when moving to JDK 17+.

## Module Trade-offs and Uneven Adoption

**Beginner — why isn't everyone modular?** JPMS gives real benefits (encapsulation,
reliable config, jlink slimming, `sun.*` lockdown) but imposes real costs, and for most
server apps the payoff is modest relative to the friction.

**Trade-offs table:**

| Benefit | Cost / friction |
|---------|-----------------|
| Strong encapsulation of internals | Reflection frameworks need `opens`; brittle setup |
| Reliable configuration, fail-fast | All deps must be modules for full benefit; ecosystem lag |
| jlink small runtimes | jlink needs *fully* modular graph; automatic modules disqualify |
| Explicit dependencies documented in module-info | Duplicate info vs. Maven/Gradle; extra maintenance |
| Service binding integrated | Little gain over existing `ServiceLoader` for many |

**Why adoption is uneven (advanced discussion points):**

- **The JDK itself is modular and everyone benefits from that** (encapsulated internals,
  jlink) *without* their app being modular. So the marginal benefit of modularizing *your
  own* app is smaller than expected.
- **Ecosystem lag**: for years many popular libraries shipped no `module-info`, only
  `Automatic-Module-Name`, so you couldn't build a clean jlink image. This created a
  chicken-and-egg stall.
- **Reflection-heavy stacks** (Spring, Hibernate, Jackson) work fine on the classpath;
  going modular means auditing every `opens`. Spring Boot, for instance, largely runs on
  the classpath as a "fat jar" and does not require you to be modular.
- **Automatic modules leak encapsulation** and can't feed jlink, so partial migration often
  yields the costs without the top benefits.
- Alternatives (OSGi for dynamic modularity, plain fat JARs, containers for isolation)
  already solved adjacent problems for many teams.

**Where JPMS clearly wins**: the JDK maintainers themselves; desktop/client apps shipping a
bundled runtime via jlink+jpackage; libraries wanting to hide internals; large codebases
enforcing architectural boundaries at the build level.

## Reflection Encapsulation in Modern JDKs

This ties JPMS to the broader tightening of the platform.

- **Java 9–15**: illegal reflective access to JDK internals was *permitted with a warning*
  by default (`--illegal-access=permit` was the default). You'd see the famous
  "An illegal reflective access operation has occurred ... will be denied in a future
  release" warning.
- **JEP 396 (JDK 16)**: the default flipped to `--illegal-access=deny`. Reflective access
  to non-opened JDK internals now fails by default; you had to opt back in with
  `--illegal-access=permit`.
- **JEP 403 (JDK 17)**: `--illegal-access` is **removed entirely** — JDK internals are
  *strongly* encapsulated with no relaxation flag. Only explicit `--add-opens` /
  `--add-exports` for specific packages still work. This is why upgrading legacy apps to
  **JDK 17 LTS** frequently surfaces `InaccessibleObjectException` that JDK 8/11 tolerated.
- **Related but separate**: **`Unsafe` / `Cleaner`** users were pushed toward supported APIs
  (`java.lang.ref.Cleaner`, `VarHandle`, later the Foreign Function and Memory API — final
  in **JDK 22**, JEP 454). **The Security Manager was deprecated for removal in JDK 17
  (JEP 411)**, a parallel platform-hardening trend.

**Interview framing**: JPMS's encapsulation is the *reason* the "reflect into anything"
era ended. The practical rule for modern JDKs (17, 21 LTS): if a framework or your code
needs deep reflection into a module (yours or the JDK's), that access must be granted
explicitly — via `opens` in module-info, or `--add-opens`/`--add-exports` on the launch
command — because the permissive fallback no longer exists.

## Common interview follow-up questions

1. What is the difference between `exports` and `opens`, and when would you use one but not
   the other?
2. Explain readability vs. accessibility. Why does exporting a package not automatically let
   another module use it?
3. What is `requires transitive` and what real problem does implied readability solve? Give
   a JDK example.
4. Compare named, automatic, and unnamed modules. Why can't a named module `requires` the
   unnamed module, and why does that matter for migration?
5. A Jackson/Hibernate app throws `InaccessibleObjectException` after adding
   `module-info.java`. Diagnose and fix it.
6. Why can't `jlink` consume automatic modules, and how does that affect adoption?
7. What changed in JDK 16 (JEP 396) and JDK 17 (JEP 403) regarding reflective access to JDK
   internals? How does that affect upgrading a Java 8 app?
8. What is a split package and why is it illegal on the module path? How do you resolve one
   during migration?
9. How do `uses`/`provides` relate to `ServiceLoader`, and what does the `provider()` static
   method do?
10. Why has JPMS adoption been uneven despite shipping in 2017? What are the real trade-offs?
11. What do `--add-opens`, `--add-exports`, and `--add-reads` do, and when are they the right
    tool vs. editing module-info?
12. What is `requires static` used for, and what happens at runtime if the module is absent?

## References

- JEP 261: Module System — https://openjdk.org/jeps/261
- JEP 200: The Modular JDK — https://openjdk.org/jeps/200
- JEP 201: Modular Source Code — https://openjdk.org/jeps/201
- JEP 220: Modular Run-Time Images — https://openjdk.org/jeps/220
- JEP 260: Encapsulate Most Internal APIs — https://openjdk.org/jeps/260
- JEP 282: jlink — The Java Linker — https://openjdk.org/jeps/282
- JEP 320: Remove the Java EE and CORBA Modules (JDK 11) — https://openjdk.org/jeps/320
- JEP 396: Strongly Encapsulate JDK Internals by Default (JDK 16) — https://openjdk.org/jeps/396
- JEP 403: Strongly Encapsulate JDK Internals (JDK 17) — https://openjdk.org/jeps/403
- JEP 392: Packaging Tool / jpackage (JDK 16) — https://openjdk.org/jeps/392
- JEP 411: Deprecate the Security Manager for Removal (JDK 17) — https://openjdk.org/jeps/411
- "The State of the Module System" (Mark Reinhold) — https://openjdk.org/projects/jigsaw/spec/sotms/
- JLS Chapter 7.7 (Module Declarations) and `java.lang.module` / `ServiceLoader` Javadoc
- Project Jigsaw — https://openjdk.org/projects/jigsaw/
