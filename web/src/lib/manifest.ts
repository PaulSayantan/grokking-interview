/**
 * THE SECTION MANIFEST — the stops inside one leg, with a REAL question count.
 *
 * atlas's `/topic` page is a position page, and its last device is a manifest of
 * the sections the reader would be committing to (CONTRACT.md §13.4). The stops
 * themselves are the topic's `## H2` headings, taken from the same
 * `render(entry).headings` array the study page's TOC is built from — so the two
 * lists can never disagree, and no heading TEXT is ever re-derived here (they are
 * MCQ anchor targets; §6).
 *
 * WHY THE QUESTION COLUMN IS REAL, AND NOT DROPPED. The atlas NOTES offered two
 * options for the per-section count: tally `questions.yaml` refs in
 * `sync-content.mjs`, or drop the column. Measured over the whole corpus before
 * choosing: all 460 topics emit a pool and all 28,064 questions carry a `ref:`
 * that resolves to a heading in their own topic — 6 of them to an H3, which is why
 * `tallyStops` attributes a ref to its OWNING H2 rather than only to exact H2
 * matches. So the count is not an estimate and not a heuristic; it is the authored
 * `ref:` field, counted. Sync now emits that tally to `src/data/question-refs.json`
 * (see the long comment on `REFS_OUT` there for why it is a module under `src/`
 * and not a build-time read of `public/questions/`).
 *
 * THE DIVISION OF LABOUR IS THE POINT. Sync knows the refs but not the anchors:
 * mapping `concepts.md#foo` onto the heading that owns it needs rehype-slug's own
 * slugs, which exist only once the markdown has been rendered. So sync stays a
 * faithful projection of what was authored and this file does the mapping against
 * the real `headings`.
 *
 * Pure data + pure functions: no fs, no globals. Import from "@lib/manifest".
 */
import refsJson from "../data/question-refs.json";

/** Every authored question ref is `concepts.md#<anchor>` within its own topic. */
export const REF_PREFIX = "concepts.md#";

/** `"<domain>/<slug>" -> { "<ref>": count }`, as sync emits it. */
export type QuestionRefCounts = Record<string, Record<string, number>>;

const refs = refsJson as QuestionRefCounts;

/** The shape `render(entry).headings` yields (astro:content). */
export interface ManifestHeading {
  depth: number;
  slug: string;
  text: string;
}

export interface ManifestStop {
  /** The rehype-slug id — the same anchor "Learn more" deep links use. */
  slug: string;
  /** The heading's own text, verbatim. Never rewritten (§6). */
  text: string;
  /** Questions authored against this H2 or any H3 under it. */
  questionCount: number;
}

export interface SectionManifest {
  stops: ManifestStop[];
  /**
   * How many authored questions landed ON a stop. `0` means there is no tally for
   * this topic (or it has no H2 at all).
   */
  counted: number;
  /**
   * Authored questions the walk could NOT attribute to any stop: a ref naming an
   * anchor that matches no heading in this topic, or one that does not name this
   * topic's `concepts.md` at all. Those questions exist — the manifest simply
   * cannot say WHICH section owns them.
   */
  unattributed: number;
  /**
   * The gate the caller must use before printing a per-stop count.
   *
   * `counted > 0` is a per-TOPIC test and the honesty question is per-SECTION: one
   * stale anchor in `questions.yaml` leaves ITS OWN section on zero while the topic
   * sails through, and the manifest then prints a confident "0 q" beside a heading
   * that really has nine. So `exact` is true only when there is a tally AND every
   * question in it landed on a stop — the only state in which a printed zero is a
   * fact rather than a gap. "0 q" beside a section that has nine is the one failure
   * this whole file is built to avoid; an unknown must render as an em dash or as
   * nothing, never as a zero.
   */
  exact: boolean;
}

/** The authored ref tally for one subtopic, or `null` if sync emitted none. */
export function topicRefCounts(
  domain: string,
  slug: string,
): Record<string, number> | null {
  return refs[`${domain}/${slug}`] ?? null;
}

/**
 * Attribute every ref to its owning H2, in heading order.
 *
 * A ref may point at an H3 (six do, corpus-wide), so the walk carries the index
 * of the most recent H2 forward and maps deeper headings onto it — the same
 * "walk back to the owning section" rule `OpenQuestions.astro` uses for prompt
 * refs. Anything above an H2 (the H1 title) and any anchor matching no heading is
 * counted nowhere: inventing a home for an unresolvable ref would make the column
 * disagree with the corpus, which is worse than a column that is one short.
 *
 * Pure, and the only place the mapping rule lives.
 */
export function tallyStops(
  headings: ManifestHeading[],
  refCounts: Record<string, number>,
): SectionManifest {
  const stops: ManifestStop[] = [];
  /** anchor -> index in `stops`. */
  const owner = new Map<string, number>();

  for (const h of headings) {
    // The H1 title, and anything above an H2: not a stop, and it owns nothing.
    if (h.depth < 2) continue;
    if (h.depth === 2) {
      owner.set(h.slug, stops.length);
      stops.push({ slug: h.slug, text: h.text, questionCount: 0 });
      continue;
    }
    // Deeper: belongs to the H2 above it, if there is one.
    if (stops.length > 0) owner.set(h.slug, stops.length - 1);
  }

  let counted = 0;
  /** Every question in the tally, wherever it ended up — the completeness yardstick. */
  let authored = 0;
  for (const ref in refCounts) {
    const n = refCounts[ref];
    authored += n;
    if (!ref.startsWith(REF_PREFIX)) continue;
    const at = owner.get(ref.slice(REF_PREFIX.length));
    if (at === undefined) continue;
    stops[at].questionCount += n;
    counted += n;
  }

  const unattributed = authored - counted;
  return { stops, counted, unattributed, exact: counted > 0 && unattributed === 0 };
}

/** The manifest for one subtopic: its H2 stops, each with its real question count. */
export function sectionManifest(
  domain: string,
  slug: string,
  headings: ManifestHeading[],
): SectionManifest {
  return tallyStops(headings, topicRefCounts(domain, slug) ?? {});
}
