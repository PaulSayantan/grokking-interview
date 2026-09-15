/**
 * Guards PA-1: ONE header height, published once, consumed by every element that
 * sticks below it.
 *
 * The failure was arithmetic drift between two files. BaseLayout hid the brand
 * wordmark at `max-width: 399px`; `/catalog` let the shared header WRAP to two rows
 * at `max-width: 400px` and hard-coded the wrapped height (101px) into its sticky
 * track head. Measured on the built site, in Chromium, at every width from 320px up:
 *
 *   320-334px  header 117px (wrapped)   top 101px  -> 16px overlap, 8px of the
 *                                                     track name's ink clipped
 *   335-399px  header  69px             top 101px  -> 32px GAP: a strip of cards
 *                                                     scrolls between the two
 *   400px      header 117px (wrapped —  top 101px  -> 16px overlap, 8px clipped
 *              the wordmark is back at
 *              400 but the wrap rule
 *              still applies)
 *   401-483px  header  73px (the        top  69px  -> 4px tuck
 *              wordmark on two lines)
 *   >=484px    header  69px             top  69px  -> flush
 *
 * The fix removes the causes rather than adding a third number: `/catalog`'s
 * page-scoped header wrap is deleted (BaseLayout's wordmark hide, which landed
 * later, already fixes the overflow it existed for — and fixes it for /progress and
 * the study pages too), the wordmark's leading is capped so two lines still measure
 * 44px, and the height itself is published as `--hdr-h` next to the header.
 *
 * What this file asserts is the SHAPE that keeps it true: one declaration, no
 * literal copies, no marketing rule reaching into the shared header. The pixel
 * measurements can only be taken in a browser, so they are recorded above.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const baseLayout = read("../layouts/BaseLayout.astro");
const catalog = read("../pages/catalog.astro");
const index = read("../pages/index.astro");

/** Comment-stripped, because these comments quote the very values asserted absent. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");
const pages = { catalog: strip(catalog), index: strip(index) } as const;

describe("the header's height is declared once, in BaseLayout", () => {
  it("publishes --hdr-h, and only one value for it", () => {
    const decls = [...baseLayout.matchAll(/--hdr-h:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(decls, "--hdr-h must be declared exactly once").toEqual(["4.3125rem"]);
  });

  it("caps the brand row so a wrapped wordmark cannot make the header taller", () => {
    // 22px leading x 2 lines = the 44px min-height row. At Tailwind's text-base
    // leading (24px) two lines are 48px and the header measured 73px.
    expect(strip(baseLayout)).toMatch(
      /body > header \.brand-wordmark \{[^}]*line-height:\s*1\.375/,
    );
  });

  it("keeps the wordmark's own breakpoint, now the only one the header has", () => {
    expect(
      [...baseLayout.matchAll(/@media \(max-width: 399px\)/g)].length,
      "the wordmark breakpoint must be declared once",
    ).toBe(1);
    // 400 was the OTHER half of the disagreement: /catalog wrapped the header one
    // pixel wider than BaseLayout hid the wordmark, which is the band that clipped.
    expect(baseLayout).not.toContain("max-width: 400px");
  });
});

describe("the pages that stick below it consume the property, not the number", () => {
  for (const [name, src] of Object.entries(pages)) {
    it(`${name}: the sticky track head reads var(--hdr-h)`, () => {
      expect(src).toMatch(
        /\.ins \.ins-trackhead \{[^}]*position: sticky; top: var\(--hdr-h, 4\.3125rem\)/,
      );
    });

    it(`${name}: keeps no literal copy of the header height`, () => {
      // 6.3125rem was the hand-maintained 101px wrapped-header copy: it may not come
      // back, and the one-row value may appear ONLY as the var() fallback.
      expect(src).not.toContain("6.3125rem");
      for (const m of src.matchAll(/4\.3125rem/g)) {
        const at = m.index ?? 0;
        expect(
          src.slice(Math.max(0, at - 20), at),
          "4.3125rem must only appear as the var(--hdr-h, …) fallback",
        ).toContain("var(--hdr-h, ");
      }
    });
  }

  /**
   * L12's `max-width: 1392px` on the header's inner div still reaches shared chrome
   * above 1536px — it widens the content box and cannot change the row height. What
   * may not come back is a rule that makes the header TALLER on a page whose sticky
   * offset assumes one row.
   */
  it("no marketing page can change the shared header's HEIGHT any more", () => {
    for (const [name, src] of Object.entries(pages)) {
      expect(src, `${name} restyles shared chrome`).not.toMatch(
        /html:has\(\.ins[\w-]*\) body > header > div \{[^}]*(flex-wrap|row-gap|padding|min-height|height)/,
      );
      expect(src, `${name} still wraps the shared header`).not.toContain(
        "flex-wrap: wrap; row-gap",
      );
    }
  });
});
