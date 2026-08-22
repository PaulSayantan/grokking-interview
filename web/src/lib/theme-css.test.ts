/**
 * Guards two CSS invariants in `src/styles/global.css` that fail SILENTLY —
 * the page still builds, still renders, and looks *almost* right, so neither
 * `astro check` nor a visual glance catches them.
 *
 * Both were real regressions found by pixel-diffing the built site:
 *
 *  1. The fixed grid backdrop is a `body::before` at `z-index: -1`. A negative
 *     z-index only escapes *behind* its own element's background if that
 *     element has none — so the moment <body> regains a `background-color`,
 *     the grid becomes pixel-identical to not existing at all.
 *
 *  2. `--color-primary-contrast` is the label color for text sitting on the
 *     saturated primary / correct / incorrect fills. In the dark theme those
 *     fills are bright and high-chroma, so a white label fails WCAG AA on
 *     every one of them (2.4–3.8:1). It must stay near-black there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("../styles/global.css", import.meta.url)),
  "utf8",
);

/** Body of the first `<selector> { … }` block (naive but fine for our rules). */
function ruleBody(selector: string): string {
  // Match the selector at the start of a line (allowing indentation), then
  // capture up to the first closing brace — none of the rules we assert on
  // contain nested blocks.
  const re = new RegExp(`^\\s*${selector}\\s*\\{([^}]*)\\}`, "m");
  const m = css.match(re);
  if (!m) throw new Error(`rule not found in global.css: ${selector}`);
  return m[1];
}

describe("fixed grid backdrop (body::before) stays visible", () => {
  it("declares the grid on body::before as a fixed, inert, behind-content layer", () => {
    const body = ruleBody("body::before");
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/z-index:\s*-1/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).toMatch(/linear-gradient/);
  });

  it("does NOT set a background-color on body (it would hide the z-index:-1 grid)", () => {
    const body = ruleBody("body");
    expect(body).not.toMatch(/background-color\s*:/);
    // `background:` shorthand would also paint a color — reject it too.
    expect(body).not.toMatch(/(^|[;\s])background\s*:/);
  });

  it("keeps the page base color on html instead", () => {
    expect(ruleBody("html")).toMatch(/background-color:\s*var\(--color-bg\)/);
  });

  it("never reintroduces background-attachment: fixed (cannot be composited)", () => {
    // Strip comments first — the rule above documents the old approach by
    // name, and that prose must not trip this assertion.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/background-attachment:\s*fixed/);
  });
});

describe("--color-primary-contrast passes WCAG AA on its fills", () => {
  /** Relative luminance per WCAG 2.x. */
  function luminance([r, g, b]: number[]): number {
    const [R, G, B] = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }
  function contrast(a: number[], b: number[]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  function hex(h: string): number[] {
    const s = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }

  /** Read a token's value from the dark-theme (`:root`) block. */
  function darkToken(name: string): string {
    const root = css.slice(0, css.indexOf('[data-theme="light"]'));
    const m = root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`dark token not found: ${name}`);
    return m[1];
  }

  const label = darkToken("--color-primary-contrast");

  // Every dark-theme fill that uses --color-primary-contrast as its label.
  const fills = [
    ["--color-primary", 4.5],
    ["--color-primary-hover", 4.5],
    ["--color-correct", 4.5],
    ["--color-incorrect", 4.5],
  ] as const;

  for (const [token, min] of fills) {
    it(`label on ${token} clears ${min}:1`, () => {
      const ratio = contrast(hex(label), hex(darkToken(token)));
      expect(ratio).toBeGreaterThanOrEqual(min);
    });
  }
});
