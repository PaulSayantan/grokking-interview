---
name: clarity-standard
description: The authoritative standard for a clarity rewrite of a topic's concepts.md — rewrite the prose top to bottom so expert material reads plainly at zero information loss, and author the prompts.yaml sidecar (think-prompts plus a cliffhanger). Use when the task is readability at scale — "make this topic easier to read", "plainer sentences", "an on-ramp into the deep material", "add think-prompts", "run the clarity wave on domain X" — or for any file whose deep sections read as dense and exhausting. For a one-off surgical fix to a topic that is NOT in a clarity wave (one wrong fact, one missing example, one undefined term) use refining-content instead. For a topic that does not exist yet use authoring-content.
---

# The clarity standard — expert ideas, plain sentences

This is the **single authoritative standard** for the clarity rewrite. It supersedes
`/tmp/clarity-design/standard.json` and `/tmp/clarity-design/plan.md` (both deleted) and it
supersedes `topics/CONTENT-AUDIT-MASTER.md`'s "refinement is polish, not triage" conclusion
for any topic in a wave. Where you remember those documents disagreeing, **this file wins.**
There is no other standard to consult.

> [!KEY-TAKEAWAY]
> This corpus conflates two independent dials, and this rewrite turns them in opposite
> directions. **The difficulty of the IDEA stays exactly where it is — senior/staff
> interview grade. The complexity of the EXPLANATION goes to near zero, in every passage,
> including the deepest one.** Gopen & Swan clarified opaque molecular-biology prose without
> removing a single technical term: "We have striven not for simplification but for
> clarification." Nothing here licenses softening. Every claim, number, caveat, version,
> spec citation and failure mode must survive item for item. Dense prose in a deep section
> is not rigour, it is unfinished thinking — and it sits exactly where readers quit.

The operating test for every sentence in every beat: **could a competent engineer meeting
this concept for the first time follow it on one read, without re-reading and without
looking up anything the file has not already given them?** If not, the sentence is wrong,
not the reader.

**How to use this document.** Work the **per-topic loop** near the end; it is the entry point and
it cites every other section in the order you need it. Each rule is stated **exactly once**, in
its own section, and every threshold appears in the rule and in the review checklist with the same
value — nowhere else. If two places ever seem to disagree again, that is a bug in this file and
the **rule text wins over the checklist and over the template**. Fix it there rather than working
around it.

## Which skill, and when

| Task | Skill |
|---|---|
| Make an existing topic read plainly, whole-file, with prompts and a cliffhanger — a clarity wave | **this skill** |
| One-off surgical fix to a topic not in a wave: a wrong fact, a missing worked example, an undefined term, a stale version | `refining-content` |
| The topic does not exist yet | `authoring-content` |

Never run this skill and `refining-content` on the same file in the same pass: one is a
whole-file rewrite, the other is additive-and-surgical, and they produce opposite edits.

## Hard repo constraints (violating any of these is a build failure)

1. **H2 heading text is an MCQ anchor target.** 28,064 questions carry
   `ref: concepts.md#anchor` and 100% resolve today. **Never rename, merge, split or delete
   an `## H2`.** **Additions are legal at any level** — a new H3 or a new H2 only adds an
   anchor. `topics/.anchors.lock` enforces exactly this: `check_lock()` collects added
   anchors only to enrich its messages, so additions pass at any level, while modifications
   and removals FAIL and the error names the MCQ refs that would break. Prefer an H3 seam;
   add an H2 only when the material is genuinely a new section, never to reshape an existing
   one. **No heading may produce a duplicate slug** — that is a hard validator error, which
   is why S1's seam vocabulary is a prefix rather than a fixed string.
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
minutes are **reported before and after, never gated** — the corpus runs a median 24 and a
max 83 rendered minutes today and clarity is allowed to raise that. Padding is still a
defect, caught by the **bloat check** (loop step 5), not by a time limit. On the one hard
case that went through the full loop, two sections grew +87.9% and roughly 50 of the added
words turned out to be narration rather than teaching. Cut those; keep the rest.

---

## The clarity rules — sentence and paragraph level

### C1 — Deepest-beat parity

**Rule.** The clarity floor is **identical in every beat of a section.** Depth is bought by
removing scaffolding — no re-glossing, no new analogy, no re-derivation — never by raising
the register.

**Why.** This is the most likely way the whole effort fails — a nicely rewritten on-ramp over a
deep tier as dense as today, which leaves the complaint unfixed for exactly the readers who go
deepest. Expertise reversal reduces the **guidance** an expert needs, never the plainness.

**Bad** — `java-jvm/synchronized-volatile-jmm/concepts.md` (the old `**Advanced.**` tier):
"The JMM is also careful to forbid *out-of-thin-air* values via a causality model, so that
data races (while unspecified in ordering) still cannot fabricate arbitrary values for
references (which would break memory safety)." Three abstract nouns never shown, the spec as
the actor, and the same file's opening tier is plain and analogised — the writing is worst
exactly where the material is hardest.

**Good.** "A race can hand you a stale value, but never an invented one. The JMM forbids
**out-of-thin-air values**: a racy read may return any value some thread actually wrote, and
nothing else. That matters most for references — if a race could fabricate one, a `String`
field could come back pointing at arbitrary memory and Java would not be memory-safe."
(One bold in the paragraph, on the term's teaching site. The thesis sentence carries the
weight by sitting first, not by being bold — see C8.)

**Check. REPORT-ONLY.** On the section's **closing 30%** by word count — callouts and the S7 exit
sentence excluded, a fence or table counting as a concrete instance — read off
words-to-first-concrete, naked term first uses, bold per 1,000 words, and metaconcepts per 1,000
words. These per-section readings show you where to look and never fail a topic; the whole-file
arithmetic in **C2 and C8 stays BINDING**. The **BINDING** gate for parity is the REGISTER SWAP.

### C2 — Thing before name

**Rule.** Four moves, always in this order: the pain in ordinary words → the mechanism
described without its name → **the name** (bolded, once) → a one-clause definition. A gloss
may use only words the reader already has. A locally coined abbreviation used before it is
coined is a hard failure (`PETPP` at `spring-core/bean-definition-stereotype-annotations` is
used 17 lines before the line that coins it).

**Why.** A definition arriving before the reader has seen one instance has nothing to attach
to — which is the mechanical reason the 181 files whose body opens `This topic|note|section|
page|document …` lose readers in the first paragraph.

**Bad** — `messaging-databases/database-scaling-replication-pooling/concepts.md:3`: a 97-word
single-sentence table of contents with 12 undefined terms and zero instances.

**Good.** "Your one database is at 90% CPU at 3pm every day, and the graph is still going up.
You have exactly three moves. Buy a bigger machine. Keep a full copy of the same data on more
machines, so reads can go anywhere. Or split *different* data across machines, so writes can
go anywhere too. The second move is called **replication**: every node holds the same rows."

**Check. BINDING.** Every bolded or italicised term first use has a gloss marker (`is`,
`means`, `—`, `:`, a parenthetical) within **25 words**, and a concrete instance in the
**60 words** before it. Zero coined-before-defined abbreviations.

### C3 — One gloss per sentence, and never between a subject and its verb

**Rule.** At most one inline gloss per sentence. Cap the subject–verb gap at **6 words**.
Never splice a gloss into an item of a list the reader is following. Long definitions become
their own sentence. Citations land after the definition, or in `## References`.

**Why.** The 2026-07 waves demanded "define jargon at first use", chose inline apposition, and
produced the corpus's signature clarity killer. Gopen & Swan: "anything of length that
intervenes between subject and verb is read as an interruption, and therefore as something of
lesser importance."

**Bad** — `system-design/interview-method-scenario-playbooks/concepts.md:632`: "the **outbox
pattern** (write the event into an `outbox` table *in the same DB transaction* as the state
change, then a relay publishes from that table) + **CDC** (Change Data Capture — tail the DB's
write-ahead log …) for reliable event publishing without a **dual-write** (…)". Four nested
definitions, then the sentence abandons syntax and collapses into bare keywords.

**Good.** "Write the event into an `outbox` table in the same database transaction as the
state change, then let a relay read that table and publish. Otherwise you are doing a
**dual-write** — one write to the database, one to the broker, no transaction across them —
and either can fail and leave the two disagreeing."

**Check. BINDING on judgement, grep-assisted.** Read each sentence's outer clause with every
parenthetical deleted; if it is no longer grammatical or no longer says the thing, the glosses
have eaten it. Grep flags sentences with ≥2 parentheticals or ≥2 em-dash pairs for mandatory
review (REPORT-ONLY as a count).

### C4 — A concrete instance inside the first 60 words

**Rule.** Every H2 and every H3 seam puts something the reader can picture inside its first
**60 words**, before any general characterisation: a number with a unit, a named
class/service, a specific request, a step-by-step trace, or a fenced block. Then fade to the
abstract, keeping the instance nameable for the rest of the section.

**Why.** Examples are the corpus's lowest-scoring axis in its own audit (2.95–4.00 domain-wide)
and the measurable form of "not easy to understand." Concreteness fading says the abstraction
must still land — it just lands second.

**Bad** — `java-jvm/oop-principles-polymorphism` §Encapsulation opened with the definition
("bundling data (fields) and the methods that operate on that data into a single unit"), while
the perfect instance — a `BankAccount` that can guarantee `balance >= 0` only if nobody can
write `balance = -100` — already sat two paragraphs down. A reordering defect, not a writing
defect. Look for these first: the instance is usually already in the file.

**Good.** "Give any caller direct access to a `BankAccount`'s `balance` field and someone will
eventually write `balance = -100`. The account is now in a state your business rules say
cannot exist… Bundling the data with the methods that operate on it, and letting nothing
outside touch the data directly, is called **encapsulation**."

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

**Why.** Gopen & Swan call misplacing old and new "the No. 1 problem in American professional
writing today," and the corpus does both halves: 2,780 sentences open on a bare demonstrative,
and the framework domains open on an API surface and reach the consequence three clauses later.

**Bad** — `spring-boot/core-annotations-stereotypes/concepts.md:79` opens on the API surface:
"the default `AnnotationTypeFilter(Component.class)` used by scanning is created with
`considerMetaAnnotations=true` but `considerInterfaces=false` and does **not** traverse
superclasses. So a concrete subclass that merely *extends* an `@Component`-annotated base is
**not** auto-registered…"

**Good.** "Put `@Service` on a base class, extend it, and the subclass never becomes a bean.
Nothing is registered, nothing is logged, and injection fails at startup with a missing-bean
error that names the interface rather than the cause. The reason is that component scanning
looks for the stereotype on the class itself. It does follow meta-annotations, which is why
`@Service` works at all — but it does not walk up the superclass chain, because the filter
scanning installs by default is built with `considerInterfaces=false` and no superclass
traversal." **Every fact survives, including both constructor flags** — that is the point.

**Check. BINDING** — name the referent or rewrite. Match **sentence-initial**, not
line-initial: `(?:(?<=[.!?]\s)|^)(This|That|These|Those|It)\s+(is|are|means|gives|makes|lets|allows)`.
The `^`-anchored version sees only paragraph openers and catches 356 hits against this one's
**2,398**, i.e. about 13% of the phenomenon; expect the higher number and do not read it as a
regression. The old/new *ordering* is **judgement**: list each sentence's first five and last
five words per paragraph; the first-word list must read as one continuing subject, and no
last-word entry may be a citation or a hedge.

### C6 — One payload per syntactic closure

**Rule.** A sentence may carry as many emphasis-worthy things as it has closures — its end,
plus each properly used colon or semicolon. More than that: split it, or install a closure.
Any clause over ~8 words goes at the **end** of its sentence. **There is no word-count limit.**

**The repo tokenizer counts each list item as a sentence.** `scripts/corpus_stats.py` starts a
new segment at every list item, so a C7 conversion of an inline enumeration *into* a list will
raise your p90. **That rise is expected and is not a C6 failure.** Do not hand-roll a different
tokenizer to make the number look better — use the repo's, and say in your report which of the
delta came from C7 conversions.

**Why.** Length is not this corpus's problem — sentences mean 14.9 words, p90 28 — and chopping
strips the connectives that carry the logical relations. Gopen & Swan: "A sentence is too long
when it has more viable candidates for stress positions than there are stress positions
available." The damage sits in ~1,290 monsters over 45 words.

**Bad** — `system-design/ccp-management-elasticity-resiliency/concepts.md:340`, the corpus's
longest sentence at 116 words: "The mechanics that stop thrashing are worth naming in an
interview: (1) a **deadband / hysteresis** … (2) **cooldown windows** … (3) **asymmetric
policy** …".

**Good.** "Three things stop an autoscaler flapping. First, hold steady inside a band around
the target — say 45% to 55% CPU — so a metric hovering near it does not ping-pong. That band
is a **deadband**… Second, after you act, ignore the metric for a fixed window…"

**Check. Judgement, BINDING.** List the things you want the reader to carry away from the
sentence; if that count exceeds 1 + (colons and semicolons used as closures), it fails.
Sentence-length reporting is **REPORT-ONLY**.

### C7 — Turn catalogues into claims

**Rule.** Before any list of 5+ technical items, name the **single question** all the items
answer, then group them by their answer. Never present an enumeration as the explanation.
No inline glosses inside list items.

**Why.** An enumeration asserts that things belong together without saying why, and working memory
tops out around four items, so items 5–15 are lost while the reader still pays for trying. It is
also the source of the corpus's nominalization density (35.97 per 1,000 prose words) — the prose
nominalizes *because* it lists.

**Bad** — `reliability-ops/cascading-failures-and-antipatterns/concepts.md:743`: twelve
stability patterns, six inline glosses, 88 words, one sentence. The reader gets twelve
unrelated names and keeps four.

**Good.** "Nygard's twelve stability patterns are twelve answers to one question: where do you
put the wall that stops a failure spreading? There are only three places to put it." Then three
grouped sub-lists — *in time*, *in capacity*, *in the process itself* — one gloss per line.
(The question needs no bold. A colon plus a question mark already gives it two closures under
C6; bolding it would spend the paragraph's one bold on something that is not a term.)

**Check. Judgement, BINDING.** The paragraph immediately above the list contains the one
question the list answers; the list is grouped by the answer; no item carries a parenthetical
gloss over 12 words.

### C8 — Emphasis budget, and one bold per term per file

**Rule.** Bold marks the **teaching site** of a term the reader must now know: the place this
file defines it. **Each distinct term is bolded exactly once in the file, at that teaching
site, and nowhere else.** Never bold for enthusiasm, never for negation ("does **not**"), never
for a slot label, never for three of nine list items, and **never a whole claim sentence or a
question** — bolded claim sentences are this corpus's dominant bold defect.

**The budget, with its tie-break** (same shape as S9's, deliberately):

- **Primary, per file (BINDING):** ≤ **12 bold spans per 1,000 prose words**.
- **Secondary, per paragraph (BINDING):** ≤ **1**.
- **Both must hold, and whichever admits fewer bolds governs.** On a normal file the per-file
  cap is the one that binds — the corpus median is 22.3 paragraphs per 1,000 prose words, so
  ≤1-per-paragraph would license ~22 while the per-file cap licenses 12. **Expect roughly one
  bold every third or fourth paragraph, not one per paragraph.** Do not work paragraph by
  paragraph and discover the per-file overrun at the end: budget the file first.

**Why.** The corpus runs 39.83 bold spans per 1,000 prose words — one bolded phrase every 25
words against a median paragraph of 20–27. Emphasis works by contrast; at that saturation it
carries no information and the eye cannot establish a rhythm, which is the literal sensation
behind "exhausting".

**Why "teaching site" and not "first occurrence"** — this is a repaired rule. The old wording
was "the first whole-token occurrence in the file," which fails three ways: it collides on
`Context` inside `SpanContext`; it spends a term's bold on an opener that name-drops it 270
lines before it is taught; and it is **uncheckable on a partial-file pass** — the hard-case run
hit a live collision where the rewritten scope bolded `**visibility**` and un-rewritten line
219 already bolded it. Anchoring the bold to the definition site is checkable inside whatever
scope you hold, and it makes an opener name-drop automatically ineligible.

**Check. BINDING arithmetic.** Count `\*\*[^*]+\*\*` outside code fences — but use a
**fence-aware, newline-tolerant** matcher: a naive `[^*\n]+` misses any bold span that wraps
a source line, which in an 88-column file is most of the long ones (it under-reported 5 where
the file had 6). Then: ≤12 per 1,000 prose words **and** ≤1 per paragraph, whichever admits
fewer, and no term bolded twice.

**Whole-file pass (the default, and what the pilot does).** Grep the finished file for each
bolded token; two bolded occurrences of the same term is a failure. Displaced siblings become
structure, not typography: a claim moves to its sentence's stress position, a warning moves
into a `[!WARNING]`, parallel items become a list.

**Partial-pass exception (documented, and it owes something).** When you rewrite fewer than
all H2s: (a) no term is bolded twice inside your scope; (b) grep the **un-rewritten
remainder** for `**<term>**` for every term you bold. On a collision, keep the bold only if
your occurrence is the file's genuine teaching site; otherwise do not bold it. **Never edit
prose outside your scope to resolve it.** Record the surviving duplicate in the ledger's
**`owed:`** list (not `known_defects`, which is for defects you did not create) as a debt to
whoever rewrites that section — that is exactly what the hard case did with `visibility`, and
recording it is the difference between a known debt and a silent regression.

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
> it.** De-hedging is the single most dangerous edit in this standard: three of the four
> fact regressions on the hard case were C9 de-hedges that invented a condition the source
> does not state. "on some JVMs" is spec-accurate; "on a 32-bit JVM" is not.

**Bad.** "Reads from replicas are relatively fast, and in most cases a caching strategy at the
application level is sufficient; in a multi-tenant context the isolation model may need to be
revisited depending on the workload."

**Good.** "Reads served from a local replica return in under 1 ms; a cross-region read costs
60–100 ms. Cache-aside with a 60-second TTL covers it until your write rate passes the single
leader's disk throughput — above that, the cache hides a database that is already falling
behind."

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

**Why.** A label is not a transition, so nothing carries the reader from slot to slot and a
2,648-line file becomes 72 identical cold starts — the mechanical cause of "boring." The shape
regex below finds **15,771** of them, a median of 22 per file (14 files have none, 86 under eight).

**Bad** — `system-design/dp-concurrency/concepts.md:314` fuses seven labelled slots into one
110-word block (*Pros / Cons / Use when / Avoid when / vs L-F / vs Reactor / Real-world*), then
repeats the shape for each of ~30 patterns in the file.

**Good.** "You pay one queue hop per message — a context switch, usually a data copy, plus the
memory the queue holds — and in exchange every worker gets to be written as ordinary blocking
code. That is the whole deal, and it is a good one whenever the people writing handlers
outnumber the people who understand the event loop. Take it unless microseconds matter."

**Check. BINDING, shape-based** — not a fixed string list. Grep
`^\s*(?:[-*]\s+)?\*\*[^*\n]{2,60}[.:]\*\*`, with a small allowlist for a genuine term first
use. The 11-string version catches ~8% of the phenomenon and is evaded by renaming
`**Trade-offs.**` to `**Trade-off.**` (94 instances already did). Then the judgement gate: the
replacement paragraph states a cost-for-benefit relation **and** a condition that flips the
decision.

### C11 — Explain the mechanism, not the interviewer

**Rule.** Never substitute a statement about how the reader will be assessed for the
explanation itself. Interview framing survives **only** inside an `[!INTERVIEW]` callout, and
only as a question — never as the reason a thing is true.

**Why.** 435 "Interviewers probe/want/expect" plus 126 "in an interview". This converts
learning into memorising a performance and inverts the motivation: the reason to understand
happens-before becomes "it will be asked" rather than "your loop will never terminate."

**Bad** — `networking/tls-ssl-https/concepts.md:21`: "**Why it matters.** Interviewers want to
know that TLS is a distinct layer that sits **between the reliable transport (TCP) and the
application (HTTP)**." The reason TLS is a distinct layer is never given.

**Good.** "TLS sits between TCP and HTTP, and that position is the whole design. It needs TCP
underneath because it assumes bytes arrive in order and none are lost — a handshake message
that arrives second breaks the key schedule… That is why HTTP/1.1, HTTP/2, IMAP and SMTP all
get TLS for free, and why the same protocol had to be redesigned as DTLS the moment anyone
wanted it over UDP."

**Check. BINDING, zero hits outside an `[!INTERVIEW]` block.** Grep
`[Ii]nterviewer(s)?\s+(probe|want|expect|ask|love|use|listen)|in an interview|the (senior|strong) (probe|signal|answer)|high-signal|[Cc]oncepts you must name|The bar is not|come up in interviews|commonly asked|a favourite question|worth being able to say out loud`.

---

## The structure rules

| | Rule | Check |
|---|---|---|
| **S1** | **Three-beat section, seam above ~50 lines.** An `## H2` **over ~50 lines** runs the case → the mechanism → the depth, with the depth behind a **content-named `### H3` seam**. An H2 **at or under ~50 lines** runs the first two beats inline and takes **no seam** — the clarity floor still applies to its closing paragraph. Seam vocabulary is a **prefix, not a fixed string**: `### Where it breaks: …`, `### What it costs: …`, `### Tuning it: …`, `### The version-specific truth: …`, `### Why the simple version is wrong: …`. Never an audience label, and never `### What breaks next` (see S8). A fixed string produces duplicate slugs — a hard validator error — in any file with two "where it breaks" seams. | Every H2 over ~50 lines has ≥1 content-named H3; shorter H2s need none. Zero audience-named seams; zero duplicate slugs. **BINDING**; where a seam exists, Beat 3 must add a *distinct* claim, not restate Beat 2 at greater length. Only 15% of the corpus's 7,903 H2 sections exceed 50 lines, so most sections take no seam |
| **S2** | **Openers.** The first 60 words after the `# H1` carry a specific situation, number or observable symptom. Delete every "This topic covers…", every citation slab, every attribution paragraph — bibliography goes to `## References`. The opening paragraph's last sentence states the question the file answers. | Grep `^\s*This (topic\|note\|section\|page\|document)\s+(covers\|is about\|explains\|discusses\|teaches\|builds)` → **zero hits, BINDING** (that exact grep returns **80** hits in 80 files today; the looser `^\s*This (topic\|note\|section\|page\|document)\b` returns 185 in 181). Then C4's 60-word test on the opener |
| **S3** | **Delete author-facing scaffolding from the reader's path.** Every "Boundaries — don't duplicate" slab, every cross-reference directory, every author erratum. Where a boundary genuinely helps, it becomes **one inline sentence with one link at the point of need**, below the file's first 25%. | Grep `Boundaries\|Cross-references\|don't duplicate\|do not duplicate`. Target ≤2 backticked `domain/slug` references per file. **BINDING** |
| **S4** | **Diagram by positive test, not by quota.** Add a mermaid diagram only if one holds: ≥3 entities with directional relationships; an ordering or timing the reader must hold; a state space with legal transitions; a layered or boundary structure. **The diagram replaces the enumeration it renders** — delete the list. Labels live inside the figure, verbatim from the prose. Mermaid only; convert ASCII art you touch. | Name which test fired. **BINDING**: the replaced enumeration is deleted, not left above the figure. See the note below on definitions versus placement |
| **S5** | **H2 text frozen; the claim goes in the first body line.** Never rename, merge, split or delete an H2. Under a bare-noun H2, the first line of body prose carries the claim the heading could not make — a finite verb and a claim, not a definition ("False sharing is when…" fails under C2). **Additions are legal at any level** — prefer an H3 seam; add an H2 only for genuinely new material, never to reshape an existing section. No duplicate slugs. | `--check-lock` plus `validate_content.py`. Every base H2's `(level, text)` still present and in order; anything extra is an addition. **BINDING, build-breaking** |
| **S6** | **Reading map for long files.** Any file over **3,500 RAW words** opens with exactly one `> [!TIP]` reading map: the minute budget, and explicit permission to skip named sections with the reason. At or under 3,500: no map. **Exempt from the callout budget.** | **The basis is RAW words** — the site's own count, the one that drives `readingMinutes`. `prose_words` (S9's basis, which strips fences, tables and callouts) is a different, smaller number and using it here fails 149 files the wrong way. **BINDING.** 387 of 460 files qualify on raw words; exactly one map exists today |
| **S7** | **Section exits are plain transitions.** The last sentence of each content H2 names the problem the next content H2 solves, in flat declarative prose, ≤25 words, withholding nothing. **Three exemptions, on every file:** the **last content H2** closes the topic's arc instead (its forward hook is the `prompts.yaml` cliffhanger), and `## Common follow-up questions` and `## References` take **no exit sentence at all**. Exactly one withheld payoff exists per topic and it lives in `prompts.yaml`. | Grep `there'?s a catch\|read on\|we'?ll see\|coming up\|stay tuned\|you'?ll never look at` → **zero hits, BINDING** |
| **S8** | ~~terminal `## What breaks next` H2~~ — **DELETED. Do not add this heading.** | See below |
| **S9** | **Callout budget, four types, colour quarantined.** See the resolved budget below. Every war story, historical aside, vendor anecdote and fun fact moves **into** a callout — never deleted, never left inline in the load-bearing chain. | **BINDING arithmetic** |

### S8 is deleted — the cliffhanger is not a heading

There is **no terminal cliffhanger H2.** `grep -E '^## (What breaks next|Where this goes next)'`
must return **zero hits** in any `concepts.md`. The cliffhanger lives only in `prompts.yaml`,
under the `cliffhanger:` key. (The grep is H2-scoped on purpose: S1 seams are prefixes, so
`### What breaks next: the 64-bit case` is a legal seam. Only the H2 form is banned.)

Two reasons, both hard. The study page has a single `data-pagefind-body`, so a cliffhanger in
the prose is by construction dense in the *next* topic's highest-signal terms and would
surface the wrong page in search — and shipping it in both places renders it twice. Second,
the prompts schema is the thing that can verify the payoff anchor resolves; a markdown heading
cannot.

If you remember a rule mandating that heading, it is the deleted S8. Run the H2-scoped grep
above on your finished file; the correct result is nothing.

### The callout budget, resolved

Two differently shaped numbers used to be live at once ("≤1 per H2" and "≤5 per file" and
"≈1.2 per 1,000 words") with no tie-break. They agree by luck on a 2,000-word slice and
diverge on a 6,000-word file. This is the single rule:

- **Primary, per file (binding):** `allowed = max(1, round(1.2 × prose_words / 1000))`.
  A 2,010-word section slice gets 2. A 4,000-word file gets 5. A 6,000-word file gets 7.
- **Secondary, per H2 (binding):** at most **1** callout per H2. This is an anti-clustering
  cap, not a budget — it never actually binds, because on 0 of 460 files does the per-file
  budget exceed the H2 count (a median file's budget of **4** spreads across 15 H2s).
- **Tie-break: both must hold, and whichever admits fewer callouts governs.** The per-H2 cap
  can never license exceeding the per-file budget, and the per-file budget can never be spent
  by stacking two callouts in one section.
- **The S6 reading map is exempt** from the per-file arithmetic.

**Why 1.2 and not 5 per file.** A rule nothing obeys is not a rule. The corpus runs about 7
callouts per file — 1.79 per 1,000 prose words, max 27 — and **256 of 460 files exceed 5**,
while `refining-content` asks for 1–3 and only 82 files comply. 1.2 per 1,000 words is a real
one-third reduction from today's rate, it is satisfiable on every file including the 27-callout
one, and it scales with length instead of punishing long files. Usage is strongly bimodal by
domain (`spring-boot` and `spring-core` sit at 0.05 per 1,000 words, `testing` at 3.99), so
some files must **shed** callouts and some must **gain** them.

**Surplus callouts are demoted, never deleted.** A `[!WARNING]` over budget moves into the
**stress position of a body paragraph** — the end of the sentence, where the payload belongs
under C5. An anecdote, a date or a vendor name over budget moves to `## References`. Deleting
it is information loss and fails the gate.

**So callout counts MAY drop, and `[!WARNING]`/`[!INTERVIEW]` counts are deliberately NOT in the
information inventory** (loop step 4). 276 of 460 files exceed this budget today, and on 193 of
them the `[!WARNING]` plus `[!INTERVIEW]` count alone exceeds it — those counts *must* fall.
What is gated instead is the **demotion log**: one line per dropped callout, naming the body
sentence or `## References` line that now carries its content. A drop with no log line is
information loss and fails. Callouts are typography; their content is information.

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
still applies to its closing paragraph. This is the same ~50-line threshold as S1, and it is the
only threshold: only 15% of the corpus's 7,903 H2 sections exceed it (mean span 36.1 lines), so
on a typical file most sections get no seam and the 72-H2 file gets a handful, not 72.
Beats 1 and 2 are always unlabelled prose.

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

H3 seams are structurally free: `read_headings` collects `#{1,6}` so a new H3 only *adds* an
anchor, and the study page builds its sidebar TOC from `depth === 2`, so seams add no clutter
and leak no spoilers.

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

`### Where it breaks: losing the thread` lets a strong reader skip by scent; `**Advanced.**`
makes them self-diagnose before they have read anything, and status labels make strong readers
skip material they needed. That is why the 778 audience-tier labels across 46 files are a
zero-tolerance grep and not a preference.

The skip affordance has exactly two levels: the H3 seam, and the S6 reading map that names the
seams worth jumping to. No collapsible blocks, no new markers, no CSS work.

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

**What a failure looks like, from the real run.** The hard case scored **PARTIAL**: vocabulary
passed decisively, clause depth did not. `## volatile` opened `[8, 8]` and its deep beat closed
`[33, 11, 24]` on a four-clause transitivity walk. The writer's own self-report claimed the deep
tier's longest sentence was 26 words; it was 38. **A writer measuring its own register swap will
understate it** — which is why step 7 of the loop hands this to a separate verifier. The repair
split four sentences, moved no content, and landed at `[8, 8]` versus `[13, 13]`. That is a pass.

A cheaper tell before you measure: read the deep paragraph aloud. If you run out of breath before
the verb, it fails.

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
> before topic 1**, or the authoritative contract and the shipped tree disagree from the first
> commit. (2) **Nothing in `web/` reads `prompts.yaml` today** — `sync-content.mjs` reads only
> `concepts.md` and `questions.yaml`. So the render-time resolution of a cliffhanger's
> destination title from README row order, and the `id` field's reveal state, are **required
> future web work, not existing properties.** Until that renderer ships, nothing downstream
> verifies these files: your own `payoff.anchor` check is the only gate. Do not assume the chain
> self-verifies.

**Real example** (from the hard-case run; abridged to three prompts):

```yaml
topic: "synchronized, volatile & the Java Memory Model"
domain: java-jvm
topic_slug: synchronized-volatile-jmm
schema: 1
pass: clarity-v1

prompts:
  - id: synchronized-volatile-jmm-p001
    ref: "concepts.md#visibility-reordering-and-atomicity"
    kind: predict-failure          # predict-failure | name-the-price |
                                   # draw-the-boundary | refute | notice-in-wild
    tier: A                        # A in-file | B other topic | C source | D open
    prompt: |                      # <=35 words
      Your teammate declares `stop` volatile, the loop exits, so they apply the same fix
      to a `hits` counter that eight threads increment. Name what still breaks.
    hint: "Count the memory accesses in one `hits++`."
    answer_in: "concepts.md#volatile"

  - id: synchronized-volatile-jmm-p002
    ref: "concepts.md#why-the-simple-version-is-wrong-three-machines-reorder-not-one"
    kind: draw-the-boundary
    tier: C
    prompt: |
      Your racy cache passes 10,000 runs on an x86 laptop and fails within a minute on an
      ARM build server. Which reordering did the ARM core permit?
    success_criterion: |           # MANDATORY for tier C. Exempt from the 35-word cap.
      You have it when you can name one reordering an ARM core may perform that an x86 core
      may not, and say which barrier a JVM therefore has to emit on ARM and not on x86.
      This file states only that ARM and POWER permit reorderings x86 forbids; it does not
      say which, and that gap is the point of the hunt.
    answer_in: external
    search_hint: |
      Doug Lea, 'The JSR-133 Cookbook for Compiler Writers' — the barriers-required table.
      The page self-labels its processor rows as historical, so confirm anything you take
      from it against your target chip's own manual.

  - id: synchronized-volatile-jmm-p005
    ref: "concepts.md#what-it-costs-the-fences-hotspot-emits"
    kind: notice-in-wild
    tier: D
    prompt: |
      Next time a profiler shows a hot method with a `volatile` write in it, count the
      writes per call. One write per call usually means one full fence per call.
    answer_shape: |                # MANDATORY for tier D. Exempt from the word cap.
      A good answer prices three things: how many StoreLoad fences one call executes, what
      each fence has to drain before the next load may proceed, and whether the write could
      happen once outside the hot path instead of once inside it.
```

### The five kinds — no others

| Kind | Shape |
|---|---|
| **predict-failure** | Concrete scenario with numbers; name the first thing that breaks. Highest-yield: it forces a pre-commitment, so a later miss is legible instead of dissolving into "yes, I knew that" |
| **name-the-price** | "{Mechanism} gives you {benefit}. Name what it costs, and the workload where that cost is the one that matters" |
| **draw-the-boundary** | "Everything here assumed {implicit assumption}. Find where it fails." Doubles as the Beat 2 → Beat 3 seam marker |
| **refute** | A colleague's confidently worded, subtly wrong review comment. Anxiety-cheap, because the person who is wrong is fictional. Source the wrong claim from a distractor already in the topic's `questions.yaml` |
| **notice-in-wild** | "Next time you {situation}, check {observable}." Nothing to get wrong. Keep **about a third** of all prompts this kind — it is the anxiety budget that keeps a reader attempting prompt nine |

### The four closure tiers — every prompt has one

- **A — answered later in this file.** `answer_in` is an in-file anchor. The reveal is a deep
  link labelled "Where this gets answered", not the answer.
- **B — answered in another topic.** `answer_in` is `/study/<domain>/<slug>#anchor`.
- **C — in a primary source.** `answer_in: external`, plus a `search_hint` and a **mandatory
  `success_criterion`**: the criterion bounds an otherwise unbounded task and is the substitute
  for a human mentor. At most **one tier-C hunt per topic**, in the deepest section.
- **D — genuinely open.** **Mandatory `answer_shape`**: the two or three dimensions any
  credible answer must price. An open prompt with no `answer_shape` is the abandonment failure.

### Density, placement, and the one absolute rule

- **Primary: a hard cap of 14 prompts per topic, regardless of file length.** This is the one
  number that governs. Do **not** scale with length: the 72-H2 file gets 14, placed at natural
  resume points so they double as session bookmarks.
- **Within that cap: ≤1 prompt per anchor, and instrument about two-thirds of teachable H2s, or
  as many as the cap allows — whichever is fewer.** Above ~21 teachable H2s the cap is what
  binds, and the corpus p95 is 29 H2s, so on the biggest files you will instrument well under
  two-thirds. That is correct, not a shortfall.
- **Skip unconditionally:** `## References`, the follow-up-questions H2 (already question
  shaped), `## Trade-offs and when to use what` (already comparative), and short pure-enumeration
  sections.
- **Instrument preferentially:** where a folk belief conflicts with the mechanism, where a rule
  is stated without its boundary, where a capability is given without its price, and at the
  Beat 2 → Beat 3 seam.
- **Placement: after the section it interrogates, never before.** The only pre-question a reader
  meets is the previous topic's cliffhanger.
- **Prompt body ≤35 words**, one question, no "and" joining two interrogatives. `success_criterion`
  and `answer_shape` are exempt from the cap.
- **Never inline the answer.** All 460 files currently do exactly that — *"Is `R + W > N` the same
  as linearizability? Why not? (No — sloppy quorums, concurrent writes and read-repair races still
  allow anomalies.)"* — which leaves no interval in which the reader could generate.
- **No duplicates.** Grep the topic's `questions.yaml` first; if an MCQ already tests it, the
  prompt must ask something the MCQ format cannot.
- **Invitation register.** No "Quiz", no "Test yourself", no score, no streak, no taunt. State
  expected difficulty out loud when it is high.

Aim for roughly a 50% first-attempt success rate. Above ~80% the prompt is decoration — delete
or escalate it. Below ~20%, add a cue, narrow it, or demote it to a tier-C hunt.

---

## Cliffhangers — in `prompts.yaml` only

One per topic, under the `cliffhanger:` key. Never a heading (S8 is deleted). **Never author the
destination's title or a link to it** — the design is that a future renderer resolves both from
README row order, so the chain tracks reading order forever and the pager and the cliffhanger can
never disagree. That renderer does not exist yet (see the warning above); the authoring rule
holds regardless, because a hand-written title is what goes stale.

**Real example** (same run; verified to pay off in the genuine next topic):

```yaml
cliffhanger:
  hook: |
    You can now make any shared field correct. Pick the edge, pick the tool, and the race
    is gone. Here is a loop with no shared field in it:

        while (true) {
            Socket s = server.accept();
            new Thread(() -> handle(s)).start();
        }

    It passes every load test you have. At the first real burst it dies with
    `OutOfMemoryError: unable to create native thread`. Nothing you just learned is wrong,
    and none of it helps. Happens-before governs which values a read may return. It never
    says how many threads you may create, or what happens when you run out.
  teaser_questions:
    - "Who decides how many threads your program is allowed to create?"
    - "Where does a task wait when no thread is free to run it?"
  payoff:
    anchor: "concepts.md#executors-factory-methods-and-their-pitfalls"
    claim: >-
      The next topic must show a factory pool whose maximumPoolSize is Integer.MAX_VALUE
      (newCachedThreadPool over a SynchronousQueue) creating a thread per burst task until
      `OutOfMemoryError: unable to create native thread`. Verified present in the
      un-rewritten destination.
```

### The six patterns — pick by what the topic just did

| | Pattern | Use when |
|---|---|---|
| **A** | **Broken invariant** *(default)* | The topic taught a rule; the next topic exists because the rule has a boundary |
| **B** | **Unpaid bill** | The topic handed over a capability that looked free. Give the bill's existence and units, never its structure |
| **C** | **Scale threshold** | Correct at today's numbers, breaks at a computable multiple. The cliffhanger *is* the arithmetic, with constants from the topic's own numbers |
| **D** | **Named unknown** | Survey topics. Exactly three routed questions. Never four |
| **E** | **Pivot** | Non-contiguous adjacency. Do not fake a dependency: name the one genuinely shared mechanism and pose a question on that seam |
| **F** | **Finale** *(domain-final)* | Close the domain's arc, hand off to real `domain/slug` targets, leave one genuinely unsolved question. No congratulation — celebration closes the loop, which is the opposite of the goal |

### Hard form limits

**80–140 words. No sentence over 25 words. At most 1 em-dash. Zero exclamation marks. Carries a
concrete artifact** — code, a number, or an error string. Banned strings: *surprising, shocking,
secret, devastating, brutal, notorious, most engineers don't know, you'll never look at X the
same way, there's a catch, stay tuned, read on*. Read it aloud flat: if it sounds like a trailer,
rewrite; if it sounds like a colleague saying "oh — one thing", it is right.

**Measure the word and sentence limits on the prose only, excluding any code artifact.** A code
artifact has no sentence terminators, so a naive splitter fuses it with the surrounding prose and
over-reports both figures. **The shipped example above measures 85 prose words with a longest
prose sentence of 16** (97 words and a spurious 17-word fusion if you include the artifact) — the
floor is 80 so that this real, compliant hook passes it. Patterns C and D can be artifact-free by
construction; for those, the arithmetic or the named unknown *is* the artifact.

**Calibrate to moderate confidence:** a reader who just finished this topic should be able to
produce a plausible-but-wrong guess. No idea at all → add one scaffolding sentence inside the
hook. Certain to get it right → push to the next boundary condition. Do **not** cite the Zeigarnik
effect anywhere; it did not replicate. A cliffhanger buys **return**, not retention.

### Verifying the payoff — this is what makes the device work

One broken payoff teaches readers to skip all 459 others. The destination is normally not yet
rewritten, and that is fine: its **prose is unstable but its headings are frozen** by the
ADD-only rule. So:

1. Read the next topic's H2 list only — with `read_headings`, not by reading the file.
2. Pick a `payoff.anchor` that **resolves today**, in the un-rewritten destination.
3. Open the destination at that anchor and confirm the promised mechanism is genuinely there.
   Record what you saw in `payoff.claim`. The hard-case run did exactly this: it read the
   destination's lines 89–90 and confirmed the exact error string the hook uses.
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

```yaml
domain: docker
schema: 1
pass: clarity-v1
reading_order_source: "topics/docker/README.md"   # re-derived every run, never hand-sorted
position: 4                                       # 3 done; next is entrypoint-vs-cmd

# PASS 0, written BEFORE topic 1 from every un-rewritten file's H2 list + first 200
# words. Never edited after. This is what makes a forward cliffhanger possible.
plan:
  - { slug: dockerfile-layers-build-cache, covers: "Instruction->layer mapping; cache key +
      invalidation; ordering; build context; layer additivity and size." }
  - { slug: entrypoint-vs-cmd, covers: "CMD vs ENTRYPOINT; exec vs shell form; PID 1 and
      SIGTERM; entrypoint scripts; STOPSIGNAL/tini." }

# APPEND-ONLY. 6 terms per topic, NO truncation - an archival rule would strip exactly
# the gloss and banned_variants fields that K2's check consumes.
canonical_terms:
  layer: { canonical: "layer", defined_in: dockerfile-layers-build-cache,
           gloss: "a filesystem changeset plus metadata, content-addressed by digest",
           banned_variants: ["diff", "slice"] }

running_example:                                  # at most 2 per domain
  name: "the 1.2 GB Node API"
  established_in: images-vs-containers
  state: "Express API, npm ci, COPY . . above the install, 1.2 GB image, 4-minute rebuilds.
          Shrunk to 90 MB in multi-stage-builds (topic 5).
          Numbers may be EXTENDED, never silently changed."

# ROLLING COMPACTION every 5 topics: compress the previous 5 topics' claims into <=5
# domain-level claims, so this stays O(1) rather than O(N). Cap ~25 live claims.
claims_established:
  - "Only RUN, COPY and ADD create filesystem layers; everything else is metadata."
  - "A cache miss on one instruction busts that instruction and every one after it."
approximations_open:
  - { id: APPROX-1, from: images-vs-containers, text: "\"a container is just a process\"",
      correction_owed_by: runtimes-oci-standards }

known_defects:            # PRE-EXISTING defects you did not create and did not fix
  - { file: images-vs-containers,
      note: "opener's byte figures disagree with the layer table; table is canon (an MCQ cites it)" }

owed:                     # DEBTS THIS PASS CREATED and could not close. Append-only.
                          # Sinks for: C8 bold collisions with un-rewritten scope, C9 gaps
                          # where the hedge was kept, partial-pass leftovers.
                          # `file` = who must close it (that is how it reaches them).
  - { file: dockerfile-layers-build-cache, from: images-vs-containers,
      kind: c8-bold-collision, token: "layer",
      note: "also bolded at line 219, outside the rewritten scope; ours is the teaching site" }
  - { file: dockerfile-layers-build-cache, from: dockerfile-layers-build-cache,
      kind: c9-unsourced-condition,
      note: "kept 'on some drivers'; the condition is not in the docs. Routed to prompt p004 (tier C)" }

exemptions:               # PER-FILE rule exemptions, with the reason. C9 mainly.
  - { file: build-context-and-dockerignore, rule: C9,
      terms: ["context"], reason: "the topic is about build context; density is the subject" }

# EXACTLY ONE. Overwritten every topic.
open_cliffhanger:
  from: dockerfile-layers-build-cache
  to_position: 4
  pattern: A
  key_noun_for_K1_grep: "PID 1"
  gap: "A correct image can still hang for ten seconds on docker stop, because the last
        line made a shell PID 1."
  payoff_anchor: "concepts.md#the-pid-1-sigterm-problem-with-shell-form"
  verified_present: true                          # checked against the UN-rewritten topic 4

# ONE line per rewritten topic, <=25 words. 1 per topic, no truncation.
topics:
  - { position: 3, slug: dockerfile-layers-build-cache, commit: abc1234,
      one_liner: "established layer/build-cache/build-context/cache-key; owns the 1.2 GB Node API",
      reading_minutes: { before: 20, after: 27 }, factlines: { emitted: 3, verified: 3 },
      adversarial_signoff: true }
```

**Load exactly four slices, never the whole ledger:** (1) the full `canonical_terms` map;
(2) `running_example`, plus the `known_defects`, `owed` and `exemptions` entries **whose `file`
is topic N** — that is how a debt owed to you reaches you; (3) the last 3 `topics[]` entries in
full plus a one-line roll-up of `claims_established`; (4) `plan[N-1] / plan[N] / plan[N+1]`.
Plus the raw `concepts.md` for N and an **H2-list-only** read of N+1. A 16-topic ledger lands
around 10–14 KB and it replaces tens of thousands of words of prior topics.

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

### The precedent

Commit `268a063` ran a no-web pedagogy pass over 59 files and **silently downgraded verified AWS
facts**: SCPs-per-entity 10 → 5 (5 is the RCP limit — a confusion the rewriter *introduced*), and
the NLB idle timeout rewritten as "fixed at 350s / not tunable" when it is configurable
60–6000s. **Every gate stayed green.** It was caught only by a second, web-enabled pass that read
the **diff**.

> [!KEY-TAKEAWAY]
> **The unit of verification is the DIFF, not the file. A fact-shaped line is immutable unless
> you explicitly re-verify it. And any sentence whose subject, verb or object differs from the
> original is a NEW CLAIM — marker word or not.**

### Why a marker grep cannot be the gate

The planned gate greped added sentences for *so, because, which means, therefore, cannot, always,
never, only*. On the real run, the **highest-severity finding carried no marker word at all**:

> "Which moves are legal at the last stage depends on the chip."

That sentence is an unsourced architectural attribution. It localises all x86-versus-ARM
difference to one stage of a three-stage pipeline, the original made no stage attribution at all,
and it **contradicted the file's own tier-C prompt**, which asks the reader about chip dependence
at a different stage. The writer's own 36-item added-claims audit missed it entirely, because its
grep was blind to it.

**So: the marker grep is a net, not a gate.** It runs *after* you have built the claim population
by other means, to catch rows you missed.

### The three other real regressions, all marker-free

Each of these is a shape to hunt, not an anecdote:

| Shape | Original | Rewrite | Why it is wrong |
|---|---|---|---|
| **De-hedge invents a condition** | "on some JVMs" | "on a 32-bit JVM" | JLS 17.7 conditions 64-bit splitting on the *implementation*, not on word size — and the rewrite implies 64-bit JVMs are safe by spec, which the spec does not say |
| **Mechanism substituted for observable property** | `incrementAndGet()` "is a CAS loop" (parenthetical) | "it **calls** `compareAndSet(expected, expected + 1)`" | It routes through `Unsafe.getAndAddInt`, whose loop uses `weakCompareAndSetInt`, and on x86 it may compile to one atomic add with no retry at all |
| **Qualifier deleted, absolute added** | "x86 is a *relatively strong* TSO model (only store-load reordering is visible)" | "x86 gives you TSO … **nothing else can**" | The guarantee holds for ordinary write-back accesses, not unconditionally |

Note what all three have in common with the SCP regression: **no number changed, no version
changed, no citation changed.** Nothing mechanical could see them. A fourth of the same family:
"HotSpot on a 64-bit platform writes a `long` in **one instruction**" replaced the base's "writes
them **atomically**" — a codegen mechanism swapped in for an observable property, in the same pass
where the writer had explicitly *rejected* a different codegen claim for being unsourceable.

### The procedure that actually catches them

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
hedge, or delete the clause, and route the gap to a tier-C prompt.** The hard case did this
correctly five times — including refusing to invent a cycle count and reverting a spec claim it
had not opened.

**Step 4 — run the marker grep as the net.** `so | because | which means | therefore | cannot |
always | never | only` over added sentences. Any hit not already in your table is a row you
missed, and it tells you your alignment was sloppy.

**Step 5 — a separate adversarial verifier, in a fresh context, is mandatory.** It sees only the
diff, the claim-diff table and the inventory delta. It re-derives the alignment **independently**
and its job is to name the rows your table does not contain. **A writer cannot audit itself** —
that is the whole lesson of the run: the writer produced the most honest audit in the effort and
still missed its own highest-severity claim. The verifier is also not infallible: on the real run
one of its suggested fixes did not compile. Read its fixes before applying them.

**Step 6 — the web fact-check pass is mandatory, not conditional.** Open **primary sources
only** — the spec, the RFC, the vendor's own limits page, the actual source file — for every
fact-shaped line the diff touched. Never fabricate a citation. When a precise value cannot be
confirmed, soften to a correct range and name the mechanism rather than asserting a wrong precise
number. Re-derive every arithmetic result in a table or trace. Record unreachable sources
explicitly as residual risk; the real run reached nine primary sources and had three refuse the
connection, and saying so is part of the deliverable.

---

## Worked example — one real section, before and after

`topics/java-jvm/synchronized-volatile-jmm/concepts.md`, `## Visibility, reordering, and
atomicity`. This is the file the whole standard was calibrated on: it went through the full
loop — write, adversarial verify, web fact-check, repair.

### BEFORE (verbatim from the repo)

> **Beginner.** Three distinct concerns are often conflated:
>
> - **Visibility** — whether a write by one thread is observable by another.
> - **Ordering / reordering** — whether operations appear to execute in program order.
> - **Atomicity** — whether a compound operation executes as one indivisible step.
>
> They are independent. `volatile` gives visibility and ordering but *not* atomicity of
> compound actions. `synchronized` and atomics give all three (within their scope).
>
> **Intermediate — the classic infinite loop.** A missing visibility guarantee: […code…]
> The JIT is allowed to hoist the non-volatile read out of the loop because, in the absence of
> a happens-before edge, it can prove nothing forces a re-read.
>
> **Advanced — reordering sources.** Reordering can come from (1) the compiler / JIT, (2) the
> processor's out-of-order execution, and (3) the memory hierarchy (store buffers, invalidate
> queues). x86 is a relatively strong TSO model (only store-load reordering is visible);
> ARM/POWER are weakly ordered and expose far more.

**Named defects:** three audience-tier labels (C10, S1); a naked definition list as the
explanation, with the instance 12 lines below the abstraction (C4, C7); "(1)…(2)…(3)" as an inline
enumeration of a three-stage pipeline — a textbook S4 positive test with no diagram; `invalidate
queues` with no gloss (C2); and quality decaying monotonically down the tiers (C1), the
`**Beginner.**` list being plainer than the `**Advanced.**` paragraph carrying the harder material.

### AFTER (the shipped rewrite)

> Three different things can go wrong with a shared field, and each one needs a different fix.
> The smallest case is one `boolean`: […the same code fence, moved up…]
>
> Main sets `stop = true` and exits. Thread T spins on, pinning a core. No exception, no log
> line, and the flag was set long ago. The write was not slow. The JIT is allowed to read
> `stop` once before the loop and reuse that copy, because with no happens-before edge nothing
> in the program obliges T to look again. Declare `stop` volatile and the edge exists, so T
> has to re-read. This is a legal compiler optimisation, not a cache that failed to flush.
>
> That loop is a **visibility** failure: a write by one thread never becomes observable to
> another. Two more failures can happen to the same field, and neither one is visibility.
>
> **Ordering** is whether operations appear to run in the order the program wrote them. Write
> `data = 42` and then `ready = true`, both of them plain fields, and another thread can see
> `ready` set while `data` is still 0. […]
>
> **Atomicity** is whether a compound operation runs as one indivisible step. `stop = true`
> is a single write, so it has nothing to divide; `count++` is a read, an add and a write. […]
>
> […the "three are independent, each tool covers a different subset" paragraph, keeping every
> fact from the BEFORE list; then the 64-bit tearing paragraph; then the one `[!WARNING]`…]
>
> ### Why the simple version is wrong: three machines reorder, not one
>
> Between the order you wrote and the order another core observes, an access passes three
> stages, and each one may move it.
>
> ```mermaid
> flowchart LR
>     P["program order<br/>you wrote"] --> J["compiler / JIT<br/>reorders while generating code"]
>     J --> C["processor<br/>out-of-order execution"]
>     C --> M["memory hierarchy<br/>store buffers, invalidate queues"]
>     M --> O["order another core observes"]
> ```
>
> The hoist in the loop above happened at the first stage, in generated code, which is why no
> amount of cache-flushing would have fixed it. At the last stage a write can be delayed after it
> has already executed: a store waits in the core's store buffer, and on many designs an
> invalidate queue also delays the moment another core learns its copy of the line has gone stale.
>
> Which moves another core can observe depends on the chip, and the compiler targets that chip
> too. x86 behaves as **total store order (TSO)**: for ordinary field accesses, store-load is
> the only reordering it exposes to another core. […]
>
> `volatile` fixes visibility, ordering and the tearing case with one keyword. It cannot fix
> `count++`. That keyword is the next section.

### What to notice

- The definition list became **three named failures, each with an instance**, in the order they
  bite, and the code fence that used to sit 12 lines below the abstraction now opens the section
  (C4, C7). The `(1)(2)(3)` enumeration is **deleted**, not kept above the diagram (S4). The deep
  beat is behind a content-named seam. The exit sentence names the next section in 20 flat words
  (S7).
- **Every fact survived**, including JLS 17.7, the JSR-133 attribution, both tearing halves, and
  `invalidate queues` — now glossed and hedged rather than named and dropped.
- Two H2s went 1,089 → 2,046 words, **+87.9%**. Reported, not gated. The bloat check then cut
  about 50 words of narration ("You do not have to track any of that", "Here is the first, as
  small as it gets") — the line between growing because it teaches and growing because it chats.
- **Three fact regressions and one marker-free added claim were caught after a clean self-audit**,
  by the verifier and the web pass. Budget for that: it is the normal outcome, not the exception.
- One thing to notice in the last quoted paragraph: "Which moves another core can observe depends
  on the chip" is the **repaired** version. The draft said "Which moves are legal at the last
  stage depends on the chip" — a marker-free stage attribution the original never made. That is
  the single most important sentence in this whole document's evidence base.

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
   **Callout counts are NOT in that list and MAY drop** — but only by documented demotion. Write a
   **demotion log**: one line per dropped callout naming the body sentence or `## References` line
   that now carries its content. A drop with no log line fails as information loss. (The list holds
   information; a callout is typography. On 193 files the S9 budget forces the
   `[!WARNING]`/`[!INTERVIEW]` count down, so gating on it would fail 42% of the corpus by
   construction.)
5. **Bloat check.** For each rewritten H2, list the added sentences that teach nothing new —
   narration, reassurance, restatement of the previous sentence — and delete them. Report the
   count. On the hard case this was about 50 words across two sections. This is the compensating
   control for having no reading-time ceiling; skipping it is how "let files grow" becomes padding.
6. **Gates — all must pass:**

   ```bash
   python3 scripts/validate_content.py
   python3 scripts/validate_content.py --check-lock
   cd web && npm run check && npm test && npm run build
   ```

   Plus the anchor check with `read_headings`: **every base heading's `(level, text)` is still
   present and in the same relative order.** Anything extra is an addition and is legal — prefer
   H3 seams; a new H2 is allowed for genuinely new material. Zero duplicate slugs. Do not gate on
   "H3 only": `check_lock()` passes additions at any level, and a gate stricter than the repo's own
   lock will fail compliant files.
7. **Adversarial verifier — a separate agent, fresh context. Mandatory, never skipped.** It sees
   the diff, the claim-diff table and the inventory delta, and nothing else. It re-derives the
   sentence alignment independently, runs its own REGISTER SWAP, and reports undisclosed added
   claims by name. It must also check the opposite failure: anything softened, hedged away, or
   vagued.
8. **Web fact-check pass — mandatory.** Primary sources only, for every fact-shaped line the diff
   touched, with the four regression shapes as the checklist.
9. **Repair.** Apply or reject each finding **with a written reason.** Verifier and fact-checker
   suggestions can themselves be wrong — one suggested fix on the real run did not compile — so
   read them before applying. Record every rejection.
10. **Commit** `concepts.md` + `prompts.yaml` + the ledger append **together, in one commit.**
    Never mix a prose rewrite with an anchor rename or a `questions.yaml` edit: three blast radii,
    three reviews.
11. **Report** reading minutes before/after, word delta, the inventory delta, the demotion log, the
    bloat-check count, and the REGISTER SWAP measurements. Reading minutes are reported, not gated.

**At the end of every session, not every topic** (`CLAUDE.md` makes this non-optional): update the
progress checklist in `ROADMAP.md` and the Claude memory index at
`~/.claude/projects/<this-repo-project-dir>/memory/`. The ledger is the per-file
completion marker; `ROADMAP.md` is the trail a human reads. On a 460-file wave, per-topic ROADMAP
edits would be noise, so batch them once per session — but never skip them.

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
