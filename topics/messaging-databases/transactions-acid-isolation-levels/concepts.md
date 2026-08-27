# Transactions, ACID & Isolation Levels

A **transaction** is a group of reads and writes that the database treats as one
indivisible unit of work: either all of it takes effect or none of it does, and while
it runs it is protected from being corrupted by other concurrent transactions. This
note is about the *mechanism* — how atomicity is implemented with undo logging, how
durability is implemented with write-ahead logging and `fsync`, what each SQL
isolation level actually permits, the concrete two-transaction anomalies (dirty read,
non-repeatable read, phantom, lost update, write skew), and how MVCC, snapshot
isolation, SSI and locking realize (or fail to realize) serializability.

The canonical references are the SQL standard (ISO/IEC 9075), the PostgreSQL and
MySQL/InnoDB manuals, Berenson et al.'s *A Critique of ANSI SQL Isolation Levels*
(1995), Cahill/Röhm/Fekete's SSI paper (2008), and Kleppmann's *Designing
Data-Intensive Applications* (DDIA), ch. 7.

> [!KEY-TAKEAWAY]
> The four ANSI isolation levels are defined by which *anomalies* they permit, not by
> how they are implemented. Two databases at the "same" level (e.g. REPEATABLE READ)
> can behave very differently: PostgreSQL's REPEATABLE READ is snapshot isolation and
> blocks phantoms, while ANSI REPEATABLE READ formally allows them.

---

## ACID properties precisely

**ACID** names the four guarantees a transactional database makes. The term was
coined by Härder & Reuter (1983), building on Gray's work.

- **Atomicity** — a transaction is all-or-nothing. If any statement fails (or the
  client issues `ROLLBACK`, or the server crashes mid-transaction), every change the
  transaction made is undone. Atomicity is about *abortability*: the ability to throw
  away a partial transaction. It is **not** about concurrency.
- **Consistency** — a transaction moves the database from one valid state to another,
  preserving declared invariants (constraints, foreign keys, `CHECK`s, and
  application-level invariants). This is the odd one out: it is largely the
  *application's* responsibility. The database enforces the constraints you declare;
  it cannot know that "the sum of all account balances must stay constant." The "C"
  is famously the letter added mostly to make the acronym pronounceable.
- **Isolation** — concurrently executing transactions do not step on each other. The
  gold standard is **serializability**: the result is as if the transactions ran one
  at a time in *some* serial order. Real systems offer weaker levels for performance.
- **Durability** — once a transaction commits, its effects survive crashes, power
  loss, and restarts. In a single node this means the data reached non-volatile
  storage (disk/SSD, via `fsync`); in a replicated system it may also mean the write
  reached a quorum of replicas.

> [!INTERVIEW]
> A frequent trap: "Which ACID property does a `UNIQUE` constraint enforce?" Answer:
> Consistency (invariant enforcement), not Isolation. Isolation is purely about
> concurrent-execution interference.

Atomicity and durability are usually implemented together by the **write-ahead log**;
isolation is implemented by MVCC and/or locking; consistency rides on top of both plus
constraint checking.

---

## Atomicity and the undo log

To roll back a partial transaction the engine must be able to **undo** changes it has
already applied to data pages. Two broad techniques exist:

1. **Undo (rollback) logging / in-place update.** Before modifying a row in place, the
   engine records the *old* value. On `ROLLBACK` (or crash recovery of an uncommitted
   transaction) it replays the undo records to restore the prior image. InnoDB does
   exactly this: it keeps **undo logs** in the undo tablespace; those same old-version
   records also serve MVCC reads (see below). PostgreSQL takes a different route — it
   never overwrites a row in place; an `UPDATE` writes a *new* row version and marks
   the old one dead, so "undo" is simply not making the new version visible.

2. **Shadow paging / copy-on-write** — write new pages and atomically flip a pointer
   at commit. SQLite's rollback journal and WAL modes are variants. Less common in big
   OLTP engines because it fragments and complicates B-tree layout.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- undo: old balance saved
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- undo: old balance saved
-- crash here, or:
ROLLBACK;   -- both updates reversed via the undo records
```

> [!WARNING]
> Atomicity is per-transaction, not per-statement guaranteed forever: many drivers run
> in **autocommit** mode where each statement is its own transaction. And in MySQL,
> most **DDL** statements (e.g. `ALTER TABLE`) cause an *implicit commit* and cannot be
> rolled back — a classic gotcha. PostgreSQL, by contrast, supports transactional DDL.

**Savepoints** give partial atomicity inside a transaction: `SAVEPOINT sp1; ...;
ROLLBACK TO sp1;` undoes only the work after the savepoint, using the same undo
machinery.

---

## Durability, WAL and fsync

The core problem: data pages live in an in-memory **buffer pool** and are flushed to
disk lazily. If the server crashes, recent committed changes might still be only in
RAM. The fix is **write-ahead logging (WAL)**, formalized by the **ARIES** algorithm
(Mohan et al., 1992):

> **The WAL rule:** the log record describing a change must reach durable storage
> *before* the corresponding data page is written, and before the transaction is
> reported as committed.

Because the log is a sequential append, flushing it is far cheaper than randomly
flushing every dirty data page. At `COMMIT`:

1. The engine appends a commit record to the WAL buffer.
2. It calls `fsync()` (or equivalent) so the log — up to and including that commit
   record — is physically on disk.
3. Only then does it acknowledge the commit to the client.

Dirty data pages can be written back later (a **checkpoint** bounds recovery time).
On restart, recovery **redoes** committed changes found in the log but not yet in the
data files, and **undoes** the effects of transactions that never committed.

| System | WAL name | Key durability knob | Meaning of loosening it |
|---|---|---|---|
| PostgreSQL | WAL (`pg_wal`) | `synchronous_commit` | `off` acks commit before `fsync` → small data-loss window, no corruption |
| MySQL/InnoDB | redo log + binlog | `innodb_flush_log_at_trx_commit` | `1`=fsync per commit (default, durable); `2`/`0` = faster, can lose recent commits |

> [!WARNING]
> `fsync` durability can be defeated by lying hardware: a disk write cache that
> acknowledges before data is truly persisted. Battery-backed / power-loss-protected
> controllers, or disabling the volatile write cache, are needed for true durability.
> In replicated setups, **semi-synchronous** replication (MySQL) or
> `synchronous_commit = remote_apply` (PostgreSQL) extends durability to replicas.

> [!TIP]
> InnoDB has two logs and people conflate them: the **redo log** is for crash recovery
> (durability); the **binlog** is a logical, engine-independent log used for
> replication and point-in-time recovery. A "two-phase commit" between them keeps them
> consistent.

---

## The four SQL isolation levels

ANSI SQL defines four levels, in increasing strictness. Crucially, the standard
defines them by which **phenomena (anomalies)** they *forbid*:

| Isolation level | Dirty read | Non-repeatable read | Phantom read |
|---|---|---|---|
| READ UNCOMMITTED | possible | possible | possible |
| READ COMMITTED | prevented | possible | possible |
| REPEATABLE READ | prevented | prevented | possible* |
| SERIALIZABLE | prevented | prevented | prevented |

\* The standard permits phantoms at REPEATABLE READ, but real MVCC engines often
prevent them at their REPEATABLE READ (PostgreSQL) or via gap locks (InnoDB).

Set the level per transaction:

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
-- or in one statement
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

**Defaults differ by vendor** (a top interview question):

| Database | Default isolation level |
|---|---|
| PostgreSQL | READ COMMITTED |
| MySQL / InnoDB | REPEATABLE READ |
| Oracle | READ COMMITTED (offers SERIALIZABLE = snapshot isolation) |
| SQL Server | READ COMMITTED (locking by default; can enable RCSI/snapshot) |

> [!WARNING]
> **READ UNCOMMITTED is barely useful and is not what people think.** In PostgreSQL it
> behaves *identically to READ COMMITTED* — Postgres never returns uncommitted data. In
> InnoDB it does permit dirty reads. Berenson et al. showed the ANSI definitions are
> also ambiguous and incomplete (they don't mention lost update or write skew at all).

---

## Read phenomena and anomalies

The three ANSI phenomena, each with a concrete two-transaction walk-through.

**Dirty read** — T1 reads a row that T2 has written but not yet committed; T2 then
aborts. T1 acted on data that never officially existed.

```
T1: BEGIN                                  T2: BEGIN
                                           T2: UPDATE accounts SET balance=0 WHERE id=1
T1: SELECT balance FROM accounts WHERE id=1  -> reads 0 (dirty!)
                                           T2: ROLLBACK      -- balance was never 0
```
Prevented at READ COMMITTED and above.

**Non-repeatable read (fuzzy read)** — T1 reads a row twice and gets different values
because T2 committed an update in between. The same *query on the same row* returns
different data.

```
T1: BEGIN
T1: SELECT balance FROM accounts WHERE id=1   -> 100
                                              T2: UPDATE accounts SET balance=150 WHERE id=1; COMMIT
T1: SELECT balance FROM accounts WHERE id=1   -> 150   (non-repeatable!)
```
Prevented at REPEATABLE READ and above (a repeatable-read transaction sees a stable
snapshot).

**Phantom read** — T1 runs a *range/predicate* query twice; T2 inserts or deletes a
row matching the predicate in between, so the second run sees a different *set* of
rows. The difference from non-repeatable read: it's about rows appearing/disappearing,
not an existing row's value changing.

```
T1: BEGIN
T1: SELECT count(*) FROM orders WHERE amount > 1000   -> 5
                                              T2: INSERT INTO orders(amount) VALUES(5000); COMMIT
T1: SELECT count(*) FROM orders WHERE amount > 1000   -> 6   (phantom!)
```
Prevented at SERIALIZABLE. InnoDB also prevents it at REPEATABLE READ using **gap /
next-key locks**; PostgreSQL prevents it at REPEATABLE READ because the whole
transaction reads one snapshot.

---

## Lost update and write skew

The ANSI phenomena are incomplete. Two more anomalies dominate real bugs and are
favorite interview material.

**Lost update** — two transactions do read-modify-write on the *same* row; one
overwrites the other's change, silently losing it.

```
T1: SELECT count FROM counters WHERE id=1   -> 42
                                            T2: SELECT count FROM counters WHERE id=1  -> 42
T1: UPDATE counters SET count=43 WHERE id=1
                                            T2: UPDATE counters SET count=43 WHERE id=1  -- should be 44!
```

Fixes:
- **Atomic write** — push the logic into the DB: `UPDATE counters SET count = count + 1
  WHERE id = 1;` (the DB serializes row writes).
- **Pessimistic lock** — `SELECT ... FOR UPDATE` locks the row so the second reader
  blocks until the first commits.
- **Optimistic / compare-and-set** — a version column: `UPDATE ... SET count=43,
  version=8 WHERE id=1 AND version=7;` succeeds only if nobody changed it; 0 rows
  affected means retry.
- **SERIALIZABLE** — detects and aborts one transaction.

> [!TIP]
> Most engines' snapshot isolation (PostgreSQL REPEATABLE READ, InnoDB) do provide
> **lost-update protection** for concurrent updates of the *same row*: the "first
> committer wins" / "first updater wins" rule aborts or blocks the second writer.
> Write skew, below, they do **not** prevent.

**Write skew** — the trickier sibling. Two transactions read an *overlapping set* of
rows, each makes a decision based on what it read, and each writes to a *different*
row. Individually each write is fine; together they violate an invariant that spanned
the rows. This is the anomaly that snapshot isolation famously **fails** to prevent.

Classic example — hospital on-call rule "at least one doctor must be on call":

```
-- invariant: at least 1 doctor on shift must remain on_call
T1 (Alice): SELECT count(*) FROM doctors WHERE on_call=true AND shift=1  -> 2
T2 (Bob):   SELECT count(*) FROM doctors WHERE on_call=true AND shift=1  -> 2
T1: UPDATE doctors SET on_call=false WHERE name='Alice'   -- "2 others, safe to leave"
T2: UPDATE doctors SET on_call=false WHERE name='Bob'     -- "2 others, safe to leave"
T1: COMMIT   T2: COMMIT       -- now ZERO doctors on call: invariant violated
```

Both transactions passed their own check on a snapshot that predated the other's
write. They wrote *different rows*, so there is no row-level write conflict for
snapshot isolation to catch. Fixes: SERIALIZABLE (SSI detects it), or materialize the
conflict by locking all read rows with `SELECT ... FOR UPDATE`.

---

## MVCC versus locking

There are two dominant families for implementing isolation.

**Two-phase locking (2PL) — pessimistic.** Readers take shared (S) locks, writers take
exclusive (X) locks; locks are held to commit ("strict 2PL"). S and X conflict, so
**readers block writers and writers block readers**. Strict 2PL delivers true
serializability but concurrency and throughput suffer, and it is deadlock-prone. Old
SQL Server default and DB2 work this way.

**Multi-Version Concurrency Control (MVCC).** Instead of overwriting data, each write
creates a new **version** stamped with transaction metadata. A reader sees the version
that was committed as of its **snapshot**, so:

> **Readers never block writers and writers never block readers.**

This is the single biggest reason MVCC databases (PostgreSQL, InnoDB, Oracle) scale
read-heavy workloads well. Writers still block *conflicting* writers (two updates to
the same row).

How the two big MVCC engines differ:

| Aspect | PostgreSQL | MySQL / InnoDB |
|---|---|---|
| Old versions stored | new row versions live *in the table heap*; dead tuples reclaimed by **VACUUM** | old versions kept in the **undo log**; reads reconstruct by applying undo |
| Visibility check | per-tuple `xmin`/`xmax` transaction ids vs snapshot | `DB_TRX_ID` / roll pointer vs read view |
| Bloat concern | table/index bloat; needs autovacuum tuning | undo log growth if a long transaction holds back purge |

> [!WARNING]
> A long-running read transaction (or an idle-in-transaction connection) is dangerous
> in MVCC: it pins old row versions, blocking PostgreSQL's VACUUM or InnoDB's purge and
> causing bloat/undo growth. Monitor and cap transaction age.

---

## Snapshot isolation and why it is not serializable

**Snapshot isolation (SI)** is the isolation model most MVCC databases actually
implement for their "repeatable read" level. Rules:

- Each transaction reads from a **consistent snapshot** taken at its start (or at first
  statement): it sees all data committed before that point and none committed after.
- Writes are buffered; at commit, the engine enforces **first-committer-wins** — if two
  transactions modified the same row, the second to commit aborts (`ERROR: could not
  serialize access` in PostgreSQL REPEATABLE READ).

SI cleanly prevents dirty reads, non-repeatable reads, phantoms, and *same-row* lost
updates. It is very attractive: strong guarantees, no read locks.

**But SI is not serializable.** It admits **write skew** (and a "read-only transaction
anomaly"). The reason: SI only checks for **write-write** conflicts on the *same item*.
Write skew is a **read-write** conflict across *different* items — each transaction's
write invalidates a predicate the other transaction read. There is no common item for
first-committer-wins to catch. Fekete et al. characterized this with **dangerous
structures**: two rw-dependency edges forming a cycle among concurrent transactions.

> [!KEY-TAKEAWAY]
> Snapshot isolation prevents write-write anomalies (same row) but permits write skew
> and phantom-based anomalies across different rows, so **SI ≠ SERIALIZABLE**. Oracle's
> "SERIALIZABLE" is actually snapshot isolation and can exhibit write skew; know this.

---

## Serializable snapshot isolation (SSI)

**SSI**, from Cahill, Röhm & Fekete (2008) and shipped in **PostgreSQL 9.1+** as its
true `SERIALIZABLE` level, makes snapshot isolation genuinely serializable while
keeping its optimistic, lock-light nature.

Mechanism: run transactions on snapshots as in SI, but the engine **tracks rw-
dependencies** (transaction A read data that transaction B then wrote) using lightweight
**SIREAD** predicate locks (these do *not* block — they only record). If it detects the
"dangerous structure" — a transaction with both an incoming and an outgoing rw-edge to
concurrent transactions, the pattern that can form a serialization-order cycle — it
**aborts one transaction** with a serialization failure.

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
-- ... reads and writes ...
COMMIT;
-- may raise: ERROR: could not serialize access due to read/write dependencies
--            among transactions  (SQLSTATE 40001)  -> application should RETRY
```

> [!INTERVIEW]
> The single most important operational fact about SSI/optimistic serializable: your
> application **must be prepared to retry** transactions that fail with SQLSTATE
> `40001`. SSI trades blocking for occasional aborts; without a retry loop you turn
> anomalies into user-visible errors.

Trade-offs vs SERIALIZABLE-via-2PL: SSI has better read concurrency (no read locks) but
may abort transactions that a locking scheduler would merely have delayed, and it keeps
extra bookkeeping (predicate lock tables) that can be exhausted by huge transactions
(then it escalates to coarser granularity, raising false-positive aborts).

InnoDB's SERIALIZABLE is *not* SSI — it is snapshot MVCC where plain `SELECT` is
implicitly promoted to `SELECT ... LOCK IN SHARE MODE`, adding read locks (a 2PL-style
approach with next-key locks).

---

## PostgreSQL versus MySQL InnoDB defaults

The two most-asked engines behave differently even at the "same" level.

| | PostgreSQL | MySQL / InnoDB |
|---|---|---|
| Default level | **READ COMMITTED** | **REPEATABLE READ** |
| READ UNCOMMITTED | treated as READ COMMITTED (no dirty reads ever) | true dirty reads allowed |
| REPEATABLE READ semantics | snapshot isolation; phantoms prevented; write-write conflict → abort (40001) | snapshot for plain reads; **gap/next-key locks** prevent phantoms on locking reads |
| SERIALIZABLE | **SSI** (true serializable, optimistic, may abort with 40001) | snapshot + promoting reads to shared locks (2PL-flavored, may deadlock/block) |
| Snapshot taken | per-statement at READ COMMITTED; per-transaction at REPEATABLE READ | per-transaction read view established on first read (RR) |

> [!WARNING]
> A famous InnoDB REPEATABLE READ quirk: plain (**non-locking**) `SELECT` reads from
> the transaction's snapshot, but a **locking** read/write (`SELECT ... FOR UPDATE`,
> `UPDATE`) sees the **latest committed** version, not the snapshot. So an `UPDATE ...
> WHERE` can act on rows your earlier plain `SELECT` didn't see — a source of surprising
> behavior. PostgreSQL is more uniform within a REPEATABLE READ transaction.

> [!TIP]
> Because PostgreSQL's default is READ COMMITTED, each *statement* gets a fresh
> snapshot — you get non-repeatable reads within a transaction by default. If you need a
> stable view across statements (e.g. a report), explicitly use REPEATABLE READ.

---

## Lock types: shared, exclusive, gap and next-key

Even MVCC engines use locks for writes and for stricter levels. Key row-level locks:

- **Shared (S)** — held by readers that need to prevent concurrent modification
  (`SELECT ... FOR SHARE` / `LOCK IN SHARE MODE`). Multiple S locks coexist.
- **Exclusive (X)** — held by writers (`UPDATE`, `DELETE`, `SELECT ... FOR UPDATE`).
  Conflicts with S and X.
- **Record lock** — locks a single index record.
- **Gap lock** (InnoDB) — locks the *gap between* index records so no other transaction
  can INSERT into that range. This is how InnoDB prevents **phantoms** at REPEATABLE
  READ. Gap locks don't conflict with each other, only with inserts into the gap.
- **Next-key lock** (InnoDB) — record lock + gap lock on the gap before it; the default
  locking granularity for range scans at REPEATABLE READ.

```sql
-- InnoDB REPEATABLE READ: this range lock (next-key) blocks inserts of amount>1000
SELECT * FROM orders WHERE amount > 1000 FOR UPDATE;
-- a concurrent INSERT INTO orders(amount) VALUES(5000) now BLOCKS -> no phantom
```

> [!TIP]
> Locking behavior is intent-based: engines use **intention locks** (IS/IX) at the
> table level to signal "I hold row locks below," so a full-table lock request can
> detect the conflict cheaply without scanning every row lock.

> [!WARNING]
> Gap locks can lock more than beginners expect and are a common deadlock source under
> InnoDB REPEATABLE READ. Switching that transaction to READ COMMITTED disables most
> gap locking (only record locks remain) — a real tuning lever, at the cost of allowing
> phantoms.

---

## Optimistic versus pessimistic concurrency control

Two philosophies for handling contention:

**Pessimistic** — assume conflicts are likely; take locks up front so conflicting work
blocks. `SELECT ... FOR UPDATE`, 2PL, table locks. Good when contention is high (writes
frequently collide) because a blocked transaction wastes less work than a repeatedly
aborted one. Risks: reduced concurrency, deadlocks, lock waits/timeouts.

**Optimistic (OCC)** — assume conflicts are rare; don't lock, but **validate at commit**
that no one else touched what you read, and abort+retry if they did. Snapshot isolation
first-committer-wins, SSI, and application-level version columns are all optimistic.
Good under low contention and read-heavy load; degrades badly under high contention
(retry storms — livelock).

Application-level optimistic locking with a version column:

```sql
-- read
SELECT id, data, version FROM items WHERE id = 7;   -- version = 3
-- update only if unchanged
UPDATE items SET data = 'new', version = 4 WHERE id = 7 AND version = 3;
-- if rows_affected = 0  ->  someone else won; re-read and retry
```

> [!INTERVIEW]
> "Optimistic or pessimistic?" The right answer is contention-driven: **low contention
> → optimistic** (cheaper happy path, no lock overhead); **high contention → pessimistic
> or serialized writes** (avoid a retry storm). Also mention that optimistic control
> requires a retry loop and idempotent transactions.

---

## Deadlocks detection and prevention

A **deadlock** is a cycle of transactions each waiting for a lock the other holds:

```
T1: locks row A, then wants row B
T2: locks row B, then wants row A   -> cycle, neither can proceed
```

Databases handle this with a **wait-for graph**: a background checker looks for cycles
and, on finding one, **aborts a victim** (usually the transaction with the least work
done / fewest rows locked) so the other proceeds. PostgreSQL and InnoDB both do
detection; the victim gets an error (`ERROR: deadlock detected` /
`ER_LOCK_DEADLOCK`, SQLSTATE 40001-family) and the app should retry.

InnoDB also uses a **`innodb_lock_wait_timeout`** (default 50s) so a transaction
waiting too long is rolled back even if no cycle is detected. `SHOW ENGINE INNODB
STATUS` displays the latest deadlock.

Prevention / mitigation:
- **Consistent lock ordering** — always acquire rows/tables in the same order (e.g. by
  ascending primary key). This is the #1 practical fix; it makes cycles impossible.
- **Keep transactions short**; touch fewer rows; commit promptly.
- **Lower isolation** where safe (READ COMMITTED reduces gap locking in InnoDB).
- **Use a single atomic statement** instead of read-then-write round trips.
- **Retry on the deadlock error** — deadlock aborts are normal, not exceptional; wrap
  writes in a bounded retry with backoff.

> [!WARNING]
> Deadlock *detection* differs from a *lock wait timeout*: detection resolves true
> cycles quickly; a timeout is a blunt fallback for long waits (including
> non-deadlock contention). Tuning the timeout does not fix a real deadlock — fix lock
> ordering.

---

## Common follow-up questions

- "What's PostgreSQL's default isolation level vs MySQL's?" READ COMMITTED vs
  REPEATABLE READ. Be ready to explain why the difference bites (per-statement vs
  per-transaction snapshots).
- "Is REPEATABLE READ enough to stop phantoms?" Per ANSI, no. In PostgreSQL RR
  (snapshot isolation) and InnoDB RR (gap locks), effectively yes — but only SSI/true
  SERIALIZABLE stops write skew.
- "Why isn't snapshot isolation serializable?" It only catches write-write
  conflicts on the same item; write skew is a read-write conflict across different
  items. Give the doctors-on-call example.
- "How do I prevent a lost update?" Atomic `SET x = x + 1`, `SELECT ... FOR
  UPDATE`, a version/CAS column, or SERIALIZABLE. Explain the read-modify-write race.
- "What does the WAL guarantee and what does fsync have to do with it?" WAL rule:
  log before data page and before commit ack; `fsync` forces the log to durable
  storage so a committed transaction survives a crash.
- "How do you handle serialization/deadlock failures?" Retry loop on SQLSTATE
  40001; keep transactions idempotent and short; order locks consistently.
- "MVCC — where do old row versions live?" PostgreSQL: in the heap (cleaned by
  VACUUM). InnoDB: in the undo log (cleaned by purge).
- "Difference between optimistic and pessimistic locking, and when to use each?"
  Contention-driven; optimistic = validate-at-commit + retry; pessimistic = lock up
  front.

## References

- ISO/IEC 9075 (SQL standard) — transaction and isolation-level definitions.
- Berenson, Bernstein, Gray, Melton, O'Neil, O'Neil, *A Critique of ANSI SQL Isolation
  Levels* (SIGMOD 1995).
- Cahill, Röhm, Fekete, *Serializable Isolation for Snapshot Databases* (SIGMOD 2008) —
  the SSI algorithm behind PostgreSQL SERIALIZABLE.
- Mohan et al., *ARIES: A Transaction Recovery Method* (1992) — WAL / undo-redo.
- Härder & Reuter, *Principles of Transaction-Oriented Database Recovery* (1983) — the
  ACID acronym.
- PostgreSQL documentation — "Transaction Isolation" (ch. 13) and "Reliability and the
  Write-Ahead Log."
- MySQL Reference Manual — "InnoDB Locking and Transaction Model" (isolation levels,
  gap/next-key locks, `innodb_flush_log_at_trx_commit`).
- Kleppmann, *Designing Data-Intensive Applications*, ch. 7 (Transactions) — anomalies,
  weak isolation, write skew, SSI.
- Jepsen analyses (jepsen.io) — empirical isolation-level testing of real databases.
