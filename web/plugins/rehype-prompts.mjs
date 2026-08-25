/**
 * rehype-prompts — injects the clarity effort's think-prompt rows into the
 * rendered `concepts.md` HTML at BUILD time.
 *
 * WHY BUILD TIME, AND WHY THIS PLUGIN OWNS THE MARKUP
 * ---------------------------------------------------
 * The no-JS contract inverts the usual disclosure pattern: the static HTML ships
 * every row OPEN, and JS only ever *removes* content (a CSS collapse gated on the
 * `data-pd="on"` flag). That rules out a client-side injection, and it also rules
 * out the "plugin drops an anchor point, the Astro page fills it" split: `<Content />`
 * renders to an HTML string, so an Astro component cannot reach inside it. The only
 * ways to fill a placeholder are a client-side move (breaks no-JS) or string surgery
 * on rendered HTML (fragile). So this plugin emits the finished markup.
 *
 * Prompt bodies are authored MARKDOWN (they contain code spans and emphasis), so
 * each one is run through a nested unified pipeline — remark-parse + remark-gfm +
 * remark-rehype — and spliced in as real hast. `renderPromptMarkdown()` is exported
 * for the two Astro components (OpenQuestions / Cliffhanger) that render the same
 * authored strings outside the markdown pipeline, so there is exactly one renderer.
 *
 * ONE ROW PER H2 SECTION
 * ----------------------
 * `prompts.yaml` allows at most one prompt per anchor, but an anchor may be an H3
 * seam inside a section. A row per *anchor* would therefore stamp several hairlines
 * on one section, and the permanent-ink budget is one hairline plus one muted line
 * PER SECTION. So a row collects every prompt whose ref anchor lives inside the H2
 * section, in document order, and sits at the section's end. That is also why the
 * label can read "2 open questions".
 *
 * SECTION BOUNDARIES WITHOUT SENTINELS
 * ------------------------------------
 * `h2`/`h3` are siblings of the blocks they head, not wrappers, so a section is the
 * run of root-level children from an `h2` up to the next heading of depth <= 2. The
 * row is inserted at that boundary, walking BACK over any trailing `<hr>` (and the
 * whitespace text nodes around it) so a rule that separates two sections keeps
 * separating them and the row stays inside the section it belongs to.
 *
 * The `h2` is also stamped with `data-pd-words` (a build-time word count for the
 * section) so the client's dwell timer never has to measure text.
 *
 * Contract for the client + CSS: see the "Reveal UI" section of web/CONTRACT.md.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { toHtml } from "hast-util-to-html";

// --- tiny hast builders ----------------------------------------------------

function h(tagName, properties, children = []) {
  return { type: "element", tagName, properties: properties || {}, children };
}
function t(value) {
  return { type: "text", value };
}

// --- authored Markdown -> hast --------------------------------------------

// No async plugins, so `runSync` is safe. Reused across every prompt on every
// page: building this once keeps 460 pages x 14 prompts cheap.
const mdProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

/** Authored Markdown -> hast children (block level: <p>, <pre>, <ul>, ...). */
export function promptMarkdownToHast(md) {
  const src = String(md ?? "").trim();
  if (!src) return [];
  const hast = mdProcessor.runSync(mdProcessor.parse(src));
  return hast.children || [];
}

/**
 * Authored Markdown -> HTML string, for the Astro components that render prompt
 * text outside the markdown pipeline. Same renderer as the in-prose rows, so a
 * code span looks identical in both places.
 */
export function renderPromptMarkdown(md) {
  const children = promptMarkdownToHast(md);
  if (!children.length) return "";
  return toHtml({ type: "root", children });
}

/**
 * Same renderer, unwrapped to INLINE html, for a string that goes inside an element
 * that already owns its own block box — a cliffhanger teaser inside an `<li>`.
 *
 * Without this the teasers were interpolated as plain text, so authored code spans
 * rendered as literal backticks three lines under a hook where the same spans rendered
 * as chips. Neither `astro check`, the test suite nor the build can see that: the
 * markup is valid and the types are right, the page is just wrong. It was caught by
 * looking at a screenshot.
 *
 * Only a lone top-level paragraph is unwrapped. Anything else (a list, a fence, two
 * paragraphs) is returned as blocks, because those need their own boxes — a teaser
 * should never be that shape, and silently flattening one would lose content.
 */
export function renderPromptInline(md) {
  const children = promptMarkdownToHast(md);
  if (!children.length) return "";
  if (children.length === 1 && children[0].type === "element" && children[0].tagName === "p") {
    return toHtml({ type: "root", children: children[0].children });
  }
  return toHtml({ type: "root", children });
}

// --- helpers ---------------------------------------------------------------

const HEADING = /^h([1-6])$/;

function isElement(node) {
  return !!node && node.type === "element";
}
function isBlank(node) {
  return !!node && node.type === "text" && node.value.trim() === "";
}

/** Words in a subtree's text nodes (build-time input to the dwell clamp). */
function countWords(node, acc = { n: 0 }) {
  if (!node) return acc.n;
  if (node.type === "text") {
    const m = node.value.trim();
    if (m) acc.n += m.split(/\s+/).length;
  }
  for (const c of node.children || []) countWords(c, acc);
  return acc.n;
}

/** `concepts.md#anchor` (or a bare `#anchor`) -> `anchor`. */
function anchorOf(ref) {
  const m = String(ref ?? "").match(/#(.+)$/);
  return m ? m[1] : null;
}

/**
 * The reveal affordance for one prompt, by closure tier:
 *   A / B — the answer is in this file or another topic: a deep link, never the answer.
 *   C     — a primary-source hunt: the mandatory success_criterion is what bounds it.
 *   D     — genuinely open: the mandatory answer_shape is what stops it abandoning the reader.
 * Everything else (hint, search_hint) rides inside the same single <details>, so a
 * prompt never grows more than one disclosure control.
 */
function detailsFor(p) {
  const parts = [];
  if (p.hint) parts.push({ label: null, md: p.hint });
  if (p.tier === "C") {
    if (p.success_criterion) parts.push({ label: null, md: p.success_criterion });
    if (p.search_hint) parts.push({ label: "Where to look", md: p.search_hint });
  }
  if (p.tier === "D" && p.answer_shape) parts.push({ label: null, md: p.answer_shape });
  if (!parts.length) return null;

  const summary =
    p.tier === "C"
      ? "How you'll know you have it"
      : p.tier === "D"
        ? "What a good answer prices"
        : "Hint";

  const body = [];
  for (const part of parts) {
    if (part.label) {
      body.push(h("p", { className: ["pd-q__label"] }, [t(part.label)]));
    }
    body.push(...promptMarkdownToHast(part.md));
  }
  return h("details", { className: ["pd-q__more"] }, [
    h("summary", {}, [t(summary)]),
    h("div", { className: ["pd-q__more-body"] }, body),
  ]);
}

/** One prompt as an <li>. `id` is the stable reveal/deep-link target. */
export function promptItemNode(p) {
  const children = [
    h("div", { className: ["pd-q__prompt"] }, promptMarkdownToHast(p.prompt)),
  ];
  const more = detailsFor(p);
  if (more) children.push(more);
  // Tier A/B close with a deep link — "where this gets answered", not the answer.
  if ((p.tier === "A" || p.tier === "B") && p.answerHref) {
    children.push(
      h("p", { className: ["pd-q__closure"] }, [
        h("a", { href: p.answerHref, className: ["pd-q__link"] }, [
          t("Where this gets answered"),
          h("span", { "aria-hidden": "true" }, [t(" →")]),
        ]),
      ]),
    );
  }
  return h("li", { className: ["pd-q"], id: `pd-${p.id}` }, children);
}

/**
 * One section's row. Three interchangeable lines ship in the HTML and CSS shows
 * exactly one; all three carry `.pd-line`, so every state has byte-identical box
 * metrics and arming can cost no layout shift:
 *   .pd-line--static  no JS at all — the body is already open, so it is a caption
 *   .pd-line--locked  JS on, section unread — a muted note, deliberately NOT a button
 *   .pd-line--armed   JS on, section read — a real button, accessible name = the label
 */
function rowNode(sectionId, prompts) {
  const n = prompts.length;
  const label = `${n} open question${n === 1 ? "" : "s"}`;
  const glyph = () => h("span", { className: ["pd-glyph"], "aria-hidden": "true" }, []);

  return h(
    "div",
    {
      className: ["pd-row"],
      "data-pd-row": "",
      "data-pd-sec": sectionId,
      "data-pd-state": "locked",
      "data-pd-count": String(n),
      "data-pagefind-ignore": "",
    },
    [
      h("span", { className: ["pd-line", "pd-line--static"] }, [
        glyph(),
        h("span", { className: ["pd-label"] }, [t(label)]),
      ]),
      h("span", { className: ["pd-line", "pd-line--locked"] }, [
        glyph(),
        h("span", { className: ["pd-label"] }, [t(`${label} · keep reading`)]),
      ]),
      h(
        "button",
        {
          type: "button",
          className: ["pd-line", "pd-line--armed"],
          "data-pd-toggle": "",
          "aria-expanded": "false",
        },
        [glyph(), h("span", { className: ["pd-label"] }, [t(label)])],
      ),
      h("div", { className: ["pd-body"], "data-pd-body": "" }, [
        h("ol", { className: ["pd-list"] }, prompts.map(promptItemNode)),
      ]),
    ],
  );
}

// --- the plugin ------------------------------------------------------------

export default function rehypePrompts() {
  return (tree, file) => {
    const sidecar = file?.data?.astro?.frontmatter?.prompts;
    const items = sidecar && Array.isArray(sidecar.items) ? sidecar.items : [];
    if (!items.length) return;

    const kids = tree.children;

    // Root-level headings, in document order.
    const headings = [];
    kids.forEach((node, i) => {
      if (!isElement(node)) return;
      const m = HEADING.exec(node.tagName);
      if (!m) return;
      headings.push({ i, depth: Number(m[1]), id: node.properties?.id, node });
    });

    // anchor id -> its position in `headings`.
    const byAnchor = new Map();
    headings.forEach((hd, k) => {
      if (hd.id && !byAnchor.has(hd.id)) byAnchor.set(hd.id, k);
    });

    // H2 sections: [startHeadingIndex, endChildIndex).
    const sections = new Map(); // h2 id -> { start, end, prompts: [] }
    headings.forEach((hd, k) => {
      if (hd.depth !== 2 || !hd.id) return;
      let end = kids.length;
      for (let j = k + 1; j < headings.length; j++) {
        if (headings[j].depth <= 2) {
          end = headings[j].i;
          break;
        }
      }
      sections.set(hd.id, { start: hd.i, end, headingIndex: k, node: hd.node, prompts: [] });
    });

    // Assign each prompt to the H2 section that CONTAINS its ref anchor (the
    // anchor may be an H3 seam). Unresolvable anchors are dropped from the prose;
    // the dangling ref is scripts/validate_content.py's job to report, not ours.
    // OpenQuestions.astro ships such a prompt already-open in the end-of-topic
    // panel, because no prose row exists that could ever unlock it.
    for (const p of items) {
      const anchor = anchorOf(p.ref);
      if (!anchor || !byAnchor.has(anchor)) continue;
      let k = byAnchor.get(anchor);
      while (k >= 0 && headings[k].depth !== 2) k--;
      if (k < 0) continue;
      const owner = sections.get(headings[k].id);
      if (owner) owner.prompts.push(p);
    }

    // Stamp the build-time word count on every section heading (cheap, and the
    // client's dwell clamp must never measure text itself).
    for (const sec of sections.values()) {
      let words = 0;
      for (let j = sec.start; j < sec.end; j++) words += countWords(kids[j]);
      sec.node.properties = sec.node.properties || {};
      sec.node.properties["data-pd-words"] = String(words);
    }

    // Insert rows back-to-front so earlier insertion points keep their indices.
    const pending = [...sections.entries()]
      .filter(([, sec]) => sec.prompts.length > 0)
      .sort((a, b) => b[1].end - a[1].end);

    for (const [id, sec] of pending) {
      let at = sec.end;
      // Keep a section-separating <hr> below the row, not above it.
      while (at - 1 > sec.start && (isBlank(kids[at - 1]) || isHr(kids[at - 1]))) at--;
      kids.splice(at, 0, rowNode(id, sec.prompts), t("\n"));
    }
  };
}

function isHr(node) {
  return isElement(node) && node.tagName === "hr";
}
