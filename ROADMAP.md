# ROADMAP — Phased build plan & live progress

Update this file at the end of every session. It is the single source of truth for
"what's done / what's next" and pairs with the Claude memory index.

## Phases

### Phase 0 — Foundation ✅ (Session 1)
- [x] Decide content model (linked YAML MCQs). Delivery stack: **Astro web app**
      (an early Python/Textual TUI idea was dropped — see CLAUDE.md).
- [x] Scaffold repo structure.
- [x] Write `README.md`, `CLAUDE.md`, `docs/content-schema.md`.
- [x] Create content templates.
- [x] Set up Claude memory + skills.
- [x] Research & write the full topic taxonomy → `TOPICS.md`.
- [x] Content validation script (`scripts/validate_content.py`).

### Phase 1 — Content authoring (multiple sessions)
Author `concepts.md` + `questions.yaml` per topic. Track per-topic below.
Suggested order: start with high-frequency domains (Docker, Kubernetes,
Spring Boot, System Design fundamentals).

Progress legend: ☐ not started · ◐ concepts done · ● concepts + MCQs done · ✅ validated

See the per-domain checklist in **"Content progress"** below (generated from TOPICS.md).

### Phase 2 — Web application (Astro) (multiple sessions)
- [ ] Scaffold Astro + Tailwind + Preact in `web/`; content sync (`sync-content.mjs`)
      that reads `topics/` → content collection + per-pool question JSON.
- [ ] Pages: landing → grouped catalog → domain (grouped subtopics + filter) →
      subtopic hub → study (concepts.md rendered to HTML) → practice.
- [ ] Practice engine: 25-MCQ sessions (subtopic / group / domain level), shuffled
      questions + options, immediate per-question feedback, score + localStorage history.
- [ ] Deep-link "Learn more" from a question → study page heading anchor.
- [ ] Deploy: static `dist/` to Netlify/Vercel.
- [ ] Tests / smoke checks for the sync pipeline + practice logic.

### Phase 3 — Polish (later)

A researched, prioritized engagement backlog was produced in Session 12 (patterns from
Khan Academy, Duolingo, Anki, Exercism, GitBook et al.; all localStorage-only). Full
plan lives in Claude memory (`web-design-enhancement-plan.md`). Highlights:

- [x] **P0** Mastery grid + `/progress` page (per-subtopic cells from quiz accuracy),
      headline stats, per-domain progress bars. *(Session 14; commit 0ad4aa2)*
- [x] **P0** Streak counter with 1-day grace + header flame pill; milestone
      celebrations (7/14/30/50/100). *(Sessions 14–15)*
- [x] **P0** "Review missed questions" — per-subtopic (`?review=1`), domain-level CTA,
      and per-card "N to review" badges. *(Sessions 14–15)*
- [x] **P1** Session presets (Quick 10 / Focused 25 / All missed) + end-of-session
      summary (per-subtopic breakdown, trend vs last, smart next CTA). *(Session 15)*
- [x] **P1** Client-side search (Pagefind, Cmd+K / "/"), scoped to study content. *(Session 15)*
- [x] **P1** Callout blocks (TIP/WARNING/INTERVIEW/KEY-TAKEAWAY) + reading time +
      page-top scroll-progress bar. *(Session 15)*
- [x] Catalog mastery bars + header "% mastered" pill. *(Session 15)*
- [x] **P2** Domain sidebar nav (disclosure) + prev/next topic pager; per-domain
      Nerd Font icons (subset woff2); welcome-back warm-up banner; difficulty filter
      (difficulty re-added to slim pools); keyboard-shortcut hints; split
      progress/activity reset. *(Session 16)*
      _Sidebar is disclosure-only (not a persistent rail) and omitted on the domain
      page (cards already list subtopics) — deliberate scope calls._
- [ ] **P3** Achievement badges; SRS-light scheduling; self-test `<details>` blocks.
      *(Light-theme toggle shipped in Session 13.)*
- [ ] Multi-answer & code-snippet question types.
- [ ] Import/export progress.

## Content progress

Populated once `TOPICS.md` is generated. Each domain lists its topics with status.
Update the marker as you author each topic.

<!-- CONTENT-PROGRESS-START -->

Per-topic status lives in each `topics/<domain>/README.md`. Domain rollup:

Note: taxonomies for the 6 originally-unauthored domains were revised (Session 17)
and 5 new domains added; counts below reflect the current READMEs.

| Domain | Topics | Authored |
|---|---|---|
| [System Design](topics/system-design/README.md) | 23 core + 8 adv + 7 design-patterns + 26 AWS | 64 ✅ (all tiers) |
| [Spring Boot](topics/spring-boot/README.md) | 18 | 18 ✅ |
| [Spring Framework Core](topics/spring-core/README.md) | 19 | 19 ✅ (all tiers) |
| [Java & JVM (framework-relevant)](topics/java-jvm/README.md) | 25 | 25 ✅ (all tiers) |
| [REST APIs & API Design](topics/rest-api-design/README.md) | 18 | 18 ✅ (all tiers, 1,529 MCQs) |
| [Docker](topics/docker/README.md) | 16 | 0 |
| [Kubernetes](topics/kubernetes/README.md) | 19 | 0 |
| [DevOps & CI/CD](topics/devops-cicd/README.md) | 21 | 0 |
| [Hibernate & JPA](topics/hibernate-jpa/README.md) | 18 | 0 |
| [Apache Tomcat](topics/apache-tomcat/README.md) | 19 | 0 |
| [Messaging & Databases](topics/messaging-databases/README.md) | 15 | 15 ✅ (Pass 1, 815 MCQs) |
| [Security (App & Web)](topics/security/README.md) | 16 | 16 ✅ (all tiers, 1,291 MCQs) |
| [Networking & Protocols](topics/networking/README.md) | 16 | 16 ✅ (all tiers, 1,372 MCQs) |
| [Observability](topics/observability/README.md) | 17 | 0 |
| [Software Testing](topics/testing/README.md) | 16 | 0 |

<!-- CONTENT-PROGRESS-END -->

## Session log

- **Session 26 (2026-07-20):** System Design **Design Patterns** group added — 7 new topics
  (`dp-` prefix, new "Design Patterns" catalog group in sync), **427 MCQs**. Covers ALL 23
  GoF patterns (5 creational / 7 structural / 11 behavioral — completeness asserted), plus
  enterprise (Fowler PoEAA), concurrency (POSA), and distributed/cloud patterns. Each pattern
  has a "Problem it solves" line, a Mermaid diagram (218 total, all render 0-error), a concrete
  example, and trade-offs; distributed-pattern topics cross-reference existing deep-dives.
  Built via `.claude/workflows/scripts/design-patterns-authoring.js` (research → author →
  verify with a completeness gate, high effort). One research agent (dp-behavioral) died on a
  transient API error; resume-from-runId recovered it (cached topics replayed). Verify stage
  added missing content (Two-Phase Termination pattern, 8 missing diagrams) and fixed invalid
  Mermaid (semicolons in sequenceDiagram messages break the parser). Validator clean; no answer
  clustering. Content-only commit (concurrent web-design work untouched). NEXT: Architectural
  Patterns group (`arch-` prefix, workflow written & ready) — fires next, cross-references these.
- **Session 25 (2026-07-20):** Messaging & Databases **Pass 1** — authored all 15 topics,
  **815 MCQs** (163 B / 438 I / 214 adv; 48-65/topic). Practitioner/mechanism-level (real SQL,
  index B-tree/LSM internals, ACID isolation anomalies, Kafka log/consumer-group protocol, Redis
  commands, RabbitMQ AMQP, replication WAL/binlog) — deliberately DEEPER/more hands-on than the
  system-design pages on overlapping topics; ORM excluded (Hibernate/JPA is its own domain).
  Diagrams authored as Mermaid (no ASCII-art), so no later conversion pass needed. Built via
  `.claude/workflows/scripts/messaging-databases-authoring.js` (author → verify). First run hit an
  AWS credential-timeout wave (13/15 verify + 1 author failed); resume-from-runId recovered all
  (cached authors replayed, only failed stages re-ran) → 30 agents, 0 errors. Verify self-caught +
  rebalanced sql-indexing answer clustering (39/48 on idx1). THEN a targeted SQL enrichment pass
  (`messaging-databases-sql-enrich.js`) reconciled the 3 SQL topics against the Devinterview SQL
  interview reference — added SQL command taxonomy (DDL/DML/DCL/TCL/DQL), deeper LATERAL JOIN,
  JSONB+GIN, UUIDv7-vs-v4 & GENERATED IDENTITY key design, SARGable as a named concept (+25 MCQs).
  Validator clean (15 files, 815 Qs); no answer clustering (top ≤31%); promoted to AUTHORED_DOMAINS.
  Content-only commit (concurrent web-design work left untouched). Pass 2 (deepen to 70-90) TODO.
- **Session 22 (2026-07-19):** Security (Application & Web) **Pass 2 (deepen)** — took all 16
  topics from 813 → **1,291 MCQs** (172 B / 449 I / 401 adv / 269 expert; every topic 74-92,
  strong adv+expert block 37-52/topic). Built via `.claude/workflows/scripts/security-deepen.js`
  (research → deepen → verify, high effort, 48 agents, 0 errors). Research stage did exhaustive
  OWASP/NIST/RFC/PortSwigger gap-analysis per topic; deepen added real-CVE/attack-internals depth
  (alg-confusion & psychic-signatures for JWT, DPoP/PAR/mix-up for OAuth, mXSS/Trusted-Types/CSP-
  bypass for XSS, DNS-rebinding/IMDSv2 for SSRF, Rapid-Reset/GCRA for rate-limiting, envelope-
  encryption/crypto-shredding for secrets, ML-KEM/ML-DSA & padding-oracle mechanics for crypto).
  Verify stage fact-checked defense correctness (no insecure fix is ever the key), fixed an
  Argon2id RFC 9106 p-param error, and rebalanced several clustered answer distributions. Content-
  only commit (concurrent web-design work untouched). Validator clean (16 files, 1,291 Qs); no
  answer-index clustering (top share ≤34% every topic). Security now complete across all four tiers.
- **Session 21 (2026-07-19):** Security (Application & Web) **Pass 1** — authored all 16
  topics, **813 MCQs** (173 B / 428 I / 212 adv; 46-55/topic). Framework-agnostic,
  OWASP/NIST/RFC-grounded (OWASP Top 10 2021, ASVS, NIST SP 800-63B/57/207, OAuth 6749/
  PKCE 7636, JWT 7519/JWS 7515, TOTP 6238/HOTP 4226, Cookie 6265, Argon2id RFC 9106).
  Built via `.claude/workflows/scripts/security-authoring.js` (author → verify, 32 agents,
  0 errors). Boundary reconciliation: OAuth/OIDC/JWT taught at protocol/threat level
  (rest-api-design owns API-contract view), crypto primitives only (networking owns TLS),
  web OWASP Top 10 references but doesn't duplicate the API Top 10. Verify stage fact-checked
  algorithm params + defense correctness. Post-check caught answer clustering in 2 topics
  (jwt 43%, rate-limiting 46%) that verify missed — rebalanced deterministically to ~25%
  (correctness preserved). Validator clean (16 files, 813 Qs); promoted to AUTHORED_DOMAINS.
  Content-only commit (concurrent web-design work left untouched). Pass 2 (deepen to 70-90)
  still TODO.
- **Session 20 (2026-07-19):** Networking & Protocols **Pass 2 (deepen)** — took all 16
  topics from 844 → **1,372 MCQs** (220 B / 435 I / 414 adv / 303 expert; every topic
  76-96, strong adv+expert block 33-53/topic). Built via `.claude/workflows/scripts/
  networking-deepen.js` (research → deepen → verify, high effort, 48 agents, 0 errors).
  Research stage did exhaustive per-topic RFC/wire gap-analysis and handed a gap brief to
  the deepener; verify stage fact-checked RFC precision (QUIC 9000/9001/9002, TLS 1.3 8446,
  CUBIC 9438, AccECN 9768, protobuf wire types, CIDR/MSS/MTU math, ICMP types, WebSocket
  handshake) and rebalanced several clustered answer distributions. Content-only commit
  (left concurrent web-design work untouched). Validator clean (16 files, 1,372 Qs); no
  answer-index clustering (top share <40% every topic). Networking now complete across all
  four tiers.
- **Session 12 (2026-07-17):** Performance audit & optimization — implemented 5 changes
  to reduce initial page-load weight: (1) slim question pools strip explanation/tags/
  difficulty from initial fetch (system-design 1213KB gz → 710KB gz), with explanations
  loaded lazily; (2) replaced motion/framer-motion (46KB gz) with CSS animations (4KB gz);
  (3) switched practice island to `client:idle` to unblock paint; (4) added `<link
  rel="preload">` for question JSON on practice pages; (5) immutable cache headers on
  hashed `/_astro/` assets. All 119 study pages and 9,432 questions verified intact.

- **Session 9 (2026-07-16):** System Design advanced/expert expansion — authored **8 new
  senior/staff deep-dive topics** (interview-method-scenario-playbooks — the scenario-based
  thinking style + per-problem playbooks; consensus-clocks-and-time — Raft/Paxos, logical/vector/
  hybrid clocks, TrueTime, linearizability spectrum; distributed-transactions-advanced — 2PC/3PC,
  Percolator/Calvin, isolation anomalies; capacity-modeling-and-tail-latency — Little's Law, USL,
  tail-at-scale, hedged requests, coordinated omission; failure-theory-advanced — metastable
  failures, retry amplification + jitter, load shedding, backpressure, static stability;
  data-internals-storage-engines — LSM vs B-tree amplification + RUM, MVCC/isolation, schema
  evolution; probabilistic-data-structures — Bloom/HLL/Count-Min/LSH; microservices-ddd-and-boundaries
  — DDD bounded contexts/aggregates, distributed-monolith anti-pattern, contract testing). **588 MCQs**,
  skewed hard (~76% adv/expert). ALSO **deepened 6 high-frequency core topics** (fundamentals, CAP,
  databases, microservices, message-queues, resilience) with senior concept sections + ~34 appended
  advanced/expert MCQs each (~205 added; those topics now ~110-116 MCQs each). Built via
  `.claude/workflows/scripts/system-design-advanced-expand.js` (author/deepen → verify, high effort,
  28 agents, 0 errors). Verify agents fact-checked subtle distributed-systems guarantees (linearizability,
  quorum math, Raft/2PC, TrueTime, USL, retry/tail math) and rebalanced answer indices. All validates
  (119 files, 9,432 questions total).
- **Session 8 (2026-07-16):** AWS System Design sub-domain — authored **26 new topics**
  under `topics/system-design/` with an `aws-` slug prefix (compute EC2/ECS/EKS/Fargate/Lambda,
  serverless + Step Functions, API Gateway/AppSync, S3 deep-dive, EBS/EFS/FSx, DynamoDB deep-dive,
  RDS/Aurora, ElastiCache/DAX, SQS/SNS/EventBridge, Kinesis/MSK, VPC/PrivateLink/Transit GW,
  Route 53/CloudFront/Global Accelerator, ELB/Auto Scaling, IAM deep-dive, KMS/Secrets/Cognito/WAF,
  CloudWatch/X-Ray/CloudTrail, multi-region DR, analytics/Redshift/EMR/Athena, microservices
  patterns/saga/outbox, ML/GenAI/SageMaker/Bedrock/RAG, IoT/Greengrass/edge, migration/7-Rs,
  cost optimization, and end-to-end reference architectures). Built via
  `.claude/workflows/scripts/aws-system-design-authoring.js` (author → verify pipeline, high effort,
  52 agents, 0 errors). **1,979 MCQs** (~76/topic; 348 B / 683 I / 636 adv / 312 expert), all four
  tiers, service-limit- and trade-off-heavy. Verify agents fact-checked AWS limits/consistency against
  current docs and rebalanced skewed answer-index distributions. All validates (111 files, 8,635 Qs total).
- **Session 1 (2026-07-15):** Foundation laid — repo scaffold, docs, templates,
  memory, skills, taxonomy research. See memory for details.
- **Session 2 (2026-07-15):** Spring Boot domain fully authored — all 18 topics have
  interview-grade `concepts.md` + `questions.yaml` (1,044 MCQs total, ~56/topic, mixed
  difficulty, descriptive/scenario-style options). Authored via parallel workflow
  (author → fact/schema verify), guided by two user-provided reference syllabi
  (ChatGPT 46-section + Gemini 14-section PDFs). All content validates. Also fixed a
  GitHub-anchor slug bug in `validate_content.py` (`&` leaves a double-dash).
- **Session 4 (2026-07-16):** Spring Core domain — authored full-depth `concepts.md` for
  all 19 topics + validated **beginner/intermediate MCQs only** (814 questions, ~42/topic,
  341 beginner / 473 intermediate) per user request. Advanced/expert deferred to a later
  deepening pass (reuse the Spring Boot deepen pattern). Built via `spring-core-authoring.js`
  (author → verify). Verify stage rebalanced skewed answer-index distributions + fixed facts.
- **Session 7 (2026-07-16):** Java/JVM domain — EXPANDED taxonomy 16 → 25 topics (added
  Java 8 depth: functional interfaces/method refs, java.time, CompletableFuture; modern
  JDK 16-21: records, sealed classes, pattern matching/switch/text blocks, virtual threads;
  modern JVM: ZGC/Shenandoah/JIT/GraalVM/JFR, JPMS; plus a Parallelism topic per user
  follow-up). Authored all 25 across ALL FOUR tiers via `java-jvm-authoring.js` (author →
  verify, high effort, version-accuracy emphasis). **1,541 MCQs** (317 B / 516 I / 437 adv /
  275 expert). 11 author agents hit transient API errors mid-run; recovered via workflow
  resume (cached agents replayed). Post-hoc fixed ~68 broken ref anchors (verify agents on
  re-run wrote refs not matching headings) via a token-matching remap script. All validates.
- **Session 6 (2026-07-16):** System Design domain — EXPANDED taxonomy 19 → 23 topics
  (added event-driven/CQRS/saga/CDC, GenAI/LLM/RAG/vector-DBs, real-time streaming,
  resilience-trade-offs deep-dive). Authored all 23 across ALL FOUR tiers in one pass via
  `system-design-authoring.js` (research-heavy author → verify, high effort). **1,739 MCQs**
  (~70-80/topic; 342 B / 604 I / 524 adv / 269 expert). Deep trade-off-focused concepts.md
  with comparison tables + estimation; heavy scenario/judgment MCQ style. Modern concepts
  verified accurate (cell-based arch, HNSW/IVF, S3-FIFO, TrueTime, CDC/outbox, metastable
  failure). All validates.
- **Session 5 (2026-07-16):** Deepened all 19 Spring Core topics — appended advanced+expert
  questions and enriched concepts.md via `spring-core-deepen.js` (deepen → verify). Bank
  grew 814 → **1,511 MCQs** (~78–80/topic; 341 B / 473 I / 344 adv / 353 expert). Verify
  stage fixed facts (e.g. getBeanProvider added in 5.1 not 4.3), rewrote dupes, re-tagged
  mislabels. Spring Core now complete across all four tiers. All validates.
- **Session 3 (2026-07-15):** Deepened all 18 Spring Boot topics — added an `expert`
  difficulty tier (schema + validator) and appended ~40+ hard advanced/expert questions
  per topic via a deepen→verify workflow (`spring-boot-deepen.js`, high effort). Bank
  grew 1,044 → **1,851 MCQs** (~98–115/topic; 659 advanced + 424 expert). concepts.md
  enriched with advanced-internals subsections. Verify stage rewrote semantic dupes and
  fact-checked. All validates.
