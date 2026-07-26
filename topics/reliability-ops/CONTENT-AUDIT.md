# reliability-ops — Content Audit

**Executive summary.** The reliability-ops domain is in excellent, near-publishable shape. Across all 16 subtopics the audit found **0 high-priority**, **4 medium-priority**, and **12 low-priority** files — every subtopic leads intuition-first, defines jargon on first use, and reaches genuine senior-to-staff interview depth (depth scored a perfect 5/5 in all 16). The single dominant, domain-wide weakness is against the repo's **#2 refinement priority (worked examples)**: nearly every file states at least one hard formula symbolically without a numbers-in/numbers-out walkthrough, and the four medium-priority files are medium precisely because that gap lands on a top-testable, high-frequency interview concept (MTTR/availability math, toil %, automation ROI, adaptive-concurrency and RCA quantitative tooling). Secondary systemic themes: 15 of 16 files carry precise factual figures flagged for web verification, several files place unreconciled/contradictory numbers back-to-back, and the longer files repeat sections. Headline takeaway: this is a **polish pass, not a rewrite** — bolt concrete numeric traces onto existing formulas, reconcile a handful of internal contradictions, verify figures, and trim duplication.

## Scorecard

Sorted: medium priority first, then lowest (clarity+example+depth) sum first.

| Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict |
|---|---|---|---|---|---|
| incident-response-and-command | 5 | 3 | 5 | medium | Exceptionally clear/deep on process, but the one quantitative concept (availability from MTBF/MTTR) is never worked with numbers. |
| root-cause-analysis-and-troubleshooting | 5 | 3 | 5 | medium | Deep, intuition-first RCA reference; every quantitative concept (Little's Law, availability, FTA) is abstract, plus a broken cross-reference to a nonexistent worked example. |
| circuit-breakers-and-bulkheads | 4 | 4 | 5 | medium | Excellent staff-level treatment whose main flaw is two directly contradictory decorator-ordering diagrams presented back-to-back without reconciliation. |
| toil-reduction-and-operational-excellence | 5 | 4 | 5 | medium | Senior-grade and comprehensive; the two most interview-relevant tools (measuring toil %, automation ROI) are formulas with no plugged-in walkthrough. |
| chaos-engineering-and-fault-injection | 4 | 5 | 5 | low | Senior, intuition-first, superb Little's Law worked example; only a confusing Knowns/Unknowns 2x2 and some redundancy hold it back. |
| blameless-postmortems-and-learning | 5 | 4 | 5 | low | Near-exemplary staff-level treatment; the heavy-tailed MTTR argument is asserted without a numeric illustration. |
| capacity-planning-and-load-management | 5 | 4 | 5 | low | Senior, math-dense; only the Universal Scalability Law section stays abstract while every peer section works its numbers. |
| cascading-failures-and-antipatterns | 5 | 4 | 5 | low | Near-exemplary; the XFetch formula and one error-% derivation are under-explained, and two recovery orderings look contradictory. |
| disaster-recovery-rpo-rto-strategies | 5 | 4 | 5 | low | Near-exemplary DR treatment; the pervasive "DR is a dollar negotiation" framing never gets one actual cost-of-downtime walkthrough. |
| graceful-degradation-and-fallbacks | 5 | 4 | 5 | low | Near-exemplary; constant-work, the (2/3)^N argument, and the fallback time budget are argued in prose without numbers. |
| load-shedding-and-backpressure | 5 | 4 | 5 | low | Near-exemplary; the "Numbers Worth Memorizing" formulas are the one section left purely symbolic. |
| on-call-escalation-and-runbooks | 5 | 4 | 5 | low | Exceptionally strong; one unreconciled time-cost figure (~6h vs ~4h) and a couple of missing numeric traces. |
| redundancy-failover-and-health-checks | 5 | 4 | 5 | low | Near-exemplary staff-level; add a downtime-per-year anchor, a tighter shuffle-sharding overlap example, gloss CRDTs. |
| reliability-fundamentals-and-availability-math | 5 | 4 | 5 | low | Near-exemplary; missing beta-factor numeric example, an inconsistent S3 figure (stated 3 ways), an unquantified quorum caveat. |
| retries-timeouts-and-backoff | 5 | 4 | 5 | low | Near-exemplary resilience deep-dive; two missing numeric traces (jitter variants, retry-budget token bucket). |
| slos-error-budgets-and-velocity-tradeoff | 5 | 5 | 5 | low | Staff-level with abundant worked numbers; only minor polish (one over-claim on low-traffic request-based SLOs, hand-wavy "happiness test," some redundancy). |

## Systemic issues

The value of this audit is in the cross-cutting patterns. Four recur across the domain.

### 1. Symbolic formulas without a numbers-in/numbers-out walkthrough (≈16/16 — the dominant theme)
This is the through-line of the entire domain and the root cause of all four medium ratings. Almost every file introduces at least one formula in symbols and stops there, against the repo's explicitly #2-weighted worked-examples bar. Representative instances:
- **incident-response**: `Availability = MTBF/(MTBF+MTTR)` never plugged in (high severity).
- **root-cause-analysis**: availability, Fault Tree Analysis probabilities/cut-sets, and Little's Law all stated abstractly (high severity).
- **toil-reduction**: the toil-% measurement formula and the automation-ROI rule both un-worked (two high-severity gaps).
- **circuit-breakers**: the Vegas adaptive-concurrency formula `queue = limit×(1 − minRTT/sampleRTT)` and the token-bucket both abstract.
- **capacity-planning**: Universal Scalability Law (α, β, N_max) is the *only* quantitative section with no numbers while every peer section works its math.
- **load-shedding**: the entire "Numbers Worth Memorizing" section (Netflix gradient, Google client throttle, jitter) is symbol-only.
- **retries-timeouts**: decorrelated jitter and the retry-budget token bucket un-traced.
- **reliability-fundamentals**: beta-factor common-cause model given only symbolically.
- **graceful-degradation**: constant-work sizing, the per-hop 1/3 → (2/3)^N derivation, and the fallback-chain time budget all prose-only.
- **cascading-failures**: XFetch probabilistic early-expiration formula and the "80% error" figure not derived.
- **disaster-recovery**: the "cost-vs-recovery negotiation" framing never shown as a dollars-in/dollars-out decision.
- **blameless-postmortems**: the heavy-tailed/lognormal MTTR argument asserted without a numeric illustration.
- **chaos-engineering** & **on-call-escalation**: the "how much budget/time can I afford" and escalation wall-clock traces are missing.

**Fix pattern:** for each, add a 2–4 line traced example with concrete inputs → output, ideally reusing a single running system per file (e.g., "the checkout service"). This one class of edit resolves the bulk of the domain's gap and directly moves every medium file toward low.

### 2. Precise factual figures flagged for web verification (15/16)
Every file except `graceful-degradation-and-fallbacks` has `needs_web_verification = true`. These are load-bearing specific numbers that drift or get misremembered and would undercut credibility if wrong. Clusters: AWS service specifics (FIS pricing/action IDs; Aurora/RDS replication lag & promotion times; DynamoDB 2015 ~55% error rate; S3 SLA), named incident figures (Knight Capital $440M/45min/7-of-8; CrowdStrike 8.5M; GitLab 2017; Google Music 2012; Meta BGP 2021; Belgium lightning strike; Cloudflare 2019), SRE/industry folklore (~3× MTTR from playbooks; Google comp ~5–6% of salary; PagerDuty 5-min ack default; "~70% of outages from changes"; "10× cost per nine"), and library defaults (AWS SDK 500/5/10 retry quota; gRPC/Envoy retry caps; BigTable hedging figures). **Fix:** a single dedicated verification pass over all flagged numbers.

### 3. Unreconciled or contradictory numbers presented back-to-back (7 subtopics)
Careful readers will hit an apparent contradiction on exactly the exam-critical point. Instances:
- **circuit-breakers** (high severity): two near-opposite decorator orderings (Bulkhead-outermost list vs. Resilience4j Retry-outermost/Bulkhead-innermost) with no reconciliation.
- **root-cause-analysis** (medium): a cross-reference points to a Little's Law worked example "in the golden-signals section above" that does not exist.
- **reliability-fundamentals** (medium): the S3 availability figure stated three inconsistent ways (99.99% / 99.9%–99.99% / ~99.9%), conflating SLA with design goal.
- **on-call-escalation**: "~6 hours per incident" vs "~4 hours per page" asserted without distinguishing them.
- **cascading-failures**: "add capacity last" vs an SRE playbook listing "increase resources" as step #1.
- **load-shedding**: retry amplification framed as "3³=27×" then "up to ~64×" side-by-side without stating the fan-out assumption.
- **incident-response**: severity taught twice (generic 5-level vs PagerDuty defs) reads as possible duplication/mismatch.

**Fix:** one bridging sentence each that names the two framings and why they differ.

### 4. Redundant / duplicated sections in long files (6 subtopics)
The "concept then deepen later" layering is often deliberate but unsignposted, padding already-long files: **chaos** (follow-ups restate inline callouts verbatim), **incident-response** (severity + mitigation taught twice), **load-shedding** (CoDel introduced twice; deadline propagation twice), **root-cause-analysis** (RED/USE/golden signals defined in two sections), **slos** (error-budget policy in three sections; burn-rate in two), **toil-reduction** (the "~33% not 0%" argument made three times). **Fix:** add a one-line "building on the section above…" signpost, or trim the second occurrence to a pointer.

*Minor cross-cutting theme (not counted above):* a handful of un-glossed acronyms/terms despite each file's otherwise-strict define-on-first-use discipline — `M/M/1`/Kendall notation (capacity), `CRDTs`/partitioned ownership (redundancy), `BGP`/catastrophic backtracking (rca), `RUM`/dark-launch (slos), "Console" (blameless) — and a few missing signature visuals (USL retrograde curve, goodput-vs-load cliff, bathtub hazard curve, and possible literal `\n` rendering in circuit-breaker mermaid labels).

## High-priority subtopics

No subtopic scored **high** priority — the domain has no file needing urgent rework. The four **medium**-priority files below are the effective top tier and should lead the refinement pass; each carries at least one high- or medium-severity issue on a top-testable concept.

### incident-response-and-command (medium)
1. **[high · example-gap] `## MTTR and the Time-to-X Breakdown`** — `Availability = MTBF/(MTBF+MTTR)` is stated but never worked; the "cutting MTTR is the cheaper lever" claim is asserted, not shown. **Fix:** MTBF=30d, MTTR=2h → 99.72%; halve MTTR → 99.86% vs double MTBF → 99.86%, side by side, noting halving MTTR is usually far cheaper.
2. **[medium · example-gap] MTTR-as-a-chain / incident lifecycle** — detect→ack→mitigate→resolve is repeated but never traced with timestamps. **Fix:** one wall-clock walkthrough (fault 02:00, alert 02:07/MTTD=7m, ack 02:09, mitigate 02:19, resolve 02:50) pointing out which slice dominates.
3. **[medium · redundancy] severity + mitigation taught twice** — add signpost pointers so the basic-vs-advanced layering reads as intentional.
4. **[low · example-gap] on-call ROI** — compute the buy-back (~20 incidents/qtr × ~6h = ~120 eng-hrs; 3× playbook reclaims ~80h/qtr).
5. **[low · correctness] verify** the Belgium/GKE/Chromecast/S3/Meta incident figures and the ~3×/~6h/~2-per-shift numbers.

### root-cause-analysis-and-troubleshooting (medium)
1. **[high · example-gap] MTT* / FTA / Little's Law** — the three most quantitative concepts all abstract. **Fix:** three mini-walkthroughs — availability (MTBF=30d, MTTR=6h vs 1h → 99.17% vs 99.86%), an FTA OR-gate with child probabilities → top-event probability + a size-1 cut set, and a Little's Law ρ=0.5/0.9/0.99 wait-multiplier trace.
2. **[medium · correctness] broken cross-reference** — text says Little's Law "is worked in the golden-signals section above," but that section never works it. **Fix:** add the worked mini-example there, or remove the dangling clause.
3. **[low · redundancy] RED/USE/golden signals defined twice** — trim the second section to just the decision rule and cross-link.
4. **[low · jargon]** gloss "catastrophic backtracking" and expand "BGP" on first use.

### circuit-breakers-and-bulkheads (medium)
1. **[high · correctness] `## Combining Breaker, Bulkhead, and Timeout`** — the numbered list (Bulkhead outermost → … → Retry #4) and the WARNING below (Resilience4j: Retry outermost → … → Bulkhead innermost) are near-opposite orderings with no reconciliation, on a point interviewers probe. **Fix:** state one is a conceptual "layers of defense" framing and the other the actual R4j aspect nesting, and explain *why* they differ (bulkhead innermost only consumes a slot for calls the breaker already admitted).
2. **[medium · example-gap] `## Adaptive Concurrency Limits`** — the Vegas formula and α/β thresholds dropped abstractly. **Fix:** trace limit=40, minRTT=50ms, sampleRTT=60ms → queue≈6.7 > β → decrement; then a healthy sample → increment.
3. **[low · example-gap]** AWS retry token bucket described only qualitatively — add a capacity-100/cost-5/refill-1 trace.
4. **[low · clarity]** HALF-OPEN decision rule stated two ways (single failure vs rate over trials) — reconcile to the rate-based reality.
5. **[low · visual]** verify mermaid labels don't render literal `\n`.

### toil-reduction-and-operational-excellence (medium)
1. **[high · example-gap] `## Measuring & Tracking Toil`** — the toil-% formula is fully abstract on a high-frequency probe. **Fix:** 6-person team @ 240 eng-hrs/wk; 25 pages×20m + 30 tickets×30m + 2 releases×2h = 27.3h → ~11% aggregate but ~66% of the on-call engineer's week (show the aggregate-vs-per-person contrast).
2. **[high · example-gap] `## When NOT to Automate`** — automation-ROI rule never worked. **Fix:** 15m task × 40/wk × 104 wk ≈ 1,040h saved vs ~184h build+maintain → automate, ~7-week payback; then flip it (once/quarter task → runbook).
3. **[medium · redundancy]** "~33% not 0%" argued in three places — merge into one section, keep the distinct "a little toil is calming" idea once.
4. **[low · missing-intuition]** dependency-availability section — add why availabilities multiply (all must be up simultaneously = AND of independent probabilities).
5. **[low · gotchas]** acknowledge the 50% cap is routinely violated in practice and how a senior handles the gap.

## Refinement plan

**Recommended order of attack** (highest leverage first):

1. **Pass A — kill the contradictions (fast, high credibility payoff).** Fix the three internal-consistency defects that actively teach the wrong thing: circuit-breakers decorator ordering (high), root-cause-analysis broken cross-reference (medium), reliability-fundamentals S3 figure stated three ways (medium). Also fold in the softer reconciliations (on-call 6h/4h, cascading recovery ordering, load-shedding 27×/64×, incident-response severity duplication).

2. **Pass B — the four medium files' worked examples.** Add the high-severity numeric walkthroughs to incident-response (MTTR/availability), root-cause-analysis (availability + FTA + Little's Law), toil-reduction (toil % + automation ROI), and circuit-breakers (adaptive concurrency). This is the single edit that moves all four from medium → low.

3. **Pass C — domain-wide worked-example sweep (low files).** Apply the same numbers-in/numbers-out treatment to the remaining symbolic formulas: capacity-planning (USL), load-shedding ("Numbers Worth Memorizing"), retries-timeouts (jitter + token bucket), reliability-fundamentals (beta-factor), graceful-degradation ((2/3)^N + constant work + fallback budget), cascading-failures (XFetch + 80% derivation), disaster-recovery (cost-of-downtime), blameless (heavy-tailed MTTR), chaos & on-call (budget/escalation traces).

4. **Pass D — polish.** Trim redundant sections with signpost pointers (chaos, incident, load-shedding, rca, slos, toil); gloss the stray acronyms (M/M/1, CRDTs, BGP, RUM, dark-launch, "Console"); add the missing signature visuals (USL retrograde curve, goodput-vs-load cliff, bathtub hazard curve, downtime-per-year anchor); fix slos over-claim and "happiness test."

5. **Pass E — web verification (do last, batch it).** **15 of 16 files have `needs_web_verification = true`** — every subtopic except `graceful-degradation-and-fallbacks`. Verify the figures clustered in Systemic Issue #2 (AWS service specifics, incident figures, SRE/industry folklore, library defaults) against primary sources and correct any drift. Because this touches nearly the whole domain, run it as one consolidated fact-check rather than per-file.

**Files missing/unreadable:** 0 of 16 (all audit files read successfully).
