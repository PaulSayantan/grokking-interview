/**
 * Guards the /study READ surface (atlas, CONTRACT.md §13.5) — specifically the
 * failures that leave the page building, rendering and looking almost right.
 *
 * NOTHING HERE TOUCHES `study-css.test.ts` OR `theme-css.test.ts`. Those 32
 * assertions are the frozen reading contract; this file only ADDS, and several
 * checks below exist to prove this surface did not disturb them.
 *
 * The six classes of silent failure it covers:
 *
 *  1. THE READING CONTRACT. Both leadings and both block gaps must be the frozen
 *     numbers, and the TOC must stay pinned flush right by the exact
 *     `margin-right` breakout. Every one of them is a rule that can be edited
 *     without anything failing to build.
 *     `--measure` is the one value here that has deliberately MOVED, on an
 *     explicit product decision: 68ch base, and 79ch (not the earlier 104ch) at
 *     >=1024px, so the line stops growing with the monitor. See the measure test
 *     below for the measurements behind the number. Leadings and gaps did not
 *     move, and global.css's 68ch/80ch did not move.
 *  2. HONESTY (§13.2). This page can prove where a reader has SCROLLED and nothing
 *     more. So its legend says PASSED / HERE / AHEAD, and it must not import the
 *     retrieval module (`reading.test.ts` owns that gate; the vocabulary is here).
 *  3. ZERO CLS ON THE PROMPT ROW. `study-css.test.ts` proves the invariant inside
 *     global.css: every box property of every prompt state lives in ONE rule. This
 *     page restyles `.pd-line`, so the same rule has to hold in the PAGE block, and
 *     nothing there tests it.
 *  4. GRAFT 2's HAZARD. Wrapping a `pre` in `figure.atl-plate` stops the frozen
 *     `.prose > pre, .prose > table` selector matching, which kills the right-hand
 *     bleed with no error anywhere. Mermaid must never be plated either, or its own
 *     width rule stops matching too.
 *  5. THE WITHDRAWN ACCELERATORS. `R`/`P` were bare-letter keys that clicked a route
 *     and NAVIGATED AWAY, which WCAG 2.1.4 forbids without an off switch, a remap or
 *     focus-scoping. §5 below now proves they cannot come back.
 *  6. NO-JS AND THE RETIRED DEVICES. The route drawer must be server-rendered (a
 *     cloned menu is an empty menu with JS off), and the devices atlas replaced —
 *     the percentage progress bar, the gradient hero, the duplicate domain
 *     disclosure — must not creep back.
 *
 * EVERY assertion runs against COMMENT-STRIPPED source, because this file's own
 * comments name the very strings it proves are absent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

function source(rel: string): string {
  return stripComments(
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"),
  );
}

const pageSrc = source("../pages/study/[domain]/[slug].astro");
const routeSrc = source("../components/StudyRoute.astro");
const plateSrc = source("../../plugins/rehype-plates.mjs");
const globalCss = readFileSync(
  fileURLToPath(new URL("../styles/global.css", import.meta.url)),
  "utf8",
);

/** The page's `<style is:global>` body. */
const pageCss = (() => {
  const open = pageSrc.lastIndexOf("<style is:global>");
  expect(open, "the /study page must carry a <style is:global> block").toBeGreaterThan(-1);
  const close = pageSrc.lastIndexOf("</style>");
  expect(close).toBeGreaterThan(open);
  return pageSrc.slice(open + "<style is:global>".length, close);
})();

interface Rule {
  selector: string;
  body: string;
}
function rules(src: string): Rule[] {
  const out: Rule[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (selector.startsWith("@")) continue; // an @media/@supports opener
    if (/^(from|to|\d+%)$/.test(selector)) continue; // a keyframe stop
    out.push({ selector, body: m[2] });
  }
  return out;
}

/**
 * The markup half: frontmatter, the style block and every `<script>` removed.
 *
 * The SELF-CLOSING script goes first, deliberately. `<script … />}` has no closing
 * tag, so a single `<script[\s\S]*?<\/script>` pass starts there and swallows every
 * line down to the first real `</script>` — i.e. the whole page — and then every
 * markup assertion below passes vacuously against an empty string.
 */
const pageMarkup = (() => {
  let m = pageSrc.slice(pageSrc.indexOf("---", 3) + 3);
  m = m.slice(0, m.lastIndexOf("<style is:global>"));
  return m.replace(/<script[^>]*\/>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
})();

/** Every `<script>` body on the page. */
const pageScripts = (pageSrc.match(/<script[\s\S]*?<\/script>/g) ?? []).join("\n");

// --- 1. the frozen reading contract ---------------------------------------

describe("the frozen reading contract survives the redesign", () => {
  it("caps the desktop measure at exactly one declared value (79ch)", () => {
    // Every value this page gives `--measure`, so a second declaration cannot
    // hide behind the first. 68ch and 80ch stay global.css's business.
    //
    // WHY 79ch AND NOT 104ch: 104ch was set when the grid started reaching the
    // viewport edge, on the reasoning that the column no longer bound the line.
    // Measured, the grid binds up to ~2030px, so the line GREW with the monitor
    // — 95 characters at 1440px, 118 at 1920px. 79ch = 987px at the 19.8px body
    // (1ch = 12.49px) = ~95 characters, i.e. it pins every wide screen to the
    // line the 1440px reader already had. Below ~1450px the grid still binds, so
    // this is a cap on ultrawide, not a narrowing of what anyone reads today.
    // GRAFT 1 still buys its shorter line with a BIGGER FACE; this stops that
    // face gain being handed straight back on a large monitor.
    const declared = [...pageCss.matchAll(/--measure:\s*([^;]+)/g)].map((m) =>
      m[1].trim(),
    );
    expect(declared).toEqual(["79ch"]);
    expect(pageCss).not.toMatch(/--measure-wide\s*:/);
    expect(globalCss).toMatch(/--measure:\s*68ch/);
    expect(globalCss).toMatch(/--measure-wide:\s*80ch/);
  });

  it("keeps the desktop leading and block gap at 1.68 / 1.35em", () => {
    const leading = rules(pageCss).find(
      (r) => r.selector === ".atl.study-page .study-prose",
    );
    expect(leading, "the desktop leading rule is gone").toBeTruthy();
    expect(leading!.body).toMatch(/line-height:\s*1\.68/);
    const gap = rules(pageCss).find(
      (r) => r.selector === ".atl.study-page .study-prose > * + *",
    );
    expect(gap, "the desktop block-gap rule is gone").toBeTruthy();
    expect(gap!.body).toMatch(/margin-top:\s*1\.35em/);
  });

  it("keeps the TOC pinned flush to the viewport's right edge", () => {
    // The one device that replaces workbench's rejected inspector gutter (§13.2).
    expect(pageCss).toMatch(
      /margin-right:\s*calc\(1rem - \(100vw - 100%\) \/ 2\)/,
    );
  });

  it("caps the right-only bleed for whatever is not plated", () => {
    const cap = rules(pageCss).find(
      (r) =>
        r.selector ===
        ".atl.study-page .study-prose > pre, .atl.study-page .study-prose > table",
    );
    expect(cap, "the bleed cap for bare pre/table is gone").toBeTruthy();
    expect(cap!.body).toMatch(/max-width:\s*calc\(100% \+ var\(--prose-bleed\)\)/);
  });

  it("declares nothing on :root and no accent hex outside a theme block", () => {
    // §12 rules 2-3. A hex here would not pick up the light theme's deepened
    // accents, and a `:root` declaration would leak to the marketing pages.
    expect(pageCss).not.toMatch(/:root/);
    // `var()` fallbacks are exempt — the mermaid pre-render colour carries the same
    // hex global.css gives `--color-text-muted`, and dropping it would leave the
    // raw diagram source unstyled if the token ever went missing.
    expect(pageCss.replace(/var\([^)]*\)/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("prefixes every selector with .atl (§12 rule 1)", () => {
    for (const r of rules(pageCss)) {
      expect(r.selector, `${r.selector} is missing the .atl namespace`).toContain(
        ".atl",
      );
    }
  });

  it("keeps this surface out of global.css", () => {
    for (const own of ["st-loc", "st-seam", "st-pager", "atl-plate"]) {
      expect(globalCss, `${own} must not be in global.css`).not.toContain(own);
    }
  });

  it("clears BOTH sticky bars on an anchor jump, from the locator's own token", () => {
    // 5.5rem (the frozen header clearance) + the locator's declared height, read
    // from the token so the two cannot drift apart.
    expect(pageCss).toMatch(
      /scroll-margin-top:\s*calc\(5\.5rem \+ var\(--atl-locator-h\)\)/,
    );
  });
});

// --- 2. honesty ------------------------------------------------------------

describe("the page claims position, never knowledge", () => {
  it("never uses a word the stores cannot justify", () => {
    const lower = pageSrc.toLowerCase();
    for (const word of ["not visited", "mastered", "sections read", "legs read"]) {
      expect(lower, `"${word}" is a claim this page cannot compute`).not.toContain(
        word,
      );
    }
  });

  it("names the three spine states in words, so colour is never the only carrier", () => {
    for (const word of ["Passed", "Here", "Ahead"]) {
      expect(pageMarkup, `the spine legend is missing "${word}"`).toContain(word);
    }
  });

  it("never imports the retrieval module", () => {
    // `reading.test.ts` owns this gate; it is restated because the tempting fix
    // for a "review N missed" route is exactly this import, and the ban is
    // structural: reading coverage must never reach mastery / SRS / the streak.
    expect(pageSrc).not.toMatch(/from ["']@lib\/progress["']/);
    expect(pageSrc).not.toMatch(/ip:answers/);
  });

  it("ships the locator's server state as the first stop, not as a guess", () => {
    // `&nbsp;`, so "§" and its number can never break across two lines in a 46px bar.
    expect(pageMarkup).toMatch(/data-st-folio>§&nbsp;01</);
    expect(pageMarkup).toMatch(/data-st-n>1</);
    // Cell 1 is `is-here` at load because it is where the page starts — the one
    // state on this surface that needs no store at all.
    expect(pageMarkup).toMatch(/"is-here": i === 0/);
  });
});

// --- 3. zero CLS on the prompt row ---------------------------------------

describe("restyling the prompt row cannot shift the page", () => {
  const BOX = [
    "min-height",
    "max-height",
    "height",
    "padding",
    "margin",
    "font-weight",
    "border",
    "gap",
    "width",
    "display",
  ];

  it("no prompt STATE variant in the page block declares a box property", () => {
    const variants = rules(pageCss).filter(
      (r) =>
        (r.selector.includes("pd-line--") || r.selector.includes("data-pd-state")) &&
        !r.selector.endsWith(".pd-line"),
    );
    for (const r of variants) {
      for (const prop of BOX) {
        expect(
          r.body,
          `${r.selector} must not set ${prop} — a row that grows when it arms ` +
            `moves the paragraph the reader is on`,
        ).not.toMatch(new RegExp(`(^|[;\\s])${prop}\\s*:`));
      }
    }
  });

  it("the base .pd-line rule is the only place the page changes the metrics", () => {
    const base = rules(pageCss).find(
      (r) => r.selector === ".atl.study-page .prose .pd-line",
    );
    expect(base, "the mono restyle of the prompt line is gone").toBeTruthy();
    // The 44px floor stays in global.css, so the touch target cannot shrink here.
    expect(base!.body).not.toMatch(/min-height/);
    expect(globalCss).toMatch(/min-height:\s*44px/);
  });

  it("hides nothing of the prompt content — that gate is global.css's and is flag-gated", () => {
    for (const r of rules(pageCss)) {
      if (!/display:\s*none/.test(r.body)) continue;
      expect(
        r.selector,
        `${r.selector} hides content a no-JS reader must still get`,
      ).not.toMatch(/pd-body|pd-panel__item|pd-line--/);
    }
  });
});

// --- 4. GRAFT 2: the plate hazard ---------------------------------------

describe("GRAFT 2 — plates keep the bleed and never touch a diagram", () => {
  it("leaves the frozen two-selector list in global.css exactly as it was", () => {
    // Adding `figure` as a third selector there would break `study-css.test.ts`'s
    // exact string match; the figure gets its OWN rule in AtlasFoundation.astro.
    expect(globalCss).toMatch(/\.prose > pre,\s*\n?\s*\.prose > table \{/);
    expect(globalCss).not.toMatch(/\.prose > figure/);
  });

  it("wraps only ROOT-LEVEL blocks, and never a mermaid pre", () => {
    // `visit()` would reach a `pre` inside a callout or a table cell, which is not
    // a figure in the reader's sense and must not get the bleed.
    expect(plateSrc).not.toMatch(/visit\(/);
    expect(plateSrc).toMatch(/tree\.children/);
    expect(plateSrc).toMatch(/isMermaid/);
    expect(plateSrc).toMatch(/mermaid/);
  });

  it("numbers plates per document and captions them with the authored language", () => {
    expect(plateSrc).toMatch(/atl-plate__no/);
    expect(plateSrc).toMatch(/Plate \$\{pad\(n\)\}/);
    expect(plateSrc).toMatch(/data-pagefind-ignore/);
  });

  it("counts a plate as one reading block, so coverage keeps its meaning", () => {
    // The reveal client walks `prose.children` and filters BLOCK_SELECTOR; without
    // `figure` there, a code-heavy section silently loses most of its blocks.
    const reading = source("./reading.ts");
    expect(reading).toMatch(/BLOCK_SELECTOR = "[^"]*\bfigure\b/);
  });

  it("keeps the mermaid width rule matching a BARE pre", () => {
    expect(pageCss).toMatch(/pre\.mermaid\s*\{[^}]*max\(var\(--measure-wide\)/);
  });
});

// --- 5. the WITHDRAWN accelerators stay withdrawn -----------------------

/**
 * `R` next leg / `P` practise were withdrawn: a document-level `keydown` calling
 * `a.click()` navigates the reader away MID-READ, and WCAG 2.1.4 Character Key
 * Shortcuts (Level A) requires an off switch, a remap, or a focus-scoped
 * component — `inEditable()` is none of the three. This is the surface where the
 * cost was highest: a lost reading position in a forty-minute read, no undo, and
 * no setting anywhere in the app. See §13.1.
 *
 * The routes are untouched, so what is asserted is: the anchors still exist as
 * ORDINARY LINKS, and nothing keyed is layered back over them.
 */
describe("the withdrawn R/P accelerators cannot come back", () => {
  it("keeps both routes as ordinary anchors", () => {
    expect(pageMarkup).toContain('id="st-route-practice"');
    expect(pageMarkup).toContain('st-route-next');
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
  });

  it("gives exactly one anchor the onward id, whichever branch renders", () => {
    const ids = pageMarkup.match(/id=\{?"?st-route-next"?\}?/g) ?? [];
    expect(ids.length, "the onward route is declared in three branches").toBe(2);
    // …and the pager only claims it when the seam did not.
    expect(pageMarkup).toMatch(/seamOnward \? undefined : "st-route-next"/);
  });
});

// --- 6. no-JS, and the retired devices stay retired ---------------------

describe("no-JS works, and nothing atlas replaced creeps back", () => {
  it("server-renders BOTH route lists from one component", () => {
    // The mock cloned the spine into the drawer with a script, which leaves the
    // phone's only route menu empty with JS off.
    expect((pageMarkup.match(/<StudyRoute /g) ?? []).length).toBe(2);
    // Scoped to the position observer: the mermaid island legitimately writes
    // `innerHTML` with the SVG it just rendered, and that is a different script.
    const observer = (pageScripts.match(/<script is:inline>[\s\S]*?<\/script>/g) ?? [])
      .filter((s) => s.includes("data-toc-link"))
      .join("\n");
    expect(observer, "the position observer is gone").toBeTruthy();
    expect(observer).not.toMatch(/cloneNode|createElement|innerHTML|appendChild/);
    expect(routeSrc).toMatch(/data-toc-link/);
  });

  it("keeps the shipped TOC hooks the observer and the styles both depend on", () => {
    for (const hook of ["toc-aside", "toc-panel", "toc-label", "toc-rail", "toc-progress"]) {
      expect(pageMarkup, `${hook} is gone`).toContain(hook);
    }
    for (const hook of ["toc-list", "toc-link", "data-slug"]) {
      expect(routeSrc, `${hook} is gone`).toContain(hook);
    }
  });

  it("drives every position mark from ONE observer", () => {
    expect((pageScripts.match(/new IntersectionObserver/g) ?? []).length).toBe(3);
    // …and the two extra observers are the reveal client's, not a second locator.
    expect(pageScripts).toContain("blockIO");
    expect(pageScripts).toContain("deptIO");
  });

  it("retires the percentage bar, the gradient hero and the duplicate domain nav", () => {
    for (const gone of [
      "scroll-progress",
      "study-crumbs",
      "study-hero",
      "text-gradient",
      "DomainSidebar",
      "reveal-fade-up",
    ]) {
      expect(pageSrc, `${gone} was replaced by an atlas device`).not.toContain(gone);
    }
  });

  it("animates one thing, gated, with a visible resting state", () => {
    // DECLARATIONS only: the string also appears in the `@supports` condition.
    const anims = pageCss.match(/^\s*animation-timeline:/gm) ?? [];
    expect(anims.length, "one scroll-driven idea per page (§12 rule 6)").toBe(1);
    const at = pageCss.search(/^\s*animation-timeline:/m);
    const before = pageCss.slice(0, at);
    expect(before.lastIndexOf("prefers-reduced-motion: no-preference")).toBeGreaterThan(0);
    expect(before.lastIndexOf("@supports (animation-timeline")).toBeGreaterThan(0);
    // The resting state is declared OUTSIDE the gates.
    expect(pageCss).toMatch(/\.toc-progress \{[^}]*transform:\s*scaleY\(0\)/);
  });

  it("renders no second <main> — BaseLayout owns the landmark", () => {
    expect(pageMarkup).not.toContain("<main");
  });

  it("keeps the channel a GRAPHIC everywhere its ground can lift to plane-1", () => {
    // §13 rule 9: as text the channel is legal on plane-0 only, and a `:hover`
    // that raises a row to plane-1 is exactly how that gets violated by accident.
    // Every channel-as-text site on this surface is named here, so a third cannot
    // appear quietly.
    const ALLOWED = [
      ".atl.study-page .prose a:not(.heading-anchor)",
      ".atl.study-page .prose ul::marker, .atl.study-page .prose li::marker",
      ".atl.study-page .st-seam .pd-cliff__teasers li::before",
    ];
    const found = rules(pageCss)
      .filter((r) => /(^|[;\s])color:\s*var\(--atl-ch\)/.test(r.body))
      .map((r) => r.selector);
    expect(found.sort()).toEqual([...ALLOWED].sort());
  });
});
