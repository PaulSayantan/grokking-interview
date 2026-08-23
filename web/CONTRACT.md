# Foundation Contract — interview-prep web

This document is the **frozen contract** for feature agents building pages on top of the
Foundation scaffold. The toolchain, data shapes, shared components, helpers, and route
map below are stable. Do not change generated-data shapes, the `concepts` collection API,
`BaseLayout` props, or the global CSS token/class names without a Foundation-phase
sign-off. All paths are relative to `/path/to/interview-prep/web` unless
stated otherwise.

## 1. Tech stack (frozen)

- **Astro 5** (latest), `output: "static"` — no SSR adapter. Prerender everything.
- **Tailwind CSS 3** via `@astrojs/tailwind` (with `applyBaseStyles: false`; base styles
  live in `src/styles/global.css`). Dark mode = `darkMode: ["selector", '[data-theme="dark"]']`.
- **Preact** via `@astrojs/preact` — use islands **only** for the interactive practice quiz
  (`client:load` / `client:visible`). Everything else is static Astro/HTML.
- **TypeScript** (strict). Path aliases: `@/*` -> `src/*`, `@lib/*` -> `src/lib/*`.
- Markdown pipeline (configured in `astro.config.mjs`). **Frozen. The clarity effort's two
  approved plugins are now LANDED** (they were the one pending amendment; the sign-off is the
  "frozen-pipeline sign-offs" decision in the clarity plan). The list below is complete again —
  do not add anything else without a fresh sign-off.
  - `remark-gfm` — GFM tables in `concepts.md` comparison sections.
  - `remark-mermaid` (`plugins/rehype-mermaid.mjs` — misnamed, it is a **remark** plugin) —
    rewrites ` ```mermaid ` fences to `<pre class="mermaid">` **before** Shiki sees them.
  - `rehype-slug` — GitHub-slugger-compatible heading ids (matches `ref` anchors).
  - `rehype-autolink-headings` (`behavior: "wrap"`, class `heading-anchor`) — anchor affordance.
  - `rehype-callouts` — the four `> [!TYPE]` callout boxes.
  - `rehype-lede` — marks each section's first paragraph (`.pd-lede`) and each tier-3 seam
    heading (`.pd-seam`). Runs **after** slug/autolink (it needs the ids) and **before**
    `rehype-prompts` (so it never sees an injected prompt row as prose). §11.
  - `rehype-prompts` — injects the think-prompt rows from the topic's `prompts.yaml` sidecar,
    read via `file.data.astro.frontmatter.prompts`. A no-op on topics with no sidecar. §11.
  - Shiki built-in highlighting (`github-light` / `github-dark`, `wrap: true`).
- Sync script is Node ESM (`scripts/sync-content.mjs`), parses YAML with the `yaml` lib.

## 2. Directory layout

```
web/
  astro.config.mjs         Astro + integrations + markdown pipeline
  tailwind.config.mjs      Tailwind (selector dark mode, fonts, prose max-width)
  tsconfig.json            strict + @/ and @lib/ aliases
  netlify.toml             base=web, build=npm run build, publish=web/dist
  package.json             scripts: sync | dev | build | preview
  .gitignore               ignores all generated artifacts (see §9)
  CONTRACT.md              this file
  scripts/
    sync-content.mjs       reads ../topics -> generates all data (§3)
  src/
    content.config.ts      'concepts' collection definition (§6)
    layouts/BaseLayout.astro   shared shell (§7)
    styles/global.css      Tailwind entry + tokens + .prose (§8)
    lib/                   shared TS types + helpers (§5)
      types.ts  sample.ts  catalog.ts  index.ts (barrel)
    pages/
      index.astro          landing placeholder (replace/extend as needed)
    data/
      catalog.json         GENERATED manifest (§4)
    content/
      concepts/<domain>/<slug>.md   GENERATED collection entries (§6)
  public/
    favicon.svg            brand "G" mark, modern tabs (source of the PNG set)
    favicon-32.png         PNG tab fallback
    apple-touch-icon.png   iOS home screen
    icon-192.png           manifest icon (Android/Chrome home screen)
    icon-512.png           manifest icon (splash / high-DPI)
    manifest.webmanifest   installable web-app manifest (CSP: manifest-src 'self')
    og-default.svg         editable source for the social card
    og-default.png         og:image — social platforms do not render SVG
    robots.txt
    fonts/                 self-hosted Inter + mono woff2 (fontsource)
    questions/             GENERATED question pools (§4)
      <domain>/<slug>.slim.json         per-subtopic pool (slim: no explanation/tags/difficulty)
      <domain>/_all.slim.json           domain-level pool (slim)
      <domain>/_explanations.json       { question_id -> explanation } (lazy-loaded)
      system-design/_group-{core,advanced,patterns,architecture,ccp,aws,cdp}.slim.json
```

## 3. Content sync (`npm run sync`)

`scripts/sync-content.mjs` reads the **read-only** source at
`/path/to/interview-prep/topics` and regenerates everything below. It is
**idempotent** — it deletes its output dirs first, so re-running always mirrors source.
Wired into `dev` and `build` (both run sync first). Never edit generated files by hand;
never modify anything under `topics/`.

**All 20 domains are authored and browsable.** The list is the hardcoded
`AUTHORED_DOMAINS` array at `scripts/sync-content.mjs:45` — a domain folder alone is
invisible to the site, so adding one means editing that array. `COMING_SOON_DOMAINS`
(`:48`) is now `[]`; the `authored:false` render path still exists but nothing uses it.
Domain display titles come from the first `# H1` of `topics/<domain>/README.md`, and
learning order within a domain comes from that README's **table row order**.

**Current generated volume: 20 domains, 460 subtopics, 28,064 questions.** Per domain:

| Domain | Sub | Questions | | Domain | Sub | Questions |
|---|--:|--:|---|---|--:|--:|
| `system-design` | 94 | 6,611 | | `devops-cicd` | 21 | 1,065 |
| `lld-and-ood` | 33 | 1,671 | | `messaging-databases` | 20 | 1,086 |
| `java-jvm` | 25 | 1,555 | | `kubernetes` | 19 | 981 |
| `system-design-case-studies` | 23 | 230 | | `observability` | 17 | 844 |
| `rest-api-design` | 20 | 1,633 | | `grpc` | 16 | 806 |
| `dsa-coding` | 20 | 456 | | `docker` | 16 | 794 |
| `spring-core` | 19 | 1,511 | | `interview-craft` | 16 | 793 |
| `spring-boot` | 18 | 1,851 | | `testing` | 16 | 784 |
| `hibernate-jpa` | 18 | 1,401 | | `security` | 17 | 1,341 |
| `networking` | 16 | 1,372 | | `reliability-ops` | 16 | 1,279 |

> Do not hand-maintain these numbers. **`docs/corpus-stats.md` is authoritative**;
> regenerate with `python3 scripts/corpus_stats.py`. Verified 2026-08-23.

## 4. Generated data shapes

### 4.1 `src/data/catalog.json` — the manifest pages render from

Shape: `{ domains: CatalogDomain[] }`. Import it via `@lib/catalog` helpers (§5), not by
reading the file directly. Real excerpt (trimmed to one domain and one group):

```json
{
  "domains": [
    {
      "slug": "system-design",
      "title": "System Design",
      "authored": true,
      "subtopicCount": 94,
      "questionCount": 6611,
      "groups": [
        {
          "key": "core",
          "label": "Core Topics",
          "subtopics": [
            { "slug": "caching-and-cdn", "title": "Caching and CDN", "questionCount": 80 }
          ]
        }
      ]
    }
  ]
}
```

> An unauthored domain would carry `"authored": false`, `"subtopicCount": 0`,
> `"questionCount": 0` and `"groups": []`. No domain is in that state today — the earlier
> version of this document used `docker` as the example, which now has 16 subtopics and
> 794 questions.

- **Domain order** in `domains[]` follows the `AUTHORED_DOMAINS` array
  (`scripts/sync-content.mjs:45`), then coming-soon — currently empty.
- **Groups:** `system-design` has **7** groups, in this order:

  | Key | Label | Subtopics | Rule |
  |---|---|--:|---|
  | `core` | Core Topics | 27 | fallback — anything unmatched below |
  | `advanced` | Advanced & Expert Deep-Dives | 8 | membership in the `SD_ADVANCED` set |
  | `patterns` | Design Patterns | 7 | slug prefix `dp-` |
  | `architecture` | Architectural Patterns | 6 | slug prefix `arch-` |
  | `ccp` | Cloud Computing Patterns | 8 | slug prefix `ccp-` |
  | `aws` | AWS System Design | 31 | slug prefix `aws-` |
  | `cdp` | AWS Cloud Design Patterns | 7 | slug prefix `aws-cdp-` |

  **Prefix order in `sdGroupKey()` (`:165`) is load-bearing:** `ccp-`, then `aws-cdp-`,
  then `aws-`. `aws-cdp-` must be tested before `aws-` because it is itself an `aws-`
  prefix — get it wrong and all 7 CDP topics land in the AWS group.

  All other domains have a **single** group `{ key: "all", label: "", subtopics: [...] }`.
- Subtopics within a group are ordered by their **README table row order** (the domain's
  learning order), not alphabetically. A topic missing from its README table falls back to
  a sentinel and its position is undefined — `sync-content.mjs` warns loudly when this
  happens, because it silently mis-ordered a whole domain once already.
- Subtopic `title` comes from the `topic` field of its `questions.yaml` (fallback: concepts.md H1).
- Coming-soon domains would have `groups: []` and zero counts and render as **disabled,
  non-clickable "Coming soon"** cards. This path is currently unexercised.

### 4.2 Question JSON — `public/questions/...`

Served as static files under the site root at URL `/questions/...` (fetch at runtime from
the Preact island, or import at build time). Each file is a **flat array of questions**.

Only the **slim** twin of each pool is emitted (`.slim.json`): the light payload the island
fetches (question + options + answer + ref, but no explanation/tags/difficulty). Explanations
are lazy-loaded per domain from `_explanations.json` keyed by question id. (The full `_all.json`
/ `<slug>.json` pools were removed — nothing at runtime fetched them and a single `_all.json`
was the most convenient bulk-scrape target. See the header comment in `sync-content.mjs`.)

| File | Contents |
| --- | --- |
| `public/questions/<domain>/<slug>.slim.json` | one subtopic's questions (slim) |
| `public/questions/<domain>/_all.slim.json` | every question in the domain, slim (parent-level practice) |
| `public/questions/<domain>/_explanations.json` | `{ question_id -> explanation }`, lazy-loaded on answer |
| `public/questions/system-design/_group-<key>.slim.json` | one system-design group pool (slim) — 7 of them: `core`, `advanced`, `patterns`, `architecture`, `ccp`, `aws`, `cdp` |

Each question object (matches the `Question` type in `@lib/types`):

```json
{
  "id": "caching-and-cdn-001",
  "difficulty": "beginner",
  "tags": ["fundamentals", "latency", "motivation"],
  "question": "What is the primary reason a Content Delivery Network ...",
  "options": ["...", "...", "...", "..."],
  "answer": 0,
  "explanation": "...",
  "ref": "concepts.md#latency-numbers-and-why-we-cache",
  "domain": "system-design",
  "topic_slug": "caching-and-cdn"
}
```

- `answer` is a **0-based** index into `options` (3–5 options).
- **Question type (`type`).** Default `single` (the shape above). A `type: "multi"`
  question is select-all-that-apply: it carries `answers: [i, j, …]` (0-based indices of
  **all** correct options) **instead of** `answer`. Both `type` and the correct-answer key
  survive into the slim pool (the quiz needs them). Grading is **all-or-nothing** — the
  chosen set must exactly equal `answers` — so a multi question is still a binary
  correct/incorrect for streaks, mastery, and spaced-repetition. The practice island renders
  multi options as a checkbox group with a Submit step (single stays tap-to-lock).
- `ref` is optional. `domain` and `topic_slug` are **injected by sync** (not in source YAML)
  so a standalone question knows its origin for the "Learn more" link.
- **Learn-more link:** given a question with `ref: "concepts.md#<anchor>"`, build
  `/study/${q.domain}/${q.topic_slug}#${anchor}` (strip the `concepts.md#` prefix). The
  `<anchor>` already equals the rendered heading id — verified against source refs.

## 5. Shared lib (`src/lib`)

Import via aliases: `import { pickN } from "@lib/sample"`, `import type { Question } from
"@lib/types"`, `import { getDomain } from "@lib/catalog"`, or the barrel `@lib/index`.

- **`types.ts`** — `Difficulty`, `Question`, `CatalogSubtopic`, `CatalogGroup`,
  `CatalogDomain`, `Catalog`. These match §4 exactly.
- **`catalog.ts`** — imports `catalog.json` and exposes:
  - `catalog: Catalog`
  - `getDomains(): CatalogDomain[]` (all, incl. coming-soon)
  - `getAuthoredDomains(): CatalogDomain[]`
  - `getDomain(slug): CatalogDomain | undefined`
  - `getGroup(domainSlug, groupKey): CatalogGroup | undefined`
  - `getAllSubtopicRefs(): { domain, slug }[]` — flat list for `getStaticPaths`.
- **`sample.ts`** — quiz sampling:
  - `DEFAULT_SAMPLE_SIZE = 25`
  - `pickN(pool, n=25, seed?)` — sample without replacement (seeded => deterministic).
  - `seededShuffle(items, seed?)` — Fisher-Yates, returns a new array.
  - `mulberry32(seed)`, `hashSeed(string)` — PRNG + string->seed for stable per-topic seeds.
- **`index.ts`** — barrel re-exporting all of the above.
- **Slugify note:** heading anchors are produced by `rehype-slug` (github-slugger) at render
  time. Do **not** hand-roll a slugify for anchors; source `ref` fields already use that same
  algorithm, so Learn-more links line up automatically.

## 6. `concepts` content collection (`src/content.config.ts`)

Astro 5 glob-loader collection named **`concepts`**, `type: content`. Entry **id is
`"<domain>/<slug>"`** (custom `generateId`), which keeps entries unique even when two domains
share a subtopic slug (e.g. `spring-boot/configuration-profiles-properties` vs
`spring-core/configuration-profiles-properties`).

Frontmatter schema (validated by Zod): `{ title: string, domain: string, slug: string,
group: string }`. `group` is the group key (`"all" | "core" | "advanced" | "aws"`).

**Body:** the original leading `# H1` line from `concepts.md` is **stripped** by sync (study
pages show the title from frontmatter/header). The rest of the Markdown is verbatim, so `## H2`
sections and their anchors are intact.

Usage in a study page:

```astro
---
import { getEntry, render } from "astro:content";
const { domain, slug } = Astro.params;
const entry = await getEntry("concepts", `${domain}/${slug}`);
if (!entry) return Astro.redirect("/404");
const { Content, headings } = await render(entry);   // headings[].slug === anchor ids
---
<h1>{entry.data.title}</h1>
{/* build a TOC from `headings` (depth/slug/text) */}
<div class="prose"><Content /></div>
```

`getCollection("concepts")` returns all 119 entries; filter by `entry.data.domain` /
`entry.data.group` as needed.

## 7. `BaseLayout.astro`

`import BaseLayout from "@/layouts/BaseLayout.astro"`. Props:

| prop | type | notes |
| --- | --- | --- |
| `title` | `string` (required) | document title; rendered as `"<title> · Interview Prep"` (or just the site name on home). |
| `description` | `string?` | meta description. |
| `activeNav` | `"home" \| "catalog"` (optional) | marks the active header link with `aria-current`. |

Provides: sticky, semantic, responsive `<header>` (site name -> `/`, Catalog link ->
`/catalog`, dark-mode toggle), a skip link, `<main id="main" class="mx-auto w-full max-w-5xl ...">`
with your page as the default slot, and a minimal footer. The dark-mode toggle persists to
`localStorage["theme"]`, respects `prefers-color-scheme`, and applies the theme in a
pre-paint inline script (**no flash of wrong theme**). Page content goes in the default slot:

```astro
<BaseLayout title="Caching and CDN" description="..." activeNav="catalog">
  <h1>...</h1>
</BaseLayout>
```

## 8. Global CSS (`src/styles/global.css`)

Imported by `BaseLayout` — every page gets it. Tailwind layers + design tokens + a
hand-rolled `.prose` ruleset. Do not rename tokens/classes below.

> **LANDED (clarity effort), was the approved pending amendment:** seven `.prose` typography
> rules changed — `line-height` 1.7 → 1.63; paragraph gap `1em` → `1.15em`; `h2`
> `margin-top` 2em → 2.75em plus `margin-bottom: 0.75em`; per-block leading (`li` 1.5 with
> `0.4em` between, `td`/`th` 1.45, `pre` 1.55); `--measure-wide` (80ch) reaching
> `pre`/`table`/`pre.mermaid` at ≥1024px; mobile `overscroll-behavior-x: contain` on
> `pre`/`table` plus `tabular-nums` and `tab-size: 2`; and `text-wrap: pretty` on `p`/`li`
> while headings keep `balance`. **`--measure` stays 68ch. No token or class was renamed.**
> Every one of the seven numbers is asserted in `src/lib/study-css.test.ts`.
>
> **Two traps that were measured, not reasoned about, and must not be re-introduced:**
> `ch` resolves against the font of the element that *uses* it, so `width: var(--measure-wide)`
> on a `<pre>` (0.9rem mono) is **narrower** than 68ch of body Inter and made code blocks
> shrink — the token is therefore a floor inside `max()`, and a right-only `--prose-bleed`
> does the widening. A *symmetric* bleed is impossible: `main`'s gutter is 16px at exactly
> 1024px, and a negative `margin-inline-start` there pushed code blocks 36px off the left
> edge of the viewport, where nothing can scroll them back.
>
> Four invariants in this file are guarded by `src/lib/theme-css.test.ts` and fail silently
> in a browser if regressed: no `background` on `body`, no `background-attachment: fixed`,
> `--color-primary-contrast` stays dark, and `a:hover` stays de-escalated to
> `:where(a):hover`. Run `npm test` after touching them.
>
> The reveal UI (§11) adds a `CLARITY REVEAL UI` block at the end of this file whose own
> silent-failure invariants live in `src/lib/study-css.test.ts`.

- **Design tokens** (CSS custom properties on `:root` and `[data-theme="dark"]`):
  `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-text`,
  `--color-text-muted`, `--color-primary`, `--color-primary-hover`, `--color-primary-contrast`,
  `--color-accent`, `--color-focus`, `--color-code-bg`, `--color-correct`, `--color-incorrect`;
  spacing `--space-1..8`; radius `--radius-sm|md|lg`; reading measure `--measure` (68ch). Use
  them in inline `style` or arbitrary Tailwind values so light/dark just work.
- **Component classes:** `.card` (surface + border + radius), `.skip-link`.
- **`.prose`** — wrap rendered concept HTML in `<div class="prose">…</div>`. Styles headings
  (with `scroll-margin-top` for sticky-header anchor offset), lists, inline code, Shiki code
  blocks, **GFM tables** (horizontally scrollable, zebra rows), blockquotes, `hr`, and the
  `.heading-anchor` affordance (hover shows a `#`). Max width is the ~68ch reading measure.
- Accessibility: global `:focus-visible` outline uses `--color-focus`. Keep semantic HTML.

## 9. Build / deploy

- `npm run sync` — regenerate data only.
- `npm run dev` — sync then `astro dev`.
- `npm run build` — sync then `astro build` -> static `dist/`. **Verified green.**
- `npm run preview` — serve `dist/`.
- **Deploy:** `netlify.toml` sets `base = "web"`, build `npm run build`, publish `web/dist`.
  Vercel: Root Directory `web`, Build `npm run build`, Output `dist`. Set `SITE_URL` env for a
  correct canonical `site` (defaults to a placeholder).
- **Gitignored (generated, never commit):** `src/content/concepts/`, `public/questions/`,
  `src/data/catalog.json`, plus `node_modules/`, `dist/`, `.astro/`. CI/deploy regenerates them
  via the `build` script.

## 10. Route map — pages feature agents must implement

Prerender all authored routes with `getStaticPaths` driven by `catalog.json`
(`getAllSubtopicRefs()` / `getAuthoredDomains()`).

| Route | Purpose | Data source |
| --- | --- | --- |
| `/` | landing page | `catalog.json` |
| `/catalog` | all domains: authored (grouped) + coming-soon (disabled cards) | `getDomains()` |
| `/domain/[domain]` | a domain's subtopics in grouped sections; client-side filter; per-group + whole-domain Practice buttons | `getDomain(domain)`; question pools under `/questions/<domain>/...` |
| `/topic/[domain]/[slug]` | subtopic hub: choose Study or Practice | `getGroup`/catalog lookup |
| `/study/[domain]/[slug]` | render `concepts.md` HTML + in-page TOC + heading anchors | `getEntry("concepts", "<domain>/<slug>")` + `render()` |
| `/practice/[domain]/[slug]` | subtopic practice (25 MCQs) | fetch `/questions/<domain>/<slug>.slim.json`, `pickN(pool, 25)` |
| `/practice/[domain]` | domain-level practice (25 MCQs) | fetch `/questions/<domain>/_all.slim.json` |

**System-design group practice (decided):** use the domain-level route with a `group` query
param — `/practice/system-design?group=core|advanced|aws` — and fetch the matching
`/questions/system-design/_group-<key>.slim.json` pool. (The route is still statically prerendered
for `system-design`; the group is read client-side from the query string. No separate route.)

- `getStaticPaths` for `[domain]` should use authored domains only; `[domain]/[slug]` should
  use `getAllSubtopicRefs()`. Coming-soon domains have no detail routes (cards are non-clickable).
- The practice quiz is the **only** Preact island; hydrate with `client:load`. Persist
  score/progress in `localStorage` (static site, no backend).

## 11. Reveal UI — think-prompts, open-questions panel, cliffhanger

The clarity effort's reading layer on `/study/[domain]/[slug]`. It renders **only** when the
topic carries a `prompts.yaml` sidecar (`entry.data.prompts`, shape frozen in
`src/content.config.ts`); the other ~460 topics render byte-identically to before except for
the seven `.prose` changes in §8 and `rehype-lede`'s `.pd-lede` class.

### 11.1 The design in one paragraph

Three states per H2 section. **LOCKED** (~95% of the page) is a hairline plus one muted,
non-interactive line — "2 open questions · keep reading". **ARMED** (the section has been
read) is the *same* line at the *same* height and baseline: colour and glyph change only, and
it becomes a real button. **REVEALED** (the reader tapped) grows **downward only**, so nothing
already read is displaced. **The heuristic ARMS; the tap OPENS — nothing auto-reveals.**
Permanent ink added per section: one hairline plus one line. Nothing else.

### 11.2 The inverted no-JS contract (the load-bearing decision)

**The static HTML ships every row OPEN and every panel item unlocked. JS only ever REMOVES
content, never adds it.** The collapse is pure CSS gated on `data-pd="on"`, set on `<html>` by
**one** inline head script (`PD_FLAG_SCRIPT`, injected through BaseLayout's `slot="head"`).
Consequences to preserve:

- No flash of open rows: the flag lands before the body parses.
- No fallback branch that can rot — with JS off, nothing below the gate ever matches.
- **`gen-csp-headers.mjs` gains exactly ONE hash.** The script is a single string constant
  with no per-page data, so all prompted pages share one digest. Verified: 11 → 12 hashes.
- The script also re-applies the flag on `astro:after-swap`, because ClientRouter resets
  `<html>`'s attributes from the incoming document and does not re-run head inline scripts on
  a study → study navigation (same reason BaseLayout's theme script does this).
- Deliberately **no watchdog** that strips the flag if the module script fails to load: it
  would be a second silent code path whose failure mode (everything flashing open mid-read on
  a slow phone) is worse than the risk it covers.

Everything else is a **bundled** `<script>` (no CSP hash, evaluated once per session) that
registers `astro:page-load` / `astro:before-swap`. It is **not** a second Preact island —
`PracticeSession.tsx` keeps that seat.

### 11.3 DOM contract

Injected into `.prose` by `rehype-prompts`, at the end of each H2 section that has prompts.
One row per **section**, not per prompt — the sidecar allows one prompt per *anchor*, and an
anchor may be an H3 seam, so a row collects every prompt whose ref anchor lives inside the
section. The row is placed before the next depth ≤ 2 heading, walking **back** over any
trailing `<hr>` so a section-separating rule keeps separating sections. **No sentinel nodes
are inserted** — `h2`/`h3` are siblings of their blocks, and the client derives sections from
root-level children.

```html
<h2 id="SECTION" data-pd-words="733">…</h2>          <!-- build-time word count -->
…section blocks…
<div class="pd-row" data-pd-row data-pd-sec="SECTION"
     data-pd-state="locked" data-pd-count="2" data-pagefind-ignore>
  <span class="pd-line pd-line--static"><span class="pd-glyph"></span>
    <span class="pd-label">2 open questions</span></span>          <!-- no JS at all -->
  <span class="pd-line pd-line--locked">… 2 open questions · keep reading</span>
  <button type="button" class="pd-line pd-line--armed"
          data-pd-toggle aria-expanded="false">… 2 open questions</button>
  <div class="pd-body" data-pd-body>
    <ol class="pd-list">
      <li class="pd-q" id="pd-<promptId>">
        <div class="pd-q__prompt">…authored Markdown, rendered…</div>
        <details class="pd-q__more"><summary>Hint</summary>…</details>
        <p class="pd-q__closure"><a class="pd-q__link" href="…">Where this gets answered →</a></p>
      </li>
    </ol>
  </div>
</div>
```

- **All three line variants ship in the HTML; CSS shows exactly one.** A `<span>` cannot become
  a `<button>` without JS creating a node, and LOCKED must make no interactive promise.
- **Height parity is the critical invariant.** `.pd-line` owns *every* box property; the state
  rules change only `display`, `color` and the `::before` glyph, and the glyph sits in a
  fixed-width slot so swapping it cannot move the label. Row height ≥ 44px. Measured:
  locked 45px, armed 45px, page shift 0px. `src/lib/study-css.test.ts` asserts no state
  variant declares a box property.
- **Prompt bodies are authored Markdown** and are rendered through a nested
  remark-parse + remark-gfm + remark-rehype pipeline in `rehype-prompts.mjs`, whose
  `renderPromptMarkdown()` export is the *same* renderer the two Astro components use.
- **Tier shapes:** A/B get a deep link ("Where this gets answered"), never the answer; C gets
  its mandatory `success_criterion` plus `search_hint` under "How you'll know you have it";
  D gets its mandatory `answer_shape` under "What a good answer prices". At most **one**
  `<details>` per prompt.
- A prompt whose ref anchor does not exist is dropped from the prose (the dangling ref is
  `scripts/validate_content.py`'s job to report) but still reaches the reader via the panel.

Other elements, all outside `.prose`, all inside the article:

| Selector | Component | Notes |
| --- | --- | --- |
| `.pd-resolves` | study page | one muted line closing the previous topic's loop (`prompts.resolves`) |
| `.pd-panel` `[data-pd-panel]` | `OpenQuestions.astro` | every prompt, progressively populated; items are `[data-pd-panel-item][data-pd-sec]` with `tabindex="-1"` |
| `.pd-unlock` `[data-pd-unlock]` | `OpenQuestions.astro` | "Unlock all"; `.pd-panel__note` + `.pd-panel__actions` are hidden until the flag appears (they do nothing without JS) |
| `.pd-cliff` | `Cliffhanger.astro` | never gated. `cliffhanger.nextTopic` **is nullable** (last topic in a domain) — falls back to `payoffHref`, then to no link. `payoff.claim` is an authoring assertion and is **never rendered** |
| `[data-pd-live]` | study page | the page's **only** live region: empty `role="status"`, one sentence on the FIRST arming, then silent for good |
| `.pd-lede`, `h3.pd-seam` + `.pd-seam__eyebrow` / `.pd-seam__rest` | `rehype-lede` | tier marks |

Order at the end of the article: prose → **Open questions panel → cliffhanger** → live region
→ "Practice this topic" CTA → prev/next pager.

### 11.4 Tier marks

All three tiers share size, colour and measure. Tier 1 is the section's first paragraph at
`1.12em / 1.5`. A tier-3 seam gets a 2px accent left rule and a small eyebrow — and the
eyebrow is **the author's own seam prefix**, lifted out of the heading text ("Where it
breaks: what the keyword does not reach" → eyebrow `WHERE IT BREAKS`, heading `what the
keyword does not reach`). Never an invented "Advanced" / "Deep dive": the clarity standard
bans audience labels, and an invented label would rot.

**Heading ids are never touched** — six live MCQ refs target H3 anchors. Seam detection is an
allowlist of the standard's five seam prefixes (`SEAM_PREFIXES` in `rehype-lede.mjs`), matched
case-insensitively up to a colon. It matches **zero** of the 460 currently-authored topics, so
un-migrated content is visually unchanged; an unrecognised seam degrades to a plain H3.
Adding new seam vocabulary means adding it to that array.

### 11.5 Reading detection — what "read" means

Lives in `src/lib/reading.ts` (pure + testable; `reading.test.ts`). Three signals must ALL
hold for one section:

1. **Coverage** — ≥ 80% of the section's root-level blocks (`p, ul, ol, pre, table, h3,
   blockquote`) have exited the reading band **UPWARD**. `IntersectionObserver`,
   `rootMargin: "-88px 0px -25% 0px"`. Counting only upward exits is what stops a TOC jump
   *past* a section from crediting it.
2. **Dwell** — `clamp(words × 60ms, 3s, 20s)`, accrued on ONE 500ms interval. `words` is
   stamped at build time as `data-pd-words`, so the client never measures text.
3. **Departure** — the next `h2` has entered the band. The last section uses the
   Open-questions panel (or the outro CTA) — both real elements, not sentinels.

Four vetoes on dwell accrual: `document.hidden`; fling scrolling faster than ~0.9
viewport-heights per tick (so a phone fling accrues ≈ 0); a 700ms suspension armed by any
click on `a[href^="#"]` or a `hashchange`; and 60s idle. **No section may be marked read
within 1,500ms of `astro:page-load`.**

### 11.6 State

`ip:`-namespaced, versioned, pruned to the **200 most-recently-touched topics**, following the
`src/lib/progress.ts` conventions.

```
ip:read:v1     { v: 1, t: { "<domain>/<slug>": { ts, s: [sectionId, …] } } }
ip:reveal:v1   { v: 1, taught?: 1, t: { "<domain>/<slug>": { ts, s: [sectionId, …] } } }
```

- **Reading coverage stays OUT of `computeMastery()`, the SRS schedule and the streak.** Those
  are the site's only honest evidence of RETRIEVAL, and letting passive scrolling feed them
  corrupts the one signal that matters. The modules do not import each other and
  `reading.test.ts` asserts it in both directions.
- On load, previously-**read** sections arm immediately (colour + glyph inside a fixed-height
  line, so zero layout shift). Previously-**revealed** sections are deliberately **not**
  re-opened in the prose: auto-opening a row would move content the reader has already read
  and would shift an anchor landing. The reveal persists into the end-of-topic panel instead,
  which sits below everything and can grow harmlessly.
- Reveal is monotonic — closing a row again does not un-remember it, so the panel stays the
  reader's list of everything they have opened.
- "Unlock all" opens every row and populates the panel but does **not** write `ip:read:v1`:
  pressing a button is not evidence of reading.

### 11.7 Accessibility + motion

- `aria-expanded` on the control, never on the target. **`aria-controls` is omitted**
  deliberately (JAWS-only, and unnecessary when the body follows in source order).
- Exactly **one** live region per page, initially empty, one sentence on first arming, then
  silent (`taught` in `ip:reveal:v1` makes it once per browser). 15 announcements per topic is
  why people leave.
- Focus is **never** moved on arming or opening. **"Unlock all" DOES move focus** to the first
  revealed panel item — without it a keyboard user is stranded on a button. No modal, no focus
  trap, no `scrollIntoView`, no `pushState`: Back always means "previous page".
- Screen-reader / keyboard readers whose scroll pattern may never satisfy the heuristic always
  have "Unlock all".
- **Exactly one 150ms opacity fade**, inside `prefers-reduced-motion: no-preference`. **No
  height animation anywhere**, so a user stylesheet at 1.5 line-height reflows harmlessly.

### 11.8 Pagefind

The study page body is the site's **only** `data-pagefind-body`. Every prompt row, the panel,
the cliffhanger, the `.pd-resolves` line and the live region carry `data-pagefind-ignore`.
**Verified delta from this feature: 0 words, 0 fragments** (460 pages / 95,349 words before,
and a build with the sidecar removed but the same prose indexes identically). A search for
"volatile" must not surface a think-prompt.
