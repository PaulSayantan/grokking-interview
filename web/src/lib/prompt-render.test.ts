/**
 * Guards that every authored prompt string reaches the page through the ONE renderer.
 *
 * The bug this exists for: `Cliffhanger.astro` interpolated its teaser questions as
 * `{q}` while rendering the hook with `set:html`. Authored code spans therefore showed
 * as literal backticks in the teasers and as styled chips in the hook — three lines
 * apart, in the same box.
 *
 * Nothing else in the suite could see it. The markup was valid, the types were right,
 * `astro check` was clean, all 88 tests passed and the build succeeded. It was found by
 * looking at a screenshot, which does not scale, hence this file.
 *
 * So the assertions below are deliberately about the SHAPE of the component source —
 * every authored string is piped through a renderer and handed over with `set:html` —
 * rather than about one string's output. A future component that adds a third authored
 * field and forgets the renderer fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderPromptMarkdown, renderPromptInline } from "../../plugins/rehype-prompts.mjs";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const cliff = read("../components/Cliffhanger.astro");
const panel = read("../components/OpenQuestions.astro");

describe("the two renderers agree on inline content", () => {
  const md = 'With no `/bin/sh`, what runs at PID 1 for `ENTRYPOINT node server.js`?';

  it("block form wraps in a paragraph", () => {
    expect(renderPromptMarkdown(md)).toBe(
      "<p>With no <code>/bin/sh</code>, what runs at PID 1 for " +
        "<code>ENTRYPOINT node server.js</code>?</p>",
    );
  });

  it("inline form is the same html without the paragraph box", () => {
    expect(renderPromptInline(md)).toBe(
      "With no <code>/bin/sh</code>, what runs at PID 1 for " +
        "<code>ENTRYPOINT node server.js</code>?",
    );
  });

  it("both turn a backtick span into a <code> element — never literal backticks", () => {
    for (const out of [renderPromptMarkdown(md), renderPromptInline(md)]) {
      expect(out).toContain("<code>/bin/sh</code>");
      expect(out).not.toContain("`");
    }
  });

  it("inline keeps blocks that genuinely need their own box", () => {
    // A teaser should never be this shape, but flattening it would drop content, so
    // the unwrap is deliberately limited to a lone paragraph.
    const two = renderPromptInline("First question?\n\nSecond question?");
    expect(two).toBe("<p>First question?</p>\n<p>Second question?</p>");
    expect(renderPromptInline("- one\n- two")).toContain("<ul>");
  });

  it("empty and whitespace-only input render to nothing, not to an empty box", () => {
    for (const fn of [renderPromptMarkdown, renderPromptInline]) {
      expect(fn("")).toBe("");
      expect(fn("   \n  ")).toBe("");
      expect(fn(null)).toBe("");
      expect(fn(undefined)).toBe("");
    }
  });
});

describe("no authored string reaches the page unrendered", () => {
  it("Cliffhanger sends the hook AND every teaser through a renderer", () => {
    expect(cliff).toMatch(/renderPromptMarkdown\(cliffhanger\.hook\)/);
    expect(cliff).toMatch(/renderPromptInline\(q\)/);
  });

  it("Cliffhanger interpolates no authored value as bare text", () => {
    // `<li>{q}</li>` was the bug. Any `{`-interpolation of a rendered string is one,
    // because a rendered string interpolated as text shows its own tags as literals.
    expect(cliff).not.toMatch(/<li>\s*\{\s*q\s*\}/);
    expect(cliff).toMatch(/<li set:html=\{q\}/);
    expect(cliff).toMatch(/set:html=\{hookHtml\}/);
  });

  it("OpenQuestions renders its prompt bodies the same way", () => {
    expect(panel).toMatch(/renderPromptMarkdown\(p\.prompt\)/);
    expect(panel).toMatch(/set:html=\{html\}/);
  });

  it("the cliffhanger's code-chip rule covers the teasers, not just the hook", () => {
    // Fixing the renderer made code spans appear in the teasers for the first time,
    // and the chip rule was scoped `.pd-cliff__hook :not(pre) > code` — so the same
    // `/bin/sh` was a chip in the hook and bare monospace three lines below it. The
    // selector must name the block, so the two can never diverge again.
    const css = read("../styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.pd-cliff :not\(pre\) > code \{/);
    expect(css).not.toMatch(/\.pd-cliff__hook :not\(pre\) > code \{/);
  });

  it("both components import from the single shared renderer module", () => {
    for (const src of [cliff, panel]) {
      expect(src).toMatch(/from "\.\.\/\.\.\/plugins\/rehype-prompts\.mjs"/);
    }
  });

  it("payoff.claim and the next-topic link are still never rendered", () => {
    // Both are deliberate omissions (an authoring assertion written for the validator
    // and the next author, and a duplicate of the pager control at the page foot).
    // A regression here is silent.
    //
    // Comments are stripped first: this component's own doc block NAMES both of the
    // things being asserted absent, so matching the raw source always "fails". Same
    // trap, and the same fix, as study-css.test.ts.
    const code = cliff.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/payoff\.claim/);
    expect(code).not.toMatch(/pd-cliff__next/);
    // …and the sanity check that the strip did not eat the whole file.
    expect(code).toMatch(/<aside class="pd-cliff"/);
  });
});
