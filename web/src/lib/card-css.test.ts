/**
 * Guards A11Y-4: the catalog card may wear its channel colour, but never as TEXT.
 *
 * The rule is the marketing foundation's own (CONTRACT.md §13 rule 9, and the same
 * arithmetic `atlas-css.test.ts` runs for `.atl`): a channel colour is legal as TEXT
 * on the PAGE GROUND only, and legal as a GRAPHIC (>=3:1) on the raised planes.
 * `DomainCard` sits on `--ins-row-bg`, which is plane-1 in BOTH themes, and it used
 * to paint two strings — the mastery `%` numeral and the `Browse` label — in
 * `var(--ins-ch)`. Computed below: the Craft & Data channel is 4.49:1 there in dark
 * theme, an AA failure on two of the twenty cards, and light theme's worst channel
 * clears by 0.07. Nothing in the card's own render can detect that, and no other
 * test in this suite reads the `.ins` token block, so it went unnoticed.
 *
 * What is asserted, therefore, is the SHAPE that cannot regress silently:
 *  1. `--ins-ch` appears in DomainCard only in graphic properties (border / bar
 *     fill), never in a `color:`.
 *  2. The two strings resolve to the ink tokens, with a fallback, like every other
 *     value in that component.
 *  3. The arithmetic that makes rule 9 true — recorded here so the next person does
 *     not have to trust the prose.
 *
 * The token values come from `catalog.astro`'s `.ins` block and from `global.css`'s
 * accents, which is where the card actually resolves them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRACKS } from "./channels";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const card = read("../components/DomainCard.astro");
const catalog = read("../pages/catalog.astro");
const globalRaw = read("../styles/global.css");

/** The card's `<style>` body, comments stripped — the prose names the very
 *  properties this file asserts are absent. */
const cardCss = (() => {
  const open = card.lastIndexOf("<style>");
  expect(open, "DomainCard must carry a <style> block").toBeGreaterThan(-1);
  return card.slice(open, card.lastIndexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
})();

// --- WCAG arithmetic (the same four functions atlas-css.test.ts uses) -------

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

/** A `{ … }` block body, by the selector that opens it. */
function block(src: string, selector: string): string {
  const at = src.indexOf(selector);
  expect(at, `no ${selector} block`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  return src.slice(open, src.indexOf("}", open));
}
const insBlock = {
  dark: block(catalog, "\n  .ins {"),
  light: block(catalog, '[data-theme="light"] .ins {'),
} as const;

function insToken(theme: "dark" | "light", name: string): string {
  const m = insBlock[theme].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`${name} is not a 6-digit hex in the ${theme} .ins block`);
  return m[1];
}
/** A `--accent-*` value out of global.css, per theme. */
function globalToken(theme: "dark" | "light", name: string): string {
  const cut = globalRaw.indexOf('[data-theme="light"]');
  const region = theme === "dark" ? globalRaw.slice(0, cut) : globalRaw.slice(cut);
  const m = region.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`${name} not found in the ${theme} half of global.css`);
  return m[1];
}
function channelValue(theme: "dark" | "light", token: string): string {
  const name = token.slice("var(".length, -1);
  return name.startsWith("--ins-") ? insToken(theme, name) : globalToken(theme, name);
}

const THEMES = ["dark", "light"] as const;

// --- 1. the shape ---------------------------------------------------------

describe("DomainCard wears its channel as a graphic, never as text", () => {
  it("no `color:` in the card is the channel", () => {
    const offenders = [...cardCss.matchAll(/([\w-]+)\s*:\s*var\(--ins-ch[^;]*;/g)]
      .map((m) => m[1])
      .filter((prop) => /(^|-)color$/.test(prop) && prop !== "border-color" && prop !== "border-top-color");
    expect(offenders, `--ins-ch used as text in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the channel still carries the card's track, as the 2px rule and the bar fill", () => {
    expect(cardCss).toMatch(/border-top:\s*2px solid var\(--ins-ch/);
    expect(cardCss).toMatch(/\.mastery-bar\s*\{[^}]*background:\s*var\(--ins-ch/);
  });

  it("the two former channel-as-text strings are ink, with a token fallback", () => {
    for (const sel of [".mastery-pct", ".browse"]) {
      const body = block(cardCss, sel + " {");
      expect(body, `${sel} lost its ink colour`).toMatch(
        /color:\s*var\(--ins-ink,\s*var\(--color-text\)\)/,
      );
    }
  });
});

// --- 2. the arithmetic that makes the rule true ---------------------------

describe("the numbers behind rule 9, on the ground this card actually sits on", () => {
  /** The card's own background: `.ins .domain-card { background-color: --ins-row-bg }`. */
  it("the card's ground is plane-1 in both themes", () => {
    expect(catalog).toMatch(/\.ins \.domain-card \{[^}]*background-color:\s*var\(--ins-row-bg\)/);
    for (const theme of THEMES) {
      expect(insBlock[theme]).toMatch(/--ins-row-bg:\s*var\(--ins-plane-1\)/);
    }
  });

  it("dark: at least one channel FAILS 4.5:1 as text on plane-1 — the whole reason", () => {
    const plane1 = insToken("dark", "--ins-plane-1");
    const worst = Math.min(
      ...TRACKS.map((t) => contrast(channelValue("dark", t.token), plane1)),
    );
    // Craft & Data, `--accent-violet` #8B5CF6 on #101010: 4.49:1.
    expect(worst).toBeLessThan(4.5);
  });

  it("light: no channel clears 4.5:1 by more than a hair either", () => {
    const plane1 = insToken("light", "--ins-plane-1");
    const worst = Math.min(
      ...TRACKS.map((t) => contrast(channelValue("light", t.token), plane1)),
    );
    expect(worst).toBeLessThan(4.7); // amber #9a6700 on #f6f8fa: 4.57:1
  });

  for (const theme of THEMES) {
    it(`${theme}: ink clears 4.5:1 as text on plane-1, by a wide margin`, () => {
      const plane1 = insToken(theme, "--ins-plane-1");
      expect(contrast(insToken(theme, "--ins-ink"), plane1)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(insToken(theme, "--ins-ink-2"), plane1)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: every channel still clears 3:1 as a GRAPHIC on plane-1`, () => {
      const plane1 = insToken(theme, "--ins-plane-1");
      for (const t of TRACKS) {
        const value = channelValue(theme, t.token);
        const ratio = contrast(value, plane1);
        expect(
          ratio,
          `${t.label} (${value}) on plane-1 in ${theme} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
