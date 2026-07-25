# NoSQL Databases & Data Models

"NoSQL" ("Not Only SQL") is an umbrella for datastores that reject one or more of the
defining assumptions of the relational model: a fixed relational schema, normalized
tables joined at query time, and single-node ACID transactions. They arose in the
mid-2000s (Google Bigtable 2006, Amazon Dynamo 2007, MongoDB and Cassandra 2008-09) to
serve workloads where **horizontal scale, flexible schema, and specific access patterns**
mattered more than ad-hoc query flexibility.

The single most important idea to carry into an interview: NoSQL databases are
**aggregate-oriented** and **access-pattern-first**. You do not model your domain into
normalized entities and then figure out queries; you enumerate your queries first and
shape the data so each query is a single cheap lookup. Denormalization is not a smell
here — it is the design.

This note teaches the *mechanisms*: how each family stores and retrieves data, how you
model for it, how consistency is tuned, and — crucially — the failure modes (hot
partitions, unbounded rows, cross-partition scatter-gather) an interviewer will probe.

---

## The four NoSQL families and when each fits

NoSQL stores are conventionally grouped into four families by their data model. Know the
representative products and the shape of data each holds.

| Family | Data model | Representative products | Natural access pattern |
|---|---|---|---|
| **Key-value** | opaque value keyed by a single key | Redis, Amazon DynamoDB, Riak, Memcached | `GET(key)` / `PUT(key, value)` |
| **Document** | self-describing JSON/BSON documents | MongoDB, Couchbase, Amazon DocumentDB | query by fields inside the document |
| **Wide-column** | rows of sparse column families, partitioned by key | Cassandra, HBase, Google Bigtable, ScyllaDB | range scan within a partition, keyed by partition + clustering columns |
| **Graph** | nodes + edges with properties | Neo4j, Amazon Neptune, JanusGraph | traverse relationships (multi-hop) |

**How to choose (the interview answer):**
- **Key-value** when access is always by a known primary key and the value is opaque to
  the DB (session store, cache, feature flags, shopping cart). Fastest and simplest.
- **Document** when entities are self-contained aggregates with nested structure and you
  query by their fields (product catalog, user profiles, content/CMS, event payloads).
- **Wide-column** when you have massive write volume and time-series/append-heavy data
  queried by a partition key over a sorted range (IoT telemetry, event logs, feeds,
  messaging). Optimized for writes and linear scale-out.
- **Graph** when the *relationships* are the query — many-to-many, variable-depth
  traversals (social graphs, fraud rings, recommendations, network/asset topology). A
  3-hop "friends of friends who bought X" is a cheap traversal in a graph DB and an
  expensive multi-join in SQL.

> [!KEY-TAKEAWAY]
> The family is chosen by **access pattern**, not by "we have a lot of data." Pick
> key-value for pure key lookups, document for self-contained aggregates you filter by
> field, wide-column for high-write partitioned range scans, and graph for relationship
> traversals.

The boundaries blur in practice: DynamoDB is key-value but supports document attributes
and secondary indexes; Redis has rich structures (see below); many products are now
**multi-model** (see the last section).

---

## Key-value stores: Redis and DynamoDB

The simplest model: a dictionary. Every operation is by a single key; the value is (to
the DB) opaque bytes. This constraint is what lets key-value stores scale trivially by
sharding on the key.

**Redis** — an in-memory data-structure server, not just a plain KV store. Values can be
typed structures, each with O(1)/O(log n) operations:

```
SET session:42 "{...}" EX 3600        # string with 1-hour TTL
INCR page:views                       # atomic counter
HSET user:42 name "Ada" age 36        # hash (field/value map)
LPUSH queue:jobs "job-1"              # list (used as a queue)
ZADD leaderboard 4200 "player:7"      # sorted set (score-ordered)
SADD tags:post:9 "sql" "nosql"        # set
EXPIRE session:42 1800                # reset TTL
```

Redis is single-threaded for command execution per node (commands are atomic, no
interleaving), persists via RDB snapshots and/or AOF, and scales horizontally with Redis
Cluster (16384 hash slots). It is covered in depth in the dedicated Redis topic; here the
point is that a KV store can offer far more than `GET`/`SET`.

**DynamoDB** — a fully-managed, horizontally-partitioned key-value + document store. Its
primary key is either:
- a single **partition key** (a.k.a. hash key), or
- a **composite key**: partition key (PK) + **sort key** (SK).

The partition key is hashed to choose a physical partition; the sort key orders items
*within* a partition, enabling range queries (`Query` with `begins_with`, `between`, `>`).
An item is a set of attributes (up to **400 KB** including names and values). DynamoDB is
schemaless except for the key attributes.

> [!TIP]
> Reach for a key-value store when the answer to "how will you read this?" is always
> "by its id." The moment you need to filter or sort by *other* fields regularly, you
> need secondary indexes (DynamoDB) or a different family.

---

## Document stores: MongoDB and the document model

A document store holds **self-describing** documents — JSON (MongoDB stores BSON, a
binary superset with more types and lengths). Documents in a collection need not share a
schema, though good practice keeps them consistent.

```js
// A single document is an aggregate: order + its line items embedded
db.orders.insertOne({
  _id: "ord-1001",
  customerId: "cust-42",
  status: "SHIPPED",
  total: 129.90,
  items: [                                   // embedded array (nested)
    { sku: "A1", qty: 2, price: 19.95 },
    { sku: "B7", qty: 1, price: 90.00 }
  ],
  shippingAddress: { city: "Berlin", zip: "10115" }
})

db.orders.find({ status: "SHIPPED", "shippingAddress.city": "Berlin" })
         .sort({ total: -1 }).limit(10)      // query by nested fields
```

Strengths: the whole aggregate is read/written in one operation (no join), schema
evolves per-document, and rich secondary indexes (including on nested fields, arrays,
text, geo) let you query by content. This makes document stores a good default for
application data where each entity is a natural aggregate (a product, a profile, an
order).

Trade-offs / gotchas the interviewer probes:
- **Document size cap**: MongoDB documents are limited to **16 MB**. Unbounded embedded
  arrays (e.g. every comment on a viral post) will blow this — that is a *referencing*
  case (see next section).
- **Joins are limited**: `$lookup` exists but is not a first-class equi-join engine;
  heavy relational querying is an anti-pattern.
- **Transactions**: MongoDB added multi-document ACID transactions in 4.0 (replica sets)
  and 4.2 (sharded clusters), but they are more expensive than a single-document write,
  which is *always* atomic. Design so the aggregate boundary matches the transaction
  boundary and you rarely need multi-doc transactions.

---

## Wide-column stores: Cassandra, HBase, Bigtable

Despite the name, wide-column is **not** columnar/analytics storage. The model
(from Google's Bigtable paper) is a **sparse, distributed, multi-dimensional sorted map**:
a row key maps to column families, each holding many columns; different rows can have
different columns. Rows are partitioned across nodes by the partition key and stored
**sorted** within a partition.

Cassandra's CQL looks like SQL but the storage model is different:

```sql
CREATE TABLE sensor_readings (
  sensor_id   text,
  bucket      date,          -- partition key part 2 (time bucketing)
  reading_ts  timestamp,     -- clustering column (sort within partition)
  value       double,
  PRIMARY KEY ((sensor_id, bucket), reading_ts)
) WITH CLUSTERING ORDER BY (reading_ts DESC);

-- Efficient: hits ONE partition, reads a sorted range
SELECT * FROM sensor_readings
WHERE sensor_id='s-1' AND bucket='2026-07-19'
  AND reading_ts >= '2026-07-19T00:00:00' AND reading_ts < '2026-07-19T12:00:00';
```

- The `PRIMARY KEY` first element (possibly compound, in extra parens) is the
  **partition key** — it decides which node stores the data.
- Remaining elements are **clustering columns** — they sort rows *inside* a partition and
  enable range scans and `ORDER BY`.
- Storage engine is **LSM-tree** based (Log-Structured Merge-tree). Instead of updating
  records in place on disk (as a B-tree does, paying a random-write seek each time), an
  LSM-tree buffers writes in an in-memory sorted table (the **memtable**) plus an
  append-only commit log, then periodically flushes the memtable to disk as an immutable
  sorted file (an **SSTable**, Sorted String Table). Because on-disk writes are pure
  sequential appends of whole files — never in-place edits — writes are extremely fast. The
  cost is on the read side: a lookup may have to check the memtable plus several SSTables
  and merge the results (**read amplification**), and a background process called
  **compaction** continuously merges SSTables to bound their number and discard superseded
  versions.

Cassandra is **masterless / peer-to-peer** (consistent hashing ring, no single leader),
giving linear write scalability and no single point of failure. HBase and Bigtable use a
region-server/tablet model over HDFS/Colossus with a coordinator. All three are built for
write-heavy, horizontally-scaled, partition-keyed range access — not ad-hoc queries.

> [!WARNING]
> In Cassandra a query that does not restrict the full partition key forces an
> `ALLOW FILTERING` cluster-wide scan — an anti-pattern that gets slower as the cluster
> grows. If you find yourself wanting `ALLOW FILTERING`, your table is modeled for the
> wrong query.

---

## Graph databases: Neo4j and traversals

Graph databases make **relationships first-class citizens**: data is nodes (entities) and
edges (relationships), both carrying properties. The killer feature is **index-free
adjacency** — each node holds direct pointers to its neighbors, so traversing an edge is
O(1) and does not depend on table size. A variable-depth traversal that would be a cascade
of self-joins in SQL is a linear walk in a graph DB.

```cypher
// Neo4j Cypher: people within 2 hops of Alice who bought product P
MATCH (alice:Person {name:'Alice'})-[:FRIEND*1..2]-(f:Person)-[:BOUGHT]->(p:Product {sku:'P'})
RETURN DISTINCT f.name
```

Use a graph DB when the *connections* are the value: social networks, recommendation
("people who X also Y"), fraud-ring detection, identity/permission graphs, network and
supply-chain topology, knowledge graphs. Two query-language families dominate: **Cypher**
(Neo4j, openCypher, Neptune) and **Gremlin** (Apache TinkerPop, JanusGraph, Neptune, which
also supports SPARQL for RDF).

Trade-off: graph DBs excel at deep traversals but are usually harder to shard (a graph
doesn't partition cleanly — edges cross partitions) and are overkill when relationships
are shallow and a join or two suffices.

---

## Aggregate-oriented modeling: embedding vs referencing

Relational modeling normalizes to eliminate redundancy, then joins at read time. NoSQL
(especially document and wide-column) is **aggregate-oriented**: you group data that is
accessed together into one unit written and read atomically, accepting redundancy.

**Embedding** (denormalize — nest related data in one document/row):
- Pros: single read returns everything; atomic single-document write; no join.
- Cons: duplication (same data copied into many aggregates), risk of unbounded growth,
  updates to duplicated data must touch many places.
- Use when: the child data is owned by and read with the parent, is bounded in size, and
  changes with the parent (order + line items, blog post + a few tags).

**Referencing** (store an id / foreign key and look up separately):
- Pros: no duplication, no size bomb, shared entities updated once.
- Cons: multiple round-trips or a `$lookup`/application-side join.
- Use when: the relationship is many-to-many, the child set is large or unbounded, or the
  referenced entity is large and shared (users referencing a shared `company` doc; a post
  referencing potentially millions of comments).

> [!INTERVIEW]
> The classic rule of thumb: **"embed for one-to-few, reference for one-to-many and
> many-to-many."** State the two failure modes you're balancing: unbounded document
> growth (over-embedding) versus N+1 read fan-out (over-referencing). Mention that
> denormalized copies require an update/consistency strategy (fan-out on write, or accept
> staleness).

The deeper principle (Martin Fowler / DDD): an **aggregate** is a consistency boundary.
NoSQL rewards you when your aggregate boundary matches both your transaction boundary and
your access pattern, and punishes you (cross-aggregate joins, distributed transactions)
when it doesn't.

---

## BASE vs ACID and eventual consistency

Relational databases target **ACID** (Atomicity, Consistency, Isolation, Durability).
Many distributed NoSQL stores instead adopt **BASE**: **B**asically **A**vailable,
**S**oft state, **E**ventual consistency. The trade is rooted in the **CAP theorem**:
under a network partition you must choose availability or (linearizable) consistency, and
in **PACELC** terms, even without a partition you trade latency against consistency.

- **Eventual consistency**: after writes stop, all replicas *converge* to the same value,
  but a read immediately after a write may see stale data. Good enough for likes, view
  counts, feeds, catalogs.
- **Read-your-writes / monotonic reads / causal consistency**: stronger session
  guarantees that fix the most jarring anomalies without full linearizability. Concretely:
  *read-your-writes* means you always see your own just-made update (you never post a
  comment and then not see it on refresh); *monotonic reads* means once you've seen a value
  you never see an older one on a later read (time never appears to run backwards); *causal
  consistency* means if write A caused write B, everyone observes A before B (a reply never
  shows up before the message it answers).
- **Strong / linearizable consistency**: every read sees the latest committed write, as
  if there were one copy. Costs latency and availability.

Positioning of real systems:
- **DynamoDB**: eventually consistent reads by default (cheaper, lower latency);
  **strongly consistent reads** available per-request (`ConsistentRead=true`) at 2x cost
  and only within a region.
- **Cassandra**: tunable per query via consistency level (see next section).
- **MongoDB**: single-document writes are atomic; **read/write concern** tune durability
  and recency; primary reads are strong, secondary reads can be stale.

> [!WARNING]
> "NoSQL = no ACID" is outdated and wrong in interviews. Single-document/single-row
> writes are atomic in MongoDB, DynamoDB, and Cassandra. MongoDB 4.0+/4.2+ has
> multi-document ACID transactions; DynamoDB has `TransactWriteItems`/`TransactGetItems`
> (up to 100 items, all-or-nothing). What you lose at scale is cheap *cross-partition*
> transactions and joins, not atomicity per se.

---

## Consistency tunables: quorums, R + W > N, read/write concern

Dynamo-style systems let you trade consistency, latency, and availability **per
operation** by choosing how many replicas must respond.

Let **N** = replication factor (copies of each item), **W** = replicas that must ack a
write, **R** = replicas that must respond to a read. The core inequality:

> **If R + W > N, the read and write replica sets overlap by at least one node, so a read
> is guaranteed to see the most recent acknowledged write** (a "quorum" read/write).

- `W=N, R=1`: fast reads, slow/fragile writes (any node down blocks writes).
- `W=1, R=N`: fast writes, slow reads; write survives with one node.
- `W=quorum, R=quorum` (e.g. N=3, W=2, R=2 → 4 > 3): balanced strong-ish consistency and
  tolerance of one node down. This is the common default.
- `R + W <= N` (e.g. N=3, W=1, R=1): fully eventual — fast and available, but reads may be
  stale.

Cassandra expresses this as **consistency levels** per statement:

```sql
CONSISTENCY QUORUM;                 -- session default for following statements
INSERT INTO users (id, name) VALUES (1, 'Ada');   -- write to QUORUM replicas
SELECT * FROM users WHERE id = 1;                 -- read from QUORUM replicas
-- ONE, TWO, QUORUM, LOCAL_QUORUM, EACH_QUORUM, ALL, ANY ...
```

`LOCAL_QUORUM` (quorum within the local datacenter) is the standard choice for
multi-DC deployments — strong within a region without cross-DC latency.

**MongoDB** exposes the same knobs differently:
- **Write concern** `w`: `w:1` (ack from primary only), `w:"majority"` (ack from a
  majority of replica-set members — durable across failover). Since **MongoDB 5.0** the
  default write concern is `w:"majority"`. `j:true` requires the write hit the on-disk
  journal.
- **Read concern**: `"local"` (default, may be rolled back), `"majority"` (only
  majority-committed data), `"linearizable"`, `"snapshot"` (for transactions).

**DynamoDB** simplifies it to two read modes (eventually vs strongly consistent);
durability is always a quorum write to multiple AZs before ack.

> [!KEY-TAKEAWAY]
> Memorize **R + W > N ⇒ quorum overlap ⇒ read sees latest write**. Note the caveats: it
> guarantees overlap, but plain Dynamo-style quorums are *not* fully linearizable (they
> lack the ordering/leader coordination of Paxos/Raft), and hinted handoff / read repair
> handle transient failures. Cassandra's `QUORUM`/`LOCAL_QUORUM` and MongoDB's
> `w:"majority"` are the practical spellings of this idea.

---

## Partition key design and hot partitions

In every horizontally-sharded NoSQL store, the **partition key decides which physical
node/partition stores an item** (usually via hashing). Get this wrong and no amount of
capacity helps — because load concentrates on one partition.

A **hot partition** is a single partition receiving a disproportionate share of traffic
(or holding disproportionate data). Causes:
- **Low-cardinality key**: partitioning orders by `status` (only a few values) or by
  `country` funnels most traffic to one partition.
- **Monotonic / sequential key**: partitioning by `date` or an auto-increment id sends all
  *new* writes to the newest partition (a "hot tail") — the classic time-series mistake.
- **Skewed key**: one celebrity user, one popular product = one scalding partition.

Fixes:
- **Choose a high-cardinality, evenly-distributed key** (a user id, an entity uuid).
- **Composite / bucketed keys**: `sensor_id + day` spreads a device's data across daily
  partitions instead of one ever-growing row.
- **Write sharding / salting**: prefix the key with a small random or hashed suffix
  (`user123#0` .. `user123#9`) to fan a hot key across 10 partitions; reads scatter-gather
  across the suffixes. Trades read complexity for write spread.

DynamoDB **adaptive capacity** and partition splitting mitigate some skew automatically,
but a genuinely single hot key still bottlenecks; a single partition has hard throughput
ceilings (historically ~3000 RCU / 1000 WCU per partition).

> [!INTERVIEW]
> When asked "why is one node melting while the cluster is idle?" the answer is almost
> always partition-key skew. Name the three culprits — low cardinality, monotonic keys,
> and celebrity/hot-key skew — and the three fixes — better key, bucketing, and salting.

---

## Secondary indexes in NoSQL

The primary key gives one efficient access path. A **secondary index** lets you query by
other attributes — but in a distributed store this is subtle because the index data itself
must be partitioned.

Two structural approaches:
- **Local secondary index**: index lives *with* each partition (indexes items sharing the
  same partition key). Query must still specify the partition key; the index just adds a
  sort/filter dimension within it. Cheap and consistent, limited scope.
- **Global secondary index**: a separate, independently-partitioned structure keyed by the
  indexed attribute. Lets you query across all partitions by the new key, at the cost of
  being maintained asynchronously (eventually consistent) and consuming extra storage/write
  capacity.

**DynamoDB** makes this concrete:

| | LSI (Local Secondary Index) | GSI (Global Secondary Index) |
|---|---|---|
| Key | same PK, **different sort key** | **different PK and SK** |
| When created | only at table creation | any time |
| Max per table | **5** | **20** (default quota) |
| Consistency | strong or eventual | **eventual only** |
| Capacity | shares table's | **its own** RCU/WCU |
| Constraint | 10 GB limit per partition-key value | none of that |

**Cassandra** secondary indexes (`CREATE INDEX`) are *local* to each node and are a known
trap: querying a low-cardinality indexed column scatters to every node. Prefer a
**materialized view** or a purpose-built denormalized query table instead.

**MongoDB** has true rich secondary indexes (B-tree), including compound, multikey (arrays),
text, geospatial, partial, and TTL indexes — closest to relational indexing among NoSQL
families.

> [!WARNING]
> A GSI is not free and not instantly consistent: writes to the base table propagate to
> the GSI asynchronously, so a read-after-write against a GSI can miss the just-written
> item. And if the GSI's provisioned throughput is exhausted, base-table writes can be
> throttled.

---

## Cassandra query-first modeling and wide rows

Cassandra is the canonical example of **query-first (query-driven) modeling**: you do not
normalize entities and then query — you list every query the application will run and
create **one table per query**, duplicating data as needed. Joins do not exist; you
denormalize instead.

The workflow:
1. Enumerate access patterns ("get a user's messages newest-first", "get message by id").
2. For each, design a table whose partition key + clustering columns make that query a
   single-partition sorted read.
3. Duplicate data across those tables; keep them in sync on write (batch or app logic).

A **wide row** (wide partition) is a partition holding many clustering rows sorted by the
clustering column — the natural shape for feeds, time series, and messaging:

```sql
CREATE TABLE messages_by_conversation (
  conversation_id uuid,
  message_id      timeuuid,      -- clustering: time-ordered
  sender_id       uuid,
  body            text,
  PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);   -- newest first, no sort at query time
```

This reads a conversation's recent messages from **one partition** in sorted order — fast
and scalable. But partitions must be **bounded**: Cassandra degrades badly on partitions
over ~100 MB or ~2 billion cells, and compaction/repair suffer. Bucketing (e.g. include a
month in the partition key) keeps wide rows from growing forever.

> [!KEY-TAKEAWAY]
> Cassandra modeling inverts the relational process: **queries first, one table per query,
> denormalize freely, keep partitions bounded.** Never model for a query you didn't plan
> for — retrofitting it means a full-scatter scan or a new table + backfill.

---

## DynamoDB single-table design

The advanced DynamoDB idiom is **single-table design**: store *multiple entity types*
(users, orders, order-items) in **one** table, overloading the partition key (PK) and sort
key (SK) so that related items share a partition and can be fetched in a single `Query`.

The trick is **generic, overloaded key attributes** and key prefixes that encode type:

| PK | SK | (attributes) |
|---|---|---|
| `USER#42` | `PROFILE` | name, email |
| `USER#42` | `ORDER#1001` | total, status |
| `USER#42` | `ORDER#1002` | total, status |
| `ORDER#1001` | `ITEM#A1` | sku, qty |

A single `Query` on `PK = USER#42 AND begins_with(SK, "ORDER#")` returns all of a user's
orders in one round-trip — no join, no second query. GSIs with overloaded keys (often
called `GSI1PK`/`GSI1SK`) provide the *inverse* and alternate access patterns (e.g. "all
items in order 1001", "orders by status").

Why do this: DynamoDB has no joins, and each cross-item fetch is a separate network call.
Co-locating related items in one partition makes the common access pattern a single
efficient query, and having one table simplifies capacity and operations.

Trade-offs / gotchas:
- It is **hard to design and read** — keys are opaque, and you must know every access
  pattern up front (query-first, like Cassandra).
- **Adding a new access pattern** later often means a new GSI or a backfill.
- Analytics/ad-hoc queries are impractical — pair it with a stream to a warehouse.

> [!INTERVIEW]
> Be ready to state the rationale: DynamoDB charges per request and offers no joins, so
> single-table design co-locates related entities under a shared partition key to satisfy
> access patterns in one `Query`. Also be ready with the honest downside: it demands
> up-front knowledge of all queries and is opaque to newcomers — many teams pragmatically
> use a few tables instead.

---

## When NoSQL is the wrong choice

Interviewers love this because it tests judgment, not buzzwords. Reach for a relational
database (or a distributed SQL / NewSQL system) instead of NoSQL when:

- **You need ad-hoc, unpredictable queries and joins.** OLAP/BI, internal admin tools, and
  evolving analytics need flexible querying — NoSQL's "model for known access patterns"
  fights you here.
- **Complex multi-entity transactions are core** (transfers, inventory + payment +
  ledger). Relational ACID across many rows is first-class; distributed NoSQL transactions
  are limited (DynamoDB ≤100 items) or costly.
- **Strong relational integrity matters**: foreign keys, unique constraints, and
  referential integrity are enforced by the engine, not your application code.
- **Data is highly relational / normalized** and duplication would be error-prone.
- **Your data volume is modest.** A single PostgreSQL/MySQL node comfortably handles many
  TB and tens of thousands of TPS. "We might scale someday" is not a reason to give up
  joins and transactions today.
- **Strong consistency across the dataset is required** and you cannot tolerate stale
  reads or reconcile conflicts.

> [!WARNING]
> The most common real-world mistake is choosing NoSQL for scale it will never need, then
> reimplementing joins, transactions, and constraints badly in application code. Modern
> PostgreSQL also has JSONB (document-style storage with indexing), so "we need flexible
> schema" alone is not a reason to leave relational. Choose NoSQL for a *specific*
> access-pattern/scale reason you can articulate.

---

## Multi-model databases

A **multi-model** database supports more than one data model (document, key-value,
graph, relational, wide-column, search) over a single engine and often a single query
interface — so you avoid running and syncing several specialized stores.

Examples:
- **ArangoDB** — document + graph + key-value in one engine (AQL).
- **Amazon DynamoDB** — key-value + document.
- **Cosmos DB** (Azure) — multiple APIs (SQL/document, Cassandra, Gremlin/graph, Table,
  MongoDB) over one backend.
- **Couchbase** — document + key-value + full-text + SQL-like N1QL.
- **PostgreSQL** — often called multi-model *by extension*: relational + JSONB (document)
  + `hstore` (key-value) + PostGIS (geo) + `pgvector` (vectors) + `ltree`/recursive CTEs
  (hierarchies).

Trade-offs: a multi-model store reduces operational sprawl and data duplication across
systems, but a purpose-built engine (Neo4j for deep graph traversal, Cassandra for
write-heavy wide-column) usually beats a generalist on its home turf. The interview
answer: multi-model is a **consolidation / simplicity** play; specialized stores win on
peak performance for their specific model.

---

## Common follow-up questions

- **"When would you pick DynamoDB over MongoDB (or vice versa)?"** DynamoDB for managed,
  predictable single-digit-ms KV/document access with known access patterns and
  AWS-native ops; MongoDB for richer ad-hoc querying, secondary indexes on many fields,
  and a more flexible document/aggregation model.
- **"Explain R + W > N with N=3."** With W=2 and R=2, the two-node read set and two-node
  write set must share at least one node (2+2 > 3), so the read sees the latest write;
  the system still tolerates one node being down.
- **"How do you fix a hot partition?"** Higher-cardinality partition key, time/entity
  bucketing, and write-sharding/salting; explain the read scatter-gather cost of salting.
- **"Why does Cassandra want `ALLOW FILTERING` for my query, and why is that bad?"** The
  query doesn't restrict the partition key, forcing a cluster-wide scan that worsens as
  the cluster grows — remodel with a query-specific table.
- **"Embed or reference the comments on a post?"** Reference — comments are unbounded and
  would eventually exceed the 16 MB document limit; embed only bounded one-to-few data.
- **"Is NoSQL faster than SQL?"** Not inherently. It's faster *for the access pattern it's
  modeled for*, by avoiding joins and scaling out; for ad-hoc queries and joins a relational
  engine is usually faster and simpler.
- **"Difference between LSI and GSI?"** LSI shares the partition key with a different sort
  key, must be created with the table, max 5, can be strongly consistent; GSI has its own
  partition+sort key and capacity, added anytime, max 20, eventually consistent.

## References

- Amazon, *Dynamo: Amazon's Highly Available Key-value Store* (SOSP 2007).
- Google, *Bigtable: A Distributed Storage System for Structured Data* (OSDI 2006).
- Google, *Spanner: Google's Globally-Distributed Database* (OSDI 2012).
- M. Kleppmann, *Designing Data-Intensive Applications* (O'Reilly, 2017) — chapters on
  data models, replication, partitioning, and consistency.
- P. Sadalage & M. Fowler, *NoSQL Distilled* (Addison-Wesley, 2012) — aggregate orientation,
  the four families.
- Amazon DynamoDB Developer Guide — core components, partitions, secondary indexes (LSI/GSI),
  service quotas (400 KB item, 5 LSI, 20 GSI), single-table design, transactions.
- Apache Cassandra documentation — data modeling, CQL, consistency levels, partitions.
- MongoDB Manual — documents (16 MB limit), write/read concern (`w:"majority"` default
  since 5.0), transactions (4.0/4.2), indexes.
- Neo4j documentation — property graph model, index-free adjacency, Cypher.
- E. Brewer, *CAP Twelve Years Later* (IEEE Computer, 2012); D. Abadi, *PACELC*.
- Werner Vogels, *Eventually Consistent* (ACM Queue, 2008).
