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
The rule: **never deserialize data from an untrusted source with native Java
serialization.** JDK 9+ added `ObjectInputFilter` (JEP 290) to allow-list
classes and cap depth/array size; JDK 17 (JEP 415) added context-specific
filter factories. These mitigate but do not eliminate the risk.

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
