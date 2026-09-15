export const meta = {
  name: 'system-design-advanced-expand',
  description: 'Expand System Design with 8 new advanced/expert topics (interview method, consensus/clocks, distributed txns, capacity+tail-latency, failure theory, data-internals, probabilistic structures, DDD/microservices) AND deepen 6 existing core topics with advanced/expert concepts + MCQs',
  phases: [
    { title: 'AuthorNew', detail: 'one agent per NEW topic researches + writes concepts.md + questions.yaml' },
    { title: 'VerifyNew', detail: 'fact-check + schema-check the new topics, fix in place' },
    { title: 'Deepen', detail: 'append advanced/expert MCQs + enrich concepts on existing topics' },
    { title: 'VerifyDeepen', detail: 'fact-check + dedupe + schema-check the deepened topics' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const RESEARCH = `
RESEARCH FIRST (this is advanced/expert material — accuracy matters): use web search to gather
current, correct, senior-level material. Authoritative sources: "Designing Data-Intensive Applications"
(Kleppmann), the Raft & Paxos papers (Ongaro/Lamport), Google Spanner / TrueTime & Percolator & Calvin
papers, "The Tail at Scale" (Dean & Barroso), the AWS Builders' Library (esp. timeouts/retries/jitter,
static stability, avoiding fallback, workload isolation), Marc Brooker's blog, Brendan Gregg (USE method),
"Metastable Failures in Distributed Systems" (Bronson et al.), Eric Evans & Vaughn Vernon (DDD), Sam Newman
(microservices), martinfowler.com, the system-design-primer, and top eng blogs (Netflix, Uber, Discord,
Meta, Stripe, Cloudflare). Prefer precise, defensible statements; distributed systems has subtle claims —
get them RIGHT (e.g. what linearizability actually guarantees, why Redlock is criticized, what 2PC blocks on).
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — deep study content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - IMPORTANT: heading text must NOT contain '/' or '&' (they break anchor slugs). Use commas / "and".
   - EXPERT-LEVEL depth: intuition → precise mechanism / theory → real systems that use it → **TRADE-OFFS**
     and failure modes. This is senior/staff-level content: name the subtle guarantees, the edge cases, the
     "what breaks first", and WHEN to use vs avoid each technique. For EVERY choice state what you gain,
     what you give up, and when the alternative wins.
   - Include: comparison tables (option A vs B vs C with columns for the dimensions that matter);
     concrete numbers (latency ballparks, p99 vs p999, amplification factors, quorum math); ASCII diagrams
     where they clarify; formulas where relevant (Little's Law, USL, quorum intersection R+W>N, retry
     amplification). Show the MATH, not just the name.
   - End with "## Common interview follow-up questions" and "## References" (list the actual papers/books/
     talks/blogs you used).

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"
     domain: system-design
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq from 001, prefix = topic-slug
         difficulty: advanced     # beginner | intermediate | advanced | expert
         tags: [kebab, tokens]
         question: |
           <prompt>
         options:
           - "<option 0>"
           - "<option 1>"
           - "<option 2>"
           - "<option 3>"
         answer: 2                # 0-BASED index of the correct option
         explanation: |
           <why correct; and WHY the distractors are wrong / what subtle guarantee or trade-off they miss>
         ref: "concepts.md#<anchor>"   # QUOTED string; resolves to a real "## " heading (GitHub slug rules)

   RULES:
   - Produce 55-75 questions. Cover EVERY subtopic with several questions each.
   - This is ADVANCED/EXPERT material: skew HARD — roughly 5% beginner, 20% intermediate, 40% advanced,
     35% expert (all four tiers must appear, but the bank should feel senior).
   - MANY questions must be TRADE-OFF / scenario / judgment / "what breaks" style with LONG, plausible,
     descriptive options (each a defensible-sounding position) so the learner must reason, not pattern-match.
     Exactly ONE best answer; distractors wrong for a SPECIFIC reason (violates a guarantee, wrong failure
     model, wrong scale, misses the real trade-off). Include some quant/estimation questions (quorum math,
     tail-latency math, amplification, capacity) where relevant.
   - 3-5 options, exactly one correct, 'answer' 0-based, VARY the correct index across the file (do NOT
     cluster answers at one index).
   - No "all/none of the above". Every 'ref' anchor (QUOTED) resolves to a real "## " heading. id prefix = slug.

Use the Write tool to create both files. Return one line:
"<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions, all tiers)".
`

// ---------- Phase 1: NEW advanced/expert topics ----------
const NEW_TOPICS = [
  { slug: 'interview-method-scenario-playbooks',
    name: 'System Design Interview Method and Scenario Playbooks',
    hints: 'the DRIVEN, trade-off-first narrative interviewers reward; the structured loop (scope & requirements: functional vs non-functional; back-of-envelope estimation — QPS, storage, bandwidth, read:write ratio; API + data model FIRST; high-level happy-path design; deep-dive on the hard part; identify bottlenecks & scale iteratively; failure modes & trade-offs); how to ASK clarifying questions and pin the numbers that drive design; how to ARTICULATE trade-offs out loud (name what you gain and give up before the interviewer asks); estimation drills & latency numbers every engineer should know; the seniority signal (reasoning about tail latency, blast radius, operational cost, not just throughput); common anti-patterns (jumping to a solution, over-engineering, ignoring the interviewer steer, silent design); per-problem THINKING TEMPLATES / playbooks for classic prompts (URL shortener, news feed/Twitter, chat/WhatsApp, rate limiter, payment/idempotent charge, Uber/geo-matching, YouTube/video, notification fanout, distributed job scheduler) — for each: the key requirement to nail, the pivotal trade-off, and the expected deep-dive; how to handle "scale this from 1K to 100M users"; how to disagree/defend a choice gracefully.' },
  { slug: 'consensus-clocks-and-time',
    name: 'Consensus, Logical Clocks and Time in Distributed Systems',
    hints: 'consensus problem & FLP impossibility (intuition); Paxos (single-decree, Multi-Paxos, roles) and why it is hard to implement; Raft (leader election, terms, log replication, commit index, safety, membership changes) — the interview-favorite; Zab (ZooKeeper) & Viewstamped Replication at a high level; quorum intersection & why majority quorums work; Flexible Paxos (grid quorums); leader-based vs leaderless replication; TIME & ORDERING: physical clock skew, NTP limits, Lamport timestamps (happens-before), vector clocks (detecting concurrency/causality), version vectors, hybrid logical clocks (HLC), Google TrueTime & commit-wait in Spanner; linearizability vs sequential vs causal vs eventual (precise guarantees + how to test with Jepsen intuition); when you actually NEED consensus vs when eventual/CRDT suffices; the cost of consensus (latency, availability during partition, throughput).' },
  { slug: 'distributed-transactions-advanced',
    name: 'Distributed Transactions Beyond Saga: 2PC, 3PC and Deterministic Approaches',
    hints: 'why distributed transactions are hard (atomicity across nodes, partial failure); two-phase commit (2PC) protocol, the coordinator, the blocking problem & coordinator failure, in-doubt transactions, why 2PC is avoided at scale; three-phase commit (3PC) & why it still fails under network partition; the saga pattern deep-dive (orchestration vs choreography, compensation, isolation anomalies, semantic locks, countermeasures) and its trade-off vs 2PC; Percolator (snapshot isolation on top of BigTable, used by TiDB); Calvin & deterministic transactions (order-then-execute, avoiding 2PC); Spanner read-write txns (2PC over Paxos groups + TrueTime); isolation levels in distributed DBs (read committed, snapshot isolation, serializable, the write-skew anomaly, SSI); idempotency & exactly-once effects; the outbox pattern vs dual-write; when to choose saga vs 2PC vs "avoid the distributed txn entirely" (redesign boundaries).' },
  { slug: 'capacity-modeling-and-tail-latency',
    name: 'Capacity Modeling, Queueing and Tail Latency at Scale',
    hints: 'back-of-envelope done rigorously; Littles Law (L = λW) and using it for concurrency/thread-pool/connection-pool sizing and queue depth; utilization vs latency (the knee of the curve, why >70-80% utilization explodes latency — M/M/1 intuition); the Universal Scalability Law (contention + crosstalk/coherency → why throughput peaks and then DROPS, not just plateaus); Amdahl vs USL; TAIL LATENCY: why averages lie, p50 vs p99 vs p999, how fan-out amplifies tail (a request touching 100 services sees the 99.99th percentile), "The Tail at Scale" mitigations (hedged requests, tied requests, request reissue, micro-partitioning, good-enough responses); coordinated omission (why load-test tools under-report latency); head-of-line blocking; connection pool & thread pool sizing math; capacity planning with headroom for failover (N+1, cell capacity); how to estimate cost from capacity; back-pressure vs buffering trade-off.' },
  { slug: 'failure-theory-advanced',
    name: 'Failure Theory: Metastable Failures, Retry Storms and Load Shedding',
    hints: 'failure taxonomy (crash, omission, timing, Byzantine, GRAY/partial failures — the hardest); metastable failures (a system stuck in a bad state sustained by a feedback loop even after the trigger is gone — e.g. retry storms, cache-empty thundering, GC death spiral) and how to break them (load shedding, backoff, capacity headroom); RETRY amplification math (a retry policy of N attempts multiplies load N× at exactly the wrong time; retry budgets, token-bucket retries, retry ONLY at one layer); exponential backoff + JITTER (full/equal/decorrelated jitter — why jitter matters); circuit breakers (states, half-open, per-endpoint) and their trade-offs; timeouts (why every remote call needs one, how to set it from p99, deadline propagation); LOAD SHEDDING & brownout (shed low-priority work, admission control, prioritized queues, LIFO under overload); BACKPRESSURE & flow control (bounded queues, reactive streams, credit-based); cascading failures & bulkheads/isolation; static stability (survive dependency failure by not needing the control plane in the data path); graceful degradation & fallbacks (and why fallbacks are dangerous per AWS); the fallacies of distributed computing.' },
  { slug: 'data-internals-storage-engines',
    name: 'Data Store Internals: Storage Engines, MVCC and Schema Evolution',
    hints: 'LSM-tree internals (memtable, SSTables, WAL, compaction strategies — size-tiered vs leveled, write/read/space AMPLIFICATION trade-offs) vs B-tree/B+tree (in-place update, WAL, read-optimized) — when each wins (write-heavy vs read-heavy); the RUM conjecture (read, update, memory — pick two); bloom filters in LSM to skip SSTables; write-ahead log & group commit; MVCC (multi-version concurrency control) & how snapshot isolation works, vacuum/GC of old versions, the write-skew anomaly & serializable snapshot isolation (SSI); isolation levels precisely (dirty read, non-repeatable read, phantom, lost update, write skew) mapped to levels; SCHEMA EVOLUTION & data encoding (backward vs forward compatibility, Avro vs Protobuf vs Thrift vs JSON, schema registry, rolling upgrades, adding/removing fields safely); secondary indexes (local vs global) & their write cost; CDC & the outbox pattern from the storage-engine view; columnar vs row storage (OLAP vs OLTP, compression, vectorized execution); time-series & append-only stores.' },
  { slug: 'probabilistic-data-structures',
    name: 'Probabilistic Data Structures for Scale',
    hints: 'why approximate structures buy massive memory/latency savings when exactness is not required; BLOOM FILTERS (no false negatives, tunable false-positive rate, the m/n/k math, cannot delete) & uses (LSM SSTable skipping, cache/DB "definitely not present", crawler URL dedup, CDN); counting Bloom & cuckoo filters (support deletion) & quotient filters; HYPERLOGLOG (cardinality estimation — unique visitors/count-distinct in ~1.5 KB with ~2% error, mergeable across shards) vs exact sets; COUNT-MIN SKETCH (frequency/heavy-hitters estimation, overestimates only) for top-k, rate limiting, trending; skip lists (probabilistic balanced structure, used in Redis sorted sets & LevelDB memtable); MinHash & SimHash / LSH for near-duplicate detection at scale; t-digest / DDSketch for streaming quantile (p99) estimation; reservoir sampling for uniform sampling over a stream; the core TRADE-OFF (accuracy vs space vs speed) and how to choose the error budget; when NOT to approximate (billing, correctness-critical).' },
  { slug: 'microservices-ddd-and-boundaries',
    name: 'Microservices Depth: DDD, Service Boundaries and Anti-Patterns',
    hints: 'Domain-Driven Design for boundaries: bounded contexts, ubiquitous language, aggregates & aggregate roots (consistency boundary = transaction boundary), entities vs value objects, domain events, context mapping (partnership, customer-supplier, conformist, anti-corruption layer, published language, shared kernel); how DDD maps to service granularity; CONWAYS LAW & the inverse Conway maneuver, team topologies (stream-aligned, platform, enabling); the DISTRIBUTED MONOLITH anti-pattern (services that must deploy together, chatty sync calls, shared DB) & how to detect/avoid; right-sizing services (too fine = distributed-monolith + latency tax; too coarse = back to monolith) — the trade-off; data ownership (database-per-service, no shared DB) & how to query across services (API composition, CQRS read models, data replication); sync vs async coupling & temporal coupling; CONSUMER-DRIVEN CONTRACT testing (Pact) & schema/API versioning + safe deprecation; idempotency-key design; the strangler-fig migration; saga/outbox for cross-service consistency (tie-in); when a MODULAR MONOLITH beats microservices (small team, unclear boundaries, low scale); the operational tax (observability, tracing/context-propagation, deployment, on-call) as the real cost.' },
]

// ---------- Phase 2: DEEPEN existing core topics ----------
const DEEPEN_TOPICS = [
  { slug: 'fundamentals-and-framework', name: 'System Design Fundamentals and Interview Framework', start: 81,
    hints: 'deeper: rigorous estimation & the numbers that drive design; tail latency & percentiles vs averages; availability math & the cost of extra nines; how non-functional requirements (consistency, latency budget, durability) change the design; how to drive the interview and defend trade-offs at senior level. Cross-link the new interview-method, capacity, and failure topics conceptually.' },
  { slug: 'cap-theorem-and-consistency', name: 'CAP Theorem and Consistency Models', start: 76,
    hints: 'deeper: PACELC precisely; the PRECISE difference between linearizability, sequential, causal, and eventual consistency and how each is tested/violated; quorum intersection math (R+W>N, sloppy quorums, hinted handoff); read-repair & anti-entropy (Merkle trees); CRDT types (G-counter, PN-counter, OR-set, LWW) and their guarantees; why "CP vs AP" is an oversimplification (it is only during a partition); consistency of real systems (Dynamo, Cassandra tunable, Spanner, CockroachDB).' },
  { slug: 'databases-sql-nosql-sharding-replication', name: 'Databases: SQL vs NoSQL, Indexing, Sharding and Replication', start: 77,
    hints: 'deeper: LSM vs B-tree amplification trade-offs & the RUM conjecture; MVCC & isolation-level anomalies (write skew, phantoms, SSI); resharding without downtime (consistent hashing, logical shards, online migration); hot-shard/hot-key detection & mitigation; replication internals (statement vs row-based vs WAL shipping, replication lag consequences, read-your-writes on replicas); multi-leader conflict resolution; secondary index cost (local vs global); when NewSQL (Spanner/CockroachDB/TiDB) is the right call and its trade-offs.' },
  { slug: 'microservices-monolith-api-design', name: 'Microservices, Monolith and API Design', start: 76,
    hints: 'deeper: DDD bounded contexts & aggregates as the boundary tool; the distributed-monolith anti-pattern & how to detect it; right-sizing granularity trade-off; consumer-driven contract testing & safe API versioning/deprecation; idempotency-key design; API composition vs CQRS read models for cross-service queries; the operational tax (tracing/context propagation, deploy, on-call) as the true cost; when a modular monolith wins. Cross-link the new DDD topic.' },
  { slug: 'message-queues-and-async', name: 'Message Queues, Streaming and Asynchronous Processing', start: 77,
    hints: 'deeper: how exactly-once effects are REALLY achieved (idempotent consumers + dedup, transactional outbox, Kafka transactions/idempotent producer); ordering guarantees precisely (per-partition only) & the throughput trade-off; consumer-lag detection & backpressure; poison-message handling & DLQ design; retry amplification & retry budgets in async pipelines (tie-in to failure theory); rebalancing storms; the log-vs-queue distinction at depth; when async messaging HURTS (latency, debugging, ordering complexity).' },
  { slug: 'resilience-tradeoffs-deep-dive', name: 'Resilience, Fault Tolerance and Design Trade-offs Deep-Dive', start: 81,
    hints: 'deeper: metastable failures & how to break the feedback loop; retry amplification math + retry budgets + jitter variants (full/equal/decorrelated); circuit-breaker half-open subtleties; load shedding, admission control & brownout; backpressure/flow control (credit-based, bounded queues); static stability (no control-plane dependency in the data path); gray/partial failure detection; why naive fallbacks are dangerous (AWS Builders Library); deadline propagation; cell-based architecture & blast-radius math. Cross-link the new failure-theory & capacity topics.' },
]

const DEEPEN_RULES = (t) => `
GOAL: make this existing System Design topic DEEPER and HARDER at the senior/staff level, and enrich
the study notes — WITHOUT removing or altering any existing content. Complement the existing questions
with a strong ADVANCED + EXPERT block.

STEP 1 — READ both existing files first:
  ${DIR}/${t.slug}/concepts.md
  ${DIR}/${t.slug}/questions.yaml
Understand what is already covered so you do NOT duplicate existing questions or headings.

STEP 2 — ENRICH concepts.md (edit in place, ADDITIVE only):
  - Where the advanced internals / edge cases / trade-offs / failure modes a senior interviewer probes
    are thin, add depth (a paragraph, comparison table, formula, ASCII diagram, or "gotcha"). You MAY add
    new "## " subsections for advanced areas that are missing. Keep EXISTING headings STABLE (questions
    ref them). New headings must NOT contain '/' or '&' (breaks anchor slugs) — use commas or "and".
  - Focus on the deepening hints below. Factual accuracy is critical; web-research anything uncertain
    (distributed-systems claims are subtle — get guarantees exactly right).
  DEEPENING FOCUS: ${t.hints}

STEP 3 — APPEND new questions to questions.yaml (do NOT rewrite or renumber existing ones):
  - Add 30-40 NEW questions. New ids are "${t.slug}-NNN" starting at ${String(t.start).padStart(3, '0')}
    and incrementing, zero-padded 3-digit, unique, contiguous with the existing ids.
  - Difficulty of NEW questions: ONLY 'advanced' and 'expert' (~55% advanced, 45% expert).
  - Heavy TRADE-OFF / scenario / "what breaks" / judgment style with LONG plausible options; exactly one
    best answer; distractors wrong for a specific reason. Some quant/estimation questions where relevant.
  - 3-5 options, 0-based 'answer', VARY the correct index. Every 'ref' (QUOTED) resolves to a real "## "
    heading (existing or newly added). No "all/none of the above".

Return one line: "${t.slug}: +<k> new questions (now <total>), concepts enriched (<what you added>)".
`

const VERIFY_RULES = (slug, name, isNew) => `
You are a staff engineer verifying advanced System Design interview content for "${name}" (slug: ${slug}).

Read BOTH ${DIR}/${slug}/concepts.md and ${DIR}/${slug}/questions.yaml and FIX IN PLACE:
1) FACTUAL/CONCEPTUAL errors — web-research anything uncertain. Distributed-systems guarantees are
   subtle: verify claims about linearizability, quorums (R+W>N), Raft/Paxos, 2PC blocking, TrueTime,
   LSM vs B-tree amplification, bloom-filter/HLL/CMS math, Little's Law, USL, tail-latency & retry
   amplification, metastable failures, DDD aggregates. A wrong 'answer' index or a guarantee/trade-off
   stated BACKWARDS is the worst defect — fix it. Ensure "correct" answers are defensibly the BEST choice.
2) DEPTH & TRADE-OFF COVERAGE: confirm concepts.md is genuinely senior-level (mechanisms, math, failure
   modes, trade-offs) and that a healthy share of questions are scenario/trade-off/"what breaks"/judgment
   style (not just definitions). If thin, ADD such questions.
3) SCHEMA: valid YAML; top-level topic/domain(system-design)/topic_slug(${slug})/version/questions;
   ids prefixed '${slug}-', unique, contiguous 3-digit${isNew ? ' from 001' : ' (do NOT renumber existing ids; new block continues contiguously)'};
   difficulty in {beginner,intermediate,advanced,expert}${isNew ? ' with all four represented (skewed hard)' : ' (new ones advanced/expert)'};
   3-5 options; 0-based in-range 'answer'; correct index VARIED (not clustered); every 'ref' anchor is a
   QUOTED string that resolves to a real '## ' heading (no '/' or '&' in headings — rename with comma/"and"
   + fix refs).
4) COVERAGE: ${isNew ? '55-75 questions, every subtopic represented' : 'the appended block adds real depth; every new subtopic referenced'}.
   Dedupe semantic repeats by rewriting.

Return one line: "${slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".
`

// ===== Phase 1: author + verify NEW topics (pipelined) =====
phase('AuthorNew')
const newResults = await pipeline(
  NEW_TOPICS,
  (t) => agent(
    `You are a principal engineer and system-design interview coach authoring DEEP, ADVANCED/EXPERT-level ` +
    `study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library ` +
    `(domain slug: "system-design", folder under topics/system-design/).\n\n` +
    `${RESEARCH}\n\n` +
    `FOCUS / subtopics to cover:\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Go DEEP and senior-level, prioritize TRADE-OFFS, ` +
    `mechanisms and math, aim high on MCQ count (55-75).`,
    { label: `author:${t.slug}`, phase: 'AuthorNew', effort: 'high' }
  ),
  (_summary, t) => agent(VERIFY_RULES(t.slug, t.name, true),
    { label: `verify:${t.slug}`, phase: 'VerifyNew', effort: 'high' })
)

// ===== Phase 2: deepen + verify EXISTING topics (pipelined) =====
phase('Deepen')
const deepenResults = await pipeline(
  DEEPEN_TOPICS,
  (t) => agent(DEEPEN_RULES(t),
    { label: `deepen:${t.slug}`, phase: 'Deepen', effort: 'high' }),
  (_summary, t) => agent(VERIFY_RULES(t.slug, t.name, false),
    { label: `verify:${t.slug}`, phase: 'VerifyDeepen', effort: 'high' })
)

return {
  newTopics: newResults.filter(Boolean),
  deepened: deepenResults.filter(Boolean),
}
