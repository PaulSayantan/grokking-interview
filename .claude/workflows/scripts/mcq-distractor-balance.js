export const meta = {
  name: 'mcq-distractor-balance',
  description: 'Fix the distractor-length giveaway in MCQ pools: the correct option is the uniquely-longest ~87% of the time (median 52 chars longer), so a test-wise learner can beat the bank without knowing the material. One agent per questions.yaml file LENGTHENS the short distractors into fuller, plausible, comparable-length wrong answers — NEVER editing the correct option text, the answer index, id, ref, question, or explanation. A second agent adversarially verifies exactly ONE option is still correct and the distractors are still wrong-for-a-reason. Cache-backed + idempotent (per-file done-marker). Structural validation + an objective before/after length-bias re-measure gate every file. EDITS questions.yaml only.',
  phases: [
    { title: 'Balance', detail: 'one agent per file lengthens short distractors to comparable length; writes a done-marker' },
    { title: 'Verify', detail: 'one agent per file confirms exactly one correct option remains and distractors stay wrong' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const CACHE = '/tmp/interview-prep-cache/refine-cache/distractor'

let KEYS = null
if (Array.isArray(args)) KEYS = args
else if (typeof args === 'string' && args.trim()) {
  try { const p = JSON.parse(args); if (Array.isArray(p)) KEYS = p } catch (e) {}
  if (!KEYS) KEYS = args.split(/[\s,]+/).filter(Boolean)
}
if (!KEYS || KEYS.length === 0) throw new Error('args must be a non-empty array of "domain/slug" keys')

const WORK = KEYS.map((k) => { const i = k.indexOf('/'); return { key: k, dom: k.slice(0, i), slug: k.slice(i + 1) } })
log(`Distractor-balance: ${WORK.length} question files; markers in ${CACHE}`)

const BAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['key', 'status', 'questions_edited', 'summary'],
  properties: {
    key: { type: 'string' },
    status: { type: 'string', enum: ['balanced', 'already-cached', 'no-change-needed', 'blocked'] },
    questions_edited: { type: 'integer', description: 'how many questions had distractors lengthened' },
    summary: { type: 'string', description: 'one sentence; if blocked, why' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['key', 'verdict', 'multi_correct', 'now_wrong_correct', 'still_biased', 'notes'],
  properties: {
    key: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'needs-rework'] },
    multi_correct: { type: 'array', items: { type: 'string' }, description: 'question ids where a lengthened distractor is now ALSO correct/defensible (must be empty)' },
    now_wrong_correct: { type: 'array', items: { type: 'string' }, description: 'question ids where the answer index no longer points at the correct option (must be empty)' },
    still_biased: { type: 'array', items: { type: 'string' }, description: 'question ids where the correct option is still conspicuously the longest by a large margin' },
    notes: { type: 'string' },
  },
}

const BALANCE_PROTOCOL = (w) => {
  const file = `${REPO}/topics/${w.dom}/${w.slug}/questions.yaml`
  const marker = `${CACHE}/${w.dom}__${w.slug}.json`
  return (
`You are a Senior Principal Engineer and assessment-design expert fixing a TEST-INTEGRITY flaw in one MCQ file: ` +
`the correct answer is almost always the LONGEST option, so a savvy test-taker can pick it without knowing the ` +
`material. Your job: make option lengths comparable by LENGTHENING the short distractors into fuller, plausible, ` +
`specific wrong answers — so length no longer signals correctness.\n\n` +

`ABSOLUTE RULES (a violation corrupts the assessment — follow exactly):\n` +
`1. You may ONLY edit the TEXT of the DISTRACTOR options (the wrong ones). \n` +
`2. NEVER change: the correct option's text, the "answer" index value, "id", "ref", "question", "explanation", ` +
`"difficulty", "tags", or ANY other field. Do not add or remove options (keep the same count). Do not reorder options ` +
`(the answer index must keep pointing at the same correct text).\n` +
`3. A lengthened distractor MUST remain UNAMBIGUOUSLY WRONG for the reason the question tests. Do NOT make it true, ` +
`half-true, or defensible. Add specificity/plausibility (concrete-but-incorrect mechanism, a real-sounding wrong ` +
`value, a plausible misconception) — the kind of wrong answer a knowledgeable distractor-writer produces. Aim for ` +
`each distractor to land within roughly ±25% of the correct option's length; do not overshoot past it.\n` +
`4. Preserve YAML structure and the block style exactly (2-space indent, the "- " list items, the "# correct" ` +
`comment convention if present). Keep it valid YAML.\n\n` +

`IDEMPOTENCY: Read the marker ${marker}. If it EXISTS with status "balanced"/"no-change-needed", return it verbatim ` +
`with status "already-cached"; edit nothing. Else do the work, Write the result JSON to ${marker}, return it.\n\n` +

`STEP 1: Read ${file} in full. For each question, identify the correct option (via the "answer" index) and which ` +
`distractors are conspicuously shorter than it.\n` +
`STEP 2: Rewrite ONLY those short distractors with the Edit tool, lengthening them to comparable, plausible, ` +
`still-wrong alternatives. Leave already-comparable distractors alone. If a question is already balanced, skip it.\n` +
`STEP 3: Self-verify before writing the marker: for every question you touched, re-confirm (a) the answer index ` +
`still points at the original correct text, (b) each edited distractor is still clearly wrong, (c) no two options ` +
`are now both correct, (d) the file is still valid YAML with unchanged non-distractor fields. Fix any violation.\n\n` +
`Return the object (key MUST be "${w.key}").`
  )
}

const results = await pipeline(
  WORK,
  (w) => agent(BALANCE_PROTOCOL(w), { label: `balance:${w.key}`, phase: 'Balance', effort: 'high', schema: BAL_SCHEMA }),
  (bal, w) => {
    const file = `${REPO}/topics/${w.dom}/${w.slug}/questions.yaml`
    return agent(
      `You are an adversarial assessment reviewer. A pass just lengthened DISTRACTOR options in one MCQ file to remove ` +
      `a "correct answer is longest" giveaway. Catch any way it BROKE a question.\n\n` +
      `Read ${file}. For EACH question:\n` +
      `1. MULTIPLE CORRECT: is any option OTHER than the one at the "answer" index now also true / correct / ` +
      `defensible after the rewrite? If so, list the question id in multi_correct (this is the worst failure).\n` +
      `2. WRONG CORRECT: does the option at the "answer" index still hold the genuinely-correct text (unchanged) and ` +
      `is it still correct? If the answer index no longer points at a correct option, list the id in now_wrong_correct.\n` +
      `3. RESIDUAL BIAS: is the correct option STILL conspicuously the longest by a wide margin? List id in still_biased.\n` +
      `The balance pass reported: ${JSON.stringify({ status: bal?.status, edited: bal?.questions_edited, summary: bal?.summary })}. ` +
      `Do NOT edit the file. verdict=clean only if multi_correct AND now_wrong_correct are BOTH empty. Return the verdict (key MUST be "${w.key}").`,
      { label: `verify:${w.key}`, phase: 'Verify', effort: 'high', schema: VERIFY_SCHEMA }
    ).then((v) => ({ balance: bal, verify: v, key: w.key }))
  }
)

const ok = results.filter(Boolean)
const clean = ok.filter((r) => r.verify?.verdict === 'clean')
const rework = ok.filter((r) => r.verify?.verdict === 'needs-rework')
const totalEdited = ok.reduce((s, r) => s + (r.balance?.questions_edited || 0), 0)
log(`Distractor-balance done: ${clean.length} clean, ${rework.length} need-rework; ${totalEdited} questions edited`)

return {
  total: WORK.length, processed: ok.length, clean: clean.length, questions_edited: totalEdited,
  needs_rework: rework.map((r) => ({ key: r.key, multi_correct: r.verify?.multi_correct, now_wrong_correct: r.verify?.now_wrong_correct, still_biased: r.verify?.still_biased })),
}
