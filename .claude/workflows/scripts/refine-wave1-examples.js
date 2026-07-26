export const meta = {
  name: 'refine-wave1-examples',
  description: 'WAVE 1 of corpus refinement: the worked-examples + intuition pass over the worst example-gap files (example_score <= 3) in the 5 highest-need domains (devops-cicd, dsa-coding, spring-boot, lld-and-ood, system-design). Cache-backed and idempotent: each file writes a done-marker after self-verification and is skipped on re-runs, so outage retries are additive. One agent per file (distinct files -> safe parallel in-place edits) ADDS concrete numbers-in/numbers-out worked examples for each hard concept (plus intuition-first openers, reasoned trade-offs, and a gotchas/follow-ups turn where the audit flagged them), following the repo refining-content standard. A second adversarial agent per file RECOMPUTES every new worked example to confirm it yields the stated answer and checks for regressions (new wrong claims, broken anchors, contradictions). EDITS concepts.md; never renames headings or touches questions.yaml.',
  phases: [
    { title: 'Refine', detail: 'one agent per file adds worked examples + intuition/trade-off/gotchas per its audit findings, writes a done-marker' },
    { title: 'Verify', detail: 'one adversarial agent per file recomputes every new example and checks for regressions/broken anchors' },
  ],
}

const REPO = '/path/to/interview-prep'
const AUDIT_CACHE = '/Users/dev/.claude/projects/<this-repo-project-dir>/audit-cache'
const REFINE_CACHE = '/Users/dev/.claude/projects/<this-repo-project-dir>/refine-cache/wave1'

// args = ["domain/slug", ...] — array or JSON string.
let KEYS = null
if (Array.isArray(args)) KEYS = args
else if (typeof args === 'string' && args.trim()) {
  try { const p = JSON.parse(args); if (Array.isArray(p)) KEYS = p } catch (e) {}
  if (!KEYS) KEYS = args.split(/[\s,]+/).filter(Boolean)
}
if (!KEYS || KEYS.length === 0) throw new Error('args must be a non-empty array of "domain/slug" keys')

const WORK = KEYS.map((k) => {
  const i = k.indexOf('/')
  return { key: k, dom: k.slice(0, i), slug: k.slice(i + 1) }
})
log(`Wave 1 worked-examples refine: ${WORK.length} files; done-markers in ${REFINE_CACHE}`)

const STANDARD = `
THE REFINEMENT STANDARD (repo refining-content skill) — apply the parts your audit findings call for, in this
priority order. This wave's PRIMARY job is #2 (worked examples); do #1/#3/#4 only where the findings flag them.

1. INTUITION-FIRST OPENER: if a hard section opens with a definition/formula/code, add ONE short plain-language
   paragraph above it — the mental model / analogy / "why this exists, what breaks without it".
2. A WORKED EXAMPLE PER HARD CONCEPT (the main deliverable): for each genuinely hard idea the audit flags, add a
   CONCRETE numbers-in -> numbers-out (or bytes-in->bytes-out, or step-by-step interleaving) trace. Plug in real
   inputs, SHOW the intermediate state, produce the output. A code TEMPLATE or a prose restatement does NOT count.
   Examples of what "concrete" means: trace base62(125) digit by digit to "21"; walk a HashMap put with a real key
   through hash->index->collision->resize; compute a DORA change-fail-rate / error budget from real counts; trace a
   saga's compensating steps on a specific failure; interleave two threads to expose the race and then show the lock
   fixing it; do the capacity math with real QPS/GB numbers. VERIFY every number yourself — the arithmetic must be
   correct and must actually produce the answer you write.
3. REASONED TRADE-OFFS: where trade-offs are bare bullets, add the reasoning — "gain X, give up Y, pick when Z".
4. GOTCHAS / FOLLOW-UPS: where the audit flags a missing senior turn, add the edge cases / failure modes / the
   follow-up question an interviewer asks. Prefer a short "## Common follow-ups" / "## Gotchas" section or a
   > [!INTERVIEW] callout.

RULES: Edits are ADDITIVE and SURGICAL — preserve the author's voice and structure. Do NOT rename or delete any
"## " heading (MCQs anchor to them). You may ADD new "## "/"### " sections. Do not pad or bloat — one good worked
example per genuinely hard concept beats five shallow ones. Callouts: only > [!TIP] / [!WARNING] / [!INTERVIEW] /
[!KEY-TAKEAWAY], marker alone on the blockquote's first line, 1-3 per file. Use mermaid ONLY where a concept is
inherently spatial/sequential. Do NOT web-search in this wave unless you must confirm one number a worked example
depends on (correctness/fact-drift was handled in Wave 0).
`

const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'status', 'examples_added', 'other_additions', 'summary'],
  properties: {
    key: { type: 'string' },
    status: { type: 'string', enum: ['refined', 'already-cached', 'no-change-needed', 'blocked'], description: 'refined=edited; already-cached=marker present, skipped; no-change-needed=re-read and it already had adequate worked examples for its hard concepts; blocked=could not safely edit' },
    examples_added: { type: 'array', items: { type: 'string' }, description: 'one line per WORKED example added: "<concept> — <inputs> -> <traced output>" (empty if none)' },
    other_additions: { type: 'array', items: { type: 'string' }, description: 'intuition openers / trade-off reasoning / gotchas sections added (brief; empty if none)' },
    summary: { type: 'string', description: 'one-sentence summary of the change (or why no change / blocked)' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'verdict', 'miscomputed_examples', 'regressions', 'notes'],
  properties: {
    key: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'needs-rework'], description: 'clean=every new worked example computes correctly AND no regression; needs-rework=otherwise' },
    miscomputed_examples: { type: 'array', items: { type: 'string' }, description: 'new worked examples whose arithmetic/trace does NOT yield the stated answer (empty if all correct) — state the right value' },
    regressions: { type: 'array', items: { type: 'string' }, description: 'NEW problems the refine introduced: wrong new claim, renamed/removed "## " heading, internal contradiction, broken ref anchor (empty if none)' },
    notes: { type: 'string', description: 'one-sentence overall assessment' },
  },
}

const REFINE_PROTOCOL = (w) => {
  const auditPath = `${AUDIT_CACHE}/${w.dom}__${w.slug}.json`
  const conceptsPath = `${REPO}/topics/${w.dom}/${w.slug}/concepts.md`
  const marker = `${REFINE_CACHE}/${w.dom}__${w.slug}.json`
  return (
`You are a Senior Principal Engineer and a gifted, enthusiastic teacher refining ONE interview-study file so a ` +
`motivated student finishes it with ZERO doubt. This wave's focus: add the missing CONCRETE WORKED EXAMPLES (and, ` +
`where flagged, intuition openers / trade-off reasoning / a gotchas turn).\n\n${STANDARD}\n\n` +

`IDEMPOTENCY (do this first): Use Read on the done-marker ${marker}. If it EXISTS and parses as JSON with status ` +
`"refined"/"no-change-needed", you are DONE — return it verbatim with status "already-cached"; edit nothing. If it ` +
`does NOT exist, do the work below, then Write your final result object as JSON to ${marker}, then return it.\n\n` +

`STEP 1 — load findings: Read ${auditPath}. Focus on issues[] of type "example-gap" (primary), plus ` +
`"missing-intuition", "depth", "gotchas-followups" where present. Each has where/detail/fix — the "fix" often names ` +
`the exact example to add. Use example_score as a signal of how much is missing (2 = almost no concrete examples).\n\n` +

`STEP 2 — read the content: Read ${conceptsPath} IN FULL. Understand the author's voice and structure before editing.\n\n` +

`STEP 3 — add the worked examples (and flagged intuition/trade-off/gotchas) with the Edit tool. For EACH hard concept ` +
`the audit flags, insert a concrete traced example near where the concept is explained. Compute every number yourself ` +
`and show the intermediate steps. Keep it tight and in the author's voice.\n\n` +

`STEP 4 — self-verify BEFORE writing the marker: re-read each example you added and RECOMPUTE it — does the trace ` +
`actually produce the answer you wrote? Did you introduce any wrong claim? Did you keep every "## " heading intact? ` +
`Does each addition fit its surroundings without contradiction? Fix anything that fails.\n\n` +

`If the file already has adequate concrete worked examples for its hard concepts, do NOT pad it — set status ` +
`"no-change-needed" and say so. Quality over volume.\n\n` +

`Return the structured object (key MUST be "${w.key}") and Write it to the marker path.`
  )
}

const results = await pipeline(
  WORK,
  (w) => agent(REFINE_PROTOCOL(w), { label: `refine:${w.key}`, phase: 'Refine', effort: 'high', schema: REFINE_SCHEMA }),
  (refineResult, w) => {
    const conceptsPath = `${REPO}/topics/${w.dom}/${w.slug}/concepts.md`
    const auditPath = `${AUDIT_CACHE}/${w.dom}__${w.slug}.json`
    return agent(
      `You are an adversarial technical reviewer. A refinement pass just added WORKED EXAMPLES (and possibly intuition/` +
      `trade-off/gotchas content) to ONE interview-study file. Your #1 job: RECOMPUTE every new worked example and catch ` +
      `any whose numbers/trace do NOT actually produce the stated answer. Your #2 job: catch regressions.\n\n` +
      `1. The refine pass reported adding these examples: ${JSON.stringify(refineResult?.examples_added || [])} and ` +
      `these other additions: ${JSON.stringify(refineResult?.other_additions || [])} (status: ${refineResult?.status}).\n` +
      `2. Read the CURRENT file: ${conceptsPath}. (Optional context: original audit ${auditPath}.)\n` +
      `3. For EACH worked example in the changed areas, independently redo the arithmetic/trace from its stated inputs. ` +
      `If the result differs from what the file claims, list it with the CORRECT value. Be exact (e.g. verify base62, ` +
      `capacity math, error-budget %, hash/index computations, thread interleavings).\n` +
      `4. Scan the additions for REGRESSIONS: a new factually-wrong claim, a renamed/removed "## " heading, a new ` +
      `internal contradiction, or a broken concepts.md#anchor reference.\n` +
      `Be skeptical and specific. Do NOT edit the file — only report. Return the structured verdict (key MUST be "${w.key}").`,
      { label: `verify:${w.key}`, phase: 'Verify', effort: 'medium', schema: VERIFY_SCHEMA }
    ).then((v) => ({ refine: refineResult, verify: v, key: w.key }))
  }
)

const ok = results.filter(Boolean)
const clean = ok.filter((r) => r.verify?.verdict === 'clean')
const rework = ok.filter((r) => r.verify?.verdict === 'needs-rework')
const noChange = ok.filter((r) => r.refine?.status === 'no-change-needed')
const blocked = ok.filter((r) => r.refine?.status === 'blocked')
const totalExamples = ok.reduce((s, r) => s + (r.refine?.examples_added?.length || 0), 0)

log(`Wave 1 done: ${clean.length} clean, ${rework.length} need-rework, ${noChange.length} no-change, ${blocked.length} blocked; ${totalExamples} worked examples added`)

return {
  total: WORK.length,
  processed: ok.length,
  clean: clean.length,
  worked_examples_added: totalExamples,
  needs_rework: rework.map((r) => ({ key: r.key, miscomputed: r.verify?.miscomputed_examples, regressions: r.verify?.regressions })),
  no_change_needed: noChange.map((r) => r.key),
  blocked: blocked.map((r) => ({ key: r.key, why: r.refine?.summary })),
}
