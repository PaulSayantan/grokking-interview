/**
 * Guards the `.atl` (atlas) foundation's SILENT-FAILURE invariants — the ones
 * where the page still builds, still renders, and still looks almost right.
 *
 * Nothing here weakens or restates an assertion from `study-css.test.ts` or
 * `theme-css.test.ts`; those two files are frozen and untouched. Three of the
 * checks below exist specifically to prove the atlas work did NOT disturb them:
 *
 *  1. THE PLATE HAZARD. global.css carries `.prose > pre, .prose > table
 *     { width: max(…) }`, which `study-css.test.ts` asserts by exact string
 *     match. Wrapping a `pre` in a numbered `<figure>` (GRAFT 2) stops that
 *     selector matching and the right-hand bleed dies with no error and no
 *     visual alarm. Adding `figure` as a third selector to the frozen list
 *     would break the exact-match assertion instead. The only safe shape is a
 *     SEPARATE rule, and this file is what keeps it separate.
 *  2. INERTNESS. `.atl` may declare custom properties and nothing else. The
 *     moment it grows a `background` / `color` / `font-*`, adding the class to
 *     an existing page becomes a visual change nobody asked for.
 *  3. CONTRAST, computed rather than asserted by eye — including the two
 *     state-bearing graphics (an unvisited node, an unvisited meter cell) that
 *     owe 3:1 because they are the "not covered" half of a two-state mark.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRACKS } from "./channels";
import { atlasChannel } from "./atlas";

const foundationRaw = readFileSync(
  fileURLToPath(new URL("../components/AtlasFoundation.astro", import.meta.url)),
  "utf8",
);
const globalRaw = readFileSync(
  fileURLToPath(new URL("../styles/global.css", import.meta.url)),
  "utf8",
);

/**
 * The three surfaces that wear `.atl`. Read whole (markup, style block AND
 * script blocks), because the withdrawal checks in §5 have to prove the absence
 * of a printed keycap, of a key binding and of an `aria-keyshortcuts` claim —
 * and those three used to live in three different halves of the same file.
 */
const consumers: Record<string, string> = Object.fromEntries(
  [
    ["study", "../pages/study/[domain]/[slug].astro"],
    ["topic", "../pages/topic/[domain]/[slug].astro"],
    ["domain", "../pages/domain/[domain].astro"],
    ["SubtopicCard", "../components/SubtopicCard.astro"],
  ].map(([name, rel]) => [
    name,
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"),
  ]),
);

/**
 * The `<style is:global>` block only. `lastIndexOf`, not `indexOf`: the
 * frontmatter doc comment MENTIONS the tag by name, and matching that mention
 * swallows the whole comment into the first "selector".
 */
const styleBlock = (() => {
  const open = foundationRaw.lastIndexOf("<style is:global>");
  expect(open, "AtlasFoundation must carry a <style is:global> block").toBeGreaterThan(-1);
  const close = foundationRaw.lastIndexOf("</style>");
  expect(close).toBeGreaterThan(open);
  return foundationRaw.slice(open + "<style is:global>".length, close);
})();

/** Comments carry prose about the very properties we assert are absent. */
const css = styleBlock.replace(/\/\*[\s\S]*?\*\//g, "");
/** …and @keyframes bodies would otherwise parse as bare `from`/`to` rules. */
const cssNoFrames = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

interface Rule {
  selector: string;
  body: string;
}
/**
 * Every `selector { declarations }` pair. Declaration bodies never nest, so this
 * also walks straight through `@media` / `@supports` wrappers and yields the
 * rules inside them.
 */
function rules(source: string): Rule[] {
  const out: Rule[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (selector.startsWith("@")) continue; // an @media/@supports opener
    out.push({ selector, body: m[2] });
  }
  return out;
}
/** The rule with EXACTLY this selector (whitespace-collapsed). */
function ruleFor(source: string, selector: string): Rule {
  const want = selector.trim().replace(/\s+/g, " ");
  const found = rules(source).find((r) => r.selector === want);
  if (!found) throw new Error(`no rule with selector: ${want}`);
  return found;
}

// --- WCAG arithmetic -------------------------------------------------------

function hex(h: string): number[] {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function luminance([r, g, b]: number[]): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The `.atl { … }` and `[data-theme="light"] .atl { … }` token blocks. */
const darkBlock = ruleFor(cssNoFrames, ".atl").body;
const lightBlock = ruleFor(cssNoFrames, '[data-theme="light"] .atl').body;

function tokenIn(blockBody: string, name: string): string {
  const m = blockBody.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token not found (or not a 6-digit hex): ${name}`);
  return m[1];
}
/** A `--accent-*` / `--color-*` value out of global.css, per theme. */
function globalToken(name: string, theme: "dark" | "light"): string {
  const cut = globalRaw.indexOf('[data-theme="light"]');
  const region = theme === "dark" ? globalRaw.slice(0, cut) : globalRaw.slice(cut);
  const m = region.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`global token not found: ${name} (${theme})`);
  return m[1];
}

const THEMES = ["dark", "light"] as const;
const themeBlock = { dark: darkBlock, light: lightBlock };

// --- 1. the authoring rules ----------------------------------------------

describe("the .atl discipline (CONTRACT.md §12 rules, §13 scope)", () => {
  it("rule 1: every selector contains `.atl`", () => {
    for (const r of rules(cssNoFrames)) {
      expect(r.selector, `${r.selector} can be beaten by a Tailwind utility`).toContain(
        ".atl",
      );
    }
  });

  it("rule 2: no accent hex outside the two theme token blocks", () => {
    for (const r of rules(cssNoFrames)) {
      if (r.selector === ".atl" || r.selector === '[data-theme="light"] .atl') continue;
      expect(r.body, `${r.selector} hardcodes a colour; one theme will be wrong`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
    }
  });

  it("rule 3: nothing is declared on :root or on [data-theme=light] alone", () => {
    for (const r of rules(cssNoFrames)) {
      expect(r.selector).not.toMatch(/(^|[\s,])(:root|html)\b/);
      expect(r.selector).not.toBe('[data-theme="light"]');
    }
  });

  it("rule 6: exactly ONE animation, gated, with a visible resting state", () => {
    const anims = css.match(/(^|[;\s])animation\s*:/g) ?? [];
    expect(anims).toHaveLength(1);
    expect(css).toMatch(/animation:\s*atl-rise linear both/);
    // The resting state is declared OUTSIDE both guards.
    const resting = ruleFor(cssNoFrames, ".atl .atl-in");
    expect(resting.body).toMatch(/opacity:\s*1/);
    expect(resting.body).toMatch(/transform:\s*none/);
    // …and the animated form is inside reduced-motion + @supports.
    const at = css.indexOf("animation: atl-rise");
    const before = css.slice(0, at);
    const rm = before.lastIndexOf("prefers-reduced-motion: no-preference");
    expect(rm).toBeGreaterThan(0);
    expect(before.lastIndexOf("@supports (animation-timeline: view())")).toBeGreaterThan(rm);
    // The range's length is the subject's own height, so this class is only ever
    // for elements well under one viewport tall.
    expect(css).toMatch(/animation-range:\s*entry 0% entry 70%/);
  });

  it("keeps the marketing pages' zero-rotation / zero-3D thesis", () => {
    for (const banned of [
      "rotate",
      "perspective(",
      "translateZ",
      "matrix3d",
      "preserve-3d",
    ]) {
      expect(css, `${banned} reappears in the atlas foundation`).not.toContain(banned);
    }
  });
});

// --- 2. inertness: `.atl` is properties-only ------------------------------

describe("adding the `atl` class is visually inert", () => {
  it(".atl and its light override declare ONLY custom properties", () => {
    for (const theme of THEMES) {
      const props = themeBlock[theme]
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => d.slice(0, d.indexOf(":")).trim());
      for (const prop of props) {
        expect(
          prop.startsWith("--"),
          `.atl (${theme}) sets \`${prop}\` — adding the class would change the page`,
        ).toBe(true);
      }
    }
  });

  it("declares no reading-contract token, so nothing is narrowed by accident", () => {
    // --measure / --measure-wide / --prose-bleed stay owned by global.css and
    // the study page's own >=1024px block. Re-declaring one here would make the
    // outcome depend on emit order.
    for (const frozen of ["--measure", "--measure-wide", "--prose-bleed"]) {
      expect(cssNoFrames, `${frozen} must not be re-declared in the foundation`).not.toMatch(
        new RegExp(`(^|[;{\\s])${frozen}\\s*:`),
      );
    }
  });

  it("the reading contract is still intact where it actually lives", () => {
    expect(globalRaw).toMatch(/--measure:\s*68ch/);
    expect(globalRaw).toMatch(/--measure-wide:\s*80ch/);
    expect(globalRaw).toMatch(/--prose-bleed:\s*4rem/);
    const page = readFileSync(
      fileURLToPath(new URL("../pages/study/[domain]/[slug].astro", import.meta.url)),
      "utf8",
    );
    // 79ch, not the earlier 104ch: the line is now CAPPED so it stops growing
    // with the monitor (measured 118 chars at 1920px before this). 79ch = 987px
    // at the 19.8px body = ~95 chars, the same line a 1440px reader already got.
    expect(page).toMatch(/--measure:\s*79ch/);
    expect(page).toMatch(/line-height:\s*1\.68/);
    expect(page).toMatch(/margin-top:\s*1\.35em/);
    // The TOC stays pinned flush to the viewport's right edge.
    expect(page).toMatch(/margin-right:\s*calc\(1rem - \(100vw - 100%\) \/ 2\)/);
  });
});

// --- 3. GRAFT 1: the raised prose body -----------------------------------

describe("GRAFT 1 — a bigger prose body, delivered through the existing hook", () => {
  it("raises the size via --prose-body and never narrows the measure", () => {
    expect(darkBlock).toMatch(/--atl-prose-body:\s*clamp\(/);
    expect(darkBlock).toMatch(/--prose-body:\s*var\(--atl-prose-body\)/);
    // global.css's `.prose` reads that token as its fallback hook, so no
    // font-size rule is needed and the OpenQuestions panel — which reads the
    // same token — stays in step with the article.
    expect(globalRaw).toMatch(/font-size:\s*var\(--prose-body,/);
  });

  it("the raised cap lands chars-per-line in the 100-105 band at 1440px", () => {
    // MEASURED in headless Chromium against this worktree: at a 1440px viewport
    // the study article column is 984px and Inter's average advance in the prose
    // is 0.4818em, so 984 / (0.4818 * size) is the character count. 17.6px gave
    // 116; the cap below is the size that gives 103 in the SAME column.
    const m = darkBlock.match(/--atl-prose-body:\s*clamp\([^,]+,[^,]+,\s*([\d.]+)rem\s*\)/);
    expect(m, "--atl-prose-body must cap at a rem value").toBeTruthy();
    const capPx = parseFloat(m![1]) * 16;
    const cpl = 984 / (0.4818 * capPx);
    expect(cpl).toBeGreaterThanOrEqual(100);
    expect(cpl).toBeLessThanOrEqual(105);
  });

  it("never reduces leading to pay for the size", () => {
    expect(globalRaw).toMatch(/line-height:\s*1\.63/);
    // Nothing in the foundation touches `.prose` leading at all.
    for (const r of rules(cssNoFrames)) {
      if (!/\.prose\b/.test(r.selector)) continue;
      expect(r.body, `${r.selector} must not set line-height`).not.toMatch(
        /(^|[;\s])line-height\s*:/,
      );
    }
  });
});

// --- 4. GRAFT 2: the plate hazard ---------------------------------------

describe("GRAFT 2 — numbered plates do not kill the frozen bleed", () => {
  const FROZEN = ".prose > pre, .prose > table";

  it("the frozen selector still exists in global.css, verbatim and with TWO selectors", () => {
    const found = rules(globalRaw.replace(/\/\*[\s\S]*?\*\//g, "")).find(
      (r) => r.selector === FROZEN,
    );
    expect(found, `study-css.test.ts matches "${FROZEN}" exactly`).toBeTruthy();
    expect(found!.selector.split(",")).toHaveLength(2);
    expect(found!.body).toMatch(/width:\s*max\(var\(--measure-wide\)/);
  });

  it("the figure wrapper gets its OWN bleed rule, not a third selector", () => {
    const plate = rules(cssNoFrames).find(
      (r) =>
        r.selector.includes("figure.atl-plate") &&
        /width:\s*max\(var\(--measure-wide\)/.test(r.body),
    );
    expect(plate, "a plated pre must still bleed right at >=1024px").toBeTruthy();
    // It is a SEPARATE rule: it must not be the frozen list with `figure` bolted on.
    expect(plate!.selector).not.toContain(".prose > pre");
    expect(plate!.selector).not.toContain(".prose > table");
    // …and the bleed is capped so a plate can never reach the pinned spine.
    expect(plate!.body).toMatch(/max-width:\s*calc\(100% \+ var\(--prose-bleed\)\)/);
  });

  it("the plated block itself fills the figure instead of re-bleeding", () => {
    const inner = ruleFor(
      cssNoFrames,
      ".atl .prose > figure.atl-plate > pre, .atl .prose > figure.atl-plate > table",
    );
    expect(inner.body).toMatch(/width:\s*100%/);
    expect(inner.body).toMatch(/max-width:\s*none/);
  });

  it("the bleed rule is gated at >=1024px, like the frozen one", () => {
    const at = cssNoFrames.indexOf("figure.atl-plate {");
    expect(at).toBeGreaterThan(0);
    const gate = cssNoFrames.lastIndexOf("@media (min-width: 1024px)", at);
    expect(gate).toBeGreaterThan(0);
    expect(cssNoFrames.slice(gate, at)).not.toMatch(/\}\s*\}/);
  });
});

// --- 5. the WITHDRAWN single-character accelerators ----------------------

/**
 * GRAFT 3 shipped `R` / `P` / `D` as bare-letter accelerators on all three atlas
 * surfaces and was WITHDRAWN: a document-level `keydown` that calls `a.click()`
 * NAVIGATES AWAY, and WCAG 2.1.4 Character Key Shortcuts (Level A) demands an off
 * switch, a remap, or focus-scoping — of which the shipped code had none. A speech
 * recognizer emitting a bare `r` cost the reader their place with no undo.
 *
 * These checks are therefore ABSENCE checks: the feature is gone and the point of
 * this section is that it cannot creep back. CONTRACT.md §13.1 records the reason.
 */
describe("GRAFT 3 is withdrawn — no single-character accelerator survives", () => {
  it("keeps `.atl-kbd` as a declared primitive but no surface prints one", () => {
    // The primitive stays declared (a keycap is a general typographic need); it
    // simply has no consumer, which is fine and keeps the withdrawal diff small.
    const kbd = ruleFor(cssNoFrames, ".atl .atl-kbd");
    expect(kbd.body).toMatch(/border:\s*1px solid/);
    expect(kbd.body).toMatch(/font-family:\s*var\(--atl-mono\)/);

    for (const [name, src] of Object.entries(consumers)) {
      expect(src, `${name} still prints a keycap chip`).not.toMatch(
        /<kbd[^>]*class="atl-kbd"/,
      );
      expect(src, `${name} still prints a keycap chip`).not.toMatch(/<kbd\b/);
    }
  });

  it("no surface declares a ROUTES map or binds a bare-letter keydown", () => {
    for (const [name, src] of Object.entries(consumers)) {
      expect(src, `${name} re-declared a ROUTES map`).not.toMatch(/\bROUTES\b/);
      expect(src, `${name} re-added the route-key handler`).not.toMatch(
        /\bonRouteKey\b|\bannounceRouteKeys\b|\binEditable\b/,
      );
      expect(src, `${name} re-added the once-only key guard`).not.toMatch(/__atl\w*Keys/);
      // Any document-level keydown at all: the accelerator can only come back
      // through one, and a scoped (element-level) handler is what 2.1.4 permits.
      expect(src, `${name} binds a document-level keydown`).not.toMatch(
        /document\.addEventListener\(\s*["']keydown["']/,
      );
    }
  });

  it("no surface emits or sets aria-keyshortcuts", () => {
    // An announced shortcut that does not exist is worse than no shortcut: a
    // screen-reader user is told to press a key that now does nothing.
    for (const [name, src] of Object.entries(consumers)) {
      expect(src, `${name} claims a keyboard shortcut`).not.toContain("aria-keyshortcuts");
    }
    expect(foundationRaw).not.toContain("aria-keyshortcuts");
  });
});

// --- 6. token hygiene ----------------------------------------------------

describe("token hygiene", () => {
  it("every colour token declared in dark is overridden in light", () => {
    const darkColours = [...darkBlock.matchAll(/(--atl-[a-z0-9-]+):\s*#[0-9a-fA-F]{6}/g)].map(
      (m) => m[1],
    );
    expect(darkColours.length).toBeGreaterThanOrEqual(8);
    for (const name of darkColours) {
      expect(lightBlock, `${name} has no light override`).toMatch(
        new RegExp(`${name}\\s*:`),
      );
    }
  });

  it("every var(--atl-…) reference resolves to a declaration in this file", () => {
    const declared = new Set(
      [...cssNoFrames.matchAll(/(--atl-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const referenced = new Set(
      [...cssNoFrames.matchAll(/var\((--atl-[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    for (const name of referenced) {
      expect(declared.has(name), `var(${name}) resolves to nothing`).toBe(true);
    }
  });

  it("the channel arrives as ONE property with an always-resolvable default", () => {
    expect(darkBlock).toMatch(/--atl-ch:\s*var\(--topic-accent,\s*var\(--color-primary\)\)/);
  });

  it("the type ladder mirrors --ins-t-* and adds the two prose steps", () => {
    for (const step of [
      "--atl-t-micro",
      "--atl-t-label",
      "--atl-t-body",
      "--atl-t-lead",
      "--atl-t-h3",
      "--atl-t-h4",
      "--atl-t-fig",
      "--atl-t-h2",
      "--atl-t-h1",
      "--atl-t-ph2",
      "--atl-t-ph3",
    ]) {
      expect(darkBlock, `${step} missing from the ladder`).toMatch(
        new RegExp(`${step}:\\s*clamp\\(`),
      );
    }
    const index = readFileSync(
      fileURLToPath(new URL("../pages/index.astro", import.meta.url)),
      "utf8",
    );
    // Same coefficients as the shipped `.ins` ladder: ONE cap viewport, so a
    // learning page and a marketing page never out-typeset each other.
    for (const step of ["micro", "label", "body", "lead", "h3", "h4", "fig", "h2", "h1"]) {
      const mine = darkBlock.match(new RegExp(`--atl-t-${step}:\\s*(clamp\\([^)]*\\))`));
      const theirs = index.match(new RegExp(`--ins-t-${step}:\\s*(clamp\\([^)]*\\))`));
      expect(mine, `--atl-t-${step}`).toBeTruthy();
      expect(theirs, `--ins-t-${step}`).toBeTruthy();
      expect(mine![1].replace(/\s+/g, "")).toBe(theirs![1].replace(/\s+/g, ""));
    }
  });

  it("a study prose heading step sits BELOW the marketing h2 step", () => {
    // 40px would out-shout the page title; `--atl-t-ph2` caps at 28.
    const ph2 = darkBlock.match(/--atl-t-ph2:[^;]*?([\d.]+)rem\s*\)/)![1];
    const h2 = darkBlock.match(/--atl-t-h2:[^;]*?([\d.]+)rem\s*\)/)![1];
    expect(parseFloat(ph2)).toBeLessThan(parseFloat(h2));
    const ph3 = darkBlock.match(/--atl-t-ph3:[^;]*?([\d.]+)rem\s*\)/)![1];
    expect(parseFloat(ph3)).toBeLessThan(parseFloat(ph2));
  });
});

// --- 7. contrast, computed ----------------------------------------------

describe("contrast (computed, both themes)", () => {
  /** Ink and channel text never sit deeper than plane-2 in either theme. */
  const INK_PLANES = ["--atl-plane-0", "--atl-plane-1", "--atl-plane-2"] as const;

  for (const theme of THEMES) {
    for (const ink of ["--atl-ink", "--atl-ink-2", "--atl-ink-3"] as const) {
      for (const plane of INK_PLANES) {
        it(`${theme}: ${ink} on ${plane} clears 4.5:1`, () => {
          const ratio = contrast(
            tokenIn(themeBlock[theme], ink),
            tokenIn(themeBlock[theme], plane),
          );
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    // An unvisited node / cell is the "not covered" half of a two-state mark, so
    // it is a STATE-BEARING GRAPHIC and owes 3:1 — unlike --atl-rule-strong,
    // which is a decorative rail and owes nothing.
    for (const plane of [...INK_PLANES, "--atl-plane-3"] as const) {
      it(`${theme}: --atl-node-ring on ${plane} clears 3:1`, () => {
        const ratio = contrast(
          tokenIn(themeBlock[theme], "--atl-node-ring"),
          tokenIn(themeBlock[theme], plane),
        );
        expect(ratio).toBeGreaterThanOrEqual(3);
      });
    }

    it(`${theme}: the brand fill carries its own label at 4.5:1`, () => {
      const ratio = contrast(
        tokenIn(themeBlock[theme], "--atl-on-brand"),
        tokenIn(themeBlock[theme], "--atl-brand"),
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }

  /**
   * Every channel a `.atl` page can be given, resolved exactly the way
   * `atlasChannel()` resolves it. The rule this proves (CONTRACT.md §13): the
   * channel is legal as TEXT on plane-0 ONLY, and legal as a GRAPHIC on
   * planes 0-2.
   *
   * Plane-1 is out for text on measured evidence, not taste: the atlas mock's
   * notes put dark violet #8B5CF6 (the Craft & Data channel) at 4.51:1 on
   * plane-1, and computing it gives 4.49:1 — a fail. That is the whole reason
   * `.atl-locator__folio` is ink rather than channel.
   */
  const channels = TRACKS.map((t) => {
    const value = atlasChannel(t.domains[0]);
    return { label: t.label, name: value.slice("var(".length, -1) };
  });

  it("every track resolves to a token this foundation or global.css declares", () => {
    for (const c of channels) {
      expect(c.name.startsWith("--")).toBe(true);
      const declared = c.name.startsWith("--atl-")
        ? new RegExp(`${c.name}\\s*:`).test(darkBlock)
        : new RegExp(`${c.name}:\\s*#`).test(globalRaw);
      expect(declared, `${c.label} -> var(${c.name}) resolves to nothing`).toBe(true);
    }
  });

  function channelValue(name: string, theme: "dark" | "light"): string {
    return name.startsWith("--atl-")
      ? tokenIn(themeBlock[theme], name)
      : globalToken(name, theme);
  }

  /**
   * The two primitives allowed to take the channel as TEXT. Both sit on the page
   * ground. This list is asserted by name so a third site cannot appear quietly
   * on a plane-1 panel, where one channel already fails AA.
   */
  const CHANNEL_TEXT_SITES = [".atl .atl-cta--mark", ".atl .atl-plate__no"];

  it("only the two plane-0 primitives take the channel as text", () => {
    const found = rules(cssNoFrames)
      .filter((r) => /(^|[;\s])color:\s*var\(--atl-ch\)/.test(r.body))
      .map((r) => r.selector)
      .sort();
    expect(found).toEqual([...CHANNEL_TEXT_SITES].sort());
  });

  for (const theme of THEMES) {
    it(`${theme}: every channel clears 4.5:1 as TEXT on plane-0`, () => {
      for (const c of channels) {
        const value = channelValue(c.name, theme);
        const ratio = contrast(value, tokenIn(themeBlock[theme], "--atl-plane-0"));
        expect(
          ratio,
          `${c.label} (${value}) on plane-0 in ${theme} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: at least one channel FAILS as text on plane-1 (why the rule exists)`, () => {
      const worst = Math.min(
        ...channels.map((c) =>
          contrast(channelValue(c.name, theme), tokenIn(themeBlock[theme], "--atl-plane-1")),
        ),
      );
      // Dark: violet 4.49:1. Light: amber 4.57:1 — which passes, so this only
      // records the measurement rather than asserting a failure in both themes.
      expect(worst).toBeLessThan(5);
    });

    it(`${theme}: every channel clears 3:1 as a GRAPHIC on planes 0-2`, () => {
      for (const c of channels) {
        const value = channelValue(c.name, theme);
        for (const plane of INK_PLANES) {
          const ratio = contrast(value, tokenIn(themeBlock[theme], plane));
          expect(
            ratio,
            `${c.label} (${value}) on ${plane} in ${theme} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }
});

// --- 8. touch targets and the declared cost -----------------------------

describe("mobile: 44px targets, and the locator costs exactly 46px", () => {
  it("every interactive primitive floors at 44px", () => {
    for (const sel of [
      ".atl .atl-cta",
      ".atl .atl-toggle",
      ".atl .atl-route__list",
      ".atl .atl-locator__sum",
    ]) {
      expect(ruleFor(cssNoFrames, sel).body, `${sel} has no 44px floor`).toMatch(
        /min-height:\s*(44px|var\(--atl-locator-h\))/,
      );
    }
    // A waypoint's own label is the target, not its 7px node.
    expect(
      ruleFor(cssNoFrames, ".atl .atl-wp a, .atl .atl-wp > span:last-child").body,
    ).toMatch(/min-height:\s*44px/);
  });

  it("the locator's height is ONE token, so scroll-margin cannot drift", () => {
    expect(darkBlock).toMatch(/--atl-locator-h:\s*46px/);
    expect(ruleFor(cssNoFrames, ".atl .atl-locator__in").body).toMatch(
      /min-height:\s*var\(--atl-locator-h\)/,
    );
  });

  it("the drawer overlays instead of reflowing the prose", () => {
    const drawer = ruleFor(cssNoFrames, ".atl .atl-drawer");
    expect(drawer.body).toMatch(/position:\s*absolute/);
    expect(drawer.body).toMatch(/top:\s*100%/);
  });

  it("a meter with many cells scrolls itself rather than the page", () => {
    const meter = ruleFor(cssNoFrames, ".atl .atl-meter");
    expect(meter.body).toMatch(/overflow-x:\s*auto/);
    expect(meter.body).toMatch(/overscroll-behavior-x:\s*contain/);
    expect(ruleFor(cssNoFrames, ".atl .atl-cell").body).toMatch(/min-width:\s*5px/);
  });
});
