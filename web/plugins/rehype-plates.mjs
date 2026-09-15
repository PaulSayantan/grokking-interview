/**
 * rehype-plates — GRAFT 2's markup half: a root-level code fence or table becomes
 * a NUMBERED PLATE (CONTRACT.md §13.1, §13.5).
 *
 * `<pre>`  ->  `<figure class="atl-plate"><pre>…</pre><figcaption>Plate 01 · bash</figcaption></figure>`
 *
 * The CSS lives in AtlasFoundation.astro, which already carries the whole
 * `.atl .prose > figure.atl-plate` recipe; this pass only supplies the wrapper it
 * describes.
 *
 * THE HAZARD THIS PLUGIN IS BUILT AROUND (§13.1, and `atlas-css.test.ts` asserts
 * both halves). global.css carries `.prose > pre, .prose > table { width: max(…) }`
 * and `study-css.test.ts` asserts that selector by EXACT STRING MATCH. Wrapping a
 * `pre` stops `.prose > pre` matching, so the right-hand bleed would die silently —
 * no error, no visual alarm, just narrower code. The fix is NOT to touch global.css
 * or that selector list: the foundation gives `figure.atl-plate` its own >=1024px
 * rule with the same `--measure-wide` floor and the same `calc(100% + var(--prose-bleed))`
 * cap. Anything here that changes the wrapper's class or nesting has to move that
 * rule with it.
 *
 * FOUR THINGS IT DELIBERATELY DOES NOT TOUCH.
 *  1. ROOT LEVEL ONLY. It walks `tree.children`, never `visit()`, so a `pre` inside
 *     a callout or a `<td>` is left alone: only a root-level block is a figure in
 *     the reader's sense, and only a root-level block gets the bleed.
 *  2. MERMAID. `plugins/rehype-mermaid.mjs` emits `<pre class="mermaid" data-mermaid>`
 *     as RAW HTML, and `rehype-raw` runs AFTER the user rehype plugins, so a diagram
 *     is still a `raw` node here and is invisible to this pass. The className/attribute
 *     guard below is the belt to that braces — the study page's own `pre.mermaid`
 *     width rule (which `study-css.test.ts` asserts) depends on a diagram staying a
 *     direct child of `.study-prose`.
 *  3. HEADING TEXT. Nothing here reads or writes a heading; `## H2` anchors are MCQ
 *     targets (§6).
 *  4. THE SECTION WALK. The reveal client derives sections from `prose.children` and
 *     counts blocks with `BLOCK_SELECTOR` (`@lib/reading`), so `figure` is in that
 *     list — otherwise every code-heavy section would silently lose its blocks and
 *     the read detector's coverage test would change meaning on all 460 topics.
 *
 * Shiki runs BEFORE the user rehype plugins in @astrojs/markdown-remark, so the
 * language is read from the `data-language` Shiki already emitted (`langAlias` is
 * applied after this value is set, so it is the AUTHORED fence language). The
 * `code`'s `language-*` class is the fallback for anything Shiki skipped.
 */

/** Shiki's own attribute, then the pre-highlight class, then nothing. */
function languageOf(node) {
  const props = node.properties || {};
  const attr = props.dataLanguage ?? props["data-language"];
  if (typeof attr === "string" && attr && attr !== "plaintext") return attr;
  const code = (node.children || []).find(
    (c) => c.type === "element" && c.tagName === "code",
  );
  for (const c of classList(code?.properties || {})) {
    if (typeof c === "string" && c.startsWith("language-")) {
      const lang = c.slice("language-".length);
      if (lang && lang !== "plaintext") return lang;
    }
  }
  return null;
}

/** Every spelling a class list arrives in: hast's `className`, or a raw `class`. */
function classList(props) {
  const out = [];
  for (const cls of [props.className, props.class]) {
    if (Array.isArray(cls)) out.push(...cls);
    else if (typeof cls === "string") out.push(...cls.split(/\s+/));
  }
  return out;
}

/**
 * A diagram is not a plate: it keeps its own width rule as a bare `pre`.
 *
 * BOTH class spellings are read on purpose. A parsed hast tree only ever carries
 * `className`, but this guard is the braces to the belt described in the header —
 * the belt being that mermaid is still a `raw` node during this pass — and a
 * defence that only works for one spelling of the same attribute is not a defence.
 * Getting it wrong is silent: a plated diagram stops matching the `pre.mermaid`
 * width rule that `study-css.test.ts` freezes, and just renders narrow.
 */
function isMermaid(node) {
  const props = node.properties || {};
  if ("dataMermaid" in props || "data-mermaid" in props) return true;
  return classList(props).includes("mermaid");
}

const pad = (n) => String(n).padStart(2, "0");

/** rehype plugin: number the root-level code fences and tables as plates. */
export default function rehypePlates() {
  return (tree) => {
    if (!tree || !Array.isArray(tree.children)) return;
    let n = 0;
    tree.children = tree.children.map((node) => {
      if (node.type !== "element") return node;
      const isPre = node.tagName === "pre";
      const isTable = node.tagName === "table";
      if (!isPre && !isTable) return node;
      if (isPre && isMermaid(node)) return node;

      n += 1;
      const lang = isPre ? languageOf(node) : null;
      const caption = [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["atl-plate__no"] },
          children: [{ type: "text", value: `Plate ${pad(n)}` }],
        },
      ];
      // A table's own header row already says what it is; only code carries a
      // second word, and only when the fence declared one.
      if (lang) {
        caption.push({
          type: "element",
          tagName: "span",
          properties: { className: ["atl-plate__kind"] },
          children: [{ type: "text", value: `· ${lang}` }],
        });
      }

      return {
        type: "element",
        tagName: "figure",
        properties: { className: ["atl-plate"] },
        children: [
          node,
          {
            type: "element",
            tagName: "figcaption",
            properties: {
              className: ["atl-plate__cap"],
              // The study article is the site's only `data-pagefind-body`; a plate
              // number is not a searchable claim about the topic.
              "data-pagefind-ignore": true,
            },
            children: caption,
          },
        ],
      };
    });
  };
}
