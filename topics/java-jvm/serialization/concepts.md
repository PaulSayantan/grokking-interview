# Serialization and Deserialization

Serialization is the process of converting an in-memory object graph into a
byte stream (or text) that can be persisted to disk, cached, or sent across a
network. Deserialization is the reverse: reconstructing the object graph from
that representation. In Java the term historically refers to the *native* JVM
mechanism built around `java.io.Serializable`, but modern applications almost
always mean **JSON serialization** (Jackson/Gson) or a schema-based binary
format (Protocol Buffers, Avro, Thrift).

This topic covers native Java serialization and *why it is now discouraged*,
the `Externalizable` alternative, JSON with Jackson as the modern default, how
records interact with serialization, versioning/compatibility rules, and
schema-based alternatives such as protobuf.

---

## Native Java serialization basics

**Beginner definition.** A class opts into native serialization by implementing
the marker interface `java.io.Serializable` (it has no methods). You then use
`ObjectOutputStream.writeObject(obj)` to produce bytes and
`ObjectInputStream.readObject()` to read them back.

```java
class Point implements java.io.Serializable {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
}

// Write
try (var out = new ObjectOutputStream(new FileOutputStream("p.ser"))) {
    out.writeObject(new Point(3, 4));
}
// Read
try (var in = new ObjectInputStream(new FileInputStream("p.ser"))) {
    Point p = (Point) in.readObject();   // returns Object; cast required
}
```

**Why it exists.** It offers a zero-config way to persist and transmit an
entire object graph, including cyclic references and shared references, while
preserving identity within a single stream (the same object written twice is
stored once via a *back-reference* / handle table).

**Worked example — shared reference preserved.** Suppose two `Team` objects
point at the *same* `Coach` instance, and we write a list `[teamA, teamB]`:

```java
Coach c = new Coach("Sam");
Team a = new Team("Red",  c);
Team b = new Team("Blue", c);   // same c
out.writeObject(List.of(a, b));
```

As `ObjectOutputStream` walks the graph it assigns each new object a handle and
records it in a table:

| Step | Object written | Handle assigned | Bytes emitted |
|---|---|---|---|
| 1 | `teamA`   | `0x7E0000` | full object data |
| 2 | `coach c` (via teamA) | `0x7E0001` | full object data |
| 3 | `teamB`   | `0x7E0002` | full object data |
| 4 | `coach c` (via teamB) | — already seen — | just a **reference** to `0x7E0001` |

On read, step 4 resolves the handle back to the single already-reconstructed
`Coach`, so `deserialized.get(0).coach == deserialized.get(1).coach` is
**`true`** — identity is preserved, and only one `Coach` is allocated. The same
handle mechanism is what lets a *cyclic* graph (A→B→A) deserialize without
infinite recursion: A's handle is recorded before B is written, so B's link
back to A becomes a handle reference, not a re-serialization. (Keep this in mind
for the JSON section below — JSON has no handle table, so it cannot do this.)

**Key rules and gotchas:**

- `writeObject` throws `NotSerializableException` at runtime (not compile time)
  if any reachable non-transient field's class is not `Serializable`. The
  marker interface is checked dynamically.
- All fields are serialized *transitively*: every non-`transient`, non-`static`
  reachable object must itself be serializable.
- `static` fields are **not** serialized — they belong to the class, not the
  instance. `transient` fields are also skipped and come back as defaults
  (`0`, `false`, `null`).
- The no-arg constructor of a `Serializable` class is **not** called during
  deserialization; the object is allocated without running any constructor.
  (For `Externalizable`, the public no-arg constructor *is* called.)
- Deserialization does not run field initializers or instance initializer
  blocks for the serializable class.
- Constructors of the first **non-serializable** superclass *are* invoked; that
  superclass must have an accessible no-arg constructor or deserialization
  throws `InvalidClassException`.

---

## serialVersionUID and class versioning

**Beginner definition.** `serialVersionUID` is a `private static final long`
that acts as a version fingerprint for a serializable class. During
deserialization the JVM compares the UID in the stream against the UID of the
loaded class. A mismatch throws `InvalidClassException`.

```java
class User implements Serializable {
    private static final long serialVersionUID = 1L;
    private String name;
}
```

**Why declare it explicitly.** If you do *not* declare it, the compiler/runtime
computes one implicitly from the class structure (name, fields, methods,
interfaces) using a SHA-based hash. That implicit value is **fragile**: adding
a method, changing a modifier, or even compiling with a different javac version
can change it, breaking deserialization of previously written data. Explicitly
declaring `serialVersionUID` gives you control over compatibility.

**Compatible vs incompatible changes** (per the Java Object Serialization
Spec):

| Change | Compatible? |
|---|---|
| Adding a field | Compatible (missing field on read gets default) |
| Removing a field | Compatible (extra field in stream ignored) |
| Adding a class to the hierarchy | Compatible |
| Changing a field's declared type | **Incompatible** |
| Changing non-static to static, or non-transient to transient | **Incompatible** (equivalent to deletion) |
| Changing the class hierarchy / moving a class up or down | **Incompatible** |
| Changing a field's access modifier (public/private/etc.) | Compatible |

If you keep the same `serialVersionUID` across a *compatible* change, old bytes
still deserialize; new fields absent from old streams get default values.

**Worked example — evolve a class, read old bytes.** Serialize a v1 object, add
a field in v2, then read the *old* bytes back:

```java
// v1 — write this to users.ser
class User implements Serializable {
    private static final long serialVersionUID = 1L;
    private String name;                 // "Ada"
}
// ... later, v2 of the SAME class (UID kept at 1L) ...
class User implements Serializable {
    private static final long serialVersionUID = 1L;
    private String name;
    private String email;                // NEW field
}
```

Trace of reading the v1 bytes with the v2 class:

1. `ObjectInputStream` reads the stream UID `1L`, compares it to the loaded
   class UID `1L` → match, so deserialization proceeds.
2. The stream supplies `name = "Ada"` → assigned.
3. The stream has **no** `email` field. Adding a field is a *compatible*
   change, so `email` is simply left at its default → `null`.

Result: `user.name` is `"Ada"`, `user.email` is `null`. No exception.

Now the failure case — the SAME edit but with `serialVersionUID` **not**
declared. The runtime computes it from class structure (a SHA hash of fields +
methods). v1's implicit UID is derived from `{name}`; v2's from `{name, email}`,
so the two hashes differ. Reading v1 bytes with the v2 class now throws:

```
java.io.InvalidClassException: User; local class incompatible:
  stream classdesc serialVersionUID = 7854123... ,
  local class serialVersionUID = -3092811...
```

That mismatch — from a change the spec calls *compatible* — is exactly the
brittleness that declaring an explicit UID prevents.

---

## transient and custom writeObject and readObject

**transient.** Marks a field to be excluded from the default serialized form.
Use it for derived/cached values, non-serializable fields you can recompute, or
sensitive data (passwords, secret keys) you never want on disk or the wire.

**Custom serialization hooks.** A serializable class can define these
`private` methods (they are found reflectively, so signatures must match
exactly):

```java
private void writeObject(ObjectOutputStream out) throws IOException {
    out.defaultWriteObject();          // writes the non-transient fields
    out.writeInt(derivedCount);        // custom extra data
}
private void readObject(ObjectInputStream in)
        throws IOException, ClassNotFoundException {
    in.defaultReadObject();            // reads the non-transient fields
    this.derivedCount = in.readInt();
    validate();                        // re-establish invariants
}
```

Other hooks:

- `writeReplace()` — returns an alternative object to serialize in place of
  `this` (e.g., a compact serialization proxy). Can be `private` and is found
  via inheritance.
- `readResolve()` — returns the object that replaces the freshly deserialized
  one. **Essential for class-based singletons** to preserve the single-instance
  invariant, because deserialization otherwise creates a brand-new instance.
  Note that **enums do *not* rely on `readResolve`**: the JVM serializes an enum
  constant specially — by its `name()` only — and reconstructs it via
  `Enum.valueOf`, ignoring `writeObject`/`readObject`/`readResolve` entirely.
  The single-instance guarantee therefore comes for free, which is exactly why
  *Effective Java* (Items 3 and 89) recommends the enum singleton over a
  class-plus-`readResolve` idiom.
- `readObjectNoData()` — called when the stream lacks data for a superclass
  (e.g., receiver added a superclass the sender didn't have).
- `ObjectInputValidation` + `registerValidation` — post-deserialization
  validation callbacks.

**Gotcha:** `transient` fields are *not* restored by `defaultReadObject()`;
if a class needs them you must handle them in a custom `readObject`, otherwise
they stay at default values. Also, a `final` transient field cannot be assigned
in `readObject` (you would need a serialization proxy instead).

---

## Why native serialization is discouraged

This is the single most important interview theme. Even Java's own architects
(Brian Goetz has called it a "horrible mistake") recommend avoiding it.

**1. Security — deserialization of untrusted data is dangerous.**
`readObject` can execute code from arbitrary classes on the classpath during
deserialization (via `readObject`/`readResolve`/finalizers). Attackers craft
*gadget chains* (e.g., from Apache Commons Collections) that lead to remote
code execution, DoS (billion-laughs style nested objects), or resource
exhaustion. This class of bug (CWE-502) has produced many high-severity CVEs.

**Walk through the attack (the classic interview question).** The key insight:
`ObjectInputStream` reconstructs *whatever classes the byte stream names* — the
stream, not your code, decides which classes get instantiated and which
`readObject`/`hashCode`/`equals` methods run.

1. **The stream drives class selection.** Each object in the stream carries a
   class descriptor. `ObjectInputStream` loads that class and, if it defines a
   private `readObject`, calls it. You have no say over which classes appear —
   even if your call site is `in.readObject()` expecting a `User`, the attacker
   can put a `HashMap` (or anything else on the classpath) at the top of the
   stream, and it gets built first.
2. **A "gadget" is an already-present class whose deserialization does something
   useful to the attacker.** Nobody adds malicious code — the attacker reuses
   methods in libraries you already depend on. Apache Commons Collections'
   `InvokerTransformer` is the canonical one: given a method name and args, it
   reflectively invokes that method on any object handed to it.
3. **Chain the gadgets.** A crafted `HashMap` whose key is a
   `TiedMapEntry`/`LazyMap` wrapping a `ChainedTransformer` is the payload. When
   the `HashMap` deserializes it calls `hashCode()` on its key, which forces the
   lazy map to compute a value, which fires the transformer chain:
   `Class.forName("java.lang.Runtime")` → `getMethod("getRuntime")` →
   `invoke(...)` → `exec("calc.exe")`. The victim never called any of this — it
   all fell out of `readObject`.
4. **Why a fixed target type does NOT save you.** `mapper.readValue(json,
   User.class)` (Jackson data-binding) is safe because the parser only ever
   populates a `User`. But `ObjectInputStream.readObject()` *ignores* your
   intended type — the cast to `User` happens only *after* the whole malicious
   graph has already been built and its gadget methods have already run. By the
   time you'd get a `ClassCastException`, the command has executed.

**Mitigation — `ObjectInputFilter` (JEP 290):**

```java
var in = new ObjectInputStream(bytes);
in.setObjectInputFilter(ObjectInputFilter.Config.createFilter(
    "com.myapp.dto.*;java.base/*;!*"));   // allow my DTOs + JDK base, reject all else
```

The filter runs *before* each class is resolved, so a rejected class never gets
instantiated (no gadget fires). You can also cap `maxdepth`, `maxarray`, and
`maxrefs` to stop billion-laughs DoS payloads.

**Its limits:** an allow-list is only as good as the list — if a gadget class is
inside an allowed package, it still fires. And any legitimately *polymorphic*
entry point (a field typed `Object`, or default-typing in Jackson) reopens the
hole because you cannot enumerate safe classes in advance. Filters mitigate;
they do not eliminate. The real rule: **never deserialize data from an untrusted
source with native Java serialization.** JDK 17 (JEP 415) added context-specific
filter factories for per-stream policies, but the guidance is unchanged.

> [!INTERVIEW]
> If asked "but I only ever read a `User`, why am I exposed?" — the answer that
> lands is: `ObjectInputStream` builds the graph the *bytes* describe and runs
> gadget code *during* construction; your declared type is checked only after,
> too late. That is the distinction from Jackson's `readValue(json, User.class)`.

**2. Brittleness / maintenance burden.** The serialized form becomes part of
your public API. Private field names and types leak into the wire format, so
refactoring can silently break compatibility. Managing `serialVersionUID` and
compatible-change rules is error-prone.

**3. Poor performance and no cross-language support.** The binary format is
Java-only, verbose (it embeds class descriptors), and slower than modern
binary codecs.

**4. Bypasses constructors and invariants.** Because no constructor runs,
deserialization can create objects in states that constructors would normally
forbid — unless you re-validate in `readObject` or use a proxy.

**Modern guidance (Effective Java, Item 85):** *"There is no reason to use Java
serialization in any new system you write."* Prefer cross-platform structured
data formats (JSON, protobuf). If you must use native serialization for legacy
reasons, never deserialize untrusted bytes and use serialization filters.

---

## Externalizable

`java.io.Externalizable` extends `Serializable` and gives the class **full
manual control** over its wire format via two public methods:

```java
public class Coord implements Externalizable {
    private int x, y;
    public Coord() {}                       // MANDATORY public no-arg ctor
    public void writeExternal(ObjectOutput out) throws IOException {
        out.writeInt(x); out.writeInt(y);
    }
    public void readExternal(ObjectInput in) throws IOException {
        x = in.readInt(); y = in.readInt();
    }
}
```

**Key differences vs Serializable:**

| Aspect | Serializable | Externalizable |
|---|---|---|
| Fields written | Default mechanism handles all non-transient fields | You write everything by hand |
| No-arg constructor on read | Not called (object allocated raw) | **Public no-arg constructor IS called**, then `readExternal` populates it |
| `transient` keyword | Honored | Irrelevant — you choose what to write |
| Control / performance | Less control | More control, potentially faster/compact |
| Risk | Boilerplate but automatic | Easy to get field order wrong then corrupt data |

**Gotcha:** Externalizable requires a public (or accessible) no-arg
constructor; if missing you get `InvalidClassException` at deserialization.
Because you control the bytes fully, it can be faster and smaller, but you own
all versioning by hand. In practice Externalizable is rarely worth it versus
just moving to JSON/protobuf.

---

## JSON serialization with Jackson

**The modern default.** For services, APIs, and config, JSON (via Jackson or
Gson) has replaced native serialization. JSON is human-readable,
cross-language, schema-flexible, and does not execute arbitrary code on read.

**Jackson `ObjectMapper` basics:**

```java
ObjectMapper mapper = new ObjectMapper();
String json = mapper.writeValueAsString(user);      // serialize
User u = mapper.readValue(json, User.class);         // deserialize
```

**How Jackson binds data (no Serializable needed):**

- By default it uses public getters/setters and public fields; it does **not**
  require `implements Serializable`.
- Deserialization normally needs a **no-arg constructor** (or a constructor
  annotated for property binding) plus setters, unless you use
  `@JsonCreator`/`@JsonProperty` on a constructor.
- Common annotations: `@JsonIgnore`, `@JsonProperty("name")`,
  `@JsonInclude(Include.NON_NULL)`, `@JsonCreator`, `@JsonIgnoreProperties`,
  `@JsonFormat` (dates), `@JsonSubTypes`/`@JsonTypeInfo` (polymorphism).
- `FAIL_ON_UNKNOWN_PROPERTIES` (on by default) throws when the JSON has a field
  the target class lacks — often disabled for forward compatibility.
- Java 8 `java.time` types need the `jackson-datatype-jsr310` module
  (`registerModule(new JavaTimeModule())`); `Optional`/`OptionalInt` need
  `jackson-datatype-jdk8`.

**Security note.** Jackson had polymorphic-deserialization CVEs when *default
typing* (`enableDefaultTyping`) is enabled with untrusted input — this embeds
Java class names in JSON and can invoke gadget classes. Keep default typing off
or use `activateDefaultTyping` with a validating `PolymorphicTypeValidator`.
Plain data-binding to a fixed target class is safe.

**Versioning with JSON** is far more forgiving than native: unknown fields can
be ignored, missing fields default, and field renames are handled with
`@JsonProperty` or `@JsonAlias`.

**Gotcha — JSON has no object-identity or cycle model.** Recall that native
serialization's handle table let a shared/cyclic graph round-trip cleanly. JSON
is a plain tree: there is no back-reference, so a **bidirectional relationship
blows up**. Take a `Parent` with a `List<Child>` and each `Child` with a
`parent` back-pointer:

```java
class Parent { List<Child> children; }
class Child  { Parent parent; }   // points back to its Parent
```

Serializing the parent, Jackson recurses `parent → children[0] → parent →
children[0] → parent → …` and never terminates → `StackOverflowError` (wrapped
as `JsonMappingException: Infinite recursion`). This is a classic "we migrated
JPA entities from native serialization to JSON and everything broke" bug.

Fixes:

- `@JsonManagedReference` on the forward side (`children`) +
  `@JsonBackReference` on the back side (`parent`) — the back side is simply
  omitted from output and re-linked on read.
- `@JsonIdentityInfo(...)` — emits an `@id` for each object and a numeric
  reference on repeats, re-introducing an identity/handle model on top of JSON
  (the closest analogue to the native back-reference table).

Related gotcha — **"ghost" properties from getters.** Jackson infers a property
from any public `getXxx()`, not just fields. A `boolean isAdmin()` or a computed
`getFullName()` will appear in the JSON even though there is no such field; use
`@JsonIgnore` to suppress it. For safe polymorphism, prefer explicit
`@JsonTypeInfo` + `@JsonSubTypes` (a closed set of named subtypes) over the
class-name-embedding *default typing* that caused the CVEs above.

---

## Records and serialization

**Since Java 16 (records final, JEP 395).** Records can implement
`Serializable`, and the JVM treats them specially and *more safely* than
ordinary classes.

**How record serialization differs:**

- The serialized form of a record is derived solely from its **record
  components** (the state description), not from arbitrary field reflection.
- **Deserialization goes through the canonical constructor.** Unlike normal
  classes, a serialized record is reconstructed by invoking the canonical
  constructor with the component values from the stream. This means your
  compact-constructor **validation runs**, so you cannot deserialize a record
  into an invalid state — a major security improvement over classic
  serialization.
- For records, the custom hooks `writeObject`, `readObject`, and
  `readObjectNoData` are ignored for controlling field state, because state
  must flow through the canonical constructor. `serialVersionUID` defaults to
  `0L` for records if not declared, and the requirement for *matching* UID
  values is **waived** for record classes (per the serialization spec), so a
  UID mismatch does not block deserialization the way it does for ordinary
  classes.
- Records cannot use a serialization proxy in the traditional
  `readObject`-based way, but the canonical-constructor path already provides
  the validation that proxies were invented to give.

```java
public record Range(int lo, int hi) implements Serializable {
    public Range {                                  // compact constructor
        if (lo > hi) throw new IllegalArgumentException("lo > hi");
    }
}
// Tampered bytes with lo>hi will throw in the canonical constructor on read.
```

Jackson also supports records (Jackson 2.12+ auto-detects record components and
uses the canonical constructor), so records are a great fit for DTOs.

---

## Serialization proxy pattern

**Effective Java Item 90.** For non-record classes with complex invariants, the
*serialization proxy pattern* is the recommended safe idiom: serialize a small
private static nested class that holds the logical state, and reconstruct the
real object through its public API.

```java
class Period implements Serializable {
    private final Date start, end;
    // ...
    private Object writeReplace() { return new SerializationProxy(this); }
    private void readObject(ObjectInputStream in) throws InvalidObjectException {
        throw new InvalidObjectException("Proxy required");   // block direct
    }
    private static class SerializationProxy implements Serializable {
        private static final long serialVersionUID = 1L;
        private final Date start, end;
        SerializationProxy(Period p) { this.start = p.start; this.end = p.end; }
        private Object readResolve() { return new Period(start, end); } // ctor runs
    }
}
```

The round-trip: `writeReplace` swaps the real object for the proxy on the way
out, and `readResolve` rebuilds the real object *through its constructor* on the
way in — so the direct `readObject` path is never taken:

```
WRITE:  Period ──writeReplace()──▶ SerializationProxy ──▶ bytes
READ:   bytes ──▶ SerializationProxy ──readResolve()──▶ new Period(start,end)
                                                          (constructor + validation run)
```

Benefits: constructors/validation run on read (no invariant bypass), `final`
fields work, and attackers cannot fabricate an invalid object graph. Records
achieve the same guarantee automatically.

---

## Alternatives such as protobuf and Avro

**Why look beyond both native and JSON.** For high-throughput, cross-language,
schema-evolving systems, schema-based binary formats win on size, speed, and
controlled versioning.

**Protocol Buffers (protobuf):**

- Define a schema in a `.proto` file; a compiler generates typed classes for
  many languages. Wire format is compact binary using tag numbers.
- **Versioning by field number:** each field has a stable numeric tag. You add
  fields with new numbers (forward/backward compatible), and you must **never
  reuse or change a field's number**. Unknown fields are preserved/ignored.
  `required` was removed in proto3; all scalar fields are effectively optional.
- No arbitrary code execution on parse then far safer than native
  serialization.
- Trade-off: not human-readable, needs the schema and codegen build step.

**Apache Avro:**

- Schema is defined in JSON. The distinctive feature is **schema-on-read with
  writer/reader schema resolution**: the schema that *wrote* the data and the
  schema the *reader* expects are both known, and Avro resolves differences
  (added fields with defaults, dropped fields, reordered fields) at read time.
- **No per-field tag numbers** — fields are matched by name during resolution,
  unlike protobuf's stable numeric tags. This makes the *schema itself* the
  contract, so the writer schema must travel with the data or be fetched.
- In practice the schema lives in a **schema registry** (e.g., Confluent Schema
  Registry). Each Kafka message carries a small schema ID; consumers fetch the
  writer schema by ID and resolve against their reader schema. This is why Avro
  dominates Kafka/big-data pipelines: millions of records need not each embed a
  full schema, yet schemas can still evolve independently per producer/consumer.

**Reasoned protobuf-vs-Avro trade-off:** reach for **protobuf** when you have
RPC/gRPC service contracts with generated stubs and want a compact wire format
whose compatibility is guaranteed by immutable field numbers — the schema is
baked into codegen on both sides. Reach for **Avro** when you have data *at
rest* or streaming (Kafka, Hadoop, data lakes) where schemas evolve often and
producers/consumers deploy independently — the registry + writer/reader
resolution lets a new producer schema flow to old consumers without a lockstep
redeploy. Rough rule: protobuf for *messages between services*, Avro for
*records in a pipeline*.

**Comparison table:**

| Format | Human-readable | Cross-language | Schema | RCE risk on untrusted input | Typical use |
|---|---|---|---|---|---|
| Native Java serialization | No | No (Java only) | Implicit in class | **High** (gadget chains) | Legacy/RMI only |
| JSON (Jackson) | Yes | Yes | Optional/loose | Low (unless default typing on) | REST APIs, config, DTOs |
| Protocol Buffers | No | Yes | `.proto`, explicit | Low | gRPC, high-perf internal RPC |
| Avro | No | Yes | JSON schema, dynamic | Low | Big-data / Kafka, schema registry |

**Rule of thumb:** JSON for external/human-facing APIs and config; protobuf/Avro
for high-volume internal service-to-service or streaming pipelines; native Java
serialization for essentially nothing new.

---

## Common interview follow-up questions

- Why is `serialVersionUID` important, and what happens if you omit it?
- Walk through a Java deserialization RCE attack. How does `ObjectInputFilter`
  (JEP 290) mitigate it? What are its limits?
- Are `static` and `transient` fields serialized? What values do they hold
  after deserialization?
- Does the constructor run during deserialization? For `Serializable`? For
  `Externalizable`? For a record?
- How do records change the safety story of serialization?
- Difference between `writeReplace`/`readResolve` and why *class-based*
  singletons rely on `readResolve` — while enums do not (they serialize by name
  and get the single-instance guarantee for free).
- When would you choose `Externalizable` over `Serializable`? Is it worth it?
- How does Jackson deserialize without `Serializable`? What does it need
  (constructor, setters, annotations)?
- Explain protobuf field numbers and the rules for evolving a schema
  compatibly.
- Why does `Effective Java` say to prefer alternatives to Java serialization?

## References

- Java Object Serialization Specification (Oracle) — versioning, `readObject`,
  `writeReplace`/`readResolve`, `Externalizable`.
- JEP 290: Filter Incoming Serialization Data (JDK 9).
- JEP 415: Context-Specific Deserialization Filters (JDK 17).
- JEP 395: Records (final in JDK 16) — record serialization semantics.
- *Effective Java, 3rd Ed.* — Items 85 (prefer alternatives), 86 (implement
  Serializable with care), 87 (custom serialized form), 88 (`readObject`
  defensively), 89 (`readResolve`/enum), 90 (serialization proxy).
- Jackson documentation (`ObjectMapper`, annotations, JSR-310 module).
- Protocol Buffers Language Guide (proto3) — field numbers and compatibility.
- CWE-502: Deserialization of Untrusted Data.
