export const meta = {
  name: 'refine-wave0-correctness',
  description: 'WAVE 0 of corpus refinement: fix the confirmed correctness bugs found by the audit (the ~94 concepts.md files with high/medium-severity correctness issues). Cache-backed and idempotent: each file writes a done-marker after its edit passes self-verification and is skipped on re-runs, so retries after an API/network outage are strictly additive. One agent per file (distinct files → safe parallel in-place edits). Each agent reads its own audit finding + concepts.md, classifies each bug as pure-logic (reason it out) vs fact-drift (web-verify before changing the number), applies SURGICAL edits, and self-verifies. A second adversarial stage per file confirms the fix is correct and introduced no regression. EDITS concepts.md; never touches questions.yaml or renames headings.',
  phases: [
    { title: 'Refine', detail: 'one agent per file fixes its confirmed correctness bugs (web-verify fact-drift), writes a done-marker' },
    { title: 'Verify', detail: 'one adversarial agent per file confirms each bug is truly fixed and no new bug/regression was introduced' },
  ],
}

const REPO = '/path/to/interview-prep'
const AUDIT_CACHE = '/Users/dev/.claude/projects/<this-repo-project-dir>/audit-cache'
const REFINE_CACHE = '/Users/dev/.claude/projects/<this-repo-project-dir>/refine-cache/wave0'

// args = ["domain/slug", ...] — may arrive as array or JSON string.
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
log(`Wave 0 correctness refine: ${WORK.length} files; done-markers in ${REFINE_CACHE}`)

const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'status', 'bugs_fixed', 'web_verified', 'summary'],
  properties: {
    key: { type: 'string' },
    status: { type: 'string', enum: ['fixed', 'already-cached', 'no-change-needed', 'blocked'], description: 'fixed=edited; already-cached=marker present, skipped; no-change-needed=re-read and the flagged bug was not actually present/already correct; blocked=could not safely fix' },
    bugs_fixed: { type: 'array', items: { type: 'string' }, description: 'one short line per correctness bug actually fixed (what was wrong -> what it now says)' },
    web_verified: { type: 'array', items: { type: 'string' }, description: 'facts checked on the web this run, each with the confirmed value + source domain (empty if none)' },
    summary: { type: 'string', description: 'one-sentence summary of the change (or why no change / blocked)' },
  },
}

const REFINE_PROTOCOL = (w) => {
  const auditPath = `${AUDIT_CACHE}/${w.dom}__${w.slug}.json`
  const conceptsPath = `${REPO}/topics/${w.dom}/${w.slug}/concepts.md`
  const marker = `${REFINE_CACHE}/${w.dom}__${w.slug}.json`
  return (
`You are a Senior Principal Engineer and a meticulous technical editor refining ONE interview-study file to fix ` +
`CONFIRMED correctness bugs the audit found. Follow the repo's refining-content standard: fixes are SURGICAL and ` +
`additive — preserve the author's voice, structure, and every "## " heading (MCQs anchor to them; do NOT rename or ` +
`delete headings). You may add a sentence, fix a number, correct code, or add a short clarifying line.\n\n` +

`IDEMPOTENCY (do this first, deterministically):\n` +
`1. Use Read on the done-marker: ${marker}\n` +
`2. If it EXISTS and parses as JSON with status "fixed"/"no-change-needed", you are DONE — return that same object ` +
`verbatim with status set to "already-cached". Do NOT edit anything.\n` +
`3. If it does NOT exist, do the work below, then Write your final result object as JSON to ${marker}, then return it.\n\n` +

`STEP 1 — load the findings. Read ${auditPath} (JSON audit for this subtopic). From its issues[], take ONLY the ` +
`entries with type=="correctness" and severity in ("high","medium"). Those are your bugs to fix. (Ignore other issue ` +
`types this wave — later waves handle examples/jargon/structure.)\n\n` +

`STEP 2 — read the content. Read ${conceptsPath} IN FULL so your edits fit the surrounding text.\n\n` +

`STEP 3 — fix each bug, classifying it first:\n` +
` • PURE-LOGIC / SELF-CONSISTENCY bug (wrong arithmetic, illegal code, a skeleton that contradicts its own prose, ` +
`mismatched numbers across sections, an off-by-one): fix it by REASONING — no web needed. If a code sample is wrong, ` +
`fix the code AND the surrounding claim so they agree. VERIFY any arithmetic yourself (e.g. actually compute base62).\n` +
` • FACT-DRIFT bug (a version/limit/pricing/spec/statistic asserted from memory that may be stale or fabricated — ` +
`e.g. a made-up RFC number, a forward-dated GA version, a changed quota): WEB-VERIFY before changing the number. Use ` +
`WebSearch / WebFetch against AUTHORITATIVE primary sources (official docs, the RFC/IETF datatracker, release notes, ` +
`the vendor's own limits/pricing page — NOT SEO blogs). If you cannot confirm a precise value, soften to a correct ` +
`RANGE and describe the mechanism rather than assert a wrong precise number; never invent a citation. When you correct/` +
`confirm a fact, add or refresh a source in the file's References (or an inline link) so it is traceable.\n` +
`Apply fixes with the Edit tool (surgical string replacements).\n\n` +

`STEP 4 — self-verify BEFORE writing the marker. Re-read your edited regions adversarially: (a) did I introduce a NEW ` +
`wrong statement? (b) does any worked example/number I touched actually compute to the value I wrote? (c) did I keep ` +
`every "## " heading intact (so questions.yaml refs still resolve)? (d) do my edits now agree with the rest of the ` +
`file? Fix anything that fails.\n\n` +

`NOTE: if, on reading the file, a flagged "bug" is NOT actually present or is already correct, do NOT force a change — ` +
`set status "no-change-needed" and explain in summary. Honesty over edits.\n\n` +

`Return the structured object (key MUST be "${w.key}") and remember to Write it to the marker path when you made a ` +
`determination (fixed / no-change-needed / blocked).`
  )
}

// ---- Phase 1 + 2 pipelined per file: refine, then adversarially verify (no barrier) ----
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'verdict', 'still_wrong', 'regressions', 'notes'],
  properties: {
    key: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'needs-rework'], description: 'clean=all flagged bugs fixed correctly AND no new bug/regression; needs-rework=otherwise' },
    still_wrong: { type: 'array', items: { type: 'string' }, description: 'flagged correctness bugs that are STILL wrong after the refine (empty if all fixed)' },
    regressions: { type: 'array', items: { type: 'string' }, description: 'NEW problems the refine introduced: wrong new claim, miscomputed example, renamed/removed heading, contradiction (empty if none)' },
    notes: { type: 'string', description: 'one-sentence overall assessment' },
  },
}

const results = await pipeline(
  WORK,
  // stage 1: refine
  (w) => agent(REFINE_PROTOCOL(w), { label: `refine:${w.key}`, phase: 'Refine', effort: 'high', schema: REFINE_SCHEMA }),
  // stage 2: adversarial verify (runs as soon as this file's refine finishes)
  (refineResult, w) => {
    const auditPath = `${AUDIT_CACHE}/${w.dom}__${w.slug}.json`
    const conceptsPath = `${REPO}/topics/${w.dom}/${w.slug}/concepts.md`
    return agent(
      `You are an adversarial technical reviewer. A refinement pass just edited ONE interview-study file to fix ` +
      `confirmed correctness bugs. Your job is to CATCH any bug it missed or any NEW problem it introduced.\n\n` +
      `1. Read the original audit findings: ${auditPath} — focus on the type=="correctness", severity high/medium issues.\n` +
      `2. Read the CURRENT file: ${conceptsPath} (post-edit).\n` +
      `3. For EACH flagged correctness bug: is it now actually correct in the file? Verify arithmetic/logic yourself; ` +
      `for a fact-drift claim, sanity-check plausibility (you may WebSearch/WebFetch a primary source if a specific ` +
      `number looks off). List any that are STILL wrong.\n` +
      `4. Independently scan the edited areas for REGRESSIONS the refine may have added: a new wrong claim, a worked ` +
      `example that does not compute, a renamed/removed "## " heading, or a new internal contradiction.\n` +
      `Be skeptical and specific. Do NOT edit the file — only report. The refine pass reported: ` +
      `${JSON.stringify({ status: refineResult?.status, bugs_fixed: refineResult?.bugs_fixed, summary: refineResult?.summary })}.\n` +
      `Return the structured verdict (key MUST be "${w.key}").`,
      { label: `verify:${w.key}`, phase: 'Verify', effort: 'medium', schema: VERIFY_SCHEMA }
    ).then((v) => ({ refine: refineResult, verify: v, key: w.key }))
  }
)

// ---- Aggregate ----
const ok = results.filter(Boolean)
const clean = ok.filter((r) => r.verify?.verdict === 'clean')
const rework = ok.filter((r) => r.verify?.verdict === 'needs-rework')
const blocked = ok.filter((r) => r.refine?.status === 'blocked')
const noChange = ok.filter((r) => r.refine?.status === 'no-change-needed')

log(`Wave 0 done: ${clean.length} clean, ${rework.length} need-rework, ${noChange.length} no-change-needed, ${blocked.length} blocked`)

return {
  total: WORK.length,
  processed: ok.length,
  clean: clean.length,
  needs_rework: rework.map((r) => ({ key: r.key, still_wrong: r.verify?.still_wrong, regressions: r.verify?.regressions })),
  no_change_needed: noChange.map((r) => r.key),
  blocked: blocked.map((r) => ({ key: r.key, why: r.refine?.summary })),
}
