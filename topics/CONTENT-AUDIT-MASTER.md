# Interview-Prep Corpus — Master Content Audit

## Executive summary

The library is in strong, largely publishable shape. Across **19 domains and 429 subtopics**, only **1 subtopic is high-priority** (a single correctness bug in `dsa-coding`), **308 are medium**, and **120 are low**. There is no domain requiring a rewrite, and no domain whose content is structurally broken. Clarity and interview depth are consistently high (most domains average 4.5–5.0 on both); several domains — `hibernate-jpa`, `networking`, `reliability-ops`, `security`, `spring-boot`, `spring-core` — score a perfect **5/5 on interview depth**.

The corpus has **one dominant, systemic weakness that shows up in every single domain**: a shortage of concrete, numbers-in / numbers-out **worked examples**. Hard concepts are explained clearly in prose, diagrams, and code skeletons, but the learner is rarely walked through the actual arithmetic, byte-level trace, or interleaving that makes the concept stick. This is exactly the #2-weighted axis in our refinement bar, and it is the single highest-leverage thing to fix.

**Headline takeaways:**

1. **Worked examples are the universal gap.** Every domain's lowest-scoring axis is examples (domain averages range 2.95–4.0 vs. clarity/depth in the 4.2–5.0 band). The fix is additive, not a rewrite: inject one traced example per hard concept.
2. **The corpus is otherwise healthy and senior-calibrated.** Clarity averages ~4.7 and depth ~4.6 corpus-wide; 0 high-priority files outside a single bug means refinement is polish, not triage.
3. **A batched fact-verification sweep is owed almost everywhere.** Nearly every domain flags most or all files as `needs_web_verification` for drifting version/limit/pricing/spec facts, with a handful of confirmed errors (see systemic themes).
4. **A small, concrete correctness backlog exists.** ~12 confirmed factual/logic errors are scattered across `dsa-coding`, `hibernate-jpa`, `java-jvm`, `observability`, `spring-boot`, `spring-core`, `networking`, `rest-api-design`, and `system-design`. These are cheap to fix and should be cleared before publish.

## Domain scorecard

Sorted so the domains most needing work are at the top (high count desc, then combined avg score asc).

| Domain | Subtopics | High | Med | Low | Avg Clarity | Avg Examples | Avg Depth | Health |
|---|---|---|---|---|---|---|---|---|
| dsa-coding | 20 | 1 | 19 | 0 | 4.60 | 3.00 | 4.00 | Strong; 1 correctness bug + domain-wide example gap |
| devops-cicd | 21 | 0 | 21 | 0 | 4.81 | 2.95 | 4.19 | Uniformly strong; lowest example score in corpus |
| java-jvm | 25 | 0 | 23 | 2 | 4.52 | 3.32 | 4.48 | Strong; 1 serialization error + example gap |
| messaging-databases | 20 | 0 | 19 | 1 | 4.80 | 3.30 | 4.35 | Mature; example gap + jargon gaps |
| observability | 17 | 0 | 15 | 2 | 4.82 | 3.29 | 4.35 | Excellent; 5 correctness bugs + example gap |
| lld-and-ood | 33 | 0 | 30 | 3 | 4.76 | 3.24 | 4.52 | Mature; skeletons contradict their own prose |
| spring-core | 19 | 0 | 12 | 7 | 4.16 | 3.42 | 5.00 | Healthy; intuition/diagram + example gaps |
| spring-boot | 18 | 0 | 15 | 3 | 4.44 | 3.22 | 5.00 | Healthy; 3 factual errors + example gap |
| kubernetes | 19 | 0 | 16 | 3 | 4.95 | 3.42 | 4.37 | Healthy; forward-dated version claims to verify |
| system-design | 86 | 0 | 61 | 25 | 4.81 | 3.28 | 4.72 | Excellent; example gap concentrated in arch-*/ccp-* |
| grpc | 16 | 0 | 14 | 2 | 4.94 | 3.44 | 4.50 | Strong; 1 retry-jitter bug to verify + example gap |
| docker | 16 | 0 | 11 | 5 | 4.94 | 3.63 | 4.38 | Structurally healthy; version-fact sweep owed |
| networking | 16 | 0 | 11 | 5 | 4.44 | 3.56 | 5.00 | Staff-deep; formulas stated but not worked |
| interview-craft | 16 | 0 | 8 | 8 | 4.94 | 3.94 | 4.38 | Strong; missing worked end-to-end examples |
| security | 17 | 0 | 4 | 13 | 4.76 | 3.65 | 5.00 | Strong; near-publishable + example gap |
| testing | 16 | 0 | 9 | 7 | 4.94 | 4.00 | 4.69 | Strong; "quantify the claims" pass |
| hibernate-jpa | 18 | 0 | 9 | 9 | 4.72 | 4.00 | 5.00 | Healthiest tier; 2 correctness errors |
| rest-api-design | 20 | 0 | 7 | 13 | 4.90 | 3.90 | 4.95 | Mature staff-grade; 2 likely spec errors |
| reliability-ops | 16 | 0 | 4 | 12 | 4.88 | 4.00 | 5.00 | Near-publishable; polish only |
| **Total** | **429** | **1** | **308** | **120** | — | — | — | — |

## Corpus-wide systemic themes

These are the recurring issues synthesized across all 19 domains. Fixing them systematically — rather than file-by-file — is the point of this audit.

### 1. Missing numbers-in / numbers-out worked examples (universal — all 19 domains)

**What it means:** The single hardest concept in each file is explained in prose, a formula, a box diagram, or a code skeleton, but the learner is never walked through the concrete trace: plug in real inputs, show intermediate state, produce the output. This is the #2-weighted axis in our bar and the lowest-scoring axis in *every* domain.

**Where it concentrates:** Everywhere, but most acutely in `devops-cicd` (examples 2.95 — DORA arithmetic, error budgets, OIDC trust policies), `spring-boot` (3.22 — three-level cache trace missing across files), `lld-and-ood` (3.24 — concurrency told-not-shown), `system-design` (3.28, 212 issues across 85/86 files, concentrated in `arch-*`/`ccp-*` pattern catalogs), `observability` (3.29 — histogram interpolation, burn-rate), `messaging-databases` (3.30), `java-jvm` (3.32 — CAS, happens-before, TLAB, JIT tiering), `kubernetes`/`spring-core` (3.42). Concrete quantitative concepts named-but-never-computed recur: Little's Law, BDP/window sizing, availability nines, equity dilution, p^N flakiness, mutation score, error budgets.

### 2. Drifting factual claims needing a batched web-verification sweep (nearly all domains)

**What it means:** Version numbers, service limits, pricing, defaults, spec citations, and statistics are asserted from memory. Most domains flag the large majority — often 100% — of files as `needs_web_verification`.

**Where it concentrates:** `security` (17/17), `docker` (15/16), `messaging-databases` (18/20), `interview-craft` (12 files — Amazon LPs, level mappings), `kubernetes` (all 19, incl. likely-wrong forward-dated GA claims: Gateway API v1.6, in-place resize 1.35, MutatingAdmissionPolicy 1.36), `system-design` (57 files, stale AWS numbers), `grpc` (defaults, gRFC A6). Recommendation: run this as **one batched sweep per domain**, not per file.

### 3. Confirmed correctness errors (~12, scattered)

**What it means:** Content that actively teaches something wrong — must be fixed before publish regardless of the example work.

**Where it concentrates:** `dsa-coding` (recursion-backtracking permutation dedup rule — the one high-priority file), `hibernate-jpa` (pooled-optimizer PK math; illegal aggregate-in-WHERE), `java-jvm` (serialization enum/`readResolve`), `spring-boot` (reactive `zip` mislabeled `combineLatest`; async `fixedRate` overlap mis-attribution; non-existent `spring.main.background-initialization`), `spring-core` (PathPattern MVC-default version), `observability` (5 bugs: on-call self-scaling, PromQL `group_left` direction, Jaeger self-time union, Grafana multi-value interpolation, OTel head-sampling), `networking` (HTTP `Content-Length`+`Transfer-Encoding` self-contradiction), `rest-api-design` (fabricated "RFC 10008" for QUERY; Deprecation header mislabeled — it is RFC 9745), `grpc` (suspected gRFC A6 retry-jitter bug to verify), `system-design` (several AWS number contradictions).

### 4. Undefined load-bearing jargon and named-but-unexplained mechanisms (~10 domains)

**What it means:** Terms-of-art are used before they are defined, and hard mechanisms are name-dropped without being taught. Trips up exactly the learner the file is for.

**Where it concentrates:** `java-jvm` (CAS, happens-before, colored pointers, DCL), `messaging-databases` (consistent hashing, 2PC, LSM-tree, skip list, write skew), `docker` (restart policies, SELinux `:z`/`:Z`, cgroup/nsenter), `grpc` (keepalive, varint, exemplars), `hibernate-jpa` (persistence context, flush, AST), `spring-boot`/`spring-core` (BREACH, synchronizer-token, three-level cache), `system-design` (saga/outbox dual-write, DLQ loops, ambient mesh, request hedging).

### 5. Reference code / diagrams that contradict their own prose or each other (concentrated in code-heavy domains)

**What it means:** Skeletons demonstrate the exact bug the surrounding text warns against; diagrams, API signatures, and models disagree and force the learner to reconcile them.

**Where it concentrates:** `lld-and-ood` (~10 files where skeletons contradict safety prose: movie-booking, traffic-signal, digital-wallet, atm, elevator; plus ~9 diagram↔API↔skeleton mismatches), `testing` (test-double taxonomy inconsistent; mermaid-vs-Mockito contradiction), `reliability-ops` (circuit-breaker decorator ordering, broken RCA cross-reference).

### 6. Missing diagrams for inherently spatial/sequential concepts (secondary, but repeated)

**What it means:** Filter chains, state machines, request lifecycles, topologies, and saga flows are described in prose despite the repo's working mermaid render pipeline.

**Where it concentrates:** `spring-core` (~13 files), `spring-boot` (11 files), `security` (~10 files), `rest-api-design` (~8 files). Lower weight than examples in our bar, but cheap wins where a diagram already "wants" to exist.

### 7. Length / redundancy / ordering seams (minor, editorial)

**What it means:** Long files repeat points, split related topics far apart, or present unreconciled numbers back-to-back. Needs consolidation, forward-references, and orientation lines.

**Where it concentrates:** `rest-api-design`, `reliability-ops` (6 padded subtopics), `security` (ordering seams), `system-design`.

## Recommended order of attack

The strategy: clear the small correctness backlog first (cheap, protects credibility), then run the high-leverage worked-example pass across the corpus in waves ordered by need, folding the batched fact-verification sweep into each wave.

**Wave 0 — Correctness & verification (fast, do first).**
Fix the one high-priority `dsa-coding` bug and the ~12 confirmed errors listed in Systemic Theme 3. In the same pass, verify the highest-risk forward-dated/limit claims: `kubernetes` GA dates, `grpc` gRFC A6 retry jitter, `rest-api-design` RFC citations, `system-design` AWS numbers. Deliverable: zero known-wrong statements in the corpus.

**Wave 1 — Worst example-gap, highest-traffic domains.**
`devops-cicd` (2.95), `dsa-coding` (3.00), `spring-boot` (3.22), `lld-and-ood` (3.24), `system-design` (3.28 — start with the `arch-*`/`ccp-*` pattern catalogs and `aws-fundamentals`, the 14 files scored example=2). These have the lowest example scores and the largest learner reach. One traced example per hard concept, using each domain's `top_priority_slugs` as the file order.

**Wave 2 — Mid example-gap core-interview domains.**
`observability` (3.29), `messaging-databases` (3.30), `java-jvm` (3.32), `kubernetes` (3.42), `spring-core` (3.42), `grpc` (3.44), `networking` (3.56 — work the stated-but-unworked formulas), `docker` (3.63), `security` (3.65). Same worked-example pass + batched fact sweep per domain.

**Wave 3 — Polish tier (already close to publishable).**
`rest-api-design` (3.90), `interview-craft` (3.94 — add labeled STAR / traced-dialogue artifacts), `testing` (4.00 — "quantify the claims you already make"), `hibernate-jpa` (4.00), `reliability-ops` (4.00). Mostly one example per file plus the editorial consolidation from Theme 7.

Within every wave, drive file order from each domain's `top_priority_slugs`, and where a domain has a reusable explainer taught piecemeal (e.g. prefix-sum+hashmap and quickselect in `dsa-coding`; three-level-cache trace in `spring-core`/`spring-boot`), write it once, canonically, and forward-reference it.

## The refinement standard

Every refined subtopic should hit this bar before it is marked done:

1. **Intuition-first opener.** Lead with a plain-language "here's the mental model / why this exists" paragraph *before* any formalism, definition, or code. (Directly addresses the definition-first lead-ins flagged in `spring-core`, `spring-boot`.)
2. **A worked example per hard concept.** For each genuinely hard idea in the file, show a concrete numbers-in / numbers-out (or bytes-in / bytes-out, or step-by-step interleaving) trace — not just the formula or a bare code template. This is the top-weighted fix corpus-wide.
3. **Reasoned trade-offs.** State the alternatives and *why* you'd pick one, with the conditions that flip the decision — not a feature list.
4. **A follow-ups / gotchas layer.** Add the senior "what if it goes sideways" turn: the edge cases, failure modes, and interview follow-up questions (streaming edge cases, teardown/graceful-shutdown, poison-pill/DLQ, deep pagination, "what if I lack the story").
5. **Defined jargon.** Every load-bearing term-of-art is defined at first use; every named mechanism is either taught or explicitly linked out. No "named-not-taught."
6. **Consistent, self-consistent structure.** Code skeletons must not contradict their own prose; diagrams, API signatures, and models must agree; sections follow the same shape across the domain. Add a mermaid diagram wherever the concept is inherently spatial/sequential.
7. **Verified facts.** Version numbers, limits, pricing, and spec citations checked in the batched web-verification sweep; no forward-dated or drifting claims.

## Per-domain report index

- [devops-cicd](devops-cicd/CONTENT-AUDIT.md)
- [docker](docker/CONTENT-AUDIT.md)
- [dsa-coding](dsa-coding/CONTENT-AUDIT.md)
- [grpc](grpc/CONTENT-AUDIT.md)
- [hibernate-jpa](hibernate-jpa/CONTENT-AUDIT.md)
- [interview-craft](interview-craft/CONTENT-AUDIT.md)
- [java-jvm](java-jvm/CONTENT-AUDIT.md)
- [kubernetes](kubernetes/CONTENT-AUDIT.md)
- [lld-and-ood](lld-and-ood/CONTENT-AUDIT.md)
- [messaging-databases](messaging-databases/CONTENT-AUDIT.md)
- [networking](networking/CONTENT-AUDIT.md)
- [observability](observability/CONTENT-AUDIT.md)
- [reliability-ops](reliability-ops/CONTENT-AUDIT.md)
- [rest-api-design](rest-api-design/CONTENT-AUDIT.md)
- [security](security/CONTENT-AUDIT.md)
- [spring-boot](spring-boot/CONTENT-AUDIT.md)
- [spring-core](spring-core/CONTENT-AUDIT.md)
- [system-design](system-design/CONTENT-AUDIT.md)
- [testing](testing/CONTENT-AUDIT.md)
