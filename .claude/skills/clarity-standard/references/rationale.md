# Clarity standard — why each rule exists, and the corpus data behind it

> **This file is ILLUSTRATIVE, not normative.** Every rule, threshold, numeric bound and
> pass/fail check lives in `../SKILL.md`, stated there exactly once. Nothing here creates,
> modifies or relaxes a requirement. The numbers on this page are *measurements of the corpus
> as it stands* — descriptions of a problem, never limits on an author. If a sentence here
> could be quoted to settle a dispute about what an author has to do, it belongs in
> `../SKILL.md` instead.

Read this when a rule looks arbitrary, when you want to know how large the problem it addresses
actually is, or when you are tempted to argue with one. You do not need it to follow the rules.

---

## The framing

Gopen & Swan clarified opaque molecular-biology prose without removing a single technical term:
"We have striven not for simplification but for clarification." That sentence is the whole
design. The difficulty of the idea and the complexity of the explanation are independent dials,
and this corpus turns them together — hardest material, densest prose. Dense prose in a deep
section is not rigour; it is unfinished thinking, and it sits exactly where readers quit.

The corpus's own audit scored examples as its lowest axis, 2.95–4.00 domain-wide, which is the
measurable form of the complaint "not easy to understand".

---

## Why there is no reading-time ceiling

The corpus runs a median of 24 and a maximum of 83 rendered minutes today. A ceiling would push
a rewriter toward deleting caveats, which is the inverse failure and a worse one. Padding is a
real risk, so the loop's bloat check is the compensating control instead: on the one hard case
that went through the full loop, two sections grew +87.9% and roughly 50 of the added words
turned out to be narration rather than teaching.

---

## Why, rule by rule

**C1 — deepest-beat parity.** This is the most likely way the whole effort fails: a nicely
rewritten on-ramp sitting over a deep tier as dense as today's, which leaves the complaint
unfixed for exactly the readers who go deepest. The expertise-reversal effect reduces the
*guidance* an expert needs; it never reduces the plainness they can read.

**C2 — thing before name.** A definition arriving before the reader has seen one instance has
nothing to attach to. That is the mechanical reason the 181 files whose body opens `This
topic|note|section|page|document …` lose readers in the first paragraph.

**C3 — one gloss per sentence.** The 2026-07 waves demanded "define jargon at first use", chose
inline apposition as the device, and produced the corpus's signature clarity killer. Gopen &
Swan: "anything of length that intervenes between subject and verb is read as an interruption,
and therefore as something of lesser importance."

**C4 — a concrete instance early.** Concreteness fading is the reason the order matters rather
than the content: the abstraction still lands, it just lands second.

**C5 — old information opens, new payload closes.** Gopen & Swan call misplacing old and new
"the No. 1 problem in American professional writing today," and this corpus does both halves.
2,780 sentences open on a bare demonstrative, and the framework domains open on an API surface
and reach the consequence three clauses later.

On the C5 regex: the line-anchored form sees only paragraph openers and catches 356 hits, where
the sentence-initial form catches 2,398 — so the line-anchored form was seeing about 13% of the
phenomenon. A first run's much larger count is the regex getting more honest, not the prose
getting worse.

**C6 — one payload per closure.** Length is not this corpus's problem: sentences mean 14.9 words
with a p90 of 28, and chopping strips the connectives that carry the logical relations. Gopen &
Swan: "A sentence is too long when it has more viable candidates for stress positions than there
are stress positions available." The damage sits in roughly 1,290 monsters over 45 words.

A tokenizer artefact worth knowing about: `scripts/corpus_stats.py` starts a new segment at every
list item, so converting an inline enumeration into a list under C7 raises the p90 sentence
figure. That rise comes from the conversion, not from a regression in the prose — which is why
C6's check asks the report to separate the two. A hand-rolled tokenizer that flattered the number
would hide the real signal instead.

**C7 — turn catalogues into claims.** An enumeration asserts that things belong together without
saying why, and working memory tops out around four items, so items 5–15 are lost while the
reader still pays the cost of trying. It is also the source of the corpus's nominalization
density, 35.97 per 1,000 prose words: the prose nominalizes *because* it lists.

**C8 — emphasis budget.** The corpus runs 39.83 bold spans per 1,000 prose words — one bolded
phrase every 25 words against a median paragraph of 20–27 words. Emphasis works by contrast; at
that saturation it carries no information and the eye cannot establish a rhythm, which is the
literal sensation behind "exhausting". The corpus median is 22.3 paragraphs per 1,000 prose
words, which is why the per-file budget rather than the per-paragraph one is normally the binding
half.

*Why "teaching site" and not "first occurrence".* This is a repaired rule. The old wording was
"the first whole-token occurrence in the file," which fails three ways: it collides on `Context`
inside `SpanContext`; it spends a term's bold on an opener that name-drops it 270 lines before
the term is taught; and it is uncheckable on a partial-file pass. The calibration run hit a live
collision where the rewritten scope bolded `**visibility**` and un-rewritten line 219 already
bolded it. Anchoring the bold to the definition site is checkable inside whatever scope you
hold, and it makes an opener name-drop automatically ineligible.

*Why the count needs a fence-aware, newline-tolerant matcher.* A naive `\*\*[^*\n]+\*\*` misses
any bold span that wraps a source line, which in an 88-column file is most of the long ones. On
the calibration file it under-reported 5 where the file had 6.

**C9 — metaconcepts out.** De-hedging is the single most dangerous edit in this standard. Three
of the four fact regressions on the calibration run were C9 de-hedges that invented a condition
the source does not state; "on some JVMs" is spec-accurate where "on a 32-bit JVM" is not. See
`fact-safety-cases.md`.

**C10 — kill the slot label.** A label is not a transition, so nothing carries the reader from
slot to slot and a 2,648-line file becomes 72 identical cold starts. That is the mechanical
cause of "boring". The shape regex finds 15,771 of them, a median of 22 per file; 14 files have
none and 86 sit under eight. A fixed list of 11 label strings catches about 8% of the phenomenon
and is evaded by renaming `**Trade-offs.**` to `**Trade-off.**`, which 94 instances already did
— hence a shape regex rather than a string list.

**C11 — explain the mechanism, not the interviewer.** 435 "Interviewers probe/want/expect" plus
126 "in an interview". This converts learning into memorising a performance and inverts the
motivation: the reason to understand happens-before becomes "it will be asked" rather than "your
loop will never terminate."

---

## Why the structure rules are shaped the way they are

**S1 and the layering mechanic.** Only 15% of the corpus's 7,903 H2 sections are long enough to
reach S1's seam threshold, and the mean span is 36.1 lines. So on a typical file most sections
take no seam at all, and the 72-H2 file takes a handful rather than 72. Seam vocabulary is a
prefix rather than a fixed string because a fixed string produces duplicate slugs — a hard
validator error — in any file with two "where it breaks" seams.

H3 seams are structurally free: `read_headings` collects `#{1,6}` so a new H3 only adds an
anchor, and the study page builds its sidebar TOC from `depth === 2`, so seams add no clutter
and leak no spoilers.

**S2.** The tight grep returns 80 hits in 80 files today; the looser `^\s*This
(topic|note|section|page|document)\b` returns 185 in 181.

**S6.** The reading map's basis is raw words because that is the site's own count, the one that
drives `readingMinutes`. `prose_words` — S9's basis, which strips fences, tables and callouts —
is a different, smaller number, and using it here misclassifies 149 files. 387 of 460 files
qualify on raw words, and exactly one map exists today.

**S8 — why the terminal cliffhanger heading was deleted.** Two hard reasons. The study page has
a single `data-pagefind-body`, so a cliffhanger sitting in the prose is by construction dense in
the *next* topic's highest-signal terms and would surface the wrong page in search — and
shipping it in both places renders it twice. Second, the prompts schema is the thing that can
verify a payoff anchor resolves; a markdown heading cannot. If you remember a rule mandating
that heading, what you are remembering is the deleted S8.

**S9 — why a length-scaled callout rate replaced the old flat per-file constant.** A rule
nothing obeys is not a rule. The corpus runs about 7 callouts per file, 1.79 per 1,000 prose
words, maximum 27, and 256 of 460 files exceed the old flat allowance of five, while
`refining-content` used to ask for 1–3 and only 82 files complied. The rate S9 now uses is a real
one-third reduction from today's, it is satisfiable on every file including the 27-callout one,
and it scales with length instead of punishing long files. Two differently shaped numbers used
to be live at once, with no tie-break; they agree by luck on a 2,000-word slice and diverge on a
6,000-word file, which is why S9 states one primary, one secondary and an explicit tie-break.

Usage is strongly bimodal by domain — `spring-boot` and `spring-core` sit at 0.05 callouts per
1,000 prose words, `testing` at 3.99 — so some files shed callouts under S9 and some gain them.

*Why callout counts are deliberately outside the information inventory.* 276 of 460 files exceed
the S9 budget today, and on 193 of them the `[!WARNING]` plus `[!INTERVIEW]` count alone exceeds
it. Gating on callout count would therefore fail 42% of the corpus by construction. What the
loop gates instead is the demotion log, because callouts are typography and their content is
information.

**The MCQ anchor lock.** 28,064 questions carry `ref: concepts.md#anchor` and 100% resolve
today. `check_lock()` collects added anchors only to enrich its messages, so additions pass at
any level while modifications and removals fail and the error names the MCQ refs that would
break. A gate stricter than the repo's own lock — "H3 additions only", say — would fail
compliant files.

---

## Content labels, never audience labels

`### Where it breaks: losing the thread` lets a strong reader skip by scent. `**Advanced.**`
makes them self-diagnose before they have read anything, and status labels make strong readers
skip material they needed. That is why the 778 audience-tier labels across 46 files are treated
as a zero-tolerance grep rather than a preference.

The skip affordance has exactly two levels by design — the H3 seam, and the reading map that
names the seams worth jumping to — so no collapsible blocks, new markers or CSS work are in
scope.

---

## Why the prompt cap does not scale with file length

The corpus p95 is 29 H2 sections. Above roughly 21 teachable H2s the flat cap is what binds
rather than the two-thirds coverage guideline, so on the biggest files you instrument well under
two-thirds of sections. That is the intended behaviour, not a shortfall: prompts are placed at
natural resume points so they double as session bookmarks, and a longer file does not create
more genuine resume points in proportion to its length.

On calibration: the mid-range first-attempt success target in `../SKILL.md` is what keeps a reader
attempting prompt nine. Prompts almost everyone gets are decoration; prompts almost nobody gets
read as abandonment. The `notice-in-wild` kind exists as the anxiety budget — nothing to get wrong
— which is why the density guidance reserves a share of every topic's prompts for it.

---

## Why the ledger is O(1) rather than O(N)

The four-slice load plus rolling compaction is what keeps a 94-topic domain readable in one
context: a 16-topic ledger lands around 10–14 KB and replaces tens of thousands of words of
prior topics. Without compaction, `claims_established` grows linearly and the ledger eventually
costs more to load than the topics it summarises.

A related design note: the ledger lives in `docs/continuity/` rather than under `topics/` because
S3 is *removing* author-facing scaffolding from the reader's tree, and a fix that added a new
instance of the thing it removes would be self-defeating.

---

## On the cliffhanger device

A cliffhanger buys **return**, not retention. There is no memory effect behind it: the Zeigarnik
effect did not replicate, so it is not evidence for anything here, which is why `../SKILL.md`
rules out citing it.

One broken payoff teaches readers to skip all 459 others, which is why the payoff verification
procedure is heavier than the hook-writing procedure. The destination is normally not yet
rewritten, and that is fine: its prose is unstable but its headings are frozen by the ADD-only
rule.
