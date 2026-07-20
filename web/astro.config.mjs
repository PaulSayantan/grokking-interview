import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import preact from "@astrojs/preact";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import remarkGfm from "remark-gfm";
import rehypeCallouts from "./plugins/rehype-callouts.mjs";
import remarkMermaid from "./plugins/rehype-mermaid.mjs";

// Static site (output: "static" is the Astro default — no SSR adapter).
// `site` is used for canonical URLs / sitemaps; override via env for prod.
// `base` is left at "/" so it deploys cleanly at a domain root on Netlify/Vercel.
export default defineConfig({
  site: process.env.SITE_URL || "https://interviewgod.io",
  output: "static",
  integrations: [
    tailwind({ applyBaseStyles: false }),
    // `compat: true` aliases react/react-dom -> preact/compat so any library
    // that imports from "react" resolves against Preact.
    preact({ compat: true }),
  ],
  markdown: {
    // GFM (tables in comparison sections) is enabled by default in Astro; we add
    // remark-gfm explicitly so the pipeline is unambiguous and portable.
    // remarkMermaid rewrites ```mermaid code nodes into raw <pre class="mermaid">
    // HTML BEFORE Shiki runs, so Shiki never tries to highlight the graph source.
    remarkPlugins: [remarkGfm, remarkMermaid],
    // rehype-slug generates github-slugger-compatible ids on headings so that
    // `concepts.md#some-heading` refs line up with in-page anchors.
    // rehype-autolink-headings wraps each heading in an anchor affordance.
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: "wrap",
          properties: { className: ["heading-anchor"] },
        },
      ],
      // Turns "> [!TIP]" GitHub-alert blockquotes into styled callout boxes.
      rehypeCallouts,
    ],
    // Shiki is Astro's built-in syntax highlighter.
    // `defaultColor: false` disables inline color styles entirely — Shiki
    // emits only `--shiki-light` / `--shiki-dark` / `--shiki-light-bg` /
    // `--shiki-dark-bg` CSS vars on each token. Our stylesheet reads whichever
    // pair matches the site's `[data-theme]`, so the site's toggle drives the
    // code theme (not the OS `prefers-color-scheme`), and first paint matches
    // the toggle state with no flicker.
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
      wrap: true,
      // Some content uses fenced-block languages Shiki has no grammar for
      // (PromQL, LogQL, Rego). Aliasing them to a loaded language silences the
      // "language doesn't exist, falling back to plaintext" build warnings while
      // keeping the descriptive ```promql etc. labels in the markdown source.
      // `bash`/`yaml` give sensible token coloring for these query/policy langs.
      langAlias: {
        promql: "yaml",
        logql: "yaml",
        rego: "bash",
      },
    },
  },
});
