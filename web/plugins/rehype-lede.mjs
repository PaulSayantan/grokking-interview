/**
 * rehype-lede — marks the tier structure the clarity rewrite writes into the prose,
 * so a layered section READS as layered without a second colour, a second measure,
 * or any authored markup.
 *
 * Two marks, both additive:
 *
 *  1. `.pd-lede` on each section's FIRST root-level paragraph (and on the file's
 *     opener, before the first H2). Tier 1 is "the case": the same colour and the
 *     same measure as everything else, one notch larger with tighter leading. CSS
 *     owns those numbers; this plugin only says which paragraph it is.
 *
 *  2. `.pd-seam` on a tier-3 seam heading — an `### H3` whose text opens with the
 *     clarity standard's seam vocabulary ("Where it breaks: …", "What it costs: …").
 *     The authored prefix is lifted into a `.pd-seam__eyebrow` span and the rest of
 *     the heading stays as the heading. That eyebrow is therefore the AUTHOR's own
 *     words, not an invented "Advanced" / "Deep dive" label — the clarity standard
 *     bans audience labels outright, and an invented one would also rot.
 *
 * WHY A PREFIX ALLOWLIST, NOT "ANY H3 WITH A COLON": the corpus has 335 H3s, 67 of
 * them with a colon, and almost all of those are "Worked example: …" / "Worked trace:
 * …" — content, not seams. The allowlist matches zero of the 460 currently-authored
 * topics (verified) and lights up only on clarity-rewritten sections. An unrecognised
 * seam degrades to a plain H3, which is exactly what it is today.
 *
 * BOTH PASSES ARE GATED ON THE SIDECAR. The seam allowlist is a natural no-op on
 * un-migrated content, but a lede is just a `<p>` — every file has one, so an ungated
 * lede pass enlarged 7,246 paragraphs across all 460 topics and silently restyled the
 * whole site. Tiering only carries meaning on a file that has been through a clarity
 * pass, so `frontmatter.prompts` is the gate for both passes.
 *
 * HEADING IDS ARE NEVER TOUCHED. rehype-slug has already run, and six live MCQ refs
 * target H3 anchors; splitting the visible text leaves `id` (and therefore every
 * deep link) byte-identical.
 */
import { visit } from "unist-util-visit";

/**
 * The clarity standard's seam vocabulary (SKILL.md rule S1). It is documented as a
 * PREFIX, not a fixed string — "Where it breaks: what the keyword does not reach" —
 * so each entry matches case-insensitively up to the colon.
 */
export const SEAM_PREFIXES = [
  "where it breaks",
  "what it costs",
  "tuning it",
  "the version-specific truth",
  "why the simple version is wrong",
];

const HEADING = /^h([1-6])$/;

function isElement(node) {
  return !!node && node.type === "element";
}

/** First text node in a subtree, plus the parent that owns it. */
function firstText(node) {
  for (const child of node.children || []) {
    if (child.type === "text" && child.value.trim() !== "") {
      return { parent: node, index: node.children.indexOf(child), text: child };
    }
    if (isElement(child)) {
      const found = firstText(child);
      if (found) return found;
    }
  }
  return null;
}

/** `"Where it breaks: what X"` -> `{ eyebrow, rest }`, or null when not a seam. */
export function splitSeam(text) {
  const at = text.indexOf(":");
  if (at < 1) return null;
  const head = text.slice(0, at).trim();
  const rest = text.slice(at + 1).trim();
  if (!rest) return null;
  if (!SEAM_PREFIXES.includes(head.toLowerCase())) return null;
  return { eyebrow: head, rest };
}

export default function rehypeLede() {
  return (tree, file) => {
    const kids = tree.children;

    // Gate the lede pass on the prompts sidecar, exactly as rehype-prompts does
    // (see rehype-prompts.mjs:223). Without this the tier-1 mark lands on every
    // H2 section of all 460 topics — 7,246 enlarged paragraphs — because a lede
    // is a plain `<p>` that every file has. The tiering only means something on a
    // file that has actually been through a clarity pass, and the seam pass below
    // is already a no-op on un-migrated content (it matches zero authored files).
    const migrated = Boolean(file?.data?.astro?.frontmatter?.prompts);

    // --- 1. the first paragraph of every region ----------------------------
    // A region runs from the start of the file (or from an H2) up to the next
    // heading. Stopping at ANY heading keeps the lede inside Beat 1: the first
    // paragraph after an H3 seam is tier-3 prose, not a lede.
    let armed = migrated; // "still looking for this region's first paragraph"
    for (const node of kids) {
      if (!migrated) break;
      if (!isElement(node)) continue;
      const m = HEADING.exec(node.tagName);
      if (m) {
        armed = Number(m[1]) <= 2;
        continue;
      }
      if (!armed) continue;
      if (node.tagName === "p") {
        node.properties = node.properties || {};
        const cls = node.properties.className;
        node.properties.className = Array.isArray(cls) ? [...cls, "pd-lede"] : ["pd-lede"];
        armed = false;
      }
      // Anything else (a callout, a table, a diagram) is skipped over: the lede
      // is the first PARAGRAPH of the region, wherever in the region it lands.
    }

    // --- 2. tier-3 seams ---------------------------------------------------
    visit(tree, "element", (node) => {
      if (node.tagName !== "h3") return;
      const found = firstText(node);
      if (!found) return;
      const split = splitSeam(found.text.value);
      if (!split) return;

      node.properties = node.properties || {};
      const cls = node.properties.className;
      node.properties.className = Array.isArray(cls) ? [...cls, "pd-seam"] : ["pd-seam"];

      // Replace the single text node with eyebrow + remainder. The heading `id`
      // lives on the h3 and is untouched, so anchors and MCQ refs still resolve.
      found.parent.children.splice(found.index, 1, {
        type: "element",
        tagName: "span",
        properties: { className: ["pd-seam__eyebrow"] },
        children: [{ type: "text", value: split.eyebrow }],
      }, {
        type: "element",
        tagName: "span",
        properties: { className: ["pd-seam__rest"] },
        children: [{ type: "text", value: split.rest }],
      });
    });
  };
}
