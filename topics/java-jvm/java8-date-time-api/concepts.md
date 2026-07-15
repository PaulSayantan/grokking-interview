# Java 8 Date and Time API (java.time)

The `java.time` package was introduced in **Java 8 (2014)** as **JSR-310** (developed under **JEP 150**),
largely designed by Stephen Colebourne, the author of the third-party **Joda-Time** library. It is a
comprehensive, immutable, thread-safe replacement for the deeply flawed `java.util.Date`, `java.util.Calendar`,
`java.util.GregorianCalendar`, `java.text.SimpleDateFormat`, and `java.util.TimeZone`.

This document assumes Java 8+. Where a specific class or method arrived later (e.g. `LocalDate.datesUntil`
in Java 9), the version is tagged explicitly.

---

## Why the legacy Date and Calendar classes were broken

Before `java.time`, Java date handling was a well-known source of bugs. The main defects:

**1. Mutability (not thread-safe state).** `java.util.Date` and `Calendar` are **mutable**. A `Date`
passed to a method can be changed by that method (`date.setTime(...)`), silently corrupting the caller's
value. Defensive copying was required everywhere.

**2. `SimpleDateFormat` is not thread-safe.** It keeps mutable `Calendar` state internally. Sharing a
single `SimpleDateFormat` across threads causes corrupted output, wrong dates, or `NumberFormatException`
under concurrency — a classic production bug. Teams worked around it with `ThreadLocal<SimpleDateFormat>`.

**3. 0-based months, 1-based days.** `new GregorianCalendar(2014, 1, 1)` is **February** 1st, not January,
because months are 0-indexed (0=January...11=December) while day-of-month is 1-based. Endless off-by-one bugs.

**4. Bad naming, poor design.** `java.util.Date` does not represent a "date" — it is an instant in time
(milliseconds since epoch) with **no time zone**, yet `toString()` prints one using the default zone.
`java.sql.Date` extends `java.util.Date` but throws on the time-related getters. `Date` had a 1900-based
year offset (`year - 1900`) in deprecated constructors.

**5. No dedicated types.** There was no clean type for "a date with no time" (a birthday), "a time with no
date" (store opening hour), or "an amount of time." Everything was crammed into `Date`/`Calendar`.

**6. Poor time-zone handling and no nanosecond precision.** `Date` had only millisecond precision.

```java
// LEGACY — buggy and mutable
Calendar c = Calendar.getInstance();
c.set(2014, 1, 1);          // Feb 1, 2014 (!) — month is 0-based
Date d = c.getTime();
d.setTime(0);               // caller's Date mutated out from under them

// java.time — immutable, correct, self-documenting
LocalDate ld = LocalDate.of(2014, 1, 1);   // Jan 1, 2014 — month is 1-based (or use Month.JANUARY)
```

`java.time` fixes all of these: types are **immutable and thread-safe**, months are **1-based** (or use the
`Month` enum), each concept has its own class, and formatters are thread-safe.

---

## LocalDate, LocalTime, and LocalDateTime

These represent **human/local time without a time zone or offset**.

- **`LocalDate`** — a date only: year-month-day (e.g. `2026-07-16`). Good for birthdays, holidays.
- **`LocalTime`** — a time only: hour-minute-second-nanosecond (e.g. `10:15:30`). Good for a store's opening time.
- **`LocalDateTime`** — date + time, still **no zone/offset** (e.g. `2026-07-16T10:15:30`).

Because they carry no zone, a `LocalDateTime` does **not** map to a unique point on the global timeline — it is
ambiguous until you attach a zone. Do **not** use `LocalDateTime` for timestamps of events across regions.

```java
LocalDate today   = LocalDate.now();                 // system clock + default zone
LocalDate d       = LocalDate.of(2026, Month.JULY, 16);
LocalTime t       = LocalTime.of(10, 15, 30);
LocalDateTime dt  = LocalDateTime.of(d, t);          // or d.atTime(t)

int dom           = d.getDayOfMonth();               // 16
DayOfWeek dow     = d.getDayOfWeek();                // THURSDAY
boolean leap      = d.isLeapYear();                  // false (2026)
LocalDate next    = d.plusDays(10);                  // returns a NEW instance
boolean before    = d.isBefore(next);                // true
```

**Factory-method naming convention** (consistent across the whole API):
`now()`, `of(...)`, `from(TemporalAccessor)`, `parse(...)`, `with...()`, `plus...()`, `minus...()`, `to...()`, `at...()`.

**Parsing/format.** `parse` uses **ISO-8601** by default: `LocalDate.parse("2026-07-16")`,
`LocalDateTime.parse("2026-07-16T10:15:30")`. Invalid input throws `DateTimeParseException`.

**Ranges.** Year supports about ±999,999,999. `LocalTime` is `00:00` – `23:59:59.999999999`.

---

## ZonedDateTime and ZoneId

**`ZonedDateTime`** = `LocalDateTime` + `ZoneId` + resolved `ZoneOffset`. It represents a full date-time in a
specific region, correctly handling **Daylight Saving Time (DST)** transitions and historical offset changes.

- **`ZoneId`** — a region ID like `Europe/Paris` or `America/New_York` (from the IANA tz database). Rules
  (offset, DST) can change over time; `ZoneId` knows the full history via its `ZoneRules`.
- **`ZoneOffset`** — a fixed offset from UTC like `+02:00`. A subclass of `ZoneId` but with no DST rules.

```java
ZoneId paris        = ZoneId.of("Europe/Paris");
ZonedDateTime zdt   = ZonedDateTime.of(2026, 7, 16, 10, 15, 0, 0, paris);   // 10:15 +02:00 (CEST)
ZonedDateTime tokyo = zdt.withZoneSameInstant(ZoneId.of("Asia/Tokyo"));     // same instant, 17:15 +09:00
ZonedDateTime wall  = zdt.withZoneSameLocal(ZoneId.of("Asia/Tokyo"));       // same wall clock 10:15, DIFFERENT instant
Set<String> all     = ZoneId.getAvailableZoneIds();
```

**DST gap and overlap edge cases** (a favourite interview topic):
- **Gap** (spring-forward): the local time does not exist. `ZonedDateTime` **pushes the time forward** by the
  gap length (e.g. `02:30` becomes `03:30`).
- **Overlap** (fall-back): the local time occurs twice. By default the **earlier** offset is chosen; use
  `withEarlierOffsetAtOverlap()` / `withLaterOffsetAtOverlap()` to control it.

**`OffsetDateTime`** sits between `LocalDateTime` and `ZonedDateTime`: date-time with a fixed offset but **no
zone rules** (no DST). It is often preferred for storing timestamps in databases / on the wire because it is
unambiguous and simpler than a full region zone.

---

## Instant vs LocalDateTime, machine time vs human time

This is the single most important conceptual split in the API.

| | `Instant` | `LocalDateTime` |
|---|---|---|
| Represents | A point on the global timeline (machine time) | A human calendar date + wall-clock time |
| Time zone | Always **UTC** (epoch-based) | **None** — zoneless/ambiguous |
| Backing value | Seconds + nanos since `1970-01-01T00:00:00Z` | Fields: year, month, day, hour... |
| Use for | Timestamps, logging, event ordering, durations | Birthdays, business hours, UI display of local wall time |
| `toString()` | `2026-07-16T08:15:30Z` (always `Z`) | `2026-07-16T10:15:30` (no offset) |

- **`Instant`** = "machine time": an unambiguous instant, count of nanoseconds from the epoch, always UTC.
- **`LocalDateTime`** = "human time": what a wall clock/calendar shows locally, with no notion of where.

You bridge them with a zone:

```java
Instant now        = Instant.now();
ZonedDateTime zdt  = now.atZone(ZoneId.of("Europe/Paris"));      // Instant -> zoned human time
LocalDateTime ldt  = LocalDateTime.ofInstant(now, ZoneId.systemDefault());
Instant back       = ldt.atZone(ZoneId.systemDefault()).toInstant();  // human -> instant needs a zone
Instant fromEpoch  = Instant.ofEpochSecond(1_600_000_000L);
long epochMilli    = now.toEpochMilli();
```

Note: `Instant` supports `plus`/`minus` only with **time-based** units (seconds, nanos, hours, days as
24h). Adding `ChronoUnit.MONTHS` to an `Instant` throws `UnsupportedTemporalTypeException` because months
have no fixed length without a calendar/zone.

---

## Duration vs Period

Both implement `TemporalAmount`, but they measure different things:

| | `Duration` | `Period` |
|---|---|---|
| Measures | **Time-based** amount (seconds, nanos) | **Date-based** amount (years, months, days) |
| Precision | Nanoseconds | Whole calendar units |
| Typical use with | `Instant`, `LocalTime`, `LocalDateTime`, `ZonedDateTime` | `LocalDate`, `LocalDateTime`, `ZonedDateTime` |
| `toString()` | ISO `PT` form, e.g. `PT25H` (25 hours) | ISO `P` form, e.g. `P1Y2M3D` |
| DST-aware when added | Yes — adds exact elapsed time (a "physical" day = 24h) | Yes — adds calendar fields (a "calendar" day may be 23/25h) |

```java
Duration d = Duration.ofHours(2).plusMinutes(30);        // PT2H30M
Duration between = Duration.between(Instant.now(), later); // exact elapsed time
long secs = d.getSeconds();                               // 9000

Period p = Period.of(1, 2, 3);                            // 1 year, 2 months, 3 days -> P1Y2M3D
Period age = Period.between(LocalDate.of(1990,1,1), LocalDate.now());
int months = age.getMonths();                             // the MONTHS field, NOT total months
long totalMonths = age.toTotalMonths();                   // normalized total
```

**Gotcha — `Period` fields are not normalized across each other.** `Period.between(2020-01-01, 2021-03-05)`
is `P1Y2M4D`; `getMonths()` returns `2`, not `14`. Use `toTotalMonths()` for the total.

**Gotcha — counting whole units.** To get "days between two dates" as a number, prefer
`ChronoUnit.DAYS.between(d1, d2)` rather than `Period`. `Period.between` gives a broken-down Y/M/D amount.

**DST subtlety.** Adding `Duration.ofDays(1)` to a `ZonedDateTime` adds exactly 24 hours (may cross a DST
boundary and land on a different wall-clock hour). Adding `Period.ofDays(1)` adds one **calendar** day
(same wall-clock time next day, which may be 23 or 25 real hours). This difference is a common trap.

---

## DateTimeFormatter, thread-safe unlike SimpleDateFormat

`DateTimeFormatter` is **immutable and thread-safe** — you can safely declare one `static final` instance
and share it across threads. This is a major win over `SimpleDateFormat`, which is mutable and unsafe.

```java
DateTimeFormatter ISO   = DateTimeFormatter.ISO_LOCAL_DATE;               // predefined
DateTimeFormatter f     = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
DateTimeFormatter loc   = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
                              .withLocale(Locale.FRANCE);

String s   = LocalDateTime.now().format(f);                              // formatting
LocalDate d = LocalDate.parse("2026-07-16", ISO);                        // parsing
```

**Pattern-letter pitfalls** (extremely common interview/bug material):

| Letter | Meaning | Common mistake |
|---|---|---|
| `y` | year-of-era | — |
| `Y` | **week-based year** | Using `YYYY` instead of `yyyy` gives wrong year near Jan 1 |
| `M` | month-of-year | — |
| `m` | minute-of-hour | Using `MM` for minutes or `mm` for month |
| `d` | day-of-month | — |
| `D` | **day-of-year** | Using `DD` expecting day-of-month |
| `H` | hour-of-day (0–23) | — |
| `h` | clock-hour (1–12) | Using `hh` without `a` (AM/PM) gives 12-hour ambiguity |

- A formatter can be created for a specific `Locale`; the default locale affects month/day names.
- Formatting a temporal that lacks a required field throws `DateTimeException`
  (e.g. formatting a `LocalDate` with an `HH` pattern).
- Since **Java 8** there is also `DateTimeFormatterBuilder` for advanced/optional sections and
  case-insensitive parsing.

---

## Immutability of the API

Every core `java.time` value type — `LocalDate`, `LocalTime`, `LocalDateTime`, `ZonedDateTime`, `Instant`,
`Duration`, `Period`, `Year`, `Month`, etc. — is **immutable and final**. Consequences:

- Every `plus`/`minus`/`with` method **returns a new object**; it never mutates the receiver.
- Instances are inherently **thread-safe** and safe to cache/share and use as `Map` keys.
- A classic bug: ignoring the return value.

```java
LocalDate d = LocalDate.of(2026, 1, 1);
d.plusDays(10);                 // BUG: result discarded, d unchanged
d = d.plusDays(10);             // correct
```

The design follows the **value-based class** contract: instances are treated by value, `equals`/`hashCode`
are based on state, and you should **not** synchronize on or use identity-sensitive operations
(`==`, identity hash) on them.

---

## Converting legacy Date to and from Instant

Java 8 added bridge methods so you can interoperate with legacy APIs. The pivot type is almost always
`Instant`.

```java
// java.util.Date  <->  Instant
Instant i        = new Date().toInstant();          // Date -> Instant (Java 8+)
Date d           = Date.from(Instant.now());        // Instant -> Date

// java.util.Calendar / GregorianCalendar
ZonedDateTime z  = ((GregorianCalendar) cal).toZonedDateTime();
GregorianCalendar g = GregorianCalendar.from(z);

// java.util.TimeZone <-> ZoneId
ZoneId zone      = TimeZone.getDefault().toZoneId();
TimeZone tz      = TimeZone.getTimeZone(ZoneId.of("Europe/Paris"));

// java.sql.Timestamp <-> Instant/LocalDateTime
Timestamp ts     = Timestamp.from(Instant.now());
Instant ti       = ts.toInstant();
LocalDateTime l  = ts.toLocalDateTime();

// java.sql.Date / java.sql.Time
LocalDate sqlLd  = java.sql.Date.valueOf(LocalDate.now());  // and .toLocalDate()
```

**Key rule:** `java.util.Date` and `Instant` are both zoneless UTC-based instants, so their conversion needs
**no zone**. But converting to/from `LocalDate`/`LocalDateTime` **requires a `ZoneId`**, because a local
date-time has no fixed instant. Forgetting the zone (or assuming UTC vs system default incorrectly) is a
frequent source of off-by-one-day bugs. Also note `Instant` supports nanoseconds while `java.util.Date`
only supports milliseconds — the sub-millisecond part is lost in `Date.from(instant)`.

---

## Temporal adjusters

A **`TemporalAdjuster`** encapsulates date-manipulation logic ("next Monday", "last day of month") and is
applied via `Temporal.with(adjuster)`. The `TemporalAdjusters` factory class provides many built-ins.

```java
import static java.time.temporal.TemporalAdjusters.*;

LocalDate d = LocalDate.of(2026, 7, 16);            // Thursday
d.with(firstDayOfMonth());                          // 2026-07-01
d.with(lastDayOfMonth());                           // 2026-07-31
d.with(firstDayOfNextMonth());                      // 2026-08-01
d.with(next(DayOfWeek.MONDAY));                     // next Monday strictly after
d.with(nextOrSame(DayOfWeek.THURSDAY));             // today (it IS Thursday)
d.with(lastInMonth(DayOfWeek.FRIDAY));              // last Friday of July
d.with(dayOfWeekInMonth(2, DayOfWeek.TUESDAY));     // 2nd Tuesday of the month

// Custom adjuster: next working day
TemporalAdjuster nextWorkday = temporal -> {
    LocalDate ld = LocalDate.from(temporal);
    DayOfWeek dow = ld.getDayOfWeek();
    int add = dow == DayOfWeek.FRIDAY ? 3 : dow == DayOfWeek.SATURDAY ? 2 : 1;
    return temporal.plus(add, ChronoUnit.DAYS);
};
LocalDate wd = d.with(nextWorkday);
```

Related field access uses **`TemporalField`** and **`ChronoField`** (e.g. `d.get(ChronoField.DAY_OF_YEAR)`),
and unit-based math uses **`TemporalUnit`** / **`ChronoUnit`** (e.g. `ChronoUnit.WEEKS.between(a, b)`).

---

## Common pitfalls

- **Ignoring return values.** `dt.plusDays(1);` does nothing useful — the API is immutable; reassign.
- **Using `LocalDateTime` for timestamps.** It has no zone; two servers in different zones interpret it
  differently. Use `Instant` (or `OffsetDateTime`) for events on the global timeline.
- **`Instant` has no zone**, so it cannot give you `getYear()`/`getMonth()` — convert to a
  `ZonedDateTime`/`LocalDateTime` first. Calling date-field getters on `Instant` is unsupported.
- **Month is 1-based in `java.time`** but 0-based in `Calendar` — mixing the two flips months.
- **`Period` fields vs totals.** `getMonths()` is the month component, not total months.
- **Adding `Period` vs `Duration` across DST** yields different instants (calendar day vs 24h).
- **`ChronoUnit.MONTHS`/`YEARS` on `Instant`/`LocalTime`** throws `UnsupportedTemporalTypeException`.
- **`YYYY` (week-based year) vs `yyyy`** in `DateTimeFormatter` — wrong year around new year.
- **`ZoneId.of("Z")` vs offset "+00:00"** — `Z` maps to `ZoneOffset.UTC`; region rules differ from offsets.
- **`Instant.MAX`/date arithmetic overflow** throws `DateTimeException`/`ArithmeticException` at extremes.
- **Comparing across types.** `LocalDate` is not comparable to `LocalDateTime`; convert explicitly.
- **`toString()` of `Instant` always ends in `Z`** — not the local offset.

---

## Common interview follow-up questions

- Why are `java.util.Date`/`Calendar` considered broken, and how does `java.time` fix each defect?
- What is the difference between `Instant` and `LocalDateTime`? When would you store each in a database?
- `Duration` vs `Period` — which do you use to add "one day" across a DST change, and what is the result?
- Why is `DateTimeFormatter` safe to share as a `static final` field while `SimpleDateFormat` is not?
- How do you convert a legacy `java.util.Date` to a `LocalDate` in a given zone, and what can go wrong?
- What happens when you build a `ZonedDateTime` at a local time that falls in a DST gap or overlap?
- Why does adding `ChronoUnit.MONTHS` to an `Instant` throw, but adding it to a `LocalDate` works?
- How does `LocalDate.of(2020, 1, 31).plusMonths(1)` resolve, and why is it Feb 29, not Mar 2?
- Write a custom `TemporalAdjuster` for "next business day."
- What is the difference between `ZoneId`, `ZoneOffset`, and `OffsetDateTime`?
- Difference between `y`, `Y`, `M`, `m`, `d`, `D`, `H`, `h` in a format pattern?

## References

- JSR-310: Date and Time API (the specification behind `java.time`).
- JEP 150: Date & Time API (OpenJDK, delivered in Java 8).
- Oracle Java Platform SE 8+ API docs: `java.time`, `java.time.format`, `java.time.temporal`,
  `java.time.chrono`, `java.time.zone` packages.
- Oracle "Date Time" trail in the official Java Tutorials.
- IANA Time Zone Database (tz database) — backing data for `ZoneId`/`ZoneRules`.
- ISO-8601 standard — the default representation used by `parse`/`toString`.
