/**
 * Barrel export for shared lib. Other agents can:
 *   import { pickN, seededShuffle, getDomain } from "@lib/index";
 *   import type { Catalog, Question } from "@lib/index";
 *
 * Note on slugify: heading anchors are produced by rehype-slug (github-slugger
 * algorithm) at Markdown render time — do NOT re-implement slugify for anchors.
 * The `ref` fields in questions.yaml already use that same algorithm, so
 * `/study/<domain>/<slug>#<anchor>` links line up automatically.
 */
export * from "./types";
export * from "./sample";
export * from "./catalog";
