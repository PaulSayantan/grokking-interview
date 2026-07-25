/**
 * Shared learner-progress layer (localStorage only — no backend).
 *
 * This is the single source of truth for the Phase 3 "habit loop" features:
 *   - Mastery grid / progress page   (reads per-subtopic accuracy)
 *   - Streak counter                 (reads/writes daily-practice streak)
 *   - Review-missed pool             (reads per-question wrong/right history)
 *
 * Both the Preact practice island (which WRITES as the learner answers) and the
 * static Astro pages (which READ to render grids, badges, and the header pill)
 * import from here. All functions are SSR-safe: they no-op / return fallbacks
 * when `localStorage` is unavailable (server render, private mode, etc.), so
 * callers can invoke them unconditionally.
 *
 * Storage keys (all under the `ip:` namespace, versioned so the shape can evolve):
 *   ip:practice:v1:<poolUrl>   per-pool session stats  (owned by PracticeSession)
 *   ip:answers:v1              { [questionId]: AnswerRecord }  per-question history
 *   ip:streak:v1               StreakRecord
 *
 * Dates are stored as YYYY-MM-DD strings in LOCAL time (a "practice day" is the
 * learner's calendar day, not UTC) so streak math matches what the user sees.
 */

export const ANSWERS_KEY = "ip:answers:v1";
export const STREAK_KEY = "ip:streak:v1";
/** Prefix for per-pool session stats written by PracticeSession. */
export const PRACTICE_KEY_PREFIX = "ip:practice:v1:";
/** Local YYYY-MM-DD of the learner's previous visit (welcome-back warm-up). */
export const LASTVISIT_KEY = "ip:lastvisit:v1";

/** How many missed days a streak tolerates before it resets (grace/"freeze"). */
export const STREAK_GRACE_DAYS = 1;

/** Mastery tiers derived from a subtopic's best accuracy. */
export type MasteryLevel = "none" | "attempted" | "familiar" | "mastered";

/**
 * One question's latest outcome + spaced-repetition schedule.
 *
 * SRS fields (interval/due/reps/lapses) are OPTIONAL so records written by the
 * pre-SRS build still load: readers default them (see `srsOf`). `recordAnswers`
 * backfills them on the next answer, so the schema migrates lazily with no
 * destructive rewrite of existing localStorage.
 */
export interface AnswerRecord {
  /** Most recent answer correct? Drives the review-missed pool. */
  correct: boolean;
  /** Domain + subtopic so pages can aggregate without a separate lookup. */
  domain: string;
  topic_slug: string;
  /** epoch ms of the last time this question was answered. */
  ts: number;
  /** SRS: current interval in days (0 before first schedule). */
  interval?: number;
  /** SRS: epoch ms when this question is next due for review. */
  due?: number;
  /** SRS: consecutive correct reviews (resets to 0 on a lapse). */
  reps?: number;
  /** SRS: total times answered wrong after being learned. */
  lapses?: number;
}

/**
 * Spaced-repetition intervals in DAYS. A correct answer advances one step; a
 * wrong answer drops back to the first step. Leitner-style, deliberately simple
 * (no ease factor) — the goal is durable recall, not exam-grade SM-2 tuning.
 */
export const SRS_INTERVALS = [1, 3, 7, 14, 30] as const;
const DAY_MS = 86_400_000;

/** SRS view of a record with all optional fields defaulted. */
export function srsOf(r: AnswerRecord): { interval: number; due: number; reps: number; lapses: number } {
  return {
    interval: r.interval ?? 0,
    // A record with no schedule yet is treated as due now (ts, or 0).
    due: r.due ?? r.ts ?? 0,
    reps: r.reps ?? 0,
    lapses: r.lapses ?? 0,
  };
}

/**
 * Given the prior schedule and whether this review was correct, compute the
 * next {interval, due, reps, lapses}. Correct: step to the next interval and
 * schedule `due = now + interval days`. Wrong: reset to the first interval,
 * `due = now + 1 day`, increment lapses.
 */
export function nextSchedule(
  prev: { interval: number; reps: number; lapses: number },
  correct: boolean,
  now: number,
): { interval: number; due: number; reps: number; lapses: number } {
  if (correct) {
    // Advance: find the current interval's position, step forward one (capped).
    const idx = SRS_INTERVALS.findIndex((d) => d >= prev.interval);
    const nextIdx = idx < 0 ? 0 : Math.min(idx + 1, SRS_INTERVALS.length - 1);
    const interval = SRS_INTERVALS[prev.interval === 0 ? 0 : nextIdx];
    return { interval, due: now + interval * DAY_MS, reps: prev.reps + 1, lapses: prev.lapses };
  }
  return { interval: SRS_INTERVALS[0], due: now + SRS_INTERVALS[0] * DAY_MS, reps: 0, lapses: prev.lapses + 1 };
}

export interface StreakRecord {
  /** Local YYYY-MM-DD of the most recent practice day. */
  lastDay: string;
  current: number;
  longest: number;
}

// --- Low-level storage helpers (SSR-safe) ---------------------------------

function canStore(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readJSON<T>(key: string, fallback: T): T {
  if (!canStore()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

// --- Date helpers ----------------------------------------------------------

/** Local calendar day as YYYY-MM-DD (NOT UTC — matches the learner's clock). */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole-day difference (b - a) between two YYYY-MM-DD strings. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((tb - ta) / 86_400_000);
}

// --- Answer history (mastery + review-missed) ------------------------------

export type AnswerMap = Record<string, AnswerRecord>;

export function readAnswers(): AnswerMap {
  return readJSON<AnswerMap>(ANSWERS_KEY, {});
}

/**
 * Record a batch of answered questions from one session. Latest outcome wins
 * (a question answered correctly this time clears its earlier "missed" state).
 */
export function recordAnswers(
  entries: { id: string; correct: boolean; domain: string; topic_slug: string }[],
): void {
  if (!entries.length) return;
  const map = readAnswers();
  const ts = Date.now();
  for (const e of entries) {
    // Advance the spaced-repetition schedule from whatever the prior record held
    // (defaults for a first-ever or pre-SRS record via srsOf).
    const prior = map[e.id];
    const prevSrs = prior ? srsOf(prior) : { interval: 0, due: 0, reps: 0, lapses: 0 };
    const sched = nextSchedule(prevSrs, e.correct, ts);
    map[e.id] = {
      correct: e.correct,
      domain: e.domain,
      topic_slug: e.topic_slug,
      ts,
      interval: sched.interval,
      due: sched.due,
      reps: sched.reps,
      lapses: sched.lapses,
    };
  }
  writeJSON(ANSWERS_KEY, map);
}

/** IDs the learner last answered INCORRECTLY (the review-missed pool). */
export function missedIds(filter?: { domain?: string; topic_slug?: string }): string[] {
  const map = readAnswers();
  const out: string[] = [];
  for (const id in map) {
    const r = map[id];
    if (r.correct) continue;
    if (filter?.domain && r.domain !== filter.domain) continue;
    if (filter?.topic_slug && r.topic_slug !== filter.topic_slug) continue;
    out.push(id);
  }
  return out;
}

/** Count of missed questions, optionally scoped to a domain / subtopic. */
export function missedCount(filter?: { domain?: string; topic_slug?: string }): number {
  return missedIds(filter).length;
}

// --- Spaced repetition: due queue --------------------------------------------

/**
 * IDs whose spaced-repetition `due` time has arrived (<= now), optionally scoped
 * to a domain / subtopic. This is the "Due today" review pool — it spans every
 * question the learner has ever answered, surfacing each when its interval elapses.
 * Sorted most-overdue first so the highest-value reviews come up first.
 */
export function dueIds(
  filter?: { domain?: string; topic_slug?: string },
  now: number = Date.now(),
): string[] {
  const map = readAnswers();
  const rows: { id: string; due: number }[] = [];
  for (const id in map) {
    const r = map[id];
    if (filter?.domain && r.domain !== filter.domain) continue;
    if (filter?.topic_slug && r.topic_slug !== filter.topic_slug) continue;
    const { due } = srsOf(r);
    if (due <= now) rows.push({ id, due });
  }
  rows.sort((a, b) => a.due - b.due); // most overdue first
  return rows.map((r) => r.id);
}

/** Count of questions currently due for spaced-repetition review. */
export function dueCount(
  filter?: { domain?: string; topic_slug?: string },
  now: number = Date.now(),
): number {
  return dueIds(filter, now).length;
}

// --- Mastery ---------------------------------------------------------------

/**
 * Per-subtopic mastery from answer history: accuracy over the questions the
 * learner has actually SEEN for that subtopic (not the full pool — you master
 * what you practice). `seen` = attempted questions, `correct` = of those, right.
 */
export interface SubtopicMastery {
  seen: number;
  correct: number;
  /** 0-100, or 0 when nothing seen. */
  pct: number;
  level: MasteryLevel;
}

/**
 * Minimum questions seen before a subtopic can be called "mastered". Guards
 * against a single lucky answer (1/1 = 100%) reading as green "mastered" — you
 * need real evidence. Below this floor a high accuracy caps at "familiar".
 */
export const MASTERY_MIN_SEEN = 5;

export function masteryLevel(pct: number, seen: number): MasteryLevel {
  if (seen === 0) return "none";
  // "Mastered" requires both high accuracy AND enough evidence to trust it.
  if (pct >= 80 && seen >= MASTERY_MIN_SEEN) return "mastered";
  if (pct >= 50) return "familiar";
  return "attempted";
}

/**
 * Compute mastery for every subtopic from the answer map, keyed by
 * "<domain>/<topic_slug>". Pages pass their catalog refs to look these up.
 */
export function computeMastery(): Record<string, SubtopicMastery> {
  const map = readAnswers();
  const acc: Record<string, { seen: number; correct: number }> = {};
  for (const id in map) {
    const r = map[id];
    const key = `${r.domain}/${r.topic_slug}`;
    const a = (acc[key] ??= { seen: 0, correct: 0 });
    a.seen += 1;
    if (r.correct) a.correct += 1;
  }
  const out: Record<string, SubtopicMastery> = {};
  for (const key in acc) {
    const { seen, correct } = acc[key];
    const pct = seen > 0 ? Math.round((correct / seen) * 100) : 0;
    out[key] = { seen, correct, pct, level: masteryLevel(pct, seen) };
  }
  return out;
}

// --- Streak ----------------------------------------------------------------

export function readStreak(): StreakRecord {
  return readJSON<StreakRecord>(STREAK_KEY, { lastDay: "", current: 0, longest: 0 });
}

/**
 * Register that the learner practiced today and return the updated streak.
 * Rules (Duolingo-style, with grace): same day = no change; within
 * STREAK_GRACE_DAYS+1 of the last day = increment; longer gap = reset to 1.
 */
export function registerPractice(today: string = localDay()): StreakRecord {
  const s = readStreak();
  if (s.lastDay === today) return s; // already counted today
  let current: number;
  if (!s.lastDay) {
    current = 1;
  } else {
    const gap = daysBetween(s.lastDay, today);
    // gap of 1 = consecutive day; up to 1+grace still continues the streak.
    current = gap >= 1 && gap <= 1 + STREAK_GRACE_DAYS ? s.current + 1 : 1;
  }
  const next: StreakRecord = {
    lastDay: today,
    current,
    longest: Math.max(s.longest, current),
  };
  writeJSON(STREAK_KEY, next);
  return next;
}

/**
 * Current streak as displayed, accounting for decay: if the learner hasn't
 * practiced within the grace window, the stored `current` is stale and should
 * read as 0 until they practice again. Read-only (does not persist).
 */
export function displayStreak(today: string = localDay()): number {
  const s = readStreak();
  if (!s.lastDay) return 0;
  const gap = daysBetween(s.lastDay, today);
  if (gap <= 1 + STREAK_GRACE_DAYS) return s.current;
  return 0;
}

// --- Streak milestones -----------------------------------------------------

export const MILESTONES_KEY = "ip:milestones:v1";

/** Streak lengths (days) that trigger a one-time celebration. */
export const STREAK_MILESTONES = [7, 14, 30, 50, 100] as const;

/**
 * If `current` streak length equals a milestone that has NOT yet been
 * celebrated, mark it claimed (persisted) and return it — otherwise null.
 * Idempotent: a milestone fires exactly once across sessions/reloads.
 */
export function claimStreakMilestone(current: number): number | null {
  if (!(STREAK_MILESTONES as readonly number[]).includes(current)) return null;
  const seen = readJSON<number[]>(MILESTONES_KEY, []);
  if (seen.includes(current)) return null;
  writeJSON(MILESTONES_KEY, [...seen, current]);
  return current;
}

// --- Resets ----------------------------------------------------------------

/** Remove all localStorage keys starting with `prefix` (SSR-safe). */
function removeByPrefix(prefix: string): void {
  if (!canStore()) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Clear mastery + accuracy data: per-question answer history and every
 * per-pool practice stat. Leaves streak, milestones, and theme intact.
 */
export function resetProgress(): void {
  if (!canStore()) return;
  try {
    localStorage.removeItem(ANSWERS_KEY);
  } catch {
    /* ignore */
  }
  removeByPrefix(PRACTICE_KEY_PREFIX);
}

/**
 * Clear the daily-habit data: streak and claimed streak milestones.
 * Leaves mastery/answers and theme intact.
 */
export function resetActivity(): void {
  if (!canStore()) return;
  try {
    localStorage.removeItem(STREAK_KEY);
    localStorage.removeItem(MILESTONES_KEY);
  } catch {
    /* ignore */
  }
}

// --- Last-visit (welcome-back warm-up) -------------------------------------

/** Local YYYY-MM-DD of the learner's previous visit, or "" if none recorded. */
export function readLastVisit(): string {
  return readJSON<string>(LASTVISIT_KEY, "");
}

/** Persist today's date as the last-visit day. */
export function writeLastVisit(today: string = localDay()): void {
  writeJSON(LASTVISIT_KEY, today);
}

/** Domain slug with the most currently-missed questions, or "" if none. */
export function topMissedDomain(): string {
  const map = readAnswers();
  const counts: Record<string, number> = {};
  for (const id in map) {
    const r = map[id];
    if (r.correct) continue;
    counts[r.domain] = (counts[r.domain] || 0) + 1;
  }
  let best = "";
  let max = 0;
  for (const d in counts) {
    if (counts[d] > max) {
      max = counts[d];
      best = d;
    }
  }
  return best;
}
