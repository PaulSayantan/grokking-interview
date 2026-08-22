# Corpus statistics — authoritative

**Regenerate with `python3 scripts/corpus_stats.py`.** Generated 2026-08-23 from `topics/`.

> [!WARNING]
> **This document supersedes every ad-hoc corpus number quoted elsewhere in the repo** —
> `ROADMAP.md`, `OPTIMIZATION-ROADMAP.md`, `topics/CONTENT-AUDIT-MASTER.md`,
> `web/CONTRACT.md`, per-domain audits, and skill files. Those were measured at different
> times with different (often undocumented) tokenizers. When a number here disagrees with
> a number there, this one wins — and the other should be fixed or deleted, not averaged.
> Do not hand-edit this file: change the script and re-run it.

## Headline

- **20 domains, 460 topics, 28,064 MCQs** (27,985 single / 79 multi).
- **28,064 questions carry a `ref`** (100.0%): H2 28,058, H3+ 6.
- **2,339,891 raw words** across 460 `concepts.md` (1,811,972 of them prose, i.e. 77% — the rest is code, tables, and headings).
- **H2 sections per file: median 15, p95 29, max 72** (`topics/system-design/dp-enterprise-application/concepts.md`), 7,903 H2s in total. The disputed max is **72** — see below.
- **Reading minutes: median 24, p90 36, max 83** (`topics/system-design/dp-enterprise-application`), total 11,707 minutes (195 hours) of reading.
- **Sentences: mean 14.9 words, p90 28**; 8,950 over 30 words (7.4% of 120,795), 1,290 over 45.
- **1,177 mermaid blocks**; 109 files (24%) have none.
- **3,239 callouts** (1.79 per 1,000 prose words); 256 files exceed 5.
- Prose density: **39.83 bold spans**, **28.75 open parens**, **35.97 nominalizations** per 1,000 prose words.
- Every `ref` anchor resolves to a real heading (0 unresolved).

## Contradictions with numbers quoted elsewhere

Recomputed on every run from `QUOTED_CLAIMS` in the script, so this table cannot itself go
stale. Line numbers are as of the generation date above; the claim text is what to grep
for. **Any row marked STALE should be corrected or deleted at its source** — do not
re-derive a rule from it.

| Source | Quoted claim | Quoted | Measured | Verdict |
|---|---|---:|---:|---|
| `ROADMAP.md:117` | `460 files, 28,064 Qs` (validator line) | 460 | 460 | ok |
| `ROADMAP.md:117` | `460 files, 28,064 Qs` — question total | 28,064 | 28,064 | ok |
| `ROADMAP.md:117` | "system-design domain now **86 topics**" | 86 | 94 | **STALE** |
| `ROADMAP.md:81` | rollup row: system-design `70 ✅` authored | 70 | 94 | **STALE** |
| `ROADMAP.md:85` | rollup row: rest-api-design `18` topics | 18 | 20 | **STALE** |
| `ROADMAP.md:85` | rollup row: rest-api-design `1,529 MCQs` | 1,529 | 1,633 | **STALE** |
| `ROADMAP.md:91` | rollup row: messaging-databases `15` topics | 15 | 20 | **STALE** |
| `ROADMAP.md:91` | rollup row: messaging-databases `815 MCQs` | 815 | 1,086 | **STALE** |
| `ROADMAP.md:92` | rollup row: security `16` topics | 16 | 17 | **STALE** |
| `ROADMAP.md:92` | rollup row: security `1,291 MCQs` | 1,291 | 1,341 | **STALE** |
| `ROADMAP.md:78-99` | rollup table row count (domains listed) | 19 | 20 | **STALE** |
| `topics/CONTENT-AUDIT-MASTER.md:26` | "19 domains and 429 subtopics" — domains | 19 | 20 | **STALE** |
| `topics/CONTENT-AUDIT-MASTER.md:26` | "19 domains and 429 subtopics" — subtopics | 429 | 460 | **STALE** |
| `topics/CONTENT-AUDIT-MASTER.md:52` | scorecard row: system-design `86` subtopics | 86 | 94 | **STALE** |
| `OPTIMIZATION-ROADMAP.md:3` | "430 topics / ~21k MCQs" — topics | 430 | 460 | **STALE** |
| `OPTIMIZATION-ROADMAP.md:3` | "430 topics / ~21k MCQs" — MCQs | 21,000 | 28,064 | **STALE** |
| `OPTIMIZATION-ROADMAP.md:33` | "320 files, 1,112 diagrams" — files with a diagram | 320 | 351 | **STALE** |
| `OPTIMIZATION-ROADMAP.md:33` | "320 files, 1,112 diagrams" — mermaid blocks | 1,112 | 1,177 | **STALE** |
| `OPTIMIZATION-ROADMAP.md:48` | "only 209/430 have a link" — denominator | 430 | 460 | **STALE** |
| `web/CONTRACT.md:81` | "4 authored domains" | 4 | 20 | **STALE** |
| `web/CONTRACT.md:81` | "119 subtopics" | 119 | 460 | **STALE** |
| `web/CONTRACT.md:81` | "9432 questions" | 9,432 | 28,064 | **STALE** |
| `web/CONTRACT.md:82` | "system-design 57/4515" — subtopics | 57 | 94 | **STALE** |
| `web/CONTRACT.md:99` | `"questionCount": 4515` (system-design) | 4,515 | 6,611 | **STALE** |
| `web/CONTRACT.md:240` | "all 119 entries" | 119 | 460 | **STALE** |

**23 of 25 quoted figures are stale.** The recurring cause is that
`ROADMAP.md`'s rollup table, `CONTENT-AUDIT-MASTER.md`'s scorecard, and `web/CONTRACT.md`'s
"current generated volume" were each snapshotted once and never regenerated, while
`topics/` kept growing. `web/CONTRACT.md` is the worst offender — it is ~4x low on every
count while `CLAUDE.md` points at it as the authoritative data-shape reference.

Not machine-checkable here, but worth flagging by hand:

- `ROADMAP.md`'s rollup table has **no row at all** for `system-design-case-studies` (23 topics, 230 MCQs), which is why its domain
  count reads 19 instead of 20.
- `OPTIMIZATION-ROADMAP.md:113` reasons about "6,672 non-boilerplate sections". The total
  H2 count is 7,903 and total headings (all levels, fence-aware) is
  8,702, so 6,672 is plausible as a filtered subset — but the filter is
  undocumented and not reproducible. Re-derive from this script before citing it.
- `OPTIMIZATION-ROADMAP.md:32` ("correct = uniquely longest 87.3%") is an MCQ-integrity
  figure owned by `scripts/mcq_quality_report.py`, not this script; the distractor rollout
  has since moved it. Run that script rather than quoting the roadmap.

## How these numbers are measured (the tokenizer)

Stated here in full because every downstream numeric rule will be written against it and
must be reproducible. This is the same contract as the script's module docstring.

1. **Fences.** A line matching ``^\s*(`{3,}|~{3,})(.*)$`` opens a fenced block (char +
   run length remembered); it closes on the same char, at least as long, with no info
   string. Fence markers and their contents are **code**: never prose, never headings. A
   `#` comment inside a Dockerfile sample is not an H1.
2. **Headings.** Outside fences only: `^(#{1,6})(?:[ \t]+(.*))?$`. Anchor slug =
   lowercase → drop all but word chars/whitespace/hyphen → each single whitespace char
   becomes one hyphen, runs **not** collapsed (github-slugger behaviour: `SQL & NoSQL` →
   `sql--nosql`). Heading lines are excluded from prose.
3. **Prose vs non-prose.** Prose = every non-fence line except headings, table rows
   (`^\s*\|`), thematic breaks, and whole-line HTML comments. Leading `>` blockquote
   markers and list markers (`-`, `*`, `+`, `1.`, `1)`) are stripped; a leading callout
   marker is counted and removed. Mermaid diagrams are inside fences, so they are code.
4. **Normalization order.** images removed → `[text](url)` → `text` → inline code spans →
   the single placeholder word `code` → bold spans counted → `**`/`__`/`*`/`_`/`~~`
   removed. Parens and words inside code spans or link URLs therefore never inflate
   prose metrics.
5. **Words (prose).** Whitespace split of the normalized text; a token is a word only if
   it contains at least one `[A-Za-z0-9]`. `prose_words` is the denominator of every
   "per 1,000 words" figure below.
6. **Segments and sentences.** A new segment begins at a blank line, list item,
   blockquote line, heading, table row, or break; continuation lines join with one space.
   A sentence ends at a word-final `.`/`!`/`?` (trailing quotes/brackets allowed) unless
   the token is a known abbreviation (`e.g.`, `i.e.`, `etc.`, `vs.`, `cf.`, `approx.`,
   `al.`, `Fig.`, `No.`, `Inc.`, `Dr.`, `Mr.`, `Ms.`, `Mrs.`, `St.`, `Jr.`, `Sr.`, `ca.`,
   `resp.`, `ex.`) or a single-letter initial. Segment end always ends a sentence, so an
   unterminated bullet counts as one. **Sentences shorter than 3 words are
   discarded** as fragments and are absent from the mean, p90, and over-30/over-45 counts.
7. **Nominalizations.** Prose word, lowercased and stripped to `[a-z]`, length ≥ 5,
   ending `tion|ment|ance|ence|ity` with optional plural `s`. **Caveat:** a pure suffix
   heuristic, so it also catches innocent words ("sentence", "instance", "difference",
   "quality"). Treat it as a *relative* density signal between files and domains, never
   as an absolute count.
8. **Raw words and reading minutes.** `raw_words` = whole-file whitespace split (code
   included) — this is what the site counts. Reading minutes replicate
   `web/scripts/sync-content.mjs` exactly: strip a leading `# H1`, `trim()`, whitespace
   split, drop empties, `max(1, round(words / 200))` with JS half-up rounding. So the
   figure equals the `readingMinutes` a reader sees on the page.
9. **Percentiles.** `median` is conventional (mean of the two middle values when even).
   `p90`/`p95` are **nearest-rank**: `index = ceil(p/100 * n) - 1`, clamped — no
   interpolation, so every percentile printed is a value that actually occurs.

Counted per topic directory that contains a `questions.yaml` (the same population the
validator walks), so `topics` here means "MCQ-bearing subtopic".

**Two deliberate exclusions worth knowing before you write a rule against these numbers.**
Markdown tables are excluded from prose: this corpus teaches heavily through comparison
tables, so `prose words` understates the words a learner actually reads, and a table-dense
file will look shorter in prose metrics than it reads. And a sentence is only counted at
≥ 3 words, so a file written in clipped fragments scores a *higher* mean
sentence length than a naive splitter would give it. Both choices make the numbers stable;
neither is neutral.

## Size — `concepts.md` lines and words

`raw words` includes code/tables (site basis); `prose words` is prose only.

| Domain | Topics | lines min/med/p90/max | raw words min/med/p90/max | prose words med | longest file (raw words) |
|---|---:|---|---|---:|---|
| devops-cicd | 21 | 452/567/719/758 | 3,530/4,586/4,973/5,120 | 3,291 | `linux-scripting-and-os-fundamentals` (5,120) |
| docker | 16 | 412/527/620/711 | 2,844/3,956/4,508/4,701 | 2,716 | `image-internals-storage-drivers` (4,701) |
| dsa-coding | 20 | 373/460/546/567 | 3,161/3,810/4,274/5,057 | 2,417 | `advanced-structures-string-algorithms` (5,057) |
| grpc | 16 | 398/481/564/906 | 2,982/3,578/4,670/6,336 | 2,529 | `grpc-fundamentals-and-when-to-use` (6,336) |
| hibernate-jpa | 18 | 635/766/958/969 | 4,322/5,336/6,282/6,730 | 3,748 | `primary-keys-and-id-generation` (6,730) |
| interview-craft | 16 | 359/473/592/652 | 3,077/4,405/5,535/5,772 | 3,321 | `design-docs-rfcs-and-adrs` (5,772) |
| java-jvm | 25 | 340/464/610/742 | 2,346/3,777/4,983/5,445 | 2,671 | `multithreading-concurrency` (5,445) |
| kubernetes | 19 | 414/633/728/805 | 2,690/4,452/5,352/5,621 | 3,141 | `api-objects-kubectl` (5,621) |
| lld-and-ood | 33 | 431/589/700/779 | 2,730/4,183/4,981/5,527 | 2,638 | `design-chess-game` (5,527) |
| messaging-databases | 20 | 469/585/648/685 | 3,570/4,714/5,349/5,943 | 3,708 | `database-storage-internals-engines` (5,943) |
| networking | 16 | 603/766/978/1191 | 5,102/6,641/8,094/9,968 | 5,547 | `tls-ssl-https` (9,968) |
| observability | 17 | 403/526/619/649 | 3,347/3,975/4,683/4,712 | 3,159 | `sampling-cardinality-and-telemetry-cost-management` (4,712) |
| reliability-ops | 16 | 593/789/863/941 | 5,477/7,069/8,088/8,712 | 5,478 | `cascading-failures-and-antipatterns` (8,712) |
| rest-api-design | 20 | 547/908/1084/1282 | 3,955/6,694/7,524/8,924 | 5,405 | `api-authentication-and-authorization` (8,924) |
| security | 17 | 466/896/1008/1059 | 3,954/7,502/8,417/8,597 | 6,330 | `xss-csp-and-security-headers` (8,597) |
| spring-boot | 18 | 385/717/1018/1037 | 4,776/5,776/8,750/9,025 | 4,319 | `spring-data-jpa-persistence` (9,025) |
| spring-core | 19 | 331/565/783/793 | 3,362/5,210/6,170/6,749 | 4,239 | `spring-data-persistence` (6,749) |
| system-design | 94 | 281/744/1079/2648 | 2,153/6,304/8,836/16,639 | 5,186 | `dp-enterprise-application` (16,639) |
| system-design-case-studies | 23 | 216/248/274/314 | 1,947/2,249/2,514/2,741 | 1,973 | `slack-shipyard-ec2-platform` (2,741) |
| testing | 16 | 383/520/628/663 | 2,916/3,533/4,304/4,887 | 2,520 | `testing-fundamentals-and-test-pyramid` (4,887) |
| **CORPUS** | **460** | 216/610/917/2648 | 1,947/4,772/7,262/16,639 | 3,593 | `system-design/dp-enterprise-application` (16,639) |

## MCQs — counts, types, difficulty, options

| Domain | MCQs | single | multi | beginner | intermediate | advanced | expert | 3 opt | 4 opt | 5 opt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| devops-cicd | 1,065 | 1,065 | 0 | 239 | 553 | 268 | 5 | 0 | 1,065 | 0 |
| docker | 794 | 794 | 0 | 180 | 382 | 214 | 18 | 0 | 794 | 0 |
| dsa-coding | 456 | 456 | 0 | 87 | 220 | 146 | 3 | 0 | 456 | 0 |
| grpc | 806 | 806 | 0 | 114 | 372 | 295 | 25 | 0 | 806 | 0 |
| hibernate-jpa | 1,401 | 1,401 | 0 | 131 | 419 | 496 | 355 | 0 | 1,401 | 0 |
| interview-craft | 793 | 793 | 0 | 126 | 395 | 258 | 14 | 0 | 792 | 1 |
| java-jvm | 1,555 | 1,555 | 0 | 319 | 523 | 440 | 273 | 0 | 1,555 | 0 |
| kubernetes | 981 | 981 | 0 | 220 | 472 | 286 | 3 | 0 | 981 | 0 |
| lld-and-ood | 1,671 | 1,671 | 0 | 359 | 838 | 432 | 42 | 0 | 1,671 | 0 |
| messaging-databases | 1,086 | 1,086 | 0 | 213 | 564 | 301 | 8 | 0 | 1,086 | 0 |
| networking | 1,372 | 1,372 | 0 | 220 | 435 | 414 | 303 | 0 | 1,372 | 0 |
| observability | 844 | 844 | 0 | 209 | 435 | 196 | 4 | 0 | 844 | 0 |
| reliability-ops | 1,279 | 1,279 | 0 | 121 | 395 | 476 | 287 | 0 | 1,278 | 1 |
| rest-api-design | 1,633 | 1,633 | 0 | 243 | 571 | 499 | 320 | 0 | 1,633 | 0 |
| security | 1,341 | 1,341 | 0 | 181 | 474 | 417 | 269 | 0 | 1,341 | 0 |
| spring-boot | 1,851 | 1,851 | 0 | 226 | 542 | 659 | 424 | 0 | 1,851 | 0 |
| spring-core | 1,511 | 1,511 | 0 | 341 | 473 | 344 | 353 | 0 | 1,511 | 0 |
| system-design | 6,611 | 6,532 | 79 | 1,068 | 2,287 | 2,261 | 995 | 0 | 6,610 | 1 |
| system-design-case-studies | 230 | 230 | 0 | 37 | 96 | 95 | 2 | 0 | 230 | 0 |
| testing | 784 | 784 | 0 | 178 | 407 | 199 | 0 | 0 | 784 | 0 |
| **CORPUS** | 28,064 | 27,985 | 79 | 4,812 | 10,853 | 8,696 | 3,703 | 0 | 28,061 | 3 |

## H2 counts — settling the "58 vs 72" dispute

Two planning docs disagreed about the maximum number of `## H2` sections in a single file:
one said 58, one said 72. Measured fence-aware over the whole corpus, the maximum is
**72**, in `topics/system-design/dp-enterprise-application/concepts.md`.

- The **58** claim is **WRONG** (actual max is 72).
- The **72** claim is **CORRECT**.

Fence-awareness is *not* what separated the two claims here — no `## ` line in the corpus
sits inside a code fence, so naive and fence-aware H2 counts agree exactly
(7,903 = 7,903 corpus-wide).

It matters a great deal at other heading levels, though, which is why fence-awareness is
non-negotiable for any heading metric: counting `#{1,6}` lines blind to fences reports
**9,127** headings versus **8,702** real ones — **425 phantom
headings across 96 files**, almost all of them `#` comments in shell, YAML, and Dockerfile samples.

Nor is 58 a stale reading of the same file: at the commit that introduced
`dp-enterprise-application` (`38e8ac2`, 2026-07-20) it already had 71 `## ` headings, and 72
from `268a063` onward — it has never had 58. So the 58 figure came from a different
population or an undocumented filter (a subset of domains, or "non-boilerplate" sections
only). Cite this table instead. *(Git-history note verified as of the generation date.)*

| Domain | H2 min | H2 median | H2 p95 | H2 max | max file |
|---|---:|---:|---:|---:|---|
| devops-cicd | 12 | 16 | 21 | 23 | `git-and-branching-strategies` |
| docker | 12 | 15 | 19 | 19 | `docker-compose` |
| dsa-coding | 10 | 12 | 19 | 21 | `coding-patterns-overview` |
| grpc | 11 | 13 | 21 | 21 | `grpc-fundamentals-and-when-to-use` |
| hibernate-jpa | 19 | 22 | 31 | 31 | `inheritance-embeddables-composite-keys` |
| interview-craft | 11 | 14 | 18 | 18 | `hiring-manager-and-project-deep-dive` |
| java-jvm | 7 | 11 | 16 | 17 | `garbage-collection` |
| kubernetes | 11 | 16 | 21 | 21 | `ingress-gateway-api` |
| lld-and-ood | 10 | 13 | 17 | 20 | `design-principles-beyond-solid` |
| messaging-databases | 11 | 15 | 18 | 20 | `search-engines-and-elasticsearch` |
| networking | 16 | 28 | 38 | 38 | `http2-http3-quic` |
| observability | 11 | 15 | 19 | 19 | `instrumentation-with-micrometer-and-metrics-libraries` |
| reliability-ops | 16 | 24 | 30 | 30 | `disaster-recovery-rpo-rto-strategies` |
| rest-api-design | 15 | 28 | 32 | 33 | `api-gateways-and-bff` |
| security | 14 | 27 | 34 | 34 | `xss-csp-and-security-headers` |
| spring-boot | 12 | 20 | 29 | 29 | `spring-data-jpa-persistence` |
| spring-core | 8 | 13 | 20 | 20 | `spring-vs-spring-boot` |
| system-design | 5 | 17 | 36 | 72 | `dp-enterprise-application` |
| system-design-case-studies | 7 | 10 | 12 | 12 | `linkedin-sales-navigator-spark-pipeline` |
| testing | 12 | 14 | 17 | 17 | `parameterized-and-data-driven-tests` |
| **CORPUS** | 5 | 15 | 29 | 72 | `system-design/dp-enterprise-application` |

## `ref` targets by heading depth

Anchor resolved against the topic's own `concepts.md` headings (fence-aware). When two
headings slugify identically the FIRST one wins, matching how a browser resolves the
fragment.

| Domain | questions | with ref | H1 | H2 | H3+ | unresolved | malformed |
|---|---:|---:|---:|---:|---:|---:|---:|
| devops-cicd | 1,065 | 1,065 | 0 | 1,065 | 0 | 0 | 0 |
| docker | 794 | 794 | 0 | 794 | 0 | 0 | 0 |
| dsa-coding | 456 | 456 | 0 | 454 | 2 | 0 | 0 |
| grpc | 806 | 806 | 0 | 806 | 0 | 0 | 0 |
| hibernate-jpa | 1,401 | 1,401 | 0 | 1,399 | 2 | 0 | 0 |
| interview-craft | 793 | 793 | 0 | 793 | 0 | 0 | 0 |
| java-jvm | 1,555 | 1,555 | 0 | 1,555 | 0 | 0 | 0 |
| kubernetes | 981 | 981 | 0 | 981 | 0 | 0 | 0 |
| lld-and-ood | 1,671 | 1,671 | 0 | 1,671 | 0 | 0 | 0 |
| messaging-databases | 1,086 | 1,086 | 0 | 1,086 | 0 | 0 | 0 |
| networking | 1,372 | 1,372 | 0 | 1,372 | 0 | 0 | 0 |
| observability | 844 | 844 | 0 | 844 | 0 | 0 | 0 |
| reliability-ops | 1,279 | 1,279 | 0 | 1,279 | 0 | 0 | 0 |
| rest-api-design | 1,633 | 1,633 | 0 | 1,632 | 1 | 0 | 0 |
| security | 1,341 | 1,341 | 0 | 1,341 | 0 | 0 | 0 |
| spring-boot | 1,851 | 1,851 | 0 | 1,851 | 0 | 0 | 0 |
| spring-core | 1,511 | 1,511 | 0 | 1,511 | 0 | 0 | 0 |
| system-design | 6,611 | 6,611 | 0 | 6,611 | 0 | 0 | 0 |
| system-design-case-studies | 230 | 230 | 0 | 229 | 1 | 0 | 0 |
| testing | 784 | 784 | 0 | 784 | 0 | 0 | 0 |
| **CORPUS** | 28,064 | 28,064 | 0 | 28,058 | 6 | 0 | 0 |

Corpus: 0 questions carry no `ref` at all (0.0%). `ref` is optional in the schema.

## Mermaid diagrams and callouts

| Domain | mermaid blocks | files with 0 | TIP | WARNING | INTERVIEW | KEY-TAKEAWAY | callouts total | per 1k prose words | files > 5 callouts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| devops-cicd | 54 | 1 | 58 | 77 | 58 | 41 | 234 | 3.34 | 21 |
| docker | 47 | 2 | 46 | 62 | 44 | 25 | 177 | 4.16 | 16 |
| dsa-coding | 42 | 1 | 28 | 42 | 20 | 27 | 117 | 2.37 | 10 |
| grpc | 52 | 0 | 33 | 63 | 28 | 31 | 155 | 3.45 | 16 |
| hibernate-jpa | 40 | 2 | 36 | 94 | 47 | 60 | 237 | 3.49 | 18 |
| interview-craft | 40 | 0 | 61 | 57 | 44 | 36 | 198 | 3.55 | 16 |
| java-jvm | 2 | 23 | 1 | 2 | 1 | 3 | 7 | 0.1 | 0 |
| kubernetes | 55 | 0 | 40 | 80 | 56 | 43 | 219 | 3.73 | 19 |
| lld-and-ood | 60 | 0 | 22 | 27 | 24 | 29 | 102 | 1.16 | 7 |
| messaging-databases | 50 | 3 | 49 | 74 | 49 | 46 | 218 | 3.01 | 19 |
| networking | 3 | 13 | 47 | 54 | 65 | 34 | 200 | 2.21 | 16 |
| observability | 48 | 1 | 43 | 55 | 44 | 40 | 182 | 3.4 | 17 |
| reliability-ops | 47 | 0 | 49 | 67 | 51 | 53 | 220 | 2.48 | 16 |
| rest-api-design | 8 | 16 | 31 | 70 | 69 | 63 | 233 | 2.22 | 18 |
| security | 6 | 14 | 39 | 79 | 76 | 59 | 253 | 2.45 | 17 |
| spring-boot | 8 | 12 | 0 | 2 | 2 | 0 | 4 | 0.05 | 0 |
| spring-core | 5 | 14 | 2 | 1 | 1 | 0 | 4 | 0.05 | 0 |
| system-design | 540 | 7 | 55 | 74 | 60 | 74 | 263 | 0.52 | 15 |
| system-design-case-studies | 28 | 0 | 6 | 10 | 12 | 23 | 51 | 1.12 | 0 |
| testing | 42 | 0 | 40 | 56 | 32 | 37 | 165 | 3.99 | 15 |
| **CORPUS** | 1,177 | 109 | 686 | 1,046 | 783 | 724 | 3,239 | 1.79 | 256 |

Corpus callouts-per-file distribution: **98** files with 0, **82** files with 1-3, **24** files with 4-5, **256** files with >5. Densest file: `topics/security/xss-csp-and-security-headers/concepts.md` with 27.

Note the shape: the `refining-content` skill asks for **1–3 callouts per file**, yet only
82 of 460 files sit inside that budget while 256 exceed 5. Callout and mermaid usage
are strongly bimodal by domain rather than uniform — the three leanest domains on callouts
are `spring-boot` (0.05/1k), `spring-core` (0.05/1k), `java-jvm` (0.1/1k) — so a corpus-wide average hides the split. Compare domain rows, not the corpus row.

## Prose metrics (prose only — no code, tables, or headings)

| Domain | prose words | sentences | mean sent | p90 sent | > 30 w | > 45 w | bold /1k | open parens /1k | nominalizations /1k |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| devops-cicd | 69,993 | 4,992 | 13.9 | 26 | 280 | 40 | 43.53 | 29.25 | 33.77 |
| docker | 42,571 | 3,130 | 13.5 | 25 | 159 | 23 | 33.12 | 26.0 | 16.96 |
| dsa-coding | 49,444 | 3,475 | 14.2 | 27 | 221 | 49 | 33.21 | 38.61 | 28.72 |
| grpc | 44,934 | 3,202 | 13.9 | 27 | 217 | 28 | 37.88 | 26.62 | 25.1 |
| hibernate-jpa | 67,876 | 4,750 | 14.2 | 27 | 297 | 42 | 34.19 | 25.21 | 43.52 |
| interview-craft | 55,781 | 4,239 | 13.1 | 24 | 169 | 14 | 25.28 | 16.49 | 35.03 |
| java-jvm | 68,422 | 4,577 | 14.8 | 28 | 325 | 46 | 39.45 | 31.88 | 35.19 |
| kubernetes | 58,707 | 4,241 | 13.8 | 26 | 255 | 31 | 46.06 | 29.52 | 25.64 |
| lld-and-ood | 88,192 | 6,125 | 14.3 | 26 | 380 | 73 | 29.65 | 29.75 | 39.33 |
| messaging-databases | 72,416 | 4,844 | 14.9 | 28 | 355 | 53 | 36.44 | 29.05 | 33.06 |
| networking | 90,656 | 6,037 | 14.9 | 28 | 461 | 58 | 47.99 | 36.13 | 33.48 |
| observability | 53,543 | 3,800 | 14.0 | 26 | 232 | 24 | 39.09 | 25.9 | 30.93 |
| reliability-ops | 88,644 | 5,984 | 14.7 | 27 | 390 | 52 | 41.27 | 25.26 | 37.88 |
| rest-api-design | 105,088 | 7,386 | 14.1 | 27 | 469 | 53 | 42.01 | 28.87 | 32.87 |
| security | 103,055 | 6,884 | 14.9 | 28 | 531 | 75 | 47.53 | 32.06 | 37.65 |
| spring-boot | 87,416 | 5,240 | 16.6 | 31 | 558 | 93 | 36.03 | 29.8 | 37.86 |
| spring-core | 76,152 | 4,435 | 17.1 | 32 | 502 | 99 | 29.23 | 25.17 | 43.01 |
| system-design | 502,283 | 31,503 | 15.8 | 29 | 2,769 | 402 | 44.4 | 30.21 | 39.36 |
| system-design-case-studies | 45,402 | 2,995 | 15.1 | 28 | 212 | 15 | 33.77 | 13.59 | 33.04 |
| testing | 41,397 | 2,956 | 13.9 | 26 | 168 | 20 | 32.93 | 24.28 | 39.04 |
| **CORPUS** | 1,811,972 | 120,795 | 14.9 | 28 | 8,950 | 1,290 | 39.83 | 28.75 | 35.97 |

## Rendered reading minutes (site formula)

`max(1, round(raw_words / 200))` on the H1-stripped body — byte-identical
to `readingMinutes` in the generated content collection, so these are the numbers a
learner sees.

Verified: all **460** entries in the generated content collection
(`web/src/content/concepts/*/*.md` frontmatter) carry exactly the `readingMinutes`
computed here — 0 mismatches. The formula is the site's, not an approximation of it.

| Domain | min | median | p90 | max | longest topic | domain total (min) |
|---|---:|---:|---:|---:|---|---:|
| devops-cicd | 18 | 23 | 25 | 26 | `linux-scripting-and-os-fundamentals` | 467 |
| docker | 14 | 20 | 23 | 24 | `image-internals-storage-drivers` | 309 |
| dsa-coding | 16 | 19 | 21 | 25 | `advanced-structures-string-algorithms` | 383 |
| grpc | 15 | 18 | 23 | 32 | `grpc-fundamentals-and-when-to-use` | 311 |
| hibernate-jpa | 22 | 27 | 31 | 34 | `primary-keys-and-id-generation` | 480 |
| interview-craft | 15 | 22 | 28 | 29 | `design-docs-rfcs-and-adrs` | 349 |
| java-jvm | 12 | 19 | 25 | 27 | `multithreading-concurrency` | 473 |
| kubernetes | 13 | 22 | 27 | 28 | `api-objects-kubectl` | 413 |
| lld-and-ood | 14 | 21 | 25 | 28 | `design-chess-game` | 691 |
| messaging-databases | 18 | 24 | 27 | 30 | `database-storage-internals-engines` | 474 |
| networking | 26 | 33 | 40 | 50 | `tls-ssl-https` | 549 |
| observability | 17 | 20 | 23 | 24 | `sampling-cardinality-and-telemetry-cost-management` | 342 |
| reliability-ops | 27 | 36 | 40 | 44 | `cascading-failures-and-antipatterns` | 555 |
| rest-api-design | 20 | 34 | 38 | 45 | `api-authentication-and-authorization` | 655 |
| security | 20 | 38 | 42 | 43 | `xss-csp-and-security-headers` | 612 |
| spring-boot | 24 | 28 | 44 | 45 | `spring-data-jpa-persistence` | 550 |
| spring-core | 17 | 26 | 31 | 34 | `spring-data-persistence` | 482 |
| system-design | 11 | 32 | 44 | 83 | `dp-enterprise-application` | 3,060 |
| system-design-case-studies | 10 | 11 | 13 | 14 | `slack-shipyard-ec2-platform` | 261 |
| testing | 15 | 18 | 22 | 24 | `testing-fundamentals-and-test-pyramid` | 291 |
| **CORPUS** | 10 | 24 | 36 | 83 | `system-design/dp-enterprise-application` | 11,707 |

**Top 10 longest topics by rendered reading time:**

| # | Topic | minutes |
|---:|---|---:|
| 1 | `topics/system-design/dp-enterprise-application/concepts.md` | 83 |
| 2 | `topics/system-design/dp-distributed-cloud/concepts.md` | 80 |
| 3 | `topics/system-design/dp-concurrency/concepts.md` | 67 |
| 4 | `topics/system-design/arch-fundamentals-and-styles/concepts.md` | 54 |
| 5 | `topics/system-design/dp-fundamentals-and-principles/concepts.md` | 51 |
| 6 | `topics/networking/tls-ssl-https/concepts.md` | 50 |
| 7 | `topics/system-design/microservices-ddd-and-boundaries/concepts.md` | 49 |
| 8 | `topics/system-design/cap-theorem-and-consistency/concepts.md` | 48 |
| 9 | `topics/system-design/resilience-tradeoffs-deep-dive/concepts.md` | 48 |
| 10 | `topics/system-design/scalability-and-load-balancing/concepts.md` | 46 |

