# Enhance Contract — Design System for feature agents

This is the **Foundation design-system contract**. It sits on top of (and does not
replace) `CONTRACT.md`. Feature agents restyling individual pages must consume the tokens,
utilities, and patterns below rather than inventing new ones. All paths are relative to
`/path/to/interview-prep/web`.

The look is **bold, modern, expressive, highly responsive** — an indigo→violet accent family
over a refined cool-neutral base, OKLCH-authored for perceptually-even light/dark themes,
compositor-only motion, and WCAG AA verified.

---

## 0. Hard DO-NOT list (read first)

- **Do NOT** use `set:html`, `innerHTML`, `dangerouslySetInnerHTML`, or `define:vars` anywhere.
  Markdown renders via Astro `render()` + `<Content />` — keep it that way.
- **Do NOT** animate layout/main-thread properties for motion: never transition/animate
  `width`, `height`, `top`, `left`, `margin`, `padding`, `background-color`, `background-position`
  for *movement*. Animate **only `transform` and `opacity`**. (Color/`background-color`
  transitions for *state change* like hover tints are fine; just don't use them for entrance/motion.)
- **Do NOT** ship custom motion without a `@media (prefers-reduced-motion: no-preference)` gate
  and a static, fully-usable resting state (WCAG 2.3.3).
- **Do NOT** rename existing tokens (`--color-bg`, `--color-surface`, `--color-surface-2`,
  `--color-border`, `--color-text`, `--color-text-muted`, `--color-primary`,
  `--color-primary-hover`, `--color-primary-contrast`, `--color-accent`, `--color-focus`,
  `--color-code-bg`, `--color-correct`, `--color-incorrect`, `--space-*`, `--radius-*`,
  `--measure`). Add tokens; never rename.
- **Do NOT** change routes, `getStaticPaths` shapes, `catalog.json` / question JSON schemas,
  the sync script output, `BaseLayout` props, or anything under `../topics` (read-only content).
- **Do NOT** add a second Preact island. Motion is for the practice quiz island only.
- **Do NOT** use viewport-only `clamp()` for type (fails zoom/WCAG 1.4.4). Use the `--step-*`
  scale, whose min/max are in `rem`.

---

## 1. Color tokens (OKLCH) — names, light/dark values, measured contrast

All tokens are CSS custom properties in `src/styles/global.css`, on `:root` (light) and
`[data-theme="dark"]` (dark). Use them via inline `style="color: var(--color-text)"` **or**
the Tailwind aliases in §6 — both work. Values shown are the authored OKLCH plus the sRGB hex
they resolve to (for reference only; author in the token).

### Core semantic tokens

| Token | Light OKLCH (hex) | Dark OKLCH (hex) | Role |
| --- | --- | --- | --- |
| `--color-bg` | `0.995 0.003 270` (`#fdfdff`) | `0.175 0.02 275` (`#0e1019`) | page background |
| `--color-surface` | `0.975 0.006 275` (`#f5f6fb`) | `0.215 0.024 275` (`#161925`) | cards / raised |
| `--color-surface-2` | `0.955 0.01 275` (`#eef0f7`) | `0.265 0.028 275` (`#212433`) | insets / chips |
| `--color-border` | `0.905 0.014 275` (`#dddfe9`) | `0.33 0.03 275` (`#313445`) | hairlines |
| `--color-text` | `0.255 0.028 275` (`#1f2230`) | `0.945 0.01 275` (`#ebecf4`) | body text |
| `--color-text-muted` | `0.505 0.03 275` (`#5f6476`) | `0.72 0.026 275` (`#9fa4b5`) | secondary text |
| `--color-primary` | `0.52 0.224 274` (`#494ee6`) | `0.72 0.13 274` (`#8c9df6`) | links, primary btn |
| `--color-primary-hover` | `0.455 0.23 274` (`#3b34d2`) | `0.8 0.095 274` (`#aabafb`) | primary hover |
| `--color-primary-contrast` | `#fdfdff` | `#0e1019` | text ON primary |
| `--color-accent` | `0.56 0.21 305` (`#9246d4`) | `0.76 0.15 305` (`#c797fd`) | violet accent |
| `--color-focus` | = primary | = primary | focus ring |
| `--color-code-bg` | `0.965 0.008 275` | `0.235 0.026 275` | inline/code bg |
| `--color-correct` | `0.52 0.15 150` (`#007f35`) | `0.78 0.15 150` (`#67d283`) | quiz correct |
| `--color-incorrect` | `0.52 0.205 27` (`#c4111a`) | `0.72 0.17 27` (`#fd7468`) | quiz incorrect |

### Group-accent tokens (system-design Core / Advanced / AWS)

| Token | Light (hex) | Dark (hex) | Group |
| --- | --- | --- | --- |
| `--color-group-core` | `0.545 0.2 264` (`#3164e2`) | `0.76 0.12 264` (`#8ab0fe`) | Core Topics |
| `--color-group-advanced` | `0.54 0.235 320` (`#a623c0`) | `0.76 0.15 320` (`#db90ec`) | Advanced & Expert |
| `--color-group-aws` | `0.52 0.13 50` (`#a24e10`) | `0.8 0.13 65` (`#f7ab5d`) | AWS |

### Measured WCAG contrast ratios (computed from the OKLCH→sRGB values)

Body text needs ≥ 4.5:1; large text / UI/icon needs ≥ 3:1. **All text/accent tokens pass AA.**

| Pair | Light | Dark | Gate |
| --- | --- | --- | --- |
| text / bg | 15.5 | 16.1 | AAA |
| text / surface | 14.6 | 14.9 | AAA |
| text / surface-2 | 13.9 | 13.1 | AAA |
| text-muted / bg | 5.79 | 7.64 | AA |
| text-muted / surface | 5.45 | 7.04 | AA |
| primary / bg | 5.88 | 7.47 | AA |
| primary / surface | 5.53 | 6.89 | AA |
| primary-contrast / primary (button label) | 5.97 | 7.45 | AA |
| accent / bg | 5.11 | 8.38 | AA |
| correct / bg | 5.06 | 10.1 | AA |
| correct / surface | 4.76 | 9.27 | AA |
| incorrect / bg | 6.00 | 7.11 | AA |
| incorrect / surface | 5.65 | 6.56 | AA |
| group-core / bg | 5.10 | 8.78 | AA |
| group-advanced / bg | 5.71 | 8.32 | AA |
| group-aws / bg | 5.69 | 9.88 | AA |

> `--color-border` on bg is ~1.3–1.5:1 by design (decorative hairline, not text/essential UI).
> If you need a **non-text-adjacent focusable border to meet 3:1**, use `--color-primary`
> (which does) rather than `--color-border`.

### Gradients & mesh (expressive backgrounds)

- `--gradient-brand` — indigo→violet→magenta 135° linear. Use for hero fills, the logo mark,
  and the `.text-gradient` helper.
- `--gradient-brand-soft` — same hues at low alpha; use behind heroes / callouts as a tint.
- `--bg-mesh` — layered radial OKLCH glows for large hero/section backgrounds
  (apply via `.bg-mesh` on a positioned wrapper).

---

## 2. Fluid type scale + spacing

rem-floored `clamp()` (scales on zoom → WCAG 1.4.4 safe). Body defaults to `--step-0`.

| Token | Range | Suggested use |
| --- | --- | --- |
| `--step--1` | 0.83→0.9rem | fine print, captions |
| `--step-0` | 1→1.125rem | **body** (set on `<body>` and `.prose`) |
| `--step-1` | 1.2→1.5rem | h4 / lead |
| `--step-2` | 1.44→1.95rem | h3 / h2-prose |
| `--step-3` | 1.73→2.6rem | section headings |
| `--step-4` | 2.07→3.45rem | page h1 |
| `--step-5` | 2.49→4.6rem | hero display |

Use as `style="font-size: var(--step-4)"` or Tailwind `text-step-4` (see §6).
Fluid spacing: `--space-section` (≈3→6rem block rhythm) and `--space-gap` (≈1→2rem).
Reading measure for long-form: `--measure` (68ch) — already applied by `.prose`.

Line-height: keep body unitless ~1.6 (`.prose` uses 1.7); reading measure 60–75ch.

---

## 3. Utility classes (site-wide)

All defined in `global.css`. All motion is reduced-motion-gated with a static resting state.

### `.card`
Surface + border + radius + `--shadow-1`. When the card is itself an `<a>` or `<button>`
(or you add `.card-interactive`), it gets a hover **lift** (`transform: translateY(-3px)` +
`--shadow-3` + primary-tinted border) — transform/shadow only, gated behind reduced-motion.

```astro
<a href="/topic/..." class="card card-interactive block p-5 no-underline">…</a>
```

### `.text-gradient`
Clips `--gradient-brand` to text. Has a solid `--color-primary` fallback where
`background-clip: text` is unsupported. Use on hero words / logo, not long passages.

```html
<h1 class="text-step-4"><span class="text-gradient">Master</span> the interview</h1>
```

### `.surface-brand` / `.bg-mesh`
`.surface-brand` = soft brand tint over surface (callouts/heroes).
`.bg-mesh` = the layered OKLCH mesh; put it on an absolutely-positioned decorative wrapper
behind hero content (add `aria-hidden` to purely decorative layers).

### `.reveal` — native scroll-driven entrance (preferred for below-the-fold)
Uses `animation-timeline: view()` — runs **off the main thread**. Resting state is fully
visible, so under `prefers-reduced-motion` OR where `animation-timeline` is unsupported it is a
**no-op** (content just shows). Add `.reveal` to any element; for staggered siblings add
`.reveal-delay-1|2|3`.

```html
<section class="reveal">…</section>
<li class="card reveal reveal-delay-1">…</li>
```

### `.anim-*` — time-based entrance (for above-the-fold, plays once on load)
Compositor-only keyframes, reduced-motion gated. Combine one animation class with an optional
stagger class:

- Animations: `.anim-fade-up`, `.anim-scale-in`, `.anim-fade-in`
- Stagger (additive delay): `.anim-stagger-1` … `.anim-stagger-5`

```html
<h1 class="anim-fade-up">…</h1>
<p  class="anim-fade-up anim-stagger-1">…</p>
<a  class="anim-scale-in anim-stagger-2">…</a>
```

### Elevation / radius
Shadows `--shadow-1|2|3` and `--shadow-glow` (colored). Radii `--radius-sm|md|lg|xl|full`.
Tailwind: `shadow-1|2|3|glow`, `rounded-xl` (maps to `--radius-xl`).

### 3D depth system (landing page; reusable)
Four composable effects in `global.css`, all compositor-only (transform/opacity), all
reduced-motion gated with a fully-visible static resting state, **zero new dependencies**.
Read the block comments in `global.css` before changing them — the structural requirements
below are load-bearing, not stylistic.

| Class | Effect |
| --- | --- |
| `.scene-3d` | perspective container; put it on the grid/list that holds tilting children |
| `.tilt-in` | scroll-driven `rotateX` entrance (native `view()` timeline). Reuses `.reveal-delay-1|2|3` for stagger |
| `.deck` / `.deck-card` / `.deck-runway` | sticky stacked card deck |
| `.depth-scene` / `.depth-layer` | hero parallax — layers drift at different Z depths on exit |
| `.tilt-pointer` | cursor-follow tilt (fine-pointer only; needs the small script on the landing page) |

Tunable per scope via custom properties (`--tilt-from-rot`, `--depth-y`, `--depth-rot`,
`--depth-fade`, `--deck-scale`, `--deck-z`, `--deck-step`, `--deck-runway-h`, …).

**Three non-obvious rules** (each cost real debugging — don't "simplify" them away):

1. **Never put `.tilt-in` and `.tilt-pointer` on the same element.** One animates `transform`,
   the other transitions it; they'd overwrite each other. Wrap: `li.tilt-in > div.tilt-pointer`.
2. **A sticky element cannot drive its own scroll animation.** A `view()` timeline tracks
   position in the scrollport, and a *stuck* element has stopped moving — progress freezes at 0
   for the whole pinned stretch, then snaps. Hence `.deck-card` animates against the
   `.deck-runway` spacer that *follows* it, published via `timeline-scope` on `.deck`. The card
   also needs `--deck-index` + inline `animation-timeline` / `view-timeline-name` per index.
3. **`overflow: hidden` makes an element a scroll container.** The hero panel is
   `overflow-hidden`, so a `view()` timeline on a layer inside it resolves against that
   non-scrolling box and never advances. That's why `.depth-layer` references a *named*
   timeline declared on `.depth-scene` instead of using `view()` directly — which also keeps
   every layer on one shared progress value so they can't desync.

Deck cards must stay **fully opaque** and carry ascending `z-index`, and the sticky offsets form
a staircase (`--deck-step` < the card's top padding). Fading them makes buried cards translucent
so overlapping text turns to mush; a shared offset exposes a strip big enough to leak headings.

### Scroll performance: never use `background-attachment: fixed`
A fixed *background attachment* cannot be composited — its position relative to the scrolling
box changes every frame, so the browser re-rasters it continuously. The grid backdrop used to be
`background-attachment: fixed` on `<body>` and made the whole site feel laggy. Measured on the
landing page (70 wheel steps, scrolling up from the bottom, grid verified painting in both):

| Approach | Raster tasks | Raster time |
| --- | --- | --- |
| `body::before` fixed layer (current) | 348 | 59ms |
| `background-attachment: fixed` (old) | 4149 | 718ms |
| no grid at all (control) | 347 | 61ms |

Use a `position: fixed` pseudo-element instead — promoted once, never redrawn, effectively free.

**Two invariants this depends on, both guarded by `src/lib/theme-css.test.ts`:**
- `<body>` must NOT set a `background-color`. The grid is a `body::before` at `z-index: -1`, and
  a negative z-index only escapes behind its own element's background if that background is
  absent. The page base color therefore lives on `<html>`. Regressing this makes the grid
  **silently invisible** — pixel-identical to deleting it, with no build or visual error.
- `--color-primary-contrast` must stay near-black in the dark theme. It labels the primary,
  correct, and incorrect fills, which are all bright/high-chroma; white text fails WCAG AA on
  every one of them (2.4–3.8:1) while near-black clears it on all four (5.3–8.2:1).

### Link hover must not outrank component colors
The base link hover tint is `:where(a):hover`, deliberately at (0,1,0) specificity rather than
`a:hover` at (0,1,1). Tailwind v3 here strips `@layer`, so plain specificity decides: as
`a:hover` this rule beat every filled button's own class-based label color, recoloring CTA text
to `--color-primary-hover` while the background transitioned to that same value — the label went
invisible under the pointer (contrast 1.00:1, both themes). Keep the weight low so any component
that sets its own color keeps it on hover. `.btn-large:hover` also pins `color` explicitly.

---

## 4. The reduced-motion pattern (copy this)

Every hand-written animation MUST look like this — static resting state outside, motion inside
the gate:

```css
.thing { opacity: 1; transform: none; }            /* resting, always usable */

@media (prefers-reduced-motion: no-preference) {
  .thing {
    animation: fade-up var(--dur-med) var(--ease-out) both;
  }
}
```

For scroll-driven reveals, also wrap in `@supports (animation-timeline: view())` so
unsupported browsers keep the visible resting state (the `.reveal` class already does this).
Available motion tokens: `--ease-out`, `--dur-fast` (140ms), `--dur-med` (240ms).

---

## 5. ClientRouter (View Transitions)

`BaseLayout.astro` imports `ClientRouter` from `astro:transitions` and renders it in `<head>`,
so **every page** gets smooth client-side navigation automatically. It auto-degrades on
non-Chromium and auto-disables under `prefers-reduced-motion` (that auto-disable covers
Astro-generated transitions; your own hand-written animations still need the §4 gate).

- Default `::view-transition-old/new(root)` fade is defined in `global.css`, reduced-motion gated.
- The dark-mode toggle is re-initialized on `astro:after-swap` and the theme re-applied from
  `localStorage` after each swap — no flash, persists across navigations. Don't duplicate that
  logic per page.
- **Per-page transition names (optional convention):** to morph a shared element (e.g. a topic
  title flowing from the topic hub into the study page), add matching
  `transition:name="topic-<domain>-<slug>"` on both elements, and `transition:animate="fade"`
  (or a custom directive) where a specific effect is wanted. Keep names unique per page pair.
  Static content needs nothing — the root fade handles it.

---

## 6. Tailwind token aliases (added, non-breaking)

`tailwind.config.mjs` maps semantic tokens to the CSS vars so you can use utilities instead of
inline styles. Existing inline `style="var(--color-*)"` usage keeps working unchanged.

- Colors (usable as `bg-*`, `text-*`, `border-*` where applicable): `bg`, `surface`,
  `surface-2`, `text`, `muted`, `primary`, `primary-hover`, `primary-contrast`, `accent`,
  `correct`, `incorrect`, `group-core`, `group-advanced`, `group-aws`.
- Border color: use `border-app` for the `--color-border` hairline (the bare `border` utility’s
  default color is also mapped to `--color-border`).
- Font sizes: `text-step--1` … `text-step-5`.
- Shadows: `shadow-1|2|3|glow`. Radius: `rounded-xl`.

Example: `<div class="card bg-surface text-text border-app text-step-1">`.

> Note: `text-muted` sets the *color* `--color-text-muted` (not Tailwind's default gray). Prefer
> these tokens over raw Tailwind palette colors so light/dark stay consistent.

---

## 7. Motion in the practice island

The practice quiz (`src/components/PracticeSession.tsx`) is the **only** island and the **only**
place `motion` is used.

- **Package:** `motion` (v12), imported as `import { motion, AnimatePresence, MotionConfig } from "motion/react"`.
- **Preact interop (already wired — do not re-add):**
  - `astro.config.mjs` → `preact({ compat: true })` aliases `react`/`react-dom` → `preact/compat`.
  - `astro.config.mjs` → `vite.ssr.noExternal: ["motion", "framer-motion"]` so the alias applies
    during the prerender/SSR pass (otherwise the build can't resolve `react`).
  - `tsconfig.json` → `paths` map `react`/`react-dom`/`react/jsx-runtime` to `preact/compat`
    for editor/type resolution.
- **Reduced motion:** wrap animated subtrees in `<MotionConfig reducedMotion="user">` — Motion
  then honors the OS `prefers-reduced-motion` setting and collapses animations to no-ops. This is
  the JS equivalent of the §4 CSS gate; use it instead of a media query inside the island.
- **Animate transform/opacity only** (`x`, `y`, `scale`, `opacity`) — never layout props.

Current usage (per-question entrance):

```tsx
<MotionConfig reducedMotion="user">
  <AnimatePresence mode="wait" initial={false}>
    <motion.div
      key={current}
      class="card p-5 sm:p-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      …question…
    </motion.div>
  </AnimatePresence>
</MotionConfig>
```

Keep motion subtle; don't animate the whole option list on every keystroke (jank + distraction).

---

## 8. Touch targets & responsiveness

- Interactive targets ≥ 24×24 CSS px (WCAG 2.5.8). Header controls are 44×44.
- Quiz answer buttons should stay ≥ 44px tall on mobile (they use `px-4 py-3`; keep or grow).
- Prefer container queries / responsive grid; the shell `<main>` is `max-w-5xl` and `.prose` is
  capped at `--measure` (68ch) — don't widen long-form reading past that.

---

## 9. Verification

`npm run build` — **GREEN** (367 pages). Motion is bundled into the `PracticeSession` island
chunk (~139 KB) and resolves against the shared Preact runtime chunk with zero bare `react`
imports (compat alias verified in the built output). ClientRouter script emitted site-wide.
