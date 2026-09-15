/**
 * Guards the /topic JUNCTION surface (atlas, CONTRACT.md §13.4) — specifically the
 * failures that leave the page building, rendering and looking almost right.
 *
 * Nothing here touches `study-css.test.ts` or `theme-css.test.ts`; two checks below
 * exist to prove this surface did not disturb them.
 *
 * The five classes of silent failure it covers:
 *
 *  1. HONESTY. §13.2 forbids shipping state the app cannot compute. `ip:read:v1` is
 *     only written on topics that carry think-prompt rows, so "not visited" is
 *     unknowable and this page says COVERED / NO RECORD instead. And before any store
 *     is read — including forever, with JS off — the "covered" figure must be an em
 *     dash rather than a `0` that reads as a fact about the reader. The one exception
 *     is deliberate and asserted: `is-here` IS server-rendered, because it comes from
 *     the URL and not from a store.
 *  2. NO INVENTED PER-SECTION STATE. The mock fills a manifest node when its section
 *     has been read; nothing here may render that, so the stops must carry no state
 *     class and the page must never reach for the reading store per section.
 *  3. THE `[hidden]` SPECIFICITY TRAP. `.atl .atl-cta` is (0,2,0); Tailwind's
 *     `[hidden] { display: none }` reset is (0,1,0). The drill route depends on the
 *     foundation's companion rule or it stays on screen while leaving the a11y tree.
 *  4. THE WITHDRAWN ACCELERATORS. `R`/`P`/`D` were bare-letter keys that clicked a
 *     route and NAVIGATED AWAY, which WCAG 2.1.4 forbids without an off switch, a
 *     remap or focus-scoping. §6 below now proves they cannot come back.
 *  5. THE N-PARSES REGRESSION. The meter needs the whole domain's coverage; doing it
 *     per cell would be up to 94 reads and 94 parses of the entire answer map.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDomainSequence } from "./catalog";

/**
 * EVERY assertion below runs against COMMENT-STRIPPED source, and that is not a
 * detail: the file documents the very strings this test proves are absent
 * ("not visited", `import.meta.url`, `aria-keyshortcuts`). Matching a doc comment
 * would fail an honest implementation and, worse, pass a dishonest one whose comment
 * happened to be deleted.
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

const pageSrc = source("../pages/topic/[domain]/[slug].astro");
const foundationSrc = source("../components/AtlasFoundation.astro");

/** The `<style is:global>` body of a source file. */
function styleBlock(raw: string, what: string): string {
  const open = raw.lastIndexOf("<style is:global>");
  expect(open, `${what} must carry a <style is:global> block`).toBeGreaterThan(-1);
  const close = raw.lastIndexOf("</style>");
  expect(close).toBeGreaterThan(open);
  return raw.slice(open + "<style is:global>".length, close);
}

const pageCss = styleBlock(pageSrc, "the /topic page");

interface Rule {
  selector: string;
  body: string;
}
function rules(src: string): Rule[] {
  const out: Rule[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (selector.startsWith("@")) continue; // an @media/@supports opener
    out.push({ selector, body: m[2] });
  }
  return out;
}
function hasRule(src: string, needle: string): boolean {
  return rules(src).some((r) => r.selector.includes(needle));
}

/**
 * The markup half: frontmatter, the style block and every `<script>` body removed.
 * Dropping the CSS matters — `var(--atl-ink)` contains the literal `atl-in`, so a
 * count of the page's one animated element reads high without it.
 */
const pageMarkup = (() => {
  const end = pageSrc.indexOf("---", 3);
  return pageSrc
    .slice(end + 3)
    .replace(/<script>[\s\S]*?<\/script>/g, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
})();
/** The frontmatter only — the build-time half. */
const pageFrontmatter = pageSrc.slice(0, pageSrc.indexOf("---", 3));
/** Every `<script>` body on the page, concatenated. */
const pageScripts = [...pageSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .join("\n");

// --- 1. the .atl authoring discipline, on a page rather than the kit -------

describe("the /topic surface keeps the `.atl` discipline (§12 rules 1-3)", () => {
  it("rule 1: every selector contains `.atl`", () => {
    for (const r of rules(pageCss)) {
      expect(r.selector, `"${r.selector}" can leak off this page`).toMatch(/\.atl\b/);
    }
  });

  it("rule 2: no colour literal anywhere — the light theme would be wrong", () => {
    expect(pageCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(pageCss).not.toMatch(/\b(rgb|hsl|oklch|oklab)\(/);
  });

  it("rule 3: nothing is declared on :root, html or [data-theme=light] alone", () => {
    for (const r of rules(pageCss)) {
      expect(r.selector).not.toMatch(/^:root\b/);
      expect(r.selector).not.toMatch(/^html\b/);
      expect(r.selector).not.toMatch(/^\[data-theme="light"\]\s*$/);
    }
  });

  it("every var(--atl-…) it reaches for is a token the foundation declares", () => {
    const declared = new Set(
      [...foundationSrc.matchAll(/(--atl-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const referenced = new Set(
      [...pageCss.matchAll(/var\((--atl-[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    expect(referenced.size).toBeGreaterThan(5);
    for (const name of referenced) {
      expect(declared.has(name), `var(${name}) resolves to nothing`).toBe(true);
    }
  });

  it("§13 rule 9: adds NO new channel-as-text site", () => {
    // The audited pair is `.atl-cta--mark` and `.atl-plate__no`. The mock coloured
    // `.tp-route__go` with the channel; it would be legal on this plane-0 ground,
    // but the audit names its sites and a page may not add a third quietly.
    for (const r of rules(pageCss)) {
      expect(r.body, `${r.selector} takes the channel as text`).not.toMatch(
        /(^|[;\s])color:\s*var\(--atl-ch\)/,
      );
    }
    // …and the channel IS used as a graphic, or the orientation is simply gone.
    expect(pageCss).toMatch(/background:\s*var\(--atl-ch\)/);
    expect(pageCss).toMatch(/border-top-color:\s*var\(--atl-ch\)/);
  });

  it("§13 rule 10: a manifest node uses the 3:1 token, not the decorative rail", () => {
    const dot = rules(pageCss).find((r) => r.selector.endsWith(".tp-stop__dot"))!;
    expect(dot.body).toMatch(/border:\s*1px solid var\(--atl-node-ring\)/);
  });

  it("declares no animation — the page's one moving object is `.atl-in`", () => {
    expect(pageCss).not.toMatch(/(^|[;\s])animation\s*:/);
    // Two onward cards are authored (next leg / next domain) but they are the two
    // arms of one conditional, so exactly one ever renders.
    expect((pageMarkup.match(/atl-in/g) ?? []).length).toBe(2);
    expect(pageMarkup).toMatch(/\{next \?/);
  });
});

// --- 2. the reading contract is not disturbed ----------------------------

describe("the frozen reading contract survives this surface", () => {
  it("declares no reading-contract token and no .prose rule", () => {
    for (const frozen of ["--measure", "--measure-wide", "--prose-bleed", "--prose-body"]) {
      expect(pageCss, `${frozen} must not be re-declared here`).not.toMatch(
        new RegExp(`(^|[;{\\s])${frozen}\\s*:`),
      );
    }
    for (const r of rules(pageCss)) {
      expect(r.selector, "the junction has no business styling .prose").not.toMatch(
        /\.prose\b/,
      );
    }
  });

  it("global.css is not where this surface lives", () => {
    const global = readFileSync(
      fileURLToPath(new URL("../styles/global.css", import.meta.url)),
      "utf8",
    );
    expect(global).not.toContain("tp-stop");
    expect(global).not.toContain("tp-route");
    expect(global).not.toContain("tp-manifest");
  });

  it("renders no second `<main>` — BaseLayout already owns the landmark", () => {
    expect(pageMarkup).not.toContain("<main");
  });
});

// --- 3. honesty: what the page may claim before a store is read -----------

describe("the page claims nothing about the reader until a store is read", () => {
  it("never uses the two words the read store cannot justify", () => {
    expect(pageSrc.toLowerCase()).not.toContain("not visited");
    expect(pageSrc.toLowerCase()).not.toContain("mastered");
  });

  it("names the three cell states in words, so colour is never the only carrier", () => {
    for (const word of ["Covered", "You are here", "No record"]) {
      expect(pageMarkup, `the legend is missing "${word}"`).toContain(word);
    }
  });

  it("ships the covered figure as an em dash, not a zero", () => {
    const m = pageMarkup.match(/data-tp-covered[^>]*>([^<]*)</);
    expect(m, "the covered slot was not found").toBeTruthy();
    expect(m![1].trim(), "it ships a number nobody computed").toBe("—");
  });

  it("`is-here` IS server-rendered — it is the URL, not a claim about the reader", () => {
    expect(pageMarkup).toMatch(/"is-here":\s*i === at/);
    // …and the hydration pass must leave that one cell alone.
    expect(pageScripts).toMatch(/dataset\.tpHere === undefined/);
  });

  it("the meter's server aria-label says coverage has not been loaded", () => {
    expect(pageMarkup).toMatch(/aria-label=\{`Position meter:[^`]*not loaded\.`\}/);
    expect(pageScripts).toMatch(/setAttribute\(\s*"aria-label"/);
  });

  /**
   * THE MEASURED REGRESSION this guards. `hydratePosition()` runs TWICE on a cold
   * load — the module registers it on `astro:page-load`, which Astro fires on the
   * initial load too, AND calls it directly. The label used to be SURGERY on itself
   * (`label.slice(0, label.indexOf("Coverage"))`), so pass 2 found no "Coverage",
   * `slice(0, -1)` ate the trailing period and the coverage sentence was appended
   * again — inside the whole accessible name of a `role="img"` element, on all 460
   * /topic pages:
   *   "…1 of 16 covered. 15 with no record1 of 16 covered. 15 with no record."
   * The only durable fix is a label REBUILT from build-time facts, so the write is
   * idempotent however many passes run. Guarding the shape, not the symptom.
   */
  it("the meter label is REBUILT from build-time facts, never edited in place", () => {
    // The two facts the sentence needs are published as data-* attributes …
    expect(pageMarkup).toMatch(/data-tp-leg=\{leg\}/);
    expect(pageMarkup).toMatch(/data-tp-place=\{domainData\.title\}/);
    // … and the script composes whole sentences from them.
    expect(pageScripts).toMatch(/dataset\.tpPlace/);
    expect(pageScripts).toMatch(/dataset\.tpLeg/);
    expect(pageScripts).toMatch(/sentences\.join\(" "\)/);
    // Never reads the label it is about to replace, and never slices it.
    expect(pageScripts, "a label derived from itself rots on the second pass").not.toMatch(
      /getAttribute\(\s*["']aria-label["']\s*\)/,
    );
    expect(pageScripts).not.toContain('indexOf("Coverage")');
    expect(pageScripts).not.toMatch(/slice\(0,\s*-1\)/);
  });

  /**
   * The class of bug, not the instance: every write in the hydration pass must be a
   * WHOLE value assigned from stored evidence plus build-time truth. Appending to,
   * or slicing, what the previous pass left behind is what broke the label — and
   * the pass runs at least twice on every cold load.
   */
  it("no hydration write appends to or trims the DOM state it finds", () => {
    // `+=` on a text node or an attribute is the append form of the same bug.
    expect(pageScripts).not.toMatch(/(textContent|innerHTML|innerText)\s*\+=/);
    // The ONE legitimate read of existing DOM text: the neighbour meta caches the
    // server's own string in `data-base` on the first pass and rebuilds from that
    // cache afterwards, so pass n produces what pass 1 did.
    expect(pageScripts).toMatch(/dataset\.base \|\|= \(meta\.textContent \|\| ""\)\.trim\(\)/);
    // Every state class is toggled with an explicit boolean, never flipped.
    for (const m of pageScripts.matchAll(/classList\.toggle\(([^)]*)\)/g)) {
      expect(m[1], `classList.toggle(${m[1]}) flips on a second pass`).toContain(",");
    }
  });

  it("the drill route ships hidden; both ports do not", () => {
    /** The bare `hidden` attribute — `aria-hidden="true"` is a different thing. */
    const HIDDEN_ATTR = /(?<!aria-)\bhidden\b/;
    const anchor = (id: string) => {
      const from = pageMarkup.slice(pageMarkup.indexOf(`id="${id}"`));
      return from.slice(0, from.indexOf("</a>"));
    };
    expect(anchor("tp-route-drill")).toMatch(HIDDEN_ATTR);
    for (const id of ["tp-route-read", "tp-route-practice"]) {
      expect(anchor(id), `#${id} must not ship hidden`).not.toMatch(HIDDEN_ATTR);
    }
  });

  it("a neighbour's meta ships a question count and nothing personal", () => {
    const meta = pageMarkup.slice(pageMarkup.indexOf("data-tp-nb-meta"));
    const cell = meta.slice(0, meta.indexOf("</span>"));
    expect(cell).toContain("questionCount.toLocaleString()");
    expect(cell).not.toMatch(/read|practis|missed|covered/i);
  });
});

// --- 4. the manifest invents no per-section state ------------------------

describe("the manifest shows what is real and nothing more (§13.2)", () => {
  it("no stop carries a read/covered state class", () => {
    // The mock's `.tp-stop.is-read` is the one device this page refuses: `ip:read:v1`
    // would answer "not read" for every section of every un-instrumented topic.
    expect(pageCss).not.toMatch(/\.tp-stop\.is-/);
    expect(pageMarkup).not.toMatch(/class:list=\[\s*"tp-stop"/);
    expect(pageMarkup).toMatch(/class="tp-stop"/);
  });

  it("the reading store is read ONCE for the meter, never per section", () => {
    expect((pageScripts.match(/readStore\(/g) ?? []).length).toBe(1);
    expect((pageScripts.match(/readAnswers\(/g) ?? []).length).toBe(1);
    expect(pageScripts).not.toMatch(/sectionsFor\(/);
    expect(pageScripts).not.toMatch(/missedCount\(/);
  });

  it("stop TEXT comes from the heading, never rebuilt from the slug (§6)", () => {
    expect(pageMarkup).toMatch(/\{stop\.text\}/);
    expect(pageMarkup).toMatch(/#\$\{stop\.slug\}/);
  });

  it("the count column is DROPPED, never printed as 0, when the tally is not exact", () => {
    // The gate is `exact` (per-SECTION safe: false if ANY ref failed to land — see
    // @lib/manifest) AND the catalog cross-check. `counted > 0` alone was per-TOPIC,
    // so a topic with one stale anchor kept its column and that section printed 0 q.
    expect(pageFrontmatter).toMatch(
      /showStopCounts\s*=\s*exact\s*&&\s*counted\s*===\s*subtopic\.questionCount/,
    );
    expect(pageFrontmatter, "a per-topic gate is what let a false zero through").not.toMatch(
      /showStopCounts\s*=\s*counted\s*>\s*0/,
    );
    expect(pageMarkup).toMatch(/\{showStopCounts &&/);
    expect(hasRule(pageCss, ".tp-manifest--noq")).toBe(true);
  });

  it("the manifest and the study TOC read the same headings, so they cannot disagree", () => {
    // Both take `render(entry).headings`; the H2 filter is the manifest's, in the lib.
    expect(pageFrontmatter).toMatch(/await render\(entry\)\)\.headings/);
    const study = source("../pages/study/[domain]/[slug].astro");
    expect(study).toMatch(/await render\(entry\)/);
  });
});

// --- 5. the `[hidden]` specificity trap ---------------------------------

describe("`hidden` beats these display rules, or the attribute lies", () => {
  it("the drill route has its companion rule in the foundation", () => {
    expect(hasRule(foundationSrc, ".atl-cta[hidden]")).toBe(true);
  });

  it("no page rule sets `display` on an attribute-hidden element without one", () => {
    // `.tp-drill` sets margin only, so the foundation's rule still decides display.
    const drill = rules(pageCss).find((r) => r.selector.endsWith(".tp-drill"))!;
    expect(drill.body).not.toMatch(/display\s*:/);
  });

  it("the script hides with the ATTRIBUTE, not a class", () => {
    expect(pageScripts).toMatch(/\.hidden\s*=/);
    expect(pageScripts).not.toMatch(/classList\.(add|toggle)\("hidden"/);
  });
});

// --- 6. the WITHDRAWN accelerators stay withdrawn ------------------------

/**
 * `R` read / `P` practise / `D` drill were withdrawn: a document-level `keydown`
 * calling `a.click()` navigates the reader away, and WCAG 2.1.4 Character Key
 * Shortcuts (Level A) requires an off switch, a remap, or a focus-scoped
 * component — `inEditable()` is none of the three. See §13.1.
 *
 * The three routes are untouched, so what is asserted is: the anchors still
 * exist as ORDINARY LINKS, and nothing keyed is layered back over them.
 */
describe("the withdrawn R/P/D accelerators cannot come back", () => {
  it("keeps all three routes as ordinary anchors", () => {
    for (const id of ["tp-route-read", "tp-route-practice", "tp-route-drill"]) {
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
    expect(pageCss).not.toMatch(/atl-kbd/);
    expect(pageMarkup).not.toContain("aria-keyshortcuts");
    expect(pageScripts).not.toContain("aria-keyshortcuts");
    // The foundation still DECLARES the primitive; nothing may consume it.
    expect(foundationSrc).toMatch(/\.atl \.atl-kbd\s*\{/);
  });
});

// --- 7. mobile, targets and the leg number ------------------------------

describe("mobile and touch targets", () => {
  it("every row and route floors at 44px", () => {
    for (const sel of [".tp-nb", ".tp-stop__link", ".tp-route__go"]) {
      // `.some`, not `.find`: a `:hover` variant of the same class also ends with
      // the selector and would shadow the base rule.
      const matching = rules(pageCss).filter((x) => x.selector.endsWith(sel));
      expect(matching.length, `${sel} has no rule`).toBeGreaterThan(0);
      expect(
        matching.some((x) => /min-height:\s*44px/.test(x.body)),
        `${sel} does not floor at 44px`,
      ).toBe(true);
    }
  });

  it("nothing can widen the page at 360px", () => {
    // A 94-cell meter and a 60-character heading are the two real threats; both are
    // contained by `minmax(0, …)` tracks plus the foundation meter's own overflow.
    const meter = rules(pageCss).find((r) => r.selector.endsWith(".tp-meter"))!;
    expect(meter.body).toMatch(/min-width:\s*0/);
    const link = rules(pageCss).find((r) => r.selector.endsWith(".tp-stop__link"))!;
    expect(link.body).toMatch(/minmax\(0, 1fr\)/);
    const pos = rules(pageCss).find((r) => r.selector.endsWith(".tp-position"))!;
    expect(pos.body).toMatch(/minmax\(0, 1fr\)/);
    // Pixel widths are legal for the marks (a 3px tick, a 1px rail, a 9px node) and
    // never for layout: anything three digits or more would out-measure a 360px
    // viewport's content box. Rule BODIES only — `@media (min-width: 720px)` is a
    // breakpoint, not a width, and `rules()` already drops the `@` openers.
    for (const r of rules(pageCss)) {
      expect(r.body, `${r.selector} pins a layout width in px`).not.toMatch(
        /(^|[;\s])(min-|max-)?width:\s*[1-9]\d{2,}px/,
      );
    }
  });

  it("a long domain name cannot overflow the spine at 360px", () => {
    // The foundation makes every waypoint `nowrap`; the longest FULL domain title is
    // 55 characters and would paint ~385px into a 328px content box. Two independent
    // guards, and the test asserts both because either alone is one corpus edit from
    // being wrong: the short title, and a wrap allowance below 640px.
    expect(pageFrontmatter).toMatch(/cardTitle\(domainData\.slug, domainData\.title\)/);
    expect(pageMarkup).toMatch(/title=\{domainData\.title\}/);
    const wrap = rules(pageCss).find((r) =>
      r.selector.includes(".tp-spine .atl-wp--mhead a"),
    );
    expect(wrap, "no wrap allowance for the domain waypoint").toBeTruthy();
    expect(wrap!.body).toMatch(/white-space:\s*normal/);
    expect(pageCss).toMatch(/max-width:\s*639px/);
  });

  it("the count column keeps its accessible text at every width", () => {
    // Hiding it below 480px with `display: none` would take it out of the a11y tree
    // too, and how many questions a section carries is what this list is FOR.
    expect(pageCss).not.toMatch(/tp-stop__q[^{]*\{[^}]*display:\s*none/);
  });
});

describe("leg numbering agrees with /domain", () => {
  it("comes from the flattened domain sequence, not from group position", () => {
    expect(pageFrontmatter).toMatch(/getDomainSequence\(domainData\.slug\)/);
    expect(pageFrontmatter).not.toMatch(/subtopic\.position/);
  });

  it("system-design's 7 groups produce one continuous 1..94, not seven 1..n", () => {
    const seq = getDomainSequence("system-design");
    expect(seq.length).toBeGreaterThan(90);
    // `position` restarts per group; the sequence index does not.
    expect(seq.filter((e) => e.subtopic.position === 1).length).toBeGreaterThan(1);
    expect(new Set(seq.map((e) => e.subtopic.slug)).size).toBe(seq.length);
  });

  it("the eyebrow, the spine and the neighbours all pad to two digits", () => {
    expect(pageFrontmatter).toMatch(/padStart\(2, "0"\)/);
    expect(pageMarkup).toMatch(/leg \{legNo\} of \{pad\(legTotal\)\}/);
  });
});

// --- 8. heading order and landmarks ------------------------------------

describe("heading order and landmarks", () => {
  it("has exactly one h1 and no skipped level", () => {
    expect((pageMarkup.match(/<h1\b/g) ?? []).length).toBe(1);
    expect((pageMarkup.match(/<h4\b/g) ?? []).length).toBe(0);
    expect((pageMarkup.match(/<h2\b/g) ?? []).length).toBeGreaterThan(2);
    expect((pageMarkup.match(/<h3\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it("every labelled section points `aria-labelledby` at a real heading", () => {
    const ids = [...pageMarkup.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) {
      expect(pageMarkup, `nothing carries id="${id}"`).toMatch(
        new RegExp(`<h[1-6][^>]*id="${id}"`),
      );
    }
  });

  it("the spine is a nav with a name, and marks the current page", () => {
    expect(pageMarkup).toMatch(/<nav class="atl-route tp-spine" aria-label="Breadcrumb">/);
    expect(pageMarkup).toContain('aria-current="page"');
  });
});
