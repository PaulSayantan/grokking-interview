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
| [System Design](topics/system-design/README.md) | 23 core + 8 adv deep-dive + 26 AWS | 57 ✅ (all tiers) |
| [Spring Boot](topics/spring-boot/README.md) | 18 | 18 ✅ |
| [Spring Framework Core](topics/spring-core/README.md) | 19 | 19 ✅ (all tiers) |
| [Java & JVM (framework-relevant)](topics/java-jvm/README.md) | 25 | 25 ✅ (all tiers) |
| [REST APIs & API Design](topics/rest-api-design/README.md) | 18 | 18 ✅ (all tiers, 1,529 MCQs) |
| [Docker](topics/docker/README.md) | 16 | 0 |
| [Kubernetes](topics/kubernetes/README.md) | 19 | 0 |
| [DevOps & CI/CD](topics/devops-cicd/README.md) | 21 | 0 |
| [Hibernate & JPA](topics/hibernate-jpa/README.md) | 18 | 0 |
| [Apache Tomcat](topics/apache-tomcat/README.md) | 19 | 0 |
| [Messaging & Databases](topics/messaging-databases/README.md) | 15 | 0 |
| [Security (App & Web)](topics/security/README.md) | 16 | 0 |
| [Networking & Protocols](topics/networking/README.md) | 16 | 16 ✅ (Pass 1, 844 MCQs) |
| [Observability](topics/observability/README.md) | 17 | 0 |
| [Software Testing](topics/testing/README.md) | 16 | 0 |

<!-- CONTENT-PROGRESS-END -->

## Session log

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
