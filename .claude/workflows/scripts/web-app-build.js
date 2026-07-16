export const meta = {
  name: 'web-app-build',
  description: 'Build a minimalist, responsive Astro website that publishes concepts.md as HTML and offers 25-MCQ practice sessions (subtopic + parent level), with a landing page, grouped catalog, domain and subtopic pages. Static output for Netlify/Vercel.',
  phases: [
    { title: 'Foundation', detail: 'scaffold Astro + Tailwind + Preact, content-sync pipeline, Layout/design tokens, freeze CONTRACT.md, prove build' },
    { title: 'Features', detail: 'parallel: landing page; catalog+domain+subtopic pages; study page; practice island — all against the contract' },
    { title: 'Integrate', detail: 'run sync + build, fix all errors, smoke-test routes/content/practice/anchors' },
  ],
}

const REPO = '/path/to/interview-prep'
const WEB = `${REPO}/web`

// The 8 advanced/expert deep-dive slugs (for System Design grouping).
const ADVANCED_SD = [
  'interview-method-scenario-playbooks', 'consensus-clocks-and-time',
  'distributed-transactions-advanced', 'capacity-modeling-and-tail-latency',
  'failure-theory-advanced', 'data-internals-storage-engines',
  'probabilistic-data-structures', 'microservices-ddd-and-boundaries',
].join(', ')

const SHARED = `
PROJECT CONTEXT
- Repo root: ${REPO}. Content lives in ${REPO}/topics/<domain>/<subtopic>/{concepts.md, questions.yaml}.
- Each questions.yaml has: topic (human title), domain (slug), topic_slug, version, questions[]
  where each question = {id, difficulty, tags[], question, options[3-5], answer (0-based index),
  explanation, ref (optional "concepts.md#anchor")}.
- Each concepts.md starts with "# <Title>" H1 then "## <Subtopic>" H2 sections (GitHub-slug anchors,
  which the ref fields point at — lowercase, spaces->-, punctuation stripped, '&' leaves a double dash).
- AUTHORED domains (browsable): system-design (57 subtopics), spring-boot (18), spring-core (19),
  java-jvm (25). Domain display titles come from the first line of topics/<domain>/README.md.
- NOT-yet-authored domains (show as disabled "Coming soon" cards, non-clickable): docker, kubernetes,
  devops-cicd, hibernate-jpa, apache-tomcat, messaging-databases. Their display names are in TOPICS.md.
- SYSTEM-DESIGN GROUPING (only this domain is grouped; others are single-group):
    * "AWS System Design" = every subtopic slug starting with "aws-"
    * "Advanced & Expert Deep-Dives" = these 8 slugs: ${ADVANCED_SD}
    * "Core Topics" = all remaining system-design slugs
- The site is STATIC (no backend). Practice score/progress persists in localStorage.

TECH / CONVENTIONS (frozen by the Foundation phase — do NOT change them):
- Astro (latest), static output (no SSR adapter). Tailwind CSS for styling. Preact island ONLY for the
  interactive practice quiz. TypeScript. Node ESM (.mjs) for the sync script.
- Minimalist, responsive, mobile-first design; light + dark mode (prefers-color-scheme + a toggle);
  accessible (semantic HTML, keyboard-navigable, visible focus, aria where needed). Restrained palette,
  system font stack, comfortable reading measure for study content.
- Web app lives entirely in ${WEB}. Never modify files under ${REPO}/topics (read-only source of truth).
`

// ---------------- Phase 1: Foundation ----------------
phase('Foundation')
const foundation = await agent(
  `You are a senior front-end engineer scaffolding a static Astro website for an interview-prep learning ` +
  `platform. Build the FOUNDATION only; other agents will add pages against your contract.\n\n${SHARED}\n\n` +
  `DELIVERABLES (create under ${WEB}):\n` +
  `1) A working Astro + Tailwind + Preact project scaffolded NON-INTERACTIVELY (write package.json, ` +
  `astro.config.mjs, tsconfig.json, tailwind config as needed by hand; then run npm install). Pin sensible ` +
  `recent versions. Integrations: @astrojs/tailwind (or Tailwind v4 via @tailwindcss/vite — pick one and be ` +
  `consistent), @astrojs/preact. Markdown pipeline: enable GFM (remark-gfm) for the comparison tables in ` +
  `concepts.md, Shiki syntax highlighting (built-in), and heading anchors via rehype-slug + ` +
  `rehype-autolink-headings so that GitHub-style anchors match the ref fields (e.g. concepts.md#some-heading ` +
  `-> #some-heading on the study page). VERIFY the slug algorithm matches github-slugger (it does by default).\n` +
  `2) scripts/sync-content.mjs — a Node ESM script that reads ${REPO}/topics and generates:\n` +
  `   - src/content/concepts/<domain>/<slug>.md : copy of each concepts.md with YAML frontmatter PREPENDED ` +
  `     (title from the H1, domain, slug, group) so it loads as an Astro content collection entry. Strip the ` +
  `     original leading "# H1" line from the body (the page shows the title in its header) OR keep it — pick ` +
  `     one and note it in the contract.\n` +
  `   - public/questions/<domain>/<slug>.json : that subtopic's questions (array; keep id, difficulty, tags, ` +
  `     question, options, answer, explanation, ref, plus injected domain + topic_slug so the practice island ` +
  `     can build a "Learn more" link to /study/<domain>/<slug>#<anchor>).\n` +
  `   - public/questions/<domain>/_all.json : all questions in the domain (for parent-level practice).\n` +
  `   - public/questions/system-design/_group-<groupKey>.json : per-group pools for system-design ` +
  `     (core, advanced, aws) for "Practice this group".\n` +
  `   - src/data/catalog.json : the full catalog manifest the pages render from. Shape (document EXACTLY in ` +
  `     the contract): { domains: [ { slug, title, authored (bool), subtopicCount, questionCount, ` +
  `     groups: [ { key, label, subtopics: [ { slug, title, questionCount } ] } ] } ] }. For non-authored ` +
  `     domains set authored:false and title from TOPICS.md; they have no groups/subtopics.\n` +
  `     Parse questions.yaml with a YAML lib (add 'yaml' or 'js-yaml' to devDeps). Derive each subtopic title ` +
  `     from its questions.yaml 'topic' field (fallback: concepts.md H1). Derive system-design groups per the ` +
  `     grouping rules above; other authored domains get a single group {key:'all', label:'', subtopics:[...]}.\n` +
  `   Wire npm scripts: "sync": "node scripts/sync-content.mjs", "build": "node scripts/sync-content.mjs && ` +
  `astro build", "dev": "node scripts/sync-content.mjs && astro dev". Make sync idempotent (clean its output ` +
  `dirs first). Add generated dirs (src/content/concepts, public/questions, src/data/catalog.json) to a ` +
  `web/.gitignore so generated artifacts are not committed.\n` +
  `3) src/content/config.ts (or content.config.ts per Astro version) defining the 'concepts' collection ` +
  `(type:'content', schema: title/domain/slug/group).\n` +
  `4) src/layouts/BaseLayout.astro — the shared shell: responsive header (site name -> home, a Catalog link, ` +
  `dark-mode toggle that persists in localStorage and respects prefers-color-scheme with NO flash of wrong ` +
  `theme), <main> slot, minimal footer. Semantic + accessible.\n` +
  `5) src/styles/global.css — Tailwind entry + design tokens (CSS custom properties for colors light/dark, ` +
  `spacing, radius), base typography, and a '.prose'-style ruleset for rendered concept HTML (readable ` +
  `measure ~68ch, styled headings/lists/code blocks/TABLES/blockquotes, anchored-heading link affordance). ` +
  `If you use Tailwind Typography plugin that's fine; otherwise hand-roll the prose styles.\n` +
  `6) A tiny src/lib/ with shared TS helpers + types (Catalog types matching catalog.json; a seeded shuffle ` +
  `and a "pick N (default 25)" sampler used by practice; a slugify note). Export clean types other agents import.\n` +
  `7) netlify.toml (base = "web", build command "npm run build", publish "web/dist") and set 'site'/base ` +
  `appropriately in astro.config for static hosting on Netlify/Vercel (both serve static dist; no adapter).\n` +
  `8) Run 'npm run sync' then 'npm run build' and CONFIRM the scaffold builds green (fix until it does). It's ` +
  `fine if there are no real pages yet beyond a placeholder index — the point is a proven toolchain + data.\n\n` +
  `FINALLY: write ${WEB}/CONTRACT.md documenting for the next agents: exact directory layout; the catalog.json ` +
  `shape (with a real example excerpt); the question JSON shape + file locations/URLs; the concepts collection ` +
  `API (how to getCollection('concepts'), find an entry by domain+slug, and render() it); BaseLayout usage + ` +
  `props; global CSS classes/tokens available (esp. the prose wrapper class name); the lib helpers/types and ` +
  `their import paths; the route map the pages must implement (below); and how anchors line up for Learn-more.\n` +
  `ROUTE MAP the feature agents will implement (state these in the contract):\n` +
  `   /                                   landing page\n` +
  `   /catalog                            all domains (grouped/authored + coming-soon)\n` +
  `   /domain/[domain]                    a domain's subtopics (grouped sections + client filter + per-group/` +
  `whole-domain Practice buttons)\n` +
  `   /topic/[domain]/[slug]              a subtopic hub: choose Study or Practice\n` +
  `   /study/[domain]/[slug]              renders concepts.md as HTML (with in-page TOC + heading anchors)\n` +
  `   /practice/[domain]/[slug]           subtopic practice session (25 MCQs)\n` +
  `   /practice/[domain]                  parent/domain-level practice session (25 MCQs from _all.json)\n` +
  `   (system-design group practice can be /practice/[domain]?group=<key> reading _group-<key>.json, OR a ` +
  `   dedicated route — decide and document.)\n` +
  `Use getStaticPaths to prerender all authored routes from catalog.json. Return a concise summary of what ` +
  `you built and CONFIRM the build passed.`,
  { label: 'foundation', phase: 'Foundation', effort: 'high' }
)

// ---------------- Phase 2: Features (parallel, distinct files) ----------------
phase('Features')
const FEATURE = (name, task) => agent(
  `You are a front-end engineer adding a feature to an ALREADY-SCAFFOLDED Astro site. FIRST read ` +
  `${WEB}/CONTRACT.md in full, plus the files it references (BaseLayout, global.css, src/lib types, ` +
  `catalog.json, astro.config). Build STRICTLY against that contract: reuse BaseLayout, the prose class, the ` +
  `design tokens, and the shared types/helpers — do NOT introduce a parallel styling system, do NOT edit ` +
  `astro.config / global.css / BaseLayout / the sync script / package.json (those are frozen; if you truly ` +
  `need a change, note it in your return message for the Integrate phase instead of editing).\n\n${SHARED}\n\n` +
  `Write ONLY your own files (your pages/components). Do NOT run npm install or npm build (the Integrate phase ` +
  `does that). Match the minimalist, responsive, accessible, light/dark aesthetic already established.\n\n` +
  `YOUR TASK:\n${task}\n\nReturn one line listing the files you created.`,
  { label: name, phase: 'Features', effort: 'high' }
)

const features = await parallel([
  () => FEATURE('feat:landing',
    `Build the LANDING page (src/pages/index.astro). A clean, minimal hero: product name + one-line value ` +
    `prop ("Study interview concepts and practice thousands of MCQs — on any device"), a primary CTA to ` +
    `/catalog ("Browse the catalog"), and a compact stats/among strip pulled from catalog.json (e.g. number ` +
    `of authored domains, total subtopics, total questions — compute from catalog.json at build). Optionally a ` +
    `short "How it works" three-step (Browse -> Study -> Practice). Fully responsive, works great on mobile. ` +
    `Use BaseLayout.`),

  () => FEATURE('feat:catalog-nav',
    `Build THREE pages + any small shared components:\n` +
    `(a) src/pages/catalog.astro — the full catalog. Render authored domains as clickable cards (title, ` +
    `subtopic count, question count) linking to /domain/<slug>; render not-yet-authored domains as visibly ` +
    `disabled "Coming soon" cards (not links). Responsive card grid.\n` +
    `(b) src/pages/domain/[domain].astro — use getStaticPaths over authored domains. Show the domain title and, ` +
    `for system-design, the subtopics under labeled GROUP sections (Core Topics / Advanced & Expert Deep-Dives / ` +
    `AWS System Design) in the catalog order; other domains show a single ungrouped list. Each subtopic is a ` +
    `card/row linking to /topic/<domain>/<slug> (show its question count). Add a client-side FILTER input ` +
    `(vanilla JS in a <script>, no framework) that filters subtopics by title as you type. Provide Practice ` +
    `buttons: one "Practice this domain" (-> /practice/<domain>) and, for system-design, a "Practice this group" ` +
    `per group (-> the group practice route/URL defined in the contract).\n` +
    `(c) src/pages/topic/[domain]/[slug].astro — getStaticPaths over all authored subtopics. A simple hub for one ` +
    `subtopic: its title, and two large clear choices — "Study" (-> /study/<domain>/<slug>) and "Practice 25 ` +
    `questions" (-> /practice/<domain>/<slug>), plus a back link to the domain. Show the subtopic's question ` +
    `count. Reuse shared card styling.`),

  () => FEATURE('feat:study',
    `Build the STUDY page: src/pages/study/[domain]/[slug].astro. getStaticPaths over all authored subtopics ` +
    `(from the concepts collection / catalog.json per the contract). Load the matching 'concepts' collection ` +
    `entry, render() it, and display the rendered HTML inside the prose wrapper class from global.css so tables, ` +
    `code blocks, and headings are styled. Page header shows the subtopic title + domain (breadcrumb back to ` +
    `/domain/<domain>). Include an in-page Table of Contents built from the entry's H2 headings (use the ` +
    `headings from render()); TOC links jump to the heading anchors (which must match github-slugger so the ` +
    `Learn-more deep links like #some-heading work). Add a prominent "Practice this topic" button linking to ` +
    `/practice/<domain>/<slug>. Ensure smooth scroll + scroll-margin so anchored headings aren't hidden under a ` +
    `sticky header. Fully responsive (TOC collapses/moves on mobile).`),

  () => FEATURE('feat:practice',
    `Build the PRACTICE experience: a Preact island + the practice pages.\n` +
    `(1) src/components/PracticeSession.tsx — a Preact component (client-loaded) that takes a questions pool ` +
    `(fetched from the public/questions JSON URL passed as a prop) and runs a session: on mount, sample 25 ` +
    `questions (or all if fewer) using the contract's sampler, and SHUFFLE both question order and the options ` +
    `within each question (remap the correct answer index accordingly!). Flow = IMMEDIATE per-question feedback: ` +
    `show one question at a time with its options as buttons; on selection, lock the choice, highlight ` +
    `correct/incorrect, reveal the explanation and a "Learn more" link to /study/<domain>/<slug>#<anchor> built ` +
    `from the question's ref (only if ref present), and show a Next button; keep a running score + progress ` +
    `("Q 7 / 25"). At the end show a results summary (score, %, and a per-question review list) with "Retry ` +
    `(new 25)" and "Back to topic" actions. Persist to localStorage: per-pool attempts + best score (define a ` +
    `stable key from the pool id). Keyboard accessible (arrow/enter or number keys to answer), visible focus, ` +
    `aria-live for feedback. Style with the site tokens (inline Tailwind classes are fine in the island; keep ` +
    `it minimalist and responsive).\n` +
    `(2) src/pages/practice/[domain]/[slug].astro — getStaticPaths over authored subtopics; renders BaseLayout ` +
    `+ <PracticeSession client:load poolUrl="/questions/<domain>/<slug>.json" backHref="/topic/<domain>/<slug>" ` +
    `title=.../>. \n` +
    `(3) src/pages/practice/[domain].astro — getStaticPaths over authored domains; parent-level practice using ` +
    `poolUrl "/questions/<domain>/_all.json". Also support system-design GROUP practice per the contract (either ` +
    `read a ?group= query param client-side to choose the _group-<key>.json pool, or implement the dedicated ` +
    `route the contract specifies) — match whatever the Foundation contract defined. Show a heading indicating ` +
    `the scope ("Practicing: <domain>" / group label). Handle the empty/short pool gracefully.`),
])

// ---------------- Phase 3: Integrate & verify ----------------
phase('Integrate')
const integrate = await agent(
  `You are the integration + QA engineer for the Astro interview-prep site in ${WEB}. The Foundation and ` +
  `Feature phases are done. Your job: make it BUILD and WORK end-to-end.\n\n${SHARED}\n\n` +
  `Read CONTRACT.md and the feature agents' notes (some may have requested a frozen-file change). Then:\n` +
  `1) Run 'npm run sync' and 'npm run build' from ${WEB}. Iterate until the build is fully GREEN. Fix all ` +
  `type errors, import path mismatches, getStaticPaths issues, missing props, Tailwind/Preact config issues, ` +
  `content-collection schema mismatches, and any contract drift between agents (e.g. a page expecting a ` +
  `different catalog shape or JSON URL than the sync produced). Prefer fixing the consumer to match the frozen ` +
  `contract; only change a frozen file if genuinely necessary and say so.\n` +
  `2) SMOKE-TEST the generated dist/ (static HTML). Confirm: dist/index.html exists; a catalog page lists the ` +
  `4 authored domains and the coming-soon ones; at least one system-design domain page shows the three group ` +
  `section labels (Core / Advanced / AWS); a sample study page (e.g. ` +
  `/study/system-design/probabilistic-data-structures) contains rendered concept HTML including a <table> and ` +
  `heading anchors whose ids match github-slugger; the practice JSON pools exist under dist (e.g. ` +
  `dist/questions/system-design/probabilistic-data-structures.json is non-empty and _all.json is large). Use ` +
  `grep over dist/ and node to verify. Report concrete evidence (counts, greps).\n` +
  `3) Verify a Learn-more anchor actually resolves: pick a question with a ref, compute the target anchor, and ` +
  `confirm that id exists in the corresponding study page HTML.\n` +
  `4) Do a quick responsiveness/a11y sanity pass on the built HTML/CSS (viewport meta present, semantic ` +
  `landmarks, buttons are <button>, images/icons have labels, color-mode toggle present). Fix obvious gaps.\n` +
  `5) Confirm generated artifacts are gitignored (src/content/concepts, public/questions, src/data/catalog.json, ` +
  `dist, node_modules) so only source is committed.\n\n` +
  `Return a concise report: build status, route/page inventory actually produced, the smoke-test evidence ` +
  `(question counts, table/anchor checks, Learn-more anchor check), any frozen-file changes you made and why, ` +
  `and how to run it locally ('cd web && npm install && npm run dev') and deploy (Netlify/Vercel static).`,
  { label: 'integrate', phase: 'Integrate', effort: 'high' }
)

return { foundation, features: features.filter(Boolean), integrate }
