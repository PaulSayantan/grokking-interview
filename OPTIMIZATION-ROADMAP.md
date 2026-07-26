# Optimization & Enhancement Roadmap

**Executive summary.** The project is in strong shape as a content asset — 430 topics / ~21k MCQs behind a fast, static Astro site with sensible performance and security decisions already made. The single biggest structural gap is the **complete absence of any automated gate**: there is no CI, the content validator runs manually, and the site's one interactive component (the quiz) and its pure scoring/streak logic are entirely untested. The highest-value theme is therefore *cheap enforcement plus a handful of near-free growth/quality wins* — stand up CI, fix a few one-line SEO/accessibility/correctness gaps, then invest in the retention mechanics (spaced repetition) and MCQ-bank integrity that turn a good corpus into a great learning tool.

## Top recommendations (ranked)

Ranked by value-for-effort. Semantically duplicate findings across lenses are merged (noted in the row).

| # | Opportunity | Dimension | Impact | Effort | Notes |
|---|-------------|-----------|--------|--------|-------|
| 1 | Add GitHub Actions CI: run `validate_content.py` + `npm run build` on push/PR | Testing/CI | High | S | The one guardrail (validator) is currently manual. Merges the two "no CI" findings. Node 20 matrix matches netlify.toml. |
| 2 | Add Open Graph / Twitter cards + default OG image in BaseLayout | SEO | High | S | Every shared link renders as a bare URL today — suppresses the primary organic-growth channel. Driven by existing title/description props. |
| 3 | Progress export / import (JSON backup of `ip:*` localStorage) on /progress | Engagement | High | S | localStorage-only, single-device today; a cache clear wipes weeks of history. Protects every other retention feature. |
| 4 | Fix undefined `--accent-violet` / `--accent-rose` tokens in dark theme | Accessibility | Med | S | Defined only in light theme; breaks Advanced-pill color + group accents in default dark mode. Add 2 tokens to `:root`. |
| 5 | Reconcile stale ROADMAP progress table (Hibernate 868→1401; dead Tomcat row) | Content freshness | Low | S | Undermines ROADMAP's "single source of truth" role. Small doc edit. |
| 6 | Fix CSP delivery docs that contradict the real mechanism | Maintainability | Med | S | netlify.toml + vercel.json claim meta-tag CSP; reality is `gen-csp-headers.mjs` response headers. A maintainer could silently ship no CSP. |
| 7 | Update CONTRACT.md to the slim-only + `_explanations.json` model | Maintainability | Med | S | Docs reference `_all.json` files that no longer exist; CLAUDE.md calls this the authoritative data-shape ref. |
| 8 | Add `@astrojs/sitemap` + `Sitemap:` line in robots.txt | SEO | Med | S | 1,331 pages, zero sitemap. Ensure it uses the correct prod SITE_URL. |
| 9 | Add named `<slot name="head">` + `jsonLd`/`ogImage` props to BaseLayout | SEO | Med | S | Prerequisite that makes #2 and JSON-LD cleanly implementable per-route. |
| 10 | Extend validator with MCQ invariants (blank/duplicate options, empty explanation) | Testing/CI | Med | S | Cheap correctness floor across all 21k questions; pairs with #1. |
| 11 | Add `@astrojs/check` + `astro check` typecheck script (and run in CI) | Testing/CI | Med | S | `astro build` does not type-check the 8 .ts/.tsx files despite strict config. |
| 12 | Shuffle answer positions in 6 rest-api-design files (>50% one index) | MCQ quality | Med | S | Global spread is fine; bias is localized. Mechanical re-shuffle. |
| 13 | Gate mastery tier on min evidence (seen≥5 + Wilson/shrinkage) | Learning science | Med | S | Today 1/1 correct = green "mastered". One pure function + a new shade. |
| 14 | Preload latin webfonts in BaseLayout (fix FOUT + mermaid render delay) | Performance | Med | S | Late CSS `@import` discovery; mermaid awaits `document.fonts.ready`. |
| 15 | Wrap running score + tier-count summaries in `aria-live` | Accessibility | Low | S | WCAG 4.1.3; consistent with existing feedback live region. |
| 16 | Announce question stem on Next (aria-labelledby / focus heading) | Accessibility | Med | S | SR users never hear the new question today. WCAG 2.4.3/4.1.3. |
| 17 | Keep locked options in SR review (aria-disabled + sr-only correctness text) | Accessibility | Med | S | Correct option named only as a number in the live region. |
| 18 | Add `engines: { node: ">=20" }` + `.nvmrc` | Maintainability | Low | S | Node pinned only in netlify.toml; Vercel/local can drift. |
| 19 | Clean up 7 untracked scratch .md + 3 machine-specific mermaid scripts | Maintainability | Low | S | Delete/relocate; they rot and mislead future sessions. |
| 20 | Establish a version-fact staleness recheck cadence doc + sweep script | Content freshness | Med | S | 93 files carry year/version claims; audit flagged forward-dated K8s facts. No recurring check exists. |
| 21 | SRS-light spaced-repetition scheduler + "Due today" preset | Engagement / Learning | High | M | Merges the three SRS findings (interval/due, timestamp-unused, weak-area steering). Strongest retention lever; `ts` already stored. |
| 22 | Rebalance distractor length (correct = uniquely longest 87.3% of the time) | MCQ quality | High | L | Textbook test-wiseness giveaway; biggest single integrity fix. Batched LLM rewrite gated by length-ratio check. |
| 23 | Render mermaid diagrams to SVG at build time | Performance | High | L | ~600KB–1.5MB client JS + CLS on every diagram page (320 files, 1,112 diagrams). Also shrinks build/bundle (#31). |
| 24 | Finish deferred Pass-2 MCQ deepening (~7 domains at ~50 → 70–90) | Content coverage | High | L | docker/grpc/observability/testing/devops-cicd/lld/interview-craft lag deepened peers (spring-boot 102). |
| 25 | Author remaining planned coverage domains (perf-eng, OS, runtimes, …) | Content coverage | High | L | 8 planned domains absent; recurring senior/staff areas. **Needs sign-off.** |
| 26 | Mermaid diagrams need a text alternative (role/aria/accDescr) | Accessibility | High | M | WCAG 1.1.1 Level A failure across the whole diagram corpus. Pairs with #23. |
| 27 | Test the answer-remap invariant + score/review logic in PracticeSession | Testing/CI | High | M | A remap bug would grade every learner's correct answers as wrong — invisible without a test. |
| 28 | Unit-test pure logic in sample.ts + progress.ts (Vitest) | Testing/CI | Med | M | seededShuffle, pickN, streak state machine, masteryLevel, daysBetween. |
| 29 | Build smoke test + cross-topic link/anchor integrity check | Testing/CI | Med | M | Verifies non-empty pools + that `learnMoreHref` deep links resolve. |
| 30 | MCQ options → radiogroup/radio semantics + sr-only correctness | Accessibility | Med | M | WCAG 1.3.1/4.1.2; toggle-button semantics today. |
| 31 | Daily mixed cross-domain challenge tied to the streak | Engagement | High | M | Streak machinery exists but nothing tells the learner what to do each day. |
| 32 | No JSON-LD structured data (BreadcrumbList, Course/Quiz) | SEO | High | M | Biggest untapped rich-result surface for a Q&A corpus. Depends on #9. |
| 33 | Attempt-history schema bump (attempts/streak/lapses) v1→v2 | Learning science | Med | S | Enabler for SRS/difficulty calibration; only last outcome kept today. |
| 34 | Dedupe system-design double-fetch of 3.8MB pool + reconsider preload | Performance | Med | S | Pool fetched + parsed twice on mount; compute tierCounts from loaded pool. |
| 35 | Weakest-topics "drill your weakest 3" recommendation on /progress + home | Engagement | Med | M | Turns passive dashboard into an action driver; `computeMastery` already yields the ranking. |
| 36 | Bookmark/flag tricky questions + star topics into a "Saved" list | Engagement | Med | M | Self-directed review the auto-missed queue can't cover. |
| 37 | Per-question confidence self-rating ("sure/unsure") | Engagement / Learning | Med | M | Merges the two confidence findings; feeds mastery + SRS intervals. |
| 38 | Even out References URL discipline (only 209/430 have a link) | Content freshness | Med | L | hibernate-jpa 0/18, system-design 18/87 vs docker/k8s 100%. |
| 39 | Non-blocking `mcq_quality_report.py` (length/position/coverage stats) | MCQ quality | Med | M | Turns the one-time audit into a repeatable gate; promote hard checks later. |
| 40 | Stratified LLM-judge distractor-plausibility sampling audit | MCQ quality | Med | M | ~570 Q scorecard to pinpoint which domains need rewrites before #22. |
| 41 | Cross-topic "See also" hyperlinks between related subtopics | Content pedagogy | Med | L | 0 files use See-also links; note: existing 7 relative links are actually broken on the live site — needs a remark rewrite plugin too. |
| 42 | Bring DSA to usable depth (~22 → ~50 MCQ/topic) + authoritative refs | Content coverage | Med | L | Lowest domain by 2x; but light count was a signed-off "coding-first" call — see sign-off. |
| 43 | Automate mermaid render regression (build-time `mermaid.parse`) | Testing/CI | Med | M | Existing audit script is manual, hardcoded to 8 pages + an absolute npx path. |
| 44 | Per-domain recall-vs-understanding stem balance + scenario top-up | MCQ quality | Low | M | Directional gap real; exact percentages are regex artifacts. |
| 45 | Content-hash question pool filenames for immutable caching | Performance | Low | M | `stale-while-revalidate` already gives instant repeat loads; modest gain. |
| 46 | Precompress dist text assets (brotli) | Performance | Low | S | Netlify/Vercel already auto-compress at the edge; limited net-new benefit. |
| 47 | Prune unused mermaid diagram-type chunks / build-time scaling | Performance | Low | M | Unused chunks are lazy-loaded, so build-hygiene not runtime UX. Folds into #23. |
| 48 | Persistent achievement badge gallery | Engagement | Low | M | Below core retention mechanics; streak milestones already provide the dopamine hit. |
| 49 | Per-question item-difficulty report from localStorage | Learning science | Low | M | Single-device sample can't recalibrate a shared bank; value is a personal weak-spot view. |
| 50 | Cookieless analytics (Plausible/GoatCounter) with quiz-finish events | Learning analytics | Med | S | Only way to learn cross-learner difficulty. **Needs sign-off** (3rd-party dep + privacy note). |
| 51 | Reconsider robots.txt full-site block of AI-answer crawlers | SEO | Med | S | Blocks citation in AI answer engines. **Needs sign-off** (strategy call). |
| 52 | Reduce ~3x on-disk serialization of system-design pools | Maintainability | Low | M | Build-artifact only (gitignored); grows linearly with domains. |
| 53 | Dependency vuln / major-version drift (Astro 5→7, Tailwind 3→4) | Maintainability | Med | L | Highs are build-time (sharp) / SSR-only (astro) — no live runtime surface on static output. Hygiene, staged. |

## Quick wins (high impact, S effort)

A maintainer could land these in about a day:

- **CI pipeline (#1).** Create `.github/workflows/ci.yml`; first step: `python scripts/validate_content.py` over `topics/`, then `cd web && npm ci && npm run build` on a Node 20 job.
- **Open Graph / Twitter cards (#2).** In `web/src/layouts/BaseLayout.astro` `<head>`, emit `og:*` + `twitter:card` from the existing `title`/`description` props and add one default `public/og-default.png`.
- **Progress export/import (#3).** On `/progress`, add an "Export" button that serializes all `ip:*` localStorage keys to a downloadable JSON blob, plus a file-input "Import" that restores them.
- **Fix dark-theme accent tokens (#4).** Add `--accent-violet` and `--accent-rose` to the `:root` block in `web/src/global.css` (currently light-theme only).
- **Fix the two CSP doc comments (#6).** Point `netlify.toml:15` and `public/vercel.json` `$comment` at `scripts/gen-csp-headers.mjs` instead of "Astro hash-based CSP".
- **Reconcile ROADMAP + CONTRACT docs (#5, #7).** Regenerate the MCQ-count rollup, drop the dead Apache Tomcat row, and rewrite CONTRACT.md's `_all.json` references to the slim-only + `_explanations.json` model.
- **Sitemap + head slot (#8, #9).** `npm i @astrojs/sitemap`, add to `astro.config.mjs` integrations (verify prod SITE_URL), add `Sitemap:` to robots.txt, and add `<slot name="head">` to BaseLayout to unblock JSON-LD/OG.
- **Validator MCQ invariants (#10) + typecheck (#11).** Add blank/duplicate-option and empty-explanation checks to `validate_content.py`; add `@astrojs/check` and an `astro check` script.
- **Answer-position reshuffle (#12).** Re-seed correct-option positions in the 6 flagged `rest-api-design` files.
- **Mastery evidence gate (#13).** In `progress.ts` `masteryLevel`, require `seen>=5` before "mastered" and add an "in progress" shade.
- **Font preload (#14) + three aria-live/label fixes (#15, #16, #17).** All small, well-scoped edits in BaseLayout / PracticeSession.

## Bigger bets (M/L effort, high impact)

Grouped by theme; each notes what it unlocks.

**Testing & CI (foundation).** Beyond the CI shell (#1): unit-test the answer-remap invariant (#27) and pure `sample.ts`/`progress.ts` logic (#28) with Vitest, add a build smoke + cross-topic link check (#29), and a build-time `mermaid.parse` gate (#43). *Unlocks:* confidence to refactor and deepen content without silently corrupting scoring, streaks, or links.

**Engagement & retention (return visits).** Land the SRS-light scheduler + "Due today" preset (#21) on top of the attempt-history schema bump (#33), then the daily cross-domain challenge (#31), weakest-topics next-up (#35), bookmarks/Saved (#36), and confidence rating (#37). *Unlocks:* durable spaced recall (the top interview-prep lever) and a real daily habit loop; today a once-correct question is "mastered forever" and nothing tells a learner what to do each day.

**Content depth & integrity.** Rebalance distractor lengths (#22, the single biggest bank-integrity fix), finish Pass-2 deepening for ~7 lagging domains (#24), stand up the MCQ quality report (#39) and distractor sampling audit (#40), and even out References (#38). *Unlocks:* an assessment a savvy learner can't game by picking the longest option, and senior-level depth where it's currently thin.

**Performance & discoverability.** Move mermaid rendering to build-time SVG (#23) — also fixing the Level-A accessibility gap (#26), CLS, and bundle size (#47) in one stroke — plus the double-fetch dedupe (#34), and the SEO structured-data stack (#32) on top of the head slot. *Unlocks:* faster diagram pages, screen-reader-usable diagrams, and rich-result eligibility for a Q&A corpus.

**Maintainability.** Staged Astro 5→6→7 + Tailwind 3→4 upgrade (#53) while the surface is a static build with a committed lockfile.

## Needs sign-off

These touch locked decisions (stack / content strategy / no-backend / third-party deps) — owner calls:

- **Author 8 new coverage domains (#25)?** performance-engineering and operating-systems are next per the locked Session-27 sequence, but this is a large multi-domain content commitment — confirm scope and ordering before building.
- **DSA depth (#42)?** ROADMAP records a signed-off "coding-first, MCQs optional" decision for dsa-coding. Raising it to a ~50-MCQ floor partly re-litigates that — do you want to reverse it?
- **Add cookieless analytics (#50)?** This introduces a third-party service (Plausible/GoatCounter) and needs a privacy note, though it stays within the static-site model. OK to add?
- **Unblock AI-answer crawlers (#51)?** robots.txt currently blocks GPTBot/ClaudeBot/PerplexityBot/CCBot/Google-Extended site-wide. Allow citation crawlers (keeping training opt-outs) to be discoverable in AI answer engines?
- **Pre-sampled subset pools (part of #34)?** Generating smaller per-domain sampled pools would cut the system-design transfer ~90% but changes the static-sampling model — only if you want to go beyond the free dedupe win.

## Planned v2 — approved for planning (queued after current work)

- **Multi-select ("select all that apply") MCQ type.** Reverses the schema's "single-answer, exactly one correct" v1 decision. Adds `type: single|multi` + `answers: [int]` (default keeps all ~27k existing questions single-answer), all-or-nothing scoring v1, and a Submit-step UI in PracticeSession. Complements the distractor fix — SATA can't be gamed by elimination and matches AWS/CKA-style exams. Pre-work done: only 0.6% of questions are already phrased as multi-select (some "which two" items are shoehorned into single-answer — a latent defect). Sequenced AFTER the distractor rollout + engineering-blogs domain. Full design in Claude memory `queued-multiselect-mcq`.

## Explicitly not recommended / already done

Three candidates were investigated and dropped during grounding:

- **"595 concepts.md sections have zero MCQ coverage" — invalid.** The proposal's slug algorithm didn't match the repo's GitHub-style anchors. Recomputed correctly, only ~81/6,672 non-boilerplate sections are uncovered (1.2%), most of them boilerplate; the cited examples actually have question refs. Not a real gap.
- **"Shipped light theme has failing contrast tokens" — invalid.** The predicted-failing accents (`--accent-orange/red/pink/purple`) are dead tokens with zero consumers; the accents actually used are AA-overridden in the light block. No contrast defect (distinct from the real #4, which is a dark-mode *undefined-token* bug).
- **"Stale/wrong site URL breaks canonicals + sitemap" — invalid.** Per authoritative memory, "Grokking Interview" / grokking-interview.vercel.app is the current, intentional brand and deploy URL (loopready.io was deliberately not purchased). The only true sub-fact — no `rel=canonical` — is a minor nicety, not a broken canonical.
