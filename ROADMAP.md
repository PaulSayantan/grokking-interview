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

### Phase 2 — Web application (Astro) ✅ (multiple sessions)

_All six shipped, deployed, tested and CI'd. These boxes sat unchecked long after the
fact; corrected 2026-08-23 against disk._
- [x] Scaffold Astro + Tailwind + Preact in `web/`; content sync (`sync-content.mjs`)
      that reads `topics/` → content collection + per-pool question JSON.
- [x] Pages: landing → grouped catalog → domain (grouped subtopics + filter) →
      subtopic hub → study (concepts.md rendered to HTML) → practice.
- [x] Practice engine: 25-MCQ sessions (subtopic / group / domain level), shuffled
      questions + options, immediate per-question feedback, score + localStorage history.
- [x] Deep-link "Learn more" from a question → study page heading anchor.
- [x] Deploy: static `dist/` to Netlify/Vercel.
- [x] Tests / smoke checks for the sync pipeline + practice logic.

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
- [x] **P3** SRS-light scheduling (Leitner 1/3/7/14/30d). *(commit `db791e6`)*
- [x] Multi-answer question type (select-all-that-apply, all-or-nothing scoring).
      *(Session 45, commit `0df37de`)* — but only **79 questions across 8 of 460
      topics**, and the quiz UI was never click-through tested.
- [ ] **P3** Achievement badges; self-test `<details>` blocks; code-snippet question type.
- [ ] Import/export progress. **The last genuinely-open Phase 3 item** — and the only
      defense against a `localStorage` wipe erasing months of mastery data on a site
      with no backend.

## Content progress

**All 20 domains / 460 topics are authored.** Do not maintain counts here — they drifted
badly (this file has said system-design is 86 topics and also 70; it is 94, and the rollup
below never got a row for `system-design-case-studies`, which is why the repo kept saying
"19 domains").

> **`docs/corpus-stats.md` is authoritative for every count.** Regenerate with
> `python3 scripts/corpus_stats.py`. Verified 2026-08-23: 20 domains, 460 topics,
> 28,064 MCQs, 2,339,891 words.

<!-- CONTENT-PROGRESS-START -->

Per-topic status lives in each `topics/<domain>/README.md`. Domain rollup:

Note: taxonomies for the 6 originally-unauthored domains were revised (Session 17)
and 5 new domains added; counts below reflect the current READMEs.

| Domain | Topics | Authored |
|---|---|---|
| [System Design](topics/system-design/README.md) | 23 core + 8 adv + 7 design-patterns + 6 arch-patterns + 26 AWS | 70 ✅ (all tiers) |
| [Spring Boot](topics/spring-boot/README.md) | 18 | 18 ✅ |
| [Spring Framework Core](topics/spring-core/README.md) | 19 | 19 ✅ (all tiers) |
| [Java & JVM (framework-relevant)](topics/java-jvm/README.md) | 25 | 25 ✅ (all tiers) |
| [REST APIs & API Design](topics/rest-api-design/README.md) | 18 | 18 ✅ (all tiers, 1,529 MCQs) |
| [Docker](topics/docker/README.md) | 16 | 16 ✅ (Pass 1, 794 MCQs) |
| [Kubernetes](topics/kubernetes/README.md) | 19 | 19 ✅ (Pass 1, 981 MCQs) |
| [DevOps & CI/CD](topics/devops-cicd/README.md) | 21 | 21 ✅ (Pass 1, 1,065 MCQs) |
| [Hibernate & JPA](topics/hibernate-jpa/README.md) | 18 | 18 ✅ (Pass 2, 1,401 MCQs) |
| [gRPC](topics/grpc/README.md) | 16 | 16 ✅ (Pass 1, 806 MCQs) |
| [Messaging & Databases](topics/messaging-databases/README.md) | 15 | 15 ✅ (Pass 1, 815 MCQs) |
| [Security (App & Web)](topics/security/README.md) | 16 | 16 ✅ (all tiers, 1,291 MCQs) |
| [Networking & Protocols](topics/networking/README.md) | 16 | 16 ✅ (all tiers, 1,372 MCQs) |
| [Observability](topics/observability/README.md) | 17 | 17 ✅ (Pass 1, 844 MCQs) |
| [Software Testing](topics/testing/README.md) | 16 | 16 ✅ (Pass 1, 784 MCQs) |
| [Interview Craft](topics/interview-craft/README.md) | 16 | 16 ✅ (Pass 1, 793 MCQs) |
| [DSA & Coding Interviews](topics/dsa-coding/README.md) | 20 | 20 ✅ (Pass 1, 456 MCQs + 350 LeetCode links) |
| [Low-Level Design & OOD](topics/lld-and-ood/README.md) | 33 | 33 ✅ (1,671 MCQs) |
| [Reliability Engineering & Operations](topics/reliability-ops/README.md) | 16 | 16 ✅ (all tiers, 1,279 MCQs) |

<!-- CONTENT-PROGRESS-END -->

## Session log

- **Session 48 (2026-09-15) — five pages redesigned + java-jvm clarity topic 1/25, BOTH MERGED TO MAIN.**
  `main` is `3afd01a`. Two independent efforts, landed as separate commits.
  - **Web (`8801926`).** Landing + `/catalog` in the `instrument` direction (won a 3-judge panel
    24.5 / 22.5 / 15 against `editorial` and `stage`); `/domain`, `/topic`, `/study` in the `atlas`
    direction (user pick from 4 self-contained HTML mocks built on real content). Deleted, all
    measured first: a hero parallax whose 5 layers sheared because `--depth-z` inverted the travel
    ladder under perspective (the h1 moved −51px while the mark above it moved −110px) and left a
    ~330px empty panel; a sticky card deck costing 3,171px for 1,073px of content (33.6% of page
    scroll); 10 infinite ambient animations; an 87-line pointer-tilt script; 49 stuck `will-change`.
    Page height 9,443 → 7,082px at 1440. **`global.css` is byte-identical** — it is shared with
    out-of-scope routes, and `check:marketing` now guards that. Reading measure capped at **79ch** so
    the line stops growing with the monitor (95 chars/line at 1440/1920/2560, was 95/118/128); body
    17.2 → 19.8px. Tests 99 → 377 across 19 files.
  - **Content (`723b888`, `3afd01a`).** `java-jvm/synchronized-volatile-jmm` through the full pilot
    loop. 21 → **62 rendered minutes** (+186% words), well past docker's ~84% bar — reported, not
    gated, per the standing uncapped-growth decision. The loop earned it: the verifier caught a FALSE
    UNIVERSAL ("the only edges you can create deliberately between two arbitrary threads" —
    `interrupt()`, `start()` and `join()` are too) that had **already been copied into the ledger's
    `claims_established`**, where every later java-jvm topic would have inherited it as settled. The
    web pass fixed 8 more, incl. `VarHandle.getPlain` (does not exist; inherited from the base file)
    and JLS 17.5.3 (a freeze IS added after each reflective final-field write).
  - **A 5-dimension adversarial review before merging** (10 findings → 6 confirmed, 4 refuted 3/3)
    caught `/topic` corrupting its own `aria-label` on all 460 pages — the label was derived from
    itself and the hydrator ran twice per cold load — and a WCAG 2.1.4 violation: the R/P/D
    accelerators had no off switch, no remap and no focus scope while calling `a.click()` to navigate
    away. **The shortcuts were withdrawn**, not patched (`Shift+letter` is still a single character;
    `Alt+D` collides with Chrome's address bar). A second review of the content branch (23 → 3
    surviving) caught two prose regressions the rewrite introduced, one of which **the base file had
    got right**. MCQ reconciliation then fixed 6 questions with **no answer key moved**.
  - **Fixed, pre-existing, not from this work:** the header overflowed 36px at 360px on `/progress`,
    `/study/*`, `/domain/*` and `/topic/*`, pushing the theme toggle off-screen. Proven pre-existing
    by testing `/progress`, which neither redesign touched. Brand wordmark now visually hidden below
    400px (kept in the a11y tree); brand link 28px → 44px tap target.
  - **KNOWN BUG, still open:** some `questions.yaml` `ref` anchors do not resolve against
    `rehype-slug`'s ids — `validate_content.py` and `rehype-slug` disagree on slugs containing
    punctuation runs, so the validator reports 100% resolution while the site cannot find them.
    Surfaced by `manifest.ts`: `docker/buildkit-advanced-builds` showed "0 q" beside 5 sections
    holding 19 questions. The web app now degrades honestly (em dash, never a false 0); **the refs in
    `topics/` are still wrong** and need a content pass plus a validator fix. Not present in java-jvm.
  - Gates on main: validator 460/28,064/180 prompts, anchors lock 8,702 intact, continuity clean,
    clarity FLAGS none, astro check 0, 377/377 tests, build 1,423 files. **Still no git remote, so
    merging main does not deploy** — Vercel is a manual push.

- **Session 47 (2026-08-24) — clarity machinery MERGED TO MAIN; docker pilot 2/16.**
  **`main` fast-forwarded to `1619705`: 15 infra commits, no content rewrites.** Includes a live
  site bug fix — `system-design-case-studies/README.md` had 1 table row for 23 directories, so 22
  topics were sorting on the `Infinity` fallback and that domain's learning order was an
  alphabetical accident across 7 companies. Gates on main: validator 460/28,064, anchors lock
  8,702, astro check 0 errors, 88/88 tests, build 460 pages. **No git remote, so merging main does
  not deploy** — deploy stays a manual Vercel push.
  - **Phase A** hardened the validator (fence-aware headings — 425 phantom headings across 96
    files were `#` comments inside code fences; four new structural gates, zero corpus
    violations; 26 dead H1-refs migrated to H2), added `topics/.anchors.lock` (8,702 headings,
    `--check-lock` in CI, 0.33s) and `docs/corpus-stats.md` as the authoritative count source.
  - **Phase B** shipped the machinery: `scripts/prose.py` (ONE normative tokenizer — three
    documents had reported three different figures for the same file), `clarity_report.py`
    (report-only, with a self-test asserting 0/11 good passages flagged and 5/5 bad caught),
    `rewrite_audit.py` + `docs/verified-facts.yaml` (**proven to fire on the real Session 44
    regression commit `268a063`**), `prompts.yaml` as a validated first-class file, and the
    study-page reveal UI (**CLS measured 0.00000**; no-JS ships every row open because JS only
    ever removes content). Tests 31 → 88.
  - **`.claude/skills/clarity-standard`** is the single authoritative standard, split into a
    normative `SKILL.md` (10,698 words) + illustrative `references/`. Invariant: a reference file
    may not contain a rule or a threshold.
  - **Docker pilot 2/16** on `clarity-pilot-docker` (NOT merged — topic N's cliffhanger promises
    what N+1 delivers, so a partial merge ships hooks that never pay off). Topic 1
    `images-vs-containers`, topic 2 `container-lifecycle`. Continuity chain verified: topic 1 left
    a named loop (`grace period`) and topic 2's opener settles it. **Measured ~62–71 min/topic.**
  - **Growth accepted at ~+80%** (topic 1 +60.8%, topic 2 +98.8%). The user's bar is now
    **self-sufficiency**: lengthy is fine, but a student must not have to search the internet to
    understand the concept. See Claude memory `clarity-effort.md` for the unresolved tension with
    tier-C/D prompts, which is the first thing to fix next session.
  - The loop that makes this safe: **brief → writer → (adversarial verifier ‖ web fact-check) →
    repair**. It has caught a false claim the writer's own audit missed on **4 of 4** topics,
    including one that was the exact misconception its topic exists to destroy.
  **Next:** encode the self-sufficiency rule, then topics 3–16 sequentially.
- **Session 46 (2026-08-22/23) — landed the stalled redesign, then opened the CLARITY effort.**
  Two efforts. (1) **Landed 3 weeks of finished-but-uncommitted landing-page work** on
  `landing-3d-depth-2026-08` (`a470c5c`, `c0ebf91`): the 3D depth system (sticky deck,
  hero parallax, pointer tilt), the brand mark + full favicon set + a new
  `manifest.webmanifest` (the `icon-192/512` pair had been orphaned; `gen-csp-headers.mjs`
  was *already* emitting `manifest-src 'self'`), and two WCAG AA contrast fixes.
  Browser-verified with Playwright before committing rather than trusting green gates:
  **0 contrast failures** across dark/light/mobile and 6 routes, primary-CTA hover 8.16:1,
  pointer tilt confirmed producing real rotation, reduced-motion fully visible, and no-JS
  renders identically to JS-on (the animations are pure CSS scroll-driven).
- **Session 46 (cont.) — the clarity effort begins.** Students reported the concepts are
  informative but **hard to understand and exhausting to read**. Root finding: writing
  quality **degrades monotonically down the depth stack** — the `**Beginner.**` tier gets
  an analogy, the `**Advanced.**` tier gets dense unreadable prose (778 audience-tier
  labels across 46 files). So the prose is worst exactly where the material is hardest.
  Designed a clarity standard (expert ideas, plain explanation, zero information loss),
  a `prompts.yaml` sidecar for think-prompts + cliffhangers, and a study-page reveal UI;
  adversarially reviewed, **9 blockers found and folded in**. Locked decisions live in
  Claude memory (`clarity-effort.md`). **Phase A pre-flight shipped** (`5c714b0`,
  `13c0a8f`, `41d6f95`, `c547fb2`, `b73daae`):
  - **Governance:** `CONTENT-AUDIT-MASTER.md` said "no domain requiring a rewrite" and
    `refining-content` opens "additive and surgical, not a rewrite" — both would have made
    an agent refuse this work. Reconciled, with the audit's worked-examples finding folded
    in as the standard's rule C4.
  - **Validator hardened** 204 → ~316 lines: fence-aware headings (**425 phantom headings**
    across 96 files were `# comment` lines inside code fences), four new structural gates
    (zero corpus violations), a removed silent skip, and **26 H1 refs migrated to H2** —
    they were dead in-page links because `stripLeadingH1` strips the H1 from the page.
  - **`topics/.anchors.lock`**: all 8,702 headings manifested; `--check-lock` in CI fails
    any modification or removal and names the MCQ-ref blast radius. Runs in 0.33s.
  - **`docs/corpus-stats.md`** is now authoritative for all counts. Settled two disputed
    numbers: `dp-enterprise-application` really has 72 H2s, and system-design is **94**
    topics (this file said 86 and also 70).
  - **Live site bug fixed:** `system-design-case-studies/README.md` had 1 table row for 23
    directories, so 22 topics sorted on the `Infinity` fallback and that domain's learning
    order was an alphabetical accident. Now 23 rows, grouped by company, sequenced on real
    dependencies. The fallback is now a loud warning.
  - 11 unsupported `[!NOTE]` callouts retyped (they rendered as plain blockquotes).
  **Next:** Phase B machinery (clarity linter, rewrite-audit gates, `prompts.yaml`
  plumbing, the reveal UI), then the **`docker` pilot** — 16 topics, sequential in README
  order. Then review before the other 19 domains.
- **Session 45 (2026-07-24):** **Multi-select MCQ type (v2) + AWS Cloud Design Patterns group.** Two
  queued items shipped in order. **(1) Multi-select (SATA):** added a `type: single|multi` question type
  across all 5 layers — schema (`answers: []` replaces `answer` for multi; all-or-nothing scoring so
  SRS/mastery stay binary), validator (type-aware, rejects all-correct multi + answer/answers mixing;
  negative-tested), sync-content + types (carry type/answers into slim pool), PracticeSession.tsx (checkbox
  group + Submit step for multi; single unchanged), CONTRACT.md. All ~27.7k existing Qs default to single,
  untouched. Pilot: 6 SATA Qs on aws-saas-isolation-patterns. Commit `0df37de`. **(2) AWS Cloud Design
  Patterns:** new `aws-cdp-` group in system-design — 7 topics, **347 MCQs (73 multi-select)**, all 46
  clouddesignpattern.org patterns taught "classic intent → modern AWS equivalent", cross-referencing the
  aws-* deep-dives instead of re-teaching. First content group built on the new multi type. Grouping code:
  `aws-cdp-`→"cdp" added BEFORE the `aws-` check in sdGroupKey + label + SD_GROUP_ORDER. Authored via
  `aws-cdp-authoring.js` (14 agents, 0 errors); verify web-checked modern-AWS mappings. Commit `62afa14`.
  system-design domain now **86 topics**. Validator green (460 files, 28,064 Qs); web build renders the new
  group. See [[queued-multiselect-mcq]], [[aws-cdp-plan]]. UI verified via typecheck+build+data-shape (not a
  live click-through — worth a manual look).
- **Session 44 (2026-07-24):** **System Design refinement pilot — overlapped Session 43, verified clean.**
  User asked (via /deep-research, but the task was a content audit not web research) to review + refine
  study content to a great-teacher bar; scoped as a system-design pilot, audit-first with a review gate.
  Ran: (1) 87-subtopic audit → `topics/system-design/CONTENT-AUDIT.md` (`system-design-content-audit.js`);
  verdict corpus already strong (clarity 4.81/depth 4.72; 0 high/59 med/28 low), dominant gap = worked
  examples. (2) Full pedagogy refine of the 59 medium files (`system-design-refine.js`, refine→verify, 118
  agents, high effort, **NO web** per user cost choice) — commit `268a063`, +5.8k lines, worked examples +
  intuition + gotchas + confirmed logic-error fixes (base62(125)="21", TGW per-flow contradiction, geohash/
  HLL). **KEY LESSON: this DUPLICATED Session 43**, which had already refined the whole corpus (incl.
  system-design) WITH web verification — 42 of my 59 files were re-refined. Worse, a no-web pass on
  web-verified content caused fact regressions (SCP-attached-per-entity 10→5; NLB idle-timeout stated
  "fixed/not tunable"). (3) So ran a web-verify sweep of my diff (`system-design-refine-factcheck.js`, 32
  AWS files, live docs) — commit `cd08d66` — fixed both regressions (NLB timeout now tunable 60–6000s since
  Nov 2023; SCP corrected + SCP-vs-RCP clarifier added), confirmed the other 30 files' facts current and
  all worked-example arithmetic correct. Net: system-design got extra worked examples + a fresh fact-check
  on top of Session 43. Validator green (453 files). **DO NOT** re-run the audit→refine loop on other
  domains — Session 43 already covered all 19 with web verification; further no-web passes only risk
  regressions. See [[content-refinement-effort]].
- **Session 43 (2026-07-25):** **Corpus-wide teaching-quality audit + 4-wave refinement.**
  Read-only audit of all **430 subtopics** (cache-backed idempotent workflow) scored each
  against a Senior-Principal-Engineer + gifted-teacher bar weighted to intuition/clarity,
  worked examples, and interview depth/gotchas → per-domain `CONTENT-AUDIT.md` ×19 + master
  `CONTENT-AUDIT-MASTER.md`. Verdict: corpus already strong (1 high / ~309 med / 120 low; no
  rewrites), universal gap = concrete worked examples. Then a 4-wave refine, each wave a
  2-stage refine→adversarial-verify pipeline (every worked example RECOMPUTED by a 2nd agent):
  **W0 correctness** (83 files, 115 confirmed bugs incl. base62/enum-readResolve/LLD
  skeleton-vs-prose; 99 facts web-verified; commit `cb8555e`), **W1 worked-examples** (123
  files, 515 examples; `049910c`), **W2 worked-examples** (99 files, 380 examples; `278dcc8`),
  **W3 polish** (33 files: 57 jargon defs + 14 diagrams + structure; `64cb30c`). Verifier caught
  22 regressions/miscomputations across waves — all fixed + independently re-verified. Net:
  **274 concepts.md improved, +22,214/−873 lines, 38 new mermaid diagrams**; validator green
  (430 files, 27,481 Qs). New repo skill `refining-content` encodes the 7-point standard.
- **Session 42 (2026-07-23):** **AWS SaaS multi-tenancy cluster** — 5 NEW topics added to the
  existing **AWS System Design** group in system-design (AWS group 26 → **31 topics**; domain 74 → 79).
  User wanted AWS multi-tenancy architectural design patterns as subtopics; decided (per Q) to keep the
  `aws-` prefix so they slot into the existing AWS group (no new sub-group) as an AWS-specific companion
  to the vendor-neutral core `multi-tenancy-and-saas-isolation` topic. Anchored on a user-provided
  Nagarro six-pattern article + the AWS Well-Architected SaaS Lens / SaaS Factory body of knowledge.
  Topics: `aws-saas-multitenancy-foundations` (isolation spectrum, silo/pool/bridge per layer, control
  plane vs application plane), `aws-saas-isolation-patterns` (the 6 patterns: Orgs/OU governance →
  account → VPC → subnet → container → data-layer), `aws-saas-tenant-identity-and-routing` (Cognito
  tenant context, JWT claims, scoped-IAM-per-request, routing, onboarding automation),
  `aws-saas-data-partitioning` (4 data sub-models, DynamoDB pooling, Postgres RLS, cross-tenant-leak
  prevention), `aws-saas-metering-tiering-throttling` (noisy neighbors, tiering, throttling, per-tenant
  cost attribution). **389 MCQs** (65 B / 138 I / 123 adv / 63 expert), all four tiers, heavy
  scenario/trade-off. Authored via research→author→verify workflow (`aws-saas-multitenancy-authoring.js`);
  transient API errors killed 3 agents mid-run, recovered with a targeted repair workflow
  (`aws-saas-multitenancy-repair.js`). Verify agents web-checked all AWS limits current (Orgs/OU/SCP,
  Cognito custom-attr/domain caps, STS session-policy/tags, DynamoDB partition throughput, VPC/subnet
  quotas, cost-allocation tags) and rebalanced badly-skewed answer indices. Validator passes; web build
  confirms all 5 render in the AWS System Design group.
- **Session 41 (2026-07-23):** **gRPC Pass 1** (NEW authored domain, was coming-soon) — 16 topics,
  **806 MCQs**, 51 Mermaid (all render clean). High-performance RPC with Protocol Buffers over HTTP/2,
  at the mechanism/protocol level. Topics: fundamentals, Protocol Buffers (proto3/wire-encoding/presence),
  service/message definition, the 4 RPC/streaming types, HTTP/2 foundations, channels/stubs/lifecycle,
  deadlines/cancellation, metadata/interceptors, status/error model, schema evolution, security/mTLS,
  load balancing & service discovery, retries/resiliency, observability, gRPC-Web/gateways, gRPC-vs-
  REST-vs-GraphQL. Emphasizes wire truth: status in HTTP/2 trailers, 5-byte framing, proto3 field-number
  contract, 17 status codes + retryability, absolute deadlines + propagation, why L7/client-side LB is
  required, gRPC-Web needs a proxy, gRFC A6 retry. BOUNDARIES cross-ref networking (HTTP/2, TLS),
  rest-api-design (REST/GraphQL), reliability-ops (resilience theory), observability, system-design
  (mesh). Built via `grpc-authoring.js` (author→verify, 32 agents, 0 errors); verify fixed answer-key
  clustering + confirmed specs vs grpc.io/protobuf.dev. Moved grpc coming-soon → authored (19 authored
  domains, 1 coming-soon: apache-tomcat). Commit e263818. Also this session (earlier): catalog/domain
  UI polish (card redesign → orange badges → topics-only mono; card titles shortened to avoid truncation;
  domain-hero descriptions via shared src/lib/domain-blurbs.ts; landing "The Library" reframed).

- **Session 40 (2026-07-22):** **Hibernate/JPA Pass 2 + Cloud Computing Patterns group + deploy-URL.**
  (1) **Hibernate & JPA Pass 2 (deepen)** — research→deepen→verify (54 agents, 0 errors); grew
  **868 → 1,401 MCQs (+533)**, every topic 78-85, heavily advanced/expert. Deepened the senior classics
  (N+1 + full fix menu, merge semantics, @Version internals, L2 concurrency strategies, equals/hashCode
  disaster, bulk-DML bypass, HB6 SQM/@JdbcTypeCode, HB7 Jakarta Persistence 3.2 + Jakarta Data, javax→
  jakarta). Verify fixed real errors (Session.upsert is StatelessSession-only; @UuidGenerator Style.TIME
  is v1-style not UUIDv7). Commit 32f2248. (2) **Cloud Computing Patterns group** (NEW ccp- group in
  system-design) — the vendor-neutral Fehling/Leymann/Retter "Cloud Computing Patterns" (Springer 2014,
  cloudcomputingpatterns.org): all **74 patterns / 5 categories** in **8 topics, 407 MCQs**, 29 Mermaid.
  Each pattern intent+context+solution+modern-cross-cloud-equivalent+trade-offs; overlaps cross-referenced
  not duplicated (workloads→capacity-modeling, consistency→cap-theorem, messaging→message-queues,
  multi-tenancy→deep dive, hybrid→aws-migration). New "ccp" sync group (label "Cloud Computing Patterns",
  before aws in SD_GROUP_ORDER). Distinct from the still-planned AWS-specific CDP catalog (clouddesignpattern.org).
  Completeness gate confirmed all 74 patterns; verify fixed a quorum MCQ. Built via
  `cloud-computing-patterns-authoring.js` (research→author→verify, 16 agents, 0 errors). Commit a041adf.
  (3) Deploy URL set to grokking-interview.vercel.app (Vercel free tier, no paid domain — commit 87ef6c5).
  System-design now 82 topics (6 groups: core/advanced/patterns/architecture/ccp/aws).

- **Session 39 (2026-07-22):** **Rebrand + Hibernate/JPA Pass 1 + gRPC coming-soon.**
  (1) Renamed the site LoopReady → **Grokking Interview** (siteName in BaseLayout drives wordmark/
  title/footer; landing title; robots comment). Deploy URL unchanged (loopready.io as SITE_URL
  default — no new domain provided). (2) Removed the landing-page footer (activeNav="home") per
  request — still shown on all other pages. (3) Added **gRPC** as a coming-soon domain
  (topics/grpc/README.md, 16-topic taxonomy; in COMING_SOON_DOMAINS). (4) **Hibernate & JPA Pass 1**
  (NEW authored domain) — 18 topics, **868 MCQs**, 34 Mermaid (all render clean). Current Jakarta
  Persistence 3.1/3.2 (jakarta.* namespace) + Hibernate 6/7 + Spring Data JPA. Senior mechanism depth:
  persistence context/identity, dirty checking, flush order, lazy proxies + LazyInitializationException,
  the N+1 problem + full fix menu, cascade vs orphanRemoval, @Version optimistic locking, entity
  equals/hashCode pitfalls. Boundaries cross-ref messaging-databases (SQL/ACID)/spring-* (@Transactional)/
  system-design, not duplicated. Built via `hibernate-jpa-authoring.js` (author→verify, 36 agents,
  0 errors). Verify caught a 60%-index-1 clustering (rebalanced) + Mermaid `\n`→`<br/>`; I fixed one
  unquoted rhombus label with parens post-sweep (Q{isNew(entity)?}→Q{"..."}). Moved hibernate-jpa
  coming-soon → authored (18 authored domains, 2 coming-soon: apache-tomcat, grpc). Commits d81ada0
  (web/rename/grpc/footer), 46befd5 (hibernate content). NEXT: performance-engineering (or apache-tomcat/gRPC).

- **Session 38 (2026-07-22):** **Reliability-Ops Pass 2 (deepen)** — research→deepen→verify pipeline
  (48 agents, 0 errors, high effort) over all 16 topics. Grew **796 → 1,279 MCQs (+483)**; every topic
  now 74-88 (from 45-58), heavily advanced/expert (37-56 adv+exp per topic). Additive concept
  enrichment + hard senior/staff MCQs: correlated/common-cause failure & k-of-n quorum math, multi-burn-
  rate & error-budget-policy governance, jitter formulas/retry-budgets/deadline-propagation/hedged
  requests (gRPC A6), Resilience4j/Hystrix exact config defaults + decorator order + adaptive concurrency,
  CoDel/LIFO-under-overload/criticality-tiers, static stability & fail-open-vs-closed, split-brain/quorum/
  fencing & the deep-health-check death spiral, metastable failure + hysteresis & cache-stampede fixes &
  Nygard's anti-patterns, ICS roles & Just Culture substitution test & Safety-II, Swiss cheese & "How
  Complex Systems Fail" & golden-signals/RED/USE, principlesofchaos.org loop + Simian Army + ChAP +
  blast-radius, AWS DR cost/RTO curve + sync=RPO0 + test-restores, queueing theory (M/M/1 knee) +
  coordinated omission + autoscale lag, toil 6-part definition + automation hierarchy + self-healing
  guardrails. 4 new Mermaid (47 total, all render clean). Validator clean; answer indices balanced
  (max 34%). Verify caught a burn-rate option contradicting its own math (fixed). Commit d0c5581.
  Same 3-stage deepen pattern as rest-api/networking/security. NEXT: performance-engineering.
- **Session 37 (2026-07-22):** **Reliability Engineering & Operations Pass 1** (NEW domain, sequence)
  — 16 topics, **796 MCQs**, 43 Mermaid diagrams (all render 0-error, headless sweep). Grounded in the
  Google SRE books, Nygard's *Release It!*, and the AWS Well-Architected Reliability pillar. Three
  clusters: foundations & SLOs (availability/nines math, error-budgets & velocity tradeoff); resilience
  patterns (retries/timeouts/backoff, circuit breakers & bulkheads, load shedding & backpressure,
  graceful degradation, redundancy/failover/health checks, cascading failures & anti-patterns);
  operations (incident response & command, on-call/runbooks, blameless postmortems, RCA, chaos
  engineering, DR RPO/RTO, capacity planning, toil). BOUNDARIES: cross-references (does not duplicate)
  observability (telemetry + SLO alerting mechanics), devops-cicd (pipeline/deploy + SRE-culture +
  its light incident topic), system-design (failure theory), security (rate-limit-as-abuse). Built via
  `reliability-ops-authoring.js` (author→verify, 32 agents, 0 errors — a clean run for once). Verify
  caught real fixes: a mixed 30-day/avg month convention in the nines table, an 85%-index-1 answer
  clustering (rebalanced to even), and the Resilience4j `waitDurationInOpenState` default (60s not 5s).
  Validator clean; answer indices balanced (max 31%). Commit 1092b99. NEXT: performance-engineering.

- **Session 36 (2026-07-22):** **LLD & OOD expansion** — grew the domain 18 → **33 topics**,
  919 → **1,671 MCQs**, driven by a deep-research workflow (99 agents, cross-referenced across
  awesome-low-level-design, low-level-design-primer, and Grokking OOD). Added **2 method topics**
  (`ooad-requirements-to-classes` — noun/verb/Abbott extraction, CRC cards, Responsibility-Driven
  Design, GRASP, with a worked pipeline; `concurrency-in-lld` — race conditions, pessimistic/optimistic
  locking, thread-safe singleton, the senior differentiator) + **13 new canonical problems**: ATM
  (State), Stack Overflow (rich domain), Movie Booking (seat-lock concurrency), Logging Framework
  (Chain of Responsibility), Notification/Pub-Sub (Observer), Ride-Sharing (Strategy/State matching),
  Traffic Signal (State+timers), Digital Wallet (ledger), Calendar Scheduler (interval conflicts),
  Text Editor (Command/Memento undo-redo), File System (Composite), Card Game (reusable abstractions),
  Task Management (Composite+workflow). Every problem topic emphasizes the step-by-step method:
  requirements → noun/verb object identification → responsibility/relationship assignment → class
  diagram → pattern justification → code → extensibility → concurrency. 34 new Mermaid diagrams (all
  render 0-error, headless sweep). Validator clean; answer indices balanced (max 38%). Built via
  `lld-and-ood-expansion.js` (author→verify) + a direct agent for `design-ride-sharing` (author died
  mid-response). Commits 010b6ae, c17371e, 4cd27c3.

- **Session 35 (2026-07-22):** **Low-Level Design & OOD Pass 1** (NEW domain, sequence) — 18
  topics, **919 MCQs**, 36 Mermaid diagrams (headless sweep: all render 0-error). The machine-coding /
  LLD interview round — the 45-90 min live OO design session between DSA and HLD. 5 foundational
  topics (OOP pillars, SOLID deep-dive, principles beyond SOLID / GRASP, UML class diagrams for
  interviews, the LLD interview method) + 13 canonical problems (parking lot, elevator, library,
  vending machine, tic-tac-toe, chess, snake & ladder, rate limiter, LRU/LFU cache, Splitwise,
  hotel booking, food delivery, auction). Each problem topic walks the full method: requirements
  → entities → Mermaid classDiagram → pattern application → API → code skeleton → extensibility →
  edge cases. Boundaries: patterns referenced by name (cross-ref `dp-*`, not re-taught), DS internals
  → dsa-coding, scaling → system-design. Built via `lld-and-ood-authoring.js` (author → verify).
  GOTCHA: a multi-hour Bedrock 503 wave failed most agents per run; recovered 16/18 via resume, and
  authored the last 2 (solid-principles, lld-interview-method) with direct Opus 4.8 agents rather than
  racing the flaky workflow. Validator clean, answer indices balanced (max 35%). Content + sync commit
  a8b5c5f. NEXT: reliability-ops.

- **Session 34 (2026-07-21):** **DSA & Coding Interviews Pass 1** (NEW domain, sequence) — 20
  topics, **456 MCQs** (87 B / 220 I / 146 adv / 3 exp) + **350 LeetCode problem links** (247
  unique), 42 Mermaid diagrams (render 0-error). Per user: DEEP data-structure INTERNALS (hashmap
  buckets/chaining/load-factor-0.75/treeify-8/resize; heap-as-array sift O(log n); trie nodes;
  graph adjacency-list-vs-matrix; union-find path-compression+rank; BST balance), problem-solving
  PATTERNS (dedicated coding-patterns-overview + per-topic recognition-signal+template), and a
  per-topic "## Interview Problems" section with ~15 canonical LeetCode links. MCQs intentionally
  LIGHTER (coding-first, user said MCQs optional — kept ≥12/topic so pages render, no web change;
  focus internals/complexity/pattern-choice). Built via `dsa-coding-authoring.js` (author → verify,
  40 agents, 0 errors). Verify heavily rebalanced index-1-skewed answer keys (LLM tendency on
  technical MCQs — several were 67-79% index-1) + fixed complexity claims + confirmed LC slugs.
  Net-new domain (README/taxonomy + AUTHORED_DOMAINS). CAVEAT: LC links are well-formed canonical
  slugs & famous problems but not each live-fetched. Content-only commit. NEXT: lld-and-ood.
- **Session 33 (2026-07-21):** **Interview Craft Pass 1** (NEW domain, sequence) — 16 topics,
  **793 MCQs** (126 B / 395 I / 258 adv / 14 exp), 40 Mermaid diagrams (render 0-error). The
  non-technical craft: STAR/behavioral, competency bank, company values/Amazon-LPs+Bar-Raiser,
  hiring-manager/project-deep-dive, seniority ladder & scope signals, Staff+ archetypes (Larson),
  trade-off articulation, estimation/napkin-math (latency numbers), handling ambiguity, mentorship/
  cross-team influence, incident leadership (behavioral), design-docs/RFCs/ADRs, engineering
  strategy/prioritization, product-sense & startup-vs-FAANG, take-home/pairing/code-review rounds,
  leveling/negotiation/reverse-questions. Net-new domain (created dir+README+taxonomy). Boundary:
  behavioral/career craft only — technical SD-interview method stays in system-design; coding-round
  skills in dsa/lld (cross-referenced). Judgment-quality guard: MCQ correct answers defensible vs a
  named framework, distractors realistic-but-weaker. Built via `interview-craft-authoring.js`
  (author → verify, 32 agents, 0 errors). Verify fixed stale Meta company values + broke guessable
  answer cycles. Added to AUTHORED_DOMAINS. ALSO fixed garbled `☐✅` README status markers in
  docker/kubernetes/observability/devops-cicd (buggy flip script — cosmetic, sync reads slugs not
  markers). Content-only commit. NEXT: dsa-coding.
- **Session 32 (2026-07-21):** **Backend-craft fold-ins** (gap-analysis P1 fold-ins into EXISTING
  domains, no new domains) — 12 topics, **620 MCQs**, 30 Mermaid diagrams. system-design +4 (DDD
  tactical, DDD strategic/context-mapping, strangler-fig migration, multi-tenancy/SaaS isolation);
  messaging-databases +5 (money/currency, search/Elasticsearch, soft-deletes/auditing/temporal,
  zero-downtime migrations, serialization/schema-evolution+registry); rest-api-design +2 (file-upload/
  media, GraphQL schema/federation); security +1 (application cryptography/data-protection). Each
  cross-references existing adjacent topics (not duplicated). Built via `backend-craft-folds-authoring.js`
  (author → verify, 24 agents, 0 errors); verify fixed mojibake (Cyrillic in multi-tenancy) + confirmed
  facts (IEEE754/double-entry, BM25/inverted-index, expand-contract, protobuf compat, envelope
  encryption). README rows added so topics number in learning order (no sync grouping change — folds
  join existing domain groups / SD core). Validators clean (SD 74/5462, msg-db 20/1086, rest-api
  20/1633, security 17/1341); no clustering; all diagrams render. Content-only commit. NEXT:
  interview-craft (new domain).
- **Session 31 (2026-07-21):** **Kubernetes Pass 1** (sequence domain 5, largest) — 19 topics,
  **981 MCQs** (220 B / 472 I / 286 adv / 3 exp), 55 Mermaid diagrams (render 0-error). Covers
  architecture/control-plane + reconciliation, API/objects/kubectl, pods & workload controllers,
  deployments/rollouts, probes & resources (liveness-vs-readiness, QoS/OOMKilled), config/secrets,
  services & networking, Ingress + Gateway API, storage (PV/PVC/CSI), scheduling/affinity/taints,
  autoscaling (HPA/VPA/CA/KEDA/Karpenter), RBAC, workload/network security (PSS, NetworkPolicy),
  Helm, K8s GitOps (Argo/Flux/Rollouts), operators/CRDs, troubleshooting, cluster lifecycle/upgrades,
  service mesh. Boundaries: container internals→docker, general GitOps/CI→devops-cicd, observability
  mechanics→observability, appsec→security, EKS→aws group (all cross-referenced). Built via
  `kubernetes-authoring.js` (author → verify, 38 agents, 0 errors). Verify fixed several
  version-accuracy errors (etcd 2GiB default quota, SSA not the kubectl-apply default, immutable
  ConfigMap GA v1.21) + broke a period-12 answer cycle. A transient "YAML parse error in
  workload-network-security" flagged mid-run was a concurrent-edit artifact — final file parses clean
  (validator confirms 19 files/981 Qs). Promoted to AUTHORED_DOMAINS. Content-only commit. NEXT:
  DDD tactical + backend-craft folds into system-design/messaging-databases/rest-api-design.
- **Session 30 (2026-07-21):** **Docker Pass 1** (sequence domain 4) — 16 topics, **794 MCQs**
  (180 B / 382 I / 214 adv / 18 exp), 46 Mermaid diagrams (render 0-error). Covers container
  fundamentals (images vs containers, lifecycle, Dockerfile/layers/cache, ENTRYPOINT vs CMD),
  multi-stage/optimization, volumes/networking/compose, registries/tags-vs-digests, production
  (healthchecks/logging/graceful-shutdown, debugging), security, image-scanning/supply-chain,
  BuildKit, image internals/overlay2, runtimes/OCI/namespaces-cgroups. Boundaries: container
  internals here; K8s orchestration → upcoming k8s; general SLSA framework → devops-cicd;
  deep namespaces/cgroups theory → upcoming OS domain (all cross-referenced). Built via
  `docker-authoring.js` (author → verify, 32 agents, 0 errors). Verify fixed a YAML flow-mapping
  bug (unquoted option parsed as dict) + a couple typos/inconsistencies. Validator clean; no
  clustering. Shiki: added `dockerignore` → bash to langAlias (dockerfile has a grammar).
  Promoted to AUTHORED_DOMAINS. Content-only + isolated web (sync + langAlias) commit. NEXT: kubernetes.
  ALSO this session: renamed site → LoopReady (loopready.io); landing floating-question chips
  (side gutters, JetBrains Mono 0.9rem); footer/landing-header/search-notice web tweaks.
- **Session 29 (2026-07-21):** **DevOps & CI/CD Pass 1** (sequence domain 3) — 21 topics,
  **1,065 MCQs** (239 B / 553 I / 268 adv / 5 exp), 53 Mermaid diagrams (render 0-error). Covers
  DevOps culture/CALMS/Three-Ways/DORA, Git/branching (trunk-based), CI/CD pipelines + tooling
  (Actions/GitLab/Jenkins), deployment strategies, IaC/Terraform, Ansible, GitOps, DevSecOps,
  supply-chain (SLSA/SBOM/Sigstore), secrets-in-deploys, platform engineering/IDP, DevOps
  scenarios. Heavy boundary discipline: observability/testing/security/networking depth stays in
  their dedicated domains (cross-referenced, not duplicated); linux kept at ops-toolkit level,
  incident/SRE at DevOps-framing (deep process → upcoming reliability-ops). Built via
  `devops-cicd-authoring.js` (author → verify). 1 author agent died (platform-engineering-and-idp,
  transient API error) — recovered via resume-from-runId. Verify fixed 2 real Mermaid bugs (chained
  mixed-arrow flowchart crash; validated via mermaid-cli) + an invalid duplicate-`push:` YAML key,
  and broke guessable answer cycles. Also silenced Shiki unknown-language warnings via
  `shikiConfig.langAlias` (promql/logql/rego → yaml/bash) in a separate commit. Validator clean;
  no clustering. Promoted to AUTHORED_DOMAINS. Content-only commit. NEXT: docker.
- **Session 28 (2026-07-20):** **Observability Pass 1** (sequence domain 2) — 17 topics,
  **844 MCQs** (209 B / 435 I / 196 adv / 4 exp), 48 Mermaid diagrams. Tool-grounded: three
  pillars + golden-signals/RED/USE, metric types & dimensional model, structured logging +
  ELK/Loki, distributed tracing + W3C context propagation, full OpenTelemetry stack (signals/
  instrumentation/Collector/tail-sampling), Prometheus + PromQL + recording rules, Jaeger,
  Grafana, Alertmanager, SLO multi-burn-rate alerting + error budgets, alert-fatigue, sampling/
  cardinality/cost, APM/eBPF/continuous-profiling. Boundaries: system-design keeps design overview;
  reliability-ops (upcoming) owns incident/on-call process; performance-eng owns flame-graph
  technique. Built via `observability-authoring.js` (author → verify, 34 agents, 0 errors).
  Validator clean; no clustering. GOTCHA: render-check caught 1 sequenceDiagram that failed to
  render — semicolons in message text (Mermaid treats `;` as statement separator, the recurring
  gotcha) — fixed to comma; re-verified all 48 diagrams render 0-error. Promoted to
  AUTHORED_DOMAINS. Content-only commit. NEXT: devops-cicd.
- **Session 27 (2026-07-20):** Exhaustive **gap analysis** (12-lens research → synthesize →
  adversarial critic) for backend+senior product/startup interviews → prioritized backlog in
  memory `gap-analysis-findings.md`. User decided: author BOTH dsa-coding + lld-and-ood, follow
  the full recommended sequence one domain at a time. THEN authored **Software Testing Pass 1** —
  16 topics, **784 MCQs** (178 B / 407 I / 199 adv), 42 Mermaid diagrams (render 0-error).
  Framework-agnostic testing discipline w/ JUnit 5 / Mockito / Testcontainers examples; covers
  test pyramid, full test-double taxonomy, TDD/BDD, integration + Testcontainers, contract testing
  (Pact/CDC), coverage + mutation testing, load/soak/spike perf testing (coordinated omission,
  percentiles), flaky-test/CI. Spring test-slices cross-referenced not duplicated. Built via
  `testing-authoring.js` (author → verify, 32 agents, 0 errors). Validator clean; no clustering
  (verify even broke a trivially-guessable 0,1,2,3 answer cycle). Promoted to AUTHORED_DOMAINS.
  Content-only commit. NEXT in sequence: observability.
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
  clustering. Content-only commit (concurrent web-design work untouched).
- **Session 26b (2026-07-20):** System Design **Architectural Patterns** group added — 6 new
  topics (`arch-` prefix, new "Architectural Patterns" group), **325 MCQs**, 93 Mermaid diagrams
  (all render 0-error). Covers the full recognized-styles taxonomy: distributed/infrastructure
  (Client-Server, P2P, Microservices, SOA, Serverless, Space-Based), code-organization (Layered,
  Hexagonal, Clean, Onion, Microkernel, +Blackboard added by verify), data-flow/event
  (Event-Driven, Pipe-and-Filter, CQRS, Event Sourcing, Batch), UI (MVC/MVP/MVVM), specialized
  (Blackboard, Primary-Replica, Broker). Each style: "Problem it solves" + diagram + trade-offs
  + "differs-from"; overlapping styles CROSS-REFERENCE existing deep-dives (not duplicated).
  Inclusive language: Primary-Replica (one sanctioned recognition note + one teaching MCQ). Built
  via `architectural-patterns-authoring.js` (research → author → verify, 0 errors). Verify caught
  + rebalanced SEVERE answer clustering (index 1 at 65-79% in 3 topics) and added a missing
  Blackboard section. Validator clean; my post-check confirmed no clustering (top ≤35%). System
  Design domain now 70 topics. Content-only commit.
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
