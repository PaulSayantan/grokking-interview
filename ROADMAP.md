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
| [System Design](topics/system-design/README.md) | 19 | 0 |
| [Docker](topics/docker/README.md) | 15 | 0 |
| [Kubernetes](topics/kubernetes/README.md) | 16 | 0 |
| [DevOps & CI/CD](topics/devops-cicd/README.md) | 18 | 0 |
| [Spring Boot](topics/spring-boot/README.md) | 18 | 18 ✅ |
| [Spring Framework Core](topics/spring-core/README.md) | 19 | 0 |
| [Hibernate & JPA](topics/hibernate-jpa/README.md) | 15 | 0 |
| [Apache Tomcat](topics/apache-tomcat/README.md) | 16 | 0 |
| [Java & JVM (framework-relevant)](topics/java-jvm/README.md) | 16 | 0 |
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
