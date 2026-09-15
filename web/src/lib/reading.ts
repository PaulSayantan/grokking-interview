/**
 * Reading-coverage + reveal state for the study page's think-prompt rows.
 *
 * DELIBERATELY SEPARATE FROM `progress.ts`. That module is the site's record of
 * RETRIEVAL — mastery, the spaced-repetition schedule, the streak — and it is the
 * only honest evidence the learner has. Scrolling past text is not retrieval, so
 * nothing here may ever feed `computeMastery()`, `nextSchedule()` or
 * `registerPractice()`; a "read" section arms a row and nothing else. The keys are
 * distinct, the modules do not import each other, and `reading.test.ts` asserts both.
 *
 * Storage follows the `progress.ts` conventions verbatim: the `ip:` namespace, a
 * version in the key so the shape can evolve, JSON values, every accessor SSR-safe.
 *
 *   ip:read:v1     { v: 1, t: { "<domain>/<slug>": { ts, s: [sectionId, …] } } }
 *   ip:reveal:v1   { v: 1, taught?: 1, t: { "<domain>/<slug>": { ts, s: [sectionId, …] } } }
 *
 * Both are pruned to the 200 most-recently-touched topics, so a learner who works
 * through all 460 topics cannot grow an unbounded localStorage entry.
 *
 * WHAT "READ" MEANS — three signals must ALL hold for one section:
 *   1. coverage  — >= 80% of its root-level blocks have left the reading band UPWARD.
 *   2. dwell     — clamp(words x 60ms, 3s, 20s) accrued on a single 500ms tick.
 *   3. departure — the next H2 has entered the band.
 * Coverage counts only UPWARD exits, which is what stops a TOC jump PAST a section
 * from crediting it: a jumped-over section's blocks never cross the band at all.
 *
 * Dwell has four vetoes (a tick accrues nothing if any holds): the document is
 * hidden; the page is fling-scrolling faster than ~0.9 viewport-heights per tick;
 * an anchor jump armed a short suspension; or the reader has been idle 60s.
 */

export const READ_KEY = "ip:read:v1";
export const REVEAL_KEY = "ip:reveal:v1";

/** Most-recently-touched topics kept in each store. */
export const MAX_TRACKED_TOPICS = 200;

/** Fraction of a section's blocks that must have exited the band upward. */
export const COVERAGE_RATIO = 0.8;

/** Dwell target = clamp(words * PER_WORD, MIN, MAX). */
export const DWELL_PER_WORD_MS = 60;
export const DWELL_MIN_MS = 3_000;
export const DWELL_MAX_MS = 20_000;

/** One interval drives every section's dwell. */
export const TICK_MS = 500;

/** Scroll faster than this many viewport-heights per tick and the tick is void. */
export const FLING_VH_PER_TICK = 0.9;

/** An in-page anchor click / hashchange suspends accrual this long. */
export const JUMP_SUSPEND_MS = 700;

/** No scroll, pointer or key activity for this long and accrual stops. */
export const IDLE_MS = 60_000;

/** No section may be marked read within this long of `astro:page-load`. */
export const SETTLE_MS = 1_500;

/**
 * The reading band. Top edge clears the sticky header (88px); the bottom 25% is
 * excluded so a block only counts once it has genuinely passed the eye line.
 */
export const READ_BAND_MARGIN = "-88px 0px -25% 0px";

/**
 * Root-level block tags that count toward a section's coverage.
 *
 * `figure` is here for GRAFT 2 (CONTRACT.md §13.1): `plugins/rehype-plates.mjs`
 * wraps every root-level code fence and table in `<figure class="atl-plate">`, so
 * without it a code-heavy section would silently lose most of its blocks and
 * `coverageMet()` would quietly start measuring something else on all 460 topics.
 * One plate is one block, exactly as the bare `pre` / `table` was.
 */
export const BLOCK_SELECTOR = "p, ul, ol, pre, table, figure, h3, blockquote";

// --- pure signal math ------------------------------------------------------

/** Dwell a section must accrue before it can be called read. */
export function dwellTargetMs(words: number): number {
  const raw = (Number.isFinite(words) ? Math.max(0, words) : 0) * DWELL_PER_WORD_MS;
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, raw));
}

/** Have enough of a section's blocks left the band upward? */
export function coverageMet(exitedUp: number, total: number): boolean {
  if (total <= 0) return false;
  return exitedUp / total >= COVERAGE_RATIO;
}

/** A fling: more than ~0.9 viewport-heights of scroll inside one tick. */
export function isFling(scrollDeltaPx: number, viewportH: number): boolean {
  if (viewportH <= 0) return false;
  return Math.abs(scrollDeltaPx) > FLING_VH_PER_TICK * viewportH;
}

export interface DwellGate {
  /** `document.hidden`. */
  hidden: boolean;
  /** Pixels scrolled since the previous tick. */
  scrollDeltaPx: number;
  viewportH: number;
  /** epoch ms until which an anchor jump has suspended accrual. */
  suspendedUntil: number;
  /** epoch ms of the last scroll / pointer / key event. */
  lastActivity: number;
  now: number;
}

/** The four vetoes. All must be clear for a tick to accrue TICK_MS of dwell. */
export function dwellAllowed(g: DwellGate): boolean {
  if (g.hidden) return false;
  if (isFling(g.scrollDeltaPx, g.viewportH)) return false;
  if (g.now < g.suspendedUntil) return false;
  if (g.now - g.lastActivity > IDLE_MS) return false;
  return true;
}

export interface SectionSignals {
  /** Build-time word count (`data-pd-words`). */
  words: number;
  /** Root-level blocks in the section. */
  blocks: number;
  /** Blocks that have exited the band upward. */
  exitedUp: number;
  /** Dwell accrued, ms. */
  dwellMs: number;
  /** Has the next H2 entered the band? */
  departed: boolean;
}

/**
 * All three signals, plus the settle window: nothing may be marked read within
 * SETTLE_MS of page load, because a restored scroll position or a hash jump fires
 * a burst of intersection callbacks that would otherwise credit whole sections.
 */
export function sectionRead(
  s: SectionSignals,
  now: number,
  pageLoadedAt: number,
): boolean {
  if (now - pageLoadedAt < SETTLE_MS) return false;
  if (!s.departed) return false;
  if (!coverageMet(s.exitedUp, s.blocks)) return false;
  return s.dwellMs >= dwellTargetMs(s.words);
}

// --- storage ---------------------------------------------------------------

export interface TopicRecord {
  /** epoch ms this topic's record was last touched (the prune key). */
  ts: number;
  /** section ids (H2 anchor ids). */
  s: string[];
}

export interface ReadingStore {
  v: 1;
  /** Set once the one-sentence live-region hint has been spoken. */
  taught?: 1;
  t: Record<string, TopicRecord>;
}

export function emptyStore(): ReadingStore {
  return { v: 1, t: {} };
}

function canStore(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Coerce whatever is in localStorage into a valid store (never throws). */
export function normalizeStore(raw: unknown): ReadingStore {
  const out = emptyStore();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Partial<ReadingStore>;
  if (obj.taught === 1) out.taught = 1;
  const t = obj.t;
  if (!t || typeof t !== "object") return out;
  for (const key of Object.keys(t)) {
    const rec = (t as Record<string, unknown>)[key];
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Partial<TopicRecord>;
    const ids = Array.isArray(r.s) ? r.s.filter((x): x is string => typeof x === "string") : [];
    out.t[key] = { ts: typeof r.ts === "number" ? r.ts : 0, s: [...new Set(ids)] };
  }
  return out;
}

/** Keep only the `max` most-recently-touched topics. */
export function pruneStore(store: ReadingStore, max = MAX_TRACKED_TOPICS): ReadingStore {
  const keys = Object.keys(store.t);
  if (keys.length <= max) return store;
  keys.sort((a, b) => store.t[b].ts - store.t[a].ts);
  const kept: Record<string, TopicRecord> = {};
  for (const k of keys.slice(0, max)) kept[k] = store.t[k];
  return { ...store, t: kept };
}

export function readStore(key: string): ReadingStore {
  if (!canStore()) return emptyStore();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyStore();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

export function writeStore(key: string, store: ReadingStore): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(key, JSON.stringify(pruneStore(store)));
  } catch {
    /* storage full / unavailable — non-fatal, the page just forgets */
  }
}

/** Section ids recorded for one topic in one store. */
export function sectionsFor(store: ReadingStore, topicKey: string): string[] {
  return store.t[topicKey]?.s ?? [];
}

/**
 * Add section ids to a topic's record and persist. Returns the updated store.
 * Touching a topic refreshes its `ts`, which is what makes the prune LRU-correct.
 */
export function addSections(
  key: string,
  topicKey: string,
  sectionIds: string[],
  now = Date.now(),
): ReadingStore {
  const store = readStore(key);
  const prev = store.t[topicKey]?.s ?? [];
  const merged = [...new Set([...prev, ...sectionIds])];
  store.t[topicKey] = { ts: now, s: merged };
  writeStore(key, store);
  return store;
}

/** Mark the one-sentence live-region hint as already spoken (once per browser). */
export function markTaught(): void {
  const store = readStore(REVEAL_KEY);
  if (store.taught === 1) return;
  store.taught = 1;
  writeStore(REVEAL_KEY, store);
}

export function wasTaught(): boolean {
  return readStore(REVEAL_KEY).taught === 1;
}
