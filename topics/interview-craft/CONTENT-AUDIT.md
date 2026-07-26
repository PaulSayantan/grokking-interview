# interview-craft — Content Audit

**Executive summary.** The interview-craft domain is in strong shape: across all 16 subtopics the writing is consistently intuition-first (mean clarity **4.94/5**), interview-depth is high (mean depth **4.38/5**), and every file was written to a genuine senior/staff bar with reasoned trade-offs, failure-mode lists, and follow-up-question sections. The weak dimension — and it is the same weakness almost everywhere — is **worked examples** (mean example **3.94/5**): files repeatedly teach a structure (STAR, ADR anatomy, equity math, WSJF, a code review) and show fragments or weak-vs-strong prose contrasts, but stop short of one *complete, traced, end-to-end* artifact a student can pattern-match against. No subtopic is rated **high** refine-priority; the split is **0 high / 8 medium / 8 low**. However, 7 of the 8 medium files carry at least one *high-severity* issue, and those cluster tightly around two things: (1) missing fully-worked examples (especially anything quantitative — equity dilution, availability math, a real code diff), and (2) a recurring set of factual claims that need web verification (Amazon's 16 LPs, other-company value statements, level mappings). Headline takeaway: this domain does not need rewriting — it needs a focused **worked-example pass** plus a short **fact-check pass**. 12 of 16 files flag `needs_web_verification=true`.

## Scorecard

Sorted high-priority first, then lowest (clarity + example + depth) first. No subtopic is rated high priority, so medium precedes low; within each band, lowest total score first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| design-docs-rfcs-and-adrs | 5 | 3 | 4 | medium | Excellent craft teaching, but lists ADR/design-doc structures without ever showing one complete filled-in artifact; skips the "who decides / escalation" layer. |
| hiring-manager-and-project-deep-dive | 5 | 3 | 4 | medium | Clear and senior-calibrated, but the drill-down dialogue, conflict story, and full resume walkthrough are all taught only in the abstract. |
| leveling-negotiation-and-reverse-questions | 5 | 3 | 4 | medium | Exceptionally clear on commercial craft, but equity sections (dilution, strike, back-loaded vesting) teach with prose where students most need numbers. |
| seniority-ladder-and-scope-signals | 5 | 3 | 4 | medium | Excellent intuition-first ladder teaching, but the harder senior→staff jump lacks the worked example the Senior section nails; missing scope-is-relative gotcha. |
| take-home-pairing-and-code-review-rounds | 5 | 3 | 4 | medium | Teaches "signal not artifact" beautifully, but no real diff/transcript to practice against; misses 2026 gotchas (AI-assistants, verbal review, remote logistics). |
| estimation-and-napkin-math | 4 | 5 | 4 | medium | Strong, example-rich cheat sheet, but no "why" behind Little's Law and an absent availability/nines subtopic senior interviewers routinely probe. |
| product-sense-startup-vs-faang | 5 | 4 | 4 | medium | Unusually clear strategy doc, but "option count is meaningless" is asserted without the math, and the growth-stage middle is under-taught. |
| company-values-and-leadership-principles | 5 | 4 | 5 | medium | Excellent senior-bar guide; main gaps are no single fully-labeled end-to-end STAR and a few high-frequency gotchas (failure stories, confidential metrics, story reuse). |
| handling-ambiguity | 5 | 4 | 4 | low | Strong intuition-first guide with vivid weak/strong scripts; minor gaps around working the risk-ranking matrix and modeling the follow-up answers. |
| behavioral-competency-bank | 5 | 4 | 5 | low | Polished senior-grade playbook; minor gaps around a fully-labeled STAR walkthrough and answer-delivery meta-gotchas. |
| behavioral-star-method | 5 | 5 | 4 | low | Exemplary intuition-first guide; only real gaps are a traced follow-up-probe dialogue and edge-case delivery scenarios. |
| engineering-strategy-and-prioritization | 5 | 4 | 5 | low | Exceptionally strong; only real gap is WSJF (and RICE's impact scale) stated as a formula but never walked through with numbers. |
| incident-leadership-behavioral | 5 | 4 | 5 | low | Polished senior-grade outage-story playbook; minor gaps (undefined SEV scale, one un-walked nuance, an LP count to verify). |
| staff-archetypes-and-impact | 5 | 4 | 5 | low | Exceptionally strong on the Staff+ mindset; main gap is the self-declared "most important story" (staff project) taught only as abstract anatomy. |
| tradeoff-articulation-and-judgment | 5 | 5 | 4 | low | Near-model doc; minor gaps (cost/availability quantification and a note on over-narration). |
| mentorship-and-cross-team-influence | 5 | 5 | 5 | low | Near-exemplary; only real issues are a research statistic to verify and a missing "managing up" probe. |

## Systemic issues

These themes recur across the domain; fixing them systematically (rather than file-by-file) is the highest-leverage work.

### 1. No fully-worked, end-to-end example — the dominant gap (≈13 of 16 files)
This single pattern explains almost the entire example-score shortfall. Files teach a structure and show *fragments* or weak-vs-strong *prose*, but never assemble one complete, traced artifact. Concretely:
- **Labeled STAR never shown assembled:** behavioral-competency-bank, company-values (no single S/T/A/R traced end-to-end for one LP), staff-archetypes (the "most important" staff-project story taught only as an abstract anatomy).
- **Traced multi-turn dialogue missing:** behavioral-star-method (the follow-up probe exchange), hiring-manager (the depth-spiral drill-down — its single most distinctive claim, never shown), take-home (a good think-aloud pairing transcript).
- **Filled artifact never shown:** design-docs (enumerates ADR/design-doc sections but shows no complete one-page ADR or mini design doc — HIGH), take-home (references "Line 42" review comments without ever showing the code diff — HIGH).
- **Missing conflict/staff worked story:** hiring-manager (no conflict story — HIGH), seniority-ladder (no Staff+ weak-vs-strong to parallel the Senior one — HIGH), staff-archetypes (no sponsorship STAR).

*Fix pattern:* pick each file's running persona/example and trace exactly one artifact all the way through, annotating which sentence maps to which beat/signal.

### 2. Quantitative concepts asserted but never computed (≈6 files, most of the HIGH-severity issues)
Where the content turns numeric, it tends to state the punchline without the arithmetic — precisely the "worked example" bar the domain sets for itself:
- **Equity/comp math:** leveling-negotiation (startup dilution + strike + liquidation preference; RSU-vs-option and Amazon's 5/15/40/40 back-loading — two HIGH issues), product-sense ("option count is meaningless" with zero numbers — HIGH), tradeoff (cost and availability named as axes but only latency is ever quantified).
- **Estimation math:** estimation (Little's Law stated as a formula with no intuition — HIGH; no availability/"nines" section at all — HIGH; powers-of-two rule cited but never taught), engineering-strategy (RICE fully worked but WSJF only a formula; RICE Impact scale unstated).

### 3. "When it goes sideways" delivery gotchas absent (≈5 files)
Files cover *what to say* but under-teach real-time failure/recovery in the room: blanking or being asked a competency you didn't prep (behavioral-competency-bank, behavioral-star-method, hiring-manager), interruptions / "tell me about *another* time" second-story requests (behavioral-star-method), how long an answer should run and the over-talking failure (behavioral-competency-bank), and the mirror gotcha — **over-narration** of trivial two-way-door decisions (tradeoff, and the over-processing/bikeshedding direction in design-docs).

### 4. Stale factual claims needing web verification (12 of 16 files flag it)
A recurring set of datable facts is stated as canonical:
- **Amazon's "16 Leadership Principles" (added 2021):** behavioral-star-method, company-values, incident-leadership, product-sense, seniority-ladder.
- **Other companies' values / mappings:** company-values (Netflix 2024 memo, Google "Googleyness", Meta values), seniority-ladder (Dropbox title structure, Google L5 / Meta E5, "Staff <10%"), leveling-negotiation & hiring-manager (levels.fyi data, US salary-history bans).
- **Cited research/scales:** mentorship (the 44%/48% glue-work statistic — attribute or soften), engineering-strategy (Intercom RICE Impact scale), handling-ambiguity (Bezos 2015 vs 2016 letter attribution).

### 5. Jargon used before it is defined (≈5 files)
Load-bearing terms introduced without first-use expansion: STAR spelled out only late/via cross-ref (company-values), the SEV severity scale used repeatedly but never explained (incident-leadership), one-way/two-way-door reversibility framing (design-docs), SLO/MTTR/p99 (engineering-strategy), and statistical significance / novelty effect / sample size (product-sense).

### 6. "What if I lack the story / scope is relative" reframe missing (≈4 files)
Guidance assumes the candidate already has a senior/staff-sized story: behavioral-competency-bank (limited-scope IC), incident-leadership (never led a big outage), staff-archetypes (no staff-scale project), and seniority-ladder (scope is relative to company size — a Staff title at a 50-person startup ≠ Staff at Google — HIGH). Companion gap: design-docs never names the decision owner / escalation path when consensus fails.

## High-priority subtopics

No subtopic is rated **high** refine-priority. The 7 medium-priority files below each carry at least one **high-severity** issue and should be treated as the top of the queue; each entry lists its most consequential issues and the concrete fix.

### hiring-manager-and-project-deep-dive (medium; 2 high-severity)
1. **[HIGH · example-gap]** The signature claim — owners get *more* precise as you drill, peripheral people run out of answers — is never shown as an actual multi-turn dialogue. *Fix:* add a 4–5 turn drill-down transcript on the checkout/pricing project (e.g. "why a 30s TTL not 5s?" → "what happens on a price change mid-TTL?" → "how did you detect the stampede?"), optionally contrasted with a peripheral candidate stalling.
2. **[HIGH · example-gap]** "Tell me about a conflict/disagreement" has no dedicated section and no worked story — only the slogan "disagree-and-commit." *Fix:* add a `## Handling conflict and disagreement` section with a worked answer (the disagreement, how voiced, the data that resolved it, the commit moment, the outcome) plus the gotcha: don't pick a conflict you "won" by authority.
3. **[MEDIUM]** The resume walkthrough gives a 4-part structure but never stitches it into one continuous ~2–3 min narrative. *Fix:* add one boxed ~150–200-word end-to-end sample using the payments-engineer persona.
4. **[MEDIUM]** No coaching on recovering a blank mid-drill, or the trap of coasting with a friendly/selling HM who is still scoring you.
5. **[LOW]** Verify/soften the "illegal in many US states" salary-history claim (scope to salary-history bans in specific jurisdictions).

### leveling-negotiation-and-reverse-questions (medium; 2 high-severity)
1. **[HIGH · example-gap]** "0.5% of a $1B company is NOT $5M" is asserted in prose but never traced. *Fix:* show the number shrinking step-by-step through dilution → liquidation preference → strike → tax.
2. **[HIGH · example-gap]** Options and Amazon's 5/15/40/40 back-loading are abstract. *Fix:* add two mini worked examples — options gain vs underwater ($2 strike at $10 vs $1.50), and a $600k grant paying $30k/$90k/$240k/$240k with the Year-1 sign-on filling the gap and the Year-5 cliff.
3. **[MEDIUM]** No fully traced negotiation showing the actual TC delta captured; add one (offer → counter → recruiter move → ~$80k/yr delta).
4. **[MEDIUM]** Missing leverage constraints from visa status (H-1B/GC timing) and sign-on clawbacks.
5. **[LOW]** Add ISO/NSO + AMT tax gotcha; add multi-offer timing/clustering strategy. `needs_web_verification` (levels.fyi data).

### seniority-ladder-and-scope-signals (medium; 2 high-severity)
1. **[HIGH · example-gap]** The senior→staff jump — named the hardest, career-defining line — is taught with bullets only; no weak-vs-strong worked story to parallel the Senior section. *Fix:* take one project and show the "great Senior-within-one-team" framing vs the "true cross-team strategy" framing.
2. **[HIGH · gotchas]** Scope is treated as absolute; never notes it is **relative to company size**. *Fix:* add a scope-relativity box — describe scope in concrete terms (N teams, N engineers, revenue/traffic) not titles, and research the target company's level mapping before claiming equivalence.
3. **[MEDIUM]** Amazon leveling / Bar Raiser appear only in References; add a "how leveling decisions actually get made" subsection (per-competency scoring, debrief, calibrator, borderline → lower level).
4. **[MEDIUM]** Extend the down-leveling subsection with concrete options when offered below target (ask for the missing signal, offer an extra panel, accept-and-grow vs re-interview).
5. **[LOW]** Verify Dropbox title structure, Google L5/Meta E5 mappings, the "Staff <10%" figure, and the Amazon LP count.

### estimation-and-napkin-math (medium; 2 high-severity)
1. **[HIGH · missing-intuition]** Little's Law (L = λ × W) is applied but never explained. *Fix:* add the restaurant analogy (30 diners/hr × 2 hr stay = 60 seated) before the formula — the top-weighted dimension failing on the most impressive tool on the page.
2. **[HIGH · gotchas]** No availability/"nines" coverage at all. *Fix:* add `## Availability and the nines` with a downtime table (99%/99.9%/99.99%/99.999%) and the serial-dependency multiplication gotcha.
3. **[MEDIUM]** Powers-of-two extrapolation rule (2^n ≈ 10^0.3n) cited in References but never taught; add "2^34 ≈ 16 billion" style worked conversion.
4. **[LOW]** Fix the garbled "~say 3-5x" peak-factor wording; reframe the muddled "DAU:MAU sticky ~0.1–0.5" row; add a bits/bytes trap example (1 Gbps ÷ 8 = 125 MB/s).

### design-docs-rfcs-and-adrs (medium; 1 high-severity)
1. **[HIGH · example-gap]** Both the ADR (Nygard) and 12-part design-doc sections enumerate the parts but never show one complete filled artifact. *Fix:* add one complete ~15-line ADR (all five sections, the running Postgres-vs-DynamoDB example) plus a filled TL;DR/BLUF block and a skeletal mini design doc.
2. **[MEDIUM]** The review section never answers "what if you can't reach consensus — who decides?" *Fix:* add a paragraph on the single-threaded owner / driver, consensus-seeking ≠ consensus-requiring, and the timeboxed escalation move.
3. **[MEDIUM]** "one-way / two-way door" is load-bearing but never defined on first use (line ~91). Define it once.
4. **[LOW]** Add the over-processing gotcha (bikeshedding, full RFC for a two-way door) so the judgment reads as bidirectional.

### take-home-pairing-and-code-review-rounds (medium; 1 high-severity)
1. **[HIGH · example-gap]** The code-review sections reference line numbers without ever showing code. *Fix:* add a 10–20 line snippet with a planted correctness bug, edge-case gap, security issue, and style nit, then a worked prioritized review (triage reasoning → 2–3 kind/specific/actionable comments, nit explicitly deprioritized).
2. **[MEDIUM]** No sample think-aloud transcript for pairing; add 4–6 annotated lines over a simple problem (clarify → plan → brute force → trade-off → test).
3. **[MEDIUM]** Missing 2026 gotcha: AI coding-assistant etiquette in take-homes/pairing (must be able to explain every line; follow stated policy; disclose if asked). Also: no-stated-time-box default (self-impose 3–4h) and the "is this take-home reasonable" red flag.
4. **[MEDIUM]** Code-review rounds are often delivered **verbally** (screen-share) and on remote shared tools (CoderPad/CodeSandbox); the file only models written comments. Add spoken-review structure and remote-logistics notes.

### product-sense-startup-vs-faang (medium; 1 high-severity)
1. **[HIGH · example-gap]** "Option count is meaningless" is hammered but never shown with math. *Fix:* add a 4–6 line worked example (10,000 options / $2 strike / 10M FD shares = 0.1%; at $200M exit ≈ $200k gross before dilution/preference; contrast 100M-share company = 0.01%).
2. **[MEDIUM]** The growth/scale-up middle of the spectrum — the most common real case — gets only one mermaid node. Add an "Anatomy of a growth-stage loop" subsection (what they borrow from FAANG vs keep scrappy, how to read which way they lean).
3. **[MEDIUM]** A/B testing drops "significance / novelty effect / sample size" with no intuition. Add one plain-language sentence + a tiny illustration (5.2% vs 5.0% on 200 users = noise; on 200,000 = likely real).
4. **[LOW]** Add the "can't tell the company type" hedge; verify the Amazon 16-LP claim.

*(company-values-and-leadership-principles is the 8th medium file but carries no high-severity issue — its top items are the missing fully-labeled end-to-end STAR for one LP, failure-story/confidential-metrics gotchas, cross-interviewer story-reuse in the panel debrief, and verifying the non-Amazon value frameworks.)*

## Refinement plan

**Recommended order of attack.** Because the same two levers (worked examples; a fact-check) dominate the whole domain, batch the work by *type* rather than marching file-by-file.

**Phase 1 — Quantitative worked examples (highest severity, most concentrated).** These are the HIGH-severity numeric gaps and share machinery (equity math appears twice):
1. leveling-negotiation — dilution/strike/preference + options + Amazon vesting-curve walkthroughs.
2. product-sense — the single equity-math example (can reuse Phase-1 leveling math).
3. estimation — Little's Law intuition + the new Availability/"nines" section + powers-of-two rule.
4. tradeoff — the cost and availability quantification examples (pairs with estimation's nines).
5. engineering-strategy — the WSJF worked example + RICE Impact scale.

**Phase 2 — Traced qualitative examples (labeled STAR / dialogue / filled artifact).**
6. hiring-manager — drill-down transcript + conflict section + stitched resume narrative.
7. seniority-ladder — Staff+ weak-vs-strong + scope-relativity box.
8. design-docs — complete filled ADR + mini design doc + decision-owner/escalation.
9. take-home — worked code-review diff + pairing transcript + AI-assistant/verbal-review/remote gotchas.
10. staff-archetypes — the end-to-end staff-project STAR + sponsorship STAR.
11. company-values — one fully-labeled end-to-end STAR + failure-story/confidential-metrics/panel-reuse gotchas.
12. behavioral-competency-bank, behavioral-star-method — labeled STAR walkthrough, traced probe dialogue, "when it goes sideways" delivery block.
13. handling-ambiguity, incident-leadership, mentorship, engineering-strategy — smaller worked additions (populated risk 2×2, mitigate-first mini-scenario, upward-influence exemplar, model follow-up answers).

**Phase 3 — Web-verification pass (do together in one sitting).** 12 of 16 files have `needs_web_verification=true`. Verify once and propagate:
- **Amazon Leadership Principles** count/date (16, added 2021) and named LPs — appears in **behavioral-star-method, company-values, incident-leadership, product-sense, seniority-ladder**.
- **Other-company frameworks** — Netflix 2024 culture memo, Google "Googleyness & Leadership", Meta values (**company-values**); Dropbox title structure, Google L5 / Meta E5, "Staff <10%" (**seniority-ladder**).
- **Comp/legal/data** — levels.fyi references and US salary-history bans (**leveling-negotiation, hiring-manager**).
- **Cited research/scales** — the 44%/48% glue-work statistic (Babcock/Recalde/Vesterlund/Weingart) in **mentorship**; Intercom RICE Impact scale in **engineering-strategy**; Bezos 2015-vs-2016 letter attribution in **handling-ambiguity**.
- Files **not** needing verification (skip in Phase 3): behavioral-competency-bank, design-docs, handling-ambiguity's non-citation content, take-home.

**Missing files:** 0 of 16 — all audit files were present and readable.
