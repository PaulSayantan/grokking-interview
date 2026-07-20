export const meta = {
  name: 'messaging-databases-authoring',
  description: 'Author interview-grade concepts.md + a 40-60 MCQ questions.yaml for all 15 Messaging & Databases topics, then verify each for factual accuracy and schema compliance',
  phases: [
    { title: 'Author', detail: 'one agent per topic writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check each topic, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/messaging-databases`

const SCOPE_NOTE = `
DOMAIN SCOPE — "Messaging & Databases" is LANGUAGE/VENDOR-AGNOSTIC and taught at the
PRACTITIONER / MECHANISM level: how databases and messaging systems actually work and how a
backend engineer uses them correctly. This is DISTINCT from system-design (already authored),
which owns the whiteboard/trade-off altitude. Concretely:
- BOUNDARY vs system-design (do NOT re-teach the whiteboard view — teach the MECHANISM):
  * system-design owns: capacity estimation, choosing a datastore for a scenario, high-level
    sharding/replication topology diagrams, message-queue-in-an-architecture, CAP trade-offs,
    caching-in-an-architecture. Those stay there.
  * THIS domain owns: real SQL syntax & query semantics, index B-tree/LSM mechanics & EXPLAIN
    plans, ACID isolation-level ANOMALIES with concrete examples, the Kafka log/partition/
    consumer-group protocol, Redis data-structure commands & persistence, RabbitMQ exchange
    types & ack mechanics, actual replication mechanics (WAL/binlog, sync vs async), connection
    pool sizing. When a topic overlaps (e.g. replication, Kafka, caching), go DEEPER and more
    HANDS-ON than the system-design page — commands, config, failure modes, not topology boxes.
- Framework-neutral: teach the datastore/broker itself (ANSI SQL, the Kafka protocol, the Redis
  command set), not an ORM/driver/client library (Hibernate/JPA is its OWN separate domain — do
  NOT teach entity mapping here). Show real SQL, real redis-cli, real kafka concepts.
- Ground EVERY claim in authoritative sources: the SQL standard (ISO/IEC 9075), PostgreSQL &
  MySQL/InnoDB docs, the Kafka protocol/docs, Redis docs, RabbitMQ/AMQP 0-9-1, Jepsen analyses
  for consistency claims, and canonical papers (Google Spanner, Amazon Dynamo, the isolation-
  levels "A Critique of ANSI SQL Isolation Levels", Kleppmann's DDIA). Verify version-specific
  behavior via web research (e.g. default isolation levels: PostgreSQL READ COMMITTED vs MySQL
  REPEATABLE READ; Kafka exactly-once semantics; Redis persistence RDB vs AOF).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — the study/answer content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - Interview-grade answers, LAYERED: beginner definition + why it matters -> intermediate
     trade-offs/comparisons -> advanced internals/gotchas the interviewer probes.
   - Include concrete examples: real SQL statements, EXPLAIN-plan snippets, index/B-tree or LSM
     sketches, isolation-anomaly walk-throughs, redis-cli / kafka command examples, comparison
     tables. Vendor-neutral but cite where PostgreSQL vs MySQL vs others differ.
   - If a diagram helps (architecture/flow/state), you MAY use a Mermaid fenced block
     (\`\`\`mermaid with flowchart/sequenceDiagram/stateDiagram-v2/erDiagram). Do NOT use ASCII-art
     box diagrams — prefer Mermaid or a table. Keep code/CLI/SQL in normal fenced blocks.
   - End with a "## Common follow-up questions" section and a "## References" section.
   - Factual accuracy is critical. Cite correct default behaviors, isolation levels, and versions.

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"        # matches the concepts.md H1
     domain: messaging-databases
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001     # globally unique within the file, zero-padded 3-digit seq
         difficulty: beginner      # one of: beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                 # 0-BASED index of the correct option
         explanation: |
           <why the correct answer is right; teach the concept>
         ref: "concepts.md#<anchor>"   # deep-link to a concepts.md H2 (GitHub slug: lowercase, spaces->-, punctuation stripped)

   RULES:
   - Produce 40-60 questions (minimum 40). Cover EVERY subtopic with several questions each.
   - 3-5 options per question, EXACTLY ONE correct. 'answer' is 0-based.
   - VARY the correct option's position across the file (do not cluster on one index).
   - Mixed difficulty (mostly beginner/intermediate with some advanced; this is Pass 1 —
     advanced/expert depth is added in a later deepening pass, so don't over-index on expert).
   - INCLUDE scenario-style questions with lengthy plausible options — e.g. "given this SQL /
     this isolation level / this Kafka config / this index, which statement is correct?" or
     "which query/config fixes the problem?". Distractors must be plausible but wrong for a real reason.
   - No "all of the above" / "none of the above".
   - Every 'ref' anchor MUST resolve to an actual "## " heading in concepts.md.
   - id prefix MUST equal the topic-slug.

Use the Write tool to create both files. Do your own web research to ensure correctness.
Return a one-line summary: "<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions)".
`

const TOPICS = [
  { slug: 'relational-modeling-normalization', name: 'Relational Modeling & Normalization', hints: "relational model (relations/tuples/attributes, keys: primary/candidate/foreign/composite/surrogate vs natural); ER modeling & cardinality; functional dependencies; normal forms 1NF-BCNF (+ brief 4NF/5NF) with concrete decomposition examples; denormalization & WHEN it's justified (read-heavy, reporting); anomalies (insert/update/delete) normalization prevents; constraints (NOT NULL, UNIQUE, CHECK, FK actions CASCADE/RESTRICT/SET NULL); star vs snowflake schema for analytics." },
  { slug: 'sql-query-language-advanced-queries', name: 'SQL Query Language & Advanced Queries', hints: "SELECT logical processing order (FROM->WHERE->GROUP BY->HAVING->SELECT->ORDER BY->LIMIT); JOIN types (INNER/LEFT/RIGHT/FULL/CROSS/self) with result semantics & NULL handling; aggregates + GROUP BY + HAVING vs WHERE; subqueries (scalar/correlated/EXISTS vs IN vs JOIN); window functions (ROW_NUMBER/RANK/DENSE_RANK/LAG/LEAD, PARTITION BY, frames); CTEs & recursive CTEs; set ops (UNION/UNION ALL/INTERSECT/EXCEPT); NULL three-valued logic pitfalls; DISTINCT; upsert (INSERT ... ON CONFLICT / MERGE)." },
  { slug: 'sql-indexing-query-optimization', name: 'SQL Indexing & Query Optimization', hints: "B-tree index mechanics (why balanced, range vs equality); clustered vs non-clustered/secondary; composite indexes & leftmost-prefix rule; covering indexes & index-only scans; when an index is NOT used (functions on column, leading wildcard, low selectivity, implicit cast); EXPLAIN / EXPLAIN ANALYZE reading (seq scan vs index scan vs bitmap); query planner & statistics/cardinality estimation; hash vs merge vs nested-loop joins; partial & expression indexes; hash/GiST/GIN/BRIN index types; index write-cost trade-off; N+1 query problem." },
  { slug: 'transactions-acid-isolation-levels', name: 'Transactions, ACID & Isolation Levels', hints: "ACID precisely (atomicity via undo, consistency, isolation, durability via WAL/fsync); the 4 SQL isolation levels (READ UNCOMMITTED/READ COMMITTED/REPEATABLE READ/SERIALIZABLE); the anomalies each prevents (dirty read, non-repeatable read, phantom, + write skew/lost update) with concrete two-transaction walk-throughs; MVCC vs locking implementations; snapshot isolation & write skew (why SI != SERIALIZABLE); SSI (serializable snapshot isolation); PostgreSQL (default READ COMMITTED) vs MySQL/InnoDB (default REPEATABLE READ + gap locks) differences; optimistic vs pessimistic concurrency; deadlocks & detection." },
  { slug: 'database-storage-internals-engines', name: 'Database Storage Internals & Engines', hints: "B-tree/B+tree storage engines (in-place update, read-optimized) vs LSM-tree (memtable+SSTables, compaction, write-optimized) — read/write/space amplification (RUM conjecture); page/heap layout, buffer pool/page cache, dirty pages & checkpoints; WAL / redo / binlog & crash recovery (ARIES); MVCC version storage (Postgres heap bloat + VACUUM vs InnoDB undo log); fill factor; row vs column storage; write-ahead logging vs write-behind; fsync & the durability/performance knob; InnoDB vs MyISAM vs RocksDB vs LevelDB comparison." },
  { slug: 'nosql-databases-data-models', name: 'NoSQL Databases & Data Models', hints: "the 4 families & when each fits: key-value (Redis/DynamoDB), document (MongoDB), wide-column (Cassandra/HBase/Bigtable), graph (Neo4j); aggregate-oriented modeling & denormalization/embedding vs referencing; BASE vs ACID & eventual consistency; consistency tunables (quorum R+W>N, read/write concern); partition key design & hot partitions; secondary indexes in NoSQL; Cassandra query-first modeling & wide rows; DynamoDB single-table design, PK/SK, GSI/LSI; when NoSQL is the WRONG choice; multi-model DBs." },
  { slug: 'vector-databases-similarity-search', name: 'Vector Databases & Similarity Search', hints: "embeddings & vector similarity (cosine/dot-product/Euclidean/L2); the ANN problem (exact kNN doesn't scale); index algorithms — HNSW (graph, layers, ef/M params, recall vs latency), IVF (inverted file, nprobe), IVF-PQ / product quantization (memory compression), ScaNN, LSH; recall vs latency vs memory trade-off; dimensionality & the curse of dimensionality; metadata filtering + vector search (pre vs post filter); hybrid search (BM25 + vector, RRF); use in RAG; pgvector vs dedicated (Pinecone/Milvus/Weaviate/Qdrant); quantization (scalar/binary)." },
  { slug: 'analytics-columnar-timeseries-databases', name: 'Analytics, Columnar & Time-Series Databases', hints: "OLTP vs OLAP workloads; row vs COLUMNAR storage (why columnar wins for analytics — compression, vectorized execution, scan only needed columns); compression schemes (RLE, dictionary, delta, bit-packing); columnar formats (Parquet/ORC) & data lakes; MPP warehouses (Redshift/BigQuery/Snowflake, separation of storage & compute); time-series DBs (InfluxDB/TimescaleDB/Prometheus) — append-heavy, downsampling, retention, hypertables, time-partitioning; roll-ups & continuous aggregates; cardinality explosion in TSDB; when to use a warehouse vs OLTP DB." },
  { slug: 'redis-caching-strategies', name: 'Redis & Caching Strategies', hints: "Redis single-threaded event loop & why it's fast (in-memory); core data structures & use-cases (strings, hashes, lists, sets, sorted sets/ZSET for leaderboards & rate limiting, streams, HyperLogLog, bitmaps, geo); TTL/expiry & eviction policies (LRU/LFU/volatile vs allkeys, maxmemory); persistence RDB (snapshot) vs AOF (append log, fsync policies) & trade-offs; caching patterns (cache-aside/lazy, write-through, write-behind, read-through); cache invalidation & stampede/thundering-herd (locking, TTL jitter, request coalescing); cache penetration/avalanche; Redis replication, Sentinel, Cluster (hash slots); distributed locks (Redlock debate); pub/sub vs Streams." },
  { slug: 'database-scaling-replication-pooling', name: 'Database Scaling: Replication, Read Replicas & Pooling', hints: "vertical vs horizontal scaling; replication mechanics (statement vs row-based/logical, WAL/binlog shipping); sync vs async vs semi-sync replication & the durability/latency trade-off; replication lag & read-your-writes / monotonic-reads problems on read replicas; single-leader vs multi-leader vs leaderless; failover & promotion (split-brain, fencing); read/write splitting; connection pooling (why — connection cost, Postgres per-connection memory; poolers PgBouncer transaction vs session mode; pool sizing formula); sharding basics (range/hash/directory) & cross-shard query/join pain; the difference between replication (copies) and partitioning (splits)." },
  { slug: 'distributed-sql-newsql', name: 'Distributed SQL & NewSQL', hints: "the NewSQL premise (SQL + ACID + horizontal scale, vs NoSQL's consistency sacrifice); Google Spanner (TrueTime, external consistency, GPS/atomic clocks), CockroachDB & YugabyteDB (Raft-replicated ranges, MVCC, no TrueTime -> hybrid logical clocks/HLC); distributed transactions (2PC + Raft/Paxos, why cross-region commit is slow); automatic sharding/rebalancing (ranges vs hash); consensus (Raft) for replication; distributed SQL vs sharded-MySQL/Vitess vs traditional; consistency guarantees (serializable, linearizable reads); the latency cost of strong consistency across regions; Calvin/deterministic approach." },
  { slug: 'apache-kafka', name: 'Apache Kafka', hints: "the distributed commit LOG abstraction; topics/partitions/offsets & ordering guarantee (per-partition only); partition key & why it drives ordering + parallelism; producers (acks=0/1/all, idempotent producer, batching/linger, min.insync.replicas); consumers & CONSUMER GROUPS (partition assignment, rebalancing, offset commit, at-least-once default); replication (leader/follower, ISR, unclean leader election); retention (time/size, log compaction for changelog topics); exactly-once semantics (idempotent producer + transactions); throughput design (zero-copy, sequential IO, page cache); KRaft (ZooKeeper removal); when Kafka vs a queue." },
  { slug: 'rabbitmq-message-queues', name: 'RabbitMQ & Message Queue Patterns', hints: "AMQP 0-9-1 model (producer->exchange->binding->queue->consumer); exchange types (direct, topic, fanout, headers) with routing-key examples; queue vs topic/pub-sub semantics; acknowledgements (manual ack/nack, requeue, prefetch/QoS for fair dispatch); durability & persistence (durable queue + persistent message + publisher confirms) for surviving broker restart; dead-letter exchanges & TTL & retry/backoff; work-queue/competing-consumers, RPC, priority queues; RabbitMQ (smart broker/dumb consumer, push) vs Kafka (dumb broker/smart consumer, pull, replayable log) contrast & when to pick each; quorum queues." },
  { slug: 'messaging-reliability-patterns', name: 'Messaging Reliability & Distributed Messaging Patterns', hints: "delivery semantics (at-most-once/at-least-once/exactly-once, why true EOS is hard & how effectively-once works); idempotent consumers & dedup (idempotency keys, dedup store); the outbox pattern & why dual-write to DB+broker is unsafe; transactional outbox + CDC vs 2PC; inbox pattern; message ordering guarantees & partition/sharding for ordering; poison messages & dead-letter queues; retry with exponential backoff + jitter; saga pattern (choreography vs orchestration) & compensating transactions; consumer lag & backpressure; the dual-write problem in general." },
  { slug: 'stream-processing-cdc', name: 'Stream Processing & Change Data Capture', hints: "stream vs batch processing; stateful stream processing (windowing: tumbling/sliding/session, watermarks for late data, event-time vs processing-time); exactly-once in streaming (checkpointing/barriers, Kafka transactions); Kafka Streams vs Flink vs Spark Structured Streaming (trade-offs, when each); stream-table duality & materialized views; Change Data Capture (CDC) — log-based (reading WAL/binlog via Debezium) vs query/trigger-based, why log-based wins; CDC use-cases (cache invalidation, search index sync, data pipeline, outbox); event sourcing vs CDC; join types in streams (stream-stream, stream-table)." },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a senior backend/data engineer and interview coach authoring LANGUAGE/VENDOR-AGNOSTIC, PRACTITIONER-LEVEL study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${SCOPE_NOTE}\n` +
    `FOCUS / frequently-asked subtopics to cover for THIS topic:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . This is Pass 1 — aim for 40-60 solid MCQs.`,
    { label: `author:${t.slug}`, phase: 'Author' }
  ),
  (authorSummary, t) => agent(
    `You are a meticulous data-systems reviewer verifying LANGUAGE/VENDOR-AGNOSTIC, PRACTITIONER-LEVEL interview content for the "Messaging & Databases" topic "${t.name}" (slug: ${t.slug}).\n\n` +
    `${SCOPE_NOTE}\n` +
    `The files are at ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml . Read BOTH.\n\n` +
    `Check and FIX IN PLACE (using Edit/Write) any of:\n` +
    `1) FACTUAL ERRORS in concepts.md or in MCQ answers/explanations. Do web research to confirm anything uncertain — DEFAULT ISOLATION LEVELS (PostgreSQL READ COMMITTED, MySQL/InnoDB REPEATABLE READ), which anomalies each isolation level allows, SQL logical processing order, index behavior, Kafka acks/ISR/consumer-group/exactly-once semantics, Redis eviction/persistence, RabbitMQ exchange/ack semantics, HNSW/IVF params, replication sync/async trade-offs, Spanner TrueTime vs CockroachDB HLC. A wrong 'answer' index or a wrong isolation/consistency/ordering claim is the WORST defect — fix it.\n` +
    `2) SCOPE DRIFT: if content drifts to the system-design WHITEBOARD altitude (capacity math, topology diagrams, "which datastore for this scenario") instead of MECHANISM, or teaches an ORM/Hibernate/JPA (separate domain) instead of raw SQL/the datastore itself, refocus it on hands-on datastore/broker mechanics. On overlapping topics (replication, Kafka, caching), it must go DEEPER/more hands-on than the system-design page.\n` +
    `3) SCHEMA violations in questions.yaml: valid YAML; top-level keys topic/domain(messaging-databases)/topic_slug(${t.slug})/version/questions; each question has id (prefix '${t.slug}-', unique, 3-digit seq), difficulty in {beginner,intermediate,advanced,expert}, question, 3-5 options, 0-based 'answer' in range, explanation; ids unique; correct-option position VARIED (not all same index) — if clustered, rewrite/reorder some.\n` +
    `4) Every 'ref: concepts.md#anchor' must resolve to an actual '## ' heading in concepts.md (GitHub slug rules). Fix mismatches. Any Mermaid blocks must be valid.\n` +
    `5) COVERAGE: at least 40 questions, every subtopic represented, mixed difficulty, some scenario-style ("given this SQL/config/isolation level, what's true?" / "which fixes it?") questions present. If thin or a subtopic is uncovered, ADD questions to reach the bar.\n\n` +
    `After fixing, return a one-line verdict: "<slug>: <questionCount> questions, <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify' }
  )
)

return results.filter(Boolean)
