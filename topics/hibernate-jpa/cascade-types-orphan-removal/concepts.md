# Cascade Types & Orphan Removal

Cascading is how JPA lets you propagate an entity-manager operation (`persist`,
`merge`, `remove`, `refresh`, `detach`) from a **parent** entity to the entities
**associated** with it, so you don't have to call the operation on every child by
hand. **Orphan removal** is a related-but-distinct feature that deletes a child row
when it is *disconnected* from its parent. Together — `cascade = ALL` +
`orphanRemoval = true` — they model a true parent/child **aggregate** where the
children have no life of their own outside the parent.

This topic is a classic source of interview "gotcha" questions because two features
that look similar (`CascadeType.REMOVE` vs `orphanRemoval`) behave differently, and
because cascading the *wrong* operation across a *shared* association can silently
delete data other entities still reference.

> [!KEY-TAKEAWAY]
> Cascade answers "when I do X to the parent, do X to the children too."
> Orphan removal answers "when a child is removed from the parent's collection,
> delete that child row." They overlap for `remove`/delete but are **not** the same
> feature, and only orphan removal reacts to *dereferencing*.

---

## What Cascading Is and How Hibernate Applies It

By default JPA operations are **not transitive**. If you call
`entityManager.persist(order)` and `order` holds a collection of new, transient
`OrderLine` objects, JPA persists only the `Order`. On flush Hibernate will try to
insert the `Order` row, and — depending on the mapping — either fail with a
`TransientObjectException`/`PropertyValueException` (because the child references a
transient instance) or simply leave the children unsaved. Cascading tells the
provider to walk the association and apply the same operation to the target(s).

Mechanically, when you invoke an `EntityManager` operation, Hibernate consults the
association's **cascade styles**. For each associated entity reachable through a
cascaded association, it schedules the *same* lifecycle action against that entity's
own persister, recursing through the object graph. This all happens in memory
against the **persistence context** (see
`hibernate-jpa/session-entitymanager-persistence-context`); the actual SQL is
emitted later, in dependency order, when the context **flushes** (see
`hibernate-jpa/transactions-dirty-checking-flushing`).

```java
@Entity
class Order {
    @Id @GeneratedValue Long id;

    // Cascade PERSIST + MERGE + REMOVE (and orphan removal) to the lines.
    @OneToMany(mappedBy = "order",
               cascade = CascadeType.ALL,
               orphanRemoval = true)
    List<OrderLine> lines = new ArrayList<>();
}

@Entity
class OrderLine {
    @Id @GeneratedValue Long id;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id")
    Order order;                    // owning side of the FK
}
```

```java
Order o = new Order();
o.lines.add(new OrderLine(o));
o.lines.add(new OrderLine(o));
em.persist(o);      // PERSIST cascades: one INSERT for the order, one per line
```

Generated SQL on flush:

```sql
insert into "Order" (id) values (?)
insert into OrderLine (order_id, id) values (?, ?)
insert into OrderLine (order_id, id) values (?, ?)
```

> [!TIP]
> Cascading operates on the **object graph in memory**, not on the database. It is a
> convenience for propagating `EntityManager` calls — it is *not* the same thing as
> an `ON DELETE CASCADE` foreign-key constraint in DDL. The DB-level constraint is a
> separate mechanism (owned by `messaging-databases`); you can even have both, and
> they can disagree.

---

## The JPA CascadeType Values

`jakarta.persistence.CascadeType` (Jakarta Persistence 3.1/3.2 — the
`jakarta.persistence` namespace, **not** the legacy `javax.persistence`) defines
these values. Each maps a cascade style to the matching `EntityManager` method:

| CascadeType | Propagates | When it fires |
|---|---|---|
| `PERSIST` | `em.persist(parent)` | Inserting a new parent also persists new children |
| `MERGE` | `em.merge(parent)` | Merging a detached parent merges its children |
| `REMOVE` | `em.remove(parent)` | Removing the parent removes its children |
| `REFRESH` | `em.refresh(parent)` | Refreshing re-reads children from the DB too |
| `DETACH` | `em.detach(parent)` | Detaching evicts children from the context too |
| `ALL` | all of the above | Shorthand for `{PERSIST, MERGE, REMOVE, REFRESH, DETACH}` |

You set cascade **on the association**, as an attribute of the mapping annotation:

```java
@OneToMany(cascade = {CascadeType.PERSIST, CascadeType.MERGE})
List<OrderLine> lines;
```

Key precision points interviewers probe:

- **There is no default cascade.** An association with no `cascade` attribute
  propagates *nothing*; you must persist/remove children yourself.
- **`CascadeType.ALL` does NOT include `orphanRemoval`.** Orphan removal is a
  *separate* boolean attribute on `@OneToOne`/`@OneToMany`, not a cascade type.
- **`flush` and `find` are not cascade types.** Flush walks the whole context
  anyway; `find` loads by id and has nothing to cascade.
- Cascade is **directional**: it fires when you call the operation on the entity
  that *declares* the cascade on its association, walking toward the target.

---

## Hibernate-Native Cascade Types

Hibernate's native `org.hibernate.annotations.CascadeType` (used via
`@org.hibernate.annotations.Cascade`) is a **superset** of the JPA values and adds
styles the spec never defined:

| Hibernate-native | Meaning |
|---|---|
| `SAVE_UPDATE` | Cascades the legacy Hibernate `Session.saveOrUpdate()` |
| `REPLICATE` | Cascades `Session.replicate()` (copy state into another DB) |
| `LOCK` | Cascades `Session.lock()` / reattachment to associated entities |
| `PERSIST / MERGE / REMOVE / REFRESH / DETACH` | Mirror the JPA values |

Notes for interviews:

- Hibernate's native `CascadeType.DELETE` corresponds to JPA's `REMOVE`; native
  `SAVE_UPDATE` roughly corresponds to `PERSIST` + reattach semantics.
- These require the **native** `@Cascade` annotation. You'd only reach for them when
  using Hibernate-specific `Session` methods (`saveOrUpdate`, `replicate`, `lock`),
  which are increasingly discouraged now that Hibernate 6/7 aligns on the
  JPA/`EntityManager` API. Prefer the JPA `cascade` attribute unless you truly need
  `saveOrUpdate`/`replicate`.
- **`orphanRemoval` is a JPA feature**, not a Hibernate-native cascade style — but
  the *behavior* originated in Hibernate's old `cascade="all-delete-orphan"` and was
  standardized into JPA 2.0. In modern code use `orphanRemoval = true`.

---

## Where Cascade Is Declared and Direction

Cascade is a property of a **single association**, so in a bidirectional
relationship each side has its **own** cascade settings. Cascading on
`Order.lines` does not imply anything about `OrderLine.order`.

- **You almost always cascade from the "parent"/aggregate-root side toward the
  children** (`@OneToMany` on `Order.lines`), not the other way.
- Cascading `REMOVE` from the **child's** `@ManyToOne` back to the parent is a
  dangerous mistake: `em.remove(line)` would then try to delete the whole `Order`
  (and, via cascade on the order, potentially every sibling line). Interviewers love
  this trap.
- Cascade interacts with the **owning side** of the relationship for FK management.
  In a bidirectional `@OneToMany(mappedBy="order")`, the `@ManyToOne` side owns the
  `order_id` FK. If you forget to set `line.setOrder(order)` you can get a spurious
  `UPDATE` (to null the FK) or a constraint violation even when cascade is correct —
  a separate mapping concern covered in
  `hibernate-jpa/entity-mappings-associations`.

```mermaid
flowchart LR
    subgraph parent["Aggregate root"]
      O["Order (declares cascade=ALL,<br/>orphanRemoval=true on lines)"]
    end
    subgraph children["Owned children"]
      L1["OrderLine 1"]
      L2["OrderLine 2"]
    end
    O -- "persist / merge / remove<br/>cascade downward" --> L1
    O --> L2
    L1 -. "@ManyToOne back-ref<br/>(usually NO cascade)" .-> O
```

---

## When to Cascade vs When Not To

The decision is a **modeling** decision, not a performance tweak. Ask: *does the
child have an independent existence, or is it wholly owned by this parent?*

**Cascade (composition / "owns-a"):** the child is meaningless without the parent
and is not shared. Classic examples:

- `Order` → `OrderLine` (a line item exists only within its order)
- `Post` → `Comment` (if comments die with the post)
- `Invoice` → `InvoiceItem`

Here `cascade = ALL` + `orphanRemoval = true` is appropriate: create, update, and
delete flow through the aggregate root.

**Do NOT cascade (association / shared reference):** the child is a shared,
independently-managed entity.

- `Employee` → `Department` (many employees share one department — cascading
  `REMOVE` when you delete an employee would delete the department out from under
  everyone else!)
- `Book` → `Author` in a `@ManyToMany` (authors are shared; cascading `REMOVE`
  could delete an author referenced by other books)
- Any reference-data / lookup entity (`Country`, `Currency`, `Category`).

> [!WARNING]
> Cascading `REMOVE` (or `ALL`) across a **shared** association is one of the most
> destructive ORM bugs. Deleting one `Employee` can delete a `Department` that
> dozens of other employees still point at, causing FK violations or silent data
> loss. Only cascade `REMOVE` when the association expresses **exclusive
> ownership**. For `@ManyToMany`, cascading `REMOVE` is almost never correct.

A safe middle ground for shared references is to cascade only `PERSIST` and `MERGE`
(so you can save a new graph in one call) while **never** cascading `REMOVE`.

This ownership question is exactly the DDD **Aggregate** boundary — the parent is
the aggregate root and children are internal to the aggregate. See
`system-design/ddd-aggregates` (data-modeling altitude) for the domain-modeling
rationale; here we stay at the ORM mechanism.

---

## orphanRemoval vs CascadeType.REMOVE

This is *the* headline distinction of the topic. Both can cause a child row to be
`DELETE`d, but they trigger on **different events**:

| | `CascadeType.REMOVE` | `orphanRemoval = true` |
|---|---|---|
| Fires when… | you call `em.remove(parent)` | a child is **removed from the collection** / the reference is set to null |
| Reacts to dereferencing a child? | **No** | **Yes** |
| Deletes children when parent is removed? | Yes | Yes (a removed parent orphans all children) |
| Semantics | "cascade my explicit delete" | "private ownership — child can't outlive the association" |
| Where declared | `cascade` attribute | separate `orphanRemoval` boolean |

The crucial case: you keep the parent alive but drop a child from its collection.

```java
Order o = em.find(Order.class, 1L);
OrderLine first = o.getLines().get(0);
o.getLines().remove(first);   // dereference the child
// no em.remove(first) call, parent NOT removed
```

- With **only `CascadeType.REMOVE`** (no orphan removal): nothing is deleted. On
  flush Hibernate merely `UPDATE`s `OrderLine.order_id = NULL` (or, if the FK is
  `NOT NULL`, throws a constraint violation). The child row **survives** as an
  orphan.
- With **`orphanRemoval = true`**: Hibernate detects the child was removed from the
  managed collection and schedules a `DELETE` for that row on flush.

```sql
-- orphanRemoval = true, after removing one line from the collection:
delete from OrderLine where id=?
```

> [!INTERVIEW]
> "You remove an `OrderLine` from `order.getLines()` but never call
> `em.remove(line)`. What SQL runs on flush?" — With `orphanRemoval=true`: a
> `DELETE` of that line. With only `cascade=REMOVE`: an `UPDATE` setting
> `order_id=NULL` (or a `NOT NULL` violation). Naming *why* — orphan removal reacts
> to **dereferencing**, cascade only to an **explicit parent remove** — is the
> senior-level answer.

`orphanRemoval` is only valid on `@OneToOne` and `@OneToMany` (relationships that
express **ownership** of the target). It is illegal on `@ManyToOne`/`@ManyToMany`,
where the target is inherently shared.

---

## orphanRemoval Mechanism and Generated SQL

How does Hibernate *know* a child became an orphan? It tracks the **managed
collection**. When a `@OneToMany`/`@OneToOne` association with `orphanRemoval=true`
is loaded, Hibernate wraps it in a **persistent collection** (e.g.
`PersistentBag`/`PersistentSet`) that records its contents. During
**dirty checking** at flush, Hibernate diffs the current collection against the
snapshot; any element present before but absent now is an orphan and is scheduled
for `DELETE`. (Dirty checking and the flush algorithm are detailed in
`hibernate-jpa/transactions-dirty-checking-flushing`.)

```mermaid
stateDiagram-v2
    [*] --> InCollection: child managed<br/>via parent collection
    InCollection --> Dereferenced: parent.getLines().remove(child)
    Dereferenced --> ScheduledDelete: flush + dirty check<br/>detects missing element
    ScheduledDelete --> Deleted: DELETE issued
    Deleted --> [*]
    InCollection --> Deleted: em.remove(parent)<br/>(if cascade REMOVE or orphanRemoval)
```

Consequences and edge behavior:

- **Orphan removal implies a delete, not just FK nulling.** Even if the FK column is
  nullable, an orphaned child is `DELETE`d, not detached.
- **Clearing the collection** deletes *all* children: `order.getLines().clear()`
  with `orphanRemoval=true` schedules a `DELETE` per element on flush.
- **Batching:** each orphan is typically a separate `DELETE` unless you enable JDBC
  batching (`hibernate.jdbc.batch_size`) — relevant for
  `hibernate-jpa/performance-tuning-pitfalls`.
- Orphan removal happens at **flush** time within the transaction, obeying the same
  flush ordering rules as other deletes.

---

## Gotchas: Reassigning Collections and Reattachment

Several real-world traps live at the boundary of cascade + orphan removal:

**1. Replacing the whole collection reference.** With `orphanRemoval=true`, do
*not* reassign the collection field to a brand-new instance:

```java
order.setLines(new ArrayList<>(newLines));   // BAD with orphanRemoval
```

Hibernate manages the *original* persistent collection. Reassigning it can throw
`org.hibernate.HibernateException: A collection with orphan deletion was no longer
referenced by the owning entity instance` (a "dereferenced collection" error). The
correct idiom is to **mutate the existing collection**:

```java
order.getLines().clear();          // orphans the old ones -> DELETE
order.getLines().addAll(newLines); // adds the new ones -> INSERT
```

**2. clear()+addAll() deletes then re-inserts.** Even to "keep" some rows, a
`clear()` + re-add can issue `DELETE` for all and `INSERT` for all, losing identity.
Prefer surgical `add`/`remove` when you care about row identity or history.

**3. orphanRemoval + `merge` on a detached graph.** When you `merge` a detached
parent whose collection is missing an element that exists in the DB, orphan removal
kicks in and deletes it. This surprises people who load a partial graph, merge it,
and find children vanished. Load the full collection or manage removals explicitly.

**4. Cascade doesn't fix a broken back-reference.** Cascading `PERSIST` saves the
child, but if you never set the owning `@ManyToOne` (`line.setOrder(order)`) the FK
column is null. Cascade propagates the *operation*, not the *link*. Use a helper:

```java
void addLine(OrderLine l) { lines.add(l); l.setOrder(this); }  // keep both sides
```

**5. `remove` on a detached/transient entity.** `em.remove()` requires a *managed*
instance; cascading `REMOVE` through a detached graph can throw
`IllegalArgumentException`. `merge` first, then `remove`.

> [!WARNING]
> `orphanRemoval` + reassigning the collection field = the classic "collection with
> orphan deletion was no longer referenced" exception. Always mutate the managed
> collection in place; never swap it for a new `List`/`Set` instance.

---

## Modeling a True Parent-Child Aggregate

`cascade = CascadeType.ALL` **plus** `orphanRemoval = true` is the canonical way to
model an entity whose children are **privately owned** and have no lifecycle of
their own — a DDD *aggregate* with the parent as root:

```java
@Entity
class Order {
    @Id @GeneratedValue Long id;

    @OneToMany(mappedBy = "order",
               cascade = CascadeType.ALL,   // persist/merge/remove/refresh/detach
               orphanRemoval = true)        // + delete-on-dereference
    private List<OrderLine> lines = new ArrayList<>();

    public void addLine(OrderLine l)    { lines.add(l); l.setOrder(this); }
    public void removeLine(OrderLine l) { lines.remove(l); l.setOrder(null); }
}
```

With this mapping the entire lifecycle flows through the root:

- `em.persist(order)` inserts the order and all its lines.
- Adding a line and flushing inserts one row.
- `order.removeLine(x)` (dereference) deletes that one row on flush (orphan removal).
- `em.remove(order)` deletes the order and every line (cascade REMOVE).

Why both are needed: `cascade=ALL` alone would *not* delete a line you merely drop
from the collection; `orphanRemoval=true` alone would *not* propagate `persist`,
`merge`, `refresh`, or `detach`. Combined, the children are fully subordinate to the
root — exactly the aggregate invariant you want. External entities should reference
the root (`Order`), never hold their own reference to an internal `OrderLine`. See
`system-design/ddd-aggregates` for the domain rationale; the ORM mechanism is what
we covered above.

> [!KEY-TAKEAWAY]
> `cascade = ALL` + `orphanRemoval = true` = "these children are part of me." Use it
> only for private, non-shared composition. For shared references, cascade at most
> `PERSIST`/`MERGE` and never `REMOVE`.

---

## Flush-Time Action Ordering (ActionQueue)

A subtle but high-value internal: **Hibernate does not execute DML in the order you
called the `EntityManager` methods.** At flush, all scheduled operations are collected
into the `ActionQueue`, which executes them in a **fixed, type-based order** so that
foreign-key dependencies are satisfied regardless of call order:

1. `OrphanRemovalAction` — orphan-removal deletes run **first**
2. `AbstractEntityInsertAction` — inserts
3. `EntityUpdateAction` — updates
4. Collection actions — `CollectionRemoveAction`, `CollectionUpdateAction`,
   `CollectionRecreateAction` (and queued ops)
5. `EntityDeleteAction` — ordinary `em.remove` deletes run **last**

Note the asymmetry: **orphan-removal deletes fire before inserts, but ordinary
`em.remove` deletes fire after inserts.**

**Why it matters — the classic unique-constraint trap.** Suppose `Order` has a unique
`slug`. You do:

```java
em.remove(oldOrder);              // slug = "spring-sale"
em.persist(new Order("spring-sale"));  // same slug
// flush -> ConstraintViolationException
```

Because `EntityDeleteAction` runs **after** inserts, the `INSERT` for the new row fires
while the old row is still present, tripping the unique constraint. The fix is to
`update` the existing row in place, not remove-then-insert. Calling `em.flush()`
between the two is a code smell that "works" only by forcing an early flush boundary.

**The mirror-image case with orphan removal works**, precisely because
`OrphanRemovalAction` runs *first*: dropping an orphan-removed child and adding a
replacement child that shares a unique key generally succeeds — the orphan `DELETE` is
issued before the new child's `INSERT`.

```mermaid
flowchart TD
    F["flush()"] --> OR["1. OrphanRemovalAction (deletes)"]
    OR --> I["2. Inserts"]
    I --> U["3. Updates"]
    U --> C["4. Collection actions"]
    C --> D["5. EntityDeleteAction (ordinary deletes)"]
```

---

## @OnDelete: Database-Level FK Cascade

The doc above notes "DB-level `ON DELETE CASCADE` is a separate mechanism." Hibernate
can **generate** that constraint for you via
`@org.hibernate.annotations.OnDelete(action = OnDeleteAction.CASCADE)`:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
@org.hibernate.annotations.OnDelete(action = OnDeleteAction.CASCADE)
private List<OrderLine> lines = new ArrayList<>();
```

With this, `hbm2ddl` emits the child FK as:

```sql
alter table OrderLine add constraint FK_line_order
  foreign key (order_id) references "Order" (id) on delete cascade
```

Now deleting a parent removes all children in **one** DB statement — no per-row child
`DELETE`s, and Hibernate does not even load the collection. This is the senior answer
to "cascade REMOVE is slow / issues N deletes — how do you fix it?"

**What you lose (state these in an interview):** because the database does the delete,
it **bypasses the persistence context** entirely, so it:

- does **not** fire `@PreRemove`/`@PostRemove` lifecycle callbacks,
- does **not** update or evict the **second-level cache** (stale-cache risk — Vlad
  Mihalcea and Thorben Janssen both warn about this),
- does **not** perform optimistic-lock `@Version` checks on the children.

`OnDeleteAction` lives in `org.hibernate.annotations` (values `CASCADE`, `NO_ACTION`;
older Hibernate also had `RESTRICT`). Contrast the **three distinct layers** crisply:

| Layer | Who deletes | SQL shape | Callbacks / cache / version |
|---|---|---|---|
| JPA `CascadeType.REMOVE` | Hibernate | 1 `SELECT` + N child `DELETE`s | Yes — fires them |
| `orphanRemoval = true` | Hibernate | `DELETE` on dereference | Yes — fires them |
| `@OnDelete(CASCADE)` | **Database** (FK) | 1 statement, DB-driven | **No** — bypasses all |

---

## Bulk JPQL/HQL Deletes Bypass Cascade and Orphan Removal

A bulk `DELETE`/`UPDATE` via JPQL/HQL/Criteria is translated to a **single SQL
statement** and executes directly against the database. It does **not** load entities,
so it:

- does **not** cascade to children (`CascadeType.REMOVE` is ignored),
- does **not** trigger `orphanRemoval`,
- does **not** run `@PreRemove`/`@PostRemove` or other lifecycle callbacks,
- does **not** synchronize the persistence context or the L2 cache (stale entities can
  linger in the current context).

```java
em.createQuery("delete from Order o where o.status = :s")
  .setParameter("s", Status.CANCELLED)
  .executeUpdate();   // children are NOT deleted; FK violation or orphaned rows
```

This is a classic production bug: developers assume a bulk parent delete removes
children (it does not), and either hit an FK-constraint violation or leave orphaned
child rows behind. The **recommended pattern** for deleting large graphs efficiently is
a *manual* bulk delete — delete children by FK in one statement, then the parent:

```java
em.createQuery("delete from OrderLine l where l.order.id = :id").setParameter("id", id).executeUpdate();
em.createQuery("delete from Order o where o.id = :id").setParameter("id", id).executeUpdate();
```

This trades the per-row deletes of cascade `REMOVE` for two set-based statements — but
you own the ordering and lose callbacks/cache-sync, so evict the L2 cache region or
`em.clear()` afterwards. See `hibernate-jpa/performance-tuning-pitfalls`.

---

## Performance: Cascade REMOVE Loads the Collection and Deletes Per Row

To cascade `REMOVE` (or apply `orphanRemoval`) Hibernate must operate on **managed
entities**, so it first `SELECT`s the entire collection into memory, then issues **one
`DELETE` per child row**, then deletes the parent:

```sql
-- em.remove(order) with cascade=REMOVE and 200 lines:
select l.id, l.order_id, ... from OrderLine l where l.order_id = ?   -- load collection
delete from OrderLine where id=?    -- x200 (one per child)
delete from OrderLine where id=?
...
delete from "Order" where id=?
```

So removing one parent with 200 children costs ~202 statements. If the child has a
`@Version` column, each `DELETE` also carries the version predicate
(`delete from OrderLine where id=? and version=?`) for optimistic-lock safety. This is
the "predict how many SQL statements" senior question, and it motivates either
`@OnDelete(CASCADE)` (one DB statement, but loses callbacks/cache/version) or a manual
bulk delete.

---

## Cascade Is Transitive Across the Object Graph

Cascade is **recursive**: it propagates through *every* level of the graph, following
each association's own cascade settings. `Order` → `OrderLine` → `LineDetail` cascades
`persist`/`remove` all the way down *if each hop declares the cascade*. A hop that does
not declare the operation stops the propagation at that edge.

To avoid infinite loops on bidirectional or cyclic graphs, Hibernate tracks the set of
**already-visited entities** during a cascade traversal, so an entity is processed once
even if reachable by multiple paths.

---

## @ElementCollection: Implicit Orphan Removal

`@ElementCollection` maps a collection of **value types** (`@Embeddable`s or basics),
which have **no independent identity** and no lifecycle of their own. Removing an
element issues a `DELETE` from the collection table **automatically** — there is no
`cascade` and no `orphanRemoval` attribute on `@ElementCollection`, because value types
are *always* owned by their parent.

```java
@ElementCollection
@CollectionTable(name = "order_tags", joinColumns = @JoinColumn(name = "order_id"))
private Set<String> tags = new HashSet<>();
// order.getTags().remove("vip"); flush -> delete from order_tags where order_id=? and tag=?
```

Interviewer probe: **"@OneToMany with orphanRemoval vs @ElementCollection — same or
different?"** Different in *kind*: `@OneToMany` targets **entities** with their own
identity/table/lifecycle, and orphan removal is an *opt-in* that turns dereference into
a `DELETE`. `@ElementCollection` targets **value types** that have no identity, so
removal-is-deletion is *intrinsic* — there is nothing to "orphan."

---

## Collection Type Affects the Delete SQL

The generated SQL for a collection mutation depends on the **collection type**, which
is the reason `clear()`+`addAll()` is dangerous under orphan removal:

- **`List` with no `@OrderColumn` → `PersistentBag`.** A bag has no reliable per-row
  identity for Hibernate to diff, so `clear()` + `addAll()` typically triggers a full
  **delete-all then insert-all**:

  ```sql
  delete from OrderLine where order_id=?      -- all rows
  insert into OrderLine (...) values (...)     -- every element re-inserted
  ```

  This loses PK identity, audit history, and any FKs pointing at those rows.

- **`Set`, or a `List` with `@OrderColumn`** can issue **surgical** row-level
  `DELETE ... where id=?` for just the removed elements, preserving the survivors.

- **Removing a single element** from a bag with `orphanRemoval=true` is still a
  targeted `delete from OrderLine where id=?` — it is the *bulk clear-and-re-add* that
  degenerates into delete-all/insert-all, not an individual `remove(x)`.

- **Unidirectional `@OneToMany` with a join column (no `mappedBy`)** is worse: because
  the child does not own the FK, Hibernate may `UPDATE` the FK to null and re-`INSERT`
  it, generating extra statements. Prefer a bidirectional mapping (child owns the FK)
  or an `@OrderColumn`.

> [!INTERVIEW]
> "Remove one line from a `List` (`PersistentBag`) with `orphanRemoval` — one targeted
> `DELETE ... where id=?`. Now `clear()` + `addAll()` — a full delete-all then
> insert-all. Why?" Because a bag can't diff individual rows, so Hibernate recreates
> the whole collection; a `Set`/`@OrderColumn` list can diff and delete surgically.

---

## @ManyToMany: Cascade REMOVE and Join-Table Rows

For a `@ManyToMany`, removing an element from the collection only deletes the **join-
table row** (the link), not the target entity — which is the correct behavior since the
target is shared:

```sql
delete from book_author where book_id=? and author_id=?   -- link only
```

But cascading `em.remove(book)` with `CascadeType.REMOVE`/`ALL` propagates the delete to
the `Author` entities themselves — and those authors may be referenced by *other*
books, causing FK violations or silent **data loss**. **Never put `ALL`/`REMOVE` on a
`@ManyToMany`.** `orphanRemoval` is not even legal there.

---

## Removal Helper: setParent(null) — UPDATE vs DELETE

A common bidirectional removal helper does `child.setParent(null)`. What happens on
flush depends on `orphanRemoval` (Thorben Janssen's canonical example):

```java
public void removeLine(OrderLine l) { lines.remove(l); l.setOrder(null); }
```

- **`orphanRemoval = false`:** the child is disowned but survives; Hibernate issues
  `UPDATE OrderLine SET order_id = NULL WHERE id = ?` (or a `NOT NULL` violation).
- **`orphanRemoval = true`:** the child is an orphan; Hibernate issues
  `DELETE FROM OrderLine WHERE id = ?`.

The `lines.remove(l)` is what the orphan-removal dirty-check detects; setting
`order = null` keeps the in-memory back-reference consistent.

---

## Hibernate 6/7 Version Specifics

- **Native `@Cascade` styles are legacy.** `SAVE_UPDATE`, `REPLICATE`, `LOCK`, `DELETE`
  in `org.hibernate.annotations.CascadeType` are de-emphasized; the underlying
  `Session.saveOrUpdate()` / `replicate()` methods are **deprecated in Hibernate 6** in
  favor of the JPA `persist`/`merge` API. The Hibernate 6.4 User Guide still *lists*
  the native `CascadeType` values (including `LOCK` and `REPLICATE`), but prefer the JPA
  `cascade` attribute unless you genuinely need a native `Session` op.
- **`OnDeleteAction`** enum lives in `org.hibernate.annotations` (values `CASCADE`,
  `NO_ACTION`; older `RESTRICT`).
- **Namespace:** `jakarta.persistence.CascadeType` (Jakarta Persistence 3.1/3.2), not
  the legacy `javax.persistence`.
- **No new cascade values:** Jakarta Persistence 3.2 (the Hibernate 7 baseline) added
  **no new `CascadeType` constants** — the set is still
  `{PERSIST, MERGE, REMOVE, REFRESH, DETACH}` (+ `ALL`). Do not invent one.

---

## Common Interview Follow-ups

- **"What's the difference between `CascadeType.REMOVE` and `orphanRemoval=true`?"**
  `REMOVE` cascades an explicit `em.remove(parent)`; `orphanRemoval` also deletes a
  child when it's *removed from the collection* / dereferenced without the parent
  being deleted. Only orphan removal reacts to dereferencing.
- **"Is `orphanRemoval` a `CascadeType`?"** No. It's a separate boolean attribute on
  `@OneToOne`/`@OneToMany`; `CascadeType.ALL` does not include it.
- **"What is the default cascade for `@OneToMany`?"** None — no operations cascade
  unless you specify `cascade`. (Don't confuse with the *fetch* default, which is
  LAZY for `@OneToMany`.)
- **"You remove a child from the collection but the FK is `NOT NULL` and there's no
  orphan removal — what happens?"** Hibernate tries `UPDATE ... SET order_id=NULL`
  and the DB rejects it with a `NOT NULL` constraint violation.
- **"Why did all my children get deleted on `merge`?"** A detached graph missing
  elements + `orphanRemoval=true` deletes the absent children.
- **"Can I put `orphanRemoval` on `@ManyToOne`?"** No — it's only valid on
  ownership-expressing `@OneToOne`/`@OneToMany`.
- **"Cascade `REMOVE` vs DB `ON DELETE CASCADE`?"** Cascade `REMOVE` runs in the
  persistence context (Hibernate issues child `DELETE`s and fires callbacks); DB
  cascade is a constraint enforced by the database and bypasses Hibernate/callbacks.
- **"Why did adding a persisted child throw a transient-object exception?"** You
  didn't cascade `PERSIST` (or didn't persist the child), so Hibernate hit a
  reference to a transient/unsaved instance on flush.
- **"You `em.remove(old)` then `em.persist(new)` sharing a unique key — why a
  constraint violation?"** The `ActionQueue` runs inserts *before* ordinary deletes, so
  the `INSERT` fires while the old row still exists. Update in place instead.
- **"Deleting a parent issues 200 SQL statements — how do you make it one?"** Cascade
  `REMOVE` loads the collection and deletes per row. Use `@OnDelete(CASCADE)` (DB FK
  cascade) or a manual bulk JPQL delete. You then lose callbacks, L2-cache sync, and
  version checks.
- **"Does `@OnDelete` fire `@PreRemove`?"** No — it is a DB-level FK cascade that
  bypasses the persistence context entirely.
- **"A bulk `delete from Order` ran but children remain / FK violation — why?"** Bulk
  JPQL/HQL bypasses cascade, orphanRemoval, callbacks, and context/L2-cache sync.
- **"Set an `@OneToOne(orphanRemoval=true)` child to null — what happens?"** The old
  child row is `DELETE`d on flush, not just unlinked.
- **"`@ElementCollection` element removal vs `@OneToMany` orphanRemoval?"** Element
  collections are value types with no identity — deletion is intrinsic; there is no
  `orphanRemoval` attribute to set.

## References

- Jakarta Persistence 3.1 / 3.2 Specification — `CascadeType`, `@OneToMany`,
  `@OneToOne`, and the `orphanRemoval` element (`jakarta.persistence` namespace).
- Hibernate ORM 6.x / 7.x User Guide — "Cascading", "Orphan removal", and
  "Associations"; `org.hibernate.annotations.CascadeType` (native styles).
- Hibernate ORM Javadoc — `org.hibernate.annotations.Cascade`,
  `PersistentCollection` (collection dirty-checking mechanism),
  `org.hibernate.annotations.OnDelete` / `OnDeleteAction`, `ActionQueue`.
- Vlad Mihalcea — "orphanRemoval" and "flush operation order / ActionQueue" articles
  (fixed action ordering; unique-constraint remove-then-insert reproduction).
- Thorben Janssen — cascade `REMOVE` N+1 performance, `setPost(null)` UPDATE-vs-DELETE
  example, `@OnDelete` and stale-L2-cache warning.
- Cross-references within this library: `hibernate-jpa/entity-lifecycle-states`,
  `hibernate-jpa/transactions-dirty-checking-flushing`,
  `hibernate-jpa/entity-mappings-associations`,
  `hibernate-jpa/session-entitymanager-persistence-context`,
  `hibernate-jpa/performance-tuning-pitfalls`, and `system-design/ddd-aggregates`.
