/**
 * Shared types for the interview-prep web app.
 *
 * These mirror the shapes produced by `scripts/sync-content.mjs`:
 *  - `Catalog`         -> src/data/catalog.json
 *  - `Question`        -> public/questions/<domain>/<slug>.json (arrays of these)
 *
 * Import from "@lib/types" (see tsconfig paths) or a relative path.
 */

/** Difficulty tiers used across questions.yaml sources. */
export type Difficulty =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "expert"
  | (string & {});

/**
 * One multiple-choice question as served in the per-topic/-domain JSON pools.
 *
 * Every pool has a `.slim.json` twin (fetched by the practice island) that omits
 * `explanation` and `tags` — hence those fields are optional. `difficulty` is
 * kept in slim pools (drives the practice difficulty filter). Explanations for
 * slim pools are served from the per-domain `_explanations.json` map
 * (`{ [questionId]: explanation }`).
 */
export interface Question {
  /** Stable unique id, e.g. "design-url-shortener-001". */
  id: string;
  /** Present in both full and slim pools (drives the practice difficulty filter). */
  difficulty?: Difficulty;
  /** Absent in `.slim.json` pools. */
  tags?: string[];
  question: string;
  /** 3-5 answer choices. */
  options: string[];
  /** 0-based index into `options`. */
  answer: number;
  /** Absent in `.slim.json` pools — look up in `_explanations.json` instead. */
  explanation?: string;
  /**
   * Optional "concepts.md#anchor" reference into the study page.
   * The practice island turns this into /study/<domain>/<topic_slug>#<anchor>.
   */
  ref?: string;
  /** Injected by sync so a standalone question knows its origin. */
  domain: string;
  /** Injected by sync — the subtopic slug this question belongs to. */
  topic_slug: string;
}

/** A subtopic entry inside a catalog group. */
export interface CatalogSubtopic {
  slug: string;
  title: string;
  questionCount: number;
  /**
   * 1-based position in the group's intended learning sequence (derived from
   * the domain README topic-table order by sync-content.mjs). Used to number
   * cards so learners know where to start and in what order to progress.
   */
  position: number;
}

/** A group of subtopics within a domain (system-design has 3; others have 1). */
export interface CatalogGroup {
  /** Stable machine key: "all" | "core" | "advanced" | "aws". */
  key: string;
  /** Human label for section headers ("" for single-group domains). */
  label: string;
  subtopics: CatalogSubtopic[];
}

/** A domain in the catalog manifest. */
export interface CatalogDomain {
  slug: string;
  title: string;
  /** false => render as a disabled "Coming soon" card (no groups/subtopics). */
  authored: boolean;
  subtopicCount: number;
  questionCount: number;
  groups: CatalogGroup[];
}

/** Root manifest — src/data/catalog.json. */
export interface Catalog {
  domains: CatalogDomain[];
}
