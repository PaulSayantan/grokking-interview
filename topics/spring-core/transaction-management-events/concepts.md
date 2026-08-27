# Transaction Management and Events

Spring provides a consistent programming model for transaction management that works across different transaction APIs (JDBC, JPA, Hibernate, JTA) and a lightweight, in-process event mechanism for decoupling components. This note covers both, layered from beginner fundamentals to advanced internals. Everything here is about the **Spring Framework core** (the `spring-tx` and `spring-context` modules), not Spring Boot — where Boot differs (e.g. auto-configuring a transaction manager) it is called out explicitly.

---

## Declarative vs Programmatic Transaction Management

Spring supports two styles of transaction demarcation. Both ultimately drive the same abstraction (`PlatformTransactionManager`), so they differ in *how you express* transaction boundaries, not in the underlying machinery.

**Declarative transaction management** is the recommended, non-invasive approach. You annotate a method or class with `@Transactional` (or configure `<tx:advice>` in XML) and Spring's AOP infrastructure wraps the bean in a proxy that begins, commits, or rolls back the transaction around the method call. Your business code contains **no transaction API calls** — the concern is externalized to metadata.

```java
@Service
public class AccountService {
    @Transactional
    public void transfer(Long from, Long to, BigDecimal amount) {
        accountRepository.debit(from, amount);
        accountRepository.credit(to, amount);
        // commit happens automatically after this returns;
        // rollback happens automatically if a RuntimeException propagates
    }
}
```

**Programmatic transaction management** means you write the demarcation code yourself. Spring offers two APIs:

- `TransactionTemplate` — a template-callback helper that runs a `TransactionCallback` inside a transaction, committing on normal return and rolling back on unchecked exceptions (or when you call `setRollbackOnly()`).
- `PlatformTransactionManager` used directly — you call `getTransaction(definition)`, then `commit(status)` or `rollback(status)` in a try/catch.

```java
// TransactionTemplate
private final TransactionTemplate txTemplate; // built from a PlatformTransactionManager

public void transfer(...) {
    txTemplate.executeWithoutResult(status -> {
        accountRepository.debit(from, amount);
        accountRepository.credit(to, amount);
    });
}

// Direct PlatformTransactionManager
public void transfer(...) {
    TransactionStatus status = txManager.getTransaction(new DefaultTransactionDefinition());
    try {
        accountRepository.debit(from, amount);
        accountRepository.credit(to, amount);
        txManager.commit(status);
    } catch (RuntimeException ex) {
        txManager.rollback(status);
        throw ex;
    }
}
```

| Aspect | Declarative (`@Transactional`) | Programmatic (`TransactionTemplate` / manager) |
|---|---|---|
| Intrusiveness | Non-invasive; no tx code in business logic | Tx code interleaved with business logic |
| Granularity | Method/class level | Any arbitrary block of code |
| Configuration | Annotation / XML advice | Java code |
| Typical use | The default choice for the vast majority of cases | Fine-grained control, few isolated tx blocks, or when you cannot use a proxy |
| Mechanism | AOP proxy | Direct API calls |

**When to prefer programmatic**: you need transactional control at a granularity smaller than a method, you want to commit part-way and continue, or you are in a context where proxying is unavailable/awkward. Otherwise, declarative is idiomatic Spring.

---

## Transactional Annotation and PlatformTransactionManager

`PlatformTransactionManager` is the central strategy interface of Spring's transaction abstraction. It has just three methods:

```java
public interface PlatformTransactionManager extends TransactionManager {
    TransactionStatus getTransaction(TransactionDefinition definition);
    void commit(TransactionStatus status);
    void rollback(TransactionStatus status);
}
```

The key idea is that transaction *demarcation* is decoupled from the *resource-specific API*. You program against `PlatformTransactionManager` (and `TransactionDefinition`/`TransactionStatus`) and choose a concrete implementation to match your persistence technology:

| Implementation | Use with |
|---|---|
| `DataSourceTransactionManager` | Plain JDBC / MyBatis / Spring JDBC on a single `DataSource` |
| `JpaTransactionManager` | JPA (`EntityManagerFactory`) |
| `HibernateTransactionManager` | Native Hibernate `SessionFactory` |
| `JtaTransactionManager` | Global/distributed (XA) transactions across multiple resources |
| `R2dbcTransactionManager` | Reactive R2DBC (implements the reactive `ReactiveTransactionManager`, not `PlatformTransactionManager`) |

`TransactionDefinition` carries the transaction attributes (propagation, isolation, timeout, read-only, rollback rules). `TransactionStatus` represents the runtime state of the current transaction (whether it is new, whether it is a rollback-only, savepoint handling for nested transactions) and exposes `setRollbackOnly()`.

**`@Transactional`** is the declarative metadata that Spring translates into a `TransactionDefinition`. Its important attributes:

- `propagation` — how the method participates in existing transactions (default `REQUIRED`).
- `isolation` — the isolation level (default `DEFAULT`, meaning the datastore's default).
- `timeout` — seconds before the transaction times out (default: use the underlying default).
- `readOnly` — hint that the transaction only reads (default `false`).
- `rollbackFor` / `rollbackForClassName` — additional exception types that trigger rollback.
- `noRollbackFor` / `noRollbackForClassName` — exception types that should **not** trigger rollback.
- `transactionManager` (alias `value`) — the bean name of the `PlatformTransactionManager` to use, when there are several (a *qualifier*).

There are two annotations named `@Transactional`:

- **`org.springframework.transaction.annotation.Transactional`** — Spring's own, richest set of attributes.
- **`jakarta.transaction.Transactional`** (formerly `javax.transaction.Transactional`, JTA 1.2 / Jakarta) — a subset; Spring understands it too. In Spring Framework 6.x (which targets Jakarta EE 9+), the JTA annotation is in the `jakarta.transaction` package; on Spring 5.x it was `javax.transaction`.

Where to put it: `@Transactional` can go on a class (applies to all public methods), on a method (overrides class-level), or on an interface (discouraged because it only works with interface-based JDK dynamic proxies, not CGLIB class proxies).

```java
@Transactional(
    propagation = Propagation.REQUIRED,
    isolation = Isolation.READ_COMMITTED,
    timeout = 30,
    readOnly = false,
    rollbackFor = IOException.class,
    transactionManager = "orderTxManager")
public void placeOrder(Order o) throws IOException { ... }
```

---

## EnableTransactionManagement

`@EnableTransactionManagement` is the Java-config switch that turns on Spring's annotation-driven transaction support. It is placed on a `@Configuration` class and is the XML `<tx:annotation-driven/>` equivalent.

```java
@Configuration
@EnableTransactionManagement
public class AppConfig {
    @Bean
    public PlatformTransactionManager txManager(DataSource ds) {
        return new DataSourceTransactionManager(ds);
    }
}
```

What it does under the hood: it registers the infrastructure beans that make `@Transactional` work — chiefly a `BeanFactoryTransactionAttributeSourceAdvisor` (a pointcut/advice pair) whose advice is a `TransactionInterceptor`, plus an `AnnotationTransactionAttributeSource` to read the annotations. These are registered through the `ProxyTransactionManagementConfiguration` (or an AspectJ variant). At runtime, an `AbstractAutoProxyCreator` post-processes beans whose methods match, wrapping them in AOP proxies.

Important attributes of `@EnableTransactionManagement`:

- `mode` — `PROXY` (default, Spring AOP proxies) or `ASPECTJ` (compile/load-time weaving; enables self-invocation and `private`/`protected` transactional methods).
- `proxyTargetClass` — `false` (default) uses JDK dynamic proxies when interfaces exist; `true` forces CGLIB subclass proxies. Only relevant in `PROXY` mode.
- `order` — the order of the transaction advisor relative to other advisors (default `Ordered.LOWEST_PRECEDENCE`).

**Spring vs Spring Boot note**: In plain Spring Framework you must add `@EnableTransactionManagement` yourself and declare a `PlatformTransactionManager` bean. Spring Boot auto-configures both when it detects a transaction manager on the classpath (via `TransactionAutoConfiguration`), so you often see `@Transactional` "just work" without the enable annotation — that is a Boot convenience, not a core Spring behavior.

You need exactly one enabling mechanism (`@EnableTransactionManagement` **or** `<tx:annotation-driven/>`), not both.

**Transaction manager resolution (the multi-manager gotcha).** With no `transactionManager`/`value` qualifier on `@Transactional`, the `TransactionInterceptor` lazily resolves a manager by type from the `BeanFactory` the *first time* the advised method runs — not at startup. If exactly one `PlatformTransactionManager`/`TransactionManager` bean exists, it is used. If several exist, resolution falls back to a `@Primary` bean, else a bean literally named `transactionManager`; if neither disambiguates you get a `NoUniqueBeanDefinitionException` at first invocation. Because this is lazy, a misconfigured qualifier can pass context startup and only blow up at runtime under the first transactional call.

**Advisor ordering matters.** The transaction advisor is registered at `Ordered.LOWEST_PRECEDENCE` by default, so it typically sits *innermost* relative to other advice. This has real consequences: if you have a `@Transactional` method and a caching or `@Async` aspect, the *order* determines whether caching happens inside or outside the transaction, and whether `@Async` moves execution to another thread *before* the transaction begins (which it does — an `@Async` `@Transactional` method starts its transaction on the async worker thread, not the caller's). Set `@EnableTransactionManagement(order = ...)` to reposition it. Also note the classic combination trap: on a single bean, an `@Async` method that internally self-invokes a `@Transactional` method gets neither aspect on the inner call (self-invocation), and stacking both annotations on one method means only one proxy wraps it — the transaction runs on the async thread.

**`AdviceMode.ASPECTJ` needs the aspect on the classpath.** In `ASPECTJ` mode Spring expects `AnnotationTransactionAspect` (from `spring-aspects`) and load-time or compile-time weaving to be configured. Merely setting `mode = ASPECTJ` without the weaver in place silently gives you *no* transactions — a subtle production trap.

---

## Transaction Propagation

Propagation defines how a transactional method behaves when it is called with (or without) an already-active transaction. It is set via `@Transactional(propagation = ...)`. Spring defines seven propagation behaviors; the three most-discussed are `REQUIRED`, `REQUIRES_NEW`, and `NESTED`.

| Propagation | If a transaction exists | If no transaction exists |
|---|---|---|
| `REQUIRED` (default) | Join the existing one | Create a new one |
| `REQUIRES_NEW` | Suspend the current one, start a brand-new independent one | Create a new one |
| `NESTED` | Create a nested transaction via a JDBC **savepoint** | Behaves like `REQUIRED` (create new) |
| `SUPPORTS` | Join the existing one | Run non-transactionally |
| `NOT_SUPPORTED` | Suspend the current one, run non-transactionally | Run non-transactionally |
| `MANDATORY` | Join the existing one | Throw `IllegalTransactionStateException` |
| `NEVER` | Throw `IllegalTransactionStateException` | Run non-transactionally |

**REQUIRED** is the workhorse: the caller and callee share one physical transaction, so a rollback anywhere marks the whole thing rollback-only and everything is committed or rolled back together.

**REQUIRES_NEW** suspends the outer transaction and runs the inner in a completely independent physical transaction (its own connection). The inner can commit or roll back regardless of the outer's fate — useful for audit logs or must-persist side effects. Because it uses a second connection while the first is suspended, watch for connection-pool exhaustion.

**NESTED** uses a single physical transaction with a **savepoint** taken before the nested block. If the nested block fails, Spring rolls back to the savepoint (partial rollback) while the outer transaction can still commit. It requires a resource manager that supports JDBC savepoints (`DataSourceTransactionManager` does; `JpaTransactionManager` support depends on the setup, and JTA generally does not).

Key distinction interviewers probe: `REQUIRES_NEW` = two independent transactions (two commits possible); `NESTED` = one transaction with an inner savepoint (only the outer truly commits, inner failures roll back to the savepoint).

**Physical vs. logical transactions (the mental model that unlocks the hard questions).** Spring distinguishes a *physical* transaction (the real resource transaction — one JDBC `Connection` with its commit/rollback) from a *logical* transaction scope (each `@Transactional` method invocation). `REQUIRED` creates a **new logical scope per method but maps all of them onto the same physical transaction**. This is why a participating (inner) `REQUIRED` method that sets rollback-only dooms the *whole* physical transaction: when the outermost scope — the one that actually created the physical transaction — reaches commit, Spring sees the rollback-only flag and throws `UnexpectedRollbackException` rather than misleading the caller into thinking a commit happened.

**Joining silently ignores the inner definition.** When a `REQUIRED` method *joins* an existing transaction, its own `isolation`, `timeout`, and `readOnly` attributes are **silently ignored** — the outer transaction's characteristics win. Only the scope that physically starts the transaction gets to set these. If you want Spring to *reject* a mismatch instead of silently ignoring it, set `validateExistingTransaction = true` on the transaction manager (non-lenient mode also rejects read-only mismatches).

**`globalRollbackOnParticipationFailure`.** By default (`true`) on `AbstractPlatformTransactionManager`, if a participating (`REQUIRED`) transaction fails, the *entire* physical transaction is marked rollback-only — the root cause of the `UnexpectedRollbackException` symptom above. Setting it to `false` lets the outer scope still attempt to commit despite a participating failure (rarely advisable; it can commit partially-failed work).

**Suspension is real resource bookkeeping.** `REQUIRES_NEW` and `NOT_SUPPORTED` *suspend* the current transaction: Spring unbinds the existing resources (e.g. the `Connection`) from the thread via `TransactionSynchronizationManager`, holds them in a `SuspendedResourcesHolder`, runs the inner work (acquiring a **second** connection for `REQUIRES_NEW`), then rebinds the originals on resume. Because the outer connection stays bound (idle) while the inner one is in use, a pool sized to the thread count can **deadlock**: every thread holds its outer connection and blocks waiting for an inner one. Spring's guidance: size the pool to exceed concurrent threads by at least 1.

**Worked example — the deadlock with real numbers.** Pool size = **10**. Ten request threads arrive at once, each entering an outer `REQUIRED` method that then calls a `REQUIRES_NEW` method:

```
Step 1: each of the 10 threads begins its outer tx -> grabs 1 connection.
        Pool: 10 checked out, 0 free.  (10 outer connections, all suspended-but-still-bound)
Step 2: each thread enters the REQUIRES_NEW method -> asks for a 2nd connection.
        Pool has 0 free. All 10 threads block, waiting for a connection to return.
Step 3: no thread can release its outer connection until its inner tx finishes,
        and no inner tx can start until it gets a connection. Circular wait -> deadlock.
```

Every thread needs 2 connections but holds 1 and the pool is empty, so nobody can make progress; the threads eventually die on the pool's connection-timeout. Raise the pool to **11**: now one thread gets the 11th connection for its inner tx, commits it, returns it, that thread finishes and frees its outer connection too, and the freed connections cascade to unblock the rest. In production you size for `maxConcurrentThreads + (nesting depth)`, not just thread count.

**`NESTED` is JDBC-savepoint-only.** It maps onto JDBC `Savepoint`s and therefore works with `DataSourceTransactionManager` (JDBC resource transactions). It does **not** work over JTA, and JPA/Hibernate support is conditional (the underlying JDBC driver and dialect must support savepoints, and `nestedTransactionAllowed` must be enabled). If nesting is requested but unsupported, Spring throws `NestedTransactionNotSupportedException`.

```java
@Transactional // REQUIRED
public void placeOrder(Order o) {
    orderRepo.save(o);
    auditService.record(o); // if this is REQUIRES_NEW, its commit survives even if placeOrder later rolls back
}

@Transactional(propagation = Propagation.REQUIRES_NEW)
public void record(Order o) { auditRepo.save(new Audit(o)); }
```

---

## Isolation Levels

Isolation controls how/when the changes made by one transaction become visible to others — i.e., how the database protects you from concurrency anomalies. Spring exposes the standard ANSI SQL levels via the `Isolation` enum on `@Transactional`, delegating the actual enforcement to the database.

The three classic read phenomena:

- **Dirty read** — reading another transaction's *uncommitted* changes.
- **Non-repeatable read** — re-reading a row within the same transaction yields different values because another committed transaction updated it.
- **Phantom read** — re-running a range query yields new rows because another committed transaction inserted rows matching the predicate.

| Isolation level | Dirty read | Non-repeatable read | Phantom read |
|---|---|---|---|
| `READ_UNCOMMITTED` | Possible | Possible | Possible |
| `READ_COMMITTED` | Prevented | Possible | Possible |
| `REPEATABLE_READ` | Prevented | Prevented | Possible |
| `SERIALIZABLE` | Prevented | Prevented | Prevented |

`Isolation.DEFAULT` (the Spring default) means "use the underlying datastore's default." Common defaults: PostgreSQL and Oracle default to `READ_COMMITTED`; MySQL/InnoDB defaults to `REPEATABLE_READ`. Higher isolation = stronger consistency but more locking/aborts and lower concurrency.

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
public Report buildReport() { ... }
```

**Worked traces — watch each anomaly interleave.** The matrix is abstract until you interleave two transactions on a clock and see the same read return a different answer. `-->` marks time flowing down; the right column is T2.

*Dirty read* (only at `READ_UNCOMMITTED`) — T1 reads a value that never really existed:

```
T1: BEGIN (READ_UNCOMMITTED)
T1: SELECT balance WHERE id=1  --> 100
                                        T2: BEGIN
                                        T2: UPDATE balance=50 WHERE id=1   (NOT committed)
T1: SELECT balance WHERE id=1  --> 50   <-- dirty: read T2's uncommitted write
                                        T2: ROLLBACK  (balance is back to 100)
T1 acted on 50, a value that was rolled away.
```

*Non-repeatable read* (still possible at `READ_COMMITTED`) — same row, re-read, different value because a committed update slipped in between:

```
T1: BEGIN (READ_COMMITTED)
T1: SELECT balance WHERE id=1  --> 100
                                        T2: BEGIN
                                        T2: UPDATE balance=50 WHERE id=1
                                        T2: COMMIT
T1: SELECT balance WHERE id=1  --> 50   <-- non-repeatable: same query, new answer
T1: COMMIT
```

Bump T1 to `REPEATABLE_READ` and its second `SELECT` still returns **100** — its snapshot/read locks pin the row for T1's whole life, so T2's committed change is invisible until T1 ends.

*Phantom read* (still possible at ANSI `REPEATABLE_READ`) — differs from a non-repeatable read in that no existing row changed; a **new row appeared** in the range:

```
T1: BEGIN (REPEATABLE_READ)
T1: SELECT COUNT(*) WHERE age>30  --> 5
                                        T2: BEGIN
                                        T2: INSERT INTO person(age) VALUES (40)
                                        T2: COMMIT
T1: SELECT COUNT(*) WHERE age>30  --> 6   <-- phantom: a row that matches the predicate materialized
T1: COMMIT
```

At `SERIALIZABLE` the range predicate itself is locked (or T1 is aborted with a serialization error), so the second `COUNT(*)` still returns **5**. The mental hook: non-repeatable read = *a row I already saw changed*; phantom = *a new row entered my search results*.

Caveats: not all databases implement every level (some map unsupported levels up to a stronger one); and with `DataSourceTransactionManager` a custom isolation level is applied to the JDBC `Connection` and reset afterward. With `JtaTransactionManager`, per-transaction isolation typically is not portable and may require vendor-specific extensions.

**The ANSI table is a floor, not what your engine actually does.** The levels above are *minimum* guarantees; real engines are frequently stronger or different, and interviewers push on this. MySQL/InnoDB's `REPEATABLE_READ` uses next-key/gap locks that eliminate most phantoms — so the "Possible" cell for phantoms at RR does not hold in practice on InnoDB. PostgreSQL is MVCC-based, so `READ_COMMITTED` already avoids dirty reads cheaply via snapshots, and its `SERIALIZABLE` is implemented as SSI (Serializable Snapshot Isolation) — optimistic rather than lock-blocking, so it can abort a transaction at commit with a `serialization_failure` (SQLSTATE 40001), meaning your code must be ready to **retry**. So "what isolation gives you" is engine-specific; name the engine before you reason about the anomaly.

---

## Rollback Rules

By default, Spring's declarative transactions roll back **only on unchecked exceptions** — that is, `RuntimeException` and `Error` (and their subclasses). **Checked exceptions do NOT trigger a rollback by default**; the transaction commits even though a checked exception propagated. This surprises many developers and is a frequent interview question.

This default comes from EJB conventions and the reasoning that checked exceptions are often "business" outcomes the caller is expected to handle, while unchecked exceptions signal programming/system errors.

```java
@Transactional
public void doWork() throws BusinessException {
    repo.save(x);
    if (invalid) throw new BusinessException("nope"); // CHECKED -> commits anyway by default!
}
```

You customize this with rollback rules:

- `rollbackFor = SomeCheckedException.class` — roll back on that checked type too.
- `noRollbackFor = SomeRuntimeException.class` — do NOT roll back on that unchecked type.

```java
@Transactional(rollbackFor = BusinessException.class,
               noRollbackFor = ResourceNotFoundException.class)
public void doWork() throws BusinessException { ... }
```

Rule resolution: Spring uses the **most specific** matching rule by exception-class inheritance distance. Rules can be positive (rollback) or negative (no-rollback), and the winning rule for a thrown exception is the one whose exception type is the closest supertype. If no custom rule matches, the default (rollback on unchecked only) applies.

**Worked example — counting hops when rollback and no-rollback compete.** Take this hierarchy and these rules:

```
RuntimeException
   └── AppException          (rollbackFor   = AppException.class)
         └── PaymentException  (noRollbackFor = PaymentException.class)
```

*Case A — a `PaymentException` is thrown.* Measure hops from the thrown type up to each rule's type:
- to `PaymentException` (noRollbackFor): 0 hops.
- to `AppException` (rollbackFor): 1 hop.

Smallest depth wins → `PaymentException` at depth 0 → it is a **no-rollback** rule → the transaction **COMMITS** (even though a subclass of `AppException`, which we asked to roll back, propagated out).

*Case B — a plain `AppException` (not the `PaymentException` subtype) is thrown:*
- to `AppException` (rollbackFor): 0 hops.
- to `PaymentException` (noRollbackFor): not a supertype of `AppException` → does not match at all.

Only `rollbackFor` matches, at depth 0 → the transaction **ROLLS BACK**. Same two rules, opposite outcomes, decided purely by which rule's type sits closer above the exception actually thrown.

Additional mechanisms:

- In programmatic code or from inside a method, call `TransactionInterceptor.currentTransactionStatus().setRollbackOnly()` (or use the injected `TransactionStatus`) to force rollback without throwing.
- Once a transaction is marked rollback-only, a participating (`REQUIRED`) outer transaction that tries to commit will fail with `UnexpectedRollbackException` — a classic symptom when an inner method's exception is caught but the transaction was already doomed.

**Rollback rules are matched on the *thrown* exception's type, not the declared one, and there is no "checked vs unchecked" nuance once you list a type.** Rule matching uses inheritance distance: for each candidate rule, Spring measures how many superclass hops separate the thrown exception from the rule's type; the rule with the smallest positive depth wins, and a negative (`noRollbackFor`) win means *no* rollback. A subtle trap: `rollbackFor = Exception.class` will match essentially everything (including `RuntimeException`), and if you also list `noRollbackFor = SomeException.class` for a more specific subtype, the more specific `noRollbackFor` wins for that subtype. Another trap: the rollback decision is made by the `TransactionInterceptor` based on what *propagates out* of the method — if you catch the exception inside the method and return normally, the transaction commits (and if an inner `REQUIRED` scope had already marked it rollback-only, you get `UnexpectedRollbackException` at commit instead).

---

## readOnly Transactions

`@Transactional(readOnly = true)` is a **hint** that the transaction will only read data. It is not a hard guarantee that writes are blocked by Spring itself; what it does depends on the transaction manager and the underlying resource.

What `readOnly` can enable:

- **JDBC / `DataSourceTransactionManager`**: sets `Connection.setReadOnly(true)`, which the JDBC driver/database may use to optimize (e.g., route to a read replica, skip certain locking). Effect is driver-dependent.
- **Hibernate / JPA**: the biggest practical benefit. Hibernate sets the flush mode to `MANUAL`/`NEVER` so the persistence context is **not dirty-checked and not flushed**, avoiding unnecessary `UPDATE` statements and reducing memory/CPU overhead. This can meaningfully speed up read-heavy service methods.
- Some managers/databases may reject write operations attempted within a read-only transaction, but you should not rely on `readOnly` for security/enforcement.

```java
@Transactional(readOnly = true)
public List<Customer> findAll() { return customerRepo.findAll(); }
```

Gotchas:
- `readOnly` is evaluated when the transaction is **created**. For propagation `REQUIRED`, a method joining an existing (writable) transaction cannot "downgrade" it to read-only — the outer definition wins.
- Combining `readOnly = true` with a write inside a Hibernate context can lead to changes not being flushed (silently ignored), which is confusing if unexpected.

---

## Proxy-based Self-invocation and Private-method Limitation

Spring's declarative transactions default to **proxy-based AOP** (`mode = PROXY`). The proxy intercepts *external* calls to the bean and applies the transaction advice before delegating to the target. This design creates two well-known limitations.

**Self-invocation**: when a method of a bean calls **another method of the same bean via `this`**, the call does not go through the proxy — it is a direct in-object call — so any `@Transactional` (or other AOP) advice on the invoked method is **bypassed**.

```java
@Service
public class OrderService {
    public void process() {
        // 'this.save()' bypasses the proxy: save()'s @Transactional is IGNORED
        save();
    }

    @Transactional
    public void save() { ... }
}
```

Here `save()`'s transaction never starts when reached via `process()`. The same trap applies if the outer method is called externally but internally re-enters another advised method through `this`.

**Private (and non-public) methods**: with the default proxy mode, `@Transactional` on `private` methods has **no effect**. JDK dynamic proxies can only advise interface methods; CGLIB proxies subclass the target and override methods, but cannot override `private`, `final`, or `static` methods. By default Spring's transaction infrastructure also only applies to **public** methods; annotations on `protected`/package-private/`private` methods are silently ignored in proxy mode.

Workarounds:

1. **Refactor** the transactional method into a *separate bean* and inject it, so the call crosses a proxy boundary. (Most common, cleanest.)
2. **Self-injection / `AopContext.currentProxy()`** — obtain the proxy reference and call through it (requires `exposeProxy = true`). Works but is considered a code smell.
3. **AspectJ mode** (`@EnableTransactionManagement(mode = AdviceMode.ASPECTJ)` with weaving) — bytecode weaving advises the actual method invocations, so self-invocation and non-public methods can be transactional. Requires the AspectJ weaver setup.

> As of Spring Framework 6.0+, `@Transactional` can be detected on `protected` and package-visible methods when using CGLIB class proxies in some configurations, but `private` methods and self-invocation remain unsupported in proxy mode. The safe interview answer: **proxy mode = public methods only, and self-invocation bypasses the proxy.**

---

## Application Events with ApplicationEventPublisher and EventListener

Spring's `ApplicationContext` is also an event bus, implementing the observer pattern for **in-process, same-JVM** decoupling. A publisher fires an event; zero or more listeners react. Publisher and listener need not know about each other.

**Publishing.** Inject `ApplicationEventPublisher` (or the context) and call `publishEvent`.

```java
@Component
public class OrderService {
    private final ApplicationEventPublisher publisher;
    OrderService(ApplicationEventPublisher publisher) { this.publisher = publisher; }

    public void placeOrder(Order o) {
        // ... persist ...
        publisher.publishEvent(new OrderPlacedEvent(o)); // any object works since Spring 4.2
    }
}
```

**The event object.** Historically events extended `org.springframework.context.ApplicationEvent`. Since **Spring 4.2** the event can be **any arbitrary object** (a POJO) — Spring wraps non-`ApplicationEvent` objects in a `PayloadApplicationEvent` internally. So extending `ApplicationEvent` is optional now.

**Listening.** Two ways:

1. Implement `ApplicationListener<E extends ApplicationEvent>` and override `onApplicationEvent`.
2. Annotate a method with **`@EventListener`** (Spring 4.2+) — no interface needed; the method parameter type selects which events it receives.

```java
@Component
public class InventoryListener {
    @EventListener
    public void on(OrderPlacedEvent event) { inventory.reserve(event.getOrder()); }

    // Conditional listening with SpEL
    @EventListener(condition = "#event.order.total > 1000")
    public void onLargeOrder(OrderPlacedEvent event) { ... }
}
```

An `@EventListener` method may **return a value**, and a non-null return is published as a *further* event (event chaining). Return `void`/`null` to publish nothing.

**Synchronous by default.** This is a critical point. `publishEvent` invokes listeners **synchronously on the publisher's thread** — the publisher blocks until all listeners finish, and (in a transaction) the listener runs **in the same transaction** as the publisher. Consequences: a listener throwing an exception propagates back to the publisher and can roll back the transaction; ordering among listeners can be controlled with `@Order` or by implementing `Ordered`.

To make listeners run asynchronously, annotate the listener with `@Async` and enable `@EnableAsync`; then it runs on a separate thread from a `TaskExecutor`, the publisher does not block, and exceptions no longer propagate to the caller (they go to the async exception handler). You can also configure a custom `ApplicationEventMulticaster` bean with a `taskExecutor` to make *all* events async.

Built-in framework events include `ContextRefreshedEvent`, `ContextStartedEvent`, `ContextStoppedEvent`, `ContextClosedEvent`, and (in web apps) `RequestHandledEvent`.

### Multicaster internals, error handling, and generic events

The real dispatch is done by a single context-wide `ApplicationEventMulticaster` bean. If you do not define one, the context creates a `SimpleApplicationEventMulticaster` that publishes **synchronously on the caller thread**. To customize it you must register a bean **named exactly `applicationEventMulticaster`** — any other name is ignored and the default is used instead. That bean exposes two knobs: a `taskExecutor` (supply one to make *all* events async) and an `ErrorHandler`.

**Error propagation and the "one bad listener" problem.** With the default multicaster and no `ErrorHandler`, listeners for a given event run in sequence and an exception from one **propagates to the publisher and stops the remaining listeners** — they never run. Setting an `ErrorHandler` on the multicaster lets you swallow/handle a listener failure so the *rest* of the listeners still receive the event and the publisher does not see the exception. This is the framework-level analogue of a try/catch around each listener.

**Ordering.** Listeners for the same event are ordered by `@Order` (or `Ordered`); lower value runs first. Ordering is only meaningful for synchronous, single-executor delivery — with a multi-threaded `taskExecutor` there is no guaranteed order.

**Async delivery caveats.** Whether via a `taskExecutor` on the multicaster or `@Async` on the listener, async delivery changes three things: (1) exceptions are **not** propagated to the publisher — they go to the `AsyncUncaughtExceptionHandler`; (2) a return value **cannot** chain a further event (you must inject `ApplicationEventPublisher` and publish manually); and (3) `ThreadLocal`-bound state — including the **transaction context** and MDC/logging context — is **not** propagated to the worker thread by default. This last point is why an async listener cannot participate in the publisher's transaction.

**Generic events and type erasure.** A listener can subscribe to a parameterized type, e.g. `@EventListener void on(EntityCreatedEvent<Person> e)`. Because of erasure, Spring can only route correctly if the fired event resolves its type parameter at runtime — either by publishing a concrete subclass (`class PersonCreatedEvent extends EntityCreatedEvent<Person>`) or by having the event implement `ResolvableTypeProvider` to advertise its `ResolvableType`. A raw `EntityCreatedEvent<>` object cannot be matched by the parameterized listener.

**Listener registration cost.** `@EventListener` methods are discovered by an `EventListenerMethodProcessor` (a `BeanFactoryPostProcessor`/`SmartInitializingSingleton`) after singletons are instantiated. A consequence: publishing an event *during* bean initialization (e.g. in a `@PostConstruct` that runs before all singletons are ready) may reach fewer listeners than expected, and very early events are buffered by an `earlyApplicationEvents` mechanism until the multicaster exists.

---

## TransactionalEventListener

When an event is published *inside* a transaction, a plain `@EventListener` runs immediately and synchronously — **before the transaction commits**. That is a problem if the listener should only act once the data is durably committed (e.g., send an email or a message only if the order really persisted). If the transaction later rolls back, the email has already gone out.

**`@TransactionalEventListener`** (Spring 4.2+) solves this by binding listener invocation to a **transaction synchronization phase**. The listener fires only at the chosen point in the surrounding transaction's lifecycle:

| `phase` (`TransactionPhase`) | Fires when |
|---|---|
| `AFTER_COMMIT` (default) | After the transaction commits successfully |
| `AFTER_ROLLBACK` | After the transaction rolls back |
| `AFTER_COMPLETION` | After the transaction completes (commit or rollback) |
| `BEFORE_COMMIT` | Just before commit |

```java
@Component
public class OrderNotifier {
    @TransactionalEventListener // phase = AFTER_COMMIT by default
    public void onCommit(OrderPlacedEvent event) {
        emailService.sendConfirmation(event.getOrder()); // only if the tx committed
    }
}
```

Key behaviors and gotchas:

- **Requires an active transaction by default.** If the event is published *outside* any transaction, the `@TransactionalEventListener` is **not invoked at all** (silently dropped). Set `fallbackExecution = true` to have it run anyway when there is no transaction.
- The event is normally published *within* the transaction (the publishing code runs inside `@Transactional`); the listener's execution is merely deferred to the chosen phase via a registered `TransactionSynchronization`.
- Still synchronous by default (runs on the thread completing the transaction). Combine with `@Async` for asynchronous post-commit handling.
- `AFTER_COMMIT` (and `AFTER_COMPLETION`) listeners run **after** the transaction has committed, so the connection/persistence context is effectively done — new writes from such a listener need their **own new transaction** (e.g. a method with `REQUIRES_NEW`), otherwise they may not be persisted as expected. `BEFORE_COMMIT` runs while the transaction is still open and can still contribute to it.

`@TransactionalEventListener` is itself a specialization of `@EventListener`, so it supports the same `condition` SpEL, payload binding, and can be combined with `@Async` and `@Order`.

### Deferred execution internals and failure modes

Under the hood, when a `@TransactionalEventListener` receives an event inside an active transaction, it does not run the handler immediately. Instead it registers a `TransactionSynchronization` via `TransactionSynchronizationManager.registerSynchronization(...)`, and the handler is invoked from the corresponding callback (`beforeCommit`, `afterCommit`, or `afterCompletion`). This registration requires that transaction synchronization is *active* — which it is under Spring's managed transaction managers. It also means the event object is captured now but the listener body executes later, on the thread that completes the transaction.

**The `AFTER_COMMIT` write trap, precisely.** By `AFTER_COMMIT` the physical transaction has committed, yet the transactional *resources may still be bound to the thread*. So if the listener runs plain data-access code without demanding a new transaction, that code "participates" in the finishing transaction context but its **changes are never committed** — they silently vanish. The correct pattern is to annotate the listener's work with `@Transactional(propagation = REQUIRES_NEW)` so a fresh physical transaction is created and committed.

**Exceptions thrown after commit cannot undo the commit.** An exception from an `AFTER_COMMIT` (or `AFTER_COMPLETION`) listener propagates out of the synchronization callback but the commit already happened — you cannot roll back. A `BEFORE_COMMIT` listener that throws, in contrast, *does* abort the commit and rolls the transaction back, because it runs while the transaction is still open. This makes `BEFORE_COMMIT` the phase to use for last-second validation that should be able to veto the commit.

**Ordering across phases and with `@Async`.** `@Order` prioritizes multiple transactional listeners *within the same phase*. Combining `@TransactionalEventListener` with `@Async` moves the *post-phase* execution onto a worker thread — this is the safe way to do post-commit work (send email/message) without blocking the committing thread, and it sidesteps the "resources still bound" write trap because the async thread has no bound transaction at all (so you again need `REQUIRES_NEW` to write).

**Nested-transaction subtlety.** If the event is published from a `REQUIRES_NEW` inner method, the synchronization binds to *that inner* transaction, so `AFTER_COMMIT` fires when the inner transaction commits — even if the outer transaction later rolls back. Developers who assume "after commit" means "after the whole business operation committed" get surprised here.

**Spring 6.1+ reactive support.** As of Spring Framework 6.1, transactional event listeners also work with reactive transactions managed by a `ReactiveTransactionManager`. Because reactive flows carry the transaction in the Reactor `Context` rather than a `ThreadLocal`, the transaction context must be included in the published event via `TransactionalEventPublisher` for the listener to bind correctly.

---

## Transaction Synchronization and Thread Binding Internals

Spring's transaction abstraction is fundamentally **thread-bound** (for the imperative `PlatformTransactionManager` family). Understanding this explains most "why doesn't my code see the transaction?" bugs.

**How the resource is bound.** When a transaction starts, the transaction manager acquires the resource (e.g. a JDBC `Connection` from the `DataSource`) and binds it to the current thread through `TransactionSynchronizationManager`, keyed by the resource factory (the `DataSource` instance). Repository code that later calls `DataSourceUtils.getConnection(dataSource)` (which `JdbcTemplate` uses) retrieves *that same bound connection* instead of opening a new one — that is how a `@Transactional` service method and its repositories share one physical transaction. If code bypasses this and calls `dataSource.getConnection()` directly, it gets a *different*, non-transactional connection and its work will not participate in (or be rolled back with) the surrounding transaction.

**Two DataSources = two transactions.** A single `DataSourceTransactionManager` binds exactly one `DataSource`. If your repositories talk to a second `DataSource` not managed by that manager, those writes are outside the transaction. Spanning both atomically requires JTA/XA (`JtaTransactionManager`) or the chained/best-effort patterns.

**Synchronizations.** Besides the resource, the manager keeps a list of `TransactionSynchronization` callbacks bound to the thread (`beforeCommit`, `afterCommit`, `beforeCompletion`, `afterCompletion`). These are the hook that powers `@TransactionalEventListener`, JPA's session flush/close, and cleanup. They only fire when synchronization is *active*, which it is for Spring-managed transactions but not if you obtained a connection entirely outside Spring.

**Thread hop = lost transaction.** Because binding is to the current thread, any thread hop loses it: `@Async` methods, manually spawned threads, parallel streams, and reactive scheduler hops all run *outside* the caller's transaction. This is the root cause behind the async event caveats above. The reactive stack solves this differently — `ReactiveTransactionManager` stores the transaction in the Reactor `Context` rather than a `ThreadLocal`, so it survives thread switches within the reactive chain but does **not** interoperate with the thread-bound imperative `TransactionSynchronizationManager`.

## Common follow-up questions

- Why doesn't my `@Transactional` roll back on a checked exception? By default only unchecked exceptions (`RuntimeException`/`Error`) trigger rollback; add `rollbackFor` for checked exceptions.
- Why is my `@Transactional` method not being wrapped in a transaction at all? Likely self-invocation (called via `this`), a non-public method, missing `@EnableTransactionManagement`, or the bean not being a Spring-managed proxy.
- Difference between `REQUIRES_NEW` and `NESTED`? `REQUIRES_NEW` = a separate, independent physical transaction (suspends the outer); `NESTED` = a savepoint within the same physical transaction (partial rollback, only the outer commits).
- What's the difference between `@EventListener` and `@TransactionalEventListener`? The former runs immediately/synchronously; the latter defers to a transaction phase (default after commit) and is skipped if no transaction is active.
- Is `readOnly=true` enforced? No — it is a hint/optimization (notably disables Hibernate dirty-checking/flush); it does not guarantee the DB rejects writes.
- Are Spring application events synchronous or asynchronous? Synchronous by default (publisher's thread, same transaction); use `@Async` + `@EnableAsync` (or a custom multicaster with a `TaskExecutor`) for async.
- Which transaction manager do I use for JPA vs plain JDBC? `JpaTransactionManager` for JPA; `DataSourceTransactionManager` for plain JDBC; `JtaTransactionManager` for distributed/XA.
- What causes `UnexpectedRollbackException`? A `REQUIRED` inner transaction was marked rollback-only (e.g., its exception was swallowed), then the outer tried to commit.
- How do you turn on annotation-driven transactions in plain Spring? `@EnableTransactionManagement` on a `@Configuration` class (or `<tx:annotation-driven/>` in XML), plus a `PlatformTransactionManager` bean.

## References

- Spring Framework Reference — Data Access, Transaction Management: https://docs.spring.io/spring-framework/reference/data-access/transaction.html
- Declarative transaction management: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative.html
- `@Transactional` settings (propagation, isolation, rollback rules): https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html
- Programmatic transaction management: https://docs.spring.io/spring-framework/reference/data-access/transaction/programmatic.html
- Standard and custom events: https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html#context-functionality-events
- `@TransactionalEventListener` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/event/TransactionalEventListener.html
- `PlatformTransactionManager` Javadoc: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/PlatformTransactionManager.html
