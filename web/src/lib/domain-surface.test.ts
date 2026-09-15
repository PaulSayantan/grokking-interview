/**
 * Guards the /domain ITINERARY surface (atlas, CONTRACT.md §13) — specifically
 * the failures that leave the page building, rendering and looking almost right.
 *
 * Nothing here touches `study-css.test.ts` or `theme-css.test.ts`; two checks
 * below exist to prove this surface did not disturb them.
 *
 * The four classes of silent failure it covers:
 *
 *  1. HONESTY. §13.2 forbids shipping state the app cannot compute. `ip:read:v1`
 *     is only written on topics that carry think-prompt rows, so "not visited" is
 *     unknowable and the page says COVERED / NO RECORD instead. And before any
 *     store is read — including forever, with JS off — the two derived figures
 *     must be an em dash rather than a `0` that reads as a fact about the reader.
 *  2. THE `[hidden]` TRAP. `.atl .dm-leg` is (0,2,0); Tailwind's
 *     `[hidden] { display: none }` reset is (0,1,0). Every class whose element is
 *     hidden via the ATTRIBUTE therefore needs a companion `[hidden]` rule, or the
 *     element stays on screen while vanishing from the a11y tree. The live filter
 *     and two progressive-enhancement routes all depend on this.
 *  3. THE WITHDRAWN ACCELERATORS. `R`/`P`/`D` were bare-letter keys that clicked a
 *     route and NAVIGATED AWAY, which WCAG 2.1.4 forbids without an off switch, a
 *     remap or focus-scoping. §5 below now proves they cannot come back.
 *  4. THE N-PARSES REGRESSION. The old SubtopicCard called `missedCount()` per
 *     card — on system-design's 94 legs that is 94 reads and 94 JSON parses of the
 *     whole answer map. The page now reads each store exactly once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * EVERY assertion below runs against COMMENT-STRIPPED source, and that is not a
 * detail: both files document the very strings this file proves are absent
 * ("not visited", `missedCount`, `aria-keyshortcuts`). Matching a doc comment
 * would fail an honest implementation and, worse, pass a dishonest one whose
 * comment happened to be deleted.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

function source(path: string): string {
  return stripComments(
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"),
  );
}

const pageSrc = source("../pages/domain/[domain].astro");
const legSrc = source("../components/SubtopicCard.astro");
const foundationSrc = source("../components/AtlasFoundation.astro");

/** The `<style is:global>` body of a source file. */
function styleBlock(raw: string, what: string): string {
  const open = raw.lastIndexOf("<style is:global>");
  expect(open, `${what} must carry a <style is:global> block`).toBeGreaterThan(-1);
  const close = raw.lastIndexOf("</style>");
  expect(close).toBeGreaterThan(open);
  return raw.slice(open + "<style is:global>".length, close);
}

const pageCss = styleBlock(pageSrc, "the /domain page");
const legCss = styleBlock(legSrc, "SubtopicCard");
const surfaceCss = pageCss + "\n" + legCss;

interface Rule {
  selector: string;
  body: string;
}
function rules(source: string): Rule[] {
  const out: Rule[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (selector.startsWith("@")) continue; // an @media/@supports opener
    out.push({ selector, body: m[2] });
  }
  return out;
}
function hasRule(source: string, needle: string): boolean {
  return rules(source).some((r) => r.selector.includes(needle));
}

/**
 * The markup half: frontmatter, the style block and every `<script>` body
 * removed. Dropping the CSS matters — `var(--atl-ink)` contains the literal
 * `atl-in`, so a count of the page's one animated element reads 6 without it.
 */
const pageMarkup = (() => {
  const end = pageSrc.indexOf("---", 3);
  return pageSrc
    .slice(end + 3)
    .replace(/<script>[\s\S]*?<\/script>/g, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
})();
/** Every `<script>` body on the page, concatenated. */
const pageScripts = [...pageSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .join("\n");

// --- 1. the .atl authoring discipline, on a page rather than the kit -------

describe("the /domain surface keeps the `.atl` discipline (§12 rules 1-3)", () => {
  it("rule 1: every selector contains `.atl`", () => {
    for (const r of rules(surfaceCss)) {
      expect(r.selector, `${r.selector} can be beaten by a Tailwind utility`).toContain(
        ".atl",
      );
    }
  });

  it("rule 2: no colour literal anywhere — the light theme would be wrong", () => {
    for (const r of rules(surfaceCss)) {
      expect(r.body, `${r.selector} hardcodes a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("rule 3: nothing is declared on :root, html or [data-theme=light] alone", () => {
    for (const r of rules(surfaceCss)) {
      expect(r.selector).not.toMatch(/(^|[\s,])(:root|html)\b/);
      expect(r.selector).not.toBe('[data-theme="light"]');
    }
  });

  it("every var(--atl-…) it reaches for is a token the foundation declares", () => {
    const declared = new Set(
      [...foundationSrc.matchAll(/(--atl-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const referenced = new Set(
      [...surfaceCss.matchAll(/var\((--atl-[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    expect(referenced.size).toBeGreaterThan(5);
    for (const name of referenced) {
      expect(declared.has(name), `var(${name}) resolves to nothing`).toBe(true);
    }
  });

  it("§13 rule 9: adds NO new channel-as-text site", () => {
    // The audited pair is `.atl-cta--mark` and `.atl-plate__no`, both on plane-0.
    // A leg row raises its ground to plane-1 on hover, where the Craft & Data
    // channel measures 4.49:1 and fails AA — so the leg tag's border is the
    // channel and its words are ink.
    for (const r of rules(surfaceCss)) {
      expect(r.body, `${r.selector} takes the channel as text`).not.toMatch(
        /(^|[;\s])color:\s*var\(--atl-ch\)/,
      );
    }
    // …and it does use the channel as a GRAPHIC, or the orientation is gone.
    expect(surfaceCss).toMatch(/background:\s*var\(--atl-ch\)/);
  });

  it("§13 rule 10: an unvisited node uses the 3:1 token, not the decorative rail", () => {
    const dot = rules(legCss).find((r) => r.selector.endsWith(".dm-leg__dot"))!;
    expect(dot.body).toMatch(/border:\s*1px solid var\(--atl-node-ring\)/);
  });

  it("declares no animation — the page's one moving object is `.atl-in`", () => {
    expect(surfaceCss).not.toMatch(/(^|[;\s])animation\s*:/);
    expect((pageMarkup.match(/atl-in/g) ?? []).length).toBe(1);
  });
});

// --- 2. the reading contract is not disturbed -----------------------------

describe("the frozen reading contract survives this surface", () => {
  it("declares no reading-contract token and no .prose rule", () => {
    for (const frozen of ["--measure", "--measure-wide", "--prose-bleed", "--prose-body"]) {
      expect(surfaceCss, `${frozen} must not be re-declared here`).not.toMatch(
        new RegExp(`(^|[;{\\s])${frozen}\\s*:`),
      );
    }
    for (const r of rules(surfaceCss)) {
      expect(r.selector, "the itinerary has no business styling .prose").not.toMatch(
        /\.prose\b/,
      );
    }
  });

  it("global.css is not where this surface lives", () => {
    const global = readFileSync(
      fileURLToPath(new URL("../styles/global.css", import.meta.url)),
      "utf8",
    );
    expect(global).not.toContain("dm-leg");
    expect(global).not.toContain("dm-territory");
  });
});

// --- 3. honesty: what the page may claim before a store is read -----------

describe("the page claims nothing about the reader until a store is read", () => {
  it("never uses the two words the read store cannot justify", () => {
    // `ip:read:v1` is only written on think-prompt topics, so it cannot tell
    // "not visited" from "not instrumented" (CONTRACT.md §13.2).
    expect(pageSrc.toLowerCase()).not.toContain("not visited");
    expect(legSrc.toLowerCase()).not.toContain("not visited");
  });

  it("names the three cell states in words, so colour is never the only carrier", () => {
    for (const word of ["Covered", "Last here", "No record"]) {
      expect(pageMarkup, `the legend is missing "${word}"`).toContain(word);
    }
  });

  it("ships the two derived figures as an em dash, not a zero", () => {
    for (const slot of ["data-dm-covered", "data-dm-missed"]) {
      const m = pageMarkup.match(new RegExp(`${slot}[^>]*>([^<]*)<`));
      expect(m, `${slot} slot not found`).toBeTruthy();
      expect(m![1].trim(), `${slot} ships a number nobody computed`).toBe("—");
    }
  });

  it("the meter's server aria-label says coverage has not been read", () => {
    expect(pageMarkup).toMatch(/aria-label=\{`Coverage meter:[^`]*Coverage not loaded\.`\}/);
    // …and the script replaces it once it knows.
    expect(pageScripts).toMatch(/setAttribute\("aria-label"/);
  });

  it("the review-missed route ships hidden and the resume route does not", () => {
    const drill = pageMarkup.slice(pageMarkup.indexOf('id="dm-route-drill"'));
    expect(drill.slice(0, drill.indexOf("</a>"))).toContain("hidden");
    // Leg 01 is build-time truth, so the resume route works with no JS at all.
    expect(pageMarkup).toContain("Start at leg 01");
  });

  it("a leg's meta line ships a question count and nothing personal", () => {
    const meta = legSrc.slice(legSrc.indexOf("data-leg-meta"));
    const cell = meta.slice(0, meta.indexOf("</span>"));
    expect(cell).toContain("questionCount.toLocaleString()");
    expect(cell).not.toMatch(/read|practis|missed/i);
  });
});

// --- 4. the `[hidden]` specificity trap ----------------------------------

describe("`hidden` beats these display rules, or the attribute lies", () => {
  it("every attribute-hidden element has its companion rule", () => {
    // The live filter hides legs; hydration hides tags; the drill route ships hidden.
    expect(hasRule(legCss, ".dm-leg[hidden]")).toBe(true);
    expect(hasRule(legCss, ".dm-leg__tag[hidden]")).toBe(true);
    expect(hasRule(pageCss, ".dm-noresults[hidden]")).toBe(true);
    expect(hasRule(foundationSrc, ".atl-cta[hidden]")).toBe(true);
  });

  it("the scripts hide with the ATTRIBUTE, not a class", () => {
    // `.hidden` would leave the element in the accessibility tree.
    expect(pageScripts).toMatch(/\.hidden\s*=/);
    expect(pageScripts).not.toMatch(/classList\.(add|toggle)\("hidden"/);
  });
});

// --- 5. the WITHDRAWN accelerators stay withdrawn -------------------------

/**
 * `R` resume / `P` practise / `D` drill were withdrawn: a document-level
 * `keydown` calling `a.click()` navigates the reader away, and WCAG 2.1.4
 * Character Key Shortcuts (Level A) requires an off switch, a remap, or a
 * focus-scoped component — `inEditable()` is none of the three. See §13.1.
 *
 * The routes themselves are untouched, so what is asserted here is: the anchors
 * still exist as ORDINARY LINKS, and nothing keyed is layered back over them.
 */
describe("the withdrawn R/P/D accelerators cannot come back", () => {
  it("keeps all three routes as ordinary anchors", () => {
    for (const id of ["dm-route-resume", "dm-route-practice", "dm-route-drill"]) {
      expect(pageMarkup, `#${id} route anchor went missing`).toContain(`id="${id}"`);
    }
  });

  it("declares no ROUTES map and binds no keydown at all", () => {
    expect(pageScripts).not.toMatch(/\bROUTES\b/);
    expect(pageScripts).not.toMatch(/\bonRouteKey\b|\bannounceRouteKeys\b|\binEditable\b/);
    expect(pageScripts).not.toMatch(/__atl\w*Keys/);
    expect(pageScripts).not.toMatch(/addEventListener\(\s*["']keydown["']/);
  });

  it("prints no keycap chip and claims no aria-keyshortcuts", () => {
    expect(pageMarkup).not.toMatch(/atl-kbd/);
    expect(pageMarkup).not.toMatch(/<kbd\b/);
    expect(surfaceCss).not.toMatch(/atl-kbd/);
    expect(pageMarkup).not.toContain("aria-keyshortcuts");
    expect(pageScripts).not.toContain("aria-keyshortcuts");
  });
});

// --- 6. one read per store, and 44px everywhere -------------------------

describe("hydration reads each store once, and every target clears 44px", () => {
  it("reads the answer map and the reading store exactly once each", () => {
    expect((pageScripts.match(/readAnswers\(\)/g) ?? []).length).toBe(1);
    expect((pageScripts.match(/readStore\(READ_KEY\)/g) ?? []).length).toBe(1);
  });

  it("no per-leg store call survives anywhere in the itinerary", () => {
    // The regression this replaced: `missedCount()` once per card.
    expect(legSrc).not.toContain("missedCount");
    expect(legSrc).not.toContain("localStorage");
    expect(pageScripts).not.toContain("missedCount");
  });

  it("SubtopicCard ships no client script at all", () => {
    expect(legSrc).not.toMatch(/<script/);
  });

  it("the leg row and the filter field floor at 44px", () => {
    expect(rules(legCss).find((r) => r.selector.endsWith(".dm-leg__link"))!.body).toMatch(
      /min-height:\s*44px/,
    );
    expect(rules(pageCss).find((r) => r.selector.endsWith(".dm-filter input"))!.body).toMatch(
      /min-height:\s*44px/,
    );
  });

  it("nothing can widen the page at 360px", () => {
    // A 94-cell meter is wider than a phone: the meter scrolls its own overflow
    // (foundation), and every track it sits in has a zero minimum.
    expect(rules(pageCss).find((r) => r.selector.endsWith(".dm-meterblock"))!.body).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(rules(pageCss).find((r) => r.selector.endsWith(".dm-meter"))!.body).toMatch(
      /min-width:\s*0/,
    );
    expect(rules(legCss).find((r) => r.selector.endsWith(".dm-leg__body"))!.body).toMatch(
      /min-width:\s*0/,
    );
    expect(rules(legCss).find((r) => r.selector.endsWith(".dm-leg__link"))!.body).toMatch(
      /grid-template-columns:[^;]*minmax\(0, 1fr\)/,
    );
  });
});

// --- 7. the leg number is the DOMAIN's, not the group's -----------------

describe("leg numbering", () => {
  it("comes from the flattened domain sequence, not from group position", () => {
    // `subtopic.position` restarts at 1 in each group, so system-design's seven
    // groups printed "01" seven times.
    expect(pageSrc).toContain("getDomainSequence");
    expect(legSrc).toMatch(/const \{ slug, title, questionCount \} = subtopic/);
    expect(legSrc).toMatch(/String\(leg\)\.padStart\(2, "0"\)/);
  });

  it("tells a screen reader the leg's place in the whole domain", () => {
    expect(legSrc).toMatch(/Leg \{leg\} of \{legTotal\}/);
  });
});

// --- 8. the document outline -------------------------------------------

describe("heading order and landmarks", () => {
  it("has exactly one h1 and no skipped level", () => {
    const levels = [...pageMarkup.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    let prev = 1;
    for (const l of levels.slice(1)) {
      expect(l, `heading level jumped from h${prev} to h${l}`).toBeLessThanOrEqual(prev + 1);
      prev = l;
    }
  });

  it("every labelled section points `aria-labelledby` at a real heading", () => {
    for (const m of pageMarkup.matchAll(/aria-labelledby="([^"]+)"/g)) {
      const id = m[1];
      expect(
        pageMarkup,
        `aria-labelledby="${id}" does not name a heading`,
      ).toMatch(new RegExp(`<h[1-6][^>]*id="${id}"`));
    }
  });

  it("adds no second <main> — BaseLayout already owns the landmark", () => {
    expect(pageMarkup).not.toMatch(/<main\b/);
  });
});
