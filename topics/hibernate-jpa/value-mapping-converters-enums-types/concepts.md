# Value Mapping: Converters, Enums, Temporal & Custom Types

Most JPA teaching focuses on *associations* (`@ManyToOne`, `@OneToMany`) and *identity*
(`@Id`). But a huge share of real-world mapping bugs live in the humble **value/basic
mappings** — how a single Java field becomes a single database column. This topic covers
the machinery Hibernate uses to convert between a Java attribute type and a JDBC column:
`@Enumerated`, `AttributeConverter`/`@Convert`, `@Temporal` vs `java.time`, `@Lob`,
Hibernate 6's rebuilt `JavaType`/`JdbcType` type system, `@JdbcTypeCode` (including
JSON), and `@Column` precision/scale for money.

Everything here is grounded in **Jakarta Persistence 3.1/3.2** (the `jakarta.persistence.*`
namespace — the legacy `javax.persistence.*` was renamed in Jakarta EE 9) and
**Hibernate ORM 6.x/7.x**. Hibernate 6 rewrote the type system, so several answers differ
from Hibernate 5 and older StackOverflow advice.

> [!KEY-TAKEAWAY]
> A "basic" attribute is one whose value maps to a single column via a converter — no
> association, no FK. The two levers are: **which Java type** you use (an enum, a
> `java.time` type, a `BigDecimal`) and **how it is converted** to a JDBC type (the
> `@Enumerated` mode, an `AttributeConverter`, a `@JdbcTypeCode`). Choosing the fragile
> option (`EnumType.ORDINAL`, `java.util.Date`, no scale on money) creates the classic
> production bugs.

For DB-level concerns this topic deliberately defers to other domains: money storage and
`JSONB` column mechanics → `messaging-databases`; the Spring repository/`@Transactional`
layer → `spring-boot`/`spring-core`. Here we stay at the ORM conversion altitude.

---

## What a Basic (Value) Mapping Is

JPA classifies every persistent attribute of an entity into one of a few categories:

- **Basic** — a single value mapped to a single column (a `String`, number, boolean,
  enum, `java.time` value, `byte[]`, or anything an `AttributeConverter` can flatten).
  Governed by `@Basic` (implicit on every non-association field) and `@Column`.
- **Embedded** — a composite value (`@Embedded` / `@Embeddable`), covered in
  `hibernate-jpa/inheritance-embeddables-composite-keys`.
- **Association** — a reference to another entity (`@ManyToOne`, `@OneToMany`, …),
  covered in `hibernate-jpa/entity-mappings-associations`.

A basic attribute needs a **round-trip converter**: Java value → JDBC bind parameter on
write, JDBC column value → Java value on read. Hibernate resolves that converter from the
attribute's Java type, any `@Enumerated`/`@Temporal`/`@Lob`/`@Convert`/`@JdbcTypeCode`
annotation, and its registry of built-in type descriptors.

Mechanically, in **Hibernate 6+** every basic attribute is described by a pair:

- a **`JavaType<T>`** — the Java-side descriptor (how to instantiate, compare, and
  represent the value, e.g. `String`, `BigDecimal`, `MyEnum`), and
- a **`JdbcType`** — the JDBC-side descriptor (which `java.sql.Types` code and which
  `PreparedStatement.setXxx`/`ResultSet.getXxx` to use, e.g. `VARCHAR`, `NUMERIC`,
  `TIMESTAMP`).

This `JavaType`/`JdbcType` split *replaced* the old monolithic `org.hibernate.type.Type`
and the legacy `UserType`/`@Type(type="...")` string-based mapping used in Hibernate 5.

> [!TIP]
> When an interviewer asks "how does Hibernate turn a `Money` field into a column?", the
> senior answer names the two descriptors: a `JavaType` for the Java representation and a
> `JdbcType` for the SQL binding, optionally bridged by an `AttributeConverter`.

---

## @Enumerated: STRING vs ORDINAL

Java enums have **no** default persistent representation, so JPA makes you choose one with
`@Enumerated(EnumType.STRING)` or `@Enumerated(EnumType.ORDINAL)`.

| Mode | Stored value | Column type | Reorder-safe? | Readable in DB? |
|---|---|---|---|---|
| `ORDINAL` | `Enum.ordinal()` — the 0-based position | integer | **No** | No (just a number) |
| `STRING` | `Enum.name()` — the constant's name | varchar | **Yes** | Yes |

The gotcha every interview probes: **the default is `ORDINAL`**. If you write
`@Enumerated` with no argument, or omit the annotation entirely on an enum field, JPA
stores the ordinal.

```java
enum Status { NEW, PAID, SHIPPED, CANCELLED }   // NEW=0, PAID=1, SHIPPED=2, CANCELLED=3

@Enumerated(EnumType.ORDINAL)   // stores 0/1/2/3
Status status;
```

`INSERT` binds `2` for `SHIPPED`. Now a later developer alphabetizes or inserts a value:

```java
enum Status { CANCELLED, NEW, PAID, REFUNDED, SHIPPED }  // positions all shifted
```

Every existing row now decodes to the **wrong** constant — `2` was `SHIPPED`, now it is
`PAID`. There is no error; the data is silently corrupted. This is *the* classic
`EnumType.ORDINAL` bug.

`EnumType.STRING` stores `'SHIPPED'`, which is stable under reordering and readable in raw
SQL. Its cost: more bytes, and renaming a constant breaks decoding (a rename is a schema
migration you must plan for). For virtually all business enums, **`STRING` is the correct
default**.

> [!WARNING]
> `EnumType.ORDINAL` couples your stored data to *source-code declaration order*. Reorder
> or insert a constant and every persisted ordinal now points at a different value —
> silent corruption, no exception. Prefer `EnumType.STRING`; if you must use ORDINAL for
> space, treat the enum order as an immutable schema and only ever *append*.

To store a custom code (e.g. `'A'`/`'I'` instead of the name), don't overload
`@Enumerated` — use an `AttributeConverter<MyEnum, String>` (below). Hibernate 6 also lets
you map an enum to a native DB `ENUM`/`CHECK` column via `@JdbcTypeCode`, but the
converter approach is the portable standard.

---

## AttributeConverter and @Convert

`AttributeConverter<X, Y>` is the **standard JPA** (2.1+/Jakarta) extension point for
mapping an arbitrary attribute type `X` to a supported JDBC type `Y` and back. It replaces
most legacy Hibernate `UserType` use for simple single-column conversions.

```java
@Converter(autoApply = true)
public class BooleanToYesNoConverter implements AttributeConverter<Boolean, String> {

    @Override
    public String convertToDatabaseColumn(Boolean attribute) {   // Java -> DB
        if (attribute == null) return null;
        return attribute ? "Y" : "N";
    }

    @Override
    public Boolean convertToEntityAttribute(String dbData) {     // DB -> Java
        if (dbData == null) return null;
        return "Y".equals(dbData);
    }
}
```

Apply it in one of two ways:

- **Per attribute:** `@Convert(converter = BooleanToYesNoConverter.class)` on the field.
- **Globally:** `@Converter(autoApply = true)` — Hibernate applies it to *every* basic
  attribute of type `Boolean` in the whole persistence unit, no `@Convert` needed.

Common uses: `Boolean` → `'Y'`/`'N'`, a value object like `Money`/`EmailAddress` → a
single column, at-rest encryption (encrypt in `convertToDatabaseColumn`), enum → custom
code, and serializing a small object to a JSON string. On write Hibernate calls
`convertToDatabaseColumn` and binds the result; on read it calls `convertToEntityAttribute`
with the raw column value.

**Mechanism / gotchas:**

- Converters run on the *value* Hibernate is about to bind or has just read. They see
  every persist, update, and query-result materialization.
- Both methods must handle `null` — Hibernate may pass `null` for a nullable column.
- **JPQL/Criteria awareness:** you query and compare using the *entity attribute* type;
  Hibernate applies the converter to literals and parameters. But a converted column is
  opaque to functions Hibernate can't translate — e.g. you cannot reliably do a `LIKE`
  or range scan on the raw stored form through JPQL, and a converter that scrambles order
  (encryption, hashing) makes DB-side sorting/filtering meaningless.
- **Not allowed on:** `@Id` (before recent versions), version fields, associations, or
  attributes already annotated `@Enumerated`/`@Temporal` — those have their own mapping.
- Index/query performance is a real trade-off: `'Y'`/`'N'` and JSON strings are simple,
  but an encrypting converter defeats indexes and forces full scans. See
  `messaging-databases` for the DB-side indexing implications.

> [!TIP]
> `AttributeConverter` is the portable, spec-standard tool. Reach for a Hibernate-specific
> `UserType` only when you need multi-column mapping or custom dirty-checking that a
> single-column converter can't express.

---

## Temporal vs Java Time (the Modern Default)

**Legacy path — `java.util.Date`/`java.util.Calendar`.** These types carry both a date and
a time, so JPA can't know which SQL type you want. `@Temporal` disambiguates:

```java
@Temporal(TemporalType.DATE)       Date birthDate;      // -> SQL DATE (no time)
@Temporal(TemporalType.TIME)       Date openingTime;    // -> SQL TIME (no date)
@Temporal(TemporalType.TIMESTAMP)  Date createdAt;      // -> SQL TIMESTAMP
```

For `java.util.Date`/`Calendar`, `@Temporal` is **mandatory** — omit it and the provider
raises a mapping error. The `TemporalType` chooses whether Hibernate truncates to a date,
a time, or keeps the full timestamp.

**Modern path — `java.time`.** Since **JPA 2.2** (and fully in Jakarta Persistence) the
`java.time` types are **natively supported basic types and need no `@Temporal`**:

| Java type | Maps to | Notes |
|---|---|---|
| `LocalDate` | `DATE` | date only |
| `LocalTime` | `TIME` | time only |
| `LocalDateTime` | `TIMESTAMP` | wall-clock, no zone |
| `Instant` | `TIMESTAMP` (UTC) | a point on the timeline |
| `OffsetDateTime` | `TIMESTAMP WITH TIME ZONE` | keeps offset |
| `ZonedDateTime` | `TIMESTAMP WITH TIME ZONE` | zone handling is provider-specific |

```java
LocalDate     birthDate;    // no @Temporal — the type already says "date"
Instant       createdAt;    // preferred for "an instant in time"
```

`java.time` types are **immutable and unambiguous**, which eliminates a whole class of
`Date` bugs (mutability aliasing, implicit time components, `Calendar` weirdness). They are
the recommended choice for all new code.

> [!WARNING]
> Applying `@Temporal` to a `java.time` type is at best redundant and, before it was
> relaxed, was rejected. Don't do it: the type already encodes date-vs-time. Reserve
> `@Temporal` for the legacy `java.util.Date`/`Calendar` types only.

**Time-zone gotcha.** How `Instant`/`OffsetDateTime` are stored depends on the JDBC driver
and Hibernate's `hibernate.timezone.default_storage` setting (`NORMALIZE`,
`NORMALIZE_UTC`, or `NATIVE`/`COLUMN`). If you store `LocalDateTime` you throw the zone
away; store `Instant` (or `TIMESTAMP WITH TIME ZONE`) when the moment matters across zones.
The underlying `TIMESTAMPTZ` semantics belong to `messaging-databases`.

---

## @Lob for CLOB and BLOB

`@Lob` tells the provider the attribute is a **Large OBject** so it maps to a
`CLOB`/`TEXT` (character) or `BLOB`/`BYTEA` (binary) column rather than a length-limited
`VARCHAR`/`VARBINARY`:

```java
@Lob String articleBody;    // long text  -> CLOB / TEXT
@Lob byte[] avatar;         // binary blob -> BLOB / BYTEA
```

- The **Java type** picks character vs binary: `String`/`char[]` → CLOB; `byte[]`/
  `Serializable` → BLOB.
- LOB columns are for content too big for a normal column; databases store them out of
  line and access can be streaming.

**Gotchas:**

- LOBs are **always effectively fetched with the row** unless you additionally mark the
  attribute for lazy basic fetching (`@Basic(fetch = LAZY)` + bytecode enhancement) — a
  plain `@Lob` field loads eagerly, so a `SELECT *` of many rows can pull megabytes.
- Some JDBC drivers stream LOBs and require an open connection/transaction to read them
  later — reading a LOB after the session closes can fail (a cousin of
  `LazyInitializationException`; see `hibernate-jpa/fetching-lazy-eager-n-plus-one`).
- On PostgreSQL specifically, `@Lob String` historically mapped to the `oid`/large-object
  API rather than `text`, which surprises people; many teams drop `@Lob` and use a plain
  `String` with `columnDefinition = "text"`, or `@JdbcTypeCode(SqlTypes.LONGVARCHAR)`.
  Check your dialect.

---

## Hibernate 6 Revamped Type System (JavaType JdbcType JdbcTypeCode)

Hibernate 6 replaced the old `org.hibernate.type.Type` hierarchy and the string-based
`@Type("...")` / `UserType` mechanism with a compositional model:

- **`JavaType<T>`** (`org.hibernate.type.descriptor.java`) — the Java-side descriptor:
  how to compare, copy, and render a value of type `T`.
- **`JdbcType`** (`org.hibernate.type.descriptor.jdbc`) — the JDBC-side descriptor: which
  `java.sql.Types` code and which `set/get` calls bind and extract the value.

A basic type = a `(JavaType, JdbcType)` pair. This is more flexible: you can keep the Java
representation but override just the JDBC side (or vice versa) without writing a full
custom type. The override annotations (all in `org.hibernate.annotations`):

| Annotation | Overrides | Example |
|---|---|---|
| `@JdbcTypeCode(int)` | the `JdbcType` via a `java.sql.Types`/`SqlTypes` code | `@JdbcTypeCode(SqlTypes.JSON)` |
| `@JdbcType(Class)` | the `JdbcType` descriptor directly | custom binder |
| `@JavaType(Class)` | the `JavaType` descriptor | custom Java rep |
| `@JavaTypeRegistration` / `@JdbcTypeRegistration` | register a descriptor globally | app-wide |
| `@Type(Class)` | a full Hibernate 6 `UserType` (note: takes a **Class**, not a string) | legacy-style |

The Hibernate-5 idiom `@org.hibernate.annotations.Type(type = "yes_no")` and string type
names are **gone** in Hibernate 6; that annotation now takes a `UserType` **class**. If
you're migrating a Hibernate-5 app, string `@Type`s must be rewritten as converters,
`@JdbcTypeCode`, or class-based `@Type`.

```java
// HB6: store a UUID as a native SQL uuid/binary rather than the driver default
@JdbcTypeCode(SqlTypes.CHAR)
UUID externalId;
```

> [!KEY-TAKEAWAY]
> Hibernate 6 = `JavaType` + `JdbcType` (composable descriptors) + `@JdbcTypeCode`.
> Hibernate 5 = monolithic `Type` + string `@Type("...")`/`UserType`. Naming this split
> is the fastest way to show an interviewer you know the current version, not 2015 advice.

---

## Mapping JSON Columns

Storing a JSON document in a column is a first-class scenario in Hibernate 6+. The clean,
version-current way uses the new type system:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(columnDefinition = "jsonb")     // PostgreSQL jsonb; json/clob elsewhere
private Map<String, Object> attributes;

@JdbcTypeCode(SqlTypes.JSON)
private ShippingDetails shippingDetails;   // any serializable POJO
```

Hibernate serializes the Java object to JSON on write (using Jackson if it's on the
classpath) and deserializes on read. `@JdbcTypeCode(SqlTypes.JSON)` maps to `jsonb`/`json`
on PostgreSQL, native JSON on MySQL, and falls back to a `CLOB`/`VARCHAR` of JSON text on
databases without a JSON type — that dialect selection is the point of the type code.

**Alternatives and history:**

- Pre-Hibernate-6, you used a third-party `UserType` (the well-known
  `hibernate-types`/`JsonType` library by Vlad Mihalcea, referenced as `@Type("jsonb")`).
  Hibernate 6 makes that library largely unnecessary for the common case.
- An `AttributeConverter<MyObject, String>` that calls Jackson also works and is fully
  portable, but stores JSON as plain text — you lose the DB's native JSON operators/
  indexing.

**Gotchas:** DB-side JSON *querying* (path operators, GIN indexes on `jsonb`) is a
database feature — see `messaging-databases`. Hibernate can bind/extract the JSON but does
not turn arbitrary JSON-path predicates into portable JPQL. Also, mapping a mutable
collection/`Map` to JSON works with dirty checking only because Hibernate deep-compares the
serialized form; very large JSON blobs make dirty checking and flush more expensive.

---

## @Basic, optional, and null handling

`@Basic` is the (usually implicit) annotation on every non-association attribute. It has
two attributes:

- **`optional`** (default `true`) — a *hint* that the value may be null. `optional = false`
  is a metadata/validation hint distinct from the DB-level `@Column(nullable = false)`,
  which drives the actual `NOT NULL` DDL constraint. Interviewers like to separate these:
  `@Basic(optional=false)` is about the *object model*; `@Column(nullable=false)` is about
  the *schema*.
- **`fetch`** (default `EAGER`) — basic attributes load eagerly by default.
  `@Basic(fetch = FetchType.LAZY)` requests lazy loading of a single column, which
  **only works with bytecode enhancement** enabled; without it the hint is ignored. It's
  mainly useful with `@Lob` to avoid pulling a big column on every read.

```java
@Basic(optional = false, fetch = FetchType.LAZY)
@Lob String hugeReport;
```

Primitive-vs-wrapper matters for nullability: a primitive `int` cannot represent SQL
`NULL` and will throw on a null read; use `Integer` for nullable numeric columns.

---

## @Column precision and scale for BigDecimal money

Money must be `BigDecimal`, never `double`/`float` — binary floating point cannot
represent decimal fractions exactly (`0.1 + 0.2 != 0.3`), so `double` money silently
accumulates rounding error. `BigDecimal` maps to SQL `NUMERIC`/`DECIMAL`, whose size you
control with `@Column`:

```java
@Column(precision = 19, scale = 4)   // NUMERIC(19,4): 15 integer digits, 4 fractional
private BigDecimal amount;
```

- **`precision`** = total number of significant digits.
- **`scale`** = digits after the decimal point.
- These attributes affect **only DDL generation** (the `NUMERIC(p,s)` in the `CREATE
  TABLE`); if the schema already exists, they don't retroactively change the column. But
  they *do* matter for rounding: the DB rounds/rejects values exceeding the declared scale.
- Leaving them off lets Hibernate emit a dialect default (often `NUMERIC(19,2)` or an
  unbounded/large default) — rarely what you want for money.

> [!WARNING]
> `double`/`float` for money is a correctness bug, not a style choice. Use `BigDecimal`
> with an explicit `@Column(precision, scale)`, and store amounts in a consistent currency/
> unit. The deeper DB-side money-storage discussion (minor units, `NUMERIC` vs integer
> cents) lives in `messaging-databases`.

---

## Common Interview Follow-ups

- **"What's the default for `@Enumerated`?"** `EnumType.ORDINAL`. Explain why that's a
  trap and that you'd always specify `STRING` for business enums.
- **"You reordered an enum and prod data looks wrong — why?"** ORDINAL stored positions;
  reordering shifted every mapping. Fix: migrate to STRING (backfill the name column) and
  never reorder ordinal enums.
- **"How do you map a `Boolean` to `'Y'`/`'N'`?"** `AttributeConverter<Boolean,String>`,
  optionally `@Converter(autoApply=true)`. Name the two methods and null handling.
- **"Do you still need `@Temporal`?"** Only for `java.util.Date`/`Calendar`. `java.time`
  types are native since JPA 2.2 and need no annotation; prefer `Instant`/`LocalDate`.
- **"How does Hibernate 6 map a custom type?"** `JavaType` + `JdbcType` descriptors,
  overridable with `@JdbcTypeCode`/`@JavaType`/`@Type(Class)`; the old string `@Type` is
  gone.
- **"How do you store JSON?"** `@JdbcTypeCode(SqlTypes.JSON)` in HB6+ (dialect picks
  `jsonb`/`json`/text); a Jackson-based `AttributeConverter` as a portable fallback.
- **"Why is `double` wrong for money and what maps it correctly?"** Binary FP rounding;
  use `BigDecimal` + `@Column(precision, scale)` → `NUMERIC(p,s)`.
- **"Converter vs `UserType`?"** Converter = standard, single column, portable; `UserType`
  = Hibernate-specific, multi-column or custom semantics.
- **"Where does the converter run in the lifecycle?"** On every bind (insert/update flush)
  and every read/query materialization; see `hibernate-jpa/transactions-dirty-checking-flushing`.

## References

- Jakarta Persistence 3.1/3.2 specification — Basic mappings, `@Enumerated`, `@Temporal`,
  `@Lob`, `@Convert`, `AttributeConverter`, `@Column` (`jakarta.persistence.*`).
- Hibernate ORM 6.x/7.x User Guide — "Basic Types", "Mapping enums", "AttributeConverter",
  "Mapping date/time values", "Mapping LOBs", "JSON mapping", and the `JavaType`/`JdbcType`
  type-system chapters.
- Cross-references in this library: `hibernate-jpa/fetching-lazy-eager-n-plus-one`
  (lazy basics/LOBs), `hibernate-jpa/transactions-dirty-checking-flushing` (when converters
  run), `hibernate-jpa/inheritance-embeddables-composite-keys` (embedded values),
  `messaging-databases` (NUMERIC/money, JSONB indexing, timestamp-with-timezone),
  `spring-boot`/`spring-core` (repository and transaction layers).
