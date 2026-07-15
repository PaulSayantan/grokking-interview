export const meta = {
  name: 'system-design-authoring',
  description: 'Author deep, trade-off-focused concepts.md + a large all-tier MCQ questions.yaml for all 23 System Design topics (incl. modern GenAI/event-driven/streaming), then verify',
  phases: [
    { title: 'Author', detail: 'one agent per topic researches + writes concepts.md + questions.yaml' },
    { title: 'Verify', detail: 'fact-check + schema-check + trade-off coverage, fix in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`

const RESEARCH = `
RESEARCH FIRST (this is a research-heavy domain): use web search to gather current, accurate,
real-world material. Good sources to consult include the ByteByteGo / "System Design Interview"
books & blog (Alex Xu), the DDIA book (Kleppmann) concepts, engineering blogs (Netflix, Uber,
Discord, Meta, Stripe, Cloudflare, AWS/Google architecture centers), the system-design-primer
GitHub repo, high-quality YouTube channels (ByteByteGo, Gaurav Sen, Hussein Nasser, System Design
Interview, Jordan has no life), and 2024-2025 interview write-ups. Capture LATEST/MODERN patterns
actually asked in interviews now (e.g. event-driven, CQRS, CDC, cell-based architecture, GenAI/RAG,
vector DBs, edge compute, streaming). Prefer current best practices over dated ones.
`

const SCHEMA = `
CONTENT CONTRACT (authoritative — follow exactly):

Write TWO files into ${DIR}/<topic-slug>/ :

1) concepts.md — deep study content:
   - Begins with a single "# <Topic Name>" H1.
   - One "## <Subtopic>" H2 per subtopic (these are the MCQ anchor targets — keep them stable).
   - IMPORTANT: heading text must NOT contain '/' or '&' (they break anchor slugs). Use commas / "and".
   - LAYERED depth: intuition → how it works → real-world usage → **TRADE-OFFS**. Trade-offs are
     the single most important thing in a system-design interview — for EVERY design choice, explicitly
     state what you gain, what you give up, and WHEN to pick it vs the alternative. Include a dedicated
     "## Trade-offs and when to use what" style section, and weave trade-off reasoning throughout.
   - Include: capacity/back-of-envelope estimation where relevant; ASCII architecture diagrams;
     comparison tables (option A vs B vs C with columns for consistency/latency/cost/complexity);
     concrete numbers (latency ballparks, QPS, storage) and real systems that use each approach;
     failure modes and how the design degrades.
   - Cover MODERN concepts relevant to the topic (see the topic's focus hints).
   - End with "## Common interview follow-up questions" and "## References" (list the actual sources
     and any YouTube videos you used).

2) questions.yaml — the MCQ bank. Top-level keys:
     topic: "<Topic Name>"
     domain: system-design
     topic_slug: <topic-slug>
     version: 1
     questions:
       - id: <topic-slug>-001    # unique, zero-padded 3-digit seq from 001, prefix = topic-slug
         difficulty: intermediate  # beginner | intermediate | advanced | expert
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
           <why correct; and WHY the distractors are wrong / what trade-off they miss>
         ref: "concepts.md#<anchor>"   # resolves to a real "## " heading (GitHub slug rules)

   RULES:
   - Produce 60-80 questions. Cover EVERY subtopic with several questions each.
   - ALL FOUR difficulties present: roughly 20% beginner, 30% intermediate, 30% advanced, 20% expert.
   - MANY questions must be TRADE-OFF / scenario / judgment questions: "Given <constraints: scale,
     latency budget, consistency need, budget>, which design is most appropriate and why?", "What is the
     PRIMARY trade-off of choosing X over Y?", "Which failure does this design NOT tolerate?". Use LONG,
     plausible, descriptive options (each a defensible-sounding design) so the learner must reason about
     trade-offs, not pattern-match keywords. There is exactly ONE best answer; distractors are wrong for a
     specific reason (wrong trade-off, violates a constraint, wrong scale, etc.).
   - Also include some estimation/quant questions where relevant (QPS, storage, bandwidth).
   - 3-5 options, exactly one correct, 'answer' 0-based, VARY the correct index across the file.
   - No "all/none of the above". Every 'ref' anchor resolves to a real "## " heading. id prefix = slug.

Use the Write tool to create both files. Return one line:
"<slug>: concepts.md (<n> subtopics) + questions.yaml (<m> questions, all tiers)".
`

const TOPICS = [
  { slug: 'fundamentals-and-framework', name: 'System Design Fundamentals & Interview Framework',
    hints: 'requirements (functional vs non-functional); back-of-envelope estimation (QPS, storage, bandwidth, memory); latency numbers every engineer should know; the RESHADED / structured interview approach; SLA/SLO/SLI & error budgets; availability nines & downtime math; latency vs throughput; vertical vs horizontal scaling; stateless vs stateful; single points of failure; read-heavy vs write-heavy; how to drive the interview and defend trade-offs.' },
  { slug: 'scalability-and-load-balancing', name: 'Scalability & Load Balancing',
    hints: 'horizontal vs vertical scaling; L4 vs L7 load balancers; LB algorithms (round robin, least connections, weighted, IP/consistent hash); health checks & failover; sticky sessions & session affinity trade-offs; reverse vs forward proxy; auto-scaling policies; GSLB / geo & DNS LB; multi-AZ / multi-region; N+1 redundancy; cell-based architecture (modern); scaling the data tier vs app tier.' },
  { slug: 'caching-and-cdn', name: 'Caching & CDN',
    hints: 'cache layers (client, CDN, app, DB); patterns cache-aside vs read-through vs write-through vs write-back vs write-around and their trade-offs; eviction (LRU/LFU/FIFO/TTL); invalidation strategies; cache stampede/thundering herd & mitigations (locking, request coalescing, jitter, early recompute); hot keys & sharding; Redis vs Memcached; CDN edge/origin, push vs pull, cache-busting; distributed cache consistency; what NOT to cache.' },
  { slug: 'databases-sql-nosql-sharding-replication', name: 'Databases: SQL vs NoSQL, Indexing, Sharding & Replication',
    hints: 'relational vs NoSQL (document/KV/wide-column/graph) and when each; ACID vs BASE; normalization vs denormalization; indexing & query optimization; storage engines LSM-tree vs B-tree (write vs read amplification), bloom filters; partitioning/sharding strategies (range/hash/directory/geo), shard key choice, hotspots & resharding; replication (leader-follower, multi-leader, leaderless), sync vs async, replication lag; read replicas; distributed txns & 2PC; CDC; polyglot persistence trade-offs; NewSQL (Spanner, CockroachDB).' },
  { slug: 'cap-theorem-and-consistency', name: 'CAP Theorem & Consistency Models',
    hints: 'CAP (CP vs AP, and the real meaning during partitions); PACELC; strong vs eventual consistency spectrum; read-your-writes, monotonic reads, causal, linearizability vs serializability; quorums (N/R/W, R+W>N); conflict resolution (LWW, vector clocks, CRDTs); consensus (Paxos, Raft) intuition; tunable consistency (Cassandra/Dynamo); which consistency for banking vs feed vs cache — trade-offs.' },
  { slug: 'message-queues-and-async', name: 'Message Queues, Streaming & Asynchronous Processing',
    hints: 'queue vs pub/sub vs log-based streaming; Kafka vs RabbitMQ vs SQS/SNS vs Pulsar trade-offs; delivery semantics (at-most/at-least/exactly-once) & how exactly-once is really achieved; idempotency & dedup; ordering & partitioning; consumer groups, offsets, backpressure & consumer lag; DLQ & retries; fan-out patterns; batch vs stream; when async messaging helps vs hurts; outbox pattern.' },
  { slug: 'microservices-monolith-api-design', name: 'Microservices, Monolith & API Design',
    hints: 'monolith vs microservices vs modular monolith — trade-offs (team scale, deploy independence, operational complexity, distributed-system tax); service boundaries & DDD; API styles REST vs GraphQL vs gRPC and when each; API gateway & BFF; versioning; pagination/filtering; idempotency keys; service mesh (sidecar) trade-offs; sync vs async inter-service comms; the fallacies of distributed computing; when NOT to do microservices.' },
  { slug: 'rate-limiting-and-consistent-hashing', name: 'Rate Limiting & Consistent Hashing',
    hints: 'rate-limit algorithms (token bucket, leaky bucket, fixed window, sliding window log, sliding window counter) & trade-offs; distributed rate limiting (Redis, sync vs local+sync, accuracy vs latency); where to enforce (gateway vs service); consistent hashing (ring, virtual nodes, why it beats mod-N on resize), bounded-load; rendezvous hashing; use in caches/shard routing/LB; hot-spot handling.' },
  { slug: 'networking-and-protocols', name: 'Networking & Communication Protocols',
    hints: 'HTTP/1.1 vs HTTP/2 vs HTTP/3(QUIC); TCP vs UDP; TLS handshake & mTLS; WebSockets vs SSE vs long polling vs webhooks (real-time trade-offs); gRPC/protobuf; DNS resolution; REST semantics & status codes; idempotency; connection pooling & keep-alive; load balancer L4/L7 tie-in; CDN/edge; latency budgets; API timeouts, retries with backoff+jitter, circuit breaking at the network layer.' },
  { slug: 'observability-monitoring-reliability', name: 'Observability, Monitoring & Site Reliability',
    hints: 'the three pillars (metrics, logs, traces) & when each; RED vs USE methods; Prometheus/Grafana, distributed tracing (OpenTelemetry, Zipkin/Jaeger), structured logging & correlation IDs; SLI/SLO/SLA & error budgets; alerting (symptom vs cause, alert fatigue); health checks & probes; on-call/incident mgmt, blameless postmortems; chaos engineering; capacity planning; cardinality/cost trade-offs of observability.' },
  { slug: 'security-authentication-data-protection', name: 'Security, Authentication & Data Protection',
    hints: 'authN vs authZ; sessions vs tokens (JWT) trade-offs, refresh/rotation, revocation; OAuth2 & OIDC flows (auth code + PKCE, client credentials); RBAC vs ABAC; API keys, mTLS; encryption in transit vs at rest, key management (KMS), envelope encryption; hashing passwords (bcrypt/argon2); secrets management; rate limiting & WAF; OWASP top risks; PII/GDPR, tokenization, data residency; zero-trust; defense in depth trade-offs.' },
  { slug: 'design-search-autocomplete-typeahead', name: 'Design Search, Autocomplete & Typeahead Systems',
    hints: 'inverted index & search engines (Elasticsearch/OpenSearch); ranking & relevance; autocomplete via trie / prefix + weighting, top-k, and the data structures; typeahead at scale (caching, sharding by prefix, personalization); indexing pipeline & near-real-time updates; spell correction; scale/latency trade-offs; precompute vs on-the-fly; vector/semantic search as a modern alternative.' },
  { slug: 'design-web-crawler-data-processing', name: 'Design a Web Crawler & Large-Scale Data Processing',
    hints: 'crawler design (frontier/URL queue, politeness, dedup via bloom filter, robots.txt, freshness/recrawl, trap avoidance, distributed workers); large-scale batch processing (MapReduce/Spark), lambda vs kappa architecture, data lake/warehouse, ETL vs ELT; dedup & idempotency at scale; back-pressure & checkpointing; trade-offs of batch vs stream for the same problem.' },
  { slug: 'design-coordination-locking-collaboration', name: 'Distributed Coordination, Locking & Collaborative Editing',
    hints: 'distributed locks (Redlock & its criticisms, ZooKeeper/etcd, fencing tokens), leader election; ZooKeeper/etcd/Consul roles; distributed mutual exclusion trade-offs (safety vs liveness); collaborative editing (OT vs CRDT — deep trade-offs), presence; idempotent fencing; consensus dependence; when a lock is the wrong tool.' },
  { slug: 'design-job-scheduler-task-queue', name: 'Design a Distributed Job Scheduler, Task Queue & Cron',
    hints: 'task queue design (at-least-once, visibility timeout, retries, DLQ, priority); distributed cron / scheduled jobs (leader election, dedup so a job runs once across nodes, missed-run handling); delayed jobs; exactly-once execution challenges; idempotency; back-pressure; comparisons (Celery, Sidekiq, Quartz, Temporal/workflow engines); scale & failure trade-offs.' },
  { slug: 'design-url-shortener', name: 'Design a URL Shortener / Pastebin / Key-Value Store',
    hints: 'requirements & scale estimation; key generation (hashing+collision handling, counter+base62, distributed ID gen like Snowflake, KGS pre-gen); read-heavy caching; DB choice & schema; custom aliases, expiry, analytics; redirect 301 vs 302 trade-off; the classic building blocks that generalize; consistency vs availability choices.' },
  { slug: 'design-feed-chat-notification', name: 'Design Social Feed / Twitter / Chat / Notification System',
    hints: 'news feed: fanout-on-write vs fanout-on-read vs hybrid (celebrity problem) — deep trade-offs; timeline storage & ranking; chat/messaging (WebSocket, delivery/read receipts, online presence, ordering, group chat, message store); notification system (push/SMS/email, fanout, dedup, rate limiting, prioritization); real-time delivery; scale numbers.' },
  { slug: 'design-video-platform-distributed-cache', name: 'Design Video/Media Platform (YouTube, Netflix) & Distributed Cache',
    hints: 'video upload & transcoding pipeline (chunking, multiple bitrates), storage (blob/object store), CDN delivery & adaptive bitrate streaming (HLS/DASH), metadata service, recommendations at a high level; live streaming vs VOD; distributed cache design (partitioning, replication, consistency, eviction, hot keys) — build-a-cache question; cost/latency trade-offs of edge caching.' },
  { slug: 'design-location-and-payment-systems', name: 'Design Location & Transactional Systems (Uber, Payments, Ticketmaster)',
    hints: 'geospatial indexing (geohash, quadtree, S2, H3) for proximity/ride-matching; real-time location updates; payment systems (idempotency keys, exactly-once charge, ledger/double-entry, reconciliation, saga for distributed txn, PCI), consistency requirements; ticket booking / inventory (concurrency, overselling prevention, reservations/holds, optimistic vs pessimistic locking) — strong-consistency trade-offs vs availability.' },
  { slug: 'event-driven-cqrs-saga-cdc', name: 'Event-Driven Architecture: CQRS, Event Sourcing, Saga & CDC',
    hints: 'event-driven vs request-response trade-offs; CQRS (separate read/write models, when it helps vs over-engineering); event sourcing (event log as source of truth, replay, snapshots, versioning, trade-offs & pitfalls); saga pattern (choreography vs orchestration) for distributed transactions & compensation; outbox pattern & the dual-write problem; CDC (Debezium) to bridge DB & event stream; eventual consistency implications; idempotent consumers; when NOT to use these (complexity cost).' },
  { slug: 'genai-llm-system-design', name: 'GenAI & LLM System Design: RAG, Vector DBs & Inference at Scale',
    hints: 'MODERN, frequently-asked now. RAG architecture (chunking, embeddings, vector DB retrieval, re-ranking, prompt assembly, grounding/citations); vector databases (Pinecone/Weaviate/pgvector/Milvus) & ANN indexes (HNSW, IVF) trade-offs; embedding models & dimensionality; serving LLM inference at scale (GPU batching, KV cache, token streaming, latency vs throughput, cost); caching (semantic/prompt cache); guardrails, hallucination mitigation, evaluation; fine-tuning vs RAG vs prompt-engineering trade-offs; agents & tool-use; data/feedback loops; cost & latency are the dominant trade-offs.' },
  { slug: 'realtime-streaming-systems', name: 'Real-Time & Streaming Systems: Analytics, Leaderboards & Live Data',
    hints: 'stream processing (Kafka Streams, Flink, Spark Streaming) & windowing (tumbling/sliding/session), watermarks, event-time vs processing-time; exactly-once in streaming; real-time analytics & OLAP (Druid, Pinot, ClickHouse) vs batch; leaderboards (Redis sorted sets, sharding, approximation); real-time dashboards; lambda vs kappa architecture; hot path vs cold path; latency vs completeness vs cost trade-offs; live comment/reaction systems.' },
  { slug: 'resilience-tradeoffs-deep-dive', name: 'Resilience, Fault Tolerance & Design Trade-offs Deep-Dive',
    hints: 'THE trade-offs topic. Resilience patterns: timeouts, retries (with backoff+jitter, retry storms), circuit breaker, bulkhead, rate limiting/load shedding, graceful degradation, fallback; idempotency for safe retries; redundancy & failover (active-active vs active-passive), multi-region trade-offs; blast radius & cell-based architecture; chaos engineering; the fallacies of distributed computing; consistency vs availability vs latency vs cost as a unifying trade-off framework; how to reason about and articulate trade-offs in an interview (this topic ties everything together).' },
]

phase('Author')
const results = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a principal engineer and system-design interview coach authoring deep, trade-off-focused ` +
    `study material for the topic "${t.name}" (slug: ${t.slug}) in a learner's interview-prep library.\n\n` +
    `${RESEARCH}\n\n` +
    `FOCUS / subtopics to cover (include modern patterns):\n${t.hints}\n\n` +
    `${SCHEMA}\n\n` +
    `Write the two files now into ${DIR}/${t.slug}/ . Go deep, prioritize TRADE-OFFS, aim high on MCQ count (60-80).`,
    { label: `author:${t.slug}`, phase: 'Author', effort: 'high' }
  ),
  (authorSummary, t) => agent(
    `You are a staff engineer verifying system-design interview content for "${t.name}" (slug: ${t.slug}).\n\n` +
    `Read BOTH ${DIR}/${t.slug}/concepts.md and ${DIR}/${t.slug}/questions.yaml and FIX IN PLACE:\n` +
    `1) FACTUAL/CONCEPTUAL errors in concepts or MCQ answers/explanations — web-research anything uncertain. ` +
    `System design has few absolutes, so ensure "correct" answers are defensibly the BEST choice for the ` +
    `stated constraints and that explanations name the real trade-off. A wrong 'answer' index or a ` +
    `trade-off stated backwards is the worst defect — fix it. Ensure modern concepts are accurate & current.\n` +
    `2) TRADE-OFF COVERAGE: confirm concepts.md has explicit trade-off treatment and that a healthy share of ` +
    `questions are scenario/trade-off/judgment style (not just definitions). If thin, ADD such questions.\n` +
    `3) SCHEMA: valid YAML; top-level topic/domain(system-design)/topic_slug(${t.slug})/version/questions; ` +
    `ids prefixed '${t.slug}-', unique, contiguous 3-digit from 001; difficulty in {beginner,intermediate,advanced,expert} ` +
    `with all four represented; 3-5 options; 0-based in-range 'answer'; correct index VARIED; every 'ref' ` +
    `anchor resolves to a real '## ' heading (no '/' or '&' in headings — rename with comma/"and" + fix refs).\n` +
    `4) COVERAGE: 60-80 questions, every subtopic represented. If thin, ADD questions. Dedupe semantic repeats by rewriting.\n\n` +
    `Return one line: "${t.slug}: <total> questions (<nBeg>/<nInt>/<nAdv>/<nExp>), <fixed|clean>, notes: ...".`,
    { label: `verify:${t.slug}`, phase: 'Verify', effort: 'high' }
  )
)

return results.filter(Boolean)
