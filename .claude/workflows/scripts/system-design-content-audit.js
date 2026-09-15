export const meta = {
  name: 'system-design-content-audit',
  description: 'Pilot content audit of the system-design domain: one agent reads each subtopic concepts.md and audits it against a senior-principal-engineer + great-teacher bar (clarity, pedagogy, depth, correctness, structure), returning structured findings; a synthesis stage ranks every subtopic and writes a prioritized audit.md report. AUDIT ONLY — no file edits.',
  phases: [
    { title: 'Audit', detail: 'one agent per subtopic reads concepts.md and scores clarity/pedagogy/depth/correctness' },
    { title: 'Synthesize', detail: 'rank subtopics, cluster systemic issues, write audit.md' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const DIR = `${REPO}/topics/system-design`
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

const RUBRIC = `
You are a Senior Principal Engineer at a top product company AND a gifted, enthusiastic teacher.
You are auditing ONE interview study document (concepts.md) for how well it TEACHES a real student —
someone preparing for senior backend/system-design interviews who wants zero doubt left behind.

Read the WHOLE file. Judge it against this bar (a great teacher's standard, not just correctness):

CLARITY & PEDAGOGY (most important):
 - Does it build intuition FIRST (the "why", a mental model, an analogy) before formal detail?
 - Would a motivated student read a section and genuinely UNDERSTAND it, or just memorize words?
 - Are there concrete worked examples / numbers / walkthroughs, not just abstract description?
 - Is jargon introduced and defined, or dropped unexplained? Are acronyms expanded on first use?
 - Does the ordering flow (simple -> complex), or does it assume things not yet taught?
DEPTH & INTERVIEW-READINESS:
 - Is it deep enough for a SENIOR bar — trade-offs, "when to use what", failure modes, gotchas —
   or is it shallow/wikipedia-ish?
 - Are the trade-offs explained with reasoning ("you gain X, you give up Y, pick it when Z"),
   not just listed?
CORRECTNESS:
 - Any statements that are wrong, outdated, oversimplified-to-the-point-of-wrong, or misleading?
   (Flag with your best judgment; note if it needs web verification — do NOT web-search in this pass.)
STRUCTURE:
 - Are the "## " headings clean anchor targets? Is there a good intro and a follow-ups section?
 - Missing subtopics a senior interviewer would expect? Redundant/overlapping sections?

Be a tough but fair grader. Most content here is already decent — your job is to find what would make
a student STRUGGLE or leave doubt, and what would make an interviewer think the answer is shallow.
`

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'clarity_score', 'depth_score', 'refine_priority', 'one_line_verdict', 'strengths', 'issues'],
  properties: {
    slug: { type: 'string' },
    clarity_score: { type: 'integer', minimum: 1, maximum: 5, description: '1=confusing, 5=crystal-clear teaching' },
    depth_score: { type: 'integer', minimum: 1, maximum: 5, description: '1=shallow, 5=senior-interview-deep' },
    refine_priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'how much this subtopic needs a refinement pass' },
    one_line_verdict: { type: 'string', description: 'one sentence: the single most important thing about this file\'s teaching quality' },
    strengths: { type: 'array', items: { type: 'string' }, description: '1-3 things done well (brief)' },
    issues: {
      type: 'array',
      description: 'concrete, actionable issues ranked most-important-first; empty if genuinely excellent',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'severity', 'where', 'detail', 'fix'],
        properties: {
          type: { type: 'string', enum: ['clarity', 'missing-intuition', 'example-gap', 'depth', 'correctness', 'jargon', 'structure', 'ordering', 'redundancy'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string', description: 'the "## heading" or region of the file this refers to' },
          detail: { type: 'string', description: 'what specifically would make a student struggle / what is wrong or thin' },
          fix: { type: 'string', description: 'the concrete change a refinement pass should make (add analogy, add worked example, define term, add trade-off reasoning, correct fact, etc.)' },
        },
      },
    },
  },
}

phase('Audit')
const audits = await parallel(SLUGS.map((slug) => () =>
  agent(
    `${RUBRIC}\n\n` +
    `Read the file ${DIR}/${slug}/concepts.md (subtopic slug: "${slug}") in full, then return your ` +
    `structured audit. Set refine_priority=high only if a student would genuinely struggle or an ` +
    `interviewer would find it shallow; medium for "good but has clear gaps"; low for "already strong, ` +
    `minor polish at most". Ground every issue in a specific heading/region and give an actionable fix.`,
    { label: `audit:${slug}`, phase: 'Audit', effort: 'medium', schema: AUDIT_SCHEMA }
  )
))

const ok = audits.filter(Boolean)

phase('Synthesize')
const compact = ok.map((a) => ({
  slug: a.slug, clarity: a.clarity_score, depth: a.depth_score, priority: a.refine_priority,
  verdict: a.one_line_verdict,
  issues: (a.issues || []).map((i) => ({ type: i.type, sev: i.severity, where: i.where, detail: i.detail, fix: i.fix })),
  strengths: a.strengths,
}))

const report = await agent(
  `You are a Senior Principal Engineer writing a prioritized CONTENT-AUDIT REPORT for the system-design ` +
  `domain of an interview-prep library, for the repo owner to review before any refinement work begins.\n\n` +
  `You are given structured audits for ${compact.length} subtopics as JSON:\n\n` +
  `${JSON.stringify(compact)}\n\n` +
  `Write a clear, skimmable Markdown report and SAVE it with the Write tool to ` +
  `${DIR}/CONTENT-AUDIT.md . The report must contain, in this order:\n` +
  `1. "# System Design — Content Audit" + a 1-paragraph executive summary (overall health, how many ` +
  `high/medium/low priority, the headline takeaways).\n` +
  `2. "## Scorecard" — a table: Subtopic | Clarity (/5) | Depth (/5) | Priority | Verdict. Sort by ` +
  `priority (high first), then lowest clarity+depth first.\n` +
  `3. "## Systemic issues" — cluster the issues ACROSS subtopics into recurring themes (e.g. "many ` +
  `topics jump to formalism without intuition", "trade-offs listed not reasoned", "few worked examples", ` +
  `"undefined jargon") with counts and example slugs. This is the most valuable section — it tells us ` +
  `what to fix systematically.\n` +
  `4. "## High-priority subtopics" — for each high-priority slug, a short subsection with its top 3-5 ` +
  `issues (severity, where, the concrete fix).\n` +
  `5. "## Suggested refinement plan" — a recommended order of attack and what a "clarity+pedagogy pass" ` +
  `should standardize (intuition-first opener, worked example per hard concept, defined jargon, reasoned ` +
  `trade-offs, consistent structure). Note anything flagged as a possible correctness/staleness issue ` +
  `that should get web verification in a later pass.\n\n` +
  `Be concrete and honest. Return one line: "audit written: <n> subtopics, <h> high / <m> med / <l> low".`,
  { label: 'synthesize:audit', phase: 'Synthesize', effort: 'high' }
)

return { audited: ok.length, report }
