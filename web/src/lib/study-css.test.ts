/**
 * Guards the reveal UI's SILENT-FAILURE invariants — the ones where the page still
 * builds, still renders, still looks almost right, and neither `astro check` nor a
 * screenshot notices.
 *
 * The critical one is LOCKED/ARMED HEIGHT PARITY. The whole "quiet seed to bloom"
 * design rests on arming a row costing zero layout shift: 95% of the page is locked
 * rows, and if one state variant ever grows its own padding or font-size, then every
 * section the reader finishes nudges the page under their eyes. Cumulative layout
 * shift does not throw, does not log, and no other test in this suite measures it.
 *
 * Also guarded here: the inverted no-JS contract (nothing may hide prompt content
 * unless it is gated on the `data-pd` flag), the "JS only removes" rule, the single
 * 150ms fade, and the seven approved `.prose` typography changes (whose numbers are
 * the contract, per CONTRACT.md §8).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raw = readFileSync(
  fileURLToPath(new URL("../styles/global.css", import.meta.url)),
  "utf8",
);
const page = readFileSync(
  fileURLToPath(new URL("../pages/study/[domain]/[slug].astro", import.meta.url)),
  "utf8",
);

/** Comments carry prose about the very properties we assert are absent. */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The reveal component block, isolated from the rest of the sheet. The slice must
 * start at the `/*` that OPENS the section banner, not at the banner text, or the
 * comment stripper below is left with an unpaired terminator and swallows the first
 * real rule into a selector.
 */
const revealBlock = (() => {
  const banner = raw.indexOf("CLARITY REVEAL UI");
  expect(banner, "the CLARITY REVEAL UI block must exist in global.css").toBeGreaterThan(0);
  const start = raw.lastIndexOf("/*", banner);
  const end = raw.lastIndexOf("/*", raw.indexOf("View Transitions", banner));
  expect(end).toBeGreaterThan(start);
  return raw.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
})();

interface Rule {
  selector: string;
  body: string;
}

/**
 * Every `selector { declarations }` pair. Declaration bodies never nest, so this
 * also walks straight through `@media` wrappers and yields the rules inside them.
 */
function rules(source: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Collapse the selector so a multi-line selector list matches exactly.
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (selector.startsWith("@")) continue; // an @media/@supports opener, not a rule
    out.push({ selector, body: m[2] });
  }
  return out;
}

/**
 * The rule with EXACTLY this selector (whitespace-collapsed). Exact, not substring:
 * `.prose h2` as a substring would first hit the shared `.prose h1, .prose h2, …`
 * scroll-margin rule and assert against the wrong declarations.
 */
function ruleFor(source: string, selector: string): Rule {
  const want = selector.trim().replace(/\s+/g, " ");
  const found = rules(source).find((r) => r.selector === want);
  if (!found) throw new Error(`no rule with selector: ${want}`);
  return found;
}

// --- THE critical invariant ------------------------------------------------

describe("locked / armed / revealed line height parity (zero CLS)", () => {
  /** Anything that could change the line's box, and therefore the row's height. */
  const BOX = [
    "min-height",
    "max-height",
    "height",
    "padding",
    "margin",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "border",
    "gap",
    "width",
  ];

  it("all three variants share ONE .pd-line rule that owns every box property", () => {
    const line = ruleFor(revealBlock, ".prose .pd-line");
    expect(line.body).toMatch(/min-height:\s*44px/); // the touch-target floor
    expect(line.body).toMatch(/padding:/);
    expect(line.body).toMatch(/font-size:/);
    expect(line.body).toMatch(/line-height:/);
    expect(line.body).toMatch(/display:\s*flex/);
  });

  it("no state variant declares a box property — only display / colour / glyph", () => {
    const variants = rules(revealBlock).filter(
      (r) =>
        (r.selector.includes("pd-line--") || r.selector.includes("data-pd-state")) &&
        // The shared base rule is the ONE place box properties are allowed.
        r.selector !== ".prose .pd-line",
    );
    // Sanity: the variants exist at all (a rename must not silently pass this).
    expect(variants.length).toBeGreaterThanOrEqual(5);
    for (const r of variants) {
      for (const prop of BOX) {
        expect(
          r.body,
          `${r.selector} must not set ${prop} — it would shift the page when a section arms`,
        ).not.toMatch(new RegExp(`(^|[;\\s])${prop}\\s*:`));
      }
    }
  });

  it("the glyph sits in a fixed-width slot, so swapping it cannot move the label", () => {
    const glyph = ruleFor(revealBlock, ".prose .pd-glyph");
    expect(glyph.body).toMatch(/flex:\s*none/);
    expect(glyph.body).toMatch(/width:\s*[\d.]+em/);
  });

  it("the glyph is swapped via ::before content, never by rewriting text", () => {
    expect(revealBlock).toMatch(/\.pd-glyph::before\s*\{[^}]*content:/);
  });
});

// --- the inverted no-JS contract ------------------------------------------

describe("no-JS ships everything open; only the data-pd flag hides", () => {
  it("every rule that hides prompt CONTENT is gated on [data-pd=\"on\"]", () => {
    const hiders = rules(revealBlock).filter(
      (r) => /display:\s*none/.test(r.body) && /pd-body|pd-panel__item/.test(r.selector),
    );
    expect(hiders.length).toBeGreaterThanOrEqual(2);
    for (const r of hiders) {
      expect(r.selector, `${r.selector} hides content without the flag`).toMatch(
        /\[data-pd="on"\]/,
      );
    }
  });

  it("the ungated display:none rules only ever hide CONTROLS or presentation", () => {
    const ungated = rules(revealBlock).filter(
      (r) =>
        /display:\s*none/.test(r.body) &&
        !r.selector.includes('[data-pd="on"]') &&
        // <hr> is presentational, not content; the next test owns it specifically.
        !/\bhr\b/.test(r.selector),
    );
    for (const r of ungated) {
      expect(
        r.selector,
        `${r.selector} is hidden without the flag — a no-JS reader loses it. Only ` +
          `controls (dead without JS) and presentational separators may be ungated.`,
      ).toMatch(
        // Controls, which do nothing without JS...
        /pd-line--locked|pd-line--armed|pd-panel__note|pd-panel__actions/,
      );
    }
  });

  it("only an <hr> may be hidden as presentation, and only next to a row", () => {
    // rehype-prompts places the row BEFORE a section's authored `---` (325 of 460
    // files have one) so the row stays inside its own section. That left two
    // hairlines ~45px apart. The row's own rule is the seam now, so the authored
    // separator is suppressed. An <hr> maps to role="separator" and carries no
    // information, so hiding it costs a no-JS reader nothing — which is why it is
    // the sole presentational exception to the rule above.
    const hrHiders = rules(revealBlock).filter(
      (r) => /display:\s*none/.test(r.body) && /\bhr\b/.test(r.selector),
    );
    expect(hrHiders).toHaveLength(1);
    expect(hrHiders[0].selector).toBe(".prose .pd-row + hr");
  });

  it("controls that do nothing without JS stay hidden until the flag appears", () => {
    expect(revealBlock).toMatch(
      /\[data-pd="on"\]\s*\.pd-panel__note,\s*\[data-pd="on"\]\s*\.pd-panel__actions\s*\{\s*display:\s*block/,
    );
  });

  it("the flag script is one constant, sets data-pd, and re-applies after a swap", () => {
    expect(page).toMatch(/const PD_FLAG_SCRIPT = `\(function\(\)\{/);
    expect(page).toMatch(/setAttribute\("data-pd","on"\)/);
    expect(page).toMatch(/astro:after-swap/);
    // Exactly one inline script on this page's head slot, so the CSP gains one hash.
    expect(page.match(/is:inline set:html=\{PD_FLAG_SCRIPT\}/g)).toHaveLength(1);
  });

  it("the module script only sets attributes — it never builds markup", () => {
    const script = page.slice(page.indexOf('from "@lib/reading"'));
    for (const banned of ["innerHTML", "insertAdjacentHTML", "createElement", "append("]) {
      expect(script, `JS must only remove content, never add it (${banned})`).not.toContain(
        banned,
      );
    }
  });

  it("no pushState / scrollIntoView / focus trap — Back stays 'previous page'", () => {
    // Comments in that file name these APIs to say they are off limits.
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/pushState|replaceState|scrollIntoView/);
  });
});

// --- motion ----------------------------------------------------------------

describe("motion is one 150ms opacity fade and nothing else", () => {
  it("declares exactly one animation in the reveal block", () => {
    const anims = revealBlock.match(/(^|[;\s])animation\s*:/g) ?? [];
    expect(anims).toHaveLength(1);
    expect(revealBlock).toMatch(/animation:\s*fade-in 150ms/);
  });

  it("puts it inside prefers-reduced-motion: no-preference", () => {
    const at = revealBlock.indexOf("animation: fade-in");
    const before = revealBlock.slice(0, at);
    const lastGate = before.lastIndexOf("prefers-reduced-motion: no-preference");
    expect(lastGate).toBeGreaterThan(0);
    // No closing of that media block between the gate and the declaration.
    expect(before.slice(lastGate)).not.toMatch(/\}\s*\}/);
  });

  it("never animates or transitions a height (a user line-height must reflow freely)", () => {
    expect(revealBlock).not.toMatch(/(transition|animation)[^;]*(max-)?height/);
    expect(revealBlock).not.toMatch(/@keyframes/);
  });
});

// --- the seven approved .prose changes (CONTRACT.md §8) -------------------

describe("the seven approved .prose typography changes", () => {
  const prose = css.slice(css.indexOf(".prose {"));

  it("1. body leading is 1.63", () => {
    expect(ruleFor(prose, ".prose").body).toMatch(/line-height:\s*1\.63/);
  });

  it("2. the paragraph gap is 1.15em", () => {
    expect(ruleFor(prose, ".prose > * + *").body).toMatch(/margin-top:\s*1\.15em/);
  });

  it("3. h2 opens 2.75em above and closes 0.75em below", () => {
    const h2 = ruleFor(prose, ".prose h2");
    expect(h2.body).toMatch(/margin-top:\s*2\.75em/);
    expect(h2.body).toMatch(/margin-bottom:\s*0\.75em/);
  });

  it("4. per-block leading: li 1.5 / 0.4em, td+th 1.45, pre 1.55", () => {
    expect(ruleFor(prose, ".prose li").body).toMatch(/line-height:\s*1\.5\b/);
    expect(ruleFor(prose, ".prose li + li").body).toMatch(/margin-top:\s*0\.4em/);
    expect(ruleFor(prose, ".prose th, .prose td").body).toMatch(/line-height:\s*1\.45/);
    expect(ruleFor(prose, ".prose pre").body).toMatch(/line-height:\s*1\.55/);
  });

  it("5. --measure-wide reaches pre and table, and --measure itself is unmoved", () => {
    expect(css).toMatch(/--measure:\s*68ch/);
    expect(css).toMatch(/--measure-wide:\s*80ch/);
    const wide = ruleFor(prose, ".prose > pre, .prose > table");
    // `--measure-wide` is a FLOOR inside max(), not the width: `ch` resolves in the
    // block's OWN font, so 80ch of 0.9rem mono is narrower than 68ch of body Inter
    // and using it directly made code blocks SHRINK.
    expect(wide.body).toMatch(/width:\s*max\(var\(--measure-wide\)/);
    // The bleed is right-only. A negative margin-inline-start pushed blocks off the
    // left edge of the viewport at exactly 1024px, where the gutter is 16px.
    expect(wide.body).not.toMatch(/margin-inline-start/);
    // …and the mermaid case, which the study page has to restate (its own
    // `margin: 1.5rem 0` is more specific and would otherwise zero the bleed).
    expect(page).toMatch(/pre\.mermaid\s*\{[^}]*max\(var\(--measure-wide\)/);
  });

  it("6. mobile: overscroll containment, tabular numerals, a 2-space tab", () => {
    expect(css).toMatch(/overscroll-behavior-x:\s*contain/);
    expect(ruleFor(prose, ".prose pre").body).toMatch(/tab-size:\s*2/);
    expect(ruleFor(prose, ".prose pre").body).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(ruleFor(prose, ".prose th, .prose td").body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("7. text-wrap: pretty on body text; headings keep balance", () => {
    expect(prose).toMatch(/\.prose p,\s*\.prose li \{\s*text-wrap:\s*pretty/);
    // The base layer's heading rule is the one that must keep `balance`.
    expect(css).toMatch(/h6\s*\{[\s\S]*?text-wrap:\s*balance/);
  });

  it("renames no token and no class", () => {
    for (const token of [
      "--measure",
      "--measure-wide",
      "--color-text-muted",
      "--color-border",
      "--topic-accent",
    ]) {
      expect(raw).toContain(token);
    }
  });
});

// --- tier marks ------------------------------------------------------------

describe("tier marks share colour and measure", () => {
  it("the lede changes size and leading only — never colour or measure", () => {
    const lede = ruleFor(revealBlock, ".prose .pd-lede");
    expect(lede.body).toMatch(/font-size:\s*1\.12em/);
    expect(lede.body).toMatch(/line-height:\s*1\.5/);
    expect(lede.body).not.toMatch(/(^|[;\s])color\s*:/);
    expect(lede.body).not.toMatch(/max-width|--measure/);
  });

  it("a tier-3 seam is a 2px accent rule plus an eyebrow, and nothing else", () => {
    const seam = ruleFor(revealBlock, ".prose h3.pd-seam");
    expect(seam.body).toMatch(/border-left:\s*2px solid var\(--topic-accent/);
    const eyebrow = ruleFor(revealBlock, ".prose .pd-seam__eyebrow");
    expect(eyebrow.body).toMatch(/text-transform:\s*uppercase/);
    expect(eyebrow.body).toMatch(/color:\s*var\(--color-text-muted\)/);
  });
});
