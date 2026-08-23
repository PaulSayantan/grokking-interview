---
name: clarity-standard
description: The authoritative standard for a clarity rewrite of a topic's concepts.md — rewrite the prose top to bottom so expert material reads plainly at zero information loss, and author the prompts.yaml sidecar (think-prompts plus a cliffhanger). Use when the task is readability at scale — "make this topic easier to read", "plainer sentences", "an on-ramp into the deep material", "add think-prompts", "run the clarity wave on domain X" — or for any file whose deep sections read as dense and exhausting. For a one-off surgical fix to a topic that is NOT in a clarity wave (one wrong fact, one missing example, one undefined term) use refining-content instead. For a topic that does not exist yet use authoring-content.
---

# The clarity standard — expert ideas, plain sentences

This is the **single authoritative standard** for the clarity rewrite. It supersedes
`/tmp/clarity-design/standard.json` and `/tmp/clarity-design/plan.md` (both deleted) and it
supersedes `topics/CONTENT-AUDIT-MASTER.md`'s "refinement is polish, not triage" conclusion
for any topic in a wave. Where you remember those documents disagreeing, **this file wins.**

> [!KEY-TAKEAWAY]
> This corpus conflates two independent dials, and this rewrite turns them in opposite
> directions. **The difficulty of the IDEA stays exactly where it is — senior/staff
> interview grade. The complexity of the EXPLANATION goes to near zero, in every passage,
> including the deepest one.** Nothing here licenses softening. Every claim, number, caveat,
> version, spec citation and failure mode must survive item for item. Dense prose in a deep
> section is not rigour, it is unfinished thinking — and it sits exactly where readers quit.

The operating test for every sentence in every beat: **could a competent engineer meeting
this concept for the first time follow it on one read, without re-reading and without
looking up anything the file has not already given them?** If not, the sentence is wrong,
not the reader.

## The normative/illustrative invariant — where a rule may live

> **SKILL.md is NORMATIVE. `references/` is ILLUSTRATIVE.**
>
> Every rule, every threshold, every numeric bound and every pass/fail check lives in this
> file. **Each threshold is stated exactly twice and nowhere else: once in its own rule, and
> once in the Review checklist, at the same value.** The checklist is the exit gate, so it has
> to be readable on its own; that one duplication is deliberate and is the only one allowed.
> Where the file template quotes a threshold it is quoting the rule, not setting one.
>
> `references/` holds only examples, before/after pairs, rationale, case studies and corpus
> statistics. **A reference file may not contain a rule, a threshold or an imperative that
> changes what an author must do.** If a sentence in `references/` could be quoted to settle a
> dispute about what is required, it belongs here instead.

If two places in this file ever seem to disagree, that is a bug in this file and the **rule
text wins over the checklist and over the template**. Fix it there rather than working around
it. If a reference file seems to state a requirement, this file wins and the reference file is
the bug.

## How to use this skill

1. **Read this file fully, once.** It is the whole standard: nothing you need in order to
   decide what to write is anywhere else.
2. **Open a reference file only when you want to see an example** of a rule you have already
   read, and open only the one you need. They are illustration; skipping all of them costs you
   nothing normative.
3. **Then work the per-topic loop near the end of this file.** It is the entry point and it
   cites every other section in the order you need it.

Do not read the references, the target `concepts.md` and the sibling `questions.yaml` all before
writing anything — that orientation is what stalls a run. Load the loop's step-1 context, write
section by section, and pull an example only for the rule you are actually unsure about.

| File | Holds |
|---|---|
| `references/examples.md` | The bad/good pair for each C rule, the S1 seam shapes, a full before/after section, and a REGISTER SWAP that failed then passed |
| `references/rationale.md` | The "why" for every rule and the corpus statistics behind each threshold |
| `references/fact-safety-cases.md` | The four real fact regressions, and why a marker grep cannot be the gate |
| `references/prompts-and-cliffhangers.md` | A full shipped `prompts.yaml`, a full shipped cliffhanger, and the six patterns illustrated |
| `references/ledger-example.md` | A filled-in continuity ledger |

## Which skill, and when

| Task | Skill |
|---|---|
| Make an existing topic read plainly, whole-file, with prompts and a cliffhanger — a clarity wave | **this skill** |
| One-off surgical fix to a topic not in a wave: a wrong fact, a missing worked example, an undefined term, a stale version | `refining-content` |
| The topic does not exist yet | `authoring-content` |

Never run this skill and `refining-content` on the same file in the same pass: one is a
whole-file rewrite, the other is additive-and-surgical, and they produce opposite edits.

## Hard repo constraints (violating any of these is a build failure)

1. **H2 heading text is an MCQ anchor target.** Tens of thousands of questions carry
   `ref: concepts.md#anchor` and 100% resolve today. **Never rename, merge, split or delete
   an `## H2`.** **Additions are legal at any level** — a new H3 or a new H2 only adds an
   anchor, and `topics/.anchors.lock` enforces exactly this: modifications and removals FAIL
   and the error names the MCQ refs that would break. Prefer an H3 seam; add an H2 only when
   the material is genuinely a new section, never to reshape an existing one. **No heading may
   produce a duplicate slug** — that is a hard validator error, which is why S1's seam
   vocabulary is a prefix rather than a fixed string.
2. **Four callout types only**, case-sensitive, marker alone on the blockquote's first line:
   `[!TIP]`, `[!WARNING]`, `[!INTERVIEW]`, `[!KEY-TAKEAWAY]`. A `[!NOTE]` renders as a plain
   grey blockquote — it is not a callout. Do not invent a fifth type.
3. **One `# H1` per file.** Its text matches `TOPICS.md` and the README row; never change it.
4. **Diagrams are mermaid only.** Never ASCII art. Convert any ASCII art in a section you
   rewrite.
5. **Verify anchors with the repo's own code**, not a hand-rolled regex (which will pick up
   `# syntax=docker/dockerfile:1` inside a fence):

   ```python
   import sys, pathlib; sys.path.insert(0, "scripts")
   from validate_content import read_headings
   for h in read_headings(pathlib.Path("topics/<domain>/<slug>/concepts.md")):
       print(h.level, h.slug, h.line, h.text)
   ```

## BINDING versus REPORT-ONLY — read once, then trust the rule

**Every rule below carries a `BINDING` or `REPORT-ONLY` tag on its own `Check.` line, and
that tag is the only statement of the rule's status.** There is no second list. If a metric's
Check line says REPORT-ONLY it never fails a topic; if it says BINDING it does. Where a rule
is binding on judgement and report-only as a count, its Check line says which is which.

**There is no reading-time ceiling.** The user's decision is "let files grow." Reading
minutes are **reported before and after, never gated.** Padding is still a defect, caught by
the **bloat check** (loop step 5), not by a time limit.

---

## The clarity rules — sentence and paragraph level

Each rule is stated once, with its check. Illustrations are in `references/examples.md`, the
reasoning and the corpus data in `references/rationale.md`.

### C1 — Deepest-beat parity

**Rule.** The clarity floor is **identical in every beat of a section.** Depth is bought by
removing scaffolding — no re-glossing, no new analogy, no re-derivation — never by raising
the register.

**Check. REPORT-ONLY.** On the section's **closing 30%** by word count — callouts and the S7 exit
sentence excluded, a fence or table counting as a concrete instance — read off
words-to-first-concrete, naked term first uses, bold per 1,000 words, and metaconcepts per 1,000
words. These per-section readings show you where to look and never fail a topic; the whole-file
arithmetic in **C2 and C8 stays BINDING**. The **BINDING** gate for parity is the REGISTER SWAP.

### C2 — Thing before name

**Rule.** Four moves, always in this order: the pain in ordinary words → the mechanism
described without its name → **the name** (bolded, once) → a one-clause definition. A gloss
may use only words the reader already has. A locally coined abbreviation used before it is
coined is a hard failure.

**Check. BINDING.** Every bolded or italicised term first use has a gloss marker (`is`,
`means`, `—`, `:`, a parenthetical) within **25 words**, and a concrete instance in the
**60 words** before it. Zero coined-before-defined abbreviations.

### C3 — One gloss per sentence, and never between a subject and its verb

**Rule.** At most one inline gloss per sentence. Cap the subject–verb gap at **6 words**.
Never splice a gloss into an item of a list the reader is following. Long definitions become
their own sentence. Citations land after the definition, or in `## References`.

**Check. BINDING on judgement, grep-assisted.** Read each sentence's outer clause with every
parenthetical deleted; if it is no longer grammatical or no longer says the thing, the glosses
have eaten it. Grep flags sentences with ≥2 parentheticals or ≥2 em-dash pairs for mandatory
review (REPORT-ONLY as a count).

### C4 — A concrete instance inside the first 60 words

**Rule.** Every H2 and every H3 seam puts something the reader can picture inside its first
**60 words**, before any general characterisation: a number with a unit, a named
class/service, a specific request, a step-by-step trace, or a fenced block. Then fade to the
abstract, keeping the instance nameable for the rest of the section. **Look for a reordering
fix first: the instance is usually already somewhere in the file.**

**Check. REPORT-ONLY** for the offset detector; **BINDING** on judgement. The instance must
be a number with a unit, a named component, a specific request, a trace, or a fence. A token
"for example, in a distributed system" does not count, and neither does a decorative number
salted in to satisfy the regex. **S5's claim line counts toward the 60 words** — write the
claim so it contains the instance, rather than spending 17 words on an abstraction first.

### C5 — Old information opens, new payload closes

**Rule.** Start each sentence with something the reader already met; end it with the one new
thing you want remembered. Never open a sentence with a bare demonstrative whose antecedent is
more than one sentence back. Never open on the most obscure new information available — an
internal class name, a constructor flag, a spec section.

**Check. BINDING** — name the referent or rewrite. Match **sentence-initial**, not
line-initial: `(?:(?<=[.!?]\s)|^)(This|That|These|Those|It)\s+(is|are|means|gives|makes|lets|allows)`.
The `^`-anchored version sees only paragraph openers; expect the sentence-initial count to be
much higher and do not read it as a regression. The old/new *ordering* is **judgement**: list
each sentence's first five and last five words per paragraph; the first-word list must read as
one continuing subject, and no last-word entry may be a citation or a hedge.

### C6 — One payload per syntactic closure

**Rule.** A sentence may carry as many emphasis-worthy things as it has closures — its end,
plus each properly used colon or semicolon. More than that: split it, or install a closure.
Any clause over ~8 words goes at the **end** of its sentence. **There is no word-count limit.**

**The repo tokenizer counts each list item as a sentence**, so a C7 conversion of an inline
enumeration into a list raises your p90. **That rise is expected and is not a C6 failure.** Use
`scripts/corpus_stats.py` rather than hand-rolling a tokenizer that flatters the number, and say
in your report which of the delta came from C7 conversions.

**Check. Judgement, BINDING.** List the things you want the reader to carry away from the
sentence; if that count exceeds 1 + (colons and semicolons used as closures), it fails.
Sentence-length reporting is **REPORT-ONLY**.

### C7 — Turn catalogues into claims

**Rule.** Before any list of 5+ technical items, name the **single question** all the items
answer, then group them by their answer. Never present an enumeration as the explanation.
No inline glosses inside list items.

**Check. Judgement, BINDING.** The paragraph immediately above the list contains the one
question the list answers; the list is grouped by the answer; no item carries a parenthetical
gloss over 12 words.

### C8 — Emphasis budget, and one bold per term per file

**Rule.** Bold marks the **teaching site** of a term the reader must now know: the place this
file defines it — not the first occurrence, which is a repaired wording. **Each distinct term
is bolded exactly once in the file, at that teaching site, and nowhere else.** Never bold for
enthusiasm, never for negation ("does **not**"), never for a slot label, never for three of
nine list items, and **never a whole claim sentence or a question** — bolded claim sentences
are this corpus's dominant bold defect.

**The budget, with its tie-break** (same shape as S9's, deliberately):

- **Primary, per file (BINDING):** ≤ **12 bold spans per 1,000 prose words**.
- **Secondary, per paragraph (BINDING):** ≤ **1**.
- **Both must hold, and whichever admits fewer bolds governs.** On a normal file the per-file
  cap is the one that binds. **Expect roughly one bold every third or fourth paragraph, not one
  per paragraph.** Budget the file first rather than discovering the overrun at the end.

**Check. BINDING arithmetic.** Count `\*\*[^*]+\*\*` outside code fences, with a **fence-aware,
newline-tolerant** matcher — a naive `[^*\n]+` misses every bold span that wraps a source line.
Then: ≤12 per 1,000 prose words **and** ≤1 per paragraph, whichever admits fewer, and no term
bolded twice.

**Whole-file pass (the default).** Grep the finished file for each bolded token; two bolded
occurrences of the same term is a failure. Displaced siblings become structure, not typography:
a claim moves to its sentence's stress position, a warning moves into a `[!WARNING]`, parallel
items become a list.

**Partial-pass exception.** When you rewrite fewer than all H2s: (a) no term is bolded twice
inside your scope; (b) grep the **un-rewritten remainder** for `**<term>**` for every term you
bold. On a collision, keep the bold only if your occurrence is the file's genuine teaching site;
otherwise do not bold it. **Never edit prose outside your scope to resolve it.** Record the
surviving duplicate in the ledger's **`owed:`** list (not `known_defects`, which is for defects
you did not create), as a debt to whoever rewrites that section.

A partial pass also suspends every rule that needs whole-file scope: **S2** (opener), **S6**
(reading map), the S7 exit of any H2 you did not rewrite, and the ledger's cliffhanger and
`topics[]` entry. A partial pass produces no cliffhanger and does not advance `position`.

### C9 — Metaconcepts out, the actual condition in

**Rule.** Delete Pinker's container words (*approach, assumption, concept, context,
framework, issue, level, model, perspective, process, role, strategy, subject, tendency,
variable*) when they name nothing — cross the word out and see if the sentence still says the
same thing. Replace every hedge (*almost, apparently, fairly, generally, largely, mostly,
nearly, relatively, roughly, somewhat, typically, tends to*) with the condition under which
the claim is false, or the magnitude of the effect. Hedge removal and qualification insertion
are **one edit, never two**.

> [!WARNING]
> **If you cannot source the condition, KEEP the hedge and flag a content gap. Do not invent
> it.** De-hedging is the single most dangerous edit in this standard — most of the calibration
> run's fact regressions were C9 de-hedges that invented a condition the source does not state.
> "on some JVMs" is spec-accurate; "on a 32-bit JVM" is not.

**Check. REPORT-ONLY** density; **BINDING** per hit: either the condition or the magnitude
appears in the same sentence, or the hedge is retained and **the gap is logged in the ledger's
`owed:` list and routed to a tier-C prompt.** Hard exemptions, never find-and-replaced: SQL
*isolation level*, consistency *model*, threat *model*, Kubernetes *workload*, statistical
*variable*. Per-file exemptions go in the ledger's **`exemptions:`** list — a topic about
*context* propagation cannot be gated on the density of the word "context".

### C10 — Kill the slot label, write the transition

**Rule.** Delete the bolded run-in labels that stand in for an argument, and replace each with
a sentence that states the relationship the label was hiding: "you pay X to buy Y", "take that
deal unless Z". **Zero tolerance on the audience-tier triple** `**Beginner.**` /
`**Intermediate.**` / `**Advanced.**`. A trade-off is never a Pros list adjacent to a Cons
list.

**Check. BINDING, shape-based** — not a fixed string list, which is evaded by renaming the
label. Grep `^\s*(?:[-*]\s+)?\*\*[^*\n]{2,60}[.:]\*\*`, with a small allowlist for a genuine
term first use. Then the judgement gate: the replacement paragraph states a cost-for-benefit
relation **and** a condition that flips the decision.

### C11 — Explain the mechanism, not the interviewer

**Rule.** Never substitute a statement about how the reader will be assessed for the
explanation itself. Interview framing survives **only** inside an `[!INTERVIEW]` callout, and
only as a question — never as the reason a thing is true.

**Check. BINDING, zero hits outside an `[!INTERVIEW]` block.** Grep
`[Ii]nterviewer(s)?\s+(probe|want|expect|ask|love|use|listen)|in an interview|the (senior|strong) (probe|signal|answer)|high-signal|[Cc]oncepts you must name|The bar is not|come up in interviews|commonly asked|a favourite question|worth being able to say out loud`.

---

## The structure rules

| | Rule | Check |
|---|---|---|
| **S1** | **Three-beat section, seam above ~50 lines.** An `## H2` **over ~50 lines** runs the case → the mechanism → the depth, with the depth behind a **content-named `### H3` seam**. An H2 **at or under ~50 lines** runs the first two beats inline and takes **no seam** — the clarity floor still applies to its closing paragraph. Seam vocabulary is a **prefix, not a fixed string**: `### Where it breaks: …`, `### What it costs: …`, `### The version-specific truth: …` (more shapes in `references/examples.md`). Never an audience label, and never `### What breaks next` (see S8). A fixed string produces duplicate slugs — a hard validator error — in any file with two "where it breaks" seams. | Every H2 over ~50 lines has ≥1 content-named H3; shorter H2s need none. Zero audience-named seams; zero duplicate slugs. **BINDING**; where a seam exists, Beat 3 must add a *distinct* claim, not restate Beat 2 at greater length |
| **S2** | **Openers.** The first 60 words after the `# H1` carry a specific situation, number or observable symptom. Delete every "This topic covers…", every citation slab, every attribution paragraph — bibliography goes to `## References`. The opening paragraph's last sentence states the question the file answers. | Grep `^\s*This (topic\|note\|section\|page\|document)\s+(covers\|is about\|explains\|discusses\|teaches\|builds)` → **zero hits, BINDING**. Then C4's 60-word test on the opener |
| **S3** | **Delete author-facing scaffolding from the reader's path.** Every "Boundaries — don't duplicate" slab, every cross-reference directory, every author erratum. Where a boundary genuinely helps, it becomes **one inline sentence with one link at the point of need**, below the file's first 25%. | Grep `Boundaries\|Cross-references\|don't duplicate\|do not duplicate`. Target ≤2 backticked `domain/slug` references per file. **BINDING** |
| **S4** | **Diagram by positive test, not by quota.** Add a mermaid diagram only if one holds: ≥3 entities with directional relationships; an ordering or timing the reader must hold; a state space with legal transitions; a layered or boundary structure. **The diagram replaces the enumeration it renders** — delete the list. Labels live inside the figure, verbatim from the prose. Mermaid only; convert ASCII art you touch. | Name which test fired. **BINDING**: the replaced enumeration is deleted, not left above the figure. See the note below on definitions versus placement |
| **S5** | **H2 text frozen; the claim goes in the first body line.** Never rename, merge, split or delete an H2. Under a bare-noun H2, the first line of body prose carries the claim the heading could not make — a finite verb and a claim, not a definition ("False sharing is when…" fails under C2). **Additions are legal at any level** — prefer an H3 seam; add an H2 only for genuinely new material, never to reshape an existing section. No duplicate slugs. | `--check-lock` plus `validate_content.py`. Every base H2's `(level, text)` still present and in order; anything extra is an addition. **BINDING, build-breaking** |
| **S6** | **Reading map for long files.** Any file over **3,500 RAW words** opens with exactly one `> [!TIP]` reading map: the minute budget, and explicit permission to skip named sections with the reason. At or under 3,500: no map. **Exempt from the callout budget.** | **The basis is RAW words** — the site's own count, the one that drives `readingMinutes`. `prose_words` (S9's basis, which strips fences, tables and callouts) is a different, smaller number and using it here fails 149 files the wrong way. **BINDING** |
| **S7** | **Section exits are plain transitions.** The last sentence of each content H2 names the problem the next content H2 solves, in flat declarative prose, ≤25 words, withholding nothing. **Three exemptions, on every file:** the **last content H2** closes the topic's arc instead (its forward hook is the `prompts.yaml` cliffhanger), and `## Common follow-up questions` and `## References` take **no exit sentence at all**. Exactly one withheld payoff exists per topic and it lives in `prompts.yaml`. | Grep `there'?s a catch\|read on\|we'?ll see\|coming up\|stay tuned\|you'?ll never look at` → **zero hits, BINDING** |
| **S8** | ~~terminal `## What breaks next` H2~~ — **DELETED. Do not add this heading.** | See below |
| **S9** | **Callout budget, four types, colour quarantined.** See the resolved budget below. Every war story, historical aside, vendor anecdote and fun fact moves **into** a callout — never deleted, never left inline in the load-bearing chain. | **BINDING arithmetic** |

### S8 is deleted — the cliffhanger is not a heading

There is **no terminal cliffhanger H2.** `grep -E '^## (What breaks next|Where this goes next)'`
must return **zero hits** in any `concepts.md`. The cliffhanger lives only in `prompts.yaml`,
under the `cliffhanger:` key. (The grep is H2-scoped on purpose: S1 seams are prefixes, so
`### What breaks next: the 64-bit case` is a legal seam. Only the H2 form is banned.) The two
hard reasons — search indexing and payoff verifiability — are in `references/rationale.md`.

If you remember a rule mandating that heading, it is the deleted S8.

### The callout budget, resolved

This is the single rule; the earlier pair of differently shaped numbers with no tie-break is
dead.

- **Primary, per file (binding):** `allowed = max(1, round(1.2 × prose_words / 1000))` — so a
  4,000-word file gets 5 and a 6,000-word file gets 7.
- **Secondary, per H2 (binding):** at most **1** callout per H2. This is an anti-clustering
  cap, not a budget.
- **Tie-break: both must hold, and whichever admits fewer callouts governs.** The per-H2 cap
  can never license exceeding the per-file budget, and the per-file budget can never be spent
  by stacking two callouts in one section.
- **The S6 reading map is exempt** from the per-file arithmetic.

Usage is bimodal by domain, so some files shed callouts under this rule and some gain them.

**Surplus callouts are demoted, never deleted.** A `[!WARNING]` over budget moves into the
**stress position of a body paragraph** — the end of the sentence, where the payload belongs
under C5. An anecdote, a date or a vendor name over budget moves to `## References`. Deleting
it is information loss and fails the gate.

**So callout counts MAY drop, and `[!WARNING]`/`[!INTERVIEW]` counts are deliberately NOT in the
information inventory** (loop step 4). What is gated instead is the **demotion log**: one line
per dropped callout, naming the body sentence or `## References` line that now carries its
content. A drop with no log line is information loss and fails. Callouts are typography; their
content is information.

### S4 note — definitions and placement are two objects

"The diagram replaces the enumeration" does **not** forbid a table and a diagram in the same
section. Definitions (what each of four barriers pins) and placement (where the spec requires
each one) are two objects: ship a table for the first and a mermaid flowchart for the second.
What is forbidden is a diagram that restates a list you also kept in prose. Say in your notes
which object each figure carries, so a reviewer does not read it as redundancy.

---

## The layering mechanic — three beats per H2

**An `## H2` over ~50 lines runs all three beats, with Beat 3 behind a content-named `### H3`
seam. An H2 at or under ~50 lines runs Beats 1–2 inline and takes no seam** — the clarity floor
still applies to its closing paragraph. This is S1's ~50-line threshold, and it is the only
threshold here: on a typical file most sections get no seam. Beats 1 and 2 are unlabelled prose.

- **Beat 1 — the case.** Opens with a concrete particular inside 60 words. Runs pain →
  mechanism → **name** → one-clause definition. At most one analogy, shipped with its mapping
  (two or more relations, not a resemblance) and its **breakdown** ("where this picture stops
  working: …"). Ends when the reader could point at the thing.
- **Beat 2 — the mechanism.** If the mechanism has more than four interacting parts, name each
  part standalone first and say out loud that the picture is deliberately incomplete, then run
  them together using the identical names. Multi-step mechanisms get 3–5 phase names chosen by
  **purpose**, not by position ("fence the old leader", not "step 3"), reused verbatim in the
  diagram and the recap. Closes on the general statement, back-referenced to Beat 1's case by
  name.
- **Beat 3 — the depth.** Only in sections over ~50 lines, behind the seam. Scaffolds removed;
  clarity floor unchanged. Must add a **distinct** claim.

### The parity table — guidance is the only axis that moves

| | Beat 1 (case) | Beat 2 (mechanism) | Beat 3 (depth) |
|---|---|---|---|
| Analogy | ≤1, with mapping + breakdown | none new | **none** |
| Re-gloss of terms already earned | yes | no | **no** |
| Worked trace | complete, every step | complete | **assumed** |
| Re-derivation of an earlier result | yes | reference only | **reference only** |
| New distinct claims | 1 | 2–4 | as many as the material has |

Guidance fades going down while the claim count rises, because the material is denser.
**The clarity floor does not move at all: C2, C4, C6 and C8 apply to Beat 3 exactly as they
apply to Beat 1**, and the REGISTER SWAP is what enforces that. There is no separate per-beat
metric — the C-rules already state the floor once, and restating it here is how a second,
conflicting set of thresholds gets born.

### Content labels, never audience labels

Seams are named by content, never by audience: `### Where it breaks: losing the thread`, never
`**Advanced.**`. Audience-tier labels are a zero-tolerance grep under C10, not a preference. The
skip affordance has exactly two levels — the H3 seam, and the S6 reading map that names the seams
worth jumping to. No collapsible blocks, no new markers, no CSS work.

---

## The REGISTER SWAP — the binding gate

This is the single most important check in this document. The stylistic *metrics* are
report-only precisely because they are gameable; this one is not, and it is the actual standard.

**Procedure, per H2:**

1. **Precondition.** If the section has **fewer than two body paragraphs** (blank-line-separated
   blocks of prose), it is too short to have a register gradient. Record it **N/A** with its
   sentence-length list and move on. That is 12.3% of the corpus's H2 sections, so expect it.
2. Identify the section's deepest beat: the last `### H3` seam, or **the closing 30% by word
   count** if the section has no seam. (C1 measures the same closing 30%.)
3. Copy two paragraphs into a scratch buffer, **unlabelled**: the section's first body
   paragraph, and the deep beat's last body paragraph. Exclude callouts and the S7 exit
   sentence — the template puts those there, and including them makes the test unsatisfiable.
4. Read them back to back and answer exactly one question: **from vocabulary and clause depth
   alone — not subject matter — can you tell which is which?**
5. If yes, it **FAILS**. Name the axis:
   - **Vocabulary** — an unearned term, a nominalisation, a passive with a hidden agent, a
     citation inside the sentence, the spec as the actor.
   - **Clause depth** — the deep paragraph's sentences carry more subordinate clauses. Measure
     it: write down each paragraph's sentence lengths as a list.
6. **Fix by rewriting the deep paragraph. Never by complicating the opener.** Splitting
   sentences moves no content and is the usual repair.
7. Record both sentence-length lists per section in your report. **They are report-only** — the
   pass/fail is your answer to step 4, not a threshold on the lists.

A cheaper tell before you measure: read the deep paragraph aloud. If you run out of breath before
the verb, it fails. A real failure-then-pass, with the measured lists, is in
`references/examples.md` — including why a writer measuring its own swap understates it, which is
why loop step 7 hands this to a separate verifier.

---

## The file template

````markdown
# <Topic Title>
    <- ONE H1, text UNCHANGED (matches TOPICS.md and the README row).

<CLIFFHANGER PAYOFF - 1-2 sentences. ONLY if topic N-1 left an open loop.
 Names the loop in N-1's own nouns and says WHERE IN THIS TOPIC it settles.
 It does NOT resolve it here - that would displace this file's own opener.
 Omit entirely for topic 1 of a domain. Rule K1.>

<OPENER - 60-120 words. Beat 1 for the whole file. Rules S2 + C4.
 A specific situation with a number, a named component, or an observable symptom
 inside the first 60 words. Its last sentence states the question this file answers.
 FORBIDDEN: "This topic covers...", a citation slab, a Boundaries/Cross-references
 slab, "Interviewers want...", a bare definition, a flat assertion.>

> [!TIP]
> **Reading map.** <n> minutes. <What the material actually needs.> If you already
> <have property X>, start at [<seam>](#<seam-anchor>). Everything else is context.
    <- OPTIONAL, rule S6. ONLY in files over 3,500 RAW words. EXEMPT from the callout budget.

---

## <Existing H2 - TEXT FROZEN>
    <- Never renamed/merged/split/deleted. MCQ refs resolve against these.
      ADDITIONS are legal at any level (H3 preferred, a new H2 only for genuinely
      new material); no duplicate slugs. Rule S5.

<FIRST BODY LINE = THE CLAIM the bare-noun heading could not make. Rule S5.
 A finite verb and a claim, not a definition. Its words count toward C4's 60.>

<BEAT 1 - THE CASE. 1-3 paragraphs, NO label.>

<BEAT 2 - THE MECHANISM. 2-5 paragraphs, NO label.>

```mermaid
    <- Rule S4. ONLY if the positive test fires. Labels inside the figure, verbatim
      from the prose. The diagram REPLACES the enumeration it renders.
```

### Where it breaks: <content-named seam, a PREFIX not a fixed string>
    <- OPTIONAL. BEAT 3 SEAM, rule S1: ONLY in an H2 over ~50 lines. Shorter
      sections stop after Beat 2. NEVER "Advanced"/"Beginner"/"Intermediate"/"Deep dive".

<BEAT 3 - DEPTH. Scaffolds removed (no re-glossing, no new analogy, no
 re-derivation, no restating Beat 2 at greater length). CLARITY FLOOR UNCHANGED:
 concrete inside 60 words, zero naked first uses, same sentence rhythm as Beat 1,
 same C8 bold budget as everywhere else. Must add a DISTINCT claim.>

> [!WARNING]
> <The misconception in the reader's own likely words, then corrected with the
> mechanism. Stating the wrong belief out loud before correcting it is the corpus's
> most effective and most underused device.>
    <- OPTIONAL, rule S9. At most 1 per H2 AND only while the per-file budget
      max(1, round(1.2 x prose_words / 1000)) lasts. On a median 15-H2 file the
      budget is 4, so about four sections carry a callout. MOST SECTIONS HAVE NONE.

<SECTION-EXIT SENTENCE - <=25 words, flat, names the problem the NEXT H2 solves.
 Rule S7. No withholding, no teaser. OMITTED in the LAST content H2 (which closes
 the arc instead) and in the two tail H2s below, which take no exit sentence.>

---

## <...remaining H2s, identical three-beat rhythm...>

## Common follow-up questions
    <- EXISTING H2, TEXT VERBATIM (four spellings exist corpus-wide; keep this file's).
      CONTENT is cleaned: interviewer framing out (C11), questions kept, answers kept.

## References
    <- EXISTING H2, always last, text unchanged. Citations pulled out of prose land here.
````

**There is no cliffhanger heading in this template.** The file ends on `## References`. The
cliffhanger is a `prompts.yaml` key.

---

## Think-prompts — the `prompts.yaml` sidecar

`topics/<domain>/<slug>/prompts.yaml`, sibling to `questions.yaml`, same `ref:
concepts.md#anchor` convention. Prose stays in `concepts.md`; structured items keyed by anchor
live in YAML. That keeps the `concepts.md` diff pure prose (so the information-loss audit stays
clean), gives every prompt a stable id for reveal state, and needs no fifth callout type.

> [!WARNING]
> **`prompts.yaml` is a new third file, and two things owe it work before the wave starts.**
> (1) `docs/content-schema.md` — the contract `CLAUDE.md` says to follow exactly — documents the
> topic directory as `concepts.md` + `questions.yaml` only. **Add `prompts.yaml` to it once,
> before topic 1.** (2) **Nothing in `web/` reads `prompts.yaml` today** — `sync-content.mjs`
> reads only `concepts.md` and `questions.yaml`. So the render-time resolution of a cliffhanger's
> destination title from README row order, and the `id` field's reveal state, are **required
> future web work, not existing properties.** Until that renderer ships, **your own
> `payoff.anchor` check is the only gate.** Do not assume the chain self-verifies.

### The field spec

File-level keys: `topic`, `domain`, `topic_slug`, `schema: 1`, `pass: clarity-v1`, then
`prompts:` and `cliffhanger:`.

| Field | Required | Rule |
|---|---|---|
| `id` | always | `<topic_slug>-pNNN`, stable once shipped — reveal state keys off it |
| `ref` | always | `concepts.md#anchor`; must resolve. ≤1 prompt per anchor |
| `kind` | always | one of the five kinds below; no others |
| `tier` | always | `A` in-file, `B` other topic, `C` primary source, `D` open |
| `prompt` | always | **≤35 words**, one question, no "and" joining two interrogatives |
| `hint` | optional | one line, points at what to count or look at; never the answer |
| `answer_in` | always | in-file anchor (A), `/study/<domain>/<slug>#anchor` (B), or `external` (C/D) |
| `success_criterion` | **mandatory for tier C** | what having it looks like; bounds an otherwise unbounded hunt. Exempt from the 35-word cap |
| `search_hint` | tier C | the primary source to open, with any caveat about it |
| `answer_shape` | **mandatory for tier D** | the two or three dimensions any credible answer must price. Exempt from the 35-word cap. An open prompt with no `answer_shape` is the abandonment failure |

Canonical shape — one prompt, all the mandatory keys:

```yaml
topic: "synchronized, volatile & the Java Memory Model"
domain: java-jvm
topic_slug: synchronized-volatile-jmm
schema: 1
pass: clarity-v1

prompts:
  - id: synchronized-volatile-jmm-p001
    ref: "concepts.md#visibility-reordering-and-atomicity"
    kind: predict-failure
    tier: A
    prompt: |
      Your teammate declares `stop` volatile, the loop exits, so they apply the same fix
      to a `hits` counter that eight threads increment. Name what still breaks.
    hint: "Count the memory accesses in one `hits++`."
    answer_in: "concepts.md#volatile"
```

A full three-prompt file with the tier-C and tier-D fields filled in is in
`references/prompts-and-cliffhangers.md`.

### The five kinds — no others

| Kind | Shape |
|---|---|
| **predict-failure** | Concrete scenario with numbers; name the first thing that breaks. Highest-yield, because it forces a pre-commitment |
| **name-the-price** | "{Mechanism} gives you {benefit}. Name what it costs, and the workload where that cost is the one that matters" |
| **draw-the-boundary** | "Everything here assumed {implicit assumption}. Find where it fails." Doubles as the Beat 2 → Beat 3 seam marker |
| **refute** | A colleague's confidently worded, subtly wrong review comment. Source the wrong claim from a distractor already in the topic's `questions.yaml` |
| **notice-in-wild** | "Next time you {situation}, check {observable}." Nothing to get wrong. Keep **about a third** of all prompts this kind |

### The four closure tiers — every prompt has one

- **A — answered later in this file.** `answer_in` is an in-file anchor. The reveal is a deep
  link labelled "Where this gets answered", not the answer.
- **B — answered in another topic.** `answer_in` is `/study/<domain>/<slug>#anchor`.
- **C — in a primary source.** `answer_in: external`, plus a `search_hint` and a **mandatory
  `success_criterion`**: the criterion is the substitute for a human mentor. At most **one
  tier-C hunt per topic**, in the deepest section.
- **D — genuinely open.** **Mandatory `answer_shape`.**

### Density, placement, and the one absolute rule

- **Primary: a hard cap of 14 prompts per topic, regardless of file length.** This is the one
  number that governs. Do **not** scale with length: the 72-H2 file gets 14, placed at natural
  resume points so they double as session bookmarks.
- **Within that cap: ≤1 prompt per anchor, and instrument about two-thirds of teachable H2s, or
  as many as the cap allows — whichever is fewer.** Instrumenting well under two-thirds on the
  biggest files is correct, not a shortfall.
- **Skip unconditionally:** `## References`, the follow-up-questions H2 (already question
  shaped), `## Trade-offs and when to use what` (already comparative), and short pure-enumeration
  sections.
- **Instrument preferentially:** where a folk belief conflicts with the mechanism, where a rule
  is stated without its boundary, where a capability is given without its price, and at the
  Beat 2 → Beat 3 seam.
- **Placement: after the section it interrogates, never before.** The only pre-question a reader
  meets is the previous topic's cliffhanger.
- **Never inline the answer.** All 460 files currently do exactly that, which leaves no interval
  in which the reader could generate. The canonical instance is quoted in
  `references/prompts-and-cliffhangers.md`.
- **No duplicates.** Grep the topic's `questions.yaml` first; if an MCQ already tests it, the
  prompt must ask something the MCQ format cannot.
- **Invitation register.** No "Quiz", no "Test yourself", no score, no streak, no taunt. State
  expected difficulty out loud when it is high.

Aim for roughly a 50% first-attempt success rate. Above ~80% the prompt is decoration — delete
or escalate it. Below ~20%, add a cue, narrow it, or demote it to a tier-C hunt.

---

## Cliffhangers — in `prompts.yaml` only

One per topic, under the `cliffhanger:` key, with `hook`, `teaser_questions` and `payoff:
{anchor, claim}`. Never a heading (S8 is deleted). **Never author the destination's title or a
link to it** — the design is that a future renderer resolves both from README row order, so the
chain tracks reading order forever and the pager and the cliffhanger can never disagree. That
renderer does not exist yet (see the warning above); the authoring rule holds regardless,
because a hand-written title is what goes stale.

### The six patterns — pick by what the topic just did

| | Pattern | Use when |
|---|---|---|
| **A** | **Broken invariant** *(default)* | The topic taught a rule; the next topic exists because the rule has a boundary |
| **B** | **Unpaid bill** | The topic handed over a capability that looked free. Give the bill's existence and units, never its structure |
| **C** | **Scale threshold** | Correct at today's numbers, breaks at a computable multiple. The cliffhanger *is* the arithmetic, with constants from the topic's own numbers |
| **D** | **Named unknown** | Survey topics. Exactly three routed questions. Never four |
| **E** | **Pivot** | Non-contiguous adjacency. Do not fake a dependency: name the one genuinely shared mechanism and pose a question on that seam |
| **F** | **Finale** *(domain-final)* | Close the domain's arc, hand off to real `domain/slug` targets, leave one genuinely unsolved question. No congratulation — celebration closes the loop, which is the opposite of the goal |

Illustrations of all six, and a full shipped hook, are in
`references/prompts-and-cliffhangers.md`.

### Hard form limits

**80–140 words. No sentence over 25 words. At most 1 em-dash. Zero exclamation marks. Carries a
concrete artifact** — code, a number, or an error string. Banned strings: *surprising, shocking,
secret, devastating, brutal, notorious, most engineers don't know, you'll never look at X the
same way, there's a catch, stay tuned, read on*. Read it aloud flat: if it sounds like a trailer,
rewrite; if it sounds like a colleague saying "oh — one thing", it is right.

**Measure the word and sentence limits on the prose only, excluding any code artifact.** A code
artifact has no sentence terminators, so a naive splitter fuses it with the prose and over-reports
both figures; the 80-word floor was set from a real compliant hook's prose-only count. Patterns C
and D can be artifact-free by construction; for those, the arithmetic or the named unknown *is*
the artifact.

**Calibrate to moderate confidence:** a reader who just finished this topic should be able to
produce a plausible-but-wrong guess. No idea at all → add one scaffolding sentence inside the
hook. Certain to get it right → push to the next boundary condition. Do **not** cite the Zeigarnik
effect anywhere; it did not replicate. A cliffhanger buys **return**, not retention.

### Verifying the payoff — this is what makes the device work

The destination is normally not yet rewritten, and that is fine: its **prose is unstable but its
headings are frozen** by the ADD-only rule. So:

1. Read the next topic's H2 list only — with `read_headings`, not by reading the file.
2. Pick a `payoff.anchor` that **resolves today**, in the un-rewritten destination.
3. Open the destination at that anchor and confirm the promised mechanism is genuinely there.
   Record what you saw in `payoff.claim`.
4. Prefer a **short exact string** that also appears in the destination — that is what the K1
   grep matches when the destination is later rewritten. Do not lengthen it for completeness.

No check ever requires a rewritten next topic to exist. That is the whole point.

---

## Continuity — what topic N may assume

**Rewrite order is the domain README's row order, one topic at a time. Never out of order.**
Domains may run concurrently; topics within a domain may not. Every continuity rule below is
defined per domain, which is why cross-domain concurrency is safe.

The carry-forward ledger is **`docs/continuity/<domain>.yaml`, committed.** It lives in `docs/`
rather than `topics/` because S3 is *removing* author scaffolding from the reader's tree and the
fix must not add a new instance.

### The ledger's required fields, and how each is maintained

| Key | Maintenance rule |
|---|---|
| `domain`, `schema: 1`, `pass: clarity-v1` | fixed |
| `reading_order_source` | the domain README path; **re-derived every run, never hand-sorted** |
| `position` | the next topic's index. Bumped in the same commit as the rewrite |
| `plan[]` | `{slug, covers}` for every topic. **Written in Pass 0 before topic 1, from H2 lists plus first 200 words. Never edited after** — it is what makes a forward cliffhanger possible |
| `canonical_terms` | **append-only. 6 terms per topic, no truncation** — an archival rule would strip exactly the `gloss` and `banned_variants` fields K2's check consumes. Each entry: `{canonical, defined_in, gloss, banned_variants[]}` |
| `running_example` | **at most 2 per domain**: `{name, established_in, state}`. Numbers may be **extended**, never silently changed |
| `claims_established` | **rolling compaction every 5 topics**: compress the previous 5 topics' claims into ≤5 domain-level claims, so the ledger stays O(1) rather than O(N). **Cap ~25 live claims** |
| `approximations_open` | `{id, from, text, correction_owed_by}`. Every entry needs a correction before the domain ends (K5) |
| `known_defects` | **pre-existing** defects you did not create and did not fix |
| `owed` | **append-only debts THIS pass created** and could not close: C8 bold collisions with un-rewritten scope, C9 gaps where the hedge was kept, partial-pass leftovers. `file` = who must close it, which is how it reaches them |
| `exemptions` | per-file rule exemptions with the reason, `{file, rule, terms, reason}`. C9 mainly |
| `open_cliffhanger` | **exactly one, overwritten every topic**: `{from, to_position, pattern, key_noun_for_K1_grep, gap, payoff_anchor, verified_present}` |
| `topics[]` | **one line per rewritten topic, ≤25 words, no truncation**: `{position, slug, commit, one_liner, reading_minutes{before,after}, factlines{emitted,verified}, adversarial_signoff}` |

A filled-in ledger is in `references/ledger-example.md`.

**Load exactly four slices, never the whole ledger:** (1) the full `canonical_terms` map;
(2) `running_example`, plus the `known_defects`, `owed` and `exemptions` entries **whose `file`
is topic N** — that is how a debt owed to you reaches you; (3) the last 3 `topics[]` entries in
full plus a one-line roll-up of `claims_established`; (4) `plan[N-1] / plan[N] / plan[N+1]`.
Plus the raw `concepts.md` for N and an **H2-list-only** read of N+1.

For a 94-topic domain, **shard the ledger by group** (the same group key the site's catalog
already uses) so each unit stays under ~25 topics.

### The continuity rules

| | Rule | Check, holding only the ledger + topic N |
|---|---|---|
| **K1** | **Name the previous loop; do not resolve it.** N's opener names the open loop in one sentence and says **where in this topic it settles**. It does not drag the resolution into the opener — that would displace N's own S2 opener, and the payoff site is usually not H2 #1 | Grep `key_noun_for_K1_grep` in N's opener; confirm the section at `payoff_anchor` actually contains it. Reviewer: the payoff must *answer*, not merely mention the noun |
| **K2** | **One canonical term per concept per domain.** Where the industry genuinely uses two names, declare it once at first use in the domain and then commit ("partitioning, also called sharding — this domain says partition") | Grep every `banned_variants` entry across N. Do not over-enforce: replica vs node vs instance in AWS content, and latency vs response time in Kleppmann's sense, are real distinctions and erasing them is also a failure |
| **K3** | **Reference, don't re-teach.** Anything established in topics 1..N-1 gets a one-clause restatement plus a link — never a re-derivation, never a re-glossing, never a fresh analogy for the same concept. Conversely, never assume a term the ledger does not record as established | Grep for a gloss marker within 25 words of a ledger-established term's first use in N |
| **K4** | **Carry the running example.** Numbers may be **extended**, never silently changed | Grep the name and every number. A changed value fails unless the ledger records the change and N states it out loud |
| **K5** | **No silent contradiction.** When N legitimately bounds an earlier simplification, it does so explicitly — naming the earlier topic, restating what it said, saying what was approximate — and logs the correction. Every `approximations_open` entry has a correction before the domain ends | Read the ≤25 live claims plus `approximations_open` |
| **K6** | **Analogies do not mutate.** One vehicle per concept per domain, with a stated breakdown. A later topic may extend it by adding a correspondence; it may not swap the picture | Grep vehicle nouns. Every analogy entry must have a non-empty breakdown line — an analogy whose breakdown you cannot fill in is one you have not checked, and it does not ship |
| **K7** | **The cliffhanger points at the real next topic and at content that exists there** | `payoff_anchor` resolves in the destination. If a README was reordered mid-wave and the destination is still a valid catalog entry but no longer `next`, that is a **warning with a remediation note**, not a failure — a mid-README insertion must not hard-fail two untouched files |

**Resuming a domain in a fresh session:** read `position`, then the four slices. The `topics[]`
list is the durable per-file completion marker, so an interrupted run resumes additively and
never rewrites a finished topic.

---

## Fact safety — the one place this standard can do real damage

> [!KEY-TAKEAWAY]
> **The unit of verification is the DIFF, not the file. A fact-shaped line is immutable unless
> you explicitly re-verify it. And any sentence whose subject, verb or object differs from the
> original is a NEW CLAIM — marker word or not.**

A no-web pedagogy pass over 59 files once silently downgraded verified AWS service limits with
every gate green. **These four shapes are the checklist for step 6, and none of them changed a
number, a version or a citation — which is exactly why nothing mechanical caught them:**

1. **A de-hedge invented a condition the spec does not state.** "on some JVMs" → "on a 32-bit
   JVM", when the spec conditions the behaviour on the implementation, not on word size. This
   shape is a **C9 failure** — three of the four regressions on the calibration run were C9
   de-hedges.
2. **A mechanism was substituted for an observable property.** "writes them atomically" → "writes
   them in one instruction": a codegen detail asserted in place of the guarantee the reader needs.
3. **A qualifier was dropped and an absolute added.** "relatively strong, only store-load is
   visible" → "nothing else can".
4. **A call path was asserted from plausibility.** `incrementAndGet()` "calls `compareAndSet`",
   when since JDK 8 it delegates elsewhere. A model that is sound can still name the wrong API.

The worked instances, the marker-free sentence that a 36-item self-audit missed, and what the
run got right are in `references/fact-safety-cases.md` — useful, not required.

### The procedure

**Step 1 — the writer builds a claim-diff table by sentence alignment, not by grep.** Align the
rewritten section against the original **sentence by sentence**. One row per sentence:
`original sentence → new sentence(s) → verdict`, where the verdict is *carried* (same SVO),
*re-worded* (same SVO, new words), or **NEW**.

**Step 2 — apply the SVO test to every row.** A sentence is NEW if its **subject, verb or
object** differs from every original sentence's, regardless of how much of the wording is
recycled. In particular these are always NEW, even when they read as paraphrase:

- an **attribution** change — which component, stage, chip, layer or version does the thing;
- a **quantifier** change — "some" → "all", "may" → "does", "usually" → "always";
- a **mechanism** substituted for a property, or a property for a mechanism;
- a **call path** — "X calls Y" where the base said only "X behaves like Y".

**Step 3 — every NEW row needs a source**: an original line number, a sibling `questions.yaml`
id (open it and read it — do not cite from memory), or a primary-source URL. "It is standard
architecture" is not a source. If you cannot source it, **apply C9's safety catch: keep the base's
hedge, or delete the clause, and route the gap to a tier-C prompt.**

**Step 4 — run the marker grep as the net, not the gate.** `so | because | which means |
therefore | cannot | always | never | only` over added sentences. It runs *after* you have built
the claim population by alignment. Any hit not already in your table is a row you missed, and it
tells you your alignment was sloppy.

**Step 5 — a separate adversarial verifier, in a fresh context, is mandatory.** It sees only the
diff, the claim-diff table and the inventory delta. It re-derives the alignment **independently**
and its job is to name the rows your table does not contain. **A writer cannot audit itself.**
The verifier is also not infallible: read its fixes before applying them.

**Step 6 — the web fact-check pass is mandatory, not conditional.** Open **primary sources
only** — the spec, the RFC, the vendor's own limits page, the actual source file — for every
fact-shaped line the diff touched. Never fabricate a citation. When a precise value cannot be
confirmed, soften to a correct range and name the mechanism rather than asserting a wrong precise
number. Re-derive every arithmetic result in a table or trace. Record unreachable sources
explicitly as residual risk; saying so is part of the deliverable.

---

## The per-topic loop

**Once per wave, before the first domain:** add `prompts.yaml` to the topic-directory listing in
`docs/content-schema.md` with its field set. That file is the authoritative contract; shipping a
third file it does not document is a contract violation from commit 1.

**Pass 0, once per domain, before topic 1.** Read every un-rewritten topic's H2 list and first
200 words. Write `docs/continuity/<domain>.yaml`'s `plan[]` in full; seed `canonical_terms` and
`running_example`. Cheap, and it is the only reason a cliffhanger can be forward-accurate.

**Then, per topic, in README row order:**

1. **Load context.** The four ledger slices, `concepts.md` for N, and an H2-list-only read of
   N+1. Do not re-read topics 1..N-1.
2. **Snapshot the base.** `git show HEAD:<path>` — this is the diff baseline and the information
   inventory source. Never trust a stored inventory; re-derive it.
3. **Write.** Rewrite the prose to the clarity and structure rules. Author `prompts.yaml`. Settle
   N-1's open loop in the opener (K1). Open N's, with the payoff anchor verified against the
   un-rewritten destination.
4. **Self-audit.** Build the claim-diff table by sentence alignment (Steps 1–4 of Fact safety).
   Run the REGISTER SWAP on every H2 with two or more body paragraphs, record the two
   sentence-length lists per section, and record the short ones N/A. Count callouts, bold spans,
   tier labels.
   **The information inventory — nothing in this list may drop:** numbers with units, versions,
   `RFC|JEP|JLS|CWE|SP 800-` citations, inline-code identifiers, URLs, table rows, mermaid blocks,
   code fences.
   **Callout counts are NOT in that list and MAY drop** — but only against S9's demotion log.
5. **Bloat check.** For each rewritten H2, list the added sentences that teach nothing new —
   narration, reassurance, restatement of the previous sentence — and delete them. Report the
   count. Skipping this is how "let files grow" becomes padding.
6. **Gates — all must pass:**

   ```bash
   python3 scripts/validate_content.py
   python3 scripts/validate_content.py --check-lock
   cd web && npm run check && npm test && npm run build
   ```

   Plus the anchor check with `read_headings`: **every base heading's `(level, text)` is still
   present and in the same relative order.** Anything extra is an addition and is legal — prefer
   H3 seams; a new H2 is allowed for genuinely new material. Zero duplicate slugs. **Do not gate on
   "H3 only":** a gate stricter than the repo's own lock will fail compliant files.
7. **Adversarial verifier — a separate agent, fresh context. Mandatory, never skipped.** It sees
   the diff, the claim-diff table and the inventory delta, and nothing else. It re-derives the
   sentence alignment independently, runs its own REGISTER SWAP, and reports undisclosed added
   claims by name. It must also check the opposite failure: anything softened, hedged away, or
   vagued.
8. **Web fact-check pass — mandatory.** Primary sources only, for every fact-shaped line the diff
   touched, using the **four regression shapes in the fact-safety section above** as the
   checklist. Worked instances of each are in `references/fact-safety-cases.md`.
9. **Repair.** Apply or reject each finding **with a written reason**, having read it — verifier
   and fact-checker suggestions can themselves be wrong. Record every rejection.
10. **Commit** `concepts.md` + `prompts.yaml` + the ledger append **together, in one commit.**
    Never mix a prose rewrite with an anchor rename or a `questions.yaml` edit: three blast radii,
    three reviews.
11. **Report** reading minutes before/after, word delta, the inventory delta, the demotion log, the
    bloat-check count, and the REGISTER SWAP measurements. Reading minutes are reported, not gated.

**At the end of every session, not every topic** (`CLAUDE.md` makes this non-optional): update the
progress checklist in `ROADMAP.md` and the Claude memory index at
`~/.claude/projects/<this-repo-project-dir>/memory/`. The ledger is the per-file
completion marker; `ROADMAP.md` is the trail a human reads. Batch those edits once per session —
but never skip them.

Do not rely on the Astro build as a safety net. It will happily render prose that has lost half
its facts. `validate_content.py` and the two review passes are the authority.

---

## Review checklist

Every line is pass/fail. This checklist is consistent with the file template and every rule
above; if you find a disagreement, the rule text wins and the checklist is a bug.

**Build-breaking**

- [ ] **Anchors intact.** `read_headings` shows every base heading's `(level, text)` still present
      and in order; anything extra is an addition (legal at any level, H3 preferred); one `# H1`,
      text unchanged; no duplicate heading slugs.
- [ ] `python3 scripts/validate_content.py` exits 0; `--check-lock` shows **additions only**.
- [ ] `cd web && npm run check && npm test && npm run build` all green.
- [ ] **No information loss.** Every number with a unit, version, spec citation, inline-code
      identifier, URL, table row, code fence and mermaid block from the base is still present, or
      is allowlisted with a justification. Word count did not drop more than 10%. **Callout counts
      are exempt** — see the demotion log below.
- [ ] **Demotion log complete.** Every callout that disappeared has a log line naming the body
      sentence or `## References` line that now carries its content.
- [ ] **Bloat check run.** Added narration / reassurance / restatement sentences named and deleted,
      count reported.
- [ ] **No undisclosed added claim.** Every NEW row in the claim-diff table has a source; the
      verifier found no row the table was missing.
- [ ] **Four callout types only.** Zero `[!NOTE]` and zero other markers.
- [ ] **Zero ASCII-art diagrams** in any rewritten section.

**Clarity**

- [ ] **REGISTER SWAP passes on every H2 with two or more body paragraphs**, on both axes, with the
      sentence-length lists recorded. Sections with fewer than two body paragraphs recorded **N/A**.
- [ ] **S1:** every H2 over ~50 lines has ≥1 content-named H3 seam; shorter H2s need none; zero
      audience-named seams.
- [ ] **C4:** every H2 and every H3 seam reaches a real concrete instance inside 60 words.
- [ ] **C2:** zero naked term first uses; every one carries a gloss marker within **25 words** and
      a concrete instance in the **60 words** before; zero abbreviations used before they are coined.
- [ ] **C3:** no sentence carries two glosses; no subject–verb gap over 6 words; no gloss spliced
      into a list item; every sentence with ≥2 parentheticals or ≥2 em-dash pairs was reviewed.
- [ ] **C8:** ≤12 bold spans per 1,000 prose words **and** ≤1 per paragraph, whichever admits
      fewer (normally the per-file cap); **no term bolded twice**; no bolded claim sentence or
      question (partial pass: collisions with un-rewritten scope recorded in the ledger's `owed`).
- [ ] **C9:** every de-hedge carries its condition or magnitude from a source; every unsourceable
      one kept its hedge and logged a gap in the ledger's `owed`.
- [ ] **C10 + S1:** zero audience-tier labels; zero slot labels on the shape regex; every
      trade-off states a cost-for-benefit relation and a condition that flips the decision.
- [ ] **C11:** zero interviewer-substitution hits outside an `[!INTERVIEW]` callout.
- [ ] **C5, C6, C7:** zero **sentence-initial** bare demonstratives on the C5 regex; every clause
      over ~8 words sits at its sentence's end; no sentence carrying more payloads than it has
      closures; every 5+ item list is preceded by the question it answers and grouped by the answer,
      with no item parenthetical over 12 words.

**Structure**

- [ ] **S2:** zero "This topic covers…"; opener has a specific situation inside 60 words.
- [ ] **S3:** zero Boundaries / Cross-references slabs; ≤2 backticked `domain/slug` references,
      each one inline sentence with one link, none in the file's first 25%.
- [ ] **S4:** every new diagram names the positive test that fired; every node label appears
      verbatim in the prose; the enumeration it replaces is deleted.
- [ ] **S5:** every bare-noun H2's first body line is a claim with a finite verb, not a definition.
- [ ] **S6:** a reading map is present **iff** the file exceeds **3,500 raw words** (not prose
      words), with a minute figure and a named skip list.
- [ ] **S7:** every content H2 that has a content H2 after it ends in a ≤25-word flat sentence
      naming the problem that next H2 solves; the **last content H2** closes the arc instead;
      `## Common follow-up questions` and `## References` have **no** exit sentence; zero teaser
      strings anywhere.
- [ ] **S9:** callouts ≤ `max(1, round(1.2 × prose_words / 1000))` per file and ≤1 per H2,
      whichever admits fewer, with the S6 map exempt; every displaced callout was **demoted into
      prose or References**, not deleted.
- [ ] **S8 is deleted:** `grep -E '^## (What breaks next|Where this goes next)'` — **zero hits.**
      (H2-scoped: an S1 seam may legally use those words as an H3 prefix.) The cliffhanger is in
      `prompts.yaml`.

**Prompts and cliffhanger**

- [ ] `prompts.yaml` parses; ≤14 prompts; ≤1 per anchor; every `ref` and in-file `answer_in`
      resolves; every prompt body ≤35 words; every tier C has a `success_criterion`; every tier D
      has an `answer_shape`; no prompt inlines its answer; no prompt duplicates an existing MCQ;
      about a third are `notice-in-wild`; ≤1 tier-C hunt.
- [ ] Cliffhanger: **80–140 words of prose** (artifact excluded), no prose sentence over 25 words,
      ≤1 em-dash, zero exclamation marks, zero banned hype strings, does not name the sibling
      topic's title, carries a concrete artifact, and `payoff.anchor` resolves in the genuine next
      topic with the promised content read and recorded.

**Continuity**

- [ ] **K1:** the opener names the previous loop's key noun and says where in this topic it
      settles.
- [ ] **K2–K6:** no banned term variant; no re-gloss of a ledger-established term; running-example
      name and numbers match; no claim conflicts with `claims_established`; one analogy vehicle per
      concept, each with a non-empty breakdown.
- [ ] **K7:** the destination is the real next topic (or a warning is recorded with a remediation
      note after a README reorder).
- [ ] **Ledger updated in the same commit:** `position` bumped, `open_cliffhanger` overwritten,
      a `topics[]` entry appended, terms/claims appended, every new debt appended to `owed` and
      every new exemption to `exemptions`, `plan[]` untouched, rolling compaction run if this is a
      multiple-of-5 topic.

---

## Non-goals — the seven things that are not this standard's job

Every hard constraint and every threshold is stated once, above. These seven are the failures a
well-meaning rewriter reaches for anyway.

- **Not touching `questions.yaml`** — not the text, not the distractors, not the `answer`
  indices, not the difficulty mix. The distractor-length rollout stays as shipped. A prose
  rewrite must not change what a question is asking about.
- **Not softening, hedging or dumbing down.** Deleting a caveat because it felt heavy, or
  replacing an exact p99.9 with "pretty high", is the failure this standard exists to prevent —
  and it is the inverse failure, not a safer alternative to it.
- **Not shortening files.** A rewrite 30% shorter has lost content, not burden. Growth is
  expected; the bloat check, not a length target, is what stops padding.
- **Not optimising Flesch-Kincaid or any grade-level score.** Both take only sentence length and
  syllable count, so they penalise unavoidable domain vocabulary and reward chopping. Use Flesch
  only as a one-directional tripwire: a sudden jump means someone reintroduced bureaucratic
  phrasing.
- **Not banning the passive voice, and not shortening sentences as the primary remedy.** "Pollen
  is dispersed by bees" is the better sentence inside a paragraph about pollen. The fix for a hard
  40-word sentence is usually to reunite subject and verb and move the payload to the end.
- **Not unpacking established product, API or type names.** `PodTemplateSpec`,
  `ThreadPoolTaskExecutor`, `PersistenceExceptionTranslationPostProcessor` stay verbatim — they
  are what the reader searches for.
- **Not adding scores, streaks, badges or mastery gates to the study page.** The MCQ surface owns
  scoring; the study surface stays the unscored one, or every prompt re-imports the exam frame
  this design exists to avoid.

Also out of scope, each already a rule above: reordering a README (Continuity), backfilling
diagrams into the 109 files with none (S4), a fifth callout type (constraint 2), parallelising
within a domain (Continuity), and citing the Zeigarnik effect (Cliffhangers).
