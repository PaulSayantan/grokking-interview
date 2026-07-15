# ROADMAP — Phased build plan & live progress

Update this file at the end of every session. It is the single source of truth for
"what's done / what's next" and pairs with the Claude memory index.

## Phases

### Phase 0 — Foundation ✅ (Session 1)
- [x] Decide stack (Python + Textual) and content model (linked YAML MCQs).
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

### Phase 2 — TUI application (multiple sessions)
- [ ] `core/` data models + content loader (parse topics/ into memory).
- [ ] `core/` quiz engine (topic mode, random mode, scoring, session results).
- [ ] `ui/` Textual screens: home / topic-picker / quiz / results.
- [ ] Progress persistence (per-user score history, e.g. `~/.interview-practice/`).
- [ ] Deep-link "Learn more" → renders `concepts.md` section with Glamour/Rich md.
- [ ] Packaging: `pip install -e .`, `interview-practice` entry point.
- [ ] Tests for loader + engine.

### Phase 3 — Polish (later)
- [ ] Spaced-repetition / weak-topic focus mode.
- [ ] Import/export progress, stats dashboard.
- [ ] Multi-answer & code-snippet question types.

## Content progress

Populated once `TOPICS.md` is generated. Each domain lists its topics with status.
Update the marker as you author each topic.

<!-- CONTENT-PROGRESS-START -->

Per-topic status lives in each `topics/<domain>/README.md`. Domain rollup:

| Domain | Topics | Authored |
|---|---|---|
| [System Design](topics/system-design/README.md) | 23 | 23 ✅ (all tiers) |
| [Docker](topics/docker/README.md) | 15 | 0 |
| [Kubernetes](topics/kubernetes/README.md) | 16 | 0 |
| [DevOps & CI/CD](topics/devops-cicd/README.md) | 18 | 0 |
| [Spring Boot](topics/spring-boot/README.md) | 18 | 18 ✅ |
| [Spring Framework Core](topics/spring-core/README.md) | 19 | 19 ✅ (all tiers) |
| [Hibernate & JPA](topics/hibernate-jpa/README.md) | 15 | 0 |
| [Apache Tomcat](topics/apache-tomcat/README.md) | 16 | 0 |
| [Java & JVM (framework-relevant)](topics/java-jvm/README.md) | 25 | 25 ✅ (all tiers) |
| [Messaging & Databases](topics/messaging-databases/README.md) | 12 | 0 |

<!-- CONTENT-PROGRESS-END -->

## Session log

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
