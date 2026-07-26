export const meta = {
  name: 'mcq-distractor-rollout',
  description: 'Corpus-wide rollout of the MCQ distractor-length fix, ONE DOMAIN per invocation. Every questions.yaml in the target domain is processed in small POSITIONAL blocks (~18 questions each, sliced by list position) so no file can stall regardless of size (most files have 35-116 questions). Blocks of the same file run sequentially (one file, one writer); different files run in parallel. Same safety contract as the pilot: only distractor text is lengthened; correct option text, answer index, id, ref, question, explanation are never touched. Per-block done-marker cache = idempotent + outage-recoverable. A per-file adversarial verify confirms exactly one correct option per question. EDITS questions.yaml only.',
  phases: [
    { title: 'Balance blocks', detail: 'per file: sequential ~18-question positional blocks lengthen short distractors' },
    { title: 'Verify files', detail: 'one adversarial agent per file: no multi-correct / broken-answer questions' },
  ],
}

const REPO = '/path/to/interview-prep'
const CACHE = '/Users/dev/.claude/projects/<this-repo-project-dir>/refine-cache/distractor-chunks'
const BLOCK = 18

// args = { domain: string, files: [{slug, n}, ...] } (n = question count).
// Compact by design — the workflow computes block counts; agents slice by list
// position (robust even when question ids are non-contiguous). May be a JSON string.
let A = args
if (typeof A === 'string' && A.trim()) { try { A = JSON.parse(A) } catch (e) { throw new Error('args JSON parse failed: ' + e.message) } }
const DOMAIN = A && A.domain
const files = (A && Array.isArray(A.files)) ? A.files : null
if (!DOMAIN || !files) throw new Error('args must be { domain: string, files: [{slug,n}] }')
if (files.length === 0) throw new Error('no files for domain ' + DOMAIN)

const totalBlocks = files.reduce((s, f) => s + Math.max(1, Math.ceil(f.n / BLOCK)), 0)
log(`Distractor rollout — domain "${DOMAIN}": ${files.length} files, ${totalBlocks} blocks (~${BLOCK} Qs each)`)

const CONTRACT =
`ABSOLUTE RULES (a violation corrupts the assessment):\n` +
`1. Edit ONLY the TEXT of the DISTRACTOR (wrong) options.\n` +
`2. NEVER change: the correct option's text, the "answer" index value, "id", "ref", "question", ` +
`"explanation", "difficulty", "tags". Do not add/remove/reorder options (the answer index must keep ` +
`pointing at the same correct text).\n` +
`3. A lengthened distractor MUST stay UNAMBIGUOUSLY WRONG — add plausible specificity (a concrete-but-` +
`incorrect mechanism, a real-sounding wrong value/version, a believable misconception a strong student ` +
`might hold); never make it true, half-true, or defensible. Target each distractor within ~±25% of the ` +
`correct option's length; do not overshoot past it.\n` +
`4. Keep valid YAML: 2-space indent, block "- " list items, any "# correct" comment convention.`

const balanceBlock = (slug, blockIdx, nBlocks) => {
  const file = `${REPO}/topics/${DOMAIN}/${slug}/questions.yaml`
  const marker = `${CACHE}/${DOMAIN}__${slug}__${blockIdx}.json`
  const lo = blockIdx * BLOCK; // 0-based inclusive
  const hiEx = lo + BLOCK;     // exclusive
  return agent(
    `You are an assessment-design expert fixing the "correct answer is always the longest option" giveaway in ONE ` +
    `MCQ file. The file's questions are a YAML list under the top-level "questions:" key. You handle ONLY block ` +
    `#${blockIdx} of ${nBlocks} — that is, the questions at LIST POSITIONS ${lo} through ${hiEx - 1} inclusive ` +
    `(0-indexed, in file order; if the list is shorter, just those that exist). Identify them by their position in ` +
    `the list. Leave every question OUTSIDE that positional block completely untouched.\n\n` +
    `IDEMPOTENCY: Use Read on ${marker}. If it EXISTS, you are DONE — reply exactly "cached" and do nothing else. ` +
    `Otherwise do the work, then use Write to create ${marker} with JSON {"done":true}, then reply "done".\n\n` +
    `${CONTRACT}\n\n` +
    `STEP 1: Read ${file}. Count the questions and locate your positional block (${lo}..${hiEx - 1}). STEP 2: For each ` +
    `question in your block, find the correct option (via its "answer" index) and lengthen its conspicuously-short ` +
    `distractors into plausible, comparable-length, still-wrong alternatives with the Edit tool. Skip questions ` +
    `already balanced. Use enough surrounding context in each Edit (include the option's list position / neighboring ` +
    `text) so you edit the RIGHT occurrence — option strings can repeat across questions. STEP 3: self-verify each ` +
    `edited question — answer index still points at the original correct text, each distractor still clearly wrong, ` +
    `no two options now both correct, still valid YAML. Then write the marker.`,
    { label: `bal:${DOMAIN}/${slug}#${blockIdx}`, phase: 'Balance blocks', effort: 'high' }
  )
}

// Phase 1: per file, run its blocks SEQUENTIALLY (one writer per questions.yaml);
// files run in PARALLEL (parallel() caps concurrency, so this self-throttles).
phase('Balance blocks')
await parallel(files.map((f) => async () => {
  const nBlocks = Math.max(1, Math.ceil(f.n / BLOCK))
  for (let b = 0; b < nBlocks; b++) {
    await balanceBlock(f.slug, b, nBlocks)
  }
}))

// Phase 2: adversarial verify per file.
phase('Verify files')
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'verdict', 'multi_correct', 'now_wrong_correct', 'notes'],
  properties: {
    slug: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'needs-rework'] },
    multi_correct: { type: 'array', items: { type: 'string' }, description: 'ids where a lengthened distractor is now also correct/defensible (must be empty)' },
    now_wrong_correct: { type: 'array', items: { type: 'string' }, description: 'ids where the answer index no longer points at a correct option (must be empty)' },
    notes: { type: 'string' },
  },
}
const verdicts = await parallel(files.map((f) => () => {
  const file = `${REPO}/topics/${DOMAIN}/${f.slug}/questions.yaml`
  return agent(
    `Adversarially review ${file} after a distractor-lengthening pass. For EACH question: (1) is any option OTHER than ` +
    `the one at the "answer" index now also true / correct / defensible? -> multi_correct. (2) does the "answer" index ` +
    `still point at a genuinely-correct option (its text unchanged)? if not -> now_wrong_correct. Do NOT edit the file. ` +
    `verdict=clean ONLY if both lists are empty. Return the verdict (slug MUST be "${f.slug}").`,
    { label: `verify:${DOMAIN}/${f.slug}`, phase: 'Verify files', effort: 'high', schema: VERIFY_SCHEMA }
  )
}))

const ok = verdicts.filter(Boolean)
const rework = ok.filter((v) => v.verdict !== 'clean')
log(`Domain "${DOMAIN}" done: ${ok.length - rework.length}/${files.length} files clean, ${rework.length} need rework`)
return {
  domain: DOMAIN, files: files.length, blocks: totalBlocks,
  clean: ok.length - rework.length,
  needs_rework: rework.map((v) => ({ slug: v.slug, multi_correct: v.multi_correct, now_wrong_correct: v.now_wrong_correct })),
}
