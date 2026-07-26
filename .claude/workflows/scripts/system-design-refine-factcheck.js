export const meta = {
  name: 'system-design-refine-factcheck',
  description: 'Web-verify the fact-shaped edits my no-web refinement pass (commit 268a063) made, to catch any regression where a correct (previously web-verified) AWS limit/price/spec/default was downgraded to a wrong value. One agent per AWS/limit-heavy file: reads the specific added fact-lines, web-verifies each against official AWS/vendor docs, fixes regressions in place, and refreshes the citation. Logic/arithmetic in worked examples is re-derived, not web-searched.',
  phases: [
    { title: 'FactCheck', detail: 'one agent per file web-verifies its added AWS facts and fixes regressions in place' },
  ],
}

const REPO = '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`
const FACTS_FILE = `${REPO}/.refine-tmp/factcheck.json`

function toSlugs(a) {
  if (Array.isArray(a)) return a
  if (typeof a === 'string' && a.trim()) {
    try { const p = JSON.parse(a); if (Array.isArray(p)) return p } catch (e) {}
    return a.split(/[\s,]+/).filter(Boolean)
  }
  return []
}
const SLUGS = toSlugs(args)
if (SLUGS.length === 0) throw new Error('no slugs passed in args')

const GUIDANCE = `
CONTEXT: A recent no-web refinement pass edited this file. An EARLIER pass had already web-verified many
AWS facts here. The danger: the no-web pass may have DOWNGRADED a correct, verified value to a wrong one
(a real example already found & fixed elsewhere: SCP-attached-per-entity was correctly 10, got flipped to
5 — 5 is the RCP limit, not SCP). Your job is to catch and fix any such REGRESSION in THIS file.

WHAT TO CHECK: read ${FACTS_FILE}, key "<slug>" — it lists the fact-shaped lines the pass ADDED/CHANGED.
For each line that asserts an AWS (or other vendor/spec) SERVICE LIMIT, QUOTA, PRICE, DEFAULT, VERSION,
or SPEC NUMBER, web-verify it against an AUTHORITATIVE PRIMARY SOURCE (official AWS service docs / quota
pages / pricing pages; RFCs; vendor release notes — NOT SEO blogs). Batch your searches per topic.

RULES:
 - If a stated precise number is WRONG, fix it in the concepts.md to the correct current value AND add or
   refresh a source in the "## References" section (or an inline link) so it's traceable. Do NOT fabricate
   a citation — if unsure of an exact value, state the mechanism + a correct conservative range and say
   "verify current docs", rather than asserting a wrong precise number.
 - If a line is already correct, or is a deliberately-softened range ("historically X, since raised —
   verify docs"), LEAVE IT — that is the intended state, not a regression.
 - Pure ARITHMETIC in worked examples (e.g. base62 traces, quorum overlap, availability products, cost
   break-evens) is NOT web-checkable — instead RE-DERIVE it and fix only if the math is wrong.
 - SURGICAL: change only what is wrong. Do NOT rename/remove/reorder any "## H2" heading (MCQ anchors).
   Do NOT touch questions.yaml. Headings: no '/' or '&'. Callouts: only [!TIP]/[!WARNING]/[!INTERVIEW]/
   [!KEY-TAKEAWAY].
`

phase('FactCheck')
const results = await parallel(SLUGS.map((slug) => () =>
  agent(
    `You are a staff AWS solutions architect fact-checking a study document with LIVE WEB ACCESS.\n\n` +
    `FILE: ${DIR}/${slug}/concepts.md  (slug: "${slug}")\n\n${GUIDANCE.replace(/<slug>/g, slug)}\n\n` +
    `Steps: (1) read ${FACTS_FILE} and get the added fact-lines for "${slug}"; (2) read the relevant ` +
    `sections of the concepts.md for context; (3) web-verify each AWS-limit/price/spec/default line ` +
    `against official docs; (4) fix any REGRESSION in place and refresh the citation; (5) re-derive any ` +
    `worked-example arithmetic and fix if wrong. Then return one line: ` +
    `"${slug}: <n> facts checked, <r> regressions fixed, <a> arithmetic fixed, notes: <what/sources>".`,
    { label: `factcheck:${slug}`, phase: 'FactCheck', effort: 'high' }
  )
))

return results.filter(Boolean)
