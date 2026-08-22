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
- Markdown pipeline (configured in `astro.config.mjs`, do not change):
  - `remark-gfm` — GFM tables in `concepts.md` comparison sections.
  - `rehype-slug` — GitHub-slugger-compatible heading ids (matches `ref` anchors).
  - `rehype-autolink-headings` (`behavior: "wrap"`, class `heading-anchor`) — anchor affordance.
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
      system-design/_group-{core,advanced,aws}.slim.json
```

## 3. Content sync (`npm run sync`)

`scripts/sync-content.mjs` reads the **read-only** source at
`/path/to/interview-prep/topics` and regenerates everything below. It is
**idempotent** — it deletes its output dirs first, so re-running always mirrors source.
Wired into `dev` and `build` (both run sync first). Never edit generated files by hand;
never modify anything under `topics/`.

Authored domains (browsable): `system-design`, `spring-boot`, `spring-core`, `java-jvm`.
Coming-soon domains (no content, `authored:false`): `docker`, `kubernetes`, `devops-cicd`,
`hibernate-jpa`, `messaging-databases`. Domain display titles come from
the first `# H1` of `topics/<domain>/README.md`.

**Current generated volume:** 4 authored domains, 6 coming-soon, 119 subtopics, 9432
questions (system-design 57/4515, spring-boot 18/1851, spring-core 19/1511, java-jvm 25/1555).

## 4. Generated data shapes

### 4.1 `src/data/catalog.json` — the manifest pages render from

Shape: `{ domains: CatalogDomain[] }`. Import it via `@lib/catalog` helpers (§5), not by
reading the file directly. Real excerpt (trimmed to one authored + one coming-soon domain):

```json
{
  "domains": [
    {
      "slug": "system-design",
      "title": "System Design",
      "authored": true,
      "subtopicCount": 57,
      "questionCount": 4515,
      "groups": [
        {
          "key": "core",
          "label": "Core Topics",
          "subtopics": [
            { "slug": "caching-and-cdn", "title": "Caching and CDN", "questionCount": 80 }
          ]
        }
      ]
    },
    {
      "slug": "docker",
      "title": "Docker",
      "authored": false,
      "subtopicCount": 0,
      "questionCount": 0,
      "groups": []
    }
  ]
}
```

- **Domain order** in `domains[]`: authored first (system-design, spring-boot, spring-core,
  java-jvm), then coming-soon (docker, kubernetes, devops-cicd, hibernate-jpa,
  messaging-databases).
- **Groups:** `system-design` has exactly 3 groups in this order:
  `core` (label "Core Topics", 23 subtopics), `advanced` (label
  "Advanced & Expert Deep-Dives", 8 subtopics), `aws` (label "AWS System Design", 26
  subtopics). Grouping rule: slug prefix `aws-` -> `aws`; the 8 known deep-dive slugs ->
  `advanced`; everything else -> `core`. All other authored domains have a **single** group
  `{ key: "all", label: "", subtopics: [...] }`.
- Subtopics within a group are sorted by `title` (locale-aware).
- Subtopic `title` comes from the `topic` field of its `questions.yaml` (fallback: concepts.md H1).
- Coming-soon domains have `groups: []` and zero counts — render as **disabled, non-clickable
  "Coming soon"** cards.

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
| `public/questions/system-design/_group-core.slim.json` | system-design "core" pool (slim) |
| `public/questions/system-design/_group-advanced.slim.json` | system-design "advanced" pool (slim) |
| `public/questions/system-design/_group-aws.slim.json` | system-design "aws" pool (slim) |

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
