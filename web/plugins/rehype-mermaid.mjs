import { visit } from "unist-util-visit";

/**
 * rehype-mermaid — mark fenced ```mermaid code blocks so the client can render
 * them with mermaid.js, and STOP Astro's Shiki highlighter from touching them.
 *
 * Why this runs and how it composes with Shiki:
 *   Astro highlights fenced code with Shiki at build time. Shiki doesn't know
 *   the "mermaid" language, so it would emit the raw graph text as a plain
 *   <pre><code> — harmless, but we want to (a) tag it for the client island and
 *   (b) keep the ORIGINAL source text intact and easily extractable.
 *
 *   Astro's markdown AST gives us, for a fenced block, a `code` mdast node with
 *   `lang === "mermaid"`. We run as a REMARK plugin (mdast) BEFORE Shiki so we
 *   can grab the pristine source, and rewrite the node into an HTML node holding
 *   a <pre class="mermaid" data-mermaid> element whose text content is the graph
 *   definition. Shiki never sees a `code` node, so it leaves us alone.
 *
 * Client contract: the study page's island selects `pre.mermaid[data-mermaid]`,
 * reads textContent as the diagram source, lazy-loads mermaid, and renders.
 * If JS is off or mermaid fails to load, the raw definition is still shown as
 * preformatted text (graceful degradation) — never a blank box.
 */

/** Minimal HTML escaping for text placed inside <pre>. */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** remark plugin (operates on the mdast, before Shiki highlights code). */
export default function remarkMermaid() {
  return (tree) => {
    visit(tree, "code", (node) => {
      if (node.lang !== "mermaid") return;
      const src = node.value || "";
      // Replace the code node with a raw HTML node Shiki won't process.
      node.type = "html";
      node.value =
        `<pre class="mermaid" data-mermaid>${escapeHtml(src)}</pre>`;
      delete node.lang;
      delete node.meta;
    });
  };
}
