export const meta = {
  name: 'optimization-survey',
  description: 'Exhaustive, repo-grounded survey of optimization & enhancement opportunities for the interview-prep project (430 topics / 21k MCQs Markdown library + Astro/Preact static site). Phase 1: 9 parallel lens-agents each audit ONE dimension (testing/CI, content pedagogy, MCQ quality, web performance, UX/engagement, accessibility, SEO/discoverability, data/build architecture, learning-science analytics) against the ACTUAL repo, reading real files to ground every claim. Phase 2: each surfaced opportunity is adversarially GROUNDED (already done? evidence real? impact/effort honest?) so nothing already-shipped or speculative survives. Phase 3: synthesize one deduplicated, impact/effort-ranked roadmap. READ-ONLY — surveys and reports; edits nothing.',
  phases: [
    { title: 'Survey', detail: '9 lens-agents each audit one optimization dimension against the real repo' },
    { title: 'Ground', detail: 'adversarially verify each opportunity: not-already-done, evidence holds, impact/effort honest' },
    { title: 'Synthesize', detail: 'dedup + rank by impact/effort into a prioritized roadmap' },
  ],
}

const REPO = '/path/to/interview-prep'
const FACTS = `
Repo facts (verified before this run — treat as ground truth, but READ FILES to confirm specifics):
- Content: 430 topics across 19 domains; each is topics/<domain>/<slug>/{concepts.md, questions.yaml}.
  ~2M words of concepts; 21,088 MCQs total. Content contract: docs/content-schema.md. Validator:
  scripts/validate_content.py (Python+PyYAML), run MANUALLY (checks ids/answer-index/options/ref anchors).
- A corpus teaching-quality audit + 4-wave refinement just completed (worked examples, correctness,
  jargon, diagrams). Per-domain topics/<domain>/CONTENT-AUDIT.md + topics/CONTENT-AUDIT-MASTER.md exist.
- Web app: web/ — Astro 5 (static output) + Tailwind 3 + one Preact island (web/src/components/
  PracticeSession.tsx). Search = Pagefind (build-time index). Mermaid diagrams rendered. CSP headers
  generated (web/scripts/gen-csp-headers.mjs). Build: sync-content.mjs → astro build → pagefind → CSP.
- web/scripts/sync-content.mjs reads topics/ and generates the content collection + per-pool question
  JSON in web/public/questions/ (43MB total; system-design pool alone 13MB). Island fetches .slim.json
  (no explanations); explanations lazy-loaded from _explanations.json per pool.
- Routes: index, catalog, progress, domain/[domain], study/[domain]/[slug], topic/[domain]/[slug],
  practice/[domain], practice/[domain]/[slug]. localStorage progress prefix: ip:practice:v1:.
- NO automated tests anywhere. NO CI (.github/workflows absent). Site name: LoopReady (loopready.io),
  deploys static dist/ to Netlify/Vercel.
- Deferred backlog (in memory, not yet built): Pagefind search deep-dive (coverage/ranking), SRS-light
  spaced repetition, mastery grid, streaks, achievement badges, review-missed, dark/light theme (site is
  dark-only by decision — needs sign-off to change).
- Locked decisions (do NOT propose reversing without flagging as needs-sign-off): Astro static stack (no
  SSR/backend; a Python TUI was dropped); content model (concepts.md + linked questions.yaml); stable
  slugs; dark-only theme.
`

const LENSES = [
  { key: 'testing-ci', title: 'Testing & CI/CD',
    brief: `The project has 430 topics, a build pipeline, and a Preact island but ZERO automated tests and NO CI. ` +
    `Audit: what should be tested and how (content-validation in CI; MCQ answer/structure invariants; a build ` +
    `smoke test; link/anchor integrity; the PracticeSession island logic; visual/DOM regression; mermaid render ` +
    `check). Propose a concrete CI pipeline (GitHub Actions) and a pragmatic test suite that fits a static site. ` +
    `Read scripts/validate_content.py, web/package.json, web/scripts/*.mjs, web/src/components/PracticeSession.tsx.` },
  { key: 'content-pedagogy', title: 'Content pedagogy, coverage & freshness',
    brief: `Assess remaining content opportunities BEYOND the refinement just done: coverage gaps (TOPICS.md vs ` +
    `authored; domains a senior backend/staff candidate would expect but are missing/thin), cross-linking between ` +
    `related subtopics, a "further reading"/references discipline, staleness-recheck cadence for version/limit ` +
    `facts, and consistency of the teaching standard across domains. Read TOPICS.md, ROADMAP.md, a sample of ` +
    `concepts.md across domains, and topics/CONTENT-AUDIT-MASTER.md. Do NOT re-propose the refinement already done.` },
  { key: 'mcq-quality', title: 'MCQ bank quality & assessment design',
    brief: `21,088 MCQs exist. Audit their QUALITY as an assessment instrument: duplicate/near-duplicate questions ` +
    `within a pool, distractor quality (implausible or "all of the above"-style), difficulty-tier balance and ` +
    `calibration, answer-position bias (is the correct index randomized?), explanation quality, coverage of each ` +
    `concepts.md section by at least one MCQ, and whether questions test understanding vs recall. Propose automated ` +
    `checks + a sampling audit. Read docs/content-schema.md and several questions.yaml; use scripts to compute stats.` },
  { key: 'web-performance', title: 'Web performance & build',
    brief: `43MB of generated question JSON (system-design pool 13MB); static Astro site with a Preact island and ` +
    `client-side mermaid. Audit: payload sizes actually shipped to the browser (slim vs full pools, what the island ` +
    `fetches), mermaid rendering cost (client vs build-time SVG), font loading, build time and its scaling with ` +
    `content, cache headers, code-splitting, and Core Web Vitals risks. Quantify where possible (read the generated ` +
    `JSON sizes, sync-content.mjs, PracticeSession.tsx, astro.config, gen-csp-headers.mjs). Propose concrete wins.` },
  { key: 'ux-engagement', title: 'UX, engagement & retention',
    brief: `Audit the learner experience and propose engagement/retention features that fit a static, no-backend, ` +
    `localStorage-only app. Consider the deferred backlog (SRS-light spaced repetition, mastery grid, streaks, ` +
    `achievement badges, review-missed queue, search deep-dive) AND anything new (bookmarks, progress export/import, ` +
    `keyboard-driven practice, "explain like an interviewer" mode, per-topic confidence tracking). Rank by ` +
    `learner value vs build cost. Read PracticeSession.tsx, progress.astro, lib/progress.ts, the pages/ routes.` },
  { key: 'accessibility', title: 'Accessibility (a11y)',
    brief: `Audit accessibility against WCAG 2.2 AA for a study/quiz site: keyboard navigation of the practice ` +
    `island, focus management, ARIA roles/labels for the quiz and nav, color-contrast of the dark theme tokens, ` +
    `screen-reader experience for MCQs and results, mermaid diagram alt-text/fallbacks, prefers-reduced-motion, ` +
    `heading structure, and skip-links. Read BaseLayout.astro, global.css (design tokens), PracticeSession.tsx, ` +
    `and a study page. Propose concrete fixes; flag anything that is a legal/ethical must-fix.` },
  { key: 'seo-discoverability', title: 'SEO & discoverability',
    brief: `A public learning site (loopready.io) with 430 study pages — audit discoverability: sitemap.xml, ` +
    `robots.txt, per-page meta description/title, canonical URLs, Open Graph / Twitter cards, JSON-LD structured ` +
    `data (Course/LearningResource/FAQPage/BreadcrumbList), heading semantics, internal linking for crawl depth, ` +
    `and whether the MCQ content can surface as rich results. Read BaseLayout.astro, astro.config, public/, the ` +
    `page routes. Propose concrete additions (most are cheap Astro wins with outsized reach).` },
  { key: 'data-build-arch', title: 'Data model, build architecture & maintainability',
    brief: `Audit the architecture for maintainability and scale: the concepts.md+questions.yaml data model and its ` +
    `limits, the 43MB generated-JSON footprint and whether it belongs in git/build, sync-content.mjs design, ` +
    `dependency freshness/security (Astro/Tailwind/mermaid/preact versions), CSP hardening, the mermaid-*.mjs helper ` +
    `scripts (are they dead code? 3 uncommitted ones exist), secrets/headers, and repo hygiene (uncommitted scratch ` +
    `files). Read web/package.json, sync-content.mjs, astro.config, gen-csp-headers.mjs, .gitignore. Propose cleanups.` },
  { key: 'learning-analytics', title: 'Learning science & analytics (no-backend)',
    brief: `Without adding a backend, how can the app MEASURE and IMPROVE learning outcomes? Audit/propose: ` +
    `client-side difficulty calibration (are tiers empirically right given local accuracy?), question-level analytics ` +
    `from localStorage (weak-area detection, forgetting-curve scheduling), self-assessment/confidence capture, ` +
    `optional privacy-respecting aggregate analytics (Plausible-style) to learn which topics are hardest, and ` +
    `evidence-based study features (interleaving, retrieval practice, spacing). Ground in lib/progress.ts + ` +
    `PracticeSession.tsx. Distinguish what's doable client-only vs what would need a backend (flag the latter).` },
]

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      description: 'up to 7 concrete opportunities, most-impactful first; empty only if the dimension is genuinely already excellent',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'opportunity', 'evidence', 'impact', 'effort', 'already_partial', 'needs_signoff'],
        properties: {
          title: { type: 'string', description: 'short label (<=8 words)' },
          opportunity: { type: 'string', description: 'what to do and the concrete win, 1-3 sentences' },
          evidence: { type: 'string', description: 'the specific file/fact/measurement grounding this (cite a path or number)' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'], description: 'learner/quality/reach value' },
          effort: { type: 'string', enum: ['S', 'M', 'L'], description: 'S=<half day, M=1-3 days, L=multi-day' },
          already_partial: { type: 'boolean', description: 'true if partially done already (say what remains in opportunity)' },
          needs_signoff: { type: 'boolean', description: 'true if it touches a locked decision (stack/theme/data-model)' },
        },
      },
    },
  },
}

// ---- Phase 1: parallel lens survey ----
phase('Survey')
const surveys = await parallel(LENSES.map((L) => () =>
  agent(
    `You are a Senior Principal Engineer auditing ONE dimension of an interview-prep learning project for ` +
    `optimization & enhancement opportunities. Be concrete, honest, and REPO-GROUNDED — actually Read/Grep the ` +
    `files named below (and any others you need) so every finding cites real evidence, not speculation.\n\n` +
    `${FACTS}\n\nYOUR LENS — ${L.title}:\n${L.brief}\n\n` +
    `Rules: Only surface opportunities that are NOT already fully done (mark already_partial=true if partial). Rank ` +
    `most-impactful first. Be calibrated on impact/effort. If something touches a locked decision, set ` +
    `needs_signoff=true rather than omitting it. Quantify with real numbers where you can. Return up to 7 findings.`,
    { label: `survey:${L.key}`, phase: 'Survey', effort: 'high', schema: FINDINGS_SCHEMA }
  )
))

// flatten + tag with lens
const raw = []
surveys.filter(Boolean).forEach((s) => (s.findings || []).forEach((f) => raw.push({ ...f, lens: s.lens })))
log(`Survey: ${raw.length} raw opportunities across ${surveys.filter(Boolean).length} lenses`)

// ---- Phase 2: adversarially ground each opportunity against the repo ----
phase('Ground')
const GROUND_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'verdict', 'corrected_impact', 'corrected_effort', 'grounding_note'],
  properties: {
    title: { type: 'string' },
    verdict: { type: 'string', enum: ['valid', 'already-done', 'overstated', 'invalid'], description: 'valid=real & not done; already-done=already shipped; overstated=real but impact/effort wrong; invalid=evidence does not hold' },
    corrected_impact: { type: 'string', enum: ['high', 'medium', 'low'] },
    corrected_effort: { type: 'string', enum: ['S', 'M', 'L'] },
    grounding_note: { type: 'string', description: 'what the repo check found (cite the file/line/fact); why the verdict' },
  },
}
const grounded = await parallel(raw.map((f) => () =>
  agent(
    `You are an adversarial reviewer verifying ONE proposed optimization against the ACTUAL repo at ${REPO}. ` +
    `Your job is to prevent already-done or speculative items from reaching the roadmap.\n\n` +
    `PROPOSAL (lens: ${f.lens}):\n- title: ${f.title}\n- opportunity: ${f.opportunity}\n- evidence claimed: ${f.evidence}\n` +
    `- claimed impact/effort: ${f.impact}/${f.effort}\n\n` +
    `Read/Grep the relevant files to CHECK: (1) Is it already implemented (fully)? If so verdict=already-done. ` +
    `(2) Does the cited evidence actually hold? If not verdict=invalid. (3) Are impact & effort honest? If materially ` +
    `off verdict=overstated and give corrected values. (4) Otherwise verdict=valid. Set corrected_impact/effort to ` +
    `your best calibrated call (same as claim if fair). Ground your note in a real file/fact. Be skeptical.`,
    { label: `ground:${f.lens}:${(f.title||'').slice(0,24)}`, phase: 'Ground', effort: 'medium', schema: GROUND_SCHEMA }
  )
))

// merge grounding verdicts back
const verified = raw.map((f, i) => {
  const g = grounded[i]
  if (!g) return { ...f, verdict: 'valid', corrected_impact: f.impact, corrected_effort: f.effort, grounding_note: '(grounding agent returned null; using original)' }
  return { ...f, verdict: g.verdict, corrected_impact: g.corrected_impact, corrected_effort: g.corrected_effort, grounding_note: g.grounding_note }
})
const survivors = verified.filter((f) => f.verdict === 'valid' || f.verdict === 'overstated')
const dropped = verified.filter((f) => f.verdict === 'already-done' || f.verdict === 'invalid')
log(`Ground: ${survivors.length} survive (${dropped.length} dropped as already-done/invalid)`)

// ---- Phase 3: synthesize the roadmap ----
phase('Synthesize')
const compact = survivors.map((f) => ({
  lens: f.lens, title: f.title, opportunity: f.opportunity, evidence: f.evidence,
  impact: f.corrected_impact, effort: f.corrected_effort, already_partial: f.already_partial,
  needs_signoff: f.needs_signoff, verdict: f.verdict, note: f.grounding_note,
}))
const dropList = dropped.map((f) => ({ lens: f.lens, title: f.title, verdict: f.verdict, note: f.grounding_note }))

const roadmap = await agent(
  `You are a Senior Principal Engineer writing the OPTIMIZATION & ENHANCEMENT ROADMAP for the interview-prep ` +
  `project, for the repo owner. You are given ${compact.length} repo-grounded, adversarially-verified opportunities ` +
  `(already-done/invalid ones already removed) as JSON:\n\n${JSON.stringify(compact)}\n\n` +
  `Also, for transparency, these were DROPPED during grounding (already-done or invalid):\n${JSON.stringify(dropList)}\n\n` +
  `Write a clear, skimmable Markdown report and SAVE it with the Write tool to ${REPO}/OPTIMIZATION-ROADMAP.md . It MUST contain:\n` +
  `1. "# Optimization & Enhancement Roadmap" + a 2-3 sentence executive summary (overall project health + the single ` +
  `biggest gap + the theme of the highest-value work).\n` +
  `2. "## Top recommendations (ranked)" — a table: # | Opportunity | Dimension | Impact | Effort | Notes. Rank by ` +
  `value-for-effort (high-impact/low-effort first). Merge any semantic duplicates across lenses into one row.\n` +
  `3. "## Quick wins (high impact, S effort)" — a short bulleted list a maintainer could knock out in a day, each ` +
  `with the concrete first step.\n` +
  `4. "## Bigger bets (M/L effort, high impact)" — the multi-day investments worth planning, grouped by theme ` +
  `(e.g. Testing/CI, Engagement, Performance, Discoverability), each with what it unlocks.\n` +
  `5. "## Needs sign-off" — anything touching a locked decision (stack/theme/data-model), stated as a question for ` +
  `the owner.\n` +
  `6. "## Explicitly not recommended / already done" — briefly note the dropped items so the owner knows they were ` +
  `considered.\n\nBe concrete, honest, and prioritized. Return one line: "roadmap written: <n> recommendations, <q> quick wins".`,
  { label: 'synthesize:roadmap', phase: 'Synthesize', effort: 'high' }
)

return {
  raw: raw.length, survivors: survivors.length, dropped: dropped.length,
  by_impact_effort: survivors.reduce((acc, f) => { const k = `${f.corrected_impact}/${f.corrected_effort}`; acc[k] = (acc[k]||0)+1; return acc }, {}),
  roadmap,
}
