# TOPICS — Master interview taxonomy

The complete map of what this library documents: every domain → topics →
subtopics, with representative interview questions. Generated from research;
refine by editing this file (and keep slugs stable — they name folders).

Frequency = how often the topic shows up in interviews (very-high → low).

## Domains

- [System Design](#system-design) — 19 topics
- [Docker](#docker) — 15 topics
- [Kubernetes](#kubernetes) — 16 topics
- [DevOps & CI/CD](#devops-cicd) — 18 topics
- [Spring Boot](#spring-boot) — 18 topics
- [Spring Framework Core](#spring-core) — 19 topics
- [Hibernate & JPA](#hibernate-jpa) — 15 topics
- [Apache Tomcat](#apache-tomcat) — 16 topics
- [Java & JVM (framework-relevant)](#java-jvm) — 16 topics
- [Messaging & Databases](#messaging-databases) — 12 topics

<a id="system-design"></a>
## System Design

Folder: `topics/system-design/` · 19 topics

### System Design Fundamentals & Interview Framework

`system-design/fundamentals-and-framework` — freq: very-high · difficulty: beginner

Core building blocks and the structured approach for driving a system design interview from requirements to a scalable architecture.

**Subtopics:**

- Functional vs non-functional requirements gathering
- Back-of-the-envelope / capacity estimation (QPS, storage, bandwidth, memory)
- Latency numbers every engineer should know
- High-level architecture diagramming and component identification
- Vertical vs horizontal scaling
- Availability, reliability, durability, and the nines of uptime
- SLA vs SLO vs SLI definitions and error budgets
- Latency vs throughput tradeoffs
- Stateless vs stateful services
- Single points of failure and redundancy
- Fault tolerance, graceful degradation, and failure domains
- Read-heavy vs write-heavy system design
- Bottleneck identification and iterative scaling

**Sample interview questions:**

- Walk me through your general approach to a system design interview from requirements to final design.
- How would you estimate the number of servers needed to handle 1 million requests per second?
- What is the difference between latency and throughput, and how do you optimize for each?
- Explain the difference between horizontal and vertical scaling and when you'd choose each.
- How do you calculate storage requirements for a system storing 500 million photos per day?
- What does 99.99% availability mean in terms of allowed downtime per year?
- How do you identify and eliminate a single point of failure in a distributed system?
- Why do we prefer stateless services behind a load balancer?
- What is the difference between an SLA, an SLO, and an SLI?

### Scalability & Load Balancing

`system-design/scalability-and-load-balancing` — freq: very-high · difficulty: beginner

Techniques for distributing traffic and scaling systems horizontally to handle growth while maintaining availability.

**Subtopics:**

- Load balancer types (L4 vs L7)
- Load balancing algorithms (round robin, least connections, weighted, IP hash)
- Reverse proxies and forward proxies
- Health checks and failover
- Sticky sessions and session affinity
- Auto-scaling and scaling policies
- Application tier vs data tier scaling
- DNS-based and geo load balancing (GSLB)
- N+1 redundancy and multi-AZ / multi-region deployment
- Read replicas for scaling reads

**Sample interview questions:**

- How does a load balancer decide which server to route a request to?
- What is the difference between an L4 and L7 load balancer?
- How would you scale a web application from 1,000 to 10 million users?
- What are sticky sessions and what problems do they introduce?
- How do health checks work and what happens when a server fails a health check?
- How would you distribute traffic across multiple data centers in different regions?
- Compare round-robin, least-connections, and consistent-hashing load balancing.
- How does auto-scaling decide when to add or remove instances?

### Caching & CDN

`system-design/caching-and-cdn` — freq: very-high · difficulty: intermediate

Strategies for storing frequently accessed data close to consumers to reduce latency and backend load.

**Subtopics:**

- Cache layers (client, CDN, application, database)
- Cache-aside, read-through, write-through, write-back, write-around
- Eviction policies (LRU, LFU, FIFO, TTL)
- Cache invalidation strategies
- Cache stampede / thundering herd and mitigation
- Hot keys and cache sharding
- Redis vs Memcached tradeoffs
- CDN architecture, edge servers, and origin fetch
- Push vs pull CDN
- Content invalidation and cache busting
- Distributed cache consistency

**Sample interview questions:**

- Explain the different caching strategies and when you'd use write-through vs write-back.
- What is cache invalidation and why is it considered one of the hard problems in CS?
- How does a CDN work and how does it decide which edge server serves a user?
- Compare Redis and Memcached — when would you pick one over the other?
- How do you handle a cache stampede when a popular key expires?
- What eviction policy would you choose for a session cache versus a content cache?
- How would you keep a distributed cache consistent across multiple nodes?
- Where would you place caches in a read-heavy news feed system?

### Databases: SQL vs NoSQL, Indexing, Sharding & Replication

`system-design/databases-sql-nosql-sharding-replication` — freq: very-high · difficulty: intermediate

Choosing and scaling data stores, including partitioning, replication, indexing, storage-engine internals, and transaction guarantees.

**Subtopics:**

- Relational vs NoSQL (document, key-value, wide-column, graph)
- ACID vs BASE
- Normalization vs denormalization
- Indexing and query optimization
- Storage engine internals (LSM tree vs B-tree, write vs read amplification)
- Bloom filters and other read-optimization structures
- Vertical vs horizontal partitioning (sharding)
- Sharding strategies (range, hash, directory, geo)
- Resharding and hotspot handling
- Primary-replica and multi-primary replication
- Synchronous vs asynchronous replication
- Read replicas and write scaling
- Federation and functional partitioning
- Distributed transactions and two-phase commit
- Change data capture (CDC) and time-series / columnar stores

**Sample interview questions:**

- When would you choose a NoSQL database over a relational database?
- How does database sharding work and how do you pick a shard key?
- What problems does sharding introduce and how do you handle cross-shard queries?
- Explain the difference between ACID and BASE consistency models.
- How does primary-replica replication work and what is replication lag?
- How would you design the database schema and partitioning for Instagram?
- What happens when one shard becomes a hotspot, and how do you rebalance?
- How do indexes speed up reads and what is their cost on writes?
- Compare LSM-tree and B-tree storage engines and when each is preferable.

### CAP Theorem & Consistency Models

`system-design/cap-theorem-and-consistency` — freq: high · difficulty: advanced

The theoretical tradeoffs between consistency, availability, and partition tolerance and the spectrum of consistency guarantees.

**Subtopics:**

- CAP theorem (CP vs AP systems)
- PACELC theorem
- Strong vs eventual consistency
- Read-your-writes, monotonic reads, causal consistency
- Quorum reads/writes (N, R, W)
- Conflict resolution (last-write-wins, vector clocks, CRDTs)
- Consensus algorithms (Paxos, Raft)
- Linearizability vs serializability
- Tunable consistency in modern databases

**Sample interview questions:**

- Explain the CAP theorem and give an example of a CP and an AP system.
- What is eventual consistency and where is it acceptable to use?
- How do quorum reads and writes (R + W > N) provide consistency guarantees?
- What is the difference between the CAP and PACELC theorems?
- How do you resolve write conflicts in an eventually consistent system?
- What consistency model would you choose for a banking system versus a social feed?
- How does the Raft consensus algorithm elect a leader and replicate a log?
- What is the difference between linearizability and serializability?

### Message Queues, Streaming & Asynchronous Processing

`system-design/message-queues-and-async` — freq: high · difficulty: intermediate

Decoupling services with queues and event streams for asynchronous, resilient, and scalable processing.

**Subtopics:**

- Message queues vs pub/sub vs event streaming
- Kafka vs RabbitMQ vs SQS tradeoffs
- Delivery guarantees (at-most-once, at-least-once, exactly-once)
- Idempotency and deduplication
- Ordering guarantees and partitioning
- Backpressure and consumer lag
- Dead letter queues and retries
- Event-driven architecture and CQRS
- Fan-out patterns
- Batch vs stream processing

**Sample interview questions:**

- When would you introduce a message queue into a system architecture?
- Compare Kafka and RabbitMQ and explain when to use each.
- How do you achieve exactly-once processing semantics?
- How do you guarantee message ordering in a distributed queue?
- What is a dead letter queue and how do you handle poison messages?
- How would you use async processing to handle image/video uploads?
- How do you make a consumer idempotent when messages can be redelivered?
- How do you handle a slow consumer and growing consumer lag?

### Microservices, Monolith & API Design

`system-design/microservices-monolith-api-design` — freq: high · difficulty: intermediate

Service decomposition tradeoffs and designing robust, evolvable APIs and inter-service communication.

**Subtopics:**

- Monolith vs microservices vs modular monolith tradeoffs
- Service decomposition and bounded contexts
- REST vs GraphQL vs gRPC
- API gateway and BFF pattern
- Service discovery
- Inter-service communication (sync vs async)
- API versioning and backward compatibility
- Idempotency keys and pagination
- Circuit breakers, retries, timeouts, bulkheads
- Saga pattern for distributed transactions
- Authentication/authorization (OAuth, JWT, API keys)

**Sample interview questions:**

- What are the tradeoffs between a monolith and microservices?
- How would you decompose a monolithic e-commerce app into microservices?
- Compare REST, GraphQL, and gRPC and when you'd use each.
- What is an API gateway and what responsibilities does it own?
- How do you handle a distributed transaction across multiple microservices?
- How do circuit breakers prevent cascading failures?
- How would you version a public REST API without breaking clients?
- How do services discover and communicate with each other at scale?

### Rate Limiting & Consistent Hashing

`system-design/rate-limiting-and-consistent-hashing` — freq: high · difficulty: intermediate

Algorithms for throttling traffic and distributing data/load evenly across a dynamic set of nodes.

**Subtopics:**

- Rate limiting algorithms (token bucket, leaky bucket, fixed window, sliding window log/counter)
- Distributed rate limiting with Redis
- Client-side vs server-side vs gateway rate limiting
- Handling rate limit headers and 429 responses
- Consistent hashing ring and virtual nodes
- Rebalancing on node add/remove
- Hash function choice and key distribution
- Applications: sharding, caching, load balancing
- Hotspot mitigation with virtual nodes

**Sample interview questions:**

- Design a rate limiter that allows 100 requests per user per minute.
- Compare token bucket and sliding window rate limiting algorithms.
- How do you implement rate limiting in a distributed multi-server environment?
- What is consistent hashing and what problem does it solve?
- How do virtual nodes improve consistent hashing?
- What happens to the keys when you add or remove a node in a consistent hash ring?
- Where would you place the rate limiter in your architecture and why?
- How would you rate limit at the API gateway without a shared bottleneck?

### Networking & Communication Protocols

`system-design/networking-and-protocols` — freq: high · difficulty: intermediate

The protocol and networking foundations underpinning distributed systems, from DNS and TCP to real-time bidirectional communication.

**Subtopics:**

- DNS resolution, TTLs, and DNS-based routing
- TCP vs UDP and connection lifecycle
- HTTP/1.1 vs HTTP/2 vs HTTP/3 (QUIC)
- TLS/SSL handshake, certificates, and mTLS
- WebSockets vs long polling vs Server-Sent Events
- Keep-alive, connection pooling, and multiplexing
- Proxies, NAT, firewalls, and load balancer placement
- Content negotiation, compression, and chunked transfer
- gRPC and protocol buffers over HTTP/2
- VPC, public vs private networking, and network partitions

**Sample interview questions:**

- Walk me through what happens from typing a URL to the page loading.
- When would you use UDP instead of TCP in a system design?
- What are the differences between HTTP/1.1, HTTP/2, and HTTP/3?
- Compare WebSockets, long polling, and Server-Sent Events for real-time updates.
- Explain the TLS handshake and how HTTPS establishes a secure connection.
- How does DNS work and how can it be used for load balancing and failover?
- Why does gRPC use HTTP/2 and what advantages does that give it?
- How does connection pooling improve performance between services?

### Observability, Monitoring & Site Reliability

`system-design/observability-monitoring-reliability` — freq: high · difficulty: intermediate

Making distributed systems observable and reliable through metrics, logging, tracing, alerting, safe deployments, and disaster recovery.

**Subtopics:**

- Three pillars of observability: metrics, logs, traces
- SLA vs SLO vs SLI and error budgets
- Distributed tracing (correlation IDs, OpenTelemetry, spans)
- Alerting, on-call, and reducing alert fatigue
- Health checks, heartbeats, and dependency checks
- Time-series databases and dashboards
- Anomaly detection and log aggregation
- Chaos engineering and fault injection
- Graceful degradation and load shedding
- Disaster recovery, RPO/RTO, and backup strategies
- Deployment strategies (blue-green, canary, rolling, feature flags)

**Sample interview questions:**

- How would you monitor the health of a large distributed system?
- Explain the difference between metrics, logs, and traces and when to use each.
- Design a metrics and monitoring system like Prometheus or Datadog.
- How does distributed tracing help you debug a slow request across services?
- What is an error budget and how does it drive release decisions?
- Compare blue-green, canary, and rolling deployments.
- How do you design a system to fail gracefully under overload?
- What are RPO and RTO and how do they shape your disaster recovery plan?

### Security, Authentication & Data Protection

`system-design/security-authentication-data-protection` — freq: high · difficulty: intermediate

Securing systems end to end: identity, encryption, abuse prevention, secrets, and regulatory data-protection concerns.

**Subtopics:**

- Authentication vs authorization
- OAuth 2.0, OpenID Connect, JWT, and session management
- Encryption in transit and at rest, and key management
- TLS termination and certificate rotation
- API keys, HMAC request signing, and mTLS
- DDoS mitigation, WAF, and bot protection
- Rate limiting and throttling for abuse prevention
- Secrets management and credential rotation
- PII handling, GDPR, and data residency
- Common vulnerabilities (SQL injection, XSS, CSRF) and defenses
- Zero-trust architecture and principle of least privilege

**Sample interview questions:**

- How would you design authentication and authorization for a large web platform?
- Explain how OAuth 2.0 and JWT work and their tradeoffs versus sessions.
- How do you encrypt sensitive data at rest and in transit, and manage the keys?
- How would you protect a public API from DDoS attacks and abuse?
- How do you store and rotate secrets and database credentials securely?
- What design considerations arise from GDPR and data residency requirements?
- How do you prevent one compromised service from accessing everything (zero trust)?
- How would you design a secure password storage and reset flow?

### Design Search, Autocomplete & Typeahead Systems

`system-design/design-search-autocomplete-typeahead` — freq: high · difficulty: advanced

Building low-latency search and prefix-suggestion systems using inverted indexes, tries, and relevance ranking at scale.

**Subtopics:**

- Inverted index construction and tokenization
- Trie / prefix tree for autocomplete
- Ranking and relevance scoring (TF-IDF, BM25)
- Elasticsearch / distributed search cluster architecture
- Query understanding, normalization, and spell correction
- Top-k and most-frequent-query computation
- Sharding and replication of search indexes
- Near-real-time indexing pipeline
- Caching popular queries and results
- Personalization and geo-aware suggestions

**Sample interview questions:**

- Design a search autocomplete / typeahead system like Google's search box.
- How would you build the top-k most frequent queries for suggestions?
- Explain how an inverted index powers full-text search.
- How do you keep a search index fresh with near-real-time updates?
- How would you shard and replicate a large search index?
- Design a full-text search system for a product catalog.
- How do you rank and score results for relevance?
- How do you serve autocomplete suggestions in under 100ms globally?

### Design a Web Crawler & Large-Scale Data Processing

`system-design/design-web-crawler-data-processing` — freq: medium · difficulty: advanced

Distributed crawling of the web and processing massive datasets with batch and streaming pipelines.

**Subtopics:**

- Crawler architecture (URL frontier, fetcher, parser, storage)
- Politeness, robots.txt, and per-domain rate limiting
- Duplicate URL and content detection (Bloom filters, hashing, MinHash)
- BFS vs DFS crawl strategy and URL prioritization
- Distributed crawling and coordination
- Batch processing with MapReduce / Spark
- Stream vs batch and Lambda / Kappa architectures
- Data lake vs data warehouse and ETL pipelines
- Handling dead links, traps, and freshness
- Deduplication and idempotent ingestion

**Sample interview questions:**

- Design a web crawler that can crawl the entire web.
- How do you avoid crawling the same URL twice at massive scale?
- How do you respect robots.txt and stay polite to each domain?
- How would you prioritize which URLs to crawl next?
- Compare Lambda and Kappa architectures for data processing.
- How would you design a MapReduce job to compute word frequency over billions of documents?
- How do you detect near-duplicate content across crawled pages?
- How do you keep crawled data fresh while bounding recrawl cost?

### Distributed Coordination, Locking & Collaborative Editing

`system-design/design-coordination-locking-collaboration` — freq: medium · difficulty: advanced

Coordination primitives for distributed systems plus real-time collaborative editing like Google Docs.

**Subtopics:**

- Distributed locks (Redis Redlock, Zookeeper, etcd)
- Leader election and coordination services
- Fencing tokens and preventing split-brain
- Operational Transformation (OT)
- CRDTs for conflict-free collaborative editing
- Real-time sync protocols and cursor/presence sharing
- Configuration management and service registry
- Distributed semaphores and locks with TTLs
- Conflict resolution and merge semantics

**Sample interview questions:**

- Design a collaborative document editor like Google Docs.
- Compare Operational Transformation and CRDTs for real-time collaboration.
- How do you implement a distributed lock and what can go wrong?
- Why do you need fencing tokens with distributed locks?
- How does leader election work in Zookeeper or etcd?
- How would you prevent split-brain in a leader-based system?
- How do multiple users' concurrent edits get merged consistently?
- How would you build a distributed configuration store that all services watch?

### Design a Distributed Job Scheduler, Task Queue & Cron

`system-design/design-job-scheduler-task-queue` — freq: medium · difficulty: intermediate

Scheduling, distributing, and reliably executing delayed, recurring, and background jobs at scale.

**Subtopics:**

- Execution semantics (at-least-once vs exactly-once execution)
- Delayed jobs and recurring / cron scheduling
- Job prioritization, fairness, and starvation avoidance
- Worker pools and task distribution
- Leader election for scheduler high availability
- Idempotency and retry with exponential backoff
- Handling long-running, stuck, and failed jobs
- Time-wheel and priority-queue data structures
- Distributed locks to prevent duplicate execution
- Monitoring job status and dead-letter handling

**Sample interview questions:**

- Design a distributed job scheduler / cron service.
- How do you guarantee a scheduled job runs exactly once across many workers?
- How would you support delayed and recurring jobs efficiently?
- How do you prevent two workers from picking up the same job?
- How do you handle a worker that dies mid-job?
- How do you prioritize jobs and prevent low-priority starvation?
- How would you make the scheduler itself highly available?
- How do you implement retries with backoff without duplicate side effects?

### Design a URL Shortener / Pastebin / Key-Value Store

`system-design/design-url-shortener` — freq: very-high · difficulty: beginner

Classic write-once/read-heavy design covering ID generation, encoding, and storage at scale.

**Subtopics:**

- Unique ID generation (counter, Snowflake, UUID)
- Base62 encoding and short-code length math
- Handling custom aliases and collisions
- Read-heavy caching strategy
- Database schema and choice
- Redirection (301 vs 302) and analytics
- Link expiration and cleanup
- Rate limiting and abuse prevention
- Capacity estimation for billions of URLs

**Sample interview questions:**

- Design a URL shortening service like TinyURL or bit.ly.
- How do you generate a unique, short, non-guessable key for each URL?
- Why use base62 encoding and how long should the short code be?
- How do you handle custom aliases and key collisions?
- Should the redirect be a 301 or 302 and why?
- How would you scale the read path for billions of redirects per day?
- How do you track click analytics without slowing down redirects?
- How do you expire and clean up old or unused links?

### Design Social Feed / Twitter / Chat / Notification System

`system-design/design-feed-chat-notification` — freq: very-high · difficulty: advanced

Real-time, fan-out-heavy social and messaging systems covering timeline generation and message delivery.

**Subtopics:**

- Fan-out on write vs fan-out on read (push vs pull)
- Handling celebrity / hot-user problem (hybrid fan-out)
- Feed ranking and pagination
- WebSocket / long polling / SSE for real-time delivery
- Presence and online status
- Message storage and ordering
- Delivery/read receipts and offline delivery
- Push notification pipeline (APNs, FCM) and fan-out
- Notification prioritization, deduplication, and rate limiting
- Group chat and message sync across devices

**Sample interview questions:**

- Design Twitter — focus on the news feed and timeline generation.
- Explain fan-out on write versus fan-out on read and their tradeoffs.
- How do you handle a celebrity with 100 million followers posting a tweet?
- Design a real-time chat system like WhatsApp or Facebook Messenger.
- How do you implement online/offline presence and read receipts?
- Design a notification system that delivers push, SMS, and email.
- How do you ensure notifications aren't sent twice and respect user preferences?
- What protocol would you use for real-time message delivery and why?

### Design Video/Media Platform (YouTube, Netflix) & Distributed Cache

`system-design/design-video-platform-distributed-cache` — freq: high · difficulty: advanced

Large-scale media storage/streaming and building a distributed in-memory cache like Memcached/Redis.

**Subtopics:**

- Video upload, transcoding pipeline, and multiple resolutions
- Blob/object storage and metadata separation
- CDN for video delivery and adaptive bitrate streaming
- View counts and trending computation
- Search and recommendation at a high level
- Distributed cache architecture and partitioning
- Consistent hashing for cache nodes
- Cache eviction and replication for high availability
- Cache client design and fault tolerance
- Hot key handling in a distributed cache

**Sample interview questions:**

- Design a video streaming service like YouTube or Netflix.
- How do you handle video upload and transcoding into multiple formats?
- How do you deliver video at scale with low buffering globally?
- How would you store and count video views accurately at massive scale?
- Design a distributed cache like Redis or Memcached.
- How do you partition and replicate data across distributed cache nodes?
- How do you handle cache node failures without losing all cached data?
- How does adaptive bitrate streaming choose the right quality?

### Design Location & Transactional Systems (Uber, Payments, Ticketmaster)

`system-design/design-location-and-payment-systems` — freq: high · difficulty: advanced

Geospatial matching and financial-grade systems requiring strong consistency, correctness, and idempotency.

**Subtopics:**

- Geospatial indexing (geohash, quadtree, S2)
- Real-time location updates and driver-rider matching
- Nearby search and proximity queries
- Payment flow, idempotency, and exactly-once charges
- Double-spending / double-booking prevention
- Distributed locks and reservation systems
- Strong consistency and transactional guarantees
- Reconciliation, ledgers, and audit trails
- Handling concurrency and inventory (seats, stock)
- Third-party payment gateway integration and retries

**Sample interview questions:**

- Design a ride-sharing service like Uber or Lyft.
- How do you efficiently find the nearest available drivers to a rider?
- What is geohashing and how does it support proximity search?
- Design a payment system and ensure a user is never charged twice.
- How do you guarantee idempotency in a payment or order API?
- Design a ticket booking system like Ticketmaster and prevent double-booking.
- How do you handle concurrency when thousands try to book the same seat?
- How do you reconcile transactions and maintain an accurate ledger?

<a id="docker"></a>
## Docker

Folder: `topics/docker/` · 15 topics

### Docker Fundamentals: Images vs Containers

`docker/images-vs-containers` — freq: very-high · difficulty: beginner

Core mental model of what Docker is, how images relate to running containers, and how it differs from VMs.

**Subtopics:**

- What Docker is and the problems it solves
- Images as immutable read-only templates
- Containers as running instances with a writable layer
- Docker architecture: client, daemon (dockerd), containerd, runc
- Docker vs virtual machines (kernel sharing, isolation, overhead)
- Linux namespaces and cgroups as the isolation primitives
- Container image registry basics
- Image tags, digests, and the :latest pitfall

**Sample interview questions:**

- What is the difference between a Docker image and a container?
- How is a container different from a virtual machine?
- Explain the Docker architecture and the role of the Docker daemon.
- What Linux kernel features make containers possible (namespaces and cgroups)?
- Can multiple containers run from the same image, and how do they stay isolated?
- What happens to data written inside a running container when it is removed?
- Why is relying on the :latest tag considered a bad practice?

### Dockerfile, Layers & Build Cache

`docker/dockerfile-layers-build-cache` — freq: very-high · difficulty: beginner

Authoring Dockerfiles and understanding how instructions become cached, layered filesystem changes.

**Subtopics:**

- Common instructions: FROM, RUN, COPY, ADD, WORKDIR, ENV, ARG, EXPOSE, LABEL
- How each instruction creates a layer and the union filesystem
- Layer caching and cache invalidation rules
- Ordering instructions to maximize cache reuse
- COPY vs ADD differences
- ARG vs ENV (build-time vs runtime variables)
- Using .dockerignore to shrink build context
- RUN command chaining to reduce layers
- Base image selection (alpine, slim, distroless, scratch)

**Sample interview questions:**

- What is a layer in a Docker image and how are layers stored?
- How does the Docker build cache work and what invalidates it?
- Why should you copy package manifests (package.json/requirements.txt) before copying the rest of the source?
- What is the difference between COPY and ADD, and which should you prefer?
- What is the difference between ARG and ENV?
- What does .dockerignore do and why is it important?
- Why is chaining multiple commands in a single RUN sometimes recommended?
- How would you order Dockerfile instructions to get the best cache hits?

### ENTRYPOINT vs CMD & Container Startup

`docker/entrypoint-vs-cmd` — freq: high · difficulty: intermediate

How a container decides what process to run at startup and the interplay between ENTRYPOINT, CMD, and runtime overrides.

**Subtopics:**

- CMD: default command/arguments and how it is overridden
- ENTRYPOINT: the fixed executable for the container
- Exec form vs shell form and PID 1 / signal handling implications
- Combining ENTRYPOINT + CMD (CMD as default args)
- Overriding at runtime with docker run args and --entrypoint
- Entrypoint scripts and exec "$@"
- Signal handling, zombie reaping, and init (tini, --init)
- Graceful shutdown and SIGTERM handling

**Sample interview questions:**

- What is the difference between ENTRYPOINT and CMD?
- When would you use ENTRYPOINT vs CMD, and can you use both together?
- What is the difference between the exec form and the shell form, and why does it matter for signals?
- How do you override ENTRYPOINT and CMD when running a container?
- Why might your app not receive SIGTERM on docker stop, and how do you fix it?
- What problem does an init process like tini solve inside a container?
- How does an entrypoint shell script typically hand off to the main process?

### Container Lifecycle & Runtime Operations

`docker/container-lifecycle` — freq: very-high · difficulty: beginner

Managing the states of a container and the day-to-day CLI commands used to run, inspect, and debug them.

**Subtopics:**

- Lifecycle states: created, running, paused, stopped, exited, removed
- Core commands: run, start, stop, restart, kill, rm, exec, attach, logs
- docker run flags: -d, -it, --rm, -p, -e, --name, --restart
- Restart policies (no, on-failure, always, unless-stopped)
- Inspecting containers: docker inspect, stats, top, events
- docker exec vs attach
- Foreground vs detached mode
- Resource limits at runtime (--memory, --cpus)
- Cleaning up: prune, dangling images and stopped containers

**Sample interview questions:**

- Walk me through the lifecycle states of a Docker container.
- What is the difference between docker stop and docker kill?
- How do you get a shell inside a running container?
- What is the difference between docker exec and docker attach?
- What do the -it and -d flags do in docker run?
- How do restart policies work and when would you use unless-stopped?
- How do you view the logs of a running or exited container?
- How do you limit CPU and memory for a container at runtime?

### Multi-Stage Builds & Image Optimization

`docker/multi-stage-builds-image-optimization` — freq: very-high · difficulty: intermediate

Techniques to produce small, fast, secure production images by separating build and runtime concerns.

**Subtopics:**

- Multi-stage build syntax and copying artifacts between stages
- Separating build toolchain from runtime image
- Choosing minimal base images (alpine, slim, distroless, scratch)
- Reducing layer count and image size
- Leveraging build cache and BuildKit
- --target to build a specific stage
- Removing build dependencies and caches in the same layer
- Static binaries and scratch images
- Analyzing image size with docker history / dive

**Sample interview questions:**

- What is a multi-stage build and what problem does it solve?
- How do you copy only the compiled artifact from a build stage into the final image?
- What techniques do you use to reduce Docker image size?
- Why are alpine or distroless images popular for production?
- How does BuildKit improve builds over the legacy builder?
- What is a scratch image and when would you use one?
- How would you debug why an image is unexpectedly large?
- How do you build only a specific stage of a multi-stage Dockerfile?

### Volumes, Bind Mounts & Data Persistence

`docker/volumes-and-storage` — freq: high · difficulty: intermediate

How to persist and share data beyond the ephemeral container writable layer.

**Subtopics:**

- Ephemeral writable layer and why data is lost on rm
- Named volumes vs bind mounts vs tmpfs mounts
- When to use volumes vs bind mounts
- -v vs --mount syntax
- Sharing volumes between containers
- Volume drivers and where volume data lives on the host
- Backing up and restoring volume data
- Read-only mounts and permissions/ownership issues
- Volumes in docker-compose

**Sample interview questions:**

- What is the difference between a volume and a bind mount?
- How do you persist database data across container restarts and removals?
- When would you choose a named volume over a bind mount?
- What is the difference between the -v and --mount flags?
- Where does Docker actually store named volume data on the host?
- How can two containers share the same data?
- What is a tmpfs mount and when is it useful?
- How do you back up the data stored in a Docker volume?

### Docker Networking

`docker/docker-networking` — freq: high · difficulty: intermediate

How containers communicate with each other, the host, and the outside world across different network drivers.

**Subtopics:**

- Default network drivers: bridge, host, none, overlay, macvlan
- Default bridge vs user-defined bridge networks
- Automatic DNS-based service discovery on user-defined networks
- Port publishing (-p) vs EXPOSE
- Container-to-container communication by name
- Host network mode and its trade-offs
- Overlay networks for multi-host / Swarm
- Inspecting networks and connecting/disconnecting containers
- Network isolation and security
- How published ports map through iptables/NAT and the docker-proxy

**Sample interview questions:**

- What are the different Docker network drivers and when do you use each?
- What is the difference between the default bridge and a user-defined bridge network?
- How do containers discover and talk to each other by name?
- What is the difference between EXPOSE and publishing a port with -p?
- What does host network mode do and what are its downsides?
- When would you use an overlay network?
- How do you connect a running container to another network?
- How would you make two containers communicate while isolating them from a third?
- What actually happens on the host when you publish a container port with -p 8080:80?

### Docker Compose & Multi-Container Apps

`docker/docker-compose` — freq: very-high · difficulty: intermediate

Declaratively defining and orchestrating multi-container applications on a single host.

**Subtopics:**

- docker-compose.yml structure: services, networks, volumes
- Common commands: up, down, build, logs, ps, exec, scale
- Service dependencies with depends_on and its limitations
- Health checks and waiting for dependencies to be ready
- Environment variables, .env files, and variable substitution
- Networking between compose services (automatic network + DNS)
- Volumes and persistence in compose
- Overriding configs and multiple compose files / profiles
- Compose vs orchestrators (Swarm, Kubernetes)

**Sample interview questions:**

- What is Docker Compose and what problem does it solve?
- Walk me through a docker-compose.yml for a web app with a database.
- What does depends_on guarantee and what does it NOT guarantee?
- How do you ensure a service waits until its database is actually ready?
- How do services in a compose file communicate with each other?
- What is the difference between docker-compose up and docker-compose down?
- How do you pass environment variables and secrets into compose services?
- How is Docker Compose different from Kubernetes?

### Registries, Tagging & Distribution

`docker/registries-and-distribution` — freq: medium · difficulty: intermediate

Storing, versioning, and distributing images via public and private registries.

**Subtopics:**

- Docker Hub and third-party registries (ECR, GCR, GHCR, Harbor)
- docker login, push, pull workflow
- Tagging strategy and semantic versioning
- Image digests vs tags for immutability
- Public vs private registries and authentication
- Running a private registry
- Image layers sharing and pull efficiency
- Manifests and multi-arch images (buildx)
- Registry security and image signing

**Sample interview questions:**

- How do you push and pull images to and from a registry?
- What is the difference between an image tag and an image digest?
- How would you set up and use a private registry?
- What tagging strategy would you use for CI/CD pipelines?
- How do you build and publish multi-architecture images?
- Why is pinning to a digest more reproducible than a tag?
- How does Docker avoid re-downloading layers that already exist locally?
- How do you authenticate to a private registry like Amazon ECR?

### Security Best Practices

`docker/docker-security` — freq: high · difficulty: advanced

Hardening images and containers against common vulnerabilities and reducing attack surface.

**Subtopics:**

- Running as a non-root user (USER instruction)
- Minimal base images to reduce attack surface
- Avoiding secrets in images/layers and using secret management
- Image scanning for vulnerabilities (Trivy, Scout, Snyk)
- Capabilities, --cap-drop, --cap-add, and privileged mode risks
- Read-only root filesystem and no-new-privileges
- Resource limits to prevent DoS
- Docker daemon and socket exposure risks
- Content trust / image signing and provenance
- Keeping base images patched
- User namespace remapping and rootless Docker
- Seccomp and AppArmor/SELinux profiles

**Sample interview questions:**

- Why should containers not run as root, and how do you avoid it?
- How do you keep secrets out of your Docker images?
- What are the risks of running a container with --privileged?
- How do you scan a Docker image for vulnerabilities?
- What is the danger of mounting the Docker socket into a container?
- How can you reduce the attack surface of a container image?
- What does a read-only root filesystem give you?
- How do Linux capabilities relate to container security?
- What is rootless Docker and what problem does it address?
- What do seccomp and AppArmor profiles do for container security?

### Orchestration & Production Concepts

`docker/orchestration-and-production` — freq: medium · difficulty: advanced

Beyond a single host: scaling, health, logging, and observability of containers in production.

**Subtopics:**

- Health checks (HEALTHCHECK instruction and compose healthcheck)
- Logging drivers and centralized logging
- Docker Swarm basics vs Kubernetes
- Scaling services and load balancing
- Rolling updates and zero-downtime deploys
- Stateless vs stateful containers and 12-factor principles
- Monitoring and resource metrics (docker stats, cAdvisor)
- Handling graceful shutdown and draining connections
- One process per container principle

**Sample interview questions:**

- How do you add a health check to a container and why is it useful?
- How do you collect logs from many containers in production?
- What is the difference between Docker Swarm and Kubernetes?
- How would you achieve zero-downtime deployment of a containerized service?
- What does it mean to run stateless containers and why does it matter?
- How do you monitor container resource usage?
- Why is the one-process-per-container guideline recommended?
- How do you scale a service horizontally with Docker?

### Image Internals & Storage Drivers

`docker/image-internals-storage-drivers` — freq: medium · difficulty: advanced

How images and container filesystems are actually stored on disk: union filesystems, copy-on-write, and content addressing.

**Subtopics:**

- Union/overlay filesystems and how layers are stacked
- Storage drivers: overlay2, aufs, btrfs, devicemapper, zfs
- Copy-on-write (CoW) semantics and the container writable layer
- Content-addressable storage and layer/image digests (SHA256)
- Image manifest, config JSON, and layer blobs
- Layer sharing and deduplication across images
- lowerdir/upperdir/merged in overlay2
- Where images and layers live under /var/lib/docker
- Inspecting layers with docker history and docker image inspect
- Disk usage and reclamation (docker system df, prune)

**Sample interview questions:**

- What is a union filesystem and how does Docker use it to build images?
- Explain copy-on-write in the context of container layers.
- What is the overlay2 storage driver and how do lowerdir and upperdir work?
- How are images content-addressed, and what is an image digest?
- How can two images share layers to save disk space?
- What happens at the filesystem level when a running container modifies a file that came from a read-only image layer?
- How do you inspect the layers that make up an image?
- How do you find and reclaim space consumed by Docker on a host?

### Debugging & Troubleshooting Containers

`docker/debugging-troubleshooting` — freq: high · difficulty: intermediate

Diagnosing why containers fail to start, crash, restart, or misbehave, and the tooling used to investigate.

**Subtopics:**

- Reading exit codes (137 OOM/SIGKILL, 143 SIGTERM, 139 SIGSEGV, 125/126/127)
- Container crash loops and CrashLoopBackOff-style restart storms
- OOMKilled containers and memory limit diagnosis
- Inspecting logs, events, and docker inspect state
- Getting a shell in distroless/minimal containers (ephemeral debug, nsenter)
- Debugging networking: DNS resolution, port conflicts, connectivity
- Debugging build failures and cache issues
- Permission and file ownership problems with mounts
- Diagnosing why a container exits immediately
- Using docker stats, top, and events for live diagnosis

**Sample interview questions:**

- A container exits immediately after starting. How do you debug it?
- What does exit code 137 mean and how do you confirm an OOM kill?
- How do you troubleshoot a container stuck in a restart loop?
- How would you debug a container that can't reach another service by name?
- How do you get a shell into a distroless or scratch-based container that has no shell?
- Your build works locally but fails in CI with a stale layer. How do you investigate?
- How do you diagnose permission-denied errors on a mounted volume?
- What tools and commands do you use to inspect a misbehaving running container?

### BuildKit & Advanced Builds

`docker/buildkit-advanced-builds` — freq: medium · difficulty: advanced

Modern build engine features that improve speed, caching, secret handling, and cross-platform builds.

**Subtopics:**

- Enabling and using BuildKit (DOCKER_BUILDKIT, docker buildx)
- Parallel stage execution and improved caching
- Cache mounts (RUN --mount=type=cache) for package managers
- Build secrets (RUN --mount=type=secret) and SSH forwarding
- Bind mounts during build (--mount=type=bind)
- Remote/registry cache backends (--cache-from, --cache-to)
- Multi-platform/multi-arch builds with buildx and QEMU emulation
- Heredocs and modern Dockerfile syntax (# syntax= directive)
- Build provenance, SBOM generation, and attestations
- buildx builders and driver types

**Sample interview questions:**

- What is BuildKit and how does it differ from the legacy Docker builder?
- How do cache mounts speed up dependency installation across builds?
- How do you pass a secret into a build without baking it into an image layer?
- How do you build a single image that runs on both amd64 and arm64?
- How do you share build cache across CI runners using a registry cache?
- Why is using build secrets safer than ARG for passing credentials at build time?
- What is an SBOM and how can BuildKit generate one during a build?
- How does buildx differ from docker build?

### Container Runtimes, Isolation Internals & OCI Standards

`docker/runtimes-oci-standards` — freq: medium · difficulty: advanced

What sits beneath the Docker CLI: the runtime stack, kernel isolation primitives, and the open standards that make it interoperable.

**Subtopics:**

- The runtime stack: dockerd, containerd, containerd-shim, runc
- OCI image spec and OCI runtime spec
- Container Runtime Interface (CRI) and why Kubernetes dropped dockershim
- Alternative runtimes: gVisor, Kata Containers, crun
- Linux namespaces in detail (pid, net, mnt, uts, ipc, user, cgroup)
- cgroups v1 vs v2 and resource accounting/enforcement
- How resource limits (--memory, --cpus) map to cgroup settings
- Capabilities and the default dropped set
- Rootless containers and user namespace remapping
- Docker vs Podman (daemonless, rootless architecture)

**Sample interview questions:**

- Describe what happens under the hood from docker run to a running process (dockerd, containerd, shim, runc).
- What are the OCI image and runtime specifications and why do they matter?
- Why did Kubernetes deprecate dockershim, and what is the CRI?
- Which Linux namespaces isolate a container and what does each one isolate?
- What is the difference between cgroups v1 and v2?
- How does setting --memory actually enforce a memory limit at the kernel level?
- What are gVisor and Kata Containers, and when would you use them?
- How does Podman differ architecturally from Docker?

<a id="kubernetes"></a>
## Kubernetes

Folder: `topics/kubernetes/` · 16 topics

### Kubernetes Architecture & Control Plane

`kubernetes/architecture-control-plane` — freq: very-high · difficulty: intermediate

How the cluster's control plane and node components work together to run and reconcile workloads.

**Subtopics:**

- kube-apiserver as the single entry point
- etcd as the key-value store and its consistency/backup
- kube-scheduler and scheduling decisions
- kube-controller-manager and control loops
- cloud-controller-manager
- kubelet responsibilities on nodes
- kube-proxy and iptables/IPVS modes
- container runtime (containerd/CRI-O) and CRI
- declarative model and reconciliation loop
- master/control-plane high availability

**Sample interview questions:**

- Walk me through what happens end-to-end when you run 'kubectl apply' to create a Deployment.
- What are the components of the Kubernetes control plane and what does each do?
- What is etcd used for, and how would you back it up and restore it?
- What is the role of the kubelet, and how does it differ from kube-proxy?
- Explain the reconciliation loop and what 'declarative' vs 'imperative' means in Kubernetes.
- How does the scheduler decide which node a pod lands on?
- How would you make the control plane highly available?
- What is the CRI and why did Kubernetes deprecate Docker as a runtime?

### Pods & Workload Controllers

`kubernetes/pods-workload-controllers` — freq: very-high · difficulty: beginner

The pod as the atomic unit and the controllers (ReplicaSet, Deployment, StatefulSet, DaemonSet, Job) that manage pods.

**Subtopics:**

- Pod lifecycle and phases (Pending/Running/Succeeded/Failed)
- Multi-container pods and sidecar/init containers
- ReplicaSet and desired replica count
- Deployment vs ReplicaSet relationship
- StatefulSet: stable identity, ordered scaling, headless service
- DaemonSet for per-node pods
- Job and CronJob for batch workloads
- Pod restart policies and disruptions (PDB)
- static pods vs controller-managed pods
- labels, selectors, and ownership

**Sample interview questions:**

- What is a Pod and why does Kubernetes use pods instead of scheduling containers directly?
- What is the difference between a Deployment, a ReplicaSet, and a StatefulSet?
- When would you use a StatefulSet instead of a Deployment?
- How does a DaemonSet differ from a Deployment and when would you use one?
- What is an init container and how does it differ from a sidecar?
- Explain the difference between a Job and a CronJob.
- How do StatefulSets provide stable network identity and storage?
- What is a PodDisruptionBudget and what problem does it solve?

### Deployments, Rolling Updates & Rollbacks

`kubernetes/deployments-rolling-updates` — freq: very-high · difficulty: intermediate

Managing application releases, update strategies, and safe rollbacks with Deployments.

**Subtopics:**

- RollingUpdate strategy (maxSurge, maxUnavailable)
- Recreate strategy
- revision history and rollback (kubectl rollout undo)
- deployment status and progress deadlines
- blue-green and canary deployment patterns
- pausing and resuming rollouts
- readiness probes gating rollout progress
- image pull policy and tag immutability

**Sample interview questions:**

- Explain how a rolling update works and what maxSurge and maxUnavailable control.
- How do you roll back a Deployment to a previous version?
- How would you implement a canary or blue-green deployment in Kubernetes?
- What happens to old ReplicaSets after a Deployment update?
- How does a readiness probe affect a rolling update?
- Your rollout is stuck; how do you diagnose why new pods aren't becoming ready?
- How do you achieve zero-downtime deployments?
- What is the difference between the RollingUpdate and Recreate strategies?

### Services, Networking & Ingress

`kubernetes/services-networking-ingress` — freq: very-high · difficulty: intermediate

How pods communicate, get discovered, and are exposed internally and externally.

**Subtopics:**

- ClusterIP, NodePort, LoadBalancer, ExternalName service types
- headless services and service discovery via DNS
- kube-proxy, endpoints, and EndpointSlices
- Ingress controllers and Ingress resources
- path-based and host-based routing, TLS termination
- CNI plugins (Calico, Flannel, Cilium) and the pod network model
- Kubernetes networking rules (pod-to-pod, no NAT)
- CoreDNS and cluster DNS resolution
- Gateway API vs Ingress

**Sample interview questions:**

- Explain the different types of Services and when you'd use each.
- What is the difference between a NodePort, a LoadBalancer, and an Ingress?
- How does service discovery work in Kubernetes?
- How does a Service route traffic to the correct pods, and what are Endpoints/EndpointSlices?
- What is an Ingress controller and how does it differ from an Ingress resource?
- What is a headless service and when would you use one?
- Describe the Kubernetes networking model and the role of the CNI.
- How does DNS resolution work for a service named 'my-svc' in namespace 'prod'?

### Configuration & Secrets Management

`kubernetes/config-secrets` — freq: high · difficulty: beginner

Injecting configuration and sensitive data into applications via ConfigMaps and Secrets.

**Subtopics:**

- ConfigMap creation and consumption (env vars vs volume mounts)
- Secret types and base64 encoding (not encryption)
- encryption at rest for etcd
- mounting secrets as files vs environment variables
- immutable ConfigMaps and Secrets
- reloading config on change (and its limitations)
- external secret managers (Vault, AWS Secrets Manager, External Secrets Operator)
- downward API for exposing pod metadata

**Sample interview questions:**

- What is the difference between a ConfigMap and a Secret?
- Are Kubernetes Secrets encrypted? How would you secure them properly?
- How can you inject configuration into a pod, and what are the trade-offs of env vars vs mounted volumes?
- If you update a ConfigMap, does the running pod automatically pick up the change?
- How would you integrate an external secrets manager like Vault or AWS Secrets Manager?
- What is the Downward API and what is it used for?
- How do you enable encryption at rest for secrets in etcd?

### Storage: Volumes, PV, PVC & StorageClasses

`kubernetes/storage-volumes-pv-pvc` — freq: high · difficulty: intermediate

Persisting data beyond the pod lifecycle using volumes, persistent volumes, and dynamic provisioning.

**Subtopics:**

- ephemeral volumes (emptyDir, hostPath)
- PersistentVolume (PV) and PersistentVolumeClaim (PVC)
- StorageClass and dynamic provisioning
- access modes (RWO, ROX, RWX, RWOP)
- reclaim policies (Retain, Delete, Recycle)
- CSI (Container Storage Interface) drivers
- volume binding modes (Immediate vs WaitForFirstConsumer)
- StatefulSet volumeClaimTemplates
- stateful workloads and data durability

**Sample interview questions:**

- Explain the relationship between a PersistentVolume, a PersistentVolumeClaim, and a StorageClass.
- What is dynamic provisioning and how does a StorageClass enable it?
- What are the different access modes and what do RWO/ROX/RWX mean?
- What is the difference between emptyDir and a PersistentVolume?
- What are reclaim policies and what happens to data when a PVC is deleted?
- How do StatefulSets handle persistent storage for each replica?
- What is the CSI and why did Kubernetes move to it?
- What is WaitForFirstConsumer volume binding and why is it useful?

### Health Probes & Resource Management

`kubernetes/probes-resources` — freq: very-high · difficulty: intermediate

Keeping workloads healthy and scheduled correctly using probes, requests/limits, and QoS.

**Subtopics:**

- liveness, readiness, and startup probes
- probe mechanisms (HTTP, TCP, exec, gRPC)
- resource requests vs limits (CPU, memory)
- QoS classes (Guaranteed, Burstable, BestEffort)
- OOMKilled and CPU throttling behavior
- eviction and node pressure
- LimitRange and ResourceQuota
- scheduling impact of requests

**Sample interview questions:**

- What is the difference between a liveness, readiness, and startup probe?
- What happens if a liveness probe fails vs a readiness probe fails?
- Explain resource requests vs limits and how they affect scheduling.
- What are the QoS classes and how are they assigned?
- What happens when a container exceeds its memory limit vs its CPU limit?
- Why might a pod be evicted, and how do requests protect against eviction?
- What is a startup probe and what problem does it solve for slow-starting apps?
- What are ResourceQuota and LimitRange used for?

### Autoscaling: HPA, VPA & Cluster Autoscaler

`kubernetes/autoscaling-hpa-vpa` — freq: high · difficulty: intermediate

Scaling pods and nodes automatically based on demand.

**Subtopics:**

- Horizontal Pod Autoscaler (HPA) on CPU/memory/custom metrics
- metrics-server and the custom/external metrics API
- Vertical Pod Autoscaler (VPA) modes
- HPA vs VPA conflicts
- Cluster Autoscaler and node scaling
- scaling on custom and external metrics (KEDA)
- scale-up/scale-down behavior and stabilization windows
- min/max replicas and target utilization
- node autoprovisioning (Karpenter)

**Sample interview questions:**

- How does the Horizontal Pod Autoscaler work and what metrics can it scale on?
- What is the difference between HPA, VPA, and the Cluster Autoscaler?
- Why can HPA and VPA conflict, and how do you use them together safely?
- What component does HPA rely on to read CPU/memory metrics?
- How would you autoscale based on a custom metric like queue length?
- What is KEDA and when would you use it over the standard HPA?
- How does the Cluster Autoscaler decide to add or remove nodes?
- How does Karpenter differ from the Cluster Autoscaler?

### Scheduling, Affinity & Multi-tenancy

`kubernetes/scheduling-affinity-namespaces` — freq: high · difficulty: advanced

Controlling where pods run and isolating workloads across namespaces.

**Subtopics:**

- node selectors, node affinity, and anti-affinity
- pod affinity and anti-affinity
- taints and tolerations
- topology spread constraints
- namespaces for logical isolation
- priority classes and preemption
- cordon, drain, and node maintenance
- custom schedulers and scheduling framework

**Sample interview questions:**

- What is the difference between node affinity and taints/tolerations?
- How would you ensure two replicas of a service never land on the same node?
- Explain taints and tolerations with a concrete use case.
- What are topology spread constraints and why are they useful?
- What are namespaces and what do they isolate (and not isolate)?
- How do PriorityClasses and preemption work?
- How do you safely take a node down for maintenance?
- What is the difference between requiredDuringScheduling and preferredDuringScheduling affinity?

### Security & RBAC

`kubernetes/security-rbac` — freq: high · difficulty: advanced

Authentication, authorization, and workload hardening in Kubernetes.

**Subtopics:**

- RBAC: Roles, ClusterRoles, RoleBindings, ClusterRoleBindings
- ServiceAccounts and token projection
- authentication vs authorization vs admission control
- admission controllers and webhooks (validating/mutating)
- NetworkPolicies for traffic segmentation
- Pod Security Admission / Pod Security Standards
- securityContext (runAsNonRoot, capabilities, readOnlyRootFilesystem)
- secrets access control and least privilege
- image scanning and supply chain security
- audit logging and API server auditing

**Sample interview questions:**

- Explain RBAC: what is the difference between a Role and a ClusterRole?
- What is the difference between a RoleBinding and a ClusterRoleBinding?
- What is a ServiceAccount and how do pods authenticate to the API server?
- How do NetworkPolicies work and what is the default behavior without them?
- Walk me through the request flow: authentication, authorization, and admission control.
- What is an admission controller and what is the difference between mutating and validating webhooks?
- How would you enforce that containers don't run as root?
- What replaced PodSecurityPolicies and how does Pod Security Admission work?
- How would you audit who accessed or modified resources in the cluster?

### Helm & Package Management

`kubernetes/helm-package-management` — freq: medium · difficulty: intermediate

Templating, packaging, and releasing Kubernetes applications with Helm and alternatives.

**Subtopics:**

- Helm charts, templates, and values.yaml
- releases, revisions, and rollbacks
- Helm 3 architecture (no Tiller)
- chart dependencies and subcharts
- hooks and lifecycle
- templating with Go templates and helpers
- Kustomize as an alternative (overlays, patches)
- GitOps tooling (ArgoCD, Flux)

**Sample interview questions:**

- What is Helm and what problem does it solve?
- Explain the structure of a Helm chart and the role of values.yaml.
- What changed between Helm 2 and Helm 3, and why was Tiller removed?
- How do you roll back a Helm release?
- What is the difference between Helm and Kustomize?
- How do Helm hooks work and when would you use a pre-install hook?
- How would you manage environment-specific configuration across dev/staging/prod?
- What is GitOps and how do tools like ArgoCD or Flux fit in?

### Operators, CRDs & Extensibility

`kubernetes/operators-crds-extensibility` — freq: medium · difficulty: advanced

Extending the Kubernetes API with custom resources and encoding operational logic in operators.

**Subtopics:**

- CustomResourceDefinitions (CRDs)
- the operator pattern and custom controllers
- control loops and reconciliation for custom resources
- controller-runtime and Kubebuilder/Operator SDK
- finalizers and owner references / garbage collection
- aggregated API servers
- when to use an operator vs a Helm chart
- informers, watches, and the client-go workqueue

**Sample interview questions:**

- What is a CustomResourceDefinition and what does it let you do?
- Explain the operator pattern and when you'd build an operator.
- How does a custom controller's reconciliation loop work?
- What is the difference between using an operator and using a Helm chart?
- What are finalizers and owner references, and how does garbage collection work?
- How do informers and watches work in client-go?
- How would you extend the Kubernetes API beyond CRDs?

### Troubleshooting & Observability

`kubernetes/troubleshooting-observability` — freq: high · difficulty: intermediate

Diagnosing failing pods, networking issues, and cluster problems in practice.

**Subtopics:**

- debugging CrashLoopBackOff, ImagePullBackOff, Pending, OOMKilled
- kubectl describe, logs, events, exec, debug
- diagnosing pending pods (scheduling failures)
- network debugging between pods and services
- reading pod and node conditions
- metrics, logging, and tracing stack (Prometheus, Grafana, Loki)
- node NotReady and kubelet issues
- ephemeral debug containers

**Sample interview questions:**

- A pod is stuck in CrashLoopBackOff — how do you debug it?
- What does ImagePullBackOff mean and how do you fix it?
- A pod is stuck in Pending — what are the possible causes and how do you investigate?
- How would you debug why service A cannot reach service B?
- Which kubectl commands do you reach for first when a workload is misbehaving?
- How do you find out why a pod was OOMKilled or evicted?
- How would you set up monitoring and alerting for a Kubernetes cluster?
- A node shows NotReady — how do you troubleshoot it?

### Kubernetes API, Objects & kubectl

`kubernetes/api-objects-kubectl` — freq: high · difficulty: beginner

The API object model, versioning, and how kubectl interacts with the API server declaratively and imperatively.

**Subtopics:**

- object anatomy: apiVersion, kind, metadata, spec, status
- API groups and resource versioning (alpha/beta/stable, GA)
- imperative vs declarative management (create/apply/edit/patch)
- kubectl apply, three-way merge, and last-applied-configuration
- server-side apply and field managers / conflict resolution
- kubectl dry-run (client vs server) and diff
- label selectors, field selectors, and annotations
- API deprecation policy and migrating deprecated APIs
- optimistic concurrency via resourceVersion

**Sample interview questions:**

- What are the required fields of every Kubernetes object and what is the difference between spec and status?
- What is the difference between imperative and declarative object management, and when do you use each?
- How does 'kubectl apply' decide what to change — explain three-way merge / last-applied-configuration.
- What is server-side apply and what problem do field managers solve?
- How do API versions like v1alpha1, v1beta1, and v1 differ, and what is Kubernetes' deprecation policy?
- What is the difference between a label and an annotation, and between label selectors and field selectors?
- How would you preview a change without actually applying it?
- How does the API server prevent conflicting concurrent updates to the same object?

### Cluster Installation, Upgrades & Lifecycle

`kubernetes/cluster-installation-upgrades` — freq: medium · difficulty: intermediate

Bootstrapping, upgrading, and maintaining clusters, including managed offerings and version compatibility.

**Subtopics:**

- kubeadm bootstrap (init, join, tokens)
- managed vs self-managed clusters (EKS, GKE, AKS)
- version skew policy across control plane, kubelet, and clients
- control-plane and node pool upgrade procedures
- draining nodes and surge/rolling node upgrades
- etcd backup/restore during upgrades
- certificate management and rotation
- cluster-level add-ons (CoreDNS, CNI, metrics-server)
- kubeconfig, contexts, and cluster access

**Sample interview questions:**

- How would you bootstrap a cluster with kubeadm, and what do init and join do?
- What is the version skew policy between the control plane, kubelet, and kubectl?
- Walk me through safely upgrading a cluster with zero workload downtime.
- What are the trade-offs between a managed service like EKS/GKE and a self-managed cluster?
- How do you back up and restore etcd, and why is it critical before an upgrade?
- How are cluster certificates managed and rotated?
- How does a kubeconfig file work and how do you switch between clusters/contexts?
- What steps do you take to upgrade node pools without dropping traffic?

### Service Mesh & Advanced Traffic Management

`kubernetes/service-mesh-traffic-management` — freq: medium · difficulty: advanced

Layering a service mesh for mTLS, fine-grained traffic control, and observability beyond core networking.

**Subtopics:**

- service mesh concepts and data plane vs control plane
- Istio and Linkerd architectures
- sidecar proxy injection (Envoy) and sidecar-less/ambient meshes
- mutual TLS and zero-trust service-to-service auth
- traffic splitting, mirroring, and request routing rules
- retries, timeouts, and circuit breaking
- mesh-level observability (metrics, distributed tracing)
- when a mesh is overkill vs Ingress/NetworkPolicy
- Cilium eBPF-based networking and mesh

**Sample interview questions:**

- What is a service mesh and what problems does it solve that core Kubernetes networking does not?
- Explain the difference between the mesh data plane and control plane.
- How does a service mesh provide mutual TLS between services?
- How would you implement a weighted canary using traffic splitting in Istio?
- What are the trade-offs of the sidecar model, and what is an ambient/sidecar-less mesh?
- When would you choose NOT to adopt a service mesh?
- How do retries, timeouts, and circuit breaking work in a mesh?
- How does Cilium's eBPF approach differ from a traditional sidecar-based mesh?

<a id="devops-cicd"></a>
## DevOps & CI/CD

Folder: `topics/devops-cicd/` · 18 topics

### DevOps Fundamentals & Culture

`devops-cicd/devops-fundamentals-and-culture` — freq: very-high · difficulty: beginner

Core DevOps philosophy, the software delivery lifecycle, and the cultural/organizational practices that CI/CD tooling supports.

**Subtopics:**

- What DevOps is and the problems it solves (dev vs ops silos)
- CI vs CD (continuous delivery) vs continuous deployment distinctions
- The DevOps lifecycle / infinity loop (plan, code, build, test, release, deploy, operate, monitor)
- Shift-left testing and security (DevSecOps)
- DORA metrics: deployment frequency, lead time for changes, MTTR, change failure rate
- Configuration management vs orchestration vs provisioning
- Agile and its relationship to DevOps
- Feedback loops and automation as core principles
- CALMS framework (Culture, Automation, Lean, Measurement, Sharing)
- Platform engineering and internal developer platforms (IDP)

**Sample interview questions:**

- What is the difference between continuous integration, continuous delivery, and continuous deployment?
- Explain the DevOps lifecycle and what happens at each stage.
- What does 'shift-left' mean and why does it matter?
- What are the four DORA metrics and why are they used to measure DevOps performance?
- How would you convince a traditional ops team to adopt DevOps practices?
- What is the difference between provisioning, configuration management, and orchestration?
- How do you measure the success of a DevOps transformation?
- What is platform engineering and how does it relate to DevOps?

### CI/CD Pipeline Concepts

`devops-cicd/cicd-pipeline-concepts` — freq: very-high · difficulty: intermediate

How build/test/deploy pipelines are designed, staged, secured, and optimized independent of a specific tool.

**Subtopics:**

- Pipeline stages: source, build, test, package, deploy, verify
- Pipeline-as-code (declarative vs scripted definitions)
- Quality gates, approval gates, and manual promotion
- Parallel vs sequential stages and fan-out/fan-in
- Handling secrets and credentials in pipelines
- Caching, artifact reuse, and build optimization
- Rollback strategies and pipeline failure handling
- Environment promotion (dev -> staging -> prod)
- Trigger types: push, PR, scheduled, manual, webhook
- Ephemeral vs persistent build agents/runners and self-hosted vs hosted
- Matrix builds and multi-platform builds

**Sample interview questions:**

- Walk me through the stages of a CI/CD pipeline you have built.
- How do you manage secrets and credentials inside a CI/CD pipeline?
- How would you speed up a slow build pipeline?
- What is pipeline-as-code and why is it preferable to configuring pipelines through a UI?
- How do you implement approval/quality gates before a production deployment?
- A pipeline stage fails intermittently (flaky tests) — how do you handle it?
- How do you design a pipeline that deploys the same artifact across multiple environments?
- What are the tradeoffs between hosted runners and self-hosted runners?

### Git & Branching Strategies

`devops-cicd/git-and-branching-strategies` — freq: high · difficulty: beginner

Version control workflows, merge strategies, and branching models that drive CI/CD triggers and release cadence.

**Subtopics:**

- GitFlow vs GitHub Flow vs GitLab Flow vs trunk-based development
- Feature branches, release branches, hotfix branches
- Merge vs rebase; fast-forward vs merge commits
- Pull/merge request review workflows and branch protection
- Handling merge conflicts
- Feature flags / feature toggles for decoupling deploy from release
- Monorepo vs polyrepo tradeoffs
- Semantic versioning and release tagging
- git revert vs reset vs cherry-pick; recovering with reflog
- Commit hygiene, squashing, and conventional commits

**Sample interview questions:**

- Compare GitFlow and trunk-based development — when would you use each?
- What is the difference between git merge and git rebase, and when do you use each?
- Why is trunk-based development often recommended for CI/CD?
- How do feature flags let you decouple deployment from release?
- How do you resolve a merge conflict, and how do you avoid them?
- Explain semantic versioning (MAJOR.MINOR.PATCH).
- What are branch protection rules and why enforce them?
- How do you undo a bad commit that was already pushed to a shared branch?

### Jenkins & CI Tooling

`devops-cicd/jenkins-and-ci-tooling` — freq: high · difficulty: intermediate

Jenkins architecture, pipeline authoring, and comparison with cloud-native CI tools like GitHub Actions and GitLab CI.

**Subtopics:**

- Jenkins controller/agent architecture
- Declarative vs scripted Jenkinsfile pipelines
- Stages, steps, post actions, and shared libraries
- Plugins ecosystem and plugin management
- Distributed builds and executor scaling
- Webhooks, polling, and multibranch pipelines
- Credentials management in Jenkins
- Comparison with GitHub Actions, GitLab CI, CircleCI, Argo, Tekton
- GitHub Actions specifics: workflows, jobs, runners, reusable/composite actions, OIDC
- GitLab CI specifics: .gitlab-ci.yml, stages, runners, environments

**Sample interview questions:**

- Explain the Jenkins controller-agent architecture.
- What is a Jenkinsfile and what is the difference between declarative and scripted pipelines?
- How do you scale Jenkins to handle many concurrent builds?
- How do you securely store and use credentials in Jenkins?
- What is a Jenkins shared library and why use one?
- How would you migrate from Jenkins to GitHub Actions or GitLab CI, and what are the tradeoffs?
- How do you set up a multibranch pipeline that builds every PR?
- How does OIDC-based authentication from GitHub Actions to a cloud provider avoid long-lived secrets?

### Deployment Strategies

`devops-cicd/deployment-strategies` — freq: very-high · difficulty: intermediate

Release patterns that minimize downtime and risk: blue-green, canary, rolling, and their trade-offs.

**Subtopics:**

- Blue-green deployment and instant rollback via traffic switch
- Canary deployment and progressive traffic shifting
- Rolling updates and surge/max-unavailable settings
- Recreate (big-bang) deployments and downtime
- A/B testing vs canary (business vs technical validation)
- Shadow / dark launch deployments
- Rollback mechanisms and automated rollback triggers
- Database schema migrations during zero-downtime deploys (expand/contract)
- Progressive delivery tooling (Argo Rollouts, Flagger)
- Ring/wave-based deployments across regions and cells

**Sample interview questions:**

- Explain blue-green deployment and its main advantages and drawbacks.
- What is the difference between blue-green and canary deployments?
- How does a canary deployment decide whether to proceed or roll back?
- How do you achieve zero-downtime deployments?
- How do you handle backward-incompatible database migrations during a rolling deploy?
- Compare canary deployment with A/B testing.
- What is a rolling deployment and how do maxSurge/maxUnavailable work in Kubernetes?
- How would you roll out a risky change safely across many regions?

### Infrastructure as Code (Terraform & Ansible)

`devops-cicd/infrastructure-as-code` — freq: very-high · difficulty: intermediate

Declaratively provisioning and configuring infrastructure with Terraform, Ansible, and related IaC tooling.

**Subtopics:**

- Declarative vs imperative IaC; idempotency
- Terraform state, remote state, and state locking
- Terraform modules, workspaces, providers, and plan/apply lifecycle
- terraform plan vs apply vs destroy; drift detection; import; taint/replace
- Provisioning (Terraform) vs configuration management (Ansible)
- Ansible playbooks, roles, inventory, and agentless push model
- Immutable vs mutable infrastructure
- Secrets in IaC and managing sensitive variables
- CloudFormation / Pulumi / CDK comparison
- Chef and Puppet (agent-based pull model) vs Ansible
- Packer and golden-image / AMI baking pipelines
- Testing and policy for IaC (terratest, tflint, checkov/OPA, Sentinel)

**Sample interview questions:**

- What is Infrastructure as Code and why is idempotency important?
- How does Terraform state work, and why do you need remote state with locking?
- What is the difference between Terraform and Ansible — when would you use each?
- Explain the terraform plan/apply workflow and what drift is.
- How do you structure Terraform code for reuse across environments?
- How does Ansible achieve idempotency without an agent?
- How do you manage secrets in Terraform without committing them to version control?
- What is the difference between mutable and immutable infrastructure?
- How do you handle a resource that was changed manually outside of Terraform?
- How would you enforce policy/compliance checks on infrastructure before apply?

### Containers & Orchestration Basics

`devops-cicd/containers-and-orchestration` — freq: high · difficulty: intermediate

Docker fundamentals and Kubernetes concepts as they relate to building, shipping, and deploying applications in CI/CD.

**Subtopics:**

- Containers vs virtual machines
- Dockerfile, image layers, multi-stage builds, and image optimization
- Container registries and image tagging strategies
- Kubernetes core objects: pods, deployments, services, ingress, configmaps, secrets
- Kubernetes rollout, rollback, and health probes (liveness/readiness/startup)
- Helm charts and Kustomize for templating manifests
- Horizontal and vertical pod autoscaling; cluster autoscaler
- Container security and image scanning in the pipeline
- Kubernetes networking: services (ClusterIP/NodePort/LoadBalancer), CNI, DNS
- Namespaces, RBAC, resource requests/limits, and quotas
- StatefulSets, DaemonSets, Jobs/CronJobs, and PersistentVolumes
- Service mesh basics (Istio/Linkerd) and sidecars

**Sample interview questions:**

- What is the difference between a container and a virtual machine?
- What is a multi-stage Docker build and why use one?
- How do liveness and readiness probes differ in Kubernetes?
- How does a Kubernetes Deployment perform a rolling update and rollback?
- What is the difference between a ConfigMap and a Secret?
- How do you integrate container image scanning into a CI pipeline?
- What is Helm and what problem does it solve?
- How does a request reach a pod — walk through Service, Ingress, and kube-proxy.
- How do resource requests and limits affect pod scheduling and eviction?

### GitOps

`devops-cicd/gitops` — freq: high · difficulty: advanced

Using Git as the single source of truth for declarative infrastructure and application delivery via pull-based reconciliation.

**Subtopics:**

- GitOps principles: declarative, versioned, automatically applied, continuously reconciled
- Pull-based vs push-based deployment models
- Argo CD and Flux CD
- Reconciliation loops and drift correction
- App-of-apps and repository structure patterns
- Separation of application code repo vs config/manifests repo
- Rollbacks via Git revert
- Secrets management in GitOps (sealed secrets, external secrets operator, SOPS)
- Promotion between environments in GitOps (branch vs directory vs overlay)

**Sample interview questions:**

- What is GitOps and what are its core principles?
- How does a pull-based GitOps model differ from a traditional push-based CI/CD deployment?
- How does Argo CD detect and correct configuration drift?
- How do you handle secrets in a GitOps workflow when everything lives in Git?
- How do you perform a rollback in GitOps?
- Why separate the application source repo from the deployment manifests repo?
- Compare Argo CD and Flux.
- How do you promote a change from staging to production in a GitOps setup?

### Monitoring & Observability

`devops-cicd/monitoring-and-observability` — freq: very-high · difficulty: intermediate

Metrics, logging, and tracing with Prometheus, Grafana, and the ELK stack to understand system health.

**Subtopics:**

- Monitoring vs observability
- Three pillars: metrics, logs, traces
- Prometheus architecture, pull model, PromQL, and exporters
- Grafana dashboards and alerting
- ELK/EFK stack (Elasticsearch, Logstash/Fluentd, Kibana) for centralized logging
- Alertmanager, alert fatigue, and alert routing
- Distributed tracing (Jaeger, OpenTelemetry)
- The four golden signals (latency, traffic, errors, saturation) and RED/USE methods
- Structured logging and log aggregation
- Metric types (counter, gauge, histogram, summary) and cardinality pitfalls
- Push vs pull monitoring and pushgateway use cases

**Sample interview questions:**

- What is the difference between monitoring and observability?
- What are the three pillars of observability?
- How does Prometheus's pull-based scraping model work and what is an exporter?
- What are the four golden signals of monitoring?
- How would you design centralized logging for a microservices system using the ELK stack?
- How do you avoid alert fatigue when setting up alerting?
- What is distributed tracing and when do you need it?
- Difference between the RED method and the USE method?
- What is high metric cardinality and why is it a problem for Prometheus?

### Artifact & Dependency Management

`devops-cicd/artifact-and-dependency-management` — freq: medium · difficulty: intermediate

Storing, versioning, and securing build artifacts and dependencies through registries and repositories.

**Subtopics:**

- Artifact repositories: Artifactory, Nexus, GitHub Packages, container registries
- Immutable artifacts and 'build once, deploy everywhere'
- Artifact versioning and promotion across environments
- Dependency management and caching
- Software supply chain security (SBOM, signing, provenance, SLSA)
- Vulnerability scanning of dependencies and images
- Retention/cleanup policies for artifacts
- Proxying and caching upstream package registries
- Image signing/verification (cosign, Notary) and admission control

**Sample interview questions:**

- Why should you build an artifact once and promote the same artifact through environments?
- What is an artifact repository and what problems does Artifactory/Nexus solve?
- How do you version and promote build artifacts across dev, staging, and prod?
- What is an SBOM and why does it matter for supply chain security?
- How do you scan artifacts and dependencies for vulnerabilities in your pipeline?
- How do you handle artifact retention and storage cleanup?
- What is artifact signing and how does it improve trust?
- How would you prevent an unsigned or vulnerable image from being deployed?

### SRE Concepts: SLA, SLO, SLI & Reliability

`devops-cicd/sre-sla-slo-sli-reliability` — freq: high · difficulty: advanced

Site Reliability Engineering principles for defining and measuring reliability targets and error budgets.

**Subtopics:**

- SLI vs SLO vs SLA definitions and relationships
- Error budgets and how they gate releases
- Choosing good SLIs (availability, latency, error rate)
- Toil reduction and automation
- Reliability vs feature velocity tradeoffs
- Capacity planning and load/chaos testing
- The nine-nines availability math and downtime budgets
- Blameless postmortems and error-budget policy
- Redundancy, failover, and graceful degradation
- Backups, RPO/RTO, and disaster recovery patterns (backup-restore, pilot light, warm standby, multi-site)

**Sample interview questions:**

- Explain the difference between an SLI, an SLO, and an SLA.
- What is an error budget and how does it influence deployment decisions?
- How would you define good SLIs for a web API?
- What does '99.9% availability' translate to in allowed downtime per month?
- What is toil and how do SREs reduce it?
- How do you balance feature velocity against reliability?
- What happens when a team exhausts its error budget?
- What are RPO and RTO, and how do they drive your disaster recovery design?

### Incident Management & Troubleshooting

`devops-cicd/incident-management-and-troubleshooting` — freq: high · difficulty: intermediate

Detecting, responding to, resolving, and learning from production incidents in a DevOps/SRE context.

**Subtopics:**

- Incident lifecycle: detection, triage, mitigation, resolution, postmortem
- MTTR, MTTD, MTBF and reducing them
- On-call rotations, escalation policies, and paging (PagerDuty/Opsgenie)
- Incident severity levels and incident commander roles
- Blameless postmortems and root cause analysis (5 Whys, fishbone)
- Rollback vs roll-forward decisions during an incident
- Runbooks and automated remediation
- Communication and stakeholder updates during incidents
- Practical debugging: high CPU/memory, disk full, OOMKilled pods, latency spikes
- Chaos engineering and game days to build resilience

**Sample interview questions:**

- Walk me through how you would handle a production outage from alert to resolution.
- What is MTTR and how would you reduce it?
- During an incident, how do you decide between rolling back and rolling forward?
- What is a blameless postmortem and why is it important?
- How do you conduct root cause analysis for a recurring issue?
- How would you design an on-call and escalation process for a small team?
- A deployment causes elevated error rates in production — what are your first steps?
- How do severity levels (SEV1-SEV5) change your incident response?
- A server shows 100% CPU / a pod keeps getting OOMKilled — how do you debug it?

### Linux, Shell Scripting & OS Fundamentals

`devops-cicd/linux-scripting-and-os-fundamentals` — freq: very-high · difficulty: intermediate

Operating-system and command-line fundamentals every DevOps engineer is screened on: processes, permissions, filesystems, systemd, and automation via shell/Python scripting.

**Subtopics:**

- File permissions, ownership, chmod/chown, umask, SUID/SGID/sticky bit
- Process management: ps, top/htop, signals, kill, nice, foreground/background, systemd services
- Filesystem, mounts, inodes, disk usage (df/du), and 'disk full' troubleshooting
- Text processing: grep, sed, awk, cut, sort, uniq, pipes and redirection
- Bash scripting: variables, conditionals, loops, functions, exit codes, set -euo pipefail
- Networking from the CLI: ss/netstat, curl, dig/nslookup, tcpdump, ip/ifconfig
- Environment variables, PATH, shell startup files, cron and scheduled jobs
- Package managers (apt/yum/dnf) and systemd/init basics
- Log locations, journalctl, and log rotation
- Python for automation/glue scripting

**Sample interview questions:**

- What do the permission bits 755 and 644 mean, and how do you set them?
- How would you find which process is consuming the most memory or holding a port?
- Write a shell command/one-liner to find the top 10 largest files under a directory.
- How do you find all lines containing an error in a large log and count them per hour?
- A disk is at 100% but deleting files doesn't free space — what's happening and how do you fix it?
- What is the difference between a hard link and a soft link?
- How do you make a script fail fast and safe (error handling in bash)?
- How do you schedule a recurring job on Linux and where do you check its output?

### Networking & DNS for DevOps

`devops-cicd/networking-and-dns-for-devops` — freq: high · difficulty: intermediate

Networking fundamentals that underpin deployments, connectivity troubleshooting, and secure traffic routing in cloud and Kubernetes environments.

**Subtopics:**

- OSI/TCP-IP model, TCP vs UDP, common ports
- DNS resolution flow, record types (A/AAAA/CNAME/MX/TXT), TTL and caching
- HTTP/HTTPS, status codes, headers, and REST basics
- Load balancing: L4 vs L7, algorithms, health checks, sticky sessions
- TLS/SSL handshake, certificates, CAs, mutual TLS, and cert rotation
- Reverse proxies, forward proxies, API gateways (Nginx, Envoy, HAProxy)
- Firewalls, security groups, NACLs, and network segmentation
- CIDR, subnets, NAT, VPN, and private vs public networking
- Connectivity troubleshooting: ping, traceroute, dig, curl, telnet
- CDN basics and caching

**Sample interview questions:**

- Walk me through what happens when you type a URL in a browser and hit enter.
- What is the difference between a Layer 4 and a Layer 7 load balancer?
- Explain the TLS handshake and how certificates establish trust.
- What is the difference between an A record, a CNAME, and an alias record?
- A service can't reach another service — how do you troubleshoot the connectivity?
- What is the difference between a security group and a network ACL?
- How does DNS TTL affect failover and deployments?
- What is the difference between a forward proxy and a reverse proxy?

### DevSecOps & Pipeline Security

`devops-cicd/devsecops-and-pipeline-security` — freq: high · difficulty: advanced

Integrating security into the delivery pipeline: scanning, secrets management, least privilege, policy-as-code, and supply chain protection.

**Subtopics:**

- Shift-left security and the DevSecOps mindset
- SAST, DAST, IAST, and SCA (software composition analysis)
- Secrets management: HashiCorp Vault, cloud secret managers, dynamic secrets, rotation
- Avoiding hardcoded secrets; secret scanning in repos and history
- Least privilege, IAM, and short-lived credentials (OIDC federation)
- Container and image security: base image hardening, non-root, scanning, admission control
- Policy-as-code (OPA/Rego, Kyverno) and compliance-as-code
- Supply chain security: SLSA, signing, provenance, dependency pinning
- Securing the CI/CD system itself (runner isolation, poisoned pipeline execution, PR-based attacks)
- Compliance frameworks and audit trails (SOC2, PCI, CIS benchmarks)

**Sample interview questions:**

- What is the difference between SAST, DAST, and SCA, and where do they fit in the pipeline?
- How do you manage secrets across a fleet of services and pipelines?
- What are dynamic secrets and why are they preferable to static credentials?
- How would you prevent secrets from being committed to Git?
- How do you grant a pipeline access to a cloud account without long-lived keys?
- What is policy-as-code and how would you enforce that no public S3 buckets get created?
- How do you secure the CI/CD pipeline itself against supply-chain attacks?
- How would you harden a container image for production?

### Cloud Platforms & Managed Services

`devops-cicd/cloud-platforms-and-managed-services` — freq: high · difficulty: intermediate

Core cloud provider concepts (primarily AWS, with Azure/GCP parallels) that DevOps engineers use to build and run CI/CD and infrastructure.

**Subtopics:**

- Core compute: VMs/EC2, auto scaling groups, serverless (Lambda), containers (ECS/EKS/Fargate)
- Storage and databases: object storage (S3), block/file storage, managed DBs (RDS/DynamoDB)
- Networking: VPC, subnets, security groups, route tables, load balancers, Route 53
- IAM: users, roles, policies, least privilege, and cross-account access
- Managed CI/CD and IaC services (CodePipeline/CodeBuild, CloudFormation, Cloud Build)
- Regions, availability zones, and multi-AZ/multi-region design
- Managed Kubernetes (EKS/AKS/GKE) and serverless containers
- Cost management and FinOps (right-sizing, spot/reserved instances, tagging, budgets)
- Autoscaling and elasticity patterns
- Shared responsibility model and cloud security basics

**Sample interview questions:**

- Explain the difference between an EC2 instance, a container, and a serverless function — when do you pick each?
- How does IAM work and how do you apply least privilege for a service?
- How would you design a highly available architecture across availability zones?
- What is the difference between a security group and a route table in a VPC?
- How do you optimize cloud cost without hurting reliability?
- How do spot instances work and where would you safely use them?
- How would you build a CI/CD pipeline using only managed cloud services?
- Explain the cloud shared responsibility model.

### Testing Strategy in CI/CD

`devops-cicd/testing-strategy-in-cicd` — freq: high · difficulty: intermediate

How automated testing is structured and wired into pipelines to give fast, reliable feedback and gate releases.

**Subtopics:**

- Test pyramid: unit, integration, end-to-end proportions
- Contract testing and consumer-driven contracts for microservices
- Smoke tests, sanity tests, and post-deploy verification
- Performance, load, and stress testing (k6, JMeter, Gatling)
- Flaky test detection, quarantine, and retries
- Test environments, service virtualization, and test data management
- Code coverage, mutation testing, and quality gates (SonarQube)
- Shift-left testing and running tests in parallel for speed
- Static analysis and linting as pipeline gates
- Testing in production: synthetic monitoring and canary analysis

**Sample interview questions:**

- Explain the test pyramid and why the shape matters for CI/CD.
- What is contract testing and when would you use it in a microservices system?
- How do you handle flaky tests in a pipeline without ignoring real failures?
- How would you add performance/load testing to a delivery pipeline?
- What quality gates would you enforce before allowing a merge?
- How do you keep a large end-to-end test suite fast?
- What is smoke testing after deployment and how does it trigger rollback?
- How do you manage test data and environments for integration tests?

### DevOps System Design & Scenario Questions

`devops-cicd/devops-system-design-and-scenarios` — freq: medium · difficulty: advanced

Open-ended design rounds where you architect end-to-end delivery, infrastructure, and reliability solutions and defend tradeoffs.

**Subtopics:**

- Designing an end-to-end CI/CD pipeline for a microservices application
- Designing scalable, highly available, multi-region infrastructure
- Designing a zero-downtime deployment and rollback strategy
- Designing a centralized logging/monitoring/alerting platform
- Designing secrets management and access control at scale
- Designing a disaster recovery / backup strategy for given RPO/RTO
- Designing a self-service internal developer platform
- Migration scenarios: monolith to microservices, on-prem to cloud, VMs to containers
- Capacity planning and handling traffic spikes / autoscaling
- Tradeoff analysis: cost vs reliability vs speed vs complexity

**Sample interview questions:**

- Design a CI/CD pipeline for a company deploying 50 microservices to Kubernetes.
- Design a highly available, multi-region deployment for a critical web service.
- How would you design zero-downtime deployments with automated rollback for this system?
- Design a centralized observability platform for hundreds of services.
- How would you migrate a legacy monolith deployed on VMs to containers with minimal risk?
- Design a disaster recovery strategy for an RTO of 15 minutes and RPO of 5 minutes.
- How would you build a self-service platform so developers can deploy without ops involvement?
- You need to cut cloud spend by 30% — how do you approach it without hurting reliability?

<a id="spring-boot"></a>
## Spring Boot

Folder: `topics/spring-boot/` · 18 topics

### Spring Boot Fundamentals, Auto-Configuration & Starters

`spring-boot/fundamentals-autoconfiguration-starters` — freq: very-high · difficulty: beginner

Core value proposition of Spring Boot over plain Spring: how it bootstraps an app via auto-configuration, starters, and opinionated defaults.

**Subtopics:**

- Spring vs Spring Boot differences
- @SpringBootApplication and its three composed annotations
- @EnableAutoConfiguration mechanism and conditional beans
- spring.factories / AutoConfiguration.imports and how auto-config classes are discovered
- @Conditional family (@ConditionalOnClass, @ConditionalOnMissingBean, @ConditionalOnProperty)
- Starter dependencies (spring-boot-starter-web, -data-jpa, -security) and what they bundle
- spring-boot-starter-parent and dependency version management (BOM)
- SpringApplication.run() startup sequence and the SpringApplication object
- Spring Boot CLI and Spring Initializr
- Overriding / excluding auto-configuration
- Fat/uber JAR packaging and how it runs
- Writing a custom starter and custom auto-configuration
- Debugging auto-config with --debug and the ConditionEvaluationReport

**Sample interview questions:**

- What is the difference between Spring and Spring Boot, and what problems does Spring Boot solve?
- What does the @SpringBootApplication annotation do, and which annotations is it composed of?
- How does Spring Boot auto-configuration actually work under the hood?
- How would you exclude or override a specific auto-configuration class?
- What is a Spring Boot starter, and what does spring-boot-starter-web pull in?
- How do @ConditionalOnMissingBean and @ConditionalOnProperty influence which beans get created?
- What happens step by step when you call SpringApplication.run()?
- How does Spring Boot manage dependency versions without you specifying them?
- How would you create your own custom starter and auto-configuration?

### IoC Container & Dependency Injection

`spring-boot/ioc-dependency-injection` — freq: very-high · difficulty: beginner

Inversion of Control principle and how the Spring container wires collaborators together, plus the trade-offs of each injection style.

**Subtopics:**

- Inversion of Control concept and its benefits
- BeanFactory vs ApplicationContext
- Constructor vs setter vs field injection and why constructor injection is preferred
- @Autowired, @Qualifier, @Primary resolution rules
- Autowiring by type vs by name
- @Resource and @Inject vs @Autowired
- Resolving multiple candidate beans / NoUniqueBeanDefinitionException
- Handling optional dependencies (required=false, Optional, ObjectProvider)
- Circular dependency problem and how Spring resolves/breaks it
- @Value and injecting configuration values
- Component scanning and @ComponentScan base packages
- Injecting collections/maps of beans and ordering with @Order
- @DependsOn and bean initialization order

**Sample interview questions:**

- What is Inversion of Control and how does dependency injection implement it?
- What is the difference between constructor, setter, and field injection, and which do you prefer and why?
- How does Spring resolve a dependency when multiple beans of the same type exist?
- What is the difference between @Autowired, @Qualifier, and @Primary?
- What is the difference between BeanFactory and ApplicationContext?
- How does Spring handle circular dependencies, and when will it fail?
- What is the difference between @Autowired and @Resource?
- Why is field injection discouraged in production code?
- How would you inject all implementations of an interface as a list?

### Bean Scopes & Lifecycle

`spring-boot/bean-scopes-lifecycle` — freq: high · difficulty: intermediate

How long beans live, how many instances exist, and the callback hooks available during creation and destruction.

**Subtopics:**

- Singleton vs prototype scope semantics
- Web scopes: request, session, application, websocket
- Default scope and thread-safety implications of singletons
- Bean lifecycle phases from instantiation to destruction
- @PostConstruct and @PreDestroy callbacks
- InitializingBean / DisposableBean interfaces
- @Bean initMethod and destroyMethod attributes
- BeanPostProcessor and BeanFactoryPostProcessor
- Aware interfaces (ApplicationContextAware, BeanNameAware)
- Injecting a prototype bean into a singleton (scoped proxy, ObjectFactory, @Lookup)
- Lazy initialization with @Lazy
- Order of lifecycle callbacks when multiple mechanisms are combined

**Sample interview questions:**

- What are the different bean scopes in Spring, and when would you use prototype over singleton?
- Are Spring singleton beans thread-safe? How do you handle shared mutable state?
- Walk me through the complete lifecycle of a Spring bean.
- What is the difference between @PostConstruct/@PreDestroy and InitializingBean/DisposableBean?
- What happens when you inject a prototype-scoped bean into a singleton bean, and how do you get a fresh instance each time?
- What is a BeanPostProcessor and when would you write one?
- What is the difference between request scope and session scope?
- How does @Lazy change bean creation, and why would you use it?

### Core Annotations & Stereotypes

`spring-boot/core-annotations-stereotypes` — freq: very-high · difficulty: beginner

The annotation vocabulary interviewers expect you to distinguish precisely, especially overlapping stereotypes and configuration annotations.

**Subtopics:**

- @Component vs @Service vs @Repository vs @Controller semantics
- @RestController vs @Controller
- @Configuration vs @Component and CGLIB proxying of @Bean methods
- @Bean vs @Component for bean registration
- @Configuration proxyBeanMethods and inter-bean method calls
- @ComponentScan, @Import, @ImportResource
- @Repository and persistence exception translation
- Meta-annotations and composed annotations
- @Profile on beans and configuration
- @ConfigurationProperties vs @Value
- Stereotype annotations and how component scanning detects them

**Sample interview questions:**

- What is the difference between @Component, @Service, and @Repository if they all just register a bean?
- What is the difference between @Controller and @RestController?
- When would you use @Bean versus @Component to register a bean?
- What is special about @Configuration classes, and why are they proxied by CGLIB?
- What does proxyBeanMethods=false do on @Configuration?
- What extra behavior does @Repository add beyond marking a bean?
- What is the difference between @ConfigurationProperties and @Value for binding configuration?
- How does @Import differ from @ComponentScan?

### Configuration, Profiles & Externalized Properties

`spring-boot/configuration-profiles-properties` — freq: high · difficulty: beginner

Managing environment-specific configuration through application.properties/yml, profiles, and type-safe binding.

**Subtopics:**

- application.properties vs application.yml differences
- Property source order and precedence (12-factor externalized config)
- Spring profiles and profile-specific files (application-dev.yml)
- Activating profiles (spring.profiles.active, env vars, CLI args)
- @Profile and @ActiveProfiles for tests
- @ConfigurationProperties binding and relaxed binding rules
- @Value with SpEL and default values
- Environment and PropertySource abstraction
- Overriding properties via command line and environment variables
- Secrets and sensitive property handling
- Configuration validation with @Validated on @ConfigurationProperties
- @ConfigurationPropertiesScan and constructor binding (@ConstructorBinding)
- Config groups/profile groups and importing external config (spring.config.import)

**Sample interview questions:**

- How does Spring Boot decide which property value wins when the same key is defined in multiple places?
- What are Spring profiles and how do you activate a specific profile?
- What is the difference between @Value and @ConfigurationProperties, and when do you prefer each?
- How would you configure different database settings for dev, test, and prod?
- What is the difference between application.properties and application.yml?
- How can you override a property defined in application.yml at deployment time without rebuilding?
- How do you validate configuration properties at startup?
- What is relaxed binding in @ConfigurationProperties?

### Spring MVC & REST APIs

`spring-boot/spring-mvc-rest-apis` — freq: very-high · difficulty: intermediate

Building HTTP endpoints: request routing, the DispatcherServlet flow, mapping annotations, and content negotiation.

**Subtopics:**

- DispatcherServlet and the front-controller request flow
- @RequestMapping and shortcut annotations (@GetMapping, @PostMapping, etc.)
- @PathVariable vs @RequestParam vs @RequestBody vs @RequestHeader
- @ResponseBody and message converters (Jackson JSON serialization)
- ResponseEntity and setting status codes/headers
- Content negotiation and produces/consumes
- HandlerMapping, HandlerAdapter, ViewResolver
- REST maturity, idempotency, and correct HTTP verb/status usage
- HttpMessageConverter customization
- CORS configuration
- RestTemplate vs WebClient for outbound calls
- API versioning strategies
- Jackson customization (@JsonIgnore, @JsonProperty, custom serializers, date/time handling)
- File upload/download (MultipartFile) and streaming responses

**Sample interview questions:**

- Explain the flow of an HTTP request through Spring MVC starting from the DispatcherServlet.
- What is the difference between @PathVariable, @RequestParam, and @RequestBody?
- What is the difference between @Controller and @RestController, and where does @ResponseBody fit in?
- How do you return a custom HTTP status code and headers from a controller?
- How does Spring convert a Java object to JSON in the response?
- What is the difference between RestTemplate and WebClient?
- How would you handle CORS in a Spring Boot REST API?
- Which HTTP methods and status codes would you use to design a RESTful resource, and why?
- How do you handle file uploads in a Spring Boot controller?

### Exception Handling & Validation

`spring-boot/exception-handling-validation` — freq: high · difficulty: intermediate

Turning errors into clean, consistent API responses and validating incoming request data.

**Subtopics:**

- @ExceptionHandler at controller level
- @ControllerAdvice / @RestControllerAdvice for global handling
- ResponseEntityExceptionHandler for framework exceptions
- @ResponseStatus on custom exceptions
- Designing a consistent error response body / ProblemDetail (RFC 7807)
- Bean Validation with @Valid / @Validated and JSR-380 annotations
- MethodArgumentNotValidException and binding errors
- Handling validation on path variables and request params (@Validated on class)
- Default Spring Boot error handling and the /error endpoint (BasicErrorController)
- Custom exceptions vs framework exceptions
- Difference between @ControllerAdvice and @RestControllerAdvice
- Custom and cross-field validators (ConstraintValidator, group validation)
- Validation cascading with @Valid on nested objects

**Sample interview questions:**

- How do you implement global exception handling in a Spring Boot REST API?
- What is the difference between @ExceptionHandler, @ControllerAdvice, and @RestControllerAdvice?
- How does @ControllerAdvice work and how are the right handler methods selected?
- How do you validate a request body and return meaningful field-level error messages?
- What is the difference between @Valid and @Validated?
- How does Spring Boot's default error response work and how do you customize it?
- How would you design a consistent error response format across all endpoints?
- What does @ResponseStatus do on a custom exception class?
- How would you write a custom validation annotation and validator?

### Spring Data JPA & Persistence

`spring-boot/spring-data-jpa-persistence` — freq: very-high · difficulty: intermediate

Data access with repositories, JPA entity mapping, query derivation, and common performance pitfalls.

**Subtopics:**

- Repository hierarchy: CrudRepository, JpaRepository, PagingAndSortingRepository
- Derived query methods (findByX) naming conventions
- @Query with JPQL and native queries, @Param
- Entity mappings: @Entity, @Id, @GeneratedValue, relationships (@OneToMany, @ManyToOne, @ManyToMany)
- FetchType LAZY vs EAGER and the N+1 select problem
- JOIN FETCH and @EntityGraph to fix N+1
- Pagination and sorting (Pageable, Page vs Slice)
- JPA vs Hibernate vs Spring Data JPA distinctions
- Persistence context, entity states, and dirty checking
- Optimistic vs pessimistic locking (@Version)
- save vs saveAndFlush, and cascade types
- DTO projections vs entity exposure
- @Modifying queries and bulk updates
- Auditing (@CreatedDate, @LastModifiedDate, @EnableJpaAuditing)
- Database migrations with Flyway / Liquibase
- spring.jpa.hibernate.ddl-auto and open-session-in-view pitfalls

**Sample interview questions:**

- What is the difference between JPA, Hibernate, and Spring Data JPA?
- What is the difference between CrudRepository and JpaRepository?
- How do derived query methods like findByLastNameAndStatus work?
- What is the N+1 select problem and how do you solve it?
- What is the difference between FetchType.LAZY and FetchType.EAGER?
- How do you write a custom query, and when would you use a native query over JPQL?
- How do you implement pagination and sorting with Spring Data JPA?
- What is optimistic locking and how does @Version work?
- What does open-session-in-view do and why is it controversial?
- How would you manage schema changes across environments (Flyway/Liquibase)?

### Transaction Management

`spring-boot/transaction-management` — freq: very-high · difficulty: advanced

Declarative transactions with @Transactional, including propagation, isolation, and the proxy pitfalls that trip candidates up.

**Subtopics:**

- @Transactional declarative transaction management
- Propagation levels (REQUIRED, REQUIRES_NEW, NESTED, SUPPORTS, etc.)
- Isolation levels and the anomalies they prevent (dirty/non-repeatable/phantom reads)
- Default rollback behavior (unchecked vs checked exceptions) and rollbackFor/noRollbackFor
- Self-invocation problem: why @Transactional on internal method calls doesn't work
- readOnly optimization
- Programmatic transactions with TransactionTemplate
- Transaction proxy mechanism (AOP) and why methods must be public
- Transaction boundaries and lazy loading (LazyInitializationException)
- Distributed transactions overview
- @Transactional at class vs method level
- Transaction synchronization callbacks (TransactionSynchronization, @TransactionalEventListener)

**Sample interview questions:**

- How does @Transactional work under the hood?
- Why doesn't @Transactional work when you call an annotated method from another method in the same class?
- What are the transaction propagation levels, and what is the difference between REQUIRED and REQUIRES_NEW?
- By default, does Spring roll back on checked exceptions? How do you change that?
- What are transaction isolation levels and which read anomalies do they prevent?
- Why must a @Transactional method be public?
- What does readOnly=true do on @Transactional?
- How can @Transactional lead to a LazyInitializationException?
- How would you run a piece of code only after the transaction commits?

### AOP, Filters & Interceptors

`spring-boot/aop-filters-interceptors` — freq: high · difficulty: advanced

Cross-cutting concerns via Spring AOP proxies, and where servlet filters vs Spring interceptors sit in the request pipeline.

**Subtopics:**

- AOP concepts: aspect, advice, pointcut, join point, weaving
- Advice types (@Before, @After, @Around, @AfterReturning, @AfterThrowing)
- @Aspect and @EnableAspectJAutoProxy
- JDK dynamic proxy vs CGLIB proxying
- Common AOP use cases (logging, metrics, security, transactions)
- Servlet Filter interface and FilterChain
- HandlerInterceptor (preHandle, postHandle, afterCompletion)
- Filters vs Interceptors: ordering, scope, and access to handler/model
- Registering filters (FilterRegistrationBean, @WebFilter) and ordering
- OncePerRequestFilter
- Limitations of Spring AOP (proxy-based, self-invocation)
- Pointcut expression language (execution, within, @annotation)

**Sample interview questions:**

- What is AOP and what are join points, pointcuts, advice, and aspects?
- What is the difference between a Filter and a HandlerInterceptor, and when would you use each?
- What are the different types of advice in Spring AOP?
- When does Spring use a JDK dynamic proxy versus a CGLIB proxy?
- What is the difference between @Around advice and @Before/@After advice?
- How would you implement request/response logging for all endpoints?
- What are the limitations of Spring AOP compared to full AspectJ?
- In what order do a Filter, an Interceptor's preHandle, and a controller method execute?

### Spring Security Basics

`spring-boot/spring-security-basics` — freq: high · difficulty: advanced

Authentication and authorization fundamentals: the filter chain, securing endpoints, and stateless JWT-based APIs.

**Subtopics:**

- Authentication vs authorization distinction
- Spring Security filter chain and SecurityFilterChain configuration
- SecurityContext, SecurityContextHolder, Authentication, Principal
- UserDetailsService and UserDetails
- PasswordEncoder (BCrypt) and why you never store plaintext
- Method-level security (@PreAuthorize, @Secured, @RolesAllowed)
- Roles vs authorities
- Form login vs HTTP Basic vs token-based auth
- Stateless authentication with JWT and where the validation filter sits
- CSRF protection and when to disable it (stateless APIs)
- OAuth2 / OIDC resource server basics
- CORS interaction with security
- AuthenticationManager / AuthenticationProvider flow
- Lambda DSL SecurityFilterChain config (post WebSecurityConfigurerAdapter deprecation)

**Sample interview questions:**

- What is the difference between authentication and authorization in Spring Security?
- How does the Spring Security filter chain process a request?
- How does JWT-based stateless authentication work in Spring Boot?
- What is the role of UserDetailsService and PasswordEncoder?
- How do you secure individual methods, and what is the difference between @PreAuthorize and @Secured?
- What is CSRF and why is it typically disabled for stateless REST APIs?
- What is the difference between a role and an authority?
- How would you restrict an endpoint to users with the ADMIN role?
- How do you configure security now that WebSecurityConfigurerAdapter is deprecated?

### Actuator, Monitoring & Embedded Servers

`spring-boot/actuator-monitoring-embedded-servers` — freq: high · difficulty: intermediate

Production-readiness features: operational endpoints, health/metrics, and the embedded servlet container model.

**Subtopics:**

- Spring Boot Actuator and built-in endpoints (/health, /info, /metrics, /env, /beans)
- Enabling/exposing endpoints and securing them
- Health indicators and custom health checks
- Metrics with Micrometer and integration with Prometheus/Grafana
- Liveness and readiness probes for Kubernetes
- Custom actuator endpoints (@Endpoint)
- Embedded servers: Tomcat vs Jetty vs Undertow and switching between them
- How the embedded server starts and packaging as an executable JAR
- Configuring server port, context path, and connection settings
- Deploying as a WAR to an external container vs embedded JAR
- Graceful shutdown
- Logging configuration and log levels
- Distributed tracing (Micrometer Tracing / correlation IDs)

**Sample interview questions:**

- What is Spring Boot Actuator and which endpoints have you used in production?
- How do you expose and secure actuator endpoints?
- How would you add a custom health check or custom metric?
- How does the embedded server work, and how would you switch from Tomcat to Jetty or Undertow?
- What is the difference between liveness and readiness probes, and how does Actuator support them?
- How do you package a Spring Boot app, and how does it run without an external server?
- How do you change the embedded server port and context path?
- How would you deploy a Spring Boot application as a WAR to an external Tomcat?

### Testing Spring Boot Applications

`spring-boot/testing-spring-boot-applications` — freq: very-high · difficulty: intermediate

Unit, slice, and integration testing strategies unique to Spring Boot, from mocking collaborators to spinning up sliced or full application contexts.

**Subtopics:**

- Unit tests vs integration tests and the test pyramid in Spring
- JUnit 5 and Mockito basics (@Mock, @InjectMocks, when/verify)
- @SpringBootTest and loading the full ApplicationContext (webEnvironment options)
- Slice tests: @WebMvcTest, @DataJpaTest, @JsonTest, @RestClientTest
- MockMvc for controller-layer testing
- @MockBean and @SpyBean vs plain Mockito mocks
- TestRestTemplate and WebTestClient for full-stack HTTP tests
- Test slices and how they limit auto-configuration for speed
- @DataJpaTest with in-memory (H2) vs Testcontainers
- Testcontainers for realistic DB/broker integration tests
- @ActiveProfiles, @TestPropertySource, and test configuration overrides
- @Transactional rollback in tests and test data setup (@Sql)
- ApplicationContext caching between tests and @DirtiesContext

**Sample interview questions:**

- What is the difference between @SpringBootTest and slice annotations like @WebMvcTest or @DataJpaTest?
- What is the difference between @MockBean and a plain Mockito @Mock?
- How do you test a REST controller without starting a full server?
- How would you write an integration test that hits a real database?
- What does @DataJpaTest configure, and does it roll back by default?
- When would you use TestRestTemplate versus MockMvc versus WebTestClient?
- How does Spring cache the ApplicationContext across tests, and when does @DirtiesContext matter?
- How do Testcontainers improve integration test fidelity over H2?

### Asynchronous Processing, Scheduling & Application Events

`spring-boot/async-scheduling-events` — freq: high · difficulty: intermediate

Running work off the request thread and decoupling components in-process: @Async, scheduled tasks, and the Spring application event system.

**Subtopics:**

- @Async and @EnableAsync for non-blocking method execution
- Return types for async methods (void, Future, CompletableFuture)
- Configuring a TaskExecutor / thread pool for @Async
- Self-invocation limitation of @Async (proxy-based, like @Transactional)
- @Scheduled with fixedRate, fixedDelay, and cron expressions
- @EnableScheduling and thread pool sizing for scheduled tasks
- Application events: ApplicationEventPublisher and @EventListener
- @TransactionalEventListener and event phases
- Synchronous vs asynchronous event listeners
- Custom application events vs built-in context events
- Exception handling in async methods (AsyncUncaughtExceptionHandler)
- Distributed scheduling concerns (ShedLock, avoiding duplicate runs across instances)

**Sample interview questions:**

- How does @Async work, and what are its limitations?
- Why does calling an @Async method from within the same class not run asynchronously?
- What is the difference between fixedRate and fixedDelay in @Scheduled?
- How do you configure the thread pool used by @Async or @Scheduled tasks?
- How does the Spring application event mechanism work, and when would you use it?
- What is @TransactionalEventListener and how does it differ from @EventListener?
- How do you handle exceptions thrown from an @Async method?
- How would you prevent a @Scheduled job from running on every instance in a multi-node deployment?

### Caching Abstraction

`spring-boot/caching-abstraction` — freq: medium · difficulty: intermediate

Spring's declarative caching abstraction for improving performance, its annotations, and integration with providers like Redis and Caffeine.

**Subtopics:**

- @EnableCaching and the caching abstraction model
- @Cacheable, @CachePut, and @CacheEvict semantics and differences
- Cache key generation and custom KeyGenerator / SpEL keys
- Conditional caching (condition, unless attributes)
- CacheManager and cache providers (Caffeine, Redis, EhCache, ConcurrentMapCacheManager)
- Local vs distributed caching trade-offs
- TTL / eviction and expiry configuration per provider
- Cache stampede / thundering herd and sync=true
- Self-invocation limitation (proxy-based caching)
- Cache consistency and invalidation strategies
- Serialization concerns with distributed caches (Redis)

**Sample interview questions:**

- How does Spring's caching abstraction work, and how do you enable it?
- What is the difference between @Cacheable, @CachePut, and @CacheEvict?
- How are cache keys generated by default, and how do you customize them?
- How would you plug in Redis or Caffeine as the cache provider?
- What is the difference between local and distributed caching, and when would you choose each?
- How do you set a TTL or eviction policy for a cache?
- Why might @Cacheable not work when the method is called from the same class?
- How do you handle cache invalidation and consistency in a distributed system?

### Reactive Programming with Spring WebFlux

`spring-boot/reactive-webflux` — freq: medium · difficulty: advanced

The reactive, non-blocking stack: Reactor types, WebFlux vs MVC, and when a reactive approach pays off.

**Subtopics:**

- Blocking (servlet) vs non-blocking (reactive) models and thread-per-request vs event loop
- Project Reactor: Mono and Flux
- Spring WebFlux vs Spring MVC differences and shared annotations
- Functional endpoints (RouterFunction / HandlerFunction) vs annotated controllers
- WebClient as the reactive HTTP client
- Backpressure and how Reactor handles it
- R2DBC for reactive data access vs blocking JDBC/JPA
- Schedulers and avoiding blocking calls on event-loop threads
- When to choose WebFlux over MVC (and when not to)
- Netty as the default reactive server
- Operators (map, flatMap, zip) and error handling (onErrorResume)

**Sample interview questions:**

- What is the difference between Spring MVC and Spring WebFlux?
- What are Mono and Flux, and how do they differ?
- When would you choose a reactive stack over the traditional servlet stack, and what are the trade-offs?
- What is backpressure and how does Reactor handle it?
- Why is it dangerous to make a blocking call inside a reactive pipeline, and how do you avoid it?
- What is R2DBC and why can't you just use JPA in a reactive application?
- What is the difference between map and flatMap in Reactor?
- How does WebClient differ from RestTemplate in a reactive application?

### Microservices, Spring Cloud & Resilience

`spring-boot/microservices-spring-cloud-resilience` — freq: high · difficulty: advanced

Building distributed systems with Spring Boot: service discovery, centralized config, API gateways, and resilience patterns.

**Subtopics:**

- Monolith vs microservices trade-offs with Spring Boot
- Service discovery (Eureka / Consul) and client-side load balancing (Spring Cloud LoadBalancer)
- Centralized configuration with Spring Cloud Config Server and refresh (@RefreshScope)
- API Gateway (Spring Cloud Gateway) and routing/filtering
- Declarative REST clients with OpenFeign
- Resilience patterns: circuit breaker, retry, rate limiter, bulkhead (Resilience4j)
- Fallbacks and graceful degradation
- Distributed tracing and correlation across services (Micrometer Tracing / Zipkin)
- Inter-service communication (sync REST vs async messaging)
- Timeouts, idempotency, and distributed transaction alternatives (saga pattern)
- Config precedence and secrets management in distributed config

**Sample interview questions:**

- How do services discover each other in a Spring Cloud microservices setup?
- What is a circuit breaker, and how would you implement one with Resilience4j?
- What problem does Spring Cloud Config Server solve, and how does config refresh work?
- What is the role of an API gateway, and what does Spring Cloud Gateway provide?
- How does OpenFeign simplify inter-service calls compared to RestTemplate/WebClient?
- How do you trace a request as it flows across multiple microservices?
- How do you handle distributed transactions across microservices?
- What resilience patterns would you apply to protect against a slow downstream dependency?

### Messaging & Event-Driven Integration

`spring-boot/messaging-event-driven-integration` — freq: medium · difficulty: advanced

Integrating Spring Boot with external message brokers for asynchronous, decoupled communication between services.

**Subtopics:**

- Why asynchronous messaging: decoupling, buffering, and scalability
- Spring for Apache Kafka (KafkaTemplate, @KafkaListener, consumer groups)
- Spring AMQP / RabbitMQ (RabbitTemplate, @RabbitListener, exchanges/queues/bindings)
- JMS with Spring (JmsTemplate, @JmsListener)
- At-least-once vs exactly-once and idempotent consumers
- Offset/acknowledgement management and manual acks
- Error handling, retries, and dead-letter queues
- Serialization/deserialization of message payloads
- Ordering, partitioning, and consumer group scaling (Kafka)
- Transactional messaging and the outbox pattern
- Spring Cloud Stream as a broker-agnostic abstraction

**Sample interview questions:**

- When would you use asynchronous messaging instead of synchronous REST calls between services?
- How do you consume messages from Kafka in Spring Boot, and how do consumer groups work?
- What is the difference between Kafka and RabbitMQ, and how does Spring integrate with each?
- How do you guarantee a message is processed at least once, and how do you make the consumer idempotent?
- How do you handle a poison message or repeated processing failures?
- What is a dead-letter queue and how would you configure one?
- How do you ensure a database write and a message publish happen atomically (outbox pattern)?
- What does Spring Cloud Stream give you over using the Kafka/RabbitMQ clients directly?

<a id="spring-core"></a>
## Spring Framework Core

Folder: `topics/spring-core/` · 19 topics

### IoC Container: ApplicationContext vs BeanFactory

`spring-core/ioc-container-applicationcontext-vs-beanfactory` — freq: very-high · difficulty: beginner

The Inversion of Control container that creates, wires, and manages Spring beans, and the two core container interfaces.

**Subtopics:**

- Inversion of Control (IoC) principle and its relationship to Dependency Injection
- BeanFactory interface and lazy (on-demand) bean instantiation
- ApplicationContext as a superset of BeanFactory
- Eager vs lazy initialization of singletons
- ApplicationContext extra features: i18n/MessageSource, event publishing, BeanPostProcessor/BeanFactoryPostProcessor auto-detection, AOP integration
- Common ApplicationContext implementations (AnnotationConfigApplicationContext, ClassPathXmlApplicationContext, WebApplicationContext)
- The Spring container as the central abstraction
- Container refresh() lifecycle and startup sequence
- How the container reads bean definitions and builds the BeanDefinition registry

**Sample interview questions:**

- What is Inversion of Control and how does Spring implement it?
- What is the difference between BeanFactory and ApplicationContext, and which should you use?
- Why does ApplicationContext eagerly instantiate singleton beans while BeanFactory instantiates lazily?
- What extra features does ApplicationContext provide over BeanFactory?
- How does the Spring IoC container know which classes to manage as beans?
- Name the common implementations of ApplicationContext and when you'd use each.
- What happens during ApplicationContext refresh()?

### Dependency Injection Types

`spring-core/dependency-injection-types` — freq: very-high · difficulty: beginner

The mechanisms Spring uses to supply a bean's collaborators: constructor, setter, and field injection.

**Subtopics:**

- Constructor injection vs setter injection vs field injection
- Why constructor injection is recommended (immutability, mandatory dependencies, testability, final fields)
- Drawbacks of field injection (hidden dependencies, hard to unit test, no immutability)
- Handling optional dependencies with setter injection and @Autowired(required=false)/Optional
- Injecting collections, maps, and arrays of beans
- DI vs Service Locator pattern
- How constructor injection resolves circular dependencies (it can't) vs setter injection
- Implicit constructor injection without @Autowired (single-constructor rule since Spring 4.3)

**Sample interview questions:**

- What are the different types of dependency injection in Spring and which is preferred?
- Why is constructor injection recommended over field injection?
- How would you inject an optional dependency?
- How do you inject a List or Map of all beans of a given type?
- What problems does field injection cause for unit testing?
- Can you make an injected dependency final, and with which injection type?
- Do you still need @Autowired on a constructor if the class has only one constructor?

### Bean Definition and Stereotype Annotations

`spring-core/bean-definition-stereotype-annotations` — freq: very-high · difficulty: beginner

How beans are declared and configured, including component scanning, stereotype annotations, and @Bean vs @Component.

**Subtopics:**

- @Component, @Service, @Repository, @Controller/@RestController and their semantic differences
- @Repository and automatic persistence exception translation
- @Configuration classes and @Bean factory methods
- @Component/component-scanning vs @Bean explicit declaration (and when to use each)
- @ComponentScan and how classpath scanning discovers beans
- XML config vs annotation config vs Java config
- Bean naming conventions and custom bean names
- proxyBeanMethods and @Configuration(full) vs @Configuration(lite) / @Component
- Meta-annotations and composed annotations (how stereotypes are built on @Component)

**Sample interview questions:**

- What is the difference between @Component, @Service, and @Repository?
- When would you use @Bean instead of @Component?
- What does @Repository do beyond marking a class as a bean?
- How does component scanning work and how do you configure it?
- What is the difference between @Configuration and @Component for defining beans?
- Why does @Configuration use CGLIB proxying by default, and what does proxyBeanMethods=false change?
- Are the stereotype annotations functionally different or only semantically different?

### Bean Scopes

`spring-core/bean-scopes` — freq: high · difficulty: intermediate

The lifecycle and visibility of bean instances managed by the container, from singleton to web-aware scopes.

**Subtopics:**

- Singleton scope (default) and its meaning (one per container, not per JVM)
- Prototype scope and why the container doesn't manage its full lifecycle
- Web scopes: request, session, application, websocket
- Injecting a prototype bean into a singleton (the scoped-bean injection problem)
- Solutions: @Lookup method injection, ObjectFactory/Provider, scoped proxies (proxyMode)
- Thread safety concerns with singleton beans
- Custom scopes
- Difference between GoF singleton pattern and Spring singleton scope

**Sample interview questions:**

- What are the bean scopes available in Spring?
- What is the default scope of a Spring bean, and does singleton mean one instance per JVM?
- What happens when you inject a prototype-scoped bean into a singleton bean, and how do you fix it?
- Are singleton beans thread-safe?
- Why doesn't Spring manage the full lifecycle of a prototype bean (e.g. destroy callbacks)?
- How does a scoped proxy work for request/session scoped beans?
- How is the Spring singleton scope different from the classic singleton design pattern?

### Bean Lifecycle and Lifecycle Callbacks

`spring-core/bean-lifecycle-callbacks` — freq: very-high · difficulty: intermediate

The full sequence a bean goes through from instantiation to destruction, and the hooks available at each stage.

**Subtopics:**

- Lifecycle phases: instantiation, populate properties, Aware callbacks, BeanPostProcessor before-init, init, BeanPostProcessor after-init, ready, destroy
- Initialization hooks: @PostConstruct, InitializingBean.afterPropertiesSet(), @Bean(initMethod)
- Destruction hooks: @PreDestroy, DisposableBean.destroy(), @Bean(destroyMethod)
- Order of the three initialization mechanisms
- *Aware interfaces (BeanNameAware, ApplicationContextAware, BeanFactoryAware)
- BeanPostProcessor vs BeanFactoryPostProcessor (bean instances vs bean definitions)
- How AOP proxies are created via BeanPostProcessor
- @DependsOn to force initialization order between beans
- SmartLifecycle / Lifecycle and phased startup/shutdown

**Sample interview questions:**

- Walk me through the complete lifecycle of a Spring bean.
- What is the order of @PostConstruct, InitializingBean.afterPropertiesSet(), and the init-method?
- What is the difference between BeanPostProcessor and BeanFactoryPostProcessor?
- How would you run code after a bean is fully initialized?
- What are the *Aware interfaces used for?
- At what point in the lifecycle does Spring create AOP proxies for a bean?
- How do you control the initialization order of two beans that don't directly depend on each other?

### @Autowired, @Qualifier, and Autowiring Resolution

`spring-core/autowired-qualifier-autowiring-resolution` — freq: very-high · difficulty: intermediate

How Spring resolves which bean to inject when multiple candidates exist, and the annotations that control it.

**Subtopics:**

- How @Autowired resolves by type then by name
- NoUniqueBeanDefinitionException and resolving ambiguity
- @Qualifier and custom qualifier annotations
- @Primary as a default candidate
- required=false and Optional/@Nullable dependencies
- @Resource (byName) vs @Inject (JSR-330) vs @Autowired (byType) differences
- @Value for injecting properties and SpEL expressions
- Ordering injected collections with @Order / @Priority
- ObjectProvider/ObjectFactory for lazy and optional resolution
- NoSuchBeanDefinitionException when no candidate exists

**Sample interview questions:**

- How does @Autowired resolve a dependency when there are multiple beans of the same type?
- What is the difference between @Qualifier and @Primary, and which wins if both are present?
- What is the difference between @Autowired, @Resource, and @Inject?
- What exception does Spring throw for ambiguous autowiring and how do you resolve it?
- How does @Value work and can it evaluate SpEL?
- How do you make an @Autowired dependency optional?
- What is ObjectProvider and when would you use it over @Autowired?

### Circular Dependencies

`spring-core/circular-dependencies` — freq: high · difficulty: advanced

What causes bean dependency cycles, how Spring handles them, and how to fix or avoid them.

**Subtopics:**

- How circular dependencies arise (A needs B, B needs A)
- Why constructor injection cycles cannot be resolved (BeanCurrentlyInCreationException)
- How Spring resolves setter/field injection cycles via the three-level cache (early bean reference / early singleton exposure)
- Spring Boot 2.6+ disabling circular references by default
- Fixes: @Lazy, redesign/refactor, setter injection, ObjectProvider, @PostConstruct wiring
- Why circular dependencies are usually a design smell
- Self-injection scenarios
- Why AOP-proxied beans complicate the three-level cache (early proxy exposure)

**Sample interview questions:**

- What is a circular dependency in Spring and how does the container handle it?
- Why can Spring resolve a circular dependency with setter injection but not with constructor injection?
- Explain Spring's three-level cache for resolving circular dependencies.
- What exception is thrown for an unresolvable circular dependency?
- How would you break a circular dependency between two beans?
- How does @Lazy help resolve a circular dependency?
- Why is the third level of the singleton cache needed when AOP proxies are involved?

### Spring AOP and Proxies

`spring-core/spring-aop-and-proxies` — freq: high · difficulty: advanced

Aspect-Oriented Programming for cross-cutting concerns and the proxy mechanism that powers it.

**Subtopics:**

- AOP core concepts: aspect, join point, pointcut, advice, weaving, target, introduction
- Advice types: @Before, @After, @AfterReturning, @AfterThrowing, @Around
- JDK dynamic proxies vs CGLIB proxies (interface-based vs subclass-based)
- Proxy-based limitations: self-invocation not intercepted, final methods/classes can't be proxied
- Why @Transactional and @Cacheable can silently fail on internal method calls
- Spring AOP (runtime proxy, method-level) vs AspectJ (compile/load-time weaving, full)
- Pointcut expression language
- Common real-world uses: transactions, security, logging, caching
- ProceedingJoinPoint and modifying arguments/return values in @Around
- Ordering multiple aspects with @Order

**Sample interview questions:**

- Explain the core AOP concepts: aspect, advice, pointcut, and join point.
- What is the difference between JDK dynamic proxies and CGLIB proxies, and when does Spring use each?
- Why does calling a @Transactional method from another method in the same class bypass the transaction?
- What are the types of advice and how does @Around differ from @Before/@After?
- What is the difference between Spring AOP and AspectJ?
- What are the limitations of Spring's proxy-based AOP?
- How do you control the execution order when multiple aspects apply to the same join point?

### Configuration, Profiles, and Externalized Properties

`spring-core/configuration-profiles-properties` — freq: medium · difficulty: intermediate

How Spring is configured across environments using profiles, property sources, and conditional beans.

**Subtopics:**

- @Configuration and @Bean method configuration
- @Profile for environment-specific beans
- Environment abstraction and PropertySources
- @PropertySource and @Value property injection
- @ConfigurationProperties type-safe binding (Spring Boot)
- @Conditional and conditional bean registration
- @Import and modularizing configuration
- Property precedence and overriding
- Relaxed binding and validation of @ConfigurationProperties
- Default profile and multiple active profiles

**Sample interview questions:**

- How do you define environment-specific beans in Spring?
- How does @Profile work and how do you activate a profile?
- What is the difference between @Value and @ConfigurationProperties?
- How does Spring's Environment abstraction and PropertySource ordering work?
- How would you conditionally register a bean only when a certain class or property is present?
- How do you import one configuration class into another?
- What is the order of precedence for property sources in Spring Boot?

### Spring vs Spring Boot

`spring-core/spring-vs-spring-boot` — freq: very-high · difficulty: intermediate

How Spring Boot builds on the core Spring Framework to reduce configuration and speed up development.

**Subtopics:**

- Spring Framework (core, DI, AOP) vs Spring Boot (opinionated convention over configuration)
- Auto-configuration and how @EnableAutoConfiguration works
- Starter dependencies (spring-boot-starter-*)
- @SpringBootApplication as a composition of @Configuration + @EnableAutoConfiguration + @ComponentScan
- Embedded servers (Tomcat/Jetty/Undertow) vs deploying a WAR
- Externalized configuration, application.properties/yaml, and Actuator
- How auto-configuration is conditional (@ConditionalOnClass, @ConditionalOnMissingBean)
- Boilerplate reduction and when you'd still use plain Spring
- spring.factories / AutoConfiguration.imports registration of auto-config classes
- How to debug auto-configuration (--debug / conditions report)

**Sample interview questions:**

- What is the difference between Spring Framework and Spring Boot?
- What is auto-configuration in Spring Boot and how does it work under the hood?
- What does the @SpringBootApplication annotation combine?
- What are Spring Boot starters and why are they useful?
- How can you override or disable a specific auto-configuration?
- What advantages does an embedded server give over a traditional WAR deployment?
- How would you find out why a particular auto-configuration did or didn't apply?

### Transaction Management and Events

`spring-core/transaction-management-events` — freq: high · difficulty: advanced

Declarative transaction handling via @Transactional and the ApplicationContext event mechanism.

**Subtopics:**

- Declarative (@Transactional) vs programmatic transaction management (TransactionTemplate/PlatformTransactionManager)
- Propagation types (REQUIRED, REQUIRES_NEW, NESTED, SUPPORTS, MANDATORY, NEVER, NOT_SUPPORTED)
- Isolation levels and their tradeoffs (dirty/non-repeatable/phantom reads)
- Rollback rules (rollback on RuntimeException/Error by default, not checked exceptions)
- How @Transactional relies on AOP proxies (and self-invocation pitfall)
- ApplicationEventPublisher, custom events, and @EventListener
- Synchronous vs @Async/@TransactionalEventListener event handling
- readOnly, timeout, and transaction manager configuration
- Why @Transactional on private/final methods doesn't work
- TransactionSynchronizationManager and transaction-bound resources

**Sample interview questions:**

- How does @Transactional work internally?
- What are transaction propagation levels and when would you use REQUIRES_NEW vs NESTED?
- Why doesn't @Transactional roll back on a checked exception by default, and how do you change that?
- Why does @Transactional not work when calling the method from within the same class?
- How does Spring's event mechanism (ApplicationEvent / @EventListener) work?
- What is the difference between a synchronous listener and a @TransactionalEventListener?
- What are the isolation levels and which concurrency anomalies does each prevent?

### Spring MVC and the Request Lifecycle

`spring-core/spring-mvc-request-lifecycle` — freq: very-high · difficulty: intermediate

How Spring processes an HTTP request through the DispatcherServlet front controller and the annotation-driven web layer.

**Subtopics:**

- DispatcherServlet as the front controller and the full request-processing flow
- HandlerMapping, HandlerAdapter, ViewResolver, and HandlerInterceptor roles
- @Controller vs @RestController and @ResponseBody
- @RequestMapping / @GetMapping / @PostMapping and request matching
- @RequestParam, @PathVariable, @RequestBody, @RequestHeader, @ModelAttribute binding
- Message converters (Jackson/HttpMessageConverter) for JSON/XML serialization
- Content negotiation and produces/consumes
- @ResponseStatus and ResponseEntity for status/headers
- Validation with @Valid / @Validated and BindingResult
- Filters vs Interceptors vs AOP for cross-cutting web concerns

**Sample interview questions:**

- Walk me through what happens from an incoming HTTP request to the response in Spring MVC.
- What is the role of the DispatcherServlet?
- What is the difference between @Controller and @RestController?
- How does Spring bind request data to method parameters (@RequestParam vs @PathVariable vs @RequestBody)?
- How is a Java object converted to JSON in the response?
- What is the difference between a Servlet Filter and a Spring HandlerInterceptor?
- How do you validate an incoming request body and handle validation errors?

### Exception Handling in the Web Layer

`spring-core/web-exception-handling` — freq: high · difficulty: intermediate

Centralized and local exception handling for REST/MVC endpoints and translating errors into HTTP responses.

**Subtopics:**

- @ExceptionHandler at the controller level
- @ControllerAdvice / @RestControllerAdvice for global exception handling
- @ResponseStatus on custom exception classes
- ResponseEntityExceptionHandler and overriding default Spring MVC error handling
- Mapping exceptions to consistent error-response payloads (ProblemDetail / RFC 7807)
- Default Spring Boot error handling (BasicErrorController, /error, whitelabel page)
- Handling validation (MethodArgumentNotValidException) and binding errors
- Ordering and precedence between local @ExceptionHandler and global advice

**Sample interview questions:**

- How do you handle exceptions globally across all controllers in Spring?
- What is the difference between @ExceptionHandler and @ControllerAdvice?
- How would you return a consistent JSON error structure for all API errors?
- How does @ResponseStatus work on a custom exception?
- What happens by default when an unhandled exception is thrown from a Spring Boot controller?
- How do you translate a validation failure into a 400 response with field-level details?

### Spring Data and Persistence Integration

`spring-core/spring-data-persistence` — freq: high · difficulty: intermediate

How Spring integrates with data access, including repositories, transactions, and exception translation.

**Subtopics:**

- Spring Data JPA repositories (CrudRepository, JpaRepository, PagingAndSortingRepository)
- Derived query methods and @Query
- How repository interfaces are backed by dynamic proxies at runtime
- DataAccessException hierarchy and persistence exception translation (@Repository / PersistencePostProcessor)
- JdbcTemplate and the template method pattern for boilerplate reduction
- Entity lifecycle, lazy loading, and LazyInitializationException relative to transaction/session boundaries
- @Transactional interaction with JPA persistence context and flushing
- N+1 query problem and fetch strategies
- Pagination and sorting (Pageable/Page)

**Sample interview questions:**

- How does Spring Data JPA provide an implementation for a repository interface you never wrote?
- What is JdbcTemplate and what problem does it solve?
- What is the DataAccessException hierarchy and how does exception translation work?
- What causes a LazyInitializationException and how do you avoid it?
- How do derived query methods work in Spring Data?
- How does @Transactional relate to the JPA persistence context and flush timing?
- What is the N+1 select problem and how would you fix it?

### Testing Spring Applications

`spring-core/testing-spring-applications` — freq: high · difficulty: intermediate

Strategies and annotations for unit and integration testing of Spring/Spring Boot components.

**Subtopics:**

- Unit testing with plain constructor injection and mocks (no Spring context)
- @SpringBootTest for full integration tests and webEnvironment options
- Test slices: @WebMvcTest, @DataJpaTest, @JsonTest, @RestClientTest
- @MockBean / @SpyBean vs Mockito @Mock (and Spring context replacement)
- MockMvc for controller testing without a running server
- TestRestTemplate / WebTestClient for real-server tests
- Spring TestContext framework and application-context caching between tests
- @ActiveProfiles, @TestPropertySource, @DirtiesContext
- Transactional test rollback (@Transactional on tests)
- Testcontainers / embedded databases for data-layer tests

**Sample interview questions:**

- How do you unit test a Spring service without starting the container?
- What is the difference between @SpringBootTest and a test slice like @WebMvcTest?
- What is @MockBean and how does it differ from Mockito's @Mock?
- How do you test a REST controller without starting a real server?
- How does Spring cache the application context across tests and why does that matter?
- How do you make each test roll back its database changes automatically?
- Why is constructor injection better for testability?

### Advanced Bean Wiring: FactoryBean, @Lazy, and Custom Registration

`spring-core/advanced-bean-wiring` — freq: medium · difficulty: advanced

Lower-level and advanced bean creation and registration mechanisms beyond standard component scanning.

**Subtopics:**

- FactoryBean interface and how it differs from a @Bean factory method (and the & prefix)
- @Lazy initialization at bean and injection-point level
- @Primary vs @Qualifier vs @Order for candidate selection
- Programmatic registration: BeanDefinitionRegistryPostProcessor, ImportBeanDefinitionRegistrar
- @Import, ImportSelector, and DeferredImportSelector (how @Enable* annotations work)
- ObjectProvider / Provider for deferred and multiple-bean resolution
- @Lookup method injection for prototype-in-singleton
- Conditional registration with @Conditional and Spring Boot @ConditionalOn* variants
- Bean definition inheritance and abstract bean definitions

**Sample interview questions:**

- What is a FactoryBean and how is it different from a @Bean method?
- How do @Enable* annotations (e.g. @EnableScheduling) register beans under the hood?
- What is the difference between @Lazy at the class level and at the injection point?
- How would you register beans programmatically at runtime?
- What is the difference between ImportSelector and ImportBeanDefinitionRegistrar?
- How does @Lookup method injection solve the prototype-in-singleton problem?

### Spring Expression Language (SpEL) and @Value

`spring-core/spel-and-value` — freq: medium · difficulty: intermediate

The expression language used to query and manipulate objects and inject dynamic values at runtime.

**Subtopics:**

- SpEL syntax: #{...} expressions vs ${...} property placeholders
- Injecting properties, defaults, and system/environment values with @Value
- Referencing other beans and their properties in SpEL
- Collection selection/projection and operators in SpEL
- SpEL usage in annotations (@Value, @Cacheable key, security expressions, @ConditionalOnExpression)
- Difference between ${} (property placeholder resolution) and #{} (SpEL evaluation)
- Providing default values (${prop:default}) and handling missing properties

**Sample interview questions:**

- What is the difference between ${...} and #{...} in Spring?
- How do you inject a default value when a property is missing?
- How can you reference another bean's property using SpEL?
- Where is SpEL used besides @Value?
- How would you inject a system property or environment variable into a field?

### Actuator, Observability, and Production Concerns

`spring-core/actuator-observability` — freq: medium · difficulty: intermediate

Production-readiness features Spring Boot provides for monitoring, health, and operational insight.

**Subtopics:**

- Spring Boot Actuator endpoints (health, info, metrics, env, beans, mappings, loggers)
- Health indicators and readiness/liveness probes
- Micrometer metrics abstraction and integration with monitoring backends
- Exposing and securing actuator endpoints (management port, exposure config)
- Distributed tracing and observability (Micrometer Tracing)
- Graceful shutdown and application availability state
- Customizing health indicators and info contributors

**Sample interview questions:**

- What is Spring Boot Actuator and what does it provide?
- How do you expose or secure actuator endpoints in production?
- What is the difference between a liveness and a readiness probe?
- How does Spring Boot integrate with metrics/monitoring systems?
- How would you add a custom health check?

### Asynchronous, Scheduled, and Caching Support

`spring-core/async-scheduling-caching` — freq: medium · difficulty: intermediate

Declarative Spring features for background execution, scheduling, and caching, all built on the proxy/AOP model.

**Subtopics:**

- @Async for asynchronous method execution and returning CompletableFuture/void
- @EnableAsync and TaskExecutor configuration and thread pools
- @Scheduled with fixedRate, fixedDelay, and cron; @EnableScheduling
- @Cacheable, @CachePut, @CacheEvict and the caching abstraction
- @EnableCaching, CacheManager, and cache providers (Caffeine, Redis, etc.)
- Why @Async, @Scheduled, and @Cacheable fail on self-invocation (proxy limitation)
- Exception handling and return-type constraints for @Async
- Cache key generation and conditional caching

**Sample interview questions:**

- How does @Async work and what are its return-type options?
- Why does @Async or @Cacheable not work when called from within the same class?
- What is the difference between fixedRate and fixedDelay in @Scheduled?
- How does Spring's caching abstraction work and what is a CacheManager?
- What is the difference between @Cacheable, @CachePut, and @CacheEvict?
- How do you handle exceptions thrown from an @Async method?

<a id="hibernate-jpa"></a>
## Hibernate & JPA

Folder: `topics/hibernate-jpa/` · 15 topics

### ORM Fundamentals & JPA vs Hibernate

`hibernate-jpa/orm-fundamentals-jpa-vs-hibernate` — freq: very-high · difficulty: beginner

Core object-relational mapping concepts and how the JPA specification relates to Hibernate as a provider.

**Subtopics:**

- What ORM is and the object-relational impedance mismatch
- JPA as a specification vs Hibernate as an implementation/provider
- Other JPA providers (EclipseLink, OpenJPA) and switching providers
- SessionFactory vs EntityManagerFactory
- javax.persistence / jakarta.persistence vs org.hibernate APIs (and the javax-to-jakarta namespace migration)
- persistence.xml, persistence unit, and hibernate.cfg.xml configuration
- Advantages and disadvantages of ORM vs plain JDBC
- @Entity, @Table, @Id, @GeneratedValue basics
- ID generation strategies: IDENTITY, SEQUENCE, TABLE, AUTO and their batching/performance implications
- Field vs property access (@Access) and where annotations are placed

**Sample interview questions:**

- What is the difference between JPA and Hibernate?
- Is JPA a framework or a specification, and where does Hibernate fit in?
- What problem does an ORM solve? Explain the object-relational impedance mismatch.
- What are the advantages and disadvantages of using Hibernate over plain JDBC?
- What is the difference between SessionFactory and EntityManagerFactory?
- Can you switch from Hibernate to another JPA provider without changing your code? What would break?
- What are the different ID generation strategies (IDENTITY, SEQUENCE, TABLE, AUTO) and how do they differ?
- Why can IDENTITY generation prevent JDBC batch inserts while SEQUENCE allows them?

### Session, EntityManager & Persistence Context

`hibernate-jpa/session-entitymanager-persistence-context` — freq: very-high · difficulty: beginner

The core runtime objects that manage entities and the persistence context that tracks them.

**Subtopics:**

- Session vs EntityManager equivalence and differences
- Persistence context and its role as a first-level cache
- Transaction-scoped vs extended persistence context
- get() vs load() in Hibernate (eager vs proxy)
- find() vs getReference() in JPA
- flush() and flush modes (AUTO, COMMIT, MANUAL)
- clear(), detach(), and closing the session/EntityManager
- Thread-safety of Session/EntityManager vs SessionFactory
- contains() and checking whether an entity is managed

**Sample interview questions:**

- What is the difference between Session and EntityManager?
- What is a persistence context and how does it relate to the first-level cache?
- What is the difference between get() and load() in Hibernate?
- What is the difference between find() and getReference() in JPA?
- Is the Hibernate Session thread-safe? What about SessionFactory?
- What does flush() do and when is it triggered automatically?
- What is the difference between a transaction-scoped and an extended persistence context?

### Entity Lifecycle States

`hibernate-jpa/entity-lifecycle-states` — freq: very-high · difficulty: intermediate

The four entity states and how methods transition entities between them.

**Subtopics:**

- Transient (new) state
- Persistent (managed) state
- Detached state
- Removed state
- Transitions via persist, merge, remove, detach, refresh
- How save/persist/saveOrUpdate/update differ (Hibernate vs JPA)
- Re-attaching detached entities with merge vs update
- Behavior of managed entities and automatic dirty checking
- Return value semantics of merge() (returns a managed copy, argument stays detached)

**Sample interview questions:**

- What are the different states of an entity in Hibernate/JPA?
- What is the difference between transient, persistent, and detached states?
- What is the difference between persist() and merge()?
- What is the difference between save(), persist(), and saveOrUpdate() in Hibernate?
- What happens when you call merge() on a detached entity?
- How do you re-attach a detached object to a session?
- What is the difference between merge() and update()?
- Why does persist() return void while merge() returns an entity?

### Entity Mappings & Associations

`hibernate-jpa/entity-mappings-associations` — freq: very-high · difficulty: intermediate

Mapping entities and their relationships to database tables and foreign keys.

**Subtopics:**

- @OneToOne, @OneToMany, @ManyToOne, @ManyToMany
- Unidirectional vs bidirectional associations
- Owning side vs inverse side and mappedBy
- @JoinColumn vs @JoinTable
- Embeddables (@Embeddable, @Embedded) and composite keys (@EmbeddedId, @IdClass)
- Inheritance strategies: SINGLE_TABLE, JOINED, TABLE_PER_CLASS (and @MappedSuperclass)
- @ElementCollection for collections of basic/embeddable types
- Bidirectional consistency and helper methods
- Column-level annotations: @Column, @Transient, @Basic, @Temporal, @Enumerated, @Lob
- @DiscriminatorColumn / @DiscriminatorValue for SINGLE_TABLE inheritance

**Sample interview questions:**

- How do you map a many-to-many relationship in Hibernate?
- What is the difference between unidirectional and bidirectional relationships?
- What does mappedBy do and which side is the owning side?
- What is the difference between @JoinColumn and @JoinTable?
- What are the inheritance mapping strategies in JPA and their trade-offs?
- How do you map a composite primary key, and what is the difference between @EmbeddedId and @IdClass?
- What is the difference between @OneToMany and @ElementCollection?
- What is the difference between @Embeddable and @Entity?

### Fetching Strategies: Lazy vs Eager & the N+1 Problem

`hibernate-jpa/fetching-lazy-eager-n-plus-one` — freq: very-high · difficulty: intermediate

Controlling when associated data loads and avoiding the classic N+1 query performance problem.

**Subtopics:**

- FetchType.LAZY vs FetchType.EAGER and defaults per association type
- How lazy loading works with proxies
- LazyInitializationException and its causes/fixes
- The N+1 select problem: cause and detection
- Fixing N+1: JOIN FETCH, @EntityGraph, batch fetching (@BatchSize)
- FetchMode.JOIN vs SELECT vs SUBSELECT
- Open-Session-in-View anti-pattern
- DTO projections to avoid over-fetching
- MultipleBagFetchException when JOIN FETCHing two List collections

**Sample interview questions:**

- What is the difference between lazy and eager loading?
- What is the N+1 select problem and how do you solve it?
- What are the default fetch types for @OneToMany, @ManyToOne, @OneToOne, and @ManyToMany?
- What causes a LazyInitializationException and how do you fix it?
- How does JOIN FETCH differ from a normal JOIN in JPQL?
- What is an EntityGraph and when would you use it?
- What is the Open Session in View pattern and why is it considered an anti-pattern?

### Caching: First & Second Level Cache

`hibernate-jpa/caching-first-second-level` — freq: high · difficulty: intermediate

Hibernate's built-in caching layers and query cache to reduce database hits.

**Subtopics:**

- First-level cache (session/persistence-context scoped)
- Second-level cache (SessionFactory scoped) and providers (EhCache, Infinispan, Caffeine)
- Enabling and configuring L2 cache (@Cacheable, @Cache, shared-cache-mode)
- Cache concurrency strategies: READ_ONLY, NONSTRICT_READ_WRITE, READ_WRITE, TRANSACTIONAL
- Query cache and why it needs the L2 cache
- Cache eviction and staleness concerns
- When caching helps vs hurts
- How bulk JPQL updates/native SQL bypass and stale the caches

**Sample interview questions:**

- What is the difference between first-level and second-level cache in Hibernate?
- Is the first-level cache enabled by default? Can you disable it?
- How do you enable the second-level cache and what providers are available?
- What are the cache concurrency strategies and when would you use each?
- What is the query cache and why does it require the second-level cache to be enabled?
- What are the risks of using the second-level cache?
- Is the second-level cache shared across sessions or per session?

### Cascade Types & Orphan Removal

`hibernate-jpa/cascade-types-orphan-removal` — freq: high · difficulty: intermediate

Propagating entity operations across associations and cleaning up disowned children.

**Subtopics:**

- CascadeType values: PERSIST, MERGE, REMOVE, REFRESH, DETACH, ALL
- JPA cascade vs Hibernate-specific cascade types (SAVE_UPDATE, REPLICATE)
- orphanRemoval=true vs CascadeType.REMOVE
- Where cascades are declared (owning vs inverse side)
- Cascade pitfalls with shared references
- Interaction of cascade with bidirectional relationships

**Sample interview questions:**

- What are the different cascade types in JPA?
- What is the difference between CascadeType.REMOVE and orphanRemoval=true?
- What does CascadeType.ALL include?
- What is the difference between JPA cascade types and Hibernate's SAVE_UPDATE?
- If you delete a parent, how do you ensure child records are also deleted?
- What happens if the same child entity is referenced by two parents with cascade REMOVE?

### Transactions, Dirty Checking & Flushing

`hibernate-jpa/transactions-dirty-checking-flushing` — freq: high · difficulty: intermediate

How Hibernate manages transactions, automatically detects changes, and orders SQL.

**Subtopics:**

- Transaction demarcation (programmatic vs declarative @Transactional)
- Automatic dirty checking and snapshot comparison
- Flush timing and FlushMode
- Write-behind / action queue and SQL ordering
- ACID properties and transaction isolation levels
- Propagation levels in Spring (REQUIRED, REQUIRES_NEW, etc.)
- @Transactional(readOnly=true) optimization
- Rollback behavior and checked vs unchecked exceptions
- Self-invocation limitation of @Transactional proxies

**Sample interview questions:**

- What is dirty checking and how does Hibernate implement it?
- How does Hibernate know an entity has changed without you calling save()?
- When does Hibernate actually execute SQL against the database?
- What is the difference between flush and commit?
- How do transaction isolation levels affect Hibernate behavior?
- What does @Transactional(readOnly = true) do and why use it?
- What are the transaction propagation levels and when would you use REQUIRES_NEW?
- Why does calling a @Transactional method from another method in the same class sometimes not open a transaction?

### Querying: JPQL, HQL, Criteria API & Native SQL

`hibernate-jpa/querying-jpql-hql-criteria-native` — freq: high · difficulty: intermediate

The different ways to query data, bulk operations, and their trade-offs.

**Subtopics:**

- HQL / JPQL syntax and object-oriented querying
- Criteria API for type-safe dynamic queries (and the metamodel)
- Native SQL queries and result mapping (@SqlResultSetMapping)
- Named queries (@NamedQuery / @NamedNativeQuery)
- Named vs positional parameters and SQL injection safety
- Pagination with setFirstResult/setMaxResults
- Projections and DTO/constructor expressions
- Spring Data JPA derived queries and @Query
- Bulk update/delete via JPQL (executeUpdate) and how it bypasses the persistence context and caches
- Stored procedures via @NamedStoredProcedureQuery and StoredProcedureQuery
- getResultList() vs getSingleResult() vs getResultStream()

**Sample interview questions:**

- What is the difference between HQL and SQL?
- When would you use the Criteria API instead of HQL/JPQL?
- How do you write a native SQL query in JPA and map its results?
- How do you prevent SQL injection in HQL queries?
- What is the difference between getResultList() and getSingleResult()?
- How do you implement pagination in JPQL?
- What is a named query and what are its advantages?
- What happens to managed entities and the second-level cache when you run a bulk JPQL UPDATE or DELETE?

### Concurrency Control: Optimistic vs Pessimistic Locking

`hibernate-jpa/concurrency-optimistic-pessimistic-locking` — freq: high · difficulty: advanced

Preventing lost updates and handling concurrent access to the same data.

**Subtopics:**

- Optimistic locking with @Version
- OptimisticLockException and how it is thrown
- Pessimistic locking (PESSIMISTIC_READ, PESSIMISTIC_WRITE, PESSIMISTIC_FORCE_INCREMENT)
- LockModeType values and applying locks (find/query/lock/refresh)
- Lost update problem and how each strategy prevents it
- Trade-offs: throughput vs blocking/deadlock risk
- Version column mechanics on UPDATE statements
- OPTIMISTIC vs OPTIMISTIC_FORCE_INCREMENT for related entities

**Sample interview questions:**

- What is the difference between optimistic and pessimistic locking?
- How does the @Version annotation implement optimistic locking?
- When would you choose pessimistic locking over optimistic locking?
- What is the lost update problem and how does locking solve it?
- What happens when an OptimisticLockException is thrown and how do you handle it?
- What are the different LockModeType values in JPA?
- What are the risks of pessimistic locking?

### Performance Tuning & Common Pitfalls

`hibernate-jpa/performance-tuning-pitfalls` — freq: medium · difficulty: advanced

Diagnosing and fixing performance and design problems in Hibernate applications.

**Subtopics:**

- Batch inserts/updates (hibernate.jdbc.batch_size, order_inserts/order_updates) and StatelessSession
- N+1 detection and query count analysis
- equals()/hashCode() contract for entities and collections
- Choosing correct fetch types and avoiding EAGER by default
- Connection pooling (HikariCP) and statement caching
- LazyInitializationException management
- Bidirectional consistency and List vs Set for collections
- Auto-DDL (hbm2ddl) dangers in production and using migration tools
- Reading with DTO projections / read-only queries to reduce overhead

**Sample interview questions:**

- How would you diagnose and fix a slow-performing Hibernate application?
- How do you perform bulk/batch inserts efficiently in Hibernate?
- Why should entities implement equals() and hashCode(), and how should they be implemented?
- What is a StatelessSession and when would you use it?
- Why is FetchType.EAGER often considered an anti-pattern?
- What are the dangers of using hibernate.hbm2ddl.auto=update in production?
- How does the choice between List and Set affect Hibernate collection performance?

### Spring Data JPA & Repository Abstraction

`hibernate-jpa/spring-data-jpa-repositories` — freq: very-high · difficulty: intermediate

The Spring Data repository layer that sits on top of JPA, providing derived queries, paging, projections, and specifications.

**Subtopics:**

- Repository hierarchy: Repository, CrudRepository, PagingAndSortingRepository, JpaRepository
- Derived query methods (findBy..., countBy..., existsBy..., deleteBy...)
- @Query with JPQL vs nativeQuery=true, and @Modifying for update/delete queries
- Pagination and sorting: Pageable, Page vs Slice, Sort
- Interface-based (closed/open) and class-based (DTO) projections
- Specifications and the Criteria-based dynamic query API, Query By Example (QBE)
- @EntityGraph on repository methods to control fetching
- How save() decides between persist() and merge() (isNew / @Version / Persistable)
- Default transaction semantics of Spring Data repository methods
- saveAll batching and the derived vs custom repository implementation pattern

**Sample interview questions:**

- What is the difference between CrudRepository, PagingAndSortingRepository, and JpaRepository?
- How do derived query methods work in Spring Data JPA?
- When do you use @Query and how do you write update queries with @Modifying?
- What is the difference between Page and Slice, and how does Pageable work?
- How does Spring Data JPA's save() decide whether to persist or merge an entity?
- What are projections in Spring Data JPA and why use interface-based ones?
- How do Specifications help you build dynamic queries?
- Are Spring Data repository methods transactional by default?

### Entity Lifecycle Callbacks, Auditing & Interceptors

`hibernate-jpa/lifecycle-callbacks-auditing-interceptors` — freq: medium · difficulty: intermediate

Hooks that run around entity persistence events and mechanisms for auditing and cross-cutting behavior.

**Subtopics:**

- JPA callback annotations: @PrePersist, @PostPersist, @PreUpdate, @PostUpdate, @PreRemove, @PostRemove, @PostLoad
- @EntityListeners and external listener classes
- Spring Data auditing: @CreatedDate, @LastModifiedDate, @CreatedBy, @LastModifiedBy, @EnableJpaAuditing, AuditorAware
- Hibernate Envers for historical/versioned audit tables (@Audited)
- Hibernate Interceptor and event-listener SPI
- When callbacks fire relative to flush and why they must avoid EntityManager calls
- Use cases: derived fields, timestamps, validation, audit logging

**Sample interview questions:**

- What JPA lifecycle callback annotations exist and when does each fire?
- How do you automatically populate created/modified timestamps on entities?
- What is the difference between @EntityListeners and putting callbacks on the entity itself?
- What is Hibernate Envers and what problem does it solve?
- Why is it discouraged to call EntityManager operations from inside a lifecycle callback?
- How does Spring Data JPA auditing know who the current user is?

### Value Mapping: Converters, Enums, Temporal & Custom Types

`hibernate-jpa/value-mapping-converters-enums-types` — freq: medium · difficulty: intermediate

Mapping individual attributes and value types to columns, including enums, dates, converters, and soft deletes.

**Subtopics:**

- @Enumerated(EnumType.STRING) vs ORDINAL and the ordinal reordering pitfall
- AttributeConverter and @Convert (and autoApply)
- Mapping java.time types vs legacy @Temporal (DATE/TIME/TIMESTAMP)
- @Lob for CLOB/BLOB and large-object handling
- @Column attributes: length, nullable, unique, precision, scale, columnDefinition
- @Transient for non-persistent fields; @Basic and its fetch attribute
- @Formula for computed/derived read-only columns (Hibernate)
- Mapping JSON/array columns and custom UserType
- Soft deletes with @SQLDelete and @Where / @SoftDelete

**Sample interview questions:**

- What is the difference between EnumType.STRING and EnumType.ORDINAL, and why is ORDINAL risky?
- How do you map a custom Java type to a column using AttributeConverter?
- How should you map date/time fields in a modern JPA application?
- What does @Transient do and how is it different from the transient keyword?
- How would you implement soft deletes in Hibernate?
- How do you persist an enum, and what happens if someone reorders the enum constants?
- How do you map a JSON column to an entity attribute?

### Configuration, Bootstrapping & Schema Generation

`hibernate-jpa/configuration-bootstrapping-schema-generation` — freq: medium · difficulty: intermediate

How Hibernate/JPA is configured and bootstrapped, how the schema is managed, and how validation integrates.

**Subtopics:**

- Hibernate dialect: what it does and why it matters
- hibernate.hbm2ddl.auto values (none, validate, update, create, create-drop) and safe production settings
- Schema migration tools (Flyway, Liquibase) vs auto-DDL
- DataSource and connection pool configuration (HikariCP)
- persistence.xml / LocalContainerEntityManagerFactoryBean vs Spring Boot auto-configuration properties
- Physical and implicit naming strategies
- show_sql, format_sql, and generate_statistics for diagnostics
- Bean Validation integration (@NotNull, @Size, @Valid) and validation on persist/update
- Testing JPA with @DataJpaTest and in-memory vs Testcontainers databases

**Sample interview questions:**

- What is a Hibernate dialect and why do you need to configure it?
- What are the possible values of hibernate.hbm2ddl.auto and which should you use in production?
- How do database migration tools like Flyway/Liquibase fit with Hibernate?
- How does Bean Validation integrate with JPA entity persistence?
- How is Hibernate bootstrapped in a Spring Boot application versus a plain JPA setup?
- How would you write a repository/persistence-layer test with @DataJpaTest?
- What do show_sql and format_sql do, and how do you inspect the SQL Hibernate generates?

<a id="apache-tomcat"></a>
## Apache Tomcat

Folder: `topics/apache-tomcat/` · 16 topics

### Tomcat Fundamentals & Servlet Container Concepts

`apache-tomcat/tomcat-fundamentals-servlet-container` — freq: very-high · difficulty: beginner

Core role of Tomcat as a servlet/JSP container and the Servlet/JSP specification concepts it implements.

**Subtopics:**

- Web server vs servlet container vs application server
- Servlet lifecycle (init, service, destroy) and single-instance/multi-thread model
- Servlet spec vs Jakarta EE / Java EE full profile
- JSP lifecycle and compilation to servlets
- ServletContext vs ServletConfig
- Filters, listeners, and the request-processing pipeline
- GET vs POST handling and request/response objects
- Tomcat vs JBoss/WildFly/GlassFish (full app server)
- Thread-safety of servlets and instance/shared field pitfalls
- RequestDispatcher forward vs redirect vs include

**Sample interview questions:**

- What is Apache Tomcat and is it a web server or an application server?
- Explain the servlet lifecycle methods and when each is called.
- What is the difference between a servlet container and a full Java EE application server?
- How does Tomcat compile and serve a JSP page?
- What is the difference between ServletContext and ServletConfig?
- Why can't Tomcat run EJBs out of the box, and what would you use instead?
- What Jakarta EE / Servlet spec version does Tomcat 10/11 implement, and what changed with the javax to jakarta namespace migration?
- How do filters and listeners fit into the request processing flow?
- Are servlets thread-safe? What happens if you store request state in an instance field?
- What is the difference between a forward and a sendRedirect?

### Tomcat Architecture (Server, Service, Engine, Host, Context)

`apache-tomcat/tomcat-architecture-components` — freq: high · difficulty: intermediate

The hierarchical container architecture of Tomcat and how the top-level components nest and process requests.

**Subtopics:**

- Server, Service, Connector, Engine, Host, Context hierarchy
- Catalina servlet engine
- Coyote HTTP connector layer
- Jasper JSP engine
- How a request flows from connector to servlet
- Wrapper container and per-servlet mapping
- Lifecycle interface and component startup/shutdown
- Relationship between components in server.xml
- Bootstrap/Catalina startup sequence and the shutdown port
- Mapper component and request-to-context routing

**Sample interview questions:**

- Draw and explain the Tomcat architecture from Server down to Wrapper.
- What are Catalina, Coyote, and Jasper and what does each do?
- Trace the path of an HTTP request through Tomcat's components until it reaches a servlet.
- What is the difference between an Engine, a Host, and a Context?
- What is the role of the Wrapper container?
- How do the Service and Connector elements relate to each other?
- What is the Lifecycle interface and how does Tomcat manage component startup?
- Can a single Tomcat instance have multiple Services or Engines? Why would you do that?
- What happens during Tomcat startup from Bootstrap to fully deployed contexts?
- How does the Mapper decide which Host and Context a request belongs to?

### Connectors: BIO, NIO, NIO2 & APR

`apache-tomcat/connectors-bio-nio-apr` — freq: high · difficulty: intermediate

Tomcat connector implementations, their I/O models, and how to choose and configure them.

**Subtopics:**

- BIO (blocking, removed after Tomcat 8.5) vs NIO vs NIO2 vs APR/native
- Protocol handlers (HTTP/1.1, HTTP/2, AJP)
- Poller, Acceptor, and worker thread model in NIO
- Keep-alive handling and connection scalability
- APR/native library and OpenSSL integration
- AJP connector and reverse-proxy integration (mod_jk, mod_proxy_ajp)
- HTTP/2 support and upgrade protocol
- protocol attribute configuration in server.xml
- Connector port binding, multiple connectors, and address binding
- Ghostcat (CVE-2020-1938) and securing/disabling the AJP connector

**Sample interview questions:**

- What is the difference between the BIO, NIO, NIO2, and APR connectors?
- Why was the BIO connector removed in Tomcat 8.5 and what is the default now?
- How does the NIO connector achieve better scalability than blocking I/O for keep-alive connections?
- What is the AJP connector and when would you use it instead of HTTP?
- What does the APR/native connector give you over pure-Java NIO?
- How do you enable HTTP/2 on a Tomcat connector?
- What are the Acceptor and Poller threads in the NIO connector?
- What is the Ghostcat (CVE-2020-1938) vulnerability and how does it relate to AJP?
- How do you configure Tomcat to listen on multiple ports or bind to a specific interface?

### Thread Pools, Executors & Performance Tuning

`apache-tomcat/thread-pools-executors-tuning` — freq: high · difficulty: advanced

Configuring connector thread pools and executors to size Tomcat for throughput and concurrency.

**Subtopics:**

- maxThreads, minSpareThreads, acceptCount tuning
- maxConnections vs maxThreads relationship
- Shared Executor element across connectors
- connectionTimeout and keepAliveTimeout
- maxKeepAliveRequests and connection reuse
- Thread-per-request model and blocking downstream calls
- Detecting thread pool exhaustion and queueing
- Async servlets (Servlet 3.0+) and non-blocking I/O to reduce thread usage
- processorCache and object recycling
- Little's Law reasoning for capacity planning

**Sample interview questions:**

- What is the difference between maxThreads, maxConnections, and acceptCount?
- What happens when all worker threads are busy and acceptCount is exceeded?
- How would you size maxThreads for a CPU-bound vs an I/O-bound workload?
- What is a shared Executor and why configure one across multiple connectors?
- How do async servlets help when your app makes slow downstream calls?
- How do you diagnose thread pool exhaustion in a production Tomcat?
- What does connectionTimeout control and how does it differ from keepAliveTimeout?
- Why can adding more threads sometimes reduce throughput?
- How would you use Little's Law to estimate the thread pool size needed for a target throughput and latency?

### Configuration Files: server.xml, web.xml, context.xml

`apache-tomcat/configuration-files` — freq: high · difficulty: intermediate

The main Tomcat configuration files, their scope, and how deployment descriptors are merged.

**Subtopics:**

- server.xml top-level structure and elements
- Global web.xml (conf/web.xml) vs application WEB-INF/web.xml
- context.xml (global, per-host, per-app) and where it lives
- catalina.properties and setenv.sh/setenv.bat
- Directory layout: bin, conf, lib, webapps, logs, work, temp
- CATALINA_HOME vs CATALINA_BASE
- JNDI resource definitions and DataSource configuration
- Merging order and precedence of descriptors
- web-fragment.xml and annotation-based configuration (metadata-complete)
- DefaultServlet and JspServlet configuration in conf/web.xml

**Sample interview questions:**

- What is the difference between server.xml, context.xml, and web.xml?
- Where do you define a JDBC DataSource so an app can look it up via JNDI?
- What is the difference between the global conf/web.xml and an application's WEB-INF/web.xml?
- Explain CATALINA_HOME vs CATALINA_BASE and why you'd separate them.
- Where should you set JVM options and environment variables for Tomcat?
- What are the different places context.xml can be defined and what is their precedence?
- What is the purpose of the work and temp directories?
- How do you configure a context path and docBase for an application?
- How do web-fragment.xml and annotations interact with web.xml, and what does metadata-complete do?

### WAR Deployment & Web Application Management

`apache-tomcat/war-deployment-management` — freq: high · difficulty: intermediate

Ways to deploy web applications to Tomcat and manage their lifecycle.

**Subtopics:**

- Auto-deploy and hot deploy from webapps directory
- WAR vs exploded directory deployment
- Manager and Host-Manager web applications
- Deploying via Manager REST API / Maven Tomcat plugin
- Context descriptor deployment (XML in conf/Catalina/<host>)
- ROOT context and default application
- Class loading during redeploy and PermGen/Metaspace leaks
- Parallel deployment (multiple versions of same app)
- unpackWARs, autoDeploy, deployOnStartup flags
- Graceful shutdown/undeploy and in-flight request draining

**Sample interview questions:**

- What are the different ways to deploy an application to Tomcat?
- What is the difference between a WAR and an exploded directory deployment?
- How does Tomcat's auto-deployment work and how do you disable it?
- What is the Manager app and how do you deploy an app through it remotely?
- How does the ROOT context work and how do you make your app the default?
- What is parallel deployment and how does versioning (##) work?
- Why do redeploys sometimes cause OutOfMemoryError: Metaspace/PermGen, and how do you fix it?
- How would you deploy a WAR from a CI/CD pipeline without restarting Tomcat?
- How do you gracefully drain in-flight requests before undeploying or shutting down Tomcat?

### Valves & Request Interception Pipeline

`apache-tomcat/valves-request-pipeline` — freq: medium · difficulty: advanced

Tomcat's Valve mechanism for intercepting requests at the container level, distinct from servlet filters.

**Subtopics:**

- Valve vs servlet Filter (container-level vs app-level)
- AccessLogValve and access log formatting
- RemoteAddrValve / RemoteHostValve for IP filtering
- RemoteIpValve and X-Forwarded-For handling behind proxies
- ErrorReportValve and custom error pages
- Pipeline and Basic valve concept per container
- StuckThreadDetectionValve
- Writing a custom valve
- CrawlerSessionManagerValve and rewrite/RewriteValve
- Valve ordering and execution relative to filters

**Sample interview questions:**

- What is a Valve in Tomcat and how does it differ from a servlet Filter?
- How do you configure access logging and customize the log pattern?
- Which valve do you use to get the real client IP when Tomcat sits behind a load balancer?
- How would you restrict access to the Manager app by IP address?
- At what level (Engine/Host/Context) can valves be attached and why does that matter?
- What is the StuckThreadDetectionValve used for?
- Explain the pipeline/basic-valve model in a Tomcat container.
- When would you write a custom valve instead of a filter?
- In what order do valves and filters execute for a single request?

### Class Loading Architecture

`apache-tomcat/classloading-architecture` — freq: medium · difficulty: advanced

Tomcat's hierarchical, spec-mandated class loader delegation model and common pitfalls.

**Subtopics:**

- Bootstrap, System, Common, and WebApp class loaders
- Deviation from standard parent-first delegation (web app first)
- WEB-INF/classes and WEB-INF/lib loading order
- Shared vs common loader (shared.loader in catalina.properties)
- ClassNotFoundException / NoClassDefFoundError troubleshooting
- Class loader leaks on redeploy and ThreadLocal/JDBC driver pitfalls
- Isolation between multiple web apps
- Endorsed/override of JRE classes
- JreMemoryLeakPreventionListener and leak detection
- delegate attribute on the Context/Loader

**Sample interview questions:**

- Describe Tomcat's class loader hierarchy.
- Why does the web application class loader deviate from the standard parent-first delegation model?
- In what order are classes in WEB-INF/classes vs WEB-INF/lib loaded?
- How are two web apps isolated from each other's classes?
- What causes a class loader memory leak on redeploy and how do you prevent it?
- Where would you place a JAR that must be shared by all web applications?
- How do you resolve a NoClassDefFoundError caused by duplicate JARs in Tomcat lib and WEB-INF/lib?
- How does Tomcat handle a JDBC driver that fails to deregister on undeploy?
- What does the delegate="true" attribute change, and when would you set it?

### Sessions, Clustering & Session Replication

`apache-tomcat/clustering-session-replication` — freq: high · difficulty: advanced

Horizontal scaling of Tomcat with load balancing, session persistence, and cluster-based session replication.

**Subtopics:**

- HttpSession management and session persistence (PersistentManager)
- Sticky sessions vs session replication
- DeltaManager vs BackupManager
- SimpleTcpCluster and multicast membership
- Load balancing with mod_jk / mod_proxy / hardware LB
- jvmRoute and session affinity
- Session serialization requirements
- External session stores (Redis/Memcached) as alternative to built-in clustering
- Session timeout configuration and session cookie attributes (Secure, HttpOnly, SameSite)
- StandardManager session persistence across restarts

**Sample interview questions:**

- How does session replication work in a Tomcat cluster?
- What is the difference between the DeltaManager and BackupManager?
- What are sticky sessions and how does jvmRoute enable them?
- When would you choose sticky sessions over full session replication?
- How does Tomcat cluster membership discovery work (multicast)?
- What must be true of objects you put in an HttpSession for clustering to work?
- How would you scale Tomcat horizontally while sharing sessions using Redis instead of built-in clustering?
- What are the trade-offs of all-to-all replication as cluster size grows?
- How do you configure session timeout, and how are HttpOnly/Secure/SameSite set on the JSESSIONID cookie?

### JVM Tuning, Memory & Troubleshooting

`apache-tomcat/jvm-tuning-troubleshooting` — freq: high · difficulty: advanced

Tuning the JVM under Tomcat and diagnosing production performance and memory issues.

**Subtopics:**

- Heap sizing (-Xms/-Xmx) and Metaspace tuning
- GC selection (G1, Parallel, ZGC) and GC logging
- Diagnosing OutOfMemoryError: heap vs Metaspace vs threads
- Thread dumps and analyzing stuck/blocked threads
- Heap dumps and memory leak analysis (MAT)
- JMX monitoring of connectors, thread pools, and memory
- setenv.sh for JAVA_OPTS / CATALINA_OPTS
- Native memory and file descriptor limits
- High CPU triage: top -H plus thread dump correlation
- Container/cgroup awareness and memory limits under Docker/Kubernetes

**Sample interview questions:**

- How do you set heap size and GC options for Tomcat, and where?
- How would you troubleshoot high CPU usage in a running Tomcat?
- What is the difference between CATALINA_OPTS and JAVA_OPTS?
- How do you capture and analyze a thread dump to find a deadlock or stuck threads?
- What are the common causes of OutOfMemoryError in Tomcat and how do you tell them apart?
- How do you monitor Tomcat's thread pool and memory in production via JMX?
- How would you find and fix a memory leak that appears after repeated redeploys?
- What garbage collector would you pick for a low-latency Tomcat service and why?
- How do you correlate a high-CPU native thread from top -H with a Java thread in a thread dump?
- What pitfalls arise when running Tomcat in a container with a memory limit, and how does the JVM detect cgroup limits?

### Security, SSL/TLS & Server Comparison

`apache-tomcat/security-tls-server-comparison` — freq: high · difficulty: advanced

Securing Tomcat with TLS, realms, and hardening, plus how Tomcat compares to alternative servers.

**Subtopics:**

- HTTPS/TLS connector configuration (JSSE vs OpenSSL/APR)
- Keystores, certificates, and cipher configuration
- Realms and authentication (JDBC, JNDI/LDAP, DataSource, Memory)
- BASIC/DIGEST/FORM/CLIENT-CERT auth and security-constraints
- Hardening: removing default apps, Manager access control, running as non-root
- Tomcat vs Jetty vs Undertow vs Netty (embedded/reactive)
- Tomcat vs Nginx/Apache HTTPD as front-end
- Embedded Tomcat in Spring Boot
- SecurityManager (deprecated) and file-system permissions
- TLS termination at Tomcat vs at a front proxy/load balancer
- Common web vulnerabilities: directory listing, version disclosure, session fixation, CSRF filter

**Sample interview questions:**

- How do you configure an HTTPS connector in Tomcat?
- What is the difference between JSSE and APR/OpenSSL for TLS in Tomcat?
- What is a Realm and how do you authenticate users against a database or LDAP?
- How would you harden a production Tomcat installation?
- How does Spring Boot embed Tomcat and how does that differ from a standalone deployment?
- Compare Tomcat with Jetty and Undertow — when would you pick each?
- Why put Nginx or Apache HTTPD in front of Tomcat?
- How do you secure the Manager and Host-Manager applications?
- Would you terminate TLS at Tomcat or at the load balancer/proxy, and what changes about RemoteIpValve when you offload it?
- What default settings should you change to avoid version disclosure and directory listing?

### Logging: JULI, Access Logs & catalina.out

`apache-tomcat/logging-juli-access-logs` — freq: medium · difficulty: intermediate

Tomcat's logging subsystem (JULI), the various log files, and integrating application/framework logging.

**Subtopics:**

- JULI (java.util.logging) and logging.properties configuration
- catalina.out vs catalina.log vs localhost.log vs manager/host-manager logs
- Access logs via AccessLogValve vs application logging
- Per-web-application logging configuration
- Redirecting stdout/stderr and why catalina.out grows unbounded
- Bridging to Log4j2/SLF4J/Logback and replacing tomcat-juli.jar
- Log rotation and retention (logrotate, RollingFileHandler)
- Log levels, handlers, and formatters in JULI

**Sample interview questions:**

- What are the different log files Tomcat produces and what goes into each?
- What is JULI and how does it differ from stock java.util.logging?
- Why does catalina.out grow without rotating, and how do you manage it?
- How do you configure per-application logging in Tomcat?
- How would you route Tomcat's internal logging through Log4j2 or Logback?
- What is the difference between an access log and an application log, and how do you enable access logging?
- Where do you set log levels for a specific package or web app?
- A servlet's System.out.println output — which file does it end up in and why?

### JNDI Resources, DataSources & Connection Pooling

`apache-tomcat/jndi-datasources-connection-pooling` — freq: high · difficulty: intermediate

Defining and looking up JNDI resources in Tomcat, and configuring JDBC connection pools correctly.

**Subtopics:**

- Defining Resource/ResourceLink in context.xml vs server.xml GlobalNamingResources
- JNDI lookup via java:comp/env and resource-ref in web.xml
- Tomcat JDBC Pool vs Commons DBCP2
- Pool sizing: maxActive/maxTotal, maxIdle, minIdle, initialSize
- Connection validation (validationQuery, testOnBorrow, testWhileIdle)
- Detecting and fixing connection pool leaks (removeAbandoned, logAbandoned)
- maxWait behavior and pool exhaustion symptoms
- Placing the JDBC driver in the right classloader (lib vs WEB-INF/lib)
- Mail sessions and other JNDI resource types

**Sample interview questions:**

- How do you configure a JDBC DataSource in Tomcat and look it up from an application?
- What is the difference between a global JNDI resource with a ResourceLink and a per-context Resource?
- Compare Tomcat JDBC Pool and Commons DBCP2 — why was Tomcat JDBC Pool created?
- How would you size a connection pool for a service with N Tomcat threads?
- What symptoms indicate connection pool exhaustion and how do you diagnose it?
- How do you detect and clean up abandoned/leaked connections?
- Where must the JDBC driver JAR live and why does putting it in WEB-INF/lib sometimes fail?
- What does validationQuery/testOnBorrow do and what is the performance trade-off?

### WebSockets, Async Processing & Modern Protocols

`apache-tomcat/websockets-async-processing` — freq: medium · difficulty: advanced

Tomcat's support for asynchronous request processing, WebSocket (JSR 356), and non-blocking I/O for scalable connections.

**Subtopics:**

- Servlet 3.0 async (AsyncContext, startAsync) and thread offloading
- Servlet 3.1 non-blocking I/O (ReadListener/WriteListener)
- WebSocket support (JSR 356 / jakarta.websocket) endpoints
- Server-Sent Events and long-lived connections
- How async/WebSocket interact with the NIO connector and thread pool
- asyncTimeout and error handling for async requests
- Comet (legacy) vs modern async APIs
- Scaling many concurrent connections without one-thread-per-connection

**Sample interview questions:**

- How do async servlets (Servlet 3.0+) free up worker threads during slow processing?
- How does Tomcat support WebSockets, and which spec/API is used?
- How does non-blocking I/O in Servlet 3.1 differ from traditional blocking reads?
- Why does the NIO connector matter for WebSocket and async scalability?
- How would you handle 50,000 idle long-lived connections in Tomcat without exhausting threads?
- What does asyncTimeout control and how do you handle async errors/timeouts?
- When would you use Server-Sent Events vs WebSockets on Tomcat?
- What are the pitfalls of mixing blocking calls inside an async servlet?

### Embedded Tomcat & Spring Boot Integration

`apache-tomcat/embedded-tomcat-spring-boot` — freq: high · difficulty: intermediate

Running Tomcat embedded in an application (notably Spring Boot) versus a standalone install, and programmatic configuration.

**Subtopics:**

- Embedded Tomcat API (Tomcat class, programmatic connectors/contexts)
- Spring Boot embedded servlet container auto-configuration
- Executable JAR with embedded Tomcat vs deployable WAR to standalone
- Configuring embedded Tomcat via server.* properties / WebServerFactoryCustomizer
- Switching containers (Jetty/Undertow) in Spring Boot
- Differences in class loading, logging, and config vs standalone
- Graceful shutdown and actuator/health integration
- When to choose embedded vs standalone deployment

**Sample interview questions:**

- How does Spring Boot embed Tomcat, and how do you configure the port and thread pool?
- What is the difference between an executable JAR with embedded Tomcat and a WAR deployed to standalone Tomcat?
- How do you customize the embedded Tomcat connector programmatically in Spring Boot?
- How would you switch a Spring Boot app from Tomcat to Undertow or Jetty, and why?
- How does class loading differ between embedded and standalone Tomcat?
- How do you configure graceful shutdown for embedded Tomcat?
- What are the trade-offs of embedded vs standalone Tomcat for operations and deployment?
- How would you tune maxThreads and connection settings for embedded Tomcat via application.properties?

### Monitoring, JMX & Management APIs

`apache-tomcat/monitoring-jmx-management` — freq: medium · difficulty: intermediate

Observing and managing a running Tomcat via JMX, the Manager status pages, and metrics integration.

**Subtopics:**

- JMX MBeans for connectors, thread pools, memory, and requests
- Enabling remote JMX and securing it
- Manager app /status and /manager/text API
- Key metrics: currentThreadsBusy, requestCount, processingTime, error count
- Integrating with Prometheus/JMX exporter, Micrometer, or APM agents
- Detecting thread pool saturation and slow requests via metrics
- Lifecycle listeners for management (JMXAdaptorListener, etc.)
- Health checks and readiness/liveness signals

**Sample interview questions:**

- Which JMX MBeans would you watch to monitor Tomcat health in production?
- How do you enable and secure remote JMX access to Tomcat?
- What does the Manager /status page show and how do you access it programmatically?
- Which metrics indicate your connector thread pool is saturated?
- How would you export Tomcat metrics to Prometheus or an APM tool?
- How do you measure per-request processing time and error rates on a connector?
- How would you build a health check that reflects Tomcat's real request-serving capacity?
- What early-warning metrics tell you Tomcat is about to run out of threads or connections?

<a id="java-jvm"></a>
## Java & JVM (framework-relevant)

Folder: `topics/java-jvm/` · 16 topics

### JVM Architecture & Class Loading

`java-jvm/jvm-architecture-class-loading` — freq: high · difficulty: intermediate

How the JVM is structured, how bytecode executes, and how classes are found, loaded, linked, and initialized.

**Subtopics:**

- JVM vs JRE vs JDK distinction
- Runtime data areas (method area, heap, stack, PC register, native method stack)
- Class loader hierarchy (bootstrap, extension/platform, application/system)
- Parent delegation model and why it exists
- Loading, linking (verification, preparation, resolution), and initialization phases
- Custom class loaders and use cases (app servers, hot reload, plugins)
- ClassNotFoundException vs NoClassDefFoundError
- JIT compilation, interpreter, and HotSpot tiered compilation
- static vs instance initialization order
- Metaspace vs the old PermGen

**Sample interview questions:**

- Explain the difference between JDK, JRE, and JVM.
- Walk me through the class loading process: what happens during loading, linking, and initialization?
- What is the parent delegation model and why does the JVM use it?
- What is the difference between ClassNotFoundException and NoClassDefFoundError?
- When would you write a custom class loader?
- What replaced PermGen in Java 8 and why?
- In what order do static blocks, instance blocks, and constructors run when you create an object of a subclass?
- What does the JIT compiler do and how does it differ from interpretation?

### JVM Memory Model: Heap vs Stack

`java-jvm/heap-vs-stack-memory` — freq: very-high · difficulty: intermediate

Where objects, references, primitives, and method frames live in JVM memory and how memory is partitioned.

**Subtopics:**

- Stack (per-thread) vs heap (shared) allocation
- What lives on the stack: local primitives, references, method frames
- What lives on the heap: objects and instance fields
- Young generation (Eden, survivor spaces) vs old/tenured generation
- Object promotion and generational hypothesis
- String pool / string interning and where it resides
- StackOverflowError vs OutOfMemoryError
- Escape analysis and stack allocation of objects
- Pass-by-value semantics for references in Java
- Metaspace and off-heap memory basics

**Sample interview questions:**

- What is the difference between stack memory and heap memory in Java?
- When you write `String s = new String("a")`, what gets created and where does it live?
- Is Java pass-by-value or pass-by-reference? Explain with an example.
- What causes a StackOverflowError versus an OutOfMemoryError?
- Explain the generational structure of the heap: Eden, survivor spaces, and old generation.
- Where is the string constant pool stored, and how does interning work?
- How does the JVM decide to promote an object from young to old generation?

### Garbage Collection

`java-jvm/garbage-collection` — freq: very-high · difficulty: advanced

How the JVM reclaims unreachable objects, the algorithms behind it, and how to tune and diagnose GC.

**Subtopics:**

- Reachability and GC roots
- Mark-sweep, mark-compact, and copying collectors
- Minor GC vs major/full GC
- Stop-the-world pauses
- Collectors: Serial, Parallel, CMS, G1, ZGC, Shenandoah
- finalize(), why it is deprecated, and Cleaner/PhantomReference
- Strong, soft, weak, and phantom references
- Memory leaks in Java despite GC (static collections, listeners, ThreadLocal)
- GC tuning flags and heap sizing (-Xms, -Xmx)
- Reading GC logs and diagnosing long pauses

**Sample interview questions:**

- How does garbage collection work in Java? What makes an object eligible for collection?
- What are GC roots and how does reachability determine liveness?
- Explain the difference between minor GC and full GC.
- Compare the G1 collector with the older CMS and Parallel collectors.
- Can you have a memory leak in Java even though there is a garbage collector? Give an example.
- Explain strong, soft, weak, and phantom references and when you would use each.
- Why is finalize() discouraged, and what should you use instead?
- How would you diagnose and fix a service experiencing long GC pause times?

### Multithreading & Concurrency Fundamentals

`java-jvm/multithreading-concurrency` — freq: very-high · difficulty: advanced

Thread lifecycle, creating and coordinating threads, and the core problems of concurrent programming.

**Subtopics:**

- Thread lifecycle and states (NEW, RUNNABLE, BLOCKED, WAITING, TIMED_WAITING, TERMINATED)
- Runnable vs Callable vs Thread; Future
- wait(), notify(), notifyAll() and the intrinsic lock
- Race conditions, critical sections, and atomicity
- Deadlock, livelock, and starvation
- Producer-consumer and BlockingQueue
- sleep() vs wait() vs yield() vs join()
- Thread interruption and cooperative cancellation
- Daemon vs user threads
- Virtual threads (Project Loom, Java 21) at a high level

**Sample interview questions:**

- What are the different states in a thread's lifecycle?
- What is the difference between wait() and sleep()?
- Explain what a deadlock is and describe the four conditions required for it to occur.
- How would you implement a producer-consumer pattern in Java?
- What is the difference between Runnable and Callable?
- Why must wait() and notify() be called from within a synchronized block?
- How do you safely stop a running thread in Java?
- What are virtual threads and how do they differ from platform threads?

### synchronized, volatile & the Java Memory Model

`java-jvm/synchronized-volatile-jmm` — freq: very-high · difficulty: advanced

How Java guarantees visibility and ordering of memory operations across threads and the primitives that provide them.

**Subtopics:**

- Java Memory Model: happens-before relationship
- Visibility vs atomicity vs ordering
- volatile keyword semantics and limits
- synchronized methods vs synchronized blocks; object vs class locks
- Reentrant locking with intrinsic monitors
- Atomic classes (AtomicInteger, AtomicReference) and CAS
- Double-checked locking and why volatile is required
- Memory barriers / fences and instruction reordering
- Why volatile does not make compound operations thread-safe
- ThreadLocal and its memory-leak pitfalls

**Sample interview questions:**

- What does the volatile keyword do, and what problem does it solve?
- What is the difference between volatile and synchronized?
- Explain the happens-before relationship in the Java Memory Model.
- Is `count++` thread-safe if count is volatile? Why or why not?
- How would you implement a correct thread-safe singleton with double-checked locking?
- What is compare-and-swap (CAS) and how do the Atomic classes use it?
- What is the difference between locking on an instance and locking on the class object?
- What is a ThreadLocal and when would it cause a memory leak?

### Executor Framework & java.util.concurrent

`java-jvm/executor-framework-concurrency-utils` — freq: high · difficulty: advanced

Managing thread pools and higher-level concurrency utilities instead of raw threads.

**Subtopics:**

- Executor, ExecutorService, ScheduledExecutorService
- ThreadPoolExecutor parameters (core/max pool size, queue, keep-alive, rejection policy)
- Executors factory methods and their pitfalls (unbounded queues/threads)
- Future, Callable, and CompletableFuture composition
- ForkJoinPool and work-stealing; parallel streams backing pool
- Locks: ReentrantLock, ReadWriteLock, StampedLock vs synchronized
- Coordination utilities: CountDownLatch, CyclicBarrier, Semaphore, Phaser
- Concurrent collections: ConcurrentHashMap, CopyOnWriteArrayList, BlockingQueue
- Graceful shutdown: shutdown() vs shutdownNow() and awaitTermination
- Choosing pool sizes for CPU-bound vs IO-bound work

**Sample interview questions:**

- Why should you use the Executor framework instead of creating threads manually?
- Explain the core parameters of ThreadPoolExecutor and how a task flows through it.
- What happens when a thread pool's queue is full? Describe the rejection policies.
- Why is Executors.newFixedThreadPool considered risky in production?
- What is the difference between submit() and execute()?
- How does CompletableFuture let you compose asynchronous operations?
- Compare ReentrantLock with the synchronized keyword — when would you choose one?
- What is the difference between CountDownLatch and CyclicBarrier?

### Collections Framework & HashMap Internals

`java-jvm/collections-hashmap-internals` — freq: very-high · difficulty: intermediate

The core collection interfaces and implementations, with deep focus on how HashMap works under the hood.

**Subtopics:**

- List vs Set vs Map vs Queue and common implementations
- ArrayList vs LinkedList performance trade-offs
- HashMap internals: buckets, hashing, load factor, resizing/rehashing
- Collision handling: chaining and treeification (Java 8 red-black tree)
- hashCode() and equals() contract and why both matter
- HashMap vs HashTable vs ConcurrentHashMap vs LinkedHashMap vs TreeMap
- How ConcurrentHashMap achieves thread safety (bucket-level / CAS, no full-map lock)
- Fail-fast vs fail-safe iterators and ConcurrentModificationException
- Comparable vs Comparator
- Behavior of null keys/values across map implementations

**Sample interview questions:**

- How does HashMap work internally? Walk through what happens on put() and get().
- What is the load factor, and what happens during resizing?
- How were collisions handled before Java 8, and what changed in Java 8?
- What is the contract between hashCode() and equals()? What breaks if you violate it?
- How is ConcurrentHashMap different from HashTable and a synchronized HashMap?
- What is a fail-fast iterator, and when do you get a ConcurrentModificationException?
- When would you use a TreeMap over a HashMap?
- What is the difference between Comparable and Comparator?

### Java 8+ Features: Lambdas, Streams & Optional

`java-jvm/java8-streams-lambdas-optional` — freq: very-high · difficulty: intermediate

Functional-style programming in modern Java: lambdas, functional interfaces, the Streams API, and Optional.

**Subtopics:**

- Lambda expressions and functional interfaces (@FunctionalInterface)
- Built-in functional interfaces (Function, Predicate, Consumer, Supplier)
- Method and constructor references
- Stream pipeline: source, intermediate (lazy) vs terminal (eager) operations
- map/filter/reduce, collect, and the Collectors API (groupingBy, joining)
- Sequential vs parallel streams and when parallel hurts
- Optional: creation, orElse/orElseGet/orElseThrow, map/flatMap, anti-patterns
- default and static methods in interfaces
- Streams vs loops: readability and performance considerations
- Newer features: var, records, sealed classes, switch expressions, text blocks

**Sample interview questions:**

- What is a functional interface, and can you name a few from the standard library?
- Explain the difference between intermediate and terminal stream operations.
- Why are streams lazy, and how does that affect performance?
- How would you group a list of employees by department using streams?
- What problem does Optional solve, and what is the difference between orElse and orElseGet?
- When is a parallel stream a bad idea?
- What is the difference between map() and flatMap() in the Stream API?
- How do default methods in interfaces work, and why were they added?

### Immutability & String Handling

`java-jvm/immutability-strings` — freq: high · difficulty: intermediate

Why immutability matters, how to design immutable classes, and how Java's String/wrapper types behave.

**Subtopics:**

- Benefits of immutability (thread safety, caching, safe sharing)
- How to design an immutable class (final class, final fields, defensive copies)
- Why String is immutable and its security/performance implications
- String vs StringBuilder vs StringBuffer
- String pool, interning, and == vs equals() for strings
- final keyword: variables, methods, classes
- Records as concise immutable data carriers
- Wrapper class immutability and Integer caching (-128..127)
- Defensive copying of mutable fields and collections
- Shallow vs deep copy / cloning pitfalls

**Sample interview questions:**

- Why is the String class immutable in Java?
- How would you design your own immutable class? What if it holds a mutable field like a List or Date?
- What is the difference between String, StringBuilder, and StringBuffer?
- Why does `Integer a = 127; Integer b = 127; a == b` return true but 128 returns false?
- What are the benefits of immutable objects, especially in concurrent code?
- What does the final keyword mean for a variable, a method, and a class?
- Explain the difference between == and equals() for String objects.
- What is a record in Java and how does it help with immutability?

### Exception Handling

`java-jvm/exception-handling` — freq: very-high · difficulty: beginner

Java's exception hierarchy, checked vs unchecked semantics, and best practices for robust error handling.

**Subtopics:**

- Throwable hierarchy: Error vs Exception; checked vs unchecked (RuntimeException)
- try / catch / finally and multi-catch
- try-with-resources and AutoCloseable
- throw vs throws; exception propagation up the call stack
- Custom exceptions and when to create them
- Exception chaining and preserving root cause
- finally with return statements and resource-leak gotchas
- Checked vs unchecked debate and API design implications
- Best practices: fail fast, don't swallow, specific over generic catches
- Exception handling in streams, lambdas, and framework layers

**Sample interview questions:**

- What is the difference between checked and unchecked exceptions?
- Explain the difference between Error and Exception.
- What is try-with-resources and what problem does it solve?
- If a finally block has a return statement, what happens to an exception thrown in try?
- What is the difference between throw and throws?
- When should you create a custom exception class?
- What are some best practices for exception handling in production services?
- How do you handle checked exceptions inside a lambda passed to a stream?

### OOP Principles & Polymorphism

`java-jvm/oop-principles-polymorphism` — freq: very-high · difficulty: beginner

Object-oriented fundamentals in Java: the four pillars, overloading vs overriding, dynamic dispatch, and class-design trade-offs.

**Subtopics:**

- Four pillars: encapsulation, inheritance, polymorphism, abstraction
- Method overloading (compile-time) vs overriding (runtime) and their rules
- Static (compile-time) binding vs dynamic (runtime) binding / virtual method dispatch
- Interface vs abstract class: capabilities, state, and when to use each
- Inheritance vs composition and 'favor composition over inheritance'
- Overriding rules: covariant return types, access modifiers, exception narrowing
- Access modifiers (private, package-private/default, protected, public)
- Can you override static, private, or final methods? method hiding vs overriding
- Multiple inheritance of type via interfaces and the diamond problem with default methods
- SOLID principles and their practical application
- Constructors, super()/this() chaining, and constructor rules with inheritance

**Sample interview questions:**

- What are the four pillars of OOP? Give a concrete Java example of each.
- What is the difference between method overloading and method overriding?
- Explain runtime polymorphism and dynamic method dispatch in Java.
- When would you choose an interface over an abstract class, and vice versa?
- Why is composition often preferred over inheritance?
- Can you override a static, private, or final method? What is method hiding?
- What are the rules for overriding regarding return type, access modifier, and thrown exceptions?
- Briefly explain each of the SOLID principles.

### Generics & the Type System

`java-jvm/generics-type-system` — freq: high · difficulty: intermediate

Parametric polymorphism in Java: generic types and methods, type erasure, wildcards, and their runtime consequences.

**Subtopics:**

- Generic classes, interfaces, and methods
- Type erasure and its runtime consequences (no reified type info)
- Bounded type parameters (<T extends Comparable<T>>)
- Wildcards: unbounded (?), upper-bounded (? extends), lower-bounded (? super)
- PECS principle: Producer Extends, Consumer Super
- Why you cannot do new T(), new T[], or instanceof T
- Reifiable vs non-reifiable types; heap pollution and @SafeVarargs
- Raw types, unchecked warnings, and backward compatibility
- Bridge methods and how erasure interacts with overriding
- Type inference and the diamond operator (<>)

**Sample interview questions:**

- What is type erasure and what practical limitations does it impose?
- Explain the difference between List<? extends Number> and List<? super Number>.
- What does the PECS principle mean and when do you apply it?
- Why can't you write `new T()` or `new T[10]` inside a generic class?
- What is the difference between a raw type and a parameterized type, and why do raw types exist?
- Can two methods be overloaded if they differ only in generic type parameter? Why or why not?
- What is a bounded type parameter and when would you use one?
- What is heap pollution and how does @SafeVarargs relate to it?

### Reflection, Annotations & Dynamic Proxies

`java-jvm/reflection-annotations-proxies` — freq: high · difficulty: advanced

Runtime metaprogramming that underpins modern frameworks: inspecting types, custom annotations, and generating proxies.

**Subtopics:**

- Reflection API: Class, Method, Field, Constructor, and setAccessible
- Runtime inspection and invocation, including accessing private members
- Built-in annotations, meta-annotations (@Retention, @Target, @Inherited)
- Writing custom annotations and processing them at runtime
- Retention policies (SOURCE, CLASS, RUNTIME) and compile-time vs runtime processing
- Annotation processors (APT) and code generation (e.g., Lombok, MapStruct)
- JDK dynamic proxies (Proxy, InvocationHandler) vs CGLIB / bytecode proxies
- How Spring, Hibernate, Jackson, and JUnit use reflection and annotations
- Performance and security costs of reflection
- Reflection under the module system (Java 9+) and illegal-access restrictions

**Sample interview questions:**

- What is reflection and what are some real framework use cases for it?
- How do frameworks like Spring use annotations and reflection under the hood?
- What are the three annotation retention policies, and which one is required for runtime processing?
- How would you define a custom annotation and read it at runtime?
- What is a JDK dynamic proxy, and how does it differ from a CGLIB proxy?
- What are the performance and security downsides of using reflection?
- How can you read or modify a private field using reflection, and should you?
- What is the difference between compile-time annotation processing and runtime reflection?

### Object Class Contract: equals, hashCode, toString & clone

`java-jvm/object-methods-equality` — freq: very-high · difficulty: intermediate

The methods every Java object inherits and the contracts they must honor, especially equals/hashCode for use in collections.

**Subtopics:**

- Methods inherited from java.lang.Object
- equals() contract: reflexive, symmetric, transitive, consistent, null-handling
- hashCode() contract and its relationship with equals()
- Consequences of overriding one without the other (broken HashMap/HashSet keys)
- Implementing correct equals/hashCode with Objects.equals and Objects.hash
- == (identity) vs equals() (logical equality) for objects and primitives
- toString() best practices and IDE/record-generated implementations
- clone() and Cloneable pitfalls; shallow vs deep copy; copy constructors as alternatives
- getClass() vs instanceof in equals() and the symmetry trap with subclasses
- Using mutable objects as map keys and why immutability helps

**Sample interview questions:**

- What is the contract between equals() and hashCode()?
- What happens if you override equals() but not hashCode() and use the object as a HashMap key?
- How do you correctly implement equals() and hashCode() for a class?
- What is the difference between == and equals()?
- Why is clone()/Cloneable considered problematic, and what should you use instead?
- Should you use getClass() or instanceof inside equals()? What are the trade-offs?
- What is the difference between a shallow copy and a deep copy?
- Why is it dangerous to mutate an object after it has been used as a key in a HashMap?

### Design Patterns (framework-relevant)

`java-jvm/design-patterns-java` — freq: high · difficulty: intermediate

Common creational, structural, and behavioral patterns as they appear in the JDK and frameworks like Spring.

**Subtopics:**

- Creational: Singleton (thread-safe variants), Factory, Abstract Factory, Builder
- Structural: Adapter, Decorator, Proxy, Facade
- Behavioral: Observer, Strategy, Template Method, Chain of Responsibility
- Dependency Injection / Inversion of Control and how DI containers work
- Singleton pitfalls: serialization, reflection, cloning, and the enum singleton
- Patterns inside the JDK (Runtime singleton, Collections factory methods, java.io Decorator)
- Immutable Builder pattern for complex object construction
- Patterns in Spring (proxy-based AOP, template method, factory beans, IoC)
- Choosing between Strategy and Template Method
- Anti-patterns and over-application of patterns

**Sample interview questions:**

- How do you implement a thread-safe singleton, and why is the enum approach often recommended?
- What is dependency injection and what problem does it solve?
- What is the difference between the Factory and Abstract Factory patterns?
- When would you use the Builder pattern instead of a constructor?
- What is the Decorator pattern, and where is it used in the java.io library?
- How does the Strategy pattern differ from the Template Method pattern?
- Give examples of design patterns used inside the JDK or Spring.
- How can a singleton be broken by reflection or serialization, and how do you prevent it?

### Serialization & Deserialization

`java-jvm/serialization` — freq: medium · difficulty: intermediate

Turning objects into a persistable/transmittable form, versioning concerns, and the security risks of native deserialization.

**Subtopics:**

- Serializable vs Externalizable interfaces
- serialVersionUID and versioning/compatibility across class changes
- transient fields and what is excluded from serialization
- Custom serialization hooks: writeObject/readObject, writeReplace/readResolve
- Serialization and inheritance (non-serializable superclass, constructor invocation)
- Security risks of Java deserialization and gadget chains
- Alternatives: JSON (Jackson/Gson), Protocol Buffers, Avro, and their trade-offs
- Deep copy via serialization
- Preserving singletons across deserialization with readResolve
- Performance and payload-size considerations

**Sample interview questions:**

- What is serialization, and how do you make a class serializable?
- What is serialVersionUID and why does it matter?
- What does the transient keyword do?
- What are the security risks of native Java deserialization, and how do you mitigate them?
- How can you customize the serialization process for a class?
- How does serialization behave when a superclass is not Serializable?
- Why might you prefer JSON or Protobuf over Java's built-in serialization?
- How would you preserve a singleton's uniqueness across deserialization?

<a id="messaging-databases"></a>
## Messaging & Databases

Folder: `topics/messaging-databases/` · 12 topics

### Relational Modeling & Normalization

`messaging-databases/relational-modeling-normalization` — freq: high · difficulty: beginner

Designing relational schemas using keys, relationships, and normal forms to reduce redundancy and anomalies.

**Subtopics:**

- Primary keys, foreign keys, composite keys, surrogate vs natural keys
- Functional dependencies and normal forms (1NF, 2NF, 3NF, BCNF)
- Update/insert/delete anomalies
- Denormalization and when to trade normalization for read performance
- One-to-one, one-to-many, many-to-many relationships and junction tables
- Entity-Relationship (ER) modeling
- Star vs snowflake schemas (OLTP vs OLAP)
- Referential integrity, cascading actions (ON DELETE/UPDATE CASCADE), and constraints (CHECK, NOT NULL, UNIQUE)
- Modeling hierarchical/tree data (adjacency list, nested set, closure table)

**Sample interview questions:**

- What is database normalization and why do we do it?
- Explain 1NF, 2NF, and 3NF with an example of a table that violates each.
- What is the difference between 3NF and BCNF?
- When would you intentionally denormalize a schema, and what are the risks?
- What are insertion, update, and deletion anomalies? Give an example.
- How do you model a many-to-many relationship in a relational database?
- What is the difference between a primary key and a unique key?
- How would you model a hierarchical structure like an org chart or category tree in SQL?
- What does ON DELETE CASCADE do, and when is it dangerous?

### SQL Query Language & Advanced Queries

`messaging-databases/sql-query-language-advanced-queries` — freq: very-high · difficulty: intermediate

Writing and reasoning about SQL: joins, aggregation, subqueries, CTEs, window functions, and safe parameterized queries.

**Subtopics:**

- JOIN types: INNER, LEFT/RIGHT/FULL OUTER, CROSS, SELF join
- Aggregation with GROUP BY, HAVING, and aggregate functions (COUNT, SUM, AVG, MIN, MAX)
- Subqueries: scalar, correlated, IN/EXISTS/ANY/ALL
- Common Table Expressions (CTEs) and recursive CTEs
- Window/analytic functions (ROW_NUMBER, RANK, DENSE_RANK, LAG/LEAD, running totals, PARTITION BY)
- Set operations: UNION vs UNION ALL, INTERSECT, EXCEPT
- NULL handling, three-valued logic, COALESCE/NULLIF, and NULL in aggregates/joins
- SQL logical execution order (FROM > WHERE > GROUP BY > HAVING > SELECT > ORDER BY > LIMIT)
- SQL injection and prevention with prepared statements / parameterized queries
- Deduplication, top-N-per-group, and pagination (OFFSET vs keyset/seek pagination)

**Sample interview questions:**

- What is the difference between an INNER JOIN and a LEFT JOIN? When does a LEFT JOIN produce NULLs?
- What is the difference between WHERE and HAVING?
- Write a query to find the second-highest salary (and generalize to Nth-highest).
- Find the top N records per group (e.g., top 3 products by sales per category).
- What is a correlated subquery and how does it differ from a regular subquery?
- What are window functions? Give an example using ROW_NUMBER or RANK.
- What is the difference between UNION and UNION ALL, and which is faster?
- In what logical order are the clauses of a SELECT statement evaluated?
- How does NULL behave in comparisons, aggregates, and joins?
- What is SQL injection and how do prepared statements prevent it?
- Why is keyset (seek) pagination often better than OFFSET/LIMIT for large tables?

### SQL Indexing & Query Optimization

`messaging-databases/sql-indexing-query-optimization` — freq: very-high · difficulty: intermediate

How indexes work internally and how to read query plans to make queries fast.

**Subtopics:**

- B-tree vs hash vs bitmap indexes
- Clustered vs non-clustered indexes
- Composite indexes and leftmost-prefix rule
- Covering indexes and index-only scans
- EXPLAIN / EXPLAIN ANALYZE and reading query plans
- When indexes are NOT used (functions on columns, leading wildcards, low selectivity, implicit type casts)
- Index tradeoffs: write amplification, storage, maintenance
- Full table scan vs index scan vs index seek
- N+1 query problem and join optimization
- Partial/filtered indexes, expression/functional indexes, and GIN/GiST for full-text/JSON
- Query planner cost estimation, statistics/cardinality, and how stale statistics cause bad plans

**Sample interview questions:**

- How does a B-tree index speed up lookups, and what is its time complexity?
- What is the difference between a clustered and a non-clustered index?
- You have an index on (a, b, c). Which queries can use it and which cannot?
- Why might the database ignore your index even though it exists?
- What is a covering index and when is it useful?
- How do you use EXPLAIN to diagnose a slow query?
- What are the downsides of adding too many indexes?
- How would you optimize a query that is doing a full table scan on a large table?
- What is the N+1 query problem and how do you fix it?
- How does the query planner decide between an index scan and a sequential scan, and why do stale statistics matter?

### Transactions, ACID & Isolation Levels

`messaging-databases/transactions-acid-isolation-levels` — freq: very-high · difficulty: intermediate

Guarantees databases provide for concurrent, reliable operations and the tradeoffs between consistency and concurrency.

**Subtopics:**

- ACID properties (Atomicity, Consistency, Isolation, Durability)
- Read phenomena: dirty read, non-repeatable read, phantom read, lost update
- Isolation levels: Read Uncommitted, Read Committed, Repeatable Read, Serializable
- Locking: shared vs exclusive, row vs table, optimistic vs pessimistic, lock escalation
- MVCC (Multi-Version Concurrency Control)
- Deadlocks: detection, prevention, and resolution
- Two-phase commit and distributed transactions
- Snapshot isolation and write skew
- SELECT ... FOR UPDATE and row-level locking
- How WAL / redo-undo logs enable atomicity and durability

**Sample interview questions:**

- What does ACID stand for and what does each property guarantee?
- Explain the difference between a dirty read, a non-repeatable read, and a phantom read.
- Which isolation level prevents phantom reads, and how?
- What is the default isolation level in PostgreSQL / MySQL and why?
- What is MVCC and how does it allow reads without blocking writes?
- How do deadlocks occur and how would you prevent or resolve them?
- What is the difference between optimistic and pessimistic locking?
- How would you handle a transaction that spans two different databases?
- What is the lost-update problem and how do SELECT ... FOR UPDATE or version columns fix it?
- What is write skew and why can it occur under snapshot isolation but not serializable?

### Database Storage Internals & Engines

`messaging-databases/database-storage-internals-engines` — freq: medium · difficulty: advanced

How databases physically store, read, and durably persist data — the engine-level foundations behind indexes and transactions.

**Subtopics:**

- B-tree/B+-tree storage vs LSM-tree (log-structured merge) storage
- Write-ahead logging (WAL) / redo logs and durability
- Buffer pool / page cache and dirty page flushing
- Pages, heap files, row vs columnar storage (OLTP vs OLAP/analytics)
- LSM internals: memtable, SSTables, compaction, and read/write amplification
- Storage engine comparison (e.g., InnoDB vs MyISAM, RocksDB, Bitcask)
- fsync, checkpoints, and the durability/performance tradeoff
- Bloom filters for read-path optimization in LSM stores
- Vacuum/compaction and space reclamation (e.g., Postgres autovacuum, tombstones)

**Sample interview questions:**

- What is the difference between a B-tree and an LSM-tree, and which is better for write-heavy workloads?
- What is a write-ahead log (WAL) and why is it essential for durability?
- Why are databases like Cassandra and RocksDB optimized for writes?
- What is write amplification and read amplification, and how does compaction relate to them?
- What is the buffer pool and how does it affect performance?
- What is the difference between row-oriented and column-oriented storage, and when do you use each?
- How do Bloom filters speed up reads in an LSM-based store?
- What are the tradeoffs of calling fsync on every commit?
- What are tombstones, and why can they hurt read performance in LSM stores?

### NoSQL Databases & Data Models

`messaging-databases/nosql-databases-data-models` — freq: very-high · difficulty: intermediate

The four NoSQL families, when to choose them over relational stores, and the consistency tradeoffs involved.

**Subtopics:**

- Document stores (MongoDB), key-value (DynamoDB), wide-column (Cassandra), graph (Neo4j)
- SQL vs NoSQL tradeoffs and when to pick each
- CAP theorem and PACELC
- Eventual vs strong consistency, tunable consistency (quorum reads/writes, R+W>N)
- Data modeling for access patterns (denormalization, embedding vs referencing)
- Partition keys, sharding, and hot partitions
- BASE vs ACID
- Horizontal vs vertical scaling
- Consistent hashing and data distribution
- Secondary indexes in NoSQL (local vs global) and single-table design (DynamoDB)
- Conflict resolution: last-write-wins, vector clocks, CRDTs

**Sample interview questions:**

- What are the main types of NoSQL databases and what is each best suited for?
- When would you choose a NoSQL database over a relational database?
- Explain the CAP theorem. Can a system be both consistent and available during a partition?
- What is the difference between eventual consistency and strong consistency?
- How does data modeling differ between a relational DB and a document store like MongoDB?
- What is a partition/shard key and how do you avoid hot partitions?
- What is the difference between ACID and BASE?
- Would you use SQL or NoSQL for a system with heavy relational joins and complex transactions? Why?
- How do quorum reads/writes (R + W > N) give you tunable consistency?
- What is consistent hashing and why is it used for data distribution?
- How do systems resolve conflicting concurrent writes (LWW, vector clocks, CRDTs)?

### Redis & Caching Strategies

`messaging-databases/redis-caching-strategies` — freq: very-high · difficulty: intermediate

Using Redis as an in-memory data store and cache, its data structures, and cache design patterns.

**Subtopics:**

- Redis data structures (strings, hashes, lists, sets, sorted sets, streams, bitmaps, HyperLogLog)
- Caching patterns: cache-aside, read-through, write-through, write-behind
- Cache eviction policies (LRU, LFU, TTL) and expiration
- Cache invalidation strategies
- Cache stampede, penetration, and avalanche problems
- Redis persistence: RDB snapshots vs AOF
- Redis as distributed lock (Redlock) and rate limiter
- Redis replication, Sentinel, and Cluster mode
- Pub/Sub and Redis Streams
- Single-threaded event loop, pipelining, and Lua scripting for atomicity
- Hot-key problems and cache consistency with the source of truth

**Sample interview questions:**

- What is the difference between cache-aside and write-through caching?
- How would you handle cache invalidation in a distributed system?
- What is a cache stampede and how do you prevent it?
- What Redis data structures would you use to build a leaderboard / rate limiter?
- How does Redis persist data, and what is the difference between RDB and AOF?
- Redis is single-threaded — how does it still achieve such high throughput?
- How would you implement a distributed lock with Redis, and what are the pitfalls?
- What eviction policy would you choose for a cache and why?
- What are cache penetration and cache avalanche, and how do you mitigate each?
- How do you keep a cache consistent with the database, and why is invalidation hard?

### Database Scaling: Replication, Read Replicas & Connection Pooling

`messaging-databases/database-scaling-replication-pooling` — freq: high · difficulty: advanced

Techniques to scale databases beyond a single node: replication, read replicas, sharding, partitioning, and efficient connection management.

**Subtopics:**

- Primary-replica replication (synchronous vs asynchronous, semi-synchronous)
- Read replicas and read/write splitting
- Replication lag and reading stale data / read-your-own-writes
- Failover and promotion of replicas, split-brain
- Sharding / horizontal partitioning strategies (range, hash, directory/lookup)
- Vertical vs horizontal partitioning
- Connection pooling (why it matters, sizing, pgbouncer/HikariCP)
- Multi-primary replication and conflict resolution
- Cross-shard queries, resharding, and distributed joins
- Backup and recovery, point-in-time recovery (PITR), RPO/RTO

**Sample interview questions:**

- What is a read replica and how does it help you scale?
- What is replication lag and how do you handle reading your own writes?
- What is the difference between synchronous and asynchronous replication?
- What is connection pooling and why is it important for database performance?
- How do you size a connection pool, and what happens if it is too large?
- Explain sharding. What strategies exist for choosing a shard key?
- How does failover work when the primary database goes down, and what is split-brain?
- What is the difference between horizontal and vertical partitioning?
- How do you handle queries that need to span multiple shards?
- What are RPO and RTO, and how does point-in-time recovery work?

### Apache Kafka

`messaging-databases/apache-kafka` — freq: very-high · difficulty: advanced

Kafka's log-based architecture: topics, partitions, consumer groups, offsets, and its delivery/ordering guarantees.

**Subtopics:**

- Topics, partitions, and the partitioned commit log
- Producers, partitioning/keying, and acks (0/1/all)
- Consumer groups, rebalancing, and parallelism
- Offsets, offset commits (auto vs manual), and consumer position
- Delivery semantics: at-most-once, at-least-once, exactly-once
- Replication, leaders/followers, and ISR (in-sync replicas)
- Ordering guarantees (per-partition) and message keys
- Log retention, compaction, and log segments
- Idempotent and transactional producers
- Kafka Connect, schema registry (Avro/Protobuf), and schema evolution/compatibility
- Cluster coordination (ZooKeeper vs KRaft) and controller role
- Consumer lag, throughput/latency tuning (batch size, linger, compression)

**Sample interview questions:**

- How does Kafka achieve scalability and parallelism through partitions?
- What is a consumer group and what happens during a rebalance?
- How are offsets managed, and what is the difference between auto-commit and manual commit?
- How does Kafka guarantee message ordering, and what are its limits?
- Explain at-least-once vs exactly-once delivery in Kafka. How is exactly-once achieved?
- What do producer acks=0, acks=1, and acks=all mean?
- What is an ISR (in-sync replica) and how does it relate to durability?
- What is the difference between log retention and log compaction?
- What happens if you have more consumers than partitions in a consumer group?
- What is a schema registry and why is schema evolution important in Kafka?
- How would you choose the number of partitions for a topic?

### RabbitMQ & Message Queue Patterns

`messaging-databases/rabbitmq-message-queues` — freq: high · difficulty: intermediate

Traditional broker-based messaging with RabbitMQ: exchanges, routing, acknowledgments, and queue patterns.

**Subtopics:**

- Exchanges (direct, topic, fanout, headers) and bindings
- Queues, routing keys, and message routing
- Producer/consumer acknowledgments and prefetch (QoS)
- Message durability, persistence, and publisher confirms
- Dead-letter exchanges/queues and retry handling
- Work queues (competing consumers) and pub/sub patterns
- Kafka vs RabbitMQ: log vs broker, pull vs push, replay vs delete-on-consume
- Message TTL, priority queues, and backpressure
- Quorum queues / mirrored queues and high availability
- Request-reply and RPC over messaging

**Sample interview questions:**

- What are the different exchange types in RabbitMQ and how does each route messages?
- How do message acknowledgments work in RabbitMQ, and what happens on a nack?
- What is a dead-letter queue and when would you use one?
- How do you ensure a message is not lost if the broker or consumer crashes?
- What is prefetch count and how does it affect throughput and fairness?
- Compare RabbitMQ and Kafka — when would you choose one over the other?
- How would you implement a retry-with-backoff mechanism in RabbitMQ?
- What is the competing-consumers pattern and how does RabbitMQ support it?
- How does RabbitMQ provide high availability with quorum or mirrored queues?
- Why can Kafka replay messages but a classic queue cannot?

### Messaging Reliability & Distributed Messaging Patterns

`messaging-databases/messaging-reliability-patterns` — freq: high · difficulty: advanced

Cross-cutting patterns for building reliable, consistent event-driven systems on top of message brokers.

**Subtopics:**

- Idempotent consumers and deduplication
- Delivery semantics tradeoffs (at-most/at-least/exactly-once) in practice
- Outbox pattern and the dual-write problem
- Saga pattern for distributed transactions (choreography vs orchestration)
- Event sourcing and CQRS
- Ordering, partitioning, and message keys across systems
- Poison messages, dead-letter handling, and retries/backoff
- Backpressure, consumer lag monitoring, and throughput tuning
- Transactional outbox vs listen-to-yourself vs 2PC tradeoffs
- Message schema versioning and backward/forward compatibility

**Sample interview questions:**

- How do you make a message consumer idempotent?
- What is the dual-write problem and how does the outbox pattern solve it?
- Explain the saga pattern. What is the difference between choreography and orchestration?
- How do you handle a poison message that keeps failing processing?
- Why is exactly-once delivery hard, and how do systems approximate it?
- How would you guarantee ordered processing of events for a given entity across a distributed system?
- What is consumer lag and how do you monitor and reduce it?
- When would you use event sourcing and CQRS, and what are the tradeoffs?
- How do you evolve a message schema without breaking existing consumers?
- How would you implement a compensating transaction when one step of a saga fails?

### Stream Processing & Change Data Capture

`messaging-databases/stream-processing-cdc` — freq: medium · difficulty: advanced

Processing continuous event streams and capturing database changes to keep systems and data stores in sync.

**Subtopics:**

- Change Data Capture (CDC) and log-based capture (Debezium, binlog/WAL tailing)
- Stream processing frameworks (Kafka Streams, Apache Flink, Spark Structured Streaming)
- Windowing: tumbling, sliding, session windows
- Event time vs processing time, watermarks, and late/out-of-order events
- Stateful stream processing, aggregations, and stream-table (KTable) joins
- Exactly-once processing and checkpointing/state stores
- Materialized views and keeping caches/search indexes in sync via CDC
- Batch vs stream processing and the Lambda/Kappa architectures

**Sample interview questions:**

- What is Change Data Capture and how does log-based CDC (e.g., Debezium) work?
- How would you keep a search index (Elasticsearch) or cache in sync with your primary database?
- What is the difference between event time and processing time, and what problem do watermarks solve?
- Explain tumbling, sliding, and session windows with an example use case.
- How does a stream processor achieve exactly-once processing across failures?
- What is the difference between a stream and a table in Kafka Streams (stream-table duality)?
- When would you choose stream processing over batch processing?
- Compare the Lambda and Kappa architectures.

