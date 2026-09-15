export const meta = {
  name: 'corpus-content-audit',
  description: 'Read-only teaching-quality audit of the entire interview-prep corpus (all domains, every subtopic concepts.md). Cache-backed and idempotent: each subtopic audit is written to a durable cache file the instant it finishes and skipped on re-runs, so retries after an API/network outage are strictly additive. One agent per UN-cached subtopic scores it against a Senior-Principal-Engineer + gifted-teacher bar, weighted toward intuition/clarity, worked examples, and interview depth/gotchas. Per-domain CONTENT-AUDIT.md reports + a master CONTENT-AUDIT-MASTER.md are written from the cache. AUDIT ONLY — no content files are edited; web verification is deferred to a later refine pass.',
  phases: [
    { title: 'Audit', detail: 'one agent per UN-cached subtopic reads concepts.md, scores it, and writes its audit JSON to the cache dir' },
    { title: 'Domain reports', detail: 'one agent per domain ranks its subtopics from cache, clusters systemic issues, writes topics/<domain>/CONTENT-AUDIT.md' },
    { title: 'Master report', detail: 'aggregate across domains into topics/CONTENT-AUDIT-MASTER.md with the corpus-wide refinement plan' },
  ],
}

// Repo root. Pass `args.root` when invoking this workflow, or edit the
// fallback for your clone. The fallback is deliberately not a real path so a
// misconfigured run fails loudly instead of reading the wrong tree.
const REPO = (typeof args !== 'undefined' && args && args.root)
  || '/path/to/interview-prep'
const CACHE = '/tmp/interview-prep-cache/audit-cache'

// args is the {domain: [slug, ...]} structure — may arrive as an object OR a JSON string.
let STRUCT = null
if (args && typeof args === 'object' && !Array.isArray(args)) {
  STRUCT = args
} else if (typeof args === 'string' && args.trim()) {
  try {
    const p = JSON.parse(args)
    if (p && typeof p === 'object' && !Array.isArray(p)) STRUCT = p
  } catch (e) { /* fall through to error below */ }
}
if (!STRUCT) throw new Error('args must be a {domain: [slug,...]} object (got: ' + typeof args + ')')

const WORK = []
for (const dom of Object.keys(STRUCT)) {
  for (const slug of STRUCT[dom]) WORK.push({ dom, slug })
}
if (WORK.length === 0) throw new Error('no subtopics in args')

const RUBRIC = `
You are a Senior Principal Engineer at a top product company AND a gifted, enthusiastic teacher.
You are auditing ONE interview study document (concepts.md) for how well it TEACHES a real student —
someone preparing for senior backend / system-design interviews who wants ZERO doubt left behind after
reading it. Read the WHOLE file before scoring.

Judge it against this bar. The three MOST HEAVILY WEIGHTED dimensions (the repo owner's chosen priorities):

(1) INTUITION & CLARITY — the top priority.
   - Does each concept LEAD with a plain-language mental model / analogy / "why does this exist" BEFORE any
     formalism, notation, or math?
   - Would a motivated student read a section and genuinely UNDERSTAND it, or just memorize words?
   - Is jargon introduced and defined on first use? Are acronyms expanded? Is the ordering simple -> complex,
     never assuming something not yet taught?
   - Where would a student get stuck, confused, or left with an unanswered "but why / but how"?

(2) WORKED EXAMPLES — second priority.
   - For every hard/non-obvious concept, is there a CONCRETE, numbers-in / numbers-out walkthrough (capacity
     math, quorum arithmetic, a traced request, a small code example with the output reasoned through), not
     just abstract prose?
   - An "example" that only restates the abstraction in words does NOT count — look for something concrete a
     student could follow step by step.

(3) INTERVIEW DEPTH & GOTCHAS — third priority.
   - Is it deep enough for a SENIOR bar: trade-offs argued with reasoning ("you gain X, you give up Y, pick it
     when Z"), failure modes, edge cases, "when to use what", and the follow-up questions an interviewer asks
     when they probe deeper — or is it shallow / wikipedia-ish?
   - Are trade-offs REASONED, or just listed as bare bullets?
   - Is there a "common follow-ups / gotchas / what interviewers push on" layer, or does it stop at the happy path?

Also note (secondary, do NOT let these dominate the priority call):
   - CORRECTNESS: any statement that is wrong, outdated, oversimplified-to-wrong, or misleading. Flag it and set
     needs_web_verification=true if it is a factual claim about version behavior, service limits, default configs,
     or performance numbers that a later pass should verify on the web. DO NOT web-search now.
   - VISUALS: a concept that would teach far better WITH a diagram but has none (nice-to-have, low severity).
   - STRUCTURE: clean "## " heading anchors, good intro, redundant/overlapping sections, missing subtopics a
     senior interviewer would expect.

Be a tough but fair grader. Most of this corpus is already strong — your job is to find precisely what would make
a student STRUGGLE or leave doubt, and what would make an interviewer think an answer is shallow. If a file is
genuinely excellent, say so and return few/no issues — do not invent problems.
`

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'clarity_score', 'example_score', 'depth_score', 'refine_priority', 'one_line_verdict', 'strengths', 'issues', 'needs_web_verification'],
  properties: {
    slug: { type: 'string' },
    clarity_score: { type: 'integer', minimum: 1, maximum: 5, description: '1=confusing, 5=crystal-clear intuition-first teaching' },
    example_score: { type: 'integer', minimum: 1, maximum: 5, description: '1=all abstract, 5=concrete worked examples for every hard concept' },
    depth_score: { type: 'integer', minimum: 1, maximum: 5, description: '1=shallow/wikipedia, 5=senior-interview-deep with reasoned trade-offs + gotchas' },
    refine_priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high=student would genuinely struggle or interviewer would find it shallow; medium=good but clear gaps; low=already strong, minor polish at most' },
    one_line_verdict: { type: 'string', description: 'one sentence: the single most important thing about this file\'s teaching quality' },
    needs_web_verification: { type: 'boolean', description: 'true if any factual claim (version behavior, service limit, default config, perf number) should be web-verified in the refine pass' },
    strengths: { type: 'array', items: { type: 'string' }, description: '1-3 things done well (brief)' },
    issues: {
      type: 'array',
      description: 'concrete, actionable issues ranked most-important-first; empty if genuinely excellent',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'severity', 'where', 'detail', 'fix'],
        properties: {
          type: { type: 'string', enum: ['clarity', 'missing-intuition', 'example-gap', 'depth', 'gotchas-followups', 'correctness', 'jargon', 'structure', 'ordering', 'redundancy', 'visual'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string', description: 'the "## heading" or region of the file this refers to' },
          detail: { type: 'string', description: 'what specifically would make a student struggle / what is wrong or thin' },
          fix: { type: 'string', description: 'the concrete change a refinement pass should make (add analogy, add worked example with numbers, define term, add trade-off reasoning, add follow-ups section, correct fact, add diagram, etc.)' },
        },
      },
    },
  },
}

// ---- Phase 1: audit every UN-cached subtopic (read-only content; writes only to CACHE) ----
// Each agent checks the cache file itself and skips if present, then writes its result the instant it
// finishes. This makes retries after an outage strictly additive — completed audits are never re-run.
phase('Audit')
log(`corpus: ${WORK.length} subtopics; cache dir: ${CACHE} — cached audits will be skipped`)

const CACHE_NOTE =
  `\n\nCACHING PROTOCOL (do this yourself, deterministically):\n` +
  `1. The cache file for this subtopic is: ${CACHE}/__CACHEKEY__.json\n` +
  `2. FIRST, use Read on that exact cache path. If it EXISTS and parses as JSON with a "clarity_score" field, ` +
  `you are DONE — return that same JSON object verbatim as your structured output. Do NOT re-read concepts.md.\n` +
  `3. If the cache file does NOT exist (Read errors), audit the concepts.md file per the rubric, then use the ` +
  `Write tool to save your final structured audit object as JSON to that exact cache path, THEN return the same ` +
  `object as your structured output.\n` +
  `This protocol guarantees an interrupted run can resume without redoing finished work.`

const audits = await parallel(WORK.map((w) => () => {
  const key = `${w.dom}__${w.slug}`
  return agent(
    `${RUBRIC}\n\n` +
    `Audit the interview-study file ${REPO}/topics/${w.dom}/${w.slug}/concepts.md ` +
    `(domain: "${w.dom}", subtopic slug: "${w.slug}"). This is AUDIT ONLY — do NOT edit concepts.md, do NOT web-search. ` +
    `Ground every issue in a specific "## heading"/region and give a concrete, actionable fix. Set refine_priority ` +
    `honestly against the weighted bar (intuition/clarity, worked examples, interview depth/gotchas matter most). ` +
    `Your returned "slug" field MUST be exactly "${w.slug}".` +
    CACHE_NOTE.replace('__CACHEKEY__', key),
    { label: `audit:${w.dom}/${w.slug}`, phase: 'Audit', effort: 'medium', schema: AUDIT_SCHEMA }
  )
}))

// Zip results back to their domain (parallel preserves order). Prefer the freshly-returned object,
// but the source of truth is the CACHE dir — the report phase re-reads it, so even nulls here are fine.
const byDomain = {}
let okCount = 0
WORK.forEach((w, i) => {
  const a = audits[i]
  if (!a) return
  okCount++
  ;(byDomain[w.dom] ||= []).push({ ...a, domain: w.dom, slug: a.slug || w.slug })
})
log(`audit phase: ${okCount}/${WORK.length} subtopics have in-memory results this run (cache holds the full set)`)

const DOMAIN_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'n', 'high', 'med', 'low', 'avg_clarity', 'avg_example', 'avg_depth', 'top_systemic_themes', 'top_priority_slugs', 'health_line'],
  properties: {
    domain: { type: 'string' },
    n: { type: 'integer' },
    high: { type: 'integer' },
    med: { type: 'integer' },
    low: { type: 'integer' },
    avg_clarity: { type: 'number' },
    avg_example: { type: 'number' },
    avg_depth: { type: 'number' },
    top_systemic_themes: { type: 'array', items: { type: 'string' }, description: 'up to 4 recurring cross-subtopic issue themes in this domain' },
    top_priority_slugs: { type: 'array', items: { type: 'string' }, description: 'the high/medium-priority slugs in this domain, worst first' },
    health_line: { type: 'string', description: 'one-sentence overall health of this domain' },
  },
}

// ---- Phase 2: one report per domain — reads the CACHE dir (not in-memory results) ----
phase('Domain reports')
const domainSummaries = await parallel(Object.keys(STRUCT).map((dom) => () => {
  const slugs = STRUCT[dom]
  const cachePaths = slugs.map((s) => `${CACHE}/${dom}__${s}.json`)
  return agent(
    `You are a Senior Principal Engineer writing a prioritized CONTENT-AUDIT report for the "${dom}" domain of an ` +
    `interview-prep study library, for the repo owner to review before any refinement work begins. The refinement ` +
    `bar is weighted toward (1) intuition & clarity, (2) worked examples, (3) interview depth & gotchas.\n\n` +
    `STEP 1 — gather the data. Read each of these ${cachePaths.length} per-subtopic audit JSON files (use the Read ` +
    `tool on each; each holds one audit object with clarity_score, example_score, depth_score, refine_priority, ` +
    `one_line_verdict, needs_web_verification, strengths, issues):\n${cachePaths.map((p) => '  - ' + p).join('\n')}\n` +
    `If a file is missing or unreadable, skip it and note the count of missing files at the end of the report.\n\n` +
    `STEP 2 — write the report. SAVE it with the Write tool to ${REPO}/topics/${dom}/CONTENT-AUDIT.md . It MUST ` +
    `contain, in order:\n` +
    `1. "# ${dom} — Content Audit" + a 1-paragraph executive summary (overall health, counts of high/medium/low ` +
    `priority, headline takeaways).\n` +
    `2. "## Scorecard" — a table: Subtopic | Clarity (/5) | Examples (/5) | Depth (/5) | Priority | Verdict. Sort ` +
    `high priority first, then lowest (clarity+example+depth) first.\n` +
    `3. "## Systemic issues" — cluster issues ACROSS subtopics into recurring themes (with counts + example slugs). ` +
    `This is the most valuable section.\n` +
    `4. "## High-priority subtopics" — for each high-priority slug, a short subsection with its top 3-5 issues ` +
    `(severity, where, the concrete fix).\n` +
    `5. "## Refinement plan" — recommended order of attack; note any slug with needs_web_verification=true.\n\n` +
    `Be concrete and honest. After writing the file, RETURN your structured domain summary object (compute the ` +
    `averages and counts from the audit files you read).`,
    { label: `report:${dom}`, phase: 'Domain reports', effort: 'high', schema: DOMAIN_SUMMARY_SCHEMA }
  )
}))

const summaries = domainSummaries.filter(Boolean)

// ---- Phase 3: master report — aggregate from the domain summaries ----
phase('Master report')
const g = {
  total: summaries.reduce((s, d) => s + (d.n || 0), 0),
  high: summaries.reduce((s, d) => s + (d.high || 0), 0),
  med: summaries.reduce((s, d) => s + (d.med || 0), 0),
  low: summaries.reduce((s, d) => s + (d.low || 0), 0),
}

const master = await agent(
  `You are a Senior Principal Engineer writing the MASTER content-audit report for an entire interview-prep study ` +
  `library (Markdown Q&A + MCQ site). The refinement bar is weighted toward (1) intuition & clarity, (2) worked ` +
  `examples, (3) interview depth & gotchas; diagrams and correctness/staleness are secondary.\n\n` +
  `Corpus-wide aggregates (computed from domain summaries): ${JSON.stringify(g)}\n\n` +
  `Per-domain summaries (JSON): ${JSON.stringify(summaries)}\n\n` +
  `Write a clear, skimmable Markdown report and SAVE it with the Write tool to ${REPO}/topics/CONTENT-AUDIT-MASTER.md . ` +
  `It MUST contain, in order:\n` +
  `1. "# Interview-Prep Corpus — Master Content Audit" + executive summary (overall corpus health, total subtopics, ` +
  `high/med/low counts, and the 3-4 headline takeaways).\n` +
  `2. "## Domain scorecard" — a table: Domain | Subtopics | High | Med | Low | Avg Clarity | Avg Examples | Avg Depth ` +
  `| Health. Sort by (high count desc, then avg-scores asc) so the domains most needing work are at the top.\n` +
  `3. "## Corpus-wide systemic themes" — the recurring issue themes across ALL domains (synthesize from each ` +
  `domain's top_systemic_themes), each with what it means and which domains it concentrates in. This is the most ` +
  `important section — it tells us what to fix SYSTEMATICALLY.\n` +
  `4. "## Recommended order of attack" — which domains/subtopics to refine first and why, as a wave plan.\n` +
  `5. "## The refinement standard" — the target every refined subtopic should hit: intuition-first opener, a worked ` +
  `example per hard concept, reasoned trade-offs, a follow-ups/gotchas layer, defined jargon, consistent structure.\n` +
  `6. "## Per-domain report index" — a bullet list linking each domain's own CONTENT-AUDIT.md (relative path ` +
  `\`<domain>/CONTENT-AUDIT.md\`).\n\n` +
  `Be concrete and honest. Return one line: "master audit written: <total> subtopics, <h> high / <m> med / <l> low".`,
  { label: 'master-report', phase: 'Master report', effort: 'high' }
)

return { audited_in_memory: okCount, domains: summaries.length, aggregates: g, master }
