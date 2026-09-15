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
  - `rehype-plates` — GRAFT 2 (§13.1): wraps every **root-level** code fence and table in
    `<figure class="atl-plate">` with a `Plate NN · <language>` caption. Registered **last**, and
    it must stay last: it reads the `data-language` Shiki emitted (Astro runs Shiki *before* every
    user rehype plugin) and numbers the final tree. It walks `tree.children` only, so a fence
    inside a callout or inside an injected prompt row is left alone. **The third approved
    addition** — signed off with the atlas refresh. The list is complete again at three, and the
    "nothing else without a fresh sign-off" rule above still holds. `contract.test.ts` asserts the
    registration and the last-position, because `plates.test.ts` tests the transform in isolation
    and would stay green if the plugin were unwired.
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
  plugins/                 markdown pipeline plugins, registered in astro.config.mjs (§1)
    rehype-mermaid.mjs  rehype-callouts.mjs  rehype-lede.mjs  rehype-prompts.mjs
    rehype-plates.mjs      GRAFT 2 — the numbered plates (§13.1, §13.5)
  src/
    content.config.ts      'concepts' collection definition (§6)
    layouts/BaseLayout.astro   shared shell (§7)
    styles/global.css      Tailwind entry + tokens + .prose (§8) — BYTE-FROZEN, see §13.6
    components/
      AtlasFoundation.astro    the whole `.atl` foundation, imported by all three
                               learning surfaces (§13)
      StudyRoute.astro         the study page's two route lists from ONE source (§13.5)
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

### 4.2.1 `src/data/question-refs.json` — the per-section question tally

Shape: `{ "<domain>/<slug>": { "concepts.md#<anchor>": count } }`, one entry per authored
subtopic, unindented (~380 KB). Emitted by sync from the same normalised `outQuestions` the
pools are written from, so it can never disagree with what ships. Read it through
`@lib/manifest` (§5), never directly; `/topic`'s section manifest is its only consumer.

**Why it is a module under `src/data/` and not a build-time read of `public/questions/`.** The
first implementation read the pools back with `node:fs` relative to `import.meta.url`, which is
correct under vitest and under `astro dev` and **wrong under `astro build`**: Vite inlines a lib
into the page chunk, so the base became `dist/pages/topic/_domain_/_slug_.astro.mjs`, every read
threw `ENOENT`, the question column silently vanished from all 460 pages — and the build still
exited 0. Imported the way `catalog.json` is, it cannot miss. `manifest.test.ts` asserts the
import form and the absence of `node:fs` / `import.meta.url` for exactly that reason.

**The anchor is deliberately NOT resolved in sync.** Mapping `concepts.md#foo` onto the heading
that owns it needs rehype-slug's own slugs, which exist only after the markdown is rendered
(see §5's slugify note). So the file stays a faithful projection of what was authored and
`@lib/manifest` maps it against `render(entry).headings`. Sync's summary line prints the ref
total beside the question total (`28064 questions (28064 with a section ref)`), so a gap between
them shows up at sync time rather than as a short column on a page.

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
- **`manifest.ts`** — `/topic`'s section manifest, over `question-refs.json` (§4.2.1):
  - `tallyStops(headings, refCounts): { stops, counted }` — pure. `stops` are the `depth === 2`
    headings in document order with their text **verbatim**; a ref pointing at an H3 is
    attributed to the H2 above it (6 do, corpus-wide), and a ref matching no heading is counted
    **nowhere** rather than guessed at.
  - `topicRefCounts(domain, slug)` — the raw tally, or `null`.
  - `sectionManifest(domain, slug, headings)` — the composition callers use.
  - `counted === 0` means "no tally" and the caller must **drop** the count column. A `0 q`
    beside a section that has nine is the one failure the whole module is built to avoid.
- **`channels.ts`** — the seven marketing/learning **tracks**: `TRACKS` (name, token, member
  slugs), `trackFor(slug)`, and `trackCoverageErrors()` / `assertTrackCoverage()` so a newly
  authored domain cannot silently fall out of every track. Its `token` values are `--ins-*`
  scoped, which is the whole reason `atlas.ts` exists.
- **`atlas.ts`** — the `.atl` foundation's build-time half (§13 rule 8). `atlasChannel(slug)` and
  `atlasChannelStyle(slug)` resolve the ONE channel property `--atl-ch`, mapping
  `var(--ins-brand)` (which resolves to nothing outside a `.ins` wrapper) onto `--atl-brand`;
  `ATLAS_CHANNEL_FALLBACK` keeps the value always-resolvable. `atlasChannelLabel(slug)`,
  `atlasTrackPosition(slug)` and `atlasNextDomain(slug)` feed the spine and the named route
  onward. Build-time only — nothing here ships to the client.
- **`domain-title.ts`** — `cardTitle(slug, title)`: the SHORT domain title (cap 36 chars) the
  spine waypoints take, with the full title kept as the `title` attribute. A 55-character domain
  name in a `nowrap` waypoint overflows 360px; this is one of the two guards (§13.4).
- **`domain-blurbs.ts`** — `DOMAIN_BLURBS` and `domainBlurb(slug, subtopicCount?)`: the one-to-two
  line description per domain (≤ ~160 chars), used by the landing page and the `/domain` hero, with
  a count-built fallback for an unlisted domain.
- **`figures.ts`** — `rowCount()` / `fmtRow()`, the per-row inventory rounding for the marketing
  pages, and `EXACT_ROW_COUNTS` (the sign-off flag). Two rounding policies coexist deliberately:
  per-row is two significant figures, page totals are 5,000-increments in `index.astro`.
- **`reading.ts`** (§11) and **`progress.ts`** (§11, `ip:answers:v1`) are the only two durable
  stores, and §13.2 governs what a learning surface may claim from them.
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
| `.pd-cliff` | `Cliffhanger.astro` | never gated. Renders the eyebrow, hook and teasers only — **no next-topic link**, because the prev/next pager at the page bottom already goes there. `nextTopic`, `payoffHref` and `payoff.claim` are resolved and validated but **never rendered** |
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

---

## 12. The marketing pages (`index.astro`, `catalog.astro`) — the `.ins` discipline

The landing page and `/catalog` are the site's only two marketing pages. They share a
page-scoped design system called `.ins` ("instrument"): every rule lives in a
`<style is:global>` block at the bottom of each page, never in `global.css`, and every rule is
written as a descendant of the `.ins` wrapper `<div>` that sits inside `BaseLayout`'s `<slot />`.

**Three discipline rules. These are not stylistic — each one prevents a class of bug.**

1. **Every new selector contains `.ins`.** Write the descendant form `.ins .ins-h1 { … }`, never
   `.ins-h1 { … }`. `(0,2,0)` beats any single Tailwind utility `(0,1,0)`, so the outcome never
   depends on bundler emit order — and a lingering stylesheet cannot restyle a study page after a
   `ClientRouter` navigation. The only exception is `html:has(.ins)` / `html:has(.ins-catalog)`.
2. **Never hardcode an accent hex.** Always `var(--accent-*)` / `var(--ins-brand)`, so the light
   theme's deepened accent values apply automatically. (`--accent-amber` is `#F59E0B` in dark —
   1.84:1 on white — and `#9a6700` in light. A hardcoded hex silently fails one theme.)
3. **Consuming a shared token is fine; mutating one is not.** New custom properties are declared
   on `.ins` and on `[data-theme="light"] .ins` — never on `:root`, never on `[data-theme="light"]`
   alone. A study page therefore resolves nothing new and inherits nothing.

**Three more discipline rules.** The three above govern the CSS; these three govern what the pages
may *say* and *show*. Same status — each is one careless line from collapsing this direction. They
continue the numbering (4–6) so a review comment can cite "§12 rule 5" unambiguously.

4. **Mono never sets prose.** `--ins-mono` is for labels, folios, figures, units, paths, IDs, keys,
   `·`-joined meta chains and source citations. The testable form: a mono string is a **label, not a
   clause** — no subject-verb clause, never a terminal full stop, each label unit ≤3 words
   (`Browse the full catalog` and `03 / What you get` are the measured ceiling). Measured in
   Chromium: 139 mono text nodes on `/` and 41 on `/catalog`, **zero** of them ending in a full
   stop; the longest is `20 DOMAINS · 400+ SUBTOPICS · 25,000+ QUESTIONS · ALWAYS FREE` — 11 words,
   but four label units, not a sentence. Prose takes the sans face and sentence case, where
   word-shape cues exist. This is why the two pre-refresh mono sentence-kickers ("A century of memory
   research agrees", 35 chars; "Don't take our word for it", 26 chars — one of which wrapped to two
   lines at 375px directly above a 33px headline) became the folios `02 / Evidence` and
   `01 / Try one`, with their prose moved into the section lead; and why the seven track-group blurbs
   keep `.ins-micro`'s 13px muted size but reset the face with
   `.ins .ins-micro.ins-trackblurb { font-family: inherit }`. That doubled class is `(0,3,0)` on
   purpose: **Astro emits a page's component `<style is:global>` block BEFORE its foundation block**,
   so overriding a foundation rule (`.ins .ins-micro`, `.ins .ins-fig-sm`) takes one class more than
   the rule being overridden, not the same. Three landing-page rules depend on this —
   `.ins-finding-fig`, `.ins-row-q`, `.ins-trackblurb`.
5. **A track colour is a hairline mark, never a field.** As built it is exactly six thin things and
   nothing else: the 3px inset row tick in the channel index (5px on hover/focus), the 2px card top
   rule on `/catalog`, the right-aligned question numeral, the 6px meter fill, the hover/focus
   border, and the 10×10px legend square in a track head. **Never a background wash, never a fill
   behind text, never prose, and never the only carrier of a distinction** — every row and card also
   names its track in words. So each value only has to clear 3:1 as a non-text graphic; the numeral
   is the single text use, and the light overrides clear 4.5:1 as text anyway (the deepest is
   `--accent-amber` → `#9a6700`, 4.87:1 on white; the audit's "amber is 1.84:1" is `#F59E0B`, the
   dark value — exactly why rule 2 is load-bearing rather than stylistic). A colour reaches a
   component as one custom property, `--ins-ch`, set from the markup, so every recipe stays
   accent-agnostic and reusable off these pages (`DomainCard` carries a `--color-primary` fallback on
   every `--ins-ch` read). The moment a channel colour becomes load-bearing for meaning or contrast,
   seven colours are a carnival *and* an accessibility problem.
6. **One animated object, or one named timeline — never two `view()`s on differently-sized
   elements.** Two independent `view()`s on a 78svh layer and a 400px block desync by hundreds of
   pixels; that was the whole critical tier of the 2026 motion audit in one sentence. The mechanism —
   and `timeline-scope`, for consumers that must cross a sibling boundary — is in the one-clock rule
   below. Corollary, same root cause: **never put `animation-timeline: view()` on a 1–2px
   pseudo-element or hairline** — an `entry` range's length is the subject's own height, so a 2px
   subject gets ~2px of scroll to play in and the animation snaps instead of animating. In force
   today: `--ins-track` is the only named timeline, `.ins-in` is the only other scroll-driven effect,
   and the hero deliberately has **no** scroll-driven exit — it scrolls away 1:1, and must not gain
   one.

**The one-clock rule.** When two elements of different heights must move together under a
scroll-driven animation, declare **ONE** named `view-timeline-name` on a common ancestor or
subject and have both consume it via `animation-timeline: <name>`. Never give them two separate
`view()`s: `view()` ranges are measured against each subject's own height, so two elements of
different heights get two different clocks and visibly desynchronise. This is the root cause of
the whole critical tier of the 2026 motion audit.

The one named timeline on either page is **`--ins-track`**, declared on each track group's
`<ol class="ins-rows">` in the landing page's channel index and consumed by that group's
`.ins-bar` meters (`entry 0% entry 55%`). Its granularity is deliberate: per-row would be twenty
clocks, and one clock on the whole ~1,400px section would need ~770px of scroll to finish, because
an `entry` range's length is the subject's own height. Scroll-driven animations ignore
`animation-delay`, so the intra-group stagger is four pre-declared `animation-range` offset classes
(`.ins-bar-o1…o4`, cycled `i % 5`), not a delay. Bar widths are build-time inline percentages, so
under reduced motion or without `animation-timeline` support every bar is already fully drawn.

**`.ins-in` is only for subjects well under one viewport tall.** Its range is `entry 0% entry 70%`,
whose length is the subject's own height. Never put it on a `<section>`.

**Guard.** `npm run check:marketing` fails if `src/styles/global.css` has moved, or if any of
`rotate`, `perspective(`, `translateZ`, `matrix3d`, `preserve-3d`, `tilt-pointer`, `depth-layer`,
`deck-card`, `scene-3d`, `fq-chip`, `stat-card`, `btn-large`, `terminal-card` reappears in either
marketing page. The zero-rotation thesis and the "global.css does not move" constraint are gates,
not promises. The `git diff` half compares the working tree and index against `HEAD`, so it
catches an uncommitted or staged edit; a PR-level gate against the merge base belongs in CI.

---

## 13. The learning pages (`/domain/*`, `/topic/*`, `/study/*`) — the `.atl` foundation

The three learning surfaces share a page-scoped design system called `.atl` ("atlas"), whose thesis
is **position**: a domain → subtopic → section spine the reader can always locate themselves on,
progress drawn as ground covered rather than a percentage, every page ending in a named route
onward — and **every orientation device placed outside the reading measure**.

`.atl` is a third `.ins` dialect, not a second design system. **All six authoring rules of §12
apply unchanged**, and a review comment can cite them the same way ("§12 rule 5"). The type ladder
is the same nine `--ins-t-*` steps with the same `clamp()` coefficients and the same 375 → 1280px
floor/cap, so a learning page and a marketing page never out-typeset each other; two prose-only
steps are added (`--atl-t-ph2` 24 → 28px, `--atl-t-ph3` 19 → 21px) because a study H2 must sit
below a marketing H2 and clearly above its own H3.

**It is a component, not a copy.** `src/components/AtlasFoundation.astro` holds the whole
foundation and all three pages import it. §12 keeps `.ins` duplicated verbatim on the grounds that
"two pages are not a library"; atlas has three consumers and ~330 lines, which is where that
trade-off flips. The component renders nothing but a hoisted `<style is:global>` block, and in the
built output it lands in its own shared CSS chunk that is linked **after** global.css and
**before** each page's own style block — so a page rule still beats a foundation rule at equal
specificity, exactly as §12 rule 4 describes for component-vs-foundation order.

**Four rules on top of §12's six.**

7. **`.atl` declares CUSTOM PROPERTIES AND NOTHING ELSE.** No background, colour, face, size or
   leading. BaseLayout already owns the canvas and the Inter face; keeping the class
   properties-only is what lets a page adopt it without a visual change, and it is asserted
   (`atlas-css.test.ts`: "adding the `atl` class is visually inert"). Verified in Chromium:
   removing the class from `/domain` and `/topic` moves **0 of 212 / 177** element boxes in both
   themes.
8. **The channel is one property, resolved at build time.** `--atl-ch` reaches every primitive,
   the way `--ins-ch` reaches the marketing components, and its value comes from
   `atlasChannel()` in `@lib/atlas`. That function exists for one silent bug: `@lib/channels`
   gives the Design track the token `var(--ins-brand)`, which resolves to **nothing** outside a
   `.ins` wrapper — set as `--atl-ch` it would paint every channel mark transparent with no error
   anywhere. It maps that one token onto `--atl-brand` and passes the six global accents through
   untouched.
9. **Channel-as-text is legal on plane-0 ONLY** (§12 rule 5, tightened by measurement). As a
   graphic — tick, node, cell, 1px segment, 2px rule — every channel clears 3:1 on planes 0-2 in
   both themes. As *text* it does not: dark `#8B5CF6` (Craft & Data) is **4.49:1 on plane-1** —
   a fail, not merely tight — 4.11:1 on plane-2, and light `#9a6700` is 4.30:1 on plane-2. So the
   locator's folio is `--atl-ink` and the channel's presence in that bar is a meter cell. Exactly
   two primitives take the channel as text (`.atl-cta--mark`, `.atl-plate__no`), both on the page
   ground, and the test asserts that list **by name** so a third cannot appear quietly.
10. **A state-bearing graphic owes 3:1; a rail owes nothing.** An unvisited node and an unvisited
    meter cell are the "not covered" half of a two-state mark, so they get their own token,
    `--atl-node-ring` (`#6e6e6e` / `#7d8590`), which clears 3:1 on **all four** planes in both
    themes. `--atl-rule` and `--atl-rule-strong` are decorative and are held to nothing. Every
    ink/plane and channel/plane pair in the foundation is computed, not eyeballed, in
    `atlas-css.test.ts`.

### 13.1 The three grafts onto the atlas direction

**GRAFT 1 — a bigger prose body (from `reading-room`; the size, never the serif).** Prose stays
Inter. `--prose-body` is raised to `clamp(1.075rem, 1.0077rem + 0.2873vw, 1.2375rem)` (17.2 →
19.8px) through the fallback hook global.css's `.prose` rule already reads, so no `font-size` rule
is added and the OpenQuestions panel — which reads the same token — stays in step with the article.
**Measured in Chromium, not reasoned:** at a 1440px viewport the study article column is 984px and
Inter's average advance in the prose is 0.4818em (10.35px at the desktop body). 17.6px painted
**116** characters per line; 19.8px paints **95** in the identical 984px column. Leading is
untouched at 1.63/1.68, which at the larger size means it *rises* in absolute terms (29.57 →
33.26px at desktop), and `--measure-wide` stays 80ch.

**The measure was then CAPPED, on an explicit product decision.** The graft above bought a shorter
line with a bigger face, but `--measure: 104ch` (1299px at the new body) let the line grow straight
back on a wide monitor: measured, the *grid* binds up to ~2030px, giving **95** characters at 1440px
but **118** at 1920px. `--measure` is therefore **79ch** at ≥1024px — 987px at the 19.8px body,
i.e. ~95 characters, the same line the 1440px reader already had. Below ~1450px the grid still
binds, so 1024px and 1440px render exactly as before; this is a cap on ultrawide, not a narrowing
of anyone's current reading. global.css keeps 68ch/80ch, unchanged.
**Accepted consequence:** at ≥1920px the gutter between the text and the right-pinned TOC grows,
because the text stops widening while the TOC stays at the viewport edge. A stable line beats a
filled one.

Those are *capacity* figures — column width over average advance. The lines a reader actually gets
are shorter, because words break, and they were counted the slow way as well: Range rects per
character on `/study/docker/images-vs-containers`, grouped into visual lines, last (ragged) line of
each paragraph dropped. In the same 984px column at 1440px, **19.8px paints a median 99 characters
per line** (mean 97.6, p90 107, over 117 full lines) against **112** at the old 17.6px — so the
graft's target band is hit on both counts. The other two widths, same method: 1024px gives a 712px
column and a median of 74 (capacity 77); 1920px gives 1224px and a median of 123 (capacity 128),
which is the known limit above, now measured rather than projected.

**GRAFT 2 — numbered plates (from `reading-room`).** Root-level code fences and tables become
numbered figures with a caption. **The hazard is the whole story:** global.css carries
`.prose > pre, .prose > table { width: max(…) }` and `study-css.test.ts` asserts that selector by
**exact string match**. Wrapping a `pre` in a `<figure>` stops it matching and the right-hand bleed
dies silently — no error, no visual alarm, just narrower code. Adding `figure` as a third selector
to that list breaks the exact-match assertion instead. The only safe shape, and the one implemented,
is: global.css untouched, the frozen list keeps its two selectors, and
`.atl .prose > figure.atl-plate` carries its **own** `>= 1024px` rule with the same
`--measure-wide` floor and the same `calc(100% + var(--prose-bleed))` cap. `atlas-css.test.ts`
asserts both halves and that the two never merge.

**Verified, both halves.** Over the built corpus: 4,868 plates across 430 of the 460 study pages
(3,065 code fences — 711 of them with no language word — and 1,803 tables), **zero** root-level bare
`pre`/`table` left unplated, and all 1,178 mermaid `pre`s untouched. In Chromium at 1440px a plate
paints 1048px against the 984px prose column — the identical width a bare `pre.mermaid` gets, i.e.
the bleed survived the wrap — and stops 8px short of the pinned TOC (1208 vs 1216); at 1920px, 8px
short again (1688 vs 1696). The caption's number is the audited channel-as-text site and measures
4.87:1 light / 9.78:1 dark on the page ground. `plates.test.ts` (19 tests) exercises the transform
itself: numbering per document, mermaid skipped by class OR attribute, nested fences left alone, raw
nodes passed through. The class-spelling half of that guard was a real hole — `isMermaid` read only
hast's `className`, so a `class` string would have been plated — and is now closed for both
spellings.

**GRAFT 3 — keyboard routes — WITHDRAWN, and it must stay withdrawn.** The graft shipped `R`
resume/next-leg, `P` practise, `D` drill-missed as **bare single-character accelerators** on
`/domain`, `/topic` and `/study`, printed as `.atl-kbd` chips inside the anchors they fired. It has
been **removed in full** — the `ROUTES` maps, the `inEditable()` / `onRouteKey()` /
`announceRouteKeys()` trio, the three document-level `keydown` binds and their `window.__atl*`
guard flags, the `aria-keyshortcuts` attributes and every printed chip. **The route anchors
themselves are untouched**: they are ordinary links, and they are the whole navigation story now.

**Why: WCAG 2.1.4 Character Key Shortcuts (Level A).** The criterion requires **at least one** of
three mitigations, and the implementation had **none** of them: a mechanism to turn the shortcut off,
a mechanism to **remap** it to a non-character key, or the shortcut being active **only while a
specific component has focus**. Guarding on `input` / `textarea` / `[contenteditable]` — which
is what `inEditable()` did — is **not** one of the three; the criterion is about the *document*, not
about text fields. There was no setting anywhere in the app, so there was nothing to turn off.

**And the failure was destructive, not cosmetic.** The handler ran on `document` and called
`a.click()`, so a stray keystroke **navigated the reader away** — losing their position in a
forty-minute read, **with no undo**. Three ordinary ways a bare `r` arrives with nobody meaning to
press it: a **speech**-input user whose recognizer emits the letter it just heard, a Firefox reader
with type-ahead find ("Search for text when you start typing"), and a VoiceOver user with Quick Nav
off, where single letters pass straight through to the page.

**Two fixes were considered and rejected.** `Shift+letter` does **not** escape 2.1.4 — the shortcut
is still a single character, and Shift is explicitly not enough. `Alt+D` collides with the
**address-bar accelerator in Chrome on Windows**, i.e. it trades an a11y defect for a
platform-chord collision. Since the feature was only a minor accelerator over links that were
already one click away, it was **withdrawn rather than patched**.

**If it is ever revived, satisfy 2.1.4 first.** That means a real off switch or remap in a settings
surface this app does not currently have, or a handler scoped to a focused component (a route
listbox, say) rather than to `document`. The `.atl-kbd` / `.atl-keys` primitives stay **declared and
unused** in `AtlasFoundation.astro`: a keycap is a general typographic need (documenting a browser
or OS chord, for instance), and leaving them declared keeps the withdrawal diff small.

**The withdrawal is gated, not merely done.** `contract.test.ts` §3 fails if this section stops
recording the reason, or if any of the three pages re-declares a `ROUTES` map, re-binds a
document-level `keydown`, emits `aria-keyshortcuts` or prints a `<kbd>`; `atlas-css.test.ts` §5 runs
the same absence checks across every `.atl` consumer; and each surface test asserts its own routes
still render as plain anchors. A half-withdrawal — code stripped but the doc still promising keys,
or the reverse — fails the build.

### 13.2 Explicitly out of scope

`workbench`'s left rail and right inspector gutter are rejected: **the TOC stays pinned flush to
the viewport's right edge** via `margin-right: calc(1rem - (100vw - 100%) / 2)`. `reading-room`'s
serif face is rejected. And **no per-section read/mastered state may be invented**: what exists is
`ip:read:v1` (`@lib/reading`), a durable per-section store that the study page's module script
only populates on topics that carry think-prompt rows (`if (!prose || !rows.length) return`) — so
today it is truthful on the clarity-migrated topics and empty everywhere else. `@lib/progress`
adds `missedCount()` and `computeMastery()` per subtopic, from answers. Where the atlas mock shows
state beyond those, degrade to what is computable or omit it. Never ship a UI that displays state
the app cannot compute.

### 13.3 `/domain/<domain>` — the itinerary

The index is an **itinerary**: the spine, a territory panel, every subtopic as a numbered leg on
one hairline rail, the existing live filter restyled, and a named route onward. `SubtopicCard.astro`
is no longer a card — it renders one leg row and its `.dm-leg*` rules live in its own
`<style is:global>` block (scoped styles cannot see `.atl`, which is on the page wrapper). Page-level
`.dm-*` rules are prefixed `.atl.atl-domain`. `domain-surface.test.ts` re-runs §12 rules 1-3 over
both blocks and asserts the four silent failures below.

**The vocabulary is the honesty gate (§13.2 applied).** Two stores exist and they are not equally
trustworthy: `ip:answers:v1` is written on every topic, `ip:read:v1` only on topics that carry
think-prompt rows. So the second cannot distinguish "not visited" from "not instrumented", and this
page therefore says:

| Real signal | What the page says |
|---|---|
| `seen > 0` in the answer map | `practised 24 · 88%` — questions seen, accuracy over them |
| sections in `ip:read:v1`, nothing practised | `6 sections read` |
| neither | `no record` — never "not visited" |
| most recent `ts` across both stores | `RESUME HERE`, and the resume CTA's target |
| first leg with no record after that one | `NEXT UP` (a route, openly a suggestion, not state) |

The legend reads **COVERED / LAST HERE / NO RECORD**. The mock's `read · 2 rounds · 88%` is
degraded: rounds are stored nowhere. Its content-driven `SUGGESTED NEXT` needs a cross-reference
graph that does not exist. **Before a store is read — which with JS off is forever — the two derived
figures are an em dash, the meter's `aria-label` says coverage is not loaded, and the
review-missed route ships `hidden`.** `0` would be a claim about the reader; leg 01, question counts
and a `Start at leg 01` route are build-time truth and always ship.

**Three failure modes worth naming.**

1. **The `[hidden]` specificity trap.** `.atl .dm-leg` is (0,2,0); Tailwind's
   `[hidden] { display: none }` reset is (0,1,0). Every element hidden by ATTRIBUTE needs a
   companion `[hidden]` rule (`.dm-leg`, `.dm-leg__tag`, `.dm-noresults`, `.atl-cta`) or it stays on
   screen while leaving the accessibility tree — the worst of both.
2. **One read per store.** The old card called `missedCount()` per card: on system-design's 94 legs
   that is 94 reads and 94 JSON parses of the whole answer map. The page now does one
   `readAnswers()`, one `readStore(READ_KEY)`, and one loop.
3. **Leg numbers come from `getDomainSequence()`, not `subtopic.position`,** which is 1-based *within
   its group* and so printed "01" seven times on system-design.

**The three routes here** — resume · practice this domain · drill missed — are **plain anchors and
nothing more**. GRAFT 3's `R`/`P`/`D` accelerators were withdrawn (§13.1: WCAG 2.1.4), so this page
binds **no `keydown` at all** and prints no keycap; `domain-surface.test.ts` §5 asserts that the
three anchors survive as links and that no `ROUTES` map, guard flag or `aria-keyshortcuts` came
back. The drill route still ships `hidden` until the hydrator finds a missed answer to drill.

**Two deliberate departures from the mock.** The leg tag's border is the channel but its words are
`--atl-ink`, because `.dm-leg__link:hover` raises the row to plane-1 where one channel fails AA as
text (§13 rule 9) — so this surface adds no new channel-as-text site. And the "missed q" figure is
ink, not channel, for the same audit reason. The two section heads are real `h2`s rather than the
mock's labelled `<p>`s, so `aria-labelledby` names a heading; `.atl-label` sets size, weight and
margin itself, so they render identically. **Group structure stays flattened** (system-design's
seven groups) — atlas wants them back as named stages on the rail, and that is a change to how
`catalog.json` groups are consumed, not a restyle.

### 13.4 `/topic/<domain>/<slug>` — the junction

The hub becomes a **position page**. What it replaced answered none of "where am I, what is
inside this, what next": a back-link, a mesh-textured gradient `h1`, two icon-tiled cards (one on
`--gradient-brand` with `--shadow-glow`) and the domain disclosure. Six devices now, and page
rules are prefixed `.atl.atl-topic`. `topic-surface.test.ts` (42 tests) re-runs §12 rules 1-3
over the block and asserts the silent failures below.

1. **The spine continued** — the same transit line one level deeper:
   `CATALOG ── PLATFORM & OPS ── DOCKER ── ▪ LEG 02`. Below 640px the two `--far` waypoints drop
   and `DOCKER → LEG 02` remains, so the itinerary is always one tap away.
2. **`LEG nn OF nn`** in the eyebrow, from `getDomainSequence()` — the FLATTENED order, never
   `subtopic.position` (1-based within its group; it printed "01" seven times on system-design).
   `/domain`, `/topic` and `/study` therefore say the same number about the same subtopic.
3. **The position strip** — the domain's one-cell-per-leg meter with THIS leg current, the
   legend, and the legs either side **named** with their question counts.
4. **The two ports** — Study and Practice as hairline-topped blocks, the primary one marked by a
   2px channel rule. No card, no gradient, no glow, no icon tile.
5. **The section manifest** — every `## H2` on a rail, each a deep link into the read and each
   with its **real** question count from `@lib/manifest` (§4.2.1, §5). Both the manifest and the
   study TOC read `render(entry).headings`, so they cannot disagree, and stop text is printed
   **verbatim** because it is an MCQ anchor target (§4/§6).
6. **The route onward** — the next leg by name; on the last leg, the next domain, so the route
   never dead-ends. On a clarity-migrated topic it opens at the exact section that settles this
   leg's cliffhanger, using the authored `prompts.cliffhanger.payoffHref`.

**The honesty gate (§13.2 applied).** Same two stores and the same vocabulary as §13.3 —
COVERED / NO RECORD, never "read", never "not visited". The **covered** figure is an em dash
until a store is read (with JS off, forever) and the drill route ships `hidden`. **One state IS
server-rendered, deliberately: `is-here`.** It comes from the URL, not from a store, so a reader's
own position is correct with no JS at all; the hydration pass is told to skip that cell by
`data-tp-here`. Two degradations are specific to this page:

- **No per-stop read state.** The mock fills a manifest node once its section has been read.
  `ip:read:v1` is per-section and could answer that on a clarity topic — and would answer "not
  read" for every section of every un-instrumented topic however carefully it was read. A map
  that lies is worse than a map with one fewer layer, so the nodes are uniform and the only
  column a stop carries is one that is real. Asserted: no `.tp-stop.is-*` rule exists.
- **No lead paragraph.** The mock opens with a sentence of the topic's own prose. No
  per-subtopic summary exists in `catalog.json` or in the collection frontmatter, and lifting
  the first paragraph out of `concepts.md` would put unrendered markdown on the page.

**Three failure modes worth naming.**

1. **The 360px spine.** A waypoint is `white-space: nowrap`, and the longest full domain title is
   55 characters (~385px into a 328px content box). Two independent guards, both asserted: the
   spine takes the SHORT title (`@lib/domain-title`, capping at 36) with the full one as `title`,
   and the domain waypoint is allowed to wrap below 640px. The count column is likewise **not**
   hidden below 480px as the mock had it — `display: none` would take it out of the
   accessibility tree, and it is what the list is for; the column gap shrinks instead.
2. **Adjacent expressions eat their space.** `{stops.length} {sectionWord}` inside a conditional
   fragment rendered `15sections`, and `{n}{" "}{word}` rendered `3  questions`. Anything of the
   form "number + word" is built as one string in the frontmatter (`stopPhrase`,
   `endOfDomainLabel`) rather than two template expressions.
3. **One read per store.** The meter needs the whole domain's coverage; per cell that would be up
   to 94 reads and 94 parses of the entire answer map. One `readAnswers()`, one
   `readStore(READ_KEY)`, one loop — asserted by count.

**The three routes here** — read this leg · practise it · drill what you missed on it — are **plain
anchors and nothing more**. GRAFT 3's `R`/`P`/`D` accelerators were withdrawn (§13.1: WCAG 2.1.4),
so this page binds **no `keydown` at all** and prints no keycap; `topic-surface.test.ts` §6 asserts
the anchors survive as links and that nothing keyed is layered back over them. Astro **inlines** an
import-free script into the HTML, so this page's position hydrator is a CSP hash rather than a
bundle — verified present in `dist/_headers`.

**One departure from the mock beyond the degradations.** `.tp-route__go` is `--atl-ink`, not the
channel. It would be legal here (its ground is plane-0, and rule 9 permits channel-as-text
there), but rule 9's audit names its two sites and a page may not add a third quietly. The
channel stays a graphic on this surface: the eyebrow tick, the primary port's 2px rule, and the
current meter cell.

### 13.5 `/study/<domain>/<slug>` — the read

The forty-minute page. Its one unanswerable question was "where am I, and what do I do next", and
four devices answer it — **every one of them outside the reading measure**, which is the whole
reason atlas does not become chrome crowding the prose. Page rules are prefixed
`.atl.study-page`; `study-surface.test.ts` (34 tests) re-runs §12 rules 1-3 over the block and
asserts the silent failures below.

1. **The locator** — a 46px sticky bar whose readout (`§ 05 · <section> · ▪▪▪▫▫ · 5/13`) IS the
   `<summary>` of a `<details>`, so tapping the bar opens the route drawer. The drawer **overlays**
   (`.atl-drawer`, absolute off the bar), so it never reflows a word. It sticks at
   `--st-header-h: 68px` — the site header is a 44px row inside `py-3` plus a 1px border, so the
   locator tucks 1px under that edge — at `z-index: 30`, below the header's 40. That header now
   publishes its own height as `--hdr-h: 4.3125rem` (69px) in BaseLayout, beside the header it
   measures, and both marketing pages' sticky track heads consume `var(--hdr-h, 4.3125rem)` instead
   of keeping copies of the number: two copies is how `/catalog`'s track head came to sit 16px short
   of a wrapped header and clip 8px of its own heading's ink. **46px is the
   permanent cost and the only one**; the mock's theme toggle is not duplicated here because
   BaseLayout's header already owns one.
2. **The route line** — the transit spine one level deeper than `/topic`:
   `CATALOG ── PLATFORM & OPS ── DOCKER ── LEG 02 ── ▪ STUDY`. Same waypoint primitives, same
   `--far` drop below 640px, same SHORT domain title (`@lib/domain-title`) plus the wrap
   allowance, so a 55-character title cannot overflow 360px.
3. **The spine** — the shipped TOC hooks (`.toc-aside .toc-panel .toc-label .toc-rail
   .toc-progress .toc-list .toc-link`) restyled as a route diagram: a node per stop, a mono `§NN`
   matching the folio in the prose, and a legend. It **stays pinned flush to the viewport's right
   edge** (§13.2). `.toc-panel` sticks below both bars, computed from `--st-header-h` +
   `--atl-locator-h` rather than a second magic number.
4. **`§ NN` folios** above every H2, from `counter(atl-sec, decimal-leading-zero)` — **pure CSS,
   no pipeline change**, so the markdown is untouched and heading TEXT (an MCQ anchor target, §6)
   is never edited. The folio and the spine's numerals count the same H2s in document order, so
   they cannot disagree. Its 3px channel tick hangs into `<main>`'s own 1rem gutter, costing the
   measure nothing.

Then **the seam**: the cliffhanger read as a territory boundary — travelled line → `unanswered`
gap → the next node — with the authored hook, the teasers numbered `Q1…` **by a CSS counter** (so
`Cliffhanger.astro`'s markup is untouched), and a named route onward. That card is a deliberate
re-decision of the component's "no next-topic link" note: it names the next leg **and the exact
section that settles the loop**, which the pager cannot say. The section name is real authored
text — the next topic's own heading, found by `payoff.anchor` in that entry's `headings` — and
`payoff.claim` is still never rendered. The extra `render()` runs only on the ~17 topics whose
cliffhanger points at the genuine next leg.

**The reading contract came through intact**, and that is asserted here as well as in the two
frozen files. One value moved by explicit decision and one only: `--measure: 79ch` at ≥1024px,
capped so the line stops growing with the monitor (was 104ch — see the GRAFT 1 section above for
the measurements). Everything else is unchanged: 68ch/80ch stay global.css's and are not
re-declared,
`.study-prose` leading 1.68, the 1.35em block gap, the right-only bleed cap, and the
`margin-right: calc(1rem - (100vw - 100%) / 2)` pin. The grid gutter stays **4.5rem** rather than
the mock's `var(--prose-bleed)`: tying it to the bleed makes a bled table end *exactly* on the
spine's left edge, and "exactly touching" is not a margin of safety on a 1px rail.

**Prose heading SIZES are unchanged** (`--step-2` / `--step-1`), deliberately against the mock.
`--atl-t-ph2` (24 → 28px) and `--atl-t-ph3` (19 → 21px) were chosen for a ~17px body; GRAFT 1
raised the body to 19.8px at desktop, where those steps would leave an H3 6% larger than the
paragraph it heads. The shipped steps keep 1.8× / 1.2× over the raised body. `--atl-t-ph3` earns
its keep on `h4`, which shipped at the same `--step-1` as `h3`.

**The honesty gate (§13.2 applied).** Nothing on this page claims a section was READ. The spine's
and the locator's marks are **scroll position** — the legend says **PASSED / HERE / AHEAD** — and
the words are position words for a reason: `ip:read:v1` is written only on topics carrying
think-prompt rows, so it cannot tell "not read" from "not instrumented". Two further degradations:

- **No drill route.** A "review N missed" figure needs `missedCount()` from `@lib/progress`, and
  `reading.test.ts` asserts that **this page never imports the retrieval module**, so reading
  coverage can never reach the mastery/SRS/streak numbers a learner trusts. That bright line
  outranks the convenience; the drill route stays on `/domain` and `/topic`, which already read
  that store, and reaching into `ip:answers:v1` by hand here would honour the letter of the test
  and break its point. (This outlived GRAFT 3, which is why it is still stated here: it was also
  the reason that surface's withdrawn `D` accelerator never existed on `/study`.)
- **The mock's "3 of 16 legs read" hero figure is dropped**, for the same reason /domain and
  /topic degrade theirs: with no JS it is unknowable, and domain-level coverage is what those two
  surfaces are for.

**Five failure modes worth naming.**

1. **The stray `*/`.** A comment appended after a comment's own terminator left `… writes by
   hand. */` as bare text before the bleed-cap selector, and CSS then folded the junk into the
   selector and **dropped the whole rule** — no error, no build warning, just a table that stops
   bleeding at 1024px. Caught by the surface test's exact-selector lookup, which is why that test
   looks up rules by selector rather than grepping for a substring.
2. **Specificity by source order.** The drawer's panel carries `.toc-panel`, whose spine rule
   makes it `position: sticky` with a viewport-height cap. At equal (0,3,0) the winner was
   whichever rule sat lower in the file. Every drawer override now names `.atl-drawer` and wins at
   (0,4,0) wherever it sits.
3. **`a:not(.heading-anchor)`.** `rehype-autolink-headings` runs with `behavior: "wrap"`, so every
   heading IS an `<a>`; a bare `.prose a { color: … }` at (0,3,0) beats global.css's
   `.prose .heading-anchor { color: inherit }` and paints all thirteen headings in the channel.
4. **`.study-outro` was a live selector.** The reveal client's last-section fallback
   (`panel ?? page.querySelector(".study-outro")`) had to be renamed with the element. It is
   unreachable today (a topic with prompt rows always has the panel), which is exactly why a
   silent rename would have sat there until it wasn't.
5. **The route drawer must be server-rendered.** The mock clones the spine's `<ul>` with a
   script, which leaves the phone's only route menu empty with JS off. Both lists come from
   `StudyRoute.astro` instead — one source of truth, no clone — and the shipped observer already
   de-duplicates `[data-toc-link]` by slug, so rendering the list twice costs no second script.

**Two deviations from the mock in colour, both measured.** Callouts sit on the **page ground**
rather than the mock's plane-1 panel: the `[!INTERVIEW]` type is `--accent-violet`, and dark
`#8B5CF6` on plane-1 is **4.49:1** — an AA fail for a title — while on plane-0 all four callout
accents clear AA in both themes (worst case light `#9a6700` at 4.87:1), which is what lets the
title keep the type's own colour. And the active spine stop is **ink + weight**, not the mock's
channel numeral, because `.toc-link:hover` raises that row's ground to plane-1; the channel stays
the node, a graphic, which owes 3:1.

**One channel per page, and `--topic-accent` is now that channel.** Both custom properties are
set from the same `@lib/atlas` lookup, so the accent the frozen contract already threads through
this page (prompt rows, prose links, the spine's fill) and the accent atlas draws its marks with
cannot be two colours. This replaces the per-GROUP accent system-design study pages used to
carry — the deliberate trade of atlas's "one channel per page" thesis. Every channel-as-text site
on this surface is a plane-0 ground, and `study-surface.test.ts` lists them **by name** so a
fourth cannot appear quietly.

**GRAFT 2 lives here** (the only prose surface): `plugins/rehype-plates.mjs` wraps every
**root-level** code fence and table in `<figure class="atl-plate">` with a `Plate NN · <language>`
caption, numbered per document, `data-pagefind-ignore`d. It walks `tree.children` rather than
`visit()`ing, so a `pre` inside a callout is left alone; it skips mermaid twice over (a diagram is
still a `raw` node at that point, and the className is checked anyway) because `pre.mermaid` has
its own width rule that depends on staying a direct child. `figure` is in
`@lib/reading`'s `BLOCK_SELECTOR` for the same reason: one plate is one block, and without it
every code-heavy section would silently lose its coverage blocks on all 460 topics.

### 13.6 How all of this is enforced — the gate map, and what no gate covers

Four commands. Run all four before claiming a change to a learning surface is done; the first
three are cheap enough that there is no excuse, and the fourth is the only one that proves the
corpus still renders.

| Command | What it proves |
|---|---|
| `npm run check` | sync + `astro check` — types, `getStaticPaths` shapes, collection schema. |
| `npm test` | `vitest run` — the source-level invariants below. |
| `npm run check:marketing` | **two** gates in one line: `git diff --quiet HEAD -- src/styles/global.css` (global.css has not moved, working tree *and* index) and the banned-token grep over the two marketing pages. Must stay **exit 0**. |
| `npm run build` | 460 pages + Pagefind + the CSP header pass. The only gate that executes the markdown pipeline, so it is the only one that would notice a plate pass that throws. |

**Two test files are FROZEN: `study-css.test.ts` (24) and `theme-css.test.ts` (8) — 32
assertions.** Between them they gate global.css: locked/armed height parity (zero CLS), the
inverted no-JS contract and the `[data-pd="on"]` flag, the single 150ms fade, the seven approved
`.prose` typography changes — including `--measure` 68ch, `--measure-wide`, `--topic-accent` and
the `.prose > pre, .prose > table` bleed list **by exact string** — the tier marks, the fixed grid
backdrop, and `--color-primary-contrast`'s AA on its fills. Note what they do **not** cover, so
the halves are not confused: the desktop `79ch`, the `1.68` leading, the `1.35em` block gap and
the TOC's flush-right pin live in the study page's own block and are gated by
`study-surface.test.ts` (plus, doc-side, by `contract.test.ts`). **Never weaken, edit or extend an existing
assertion in those two files.** If a change appears to require it, the change is wrong or the
constraint needs a fresh sign-off — stop and escalate rather than editing the test. **Adding** a
test is always the sanctioned move, which is why this refresh added **eleven** new test files
(the suite is 351 tests across 17 files today) and **zero** edits to those two — verified:
`git diff HEAD -- src/lib/study-css.test.ts src/lib/theme-css.test.ts src/styles/global.css` is
empty.

| Test file | Freezes |
|---|---|
| `study-css.test.ts` (24) · `theme-css.test.ts` (8) | **FROZEN.** The reading contract and the two themes. |
| `atlas-css.test.ts` (63) | The foundation: `.atl` inertness (properties only), the type ladder, computed contrast on all four planes in both themes, the channel-as-text audit list, `--atl-node-ring`'s 3:1, 44px targets, the 46px locator, and both halves of the GRAFT 2 bleed split. |
| `domain-surface.test.ts` (30) · `topic-surface.test.ts` (38) · `study-surface.test.ts` (31) | Per surface: §12 rules 1-3 over that page's style block, the honesty vocabulary, the `[hidden]` companion rules, the **withdrawn** GRAFT 3 accelerators staying withdrawn (§13.1), heading order and landmarks, 360px overflow. |
| `plates.test.ts` (19) | The GRAFT 2 transform in isolation: numbering, captions, mermaid skipped in **both** class spellings, nested fences and raw nodes. |
| `atlas.test.ts` (17) · `channels.test.ts` (7) · `domain-title.test.ts` (4) · `manifest.test.ts` (14) | The build-time libs behind the spine, the channel, the short title and the section counts. |
| `reading.test.ts` (33) · `progress.test.ts` (12) | The two stores — including the assertion that `/study` never imports the retrieval module, which is why it ships no drill route (§13.5). |
| `contract.test.ts` (24) | **This document against the code.** See below. |

**`contract.test.ts` exists because a unit test can be green about a feature that is not wired
up.** `plates.test.ts` exercises the plate transform directly; deleting the one line in
`astro.config.mjs` that registers `rehypePlates` would take 4,868 plates off the corpus and leave
every test passing. It closes four classes of drift: the **pipeline** (plates registered, and
still LAST), the **numbers this document quotes** (`--atl-locator-h`, `--st-header-h`, the
`--prose-body` clamp, the two prose type steps, `--atl-node-ring`'s two hexes, and the reading
contract's own figures — each must appear in both the doc and the source), the **GRAFT 3
withdrawal** (§13.1 must still record the WCAG 2.1.4 reasoning, and no page may have re-added a
`ROUTES` map, a document `keydown`, an `aria-keyshortcuts` or a printed `<kbd>`), and the
**guard itself** (`check:marketing`
still runs the `global.css` diff and still bans every token §12 says it bans). It also fails if a
new `src/lib` module or a new pipeline plugin lands undocumented.

**What no gate covers — every one of these is a measurement, not a promise.** There is no browser
in CI: the chars-per-line figures, the 1048px plate width, the 8px TOC clearance, the "0 of 212
boxes move" inertness proof, the 4,868-plate corpus count and every screenshot-level claim in §13
were measured in Chromium at a point in time and are frozen only as far as the doc↔source
cross-check above reaches. Contrast is computed from token **hex values**, not sampled pixels, so
it cannot see a wash an opacity introduces. No axe/Lighthouse run is wired in, so AA, focus order
and screen-reader output are argued from source and were hand-checked, not gated. Treat a change
that moves layout, opacity or a colour token as **unverified until re-measured in a browser**.
