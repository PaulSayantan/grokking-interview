export const meta = {
  name: 'eng-blog-balance-fix',
  description: 'Rebalance MCQ distractor lengths in the case-study topics where the correct answer is systematically the longest option (a length giveaway). One agent per file: trim/extend ONLY distractor text so option lengths are mixed and the correct answer lands mid-pack across the 10 questions. Never touches correct-option text, answer index, question, explanation, or facts. Verifies by recomputing lengths.',
  phases: [{ title: 'Balance', detail: 'one agent per flagged file mixes distractor lengths' }],
}
// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const SLUGS = Array.isArray(args) ? args : (typeof args === 'string' ? JSON.parse(args) : null)
if (!SLUGS || !SLUGS.length) throw new Error('args must be an array of topic slugs')

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'longest_correct_after', 'notes'],
  properties: {
    slug: { type: 'string' },
    longest_correct_after: { type: 'integer', description: 'how many of the 10 questions still have the correct option uniquely-longest after your edits' },
    notes: { type: 'string' },
  },
}
const results = await parallel(SLUGS.map((slug) => () => {
  const file = `${REPO}/topics/system-design-case-studies/${slug}/questions.yaml`
  return agent(
    `Rebalance MCQ option lengths in ${file}. Currently the CORRECT option is the longest in most/all of the ` +
    `10 questions — a length giveaway a test-taker can exploit. Fix it.\n\n` +
    `RULES: edit ONLY the DISTRACTOR (wrong) option text. NEVER change the correct option's text, the "answer" ` +
    `index, the question, the explanation, ids, refs, tags, or any fact. Keep 4 options per question, same order, ` +
    `valid YAML. Distractors must stay clearly WRONG and plausible.\n\n` +
    `GOAL: make option lengths MIXED so the correct option is usually MID-PACK (2nd or 3rd longest of 4). Achieve ` +
    `this by LENGTHENING some short distractors (add plausible-but-wrong specificity) and/or TRIMMING padded ones. ` +
    `Across the 10 questions, the correct answer should be uniquely-longest in at most ~3 and shortest in at most ` +
    `~3. Read the file, compute the 4 option char-lengths per question, edit distractors, then RE-COMPUTE to ` +
    `confirm. Return the count of questions where the correct option is still uniquely-longest (aim <= 3).`,
    { label: `balance:${slug}`, phase: 'Balance', effort: 'high', schema: SCHEMA }
  )
}))
return { fixed: results.filter(Boolean).map((r) => ({ slug: r.slug, longest_after: r.longest_correct_after })) }
