# Transaction Management

Spring's transaction abstraction gives you a consistent programming model across
different transaction APIs (JDBC, JPA, Hibernate, JTA) and lets you manage
transactions **declaratively** (`@Transactional`) or **programmatically**
(`TransactionTemplate` / `PlatformTransactionManager`). This topic is a favorite
of interviewers because the *declarative* model hides an AOP proxy whose
subtleties (self-invocation, `private` methods, default rollback rules,
propagation semantics) trip up even experienced developers.

---

## ACID

A **transaction** is a unit of work that either fully completes or fully fails.
The classic guarantees are **ACID**:

| Property | Meaning | Who enforces it |
|---|---|---|
| **Atomicity** | All statements commit together, or none do (all-or-nothing). A rollback undoes partial work. | Transaction manager + DB (undo/rollback log) |
| **Consistency** | A transaction moves the DB from one valid state to another, respecting constraints (FKs, checks, triggers). | DB constraints + your business logic |
| **Isolation** | Concurrent transactions don't corrupt each other; the degree is tuned by the *isolation level*. | DB locking / MVCC |
| **Durability** | Once committed, data survives crashes (written to durable storage / WAL). | DB (write-ahead log, fsync) |

**Why it matters:** the canonical example is a bank transfer — debit account A
and credit account B. If the JVM dies after the debit but before the credit,
atomicity (rollback) prevents money vanishing. Spring doesn't *implement* ACID
itself; it *coordinates* the underlying resource (DB / JTA) so ACID holds across
your service method.

**Advanced:** Consistency in the ACID sense is largely the application's/DB's
responsibility, not something the transaction manager magically provides — it
just guarantees that if your logic is correct, partial results are never
persisted. Note also that isolation is a *spectrum*: stronger isolation costs
concurrency, so real systems rarely run at `SERIALIZABLE`.

---

## Declarative vs programmatic transaction management

Spring offers two styles:

**Declarative** — annotate a method/class with `@Transactional`. Spring wraps
the bean in an AOP proxy that starts/commits/rolls back around the method. This
is the dominant style: no boilerplate, transaction demarcation is separated from
business logic.

```java
@Service
public class OrderService {
    @Transactional
    public void placeOrder(Order o) {
        inventory.reserve(o);
        payment.charge(o);   // if this throws, everything rolls back
    }
}
```

**Programmatic** — you control the transaction in code, via `TransactionTemplate`
(preferred) or the raw `PlatformTransactionManager`.

```java
// TransactionTemplate — recommended programmatic style
transactionTemplate.execute(status -> {
    inventory.reserve(o);
    payment.charge(o);
    return null;               // exception or status.setRollbackOnly() -> rollback
});

// Raw PlatformTransactionManager
TransactionStatus status = txManager.getTransaction(new DefaultTransactionDefinition());
try {
    // work...
    txManager.commit(status);
} catch (RuntimeException e) {
    txManager.rollback(status);
    throw e;
}
```

| | Declarative | Programmatic |
|---|---|---|
| Boilerplate | Minimal (annotation) | Explicit code |
| Fine-grained control | Limited (whole method) | Full (partial commits, dynamic rollback) |
| Testability of tx logic | Needs proxy in place | Direct |
| Best for | 95% of business methods | Small blocks, dynamic decisions, non-Spring-managed code |

**Trade-off:** declarative is cleaner but couples you to the proxy mechanism (and
its self-invocation limitation). Programmatic is verbose but works anywhere and
lets you commit part-way. Interviewers like to hear "declarative by default,
programmatic when I need scoped or conditional demarcation."

---

## @Transactional mechanics (AOP proxy)

`@Transactional` is **not** magic on the method — it is implemented with
**Spring AOP**. At startup, if a bean has `@Transactional` (via
`@EnableTransactionManagement`, which Spring Boot auto-enables), Spring creates a
**proxy** around that bean. Callers get the proxy, not the raw object.

Flow on every call to a transactional method:
1. Caller invokes proxy method.
2. `TransactionInterceptor` (an `@Around`-style advice) consults the
   `TransactionAttributeSource` to read the `@Transactional` metadata.
3. It asks the `PlatformTransactionManager` to start/join a transaction
   according to the **propagation** setting.
4. It invokes the **target** method.
5. On normal return → commit. On a rollback-triggering exception → rollback.

**Proxy types:**
- **JDK dynamic proxy** — used when the bean implements at least one interface;
  the proxy implements the same interface(s).
- **CGLIB** — used when there is no interface (subclass-based proxy). Spring Boot
  defaults to CGLIB proxying (`spring.aop.proxy-target-class=true`) so it works
  regardless of interfaces.

**The core consequence:** self-invocation and non-public methods bypass the
interceptor (see the trap subtopic below).

**Advanced internals:** the transaction context (connection, `TransactionStatus`)
is bound to the current thread via `TransactionSynchronizationManager`
(a set of `ThreadLocal`s). That's how a `@Transactional` method and the JDBC
connection it uses share the same transaction — and why classic thread-per-request
transactions don't propagate to a different thread you spawn (e.g. `@Async` or a
new `Thread`).

---

## PlatformTransactionManager

`PlatformTransactionManager` is the central **strategy interface** (SPI) of the
Spring transaction abstraction. Three methods:

```java
public interface PlatformTransactionManager extends TransactionManager {
    TransactionStatus getTransaction(TransactionDefinition definition);
    void commit(TransactionStatus status);
    void rollback(TransactionStatus status);
}
```

You pick an **implementation** matching your persistence tech:

| Implementation | Use with |
|---|---|
| `DataSourceTransactionManager` (a.k.a. `JdbcTransactionManager` in newer Spring) | Plain JDBC / MyBatis / Spring JDBC |
| `JpaTransactionManager` | JPA / Hibernate (as JPA) |
| `HibernateTransactionManager` | Native Hibernate `SessionFactory` |
| `JtaTransactionManager` | Distributed / XA transactions across multiple resources |
| `R2dbcTransactionManager` | Reactive R2DBC |

**Spring Boot auto-configuration** creates the right one for you: with
`spring-boot-starter-data-jpa` you get a `JpaTransactionManager`; with plain
`spring-boot-starter-jdbc` you get a `DataSourceTransactionManager`. You only
declare one manually when you have multiple databases (then you name the manager
via `@Transactional("txManagerName")`).

**Reactive note:** Spring 5.2+ added `ReactiveTransactionManager` for WebFlux;
`@Transactional` on a method returning `Mono`/`Flux` uses it — transaction state
is bound to the Reactor context, not a ThreadLocal.

**Interface hierarchy:** since Spring 5.2 both `PlatformTransactionManager` and
`ReactiveTransactionManager` extend the empty marker interface
`TransactionManager`.

---

## Propagation

Propagation defines what happens when a transactional method is called — does it
join an existing transaction, start a new one, or run without one? Set via
`@Transactional(propagation = Propagation.X)`. Default is **REQUIRED**.

| Propagation | If a tx exists | If NO tx exists |
|---|---|---|
| **REQUIRED** (default) | Join it | Create a new one |
| **REQUIRES_NEW** | Suspend it, start a brand-new independent tx | Create a new one |
| **NESTED** | Create a **savepoint** within the current tx (nested) | Create a new one |
| **SUPPORTS** | Join it | Run **non-transactionally** |
| **MANDATORY** | Join it | **Throw** `IllegalTransactionStateException` |
| **NEVER** | **Throw** `IllegalTransactionStateException` | Run non-transactionally |
| **NOT_SUPPORTED** | Suspend it, run non-transactionally | Run non-transactionally |

**Key distinctions:**
- **REQUIRED vs REQUIRES_NEW** — with REQUIRED, an inner method's failure marks
  the *whole* transaction rollback-only; with REQUIRES_NEW the inner tx commits or
  rolls back **independently** (outer can survive inner's failure, and vice
  versa). REQUIRES_NEW physically **suspends** the outer connection and grabs a
  second connection — beware connection-pool exhaustion and self-deadlock if the
  pool is size 1.
- **NESTED vs REQUIRES_NEW** — NESTED uses a **JDBC savepoint** inside the *same*
  physical transaction/connection. Rolling back the nested part reverts to the
  savepoint but the outer tx continues; however if the **outer** rolls back,
  the nested work is also lost (it was never independently committed). NESTED
  requires a resource manager that supports savepoints (JDBC does; many JPA
  setups do not — `JpaTransactionManager` does not support NESTED and throws
  `NestedTransactionNotSupportedException`).
- **MANDATORY** enforces "I must be called inside someone else's transaction."
- **NEVER** enforces "I must NOT be called inside a transaction."
- **NOT_SUPPORTED** runs the body with no transaction (suspends any existing one)
  — useful for long-running read-only reporting that shouldn't hold locks.

**Advanced gotcha:** suspension (REQUIRES_NEW, NOT_SUPPORTED) only truly works
when the transaction manager supports it. Also, propagation is evaluated by the
proxy — so an inner `REQUIRES_NEW` method called via `this.` from the same bean
gets **no new transaction at all** (self-invocation trap).

---

## Isolation levels & anomalies

Isolation controls how/when one transaction's changes become visible to others.
Set via `@Transactional(isolation = Isolation.X)`. `DEFAULT` means "use the
database's default" (e.g. `READ_COMMITTED` for PostgreSQL/Oracle/SQL Server,
`REPEATABLE_READ` for MySQL InnoDB).

**The three classic read anomalies:**
- **Dirty read** — you read another transaction's *uncommitted* change; it may
  later roll back, so you read data that never officially existed.
- **Non-repeatable read** — you read a row, another tx commits an *update* to it,
  you re-read the same row and get a different value within your own tx.
- **Phantom read** — you run a range query (`WHERE age > 30`), another tx commits
  an *insert/delete* matching that predicate, you re-run the query and rows
  appear/disappear.

**Which level prevents which:**

| Isolation level | Dirty read | Non-repeatable read | Phantom read |
|---|---|---|---|
| **READ_UNCOMMITTED** | ❌ possible | ❌ possible | ❌ possible |
| **READ_COMMITTED** | ✅ prevented | ❌ possible | ❌ possible |
| **REPEATABLE_READ** | ✅ prevented | ✅ prevented | ❌ possible* |
| **SERIALIZABLE** | ✅ prevented | ✅ prevented | ✅ prevented |

*Per the SQL standard REPEATABLE_READ allows phantoms; MySQL InnoDB's
REPEATABLE_READ uses next-key locking / MVCC snapshots and prevents most phantoms
in practice — a common interview nuance.

**Trade-off:** higher isolation = more locking/blocking = less throughput and
more deadlocks. `SERIALIZABLE` is the safest and slowest. Most apps run at
`READ_COMMITTED` and use optimistic locking (`@Version`) or `SELECT ... FOR
UPDATE` for the few spots that need more.

**Advanced gotcha:** isolation is only honored when a *new physical* transaction
starts. If a `@Transactional(isolation = SERIALIZABLE)` method **joins** an
existing REQUIRED transaction that started at READ_COMMITTED, Spring by default
**throws** `IllegalTransactionStateException` on isolation mismatch only if
`validateExistingTransaction` is on; otherwise the requested isolation is
**silently ignored** — the inner participates at the outer's level. Also,
`isolation` on `@Transactional` is not supported by `JpaTransactionManager` in
older setups unless the datasource/Hibernate allows per-tx isolation.

---

## Rollback rules (rollbackFor)

**The single most tested trap:** by default, Spring rolls back **only on
unchecked exceptions** — subclasses of `RuntimeException` and `Error`. Checked
exceptions do **NOT** trigger rollback by default; the transaction **commits**.

```java
@Transactional
public void save() throws IOException {
    repo.insert(...);
    throw new IOException("boom");   // DEFAULT: transaction COMMITS! (checked)
}
```

This surprises people coming from EJB (where the same default exists but is
often forgotten). To roll back on a checked exception:

```java
@Transactional(rollbackFor = IOException.class)          // roll back on this checked ex
@Transactional(rollbackFor = Exception.class)            // roll back on ANY exception
@Transactional(noRollbackFor = IllegalStateException.class)  // do NOT roll back on this unchecked ex
```

Rules of resolution:
- `rollbackFor` / `rollbackForClassName` — additional throwables that force rollback.
- `noRollbackFor` / `noRollbackForClassName` — throwables that should NOT roll back.
- The most **specific** matching rule wins (by class hierarchy distance).
- If no custom rule matches, the default (rollback on unchecked + Error) applies.

**Other gotchas:**
- If you **catch** the exception inside the method and don't rethrow, Spring never
  sees it → **commit**. To force rollback without rethrowing, call
  `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()`.
- Once a transaction is marked rollback-only (e.g. an inner REQUIRED method
  failed), the outer commit throws
  `UnexpectedRollbackException` ("Transaction rolled back because it has been
  marked as rollback-only") — a very common "why did my commit fail?" question.

---

## readOnly

`@Transactional(readOnly = true)` is a **hint** that the transaction won't modify
data. It matters most with JPA/Hibernate:

- Hibernate sets the `FlushMode` to `MANUAL`/`NEVER`, so it **skips dirty
  checking and auto-flush** — a real performance win for read-heavy service
  methods (no snapshot comparisons, entities effectively read-only).
- The JDBC connection is flagged `Connection.setReadOnly(true)`, which some
  drivers/DBs use to route to read replicas or optimize.

**Important nuances:**
- `readOnly` is **not** a hard guarantee against writes at the Spring level; if
  you actually issue an update the DB (or Hibernate flush) may reject or ignore
  it depending on setup. It's an optimization/intent hint, not a security
  control.
- It only takes effect when a **new** transaction begins; setting it while
  joining an existing read-write tx has no effect.
- Common pattern: annotate read query methods `readOnly = true` and let write
  methods use the default.

---

## timeout

`@Transactional(timeout = N)` sets the maximum time in **seconds** the transaction
may run before it is rolled back. `-1` (`TIMEOUT_DEFAULT`) means use the
underlying default (usually none).

- The clock starts when the transaction begins; if the accumulated time is
  exceeded at the next resource interaction (e.g. a statement execution), the
  transaction is rolled back with a `TransactionTimedOutException`.
- It's enforced cooperatively via the transaction synchronization + the JDBC
  statement query timeout — a single long-running statement that doesn't yield
  may or may not be interrupted depending on the driver.
- Like `readOnly`/`isolation`, `timeout` applies to the transaction that is
  **created**; a method joining an existing transaction can't shorten its parent.
- `timeoutString` (Spring 6+) allows a property-placeholder value.

Use it to bound worst-case lock-holding time so a stuck transaction doesn't pin
connections/locks forever.

---

## The self-invocation / private method trap (proxy bypass)

**This is the #1 `@Transactional` interview trap.** Because declarative
transactions are proxy-based, `@Transactional` is only honored when the call goes
**through the proxy**.

**Self-invocation** — a method calling another method of the *same bean* via
`this`:

```java
@Service
public class UserService {
    public void outer() {
        inner();                 // internal call -> goes to 'this', NOT the proxy
    }
    @Transactional
    public void inner() {        // NO transaction when called from outer()!
        repo.save(...);
    }
}
```

`outer()` calls `this.inner()`, bypassing the proxy, so the
`TransactionInterceptor` never runs and `inner()` executes with **no
transaction**. The same applies to a transactional `outer()` calling a
`REQUIRES_NEW inner()` — no new transaction is created.

**Why:** the proxy wraps the *bean reference* held by other beans. Inside the
target object, `this` is the raw instance, not the proxy, so advice is skipped.

**`private`/non-public methods** — Spring's proxy-based `@Transactional` is only
applied to **public** methods. On `private`, `protected`, or package-private
methods the annotation is **silently ignored** (with JDK/CGLIB proxying). (AspectJ
compile/load-time weaving *can* handle non-public and self-invocation, because it
modifies the bytecode directly rather than using a proxy.) Also, on CGLIB, a
`final` method or `final` class cannot be proxied.

**Fixes:**
1. **Split into two beans** so the call crosses a proxy boundary (cleanest).
2. **Self-inject the proxy** and call through it:
   ```java
   @Autowired private UserService self;   // injected proxy
   public void outer() { self.inner(); }
   ```
   or `AopContext.currentProxy()` with `exposeProxy = true`.
3. Use **programmatic** transactions (`TransactionTemplate`) in `outer()`.
4. Use **AspectJ** weaving (`mode = AdviceMode.ASPECTJ`) — no proxy, so
   self-invocation and non-public methods work.

**Bonus trap:** `@Transactional` on an interface method with JDK proxies works,
but Spring recommends annotating **concrete classes**, because CGLIB proxies
can't see interface-level annotations.

---

## Common follow-up questions

- **Why does my checked exception commit instead of rolling back?** Default
  rollback is unchecked + Error only; add `rollbackFor = Exception.class`.
- **Why is `@Transactional` on my `private` method ignored?** Proxy-based tx only
  advises public methods; make it public and call it through the proxy, or use
  AspectJ.
- **I call a `@Transactional` method from another method in the same class and it
  doesn't start a transaction — why?** Self-invocation bypasses the proxy.
- **REQUIRED vs REQUIRES_NEW — when to use which?** REQUIRES_NEW for work that
  must commit independently (audit logs, sending a notification record) even if
  the outer tx rolls back; REQUIRED for normal "all-or-nothing" flows.
- **Difference between NESTED and REQUIRES_NEW?** NESTED = savepoint in the same
  physical tx (rolls back to savepoint, dies with the outer); REQUIRES_NEW =
  separate physical tx/connection, commits independently.
- **What is `UnexpectedRollbackException`?** The outer tx tried to commit but was
  marked rollback-only by a failed inner participating tx.
- **Does `@Transactional` work across threads (`@Async`, new Thread)?** No — the
  tx context is thread-bound via ThreadLocal; the new thread has no transaction.
- **JDK proxy vs CGLIB for transactions?** JDK when interfaces exist (interface
  proxy), CGLIB otherwise (subclass); Spring Boot defaults to CGLIB.
- **What does `readOnly = true` actually do?** Hibernate skips dirty checking /
  flush; sets JDBC connection read-only hint — a performance optimization, not a
  write guard.
- **Which package for `@Transactional` in Spring Boot 3?** Use
  `org.springframework.transaction.annotation.Transactional` (Spring's), or the
  Jakarta `jakarta.transaction.Transactional` (note: `javax.*` → `jakarta.*` in
  Boot 3 / Spring 6). Spring's variant supports more attributes (isolation,
  timeout, readOnly, rollbackFor).

---

## References

- Spring Framework Reference — Data Access / Transaction Management:
  https://docs.spring.io/spring-framework/reference/data-access/transaction.html
- Spring Framework Reference — Declarative Transaction Management:
  https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative.html
- Javadoc — `Propagation`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Propagation.html
- Javadoc — `Isolation`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Isolation.html
- Javadoc — `PlatformTransactionManager`:
  https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/PlatformTransactionManager.html
- Baeldung — Transactions with Spring and JPA:
  https://www.baeldung.com/transaction-configuration-with-spring-and-jpa
- Baeldung — `@Transactional` propagation and isolation:
  https://www.baeldung.com/spring-transactional-propagation-isolation
- Baeldung — self-invocation / AOP proxy limitations:
  https://www.baeldung.com/spring-aop-vs-aspectj
- Vlad Mihalcea — the best way to use `@Transactional`:
  https://vladmihalcea.com/spring-transaction-best-practices/
