export const meta = {
  name: 'eng-blog-case-studies',
  description: 'Author the System Design Case Studies pilot: one topic per real, verified engineering-blog post. Each post URL has been pre-verified as fetchable (self-hosted blogs; Medium ones excluded). Per story, a pipeline: (1) an author agent WebFetches the real post in depth and writes concepts.md (7-point teaching standard, every claim sourced) + questions.yaml (10 MCQs) following docs/content-schema.md, with distractor lengths deliberately BALANCED so the correct answer is not systematically the longest; (2) a verify agent independently re-checks factual fidelity to the post, MCQ correctness (exactly one right answer), and re-measures distractor-length balance, fixing if needed. Cache-backed via a per-topic done-marker. WRITES only under topics/system-design-case-studies/. Registration in sync + validate happen after, by the main loop.',
  phases: [
    { title: 'Author', detail: 'per story: fetch the real post, write concepts.md + balanced-distractor MCQs' },
    { title: 'Verify', detail: 'per story: check fidelity to the post, one-correct-answer, and distractor balance' },
  ],
}

const REPO = '/path/to/interview-prep'
const DOMAIN = 'system-design-case-studies'
const CACHE = '/Users/dev/.claude/projects/<this-repo-project-dir>/refine-cache/eng-blogs'

// Pilot work-list: {company, slug, url, angle}. URLs pre-verified fetchable (self-hosted).
// The reference topic (uber-zone-failure-resilient-opensearch) is already authored — not here.
const STORIES = (() => {
  const A = args
  if (Array.isArray(A)) return A
  if (typeof A === 'string' && A.trim()) { try { const p = JSON.parse(A); if (Array.isArray(p)) return p } catch (e) {} }
  return null
})()
if (!STORIES || STORIES.length === 0) throw new Error('args must be a non-empty array of {company, slug, url, angle}')
log(`Case-studies pilot: ${STORIES.length} stories`)

const STANDARD = `
Teach this as a crystal-clear system-design CASE STUDY for senior-interview prep, in PLAIN language —
the 7-point bar: (1) intuition-first (the problem + why it matters, before any jargon); (2) the naive
approach and why it broke; (3) the actual architecture (components, data flow, mechanisms) with a
mermaid diagram where it helps; (4) CONCRETE numbers from the post (scale, nodes, latency, %s) — quote
real figures, and if the post gives none, say so rather than inventing; (5) reasoned trade-offs +
gotchas; (6) a "Common follow-up questions" section; (7) define all jargon on first use. Every factual
claim MUST come from the fetched post — do NOT invent numbers or details. Cite the post URL (and any
secondary source) in a References section. Match the repo's existing case-study voice.
`

const AUTHOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'status', 'title', 'summary', 'has_real_numbers'],
  properties: {
    slug: { type: 'string' },
    status: { type: 'string', enum: ['authored', 'already-cached', 'blocked'], description: 'blocked if the post could not be fetched (e.g. Medium empty scaffolding)' },
    title: { type: 'string', description: 'the concepts.md H1 title used' },
    summary: { type: 'string', description: 'one line: the problem this case study teaches' },
    has_real_numbers: { type: 'boolean', description: 'did the post provide concrete figures that were used?' },
  },
}

const authorStory = (s) => {
  const dir = `${REPO}/topics/${DOMAIN}/${s.slug}`
  const marker = `${CACHE}/${s.slug}.json`
  return agent(
    `You are a Senior Principal Engineer and gifted teacher authoring ONE case-study topic for the ` +
    `"${DOMAIN}" domain, from a REAL engineering-blog post.\n\n` +
    `COMPANY: ${s.company}\nSTORY ANGLE: ${s.angle}\nPOST URL: ${s.url}\nTOPIC SLUG: ${s.slug}\n\n` +
    `IDEMPOTENCY: use Read on ${marker}. If it EXISTS with status "authored", return it verbatim with ` +
    `status "already-cached"; write nothing. Otherwise proceed.\n\n` +
    `STEP 1 — FETCH THE REAL POST. Load WebFetch via ToolSearch ("select:WebFetch"), then WebFetch ${s.url} ` +
    `with a detailed extraction prompt (problem, prior approach + why it failed, architecture/components/` +
    `data-flow, concrete numbers, trade-offs/gotchas, key takeaways). If the URL 301/307-redirects, ` +
    `re-fetch the redirect target. If the page comes back as EMPTY scaffolding (Medium SPA) or unfetchable, ` +
    `set status "blocked" and stop (do NOT invent content).\n\n` +
    `${STANDARD}\n\n` +
    `STEP 2 — WRITE concepts.md to ${dir}/concepts.md . Start with "# ${'<title>'}" (a clear title naming the ` +
    `company + the problem). Use "## " section headings (these are MCQ anchor targets). Follow the content ` +
    `contract in ${REPO}/docs/content-schema.md exactly. 1-3 callouts max (> [!KEY-TAKEAWAY] / [!INTERVIEW] / ` +
    `[!TIP] / [!WARNING]). End with "## Common follow-up questions" and "## References" (cite ${s.url}).\n\n` +
    `STEP 3 — WRITE questions.yaml to ${dir}/questions.yaml : 10 MCQs per the schema (topic, domain: ` +
    `"${DOMAIN}", topic_slug: "${s.slug}", version: 1; ids "${s.slug}-001".."${s.slug}-010"; each 4 options, ` +
    `0-based "answer", teaching "explanation", and a "ref: concepts.md#<anchor>" to a real heading). ` +
    `Mix difficulty. VARY the correct-answer position across questions.\n` +
    `**DISTRACTOR-LENGTH BALANCE (mandatory):** do NOT let the correct option be the longest — that is a ` +
    `giveaway. Make option lengths comparable and MIXED: across the 10 questions the correct answer should be ` +
    `the longest in only ~2-3 and the shortest in ~2-3, mid-pack otherwise. Distractors must stay clearly ` +
    `WRONG but be written at a length similar to the correct option. After writing, mentally check the ` +
    `lengths and adjust distractors so the correct answer is usually mid-pack.\n\n` +
    `STEP 4 — self-check: valid YAML; every "ref" anchor matches a real "## " heading (GitHub-slugified); ` +
    `exactly one correct answer per question; no invented facts. Then Write ${marker} as JSON ` +
    `{"done":true,"slug":"${s.slug}"} and return the structured object.`,
    { label: `author:${s.slug}`, phase: 'Author', effort: 'high', schema: AUTHOR_SCHEMA }
  )
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'verdict', 'fidelity_issues', 'mcq_issues', 'balance_ok', 'notes'],
  properties: {
    slug: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'needs-rework', 'blocked'] },
    fidelity_issues: { type: 'array', items: { type: 'string' }, description: 'claims in concepts.md NOT supported by the post / likely invented (empty if none)' },
    mcq_issues: { type: 'array', items: { type: 'string' }, description: 'questions with zero or multiple correct answers, or a wrong answer index, or a broken ref anchor (empty if none)' },
    balance_ok: { type: 'boolean', description: 'true if distractor lengths are mixed (correct answer not systematically longest)' },
    notes: { type: 'string' },
  },
}

const verifyStory = (authored, s) => {
  const dir = `${REPO}/topics/${DOMAIN}/${s.slug}`
  if (authored?.status === 'blocked') {
    return Promise.resolve({ slug: s.slug, verdict: 'blocked', fidelity_issues: [], mcq_issues: [], balance_ok: true, notes: 'author blocked (post unfetchable)' })
  }
  return agent(
    `You are an adversarial reviewer verifying ONE authored case-study topic against its SOURCE post.\n\n` +
    `POST URL: ${s.url}\nFILES: ${dir}/concepts.md and ${dir}/questions.yaml\n\n` +
    `1. Load WebFetch (ToolSearch "select:WebFetch") and re-fetch ${s.url} (follow redirects). Read ` +
    `${dir}/concepts.md. Flag any FACTUAL claim / number in concepts.md that the post does NOT support ` +
    `(possible fabrication) → fidelity_issues.\n` +
    `2. Read ${dir}/questions.yaml. For each question check: exactly ONE correct option, the "answer" index ` +
    `points at it, options are plausible, and "ref" anchors resolve to real "## " headings. → mcq_issues.\n` +
    `3. Compute the 4 option lengths per question. If the correct option is the uniquely-longest in MOST ` +
    `questions (a length giveaway), set balance_ok=false and note it. If a fix is small and clearly safe you ` +
    `MAY edit distractor text to rebalance (never change correct text / answer index / facts); otherwise just ` +
    `report. \n` +
    `verdict=clean only if fidelity_issues AND mcq_issues are both empty AND balance_ok is true. Return the object.`,
    { label: `verify:${s.slug}`, phase: 'Verify', effort: 'high', schema: VERIFY_SCHEMA }
  )
}

const results = await pipeline(STORIES, (s) => authorStory(s), (authored, s) => verifyStory(authored, s).then((v) => ({ author: authored, verify: v, slug: s.slug })))

const ok = results.filter(Boolean)
const clean = ok.filter((r) => r.verify?.verdict === 'clean')
const rework = ok.filter((r) => r.verify?.verdict === 'needs-rework')
const blocked = ok.filter((r) => r.verify?.verdict === 'blocked' || r.author?.status === 'blocked')
log(`Case-studies: ${clean.length} clean, ${rework.length} need-rework, ${blocked.length} blocked`)
return {
  total: STORIES.length, clean: clean.length,
  needs_rework: rework.map((r) => ({ slug: r.slug, fidelity: r.verify?.fidelity_issues, mcq: r.verify?.mcq_issues, balance_ok: r.verify?.balance_ok })),
  blocked: blocked.map((r) => r.slug),
  authored: ok.filter((r) => r.author?.status !== 'blocked').map((r) => ({ slug: r.slug, title: r.author?.title, has_numbers: r.author?.has_real_numbers })),
}
