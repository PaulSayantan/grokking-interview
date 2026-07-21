# Soft Deletes, Auditing & Temporal Data

Most business data does not want to be *gone*. When a user "deletes" an order, an admin
"removes" an employee, or a compliance officer asks "what did this record look like last
March, and who changed it since?", a naive `DELETE` throws away exactly the information
the business needs. This note covers the family of patterns that let you **keep the
past**: soft deletes (mark rather than remove), audit trails (who-changed-what-when),
and temporal data (query the state of the world *as of* any point in time) — and the
sharp edges each one adds, up to the modern tension between immutable history and the
GDPR right to erasure.

The techniques form a rough ladder of fidelity:

| Pattern | Question it answers | History kept |
|---|---|---|
| Soft delete | "Is this row still live?" | Deletion only |
| Audit columns | "Who last touched it, when?" | Latest change actor |
| Audit / history table | "What was every version and who made it?" | Full row history |
| System-versioned (SQL:2011) | "What did the DB hold **as of** time T?" | Transaction-time |
| Bitemporal | "What did we *know*, about what was *true when*?" | Two time axes |
| Event sourcing | "What sequence of facts produced this state?" | Every event (see pointer) |

Everything is vendor-neutral ANSI SQL where possible; PostgreSQL, MySQL/InnoDB, SQL
Server, and MariaDB specifics are called out explicitly. Transaction semantics
(isolation, MVCC) and schema design (keys, normalization) are covered by sibling topics
— **See also: transactions-acid-isolation-levels** and
**relational-modeling-normalization** — so this note points at them rather than
re-teaching them.

---

## Soft delete: definition and motivation

A **soft delete** replaces a physical `DELETE` with an `UPDATE` that marks the row as
inactive, leaving the bytes in the table. The two common encodings are:

```sql
-- Boolean flag
ALTER TABLE orders ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE orders SET is_deleted = TRUE WHERE id = 42;

-- Nullable timestamp (usually preferred)
ALTER TABLE orders ADD COLUMN deleted_at TIMESTAMPTZ;   -- NULL = live
UPDATE orders SET deleted_at = now() WHERE id = 42;
```

A **nullable `deleted_at` timestamp is usually preferred over a boolean**: it encodes
*whether* deleted (NULL vs not-NULL) **and** *when* in a single column, which doubles as
a free audit fact and lets you build retention/purge windows ("hard-delete rows soft-
deleted more than 90 days ago"). It is the convention baked into ORMs like Rails
(`acts_as_paranoid`), Laravel (`SoftDeletes` trait, `deleted_at`), Hibernate
(`@SoftDelete`), and Django (via managers).

Why teams reach for it:

- **Recoverability / undo.** "Trash can" UX, accidental-deletion recovery, restore flows
  — no point-in-time restore of the whole database required.
- **Referential safety.** Child rows that still point at the "deleted" parent do not
  become dangling FKs or trigger cascade deletes.
- **Audit & analytics.** The historical fact that the row *existed* is preserved for
  reporting, ML features, and investigations.
- **Cheaper operation.** An `UPDATE` of one column can be lighter than a `DELETE` that
  must maintain every index and fire cascade rules — though it also creates dead tuples
  (see MVCC note below).

> [!KEY-TAKEAWAY]
> Soft delete = "mark, don't remove." It buys recoverability, referential safety, and
> history, at the cost of *every reader now carrying the burden of filtering deleted
> rows* — the trade-off that defines all the gotchas below.

## Soft delete: trade-offs and gotchas

Soft delete is not free. It shifts complexity from the write path onto **every read path
forever**.

- **The forgotten-filter data-leak bug.** Every query must add `WHERE deleted_at IS
  NULL`. Miss it in *one* endpoint, report, or JOIN and "deleted" rows resurface —
  showing cancelled orders, re-exposing PII a user asked to remove, or double-counting in
  analytics. This is the single most common and most dangerous soft-delete failure. It is
  easy to forget in ad-hoc queries, new joins, and aggregate reports.
- **Unique-constraint conflicts.** A plain `UNIQUE(email)` counts deleted rows. A user
  deletes their account and re-registers with the same email → constraint violation, even
  though no *live* row conflicts. (Fixes in the next section.)
- **Foreign-key integrity is only skin-deep.** The FK still points at a row that is
  logically gone. Nothing stops you creating a *new* child row against a soft-deleted
  parent; the DB sees a live parent. Application logic must re-check.
- **Cascades don't cascade.** A real `ON DELETE CASCADE` won't fire. Soft-deleting a
  parent leaves children live unless you soft-delete them too — orphaned-but-visible rows.
- **Index bloat & dead space.** Rows are never reclaimed, so tables grow monotonically.
  In PostgreSQL a soft-delete `UPDATE` also creates a **new tuple version** (the old one
  is dead until `VACUUM`), so a soft delete is *not* cheaper on dead-tuple pressure than a
  hard delete — it just never frees the space at all.
- **Query planner skew.** If 95% of rows are deleted, ordinary indexes and stats are
  dominated by rows nobody queries, hurting selectivity estimates and cache hit rates.
- **Leaks into every layer.** ORMs need global default scopes; report writers, BI tools,
  and data scientists hitting the raw table must all remember the filter.

> [!WARNING]
> The most reliable soft-delete bug is a *silent* one: a JOIN or new query that omits
> `deleted_at IS NULL` and quietly surfaces deleted data. Enforce the filter structurally
> (views / RLS / ORM default scope), not by developer discipline.

**When NOT to soft-delete:** high-churn/transient tables (sessions, queues, rate-limit
counters), append-only event logs (nothing to delete), and cases where a proper history
table or system-versioning is the better fit. Soft delete on a hot table with 90% dead
rows is an anti-pattern — use partitioning + purge or an archive table instead.

## Managing soft deletes: partial indexes, views, and constraints

The gotchas are manageable with schema-level enforcement rather than convention.

**Partial (filtered) unique index** — enforce uniqueness *only among live rows*:

```sql
-- PostgreSQL / SQLite: partial index
CREATE UNIQUE INDEX uq_users_email_live
  ON users (email) WHERE deleted_at IS NULL;

-- SQL Server: filtered index (same idea, WHERE clause)
CREATE UNIQUE INDEX uq_users_email_live
  ON users (email) WHERE deleted_at IS NULL;
```

Now a deleted user's email no longer blocks re-registration; only *live* duplicates are
rejected. MySQL/InnoDB historically has **no partial-index syntax**; the common
workarounds are a generated/virtual column (e.g. `email_key` that is NULL when deleted,
relying on multiple-NULLs-allowed in unique indexes) or folding the delete marker into
the key (e.g. `UNIQUE(email, deleted_marker)` where the marker is the row id when deleted
and a constant when live).

**Partial indexes also fix the bloat/selectivity problem** for hot lookups:

```sql
-- Index only the ~5% of rows anyone actually queries
CREATE INDEX idx_orders_status_live
  ON orders (status) WHERE deleted_at IS NULL;
```

**Views to make the filter the default** — readers hit the view, not the base table:

```sql
CREATE VIEW active_orders AS
  SELECT * FROM orders WHERE deleted_at IS NULL;
```

Point the application and BI tools at `active_orders`; the base table is reserved for
admin/restore/audit. **Row-Level Security** (PostgreSQL `CREATE POLICY … USING
(deleted_at IS NULL)`) enforces it even harder — the filter is applied by the engine for
every session regardless of the query. ORM **default scopes** (Rails/Django/Laravel)
achieve the same at the app tier but are bypassed by raw SQL, so defense-in-depth
favors a DB-level guard.

> [!TIP]
> Reach for a **partial unique index** the moment you add a soft-delete column to a table
> that has any natural unique key (email, username, SKU). It is the fix for the single
> most common soft-delete production incident: "user can't re-sign-up with their old
> email."

## Audit columns for row provenance

The lightest-weight audit adds four columns to a table so each row records its own
provenance:

```sql
ALTER TABLE accounts
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN created_by BIGINT      NOT NULL REFERENCES users(id),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_by BIGINT      REFERENCES users(id);
```

`created_*` is set once on insert and never changed; `updated_*` is refreshed on every
write (often via a `BEFORE UPDATE` trigger so the app can't forget). This answers **"who
last touched this row, and when?"** cheaply and is nearly universal in enterprise
schemas.

Its hard limitation: **it stores only the *latest* actor, not the history.** It cannot
tell you the value *before* the last change, who made the change two edits ago, or that
a field was changed and then changed back. `updated_by` is also only as trustworthy as
the app that sets it — a direct SQL `UPDATE` or a background job may leave a misleading
actor. For real change history you need a separate audit/history table (next section).

> [!INTERVIEW]
> A classic follow-up: *"Your table has `created_by`/`updated_by`. A customer disputes a
> balance change from three edits ago — can you answer who did it?"* Correct answer: **no**
> — audit columns keep only the most recent actor. You need a row-versioned history/audit
> table or system-versioning to reconstruct intermediate states.

## Audit / history tables: triggers vs app-level vs CDC

To keep the **full history of every change**, write a copy of the row (before and/or
after) to a separate table on each mutation:

```sql
CREATE TABLE accounts_audit (
  audit_id    BIGSERIAL PRIMARY KEY,
  account_id  BIGINT NOT NULL,
  operation   CHAR(1) NOT NULL,        -- I / U / D
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  TEXT,
  row_before  JSONB,                   -- full prior image
  row_after   JSONB                    -- full new image
);
```

There are three main places to capture the change; the choice is a core interview
trade-off:

| Approach | How | Pros | Cons |
|---|---|---|---|
| **DB triggers** | `AFTER INSERT/UPDATE/DELETE` trigger writes audit row | Cannot be bypassed (catches ad-hoc SQL, other apps); atomic with the change | DB-specific; hidden logic; per-row overhead; capturing the app *user* is awkward (needs session var / `SET LOCAL`) |
| **App-level** | Repository/ORM hooks (Hibernate Envers, Django-simple-history) write history | Rich business context (user, request id, reason); portable | **Bypassed by any write that skips the app** (migrations, DBA scripts, other services) → incomplete audit |
| **CDC / log-based** | Read the WAL/binlog (Debezium, native CDC) into a downstream audit store | Zero write-path overhead; captures *all* writes; decoupled/async | Eventually consistent; more infra; actor/user context often missing from the log |

Key trade-off to state in an interview: **triggers give completeness (nothing escapes),
app-level gives context (who/why), CDC gives decoupling and zero write-latency cost.**
Many mature systems combine them — CDC for the firehose, app metadata for context.

**See also: stream-processing-cdc** for how log-based CDC (Debezium, binlog/WAL tailing)
actually works; here we only care that it can *feed* an audit store without touching the
write path.

## Append-only history and tamper-evidence

For compliance (SOX, HIPAA, PCI-DSS) or security-sensitive audit logs, the audit trail
must be **tamper-evident**: an attacker (or a careless admin) should not be able to
alter or delete history without detection.

Techniques, roughly in increasing strength:

- **Append-only by permission.** Grant only `INSERT` on the audit table (no
  `UPDATE`/`DELETE`), even to the app role. In PostgreSQL, `REVOKE UPDATE, DELETE` and/or
  a trigger that `RAISE`s on any non-insert. This stops accidental and casual tampering
  but not a superuser.
- **WORM storage / immutability locks.** Write audit data to Write-Once-Read-Many storage
  (e.g. S3 Object Lock in compliance mode) so even the account owner cannot delete before
  the retention period expires.
- **Hash chaining (blockchain-style).** Each audit row stores `hash =
  H(prev_hash || row_data)`. Any retroactive edit breaks the chain from that point
  forward, making tampering *detectable*. This is what "ledger" features do — AWS QLDB
  (now on a deprecation path) and SQL Server 2022 **ledger tables** build a Merkle-tree
  digest you can verify.
- **External anchoring.** Periodically publish the chain's tip hash to an independent
  system (or a public ledger) so nobody who controls the DB can rewrite the whole chain
  undetected.

> [!WARNING]
> "Append-only" enforced only in application code is not tamper-evidence — anyone with DB
> credentials can still `UPDATE`/`DELETE`. Real tamper-*evidence* needs cryptographic
> chaining or WORM storage; tamper-*proofing* is effectively impossible against a
> sufficiently privileged insider, so aim for detectability + separation of duties.

## Temporal data: valid time vs transaction time

**Temporal data** tracks not just current state but how facts change over time. The
foundational distinction (from Snodgrass's work and codified in SQL:2011) is between two
independent time axes:

- **Valid time** (a.k.a. *application time* / *business time*): the period during which a
  fact is **true in the modeled world**. "Alice's salary was \$90k **from 2023-01-01 to
  2024-06-30**." You can record facts about the past or the *future* (a raise effective
  next month), and you can correct valid time.
- **Transaction time** (a.k.a. *system time*): the period during which a fact was
  **stored in the database** — when the row was inserted and when it was superseded.
  Transaction time is **append-only and cannot be back-dated**; it records what the DB
  *believed* and when. This is the axis that makes an audit trail.

They diverge whenever reality and the database disagree in timing. Example: a salary raise
was *effective* 2024-01-01 (valid time) but wasn't *entered* into the system until
2024-01-15 (transaction time). If you only track one axis you cannot answer both "what
was her salary on Jan 5?" and "what did *we think* her salary was, as of Jan 5?".

| | Valid time | Transaction time |
|---|---|---|
| Meaning | When the fact is true in reality | When the DB knew it |
| Set by | Application / business | System (automatic) |
| Can reference future? | Yes | No |
| Can be corrected/back-dated? | Yes | No (append-only) |
| Enables | Effective-dated business rules | Audit / point-in-time DB state |

## Bitemporal tables

A **bitemporal** table tracks **both** valid time and transaction time simultaneously —
two independent `PERIOD`s per row. This is the gold standard for regulated finance,
insurance, and anywhere you must answer *retroactive* questions:

> "As of what we knew on **March 1** (transaction time), what did we believe Alice's
> salary was for the period covering **February** (valid time)?"

Bitemporality lets you record a correction *without losing the wrong value you previously
held*: you close off the old (transaction-time) version and insert a corrected one, so
you can always reconstruct both "the truth as best we know it now" and "what the system
would have told an auditor on any past date." That combination — reproducing a past
*belief* about a past *reality* — is impossible with a single time axis.

The cost is real: four temporal columns, more complex constraints (no two rows may
overlap in *both* dimensions for the same key), and every query must pin *both* axes.
Most systems don't need it; when regulators or auditors do, nothing else suffices.

## System-versioned temporal tables (SQL:2011)

**SQL:2011** standardized temporal support with two features that map onto the two time
axes:

- **Application-time period tables** — you manage valid-time columns, declared with
  `PERIOD FOR <name> (start_col, end_col)`. Supports temporal primary keys
  (`... WITHOUT OVERLAPS`) and temporal referential integrity; the engine can auto-split
  periods on update/delete.
- **System-versioned tables** — the engine *automatically* maintains transaction-time.
  You declare `PERIOD FOR SYSTEM_TIME` plus `WITH SYSTEM VERSIONING`; on every `UPDATE`
  or `DELETE` the engine closes the old row's system-time period and keeps it as history.
  **Constraints (PK, unique, FK) are enforced only on current rows.** Combine both for a
  **bitemporal** table.

Standard syntax:

```sql
CREATE TABLE employees (
  emp_id   BIGINT PRIMARY KEY,
  salary   NUMERIC(12,2),
  sys_start TIMESTAMP(6) GENERATED ALWAYS AS ROW START,
  sys_end   TIMESTAMP(6) GENERATED ALWAYS AS ROW END,
  PERIOD FOR SYSTEM_TIME (sys_start, sys_end)
) WITH SYSTEM VERSIONING;

-- Time-travel queries (standard)
SELECT * FROM employees FOR SYSTEM_TIME AS OF TIMESTAMP '2024-03-01 00:00:00';
SELECT * FROM employees FOR SYSTEM_TIME
  BETWEEN TIMESTAMP '2024-01-01' AND TIMESTAMP '2024-06-30';
SELECT * FROM employees FOR SYSTEM_TIME FROM '2024-01-01' TO '2024-06-30';
```

Vendor support and syntax vary — a frequent gotcha:

| Engine | System-versioning | Time-travel syntax |
|---|---|---|
| MariaDB (10.3+) | `WITH SYSTEM VERSIONING` | `FOR SYSTEM_TIME AS OF ...` |
| SQL Server (2016+) | `WITH (SYSTEM_VERSIONING = ON)`; separate history table | `FOR SYSTEM_TIME AS OF ...` |
| IBM Db2 (10+) | System-period + business-period temporal | `FOR SYSTEM_TIME AS OF ...` |
| Oracle | Flashback / Temporal Validity | `AS OF TIMESTAMP ...` (Flashback) |
| PostgreSQL | **No native SQL:2011 system-versioning** (as of PG 16); done via triggers or extensions | — |
| MySQL | No native system-versioning | — |

> [!WARNING]
> Do not assume "temporal tables" work everywhere. **PostgreSQL and MySQL have no native
> SQL:2011 system-versioning** — you emulate it with triggers/history tables or an
> extension. MariaDB, SQL Server, and Db2 do have it, but the DDL and even the query
> keyword (`FOR SYSTEM_TIME AS OF` vs Oracle's `AS OF TIMESTAMP`) differ.

## Slowly changing dimensions (SCD Type 2)

In dimensional/data-warehouse modeling (Kimball), a **slowly changing dimension** is a
dimension whose attributes change occasionally (a customer moves city, a product changes
category), and the SCD "types" codify how you handle that change. This is the analytics
world's answer to the same history problem.

| SCD type | Strategy | History kept |
|---|---|---|
| **Type 0** | Retain original; never change (e.g. date-of-birth) | Original only |
| **Type 1** | **Overwrite** with new value | None (like a hard update) |
| **Type 2** | **Add a new row** per change, with effective/expiry dates + current flag | **Full history** |
| **Type 3** | Add a **column** for the previous value | Limited (one prior value) |
| **Type 4** | Current row in main table, changes in a separate **history table** | Full, split out |
| **Type 6** | Hybrid **1+2+3**: new row + overwritten current column + prior-value column | Full + fast current |

**Type 2 is the one interviewers mean by "keep dimension history."** Each version is a
new row sharing the natural/business key but with its own surrogate key, plus:

```
customer_key | customer_id | city    | effective_date | end_date   | is_current
     501      |   C-100     | Austin  | 2022-01-01     | 2024-05-31 | false
     902      |   C-100     | Denver  | 2024-06-01     | 9999-12-31 | true
```

The **surrogate key** (`customer_key`) is what fact rows join to, so a fact row
"freezes" the dimension version that was current when the fact occurred — an order from
2023 forever links to `Austin`. A NULL or `9999-12-31` end_date plus `is_current = true`
marks the live version. Type 2 corresponds directly to valid-time versioning; Type 4 is
essentially the audit/history-table pattern under an analytics name.

## Event sourcing as the ultimate audit trail

**Event sourcing** stores state as an **append-only, immutable log of domain events**
(`OrderPlaced`, `ItemAdded`, `OrderCancelled`) rather than as current rows; current state
is a *fold* (replay) over the events. Because nothing is ever mutated or deleted, the
event store **is** a perfect, complete audit trail by construction — you can reconstruct
the exact state at any point in time by replaying events up to that moment, which
subsumes soft delete (a `Deleted` event), temporal queries (replay to time T), and audit
(the events *are* the who/what/when).

The cost is a different architecture entirely: read models/projections, eventual
consistency, schema/versioning of events, and the GDPR-erasure problem in an especially
acute form (you cannot delete an event without breaking the log — see below).

> [!INTERVIEW]
> If an interviewer pushes "what's the strongest form of audit?", the answer is **event
> sourcing** — the log of immutable events is a total audit trail. But flag the cost:
> it's a system-wide design commitment (CQRS, projections, eventual consistency), not a
> column you bolt onto a table. This is a *pointer* — a full treatment is its own topic.

## GDPR right-to-erasure vs immutable history

Immutable audit trails, system-versioning, and event stores collide head-on with the
**GDPR Article 17 "right to erasure"** (right to be forgotten) and similar laws (CCPA).
The user has a right to have their personal data deleted — but your whole architecture is
built to *never* delete. This is one of the sharpest real-world tensions in the topic.

Resolution strategies:

- **Anonymization / pseudonymization instead of deletion.** Overwrite or null the PII
  fields (name, email, address) while keeping the non-personal skeleton for referential
  integrity and aggregate analytics. If data is *truly* anonymized (not reversible,
  not re-identifiable), GDPR no longer applies to it. This preserves audit *structure*
  without retaining *identity*.
- **Crypto-shredding (crypto-erasure).** Encrypt each subject's PII with a per-subject
  key; to "erase," **destroy the key**. The ciphertext remains in immutable logs/backups
  but is permanently unreadable. This is the standard reconciliation for **event
  sourcing** and WORM backups where physically deleting a record is impossible.
- **Tombstone + purge on soft-deleted data.** Soft delete alone does *not* satisfy
  erasure — the PII is still there. You need a real purge (or anonymize) step.
- **Legal-basis exemptions.** GDPR erasure is **not absolute**: data retained to meet a
  *legal obligation* (tax/financial records, KYC/AML) or to establish/defend legal claims
  may be lawfully kept. So audit data required by other regulation can often survive an
  erasure request — but you must justify and scope it.

> [!WARNING]
> Soft delete is **not** GDPR erasure. `deleted_at = now()` leaves every byte of personal
> data in the table. Satisfying a right-to-erasure request requires anonymizing or
> hard-deleting the PII (or crypto-shredding it in immutable stores) — and remembering
> backups, read replicas, search indexes, and downstream CDC sinks hold copies too.

## Data retention and purge

Keeping everything forever is neither free nor legal. A **retention policy** defines how
long each class of data lives before it is purged or anonymized, driven by (a) storage
cost and query performance, (b) legal maximums (GDPR data-minimization: don't keep longer
than necessary) and legal minimums (tax records for N years), and (c) risk (data you
don't hold can't be breached or subpoenaed).

Implementation patterns:

- **Time-based purge job.** Scheduled deletion/anonymization of rows past their window
  (e.g. hard-delete audit rows older than 7 years, anonymize soft-deleted users after 30
  days).
- **Partitioning by time + `DROP PARTITION`.** For large append-only/audit tables,
  range-partition by date and drop whole old partitions — a metadata operation that is
  vastly cheaper than a bulk `DELETE` (no per-row work, no dead-tuple bloat, no VACUUM
  storm).
- **Tiered storage / archival.** Move cold history to cheaper storage (object store,
  cold columnar) before deleting, keeping it queryable-if-needed but off the hot path.
- **TTL features.** Some stores auto-expire rows (DynamoDB TTL, Cassandra TTL, MongoDB
  TTL index) — the engine purges expired data in the background.

> [!TIP]
> For high-volume audit/history tables, **partition by time and drop old partitions**
> rather than issuing bulk `DELETE`s. Dropping a partition is a fast catalog operation;
> a bulk delete rewrites indexes, generates huge WAL/redo, bloats the table, and competes
> with live traffic.

## Common follow-up questions

- **Why prefer `deleted_at TIMESTAMP` over an `is_deleted` boolean?** The timestamp
  encodes both *whether* and *when* deleted in one column, gives you a free audit fact,
  and lets you drive retention/purge windows. A boolean throws away the "when."
- **A user soft-deleted their account and can't re-register with the same email — why,
  and how do you fix it?** A plain `UNIQUE(email)` counts the deleted row. Fix with a
  **partial/filtered unique index** `WHERE deleted_at IS NULL` (or a MySQL generated-column
  workaround, since InnoDB lacks partial indexes).
- **Triggers vs application-level vs CDC auditing — which and why?** Triggers =
  completeness (can't be bypassed) but no user context; app-level = rich context but
  bypassed by out-of-band writes; CDC = zero write-path cost and captures everything but
  is async and lacks actor context. Often combined.
- **Valid time vs transaction time?** Valid = when the fact is true in reality (settable,
  future-datable, correctable); transaction = when the DB stored it (append-only, the
  audit axis). Bitemporal tracks both.
- **Does PostgreSQL support SQL:2011 temporal tables?** Not natively (through PG 16) —
  emulate with triggers/history tables or an extension. MariaDB, SQL Server, and Db2 do.
- **How do you reconcile an immutable audit log / event store with GDPR right-to-erasure?**
  Anonymize the PII, or **crypto-shred** (destroy the per-subject encryption key so
  ciphertext in immutable logs becomes unreadable); rely on legal-basis exemptions where
  retention is legally required.
- **Is soft delete enough for GDPR erasure?** No — the personal data is still present.
  You must anonymize or hard-delete, including copies in backups, replicas, and search
  indexes.
- **How do you keep a huge audit table from crippling the DB?** Time-partition and
  `DROP PARTITION` old data; consider append-only permissions and tiered/archival storage.
- **What's the strongest form of audit?** Event sourcing — an immutable event log is a
  complete audit trail — at the cost of a CQRS/eventual-consistency architecture.
- **SCD Type 2 vs system-versioning?** Both keep row history; SCD Type 2 is the warehouse
  (valid-time, surrogate-key) idiom for dimensions, system-versioning is the OLTP engine
  feature for transaction-time. They solve the same problem in different layers.

## References

- E. F. Codd, *A Relational Model of Data for Large Shared Data Banks* (1970) — relational
  foundations.
- ISO/IEC 9075:2011 (SQL:2011) — temporal features: application-time period tables,
  system-versioned tables, `PERIOD FOR SYSTEM_TIME`, `FOR SYSTEM_TIME AS OF`.
- Krishna Kulkarni & Jan-Eike Michels, *Temporal Features in SQL:2011* (ACM SIGMOD Record,
  2012) — authoritative overview of the standard.
- Richard T. Snodgrass, *Developing Time-Oriented Database Applications in SQL* (2000) —
  valid time, transaction time, bitemporal.
- Ralph Kimball & Margy Ross, *The Data Warehouse Toolkit* — slowly changing dimensions
  (Types 0–7).
- Martin Fowler, *Event Sourcing* and *Temporal Property* patterns.
- PostgreSQL docs — partial indexes, row-level security, table partitioning, VACUUM/MVCC.
- MariaDB / Microsoft SQL Server / IBM Db2 / Oracle docs — system-versioned temporal
  tables and time-travel query syntax.
- EU GDPR Article 17 (right to erasure) and Article 5 (storage limitation / data
  minimization).
- AWS S3 Object Lock (WORM); Microsoft SQL Server 2022 ledger tables (tamper-evidence).
