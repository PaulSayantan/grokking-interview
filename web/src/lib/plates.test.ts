/**
 * GRAFT 2's transform, exercised as BEHAVIOUR (CONTRACT.md §13.1).
 *
 * `study-surface.test.ts` already guards this graft from the CSS side and by
 * reading `plugins/rehype-plates.mjs` as text — it proves the plugin *says*
 * `tree.children`, `isMermaid`, `atl-plate__no`. What nothing proved until now is
 * what the plugin *does* to a tree, and every failure mode of this pass is silent:
 *
 *  1. A WRONG CLASS NAME. The bleed that survives the figure wrap is
 *     `.atl .prose > figure.atl-plate` in AtlasFoundation.astro. Rename the
 *     wrapper here and the frozen `.prose > pre, .prose > table` rule in
 *     global.css no longer matches either, so a wide code block silently narrows
 *     to the reading measure with no error and no failing test.
 *  2. A PLATED DIAGRAM. `pre.mermaid` has its own width rule keyed on a BARE
 *     `pre` (asserted in `study-css.test.ts`), and mermaid is a raw node during
 *     this pass on the real pipeline — so a guard that stops working would only
 *     show up as narrower diagrams.
 *  3. A NON-ROOT WRAP. `visit()` instead of a `tree.children` walk would plate a
 *     fence inside a callout: numbered "Plate 07" in the middle of an inset, and
 *     given the bleed, hanging out of its own panel.
 *  4. NUMBERING. Plates are numbered per document. A counter that leaks between
 *     documents shows up as "Plate 43" on page two of a domain.
 *
 * The tree fixtures are hast, shaped the way @astrojs/markdown-remark hands the
 * pass its input: Shiki has already run (hence `data-language` on the `pre`), so
 * these are the real property names, not invented ones.
 */
import { describe, it, expect } from "vitest";
import rehypePlates from "../../plugins/rehype-plates.mjs";

// --- hast helpers ----------------------------------------------------------

type Node = Record<string, any>;

const el = (tagName: string, properties: Node = {}, children: Node[] = []): Node => ({
  type: "element",
  tagName,
  properties,
  children,
});

const text = (value: string): Node => ({ type: "text", value });

/** A Shiki-highlighted fence: the language lands on BOTH the pre and the code. */
const fence = (lang?: string): Node =>
  el(
    "pre",
    lang
      ? { className: ["astro-code"], tabindex: 0, dataLanguage: lang }
      : { className: ["astro-code"], tabindex: 0 },
    [el("code", lang ? { className: [`language-${lang}`] } : {}, [text("x")])],
  );

/** A fence Shiki skipped: no `data-language`, only the class survives. */
const unhighlighted = (lang: string): Node =>
  el("pre", {}, [el("code", { className: [`language-${lang}`] }, [text("x")])]);

const table = (): Node =>
  el("table", {}, [el("tbody", {}, [el("tr", {}, [el("td", {}, [text("cell")])])])]);

const root = (children: Node[]): Node => ({ type: "root", children });

/** Run the plugin the way unified would. */
function run(tree: Node): Node {
  rehypePlates()(tree as any);
  return tree;
}

const caption = (figure: Node): Node =>
  figure.children.find((c: Node) => c.tagName === "figcaption");

const capText = (figure: Node): string =>
  caption(figure)
    .children.map((s: Node) => s.children.map((t: Node) => t.value).join(""))
    .join(" ");

const plateNumbers = (tree: Node): string[] =>
  tree.children
    .filter((n: Node) => n.tagName === "figure")
    .map((f: Node) => capText(f));

// --- 1. the wrapper --------------------------------------------------------

describe("a root-level fence becomes a numbered plate", () => {
  const tree = run(root([el("p", {}, [text("lede")]), fence("bash")]));
  const figure = tree.children[1];

  it("wraps the pre in a figure WITHOUT moving it", () => {
    expect(figure.tagName).toBe("figure");
    expect(figure.children[0].tagName).toBe("pre");
    expect(figure.children[0].children[0].tagName).toBe("code");
  });

  it("uses the exact class the bleed rule keys on", () => {
    // `.atl .prose > figure.atl-plate` in AtlasFoundation.astro. Any other class
    // here and the code block silently loses the right-hand bleed, because the
    // frozen `.prose > pre` rule has already stopped matching.
    expect(figure.properties.className).toEqual(["atl-plate"]);
  });

  it("leaves the paragraph before it untouched", () => {
    expect(tree.children[0].tagName).toBe("p");
    expect(tree.children).toHaveLength(2);
  });

  it("captions it, and keeps the number out of the search index", () => {
    const cap = caption(figure);
    expect(cap.properties.className).toEqual(["atl-plate__cap"]);
    // The study article is the site's only `data-pagefind-body`; "Plate 02" is
    // not a searchable claim about the topic.
    expect(cap.properties["data-pagefind-ignore"]).toBe(true);
    expect(cap.children[0].properties.className).toEqual(["atl-plate__no"]);
    expect(capText(figure)).toBe("Plate 01 · bash");
  });
});

// --- 2. numbering ----------------------------------------------------------

describe("numbering", () => {
  it("is zero-padded and runs across fences AND tables in document order", () => {
    const tree = run(
      root([fence("java"), el("p", {}, [text("prose")]), table(), fence("yaml")]),
    );
    expect(plateNumbers(tree)).toEqual([
      "Plate 01 · java",
      "Plate 02",
      "Plate 03 · yaml",
    ]);
  });

  it("pads to two digits and then grows", () => {
    const tree = run(root(Array.from({ length: 11 }, () => table())));
    const nums = plateNumbers(tree);
    expect(nums[0]).toBe("Plate 01");
    expect(nums[8]).toBe("Plate 09");
    expect(nums[9]).toBe("Plate 10");
    expect(nums[10]).toBe("Plate 11");
  });

  it("restarts at 01 for the next document", () => {
    // One transformer instance per file in unified, but the counter must live
    // inside the transform, not the module — otherwise page two of a domain
    // opens on "Plate 12".
    const plugin = rehypePlates();
    const a = root([table()]);
    const b = root([table()]);
    plugin(a as any);
    plugin(b as any);
    expect(plateNumbers(a)).toEqual(["Plate 01"]);
    expect(plateNumbers(b)).toEqual(["Plate 01"]);
  });
});

// --- 3. the language word --------------------------------------------------

describe("the caption's second word is the AUTHORED language, or nothing", () => {
  it("prefers Shiki's data-language", () => {
    const tree = run(root([fence("dockerfile")]));
    expect(capText(tree.children[0])).toBe("Plate 01 · dockerfile");
  });

  it("falls back to the code element's language- class", () => {
    const tree = run(root([unhighlighted("promql")]));
    expect(capText(tree.children[0])).toBe("Plate 01 · promql");
  });

  it("reads that class list in either spelling", () => {
    // hast says `className`; a raw `class` string is what a hand-built or
    // re-parsed node carries. Both reach the same word.
    const tree = run(
      root([el("pre", {}, [el("code", { class: "language-rego" }, [text("x")])])]),
    );
    expect(capText(tree.children[0])).toBe("Plate 01 · rego");
  });

  it("says nothing for a bare fence", () => {
    const tree = run(root([el("pre", {}, [el("code", {}, [text("x")])])]));
    expect(capText(tree.children[0])).toBe("Plate 01");
    expect(caption(tree.children[0]).children).toHaveLength(1);
  });

  it("treats plaintext as no language at all", () => {
    const tree = run(root([fence("plaintext")]));
    expect(capText(tree.children[0])).toBe("Plate 01");
  });

  it("never gives a table a language word", () => {
    const tree = run(root([table()]));
    expect(caption(tree.children[0]).children).toHaveLength(1);
    expect(capText(tree.children[0])).toBe("Plate 01");
  });
});

// --- 4. what it must not touch --------------------------------------------

describe("what the pass refuses to plate", () => {
  it("leaves a mermaid pre exactly as it found it, by class or by attribute", () => {
    for (const props of [
      { className: ["mermaid"] },
      { class: "mermaid" },
      { dataMermaid: true },
      { "data-mermaid": "" },
    ]) {
      const diagram = el("pre", props, [text("graph TD")]);
      const tree = run(root([diagram]));
      // Identity, not equality: `pre.mermaid`'s width rule in the study page
      // needs it to stay a DIRECT child of `.study-prose`.
      expect(tree.children[0]).toBe(diagram);
      expect(tree.children[0].tagName).toBe("pre");
    }
  });

  it("does not spend a plate number on a diagram", () => {
    const tree = run(
      root([el("pre", { className: ["mermaid"] }, [text("graph TD")]), fence("go")]),
    );
    expect(plateNumbers(tree)).toEqual(["Plate 01 · go"]);
  });

  it("ignores a fence nested inside a callout or a table cell", () => {
    const nestedFence = fence("bash");
    const callout = el("blockquote", { className: ["callout"] }, [nestedFence]);
    const cellFence = fence("sql");
    const host = el("table", {}, [
      el("tbody", {}, [el("tr", {}, [el("td", {}, [cellFence])])]),
    ]);
    const tree = run(root([callout, host]));

    // The callout is not a plate and its inner fence is still a bare pre.
    expect(tree.children[0]).toBe(callout);
    expect(callout.children[0]).toBe(nestedFence);
    // The root-level table IS a plate, but the fence inside it is not.
    expect(tree.children[1].tagName).toBe("figure");
    expect(cellFence.tagName).toBe("pre");
    expect(plateNumbers(tree)).toEqual(["Plate 01"]);
  });

  it("passes non-element nodes through and never changes the child count", () => {
    const raw = { type: "raw", value: "<pre class=\"mermaid\">graph TD</pre>" };
    const blank = text("\n");
    const tree = run(root([raw, blank, table(), blank]));
    expect(tree.children).toHaveLength(4);
    expect(tree.children[0]).toBe(raw);
    // Mermaid reaches this pass as a RAW node on the real pipeline (rehype-raw
    // runs after the user plugins), so it must survive untouched even as a string.
    expect(tree.children[0].value).toContain("mermaid");
    expect(tree.children[2].tagName).toBe("figure");
  });

  it("touches no heading — H2s are MCQ anchor targets", () => {
    const h2 = el("h2", { id: "images-vs-containers" }, [text("Images vs containers")]);
    const tree = run(root([h2, fence("java")]));
    expect(tree.children[0]).toBe(h2);
    expect(h2.properties.id).toBe("images-vs-containers");
  });

  it("survives an empty or malformed tree without throwing", () => {
    expect(() => run(root([]))).not.toThrow();
    expect(() => rehypePlates()({} as any)).not.toThrow();
    expect(() => rehypePlates()(null as any)).not.toThrow();
  });
});
