/**
 * Short card/row titles — the single source of truth shared by `/` and
 * `/catalog`.
 *
 * Why this file exists: the shortening logic used to live inside
 * `DomainCard.astro`, so `/catalog` (which renders through the card) and `/`
 * (which printed the raw `domain.title`) disagreed on the same domain's name —
 * "Data Structures & Algorithms" on one page, "Data Structures, Algorithms &
 * Coding Interviews" on the other. Both marketing pages now call `cardTitle()`.
 *
 * The FULL, unabridged title always shows on `/domain/<slug>` (that page
 * renders `domain.title` directly) and is kept as the `title=`/`aria-label`
 * text wherever the short form is displayed, so nothing is lost.
 *
 * Import from "@lib/domain-title".
 */

/**
 * Explicit short forms for the couple of long, bracket-less titles that the
 * parenthetical strip below cannot help with. Keyed by domain slug — slugs are
 * stable identifiers, titles are not.
 */
const CARD_TITLE_OVERRIDES: Record<string, string> = {
  "dsa-coding": "Data Structures & Algorithms",
  "lld-and-ood": "Low-Level & OO Design",
};

/**
 * Short, non-truncated card/row title:
 *  1) an explicit override if the slug has one, else
 *  2) the title with any parenthetical qualifier removed
 *     (e.g. "Java & JVM (framework-relevant)" -> "Java & JVM").
 * Everything else is already short enough and passes through unchanged.
 */
export function cardTitle(slug: string, title: string): string {
  return CARD_TITLE_OVERRIDES[slug] ?? title.replace(/\s*\([^)]*\)/g, "").trim();
}
