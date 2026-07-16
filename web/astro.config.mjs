import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import preact from "@astrojs/preact";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import remarkGfm from "remark-gfm";

// Static site (output: "static" is the Astro default — no SSR adapter).
// `site` is used for canonical URLs / sitemaps; override via env for prod.
// `base` is left at "/" so it deploys cleanly at a domain root on Netlify/Vercel.
export default defineConfig({
  site: process.env.SITE_URL || "https://interview-prep.example.com",
  output: "static",
  integrations: [
    tailwind({ applyBaseStyles: false }),
    preact(),
  ],
  markdown: {
    // GFM (tables in comparison sections) is enabled by default in Astro; we add
    // remark-gfm explicitly so the pipeline is unambiguous and portable.
    remarkPlugins: [remarkGfm],
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
    ],
    // Shiki is Astro's built-in syntax highlighter.
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
  },
});
