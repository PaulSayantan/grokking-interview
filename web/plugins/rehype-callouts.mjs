import { visit } from "unist-util-visit";

// The ONLY 4 supported types. slug -> class/data value; label -> visible text.
const CALLOUTS = {
  TIP: { slug: "tip", label: "Tip" },
  WARNING: { slug: "warning", label: "Warning" },
  INTERVIEW: { slug: "interview", label: "Interview" },
  "KEY-TAKEAWAY": { slug: "key-takeaway", label: "Key takeaway" },
};
// Matches the leading marker in the blockquote's first text node, e.g. "[!TIP]".
const MARKER = /^\[!(TIP|WARNING|INTERVIEW|KEY-TAKEAWAY)\]\s*/;

/** rehype plugin: GitHub-alert-style callouts limited to 4 custom types. */
export default function rehypeCallouts() {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "blockquote") return;
      const firstP = node.children.find(
        (c) => c.type === "element" && c.tagName === "p",
      );
      if (!firstP) return;
      const firstText = firstP.children[0];
      if (!firstText || firstText.type !== "text") return;
      const m = firstText.value.match(MARKER);
      if (!m) return;
      const meta = CALLOUTS[m[1]];

      // Strip "[!TYPE]" from the first paragraph. In "> [!TIP]\n> body" the
      // label sits in its own text node followed by a soft-break <br>; drop
      // the emptied text node and any leading break/whitespace left behind.
      firstText.value = firstText.value.slice(m[0].length);
      if (firstText.value === "") {
        firstP.children.shift();
        while (
          firstP.children[0] &&
          ((firstP.children[0].type === "element" &&
            firstP.children[0].tagName === "br") ||
            (firstP.children[0].type === "text" &&
              firstP.children[0].value.trim() === ""))
        ) {
          firstP.children.shift();
        }
      }

      node.properties = node.properties || {};
      node.properties.className = ["callout", `callout--${meta.slug}`];
      node.properties["data-callout"] = meta.slug;

      node.children.unshift({
        type: "element",
        tagName: "div",
        properties: { className: ["callout-title"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["callout-icon"], "aria-hidden": "true" },
            children: [],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["callout-label"] },
            children: [{ type: "text", value: meta.label }],
          },
        ],
      });
    });
  };
}
