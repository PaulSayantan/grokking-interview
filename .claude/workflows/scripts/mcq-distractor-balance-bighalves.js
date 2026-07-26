export const meta = {
  name: 'mcq-distractor-balance-bighalves',
  description: 'Finish the 4 large interview-craft files that stalled in the distractor-balance run (48-57 Qs each — a single agent could not edit ~50 questions inside the no-progress window). Split each file into HALVES by question-id range so each agent has ~24-29 edits, well within the timeout. Same safety contract: only distractor text is lengthened; correct option text, answer index, id, ref, question, explanation are never touched. After both halves of a file are done, one adversarial agent verifies the whole file (exactly one correct option per question, distractors still wrong). EDITS questions.yaml only.',
  phases: [
    { title: 'Balance halves', detail: 'one agent per file-half lengthens short distractors in its question-id range' },
    { title: 'Verify files', detail: 'one agent per file confirms no multi-correct / broken-answer questions' },
  ],
}

const REPO = '/path/to/interview-prep'

// Each entry: file + the two id ranges. (Half boundaries computed from the pool.)
const FILES = [
  { slug: 'behavioral-competency-bank', a: ['behavioral-competency-bank-001', 'behavioral-competency-bank-028'], b: ['behavioral-competency-bank-029', 'behavioral-competency-bank-057'] },
  { slug: 'design-docs-rfcs-and-adrs', a: ['design-docs-rfcs-and-adrs-001', 'design-docs-rfcs-and-adrs-024'], b: ['design-docs-rfcs-and-adrs-025', 'design-docs-rfcs-and-adrs-048'] },
  { slug: 'handling-ambiguity', a: ['handling-ambiguity-001', 'handling-ambiguity-024'], b: ['handling-ambiguity-025', 'handling-ambiguity-048'] },
  { slug: 'product-sense-startup-vs-faang', a: ['product-sense-startup-vs-faang-001', 'product-sense-startup-vs-faang-025'], b: ['product-sense-startup-vs-faang-026', 'product-sense-startup-vs-faang-050'] },
]

const CONTRACT =
`ABSOLUTE RULES (a violation corrupts the assessment):\n` +
`1. Edit ONLY the TEXT of the DISTRACTOR (wrong) options.\n` +
`2. NEVER change: the correct option's text, the "answer" index, "id", "ref", "question", ` +
`"explanation", "difficulty", "tags". Do not add/remove/reorder options.\n` +
`3. A lengthened distractor MUST stay UNAMBIGUOUSLY WRONG — add plausible specificity (a ` +
`concrete-but-incorrect mechanism, a real-sounding wrong value, a believable misconception); ` +
`never make it true or defensible. Target each distractor within ~±25% of the correct option's ` +
`length; do not overshoot past it.\n` +
`4. Keep valid YAML, 2-space indent, block style, and any "# correct" comment convention.`

const balanceHalf = (slug, range, label) => {
  const file = `${REPO}/topics/interview-craft/${slug}/questions.yaml`
  return agent(
    `You are an assessment-design expert fixing the "correct answer is always longest" giveaway in ONE MCQ file, ` +
    `but ONLY for the questions whose id is in the range ${range[0]} .. ${range[1]} (inclusive). Leave every ` +
    `question OUTSIDE that id range completely untouched.\n\n${CONTRACT}\n\n` +
    `STEP 1: Read ${file}. STEP 2: For each question in your id range, find the correct option (via "answer") and ` +
    `lengthen its conspicuously-short distractors into plausible, comparable-length, still-wrong alternatives using ` +
    `the Edit tool. Skip questions already balanced. STEP 3: self-verify each edited question — answer index still ` +
    `points at the original correct text, each distractor still clearly wrong, no two options now both correct, ` +
    `still valid YAML. \n` +
    `Return a one-line summary: how many questions in your range you edited.`,
    { label, phase: 'Balance halves', effort: 'high' }
  )
}

// Phase 1: 8 half-file agents (2 per file). Halves of the SAME file edit disjoint
// id ranges but the same file — run them SEQUENTIALLY per file to avoid concurrent
// writes to one questions.yaml; different files run in parallel.
phase('Balance halves')
await parallel(FILES.map((f) => async () => {
  await balanceHalf(f.slug, f.a, `balance:${f.slug}:A`)
  await balanceHalf(f.slug, f.b, `balance:${f.slug}:B`)
}))

// Phase 2: verify each whole file.
phase('Verify files')
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'verdict', 'multi_correct', 'now_wrong_correct', 'notes'],
  properties: {
    slug: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'needs-rework'] },
    multi_correct: { type: 'array', items: { type: 'string' } },
    now_wrong_correct: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
const verdicts = await parallel(FILES.map((f) => () => {
  const file = `${REPO}/topics/interview-craft/${f.slug}/questions.yaml`
  return agent(
    `Adversarially review ${file} after a distractor-lengthening pass. For EACH question: (1) is any option OTHER ` +
    `than the one at "answer" now also true/defensible? -> multi_correct. (2) does "answer" still point at a ` +
    `genuinely-correct option? if not -> now_wrong_correct. Do NOT edit. verdict=clean only if BOTH lists are empty. ` +
    `Return the verdict (slug MUST be "${f.slug}").`,
    { label: `verify:${f.slug}`, phase: 'Verify files', effort: 'high', schema: VERIFY_SCHEMA }
  )
}))

const bad = verdicts.filter(Boolean).filter((v) => v.verdict !== 'clean')
return { files: FILES.length, clean: verdicts.filter(Boolean).filter((v) => v.verdict === 'clean').length, needs_rework: bad }
