export const meta = {
  name: 'web-ui-enhance',
  description: 'Enhance the Astro interview-prep site into a bold, modern, expressive, highly responsive experience: OKLCH design system, native CSS scroll-driven animations + Astro View Transitions, Motion-powered quiz island, fluid type, then a code-review + security verification pass.',
  phases: [
    { title: 'DesignSystem', detail: 'freeze OKLCH tokens, fluid type, global CSS, ClientRouter, Motion install, ENHANCE-CONTRACT.md; prove build' },
    { title: 'Enhance', detail: 'parallel: landing; catalog+domain+nav; study; practice island (Motion) — all against the design system' },
    { title: 'Integrate', detail: 'run sync + build, fix all errors, smoke-test routes/motion/a11y' },
    { title: 'Review', detail: 'code-review + security + correctness pass on web/, fix confirmed issues, re-verify build' },
  ],
}

const WEB = '/path/to/interview-prep/web'

// ---- Verified research findings the agents MUST follow (from the deep-research run) ----
const RESEARCH = `
RESEARCH-BACKED RULES (these were fact-checked & adversarially verified — follow them exactly):
- MOTION PERFORMANCE: animate ONLY compositor-friendly properties — transform and opacity. NEVER animate
  width/height/top/left/margin/background-color for motion (they hit the main thread and jank). Use native
  CSS scroll-driven animations (animation-timeline: view()/scroll()) for entrance/reveal effects — they run
  off the main thread.
- ROUTE TRANSITIONS: use Astro's <ClientRouter /> (View Transitions). It auto-degrades on non-Chromium and
  auto-disables when prefers-reduced-motion is set. That auto-disable ONLY covers Astro-generated animations —
  every hand-written animation you add MUST itself be gated behind @media (prefers-reduced-motion: no-preference)
  (i.e. motion only for users who have NOT requested reduced motion). Provide a static, non-animated resting
  state so reduced-motion and older browsers see fully-usable content.
- ACCESSIBILITY GATE: wrap ALL custom motion in prefers-reduced-motion. This is non-negotiable (WCAG 2.3.3).
- FLUID TYPE: use clamp() for fluid type BUT the min and max MUST be in rem (not viewport-only), because
  browsers do not scale vw on zoom — a viewport-only clamp fails WCAG 1.4.4 resize (200%). Pattern:
  clamp(<rem min>, <rem> + <vw>, <rem max>). Body text ~16-20px, line-height unitless ~1.3-1.6, reading
  measure ~60-75ch for long-form study content.
- TOUCH TARGETS: interactive targets >= 24x24 CSS px (WCAG 2.2 SC 2.5.8); quiz answer buttons comfortably
  larger on mobile (44px+ recommended).
- COLOR: OKLCH-based token system, perceptually consistent lightness across light AND dark themes, WCAG AA
  contrast for text (>=4.5:1 body, >=3:1 large/UI). Verify contrast; don't ship an accent that fails AA on
  its intended background.
- SECURITY: do NOT introduce set:html / innerHTML / dangerouslySetInnerHTML / define:vars anywhere. Markdown
  is rendered via Astro's render()+<Content/> (safe, compiled) — keep it that way.
- BROWSER TARGET: modern evergreen (recent Chrome/Edge/Safari/Firefox). You may use container queries, subgrid,
  native scroll-driven animations, @view-transition, OKLCH directly. Still provide a sane static resting state
  (see reduced-motion) so nothing is broken if a feature is unsupported.
`

const CONTEXT = `
PROJECT: a static Astro + Tailwind + Preact site in ${WEB} that publishes interview study notes (markdown ->
HTML via content collections) and runs a client-side 25-MCQ practice quiz. It currently has a MINIMALIST design.
GOAL: make it BOLD, MODERN, EXPRESSIVE, and HIGHLY RESPONSIVE while keeping it fast, accessible, and bug-free.
Read ${WEB}/CONTRACT.md (the original build contract: routes, catalog.json shape, question JSON URLs, lib
helpers, BaseLayout, prose class) BEFORE touching anything. Content lives read-only in ../topics — NEVER edit it.
Existing routes: / , /catalog , /domain/[domain] , /topic/[domain]/[slug] , /study/[domain]/[slug] ,
/practice/[domain]/[slug] , /practice/[domain] (+ ?group= for system-design groups).
System-design groups (color-accent opportunity): Core / Advanced & Expert Deep-Dives / AWS.
Do NOT change routes, the sync script's OUTPUT SHAPE, the catalog/question JSON schemas, or content — only the
LOOK, FEEL, MOTION, and RESPONSIVENESS (and safe internal refactors). Preserve all existing functionality
(study rendering, TOC + anchor deep-links, 25-question sampling, option shuffle + answer remap, immediate
feedback, Learn-more links, localStorage scoring).
${RESEARCH}
`

// ---------------- Phase 1: Design System (frozen foundation) ----------------
phase('DesignSystem')
const designSystem = await agent(
  `You are a world-class product designer + front-end engineer establishing a BOLD, MODERN design system for ` +
  `an existing Astro site, to be consumed by other agents. Build ONLY the shared foundation; do not restyle ` +
  `individual pages yet.\n\n${CONTEXT}\n\n` +
  `DELIVERABLES (edit/replace in place under ${WEB}):\n` +
  `1) src/styles/global.css — a cohesive OKLCH design-token system as CSS custom properties for BOTH light and ` +
  `dark themes: a vivid but tasteful accent family (recommend an indigo->violet direction, your call) over a ` +
  `refined neutral base; semantic tokens (bg, surface, surface-2, border, text, text-muted, primary, ` +
  `primary-contrast, correct, incorrect, plus 3 group-accent tokens for Core/Advanced/AWS). Preserve the EXISTING ` +
  `token NAMES already referenced across the app (bg, surface, surface-2, border, text, text-muted, primary, ` +
  `primary-contrast, correct, incorrect) so nothing breaks — just give them richer values; ADD new tokens ` +
  `rather than renaming. Include: fluid type scale via rem-based clamp() (a --step--1..--step-5 or similar ` +
  `scale + fluid section spacing), an elevation/shadow scale, radii, an expressive but subtle background ` +
  `treatment (e.g. a soft OKLCH gradient/mesh or gradient accents usable behind heroes), and gradient tokens. ` +
  `Keep the '.prose' long-form reading styles (60-75ch measure, styled headings/code/tables/blockquotes, ` +
  `anchored-heading affordance) — upgrade their typography/rhythm/color to the new tokens. Add reusable utility ` +
  `classes used site-wide: '.card' (with hover lift via transform/box-shadow, reduced-motion safe), a gradient ` +
  `text/heading helper, a '.reveal' entrance pattern using NATIVE CSS scroll-driven animations ` +
  `(animation-timeline: view()) that is a NO-OP (fully visible resting state) under prefers-reduced-motion and ` +
  `where unsupported. Verify AA contrast of text tokens on their backgrounds and note the ratios in the contract.\n` +
  `2) src/layouts/BaseLayout.astro — integrate Astro's <ClientRouter /> for smooth route/view transitions ` +
  `(import from 'astro:transitions'); keep the no-flash dark-mode toggle working across client-side navigations ` +
  `(re-init on astro:after-swap; persist in localStorage). Modernize the header/footer chrome (sticky, subtle ` +
  `blur/translucency, refined nav, larger touch targets >=24px) using the tokens. Keep skip-link + landmarks. ` +
  `Add tasteful default view-transition names/animations if helpful, all reduced-motion safe.\n` +
  `3) Install the Motion library for the quiz island: run 'npm install motion' (the 'motion' package; the ` +
  `practice island imports from 'motion/react' via preact/compat, which is already aliased — VERIFY the ` +
  `preact/compat React alias exists in astro.config/tsconfig and add it if missing so 'motion/react' works with ` +
  `Preact). Do NOT convert other islands; Motion is ONLY for the practice quiz.\n` +
  `4) A small src/styles or src/lib note of reusable animation keyframes/classes (fade-up, scale-in, stagger via ` +
  `animation-delay) — all compositor-only (transform/opacity) and reduced-motion gated — that feature agents can ` +
  `apply by adding a class. Keep tailwind.config.mjs compatible (extend theme colors to reference the CSS vars if ` +
  `useful) but do NOT break existing utility usage.\n` +
  `5) Run 'npm run build' and confirm GREEN. Fix anything you broke. The homepage may stay mostly as-is for now; ` +
  `the point is the toolchain + tokens + ClientRouter + Motion all build.\n\n` +
  `FINALLY write ${WEB}/ENHANCE-CONTRACT.md for the feature agents: the full token list (names + light/dark ` +
  `values + measured contrast ratios), the fluid type scale + how to use it, the utility classes (.card, ` +
  `.reveal, gradient helpers, animation classes) with usage examples, the reduced-motion pattern to copy, how ` +
  `ClientRouter is wired (and any per-page transition:name conventions), how to use Motion in the practice ` +
  `island (import path, preact/compat alias, example), and the hard DO-NOT list (no set:html/innerHTML, don't ` +
  `animate layout props, don't rename existing tokens, don't change routes/JSON shapes/content). Return a concise ` +
  `summary + CONFIRM the build passed.`,
  { label: 'design-system', phase: 'DesignSystem', effort: 'high' }
)

// ---------------- Phase 2: Enhance pages (parallel) ----------------
phase('Enhance')
const ENH = (name, task) => agent(
  `You are a senior front-end engineer visually enhancing ONE area of an Astro site whose BOLD design system is ` +
  `already frozen. FIRST read ${WEB}/ENHANCE-CONTRACT.md AND ${WEB}/CONTRACT.md, plus global.css and BaseLayout, ` +
  `so you reuse the tokens, utilities, fluid type, .card, .reveal, animation classes, and reduced-motion pattern ` +
  `EXACTLY. Do NOT edit global.css / BaseLayout / astro.config / tailwind.config / the sync script / package.json ` +
  `(frozen — if you truly need a change, note it in your return for the Integrate phase). Do NOT run npm build ` +
  `(Integrate does). Do NOT change routes, JSON shapes, sampling/scoring logic, or content.\n\n${CONTEXT}\n\n` +
  `YOUR TASK:\n${task}\n\n` +
  `Keep it bold + modern + expressive but tasteful; fully responsive (mobile-first, test mentally at 360px, ` +
  `768px, 1280px); accessible (contrast, focus, 24px+ targets, aria); all motion compositor-only + reduced-motion ` +
  `gated. Return one line listing the files you changed.`,
  { label: name, phase: 'Enhance', effort: 'high' }
)

const enhanced = await parallel([
  () => ENH('enh:landing',
    `Redesign the LANDING page (src/pages/index.astro) into a striking, modern hero-led entry: expressive gradient/` +
    `mesh hero using the accent tokens, bold fluid headline (gradient text helper), clear value prop and primary ` +
    `CTA to /catalog, a live stats strip (domains / subtopics / questions from catalog.json), and a short ` +
    `"How it works" (Browse -> Study -> Practice) with reveal-on-scroll cards. Add tasteful entrance motion ` +
    `(fade-up/stagger) and hover micro-interactions, all reduced-motion safe. Make it feel award-worthy but fast.`),

  () => ENH('enh:catalog-nav',
    `Restyle the CATALOG + navigation pages: src/pages/catalog.astro, src/pages/domain/[domain].astro, ` +
    `src/pages/topic/[domain]/[slug].astro, and the shared components src/components/DomainCard.astro + ` +
    `SubtopicCard.astro. Make domain/subtopic cards modern and tactile (.card hover lift, subtle gradient accents, ` +
    `clear question-count badges); use container queries and/or subgrid for a clean aligned responsive grid; add ` +
    `reveal-on-scroll stagger. For system-design, give the three group sections (Core / Advanced & Expert Deep-Dives ` +
    `/ AWS) distinct group-accent colors from the tokens. Keep the client-side filter input working and style it ` +
    `nicely (search field, 24px+ target). Coming-soon cards: visually distinct, clearly disabled, non-clickable. ` +
    `Keep all existing links/Practice buttons and their targets intact.`),

  () => ENH('enh:study',
    `Elevate the STUDY page (src/pages/study/[domain]/[slug].astro) for beautiful long-form reading: apply the ` +
    `upgraded .prose typography (comfortable measure, rhythm, styled tables/code/blockquotes), a refined sticky ` +
    `in-page TOC with a scroll-progress indicator and active-section highlight (native scroll-driven animation ` +
    `where possible; reduced-motion safe), a strong page header/breadcrumb, and a prominent "Practice this topic" ` +
    `CTA. Ensure heading anchors STILL match github-slugger ids (do not change how Content/headings render — the ` +
    `Learn-more deep links depend on them) and scroll-margin clears the sticky header. Add subtle reveal motion to ` +
    `content sections. Fully responsive: TOC collapses/moves gracefully on mobile.`),

  () => ENH('enh:practice',
    `Enhance the PRACTICE experience: src/components/PracticeSession.tsx (the Preact island) and the two practice ` +
    `pages (src/pages/practice/[domain]/[slug].astro, src/pages/practice/[domain].astro). Use the Motion library ` +
    `(import from 'motion/react' per ENHANCE-CONTRACT.md; works via preact/compat) to add delightful, tasteful ` +
    `animation to the quiz: animated question enter/exit transitions, spring-y option selection, a satisfying ` +
    `correct/incorrect feedback reveal (color + subtle scale/checkmark, compositor-only), an animated progress bar, ` +
    `and a celebratory but tasteful results summary. PRESERVE ALL LOGIC EXACTLY: 25-question sampling (or full pool ` +
    `if smaller), option shuffle WITH correct-answer index remap, immediate per-question feedback + explanation + ` +
    `Learn-more link, running score, localStorage best-score, keyboard accessibility (number keys, arrows+enter, ` +
    `visible focus), aria-live feedback. Respect prefers-reduced-motion (Motion supports useReducedMotion — gate ` +
    `or minimize animation when set). Answer buttons must be 44px+ touch targets on mobile. Style with the design ` +
    `tokens. Keep the empty/error/short-pool graceful states. Do not change the poolUrl/props contract.`),
])

// ---------------- Phase 3: Integrate & verify build ----------------
phase('Integrate')
const integrate = await agent(
  `You are the integration + QA engineer for the enhanced Astro site in ${WEB}. Make it BUILD and WORK.\n\n${CONTEXT}\n\n` +
  `Read ENHANCE-CONTRACT.md and the feature agents' notes (some may have requested a frozen-file change). Then:\n` +
  `1) Run 'npm run sync' then 'npm run build' from ${WEB}. Iterate until FULLY GREEN. Fix type errors, import/alias ` +
  `issues (esp. the 'motion/react' + preact/compat alias), Tailwind/PostCSS/OKLCH issues, ClientRouter integration ` +
  `bugs, content-collection/render breakage, and any drift between agents (token names, class names, prop shapes). ` +
  `Prefer fixing the consumer to match the frozen design system; only touch a frozen file if genuinely necessary.\n` +
  `2) SMOKE-TEST dist/: index/catalog/a domain page/a study page/practice pages all present; study page still has ` +
  `rendered concept HTML incl. a <table> and heading anchors whose ids match github-slugger (Learn-more still ` +
  `resolves — verify one ref anchor exists in the target study HTML); question JSON pools still present + non-empty; ` +
  `no routes generated for coming-soon domains; ClientRouter script present; Motion bundled into the practice island ` +
  `chunk. Report concrete evidence (greps/counts).\n` +
  `3) A11y/responsive sanity on built HTML/CSS: viewport meta, landmarks, buttons are <button>, focus styles, dark ` +
  `mode toggle works, prefers-reduced-motion media queries present in the CSS (grep for it), no obviously ` +
  `layout-animating transitions. Fix obvious gaps.\n` +
  `4) Confirm generated artifacts still gitignored (dist, public/questions, src/content/concepts, src/data/catalog.json, ` +
  `node_modules). Note package.json/lock now include 'motion' (that's expected + committed).\n\n` +
  `Return: build status, what you fixed, smoke-test evidence, and confirm reduced-motion + Learn-more anchors + ` +
  `quiz JSON all intact.`,
  { label: 'integrate', phase: 'Integrate', effort: 'high' }
)

// ---------------- Phase 4: Code review + security ----------------
phase('Review')
const review = await agent(
  `You are a staff front-end engineer + application security reviewer auditing the ENHANCED Astro site in ${WEB} ` +
  `(a STATIC site: markdown rendered via content collections, a client-side Preact+Motion quiz reading static JSON, ` +
  `localStorage for scores; first-party content only, no backend, no user input persisted server-side).\n\n${CONTEXT}\n\n` +
  `Do a rigorous CORRECTNESS + SECURITY + QUALITY review of the web/ source (NOT node_modules, NOT generated ` +
  `artifacts). Focus on REAL, verifiable issues — for each, confirm it by reading the actual code before reporting.\n` +
  `SECURITY: any set:html/innerHTML/dangerouslySetInnerHTML/define:vars introduced (should be NONE — flag if found ` +
  `and assess XSS)? Any unsafe URL/anchor construction from question 'ref' (e.g. javascript: or unescaped hash) in ` +
  `Learn-more links? Any localStorage parse that can throw/crash on malformed data? External links using ` +
  `target=_blank without rel=noopener? Any dependency red flags (check package.json — Astro 5.x, motion, preact ` +
  `versions; note if a known-vuln version). Since content is build-time + first-party and rendered via Astro ` +
  `render(), XSS surface should be minimal — say so honestly, don't invent risk.\n` +
  `CORRECTNESS: verify the practice logic still holds after the Motion refactor — sampling caps at 25, option ` +
  `shuffle REMAPS the correct-answer index (the option shown at the correct position equals the original correct ` +
  `answer), scoring counts correctly, immediate feedback + Learn-more + localStorage persist work, keyboard a11y ` +
  `intact, empty/error/short-pool states handled. Check getStaticPaths cover all authored subtopics and NONE of the ` +
  `6 coming-soon domains. Check reduced-motion truly disables/*minimizes custom motion (grep the CSS + island). ` +
  `Check no animation targets layout properties. Check fluid type uses rem (not viewport-only) mins/maxes.\n` +
  `QUALITY: dead code, broken/duplicate ids, missing alt/aria, contrast regressions, responsiveness gaps.\n` +
  `FIX confirmed issues IN PLACE (conservative, minimal-risk edits). For the practice logic, you may write a tiny ` +
  `throwaway Node script to simulate prepare()/scoring over the real JSON pools to PROVE the remap+scoring are ` +
  `correct (many runs), then delete it. After fixes, run 'npm run build' and confirm GREEN.\n\n` +
  `Return a structured report: (A) Security findings (with severity + whether fixed, or "no issue found" honestly), ` +
  `(B) Correctness findings + the practice-logic proof result, (C) Quality fixes, (D) final build status. Be ` +
  `precise and evidence-based; do not pad with speculative issues.`,
  { label: 'review', phase: 'Review', effort: 'high' }
)

return { designSystem, enhanced: enhanced.filter(Boolean), integrate, review }
